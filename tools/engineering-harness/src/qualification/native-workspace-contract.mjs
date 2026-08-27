import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

export const G17_NATIVE_WORKSPACE_OWNER_ARTIFACT_NAME =
  "native-workspace-owner.json";
export const G17_NATIVE_WORKSPACE_ARTIFACT_NAME =
  G17_NATIVE_WORKSPACE_OWNER_ARTIFACT_NAME;
export const G17_NATIVE_WORKSPACE_OWNER_MAX_BYTES = 32 * 1024 * 1024;
export const G17_NATIVE_WORKSPACE_OWNER_SCHEMA =
  "oxigraph.g1.7-native-workspace-owner/v2";
export const G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA =
  "oxigraph.g1.7-native-workspace/v2";
export const G17_NATIVE_WORKSPACE_BINDING_SCHEMA =
  "oxigraph.g1.7-native-workspace-binding/v1";
export const G17_NATIVE_WORKSPACE_VERIFICATION_SCHEMA =
  "oxigraph.g1.7-native-workspace-verification/v2";

export const G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS = Object.freeze([
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

export const G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS = Object.freeze([
  Object.freeze({
    path: "bench/bsbm-tools",
    commit: "59d0a8a605b26f21506789fa1a713beb5abf1cab",
  }),
  Object.freeze({
    path: "cli/templates/yasgui",
    commit: "05a7ac428edeab35e40f66cafe0589ac9d224ee6",
  }),
  Object.freeze({
    path: "testsuite/N3",
    commit: "b975fc59ab5d2ad2d28e7206f1c34c716977d2ad",
  }),
  Object.freeze({
    path: "testsuite/json-ld-api",
    commit: "92f07705a0c0ac27aa9bc6fe1322dcc9fad0114d",
  }),
  Object.freeze({
    path: "testsuite/json-ld-streaming",
    commit: "64e6fea9eee3cf5d80468810552f50f6c487925f",
  }),
  Object.freeze({
    path: "testsuite/rdf-canon",
    commit: "15619df2fda7a4ca88308733789b6774517f9638",
  }),
  Object.freeze({
    path: "testsuite/rdf-tests",
    commit: "3d0b0613d0177d25aad7ec60e88df2338f461516",
  }),
]);

/*
 * Pure replay intentionally has no Git object database or filesystem bytes.
 * External commit/tree/lock anchors plus these exact root Git object identities
 * are source authority; counts and manifest digests remain bounded,
 * internally-consistent attestations minted by the live producer.
 */

const WORKSPACE_POLICY = "detached-committed-source-private-offline-vendor/v1";
const SOURCE_SCHEMA = "oxigraph.g1.7-source-snapshot/v1";
const SOURCE_POLICY = "temporary-index-exact-git-object-closure/v1";
const SOURCE_OBJECT_CLOSURE_SCHEMA =
  "oxigraph.g1.7-source-object-closure/v1";
const DEPENDENCY_SCHEMA = "oxigraph.g1.7-private-cargo-dependencies/v1";
const DEPENDENCY_POLICY = "lock-checksummed-archive-to-directory-source/v1";
const LOCKED_PACKAGE_SCHEMA = "oxigraph.g1.7-locked-registry-packages/v1";
const ARCHIVE_SCHEMA = "oxigraph.g1.7-registry-archive-set/v1";
const SPARSE_SCHEMA = "oxigraph.g1.7-sparse-bootstrap-set/v1";
const VENDOR_CHECKSUM_SCHEMA = "oxigraph.g1.7-vendor-checksum-set/v1";
const METADATA_SCHEMA = "oxigraph.g1.7-cargo-metadata-projection/v1";
const REGISTRY_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";
const REGISTRY_DIRECTORY = "index.crates.io-1949cf8c6b5b557f";

const MAX_OWNER_BYTES = G17_NATIVE_WORKSPACE_OWNER_MAX_BYTES;
const MAX_LOCK_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_ENTRIES = 200_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PACKAGES = 4_096;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_SPARSE_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_SPARSE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_VENDOR_ENTRIES = 200_000;
const MAX_VENDOR_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_PROJECTION_BYTES = 1024 * 1024;
const MAX_SPARSE_PROJECTION_BYTES = 1024 * 1024;
const MAX_VENDOR_CHECKSUM_PROJECTION_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_PROJECTION_BYTES = 1024 * 1024;
const CARGO_TIMEOUT_MS = 300_000;
const VENDOR_OUTPUT_BYTES = 1024 * 1024;
const METADATA_OUTPUT_BYTES = 16 * 1024 * 1024;

const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_CRATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const SAFE_CRATE_VERSION = /^[A-Za-z0-9.+-]+$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`G1.7 native workspace contract: ${message}`);
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
  if (
    value !== null &&
    typeof value === "object" &&
    !Buffer.isBuffer(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function safeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} is outside its safe integer bounds`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function gitObject(value, label) {
  if (!GIT_OBJECT.test(value ?? "")) fail(`${label} is not a Git SHA-1 object`);
  return value;
}

function comparePortable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        Buffer.byteLength(part, "utf8") > 255,
    )
  ) {
    fail(`${label} is not a confined portable relative path`);
  }
  return value;
}

function confinedLogicalPath(value, roots, label, { allowRoot = true } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    !value.startsWith("/") ||
    value.includes("//") ||
    value.split("/").slice(1).some(
      (part) => part.length === 0 || part === "." || part === ".." ||
        Buffer.byteLength(part, "utf8") > 255,
    )
  ) {
    fail(`${label} is not a canonical logical path`);
  }
  const matched = roots.some(
    (root) => value === root ? allowRoot : value.startsWith(`${root}/`),
  );
  if (!matched) fail(`${label} is outside its logical root allowlist`);
  return value;
}

function safeSymlinkTarget(path, target, label) {
  safeRelativePath(path, `${label} path`);
  if (
    typeof target !== "string" ||
    target.length === 0 ||
    Buffer.byteLength(target, "utf8") > 4_096 ||
    target.includes("\0") ||
    target.includes("\\") ||
    target.startsWith("/")
  ) {
    fail(`${label} target is not a confined relative target`);
  }
  const resolved = path.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) fail(`${label} target escapes the source root`);
      resolved.pop();
    } else {
      if (Buffer.byteLength(part, "utf8") > 255) {
        fail(`${label} target component exceeds its byte ceiling`);
      }
      resolved.push(part);
    }
  }
  return target;
}

function sortedUnique(records, identity, label) {
  const identities = records.map(identity);
  if (
    new Set(identities).size !== identities.length ||
    identities.some((value, index) => index > 0 && value <= identities[index - 1])
  ) {
    fail(`${label} is duplicated or not in canonical order`);
  }
}

function strictBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) {
    fail(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(`${label} is not canonical base64`);
  return bytes;
}

function canonicalBound(value, maximumBytes, label) {
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes > maximumBytes) fail(`${label} exceeds its canonical byte ceiling`);
  return { bytes, sha256: canonicalSha256(value) };
}

function expectedBinding(expected) {
  exactKeys(
    expected,
    [
      "subjectIdentitySha256",
      "subjectCommit",
      "subjectTree",
      "cargoLockBlob",
      "cargoLockSha256",
      "platformManifestSha256",
      "toolchainRootSha256",
      "toolchain",
    ],
    "expected workspace anchors",
  );
  exactKeys(expected.toolchain, ["cargo", "rustc"], "expected toolchain anchors");
  for (const program of ["cargo", "rustc"]) {
    exactKeys(
      expected.toolchain[program],
      ["executableSha256", "versionSha256"],
      `expected ${program} anchors`,
    );
    digest(
      expected.toolchain[program].executableSha256,
      `expected ${program} executable digest`,
    );
    digest(expected.toolchain[program].versionSha256, `expected ${program} version digest`);
  }
  digest(expected.subjectIdentitySha256, "expected subject identity digest");
  gitObject(expected.subjectCommit, "expected subject commit");
  gitObject(expected.subjectTree, "expected subject tree");
  gitObject(expected.cargoLockBlob, "expected Cargo.lock blob");
  digest(expected.cargoLockSha256, "expected Cargo.lock digest");
  digest(expected.platformManifestSha256, "expected platform manifest digest");
  digest(expected.toolchainRootSha256, "expected toolchain root digest");
  return {
    schema: G17_NATIVE_WORKSPACE_BINDING_SCHEMA,
    subjectIdentitySha256: expected.subjectIdentitySha256,
    subjectCommit: expected.subjectCommit,
    subjectTree: expected.subjectTree,
    cargoLockBlob: expected.cargoLockBlob,
    cargoLockSha256: expected.cargoLockSha256,
    platformManifestSha256: expected.platformManifestSha256,
    toolchainRootSha256: expected.toolchainRootSha256,
    toolchain: {
      cargo: {
        logicalPath: "/toolchain/bin/cargo",
        executableSha256: expected.toolchain.cargo.executableSha256,
        versionSha256: expected.toolchain.cargo.versionSha256,
      },
      rustc: {
        logicalPath: "/toolchain/bin/rustc",
        executableSha256: expected.toolchain.rustc.executableSha256,
        versionSha256: expected.toolchain.rustc.versionSha256,
      },
    },
  };
}

function validateBinding(binding, expected) {
  exactKeys(
    binding,
    [
      "schema",
      "subjectIdentitySha256",
      "subjectCommit",
      "subjectTree",
      "cargoLockBlob",
      "cargoLockSha256",
      "platformManifestSha256",
      "toolchainRootSha256",
      "toolchain",
    ],
    "workspace binding",
  );
  exactKeys(binding.toolchain, ["cargo", "rustc"], "workspace binding toolchain");
  for (const program of ["cargo", "rustc"]) {
    exactKeys(
      binding.toolchain[program],
      ["logicalPath", "executableSha256", "versionSha256"],
      `workspace binding ${program}`,
    );
  }
  const replayed = expectedBinding(expected);
  if (!isDeepStrictEqual(binding, replayed)) {
    fail("workspace binding differs from the external expected anchors");
  }
  return replayed;
}

function cargoLockRegistryPackages(bytes) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`source Cargo.lock is not UTF-8: ${error.message}`);
  }
  const sections = text.split(/^\[\[package\]\]\s*$/mu);
  const versionFields = [...sections[0].matchAll(/^version = ([0-9]+)$/gmu)];
  if (versionFields.length !== 1 || versionFields[0][1] !== "4") {
    fail("source Cargo.lock does not use exactly lock format version 4");
  }
  if (sections.length - 1 < 1 || sections.length - 1 > MAX_PACKAGES) {
    fail("source Cargo.lock package inventory is not bounded");
  }
  const packages = [];
  for (const block of sections.slice(1)) {
    const fields = (name) => [
      ...block.matchAll(new RegExp(`^${name} = "([^"\\\\]*)"$`, "gmu")),
    ].map((match) => match[1]);
    const names = fields("name");
    const versions = fields("version");
    const sources = fields("source");
    const checksums = fields("checksum");
    if (
      names.length !== 1 ||
      versions.length !== 1 ||
      sources.length > 1 ||
      checksums.length > 1
    ) {
      fail("source Cargo.lock package fields are ambiguous");
    }
    const [name] = names;
    const [version] = versions;
    const [source] = sources;
    if (source === undefined) continue;
    const [checksum] = checksums;
    if (
      source !== REGISTRY_SOURCE ||
      !SAFE_CRATE_NAME.test(name ?? "") ||
      !SAFE_CRATE_VERSION.test(version ?? "") ||
      !DIGEST.test(checksum ?? "")
    ) {
      fail("source Cargo.lock registry package is unsupported or malformed");
    }
    packages.push({ name, version, source, checksum });
    if (packages.length > MAX_PACKAGES) {
      fail("source Cargo.lock registry package inventory exceeds its ceiling");
    }
  }
  packages.sort((left, right) => comparePortable(
    `${left.name}\0${left.version}\0${left.source}`,
    `${right.name}\0${right.version}\0${right.source}`,
  ));
  sortedUnique(
    packages,
    (item) => `${item.name}\0${item.version}\0${item.source}`,
    "source Cargo.lock registry packages",
  );
  if (packages.length < 1) fail("source Cargo.lock has no registry package closure");
  return packages;
}

