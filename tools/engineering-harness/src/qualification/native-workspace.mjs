import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rmdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { comparePortablePaths } from "../../../metaharness/policy-contract.mjs";
import { runGit, createGitHome } from "../candidate/git.mjs";
import { runBoundedProcess } from "../native/process.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const sourceSnapshotSchema = "oxigraph.g1.7-source-snapshot/v1";
const sourceManifestSchema = "oxigraph.g1.7-source-filesystem/v1";
const sourceObjectClosureSchema = "oxigraph.g1.7-source-object-closure/v1";
const workspaceSchema = "oxigraph.g1.7-native-workspace/v1";
const dependencySchema = "oxigraph.g1.7-private-cargo-dependencies/v1";
const vendorManifestSchema = "oxigraph.g1.7-vendor-filesystem/v1";
const vendorChecksumSchema = "oxigraph.g1.7-vendor-checksum-set/v1";
const metadataProjectionSchema = "oxigraph.g1.7-cargo-metadata-projection/v1";
const workspacePolicy = "detached-committed-source-private-offline-vendor/v1";
const dependencyPolicy = "lock-checksummed-archive-to-directory-source/v1";
const cratesIoRegistrySource =
  "registry+https://github.com/rust-lang/crates.io-index";
const cratesIoDirectory = "index.crates.io-1949cf8c6b5b557f";
const safeRunId = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const safeCrateName = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const safeCrateVersion = /^[A-Za-z0-9.+-]+$/u;
const maximumSourceEntries = 200_000;
const maximumSourceFileBytes = 64 * 1024 * 1024;
const maximumSourceBytes = 2 * 1024 * 1024 * 1024;
const maximumCargoLockBytes = 16 * 1024 * 1024;
const maximumRegistryPackages = 4_096;
const maximumArchiveBytes = 32 * 1024 * 1024;
const maximumArchiveTotalBytes = 256 * 1024 * 1024;
const maximumSparseEntryBytes = 8 * 1024 * 1024;
const maximumSparseTotalBytes = 64 * 1024 * 1024;
const maximumSparseConfigBytes = 64 * 1024;
const maximumArchiveProjectionBytes = 1024 * 1024;
const maximumSparseProjectionBytes = 1024 * 1024;
const maximumVendorChecksumProjectionBytes = 4 * 1024 * 1024;
const maximumMetadataProjectionBytes = 1024 * 1024;
const maximumVendorEntries = 200_000;
const maximumVendorFileBytes = 64 * 1024 * 1024;
const maximumVendorBytes = 2 * 1024 * 1024 * 1024;
const cargoPreparationTimeoutMs = 300_000;
const cargoVendorOutputBytes = 1024 * 1024;
const cargoMetadataOutputBytes = 16 * 1024 * 1024;
const sourceSnapshotInternals = new WeakMap();
const dependencyInternals = new WeakMap();
const liveWorkspaces = new WeakMap();

const productionRequiredGitlinks = Object.freeze([
  Object.freeze({
    path: "oxrocksdb-sys/lz4",
    commit: "ebb370ca83af193212df4dcbadcc5d87bc0de2f0",
    tree: "1ff35e0f086e3b431ea0efd001eb5c6254561953",
  }),
  Object.freeze({
    path: "oxrocksdb-sys/rocksdb",
    commit: "3b446089141659fad25328c5ea3e7ed283df46e4",
    tree: "36afaac5df4b9666e3c7ca5e32e094edd6fedfac",
  }),
]);

export class G17NativeWorkspaceFault extends Error {
  constructor(classification, phase, reason, cause) {
    super(`G1.7 native workspace ${phase}/${classification}: ${reason}`, { cause });
    this.name = "G17NativeWorkspaceFault";
    this.classification = classification;
    this.phase = phase;
    this.reason = reason;
  }
}

function workspaceFault(classification, phase, reason, cause) {
  throw new G17NativeWorkspaceFault(classification, phase, reason, cause);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function objectIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
  });
}

function exactInput(value, required, optional, label) {
  if (!plainObject(value)) {
    workspaceFault("FAIL", "preflight", `${label} must be a plain object`);
  }
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    workspaceFault("FAIL", "preflight", `${label} fields are not exact`);
  }
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function safeRelativePath(path, label, phase = "source") {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    workspaceFault("FAIL", phase, `${label} is not a safe portable path`);
  }
  return path;
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function boundedCanonicalProjection(value, maximumBytes, label, phase = "verify") {
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes > maximumBytes) {
    workspaceFault("FAIL", phase, `${label} exceeds its serialized byte ceiling`);
  }
  return Object.freeze({ bytes, sha256: canonicalSha256(value) });
}

function cargoLockRegistryPackages(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumCargoLockBytes) {
    workspaceFault("FAIL", "cache", "Cargo.lock is not a bounded Buffer");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    workspaceFault("FAIL", "cache", "Cargo.lock is not UTF-8", error);
  }
  const sections = text.split(/^\[\[package\]\]\s*$/mu);
  const preamble = sections[0];
  const versionFields = [...preamble.matchAll(/^version = ([0-9]+)$/gmu)];
  if (versionFields.length !== 1 || versionFields[0][1] !== "4") {
    workspaceFault("FAIL", "cache", "Cargo.lock must use exactly lock format version 4");
  }
  const blocks = sections.slice(1);
  if (blocks.length < 1 || blocks.length > maximumRegistryPackages) {
    workspaceFault("FAIL", "cache", "Cargo.lock exceeds its total package ceiling");
  }
  const packages = [];
  for (const block of blocks) {
    const fields = (name) => [
      ...block.matchAll(new RegExp(`^${name} = "([^"\\\\]*)"$`, "gmu")),
    ].map((match) => match[1]);
    const names = fields("name");
    const versions = fields("version");
    const sources = fields("source");
    const checksums = fields("checksum");
    if (names.length !== 1 || versions.length !== 1 || sources.length > 1 || checksums.length > 1) {
      workspaceFault("FAIL", "cache", "Cargo.lock package fields are ambiguous");
    }
    const [name] = names;
    const [version] = versions;
    const [source] = sources;
    if (source === undefined) continue;
    if (source !== cratesIoRegistrySource) {
      workspaceFault("MISSING", "cache", `locked dependency source is unsupported: ${source}`);
    }
    const [checksum] = checksums;
    if (
      !safeCrateName.test(name ?? "") ||
      !safeCrateVersion.test(version ?? "") ||
      !/^[0-9a-f]{64}$/u.test(checksum ?? "")
    ) {
      workspaceFault("FAIL", "cache", "Cargo.lock registry package is malformed");
    }
    packages.push(Object.freeze({ name, version, source, checksum }));
    if (packages.length > maximumRegistryPackages) {
      workspaceFault("FAIL", "cache", "Cargo.lock exceeds its package ceiling");
    }
  }
  packages.sort((left, right) => comparePortablePaths(
    `${left.name}\0${left.version}\0${left.source}`,
    `${right.name}\0${right.version}\0${right.source}`,
  ));
  const identities = packages.map(({ name, version, source }) => `${name}\0${version}\0${source}`);
  if (packages.length < 1 || new Set(identities).size !== identities.length) {
    workspaceFault("FAIL", "cache", "Cargo.lock registry package set is empty or duplicated");
  }
  return Object.freeze(packages);
}

function sparseIndexPath(crateName) {
  const name = crateName.toLowerCase();
  if (!safeCrateName.test(name)) {
    workspaceFault("FAIL", "cache", `crate name is unsafe: ${crateName}`);
  }
  if (name.length === 1) return `1/${name}`;
  if (name.length === 2) return `2/${name}`;
  if (name.length === 3) return `3/${name[0]}/${name}`;
  return `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`;
}

async function boundedRegularBytes(
  path,
  label,
  maximumBytes,
  minimumBytes = 1,
  phase = "cache",
) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    workspaceFault("MISSING", phase, "O_NOFOLLOW is unavailable on this platform");
  }
  let descriptor;
  try {
    descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    workspaceFault(
      error?.code === "ENOENT" ? "MISSING" : "FAIL",
      phase,
      `${label} cannot be opened safely`,
      error,
    );
  }
  try {
    const before = await descriptor.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size < minimumBytes ||
      before.size > maximumBytes
    ) {
      workspaceFault("FAIL", phase, `${label} is not a bounded exclusive regular file`);
    }
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat();
    if (
      bytes.length !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      workspaceFault("FAIL", phase, `${label} changed during its bounded read`);
    }
    return bytes;
  } finally {
    await descriptor.close();
  }
}

async function writeExclusiveBytes(path, bytes, label) {
  let descriptor;
  try {
    descriptor = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await descriptor.writeFile(bytes);
    await descriptor.sync();
  } catch (error) {
    workspaceFault("FAIL", "cache", `${label} cannot be written exclusively`, error);
  } finally {
    await descriptor?.close();
  }
  const observed = await boundedRegularBytes(path, label, bytes.length, bytes.length);
  if (!observed.equals(bytes)) {
    workspaceFault("FAIL", "cache", `${label} differs after its exclusive copy`);
  }
}

async function requireRealDirectory(
  path,
  label,
  classification = "MISSING",
  phase = "cache",
) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    workspaceFault(classification, phase, `${label} is unavailable`, error);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    workspaceFault("FAIL", phase, `${label} is not a real directory`);
  }
  return realpath(path);
}

function logicalWorkspacePath(path, mappings, label) {
  if (typeof path !== "string" || path.length === 0) {
    workspaceFault("FAIL", "verify", `${label} is not a path`);
  }
  for (const { host, logical } of mappings) {
    if (path === host) return logical;
    if (contained(host, path)) {
      return `${logical}/${relative(host, path).split(sep).join("/")}`;
    }
  }
  workspaceFault("FAIL", "verify", `${label} is outside the private workspace contract`);
}

