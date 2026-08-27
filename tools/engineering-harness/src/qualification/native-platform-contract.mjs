import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

export const G17_NATIVE_PLATFORM_ARTIFACT_NAME =
  "linux-native-platform-closure.json";
export const G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME =
  "linux-native-isolation-policy.json";
export const G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME =
  "linux-native-isolation-instance.json";
export const G17_NATIVE_SESSION_ARTIFACT_NAME = "native-session.json";

export const G17_NATIVE_PLATFORM_SCHEMA =
  "oxigraph.g1.7-linux-native-platform-closure/v1";
export const G17_NATIVE_ISOLATION_POLICY_SCHEMA =
  "oxigraph.g1.7-linux-native-isolation-policy/v1";
export const G17_NATIVE_ISOLATION_INSTANCE_SCHEMA =
  "oxigraph.g1.7-linux-native-isolation-instance/v1";

const PROFILE = "linux-x86_64-gnu-bundled-rocksdb/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const MAX_PLATFORM_BYTES = 64 * 1024 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_INSTANCE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 250_000;
const MAX_ROLES = 64;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOOLCHAIN_BYTES = 1_610_612_736;
const MAX_PLATFORM_ROOT_BYTES = 2_684_354_560;
const MAX_COMBINED_BYTES = 4_294_967_296;
const MAX_ELF_NODES = 4_096;
const MAX_ELF_EDGES = 16_384;
const MAX_LINKER_SCRIPTS = 4_096;
const MAX_PATH_BYTES = 4_096;
const MAX_PROBES = 64;
const MAX_PROBE_OUTPUT_BYTES = 65_536;
const MAX_SYMLINK_DEPTH = 64;

export const G17_NATIVE_PLATFORM_REQUIRED_ROLES = Object.freeze([
  ["cargo", "toolchain", "bin/cargo", "file", /^bin\/cargo$/u],
  ["rustc", "toolchain", "bin/rustc", "file", /^bin\/rustc$/u],
  ["rustfmt", "toolchain", "bin/rustfmt", "file", /^bin\/rustfmt$/u],
  ["rustLibraries", "toolchain", "lib", "directory", /^lib$/u],
  [
    "rustTargetLibraries",
    "toolchain",
    "lib/rustlib/x86_64-unknown-linux-gnu",
    "directory",
    /^lib\/rustlib\/x86_64-unknown-linux-gnu$/u,
  ],
  ["cc", "platform", "usr/bin/x86_64-linux-gnu-gcc-13", "file", /^usr\/bin\/x86_64-linux-gnu-gcc-[0-9]+$/u],
  ["cxx", "platform", "usr/bin/x86_64-linux-gnu-g++-13", "file", /^usr\/bin\/x86_64-linux-gnu-g\+\+-[0-9]+$/u],
  ["ar", "platform", "usr/bin/x86_64-linux-gnu-ar", "file", /^usr\/bin\/x86_64-linux-gnu-ar$/u],
  ["as", "platform", "usr/bin/x86_64-linux-gnu-as", "file", /^usr\/bin\/x86_64-linux-gnu-as$/u],
  ["ld", "platform", "usr/bin/x86_64-linux-gnu-ld.bfd", "file", /^usr\/bin\/x86_64-linux-gnu-ld\.bfd$/u],
  ["nm", "platform", "usr/bin/x86_64-linux-gnu-nm", "file", /^usr\/bin\/x86_64-linux-gnu-nm$/u],
  ["cc1", "platform", "usr/libexec/gcc/x86_64-linux-gnu/13/cc1", "file", /^usr\/libexec\/gcc\/x86_64-linux-gnu\/[0-9]+\/cc1$/u],
  [
    "cc1plus",
    "platform",
    "usr/libexec/gcc/x86_64-linux-gnu/13/cc1plus",
    "file",
    /^usr\/libexec\/gcc\/x86_64-linux-gnu\/[0-9]+\/cc1plus$/u,
  ],
  [
    "collect2",
    "platform",
    "usr/libexec/gcc/x86_64-linux-gnu/13/collect2",
    "file",
    /^usr\/libexec\/gcc\/x86_64-linux-gnu\/[0-9]+\/collect2$/u,
  ],
  [
    "ltoWrapper",
    "platform",
    "usr/libexec/gcc/x86_64-linux-gnu/13/lto-wrapper",
    "file",
    /^usr\/libexec\/gcc\/x86_64-linux-gnu\/[0-9]+\/lto-wrapper$/u,
  ],
  ["lto1", "platform", "usr/libexec/gcc/x86_64-linux-gnu/13/lto1", "file", /^usr\/libexec\/gcc\/x86_64-linux-gnu\/[0-9]+\/lto1$/u],
  [
    "gccLibraries",
    "platform",
    "usr/lib/gcc/x86_64-linux-gnu/13",
    "directory",
    /^usr\/lib\/gcc\/x86_64-linux-gnu\/[0-9]+$/u,
  ],
  [
    "libltoPlugin",
    "platform",
    "usr/lib/gcc/x86_64-linux-gnu/13/liblto_plugin.so",
    "file",
    /^usr\/lib\/gcc\/x86_64-linux-gnu\/[0-9]+\/liblto_plugin\.so$/u,
  ],
  ["cHeaders", "platform", "usr/include", "directory", /^usr\/include$/u],
  ["cxxHeaders", "platform", "usr/include/c++/13", "directory", /^usr\/include\/c\+\+\/[0-9]+$/u],
  [
    "cxxTargetHeaders",
    "platform",
    "usr/include/x86_64-linux-gnu/c++/13",
    "directory",
    /^usr\/include\/x86_64-linux-gnu\/c\+\+\/[0-9]+$/u,
  ],
  [
    "clangHeaders",
    "platform",
    "usr/lib/llvm-18/lib/clang/18/include",
    "directory",
    /^usr\/lib\/llvm-[0-9]+\/lib\/clang\/[0-9]+(?:\.[0-9]+)*\/include$/u,
  ],
  [
    "libclang",
    "platform",
    "usr/lib/llvm-18/lib/libclang-18.so.1",
    "file",
    /^usr\/lib\/llvm-[0-9]+\/lib\/libclang(?:-[0-9]+)?\.so\.1$/u,
  ],
  ["node", "platform", "usr/bin/node", "file", /^usr\/bin\/node$/u],
  ["python", "platform", "usr/bin/python3.12", "file", /^usr\/bin\/python3\.[0-9]+$/u],
  ["pythonStdlib", "platform", "usr/lib/python3.12", "directory", /^usr\/lib\/python3\.[0-9]+$/u],
  ["setpriv", "platform", "usr/bin/setpriv", "file", /^usr\/bin\/setpriv$/u],
  ["mount", "platform", "usr/bin/mount", "file", /^usr\/bin\/mount$/u],
  ["true", "platform", "usr/bin/true", "file", /^usr\/bin\/true$/u],
  [
    "libseccomp",
    "platform",
    "lib/x86_64-linux-gnu/libseccomp.so.2",
    "file",
    /^(?:usr\/)?lib\/x86_64-linux-gnu\/libseccomp\.so\.2$/u,
  ],
  [
    "dynamicLoader",
    "platform",
    "lib64/ld-linux-x86-64.so.2",
    "file",
    /^lib64\/ld-linux-x86-64\.so\.2$/u,
  ],
].map(([id, root, fixturePath, kind, pathPattern]) =>
  Object.freeze({ id, root, fixturePath, kind, pathPattern })));