function validateCargoLock(value, binding) {
  exactKeys(value, ["blob", "bytes", "sha256", "base64"], "source Cargo.lock");
  gitObject(value.blob, "source Cargo.lock blob");
  digest(value.sha256, "source Cargo.lock digest");
  safeInteger(value.bytes, "source Cargo.lock bytes", {
    minimum: 1,
    maximum: MAX_LOCK_BYTES,
  });
  const bytes = strictBase64(value.base64, "source Cargo.lock base64");
  if (
    bytes.length !== value.bytes ||
    sha256(bytes) !== value.sha256 ||
    gitBlobSha1(bytes) !== value.blob ||
    value.blob !== binding.cargoLockBlob ||
    value.sha256 !== binding.cargoLockSha256
  ) {
    fail("source Cargo.lock does not replay to its Git and external bindings");
  }
  return { value, packages: cargoLockRegistryPackages(bytes) };
}

function validateGitlinks(value, label, { required }) {
  if (!Array.isArray(value) || value.length > MAX_PACKAGES) {
    fail(`${label} is not a bounded array`);
  }
  for (const [index, item] of value.entries()) {
    const keys = required
      ? ["path", "commit", "tree", "entryCount", "manifestSha256"]
      : ["path", "commit"];
    exactKeys(item, keys, `${label} ${index}`);
    safeRelativePath(item.path, `${label} ${index} path`);
    gitObject(item.commit, `${label} ${index} commit`);
    if (required) {
      gitObject(item.tree, `${label} ${index} tree`);
      safeInteger(item.entryCount, `${label} ${index} entry count`, {
        minimum: 1,
        maximum: MAX_SOURCE_ENTRIES,
      });
      digest(item.manifestSha256, `${label} ${index} manifest digest`);
    }
  }
  sortedUnique(value, (item) => item.path, label);
  return value;
}

