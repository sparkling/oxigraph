import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  createG17NativeSessionConfiguration,
  verifyG17NativeSessionArtifact,
} from "./native-session-contract.mjs";

export const G17_NATIVE_PLATFORM_ARTIFACT_NAME =
  "linux-native-platform-closure.json";
export const G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME =
  "linux-native-source-plan.json";
export const G17_NATIVE_CONTROLLER_ARTIFACT_NAME =
  "linux-native-controller-closure.json";
export const G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME =
  "linux-native-isolation-policy.json";
export const G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME =
  "linux-native-isolation-instance.json";
export const G17_NATIVE_SESSION_ARTIFACT_NAME = "native-session.json";

export const G17_NATIVE_PLATFORM_SCHEMA =
  "oxigraph.g1.7-linux-native-platform-closure/v4";
export const G17_NATIVE_SOURCE_PLAN_SCHEMA =
  "oxigraph.g1.7-native-platform-source-plan/v1";
export const G17_NATIVE_CONTROLLER_SCHEMA =
  "oxigraph.g1.7-native-controller-closure/v1";
export const G17_NATIVE_ISOLATION_POLICY_SCHEMA =
  "oxigraph.g1.7-linux-native-isolation-policy/v4";
export const G17_NATIVE_ISOLATION_INSTANCE_SCHEMA =
  "oxigraph.g1.7-linux-native-isolation-instance/v4";

const PROFILE = "linux-x86_64-gnu-bundled-rocksdb/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const MAX_PLATFORM_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_CONTROLLER_BYTES = 64 * 1024 * 1024;
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
const MAX_COMPONENT_BYTES = 255;
const MAX_PROBES = 64;
const MAX_PROBE_OUTPUT_BYTES = 65_536;
const MAX_CONTROLLER_OUTPUT_BYTES = 256 * 1024;
const MAX_SYMLINK_DEPTH = 64;
const PLATFORM_TOP_LEVEL_ROOTS = Object.freeze([
  "usr",
  "bin",
  "sbin",
  "lib",
  "lib64",
  "etc",
  "control",
  "proc",
  "dev",
  "runner",
  "result",
  "workspace",
  "cargo-home",
  "toolchain",
  "state",
  "tmp",
]);

const SOURCE_PLAN_SEEDS = Object.freeze([
  Object.freeze({ id: "rust-cargo", root: "toolchain", excludes: Object.freeze([]) }),
  Object.freeze({ id: "rust-rustc", root: "toolchain", excludes: Object.freeze([]) }),
  Object.freeze({ id: "rust-rustfmt", root: "toolchain", excludes: Object.freeze([]) }),
  Object.freeze({ id: "rust-libraries", root: "toolchain", excludes: Object.freeze([]) }),
  Object.freeze({
    id: "c-headers",
    root: "platform",
    excludes: Object.freeze(["x86_64-linux-gnu/mpi", "x86_64-linux-gnu/openmpi"]),
  }),
  Object.freeze({ id: "gcc-libraries", root: "platform", excludes: Object.freeze([]) }),
  Object.freeze({ id: "gcc-libexec", root: "platform", excludes: Object.freeze([]) }),
  Object.freeze({ id: "clang-headers", root: "platform", excludes: Object.freeze([]) }),
  Object.freeze({
    id: "python-stdlib",
    root: "platform",
    excludes: Object.freeze(["sitecustomize.py"]),
  }),
  ...[
    "cc",
    "cxx",
    "ar",
    "as",
    "ld",
    "nm",
    "ranlib",
    "node",
    "python",
    "setpriv",
    "mount",
    "true",
    "os-release",
    "contained-session-worker",
    "seccomp-launcher",
  ].map((id) => Object.freeze({ id, root: "platform", excludes: Object.freeze([]) })),
]);

const CONTROLLER_TOOL_IDS = Object.freeze([
  "systemd-run",
  "prlimit",
  "bwrap",
  "native-snapshot-helper",
  "contained-session-worker",
  "seccomp-launcher",
]);
const CONTROLLER_SYSTEM_TOOL_IDS = Object.freeze(CONTROLLER_TOOL_IDS.slice(0, 3));
const SNAPSHOT_HELPER_COMPILE_ARGS = Object.freeze([
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
]);

const PLATFORM_ROLE_DEFINITIONS = Object.freeze([
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
  ["ranlib", "platform", "usr/bin/x86_64-linux-gnu-ranlib", "file", /^usr\/bin\/x86_64-linux-gnu-ranlib$/u],
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

export const G17_NATIVE_PLATFORM_REQUIRED_ROLES = Object.freeze(
  PLATFORM_ROLE_DEFINITIONS.map(({ id, root, fixturePath, kind }) =>
    Object.freeze({ id, root, fixturePath, kind })),
);

const PLATFORM_ROLE_PATH_PATTERNS = new Map(
  PLATFORM_ROLE_DEFINITIONS.map(({ id, pathPattern }) => [id, pathPattern]),
);

const EXECUTABLE_PLATFORM_ROLES = new Set([
  "cargo",
  "rustc",
  "rustfmt",
  "cc",
  "cxx",
  "ar",
  "as",
  "ld",
  "nm",
  "ranlib",
  "cc1",
  "cc1plus",
  "collect2",
  "ltoWrapper",
  "lto1",
  "node",
  "python",
  "setpriv",
  "mount",
  "true",
  "dynamicLoader",
]);

function probeStream(text) {
  const bytes = Buffer.from(text, "utf8");
  return Object.freeze({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    base64: bytes.toString("base64"),
  });
}

function frozenProbeRecipe(id, role, args, stdin = "", productPaths = []) {
  return Object.freeze({
    id,
    role,
    args: Object.freeze(args),
    cwd: "/",
    timeoutMs: 30_000,
    maxOutputBytes: MAX_PROBE_OUTPUT_BYTES,
    stdin: probeStream(stdin),
    productPaths: Object.freeze(productPaths),
  });
}

const LIBCLANG_PROBE_SOURCE = [
  "import ctypes, os",
  "class CXString(ctypes.Structure):",
  "    _fields_ = [('data', ctypes.c_void_p), ('private_flags', ctypes.c_uint)]",
  "lib = ctypes.CDLL(os.environ['LIBCLANG_PATH'])",
  "lib.clang_getClangVersion.restype = CXString",
  "lib.clang_getCString.argtypes = [CXString]",
  "lib.clang_getCString.restype = ctypes.c_char_p",
  "value = lib.clang_getClangVersion()",
  "print(lib.clang_getCString(value).decode('utf-8'))",
  "lib.clang_disposeString(value)",
].join("\n");
const LIBSECCOMP_PROBE_SOURCE = [
  "import ctypes, os",
  "class Version(ctypes.Structure):",
  "    _fields_ = [('major', ctypes.c_uint), ('minor', ctypes.c_uint), ('micro', ctypes.c_uint)]",
  "lib = ctypes.CDLL('/lib/x86_64-linux-gnu/libseccomp.so.2')",
  "lib.seccomp_version.restype = ctypes.POINTER(Version)",
  "value = lib.seccomp_version().contents",
  "print(f'{value.major}.{value.minor}.{value.micro}')",
].join("\n");

export const G17_NATIVE_PLATFORM_PROBE_RECIPES = Object.freeze([
  frozenProbeRecipe("rust-version", "rustc", ["-vV"]),
  frozenProbeRecipe("cargo-version", "cargo", ["--version", "--verbose"]),
  frozenProbeRecipe("rustfmt-version", "rustfmt", ["--version"]),
  frozenProbeRecipe("rust-target-libdir", "rustc", ["--print", "target-libdir"]),
  frozenProbeRecipe("rust-cfg", "rustc", ["--print", "cfg"]),
  frozenProbeRecipe("gcc-version", "cc", ["--version"]),
  frozenProbeRecipe("gcc-target", "cc", ["-dumpmachine"]),
  frozenProbeRecipe("gcc-search-dirs", "cc", ["-print-search-dirs"]),
  frozenProbeRecipe("gxx-version", "cxx", ["--version"]),
  frozenProbeRecipe("binutils-version", "ld", ["--version"]),
  frozenProbeRecipe("c-include-search", "cc", ["-E", "-Wp,-v", "-xc", "-"]),
  frozenProbeRecipe("cxx-include-search", "cxx", ["-E", "-Wp,-v", "-xc++", "-"]),
  frozenProbeRecipe("controller-node-version", "node", ["--version"]),
  frozenProbeRecipe("controller-python-version", "python", ["--version"]),
  frozenProbeRecipe(
    "c-smoke",
    "cc",
    ["-std=c11", "-Werror", "-x", "c", "-", "-o", "/state/g17-c-smoke"],
    "int main(void) { return 0; }\n",
    ["/state/g17-c-smoke"],
  ),
  frozenProbeRecipe(
    "cxx20-smoke",
    "cxx",
    ["-std=c++20", "-Werror", "-x", "c++", "-", "-o", "/state/g17-cxx20-smoke"],
    "int main() { return 0; }\n",
    ["/state/g17-cxx20-smoke"],
  ),
  frozenProbeRecipe(
    "archive-smoke",
    "ar",
    ["crsD", "/state/g17-archive-smoke.a", "/state/g17-c-smoke"],
    "",
    ["/state/g17-archive-smoke.a"],
  ),
  frozenProbeRecipe(
    "libclang-bindgen-smoke",
    "python",
    ["-I", "-S", "-c", LIBCLANG_PROBE_SOURCE],
  ),
  frozenProbeRecipe(
    "rustfmt-smoke",
    "rustfmt",
    ["--check", "--edition", "2024"],
    "fn main() {\n    println!(\"ok\");\n}\n",
  ),
  frozenProbeRecipe(
    "python-seccomp-smoke",
    "python",
    ["-I", "-S", "-c", LIBSECCOMP_PROBE_SOURCE],
  ),
  frozenProbeRecipe(
    "rust-link-smoke",
    "rustc",
    [
      "-",
      "--crate-name",
      "g17_rust_link_smoke",
      "--edition",
      "2024",
      "-C",
      "debuginfo=0",
      "-o",
      "/state/g17-rust-link-smoke",
    ],
    "fn main() {}\n",
    ["/state/g17-rust-link-smoke"],
  ),
  frozenProbeRecipe("glibc-version", "dynamicLoader", ["--version"]),
]);

export const G17_NATIVE_PLATFORM_REQUIRED_PROBES = Object.freeze(
  G17_NATIVE_PLATFORM_PROBE_RECIPES.map(({ id }) => id),
);

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
  const parts = typeof value === "string" ? value.split("/") : [];
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        Buffer.byteLength(part, "utf8") > MAX_COMPONENT_BYTES,
    )
  ) {
    fail(`${label} is not a safe portable relative path`);
  }
  return value;
}