export const G17_NATIVE_PLATFORM_REQUIRED_PROBES = Object.freeze([
  "rust-version",
  "rust-target-libdir",
  "rust-cfg",
  "gcc-version",
  "gcc-target",
  "gcc-search-dirs",
  "gxx-version",
  "c-include-search",
  "cxx-include-search",
  "controller-node-version",
  "controller-python-version",
  "c-smoke",
  "cxx20-smoke",
  "archive-smoke",
  "libclang-bindgen-smoke",
  "rustfmt-smoke",
  "python-seccomp-smoke",
  "rust-link-smoke",
]);

const PLATFORM_LIMITS = Object.freeze({
  maxManifestBytes: MAX_PLATFORM_BYTES,
  maxEntries: MAX_ENTRIES,
  maxRoles: MAX_ROLES,
  maxFileBytes: MAX_FILE_BYTES,
  maxToolchainBytes: MAX_TOOLCHAIN_BYTES,
  maxPlatformBytes: MAX_PLATFORM_ROOT_BYTES,
  maxCombinedBytes: MAX_COMBINED_BYTES,
  maxElfNodes: MAX_ELF_NODES,
  maxElfEdges: MAX_ELF_EDGES,
  maxLinkerScripts: MAX_LINKER_SCRIPTS,
  maxPathBytes: MAX_PATH_BYTES,
  maxSymlinkDepth: MAX_SYMLINK_DEPTH,
  maxProbes: MAX_PROBES,
  maxProbeOutputBytes: MAX_PROBE_OUTPUT_BYTES,
});

function fail(message) {
  throw new Error(`G1.7 native platform contract: ${message}`);
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

function safeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum ||
    Object.is(value, -0)
  ) {
    fail(`${label} is not a bounded non-negative safe integer`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function nonempty(value, label, maximumBytes = MAX_PATH_BYTES) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    value.includes("\0")
  ) {
    fail(`${label} is not a bounded non-empty string`);
  }
  return value;
}

function safePath(value, label) {
  nonempty(value, label);
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    fail(`${label} is not a safe portable relative path`);
  }
  return value;
}

function logicalAbsolutePath(value, label) {
  nonempty(value, label);
  if (
    !value.startsWith("/") ||
    value.includes("\\") ||
    (value !== "/" &&
      value.split("/").slice(1).some((part) => part.length === 0 || part === "." || part === ".."))
  ) {
    fail(`${label} is not a safe logical absolute path`);
  }
  return value;
}

function canonicalArtifact(value, name, maximumBytes) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    fail(`${name} exceeds its byte ceiling`);
  }
  return Object.freeze({ name, bytes, sha256: sha256(bytes) });
}

function parseCanonical(bytes, label, maximumBytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumBytes) {
    fail(`${label} is not a bounded Buffer`);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail(`${label} is not canonical JSON`);
  }
  return value;
}

function compareIdentity(left, right) {
  const a = `${left.root}\0${left.path}`;
  const b = `${right.root}\0${right.path}`;
  return a < b ? -1 : a > b ? 1 : 0;
}

function entryIdentity(entry) {
  return `${entry.root}:${entry.path}`;
}