function validateProductionGitlinkPolicy(source) {
  const required = source.requiredGitlinks.map(({ path, commit, tree }) => ({
    path,
    commit,
    tree,
  }));
  const excluded = source.excludedGitlinks.map(({ path, commit }) => ({
    path,
    commit,
  }));
  if (!isDeepStrictEqual(required, G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS)) {
    fail("required root Gitlink identities differ from the production source policy");
  }
  if (!isDeepStrictEqual(excluded, G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS)) {
    fail("excluded root Gitlink identities differ from the production source policy");
  }
}

function validateSymlinks(value) {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_ENTRIES) {
    fail("source symlink inventory is not bounded");
  }
  for (const [index, item] of value.entries()) {
    exactKeys(item, ["path", "target", "gitBlob"], `source symlink ${index}`);
    safeSymlinkTarget(item.path, item.target, `source symlink ${index}`);
    gitObject(item.gitBlob, `source symlink ${index} Git blob`);
    if (gitBlobSha1(Buffer.from(item.target, "utf8")) !== item.gitBlob) {
      fail(`source symlink ${index} target differs from its Git blob`);
    }
  }
  sortedUnique(value, (item) => item.path, "source symlink inventory");
  return value;
}

function validateSource(source, binding) {
  exactKeys(
    source,
    [
      "schema",
      "policy",
      "commit",
      "tree",
      "cargoLock",
      "requiredGitlinks",
      "excludedGitlinks",
      "symlinks",
      "objectClosureSha256",
      "entryCount",
      "totalBytes",
      "manifestSha256",
      "beforeSha256",
      "afterSha256",
    ],
    "workspace source",
  );
  if (
    source.schema !== SOURCE_SCHEMA ||
    source.policy !== SOURCE_POLICY ||
    source.commit !== binding.subjectCommit ||
    source.tree !== binding.subjectTree
  ) {
    fail("workspace source identity or policy differs from its binding");
  }
  gitObject(source.commit, "workspace source commit");
  gitObject(source.tree, "workspace source tree");
  const lock = validateCargoLock(source.cargoLock, binding);
  validateGitlinks(source.requiredGitlinks, "required gitlinks", { required: true });
  validateGitlinks(source.excludedGitlinks, "excluded gitlinks", { required: false });
  validateProductionGitlinkPolicy(source);
  validateSymlinks(source.symlinks);
  const admitted = new Set(source.requiredGitlinks.map(({ path }) => path));
  if (source.excludedGitlinks.some(({ path }) => admitted.has(path))) {
    fail("required and excluded gitlink paths overlap");
  }
  safeInteger(source.entryCount, "source entry count", {
    minimum: 1,
    maximum: MAX_SOURCE_ENTRIES,
  });
  safeInteger(source.totalBytes, "source total bytes", {
    minimum: 1,
    maximum: MAX_SOURCE_BYTES,
  });
  if (
    source.symlinks.length > source.entryCount ||
    source.requiredGitlinks.reduce((sum, item) => sum + item.entryCount, 0) >
      source.entryCount ||
    source.cargoLock.bytes > source.totalBytes
  ) {
    fail("source counts are contradictory");
  }
  for (const key of [
    "objectClosureSha256",
    "manifestSha256",
    "beforeSha256",
    "afterSha256",
  ]) {
    digest(source[key], `source ${key}`);
  }
  const objectClosureSha256 = canonicalSha256({
    schema: SOURCE_OBJECT_CLOSURE_SCHEMA,
    objectFormat: "sha1",
    commit: source.commit,
    tree: source.tree,
    requiredGitlinks: source.requiredGitlinks,
    excludedGitlinks: source.excludedGitlinks,
    symlinks: source.symlinks,
  });
  if (
    source.objectClosureSha256 !== objectClosureSha256 ||
    source.beforeSha256 !== source.manifestSha256 ||
    source.afterSha256 !== source.manifestSha256
  ) {
    fail("source closure or before/after manifest replay drifted");
  }
  return { source, lockedPackages: lock.packages };
}