function processEvidence(
  outcome,
  executable,
  args,
  cwd,
  environment,
  timeoutMs,
  maxOutputBytes,
  logicalPaths,
) {
  const mappings = [
    { host: logicalPaths.vendorDirectory, logical: "/cargo-home/vendor" },
    { host: logicalPaths.bootstrapCargoHome, logical: "/control/bootstrap-cargo-home" },
    { host: logicalPaths.temporaryDirectory, logical: "/control/tmp" },
    { host: logicalPaths.sourceDirectory, logical: "/workspace" },
    { host: logicalPaths.targetDirectory, logical: "/state/target" },
    { host: logicalPaths.homeDirectory, logical: "/home" },
    { host: dirname(executable), logical: "/toolchain/bin" },
  ].sort((left, right) => right.host.length - left.host.length);
  const argv = args.map((argument, index) =>
    isAbsolute(argument)
      ? logicalWorkspacePath(argument, mappings, `Cargo argv ${index}`)
      : argument);
  const normalizedEnvironment = Object.freeze({
    CARGO_HOME: logicalWorkspacePath(
      environment.CARGO_HOME,
      mappings,
      "Cargo environment CARGO_HOME",
    ),
    CARGO_NET_OFFLINE: environment.CARGO_NET_OFFLINE,
    CARGO_REGISTRIES_CRATES_IO_PROTOCOL:
      environment.CARGO_REGISTRIES_CRATES_IO_PROTOCOL,
    CARGO_TERM_COLOR: environment.CARGO_TERM_COLOR,
    GIT_CONFIG_GLOBAL: environment.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: environment.GIT_CONFIG_NOSYSTEM,
    GIT_TERMINAL_PROMPT: environment.GIT_TERMINAL_PROMPT,
    HOME: logicalWorkspacePath(environment.HOME, mappings, "Cargo environment HOME"),
    LANG: environment.LANG,
    LC_ALL: environment.LC_ALL,
    NO_COLOR: environment.NO_COLOR,
    PATH: "/toolchain/bin:/usr/bin:/bin",
    RUSTC: "/toolchain/bin/rustc",
    SOURCE_DATE_EPOCH: environment.SOURCE_DATE_EPOCH,
    TEMP: logicalWorkspacePath(environment.TEMP, mappings, "Cargo environment TEMP"),
    TERM: environment.TERM,
    TMP: logicalWorkspacePath(environment.TMP, mappings, "Cargo environment TMP"),
    TMPDIR: logicalWorkspacePath(environment.TMPDIR, mappings, "Cargo environment TMPDIR"),
  });
  const environmentSha256 = canonicalSha256(normalizedEnvironment);
  return Object.freeze({
    program: "/toolchain/bin/cargo",
    argv: Object.freeze(argv),
    cwd: logicalWorkspacePath(cwd, mappings, "Cargo working directory"),
    environment: normalizedEnvironment,
    environmentSha256,
    timeoutMs,
    maxOutputBytes,
    disposition: outcome.disposition,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    durationMs: outcome.durationMs,
    stdoutBytes: Buffer.byteLength(outcome.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(outcome.stderr, "utf8"),
    stdoutSha256: sha256(Buffer.from(outcome.stdout, "utf8")),
    stderrSha256: sha256(Buffer.from(outcome.stderr, "utf8")),
  });
}

function requireCompletedCargo(outcome, phase) {
  if (
    !plainObject(outcome) ||
    typeof outcome.stdout !== "string" ||
    typeof outcome.stderr !== "string"
  ) {
    workspaceFault("MISSING", phase, `Cargo ${phase} did not complete under its bound`);
  }
  if (outcome.disposition !== "completed" || outcome.signal !== null) {
    workspaceFault("MISSING", phase, `Cargo ${phase} did not complete under its bound`);
  }
  if (outcome.exitCode !== 0) {
    workspaceFault("STALE", phase, `Cargo ${phase} rejected the sealed dependency graph`);
  }
}

function cargoConfigBytes(directory, targetDirectory) {
  return Buffer.from([
    "[build]",
    `target-dir = ${JSON.stringify(targetDirectory)}`,
    "",
    "[net]",
    "offline = true",
    "",
    "[source.crates-io]",
    'replace-with = "g17-vendored-sources"',
    "",
    "[source.g17-vendored-sources]",
    `directory = ${JSON.stringify(directory)}`,
    "",
  ].join("\n"), "utf8");
}

function sparseBootstrapConfigBytes() {
  return Buffer.from([
    "[net]",
    "offline = true",
    "",
    "[registries.crates-io]",
    'protocol = "sparse"',
    "",
  ].join("\n"), "utf8");
}

async function requireSafeSourcePath(root, relativePath, label) {
  safeRelativePath(relativePath, label, "cache");
  const parts = relativePath.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const metadata = await lstat(current).catch((error) =>
      workspaceFault(
        error?.code === "ENOENT" ? "MISSING" : "FAIL",
        "cache",
        `${label} parent is unavailable`,
        error,
      ));
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      workspaceFault("FAIL", "cache", `${label} parent is not a real directory`);
    }
  }
  return join(root, ...parts);
}

async function requireContainedRealDirectory(root, relativePath, label) {
  safeRelativePath(relativePath, label, "cache");
  let current = root;
  for (const part of relativePath.split("/")) {
    current = join(current, part);
    const metadata = await lstat(current).catch((error) =>
      workspaceFault(
        error?.code === "ENOENT" ? "MISSING" : "FAIL",
        "cache",
        `${label} is unavailable`,
        error,
      ));
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      workspaceFault("FAIL", "cache", `${label} contains a non-directory or symlink component`);
    }
  }
  const resolved = await realpath(current).catch((error) =>
    workspaceFault("FAIL", "cache", `${label} cannot be resolved`, error));
  if (!contained(root, resolved)) {
    workspaceFault("FAIL", "cache", `${label} escapes the source Cargo home`);
  }
  return resolved;
}