function directoryDigest(entries, root, path) {
  const prefix = `${path}/`;
  const descendants = entries
    .filter(
      (entry) =>
        entry.root === root &&
        entry.path.startsWith(prefix) &&
        entry.kind !== "directory",
    )
    .map(({ path: childPath, kind, mode, bytes, sha256: childSha256, target }) => ({
      path: childPath,
      kind,
      mode,
      bytes,
      sha256: childSha256,
      target,
    }));
  return canonicalSha256({
    schema: "oxigraph.g1.7-platform-subtree/v1",
    root,
    path,
    descendants,
  });
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    fail("platform entry inventory is not bounded");
  }
  let toolchainBytes = 0;
  let platformBytes = 0;
  const seen = new Set();
  const caseFolded = new Set();
  for (const [index, entry] of entries.entries()) {
    exactKeys(
      entry,
      ["root", "path", "kind", "mode", "bytes", "sha256", "target"],
      `platform entry ${index}`,
    );
    if (!["toolchain", "platform"].includes(entry.root)) {
      fail(`platform entry ${index} root is invalid`);
    }
    safePath(entry.path, `platform entry ${index} path`);
    if (!['file', 'directory', 'symlink'].includes(entry.kind)) {
      fail(`platform entry ${index} kind is invalid`);
    }
    const identity = entryIdentity(entry);
    if (seen.has(identity) || caseFolded.has(identity.toLowerCase())) {
      fail("platform entry inventory is duplicated or case-colliding");
    }
    seen.add(identity);
    caseFolded.add(identity.toLowerCase());
    if (
      index > 0 &&
      compareIdentity(entries[index - 1], entry) >= 0
    ) {
      fail("platform entry inventory is not strictly sorted");
    }
    if (entry.kind === "file") {
      if (
        !Number.isInteger(entry.mode) ||
        entry.mode < 0 ||
        entry.mode > 0o777 ||
        (entry.mode & 0o222) !== 0 ||
        entry.target !== null
      ) {
        fail(`platform file ${identity} has unsafe metadata`);
      }
      safeInteger(entry.bytes, `platform file ${identity} bytes`, MAX_FILE_BYTES);
      digest(entry.sha256, `platform file ${identity}`);
      if (entry.root === "toolchain") toolchainBytes += entry.bytes;
      else platformBytes += entry.bytes;
    } else if (entry.kind === "directory") {
      if (
        !Number.isInteger(entry.mode) ||
        entry.mode < 0 ||
        entry.mode > 0o777 ||
        (entry.mode & 0o222) !== 0 ||
        entry.bytes !== 0 ||
        entry.target !== null
      ) {
        fail(`platform directory ${identity} has unsafe metadata`);
      }
      digest(entry.sha256, `platform directory ${identity}`);
      if (entry.sha256 !== directoryDigest(entries, entry.root, entry.path)) {
        fail(`platform directory ${identity} subtree digest drifted`);
      }
    } else {
      if (
        entry.mode !== null ||
        entry.bytes !== null ||
        entry.sha256 !== null ||
        typeof entry.target !== "string"
      ) {
        fail(`platform symlink ${identity} has unsafe metadata`);
      }
      nonempty(entry.target, `platform symlink ${identity} target`);
    }
  }
  if (
    toolchainBytes > MAX_TOOLCHAIN_BYTES ||
    platformBytes > MAX_PLATFORM_ROOT_BYTES ||
    toolchainBytes + platformBytes > MAX_COMBINED_BYTES
  ) {
    fail("platform roots exceed their byte ceilings");
  }
  validateSymlinks(entries);
  return Object.freeze({ toolchainBytes, platformBytes });
}

function resolveSymlink(entriesById, entry) {
  let current = entry;
  const visited = new Set();
  for (let depth = 0; depth <= MAX_SYMLINK_DEPTH; depth += 1) {
    const identity = entryIdentity(current);
    if (visited.has(identity)) fail(`platform symlink cycle at ${identity}`);
    visited.add(identity);
    if (current.kind !== "symlink") return current;
    const targetPath = current.target.startsWith("/")
      ? current.target.slice(1)
      : posix.normalize(posix.join(posix.dirname(current.path), current.target));
    safePath(targetPath, `platform symlink ${identity} resolved target`);
    const next = entriesById.get(`${current.root}:${targetPath}`);
    if (next === undefined) fail(`platform symlink ${identity} target is absent`);
    current = next;
  }
  fail(`platform symlink chain exceeds depth ${MAX_SYMLINK_DEPTH}`);
}

function validateSymlinks(entries) {
  const entriesById = new Map(entries.map((entry) => [entryIdentity(entry), entry]));
  for (const entry of entries) {
    if (entry.kind === "symlink") resolveSymlink(entriesById, entry);
  }
}

function validateTarget(target) {
  exactKeys(
    target,
    [
      "os",
      "architecture",
      "abi",
      "rustTriple",
      "gccTriple",
      "elfClass",
      "elfData",
      "elfMachine",
      "dynamicLoader",
      "glibcVersion",
    ],
    "platform target",
  );
  if (
    target.os !== "linux" ||
    target.architecture !== "x86_64" ||
    target.abi !== "gnu" ||
    target.rustTriple !== "x86_64-unknown-linux-gnu" ||
    target.gccTriple !== "x86_64-linux-gnu" ||
    target.elfClass !== 64 ||
    target.elfData !== "little" ||
    target.elfMachine !== 62 ||
    target.dynamicLoader !== "lib64/ld-linux-x86-64.so.2" ||
    !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/u.test(target.glibcVersion)
  ) {
    fail("platform target is unsupported or malformed");
  }
}