function logicalAbsolutePath(value, label) {
  nonempty(value, label);
  const parts = typeof value === "string" ? value.split("/").slice(1) : [];
  if (
    !value.startsWith("/") ||
    value.includes("\\") ||
    (value !== "/" &&
      parts.some(
        (part) =>
          part.length === 0 ||
          part === "." ||
          part === ".." ||
          Buffer.byteLength(part, "utf8") > MAX_COMPONENT_BYTES,
      ))
  ) {
    fail(`${label} is not a safe logical absolute path`);
  }
  return value;
}

function canonicalArtifact(value, name, maximumBytes) {
  const storedBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (storedBytes.length < 1 || storedBytes.length > maximumBytes) {
    fail(`${name} exceeds its byte ceiling`);
  }
  return Object.freeze({
    name,
    get bytes() {
      return Buffer.from(storedBytes);
    },
    sha256: sha256(storedBytes),
  });
}

function cloneCanonicalJson(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (error) {
    fail(`${label} is not canonical JSON data: ${error.message}`);
  }
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

function directoryDigest(root, path, children) {
  return canonicalSha256({
    schema: "oxigraph.g1.7-platform-directory/v2",
    root,
    path,
    children: children.map(
      ({ path: childPath, kind, mode, bytes, sha256: childSha256, target }) => ({
      path: childPath,
      kind,
      mode,
      bytes,
      sha256: childSha256,
      target,
      }),
    ),
  });
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ENTRIES) {
    fail("platform entry inventory is not bounded");
  }
  let toolchainBytes = 0;
  let platformBytes = 0;
  const seen = new Set();
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
    if (seen.has(identity)) fail(`platform entry inventory duplicates ${identity}`);
    seen.add(identity);
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
  const entriesById = new Map(entries.map((entry) => [entryIdentity(entry), entry]));
  const childrenByDirectory = new Map();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (
      entry.root === "platform" &&
      !PLATFORM_TOP_LEVEL_ROOTS.includes(parts[0])
    ) {
      fail(`platform entry ${entryIdentity(entry)} is outside mounted roots`);
    }
    for (let length = 1; length < parts.length; length += 1) {
      const ancestorPath = parts.slice(0, length).join("/");
      const ancestor = entriesById.get(`${entry.root}:${ancestorPath}`);
      if (ancestor?.kind !== "directory") {
        fail(`platform entry ${entryIdentity(entry)} has an absent or non-directory ancestor`);
      }
    }
    const parentPath = posix.dirname(entry.path);
    if (parentPath !== ".") {
      const parentIdentity = `${entry.root}:${parentPath}`;
      const children = childrenByDirectory.get(parentIdentity) ?? [];
      children.push(entry);
      childrenByDirectory.set(parentIdentity, children);
    }
  }
  for (const entry of entries.filter(({ kind }) => kind === "directory")) {
    if (
      entry.sha256 !==
      directoryDigest(
        entry.root,
        entry.path,
        childrenByDirectory.get(entryIdentity(entry)) ?? [],
      )
    ) {
      fail(`platform directory ${entryIdentity(entry)} child digest drifted`);
    }
  }
  validateSymlinks(entries);
  return Object.freeze({ toolchainBytes, platformBytes });
}

function resolvedSymlinkPath(entry, label) {
  if (!entry.target.startsWith("/")) {
    const targetPath = posix.normalize(
      posix.join(posix.dirname(entry.path), entry.target),
    );
    return safePath(targetPath, label);
  }
  if (
    entry.root === "platform" &&
    entry.path === "tmp" &&
    entry.target === "/state/tmp"
  ) {
    return "state/tmp";
  }
  if (entry.root === "toolchain") {
    if (!entry.target.startsWith("/toolchain/")) {
      fail(`${label} is outside the mounted toolchain root`);
    }
    return safePath(entry.target.slice("/toolchain/".length), label);
  }
  if (!/^\/(?:usr|bin|sbin|lib|lib64|etc)\//u.test(entry.target)) {
    fail(`${label} is outside the mounted platform roots`);
  }
  return safePath(entry.target.slice(1), label);
}

function resolveVirtualEntry(entriesById, initial) {
  let current = { root: initial.root, path: initial.path };
  const visited = new Set();
  for (let depth = 0; depth <= MAX_SYMLINK_DEPTH; depth += 1) {
    const identity = `${current.root}:${current.path}`;
    if (visited.has(identity)) fail(`platform symlink cycle at ${identity}`);
    visited.add(identity);
    const parts = current.path.split("/");
    let redirected = false;
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      const entry = entriesById.get(`${current.root}:${prefix}`);
      if (entry === undefined) {
        fail(`platform path ${identity} is absent at ${prefix}`);
      }
      if (entry.kind === "symlink") {
        const targetPath = resolvedSymlinkPath(
          entry,
          `platform symlink ${entryIdentity(entry)} resolved target`,
        );
        const remainder = parts.slice(length).join("/");
        current = {
          root: current.root,
          path: remainder.length === 0
            ? targetPath
            : posix.join(targetPath, remainder),
        };
        safePath(current.path, `platform symlink ${identity} continued target`);
        redirected = true;
        break;
      }
      if (length < parts.length && entry.kind !== "directory") {
        fail(`platform path ${identity} has a non-directory ancestor`);
      }
      if (length === parts.length) return entry;
    }
    if (!redirected) fail(`platform path ${identity} did not resolve`);
  }
  fail(`platform symlink chain exceeds depth ${MAX_SYMLINK_DEPTH}`);
}