function validatePackages(packages) {
  if (!Array.isArray(packages) || packages.length < 1 || packages.length > MAX_PACKAGES) {
    fail("dependency package inventory is not bounded");
  }
  for (const [index, item] of packages.entries()) {
    exactKeys(item, ["name", "version", "source", "checksum"], `package ${index}`);
    if (
      !SAFE_CRATE_NAME.test(item.name ?? "") ||
      !SAFE_CRATE_VERSION.test(item.version ?? "") ||
      item.source !== REGISTRY_SOURCE
    ) {
      fail(`package ${index} identity is invalid`);
    }
    digest(item.checksum, `package ${index} checksum`);
  }
  sortedUnique(
    packages,
    (item) => `${item.name}\0${item.version}\0${item.source}`,
    "dependency package inventory",
  );
  return packages;
}

function validateArchives(value, dependencies) {
  exactKeys(
    value,
    ["schema", "records", "count", "bytes", "serializedBytes", "sha256"],
    "registry archives",
  );
  if (!Array.isArray(value.records) || value.records.length !== dependencies.packages.length) {
    fail("registry archive inventory differs from the locked package inventory");
  }
  let bytes = 0;
  for (const [index, record] of value.records.entries()) {
    exactKeys(
      record,
      ["name", "version", "source", "lockChecksum", "archiveName", "bytes", "sha256"],
      `registry archive ${index}`,
    );
    const locked = dependencies.packages[index];
    safeInteger(record.bytes, `registry archive ${index} bytes`, {
      minimum: 1,
      maximum: MAX_ARCHIVE_BYTES,
    });
    digest(record.lockChecksum, `registry archive ${index} lock checksum`);
    digest(record.sha256, `registry archive ${index} digest`);
    if (
      record.name !== locked.name ||
      record.version !== locked.version ||
      record.source !== locked.source ||
      record.lockChecksum !== locked.checksum ||
      record.sha256 !== locked.checksum ||
      record.archiveName !== `${locked.name}-${locked.version}.crate`
    ) {
      fail(`registry archive ${index} differs from its locked package`);
    }
    bytes += record.bytes;
  }
  safeInteger(value.count, "registry archive count", { maximum: MAX_PACKAGES });
  safeInteger(value.bytes, "registry archive total bytes", {
    maximum: MAX_ARCHIVE_TOTAL_BYTES,
  });
  safeInteger(value.serializedBytes, "registry archive serialized bytes", {
    maximum: MAX_ARCHIVE_PROJECTION_BYTES,
  });
  digest(value.sha256, "registry archive set digest");
  const projection = {
    schema: ARCHIVE_SCHEMA,
    cargoLockSha256: dependencies.cargoLock.sha256,
    records: value.records,
  };
  const bound = canonicalBound(projection, MAX_ARCHIVE_PROJECTION_BYTES, "archive projection");
  if (
    value.schema !== ARCHIVE_SCHEMA ||
    value.count !== value.records.length ||
    value.bytes !== bytes ||
    value.serializedBytes !== bound.bytes ||
    value.sha256 !== bound.sha256
  ) {
    fail("registry archive projection replay drifted");
  }
  return value;
}

function sparseIndexPath(crateName) {
  const name = crateName.toLowerCase();
  if (name.length === 1) return `1/${name}`;
  if (name.length === 2) return `2/${name}`;
  if (name.length === 3) return `3/${name[0]}/${name}`;
  return `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`;
}

function validateSparse(value, packages) {
  exactKeys(
    value,
    [
      "schema",
      "records",
      "uniqueCrateCount",
      "bytes",
      "serializedBytes",
      "configSha256",
      "entriesSha256",
    ],
    "sparse bootstrap",
  );
  if (!Array.isArray(value.records) || value.records.length < 1 || value.records.length > MAX_PACKAGES) {
    fail("sparse bootstrap inventory is not bounded");
  }
  const crateNames = new Map();
  for (const { name } of packages) {
    const normalized = name.toLowerCase();
    const previous = crateNames.get(normalized);
    if (previous !== undefined && previous !== name) {
      fail("locked package names collide in the sparse index");
    }
    crateNames.set(normalized, name);
  }
  const expectedCrates = [...crateNames.values()].sort(comparePortable);
  let bytes = 0;
  for (const [index, record] of value.records.entries()) {
    exactKeys(record, ["crate", "path", "bytes", "sha256"], `sparse entry ${index}`);
    if (!SAFE_CRATE_NAME.test(record.crate ?? "")) fail(`sparse entry ${index} crate is invalid`);
    safeRelativePath(record.path, `sparse entry ${index} path`);
    safeInteger(record.bytes, `sparse entry ${index} bytes`, {
      minimum: 1,
      maximum: MAX_SPARSE_ENTRY_BYTES,
    });
    digest(record.sha256, `sparse entry ${index} digest`);
    if (record.path !== sparseIndexPath(record.crate)) {
      fail(`sparse entry ${index} path differs from its crate`);
    }
    bytes += record.bytes;
  }
  sortedUnique(value.records, (record) => record.crate, "sparse bootstrap inventory");
  if (!isDeepStrictEqual(value.records.map(({ crate }) => crate), expectedCrates)) {
    fail("sparse bootstrap crate set differs from locked packages");
  }
  safeInteger(value.uniqueCrateCount, "sparse unique crate count", { maximum: MAX_PACKAGES });
  safeInteger(value.bytes, "sparse total bytes", { maximum: MAX_SPARSE_TOTAL_BYTES });
  safeInteger(value.serializedBytes, "sparse serialized bytes", {
    maximum: MAX_SPARSE_PROJECTION_BYTES,
  });
  digest(value.configSha256, "sparse registry config digest");
  digest(value.entriesSha256, "sparse entry set digest");
  const projection = {
    schema: SPARSE_SCHEMA,
    registryDirectory: REGISTRY_DIRECTORY,
    configSha256: value.configSha256,
    records: value.records,
  };
  const bound = canonicalBound(projection, MAX_SPARSE_PROJECTION_BYTES, "sparse projection");
  if (
    value.schema !== SPARSE_SCHEMA ||
    value.uniqueCrateCount !== value.records.length ||
    value.bytes !== bytes ||
    value.serializedBytes !== bound.bytes ||
    value.entriesSha256 !== bound.sha256
  ) {
    fail("sparse bootstrap projection replay drifted");
  }
  return value;
}