function validateRoles(roles, entries) {
  plainObject(roles, "platform roles");
  const required = G17_NATIVE_PLATFORM_REQUIRED_ROLES;
  if (
    Object.keys(roles).length !== required.length ||
    Object.keys(roles).length > MAX_ROLES ||
    required.some(({ id }) => !Object.hasOwn(roles, id))
  ) {
    fail("platform role inventory is not exact");
  }
  const entriesById = new Map(entries.map((entry) => [entryIdentity(entry), entry]));
  for (const requiredRole of required) {
    const role = roles[requiredRole.id];
    exactKeys(
      role,
      ["root", "path", "kind", "resolvedPath", "sha256"],
      `platform role ${requiredRole.id}`,
    );
    if (
      role.root !== requiredRole.root ||
      role.kind !== requiredRole.kind ||
      !requiredRole.pathPattern.test(role.path)
    ) {
      fail(`platform role ${requiredRole.id} binding drifted`);
    }
    safePath(role.path, `platform role ${requiredRole.id} path`);
    safePath(role.resolvedPath, `platform role ${requiredRole.id} resolved path`);
    digest(role.sha256, `platform role ${requiredRole.id}`);
    const entry = entriesById.get(`${role.root}:${role.path}`);
    if (entry === undefined) fail(`platform role ${requiredRole.id} entry is absent`);
    const resolved = entry.kind === "symlink" ? resolveSymlink(entriesById, entry) : entry;
    if (
      resolved.path !== role.resolvedPath ||
      resolved.kind !== role.kind ||
      resolved.sha256 !== role.sha256
    ) {
      fail(`platform role ${requiredRole.id} resolution drifted`);
    }
  }
  const major = (value, pattern, label) => {
    const match = pattern.exec(value);
    if (match === null) fail(`${label} version is absent`);
    return match[1];
  };
  const gccVersions = [
    major(roles.cc.path, /gcc-([0-9]+)$/u, "GCC"),
    major(roles.cxx.path, /g\+\+-([0-9]+)$/u, "G++"),
    ...["cc1", "cc1plus", "collect2", "ltoWrapper", "lto1"].map((id) =>
      major(roles[id].path, /x86_64-linux-gnu\/([0-9]+)\//u, id)),
    major(roles.gccLibraries.path, /x86_64-linux-gnu\/([0-9]+)$/u, "GCC libraries"),
    major(roles.libltoPlugin.path, /x86_64-linux-gnu\/([0-9]+)\//u, "LTO plugin"),
    major(roles.cxxHeaders.path, /c\+\+\/([0-9]+)$/u, "C++ headers"),
    major(roles.cxxTargetHeaders.path, /c\+\+\/([0-9]+)$/u, "target C++ headers"),
  ];
  if (new Set(gccVersions).size !== 1) fail("GCC platform roles mix major versions");
  const llvmVersions = [
    major(roles.clangHeaders.path, /llvm-([0-9]+)\//u, "Clang headers"),
    major(roles.libclang.path, /llvm-([0-9]+)\//u, "libclang"),
  ];
  if (new Set(llvmVersions).size !== 1) fail("LLVM platform roles mix major versions");
  const pythonVersions = [
    major(roles.python.path, /python(3\.[0-9]+)$/u, "Python"),
    major(roles.pythonStdlib.path, /python(3\.[0-9]+)$/u, "Python standard library"),
  ];
  if (new Set(pythonVersions).size !== 1) fail("Python platform roles mix versions");
}

function strictStream(value, label) {
  exactKeys(value, ["bytes", "sha256", "base64"], label);
  safeInteger(value.bytes, `${label} bytes`, MAX_PROBE_OUTPUT_BYTES);
  digest(value.sha256, `${label} digest`);
  if (
    typeof value.base64 !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.base64)
  ) {
    fail(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value.base64, "base64");
  if (
    bytes.toString("base64") !== value.base64 ||
    bytes.length !== value.bytes ||
    sha256(bytes) !== value.sha256
  ) {
    fail(`${label} bytes differ from their digest binding`);
  }
  return bytes;
}

function validateStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0 || item.includes("\0"))
  ) {
    fail(`${label} must be a string array`);
  }
}

function validateProbes(probes) {
  if (
    !Array.isArray(probes) ||
    probes.length !== G17_NATIVE_PLATFORM_REQUIRED_PROBES.length ||
    probes.length > MAX_PROBES ||
    !isDeepStrictEqual(
      probes.map(({ id }) => id),
      G17_NATIVE_PLATFORM_REQUIRED_PROBES,
    )
  ) {
    fail("platform probe inventory is not exact");
  }
  for (const [index, probe] of probes.entries()) {
    exactKeys(
      probe,
      [
        "id",
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
        "stdout",
        "stderr",
        "parsed",
        "parsedSha256",
      ],
      `platform probe ${index}`,
    );
    if (!SAFE_ID.test(probe.id ?? "")) fail(`platform probe ${index} id is unsafe`);
    logicalAbsolutePath(probe.program, `platform probe ${probe.id} program`);
    validateStringArray(probe.argv, `platform probe ${probe.id} argv`);
    if (probe.argv[0] !== probe.program) fail(`platform probe ${probe.id} argv drifted`);
    logicalAbsolutePath(probe.cwd, `platform probe ${probe.id} cwd`);
    plainObject(probe.environment, `platform probe ${probe.id} environment`);
    if (
      Object.entries(probe.environment).some(
        ([name, value]) =>
          !/^[A-Z][A-Z0-9_]*$/u.test(name) ||
          typeof value !== "string" ||
          value.includes("\0"),
      ) ||
      canonicalSha256(probe.environment) !== probe.environmentSha256 ||
      probe.disposition !== "completed" ||
      probe.exitCode !== 0 ||
      probe.signal !== null
    ) {
      fail(`platform probe ${probe.id} did not complete under its exact environment`);
    }
    safeInteger(probe.timeoutMs, `platform probe ${probe.id} timeout`, 300_000);
    safeInteger(
      probe.maxOutputBytes,
      `platform probe ${probe.id} output ceiling`,
      MAX_PROBE_OUTPUT_BYTES,
    );
    safeInteger(probe.durationMs, `platform probe ${probe.id} duration`, probe.timeoutMs);
    const stdout = strictStream(probe.stdout, `platform probe ${probe.id} stdout`);
    const stderr = strictStream(probe.stderr, `platform probe ${probe.id} stderr`);
    if (stdout.length + stderr.length > probe.maxOutputBytes) {
      fail(`platform probe ${probe.id} output exceeds its ceiling`);
    }
    plainObject(probe.parsed, `platform probe ${probe.id} parsed result`);
    if (canonicalSha256(probe.parsed) !== probe.parsedSha256) {
      fail(`platform probe ${probe.id} parsed result digest drifted`);
    }
  }
}

function validateElfGraph(graph, entries, roles) {
  exactKeys(graph, ["nodes", "edges", "sha256"], "platform ELF graph");
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length < 1 ||
    graph.nodes.length > MAX_ELF_NODES ||
    !Array.isArray(graph.edges) ||
    graph.edges.length > MAX_ELF_EDGES
  ) {
    fail("platform ELF graph is not bounded");
  }
  const entriesById = new Map(entries.map((entry) => [entryIdentity(entry), entry]));
  const nodesById = new Map();
  for (const [index, node] of graph.nodes.entries()) {
    exactKeys(
      node,
      [
        "root",
        "path",
        "sha256",
        "elfClass",
        "elfData",
        "elfMachine",
        "interpreter",
        "soname",
        "needed",
        "rpath",
        "runpath",
      ],
      `platform ELF node ${index}`,
    );
    if (!["toolchain", "platform"].includes(node.root)) fail("ELF node root is invalid");
    safePath(node.path, `platform ELF node ${index} path`);
    digest(node.sha256, `platform ELF node ${index}`);
    if (
      node.elfClass !== 64 ||
      node.elfData !== "little" ||
      node.elfMachine !== 62 ||
      !(node.interpreter === null || typeof node.interpreter === "string") ||
      !(node.soname === null || typeof node.soname === "string")
    ) {
      fail(`platform ELF node ${index} target metadata drifted`);
    }
    for (const [value, label] of [
      [node.needed, "needed"],
      [node.rpath, "rpath"],
      [node.runpath, "runpath"],
    ]) validateStringArray(value, `platform ELF node ${index} ${label}`);
    const identity = entryIdentity(node);
    if (nodesById.has(identity)) fail("platform ELF node inventory is duplicated");
    const entry = entriesById.get(identity);
    if (entry?.kind !== "file" || entry.sha256 !== node.sha256) {
      fail(`platform ELF node ${identity} differs from its entry`);
    }
    nodesById.set(identity, node);
  }
  for (const role of G17_NATIVE_PLATFORM_REQUIRED_ROLES.filter(({ kind }) => kind === "file")) {
    const evidence = roles[role.id];
    if (!nodesById.has(`${evidence.root}:${evidence.resolvedPath}`)) {
      fail(`platform ELF graph omits executable/library role ${role.id}`);
    }
  }
  const edgeIds = new Set();
  for (const [index, edge] of graph.edges.entries()) {
    exactKeys(edge, ["from", "needed", "to"], `platform ELF edge ${index}`);
    nonempty(edge.from, `platform ELF edge ${index} source`);
    nonempty(edge.needed, `platform ELF edge ${index} needed name`);
    nonempty(edge.to, `platform ELF edge ${index} target`);
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      fail(`platform ELF edge ${index} references an absent node`);
    }
    const edgeId = `${edge.from}\0${edge.needed}\0${edge.to}`;
    if (edgeIds.has(edgeId)) fail("platform ELF edge inventory is duplicated");
    edgeIds.add(edgeId);
  }
  for (const [identity, node] of nodesById) {
    for (const needed of node.needed) {
      const matching = graph.edges.filter(
        (edge) => edge.from === identity && edge.needed === needed,
      );
      if (matching.length !== 1) {
        fail(`platform ELF dependency ${identity}/${needed} is unresolved or ambiguous`);
      }
    }
    if (node.interpreter !== null && !nodesById.has(node.interpreter)) {
      fail(`platform ELF interpreter for ${identity} is absent`);
    }
  }
  const base = { nodes: graph.nodes, edges: graph.edges };
  if (graph.sha256 !== canonicalSha256(base)) fail("platform ELF graph digest drifted");
}