async function rejectCargoConfigurationAncestors(sourceDirectory) {
  let current = sourceDirectory;
  for (;;) {
    for (const name of ["config", "config.toml"]) {
      const path = join(current, ".cargo", name);
      const metadata = await lstat(path).catch((error) => {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined;
        workspaceFault("FAIL", "cache", "Cargo configuration authority cannot be inspected", error);
      });
      if (metadata !== undefined) {
        workspaceFault(
          "FAIL",
          "cache",
          `Cargo configuration authority is forbidden above the source: ${path}`,
        );
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function copyPrivateCargoBootstrap({
  sourceCargoHome,
  bootstrapCargoHome,
  cargoLock,
}) {
  const sourceHome = await requireRealDirectory(sourceCargoHome, "source Cargo home");
  const sourceCacheRoot = await requireContainedRealDirectory(
    sourceHome,
    `registry/cache/${cratesIoDirectory}`,
    "crates.io archive cache",
  );
  const sourceIndexRoot = await requireContainedRealDirectory(
    sourceHome,
    `registry/index/${cratesIoDirectory}`,
    "crates.io sparse index",
  );
  const packages = cargoLockRegistryPackages(cargoLock);
  const cacheRoot = join(
    bootstrapCargoHome,
    "registry",
    "cache",
    cratesIoDirectory,
  );
  const indexRoot = join(
    bootstrapCargoHome,
    "registry",
    "index",
    cratesIoDirectory,
  );
  await Promise.all([
    mkdir(cacheRoot, { recursive: true, mode: 0o700 }),
    mkdir(join(indexRoot, ".cache"), { recursive: true, mode: 0o700 }),
  ]);

  const configSourcePath = await requireSafeSourcePath(
    sourceIndexRoot,
    "config.json",
    "sparse registry config",
  );
  const configBytes = await boundedRegularBytes(
    configSourcePath,
    "sparse registry config",
    maximumSparseConfigBytes,
  );
  let config;
  try {
    config = JSON.parse(configBytes);
  } catch (error) {
    workspaceFault("FAIL", "cache", "sparse registry config is invalid JSON", error);
  }
  if (
    !plainObject(config) ||
    config.dl !== "https://static.crates.io/crates" ||
    config.api !== "https://crates.io" ||
    (Object.hasOwn(config, "auth-required") && config["auth-required"] !== false) ||
    Object.keys(config).some((key) => !["api", "auth-required", "dl"].includes(key))
  ) {
    workspaceFault("FAIL", "cache", "sparse registry config carries unexpected authority");
  }
  await writeExclusiveBytes(
    join(indexRoot, "config.json"),
    configBytes,
    "private sparse registry config",
  );

  let archiveBytes = 0;
  const archives = [];
  for (const locked of packages) {
    const archiveName = `${locked.name}-${locked.version}.crate`;
    const sourcePath = await requireSafeSourcePath(
      sourceCacheRoot,
      archiveName,
      `locked archive ${archiveName}`,
    );
    const bytes = await boundedRegularBytes(
      sourcePath,
      `locked archive ${archiveName}`,
      maximumArchiveBytes,
    );
    const digest = sha256(bytes);
    if (digest !== locked.checksum) {
      workspaceFault("STALE", "cache", `locked archive checksum drifted: ${archiveName}`);
    }
    archiveBytes += bytes.length;
    if (archiveBytes > maximumArchiveTotalBytes) {
      workspaceFault("FAIL", "cache", "locked archives exceed their aggregate byte ceiling");
    }
    await writeExclusiveBytes(
      join(cacheRoot, archiveName),
      bytes,
      `private locked archive ${archiveName}`,
    );
    archives.push(Object.freeze({
      name: locked.name,
      version: locked.version,
      source: locked.source,
      lockChecksum: locked.checksum,
      archiveName,
      bytes: bytes.length,
      sha256: digest,
    }));
  }

  const uniqueCrates = new Map();
  for (const { name } of packages) {
    const normalized = name.toLowerCase();
    const previous = uniqueCrates.get(normalized);
    if (previous !== undefined && previous !== name) {
      workspaceFault("FAIL", "cache", `crate names collide in the sparse index: ${name}`);
    }
    uniqueCrates.set(normalized, name);
  }
  const sparseEntries = [];
  let sparseBytes = 0;
  for (const name of [...uniqueCrates.values()].sort(comparePortablePaths)) {
    const indexPath = sparseIndexPath(name);
    const sourcePath = await requireSafeSourcePath(
      join(sourceIndexRoot, ".cache"),
      indexPath,
      `sparse entry ${name}`,
    );
    const bytes = await boundedRegularBytes(
      sourcePath,
      `sparse entry ${name}`,
      maximumSparseEntryBytes,
    );
    sparseBytes += bytes.length;
    if (sparseBytes > maximumSparseTotalBytes) {
      workspaceFault("FAIL", "cache", "sparse entries exceed their aggregate byte ceiling");
    }
    const destination = join(indexRoot, ".cache", ...indexPath.split("/"));
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeExclusiveBytes(destination, bytes, `private sparse entry ${name}`);
    sparseEntries.push(Object.freeze({
      crate: name,
      path: indexPath,
      bytes: bytes.length,
      sha256: sha256(bytes),
    }));
  }

  return deepFreeze({
    packages,
    packageSetSha256: canonicalSha256({
      schema: "oxigraph.g1.7-locked-registry-packages/v1",
      packages,
    }),
    archives,
    archiveBytes,
    archiveSetSha256: canonicalSha256({
      schema: "oxigraph.g1.7-registry-archives/v1",
      archives,
    }),
    sparseEntries,
    sparseBytes,
    sparseConfigSha256: sha256(configBytes),
    sparseEntrySetSha256: canonicalSha256({
      schema: "oxigraph.g1.7-sparse-entries/v1",
      entries: sparseEntries,
    }),
  });
}

async function verifyVendorTree(vendorDirectory, lockedPackages) {
  const vendorRoot = await requireRealDirectory(
    vendorDirectory,
    "private vendor directory",
    "STALE",
    "vendor",
  );
  const expectedDirectories = new Map(
    lockedPackages.map((locked) => [`${locked.name}-${locked.version}`, locked]),
  );
  const topLevel = await readdir(vendorRoot, { withFileTypes: true });
  topLevel.sort((left, right) => comparePortablePaths(left.name, right.name));
  if (
    topLevel.length !== expectedDirectories.size ||
    topLevel.some(
      (entry) =>
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !expectedDirectories.has(entry.name),
    )
  ) {
    workspaceFault("STALE", "vendor", "vendored package directory set differs from Cargo.lock");
  }

  const entries = [];
  const checksumPackages = [];
  let checksumFileCount = 0;
  let totalBytes = 0;
  for (const packageEntry of topLevel) {
    const locked = expectedDirectories.get(packageEntry.name);
    const packageRoot = join(vendorRoot, packageEntry.name);
    const packageMetadata = await lstat(packageRoot);
    if (packageMetadata.isSymbolicLink() || !packageMetadata.isDirectory()) {
      workspaceFault("FAIL", "vendor", `vendored package is not a real directory: ${packageEntry.name}`);
    }
    const checksumBytes = await boundedRegularBytes(
      join(packageRoot, ".cargo-checksum.json"),
      `vendor checksum ${packageEntry.name}`,
      maximumVendorFileBytes,
      1,
      "vendor",
    );
    let checksum;
    try {
      checksum = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(checksumBytes));
    } catch (error) {
      workspaceFault("FAIL", "vendor", `vendor checksum is invalid: ${packageEntry.name}`, error);
    }
    if (
      !plainObject(checksum) ||
      !plainObject(checksum.files) ||
      Object.keys(checksum).length !== 2 ||
      !Object.hasOwn(checksum, "files") ||
      !Object.hasOwn(checksum, "package") ||
      checksum.package !== locked.checksum
    ) {
      workspaceFault("STALE", "vendor", `vendor checksum authority drifted: ${packageEntry.name}`);
    }
    const expectedFiles = new Map();
    const checksumFiles = [];
    for (const [path, digest] of Object.entries(checksum.files)) {
      safeRelativePath(path, `vendor checksum path in ${packageEntry.name}`, "vendor");
      if (!/^[0-9a-f]{64}$/u.test(digest)) {
        workspaceFault("FAIL", "vendor", `vendor checksum digest is invalid: ${packageEntry.name}`);
      }
      expectedFiles.set(path, digest);
      checksumFiles.push(Object.freeze({ path, sha256: digest }));
    }
    checksumFiles.sort((left, right) => comparePortablePaths(left.path, right.path));
    checksumFileCount += checksumFiles.length;
    if (checksumFileCount > maximumVendorEntries) {
      workspaceFault("FAIL", "vendor", "vendor checksum map exceeds its file ceiling");
    }
    checksumPackages.push(Object.freeze({
      name: locked.name,
      version: locked.version,
      packageChecksum: checksum.package,
      files: Object.freeze(checksumFiles),
    }));
    const packageRecords = [];
    async function walk(directory, prefix = "") {
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => comparePortablePaths(left.name, right.name));
      for (const child of children) {
        const portablePath = prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
        safeRelativePath(portablePath, `vendor entry in ${packageEntry.name}`, "vendor");
        const path = join(packageRoot, ...portablePath.split("/"));
        const metadata = await lstat(path);
        if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
          packageRecords.push(Object.freeze({
            package: packageEntry.name,
            path: portablePath,
            kind: "directory",
            bytes: 0,
            sha256: null,
          }));
          await walk(path, portablePath);
          continue;
        }
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
          workspaceFault("FAIL", "vendor", `vendor entry has an unsafe type: ${packageEntry.name}/${portablePath}`);
        }
        const bytes = await boundedRegularBytes(
          path,
          `vendor file ${packageEntry.name}/${portablePath}`,
          maximumVendorFileBytes,
          0,
          "vendor",
        );
        const digest = sha256(bytes);
        if (portablePath === ".cargo-checksum.json") {
          if (!bytes.equals(checksumBytes)) {
            workspaceFault("FAIL", "vendor", `vendor checksum changed during verification: ${packageEntry.name}`);
          }
        } else {
          const expectedDigest = expectedFiles.get(portablePath);
          if (expectedDigest === undefined) {
            workspaceFault("FAIL", "vendor", `vendor contains an unlisted file: ${packageEntry.name}/${portablePath}`);
          }
          if (digest !== expectedDigest) {
            workspaceFault("STALE", "vendor", `vendor file checksum drifted: ${packageEntry.name}/${portablePath}`);
          }
          expectedFiles.delete(portablePath);
        }
        totalBytes += bytes.length;
        if (totalBytes > maximumVendorBytes) {
          workspaceFault("FAIL", "vendor", "vendor tree exceeds its aggregate byte ceiling");
        }
        packageRecords.push(Object.freeze({
          package: packageEntry.name,
          path: portablePath,
          kind: "file",
          bytes: bytes.length,
          sha256: digest,
        }));
        if (entries.length + packageRecords.length > maximumVendorEntries) {
          workspaceFault("FAIL", "vendor", "vendor tree exceeds its entry ceiling");
        }
      }
    }
    await walk(packageRoot);
    if (expectedFiles.size !== 0) {
      workspaceFault(
        "STALE",
        "vendor",
        `vendor is missing checksum-listed files: ${packageEntry.name}`,
      );
    }
    packageRecords.sort((left, right) => comparePortablePaths(left.path, right.path));
    entries.push(...packageRecords);
  }
  entries.sort((left, right) => comparePortablePaths(
    `${left.package}/${left.path}`,
    `${right.package}/${right.path}`,
  ));
  checksumPackages.sort((left, right) => comparePortablePaths(
    `${left.name}\0${left.version}`,
    `${right.name}\0${right.version}`,
  ));
  return deepFreeze({
    packageCount: expectedDirectories.size,
    entryCount: entries.length,
    bytes: totalBytes,
    manifestSha256: canonicalSha256({ schema: vendorManifestSchema, entries }),
    entries,
    checksumFileCount,
    checksumPackages,
  });
}

async function requireAbsent(path, label, phase = "cache") {
  const metadata = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    workspaceFault("FAIL", phase, `${label} cannot be inspected`, error);
  });
  if (metadata !== undefined) {
    workspaceFault("FAIL", phase, `${label} must be absent`);
  }
}

function cargoPreparationEnvironment({
  cargoProgram,
  cargoHomeDirectory,
  homeDirectory,
  temporaryDirectory,
}) {
  const toolchainBin = dirname(cargoProgram);
  return Object.freeze({
    CARGO_HOME: cargoHomeDirectory,
    CARGO_NET_OFFLINE: "true",
    CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
    CARGO_TERM_COLOR: "never",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: homeDirectory,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    PATH: `${toolchainBin}:/usr/bin:/bin`,
    RUSTC: join(toolchainBin, "rustc"),
    SOURCE_DATE_EPOCH: "946684800",
    TEMP: temporaryDirectory,
    TERM: "dumb",
    TMP: temporaryDirectory,
    TMPDIR: temporaryDirectory,
  });
}

async function runPrivateCargo({
  processRunner,
  cargoProgram,
  args,
  cwd,
  environment,
  timeoutMs,
  maxOutputBytes,
  signal,
  phase,
  logicalPaths,
}) {
  let outcome;
  try {
    outcome = await processRunner({
      executable: cargoProgram,
      args,
      cwd,
      environment,
      timeoutMs,
      maxOutputBytes,
      signal,
    });
  } catch (error) {
    workspaceFault("MISSING", phase, `Cargo ${phase} could not be spawned`, error);
  }
  requireCompletedCargo(outcome, phase);
  return Object.freeze({
    outcome,
    evidence: processEvidence(
      outcome,
      cargoProgram,
      args,
      cwd,
      environment,
      timeoutMs,
      maxOutputBytes,
      logicalPaths,
    ),
  });
}

