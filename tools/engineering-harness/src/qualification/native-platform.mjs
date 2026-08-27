import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rmdir,
  statfs,
  symlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { repositoryRoot } from "../paths.mjs";
import { loadG17Contract } from "./contract.mjs";
import {
  g17QualificationToolchain,
  g17ReceiptIdentity,
  verifyCurrentG17QualificationIdentity,
} from "./identity.mjs";
import { parseG17Elf64, parseG17GnuLinkerScript } from "./native-elf.mjs";
import {
  G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
  G17_NATIVE_CONTROLLER_SCHEMA,
  G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_REQUIRED_ROLES,
  G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
  G17_NATIVE_SOURCE_PLAN_SCHEMA,
  createG17NativePlatformClosureArtifact,
  g17NativePlatformProbeRecipes,
  replayG17NativePlatformProbe,
  verifyG17NativePlatformBundle,
} from "./native-platform-contract.mjs";
import {
  buildG17NativeSnapshotHelper,
  closeG17NativeSnapshotHelper,
  deleteG17NativeNode,
  snapshotG17NativeNode,
  verifyG17NativeSnapshotHelper,
} from "./native-snapshot.mjs";

const safeRunId = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const maximumFileBytes = 512 * 1024 * 1024;
const maximumEntries = 250_000;
const maximumToolchainBytes = 1_610_612_736;
const maximumPlatformBytes = 2_684_354_560;
const maximumCombinedBytes = 4_294_967_296;
const platformProfile = "linux-x86_64-gnu-bundled-rocksdb/v1";
const livePlatforms = new WeakMap();
const minimumProductionFreeBytes = 3_758_096_384;
const maximumControllerOutputBytes = 256 * 1024;
const productionWorkerSource = fileURLToPath(
  new URL("./contained-session-worker.mjs", import.meta.url),
);
const productionSeccompSource = fileURLToPath(
  new URL("../candidate/seccomp-launcher.py", import.meta.url),
);
const productionControllerExecutables = Object.freeze([
  Object.freeze({ id: "systemd-run", path: "/usr/bin/systemd-run", args: ["--version"] }),
  Object.freeze({ id: "prlimit", path: "/usr/bin/prlimit", args: ["--version"] }),
  Object.freeze({ id: "bwrap", path: "/usr/bin/bwrap", args: ["--version"] }),
]);
const productionTarget = Object.freeze({
  os: "linux",
  architecture: "x86_64",
  abi: "gnu",
  rustTriple: "x86_64-unknown-linux-gnu",
  gccTriple: "x86_64-linux-gnu",
  elfClass: 64,
  elfData: "little",
  elfMachine: 62,
  dynamicLoader: "lib64/ld-linux-x86-64.so.2",
});

export class G17NativePlatformFault extends Error {
  constructor(classification, phase, reason, cause) {
    super(`G1.7 native platform ${phase}/${classification}: ${reason}`, { cause });
    this.name = "G17NativePlatformFault";
    this.classification = classification;
    this.phase = phase;
    this.reason = reason;
  }
}

function platformFault(classification, phase, reason, cause) {
  throw new G17NativePlatformFault(classification, phase, reason, cause);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function exactKeys(value, expected, label) {
  if (
    !plainObject(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    platformFault("FAIL", "preflight", `${label} fields are not exact`);
  }
}

function rawStream(bytes) {
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  });
}

function verifyCanonicalArtifactRecord(
  record,
  { name, expectedKeys = ["name", "bytes", "sha256"], maximumBytes, label },
) {
  exactKeys(record, expectedKeys, label);
  const bytes = record.bytes;
  if (
    record.name !== name ||
    !Buffer.isBuffer(bytes) ||
    bytes.length < 2 ||
    bytes.length > maximumBytes ||
    bytes.at(-1) !== 0x0a ||
    !/^[0-9a-f]{64}$/u.test(record.sha256 ?? "") ||
    sha256(bytes) !== record.sha256
  ) {
    platformFault("FAIL", "verify", `${label} byte binding is invalid`);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    platformFault("FAIL", "verify", `${label} is not JSON`, error);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    platformFault("FAIL", "verify", `${label} is not canonical JSON`);
  }
  return Object.freeze({ bytes, value });
}

async function runPlatformController({
  executable,
  args,
  cwd,
  environment,
  stdin = Buffer.alloc(0),
  signal,
  timeoutMs = 30_000,
  maxOutputBytes = maximumControllerOutputBytes,
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let outputBytes = 0;
    const stdout = [];
    const stderr = [];
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const collect = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        settle(() => rejectPromise(
          new Error("platform controller output exceeded its ceiling"),
        ));
      } else {
        target.push(chunk);
      }
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.on("error", (error) => settle(() => rejectPromise(error)));
    child.on("close", (exitCode, observedSignal) => settle(() => resolvePromise({
      disposition: "completed",
      exitCode,
      signal: observedSignal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    })));
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") settle(() => rejectPromise(error));
    });
    child.stdin.end(stdin);
  });
}

const controllerEnvironment = Object.freeze({
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
});

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function safeRelativePath(value, label, { allowEmpty = false } = {}) {
  if (allowEmpty && value === "") return value;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    isAbsolute(value) ||
    value
      .split("/")
      .some(
        (part) =>
          part.length === 0 ||
          part === "." ||
          part === ".." ||
          Buffer.byteLength(part, "utf8") > 255,
      )
  ) {
    platformFault("FAIL", "preflight", `${label} is not a safe portable path`);
  }
  return value;
}

function safeSymlinkTarget(root, linkPath, target, label, phase = "materialize") {
  if (target.startsWith("/")) {
    if (root === "toolchain") {
      if (!target.startsWith("/toolchain/")) {
        platformFault("FAIL", phase, `${label} is outside the mounted toolchain root`);
      }
      return safeRelativePath(target.slice("/toolchain/".length), label);
    }
    if (linkPath === "tmp" && target === "/state/tmp") {
      return "state/tmp";
    }
    if (!/^\/(?:usr|bin|sbin|lib|lib64|etc)\//u.test(target)) {
      platformFault("FAIL", phase, `${label} is outside the mounted platform roots`);
    }
    return safeRelativePath(target.slice(1), label);
  }
  return safeRelativePath(
    posix.normalize(posix.join(posix.dirname(linkPath), target)),
    label,
  );
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

function objectIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
  });
}

async function boundedNoFollowBytes(path, label, phase) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    platformFault("MISSING", phase, "O_NOFOLLOW is unavailable");
  }
  let descriptor;
  try {
    descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || before.size < 0n || before.size > BigInt(maximumFileBytes)) {
      platformFault("FAIL", phase, `${label} is not a bounded regular file`);
    }
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat({ bigint: true });
    if (
      bytes.length !== Number(before.size) ||
      !isDeepStrictEqual(metadataIdentity(before), metadataIdentity(after))
    ) {
      platformFault("FAIL", phase, `${label} changed while it was read`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault(
      error?.code === "ENOENT" ? "MISSING" : "FAIL",
      phase,
      `${label} cannot be read safely`,
      error,
    );
  } finally {
    await descriptor?.close();
  }
}

async function writeExclusive(path, bytes, mode, label) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await descriptor.writeFile(bytes);
    await descriptor.sync();
  } catch (error) {
    platformFault("FAIL", "materialize", `${label} cannot be written exclusively`, error);
  } finally {
    await descriptor?.close();
  }
  await chmod(path, mode);
}

function stableSourceMetadata(before, after) {
  return isDeepStrictEqual(metadataIdentity(before), metadataIdentity(after));
}

async function copyNode(source, destination, logicalRoot, logicalPathValue, count) {
  count.signal?.throwIfAborted();
  if (count.value >= maximumEntries) {
    platformFault("FAIL", "materialize", "platform source exceeds its entry ceiling");
  }
  count.value += 1;
  const before = await lstat(source, { bigint: true }).catch((error) =>
    platformFault(
      error?.code === "ENOENT" ? "MISSING" : "FAIL",
      "materialize",
      `platform source is unavailable: ${logicalRoot}:${logicalPathValue}`,
      error,
    ));
  if (before.isDirectory() && !before.isSymbolicLink()) {
    await mkdir(destination, { recursive: false, mode: 0o700 }).catch((error) =>
      platformFault(
        "FAIL",
        "materialize",
        `platform directory destination collides: ${logicalRoot}:${logicalPathValue}`,
        error,
      ));
    const children = await readdir(source, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      safeRelativePath(child.name, "platform source entry name");
      const childLogical = logicalPathValue.length === 0
        ? child.name
        : `${logicalPathValue}/${child.name}`;
      await copyNode(
        join(source, child.name),
        join(destination, child.name),
        logicalRoot,
        childLogical,
        count,
      );
    }
    const after = await lstat(source, { bigint: true });
    if (!stableSourceMetadata(before, after)) {
      platformFault("FAIL", "materialize", `platform directory changed while copied: ${logicalRoot}:${logicalPathValue}`);
    }
    await chmod(destination, 0o555);
    return;
  }
  if (before.isFile() && !before.isSymbolicLink()) {
    const bytes = await boundedNoFollowBytes(
      source,
      `platform file ${logicalRoot}:${logicalPathValue}`,
      "materialize",
    );
    const mode = (Number(before.mode) & 0o111) === 0 ? 0o444 : 0o555;
    count[`${logicalRoot}Bytes`] += bytes.length;
    if (
      count.toolchainBytes > maximumToolchainBytes ||
      count.platformBytes > maximumPlatformBytes ||
      count.toolchainBytes + count.platformBytes > maximumCombinedBytes
    ) {
      platformFault("FAIL", "materialize", "platform source exceeds its byte ceiling");
    }
    await writeExclusive(
      destination,
      bytes,
      mode,
      `platform file ${logicalRoot}:${logicalPathValue}`,
    );
    const copied = await boundedNoFollowBytes(
      destination,
      `copied platform file ${logicalRoot}:${logicalPathValue}`,
      "materialize",
    );
    if (!bytes.equals(copied)) {
      platformFault("FAIL", "materialize", `platform file copy drifted: ${logicalRoot}:${logicalPathValue}`);
    }
    return;
  }
  if (before.isSymbolicLink()) {
    const target = await readlink(source);
    const after = await lstat(source, { bigint: true });
    if (
      !stableSourceMetadata(before, after) ||
      target.length === 0 ||
      target.includes("\0")
    ) {
      platformFault("FAIL", "materialize", `platform symlink is unsafe: ${logicalRoot}:${logicalPathValue}`);
    }
    safeSymlinkTarget(
      logicalRoot,
      logicalPathValue,
      target,
      `platform symlink target ${logicalRoot}:${logicalPathValue}`,
    );
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await symlink(target, destination).catch((error) =>
      platformFault(
        "FAIL",
        "materialize",
        `platform symlink destination collides: ${logicalRoot}:${logicalPathValue}`,
        error,
      ));
    return;
  }
  platformFault("FAIL", "materialize", `platform source has an unsupported type: ${logicalRoot}:${logicalPathValue}`);
}

function sourceDestinations(sources) {
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > 512) {
    platformFault("FAIL", "preflight", "platform source inventory is not bounded");
  }
  const normalized = sources.map((source, index) => {
    if (!plainObject(source) || !["toolchain", "platform"].includes(source.root)) {
      platformFault("FAIL", "preflight", `platform source ${index} is malformed`);
    }
    if (typeof source.source !== "string" || !isAbsolute(source.source)) {
      platformFault("FAIL", "preflight", `platform source ${index} is not absolute`);
    }
    if (resolve(source.source) !== source.source) {
      platformFault("FAIL", "preflight", `platform source ${index} is not normalized`);
    }
    safeRelativePath(source.destination, `platform source ${index} destination`, {
      allowEmpty: true,
    });
    return Object.freeze({
      root: source.root,
      source: source.source,
      destination: source.destination,
    });
  });
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      if (left.root !== right.root) continue;
      const leftPrefix = left.destination.length === 0 ? "" : `${left.destination}/`;
      const rightPrefix = right.destination.length === 0 ? "" : `${right.destination}/`;
      if (
        left.destination === right.destination ||
        left.destination.startsWith(rightPrefix) ||
        right.destination.startsWith(leftPrefix)
      ) {
        platformFault("FAIL", "preflight", "overlapping platform destinations are forbidden");
      }
    }
  }
  return Object.freeze(normalized);
}