function validateLinkerScripts(linkerScripts, entries) {
  exactKeys(
    linkerScripts,
    ["records", "sha256"],
    "platform linker-script closure",
  );
  if (
    !Array.isArray(linkerScripts.records) ||
    linkerScripts.records.length > MAX_LINKER_SCRIPTS
  ) {
    fail("platform linker-script inventory is not bounded");
  }
  const entriesById = new Map(entries.map((entry) => [entryIdentity(entry), entry]));
  const identities = new Set();
  for (const [index, record] of linkerScripts.records.entries()) {
    exactKeys(
      record,
      ["root", "path", "sha256", "directives", "inputs"],
      `platform linker script ${index}`,
    );
    if (!["toolchain", "platform"].includes(record.root)) {
      fail(`platform linker script ${index} root is invalid`);
    }
    safePath(record.path, `platform linker script ${index} path`);
    digest(record.sha256, `platform linker script ${index}`);
    validateStringArray(record.directives, `platform linker script ${index} directives`);
    validateStringArray(record.inputs, `platform linker script ${index} inputs`);
    const identity = entryIdentity(record);
    if (identities.has(identity)) fail("platform linker scripts are duplicated");
    identities.add(identity);
    const entry = entriesById.get(identity);
    if (entry?.kind !== "file" || entry.sha256 !== record.sha256) {
      fail(`platform linker script ${identity} differs from its entry`);
    }
    for (const input of record.inputs) {
      if (!entriesById.has(input)) {
        fail(`platform linker script ${identity} input is absent`);
      }
    }
  }
  if (
    linkerScripts.sha256 !==
      canonicalSha256({ records: linkerScripts.records })
  ) {
    fail("platform linker-script digest drifted");
  }
}

function platformBase(input) {
  plainObject(input, "platform closure input");
  exactKeys(
    input,
    ["profile", "target", "entries", "roles", "probes", "elfGraph", "linkerScripts"],
    "platform closure input",
  );
  return {
    schema: G17_NATIVE_PLATFORM_SCHEMA,
    profile: input.profile,
    target: input.target,
    limits: PLATFORM_LIMITS,
    entries: input.entries,
    roles: input.roles,
    probes: input.probes,
    elfGraph: {
      ...input.elfGraph,
      sha256: canonicalSha256(input.elfGraph),
    },
    linkerScripts: {
      ...input.linkerScripts,
      sha256: canonicalSha256(input.linkerScripts),
    },
  };
}