async function validateMetadata({
  stdout,
  sourceDirectory,
  vendorDirectory,
  targetDirectory,
  lockedPackages,
}) {
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch (error) {
    workspaceFault("STALE", "metadata", "Cargo metadata is not bounded JSON", error);
  }
  if (
    !plainObject(metadata) ||
    metadata.workspace_root !== sourceDirectory ||
    metadata.target_directory !== targetDirectory ||
    !Array.isArray(metadata.packages)
  ) {
    workspaceFault("STALE", "metadata", "Cargo metadata roots differ from the private workspace");
  }
  if (metadata.packages.length < 1 || metadata.packages.length > maximumRegistryPackages) {
    workspaceFault("FAIL", "metadata", "Cargo metadata exceeds its package ceiling");
  }
  const registryPackages = [];
  const projectedPackages = [];
  for (const packageValue of metadata.packages) {
    if (
      !plainObject(packageValue) ||
      !safeCrateName.test(packageValue.name ?? "") ||
      !safeCrateVersion.test(packageValue.version ?? "") ||
      typeof packageValue.manifest_path !== "string" ||
      packageValue.manifest_path.length === 0
    ) {
      workspaceFault("STALE", "metadata", "Cargo metadata package is malformed");
    }
    const manifest = await realpath(packageValue.manifest_path).catch((error) =>
      workspaceFault("STALE", "metadata", "Cargo metadata manifest is unavailable", error));
    if (packageValue.source === null) {
      if (!contained(sourceDirectory, manifest)) {
        workspaceFault("FAIL", "metadata", "local Cargo manifest escapes the source snapshot");
      }
      const manifestPath = relative(sourceDirectory, manifest).split(sep).join("/");
      if (manifestPath.length === 0) {
        workspaceFault("FAIL", "metadata", "local Cargo manifest is not a file path");
      }
      projectedPackages.push(Object.freeze({
        name: packageValue.name,
        version: packageValue.version,
        source: null,
        manifestPath: `/workspace/${manifestPath}`,
      }));
    } else if (packageValue.source === cratesIoRegistrySource) {
      if (!contained(vendorDirectory, manifest)) {
        workspaceFault("FAIL", "metadata", "registry Cargo manifest escapes the vendor closure");
      }
      registryPackages.push(`${packageValue.name}\0${packageValue.version}`);
      const manifestPath = relative(vendorDirectory, manifest).split(sep).join("/");
      if (manifestPath.length === 0) {
        workspaceFault("FAIL", "metadata", "registry Cargo manifest is not a file path");
      }
      projectedPackages.push(Object.freeze({
        name: packageValue.name,
        version: packageValue.version,
        source: cratesIoRegistrySource,
        manifestPath: `/cargo-home/vendor/${manifestPath}`,
      }));
    } else {
      workspaceFault("FAIL", "metadata", "Cargo metadata contains an unsealed package source");
    }
  }
  registryPackages.sort(comparePortablePaths);
  const expected = lockedPackages
    .map(({ name, version }) => `${name}\0${version}`)
    .sort(comparePortablePaths);
  if (
    registryPackages.length !== expected.length ||
    registryPackages.some((value, index) => value !== expected[index])
  ) {
    workspaceFault("STALE", "metadata", "Cargo metadata dependency set differs from Cargo.lock");
  }
  projectedPackages.sort((left, right) => comparePortablePaths(
    `${left.source ?? "local"}\0${left.name}\0${left.version}\0${left.manifestPath}`,
    `${right.source ?? "local"}\0${right.name}\0${right.version}\0${right.manifestPath}`,
  ));
  const packageIdentities = projectedPackages.map((value) =>
    `${value.source ?? "local"}\0${value.name}\0${value.version}\0${value.manifestPath}`);
  if (new Set(packageIdentities).size !== packageIdentities.length) {
    workspaceFault("FAIL", "metadata", "Cargo metadata package projection is duplicated");
  }
  const projection = {
    schema: metadataProjectionSchema,
    workspaceRoot: "/workspace",
    targetDirectory: "/state/target",
    packageCount: metadata.packages.length,
    registryPackageCount: registryPackages.length,
    packages: projectedPackages,
  };
  const bound = boundedCanonicalProjection(
    projection,
    maximumMetadataProjectionBytes,
    "Cargo metadata projection",
    "metadata",
  );
  return deepFreeze({ ...projection, bytes: bound.bytes, sha256: bound.sha256 });
}

async function createPrivateCargoDependencies({
  root,
  sourceSnapshot,
  cargoProgram,
  sourceCargoHome,
  processRunner,
  signal,
}) {
  const controlDirectory = join(root, "control");
  const sourceDirectory = sourceSnapshot.sourceDirectory;
  const homeDirectory = join(root, "home");
  const targetDirectory = join(root, "target");
  const cargoHomeDirectory = join(root, "cargo-home");
  const vendorDirectory = join(cargoHomeDirectory, "vendor");
  const bootstrapCargoHome = join(controlDirectory, "bootstrap-cargo-home");
  const temporaryDirectory = join(controlDirectory, "tmp");
  const logicalPaths = Object.freeze({
    bootstrapCargoHome,
    homeDirectory,
    sourceDirectory,
    targetDirectory,
    temporaryDirectory,
    vendorDirectory,
  });
  await Promise.all([
    mkdir(homeDirectory, { mode: 0o700 }),
    mkdir(targetDirectory, { mode: 0o700 }),
    mkdir(cargoHomeDirectory, { mode: 0o700 }),
    mkdir(bootstrapCargoHome, { mode: 0o700 }),
    mkdir(temporaryDirectory, { mode: 0o700 }),
  ]);
  await Promise.all([
    rejectCargoConfigurationAncestors(sourceDirectory),
    requireAbsent(vendorDirectory, "private vendor destination", "vendor"),
  ]);
  const cargoLockBytes = Buffer.from(sourceSnapshot.cargoLock.base64, "base64");
  if (
    cargoLockBytes.toString("base64") !== sourceSnapshot.cargoLock.base64 ||
    cargoLockBytes.length !== sourceSnapshot.cargoLock.bytes ||
    sha256(cargoLockBytes) !== sourceSnapshot.cargoLock.sha256
  ) {
    workspaceFault("STALE", "lock", "source snapshot Cargo.lock binding is invalid");
  }
  const bootstrap = await copyPrivateCargoBootstrap({
    sourceCargoHome,
    bootstrapCargoHome,
    cargoLock: cargoLockBytes,
  });
  await writeExclusiveBytes(
    join(bootstrapCargoHome, "config.toml"),
    sparseBootstrapConfigBytes(),
    "private bootstrap Cargo config",
  );
  const vendorArgs = Object.freeze([
    "vendor",
    "--locked",
    "--offline",
    "--versioned-dirs",
    "--color=never",
    "--manifest-path",
    join(sourceDirectory, "Cargo.toml"),
    vendorDirectory,
  ]);
  const vendorEnvironment = cargoPreparationEnvironment({
    cargoProgram,
    cargoHomeDirectory: bootstrapCargoHome,
    homeDirectory,
    temporaryDirectory,
  });
  const vendorRun = await runPrivateCargo({
    processRunner,
    cargoProgram,
    args: vendorArgs,
    cwd: sourceDirectory,
    environment: vendorEnvironment,
    timeoutMs: cargoPreparationTimeoutMs,
    maxOutputBytes: cargoVendorOutputBytes,
    signal,
    phase: "vendor",
    logicalPaths,
  });
  const vendorBefore = await verifyVendorTree(vendorDirectory, bootstrap.packages);

  await rm(join(bootstrapCargoHome, "config.toml"));
  const metadataConfig = cargoConfigBytes(vendorDirectory, targetDirectory);
  await writeExclusiveBytes(
    join(bootstrapCargoHome, "config.toml"),
    metadataConfig,
    "private metadata Cargo config",
  );
  const metadataArgs = Object.freeze([
    "metadata",
    "--locked",
    "--offline",
    "--format-version",
    "1",
    "--manifest-path",
    join(sourceDirectory, "Cargo.toml"),
  ]);
  const metadataRun = await runPrivateCargo({
    processRunner,
    cargoProgram,
    args: metadataArgs,
    cwd: sourceDirectory,
    environment: vendorEnvironment,
    timeoutMs: cargoPreparationTimeoutMs,
    maxOutputBytes: cargoMetadataOutputBytes,
    signal,
    phase: "metadata",
    logicalPaths,
  });
  const metadata = await validateMetadata({
    stdout: metadataRun.outcome.stdout,
    sourceDirectory,
    vendorDirectory,
    targetDirectory,
    lockedPackages: bootstrap.packages,
  });
  const vendorAfter = await verifyVendorTree(vendorDirectory, bootstrap.packages);
  const vendorChecksumBeforeBase = {
    schema: vendorChecksumSchema,
    cargoLockSha256: sourceSnapshot.cargoLock.sha256,
    packages: vendorBefore.checksumPackages,
  };
  const vendorChecksumAfterBase = {
    schema: vendorChecksumSchema,
    cargoLockSha256: sourceSnapshot.cargoLock.sha256,
    packages: vendorAfter.checksumPackages,
  };
  const vendorChecksumBefore = boundedCanonicalProjection(
    vendorChecksumBeforeBase,
    maximumVendorChecksumProjectionBytes,
    "vendor checksum projection",
    "vendor",
  );
  const vendorChecksumAfter = boundedCanonicalProjection(
    vendorChecksumAfterBase,
    maximumVendorChecksumProjectionBytes,
    "vendor checksum projection",
    "vendor",
  );
  if (
    vendorAfter.manifestSha256 !== vendorBefore.manifestSha256 ||
    vendorChecksumAfter.sha256 !== vendorChecksumBefore.sha256
  ) {
    workspaceFault("FAIL", "verify", "vendor closure changed during Cargo metadata");
  }

  await rm(bootstrapCargoHome, { recursive: true, force: false });
  await requireAbsent(bootstrapCargoHome, "bootstrap Cargo authority", "verify");
  const finalConfig = cargoConfigBytes("/cargo-home/vendor", "/state/target");
  await writeExclusiveBytes(
    join(cargoHomeDirectory, "config.toml"),
    finalConfig,
    "final private Cargo config",
  );
  const cargoHomeEntries = (await readdir(cargoHomeDirectory, { withFileTypes: true }))
    .sort((left, right) => comparePortablePaths(left.name, right.name));
  if (
    cargoHomeEntries.length !== 2 ||
    cargoHomeEntries[0].name !== "config.toml" ||
    !cargoHomeEntries[0].isFile() ||
    cargoHomeEntries[0].isSymbolicLink() ||
    cargoHomeEntries[1].name !== "vendor" ||
    !cargoHomeEntries[1].isDirectory() ||
    cargoHomeEntries[1].isSymbolicLink()
  ) {
    workspaceFault("FAIL", "verify", "final Cargo home contains unexpected authority");
  }

  const archiveProjectionBase = {
    schema: "oxigraph.g1.7-registry-archive-set/v1",
    cargoLockSha256: sourceSnapshot.cargoLock.sha256,
    records: bootstrap.archives,
  };
  const archiveProjection = boundedCanonicalProjection(
    archiveProjectionBase,
    maximumArchiveProjectionBytes,
    "registry archive projection",
  );
  const sparseProjectionBase = {
    schema: "oxigraph.g1.7-sparse-bootstrap-set/v1",
    registryDirectory: cratesIoDirectory,
    configSha256: bootstrap.sparseConfigSha256,
    records: bootstrap.sparseEntries,
  };
  const sparseProjection = boundedCanonicalProjection(
    sparseProjectionBase,
    maximumSparseProjectionBytes,
    "sparse bootstrap projection",
  );
  const dependencyBase = {
    schema: dependencySchema,
    policy: dependencyPolicy,
    cargoLock: {
      blob: sourceSnapshot.cargoLock.blob,
      bytes: sourceSnapshot.cargoLock.bytes,
      sha256: sourceSnapshot.cargoLock.sha256,
    },
    registrySource: cratesIoRegistrySource,
    registryDirectory: cratesIoDirectory,
    packageCount: bootstrap.packages.length,
    packageSetSha256: bootstrap.packageSetSha256,
    packages: bootstrap.packages,
    archives: {
      schema: archiveProjectionBase.schema,
      records: bootstrap.archives,
      count: bootstrap.archives.length,
      bytes: bootstrap.archiveBytes,
      serializedBytes: archiveProjection.bytes,
      sha256: archiveProjection.sha256,
    },
    sparseBootstrap: {
      schema: sparseProjectionBase.schema,
      records: bootstrap.sparseEntries,
      uniqueCrateCount: bootstrap.sparseEntries.length,
      bytes: bootstrap.sparseBytes,
      serializedBytes: sparseProjection.bytes,
      configSha256: bootstrap.sparseConfigSha256,
      entriesSha256: sparseProjection.sha256,
    },
    vendorChecksums: {
      schema: vendorChecksumSchema,
      packageCount: vendorBefore.checksumPackages.length,
      fileCount: vendorBefore.checksumFileCount,
      serializedBytes: vendorChecksumBefore.bytes,
      packages: vendorBefore.checksumPackages,
      sha256: vendorChecksumBefore.sha256,
    },
    vendorCommand: vendorRun.evidence,
    metadataCommand: metadataRun.evidence,
    metadata,
    vendor: {
      packageCount: vendorBefore.packageCount,
      entryCount: vendorBefore.entryCount,
      bytes: vendorBefore.bytes,
      beforeSha256: vendorBefore.manifestSha256,
      afterSha256: vendorAfter.manifestSha256,
    },
    finalConfigSha256: sha256(finalConfig),
  };
  const dependencies = deepFreeze({
    ...dependencyBase,
    snapshotSha256: canonicalSha256(dependencyBase),
  });
  dependencyInternals.set(dependencies, Object.freeze({
    finalConfig,
    lockedPackages: bootstrap.packages,
    sparseEntries: bootstrap.sparseEntries,
    vendorEntries: vendorBefore.entries,
  }));
  return Object.freeze({
    cargoHomeDirectory,
    dependencies,
    homeDirectory,
    targetDirectory,
    vendorDirectory,
  });
}