function validateVendorChecksums(value, dependencies) {
  exactKeys(
    value,
    ["schema", "packageCount", "fileCount", "serializedBytes", "packages", "sha256"],
    "vendor checksum set",
  );
  if (!Array.isArray(value.packages) || value.packages.length !== dependencies.packages.length) {
    fail("vendor checksum packages differ from locked packages");
  }
  let fileCount = 0;
  for (const [index, item] of value.packages.entries()) {
    exactKeys(item, ["name", "version", "packageChecksum", "files"], `vendor package ${index}`);
    const locked = dependencies.packages[index];
    if (
      item.name !== locked.name ||
      item.version !== locked.version ||
      item.packageChecksum !== locked.checksum ||
      !Array.isArray(item.files)
    ) {
      fail(`vendor package ${index} differs from its locked package`);
    }
    digest(item.packageChecksum, `vendor package ${index} checksum`);
    for (const [fileIndex, file] of item.files.entries()) {
      exactKeys(file, ["path", "sha256"], `vendor package ${index} file ${fileIndex}`);
      safeRelativePath(file.path, `vendor package ${index} file ${fileIndex} path`);
      digest(file.sha256, `vendor package ${index} file ${fileIndex} digest`);
    }
    sortedUnique(item.files, (file) => file.path, `vendor package ${index} files`);
    fileCount += item.files.length;
  }
  safeInteger(value.packageCount, "vendor checksum package count", { maximum: MAX_PACKAGES });
  safeInteger(value.fileCount, "vendor checksum file count", { maximum: MAX_VENDOR_ENTRIES });
  safeInteger(value.serializedBytes, "vendor checksum serialized bytes", {
    maximum: MAX_VENDOR_CHECKSUM_PROJECTION_BYTES,
  });
  digest(value.sha256, "vendor checksum set digest");
  const projection = {
    schema: VENDOR_CHECKSUM_SCHEMA,
    cargoLockSha256: dependencies.cargoLock.sha256,
    packages: value.packages,
  };
  const bound = canonicalBound(
    projection,
    MAX_VENDOR_CHECKSUM_PROJECTION_BYTES,
    "vendor checksum projection",
  );
  if (
    value.schema !== VENDOR_CHECKSUM_SCHEMA ||
    value.packageCount !== value.packages.length ||
    value.fileCount !== fileCount ||
    value.serializedBytes !== bound.bytes ||
    value.sha256 !== bound.sha256
  ) {
    fail("vendor checksum projection replay drifted");
  }
  return value;
}

const EXPECTED_CARGO_ENVIRONMENT = Object.freeze({
  CARGO_HOME: "/control/bootstrap-cargo-home",
  CARGO_NET_OFFLINE: "true",
  CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
  CARGO_TERM_COLOR: "never",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/home",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  NO_COLOR: "1",
  PATH: "/toolchain/bin:/usr/bin:/bin",
  RUSTC: "/toolchain/bin/rustc",
  SOURCE_DATE_EPOCH: "946684800",
  TEMP: "/control/tmp",
  TERM: "dumb",
  TMP: "/control/tmp",
  TMPDIR: "/control/tmp",
});

const VENDOR_ARGV = Object.freeze([
  "vendor",
  "--locked",
  "--offline",
  "--versioned-dirs",
  "--color=never",
  "--manifest-path",
  "/workspace/Cargo.toml",
  "/cargo-home/vendor",
]);

const METADATA_ARGV = Object.freeze([
  "metadata",
  "--locked",
  "--offline",
  "--format-version",
  "1",
  "--manifest-path",
  "/workspace/Cargo.toml",
]);