function bindPlatform(base) {
  const toolchainEntries = base.entries.filter(({ root }) => root === "toolchain");
  const platformEntries = base.entries.filter(({ root }) => root === "platform");
  const bound = {
    ...base,
    toolchainRootSha256: canonicalSha256({
      schema: "oxigraph.g1.7-linux-native-root/v1",
      root: "toolchain",
      entries: toolchainEntries,
    }),
    platformRootSha256: canonicalSha256({
      schema: "oxigraph.g1.7-linux-native-root/v1",
      root: "platform",
      entries: platformEntries,
    }),
    rolesSha256: canonicalSha256(base.roles),
    probesSha256: canonicalSha256(base.probes),
  };
  return { ...bound, manifestSha256: canonicalSha256(bound) };
}

function validatePlatform(value) {
  exactKeys(
    value,
    [
      "schema",
      "profile",
      "target",
      "limits",
      "entries",
      "roles",
      "probes",
      "elfGraph",
      "linkerScripts",
      "toolchainRootSha256",
      "platformRootSha256",
      "rolesSha256",
      "probesSha256",
      "manifestSha256",
    ],
    "platform closure",
  );
  if (
    value.schema !== G17_NATIVE_PLATFORM_SCHEMA ||
    value.profile !== PROFILE ||
    !isDeepStrictEqual(value.limits, PLATFORM_LIMITS)
  ) {
    fail("platform closure identity or limits drifted");
  }
  validateTarget(value.target);
  validateEntries(value.entries);
  validateRoles(value.roles, value.entries);
  validateProbes(value.probes);
  validateElfGraph(value.elfGraph, value.entries, value.roles);
  validateLinkerScripts(value.linkerScripts, value.entries);
  const expected = bindPlatform({
    schema: value.schema,
    profile: value.profile,
    target: value.target,
    limits: value.limits,
    entries: value.entries,
    roles: value.roles,
    probes: value.probes,
    elfGraph: value.elfGraph,
    linkerScripts: value.linkerScripts,
  });
  if (!isDeepStrictEqual(value, expected)) {
    fail("platform closure derived digests drifted");
  }
  return deepFreeze(value);
}