function resolveSymlink(entriesById, entry) {
  return resolveVirtualEntry(entriesById, entry);
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
      !PLATFORM_ROLE_PATH_PATTERNS.get(requiredRole.id).test(role.path)
    ) {
      fail(`platform role ${requiredRole.id} binding drifted`);
    }
    safePath(role.path, `platform role ${requiredRole.id} path`);
    safePath(role.resolvedPath, `platform role ${requiredRole.id} resolved path`);
    digest(role.sha256, `platform role ${requiredRole.id}`);
    const resolved = resolveVirtualEntry(entriesById, role);
    if (
      resolved.path !== role.resolvedPath ||
      resolved.kind !== role.kind ||
      resolved.sha256 !== role.sha256 ||
      (resolved.kind === "directory" && (resolved.mode & 0o500) !== 0o500) ||
      (resolved.kind === "file" && (resolved.mode & 0o400) === 0) ||
      (EXECUTABLE_PLATFORM_ROLES.has(requiredRole.id) &&
        (resolved.mode & 0o100) === 0)
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
    major(roles.cc.resolvedPath, /gcc-([0-9]+)$/u, "GCC"),
    major(roles.cxx.resolvedPath, /g\+\+-([0-9]+)$/u, "G++"),
    ...["cc1", "cc1plus", "collect2", "ltoWrapper", "lto1"].map((id) =>
      major(roles[id].resolvedPath, /x86_64-linux-gnu\/([0-9]+)\//u, id)),
    major(roles.gccLibraries.resolvedPath, /x86_64-linux-gnu\/([0-9]+)$/u, "GCC libraries"),
    major(roles.libltoPlugin.resolvedPath, /x86_64-linux-gnu\/([0-9]+)\//u, "LTO plugin"),
    major(roles.cxxHeaders.resolvedPath, /c\+\+\/([0-9]+)$/u, "C++ headers"),
    major(roles.cxxTargetHeaders.resolvedPath, /c\+\+\/([0-9]+)$/u, "target C++ headers"),
  ];
  if (new Set(gccVersions).size !== 1) fail("GCC platform roles mix major versions");
  const llvmVersions = [
    major(roles.clangHeaders.resolvedPath, /llvm-([0-9]+)\//u, "Clang headers"),
    major(roles.libclang.path, /llvm-([0-9]+)\//u, "libclang"),
  ];
  if (new Set(llvmVersions).size !== 1) fail("LLVM platform roles mix major versions");
  const pythonVersions = [
    major(roles.python.resolvedPath, /python(3\.[0-9]+)$/u, "Python"),
    major(roles.pythonStdlib.resolvedPath, /python(3\.[0-9]+)$/u, "Python standard library"),
  ];
  if (new Set(pythonVersions).size !== 1) fail("Python platform roles mix versions");
}

function strictStream(value, label, maximumBytes = MAX_PROBE_OUTPUT_BYTES) {
  exactKeys(value, ["bytes", "sha256", "base64"], label);
  safeInteger(value.bytes, `${label} bytes`, maximumBytes);
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

function roleLogicalPath(role) {
  return role.root === "toolchain"
    ? `/toolchain/${role.path}`
    : `/${role.path}`;
}

function expectedProbeEnvironment(roles) {
  return {
    HOME: "/state/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LD_LIBRARY_PATH: [
      "/toolchain/lib",
      posix.dirname(roleLogicalPath(roles.libclang)),
      "/usr/lib/x86_64-linux-gnu",
      "/lib/x86_64-linux-gnu",
    ].join(":"),
    LIBCLANG_PATH: roleLogicalPath(roles.libclang),
    PATH: "/toolchain/bin:/usr/bin",
    TMPDIR: "/state/tmp",
    TZ: "UTC",
  };
}

export function g17NativePlatformProbeRecipes(roles) {
  plainObject(roles, "platform probe roles");
  const environment = expectedProbeEnvironment(roles);
  return deepFreeze(
    G17_NATIVE_PLATFORM_PROBE_RECIPES.map((recipe) => {
      const role = roles[recipe.role];
      if (role === undefined) {
        fail(`platform probe recipe role is absent: ${recipe.id}/${recipe.role}`);
      }
      const program = roleLogicalPath(role);
      return {
        id: recipe.id,
        role: recipe.role,
        program,
        argv: [program, ...recipe.args],
        cwd: recipe.cwd,
        environment: { ...environment },
        timeoutMs: recipe.timeoutMs,
        maxOutputBytes: recipe.maxOutputBytes,
        stdin: { ...recipe.stdin },
        productPaths: [...recipe.productPaths],
      };
    }),
  );
}

function strictUtf8(value, label, maximumBytes = MAX_PROBE_OUTPUT_BYTES) {
  const bytes = strictStream(value, label, maximumBytes);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    fail(`${label} is not exact UTF-8`);
  }
  return text;
}

function versionFact(text, pattern, label) {
  const match = pattern.exec(text);
  if (match === null) fail(`${label} does not contain a version`);
  return match[1];
}

function rustVersionFacts(text) {
  const fields = Object.fromEntries(
    text
      .split("\n")
      .map((line) => /^([^:]+): (.+)$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
  if (
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(fields.release ?? "") ||
    !/^[a-z0-9_]+(?:-[a-z0-9_]+){2,3}$/u.test(fields.host ?? "") ||
    !/^\d+\.\d+(?:\.\d+)?$/u.test(fields["LLVM version"] ?? "")
  ) {
    fail("rust-version probe output is malformed");
  }
  return {
    release: fields.release,
    host: fields.host,
    llvmVersion: fields["LLVM version"],
  };
}

function includeSearchFacts(text, label) {
  const lines = text.split("\n").map((line) => line.trim());
  const start = lines.indexOf("#include <...> search starts here:");
  const end = lines.indexOf("End of search list.");
  if (start < 0 || end <= start + 1) {
    fail(`${label} output omits its include-search boundaries`);
  }
  const paths = lines.slice(start + 1, end).filter((line) => !line.startsWith("("));
  if (
    paths.length < 1 ||
    paths.some((path) => {
      try {
        logicalAbsolutePath(path, `${label} include path`);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    fail(`${label} output contains an unsafe include path`);
  }
  return { paths };
}

function validateProducts(products, expectedPaths, label) {
  if (
    !Array.isArray(products) ||
    products.length !== expectedPaths.length ||
    !isDeepStrictEqual(products.map(({ path }) => path), expectedPaths)
  ) {
    fail(`${label} product inventory is not exact`);
  }
  for (const [index, product] of products.entries()) {
    exactKeys(product, ["path", "bytes", "sha256"], `${label} product ${index}`);
    logicalAbsolutePath(product.path, `${label} product ${index} path`);
    safeInteger(product.bytes, `${label} product ${index} bytes`, MAX_FILE_BYTES);
    if (product.bytes < 1) fail(`${label} product ${index} is empty`);
    digest(product.sha256, `${label} product ${index} digest`);
  }
}

export function replayG17NativePlatformProbe({
  id,
  stdout,
  stderr,
  products,
}) {
  const stdoutText = strictUtf8(stdout, `platform probe ${id} stdout`);
  const stderrText = strictUtf8(stderr, `platform probe ${id} stderr`);
  const recipe = G17_NATIVE_PLATFORM_PROBE_RECIPES.find(
    (candidate) => candidate.id === id,
  );
  if (recipe === undefined) fail(`platform probe ${id} is not registered`);
  validateProducts(products, recipe.productPaths, `platform probe ${id}`);
  let facts;
  switch (id) {
    case "rust-version":
      facts = rustVersionFacts(stdoutText);
      break;
    case "cargo-version": {
      const fields = Object.fromEntries(
        stdoutText
          .split("\n")
          .map((line) => /^([^:]+): (.+)$/u.exec(line))
          .filter((match) => match !== null)
          .map((match) => [match[1], match[2]]),
      );
      facts = {
        release: fields.release,
        host: fields.host,
      };
      if (
        !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(facts.release ?? "") ||
        !/^[a-z0-9_]+(?:-[a-z0-9_]+){2,3}$/u.test(facts.host ?? "")
      ) {
        fail("cargo-version probe output is malformed");
      }
      break;
    }
    case "rustfmt-version":
      facts = {
        version: versionFact(
          stdoutText,
          /^rustfmt (\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/u,
          id,
        ),
      };
      break;
    case "rust-target-libdir":
      facts = { path: stdoutText.trim() };
      logicalAbsolutePath(facts.path, "rust target libdir");
      break;
    case "rust-cfg": {
      const values = stdoutText.split("\n").filter(Boolean).sort();
      if (values.length < 3) fail("rust cfg probe output is incomplete");
      facts = { values };
      break;
    }
    case "gcc-version":
    case "gxx-version":
      facts = {
        version: versionFact(
          stdoutText,
          /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/u,
          id,
        ),
      };
      break;
    case "binutils-version":
      facts = {
        version: versionFact(
          stdoutText,
          /\b(\d+\.\d+(?:\.\d+)?)\b/u,
          id,
        ),
      };
      break;
    case "gcc-target":
      facts = { triple: stdoutText.trim() };
      break;
    case "gcc-search-dirs": {
      const lines = stdoutText.split("\n").map((line) => line.trim()).filter(Boolean);
      if (
        lines.length !== 3 ||
        !["install: ", "programs: ", "libraries: "].every((prefix, index) =>
          lines[index].startsWith(prefix))
      ) {
        fail("gcc search-directory output is malformed");
      }
      facts = { lines };
      break;
    }
    case "c-include-search":
    case "cxx-include-search":
      facts = includeSearchFacts(stderrText, id);
      break;
    case "controller-node-version":
      facts = {
        version: versionFact(stdoutText.trim(), /^v(\d+\.\d+\.\d+)$/u, id),
      };
      break;
    case "controller-python-version":
      facts = {
        version: versionFact(stdoutText.trim(), /^Python (\d+\.\d+\.\d+)$/u, id),
      };
      break;
    case "libclang-bindgen-smoke":
      facts = {
        version: versionFact(
          stdoutText,
          /(?:clang version |libclang[^0-9]*)(\d+\.\d+(?:\.\d+)?)/iu,
          id,
        ),
      };
      break;
    case "python-seccomp-smoke":
      facts = {
        version: versionFact(stdoutText.trim(), /^(\d+\.\d+\.\d+)$/u, id),
      };
      break;
    case "glibc-version":
      facts = {
        version: versionFact(stdoutText, /\b(\d+\.\d+(?:\.\d+)?)\b/u, id),
      };
      break;
    default:
      if (stdoutText.length !== 0 || stderrText.length !== 0) {
        fail(`platform smoke probe ${id} emitted unexpected output`);
      }
      facts = {
        status: "PASS",
        products: products.map(({ path, sha256: productSha256 }) => ({
          path,
          sha256: productSha256,
        })),
      };
      break;
  }
  return deepFreeze({
    schema: "oxigraph.g1.7-linux-native-probe-result/v2",
    id,
    facts,
  });
}

function validateStringArray(value, label, maximumItems = 4_096) {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length === 0 ||
        Buffer.byteLength(item, "utf8") > MAX_PATH_BYTES ||
        item.includes("\0"),
    )
  ) {
    fail(`${label} must be a string array`);
  }
}

function roleResolvedLogicalPath(role) {
  return role.root === "toolchain"
    ? `/toolchain/${role.resolvedPath}`
    : `/${role.resolvedPath}`;
}

function validateProbeCrossBindings(probes, target, entries, roles) {
  const facts = (id) => probes.find((probe) => probe.id === id).parsed.facts;
  const rust = facts("rust-version");
  const cargo = facts("cargo-version");
  if (
    rust.host !== target.rustTriple ||
    cargo.host !== target.rustTriple ||
    cargo.release !== rust.release
  ) {
    fail("Rust and Cargo probe versions or target triples are mixed");
  }
  const targetLibdir = facts("rust-target-libdir").path;
  const expectedTargetLibdir = `${roleResolvedLogicalPath(roles.rustTargetLibraries)}/lib`;
  const targetLibdirEntry = targetLibdir.startsWith("/toolchain/")
    ? `toolchain:${targetLibdir.slice("/toolchain/".length)}`
    : null;
  if (
    targetLibdir !== expectedTargetLibdir ||
    !entries.some(
      (entry) => entryIdentity(entry) === targetLibdirEntry && entry.kind === "directory",
    )
  ) {
    fail("Rust target library probe is not bound to the attested directory");
  }
  const cfg = new Set(facts("rust-cfg").values);
  if (
    !cfg.has('target_arch="x86_64"') ||
    !cfg.has('target_env="gnu"') ||
    !cfg.has('target_os="linux"')
  ) {
    fail("Rust cfg probe differs from the frozen target");
  }
  const gccVersion = facts("gcc-version").version;
  const gxxVersion = facts("gxx-version").version;
  const gccMajor = /^([0-9]+)\./u.exec(gccVersion)?.[1];
  const roleGccMajor = /gcc-([0-9]+)$/u.exec(roles.cc.resolvedPath)?.[1];
  if (
    gccMajor === undefined ||
    gccMajor !== /^([0-9]+)\./u.exec(gxxVersion)?.[1] ||
    gccMajor !== roleGccMajor ||
    facts("gcc-target").triple !== target.gccTriple
  ) {
    fail("GCC/G++ probe versions or target triple are mixed");
  }
  const searchText = facts("gcc-search-dirs").lines.join("\n");
  if (
    !searchText.includes(roleResolvedLogicalPath(roles.gccLibraries)) ||
    /(?:^|[:=])\/(?:home|tmp|opt|run)(?:\/|:|$)/u.test(searchText)
  ) {
    fail("GCC search directories are not closure-only");
  }
  const cIncludes = new Set(facts("c-include-search").paths);
  const cxxIncludes = new Set(facts("cxx-include-search").paths);
  if (
    !cIncludes.has(roleResolvedLogicalPath(roles.cHeaders)) ||
    !cxxIncludes.has(roleResolvedLogicalPath(roles.cHeaders)) ||
    !cxxIncludes.has(roleResolvedLogicalPath(roles.cxxHeaders)) ||
    !cxxIncludes.has(roleResolvedLogicalPath(roles.cxxTargetHeaders))
  ) {
    fail("C/C++ include probes omit required attested roots");
  }
  const pythonVersion = facts("controller-python-version").version;
  const pythonRoleVersion = /python(3\.[0-9]+)$/u.exec(roles.python.resolvedPath)?.[1];
  if (!pythonVersion.startsWith(`${pythonRoleVersion}.`)) {
    fail("Python probe version differs from its runtime and standard library");
  }
  const llvmMajor = /^([0-9]+)\./u.exec(
    facts("libclang-bindgen-smoke").version,
  )?.[1];
  const outerLlvmMajor = /llvm-([0-9]+)\//u.exec(roles.libclang.path)?.[1];
  const innerLlvmMajor = /\/clang\/([0-9]+)(?:\.|\/)/u.exec(
    roles.clangHeaders.resolvedPath,
  )?.[1];
  if (
    llvmMajor === undefined ||
    llvmMajor !== outerLlvmMajor ||
    llvmMajor !== innerLlvmMajor
  ) {
    fail("libclang probe and header/library versions are mixed");
  }
  if (facts("glibc-version").version !== target.glibcVersion) {
    fail("glibc loader probe differs from the frozen target");
  }
}

function validateProbes(probes, target, entries, roles) {
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
  const expectedRecipes = g17NativePlatformProbeRecipes(roles);
  for (const [index, probe] of probes.entries()) {
    const expected = expectedRecipes[index];
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
        "stdin",
        "products",
        "parsed",
        "parsedSha256",
      ],
      `platform probe ${index}`,
    );
    if (
      probe.id !== expected.id ||
      probe.program !== expected.program ||
      !isDeepStrictEqual(probe.argv, expected.argv) ||
      probe.cwd !== expected.cwd ||
      !isDeepStrictEqual(probe.environment, expected.environment) ||
      probe.timeoutMs !== expected.timeoutMs ||
      probe.maxOutputBytes !== expected.maxOutputBytes ||
      !isDeepStrictEqual(probe.stdin, expected.stdin)
    ) {
      fail(`platform probe ${probe.id} recipe drifted`);
    }
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
    strictStream(probe.stdin, `platform probe ${probe.id} stdin`);
    if (stdout.length + stderr.length > probe.maxOutputBytes) {
      fail(`platform probe ${probe.id} output exceeds its ceiling`);
    }
    const replayed = replayG17NativePlatformProbe({
      id: probe.id,
      stdout: probe.stdout,
      stderr: probe.stderr,
      products: probe.products,
    });
    if (
      !isDeepStrictEqual(probe.parsed, replayed) ||
      canonicalSha256(replayed) !== probe.parsedSha256
    ) {
      fail(`platform probe ${probe.id} parsed result digest drifted`);
    }
  }
  validateProbeCrossBindings(probes, target, entries, roles);
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
  let previousNodeIdentity = null;
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
    if (
      nodesById.has(identity) ||
      (previousNodeIdentity !== null && identity <= previousNodeIdentity)
    ) {
      fail("platform ELF node inventory is duplicated or not strictly ordered");
    }
    previousNodeIdentity = identity;
    const entry = entriesById.get(identity);
    if (entry?.kind !== "file" || entry.sha256 !== node.sha256) {
      fail(`platform ELF node ${identity} differs from its entry`);
    }
    nodesById.set(identity, node);
    for (const [paths, label] of [
      [node.rpath, "RPATH"],
      [node.runpath, "RUNPATH"],
    ]) {
      for (const path of paths) {
        if (
          path.includes("\0") ||
          /\$(?!\{?ORIGIN\}?)/u.test(path) ||
          (/^\//u.test(path) &&
            !/^\/(?:toolchain|usr|lib|lib64)(?:\/|$)/u.test(path))
        ) {
          fail(`platform ELF node ${identity} has unsafe ${label}`);
        }
      }
    }
  }
  for (const role of G17_NATIVE_PLATFORM_REQUIRED_ROLES.filter(({ kind }) => kind === "file")) {
    const evidence = roles[role.id];
    if (!nodesById.has(`${evidence.root}:${evidence.resolvedPath}`)) {
      fail(`platform ELF graph omits executable/library role ${role.id}`);
    }
  }
  const edgeIds = new Set();
  let previousEdgeIdentity = null;
  for (const [index, edge] of graph.edges.entries()) {
    exactKeys(edge, ["from", "needed", "to"], `platform ELF edge ${index}`);
    nonempty(edge.from, `platform ELF edge ${index} source`);
    nonempty(edge.needed, `platform ELF edge ${index} needed name`);
    nonempty(edge.to, `platform ELF edge ${index} target`);
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      fail(`platform ELF edge ${index} references an absent node`);
    }
    const edgeId = `${edge.from}\0${edge.needed}\0${edge.to}`;
    if (
      edgeIds.has(edgeId) ||
      (previousEdgeIdentity !== null && edgeId <= previousEdgeIdentity)
    ) {
      fail("platform ELF edge inventory is duplicated or not strictly ordered");
    }
    previousEdgeIdentity = edgeId;
    edgeIds.add(edgeId);
    const source = nodesById.get(edge.from);
    const target = nodesById.get(edge.to);
    if (
      !source.needed.includes(edge.needed) ||
      ![target.soname, posix.basename(target.path)].includes(edge.needed)
    ) {
      fail(`platform ELF edge ${index} does not bind one declared SONAME`);
    }
  }
  const reachable = new Set();
  const frontier = [];
  for (const role of G17_NATIVE_PLATFORM_REQUIRED_ROLES) {
    const evidence = roles[role.id];
    for (const identity of nodesById.keys()) {
      const [root, ...pathParts] = identity.split(":");
      const path = pathParts.join(":");
      if (
        root === evidence.root &&
        (path === evidence.resolvedPath ||
          (role.kind === "directory" && path.startsWith(`${evidence.resolvedPath}/`)))
      ) {
        frontier.push(identity);
      }
    }
  }
  while (frontier.length > 0) {
    const identity = frontier.pop();
    if (reachable.has(identity)) continue;
    reachable.add(identity);
    const node = nodesById.get(identity);
    if (node.interpreter !== null) frontier.push(node.interpreter);
    for (const edge of graph.edges) {
      if (edge.from === identity) frontier.push(edge.to);
    }
  }
  if (reachable.size !== nodesById.size) {
    fail("platform ELF graph contains unreachable extra nodes");
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
    [
      "profile",
      "subjectIdentitySha256",
      "sourcePlanSha256",
      "controllerAttestationSha256",
      "target",
      "entries",
      "roles",
      "probes",
      "elfGraph",
      "linkerScripts",
    ],
    "platform closure input",
  );
  return {
    schema: G17_NATIVE_PLATFORM_SCHEMA,
    profile: input.profile,
    subjectIdentitySha256: input.subjectIdentitySha256,
    sourcePlanSha256: input.sourcePlanSha256,
    controllerAttestationSha256: input.controllerAttestationSha256,
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
      "subjectIdentitySha256",
      "sourcePlanSha256",
      "controllerAttestationSha256",
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
    !DIGEST.test(value.subjectIdentitySha256 ?? "") ||
    !DIGEST.test(value.sourcePlanSha256 ?? "") ||
    !DIGEST.test(value.controllerAttestationSha256 ?? "") ||
    !isDeepStrictEqual(value.limits, PLATFORM_LIMITS)
  ) {
    fail("platform closure identity or limits drifted");
  }
  validateTarget(value.target);
  validateEntries(value.entries);
  validateRoles(value.roles, value.entries);
  validateProbes(value.probes, value.target, value.entries, value.roles);
  validateElfGraph(value.elfGraph, value.entries, value.roles);
  validateLinkerScripts(value.linkerScripts, value.entries);
  const expected = bindPlatform({
    schema: value.schema,
    profile: value.profile,
    subjectIdentitySha256: value.subjectIdentitySha256,
    sourcePlanSha256: value.sourcePlanSha256,
    controllerAttestationSha256: value.controllerAttestationSha256,
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
    const closure = validatePlatform(
      bindPlatform(platformBase(cloneCanonicalJson(input, "platform closure input"))),
    );
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

function positiveInteger(value, label, maximum) {
  safeInteger(value, label, maximum);
  if (value === 0) fail(`${label} must be positive`);
  return value;
}

function sourcePlanGeneration(path, pattern, label) {
  const match = pattern.exec(path ?? "");
  if (match === null) fail(`platform source plan ${label} generation is absent`);
  return match[1];
}

function validateSourcePlan(value, platform) {
  exactKeys(
    value,
    [
      "schema",
      "subjectIdentitySha256",
      "target",
      "generations",
      "seeds",
      "roles",
      "dependencySourcePrefixes",
    ],
    "platform source plan",
  );
  if (
    value.schema !== G17_NATIVE_SOURCE_PLAN_SCHEMA ||
    value.subjectIdentitySha256 !== platform.subjectIdentitySha256
  ) {
    fail("platform source plan identity drifted");
  }
  const { glibcVersion: ignoredGlibcVersion, ...expectedTarget } = platform.target;
  if (!isDeepStrictEqual(value.target, expectedTarget)) {
    fail("platform source plan target drifted");
  }
  exactKeys(
    value.generations,
    ["gccMajor", "llvmMajor", "pythonVersion"],
    "platform source plan generations",
  );
  const expectedGenerations = {
    gccMajor: sourcePlanGeneration(
      platform.roles.cc.path,
      /gcc-([0-9]+)$/u,
      "GCC",
    ),
    llvmMajor: sourcePlanGeneration(
      platform.roles.libclang.path,
      /llvm-([0-9]+)\//u,
      "LLVM",
    ),
    pythonVersion: sourcePlanGeneration(
      platform.roles.python.path,
      /(?:^|\/)(python3\.[0-9]+)$/u,
      "Python",
    ),
  };
  if (!isDeepStrictEqual(value.generations, expectedGenerations)) {
    fail("platform source plan generations drifted");
  }

  const expectedRoleIds = G17_NATIVE_PLATFORM_REQUIRED_ROLES.map(({ id }) => id);
  exactKeys(value.roles, expectedRoleIds, "platform source plan roles");
  for (const id of expectedRoleIds) {
    exactKeys(value.roles[id], ["root", "path"], `platform source plan role ${id}`);
    if (
      !isDeepStrictEqual(value.roles[id], {
        root: platform.roles[id].root,
        path: platform.roles[id].path,
      })
    ) {
      fail(`platform source plan role ${id} drifted`);
    }
  }

  if (
    !Array.isArray(value.seeds) ||
    value.seeds.length !== SOURCE_PLAN_SEEDS.length
  ) {
    fail("platform source plan seed inventory drifted");
  }
  const expectedSeedDestinations = {
    "rust-cargo": platform.roles.cargo.path,
    "rust-rustc": platform.roles.rustc.path,
    "rust-rustfmt": platform.roles.rustfmt.path,
    "rust-libraries": platform.roles.rustLibraries.path,
    "c-headers": platform.roles.cHeaders.path,
    "gcc-libraries": platform.roles.gccLibraries.path,
    "gcc-libexec": posix.dirname(platform.roles.cc1.path),
    "clang-headers": platform.roles.clangHeaders.path,
    "python-stdlib": platform.roles.pythonStdlib.path,
    cc: platform.roles.cc.path,
    cxx: platform.roles.cxx.path,
    ar: platform.roles.ar.path,
    as: platform.roles.as.path,
    ld: platform.roles.ld.path,
    nm: platform.roles.nm.path,
    ranlib: platform.roles.ranlib.path,
    node: platform.roles.node.path,
    python: platform.roles.python.path,
    setpriv: platform.roles.setpriv.path,
    mount: platform.roles.mount.path,
    true: platform.roles.true.path,
    "os-release": "usr/lib/os-release",
    "contained-session-worker": "runner/contained-session-worker.mjs",
    "seccomp-launcher": "runner/seccomp-launcher.py",
  };
  const entryIds = new Set(platform.entries.map(({ root, path }) => `${root}:${path}`));
  for (const [index, expected] of SOURCE_PLAN_SEEDS.entries()) {
    const seed = value.seeds[index];
    exactKeys(
      seed,
      ["id", "root", "destination", "excludes"],
      `platform source plan seed ${index}`,
    );
    safePath(seed.destination, `platform source plan seed ${index} destination`);
    validateStringArray(seed.excludes, `platform source plan seed ${index} excludes`, 16);
    for (const [excludeIndex, exclude] of seed.excludes.entries()) {
      safePath(exclude, `platform source plan seed ${index} exclude ${excludeIndex}`);
    }
    if (
      seed.id !== expected.id ||
      seed.root !== expected.root ||
      seed.destination !== expectedSeedDestinations[expected.id] ||
      !isDeepStrictEqual(seed.excludes, expected.excludes) ||
      !entryIds.has(`${seed.root}:${seed.destination}`)
    ) {
      fail(`platform source plan seed ${index} drifted`);
    }
  }

  const expectedPrefixes = [
    "toolchain:lib",
    "platform:usr/lib/x86_64-linux-gnu",
    `platform:usr/lib/llvm-${expectedGenerations.llvmMajor}/lib`,
    `platform:usr/lib/gcc/x86_64-linux-gnu/${expectedGenerations.gccMajor}`,
    `platform:usr/libexec/gcc/x86_64-linux-gnu/${expectedGenerations.gccMajor}`,
    "platform:usr/lib64",
  ];
  if (!isDeepStrictEqual(value.dependencySourcePrefixes, expectedPrefixes)) {
    fail("platform source plan dependency roots drifted");
  }
  return deepFreeze(value);
}

function validateSnapshotHelperIdentity(value) {
  exactKeys(
    value,
    ["device", "inode", "mode", "links", "size", "modifiedNs", "changedNs"],
    "snapshot helper executable identity",
  );
  for (const [key, field] of Object.entries(value)) {
    if (
      typeof field !== "string" ||
      field.length > 32 ||
      !/^(?:0|[1-9][0-9]*)$/u.test(field)
    ) {
      fail(`snapshot helper executable identity ${key} is invalid`);
    }
  }
}

function validateSnapshotHelperAttestation(value) {
  exactKeys(
    value,
    ["schema", "source", "compiler", "compile", "executable", "sha256"],
    "snapshot helper attestation",
  );
  if (value.schema !== "oxigraph.g1.7-native-snapshot-helper/v2") {
    fail("snapshot helper attestation schema drifted");
  }
  exactKeys(value.source, ["bytes", "sha256"], "snapshot helper source");
  positiveInteger(value.source.bytes, "snapshot helper source bytes", 1024 * 1024);
  digest(value.source.sha256, "snapshot helper source digest");

  exactKeys(
    value.compiler,
    ["path", "executableSha256", "version"],
    "snapshot helper compiler",
  );
  logicalAbsolutePath(value.compiler.path, "snapshot helper compiler path");
  if (!/^\/usr\/bin\/x86_64-linux-gnu-gcc-[0-9]+$/u.test(value.compiler.path)) {
    fail("snapshot helper compiler path is outside the reviewed family");
  }
  digest(value.compiler.executableSha256, "snapshot helper compiler digest");
  if (
    strictUtf8(
      value.compiler.version,
      "snapshot helper compiler version",
      MAX_CONTROLLER_OUTPUT_BYTES,
    ).length === 0
  ) {
    fail("snapshot helper compiler version is empty");
  }

  exactKeys(value.compile, ["argv", "stdout", "stderr"], "snapshot helper compile");
  if (
    !isDeepStrictEqual(value.compile.argv, [
      value.compiler.path,
      ...SNAPSHOT_HELPER_COMPILE_ARGS,
    ])
  ) {
    fail("snapshot helper compile recipe drifted");
  }
  strictStream(
    value.compile.stdout,
    "snapshot helper compile stdout",
    MAX_CONTROLLER_OUTPUT_BYTES,
  );
  strictStream(
    value.compile.stderr,
    "snapshot helper compile stderr",
    MAX_CONTROLLER_OUTPUT_BYTES,
  );

  exactKeys(
    value.executable,
    ["bytes", "sha256", "identity"],
    "snapshot helper executable",
  );
  positiveInteger(
    value.executable.bytes,
    "snapshot helper executable bytes",
    4 * 1024 * 1024,
  );
  digest(value.executable.sha256, "snapshot helper executable digest");
  validateSnapshotHelperIdentity(value.executable.identity);
  const executableMode = BigInt(value.executable.identity.mode);
  if (
    value.executable.identity.size !== String(value.executable.bytes) ||
    value.executable.identity.links !== "1" ||
    executableMode > 0o177777n ||
    (executableMode & 0o170000n) !== 0o100000n ||
    (executableMode & 0o500n) !== 0o500n ||
    (executableMode & 0o222n) !== 0n
  ) {
    fail("snapshot helper executable identity drifted");
  }
  const { sha256: attestationSha256, ...binding } = value;
  if (attestationSha256 !== canonicalSha256(binding)) {
    fail("snapshot helper attestation digest drifted");
  }
  return value;
}

function validateControllerClosure(value, id) {
  exactKeys(value, ["records", "sha256"], `controller ${id} dependency closure`);
  if (!Array.isArray(value.records) || value.records.length < 1 || value.records.length > 256) {
    fail(`controller ${id} dependency closure is not bounded`);
  }
  let previousPath = null;
  for (const [index, record] of value.records.entries()) {
    exactKeys(
      record,
      ["path", "bytes", "sha256", "soname", "needed"],
      `controller ${id} dependency ${index}`,
    );
    logicalAbsolutePath(record.path, `controller ${id} dependency ${index} path`);
    if (
      !/^\/(?:usr\/(?:bin|lib(?:64)?|lib\/systemd)|lib(?:64)?)(?:\/|$)/u.test(record.path) ||
      (previousPath !== null && previousPath >= record.path)
    ) {
      fail(`controller ${id} dependency paths drifted`);
    }
    previousPath = record.path;
    positiveInteger(
      record.bytes,
      `controller ${id} dependency ${index} bytes`,
      MAX_FILE_BYTES,
    );
    digest(record.sha256, `controller ${id} dependency ${index} digest`);
    if (
      record.soname !== null &&
      (typeof record.soname !== "string" || record.soname.length === 0 || record.soname.includes("/"))
    ) {
      fail(`controller ${id} dependency ${index} SONAME is invalid`);
    }
    validateStringArray(record.needed, `controller ${id} dependency ${index} needed`, 256);
  }
  if (value.sha256 !== canonicalSha256(value.records)) {
    fail(`controller ${id} dependency closure digest drifted`);
  }
  const representedNames = new Set(
    value.records.flatMap((record) =>
      record.soname === null
        ? [posix.basename(record.path)]
        : [posix.basename(record.path), record.soname]),
  );
  for (const record of value.records) {
    for (const needed of record.needed) {
      if (!representedNames.has(needed)) {
        fail(`controller ${id} dependency ${needed} is not represented`);
      }
    }
  }
  return value;
}

function validateController(value, platform) {
  exactKeys(
    value,
    ["schema", "tools", "closures", "snapshotHelper", "sha256"],
    "platform controller closure",
  );
  if (value.schema !== G17_NATIVE_CONTROLLER_SCHEMA) {
    fail("platform controller closure schema drifted");
  }
  exactKeys(value.closures, CONTROLLER_SYSTEM_TOOL_IDS, "platform controller closures");
  for (const id of CONTROLLER_SYSTEM_TOOL_IDS) {
    validateControllerClosure(value.closures[id], id);
  }
  validateSnapshotHelperAttestation(value.snapshotHelper);

  if (!Array.isArray(value.tools) || value.tools.length !== CONTROLLER_TOOL_IDS.length) {
    fail("platform controller tool inventory drifted");
  }
  for (const [index, expectedId] of CONTROLLER_TOOL_IDS.entries()) {
    const tool = value.tools[index];
    exactKeys(
      tool,
      ["id", "executableSha256", "version", "dependencyClosureSha256"],
      `platform controller tool ${index}`,
    );
    if (tool.id !== expectedId) fail(`platform controller tool ${index} drifted`);
    digest(tool.executableSha256, `platform controller tool ${expectedId} executable`);
    digest(
      tool.dependencyClosureSha256,
      `platform controller tool ${expectedId} dependency closure`,
    );
    if (
      strictUtf8(
        tool.version,
        `platform controller tool ${expectedId} version`,
        MAX_CONTROLLER_OUTPUT_BYTES,
      ).length === 0
    ) {
      fail(`platform controller tool ${expectedId} version is empty`);
    }
  }

  for (const id of CONTROLLER_SYSTEM_TOOL_IDS) {
    const tool = value.tools.find((candidate) => candidate.id === id);
    const closure = value.closures[id];
    const executable = closure.records.find(({ path }) => path === `/usr/bin/${id}`);
    if (
      executable === undefined ||
      executable.sha256 !== tool.executableSha256 ||
      closure.sha256 !== tool.dependencyClosureSha256
    ) {
      fail(`platform controller tool ${id} differs from its dependency closure`);
    }
  }

  const helperTool = value.tools.find(({ id }) => id === "native-snapshot-helper");
  if (
    value.snapshotHelper.compiler.path !== `/${platform.roles.cc.resolvedPath}` ||
    value.snapshotHelper.compiler.executableSha256 !== platform.roles.cc.sha256 ||
    helperTool.executableSha256 !== value.snapshotHelper.executable.sha256 ||
    helperTool.dependencyClosureSha256 !== canonicalSha256({
      source: value.snapshotHelper.source,
      compiler: value.snapshotHelper.compiler,
    }) ||
    strictUtf8(
      helperTool.version,
      "snapshot helper tool version",
      MAX_CONTROLLER_OUTPUT_BYTES,
    ) !==
      `${value.snapshotHelper.schema}\n`
  ) {
    fail("snapshot helper tool binding drifted");
  }

  for (const [id, path, version] of [
    ["contained-session-worker", "runner/contained-session-worker.mjs", "contained-session-worker/v4\n"],
    ["seccomp-launcher", "runner/seccomp-launcher.py", "seccomp-launcher/v2\n"],
  ]) {
    const tool = value.tools.find((candidate) => candidate.id === id);
    const entry = platform.entries.find(
      (candidate) => candidate.root === "platform" && candidate.path === path,
    );
    if (
      entry?.kind !== "file" ||
      entry.sha256 !== tool.executableSha256 ||
      tool.dependencyClosureSha256 !== tool.executableSha256 ||
      strictUtf8(
        tool.version,
        `platform controller tool ${id} version`,
        MAX_CONTROLLER_OUTPUT_BYTES,
      ) !== version
    ) {
      fail(`platform controller tool ${id} differs from the generated platform`);
    }
  }

  const { sha256: controllerSha256, ...binding } = value;
  if (controllerSha256 !== canonicalSha256(binding)) {
    fail("platform controller closure digest drifted");
  }
  return deepFreeze(value);
}

function replayControllerArtifact(controllerBytes, platform) {
  const controller = validateController(
    parseCanonical(
      controllerBytes,
      "platform controller closure",
      MAX_CONTROLLER_BYTES,
    ),
    platform,
  );
  if (sha256(controllerBytes) !== platform.controllerAttestationSha256) {
    fail("platform controller artifact reference drifted");
  }
  return controller;
}

export function verifyG17NativePlatformBundle(input) {
  try {
    exactKeys(
      input,
      ["platformBytes", "sourcePlanBytes", "controllerBytes"],
      "platform bundle",
    );
    const platform = validatePlatform(
      parseCanonical(input.platformBytes, "platform closure", MAX_PLATFORM_BYTES),
    );
    const sourcePlan = validateSourcePlan(
      parseCanonical(input.sourcePlanBytes, "platform source plan", MAX_SOURCE_PLAN_BYTES),
      platform,
    );
    const controller = replayControllerArtifact(input.controllerBytes, platform);
    if (
      sha256(input.sourcePlanBytes) !== platform.sourcePlanSha256 ||
      sha256(input.controllerBytes) !== platform.controllerAttestationSha256
    ) {
      fail("platform bundle artifact references drifted");
    }
    return deepFreeze({
      platform,
      sourcePlan,
      sourcePlanProjectionSha256: canonicalSha256(sourcePlan),
      controller,
    });
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
  rootFilesystem: "empty-generated-platform-root/v4",
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
      "prctl-set-pdeathsig",
      "setns",
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

function validateControllerTools(controllerTools) {
  if (
    !Array.isArray(controllerTools) ||
    !isDeepStrictEqual(controllerTools.map((tool) => tool?.id), CONTROLLER_TOOL_IDS)
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
    strictStream(
      tool.version,
      `isolation controller tool ${tool.id} version`,
      MAX_CONTROLLER_OUTPUT_BYTES,
    );
  }
}

function bindInstance(base) {
  return { ...base, sha256: canonicalSha256(base) };
}

function validateNamespaceSet(value, label) {
  exactKeys(value, ["user", "mount", "network", "pid", "ipc", "uts"], label);
  const tags = {
    user: "user",
    mount: "mnt",
    network: "net",
    pid: "pid",
    ipc: "ipc",
    uts: "uts",
  };
  for (const [key, tag] of Object.entries(tags)) {
    if (!new RegExp(`^${tag}:\\[([1-9][0-9]*)\\]$`, "u").test(value[key] ?? "")) {
      fail(`${label} ${key} identity is invalid`);
    }
  }
}

function validateControllerNamespaces(value, innerNamespaces) {
  exactKeys(value, ["before", "after"], "controller namespace observations");
  validateNamespaceSet(value.before, "controller namespace before");
  validateNamespaceSet(value.after, "controller namespace after");
  if (!isDeepStrictEqual(value.before, value.after)) {
    fail("controller namespace identities changed across the session");
  }
  validateNamespaceSet(innerNamespaces, "session inner namespaces");
  for (const key of Object.keys(value.before)) {
    if (value.before[key] === innerNamespaces[key]) {
      fail(`session ${key} namespace is not distinct from the controller`);
    }
  }
}

function deriveSessionReplay({
  runId,
  sessionBytes,
  contractBytes,
  contractSha256,
  policy,
  platform,
  workspaceProjectionSha256,
}) {
  if (
    !Buffer.isBuffer(sessionBytes) ||
    sessionBytes.length < 1 ||
    sessionBytes.length > 16 * 1024 * 1024
  ) {
    fail("native session bytes are not a bounded Buffer");
  }
  let claimed;
  try {
    claimed = JSON.parse(sessionBytes);
  } catch (error) {
    fail(`native session bytes are invalid JSON: ${error.message}`);
  }
  const requestedLimits = claimed?.configuration?.requestedLimits;
  const expectedConfiguration = createG17NativeSessionConfiguration({
    runId,
    contractBytes,
    contractSha256,
    platform,
    policy,
    workspaceProjectionSha256,
    requestedLimits,
  });
  const projection = verifyG17NativeSessionArtifact({
    bytes: sessionBytes,
    expectedConfiguration,
    contractBytes,
    contractSha256,
  });
  if (
    projection.status !== "PASS" ||
    projection.effectiveIsolation === null ||
    projection.bindings.contractSha256 !== contractSha256 ||
    projection.bindings.platformManifestSha256 !== platform.manifestSha256 ||
    projection.bindings.policySha256 !== policy.sha256 ||
    projection.bindings.workspaceProjectionSha256 !== workspaceProjectionSha256
  ) {
    fail("native session is not a current PASS bound to this isolation generation");
  }
  return Object.freeze({ expectedConfiguration, projection });
}

function expectedEffectiveObservations(session) {
  const isolation = session.projection.effectiveIsolation;
  const requested = session.expectedConfiguration.requestedLimits;
  const requiredTrue = [
    "namespaceIdentitiesObserved",
    "zeroMappedIdentity",
    "mountAuthorityBounded",
    "loopbackRoutesOnly",
    "cgroupV2LimitsMatch",
    "rlimitsMatch",
    "stateTmpfsAndAnchorsMatch",
    "finalQuiescence",
    "commandCapabilitiesDropped",
    "noNewPrivileges",
    "seccompFiltered",
    "deniedSyscallProbesObserved",
    "detachedCommandSessions",
  ];
  if (requiredTrue.some((key) => isolation[key] !== true)) {
    fail("native session isolation replay is incomplete");
  }
  return deepFreeze({
    userNamespace: true,
    mountNamespace: true,
    networkNamespace: true,
    pidNamespace: true,
    ipcNamespace: true,
    utsNamespace: true,
    controllerNamespacesDistinct: true,
    commandCapabilitiesDropped: true,
    noNewPrivileges: true,
    seccompFiltered: true,
    deniedSyscallProbesObserved: true,
    mountAuthorityBounded: true,
    loopbackRoutesOnly: true,
    cgroupV2: true,
    memoryMaxBytes: requested.residentBytes,
    memorySwapMaxBytes: requested.memorySwapBytes,
    tasksMax: requested.tasksMax,
    fileSizeMaxBytes: requested.diskBytes,
    coreSizeMaxBytes: 0,
    stateTmpfsAndAnchorsMatch: true,
    detachedCommandSessions: true,
    parentDeathSignal: "SIGKILL",
    finalDescendantsObserved: session.projection.finalDescendantsObserved,
  });
}

function validateInstance({
  value,
  policy,
  platform,
  controllerBytes,
  workspaceProjectionSha256,
  sessionBytes,
  contractBytes,
  contractSha256,
}) {
  exactKeys(
    value,
    [
      "schema",
      "runId",
      "policySha256",
      "platformManifestSha256",
      "workspaceProjectionSha256",
      "controllerTools",
      "controllerToolsSha256",
      "controllerNamespaces",
      "controllerNamespacesSha256",
      "effectiveObservations",
      "sessionArtifact",
      "sessionProjectionSha256",
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
  const controller = replayControllerArtifact(controllerBytes, platform);
  validateControllerTools(value.controllerTools);
  if (
    !isDeepStrictEqual(value.controllerTools, controller.tools) ||
    value.controllerToolsSha256 !== canonicalSha256(value.controllerTools)
  ) {
    fail("isolation controller-tool digest drifted");
  }
  const session = deriveSessionReplay({
    runId: value.runId,
    sessionBytes,
    contractBytes,
    contractSha256,
    policy,
    platform,
    workspaceProjectionSha256,
  });
  validateControllerNamespaces(
    value.controllerNamespaces,
    session.projection.effectiveIsolation.innerNamespaces,
  );
  if (
    value.controllerNamespacesSha256 !==
    canonicalSha256(value.controllerNamespaces)
  ) {
    fail("controller namespace observation digest drifted");
  }
  if (
    !isDeepStrictEqual(
      value.effectiveObservations,
      expectedEffectiveObservations(session),
    )
  ) {
    fail("isolation effective observations differ from native-session replay");
  }
  exactKeys(value.sessionArtifact, ["name", "bytes", "sha256"], "session result artifact");
  if (
    value.sessionArtifact.name !== G17_NATIVE_SESSION_ARTIFACT_NAME ||
    value.sessionArtifact.bytes !== sessionBytes.length ||
    value.sessionArtifact.bytes < 1 ||
    value.sessionArtifact.bytes > 16 * 1024 * 1024 ||
    value.sessionArtifact.sha256 !== sha256(sessionBytes) ||
    value.sessionProjectionSha256 !== canonicalSha256(session.projection)
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
    exactKeys(
      input,
      [
        "runId",
        "policy",
        "platform",
        "controllerBytes",
        "workspaceProjectionSha256",
        "controllerNamespaces",
        "sessionBytes",
        "contractBytes",
        "contractSha256",
      ],
      "isolation instance input",
    );
    const policy = expectedPolicy();
    if (!isDeepStrictEqual(input.policy, policy)) {
      fail("isolation instance policy input is not current");
    }
    const platform = cloneCanonicalJson(input.platform, "isolation platform");
    const controller = replayControllerArtifact(input.controllerBytes, platform);
    const controllerTools = cloneCanonicalJson(
      controller.tools,
      "isolation controller tools",
    );
    const controllerNamespaces = cloneCanonicalJson(
      input.controllerNamespaces,
      "controller namespace observations",
    );
    const session = deriveSessionReplay({
      runId: input.runId,
      sessionBytes: input.sessionBytes,
      contractBytes: input.contractBytes,
      contractSha256: input.contractSha256,
      policy,
      platform,
      workspaceProjectionSha256: input.workspaceProjectionSha256,
    });
    validateControllerNamespaces(
      controllerNamespaces,
      session.projection.effectiveIsolation.innerNamespaces,
    );
    const base = {
      schema: G17_NATIVE_ISOLATION_INSTANCE_SCHEMA,
      runId: input.runId,
      policySha256: policy.sha256,
      platformManifestSha256: platform.manifestSha256,
      workspaceProjectionSha256: input.workspaceProjectionSha256,
      controllerTools,
      controllerToolsSha256: canonicalSha256(controllerTools),
      controllerNamespaces,
      controllerNamespacesSha256: canonicalSha256(controllerNamespaces),
      effectiveObservations: expectedEffectiveObservations(session),
      sessionArtifact: {
        name: G17_NATIVE_SESSION_ARTIFACT_NAME,
        bytes: input.sessionBytes.length,
        sha256: sha256(input.sessionBytes),
      },
      sessionProjectionSha256: canonicalSha256(session.projection),
    };
    const instance = validateInstance({
      value: bindInstance(base),
      policy,
      platform,
      controllerBytes: input.controllerBytes,
      workspaceProjectionSha256: input.workspaceProjectionSha256,
      sessionBytes: input.sessionBytes,
      contractBytes: input.contractBytes,
      contractSha256: input.contractSha256,
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

export function verifyG17NativeIsolationInstanceArtifact(input) {
  try {
    exactKeys(
      input,
      [
        "bytes",
        "policy",
        "platform",
        "controllerBytes",
        "workspaceProjectionSha256",
        "sessionBytes",
        "contractBytes",
        "contractSha256",
      ],
      "isolation instance verification input",
    );
    return validateInstance({
      value: parseCanonical(input.bytes, "isolation instance", MAX_INSTANCE_BYTES),
      policy: input.policy,
      platform: input.platform,
      controllerBytes: input.controllerBytes,
      workspaceProjectionSha256: input.workspaceProjectionSha256,
      sessionBytes: input.sessionBytes,
      contractBytes: input.contractBytes,
      contractSha256: input.contractSha256,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native platform contract:")) throw error;
    fail(error.message);
  }
}