function validateProcess(value, { argv, maxOutputBytes }, binding, label) {
  exactKeys(
    value,
    [
      "program",
      "argv",
      "cwd",
      "environment",
      "environmentSha256",
      "timeoutMs",
      "maxOutputBytes",
      "disposition",
      "exitCode",
      "signal",
      "durationMs",
      "stdoutBytes",
      "stderrBytes",
      "stdoutSha256",
      "stderrSha256",
    ],
    label,
  );
  exactKeys(value.environment, Object.keys(EXPECTED_CARGO_ENVIRONMENT), `${label} environment`);
  if (
    value.program !== binding.toolchain.cargo.logicalPath ||
    !isDeepStrictEqual(value.argv, argv) ||
    value.cwd !== "/workspace" ||
    !isDeepStrictEqual(value.environment, EXPECTED_CARGO_ENVIRONMENT) ||
    value.environment.RUSTC !== binding.toolchain.rustc.logicalPath ||
    value.environmentSha256 !== canonicalSha256(value.environment) ||
    value.timeoutMs !== CARGO_TIMEOUT_MS ||
    value.maxOutputBytes !== maxOutputBytes ||
    value.disposition !== "completed" ||
    value.exitCode !== 0 ||
    value.signal !== null
  ) {
    fail(`${label} differs from the exact offline Cargo process contract`);
  }
  confinedLogicalPath(value.program, ["/toolchain"], `${label} program`, { allowRoot: false });
  confinedLogicalPath(value.cwd, ["/workspace"], `${label} working directory`);
  for (const [index, argument] of value.argv.entries()) {
    if (argument.startsWith("/")) {
      confinedLogicalPath(
        argument,
        ["/workspace", "/cargo-home", "/control", "/state", "/home", "/toolchain"],
        `${label} argv ${index}`,
      );
    }
  }
  for (const [key, environmentValue] of Object.entries(value.environment)) {
    if (["CARGO_HOME", "HOME", "RUSTC", "TEMP", "TMP", "TMPDIR"].includes(key)) {
      confinedLogicalPath(
        environmentValue,
        ["/workspace", "/cargo-home", "/control", "/state", "/home", "/toolchain"],
        `${label} environment ${key}`,
      );
    }
  }
  safeInteger(value.durationMs, `${label} duration`, { maximum: CARGO_TIMEOUT_MS });
  safeInteger(value.stdoutBytes, `${label} stdout bytes`, { maximum: maxOutputBytes });
  safeInteger(value.stderrBytes, `${label} stderr bytes`, { maximum: maxOutputBytes });
  if (value.stdoutBytes + value.stderrBytes > maxOutputBytes) {
    fail(`${label} captured output exceeds its ceiling`);
  }
  digest(value.stdoutSha256, `${label} stdout digest`);
  digest(value.stderrSha256, `${label} stderr digest`);
  const emptyDigest = sha256(Buffer.alloc(0));
  if (
    (value.stdoutBytes === 0 && value.stdoutSha256 !== emptyDigest) ||
    (value.stderrBytes === 0 && value.stderrSha256 !== emptyDigest)
  ) {
    fail(`${label} empty output differs from the empty-stream digest`);
  }
  return value;
}

function validateMetadata(value, packages) {
  exactKeys(
    value,
    [
      "schema",
      "workspaceRoot",
      "targetDirectory",
      "packageCount",
      "registryPackageCount",
      "packages",
      "bytes",
      "sha256",
    ],
    "Cargo metadata projection",
  );
  if (!Array.isArray(value.packages) || value.packages.length < 1 || value.packages.length > MAX_PACKAGES) {
    fail("Cargo metadata package inventory is not bounded");
  }
  const registry = [];
  for (const [index, item] of value.packages.entries()) {
    exactKeys(item, ["name", "version", "source", "manifestPath"], `metadata package ${index}`);
    if (
      !SAFE_CRATE_NAME.test(item.name ?? "") ||
      !SAFE_CRATE_VERSION.test(item.version ?? "") ||
      ![null, REGISTRY_SOURCE].includes(item.source)
    ) {
      fail(`metadata package ${index} identity is invalid`);
    }
    if (item.source === null) {
      confinedLogicalPath(item.manifestPath, ["/workspace"], `metadata package ${index} manifest`, {
        allowRoot: false,
      });
    } else {
      confinedLogicalPath(
        item.manifestPath,
        ["/cargo-home/vendor"],
        `metadata package ${index} manifest`,
        { allowRoot: false },
      );
      registry.push(`${item.name}\0${item.version}`);
    }
  }
  sortedUnique(
    value.packages,
    (item) => `${item.source ?? "local"}\0${item.name}\0${item.version}\0${item.manifestPath}`,
    "Cargo metadata packages",
  );
  registry.sort(comparePortable);
  const expectedRegistry = packages
    .map(({ name, version }) => `${name}\0${version}`)
    .sort(comparePortable);
  const projection = {
    schema: METADATA_SCHEMA,
    workspaceRoot: "/workspace",
    targetDirectory: "/state/target",
    packageCount: value.packages.length,
    registryPackageCount: registry.length,
    packages: value.packages,
  };
  const bound = canonicalBound(projection, MAX_METADATA_PROJECTION_BYTES, "metadata projection");
  safeInteger(value.packageCount, "metadata package count", { maximum: MAX_PACKAGES });
  safeInteger(value.registryPackageCount, "metadata registry package count", {
    maximum: MAX_PACKAGES,
  });
  safeInteger(value.bytes, "metadata serialized bytes", { maximum: MAX_METADATA_PROJECTION_BYTES });
  digest(value.sha256, "metadata projection digest");
  if (
    value.schema !== METADATA_SCHEMA ||
    value.workspaceRoot !== "/workspace" ||
    value.targetDirectory !== "/state/target" ||
    !isDeepStrictEqual(registry, expectedRegistry) ||
    value.packageCount !== projection.packageCount ||
    value.registryPackageCount !== projection.registryPackageCount ||
    value.bytes !== bound.bytes ||
    value.sha256 !== bound.sha256
  ) {
    fail("Cargo metadata projection replay drifted");
  }
  return value;
}

function finalCargoConfigSha256() {
  const bytes = Buffer.from([
    "[build]",
    'target-dir = "/state/target"',
    "",
    "[net]",
    "offline = true",
    "",
    "[source.crates-io]",
    'replace-with = "g17-vendored-sources"',
    "",
    "[source.g17-vendored-sources]",
    'directory = "/cargo-home/vendor"',
    "",
  ].join("\n"), "utf8");
  return sha256(bytes);
}