export function createG17NativePlatformClosureArtifact(input) {
  try {
    const closure = validatePlatform(bindPlatform(platformBase(input)));
    return Object.freeze({
      closure,
      artifact: canonicalArtifact(
        closure,
        G17_NATIVE_PLATFORM_ARTIFACT_NAME,
        MAX_PLATFORM_BYTES,
      ),
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native platform contract:")) throw error;
    fail(error.message);
  }
}

export function verifyG17NativePlatformClosureArtifact(bytes) {
  try {
    return validatePlatform(parseCanonical(bytes, "platform closure", MAX_PLATFORM_BYTES));
  } catch (error) {
    if (error.message.startsWith("G1.7 native platform contract:")) throw error;
    fail(error.message);
  }
}

const POLICY_BASE = Object.freeze({
  schema: G17_NATIVE_ISOLATION_POLICY_SCHEMA,
  profile: PROFILE,
  namespaces: Object.freeze(["user", "mount", "network", "pid", "ipc", "uts"]),
  identity: Object.freeze({ uid: 0, gid: 0 }),
  capabilities: Object.freeze({
    namespaceSetup: Object.freeze(["CAP_SYS_ADMIN", "CAP_SETPCAP"]),
    command: Object.freeze([]),
  }),
  network: "isolated",
  rootFilesystem: "empty-generated-closure-only/v1",
  mountPolicy: Object.freeze({
    hostSystemRootsForbidden: true,
    sourceReadOnly: true,
    cargoHomeReadOnly: true,
    toolchainReadOnly: true,
    platformReadOnly: true,
    stateSingleQuotaTmpfs: true,
    resultSingleFile: true,
  }),
  seccomp: Object.freeze({
    policy: "default-allow-deny-escalation/v1",
    assurance: "containment-hardening-not-complete-syscall-allowlist",
    denied: Object.freeze([
      "clone-newuser",
      "clone3",
      "fsconfig",
      "fsmount",
      "fsopen",
      "fspick",
      "mount",
      "mount_setattr",
      "move_mount",
      "open_tree",
      "pivot_root",
      "setns",
      "umount",
      "umount2",
      "unshare",
    ]),
  }),
  noNewPrivileges: true,
  parentDeathSignal: "SIGKILL",
  processGroups: Object.freeze({ detached: true, termThenKill: true, reapRequired: true }),
  quiescence: Object.freeze({ afterEveryCommand: true, finalProcScan: true }),
});

function expectedPolicy() {
  return deepFreeze({ ...POLICY_BASE, sha256: canonicalSha256(POLICY_BASE) });
}

export function createG17NativeIsolationPolicyArtifact() {
  const policy = expectedPolicy();
  return Object.freeze({
    policy,
    artifact: canonicalArtifact(
      policy,
      G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME,
      MAX_POLICY_BYTES,
    ),
  });
}

export function verifyG17NativeIsolationPolicyArtifact(bytes) {
  try {
    const policy = parseCanonical(bytes, "isolation policy", MAX_POLICY_BYTES);
    if (!isDeepStrictEqual(policy, expectedPolicy())) {
      fail("isolation policy differs from the frozen policy");
    }
    return deepFreeze(policy);
  } catch (error) {
    if (error.message.startsWith("G1.7 native platform contract:")) throw error;
    fail(error.message);
  }
}

function validateMounts(mounts) {
  const expected = Object.freeze([
    ["platform:usr", "/usr", "read-only"],
    ["platform:lib", "/lib", "read-only"],
    ["platform:lib64", "/lib64", "read-only"],
    ["toolchain:", "/toolchain", "read-only"],
    ["workspace:source", "/workspace", "read-only"],
    ["workspace:cargo-home", "/cargo-home", "read-only"],
    ["state:tmpfs", "/state", "read-write-quota"],
  ]);
  if (!Array.isArray(mounts) || mounts.length !== expected.length) {
    fail("isolation mount inventory is not exact");
  }
  for (const [index, mount] of mounts.entries()) {
    exactKeys(mount, ["source", "destination", "mode"], `isolation mount ${index}`);
    if (
      !isDeepStrictEqual(
        [mount.source, mount.destination, mount.mode],
        expected[index],
      ) ||
      mount.source.startsWith("/")
    ) {
      fail("isolation mount inventory includes ambient or drifted authority");
    }
  }
}

function logicalRolePath(role) {
  return role.root === "toolchain" ? `/toolchain/${role.resolvedPath}` : `/${role.resolvedPath}`;
}

function expectedEnvironment(platform, cargoBuildJobs) {
  const { roles } = platform;
  return {
    AR: logicalRolePath(roles.ar),
    CARGO_BUILD_JOBS: String(cargoBuildJobs),
    CARGO_HOME: "/cargo-home",
    CARGO_INCREMENTAL: "0",
    CARGO_NET_OFFLINE: "true",
    CARGO_PROFILE_TEST_DEBUG: "0",
    CARGO_TARGET_DIR: "/state/target",
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER: logicalRolePath(roles.cc),
    CARGO_TERM_COLOR: "never",
    CC: logicalRolePath(roles.cc),
    CXX: logicalRolePath(roles.cxx),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/state/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LD_LIBRARY_PATH: [
      "/toolchain/lib",
      posix.dirname(logicalRolePath(roles.libclang)),
      "/usr/lib/x86_64-linux-gnu",
      "/lib/x86_64-linux-gnu",
    ].join(":"),
    LIBCLANG_PATH: logicalRolePath(roles.libclang),
    LLVM_CONFIG_PATH: "/nonexistent",
    NO_COLOR: "1",
    PATH: "/toolchain/bin:/usr/bin",
    RUSTC: logicalRolePath(roles.rustc),
    RUSTFMT: logicalRolePath(roles.rustfmt),
    SOURCE_DATE_EPOCH: "946684800",
    TEMP: "/state/tmp",
    TERM: "dumb",
    TMP: "/state/tmp",
    TMPDIR: "/state/tmp",
    TZ: "UTC",
    USER: "sandbox",
  };
}

function validateCommands(commands, totalWallMs) {
  if (
    !Array.isArray(commands) ||
    commands.length < 2 ||
    commands.length > 64 ||
    commands.length % 2 !== 0
  ) {
    fail("isolation logical commands are not bounded pairs");
  }
  const lanes = new Set();
  for (const [index, command] of commands.entries()) {
    exactKeys(
      command,
      ["name", "argv", "timeoutMs", "maxOutputBytes"],
      `isolation command ${index}`,
    );
    const [phase, lane, ...extra] = command.name.split(":");
    const expectedPhase = index % 2 === 0 ? "inventory" : "execution";
    if (
      extra.length !== 0 ||
      phase !== expectedPhase ||
      !SAFE_ID.test(lane ?? "") ||
      (phase === "inventory" && lanes.has(lane)) ||
      (phase === "execution" && commands[index - 1]?.name !== `inventory:${lane}`)
    ) {
      fail("isolation logical command order drifted");
    }
    if (phase === "inventory") lanes.add(lane);
    validateStringArray(command.argv, `isolation command ${index} argv`);
    if (
      command.argv[0] !== "cargo" ||
      command.argv[1] !== "test" ||
      !command.argv.includes("--locked") ||
      !command.argv.includes("--offline") ||
      command.argv.filter((value) => value === "--target-dir").length !== 1 ||
      command.argv[command.argv.indexOf("--target-dir") + 1] !== "/state/target"
    ) {
      fail(`isolation command ${index} is not the frozen Cargo shape`);
    }
    safeInteger(command.timeoutMs, `isolation command ${index} timeout`, totalWallMs);
    safeInteger(
      command.maxOutputBytes,
      `isolation command ${index} output ceiling`,
      67_108_864,
    );
  }
}

function validateControllerTools(controllerTools) {
  const expected = ["systemd-run", "prlimit", "bwrap"];
  if (
    !Array.isArray(controllerTools) ||
    !isDeepStrictEqual(controllerTools.map(({ id }) => id), expected)
  ) {
    fail("isolation controller-tool inventory is not exact");
  }
  for (const [index, tool] of controllerTools.entries()) {
    exactKeys(
      tool,
      ["id", "executableSha256", "version", "dependencyClosureSha256"],
      `isolation controller tool ${index}`,
    );
    digest(tool.executableSha256, `isolation controller tool ${tool.id}`);
    digest(tool.dependencyClosureSha256, `isolation controller tool ${tool.id} closure`);
    strictStream(tool.version, `isolation controller tool ${tool.id} version`);
  }
}

function validateLimits(requested, effective) {
  exactKeys(
    requested,
    [
      "totalWallMs",
      "residentBytes",
      "diskBytes",
      "cargoBuildJobs",
      "tasksMax",
      "memorySwapBytes",
    ],
    "isolation requested limits",
  );
  if (
    !Number.isInteger(requested.totalWallMs) ||
    requested.totalWallMs < 1_000 ||
    requested.totalWallMs > 7_200_000 ||
    !Number.isSafeInteger(requested.residentBytes) ||
    requested.residentBytes < 268_435_456 ||
    requested.residentBytes > 68_719_476_736 ||
    !Number.isSafeInteger(requested.diskBytes) ||
    requested.diskBytes < 33_554_432 ||
    requested.diskBytes > 137_438_953_472 ||
    !Number.isInteger(requested.cargoBuildJobs) ||
    requested.cargoBuildJobs < 1 ||
    requested.cargoBuildJobs > 16 ||
    requested.tasksMax !== 512 ||
    requested.memorySwapBytes !== 0
  ) {
    fail("isolation requested limits are invalid");
  }
  exactKeys(
    effective,
    [
      "userNamespace",
      "mountNamespace",
      "networkNamespace",
      "pidNamespace",
      "ipcNamespace",
      "utsNamespace",
      "cgroupV2",
      "memoryMaxBytes",
      "memorySwapMaxBytes",
      "tasksMax",
      "fileSizeMaxBytes",
      "coreSizeMaxBytes",
      "finalDescendantsObserved",
    ],
    "isolation effective observations",
  );
  if (
    [
      "userNamespace",
      "mountNamespace",
      "networkNamespace",
      "pidNamespace",
      "ipcNamespace",
      "utsNamespace",
      "cgroupV2",
    ].some((key) => effective[key] !== true) ||
    effective.memoryMaxBytes !== requested.residentBytes ||
    effective.memorySwapMaxBytes !== requested.memorySwapBytes ||
    effective.tasksMax !== requested.tasksMax ||
    effective.fileSizeMaxBytes !== requested.diskBytes ||
    effective.coreSizeMaxBytes !== 0 ||
    effective.finalDescendantsObserved !== 0
  ) {
    fail("isolation effective observations do not prove the requested controls");
  }
}

function instanceBase(input) {
  exactKeys(
    input,
    [
      "runId",
      "policySha256",
      "platformManifestSha256",
      "workspaceProjectionSha256",
      "mounts",
      "environment",
      "logicalCommands",
      "controllerTools",
      "requestedLimits",
      "effectiveObservations",
      "resultArtifact",
    ],
    "isolation instance input",
  );
  return {
    schema: G17_NATIVE_ISOLATION_INSTANCE_SCHEMA,
    ...input,
    mountsSha256: canonicalSha256(input.mounts),
    environmentSha256: canonicalSha256(input.environment),
    logicalArgvSha256: canonicalSha256(input.logicalCommands),
    controllerToolsSha256: canonicalSha256(input.controllerTools),
  };
}

function bindInstance(base) {
  return { ...base, sha256: canonicalSha256(base) };
}

function validateInstance({ value, policy, platform, workspaceProjectionSha256 }) {
  exactKeys(
    value,
    [
      "schema",
      "runId",
      "policySha256",
      "platformManifestSha256",
      "workspaceProjectionSha256",
      "mounts",
      "mountsSha256",
      "environment",
      "environmentSha256",
      "logicalCommands",
      "logicalArgvSha256",
      "controllerTools",
      "controllerToolsSha256",
      "requestedLimits",
      "effectiveObservations",
      "resultArtifact",
      "sha256",
    ],
    "isolation instance",
  );
  if (
    value.schema !== G17_NATIVE_ISOLATION_INSTANCE_SCHEMA ||
    !SAFE_ID.test(value.runId ?? "") ||
    value.policySha256 !== policy?.sha256 ||
    value.platformManifestSha256 !== platform?.manifestSha256 ||
    value.workspaceProjectionSha256 !== workspaceProjectionSha256 ||
    !DIGEST.test(workspaceProjectionSha256 ?? "")
  ) {
    fail("isolation instance generation binding drifted");
  }
  if (!isDeepStrictEqual(policy, expectedPolicy())) {
    fail("isolation instance policy is not current");
  }
  validatePlatform(platform);
  validateMounts(value.mounts);
  if (value.mountsSha256 !== canonicalSha256(value.mounts)) {
    fail("isolation mount digest drifted");
  }
  if (
    !isDeepStrictEqual(
      value.environment,
      expectedEnvironment(platform, value.requestedLimits.cargoBuildJobs),
    ) ||
    value.environmentSha256 !== canonicalSha256(value.environment)
  ) {
    fail("isolation command environment drifted");
  }
  validateCommands(value.logicalCommands, value.requestedLimits.totalWallMs);
  if (value.logicalArgvSha256 !== canonicalSha256(value.logicalCommands)) {
    fail("isolation logical-command digest drifted");
  }
  validateControllerTools(value.controllerTools);
  if (value.controllerToolsSha256 !== canonicalSha256(value.controllerTools)) {
    fail("isolation controller-tool digest drifted");
  }
  validateLimits(value.requestedLimits, value.effectiveObservations);
  exactKeys(value.resultArtifact, ["name", "bytes", "sha256"], "session result artifact");
  if (
    value.resultArtifact.name !== G17_NATIVE_SESSION_ARTIFACT_NAME ||
    !Number.isSafeInteger(value.resultArtifact.bytes) ||
    value.resultArtifact.bytes < 1 ||
    value.resultArtifact.bytes > 268_435_456 ||
    !DIGEST.test(value.resultArtifact.sha256 ?? "")
  ) {
    fail("session result artifact reference is invalid");
  }
  const { sha256: observedSha256, ...base } = value;
  if (observedSha256 !== canonicalSha256(base)) {
    fail("isolation instance digest drifted");
  }
  return deepFreeze(value);
}

export function createG17NativeIsolationInstanceArtifact(input) {
  try {
    const policy = expectedPolicy();
    const platform = input?.platform;
    const baseInput = { ...input };
    delete baseInput.platform;
    const instance = validateInstance({
      value: bindInstance(instanceBase(baseInput)),
      policy,
      platform,
      workspaceProjectionSha256: input?.workspaceProjectionSha256,
    });
    return Object.freeze({
      instance,
      artifact: canonicalArtifact(
        instance,
        G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
        MAX_INSTANCE_BYTES,
      ),
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native platform contract:")) throw error;
    fail(error.message);
  }
}

export function verifyG17NativeIsolationInstanceArtifact({
  bytes,
  policy,
  platform,
  workspaceProjectionSha256,
}) {
  try {
    return validateInstance({
      value: parseCanonical(bytes, "isolation instance", MAX_INSTANCE_BYTES),
      policy,
      platform,
      workspaceProjectionSha256,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native platform contract:")) throw error;
    fail(error.message);
  }
}