async function verifySourceSnapshot(sourceSnapshot, phase) {
  const internals = sourceSnapshotInternals.get(sourceSnapshot);
  if (internals === undefined) {
    workspaceFault("FAIL", phase, "source snapshot is not owned by this acquisition process");
  }
  const manifest = await verifyMaterializedTree(
    sourceSnapshot.sourceDirectory,
    internals.expectedEntries,
  );
  if (
    manifest.entryCount !== sourceSnapshot.entryCount ||
    manifest.totalBytes !== sourceSnapshot.totalBytes ||
    manifest.manifestSha256 !== sourceSnapshot.beforeSha256
  ) {
    workspaceFault("FAIL", phase, "source snapshot changed after materialization");
  }
  return Object.freeze({
    entryCount: manifest.entryCount,
    totalBytes: manifest.totalBytes,
    beforeSha256: sourceSnapshot.beforeSha256,
    afterSha256: manifest.manifestSha256,
  });
}

async function workspaceRootMetadata(root, state, phase) {
  const metadata = await lstat(root, { bigint: true }).catch((error) =>
    workspaceFault("FAIL", phase, "workspace root cannot be inspected", error));
  const resolved = await realpath(root).catch((error) =>
    workspaceFault("FAIL", phase, "workspace root cannot be resolved", error));
  const expectedOwner = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : metadata.uid;
  const expectedGroup = typeof process.getgid === "function"
    ? BigInt(process.getgid())
    : metadata.gid;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    resolved !== root ||
    dirname(root) !== state.parent ||
    !basename(root).startsWith(`oxigraph-g17-${state.runId}-`) ||
    !isDeepStrictEqual(objectIdentity(metadata), state.rootIdentity) ||
    Number(metadata.mode & 0o7777n) !== 0o700 ||
    metadata.uid !== expectedOwner ||
    metadata.gid !== expectedGroup
  ) {
    workspaceFault("FAIL", phase, "workspace root identity or ownership changed");
  }
  return metadata;
}

async function safeRemoveGeneratedRoot({ root, parent, runId, rootIdentity }) {
  if (
    !safeRunId.test(runId ?? "") ||
    !isAbsolute(root) ||
    !isAbsolute(parent) ||
    dirname(root) !== parent ||
    !basename(root).startsWith(`oxigraph-g17-${runId}-`) ||
    basename(root) === `oxigraph-g17-${runId}-`
  ) {
    workspaceFault("FAIL", "cleanup", "workspace cleanup target is unsafe");
  }
  const metadata = await lstat(root, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    workspaceFault("FAIL", "cleanup", "workspace cleanup target cannot be inspected", error);
  });
  if (metadata === undefined) {
    if (rootIdentity !== undefined) {
      workspaceFault("FAIL", "cleanup", "workspace cleanup target disappeared");
    }
    return;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    await realpath(root) !== root ||
    (rootIdentity !== undefined &&
      !isDeepStrictEqual(objectIdentity(metadata), rootIdentity))
  ) {
    workspaceFault("FAIL", "cleanup", "workspace cleanup target is not its generated directory");
  }
  await chmod(root, 0o700);
  if (rootIdentity !== undefined) {
    const beforeRemove = await lstat(root, { bigint: true });
    if (!isDeepStrictEqual(objectIdentity(beforeRemove), rootIdentity)) {
      workspaceFault("FAIL", "cleanup", "workspace cleanup target identity changed");
    }
  }
  await rm(root, { recursive: true, force: false }).catch((error) =>
    workspaceFault("FAIL", "cleanup", "workspace cleanup failed", error));
  const remaining = await lstat(root).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    workspaceFault("FAIL", "cleanup", "workspace cleanup result cannot be inspected", error);
  });
  if (remaining !== undefined) {
    workspaceFault("FAIL", "cleanup", "workspace cleanup target remains present");
  }
}

function sealedCargoProgram(identity, suppliedProgram, enforceIdentity) {
  if (typeof suppliedProgram !== "string" || !isAbsolute(suppliedProgram)) {
    workspaceFault("FAIL", "toolchain", "Cargo program is not an absolute path");
  }
  if (!enforceIdentity) return suppliedProgram;
  const matches = (identity?.toolchain ?? []).filter(({ program }) => program === "cargo");
  if (matches.length !== 1) {
    workspaceFault("FAIL", "toolchain", "sealed identity has no unique Cargo tool");
  }
  const cargo = matches[0];
  if (
    cargo.toolchainPath !== suppliedProgram ||
    !/^[0-9a-f]{64}$/u.test(cargo.toolchainExecutableSha256 ?? "")
  ) {
    workspaceFault("STALE", "toolchain", "Cargo program differs from the sealed identity");
  }
  return suppliedProgram;
}