function validateDependencies(dependencies, source, binding, lockedPackages) {
  exactKeys(
    dependencies,
    [
      "schema",
      "policy",
      "cargoLock",
      "registrySource",
      "registryDirectory",
      "packageCount",
      "packageSetSha256",
      "packages",
      "archives",
      "sparseBootstrap",
      "vendorChecksums",
      "vendorCommand",
      "metadataCommand",
      "metadata",
      "vendor",
      "finalConfigSha256",
      "snapshotSha256",
    ],
    "workspace dependencies",
  );
  if (
    dependencies.schema !== DEPENDENCY_SCHEMA ||
    dependencies.policy !== DEPENDENCY_POLICY ||
    dependencies.registrySource !== REGISTRY_SOURCE ||
    dependencies.registryDirectory !== REGISTRY_DIRECTORY
  ) {
    fail("workspace dependency policy or registry identity drifted");
  }
  exactKeys(dependencies.cargoLock, ["blob", "bytes", "sha256"], "dependency Cargo.lock");
  if (!isDeepStrictEqual(dependencies.cargoLock, {
    blob: source.cargoLock.blob,
    bytes: source.cargoLock.bytes,
    sha256: source.cargoLock.sha256,
  })) {
    fail("dependency Cargo.lock differs from the source snapshot");
  }
  if (
    dependencies.cargoLock.blob !== binding.cargoLockBlob ||
    dependencies.cargoLock.sha256 !== binding.cargoLockSha256
  ) {
    fail("dependency Cargo.lock differs from the workspace binding");
  }
  validatePackages(dependencies.packages);
  if (!isDeepStrictEqual(dependencies.packages, lockedPackages)) {
    fail("dependency packages differ from the externally bound Cargo.lock bytes");
  }
  safeInteger(dependencies.packageCount, "dependency package count", { maximum: MAX_PACKAGES });
  digest(dependencies.packageSetSha256, "dependency package set digest");
  if (
    dependencies.packageCount !== dependencies.packages.length ||
    dependencies.packageSetSha256 !== canonicalSha256({
      schema: LOCKED_PACKAGE_SCHEMA,
      packages: dependencies.packages,
    })
  ) {
    fail("dependency package-set replay drifted");
  }
  validateArchives(dependencies.archives, dependencies);
  validateSparse(dependencies.sparseBootstrap, dependencies.packages);
  validateVendorChecksums(dependencies.vendorChecksums, dependencies);
  validateProcess(
    dependencies.vendorCommand,
    { argv: VENDOR_ARGV, maxOutputBytes: VENDOR_OUTPUT_BYTES },
    binding,
    "Cargo vendor command",
  );
  validateProcess(
    dependencies.metadataCommand,
    { argv: METADATA_ARGV, maxOutputBytes: METADATA_OUTPUT_BYTES },
    binding,
    "Cargo metadata command",
  );
  validateMetadata(dependencies.metadata, dependencies.packages);
  exactKeys(
    dependencies.vendor,
    ["packageCount", "entryCount", "bytes", "beforeSha256", "afterSha256"],
    "vendor filesystem summary",
  );
  safeInteger(dependencies.vendor.packageCount, "vendor package count", { maximum: MAX_PACKAGES });
  safeInteger(dependencies.vendor.entryCount, "vendor entry count", {
    minimum: 1,
    maximum: MAX_VENDOR_ENTRIES,
  });
  safeInteger(dependencies.vendor.bytes, "vendor bytes", {
    minimum: 1,
    maximum: MAX_VENDOR_BYTES,
  });
  digest(dependencies.vendor.beforeSha256, "vendor before digest");
  digest(dependencies.vendor.afterSha256, "vendor after digest");
  if (
    dependencies.vendor.packageCount !== dependencies.packageCount ||
    dependencies.vendor.entryCount <
      dependencies.vendorChecksums.fileCount + dependencies.packageCount ||
    dependencies.vendor.beforeSha256 !== dependencies.vendor.afterSha256
  ) {
    fail("vendor filesystem summary is contradictory");
  }
  digest(dependencies.finalConfigSha256, "final Cargo config digest");
  if (dependencies.finalConfigSha256 !== finalCargoConfigSha256()) {
    fail("final Cargo config digest differs from the generated offline config");
  }
  digest(dependencies.snapshotSha256, "dependency snapshot digest");
  const base = {
    schema: dependencies.schema,
    policy: dependencies.policy,
    cargoLock: dependencies.cargoLock,
    registrySource: dependencies.registrySource,
    registryDirectory: dependencies.registryDirectory,
    packageCount: dependencies.packageCount,
    packageSetSha256: dependencies.packageSetSha256,
    packages: dependencies.packages,
    archives: dependencies.archives,
    sparseBootstrap: dependencies.sparseBootstrap,
    vendorChecksums: dependencies.vendorChecksums,
    vendorCommand: dependencies.vendorCommand,
    metadataCommand: dependencies.metadataCommand,
    metadata: dependencies.metadata,
    vendor: dependencies.vendor,
    finalConfigSha256: dependencies.finalConfigSha256,
  };
  if (dependencies.snapshotSha256 !== canonicalSha256(base)) {
    fail("dependency snapshot hash replay drifted");
  }
  return dependencies;
}

function sourceProjection(source) {
  return {
    policy: source.policy,
    commit: source.commit,
    tree: source.tree,
    cargoLockSha256: source.cargoLock.sha256,
    requiredGitlinks: source.requiredGitlinks,
    excludedGitlinks: source.excludedGitlinks,
    objectClosureSha256: source.objectClosureSha256,
    entryCount: source.entryCount,
    totalBytes: source.totalBytes,
    manifestSha256: source.manifestSha256,
  };
}