const generatedRootDirectories = Object.freeze([
  "control",
  "control/cgroup2",
  "proc",
  "dev",
  "runner",
  "result",
  "workspace",
  "cargo-home",
  "toolchain",
  "state",
  "state/home",
  "state/target",
  "state/tmp",
]);

async function createGeneratedRootLayout(platformDirectory) {
  for (const logicalPath of generatedRootDirectories) {
    const destination = join(platformDirectory, ...logicalPath.split("/"));
    await mkdir(destination, { recursive: false, mode: 0o700 }).catch((error) =>
      platformFault(
        "FAIL",
        "materialize",
        `generated platform mountpoint collides: ${logicalPath}`,
        error,
      ));
  }
  await symlink("state/tmp", join(platformDirectory, "tmp")).catch((error) =>
    platformFault(
      "FAIL",
      "materialize",
      "generated platform tmp symlink collides",
      error,
    ));
}

async function sourceRootIdentity(source, index) {
  const [resolved, metadata] = await Promise.all([
    realpath(source).catch((error) =>
      platformFault(
        error?.code === "ENOENT" ? "MISSING" : "FAIL",
        "preflight",
        `platform source ${index} is unavailable`,
        error,
      )),
    lstat(source, { bigint: true }).catch((error) =>
      platformFault(
        error?.code === "ENOENT" ? "MISSING" : "FAIL",
        "preflight",
        `platform source ${index} cannot be inspected`,
        error,
      )),
  ]);
  if (
    resolved !== source ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    platformFault(
      "FAIL",
      "preflight",
      `platform source ${index} is not a real directory root`,
    );
  }
  return metadataIdentity(metadata);
}