async function createNativeWorkspaceWithOptions({
  runId,
  repoRoot,
  identity,
  cargoProgram,
  sourceCargoHome,
  temporaryParent,
  requiredGitlinks,
  processRunner,
  enforceToolIdentity,
  production,
  signal,
}) {
  if (!safeRunId.test(runId ?? "") || typeof production !== "boolean") {
    workspaceFault("FAIL", "workspace", "native workspace run id is unsafe");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    workspaceFault("FAIL", "workspace", "native workspace abort signal is invalid");
  }
  const parent = await requireRealDirectory(
    temporaryParent,
    "temporary workspace parent",
    "MISSING",
    "workspace",
  );
  const requestedCargo = sealedCargoProgram(identity, cargoProgram, enforceToolIdentity);
  const resolvedCargo = await realpath(requestedCargo).catch((error) =>
    workspaceFault("MISSING", "toolchain", "sealed Cargo program is unavailable", error));
  if (enforceToolIdentity) {
    const cargo = identity.toolchain.find(({ program }) => program === "cargo");
    const bytes = await boundedRegularBytes(
      resolvedCargo,
      "sealed Cargo program",
      256 * 1024 * 1024,
      1,
      "toolchain",
    );
    if (
      resolvedCargo !== cargo.toolchainPath ||
      sha256(bytes) !== cargo.toolchainExecutableSha256
    ) {
      workspaceFault("STALE", "toolchain", "sealed Cargo program changed before acquisition");
    }
  }
  const root = await mkdtemp(join(parent, `oxigraph-g17-${runId}-`));
  let rootIdentity;
  let sourceSnapshot;
  let dependencyWorkspace;
  let workspace;
  try {
    await chmod(root, 0o700);
    const rootMetadata = await lstat(root, { bigint: true });
    rootIdentity = objectIdentity(rootMetadata);
    await workspaceRootMetadata(root, {
      parent,
      runId,
      rootIdentity,
    }, "workspace");
    sourceSnapshot = await materializeSourceSnapshot({
      repoRoot,
      identity,
      destinationRoot: root,
      requiredGitlinks,
    });
    dependencyWorkspace = await createPrivateCargoDependencies({
      root,
      sourceSnapshot,
      cargoProgram: resolvedCargo,
      sourceCargoHome,
      processRunner,
      signal,
    });
    await verifySourceSnapshot(sourceSnapshot, "verify");
    workspace = deepFreeze({
      schema: workspaceSchema,
      policy: workspacePolicy,
      runId,
      root,
      sourceDirectory: sourceSnapshot.sourceDirectory,
      cargoHomeDirectory: dependencyWorkspace.cargoHomeDirectory,
      vendorDirectory: dependencyWorkspace.vendorDirectory,
      homeDirectory: dependencyWorkspace.homeDirectory,
      targetDirectory: dependencyWorkspace.targetDirectory,
      sourceSnapshot,
      dependencies: dependencyWorkspace.dependencies,
    });
    liveWorkspaces.set(workspace, {
      parent,
      runId,
      rootIdentity,
      phase: "live",
      production,
    });
    await verifyG17NativeWorkspace(workspace, "after-preparation");
    return workspace;
  } catch (error) {
    if (workspace !== undefined) {
      liveWorkspaces.delete(workspace);
    }
    if (dependencyWorkspace !== undefined) {
      dependencyInternals.delete(dependencyWorkspace.dependencies);
    }
    if (sourceSnapshot !== undefined) {
      sourceSnapshotInternals.delete(sourceSnapshot);
    }
    let cleanupError;
    try {
      await safeRemoveGeneratedRoot({ root, parent, runId, rootIdentity });
    } catch (caught) {
      cleanupError = caught;
    }
    if (cleanupError !== undefined) {
      if (error instanceof G17NativeWorkspaceFault && Object.isExtensible(error)) {
        error.cleanupError = cleanupError.message;
      } else {
        throw new AggregateError(
          [error, cleanupError],
          "native workspace acquisition and cleanup failed",
        );
      }
    }
    if (error instanceof G17NativeWorkspaceFault) throw error;
    workspaceFault("FAIL", "workspace", error.message, error);
  }
}

export async function verifyG17NativeWorkspace(workspace, phase = "verify") {
  const state = liveWorkspaces.get(workspace);
  try {
    if (
      state === undefined ||
      state.phase !== "live" ||
      !["after-preparation", "after-native", "verify"].includes(phase)
    ) {
      workspaceFault("FAIL", "verify", "native workspace verification target is not live");
    }
    state.phase = "verifying";
    await workspaceRootMetadata(workspace.root, state, phase);
    const source = await verifySourceSnapshot(workspace.sourceSnapshot, phase);
    const dependencyState = dependencyInternals.get(workspace.dependencies);
    if (dependencyState === undefined) {
      workspaceFault("FAIL", phase, "dependency closure is not owned by this acquisition process");
    }
    const vendor = await verifyVendorTree(
      workspace.vendorDirectory,
      dependencyState.lockedPackages,
    );
    const vendorChecksum = boundedCanonicalProjection(
      {
        schema: vendorChecksumSchema,
        cargoLockSha256: workspace.dependencies.cargoLock.sha256,
        packages: vendor.checksumPackages,
      },
      maximumVendorChecksumProjectionBytes,
      "vendor checksum projection",
      phase,
    );
    const config = await boundedRegularBytes(
      join(workspace.cargoHomeDirectory, "config.toml"),
      "final private Cargo config",
      maximumSparseConfigBytes,
      1,
      phase,
    );
    if (
      vendor.manifestSha256 !== workspace.dependencies.vendor.beforeSha256 ||
      vendor.manifestSha256 !== workspace.dependencies.vendor.afterSha256 ||
      vendorChecksum.sha256 !== workspace.dependencies.vendorChecksums.sha256 ||
      sha256(config) !== workspace.dependencies.finalConfigSha256 ||
      !config.equals(dependencyState.finalConfig)
    ) {
      workspaceFault("FAIL", phase, "private dependency closure changed after preparation");
    }
    await requireAbsent(
      join(workspace.root, "control", "bootstrap-cargo-home"),
      "bootstrap Cargo authority",
      phase,
    );
    await workspaceRootMetadata(workspace.root, state, phase);
    const workspaceEvidence = {
      schema: "oxigraph.g1.7-native-workspace-verification/v1",
      phase,
      source,
      vendor: {
        packageCount: vendor.packageCount,
        entryCount: vendor.entryCount,
        bytes: vendor.bytes,
        beforeSha256: workspace.dependencies.vendor.beforeSha256,
        afterSha256: vendor.manifestSha256,
      },
      vendorChecksumSha256: vendorChecksum.sha256,
      finalConfigSha256: sha256(config),
    };
    return deepFreeze({
      ...workspaceEvidence,
      sha256: canonicalSha256(workspaceEvidence),
    });
  } catch (error) {
    if (error instanceof G17NativeWorkspaceFault) throw error;
    workspaceFault("FAIL", phase, error.message, error);
  } finally {
    if (state?.phase === "verifying") state.phase = "live";
  }
}

export function g17NativeWorkspaceProjection(workspace) {
  const state = liveWorkspaces.get(workspace);
  if (state === undefined || state.phase !== "live") {
    workspaceFault("FAIL", "verify", "native workspace projection target is not live");
  }
  const projection = {
    schema: workspace.schema,
    policy: workspace.policy,
    source: {
      policy: workspace.sourceSnapshot.policy,
      commit: workspace.sourceSnapshot.commit,
      tree: workspace.sourceSnapshot.tree,
      cargoLockSha256: workspace.sourceSnapshot.cargoLock.sha256,
      requiredGitlinks: workspace.sourceSnapshot.requiredGitlinks,
      excludedGitlinks: workspace.sourceSnapshot.excludedGitlinks,
      objectClosureSha256: workspace.sourceSnapshot.objectClosureSha256,
      entryCount: workspace.sourceSnapshot.entryCount,
      totalBytes: workspace.sourceSnapshot.totalBytes,
      manifestSha256: workspace.sourceSnapshot.manifestSha256,
    },
    dependencies: {
      schema: workspace.dependencies.schema,
      policy: workspace.dependencies.policy,
      packageCount: workspace.dependencies.packageCount,
      packageSetSha256: workspace.dependencies.packageSetSha256,
      archiveCount: workspace.dependencies.archives.count,
      archiveBytes: workspace.dependencies.archives.bytes,
      archiveSetSha256: workspace.dependencies.archives.sha256,
      sparseEntryCount: workspace.dependencies.sparseBootstrap.uniqueCrateCount,
      sparseEntrySetSha256: workspace.dependencies.sparseBootstrap.entriesSha256,
      vendorChecksumSetSha256: workspace.dependencies.vendorChecksums.sha256,
      vendorManifestSha256: workspace.dependencies.vendor.afterSha256,
      metadataProjectionSha256: workspace.dependencies.metadata.sha256,
      finalConfigSha256: workspace.dependencies.finalConfigSha256,
      snapshotSha256: workspace.dependencies.snapshotSha256,
    },
  };
  return deepFreeze({ ...projection, sha256: canonicalSha256(projection) });
}

export function g17NativeWorkspaceOwnerEvidence(workspace, verification) {
  const state = liveWorkspaces.get(workspace);
  if (state === undefined || state.phase !== "live") {
    workspaceFault("FAIL", "verify", "native workspace owner target is not live");
  }
  if (!state.production) {
    workspaceFault("FAIL", "verify", "test workspace cannot mint production owner evidence");
  }
  const projection = g17NativeWorkspaceProjection(workspace);
  if (
    verification?.schema !== "oxigraph.g1.7-native-workspace-verification/v1" ||
    verification.phase !== "after-native" ||
    verification.source?.beforeSha256 !== workspace.sourceSnapshot.beforeSha256 ||
    verification.source?.afterSha256 !== workspace.sourceSnapshot.afterSha256 ||
    verification.vendor?.beforeSha256 !== workspace.dependencies.vendor.beforeSha256 ||
    verification.vendor?.afterSha256 !== workspace.dependencies.vendor.afterSha256 ||
    verification.vendorChecksumSha256 !== workspace.dependencies.vendorChecksums.sha256 ||
    verification.finalConfigSha256 !== workspace.dependencies.finalConfigSha256
  ) {
    workspaceFault("FAIL", "verify", "post-native workspace evidence is inconsistent");
  }
  const source = {
    schema: workspace.sourceSnapshot.schema,
    policy: workspace.sourceSnapshot.policy,
    commit: workspace.sourceSnapshot.commit,
    tree: workspace.sourceSnapshot.tree,
    cargoLock: workspace.sourceSnapshot.cargoLock,
    requiredGitlinks: workspace.sourceSnapshot.requiredGitlinks,
    excludedGitlinks: workspace.sourceSnapshot.excludedGitlinks,
    symlinks: workspace.sourceSnapshot.symlinks,
    objectClosureSha256: workspace.sourceSnapshot.objectClosureSha256,
    entryCount: workspace.sourceSnapshot.entryCount,
    totalBytes: workspace.sourceSnapshot.totalBytes,
    manifestSha256: workspace.sourceSnapshot.manifestSha256,
    beforeSha256: workspace.sourceSnapshot.beforeSha256,
    afterSha256: workspace.sourceSnapshot.afterSha256,
  };
  const owner = {
    schema: "oxigraph.g1.7-native-workspace-owner/v1",
    policy: workspace.policy,
    source,
    dependencies: workspace.dependencies,
    verification,
    projection,
  };
  const sealed = deepFreeze({ ...owner, sha256: canonicalSha256(owner) });
  if (canonicalJson(sealed).includes(workspace.root)) {
    workspaceFault("FAIL", "verify", "native workspace owner exposes its host path");
  }
  return sealed;
}