function dependencyProjection(dependencies) {
  return {
    schema: dependencies.schema,
    policy: dependencies.policy,
    packageCount: dependencies.packageCount,
    packageSetSha256: dependencies.packageSetSha256,
    archiveCount: dependencies.archives.count,
    archiveBytes: dependencies.archives.bytes,
    archiveSetSha256: dependencies.archives.sha256,
    sparseEntryCount: dependencies.sparseBootstrap.uniqueCrateCount,
    sparseEntrySetSha256: dependencies.sparseBootstrap.entriesSha256,
    vendorChecksumSetSha256: dependencies.vendorChecksums.sha256,
    vendorManifestSha256: dependencies.vendor.afterSha256,
    metadataProjectionSha256: dependencies.metadata.sha256,
    finalConfigSha256: dependencies.finalConfigSha256,
    snapshotSha256: dependencies.snapshotSha256,
  };
}

function validateVerification(value, source, dependencies, bindingSha256) {
  exactKeys(
    value,
    [
      "schema",
      "phase",
      "bindingSha256",
      "source",
      "vendor",
      "vendorChecksumSha256",
      "finalConfigSha256",
      "sha256",
    ],
    "workspace verification",
  );
  exactKeys(
    value.source,
    ["entryCount", "totalBytes", "beforeSha256", "afterSha256"],
    "workspace verification source",
  );
  exactKeys(
    value.vendor,
    ["packageCount", "entryCount", "bytes", "beforeSha256", "afterSha256"],
    "workspace verification vendor",
  );
  const expectedSource = {
    entryCount: source.entryCount,
    totalBytes: source.totalBytes,
    beforeSha256: source.beforeSha256,
    afterSha256: source.afterSha256,
  };
  const expectedVendor = { ...dependencies.vendor };
  const base = {
    schema: G17_NATIVE_WORKSPACE_VERIFICATION_SCHEMA,
    phase: "after-native",
    bindingSha256,
    source: expectedSource,
    vendor: expectedVendor,
    vendorChecksumSha256: dependencies.vendorChecksums.sha256,
    finalConfigSha256: dependencies.finalConfigSha256,
  };
  if (
    !isDeepStrictEqual(value, { ...base, sha256: canonicalSha256(base) })
  ) {
    fail("workspace verification replay drifted");
  }
  return value;
}

function validateProjection(value, binding, source, dependencies) {
  exactKeys(
    value,
    ["schema", "policy", "binding", "source", "dependencies", "sha256"],
    "workspace projection",
  );
  const base = {
    schema: G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA,
    policy: WORKSPACE_POLICY,
    binding,
    source: sourceProjection(source),
    dependencies: dependencyProjection(dependencies),
  };
  const expected = { ...base, sha256: canonicalSha256(base) };
  if (!isDeepStrictEqual(value, expected)) {
    fail("workspace projection does not independently replay from its owner");
  }
  return value;
}

function parseCanonicalOwner(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 2 ||
    bytes.length > MAX_OWNER_BYTES ||
    bytes.at(-1) !== 0x0a
  ) {
    fail("workspace owner artifact is not a newline-terminated bounded Buffer");
  }
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`workspace owner artifact is not UTF-8: ${error.message}`);
  }
  let owner;
  try {
    owner = JSON.parse(text);
  } catch (error) {
    fail(`workspace owner artifact is invalid JSON: ${error.message}`);
  }
  const canonical = Buffer.from(`${canonicalJson(owner)}\n`, "utf8");
  if (!bytes.equals(canonical)) fail("workspace owner artifact is not canonical JSON");
  return owner;
}

function immutableArtifact(bytes) {
  const sealed = Buffer.from(bytes);
  const artifact = {};
  Object.defineProperties(artifact, {
    name: { value: G17_NATIVE_WORKSPACE_OWNER_ARTIFACT_NAME, enumerable: true },
    bytes: {
      enumerable: true,
      get() {
        return Buffer.from(sealed);
      },
    },
    sha256: { value: sha256(sealed), enumerable: true },
  });
  return Object.freeze(artifact);
}

export function verifyG17NativeWorkspaceOwnerArtifact(input) {
  try {
    exactKeys(input, ["bytes", "expected"], "workspace owner verification input");
    const suppliedBytes = input.bytes;
    if (
      !Buffer.isBuffer(suppliedBytes) ||
      suppliedBytes.length < 2 ||
      suppliedBytes.length > MAX_OWNER_BYTES
    ) {
      fail("workspace owner artifact is not a newline-terminated bounded Buffer");
    }
    const artifactBytes = Buffer.from(suppliedBytes);
    const owner = parseCanonicalOwner(artifactBytes);
    exactKeys(
      owner,
      [
        "schema",
        "policy",
        "binding",
        "source",
        "dependencies",
        "verification",
        "projection",
        "sha256",
      ],
      "workspace owner",
    );
    if (
      owner.schema !== G17_NATIVE_WORKSPACE_OWNER_SCHEMA ||
      owner.policy !== WORKSPACE_POLICY
    ) {
      fail("workspace owner schema or policy drifted");
    }
    const binding = validateBinding(owner.binding, input.expected);
    const replayedSource = validateSource(owner.source, binding);
    const source = replayedSource.source;
    const dependencies = validateDependencies(
      owner.dependencies,
      source,
      binding,
      replayedSource.lockedPackages,
    );
    const bindingSha256 = canonicalSha256(binding);
    validateVerification(owner.verification, source, dependencies, bindingSha256);
    const projection = validateProjection(owner.projection, binding, source, dependencies);
    digest(owner.sha256, "workspace owner digest");
    const ownerBase = {
      schema: owner.schema,
      policy: owner.policy,
      binding: owner.binding,
      source: owner.source,
      dependencies: owner.dependencies,
      verification: owner.verification,
      projection: owner.projection,
    };
    if (owner.sha256 !== canonicalSha256(ownerBase)) {
      fail("workspace owner hash replay drifted");
    }
    deepFreeze(owner);
    const artifact = immutableArtifact(artifactBytes);
    return Object.freeze({ owner, projection: owner.projection, artifact });
  } catch (error) {
    if (error?.message?.startsWith("G1.7 native workspace contract:")) throw error;
    fail(error?.message ?? String(error));
  }
}