function entryComparator(left, right) {
  const leftId = `${left.root}\0${left.path}`;
  const rightId = `${right.root}\0${right.path}`;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

async function completedTextProbe(executable, args, signal, label) {
  const outcome = await runPlatformController({
    executable,
    args,
    cwd: "/",
    environment: controllerEnvironment,
    signal,
  }).catch((error) =>
    platformFault("MISSING", "discover", `${label} could not start`, error));
  if (outcome.exitCode !== 0 || outcome.signal !== null || outcome.stderr.length !== 0) {
    platformFault("STALE", "discover", `${label} did not complete exactly`);
  }
  const value = outcome.stdout.toString("utf8");
  if (value.length < 1 || value.includes("\0")) {
    platformFault("FAIL", "discover", `${label} returned invalid text`);
  }
  return value.trim();
}

async function exactRealFile(path, label) {
  const resolved = await realpath(path).catch((error) =>
    platformFault("MISSING", "discover", `${label} is unavailable`, error));
  const metadata = await lstat(resolved, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    platformFault("FAIL", "discover", `${label} does not resolve to a regular file`);
  }
  return resolved;
}

async function discoverProductionSourcePlan(identity, signal) {
  const receiptIdentity = g17ReceiptIdentity(identity);
  const qualifiedToolchain = g17QualificationToolchain(identity);
  if (
    identity.host?.platform !== "linux" ||
    identity.host?.architecture !== "x64" ||
    identity.host?.targetTriple !== productionTarget.rustTriple
  ) {
    platformFault("MISSING", "discover", "qualified subject host is not supported");
  }
  const { cargo, rustc } = qualifiedToolchain;
  const rustcPath = await exactRealFile(rustc.toolchainPath, "qualified rustc");
  const cargoPath = await exactRealFile(cargo.toolchainPath, "qualified cargo");
  const [rustcBytes, cargoBytes, rustcVersion, cargoVersion] = await Promise.all([
    boundedNoFollowBytes(rustcPath, "qualified rustc", "discover"),
    boundedNoFollowBytes(cargoPath, "qualified cargo", "discover"),
    completedTextProbe(rustcPath, ["--version", "--verbose"], signal, "rustc version probe"),
    completedTextProbe(cargoPath, ["--version", "--verbose"], signal, "Cargo version probe"),
  ]);
  if (
    sha256(rustcBytes) !== rustc.toolchainExecutableSha256 ||
    sha256(cargoBytes) !== cargo.toolchainExecutableSha256 ||
    rustcVersion !== rustc.versionStdout ||
    cargoVersion !== cargo.versionStdout
  ) {
    platformFault("STALE", "discover", "qualified Rust toolchain bytes or versions drifted");
  }
  const sysroot = await realpath(resolve(dirname(rustcPath), "..")).catch((error) =>
    platformFault("MISSING", "discover", "qualified Rust sysroot is unavailable", error));
  const reportedSysroot = await completedTextProbe(
    rustcPath,
    ["--print", "sysroot"],
    signal,
    "rustc sysroot probe",
  );
  if (
    reportedSysroot !== sysroot ||
    !contained(sysroot, cargoPath) ||
    dirname(cargoPath) !== join(sysroot, "bin") ||
    dirname(rustcPath) !== join(sysroot, "bin")
  ) {
    platformFault("FAIL", "discover", "qualified Cargo and rustc do not share one sysroot");
  }
  const rustfmtPath = await exactRealFile(join(sysroot, "bin", "rustfmt"), "qualified rustfmt");
  const ccPath = await exactRealFile("/usr/bin/x86_64-linux-gnu-gcc", "GCC");
  const cxxPath = await exactRealFile("/usr/bin/x86_64-linux-gnu-g++", "G++");
  const gccMajor = /gcc-([0-9]+)$/u.exec(ccPath)?.[1];
  const gxxMajor = /g\+\+-([0-9]+)$/u.exec(cxxPath)?.[1];
  if (gccMajor === undefined || gccMajor !== gxxMajor) {
    platformFault("MISSING", "discover", "GCC and G++ major versions do not match");
  }
  const llvmCandidates = (await readdir("/usr/lib", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^llvm-[1-9][0-9]*$/u.test(entry.name))
    .map((entry) => Number(entry.name.slice("llvm-".length)))
    .sort((left, right) => right - left);
  let llvmMajor;
  for (const candidate of llvmCandidates) {
    const [libclang, headers] = await Promise.all([
      lstat(`/usr/lib/llvm-${candidate}/lib/libclang-${candidate}.so.1`).catch(() => null),
      lstat(`/usr/lib/llvm-${candidate}/lib/clang/${candidate}/include`).catch(() => null),
    ]);
    if (libclang?.isSymbolicLink() && headers?.isDirectory()) {
      llvmMajor = String(candidate);
      break;
    }
  }
  if (llvmMajor === undefined) {
    platformFault("MISSING", "discover", "a coherent libclang/header generation is unavailable");
  }
  const pythonPath = await exactRealFile("/usr/bin/python3", "Python 3");
  const pythonVersion = /^(python3\.[0-9]+)$/u.exec(basename(pythonPath))?.[1];
  if (pythonVersion === undefined) {
    platformFault("MISSING", "discover", "Python executable version is unsupported");
  }
  const items = [
    ["rust-cargo", "toolchain", cargoPath, "bin/cargo", []],
    ["rust-rustc", "toolchain", rustcPath, "bin/rustc", []],
    ["rust-rustfmt", "toolchain", rustfmtPath, "bin/rustfmt", []],
    ["rust-libraries", "toolchain", join(sysroot, "lib"), "lib", []],
    ["c-headers", "platform", "/usr/include", "usr/include", [
      "x86_64-linux-gnu/mpi",
      "x86_64-linux-gnu/openmpi",
    ]],
    ["gcc-libraries", "platform", `/usr/lib/gcc/x86_64-linux-gnu/${gccMajor}`, `usr/lib/gcc/x86_64-linux-gnu/${gccMajor}`, []],
    ["gcc-libexec", "platform", `/usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}`, `usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}`, []],
    ["clang-headers", "platform", `/usr/lib/llvm-${llvmMajor}/lib/clang/${llvmMajor}/include`, `usr/lib/llvm-${llvmMajor}/lib/clang/${llvmMajor}/include`, []],
    ["python-stdlib", "platform", `/usr/lib/${pythonVersion}`, `usr/lib/${pythonVersion}`, ["sitecustomize.py"]],
    ["cc", "platform", ccPath, `usr/bin/${basename(ccPath)}`, []],
    ["cxx", "platform", cxxPath, `usr/bin/${basename(cxxPath)}`, []],
    ["ar", "platform", "/usr/bin/x86_64-linux-gnu-ar", "usr/bin/x86_64-linux-gnu-ar", []],
    ["as", "platform", "/usr/bin/x86_64-linux-gnu-as", "usr/bin/x86_64-linux-gnu-as", []],
    ["ld", "platform", "/usr/bin/x86_64-linux-gnu-ld.bfd", "usr/bin/x86_64-linux-gnu-ld.bfd", []],
    ["nm", "platform", "/usr/bin/x86_64-linux-gnu-nm", "usr/bin/x86_64-linux-gnu-nm", []],
    ["ranlib", "platform", "/usr/bin/x86_64-linux-gnu-ranlib", "usr/bin/x86_64-linux-gnu-ranlib", []],
    ["node", "platform", "/usr/bin/node", "usr/bin/node", []],
    ["python", "platform", pythonPath, `usr/bin/${basename(pythonPath)}`, []],
    ["setpriv", "platform", "/usr/bin/setpriv", "usr/bin/setpriv", []],
    ["mount", "platform", "/usr/bin/mount", "usr/bin/mount", []],
    ["true", "platform", "/usr/bin/true", "usr/bin/true", []],
    ["os-release", "platform", "/usr/lib/os-release", "usr/lib/os-release", []],
    ["contained-session-worker", "platform", productionWorkerSource, "runner/contained-session-worker.mjs", []],
    ["seccomp-launcher", "platform", productionSeccompSource, "runner/seccomp-launcher.py", []],
  ].map(([id, root, source, destination, excludes]) => Object.freeze({
    id,
    root,
    source,
    destination,
    excludes: Object.freeze(excludes),
  }));
  const roleBindings = deepFreeze({
    cargo: { root: "toolchain", path: "bin/cargo" },
    rustc: { root: "toolchain", path: "bin/rustc" },
    rustfmt: { root: "toolchain", path: "bin/rustfmt" },
    rustLibraries: { root: "toolchain", path: "lib" },
    rustTargetLibraries: {
      root: "toolchain",
      path: `lib/rustlib/${productionTarget.rustTriple}`,
    },
    cc: { root: "platform", path: `usr/bin/${basename(ccPath)}` },
    cxx: { root: "platform", path: `usr/bin/${basename(cxxPath)}` },
    ar: { root: "platform", path: "usr/bin/x86_64-linux-gnu-ar" },
    as: { root: "platform", path: "usr/bin/x86_64-linux-gnu-as" },
    ld: { root: "platform", path: "usr/bin/x86_64-linux-gnu-ld.bfd" },
    nm: { root: "platform", path: "usr/bin/x86_64-linux-gnu-nm" },
    ranlib: { root: "platform", path: "usr/bin/x86_64-linux-gnu-ranlib" },
    cc1: { root: "platform", path: `usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}/cc1` },
    cc1plus: { root: "platform", path: `usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}/cc1plus` },
    collect2: { root: "platform", path: `usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}/collect2` },
    ltoWrapper: { root: "platform", path: `usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}/lto-wrapper` },
    lto1: { root: "platform", path: `usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}/lto1` },
    gccLibraries: { root: "platform", path: `usr/lib/gcc/x86_64-linux-gnu/${gccMajor}` },
    libltoPlugin: { root: "platform", path: `usr/lib/gcc/x86_64-linux-gnu/${gccMajor}/liblto_plugin.so` },
    cHeaders: { root: "platform", path: "usr/include" },
    cxxHeaders: { root: "platform", path: `usr/include/c++/${gccMajor}` },
    cxxTargetHeaders: { root: "platform", path: `usr/include/x86_64-linux-gnu/c++/${gccMajor}` },
    clangHeaders: { root: "platform", path: `usr/lib/llvm-${llvmMajor}/lib/clang/${llvmMajor}/include` },
    libclang: { root: "platform", path: `usr/lib/llvm-${llvmMajor}/lib/libclang-${llvmMajor}.so.1` },
    node: { root: "platform", path: "usr/bin/node" },
    python: { root: "platform", path: `usr/bin/${basename(pythonPath)}` },
    pythonStdlib: { root: "platform", path: `usr/lib/${pythonVersion}` },
    setpriv: { root: "platform", path: "usr/bin/setpriv" },
    mount: { root: "platform", path: "usr/bin/mount" },
    true: { root: "platform", path: "usr/bin/true" },
    libseccomp: { root: "platform", path: "lib/x86_64-linux-gnu/libseccomp.so.2" },
    dynamicLoader: { root: "platform", path: "lib64/ld-linux-x86-64.so.2" },
  });
  const projection = deepFreeze({
    schema: G17_NATIVE_SOURCE_PLAN_SCHEMA,
    subjectIdentitySha256: receiptIdentity.identitySha256,
    target: productionTarget,
    generations: { gccMajor, llvmMajor, pythonVersion },
    seeds: items.map(({ id, root, destination, excludes }) => ({
      id,
      root,
      destination,
      excludes,
    })),
    roles: roleBindings,
    dependencySourcePrefixes: [
      "toolchain:lib",
      "platform:usr/lib/x86_64-linux-gnu",
      `platform:usr/lib/llvm-${llvmMajor}/lib`,
      `platform:usr/lib/gcc/x86_64-linux-gnu/${gccMajor}`,
      `platform:usr/libexec/gcc/x86_64-linux-gnu/${gccMajor}`,
      "platform:usr/lib64",
    ],
  });
  const sourcePlanBytes = Buffer.from(`${canonicalJson(projection)}\n`, "utf8");
  return Object.freeze({
    receiptIdentity,
    sysroot,
    gccMajor,
    llvmMajor,
    pythonVersion,
    items: Object.freeze(items),
    roleBindings,
    qualifiedToolchain,
    projection,
    sourcePlanProjectionSha256: canonicalSha256(projection),
    sourcePlanSha256: sha256(sourcePlanBytes),
  });
}

function expandOriginPath(value, origin) {
  const expanded = value
    .replaceAll("${ORIGIN}", origin)
    .replaceAll("$ORIGIN", origin);
  if (expanded.includes("$") || !isAbsolute(expanded)) return null;
  return resolve(expanded);
}

async function controllerElfClosure(seedPath) {
  const allowedRoots = ["/usr/bin", "/usr/lib", "/usr/lib64", "/lib", "/lib64"];
  const queue = [await realpath(seedPath)];
  const records = new Map();
  while (queue.length > 0) {
    const path = queue.shift();
    if (records.has(path)) continue;
    const resolvedPath = await realpath(path).catch((error) =>
      platformFault("MISSING", "controller", "controller ELF dependency is absent", error));
    if (!allowedRoots.some((root) => contained(root, resolvedPath))) {
      platformFault("FAIL", "controller", "controller ELF dependency escaped system roots");
    }
    const file = await boundedNoFollowBytes(
      resolvedPath,
      "controller ELF dependency",
      "controller",
    );
    const parsed = parseG17Elf64(file);
    if (parsed === null) {
      platformFault("FAIL", "controller", "controller dependency is not ELF");
    }
    const origin = dirname(resolvedPath);
    const search = [
      ...parsed.runpath.map((value) => expandOriginPath(value, origin)),
      ...parsed.rpath.map((value) => expandOriginPath(value, origin)),
      origin,
      "/usr/lib/x86_64-linux-gnu",
      "/usr/lib/systemd",
      "/usr/lib64",
      "/lib/x86_64-linux-gnu",
      "/lib64",
    ].filter((value) => value !== null);
    for (const needed of parsed.needed) {
      let target;
      for (const directory of search) {
        const candidate = join(directory, needed);
        try {
          const metadata = await lstat(candidate);
          if (metadata.isFile() || metadata.isSymbolicLink()) {
            target = await realpath(candidate);
            break;
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      if (target === undefined) {
        platformFault("MISSING", "controller", `controller dependency ${needed} is absent`);
      }
      queue.push(target);
    }
    if (parsed.interpreter !== null) queue.push(parsed.interpreter);
    records.set(resolvedPath, Object.freeze({
      path: resolvedPath,
      bytes: file.length,
      sha256: sha256(file),
      soname: parsed.soname,
      needed: parsed.needed,
    }));
  }
  const closure = [...records.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze({
    records: Object.freeze(closure),
    sha256: canonicalSha256(closure),
  });
}

async function createProductionControllerAttestation(helper, signal) {
  const tools = [];
  const closures = {};
  for (const definition of productionControllerExecutables) {
    const executable = await exactRealFile(definition.path, definition.id);
    const [bytes, version, closure] = await Promise.all([
      boundedNoFollowBytes(executable, `${definition.id} controller`, "controller"),
      runPlatformController({
        executable,
        args: definition.args,
        cwd: "/",
        environment: controllerEnvironment,
        signal,
      }),
      controllerElfClosure(executable),
    ]);
    if (version.exitCode !== 0 || version.signal !== null) {
      platformFault("STALE", "controller", `${definition.id} version probe failed`);
    }
    closures[definition.id] = closure;
    tools.push({
      id: definition.id,
      executableSha256: sha256(bytes),
      version: rawStream(Buffer.concat([version.stdout, version.stderr])),
      dependencyClosureSha256: closure.sha256,
    });
  }
  const workerBytes = await boundedNoFollowBytes(
    productionWorkerSource,
    "contained session worker",
    "controller",
  );
  const launcherBytes = await boundedNoFollowBytes(
    productionSeccompSource,
    "seccomp launcher",
    "controller",
  );
  const helperAttestation = await verifyG17NativeSnapshotHelper(helper);
  tools.push(
    {
      id: "native-snapshot-helper",
      executableSha256: helperAttestation.executable.sha256,
      version: rawStream(Buffer.from(`${helperAttestation.schema}\n`, "utf8")),
      dependencyClosureSha256: canonicalSha256({
        source: helperAttestation.source,
        compiler: helperAttestation.compiler,
      }),
    },
    {
      id: "contained-session-worker",
      executableSha256: sha256(workerBytes),
      version: rawStream(Buffer.from("contained-session-worker/v5\n", "utf8")),
      dependencyClosureSha256: sha256(workerBytes),
    },
    {
      id: "seccomp-launcher",
      executableSha256: sha256(launcherBytes),
      version: rawStream(Buffer.from("seccomp-launcher/v3\n", "utf8")),
      dependencyClosureSha256: sha256(launcherBytes),
    },
  );
  const base = {
    schema: G17_NATIVE_CONTROLLER_SCHEMA,
    tools,
    closures,
    snapshotHelper: helperAttestation,
  };
  const value = deepFreeze({ ...base, sha256: canonicalSha256(base) });
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  return Object.freeze({
    value,
    artifact: Object.freeze({
      name: G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
      get bytes() {
        return Buffer.from(bytes);
      },
      sha256: sha256(bytes),
    }),
  });
}

function productionDestination(root, rootName, logicalPath) {
  const directory = rootName === "toolchain"
    ? join(root, "toolchain")
    : join(root, "platform");
  return join(directory, ...logicalPath.split("/"));
}

async function copyProductionItem({ helper, root, item, totals, signal }) {
  const destination = productionDestination(root, item.root, item.destination);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const remainingBytes = maximumCombinedBytes - totals.bytes;
  const remainingEntries = maximumEntries - totals.entries;
  if (remainingBytes < 1 || remainingEntries < 1) {
    platformFault("FAIL", "materialize", "production platform exhausted its aggregate ceiling");
  }
  const result = await snapshotG17NativeNode({
    helper,
    source: item.source,
    destination,
    maxFileBytes: maximumFileBytes,
    maxBytes: remainingBytes,
    maxEntries: remainingEntries,
    excludes: item.excludes,
    signal,
  }).catch((error) => {
    if (error?.classification === "MISSING") throw error;
    platformFault("FAIL", "materialize", `production source ${item.id} failed`, error);
  });
  totals.bytes += result.bytes;
  totals.entries += result.entries;
  totals[`${item.root}Bytes`] += result.bytes;
  if (
    totals.toolchainBytes > maximumToolchainBytes ||
    totals.platformBytes > maximumPlatformBytes ||
    totals.bytes > maximumCombinedBytes ||
    totals.entries > maximumEntries
  ) {
    platformFault("FAIL", "materialize", "production platform exceeds its reviewed ceilings");
  }
}

async function createProductionLayout(platformDirectory, plan) {
  await createGeneratedRootLayout(platformDirectory);
  for (const path of [
    "usr/bin",
    "usr/lib",
    "usr/lib64",
    "usr/local",
    "usr/local/include",
    "usr/sbin",
    "etc",
  ]) {
    await mkdir(join(platformDirectory, ...path.split("/")), {
      recursive: true,
      mode: 0o700,
    });
  }
  for (const [path, target] of [
    ["bin", "usr/bin"],
    ["sbin", "usr/sbin"],
    ["lib", "usr/lib"],
    ["lib64", "usr/lib64"],
    ["etc/os-release", "../usr/lib/os-release"],
    ["usr/bin/python3", plan.pythonVersion],
    ["usr/bin/x86_64-linux-gnu-ld", "x86_64-linux-gnu-ld.bfd"],
    ["usr/bin/as", "x86_64-linux-gnu-as"],
    ["usr/bin/ld", "x86_64-linux-gnu-ld.bfd"],
    ["usr/bin/ar", "x86_64-linux-gnu-ar"],
    ["usr/bin/nm", "x86_64-linux-gnu-nm"],
    ["usr/bin/ranlib", "x86_64-linux-gnu-ranlib"],
    ["usr/bin/cc", `x86_64-linux-gnu-gcc-${plan.gccMajor}`],
    ["usr/bin/c++", `x86_64-linux-gnu-g++-${plan.gccMajor}`],
  ]) {
    await symlink(target, join(platformDirectory, ...path.split("/"))).catch((error) =>
      platformFault("FAIL", "materialize", `production alias ${path} collided`, error));
  }
}

function normalizeLogical(rootName, path, label) {
  const safe = safeRelativePath(path, label);
  if (rootName === "toolchain") return { root: rootName, path: safe };
  const aliases = [
    ["bin", "usr/bin"],
    ["sbin", "usr/sbin"],
    ["lib", "usr/lib"],
    ["lib64", "usr/lib64"],
  ];
  for (const [from, to] of aliases) {
    if (safe === from || safe.startsWith(`${from}/`)) {
      return {
        root: rootName,
        path: safe === from ? to : `${to}/${safe.slice(from.length + 1)}`,
      };
    }
  }
  return { root: rootName, path: safe };
}

function hostSourceForLogical(plan, rootName, logicalPath) {
  const normalized = normalizeLogical(rootName, logicalPath, "dependency logical path");
  if (normalized.root === "toolchain") {
    return {
      ...normalized,
      source: join(plan.sysroot, ...normalized.path.split("/")),
    };
  }
  return { ...normalized, source: `/${normalized.path}` };
}

async function ensureProductionLogical({
  helper,
  root,
  plan,
  rootName,
  logicalPath,
  totals,
  signal,
  stack = new Set(),
}) {
  const source = hostSourceForLogical(plan, rootName, logicalPath);
  const identity = `${source.root}:${source.path}`;
  if (stack.has(identity)) {
    platformFault("FAIL", "dependency", `production symlink cycle at ${identity}`);
  }
  const destination = productionDestination(root, source.root, source.path);
  let metadata;
  try {
    metadata = await lstat(destination, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const allowed = source.root === "toolchain"
      ? contained(plan.sysroot, source.source)
      : [
        "/usr/bin",
        "/usr/include",
        "/usr/lib",
        "/usr/lib64",
        "/usr/libexec",
      ].some((prefix) => contained(prefix, source.source));
    if (!allowed) {
      platformFault("FAIL", "dependency", `dependency source escaped its roots: ${identity}`);
    }
    await copyProductionItem({
      helper,
      root,
      item: {
        id: `dependency-${sha256(Buffer.from(identity)).slice(0, 16)}`,
        root: source.root,
        source: source.source,
        destination: source.path,
        excludes: [],
      },
      totals,
      signal,
    });
    metadata = await lstat(destination, { bigint: true });
  }
  if (metadata.isSymbolicLink()) {
    const target = await readlink(destination);
    const targetPath = target.startsWith("/")
      ? target.slice(1)
      : posix.normalize(posix.join(posix.dirname(source.path), target));
    const nextRoot = target.startsWith("/toolchain/") ? "toolchain" : source.root;
    const nextPath = target.startsWith("/toolchain/")
      ? target.slice("/toolchain/".length)
      : targetPath;
    const nextStack = new Set(stack);
    nextStack.add(identity);
    return ensureProductionLogical({
      helper,
      root,
      plan,
      rootName: nextRoot,
      logicalPath: nextPath,
      totals,
      signal,
      stack: nextStack,
    });
  }
  if (!metadata.isFile() && !metadata.isDirectory()) {
    platformFault("FAIL", "dependency", `dependency has an unsupported type: ${identity}`);
  }
  return Object.freeze({
    root: source.root,
    path: source.path,
    kind: metadata.isFile() ? "file" : "directory",
  });
}

async function walkProductionTree(rootName, directory, relativePath = "") {
  const found = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const child of children) {
    safeRelativePath(child.name, "production tree entry name");
    const path = relativePath === "" ? child.name : `${relativePath}/${child.name}`;
    const hostPath = join(directory, child.name);
    const metadata = await lstat(hostPath);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      found.push(...await walkProductionTree(rootName, hostPath, path));
    } else {
      found.push({ root: rootName, path, kind: metadata.isSymbolicLink() ? "symlink" : metadata.isFile() ? "file" : "unsupported" });
    }
  }
  return found;
}

async function closeProductionSymlinks(context) {
  for (;;) {
    const inventory = [
      ...await walkProductionTree("toolchain", join(context.root, "toolchain")),
      ...await walkProductionTree("platform", join(context.root, "platform")),
    ];
    let copied = false;
    for (const entry of inventory.filter(({ kind }) => kind === "symlink")) {
      const destination = productionDestination(context.root, entry.root, entry.path);
      const target = await readlink(destination);
      const nextRoot = target.startsWith("/toolchain/") ? "toolchain" : entry.root;
      const nextPath = target.startsWith("/toolchain/")
        ? target.slice("/toolchain/".length)
        : target.startsWith("/")
          ? target.slice(1)
          : posix.normalize(posix.join(posix.dirname(entry.path), target));
      const normalized = normalizeLogical(nextRoot, nextPath, "production symlink target");
      const targetDestination = productionDestination(
        context.root,
        normalized.root,
        normalized.path,
      );
      try {
        await lstat(targetDestination);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await ensureProductionLogical({
          ...context,
          rootName: nextRoot,
          logicalPath: nextPath,
        });
        copied = true;
      }
    }
    if (!copied) return;
  }
}

function logicalSearchDirectory(node, value) {
  const label = `ELF search path ${JSON.stringify(value)} for ${node.root}:${node.path}`;
  const origin = posix.dirname(node.path);
  const expanded = value
    .replaceAll("${ORIGIN}", origin)
    .replaceAll("$ORIGIN", origin);
  if (expanded.includes("$")) return null;
  const canonical = (rootName, path) => {
    const normalized = posix.normalize(path).replace(/\/$/u, "");
    return normalizeLogical(rootName, normalized, label);
  };
  if (expanded.startsWith("/toolchain/")) {
    return canonical("toolchain", expanded.slice("/toolchain/".length));
  }
  if (expanded.startsWith("/")) {
    return canonical("platform", expanded.slice(1));
  }
  return canonical(node.root, posix.join(origin, expanded));
}

async function productionCandidateExists(context, candidate) {
  const normalized = normalizeLogical(candidate.root, candidate.path, "ELF dependency candidate");
  try {
    await lstat(productionDestination(context.root, normalized.root, normalized.path));
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const source = hostSourceForLogical(context.plan, normalized.root, normalized.path);
  try {
    const metadata = await lstat(source.source);
    return metadata.isFile() || metadata.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function buildProductionElfGraph(context) {
  const initialByIdentity = new Map();
  for (const required of G17_NATIVE_PLATFORM_REQUIRED_ROLES) {
    const binding = context.plan.roleBindings[required.id];
    const terminal = await ensureProductionLogical({
      ...context,
      rootName: binding.root,
      logicalPath: binding.path,
    });
    const candidates = terminal.kind === "directory"
      ? await walkProductionTree(
        terminal.root,
        productionDestination(context.root, terminal.root, terminal.path),
        terminal.path,
      )
      : [terminal];
    for (const candidate of candidates.filter(({ kind }) => kind === "file")) {
      initialByIdentity.set(`${candidate.root}:${candidate.path}`, candidate);
    }
  }
  const initial = [...initialByIdentity.values()];
  const queue = initial.map(({ root: rootName, path }) => ({ root: rootName, path }));
  const nodes = new Map();
  const edges = [];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate.path.endsWith(".o") || candidate.path.endsWith(".a")) continue;
    const terminal = await ensureProductionLogical({
      ...context,
      rootName: candidate.root,
      logicalPath: candidate.path,
    });
    if (terminal.kind !== "file") continue;
    const identity = `${terminal.root}:${terminal.path}`;
    if (nodes.has(identity)) continue;
    const bytes = await boundedNoFollowBytes(
      productionDestination(context.root, terminal.root, terminal.path),
      `production ELF ${identity}`,
      "elf",
    );
    const parsed = parseG17Elf64(bytes);
    if (parsed === null) continue;
    const node = {
      root: terminal.root,
      path: terminal.path,
      sha256: sha256(bytes),
      ...parsed,
      interpreter: null,
    };
    nodes.set(identity, node);
    if (parsed.interpreter !== null) {
      const raw = parsed.interpreter.startsWith("/toolchain/")
        ? { root: "toolchain", path: parsed.interpreter.slice("/toolchain/".length) }
        : { root: "platform", path: parsed.interpreter.slice(1) };
      const interpreter = await ensureProductionLogical({
        ...context,
        rootName: raw.root,
        logicalPath: raw.path,
      });
      if (interpreter.kind !== "file") {
        platformFault("FAIL", "elf", `ELF interpreter for ${identity} is not a file`);
      }
      node.interpreter = `${interpreter.root}:${interpreter.path}`;
      queue.push(interpreter);
    }
    const configuredSearch = [
      ...parsed.runpath,
      ...parsed.rpath,
    ].map((value) => logicalSearchDirectory(node, value)).filter(Boolean);
    const defaults = node.root === "toolchain"
      ? [
        { root: "toolchain", path: "lib" },
        { root: "toolchain", path: `lib/rustlib/${productionTarget.rustTriple}/lib` },
        { root: "platform", path: `usr/lib/gcc/x86_64-linux-gnu/${context.plan.gccMajor}` },
        { root: "platform", path: "usr/lib/x86_64-linux-gnu" },
        { root: "platform", path: `usr/lib/llvm-${context.plan.llvmMajor}/lib` },
        { root: "platform", path: "usr/lib64" },
      ]
      : [
        { root: node.root, path: posix.dirname(node.path) },
        { root: "platform", path: `usr/lib/gcc/x86_64-linux-gnu/${context.plan.gccMajor}` },
        { root: "platform", path: "usr/lib/x86_64-linux-gnu" },
        { root: "platform", path: `usr/lib/llvm-${context.plan.llvmMajor}/lib` },
        { root: "platform", path: "usr/lib64" },
        { root: "toolchain", path: "lib" },
      ];
    for (const needed of parsed.needed) {
      if (
        needed.includes("/") ||
        needed.includes("\0") ||
        Buffer.byteLength(needed, "utf8") > 255
      ) {
        platformFault("FAIL", "elf", `ELF dependency name is unsafe: ${identity}`);
      }
      let selected;
      for (const directory of [...configuredSearch, ...defaults]) {
        const path = posix.normalize(posix.join(directory.path, needed));
        const next = normalizeLogical(directory.root, path, "ELF dependency path");
        if (await productionCandidateExists(context, next)) {
          selected = next;
          break;
        }
      }
      if (selected === undefined) {
        platformFault("MISSING", "elf", `ELF dependency ${identity}/${needed} is unavailable`);
      }
      const target = await ensureProductionLogical({
        ...context,
        rootName: selected.root,
        logicalPath: selected.path,
      });
      if (target.kind !== "file") {
        platformFault("FAIL", "elf", `ELF dependency ${identity}/${needed} is not a file`);
      }
      edges.push({ from: identity, needed, to: `${target.root}:${target.path}` });
      queue.push(target);
    }
  }
  const sortedNodes = [...nodes.values()].sort((left, right) => {
    const leftId = `${left.root}:${left.path}`;
    const rightId = `${right.root}:${right.path}`;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  edges.sort((left, right) => {
    const leftId = `${left.from}\0${left.needed}\0${left.to}`;
    const rightId = `${right.from}\0${right.needed}\0${right.to}`;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return { nodes: sortedNodes, edges };
}

async function buildProductionLinkerClosure(context) {
  const seedPaths = [
    "usr/lib/x86_64-linux-gnu/crt1.o",
    "usr/lib/x86_64-linux-gnu/Scrt1.o",
    "usr/lib/x86_64-linux-gnu/rcrt1.o",
    "usr/lib/x86_64-linux-gnu/crti.o",
    "usr/lib/x86_64-linux-gnu/crtn.o",
    "usr/lib/x86_64-linux-gnu/libc.so",
    "usr/lib/x86_64-linux-gnu/libc_nonshared.a",
    "usr/lib/x86_64-linux-gnu/libdl.a",
    "usr/lib/x86_64-linux-gnu/libm.so",
    "usr/lib/x86_64-linux-gnu/libpthread.a",
    "usr/lib/x86_64-linux-gnu/librt.a",
    "usr/lib/x86_64-linux-gnu/libutil.a",
  ];
  for (const path of seedPaths) {
    await ensureProductionLogical({ ...context, rootName: "platform", logicalPath: path });
  }
  const records = new Map();
  const queue = [
    { root: "platform", path: "usr/lib/x86_64-linux-gnu/libc.so" },
    { root: "platform", path: "usr/lib/x86_64-linux-gnu/libm.so" },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    const terminal = await ensureProductionLogical({
      ...context,
      rootName: current.root,
      logicalPath: current.path,
    });
    if (terminal.kind !== "file") continue;
    const identity = `${terminal.root}:${terminal.path}`;
    if (records.has(identity)) continue;
    const bytes = await boundedNoFollowBytes(
      productionDestination(context.root, terminal.root, terminal.path),
      `production linker script ${identity}`,
      "linker",
    );
    const parsed = parseG17GnuLinkerScript(bytes);
    if (parsed === null) continue;
    const inputs = [];
    for (const rawInput of parsed.inputs) {
      let input;
      if (rawInput.startsWith("-l")) {
        const needed = `lib${rawInput.slice(2)}.so`;
        const directories = [
          `usr/lib/gcc/x86_64-linux-gnu/${context.plan.gccMajor}`,
          "usr/lib/x86_64-linux-gnu",
        ];
        for (const directory of directories) {
          const candidate = { root: "platform", path: `${directory}/${needed}` };
          if (await productionCandidateExists(context, candidate)) {
            input = candidate;
            break;
          }
        }
      } else if (rawInput.startsWith("/")) {
        input = { root: "platform", path: rawInput.slice(1) };
      } else {
        input = {
          root: terminal.root,
          path: posix.normalize(posix.join(posix.dirname(terminal.path), rawInput)),
        };
      }
      if (input === undefined) {
        platformFault("MISSING", "linker", `linker input ${rawInput} is unavailable`);
      }
      const normalized = normalizeLogical(input.root, input.path, "linker input");
      await ensureProductionLogical({
        ...context,
        rootName: normalized.root,
        logicalPath: normalized.path,
      });
      inputs.push(`${normalized.root}:${normalized.path}`);
      queue.push(normalized);
    }
    records.set(identity, {
      root: terminal.root,
      path: terminal.path,
      sha256: sha256(bytes),
      directives: parsed.directives,
      inputs,
    });
  }
  const sorted = [...records.values()].sort((left, right) =>
    `${left.root}:${left.path}`.localeCompare(`${right.root}:${right.path}`));
  if (sorted.length < 2) {
    platformFault("FAIL", "linker", "production linker-script closure is incomplete");
  }
  return sorted;
}

async function createProductionProbeRunner({
  platformDirectory,
  toolchainDirectory,
  stateDirectory,
}) {
  const bwrap = "/usr/bin/bwrap";
  return async ({
    executable,
    args,
    cwd,
    environment,
    stdin,
    productPaths,
    timeoutMs,
    maxOutputBytes,
    signal,
  }) => {
    let logicalExecutable;
    if (contained(toolchainDirectory, executable)) {
      logicalExecutable = `/toolchain/${relative(toolchainDirectory, executable).split(sep).join("/")}`;
    } else if (contained(platformDirectory, executable)) {
      logicalExecutable = `/${relative(platformDirectory, executable).split(sep).join("/")}`;
    } else {
      platformFault("FAIL", "probe", "probe executable escaped generated roots");
    }
    const sandbox = [
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
      "--clearenv",
      "--ro-bind",
      platformDirectory,
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--remount-ro",
      "/dev",
      "--ro-bind",
      toolchainDirectory,
      "/toolchain",
      "--bind",
      stateDirectory,
      "/state",
      "--chdir",
      cwd,
    ];
    for (const [name, value] of Object.entries(environment)) {
      sandbox.push("--setenv", name, value);
    }
    sandbox.push("--", logicalExecutable, ...args);
    const started = Date.now();
    const outcome = await runPlatformController({
      executable: bwrap,
      args: sandbox,
      cwd: "/",
      environment: controllerEnvironment,
      stdin,
      signal,
      timeoutMs,
      maxOutputBytes,
    });
    const products = [];
    if (outcome.exitCode === 0 && outcome.signal === null) {
      for (const path of productPaths) {
        if (!path.startsWith("/state/") || path.includes("..")) {
          platformFault("FAIL", "probe", "probe product path is unsafe");
        }
        const bytes = await boundedNoFollowBytes(
          join(stateDirectory, ...path.slice("/state/".length).split("/")),
          `probe product ${path}`,
          "probe",
        );
        products.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
    return {
      disposition: outcome.disposition,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      durationMs: Math.min(timeoutMs, Math.max(0, Date.now() - started)),
      stdout: outcome.stdout.toString("utf8"),
      stderr: outcome.stderr.toString("utf8"),
      products,
    };
  };
}

async function scanNode(rootName, rootDirectory, path, entries, phase) {
  const hostPath = join(rootDirectory, ...path.split("/"));
  const metadata = await lstat(hostPath, { bigint: true });
  const mode = Number(metadata.mode) & 0o777;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    if ((mode & 0o222) !== 0) {
      platformFault("FAIL", phase, `generated platform directory is writable: ${rootName}:${path}`);
    }
    const entry = {
      root: rootName,
      path,
      kind: "directory",
      mode,
      bytes: 0,
      sha256: null,
      target: null,
    };
    entries.push(entry);
    const children = await readdir(hostPath, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      safeRelativePath(child.name, "generated platform entry name");
      await scanNode(rootName, rootDirectory, `${path}/${child.name}`, entries, phase);
    }
    return;
  }
  if (metadata.isFile() && !metadata.isSymbolicLink()) {
    if ((mode & 0o222) !== 0) {
      platformFault("FAIL", phase, `generated platform file is writable: ${rootName}:${path}`);
    }
    const bytes = await boundedNoFollowBytes(
      hostPath,
      `generated platform file ${rootName}:${path}`,
      phase,
    );
    entries.push({
      root: rootName,
      path,
      kind: "file",
      mode,
      bytes: bytes.length,
      sha256: sha256(bytes),
      target: null,
    });
    return;
  }
  if (metadata.isSymbolicLink()) {
    entries.push({
      root: rootName,
      path,
      kind: "symlink",
      mode: null,
      bytes: null,
      sha256: null,
      target: await readlink(hostPath),
    });
    return;
  }
  platformFault("FAIL", phase, `generated platform entry has an unsupported type: ${rootName}:${path}`);
}

function directorySha256(root, path, children) {
  return canonicalSha256({
    schema: "oxigraph.g1.7-platform-directory/v2",
    root,
    path,
    children: children.map(
      ({ path: childPath, kind, mode, bytes, sha256: digest, target }) => ({
        path: childPath,
        kind,
        mode,
        bytes,
        sha256: digest,
        target,
      }),
    ),
  });
}

function bindDirectoryDigests(entries) {
  const childrenByDirectory = new Map();
  for (const entry of entries) {
    const parentPath = posix.dirname(entry.path);
    if (parentPath === ".") continue;
    const parentIdentity = `${entry.root}:${parentPath}`;
    const children = childrenByDirectory.get(parentIdentity) ?? [];
    children.push(entry);
    childrenByDirectory.set(parentIdentity, children);
  }
  const directories = entries
    .filter(({ kind }) => kind === "directory")
    .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
  for (const directory of directories) {
    directory.sha256 = directorySha256(
      directory.root,
      directory.path,
      childrenByDirectory.get(`${directory.root}:${directory.path}`) ?? [],
    );
  }
}

async function scanRoots(toolchainDirectory, platformDirectory, phase = "manifest") {
  const entries = [];
  for (const [rootName, rootDirectory] of [
    ["toolchain", toolchainDirectory],
    ["platform", platformDirectory],
  ]) {
    const children = await readdir(rootDirectory, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      safeRelativePath(child.name, "generated platform root entry");
      await scanNode(rootName, rootDirectory, child.name, entries, phase);
    }
  }
  if (entries.length < 1 || entries.length > maximumEntries) {
      platformFault("FAIL", phase, "generated platform entry inventory is not bounded");
  }
  entries.sort(entryComparator);
  bindDirectoryDigests(entries);
  return entries;
}

function resolveEntry(entriesById, initial) {
  let current = { root: initial.root, path: initial.path };
  const visited = new Set();
  for (let depth = 0; depth <= 64; depth += 1) {
    const identity = `${current.root}:${current.path}`;
    if (visited.has(identity)) platformFault("FAIL", "role", `platform symlink cycle: ${identity}`);
    visited.add(identity);
    const parts = current.path.split("/");
    let redirected = false;
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      const entry = entriesById.get(`${current.root}:${prefix}`);
      if (entry === undefined) {
        platformFault("MISSING", "role", `platform path is absent: ${identity}/${prefix}`);
      }
      if (entry.kind === "symlink") {
        const resolvedPath = safeSymlinkTarget(
          entry.root,
          entry.path,
          entry.target,
          `platform symlink target ${entry.root}:${entry.path}`,
          "role",
        );
        const remainder = parts.slice(length).join("/");
        current = {
          root: current.root,
          path: remainder.length === 0
            ? resolvedPath
            : posix.join(resolvedPath, remainder),
        };
        safeRelativePath(current.path, `platform continued symlink target ${identity}`);
        redirected = true;
        break;
      }
      if (length < parts.length && entry.kind !== "directory") {
        platformFault("FAIL", "role", `platform path has a non-directory ancestor: ${identity}`);
      }
      if (length === parts.length) return entry;
    }
    if (!redirected) {
      platformFault("FAIL", "role", `platform path did not resolve: ${identity}`);
    }
  }
  platformFault("FAIL", "role", "platform symlink chain exceeds its depth ceiling");
}

function projectRoles(roleBindings, entries) {
  if (!plainObject(roleBindings)) platformFault("FAIL", "role", "platform role bindings are malformed");
  const entriesById = new Map(entries.map((entry) => [`${entry.root}:${entry.path}`, entry]));
  return Object.fromEntries(
    G17_NATIVE_PLATFORM_REQUIRED_ROLES.map((required) => {
      const binding = roleBindings[required.id];
      if (
        !plainObject(binding) ||
        binding.root !== required.root ||
        typeof binding.path !== "string"
      ) {
        platformFault("FAIL", "role", `platform role binding is absent: ${required.id}`);
      }
      safeRelativePath(binding.path, `platform role ${required.id} path`);
      const resolved = resolveEntry(entriesById, binding);
      if (resolved.kind !== required.kind || typeof resolved.sha256 !== "string") {
        platformFault("FAIL", "role", `platform role has an unsafe type: ${required.id}`);
      }
      return [required.id, {
        root: binding.root,
        path: binding.path,
        kind: required.kind,
        resolvedPath: resolved.path,
        sha256: resolved.sha256,
      }];
    }),
  );
}

function streamEvidence(text, label) {
  if (typeof text !== "string") platformFault("FAIL", "probe", `${label} is not text`);
  const bytes = Buffer.from(text, "utf8");
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  });
}

async function collectProbes({
  processRunner,
  roles,
  toolchainDirectory,
  platformDirectory,
  signal,
}) {
  const roots = { toolchain: toolchainDirectory, platform: platformDirectory };
  const probes = [];
  for (const definition of g17NativePlatformProbeRecipes(roles)) {
    const role = roles[definition.role];
    if (role === undefined || role.kind !== "file") {
      platformFault("FAIL", "probe", `platform probe role is invalid: ${definition.id}`);
    }
    const executable = join(roots[role.root], ...role.path.split("/"));
    let outcome;
    try {
      outcome = await processRunner({
        executable,
        args: definition.argv.slice(1),
        cwd: definition.cwd,
        environment: definition.environment,
        stdin: Buffer.from(definition.stdin.base64, "base64"),
        productPaths: definition.productPaths,
        probeId: definition.id,
        timeoutMs: definition.timeoutMs,
        maxOutputBytes: definition.maxOutputBytes,
        signal,
      });
    } catch (error) {
      platformFault("MISSING", "probe", `platform probe could not start: ${definition.id}`, error);
    }
    if (
      !plainObject(outcome) ||
      outcome.disposition !== "completed" ||
      outcome.exitCode !== 0 ||
      outcome.signal !== null ||
      typeof outcome.stdout !== "string" ||
      typeof outcome.stderr !== "string" ||
      !Array.isArray(outcome.products) ||
      !Number.isSafeInteger(outcome.durationMs) ||
      outcome.durationMs < 0 ||
      outcome.durationMs > definition.timeoutMs
    ) {
      const diagnostic = plainObject(outcome)
        ? ` disposition=${JSON.stringify(outcome.disposition)}` +
          ` exitCode=${JSON.stringify(outcome.exitCode)}` +
          ` signal=${JSON.stringify(outcome.signal)}` +
          ` stdout=${JSON.stringify(typeof outcome.stdout === "string" ? outcome.stdout.slice(0, 512) : outcome.stdout)}` +
          ` stderrTail=${JSON.stringify(typeof outcome.stderr === "string" ? outcome.stderr.slice(-2_048) : outcome.stderr)}`
        : ` outcome=${JSON.stringify(outcome)}`;
      platformFault(
        "STALE",
        "probe",
        `platform probe did not pass: ${definition.id};${diagnostic}`,
      );
    }
    const stdout = streamEvidence(outcome.stdout, `${definition.id} stdout`);
    const stderr = streamEvidence(outcome.stderr, `${definition.id} stderr`);
    if (stdout.bytes + stderr.bytes > definition.maxOutputBytes) {
      platformFault("FAIL", "probe", `platform probe output exceeded its ceiling: ${definition.id}`);
    }
    const parsed = replayG17NativePlatformProbe({
      id: definition.id,
      stdout,
      stderr,
      products: outcome.products,
    });
    const program = definition.program;
    probes.push({
      id: definition.id,
      program,
      argv: definition.argv,
      cwd: definition.cwd,
      environment: definition.environment,
      environmentSha256: canonicalSha256(definition.environment),
      timeoutMs: definition.timeoutMs,
      maxOutputBytes: definition.maxOutputBytes,
      disposition: outcome.disposition,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      durationMs: outcome.durationMs,
      stdout,
      stderr,
      stdin: definition.stdin,
      products: outcome.products,
      parsed,
      parsedSha256: canonicalSha256(parsed),
    });
  }
  return probes;
}

async function inspectElfGraph({
  elfInspector,
  roles,
  entries,
  toolchainDirectory,
  platformDirectory,
}) {
  const entriesById = new Map(entries.map((entry) => [`${entry.root}:${entry.path}`, entry]));
  const roots = { toolchain: toolchainDirectory, platform: platformDirectory };
  const nodes = [];
  const edges = [];
  for (const required of G17_NATIVE_PLATFORM_REQUIRED_ROLES.filter(({ kind }) => kind === "file")) {
    const role = { id: required.id, ...roles[required.id] };
    const entry = entriesById.get(`${role.root}:${role.resolvedPath}`);
    const path = join(roots[role.root], ...role.resolvedPath.split("/"));
    let inspected;
    try {
      inspected = await elfInspector({ role, entry, path });
    } catch (error) {
      platformFault("FAIL", "elf", `ELF inspection failed for role ${role.id}`, error);
    }
    if (
      !plainObject(inspected) ||
      !plainObject(inspected.node) ||
      !Array.isArray(inspected.edges) ||
      inspected.observedSha256 !== entry.sha256
    ) {
      platformFault("FAIL", "elf", `ELF inspection is malformed for role ${role.id}`);
    }
    nodes.push({
      ...inspected.node,
      root: role.root,
      path: role.resolvedPath,
      sha256: entry.sha256,
    });
    edges.push(...inspected.edges);
  }
  nodes.sort((left, right) => {
    const leftId = `${left.root}:${left.path}`;
    const rightId = `${right.root}:${right.path}`;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  edges.sort((left, right) => {
    const leftId = `${left.from}\0${left.needed}\0${left.to}`;
    const rightId = `${right.from}\0${right.needed}\0${right.to}`;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return { nodes, edges };
}

function generatedPlatformPrefix(runId, kind) {
  return kind === "platform"
    ? `oxigraph-g17-platform-${runId}-`
    : `oxigraph-g17-platform-controller-${runId}-`;
}

function validateGeneratedPlatformPath(path, parent, runId, kind, phase) {
  const prefix = generatedPlatformPrefix(runId, kind);
  if (
    !safeRunId.test(runId ?? "") ||
    !["platform", "controller"].includes(kind) ||
    !isAbsolute(path) ||
    !isAbsolute(parent) ||
    dirname(path) !== parent ||
    !basename(path).startsWith(prefix) ||
    basename(path) === prefix
  ) {
    platformFault("FAIL", phase, `${kind} generated-directory target is unsafe`);
  }
}

async function pinPlatformParent(parent, phase = "preflight") {
  let handle;
  try {
    const before = await lstat(parent, { bigint: true });
    handle = await open(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const [held, after, resolved] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(parent, { bigint: true }),
      realpath(parent),
    ]);
    const identity = objectIdentity(before);
    if (
      resolved !== parent ||
      before.isSymbolicLink() ||
      !before.isDirectory() ||
      !held.isDirectory() ||
      !after.isDirectory() ||
      !isDeepStrictEqual(objectIdentity(held), identity) ||
      !isDeepStrictEqual(objectIdentity(after), identity)
    ) {
      platformFault("FAIL", phase, "platform temporary parent changed while pinned");
    }
    return { handle, identity };
  } catch (error) {
    await handle?.close();
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault("FAIL", phase, "platform temporary parent cannot be pinned", error);
  }
}

async function pinGeneratedPlatformDirectory({
  path,
  parent,
  parentHandle,
  parentIdentity,
  runId,
  kind,
}) {
  validateGeneratedPlatformPath(path, parent, runId, kind, "materialize");
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const [held, named, heldParent, namedParent, resolved, resolvedParent] =
      await Promise.all([
        handle.stat({ bigint: true }),
        lstat(path, { bigint: true }),
        parentHandle.stat({ bigint: true }),
        lstat(parent, { bigint: true }),
        realpath(path),
        realpath(parent),
      ]);
    const identity = objectIdentity(before);
    if (
      resolved !== path ||
      resolvedParent !== parent ||
      before.isSymbolicLink() ||
      !before.isDirectory() ||
      !held.isDirectory() ||
      !named.isDirectory() ||
      !heldParent.isDirectory() ||
      !namedParent.isDirectory() ||
      !isDeepStrictEqual(objectIdentity(held), identity) ||
      !isDeepStrictEqual(objectIdentity(named), identity) ||
      !isDeepStrictEqual(objectIdentity(heldParent), parentIdentity) ||
      !isDeepStrictEqual(objectIdentity(namedParent), parentIdentity)
    ) {
      platformFault("FAIL", "materialize", `${kind} generated directory changed while pinned`);
    }
    await handle.chmod(0o700);
    const after = await handle.stat({ bigint: true });
    if (
      !after.isDirectory() ||
      Number(after.mode & 0o7777n) !== 0o700 ||
      !isDeepStrictEqual(objectIdentity(after), identity)
    ) {
      platformFault("FAIL", "materialize", `${kind} generated directory could not be sealed`);
    }
    return { path, handle, identity };
  } catch (error) {
    await handle?.close();
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault("FAIL", "materialize", `${kind} generated directory cannot be pinned`, error);
  }
}

async function verifyPinnedGeneratedPlatformDirectory(state, kind, phase) {
  const path = kind === "platform" ? state.root : state.helperRoot;
  const handle = kind === "platform" ? state.rootHandle : state.helperRootHandle;
  const identity = kind === "platform" ? state.rootIdentity : state.helperRootIdentity;
  validateGeneratedPlatformPath(path, state.parent, state.runId, kind, phase);
  const [named, held, namedParent, heldParent, resolved, resolvedParent] =
    await Promise.all([
      lstat(path, { bigint: true }),
      handle.stat({ bigint: true }),
      lstat(state.parent, { bigint: true }),
      state.parentHandle.stat({ bigint: true }),
      realpath(path),
      realpath(state.parent),
    ]).catch((error) =>
      platformFault("FAIL", phase, `${kind} generated-directory identity cannot be read`, error));
  if (
    resolved !== path ||
    resolvedParent !== state.parent ||
    named.isSymbolicLink() ||
    !named.isDirectory() ||
    !held.isDirectory() ||
    !namedParent.isDirectory() ||
    !heldParent.isDirectory() ||
    !isDeepStrictEqual(objectIdentity(named), identity) ||
    !isDeepStrictEqual(objectIdentity(held), identity) ||
    !isDeepStrictEqual(objectIdentity(namedParent), state.parentIdentity) ||
    !isDeepStrictEqual(objectIdentity(heldParent), state.parentIdentity) ||
    Number(named.mode & 0o7777n) !== 0o700
  ) {
    platformFault("FAIL", phase, `${kind} generated-directory identity changed`);
  }
}

async function isExactDetachedPlatformDirectory(state, kind) {
  const path = kind === "platform" ? state.root : state.helperRoot;
  const handle = kind === "platform" ? state.rootHandle : state.helperRootHandle;
  const identity = kind === "platform" ? state.rootIdentity : state.helperRootIdentity;
  const named = await lstat(path, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (named !== undefined) return false;
  const [held, heldParent, namedParent, resolvedParent] = await Promise.all([
    handle.stat({ bigint: true }),
    state.parentHandle.stat({ bigint: true }),
    lstat(state.parent, { bigint: true }),
    realpath(state.parent),
  ]);
  return (
    held.isDirectory() &&
    held.nlink === 0n &&
    heldParent.isDirectory() &&
    namedParent.isDirectory() &&
    resolvedParent === state.parent &&
    isDeepStrictEqual(objectIdentity(held), identity) &&
    isDeepStrictEqual(objectIdentity(heldParent), state.parentIdentity) &&
    isDeepStrictEqual(objectIdentity(namedParent), state.parentIdentity)
  );
}

async function deletePinnedPlatformDirectory(state, kind) {
  if (state.detached?.[kind] === true) {
    if (!await isExactDetachedPlatformDirectory(state, kind)) {
      platformFault("FAIL", "cleanup", `${kind} detached-directory state is contradictory`);
    }
    return undefined;
  }
  if (await isExactDetachedPlatformDirectory(state, kind)) {
    platformFault(
      "FAIL",
      "cleanup",
      `${kind} deletion completed without a confirmed helper receipt`,
    );
  }
  await verifyPinnedGeneratedPlatformDirectory(state, kind, "cleanup");
  const path = kind === "platform" ? state.root : state.helperRoot;
  const rootHandle = kind === "platform" ? state.rootHandle : state.helperRootHandle;
  const result = await deleteG17NativeNode({
    helper: state.helper,
    parentHandle: state.parentHandle,
    rootHandle,
    targetName: basename(path),
    maxEntries: maximumEntries + 10_000,
    maxDepth: 128,
    timeoutMs: 120_000,
    signal: undefined,
  });
  const remaining = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    platformFault("FAIL", "cleanup", `${kind} cleanup result cannot be inspected`, error);
  });
  if (remaining !== undefined) {
    platformFault("FAIL", "cleanup", `${kind} cleanup target remains present`);
  }
  if (!await isExactDetachedPlatformDirectory(state, kind)) {
    platformFault("FAIL", "cleanup", `${kind} cleanup did not detach the pinned directory`);
  }
  state.detached[kind] = true;
  return result;
}

async function removePinnedEmptyPlatformDirectory(state, kind) {
  await verifyPinnedGeneratedPlatformDirectory(state, kind, "cleanup");
  const path = kind === "platform" ? state.root : state.helperRoot;
  await rmdir(path).catch((error) => {
    platformFault(
      "FAIL",
      "cleanup",
      `pinned empty ${kind} directory cannot be removed nonrecursively`,
      error,
    );
  });
  if (!await isExactDetachedPlatformDirectory(state, kind)) {
    platformFault("FAIL", "cleanup", `pinned empty ${kind} directory did not detach`);
  }
  state.detached[kind] = true;
}

async function acquirePlatformCleanupAuthority({ parent, runId, signal }) {
  const pinnedParent = await pinPlatformParent(parent);
  let helperRoot;
  let helperRootRecord;
  let helper;
  try {
    helperRoot = await mkdtemp(
      join(parent, generatedPlatformPrefix(runId, "controller")),
    );
    helperRootRecord = await pinGeneratedPlatformDirectory({
      path: helperRoot,
      parent,
      parentHandle: pinnedParent.handle,
      parentIdentity: pinnedParent.identity,
      runId,
      kind: "controller",
    });
    helper = await buildG17NativeSnapshotHelper({
      outputDirectory: helperRoot,
      signal,
    });
    const authority = {
      parent,
      parentHandle: pinnedParent.handle,
      parentIdentity: pinnedParent.identity,
      helperRoot,
      helperRootHandle: helperRootRecord.handle,
      helperRootIdentity: helperRootRecord.identity,
      helper,
    };
    await verifyPinnedGeneratedPlatformDirectory(
      { ...authority, runId },
      "controller",
      "materialize",
    );
    await verifyG17NativeSnapshotHelper(helper);
    return authority;
  } catch (error) {
    const cleanupErrors = [];
    if (helper !== undefined && helperRootRecord !== undefined) {
      const cleanupState = {
        parent,
        parentHandle: pinnedParent.handle,
        parentIdentity: pinnedParent.identity,
        helperRoot,
        helperRootHandle: helperRootRecord.handle,
        helperRootIdentity: helperRootRecord.identity,
        helper,
        runId,
        detached: { platform: false, controller: false },
      };
      try {
        await deletePinnedPlatformDirectory(cleanupState, "controller");
      } catch (caught) {
        cleanupErrors.push(caught);
      }
      try {
        await closeG17NativeSnapshotHelper(helper);
      } catch (caught) {
        cleanupErrors.push(caught);
      }
    } else if (helperRootRecord !== undefined) {
      try {
        await removePinnedEmptyPlatformDirectory({
          parent,
          parentHandle: pinnedParent.handle,
          parentIdentity: pinnedParent.identity,
          helperRoot,
          helperRootHandle: helperRootRecord.handle,
          helperRootIdentity: helperRootRecord.identity,
          runId,
          detached: { platform: false, controller: false },
        }, "controller");
      } catch (caught) {
        cleanupErrors.push(caught);
      }
    } else if (helperRoot !== undefined) {
      cleanupErrors.push(new G17NativePlatformFault(
        "FAIL",
        "cleanup",
        "unidentified controller directory was left untouched",
      ));
    }
    const closures = await Promise.allSettled([
      helperRootRecord?.handle.close(),
      pinnedParent.handle.close(),
    ]);
    cleanupErrors.push(
      ...closures
        .filter(({ status }) => status === "rejected")
        .map(({ reason }) => reason),
    );
    if (cleanupErrors.length > 0) {
      platformFault(
        "FAIL",
        "cleanup",
        "platform cleanup authority failed before it became usable",
        new AggregateError([error, ...cleanupErrors]),
      );
    }
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault(
      ["FAIL", "MISSING", "STALE"].includes(error?.classification)
        ? error.classification
        : "FAIL",
      "materialize",
      "platform cleanup authority could not be acquired",
      error,
    );
  }
}

async function cleanFailedPlatformAcquisition({ state, root, originalError }) {
  const cleanupErrors = [];
  const receiptErrors = [];
  if (state.rootHandle === undefined) {
    if (root !== undefined) {
      cleanupErrors.push(new G17NativePlatformFault(
        "FAIL",
        "cleanup",
        "unidentified platform directory was left untouched",
      ));
    }
  } else {
    try {
      await deletePinnedPlatformDirectory(state, "platform");
    } catch (error) {
      if (await isExactDetachedPlatformDirectory(state, "platform").catch(() => false)) {
        state.detached.platform = true;
        receiptErrors.push(error);
      } else {
        cleanupErrors.push(error);
      }
    }
  }
  try {
    await deletePinnedPlatformDirectory(state, "controller");
  } catch (error) {
    if (await isExactDetachedPlatformDirectory(state, "controller").catch(() => false)) {
      state.detached.controller = true;
      receiptErrors.push(error);
    } else {
      cleanupErrors.push(error);
    }
  }
  try {
    await closeG17NativeSnapshotHelper(state.helper);
  } catch (error) {
    cleanupErrors.push(error);
  }
  const closures = await Promise.allSettled([
    state.rootHandle?.close(),
    state.helperRootHandle.close(),
    state.parentHandle.close(),
  ]);
  cleanupErrors.push(
    ...closures
      .filter(({ status }) => status === "rejected")
      .map(({ reason }) => reason),
  );
  if (cleanupErrors.length > 0 || receiptErrors.length > 0) {
    platformFault(
      "FAIL",
      "cleanup",
      "platform acquisition failed and exact cleanup did not complete",
      new AggregateError([originalError, ...receiptErrors, ...cleanupErrors]),
    );
  }
}

async function createPlatformWithOptions({
  runId,
  temporaryParent,
  sources,
  roleBindings,
  processRunner,
  elfInspector,
  linkerScriptInspector,
  glibcVersion,
  subjectIdentitySha256,
  sourcePlanSha256,
  controllerAttestationSha256,
  signal,
}) {
  if (!safeRunId.test(runId ?? "")) {
    platformFault("FAIL", "preflight", "platform run id is unsafe");
  }
  const parent = await realpath(temporaryParent).catch((error) =>
    platformFault("MISSING", "preflight", "platform temporary parent is unavailable", error));
  const parentMetadata = await lstat(parent);
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
    platformFault("FAIL", "preflight", "platform temporary parent is not a real directory");
  }
  const normalizedSources = sourceDestinations(sources);
  if (
    normalizedSources.some((source) => contained(source.source, parent))
  ) {
    platformFault(
      "FAIL",
      "preflight",
      "platform source may not contain the generated-root parent",
    );
  }
  const sourceIdentities = await Promise.all(
    normalizedSources.map((source, index) => sourceRootIdentity(source.source, index)),
  );
  const authority = await acquirePlatformCleanupAuthority({ parent, runId, signal });
  let root;
  let rootRecord;
  let platform;
  try {
    root = await mkdtemp(join(parent, generatedPlatformPrefix(runId, "platform")));
    rootRecord = await pinGeneratedPlatformDirectory({
      path: root,
      parent,
      parentHandle: authority.parentHandle,
      parentIdentity: authority.parentIdentity,
      runId,
      kind: "platform",
    });
    const toolchainDirectory = join(root, "toolchain");
    const platformDirectory = join(root, "platform");
    await Promise.all([
      mkdir(toolchainDirectory, { mode: 0o700 }),
      mkdir(platformDirectory, { mode: 0o700 }),
    ]);
    const count = {
      value: 0,
      toolchainBytes: 0,
      platformBytes: 0,
      signal,
    };
    for (const [sourceIndex, source] of normalizedSources.entries()) {
      signal?.throwIfAborted();
      const destinationRoot = source.root === "toolchain"
        ? toolchainDirectory
        : platformDirectory;
      const destination = source.destination.length === 0
        ? destinationRoot
        : join(destinationRoot, ...source.destination.split("/"));
      if (source.destination.length === 0) {
        const before = await lstat(source.source, { bigint: true });
        const children = await readdir(source.source, { withFileTypes: true });
        children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        for (const child of children) {
          safeRelativePath(child.name, "platform source root entry");
          await copyNode(
            join(source.source, child.name),
            join(destination, child.name),
            source.root,
            child.name,
            count,
          );
        }
        const after = await lstat(source.source, { bigint: true });
        if (!stableSourceMetadata(before, after)) {
          platformFault(
            "FAIL",
            "materialize",
            `platform source ${sourceIndex} changed while copied`,
          );
        }
      } else {
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await copyNode(
          source.source,
          destination,
          source.root,
          source.destination,
          count,
        );
      }
      const finalSource = await lstat(source.source, { bigint: true });
      if (
        !isDeepStrictEqual(
          metadataIdentity(finalSource),
          sourceIdentities[sourceIndex],
        )
      ) {
        platformFault(
          "FAIL",
          "materialize",
          `platform source ${sourceIndex} changed after preflight`,
        );
      }
    }
    await createGeneratedRootLayout(platformDirectory);
    async function freezeDirectories(directory) {
      for (const child of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, child.name);
        if (child.isDirectory() && !child.isSymbolicLink()) {
          await freezeDirectories(path);
          await chmod(path, 0o555);
        }
      }
    }
    await Promise.all([
      freezeDirectories(toolchainDirectory),
      freezeDirectories(platformDirectory),
    ]);
    await Promise.all([
      chmod(toolchainDirectory, 0o555),
      chmod(platformDirectory, 0o555),
    ]);
    const entries = await scanRoots(toolchainDirectory, platformDirectory);
    const roles = projectRoles(roleBindings, entries);
    const probes = await collectProbes({
      processRunner,
      roles,
      toolchainDirectory,
      platformDirectory,
      signal,
    });
    const elfGraph = await inspectElfGraph({
      elfInspector,
      roles,
      entries,
      toolchainDirectory,
      platformDirectory,
    });
    const linkerRecords = await linkerScriptInspector({
      entries,
      roles,
      toolchainDirectory,
      platformDirectory,
    });
    if (!Array.isArray(linkerRecords)) {
      platformFault("FAIL", "linker", "linker-script inspection did not return records");
    }
    const created = createG17NativePlatformClosureArtifact({
      profile: platformProfile,
      subjectIdentitySha256,
      sourcePlanSha256,
      controllerAttestationSha256,
      target: {
        os: "linux",
        architecture: "x86_64",
        abi: "gnu",
        rustTriple: "x86_64-unknown-linux-gnu",
        gccTriple: "x86_64-linux-gnu",
        elfClass: 64,
        elfData: "little",
        elfMachine: 62,
        dynamicLoader: "lib64/ld-linux-x86-64.so.2",
        glibcVersion,
      },
      entries,
      roles,
      probes,
      elfGraph,
      linkerScripts: { records: linkerRecords },
    });
    platform = deepFreeze({
      root,
      toolchainDirectory,
      platformDirectory,
      closure: created.closure,
      artifact: created.artifact,
    });
    livePlatforms.set(platform, {
      ...authority,
      runId,
      root,
      rootIdentity: rootRecord.identity,
      rootHandle: rootRecord.handle,
      detached: { platform: false, controller: false },
      phase: "live",
      production: false,
    });
    await verifyG17NativePlatform(platform, "after-preparation");
    return platform;
  } catch (error) {
    if (platform !== undefined) livePlatforms.delete(platform);
    await cleanFailedPlatformAcquisition({
      state: {
        ...authority,
        runId,
        root,
        rootIdentity: rootRecord?.identity,
        rootHandle: rootRecord?.handle,
        detached: { platform: false, controller: false },
      },
      root,
      originalError: error,
    });
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault("FAIL", "materialize", error.message, error);
  }
}

async function freezeGeneratedDirectories(directory) {
  const children = await readdir(directory, { withFileTypes: true });
  for (const child of children) {
    const path = join(directory, child.name);
    if (child.isDirectory() && !child.isSymbolicLink()) {
      await freezeGeneratedDirectories(path);
      await chmod(path, 0o555);
    }
  }
}

export async function acquireG17NativePlatform(input) {
  exactKeys(
    input,
    ["runId", "temporaryParent", "identity", "signal"],
    "production platform acquisition input",
  );
  if (
    !safeRunId.test(input.runId ?? "") ||
    typeof input.temporaryParent !== "string" ||
    !isAbsolute(input.temporaryParent) ||
    (input.signal !== undefined && !(input.signal instanceof AbortSignal))
  ) {
    platformFault("FAIL", "preflight", "production platform run id or parent is unsafe");
  }
  const parent = await realpath(input.temporaryParent).catch((error) =>
    platformFault("MISSING", "preflight", "production platform parent is unavailable", error));
  const parentMetadata = await lstat(parent, { bigint: true });
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
    platformFault("FAIL", "preflight", "production platform parent is not a real directory");
  }
  const capacity = await statfs(parent, { bigint: true });
  if (capacity.bavail * capacity.bsize < BigInt(minimumProductionFreeBytes)) {
    platformFault("MISSING", "preflight", "production platform has insufficient free disk");
  }
  const { contract } = loadG17Contract();
  await verifyCurrentG17QualificationIdentity(input.identity, {
    contract,
    repoRoot: repositoryRoot,
  }).catch((error) =>
    platformFault(
      "STALE",
      "discover",
      "qualified identity is not current production evidence",
      error,
    ));
  const plan = await discoverProductionSourcePlan(input.identity, input.signal);
  const authority = await acquirePlatformCleanupAuthority({
    parent,
    runId: input.runId,
    signal: input.signal,
  });
  let root;
  let rootRecord;
  let platform;
  try {
    root = await mkdtemp(
      join(parent, generatedPlatformPrefix(input.runId, "platform")),
    );
    rootRecord = await pinGeneratedPlatformDirectory({
      path: root,
      parent,
      parentHandle: authority.parentHandle,
      parentIdentity: authority.parentIdentity,
      runId: input.runId,
      kind: "platform",
    });
    const platformDirectory = join(root, "platform");
    const toolchainDirectory = join(root, "toolchain");
    const probeStateDirectory = join(root, "probe-state");
    await Promise.all([
      mkdir(platformDirectory, { mode: 0o700 }),
      mkdir(join(probeStateDirectory, "home"), { recursive: true, mode: 0o700 }),
      mkdir(join(probeStateDirectory, "tmp"), { recursive: true, mode: 0o700 }),
    ]);
    await createProductionLayout(platformDirectory, plan);
    const controller = await createProductionControllerAttestation(
      authority.helper,
      input.signal,
    );
    const totals = {
      bytes: 0,
      entries: 0,
      toolchainBytes: 0,
      platformBytes: 0,
    };
    for (const item of plan.items) {
      input.signal?.throwIfAborted();
      await copyProductionItem({
        helper: authority.helper,
        root,
        item,
        totals,
        signal: input.signal,
      });
    }
    const context = {
      helper: authority.helper,
      root,
      plan,
      totals,
      signal: input.signal,
    };
    for (const roleId of ["libclang", "libseccomp", "dynamicLoader"]) {
      const role = plan.roleBindings[roleId];
      await ensureProductionLogical({
        ...context,
        rootName: role.root,
        logicalPath: role.path,
      });
    }
    const linkerRecords = await buildProductionLinkerClosure(context);
    await closeProductionSymlinks(context);
    const elfGraph = await buildProductionElfGraph(context);
    await closeProductionSymlinks(context);
    await Promise.all([
      freezeGeneratedDirectories(toolchainDirectory),
      freezeGeneratedDirectories(platformDirectory),
    ]);
    await Promise.all([
      chmod(toolchainDirectory, 0o555),
      chmod(platformDirectory, 0o555),
    ]);
    const entries = await scanRoots(toolchainDirectory, platformDirectory);
    const roles = projectRoles(plan.roleBindings, entries);
    for (const program of ["cargo", "rustc"]) {
      if (
        roles[program].sha256 !==
          plan.qualifiedToolchain[program].toolchainExecutableSha256
      ) {
        platformFault(
          "STALE",
          "role",
          `qualified ${program} changed between discovery and platform closure`,
        );
      }
    }
    const processRunner = await createProductionProbeRunner({
      platformDirectory,
      toolchainDirectory,
      stateDirectory: probeStateDirectory,
    });
    const probes = await collectProbes({
      processRunner,
      roles,
      toolchainDirectory,
      platformDirectory,
      signal: input.signal,
    });
    const glibcVersion = probes.find(({ id }) => id === "glibc-version")
      ?.parsed?.facts?.version;
    if (!/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/u.test(glibcVersion ?? "")) {
      platformFault("FAIL", "probe", "in-root glibc version is absent");
    }
    const created = createG17NativePlatformClosureArtifact({
      profile: platformProfile,
      subjectIdentitySha256: plan.receiptIdentity.identitySha256,
      sourcePlanSha256: plan.sourcePlanSha256,
      controllerAttestationSha256: controller.artifact.sha256,
      target: { ...productionTarget, glibcVersion },
      entries,
      roles,
      probes,
      elfGraph,
      linkerScripts: { records: linkerRecords },
    });
    const sourcePlanBytes = Buffer.from(`${canonicalJson(plan.projection)}\n`, "utf8");
    if (sha256(sourcePlanBytes) !== plan.sourcePlanSha256) {
      platformFault("FAIL", "materialize", "source-plan artifact digest drifted");
    }
    platform = deepFreeze({
      root,
      platformDirectory,
      toolchainDirectory,
      closure: created.closure,
      artifact: created.artifact,
      sourcePlan: Object.freeze({
        name: G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
        get bytes() {
          return Buffer.from(sourcePlanBytes);
        },
        projectionSha256: plan.sourcePlanProjectionSha256,
        sha256: plan.sourcePlanSha256,
      }),
      controllerAttestation: controller.artifact,
    });
    livePlatforms.set(platform, {
      ...authority,
      runId: input.runId,
      root,
      rootIdentity: rootRecord.identity,
      rootHandle: rootRecord.handle,
      detached: { platform: false, controller: false },
      phase: "live",
      production: true,
    });
    await verifyG17NativePlatform(platform, "after-preparation");
    return platform;
  } catch (error) {
    if (platform !== undefined) livePlatforms.delete(platform);
    await cleanFailedPlatformAcquisition({
      state: {
        ...authority,
        runId: input.runId,
        root,
        rootIdentity: rootRecord?.identity,
        rootHandle: rootRecord?.handle,
        detached: { platform: false, controller: false },
      },
      root,
      originalError: error,
    });
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault("FAIL", "materialize", error.message, error);
  }
}

export async function verifyG17NativePlatform(platform, phase = "verify") {
  const state = livePlatforms.get(platform);
  let acquired = false;
  let succeeded = false;
  try {
    if (
      state === undefined ||
      state.phase !== "live" ||
      !["after-preparation", "after-native", "verify"].includes(phase)
    ) {
      platformFault("FAIL", "verify", "platform verification target is not live");
    }
    state.phase = "verifying";
    acquired = true;
    await verifyPinnedGeneratedPlatformDirectory(state, "controller", phase);
    await verifyPinnedGeneratedPlatformDirectory(state, "platform", phase);
    await verifyG17NativeSnapshotHelper(state.helper);
    if (state.production) {
      const platformArtifact = verifyCanonicalArtifactRecord(platform.artifact, {
        name: G17_NATIVE_PLATFORM_ARTIFACT_NAME,
        maximumBytes: 64 * 1024 * 1024,
        label: "platform closure artifact",
      });
      const sourcePlanArtifact = verifyCanonicalArtifactRecord(platform.sourcePlan, {
        name: G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
        expectedKeys: ["name", "bytes", "projectionSha256", "sha256"],
        maximumBytes: 4 * 1024 * 1024,
        label: "platform source-plan artifact",
      });
      const controllerArtifact = verifyCanonicalArtifactRecord(
        platform.controllerAttestation,
        {
          name: G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
          maximumBytes: 64 * 1024 * 1024,
          label: "platform controller artifact",
        },
      );
      const bundle = verifyG17NativePlatformBundle({
        platformBytes: platformArtifact.bytes,
        sourcePlanBytes: sourcePlanArtifact.bytes,
        controllerBytes: controllerArtifact.bytes,
      });
      if (
        !isDeepStrictEqual(bundle.platform, platform.closure) ||
        bundle.sourcePlanProjectionSha256 !== platform.sourcePlan.projectionSha256
      ) {
        platformFault("FAIL", phase, "platform bundle differs from its live projection");
      }
    }
    const entries = await scanRoots(
      platform.toolchainDirectory,
      platform.platformDirectory,
      phase,
    );
    if (!isDeepStrictEqual(entries, platform.closure.entries)) {
      platformFault("FAIL", phase, "generated platform closure changed after acquisition");
    }
    const toolchainRootSha256 = canonicalSha256({
      schema: "oxigraph.g1.7-linux-native-root/v1",
      root: "toolchain",
      entries: entries.filter(({ root }) => root === "toolchain"),
    });
    const platformRootSha256 = canonicalSha256({
      schema: "oxigraph.g1.7-linux-native-root/v1",
      root: "platform",
      entries: entries.filter(({ root }) => root === "platform"),
    });
    if (
      toolchainRootSha256 !== platform.closure.toolchainRootSha256 ||
      platformRootSha256 !== platform.closure.platformRootSha256
    ) {
      platformFault("FAIL", phase, "generated platform root digest drifted");
    }
    await verifyPinnedGeneratedPlatformDirectory(state, "platform", phase);
    await verifyPinnedGeneratedPlatformDirectory(state, "controller", phase);
    const evidence = {
      schema: "oxigraph.g1.7-linux-native-platform-verification/v1",
      phase,
      toolchainEntries: entries.filter(({ root }) => root === "toolchain").length,
      platformEntries: entries.filter(({ root }) => root === "platform").length,
      toolchainRootSha256,
      platformRootSha256,
      manifestSha256: platform.closure.manifestSha256,
    };
    succeeded = true;
    return deepFreeze({ ...evidence, sha256: canonicalSha256(evidence) });
  } catch (error) {
    if (error instanceof G17NativePlatformFault) throw error;
    platformFault("FAIL", phase, error.message, error);
  } finally {
    if (acquired && state?.phase === "verifying") {
      state.phase = succeeded ? "live" : "invalid";
    }
  }
}

export async function deleteG17NativePlatformTree(platform, input) {
  exactKeys(
    input,
    [
      "parentHandle",
      "rootHandle",
      "targetName",
      "maxEntries",
      "maxDepth",
      "timeoutMs",
      "signal",
    ],
    "platform delete request",
  );
  const state = livePlatforms.get(platform);
  if (state === undefined || !["live", "invalid"].includes(state.phase)) {
    platformFault("FAIL", "cleanup", "platform delete authority is not live");
  }
  const priorPhase = state.phase;
  state.phase = "deleting-external-tree";
  try {
    return await deleteG17NativeNode({
      helper: state.helper,
      ...input,
    });
  } catch (error) {
    platformFault("FAIL", "cleanup", "platform could not delete the pinned tree", error);
  } finally {
    if (
      livePlatforms.get(platform) === state &&
      state.phase === "deleting-external-tree"
    ) {
      state.phase = priorPhase;
    }
  }
}

export async function destroyG17NativePlatform(platform) {
  const state = livePlatforms.get(platform);
  if (
    state === undefined ||
    !["live", "invalid", "cleanup-failed"].includes(state.phase)
  ) {
    platformFault("FAIL", "cleanup", "platform cleanup target is not live or retryable");
  }
  state.phase = "destroying";
  const receiptErrors = [];
  try {
    try {
      await deletePinnedPlatformDirectory(state, "platform");
    } catch (error) {
      if (await isExactDetachedPlatformDirectory(state, "platform").catch(() => false)) {
        state.detached.platform = true;
        receiptErrors.push(error);
      } else {
        state.phase = "cleanup-failed";
        throw error;
      }
    }
    try {
      await deletePinnedPlatformDirectory(state, "controller");
    } catch (error) {
      if (await isExactDetachedPlatformDirectory(state, "controller").catch(() => false)) {
        state.detached.controller = true;
        receiptErrors.push(error);
      } else {
        state.phase = "cleanup-failed";
        throw error;
      }
    }
    const closeResults = await Promise.allSettled([
      closeG17NativeSnapshotHelper(state.helper),
      state.rootHandle.close(),
      state.helperRootHandle.close(),
      state.parentHandle.close(),
    ]);
    livePlatforms.delete(platform);
    const closeErrors = closeResults
      .filter(({ status }) => status === "rejected")
      .map(({ reason }) => reason);
    if (receiptErrors.length > 0 || closeErrors.length > 0) {
      platformFault(
        "FAIL",
        "cleanup",
        receiptErrors.length > 0
          ? "platform deletion completed without every confirmed helper receipt"
          : "platform was deleted but its descriptor closure failed",
        new AggregateError([...receiptErrors, ...closeErrors]),
      );
    }
  } catch (error) {
    if (livePlatforms.get(platform) === state && state.phase === "destroying") {
      state.phase = "cleanup-failed";
    }
    throw error;
  }
}

export function createG17NativePlatformAcquirerForTesting({
  temporaryParent,
  sources,
  roleBindings,
  processRunner,
  elfInspector,
  linkerScriptInspector,
  glibcVersion = "2.39",
}) {
  if (
    typeof temporaryParent !== "string" ||
    !Array.isArray(sources) ||
    !plainObject(roleBindings) ||
    typeof processRunner !== "function" ||
    typeof elfInspector !== "function" ||
    typeof linkerScriptInspector !== "function" ||
    !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/u.test(glibcVersion)
  ) {
    throw new Error("G1.7 native platform test factory inputs are invalid");
  }
  return ({ runId, signal } = {}) => createPlatformWithOptions({
    runId,
    temporaryParent,
    sources,
    roleBindings,
    processRunner,
    elfInspector,
    linkerScriptInspector,
    glibcVersion,
    subjectIdentitySha256: "6".repeat(64),
    sourcePlanSha256: "7".repeat(64),
    controllerAttestationSha256: "8".repeat(64),
    signal,
  });
}