export function g17NativeWorkspaceEnvironment(toolchain, workspace) {
  const state = liveWorkspaces.get(workspace);
  if (
    state === undefined ||
    state.phase !== "live" ||
    typeof toolchain?.rustc?.toolchainPath !== "string"
  ) {
    workspaceFault("FAIL", "verify", "native workspace environment inputs are invalid");
  }
  return Object.freeze({
    CARGO_HOME: workspace.cargoHomeDirectory,
    CARGO_NET_OFFLINE: "true",
    CARGO_TARGET_DIR: workspace.targetDirectory,
    CARGO_TERM_COLOR: "never",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: workspace.homeDirectory,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    PATH: `${dirname(toolchain.rustc.toolchainPath)}:/usr/bin:/bin`,
    RUSTC: toolchain.rustc.toolchainPath,
    TEMP: workspace.root,
    TERM: "dumb",
    TMP: workspace.root,
    TMPDIR: workspace.root,
  });
}

export async function destroyG17NativeWorkspace(workspace) {
  const state = liveWorkspaces.get(workspace);
  if (state === undefined || state.phase !== "live") {
    workspaceFault("FAIL", "cleanup", "native workspace cleanup target is not live");
  }
  state.phase = "destroying";
  try {
    await safeRemoveGeneratedRoot({
      root: workspace.root,
      parent: state.parent,
      runId: state.runId,
      rootIdentity: state.rootIdentity,
    });
    dependencyInternals.delete(workspace.dependencies);
    sourceSnapshotInternals.delete(workspace.sourceSnapshot);
    liveWorkspaces.delete(workspace);
  } catch (error) {
    state.phase = "live";
    throw error;
  }
}

export function createG17NativeWorkspace(options) {
  exactInput(
    options,
    ["runId", "repoRoot", "identity", "cargoProgram"],
    ["signal"],
    "production workspace acquisition input",
  );
  return createNativeWorkspaceWithOptions({
    ...options,
    sourceCargoHome: join(userInfo().homedir, ".cargo"),
    temporaryParent: tmpdir(),
    requiredGitlinks: productionRequiredGitlinks,
    processRunner: runBoundedProcess,
    enforceToolIdentity: true,
    production: true,
  });
}

export function createG17NativeWorkspaceForTesting(input) {
  exactInput(
    input,
    ["sourceCargoHome", "temporaryParent", "processRunner"],
    ["requiredGitlinks"],
    "native workspace test factory input",
  );
  const {
    sourceCargoHome,
    temporaryParent,
    requiredGitlinks = [],
    processRunner,
  } = input;
  if (
    typeof sourceCargoHome !== "string" ||
    typeof temporaryParent !== "string" ||
    !Array.isArray(requiredGitlinks) ||
    typeof processRunner !== "function"
  ) {
    throw new Error("G1.7 native workspace test factory inputs are invalid");
  }
  return (options) => {
    exactInput(
      options,
      ["runId", "repoRoot", "identity", "cargoProgram"],
      ["signal"],
      "test workspace acquisition input",
    );
    return createNativeWorkspaceWithOptions({
      ...options,
      sourceCargoHome,
      temporaryParent,
      requiredGitlinks,
      processRunner,
      enforceToolIdentity: false,
      production: false,
    });
  };
}

function parseTree(output, prefix = "") {
  const entries = [];
  for (const record of output.split("\0").filter(Boolean)) {
    const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (match === null) {
      workspaceFault("FAIL", "source", "Git emitted an unsupported tree record");
    }
    const [, mode, type, object, rawPath] = match;
    const path = safeRelativePath(
      prefix.length === 0 ? rawPath : `${prefix}/${rawPath}`,
      "tree entry",
    );
    if (
      (mode === "160000" && type !== "commit") ||
      (mode !== "160000" && type !== "blob")
    ) {
      workspaceFault("FAIL", "source", `Git tree mode/type disagrees at ${path}`);
    }
    entries.push(Object.freeze({ mode, type, object, path }));
  }
  return entries.sort((left, right) => comparePortablePaths(left.path, right.path));
}

function expectedDirectories(paths) {
  const directories = new Set([""]);
  for (const path of paths) {
    let current = dirname(path);
    while (current !== "." && current !== "") {
      directories.add(current);
      current = dirname(current);
    }
  }
  return directories;
}

async function verifyMaterializedTree(sourceDirectory, expectedEntries) {
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]));
  const directories = expectedDirectories(expected.keys());
  const observed = [];
  let totalBytes = 0;

  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePortablePaths(left.name, right.name));
    for (const entry of entries) {
      const portablePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      safeRelativePath(portablePath, "materialized entry");
      const path = join(sourceDirectory, ...portablePath.split("/"));
      const metadata = await lstat(path);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        if (!directories.has(portablePath)) {
          workspaceFault("FAIL", "source", `materialized tree contains extra directory: ${portablePath}`);
        }
        await walk(path, portablePath);
        continue;
      }
      const expectedEntry = expected.get(portablePath);
      if (expectedEntry === undefined) {
        workspaceFault("FAIL", "source", `materialized tree contains extra entry: ${portablePath}`);
      }
      let bytes;
      let kind;
      let target;
      if (metadata.isSymbolicLink()) {
        if (expectedEntry.mode !== "120000") {
          workspaceFault("FAIL", "source", `unexpected symlink: ${portablePath}`);
        }
        target = await readlink(path);
        if (
          target.length === 0 ||
          target.includes("\0") ||
          isAbsolute(target) ||
          !contained(sourceDirectory, join(dirname(path), target))
        ) {
          workspaceFault("FAIL", "source", `escaping source symlink: ${portablePath}`);
        }
        bytes = Buffer.from(target, "utf8");
        kind = "symlink";
      } else if (metadata.isFile()) {
        const observedMode = (metadata.mode & 0o111) === 0 ? "100644" : "100755";
        if (
          expectedEntry.mode !== observedMode ||
          metadata.nlink !== 1 ||
          metadata.size > maximumSourceFileBytes
        ) {
          workspaceFault("FAIL", "source", `source file metadata drifted: ${portablePath}`);
        }
        bytes = await readFile(path);
        kind = "file";
      } else {
        workspaceFault("FAIL", "source", `source contains a special file: ${portablePath}`);
      }
      if (gitBlobSha1(bytes) !== expectedEntry.object) {
        workspaceFault("STALE", "source", `source blob differs from Git: ${portablePath}`);
      }
      totalBytes += bytes.length;
      if (totalBytes > maximumSourceBytes) {
        workspaceFault("FAIL", "source", "source snapshot exceeds its byte ceiling");
      }
      observed.push(Object.freeze({
        path: portablePath,
        mode: expectedEntry.mode,
        kind,
        bytes: bytes.length,
        gitBlob: expectedEntry.object,
        sha256: sha256(bytes),
        ...(kind === "symlink" ? { target } : {}),
      }));
      expected.delete(portablePath);
      if (observed.length > maximumSourceEntries) {
        workspaceFault("FAIL", "source", "source snapshot exceeds its entry ceiling");
      }
    }
  }

  await walk(sourceDirectory);
  if (expected.size !== 0) {
    workspaceFault(
      "STALE",
      "source",
      `source snapshot is missing Git entries: ${[...expected.keys()].slice(0, 5).join(", ")}`,
    );
  }
  observed.sort((left, right) => comparePortablePaths(left.path, right.path));
  return deepFreeze({
    entries: observed,
    entryCount: observed.length,
    totalBytes,
    manifestSha256: canonicalSha256({
      schema: sourceManifestSchema,
      entries: observed,
    }),
  });
}

async function gitText({ args, cwd, home, environmentOverrides, maxOutputBytes = 64 * 1024 * 1024 }) {
  return runGit({
    args,
    cwd,
    home,
    environmentOverrides,
    maxOutputBytes,
    timeoutMs: 300_000,
  });
}

async function createRawCheckoutRepository({ controlDirectory, repository, gitHome }) {
  const gitDirectory = join(controlDirectory, "raw-checkout.git");
  await gitText({
    args: ["init", "--bare", "--quiet", gitDirectory],
    cwd: repository,
    home: gitHome,
  });
  const rawAttributes = [
    "* -text -crlf -ident -filter !eol !working-tree-encoding",
    "** -text -crlf -ident -filter !eol !working-tree-encoding",
    "",
  ].join("\n");
  await writeFile(join(gitDirectory, "info", "attributes"), rawAttributes, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return gitDirectory;
}

async function materializeSourceSnapshot({
  repoRoot,
  identity,
  destinationRoot,
  requiredGitlinks,
}) {
  let sourceDirectory;
  let controlDirectory;
  try {
    const repository = await realpath(repoRoot);
    const destination = await realpath(destinationRoot);
    if (repository === destination || !GIT_OBJECT.test(identity?.subject?.commit ?? "")) {
      workspaceFault("FAIL", "source", "source snapshot inputs are invalid");
    }
    controlDirectory = join(destination, "control");
    sourceDirectory = join(destination, "source");
    await mkdir(controlDirectory, { mode: 0o700 });
    await mkdir(sourceDirectory, { mode: 0o700 });
    const gitHome = await createGitHome(controlDirectory);
    const commit = identity.subject.commit;
    const tree = (await gitText({
      args: ["rev-parse", `${commit}^{tree}`],
      cwd: repository,
      home: gitHome,
    })).trim();
    if (tree !== identity.subject.tree) {
      workspaceFault("STALE", "source", "subject tree differs from the sealed identity");
    }
    const cargoLockBlob = (await gitText({
      args: ["rev-parse", `${commit}:Cargo.lock`],
      cwd: repository,
      home: gitHome,
    })).trim();
    const cargoLockText = await gitText({
      args: ["show", `${commit}:Cargo.lock`],
      cwd: repository,
      home: gitHome,
      maxOutputBytes: 16 * 1024 * 1024,
    });
    const cargoLockBytes = Buffer.from(cargoLockText, "utf8");
    if (
      cargoLockBlob !== identity.cargoLock?.blob ||
      sha256(cargoLockBytes) !== identity.cargoLock?.sha256
    ) {
      workspaceFault("STALE", "source", "committed Cargo.lock differs from identity");
    }
    const rootEntries = parseTree(await gitText({
      args: ["ls-tree", "-r", "-z", commit],
      cwd: repository,
      home: gitHome,
    }));
    const rootGitlinks = rootEntries.filter(({ mode }) => mode === "160000");
    const required = requiredGitlinks.map((gitlink) => {
      safeRelativePath(gitlink.path, "required gitlink");
      if (!GIT_OBJECT.test(gitlink.commit ?? "")) {
        workspaceFault("FAIL", "source", `required gitlink commit is invalid: ${gitlink.path}`);
      }
      const entry = rootGitlinks.find(({ path }) => path === gitlink.path);
      if (entry?.object !== gitlink.commit) {
        workspaceFault("STALE", "source", `required gitlink drifted: ${gitlink.path}`);
      }
      return { ...gitlink };
    });
    if (new Set(required.map(({ path }) => path)).size !== required.length) {
      workspaceFault("FAIL", "source", "required gitlink paths are duplicated");
    }
    const excludedGitlinks = rootGitlinks
      .filter(({ path }) => !required.some((requiredEntry) => requiredEntry.path === path))
      .map(({ path, object: commitObject }) => Object.freeze({ path, commit: commitObject }))
      .sort((left, right) => comparePortablePaths(left.path, right.path));

    const commonDirectoryText = await gitText({
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      cwd: repository,
      home: gitHome,
    });
    const commonDirectory = await realpath(commonDirectoryText.trim());
    const rootObjectsDirectory = await realpath(join(commonDirectory, "objects"));
    const rawCheckoutGitDirectory = await createRawCheckoutRepository({
      controlDirectory,
      repository,
      gitHome,
    });
    const superIndex = join(controlDirectory, "super.index");
    await gitText({
      args: [`--git-dir=${rawCheckoutGitDirectory}`, "read-tree", commit],
      cwd: repository,
      home: gitHome,
      environmentOverrides: {
        GIT_ALTERNATE_OBJECT_DIRECTORIES: rootObjectsDirectory,
        GIT_INDEX_FILE: superIndex,
      },
    });
    await gitText({
      args: [
        `--git-dir=${rawCheckoutGitDirectory}`,
        `--work-tree=${sourceDirectory}`,
        "checkout-index",
        "--all",
        "--force",
        `--prefix=${sourceDirectory}${sep}`,
      ],
      cwd: repository,
      home: gitHome,
      environmentOverrides: {
        GIT_ALTERNATE_OBJECT_DIRECTORIES: rootObjectsDirectory,
        GIT_INDEX_FILE: superIndex,
      },
    });
    for (const { path: excludedPath } of excludedGitlinks) {
      const placeholder = join(sourceDirectory, ...excludedPath.split("/"));
      if (!contained(sourceDirectory, placeholder)) {
        workspaceFault("FAIL", "source", `excluded gitlink escapes source: ${excludedPath}`);
      }
      const metadata = await lstat(placeholder).catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        workspaceFault(
          "FAIL",
          "source",
          `excluded gitlink placeholder cannot be inspected: ${excludedPath}`,
          error,
        );
      });
      if (metadata === undefined) continue;
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        workspaceFault(
          "FAIL",
          "source",
          `excluded gitlink placeholder has an unsafe type: ${excludedPath}`,
        );
      }
      if ((await readdir(placeholder)).length !== 0) {
        workspaceFault(
          "FAIL",
          "source",
          `excluded gitlink placeholder is not empty: ${excludedPath}`,
        );
      }
      await rmdir(placeholder);
    }

    const expectedEntries = rootEntries.filter(({ mode }) => mode !== "160000");
    const sealedRequired = [];
    for (let index = 0; index < required.length; index += 1) {
      const gitlink = required[index];
      const gitDirectory = await realpath(
        join(commonDirectory, "modules", ...gitlink.path.split("/")),
      ).catch((error) => workspaceFault(
        "MISSING",
        "source",
        `required gitlink object store is missing: ${gitlink.path}`,
        error,
      ));
      const observedTree = (await gitText({
        args: [`--git-dir=${gitDirectory}`, "rev-parse", `${gitlink.commit}^{tree}`],
        cwd: repository,
        home: gitHome,
      })).trim();
      if (gitlink.tree !== undefined && observedTree !== gitlink.tree) {
        workspaceFault("STALE", "source", `required gitlink tree drifted: ${gitlink.path}`);
      }
      const submoduleEntries = parseTree(await gitText({
        args: [`--git-dir=${gitDirectory}`, "ls-tree", "-r", "-z", gitlink.commit],
        cwd: repository,
        home: gitHome,
      }), gitlink.path);
      if (submoduleEntries.some(({ mode }) => mode === "160000")) {
        workspaceFault("FAIL", "source", `nested gitlink is not admitted: ${gitlink.path}`);
      }
      const submoduleRoot = join(sourceDirectory, ...gitlink.path.split("/"));
      await mkdir(submoduleRoot, { recursive: true, mode: 0o700 });
      const submoduleIndex = join(controlDirectory, `submodule-${index}.index`);
      const submoduleObjectsDirectory = await realpath(join(gitDirectory, "objects"));
      await gitText({
        args: [`--git-dir=${rawCheckoutGitDirectory}`, "read-tree", gitlink.commit],
        cwd: repository,
        home: gitHome,
        environmentOverrides: {
          GIT_ALTERNATE_OBJECT_DIRECTORIES: submoduleObjectsDirectory,
          GIT_INDEX_FILE: submoduleIndex,
        },
      });
      await gitText({
        args: [
          `--git-dir=${rawCheckoutGitDirectory}`,
          `--work-tree=${submoduleRoot}`,
          "checkout-index",
          "--all",
          "--force",
          `--prefix=${submoduleRoot}${sep}`,
        ],
        cwd: repository,
        home: gitHome,
        environmentOverrides: {
          GIT_ALTERNATE_OBJECT_DIRECTORIES: submoduleObjectsDirectory,
          GIT_INDEX_FILE: submoduleIndex,
        },
      });
      expectedEntries.push(...submoduleEntries);
      sealedRequired.push(Object.freeze({
        path: gitlink.path,
        commit: gitlink.commit,
        tree: observedTree,
        entryCount: submoduleEntries.length,
        manifestSha256: canonicalSha256(submoduleEntries),
      }));
    }
    expectedEntries.sort((left, right) => comparePortablePaths(left.path, right.path));
    if (new Set(expectedEntries.map(({ path }) => path)).size !== expectedEntries.length) {
      workspaceFault("FAIL", "source", "source object closure contains duplicate paths");
    }
    const manifest = await verifyMaterializedTree(sourceDirectory, expectedEntries);
    const symlinks = manifest.entries
      .filter(({ kind }) => kind === "symlink")
      .map(({ path, target, gitBlob }) => Object.freeze({ path, target, gitBlob }));
    const objectClosureSha256 = canonicalSha256({
      schema: sourceObjectClosureSchema,
      objectFormat: "sha1",
      commit,
      tree,
      requiredGitlinks: sealedRequired,
      excludedGitlinks,
      symlinks,
    });
    const acquisitionAfter = await verifyMaterializedTree(sourceDirectory, expectedEntries);
    if (
      acquisitionAfter.entryCount !== manifest.entryCount ||
      acquisitionAfter.totalBytes !== manifest.totalBytes ||
      acquisitionAfter.manifestSha256 !== manifest.manifestSha256
    ) {
      workspaceFault("FAIL", "source", "source snapshot changed during acquisition verification");
    }
    const snapshot = {
      schema: sourceSnapshotSchema,
      policy: "temporary-index-exact-git-object-closure/v1",
      sourceDirectory,
      commit,
      tree,
      cargoLock: {
        blob: cargoLockBlob,
        bytes: cargoLockBytes.length,
        sha256: sha256(cargoLockBytes),
        base64: cargoLockBytes.toString("base64"),
      },
      requiredGitlinks: sealedRequired,
      excludedGitlinks,
      symlinks,
      objectClosureSha256,
      entryCount: manifest.entryCount,
      totalBytes: manifest.totalBytes,
      manifestSha256: manifest.manifestSha256,
      beforeSha256: manifest.manifestSha256,
      afterSha256: acquisitionAfter.manifestSha256,
    };
    const frozenSnapshot = deepFreeze(snapshot);
    sourceSnapshotInternals.set(frozenSnapshot, Object.freeze({
      expectedEntries: Object.freeze([...expectedEntries]),
    }));
    return frozenSnapshot;
  } catch (error) {
    if (sourceDirectory !== undefined) {
      await rm(sourceDirectory, { recursive: true, force: true }).catch(() => {});
    }
    if (controlDirectory !== undefined) {
      await rm(controlDirectory, { recursive: true, force: true }).catch(() => {});
    }
    if (error instanceof G17NativeWorkspaceFault) throw error;
    workspaceFault("FAIL", "source", error.message, error);
  }
}

export function materializeG17SourceSnapshotForTesting(options) {
  return materializeSourceSnapshot(options);
}

export function productionG17RequiredGitlinks() {
  return productionRequiredGitlinks;
}
