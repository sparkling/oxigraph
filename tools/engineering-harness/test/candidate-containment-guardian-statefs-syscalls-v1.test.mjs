import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ATTESTATION_URL = new URL(
  "../src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs",
  import.meta.url,
);
const HEADER_URL = new URL(
  "../src/candidate/containment-guardian-statefs-syscalls-v1.h",
  import.meta.url,
);
const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-statefs-syscalls-v1.c",
  import.meta.url,
);
const ADR_URL = new URL(
  "../../../docs/adr/0037-durable-containment-statefs-and-manager-protocol.md",
  import.meta.url,
);
const PACKAGE_URL = new URL("../package.json", import.meta.url);
const LOCK_URL = new URL("../package-lock.json", import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EVALUATOR_PATH = fileURLToPath(import.meta.url);

const PREDECESSOR_BYTE_PINS = Object.freeze([
  Object.freeze([
    ADR_URL,
    216688,
    "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",
  ]),
  Object.freeze([
    PACKAGE_URL,
    2790,
    "6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8",
  ]),
  Object.freeze([
    LOCK_URL,
    24963,
    "5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d",
  ]),
]);

const EXPECTED_EXPORTS = Object.freeze([
  "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS",
  "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256",
  "attestCandidateContainmentGuardianStatefsSyscallsV1",
]);

const EXPECTED_AUTHORITY = orderedRecord([
  ["filesystemExecution", false],
  ["processExecution", false],
  ["cgroupMutation", false],
  ["runtimeRegistration", false],
  ["productExecution", false],
  ["g17Execution", false],
  ["qualification", false],
  ["readiness", false],
  ["promotion", false],
  ["publication", false],
]);

const EXPECTED_PHYSICAL_FACTS = orderedRecord([
  ["stateRootOrigin", null],
  ["stateRootHeld", null],
  ["stateRootLocked", null],
  ["filesystemClassified", null],
  ["inventoryObserved", null],
  ["artifactPersisted", null],
  ["directoryCreated", null],
  ["generationMoved", null],
  ["temporaryRemoved", null],
  ["managerAlive", null],
  ["guardianAlive", null],
  ["actorContinuity", null],
]);

const EXPECTED_NONCLAIMS = Object.freeze([
  "state-root-provenance",
  "service-manager-identity",
  "epoch-randomness",
  "historical-durability",
  "power-loss-durability",
  "remote-filesystem",
  "same-uid-tamper-resistance",
  "process-liveness",
  "cgroup-state",
  "descriptor-origin",
  "post-acquisition-lock-continuity",
  "pidfd-or-wait-authority",
  "application-output",
  "COMMIT",
  "semantic-qualification",
  "product-progress",
  "runtime-registration",
  "production-readiness",
  "promotion",
  "publication",
]);

const REQUEST_FIELDS = Object.freeze([
  ["abi_version", "uint32_t", 0],
  ["struct_size", "uint32_t", 4],
  ["operation", "uint32_t", 8],
  ["inventory_kind", "uint32_t", 12],
  ["dirfd_a", "int32_t", 16],
  ["dirfd_b", "int32_t", 20],
  ["dirfd_a_role", "uint32_t", 24],
  ["dirfd_b_role", "uint32_t", 28],
  ["name_a_length", "uint32_t", 32],
  ["name_b_length", "uint32_t", 36],
  ["input_length", "uint64_t", 40],
  ["name_a_address", "uint64_t", 48],
  ["name_b_address", "uint64_t", 56],
  ["input_address", "uint64_t", 64],
  ["observations_address", "uint64_t", 72],
  ["observation_capacity", "uint32_t", 80],
  ["output_capacity", "uint32_t", 84],
  ["output_address", "uint64_t", 88],
  ["test_fault_selector", "uint32_t", 96],
  ["expected_owner_uid", "uint32_t", 100],
  ["expected_owner_gid", "uint32_t", 104],
  ["inventory_directory_role", "uint32_t", 108],
  ["expected_mount_id_a", "uint64_t", 112],
  ["expected_mount_id_b", "uint64_t", 120],
  ["expected_device_major_a", "uint64_t", 128],
  ["expected_device_minor_a", "uint64_t", 136],
  ["expected_inode_a", "uint64_t", 144],
  ["expected_filesystem_magic_a", "uint64_t", 152],
  ["expected_device_major_b", "uint64_t", 160],
  ["expected_device_minor_b", "uint64_t", 168],
  ["expected_inode_b", "uint64_t", 176],
  ["expected_filesystem_magic_b", "uint64_t", 184],
]);

const OBSERVATION_FIELDS = Object.freeze([
  ["struct_size", "uint32_t", 0],
  ["kind", "uint32_t", 4],
  ["role", "uint32_t", 8],
  ["name_length", "uint32_t", 12],
  ["device_major", "uint64_t", 16],
  ["device_minor", "uint64_t", 24],
  ["inode", "uint64_t", 32],
  ["mount_id", "uint64_t", 40],
  ["byte_length", "uint64_t", 48],
  ["link_count", "uint64_t", 56],
  ["mode", "uint32_t", 64],
  ["owner_uid", "uint32_t", 68],
  ["owner_gid", "uint32_t", 72],
  ["statx_mask", "uint32_t", 76],
  ["filesystem_magic", "uint64_t", 80],
  ["content_offset", "uint64_t", 88],
  ["content_length", "uint64_t", 96],
  ["name", "uint8_t[256]", 104],
  ["reserved_0", "uint64_t", 360],
  ["reserved_1", "uint64_t", 368],
  ["reserved_2", "uint64_t", 376],
]);

const RESULT_FIELDS = Object.freeze([
  ["abi_version", "uint32_t", 0],
  ["struct_size", "uint32_t", 4],
  ["operation", "uint32_t", 8],
  ["status", "uint32_t", 12],
  ["effect_class", "uint32_t", 16],
  ["last_completed_step", "uint32_t", 20],
  ["failed_step", "uint32_t", 24],
  ["errno_value", "int32_t", 28],
  ["observation_count", "uint32_t", 32],
  ["output_length", "uint32_t", 36],
  ["completed_step_count", "uint32_t", 40],
  ["returned_directory_fd", "int32_t", 44],
  ["bytes_consumed", "uint64_t", 48],
  ["reserved_u64", "uint64_t", 56],
]);

const EXPECTED_ABI = Object.freeze([
  Object.freeze([
    "request",
    Object.freeze(["alignment", 8, "size", 192, "fields", REQUEST_FIELDS]),
  ]),
  Object.freeze([
    "observation",
    Object.freeze(["alignment", 8, "size", 384, "fields", OBSERVATION_FIELDS]),
  ]),
  Object.freeze([
    "result",
    Object.freeze(["alignment", 8, "size", 64, "fields", RESULT_FIELDS]),
  ]),
  Object.freeze([
    "return",
    Object.freeze(["resultProduced", 0, "fixedBoundaryFailure", -1]),
  ]),
]);

const EXPECTED_OPERATIONS = Object.freeze([
  ["INVALID", 0],
  ["LOCK_EX_NB", 1],
  ["INVENTORY", 2],
  ["PERSIST_NOREPLACE", 3],
  ["MKDIR_SYNC", 4],
  ["MOVE_NOREPLACE_SYNC", 5],
  ["TEMP_CLEANUP", 6],
  ["MOVE_SYNC_REOBSERVE", 7],
  ["RELEASE_DIRECTORY", 8],
]);

const EXPECTED_INVENTORY_KINDS = Object.freeze([
  ["NONE", 0],
  ["DIRECTORY", 1],
  ["REGULAR_FILE", 2],
]);

const EXPECTED_DIRECTORY_ROLES = Object.freeze([
  ["NONE", 0],
  ["STATE_ROOT", 1],
  ["LIFETIMES", 2],
  ["LIFETIME_SEGMENT", 3],
  ["STAGING", 4],
  ["ACTIVE", 5],
  ["CLOSED", 6],
  ["RECOVERED", 7],
  ["QUARANTINED", 8],
  ["GENERATION", 9],
  ["NORMAL_JOURNAL", 10],
  ["RECOVERY_JOURNAL", 11],
  ["RECOVERY_ATTEMPT", 12],
]);

const EXPECTED_OBSERVATION_KINDS = Object.freeze([
  ["ABSENT", 0],
  ["REGULAR", 1],
  ["DIRECTORY", 2],
  ["SYMLINK", 3],
  ["FIFO", 4],
  ["BLOCK_DEVICE", 5],
  ["CHARACTER_DEVICE", 6],
  ["SOCKET", 7],
  ["OTHER", 8],
]);

const EXPECTED_RESULT_STATUSES = Object.freeze([
  ["COMPLETE", 0],
  ["REJECTED", 1],
  ["SYSCALL_FAILED", 2],
  ["LIMIT_EXCEEDED", 3],
  ["FAULT_INJECTED", 4],
  ["VERIFICATION_FAILED", 5],
]);

const EXPECTED_EFFECT_CLASSES = Object.freeze([
  ["NO_EFFECT", 0],
  ["DEFINITE_NO_EFFECT", 1],
  ["COMPLETE", 2],
  ["MUTATION_OBSERVED_NOT_FULLY_SYNCED", 3],
  ["EFFECT_UNCERTAIN", 4],
]);

const EXPECTED_UAPI = Object.freeze([
  ["O_RDONLY", 0x00000000],
  ["O_WRONLY", 0x00000001],
  ["O_CREAT", 0x00000040],
  ["O_EXCL", 0x00000080],
  ["O_ACCMODE", 0x00000003],
  ["O_NONBLOCK", 0x00000800],
  ["O_LARGEFILE", 0x00008000],
  ["O_DIRECTORY", 0x00010000],
  ["O_NOFOLLOW", 0x00020000],
  ["O_CLOEXEC", 0x00080000],
  ["O_PATH", 0x00200000],
  ["F_GETFL", 3],
  ["F_GETFD", 1],
  ["FD_CLOEXEC", 1],
  ["LOCK_EX", 2],
  ["LOCK_NB", 4],
  ["AT_FDCWD", -100],
  ["AT_SYMLINK_NOFOLLOW", 0x00000100],
  ["AT_EMPTY_PATH", 0x00001000],
  ["STATX_BASIC_STATS", 0x000007ff],
  ["STATX_MNT_ID", 0x00001000],
  ["S_IFMT", 0o170000],
  ["S_IFREG", 0o100000],
  ["S_IFDIR", 0o040000],
  ["S_IFLNK", 0o120000],
  ["S_IFIFO", 0o010000],
  ["S_IFBLK", 0o060000],
  ["S_IFCHR", 0o020000],
  ["S_IFSOCK", 0o140000],
  ["S_ISUID", 0o004000],
  ["S_ISGID", 0o002000],
  ["S_ISVTX", 0o001000],
  ["RENAME_NOREPLACE", 1],
]);

const EXPECTED_SYSCALLS = Object.freeze([
  ["read", 0],
  ["write", 1],
  ["close", 3],
  ["fcntl", 72],
  ["flock", 73],
  ["fsync", 74],
  ["fstatfs", 138],
  ["getdents64", 217],
  ["openat", 257],
  ["mkdirat", 258],
  ["unlinkat", 263],
  ["renameat2", 316],
  ["statx", 332],
]);

const EXPECTED_OPERATION_SHAPES = Object.freeze([
  Object.freeze(["LOCK_EX_NB", "STATE_ROOT/-", "NONE", "-/-", "-", "1/0"]),
  Object.freeze([
    "INVENTORY/DIRECTORY/ROOT",
    "STATE_ROOT/-",
    "DIRECTORY",
    "-/-",
    "-",
    "257/32768",
  ]),
  Object.freeze([
    "INVENTORY/DIRECTORY/CHILD",
    "EXACT_HELD_PARENT/-",
    "DIRECTORY",
    "EXACT_CHILD/-",
    "-",
    "257/32768",
  ]),
  Object.freeze([
    "INVENTORY/REGULAR_FILE",
    "CONTAINING_DIRECTORY/-",
    "REGULAR_FILE",
    "EXACT_FINAL/-",
    "-",
    "1/98304",
  ]),
  Object.freeze([
    "PERSIST_NOREPLACE",
    "CONTAINING_DIRECTORY/-",
    "NONE",
    "EXACT_TEMPORARY/EXACT_FINAL",
    "1..98304",
    "1/98304",
  ]),
  Object.freeze([
    "MKDIR_SYNC",
    "CONTAINING_DIRECTORY/-",
    "NONE",
    "EXACT_CHILD/-",
    "-",
    "1/0",
  ]),
  Object.freeze([
    "MOVE_NOREPLACE_SYNC",
    "EXACT_SOURCE_PARENT/EXACT_DESTINATION_PARENT",
    "NONE",
    "EXACT_SOURCE/EXACT_DESTINATION",
    "-",
    "2/0",
  ]),
  Object.freeze([
    "MOVE_SYNC_REOBSERVE",
    "EXACT_SOURCE_PARENT/EXACT_DESTINATION_PARENT",
    "NONE",
    "EXACT_SOURCE/EXACT_DESTINATION",
    "-",
    "2/0",
  ]),
  Object.freeze([
    "TEMP_CLEANUP",
    "CONTAINING_DIRECTORY/-",
    "NONE",
    "EXACT_TEMPORARY/-",
    "-",
    "1/0",
  ]),
  Object.freeze([
    "RELEASE_DIRECTORY",
    "EXACT_NONROOT_HELD_DIRECTORY/-",
    "NONE",
    "-/-",
    "-",
    "0/0",
  ]),
]);

const EXPECTED_LIMITS = Object.freeze([
  ["pathBytes", 4096],
  ["compilerVersionBytes", 65536],
  ["headerBytes", 1048576],
  ["sourceBytes", 1048576],
  ["objectBytes", 1048576],
  ["argvElements", 64],
  ["argvElementBytes", 4096],
  ["environmentEntries", 4],
  ["elfSections", 256],
  ["elfSymbols", 512],
  ["elfRelocations", 4096],
  ["reportCanonicalBytes", 1048576],
  ["directSyscallInstructions", 13],
]);

const EXPECTED_PRODUCTION_ARGV = Object.freeze([
  "/usr/bin/cc",
  "-std=c17",
  "-O2",
  "-fPIC",
  "-fvisibility=hidden",
  "-fno-common",
  "-fno-strict-aliasing",
  "-fno-stack-protector",
  "-fno-builtin",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-Wconversion",
  "-Wsign-conversion",
  "-Wshadow",
  "-Wformat=2",
  "-Wundef",
  "-Wvla",
  "-Wcast-align=strict",
  "-Wstrict-prototypes",
  "-Wmissing-prototypes",
  "-ffile-prefix-map=REQ_ROOT=.",
  "-fdebug-prefix-map=REQ_ROOT=.",
  "-c",
  "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c",
  "-o",
  "OUTPUT_OBJECT",
]);

const EXPECTED_ENVIRONMENT = Object.freeze([
  Object.freeze(["LC_ALL", "C"]),
  Object.freeze(["LANG", "C"]),
  Object.freeze(["TZ", "UTC"]),
  Object.freeze(["SOURCE_DATE_EPOCH", "0"]),
]);

const EXPECTED_REPORT_FIELDS = Object.freeze([
  "schema",
  "requirementsSha256",
  "buildKind",
  "platform",
  "compilerRealpath",
  "compilerByteLength",
  "compilerSha256",
  "compilerVersionByteLength",
  "compilerVersionSha256",
  "firstProductionArgv",
  "secondProductionArgv",
  "faultArgv",
  "environment",
  "headerByteLength",
  "headerSha256",
  "sourceByteLength",
  "sourceSha256",
  "firstObjectByteLength",
  "firstObjectSha256",
  "secondObjectByteLength",
  "secondObjectSha256",
  "repeatedObjectBytesEqual",
  "faultObjectByteLength",
  "faultObjectSha256",
  "faultInspection",
  "elfClass",
  "elfData",
  "elfType",
  "elfMachine",
  "definedGlobalSymbols",
  "undefinedSymbols",
  "pltEntries",
  "relocationTargets",
  "gnuStackExecutable",
  "writableExecutableSectionCount",
  "directSyscallInstructionCount",
  "observedSyscallNumbers",
  "abiLayoutSha256",
  "faultSelectorPresent",
  "reportSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
]);

const EXPECTED_FAULT_INSPECTION_FIELDS = Object.freeze([
  "schema",
  "objectSha256",
  "elfClass",
  "elfData",
  "elfType",
  "elfMachine",
  "definedGlobalSymbols",
  "undefinedSymbols",
  "pltEntries",
  "relocationTargets",
  "gnuStackExecutable",
  "writableExecutableSectionCount",
  "directSyscallInstructionCount",
  "observedSyscallNumbers",
  "abiLayoutSha256",
  "faultSelectorPresent",
  "inspectionSha256",
]);

const EXPECTED_BUILD_REQUIREMENTS = deepFreeze(
  orderedRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-syscalls-build-requirements/v1",
    ],
    ["version", 1],
    ["platform", "linux-x86_64-sysv-little-endian"],
    [
      "header",
      "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.h",
    ],
    [
      "source",
      "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c",
    ],
    ["entrypoint", "oxigraph_containment_statefs_execute_v1"],
    [
      "outputObjects",
      [
        "BUILD_ROOT/production-0001/containment-guardian-statefs-syscalls-v1.o",
        "BUILD_ROOT/production-0002/containment-guardian-statefs-syscalls-v1.o",
        "BUILD_ROOT/fault-0001/containment-guardian-statefs-syscalls-v1-fault.o",
      ],
    ],
    ["limits", EXPECTED_LIMITS],
    ["abi", EXPECTED_ABI],
    ["productionArgv", EXPECTED_PRODUCTION_ARGV],
    [
      "faultArgvDelta",
      ["insert-before-c", "-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1"],
    ],
    ["environment", EXPECTED_ENVIRONMENT],
    [
      "pathRules",
      [
        ["repositoryRoot", "absolute-existing-nonsymlink-directory"],
        [
          "privateBuildRoot",
          "absolute-empty-owner-0700-nonsymlink-outside-repository",
        ],
        [
          "childDirectories",
          ["production-0001", "production-0002", "fault-0001"],
        ],
        ["childDirectoryMode", "0700"],
        ["umask", "0077"],
        ["compiler", "/usr/bin/cc"],
        ["cwd", "repositoryRoot"],
        ["pathSearch", false],
      ],
    ],
    ["allowedSyscalls", EXPECTED_SYSCALLS],
    [
      "elfRules",
      [
        ["class", "ELF64"],
        ["data", "LSB"],
        ["type", "REL"],
        ["machine", "AMD64"],
        ["definedGlobals", ["oxigraph_containment_statefs_execute_v1"]],
        ["undefinedSymbols", []],
        ["pltEntries", []],
        ["gnuStackExecutable", false],
        ["writableExecutableSectionCount", 0],
        ["maximumStackAllocationBytes", 256],
        ["relocationTargetRule", "defined-local-or-nonwritable-section-only"],
        ["directSyscallInstructionCount", 13],
        ["faultCodeInProduction", false],
        ["repeatedProductionBytesEqual", true],
      ],
    ],
    ["reportFields", EXPECTED_REPORT_FIELDS],
    ["repeatCount", 2],
    ["authority", EXPECTED_AUTHORITY],
    ["physicalFacts", EXPECTED_PHYSICAL_FACTS],
    ["nonclaims", EXPECTED_NONCLAIMS],
  ]),
);

const EXPECTED_REQUIREMENTS_SHA256 =
  "fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70";
const EXPECTED_ABI_LAYOUT_SHA256 =
  "651ae0afeedca00a87275030238afe7788cb8852acb2f060f44f711712b041a0";
const EXPECTED_OPERATION_SHAPES_SHA256 =
  "9a66e919ac4e1fc361ecdc91c2f9c67723d1b948089f8191122870461f1d975f";
const EXPECTED_UAPI_SHA256 =
  "18fb844be622ca2b46551c63c2fb5444167f1f25beff6625c5a3c045b11f1a85";
const EXPECTED_OPERATIONS_SHA256 =
  "f62690b17a64047a4ae7237d90e2521e275edfa61bd99dd91f265fb2dc37dbc0";

function orderedRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite oracle value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError("non-JSON oracle value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function independentlyReadCompilerVersion(compilerRealpath) {
  const child = spawnSync(compilerRealpath, ["--version"], {
    cwd: REPOSITORY_ROOT,
    env: Object.fromEntries(EXPECTED_ENVIRONMENT),
    encoding: null,
    maxBuffer: 65536,
    shell: false,
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(Buffer.isBuffer(child.stdout), true);
  assert.equal(Buffer.isBuffer(child.stderr), true);
  assert.equal(child.stderr.length, 0);
  assert.ok(child.stdout.length >= 1 && child.stdout.length <= 65536);
  return child.stdout;
}

function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function assertDeepFrozenNullPrototype(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    assert.equal(Object.getPrototypeOf(value), null);
  }
  for (const child of Object.values(value)) {
    assertDeepFrozenNullPrototype(child, seen);
  }
}

function assertDenseSortedUniqueAscii(values) {
  assert.ok(Array.isArray(values));
  assert.equal(Object.keys(values).length, values.length);
  for (const value of values) {
    assert.equal(typeof value, "string");
    assert.match(value, /^[\x20-\x7e]+$/u);
  }
  assert.deepEqual(values, [...new Set(values)].sort());
}

function digestPrecedingFields(value, digestField, fields) {
  const digestIndex = fields.indexOf(digestField);
  assert.ok(digestIndex > 0);
  const unsigned = orderedRecord(
    fields.slice(0, digestIndex).map((key) => [key, value[key]]),
  );
  return semanticSha256(unsigned);
}

function stripCComments(source) {
  let state = "code";
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (character === "/" && next === "/") {
        output += "  ";
        index += 1;
        state = "line-comment";
      } else if (character === "/" && next === "*") {
        output += "  ";
        index += 1;
        state = "block-comment";
      } else {
        output += character;
        if (character === '"') state = "string";
        if (character === "'") state = "character";
      }
      continue;
    }
    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        output += character;
        state = "code";
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }
    output += character;
    if (character === "\\") {
      assert.notEqual(next, undefined, `unterminated C ${state} escape`);
      output += next;
      index += 1;
    } else if (
      (state === "string" && character === '"') ||
      (state === "character" && character === "'")
    ) {
      state = "code";
    } else {
      assert.notEqual(character, "\n", `unterminated C ${state}`);
      assert.notEqual(character, "\r", `unterminated C ${state}`);
    }
  }
  assert.ok(
    state === "code" || state === "line-comment",
    `unterminated C ${state}`,
  );
  return output;
}

function stripCStringAndCharacterLiterals(source) {
  return source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, (literal) =>
    literal.replace(/[^\n]/gu, " "),
  );
}

function stripCAlignmentSpecifiers(source) {
  const output = source.split("");
  for (const match of source.matchAll(/\b_Alignas\b/gu)) {
    let cursor = match.index + match[0].length;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    assert.equal(source[cursor], "(", "_Alignas opening parenthesis");
    let depth = 1;
    cursor += 1;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      if (source[cursor] === ")") depth -= 1;
    }
    assert.equal(depth, 0, "unterminated _Alignas specifier");
    for (let index = match.index; index < cursor; index += 1) {
      if (output[index] !== "\n" && output[index] !== "\r") {
        output[index] = " ";
      }
    }
  }
  return output.join("");
}

function cFunctionBodies(source) {
  const clean = stripCStringAndCharacterLiterals(stripCComments(source));
  const bodies = [];
  let declarationStart = 0;
  for (
    let open = clean.indexOf("{");
    open !== -1;
    open = clean.indexOf("{", open + 1)
  ) {
    const header = clean.slice(declarationStart, open).trim();
    const functionName = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^;{}]*\)\s*$/u.exec(
      header,
    )?.[1];
    let depth = 1;
    let close = open + 1;
    for (; close < clean.length && depth > 0; close += 1) {
      if (clean[close] === "{") depth += 1;
      if (clean[close] === "}") depth -= 1;
    }
    assert.equal(depth, 0, "unterminated C function body");
    if (
      functionName !== undefined &&
      !new Set(["if", "for", "while", "switch"]).has(functionName)
    ) {
      bodies.push(clean.slice(open + 1, close - 1));
    }
    open = close - 1;
    declarationStart = close;
  }
  assert.ok(bodies.length > 0, "C function body required");
  return bodies;
}

function assertOnlySyscallInlineAssembly(source) {
  const phaseTwo = source.replace(/\\(?:\r\n|\n|\r)/gu, "");
  const clean = stripCComments(phaseTwo);
  const masked = stripCStringAndCharacterLiterals(clean);
  assert.doesNotMatch(masked, /(?:##|%:%:|\?\?)/u, "C token construction");
  const functionBodyRanges = [];
  let declarationStart = 0;
  for (
    let open = masked.indexOf("{");
    open !== -1;
    open = masked.indexOf("{", open + 1)
  ) {
    const header = masked.slice(declarationStart, open).trim();
    const functionName =
      /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^;{}]*\)\s*$/u.exec(header)?.[1];
    let depth = 1;
    let close = open + 1;
    for (; close < masked.length && depth > 0; close += 1) {
      if (masked[close] === "{") depth += 1;
      if (masked[close] === "}") depth -= 1;
    }
    assert.equal(depth, 0, "unterminated C function body");
    if (
      functionName !== undefined &&
      !new Set(["if", "for", "while", "switch"]).has(functionName)
    ) {
      functionBodyRanges.push([open + 1, close - 1]);
    }
    open = close - 1;
    declarationStart = close;
  }
  const occurrences = [...masked.matchAll(/\b(?:__asm__|__asm|asm)\b/gu)];
  assert.ok(occurrences.length > 0, "direct syscall assembly required");
  let directSyscallAssemblyCount = 0;
  for (const occurrence of occurrences) {
    let cursor = occurrence.index + occurrence[0].length;
    while (/\s/u.test(masked[cursor] ?? "")) cursor += 1;
    const qualifier = /^(?:__volatile__|__volatile|volatile)\b/u.exec(
      masked.slice(cursor),
    );
    if (qualifier !== null) {
      cursor += qualifier[0].length;
      while (/\s/u.test(masked[cursor] ?? "")) cursor += 1;
    }
    assert.equal(masked[cursor], "(", "inline-assembly-open");
    const open = cursor;
    let depth = 1;
    let firstColon = -1;
    cursor += 1;
    for (; cursor < masked.length && depth > 0; cursor += 1) {
      if (masked[cursor] === "(") depth += 1;
      if (masked[cursor] === ")") depth -= 1;
      if (masked[cursor] === ":" && depth === 1 && firstColon === -1) {
        firstColon = cursor;
      }
    }
    assert.equal(depth, 0, "inline-assembly-close");
    const close = cursor - 1;
    const templateEnd = firstColon === -1 ? close : firstColon;
    const statementStart =
      Math.max(
        masked.lastIndexOf(";", occurrence.index),
        masked.lastIndexOf("{", occurrence.index),
        masked.lastIndexOf("}", occurrence.index),
      ) + 1;
    const statementEnd = masked.indexOf(";", close + 1);
    const isAllowedLocalRegisterBinding =
      occurrence[0] === "__asm__" &&
      qualifier === null &&
      functionBodyRanges.some(
        ([start, end]) => occurrence.index >= start && occurrence.index < end,
      ) &&
      /^\s*register\s+long\s+[a-zA-Z_][a-zA-Z0-9_]*\s*$/u.test(
        masked.slice(statementStart, occurrence.index),
      ) &&
      new Set(['"r10"', '"r8"']).has(
        clean.slice(open + 1, close).trim(),
      ) &&
      statementEnd !== -1 &&
      /^\s*=\s*[a-zA-Z_][a-zA-Z0-9_]*\s*;$/u.test(
        masked.slice(close + 1, statementEnd + 1),
      );
    if (isAllowedLocalRegisterBinding) continue;
    const executableTemplate = clean.slice(open + 1, templateEnd).trim();
    if (executableTemplate !== '"syscall"') {
      const fixedImmediate =
        /^"movl \$([0-9]+), %%eax\\n\\tsyscall"$/u.exec(executableTemplate);
      assert.notEqual(fixedImmediate, null, "inline-assembly-template");
      assert.equal(
        new Set([
          "0",
          "1",
          "3",
          "72",
          "73",
          "74",
          "138",
          "217",
          "257",
          "258",
          "263",
          "316",
          "332",
        ]).has(fixedImmediate[1]),
        true,
        "inline-assembly-syscall-immediate",
      );
    }
    directSyscallAssemblyCount += 1;
  }
  assert.ok(directSyscallAssemblyCount > 0, "direct syscall assembly required");
}

function reconstructPreR14D1P2AdrRepinSource(source) {
  const count = (value, needle) => {
    assert.notEqual(needle.length, 0);
    let matches = 0;
    let offset = 0;
    while (true) {
      const index = value.indexOf(needle, offset);
      if (index === -1) return matches;
      matches += 1;
      offset = index + needle.length;
    }
  };
  const replaceOne = (value, before, after, label) => {
    assert.equal(count(value, before), 1, label);
    return value.replace(before, after);
  };
  const currentAdrPin = [
    "    ADR_URL,",
    "    216688,",
    '    "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",',
  ].join("\n");
  const predecessorAdrPin = [
    "    ADR_URL,",
    "    216620,",
    '    "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",',
  ].join("\n");
  const currentAcceptedInverseEntry = [
    "  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(",
    "    reconstructPreR14D1P2AdrRepinSource(currentEvaluatorSource),",
    "  );",
  ].join("\n");
  const predecessorAcceptedInverseEntry = [
    "  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(",
    "    currentEvaluatorSource,",
    "  );",
  ].join("\n");
  const currentR13InverseEntry = [
    "  const reconstructedSource = reconstructPreR13S3SyscallEvaluatorSource(",
    "    reconstructPreR14D1P2AdrRepinSource(currentSource),",
    "  );",
  ].join("\n");
  const predecessorR13InverseEntry = [
    "  const reconstructedSource = reconstructPreR13S3SyscallEvaluatorSource(",
    "    currentSource,",
    "  );",
  ].join("\n");
  const currentR8InverseEntry = [
    "  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(",
    "    reconstructPreR14D1P2AdrRepinSource(currentSource),",
    "  );",
  ].join("\n");
  const predecessorR8InverseEntry =
    "  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(currentSource);";
  let reconstructed = replaceOne(
    source,
    currentAdrPin,
    predecessorAdrPin,
    "R14D1 P2 ADR pin inverse",
  );
  reconstructed = replaceOne(
    reconstructed,
    currentAcceptedInverseEntry,
    predecessorAcceptedInverseEntry,
    "R14D1 P2 accepted inverse entry",
  );
  reconstructed = replaceOne(
    reconstructed,
    currentR13InverseEntry,
    predecessorR13InverseEntry,
    "R14D1 P2 R13 inverse entry",
  );
  reconstructed = replaceOne(
    reconstructed,
    currentR8InverseEntry,
    predecessorR8InverseEntry,
    "R14D1 P2 R8 inverse entry",
  );
  const correctionStart =
    "\n\nfunction reconstructPreR14D1P2AdrRepinSource(source) {\n";
  const correctionEnd =
    "\n\nfunction reconstructPreR8EvaluatorSource(source, proofStart, proofEnd) {\n";
  assert.equal(count(reconstructed, correctionStart), 1, "R14D1 P2 start");
  assert.equal(count(reconstructed, correctionEnd), 1, "R14D1 P2 end");
  const startIndex = reconstructed.indexOf(correctionStart);
  const endIndex = reconstructed.indexOf(
    correctionEnd,
    startIndex + correctionStart.length,
  );
  assert.equal(endIndex > startIndex, true, "R14D1 P2 inverse order");
  return `${reconstructed.slice(0, startIndex)}${reconstructed.slice(endIndex)}`;
}

test("R14D1 P2 ADR repin inversely reconstructs the exact R13D1 evaluator", async () => {
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource =
    reconstructPreR14D1P2AdrRepinSource(currentSource);
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 160288);
  assert.equal(reconstructedSource.split("\n").length - 1, 4801);
  assert.equal(
    sha256(reconstructedBytes),
    "6fb8848670dc84fad1fa42fdf8f34bfd31ea7876da40361bcff7ddf5ed95be81",
  );
  assert.equal(
    createHash("sha1")
      .update(Buffer.from(`blob ${reconstructedBytes.length}\0`, "utf8"))
      .update(reconstructedBytes)
      .digest("hex"),
    "d95a93e4fe0b3ca6b9da5b55dad7672e09253edd",
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)test\(/gu)].length,
    13,
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)candidateTest\(/gu)].length,
    8,
  );
  assert.deepEqual(
    [
      ...reconstructedSource.matchAll(
        /(?:^|\n)(?:test|candidateTest)\(\s*"([^"\n]+)"/gu,
      ),
    ].map((match) => match[1]),
    [
      "literal build, ABI, UAPI, syscall, and authority oracle is internally closed",
      "pins the accepted S0 ADR and unchanged harness package bytes",
      "ADR pin correction inversely reconstructs accepted S3 syscall evaluator",
      "R13 statx-mask correction inversely reconstructs the exact pre-R13 syscall evaluator",
      "literal statx-mask and complete-prefix oracle is internally closed",
      "statx source oracle kills incomplete masks, masked copies, and partial publication",
      "C source copies and gates complete statx evidence before publication",
      "R8 fixed-register and syscall-immediate correction inversely reconstructs the pre-R8 syscall evaluator",
      "exports only the three frozen attestation identities",
      "freezes the complete build requirements and ABI digest independently",
      "freezes all eight operations and ten exact request-shape variants",
      "header fixes all three layouts, enum values, UAPI literals, and entrypoint",
      "C source is one direct-syscall translation unit with no ambient authority",
      "production attestation binds deterministic objects, ELF, ABI, and source bytes",
      "build contract enforces BOUNDS before SHAPE before PATH and rejects caller overrides",
      "attestation source declares the exact error vocabulary and contains no ambient effects",
      "literal oracle fixes production nullability and report digest boundaries",
      "local byte-array audit rejects fixed and variable stack scratch without rejecting ABI members",
      "instruction audit follows reachable stack paths and rejects unmodelled stack writes",
      "missing-module attribution rejects wrong code, URL, message, and present source",
      "reports only the exact source-absent attestation import RED",
    ],
  );
});

function reconstructPreR8EvaluatorSource(source, proofStart, proofEnd) {
  const count = (value, needle) => {
    assert.notEqual(needle.length, 0);
    let matches = 0;
    let offset = 0;
    while (true) {
      const index = value.indexOf(needle, offset);
      if (index === -1) return matches;
      matches += 1;
      offset = index + needle.length;
    }
  };
  const replaceOne = (value, before, after, label) => {
    assert.equal(count(value, before), 1, label);
    return value.replace(before, after);
  };
  const removeRangeOne = (value, start, end, label) => {
    assert.equal(count(value, start), 1, `${label} start`);
    assert.equal(count(value, end), 1, `${label} end`);
    const startIndex = value.indexOf(start);
    const endIndex = value.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${value.slice(0, startIndex)}${value.slice(endIndex)}`;
  };
  const functionRangeCorrection = [
    "  const functionBodyRanges = [];",
    "  let declarationStart = 0;",
    "  for (",
    '    let open = masked.indexOf("{");',
    "    open !== -1;",
    '    open = masked.indexOf("{", open + 1)',
    "  ) {",
    "    const header = masked.slice(declarationStart, open).trim();",
    "    const functionName =",
    "      /\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\([^;{}]*\\)\\s*$/u.exec(header)?.[1];",
    "    let depth = 1;",
    "    let close = open + 1;",
    "    for (; close < masked.length && depth > 0; close += 1) {",
    '      if (masked[close] === "{") depth += 1;',
    '      if (masked[close] === "}") depth -= 1;',
    "    }",
    '    assert.equal(depth, 0, "unterminated C function body");',
    "    if (",
    "      functionName !== undefined &&",
    '      !new Set(["if", "for", "while", "switch"]).has(functionName)',
    "    ) {",
    "      functionBodyRanges.push([open + 1, close - 1]);",
    "    }",
    "    open = close - 1;",
    "    declarationStart = close;",
    "  }",
    "",
  ].join("\n");
  const correctedDecision = [
    "    const statementStart =",
    "      Math.max(",
    '        masked.lastIndexOf(";", occurrence.index),',
    '        masked.lastIndexOf("{", occurrence.index),',
    '        masked.lastIndexOf("}", occurrence.index),',
    "      ) + 1;",
    '    const statementEnd = masked.indexOf(";", close + 1);',
    "    const isAllowedLocalRegisterBinding =",
    '      occurrence[0] === "__asm__" &&',
    "      qualifier === null &&",
    "      functionBodyRanges.some(",
    "        ([start, end]) => occurrence.index >= start && occurrence.index < end,",
    "      ) &&",
    "      /^\\s*register\\s+long\\s+[a-zA-Z_][a-zA-Z0-9_]*\\s*$/u.test(",
    "        masked.slice(statementStart, occurrence.index),",
    "      ) &&",
    "      new Set(['\"r10\"', '\"r8\"']).has(",
    "        clean.slice(open + 1, close).trim(),",
    "      ) &&",
    "      statementEnd !== -1 &&",
    "      /^\\s*=\\s*[a-zA-Z_][a-zA-Z0-9_]*\\s*;$/u.test(",
    "        masked.slice(close + 1, statementEnd + 1),",
    "      );",
    "    if (isAllowedLocalRegisterBinding) continue;",
    "    const executableTemplate = clean.slice(open + 1, templateEnd).trim();",
    '    if (executableTemplate !== \'"syscall"\') {',
    "      const fixedImmediate =",
    '        /^"movl \\$([0-9]+), %%eax\\\\n\\\\tsyscall"$/u.exec(executableTemplate);',
    '      assert.notEqual(fixedImmediate, null, "inline-assembly-template");',
    "      assert.equal(",
    "        new Set([",
    '          "0",',
    '          "1",',
    '          "3",',
    '          "72",',
    '          "73",',
    '          "74",',
    '          "138",',
    '          "217",',
    '          "257",',
    '          "258",',
    '          "263",',
    '          "316",',
    '          "332",',
    "        ]).has(fixedImmediate[1]),",
    "        true,",
    '        "inline-assembly-syscall-immediate",',
    "      );",
    "    }",
    "    directSyscallAssemblyCount += 1;",
  ].join("\n");
  const acceptedDecision = [
    "    assert.equal(",
    "      clean.slice(open + 1, templateEnd).trim(),",
    "      '\"syscall\"',",
    '      "inline-assembly-template",',
    "    );",
  ].join("\n");
  const correctedOriginalInverseEntry = [
    "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
    "    currentEvaluatorSource,",
    "    [",
    "      '\\n\\ntest(\"R8 fixed-register and syscall-immediate correction ',",
    "      'inversely reconstructs the pre-R8 syscall evaluator\", async () => {\\n',",
    '    ].join(""),',
    "    '\\n\\ncandidateTest(\"exports only the three frozen attestation identities\", () => {\\n',",
    "  );",
    "  acceptedEvaluatorSource = replaceExactly(",
    "    acceptedEvaluatorSource,",
  ].join("\n");
  const acceptedOriginalInverseEntry = [
    "  let acceptedEvaluatorSource = replaceExactly(",
    "    currentEvaluatorSource,",
  ].join("\n");
  const helperStart = [
    "\n\nfunction ",
    "reconstructPreR8EvaluatorSource(source, proofStart, proofEnd) {\n",
  ].join("");
  const helperEnd =
    "\n\nfunction assertNoFunctionLocalByteArrays(source) {\n";
  let reconstructed = replaceOne(
    source,
    functionRangeCorrection,
    "",
    "R8 function-range correction",
  );
  reconstructed = replaceOne(
    reconstructed,
    "  let directSyscallAssemblyCount = 0;\n",
    "",
    "R8 syscall counter declaration",
  );
  reconstructed = replaceOne(
    reconstructed,
    correctedDecision,
    acceptedDecision,
    "R8 assembly decision",
  );
  reconstructed = replaceOne(
    reconstructed,
    '  assert.ok(directSyscallAssemblyCount > 0, "direct syscall assembly required");\n',
    "",
    "R8 syscall counter assertion",
  );
  reconstructed = replaceOne(
    reconstructed,
    correctedOriginalInverseEntry,
    acceptedOriginalInverseEntry,
    "R8 original-inverse chain",
  );
  reconstructed = removeRangeOne(
    reconstructed,
    helperStart,
    helperEnd,
    "R8 inverse helper",
  );
  return removeRangeOne(
    reconstructed,
    proofStart,
    proofEnd,
    "R8 correction proof",
  );
}

function assertNoFunctionLocalByteArrays(source) {
  const phaseTwo = source.replace(/\\(?:\r\n|\n|\r)/gu, "");
  const clean = stripCStringAndCharacterLiterals(stripCComments(phaseTwo));
  const byteTypes = new Set([
    "char",
    "signed char",
    "unsigned char",
    "int8_t",
    "uint8_t",
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of clean.matchAll(
      /\btypedef\s+((?:(?:const|volatile|signed|unsigned)\s+)*[a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/gu,
    )) {
      const sourceType = match[1].replace(/\s+/gu, " ").trim();
      const unqualified = sourceType
        .replace(/\b(?:const|volatile)\b/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      if (byteTypes.has(unqualified) && !byteTypes.has(match[2])) {
        byteTypes.add(match[2]);
        changed = true;
      }
    }
    for (const match of clean.matchAll(
      /^\s*#\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+((?:(?:const|volatile|signed|unsigned)\s+)*[a-zA-Z_][a-zA-Z0-9_]*)\s*$/gmu,
    )) {
      const sourceType = match[2]
        .replace(/\b(?:const|volatile)\b/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      if (byteTypes.has(sourceType) && !byteTypes.has(match[1])) {
        byteTypes.add(match[1]);
        changed = true;
      }
    }
  }
  const rawAggregateDefinitions = [];
  for (const match of clean.matchAll(/\b(typedef\s+)?(struct|union)\b/gu)) {
    let cursor = match.index + match[0].length;
    while (/\s/u.test(clean[cursor] ?? "")) cursor += 1;
    const tagMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/u.exec(clean.slice(cursor));
    const tag = tagMatch?.[0];
    if (tag !== undefined) cursor += tag.length;
    while (/\s/u.test(clean[cursor] ?? "")) cursor += 1;
    if (clean[cursor] !== "{") continue;
    const open = cursor;
    let depth = 1;
    cursor += 1;
    for (; cursor < clean.length && depth > 0; cursor += 1) {
      if (clean[cursor] === "{") depth += 1;
      if (clean[cursor] === "}") depth -= 1;
    }
    assert.equal(depth, 0, "unterminated C aggregate definition");
    const close = cursor - 1;
    const semicolon = clean.indexOf(";", cursor);
    assert.ok(semicolon >= cursor, "aggregate definition semicolon");
    const trailing = clean.slice(cursor, semicolon);
    assert.doesNotMatch(trailing, /[{}]/u, "aggregate declarator braces");
    rawAggregateDefinitions.push(
      Object.freeze({
        start: match.index,
        open,
        close,
        end: semicolon + 1,
        isTypedef: match[1] !== undefined,
        kind: match[2],
        tag,
        trailing,
      }),
    );
  }
  const aggregateDefinitions = rawAggregateDefinitions.map((definition) => {
    const children = rawAggregateDefinitions.filter(
      (candidate) =>
        candidate.start > definition.open &&
        candidate.end <= definition.close &&
        !rawAggregateDefinitions.some(
          (intermediate) =>
            intermediate !== definition &&
            intermediate !== candidate &&
            intermediate.start > definition.open &&
            intermediate.end <= definition.close &&
            candidate.start > intermediate.open &&
            candidate.end <= intermediate.close,
        ),
    );
    const topLevelBody = [
      ...clean.slice(definition.open + 1, definition.close),
    ];
    for (const child of children) {
      for (
        let index = child.start - definition.open - 1;
        index < child.end - definition.open - 1;
        index += 1
      ) {
        if (topLevelBody[index] !== "\n" && topLevelBody[index] !== "\r") {
          topLevelBody[index] = " ";
        }
      }
    }
    return Object.freeze({
      ...definition,
      children: Object.freeze(children),
      topLevelBody: topLevelBody.join(""),
    });
  });
  const aggregateTypesWithByteArrays = new Set();
  const aggregateDefinitionStartsWithByteArrays = new Set();
  const escapeType = (type) =>
    type.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
  const declaratorsContainByValue = (declarators, { arrayRequired }) =>
    declarators.split(",").some((rawDeclarator) => {
      const declarator = rawDeclarator.split("=", 1)[0].trim();
      if (declarator.length === 0) return false;
      const array = declarator.indexOf("[");
      if (arrayRequired && array === -1) return false;
      const prefix = array === -1 ? declarator : declarator.slice(0, array);
      return !prefix.includes("*");
    });
  const bodyContainsByValue = (body, types, options) =>
    body.split(";").some((member) =>
      [...types].some((type) => {
        const match = new RegExp(`\\b${escapeType(type)}\\b([^;]*)$`, "u").exec(
          member,
        );
        return match !== null && declaratorsContainByValue(match[1], options);
      }),
    );
  changed = true;
  while (changed) {
    changed = false;
    for (const definition of aggregateDefinitions) {
      const containsByteArray = bodyContainsByValue(
        definition.topLevelBody,
        byteTypes,
        { arrayRequired: true },
      );
      const containsUnsafeAggregate = bodyContainsByValue(
        definition.topLevelBody,
        aggregateTypesWithByteArrays,
        { arrayRequired: false },
      );
      const containsUnsafeAnonymousAggregate = definition.children.some(
        (child) =>
          !child.isTypedef &&
          aggregateDefinitionStartsWithByteArrays.has(child.start) &&
          declaratorsContainByValue(child.trailing, { arrayRequired: false }),
      );
      if (
        !containsByteArray &&
        !containsUnsafeAggregate &&
        !containsUnsafeAnonymousAggregate
      ) {
        continue;
      }
      if (!aggregateDefinitionStartsWithByteArrays.has(definition.start)) {
        aggregateDefinitionStartsWithByteArrays.add(definition.start);
        changed = true;
      }
      const ownedTypes = [];
      if (definition.tag !== undefined) {
        ownedTypes.push(`${definition.kind} ${definition.tag}`);
      }
      if (definition.isTypedef) {
        for (const rawDeclarator of definition.trailing.split(",")) {
          const alias = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*$/u.exec(
            rawDeclarator,
          )?.[1];
          if (alias !== undefined && !rawDeclarator.includes("*")) {
            ownedTypes.push(alias);
          }
        }
      }
      for (const type of ownedTypes) {
        if (!aggregateTypesWithByteArrays.has(type)) {
          aggregateTypesWithByteArrays.add(type);
          changed = true;
        }
      }
    }
    for (const match of clean.matchAll(
      /\btypedef\s+((?:(?:const|volatile)\s+)*(?:(?:struct|union)\s+[a-zA-Z_][a-zA-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_]*))\s+([^;{}]+);/gu,
    )) {
      const sourceType = match[1]
        .replace(/\b(?:const|volatile)\b/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      for (const rawDeclarator of match[2].split(",")) {
        const alias = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\[[^\]]*\]\s*)*$/u.exec(
          rawDeclarator,
        )?.[1];
        const aliasesByteArray =
          byteTypes.has(sourceType) &&
          declaratorsContainByValue(rawDeclarator, { arrayRequired: true });
        const aliasesUnsafeAggregate =
          aggregateTypesWithByteArrays.has(sourceType) &&
          declaratorsContainByValue(rawDeclarator, { arrayRequired: false });
        if (
          alias !== undefined &&
          (aliasesByteArray || aliasesUnsafeAggregate) &&
          !aggregateTypesWithByteArrays.has(alias)
        ) {
          aggregateTypesWithByteArrays.add(alias);
          changed = true;
        }
      }
    }
  }
  const escapedTypes = [...byteTypes]
    .sort((left, right) => right.length - left.length)
    .map((type) =>
      type.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+"),
    );
  const byteTypeNamesPattern = escapedTypes.join("|");
  const byteTypePattern = `(?:(?:${byteTypeNamesPattern})\\b|_Atomic\\s*\\(\\s*(?:${byteTypeNamesPattern})\\b\\s*\\))`;
  const declaration = new RegExp(
    `(?:^|[;{}]|\\bfor\\s*\\()\\s*(?:(?:static|register|auto|const|volatile|restrict|_Atomic|_Thread_local)\\s+)*${byteTypePattern}([^;{}]*)`,
    "gu",
  );
  const forbiddenDeclarationMacros = new Set();
  changed = true;
  while (changed) {
    changed = false;
    for (const match of clean.matchAll(
      /^\s*#\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^\n)]*\)\s+([^\n]*)$/gmu,
    )) {
      const replacement = match[2];
      const declaresByteArray = [...byteTypes].some((type) =>
        new RegExp(
          `\\b${type.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b[^;{}]*\\b[a-zA-Z_][a-zA-Z0-9_]*\\s*\\[`,
          "u",
        ).test(replacement),
      );
      const invokesForbiddenMacro = [...forbiddenDeclarationMacros].some(
        (name) => new RegExp(`\\b${name}\\s*\\(`, "u").test(replacement),
      );
      if (
        (declaresByteArray || invokesForbiddenMacro) &&
        !forbiddenDeclarationMacros.has(match[1])
      ) {
        forbiddenDeclarationMacros.add(match[1]);
        changed = true;
      }
    }
  }
  const escapedAggregateTypes = [...aggregateTypesWithByteArrays]
    .sort((left, right) => right.length - left.length)
    .map(escapeType)
    .join("|");
  const aggregateTypePattern = `(?:(?:${escapedAggregateTypes})\\b|_Atomic\\s*\\(\\s*(?:${escapedAggregateTypes})\\b\\s*\\))`;
  const aggregateDeclaration =
    aggregateTypesWithByteArrays.size === 0
      ? null
      : new RegExp(
          `(?:^|[;{}]|\\bfor\\s*\\()\\s*(?:(?:static|register|auto|const|volatile|restrict|_Atomic|_Thread_local)\\s+)*${aggregateTypePattern}([^;{}]*)`,
          "gu",
        );
  for (const body of cFunctionBodies(phaseTwo)) {
    const declarationBody = stripCAlignmentSpecifiers(body);
    assert.doesNotMatch(
      body,
      new RegExp(
        `\\(\\s*(?:(?:const|volatile|_Atomic)\\s+)*${byteTypePattern}\\s*\\[[^\\]]*\\]\\s*\\)\\s*\\{`,
        "u",
      ),
      "compound literal is a byte array",
    );
    if (aggregateDeclaration !== null) {
      assert.doesNotMatch(
        body,
        new RegExp(
          `\\(\\s*(?:(?:const|volatile|_Atomic)\\s+)*${aggregateTypePattern}\\s*\\)\\s*\\{`,
          "u",
        ),
        "compound literal contains a byte array",
      );
      for (const match of declarationBody.matchAll(aggregateDeclaration)) {
        for (const rawDeclarator of match[1].split(",")) {
          const declarator = rawDeclarator.split("=", 1)[0].trim();
          if (declarator.length === 0) continue;
          assert.match(
            declarator,
            /^(?:\*|\(\s*\*)/u,
            "function-local aggregate contains a byte array",
          );
        }
      }
    }
    for (const name of forbiddenDeclarationMacros) {
      assert.doesNotMatch(body, new RegExp(`\\b${name}\\s*\\(`, "u"));
    }
    for (const match of declarationBody.matchAll(declaration)) {
      const declarators = [];
      let start = 0;
      let depth = 0;
      for (let index = 0; index <= match[1].length; index += 1) {
        const character = match[1][index];
        if (character === "(" || character === "[" || character === "{") {
          depth += 1;
        } else if (
          character === ")" ||
          character === "]" ||
          character === "}"
        ) {
          depth = Math.max(0, depth - 1);
        }
        if ((character === "," && depth === 0) || index === match[1].length) {
          declarators.push(match[1].slice(start, index));
          start = index + 1;
        }
      }
      for (const rawDeclarator of declarators) {
        let equals = rawDeclarator.length;
        depth = 0;
        for (let index = 0; index < rawDeclarator.length; index += 1) {
          const character = rawDeclarator[index];
          if (character === "(" || character === "[" || character === "{") {
            depth += 1;
          } else if (
            character === ")" ||
            character === "]" ||
            character === "}"
          ) {
            depth = Math.max(0, depth - 1);
          } else if (character === "=" && depth === 0) {
            equals = index;
            break;
          }
        }
        const declarator = rawDeclarator.slice(0, equals);
        assert.equal(
          declaratorsContainByValue(declarator, { arrayRequired: true }),
          false,
          "function-local byte array",
        );
      }
    }
  }
}

function normalizeCType(type, extent) {
  return extent === undefined ? type : `${type}[${extent}]`;
}

function extractStructFields(header, structName) {
  const clean = stripCComments(header);
  const matches = [
    ...clean.matchAll(
      new RegExp(`\\bstruct\\s+${structName}\\s*\\{([\\s\\S]*?)\\}\\s*;`, "gu"),
    ),
  ];
  assert.equal(matches.length, 1, structName);
  const match = matches[0];
  return match[1]
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((declaration) => {
      const field =
        /^(uint32_t|int32_t|uint64_t|uint8_t)\s+([a-z][a-z0-9_]*)(?:\s*\[\s*([0-9]+)\s*\])?$/u.exec(
          declaration,
        );
      assert.notEqual(field, null, declaration);
      return [field[2], normalizeCType(field[1], field[3])];
    });
}

function parseCInteger(raw) {
  const negative = raw.startsWith("-");
  const magnitude = negative ? raw.slice(1) : raw;
  let value;
  if (/^0[xX][0-9a-fA-F]+$/u.test(magnitude)) {
    value = Number.parseInt(magnitude.slice(2), 16);
  } else if (/^0[0-7]+$/u.test(magnitude) && magnitude !== "0") {
    value = Number.parseInt(magnitude.slice(1), 8);
  } else {
    value = Number.parseInt(magnitude, 10);
  }
  return negative ? -value : value;
}

function cIntegerAssignments(header) {
  const clean = stripCComments(header);
  const assignments = [];
  for (const match of clean.matchAll(
    /(?:^\s*#\s*define\s+|\b)([A-Z][A-Z0-9_]*)\s*(?:=\s*)?(-?(?:0[xX][0-9a-fA-F]+|0[0-7]+|[0-9]+))\b/gmu,
  )) {
    assignments.push([match[1], parseCInteger(match[2])]);
  }
  return assignments;
}

function assertAssignedSuffix(assignments, suffix, expected, category = null) {
  const candidates = assignments.filter(
    ([identifier]) =>
      (identifier === suffix ||
        (category === null
          ? identifier.endsWith(`_${suffix}`)
          : identifier.endsWith(`_${category}_${suffix}`))),
  );
  assert.deepEqual(
    candidates,
    [[candidates[0]?.[0], expected]],
    `${category ?? "literal"}:${suffix}=${expected}`,
  );
}

function preprocessCandidate(
  url,
  { fault = false, preserveLineMarkers = false } = {},
) {
  const productionPrefix = EXPECTED_PRODUCTION_ARGV.slice(
    1,
    EXPECTED_PRODUCTION_ARGV.indexOf("-c"),
  ).map((argument) => {
    if (argument === "-ffile-prefix-map=REQ_ROOT=.") {
      return `-ffile-prefix-map=${REPOSITORY_ROOT}=.`;
    }
    if (argument === "-fdebug-prefix-map=REQ_ROOT=.") {
      return `-fdebug-prefix-map=${REPOSITORY_ROOT}=.`;
    }
    return argument;
  });
  const child = spawnSync(
    "/usr/bin/cc",
    [
      ...productionPrefix,
      "-E",
      ...(preserveLineMarkers ? [] : ["-P"]),
      "-dD",
      ...(fault ? ["-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1"] : []),
      url.href === SOURCE_URL.href
        ? "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c"
        : fileURLToPath(url),
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        LC_ALL: "C",
        LANG: "C",
        TZ: "UTC",
        SOURCE_DATE_EPOCH: "0",
      },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      timeout: 30000,
      windowsHide: true,
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  assert.ok(child.stdout.length > 0 && child.stdout.length <= 8 * 1024 * 1024);
  return child.stdout;
}

function assertStaticAbi(header, structName, alignment, size, fields) {
  assert.deepEqual(
    extractStructFields(header, structName),
    fields.map(([name, type]) => [name, type]),
  );
  assert.match(
    header,
    new RegExp(
      `_Static_assert\\s*\\(\\s*_Alignof\\s*\\(\\s*struct\\s+${structName}\\s*\\)\\s*==\\s*${alignment}\\b`,
      "u",
    ),
  );
  assert.match(
    header,
    new RegExp(
      `_Static_assert\\s*\\(\\s*sizeof\\s*\\(\\s*struct\\s+${structName}\\s*\\)\\s*==\\s*${size}\\b`,
      "u",
    ),
  );
  for (const [field, , offset] of fields) {
    assert.match(
      header,
      new RegExp(
        `_Static_assert\\s*\\(\\s*(?:__builtin_)?offsetof\\s*\\(\\s*struct\\s+${structName}\\s*,\\s*${field}\\s*\\)\\s*==\\s*${offset}\\b`,
        "u",
      ),
    );
  }
}

function reportedArgv(compilerRealpath, privateBuildRoot, child, basename) {
  return EXPECTED_PRODUCTION_ARGV.map((argument) => {
    if (argument === "/usr/bin/cc") return compilerRealpath;
    if (argument === "-ffile-prefix-map=REQ_ROOT=.") {
      return `-ffile-prefix-map=${REPOSITORY_ROOT}=.`;
    }
    if (argument === "-fdebug-prefix-map=REQ_ROOT=.") {
      return `-fdebug-prefix-map=${REPOSITORY_ROOT}=.`;
    }
    if (argument === "OUTPUT_OBJECT") {
      return join(privateBuildRoot, child, basename);
    }
    return argument;
  });
}

function assertInsidePrivateRoot(pathname, privateBuildRoot) {
  const projected = relative(privateBuildRoot, pathname);
  assert.notEqual(projected, "");
  assert.equal(projected.startsWith(`..${sep}`), false);
  assert.equal(resolve(privateBuildRoot, projected), pathname);
}

async function assertRegularSource(url, maximumBytes) {
  const status = await lstat(url, { bigint: true });
  assert.equal(status.isSymbolicLink(), false);
  assert.equal(status.isFile(), true);
  const bytes = await readFile(url);
  assert.ok(bytes.length > 0 && bytes.length <= maximumBytes);
  return bytes;
}

function checkedRange(bytes, offset, length, label) {
  assert.ok(Number.isSafeInteger(offset) && offset >= 0, `${label}:offset`);
  assert.ok(Number.isSafeInteger(length) && length >= 0, `${label}:length`);
  assert.ok(offset + length <= bytes.length, `${label}:bounds`);
}

function boundedU64(bytes, offset, label) {
  checkedRange(bytes, offset, 8, label);
  const value = bytes.readBigUInt64LE(offset);
  assert.ok(value <= BigInt(Number.MAX_SAFE_INTEGER), `${label}:safe`);
  return Number(value);
}

function asciiCString(bytes, offset, label) {
  assert.ok(Number.isSafeInteger(offset) && offset >= 0, `${label}:offset`);
  assert.ok(offset < bytes.length, `${label}:bounds`);
  const end = bytes.indexOf(0, offset);
  assert.ok(end >= offset, `${label}:nul`);
  const value = bytes.subarray(offset, end).toString("latin1");
  assert.match(value, /^[\x20-\x7e]*$/u, label);
  return value;
}

function executableSectionExtents(bytes) {
  checkedRange(bytes, 0, 64, "elf-header");
  assert.deepEqual(
    [...bytes.subarray(0, 7)],
    [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1],
  );
  assert.equal(bytes.readUInt16LE(16), 1, "ET_REL");
  assert.equal(bytes.readUInt16LE(18), 62, "EM_X86_64");
  const sectionOffset = boundedU64(bytes, 40, "section-table");
  const sectionEntrySize = bytes.readUInt16LE(58);
  const sectionCount = bytes.readUInt16LE(60);
  const sectionNameIndex = bytes.readUInt16LE(62);
  assert.equal(sectionEntrySize, 64);
  assert.ok(sectionCount >= 1 && sectionCount <= 256);
  assert.ok(sectionNameIndex > 0 && sectionNameIndex < sectionCount);
  checkedRange(
    bytes,
    sectionOffset,
    sectionEntrySize * sectionCount,
    "section-table",
  );

  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * sectionEntrySize;
    sections.push({
      nameOffset: bytes.readUInt32LE(offset),
      type: bytes.readUInt32LE(offset + 4),
      flags: boundedU64(bytes, offset + 8, `section-${index}-flags`),
      address: boundedU64(bytes, offset + 16, `section-${index}-address`),
      offset: boundedU64(bytes, offset + 24, `section-${index}-offset`),
      size: boundedU64(bytes, offset + 32, `section-${index}-size`),
    });
  }
  const namesSection = sections[sectionNameIndex];
  checkedRange(
    bytes,
    namesSection.offset,
    namesSection.size,
    "section-name-table",
  );
  const names = bytes.subarray(
    namesSection.offset,
    namesSection.offset + namesSection.size,
  );
  const executable = [];
  for (const [index, section] of sections.entries()) {
    if ((section.flags & 0x4) === 0 || section.size === 0) continue;
    assert.notEqual(section.type, 8, `section-${index}:executable-nobits`);
    checkedRange(bytes, section.offset, section.size, `section-${index}:bytes`);
    executable.push(
      Object.freeze({
        name: asciiCString(names, section.nameOffset, `section-${index}-name`),
        address: section.address,
        size: section.size,
      }),
    );
  }
  assert.ok(executable.length > 0, "nonempty-executable-section");
  assert.equal(
    new Set(executable.map(({ name }) => name)).size,
    executable.length,
  );
  return Object.freeze(executable);
}

function parseElf64Relocatable(bytes) {
  assert.ok(Buffer.isBuffer(bytes));
  checkedRange(bytes, 0, 64, "elf-header");
  assert.deepEqual(
    [...bytes.subarray(0, 7)],
    [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1],
  );
  assert.equal(bytes.readUInt16LE(16), 1, "ET_REL");
  assert.equal(bytes.readUInt16LE(18), 62, "EM_X86_64");
  assert.equal(bytes.readUInt16LE(52), 64, "ELF64 header size");

  const sectionOffset = boundedU64(bytes, 40, "section-table");
  const sectionEntrySize = bytes.readUInt16LE(58);
  const sectionCount = bytes.readUInt16LE(60);
  const sectionNameIndex = bytes.readUInt16LE(62);
  assert.equal(sectionEntrySize, 64);
  assert.ok(sectionCount >= 1 && sectionCount <= 256);
  assert.ok(sectionNameIndex > 0 && sectionNameIndex < sectionCount);
  checkedRange(
    bytes,
    sectionOffset,
    sectionEntrySize * sectionCount,
    "section-table",
  );

  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * sectionEntrySize;
    sections.push({
      index,
      nameOffset: bytes.readUInt32LE(offset),
      type: bytes.readUInt32LE(offset + 4),
      flags: boundedU64(bytes, offset + 8, `section-${index}-flags`),
      offset: boundedU64(bytes, offset + 24, `section-${index}-offset`),
      size: boundedU64(bytes, offset + 32, `section-${index}-size`),
      link: bytes.readUInt32LE(offset + 40),
      info: bytes.readUInt32LE(offset + 44),
      entrySize: boundedU64(bytes, offset + 56, `section-${index}-entry-size`),
    });
  }

  const sectionNameSection = sections[sectionNameIndex];
  checkedRange(
    bytes,
    sectionNameSection.offset,
    sectionNameSection.size,
    "section-name-table",
  );
  const sectionNames = bytes.subarray(
    sectionNameSection.offset,
    sectionNameSection.offset + sectionNameSection.size,
  );
  for (const section of sections) {
    section.name = asciiCString(
      sectionNames,
      section.nameOffset,
      `section-${section.index}-name`,
    );
    if (section.type !== 8) {
      checkedRange(
        bytes,
        section.offset,
        section.size,
        section.name || "section-0",
      );
    }
  }

  const symbolTables = new Map();
  const definedGlobalSymbols = [];
  const undefinedSymbols = [];
  let totalSymbols = 0;
  for (const section of sections.filter(({ type }) => type === 2)) {
    assert.equal(section.entrySize, 24);
    assert.equal(section.size % section.entrySize, 0);
    assert.ok(section.link < sections.length);
    const stringSection = sections[section.link];
    checkedRange(
      bytes,
      stringSection.offset,
      stringSection.size,
      `${section.name}:strings`,
    );
    const strings = bytes.subarray(
      stringSection.offset,
      stringSection.offset + stringSection.size,
    );
    const symbols = [];
    const count = section.size / section.entrySize;
    totalSymbols += count;
    assert.ok(totalSymbols <= 512);
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * section.entrySize;
      const name = asciiCString(
        strings,
        bytes.readUInt32LE(offset),
        `${section.name}:symbol-${index}`,
      );
      const info = bytes[offset + 4];
      const sectionIndex = bytes.readUInt16LE(offset + 6);
      const symbol = {
        name,
        binding: info >> 4,
        type: info & 0x0f,
        sectionIndex,
      };
      symbols.push(symbol);
      if (name !== "" && sectionIndex === 0) undefinedSymbols.push(name);
      if (name !== "" && sectionIndex !== 0 && symbol.binding !== 0) {
        definedGlobalSymbols.push(name);
      }
    }
    symbolTables.set(section.index, symbols);
  }

  const relocationTargets = [];
  let relocationCount = 0;
  for (const section of sections.filter(
    ({ type }) => type === 4 || type === 9,
  )) {
    const expectedEntrySize = section.type === 4 ? 24 : 16;
    assert.equal(section.entrySize, expectedEntrySize);
    assert.equal(section.size % section.entrySize, 0);
    const symbols = symbolTables.get(section.link);
    assert.notEqual(symbols, undefined, `${section.name}:symbol-table`);
    const count = section.size / section.entrySize;
    relocationCount += count;
    assert.ok(relocationCount <= 4096);
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * section.entrySize;
      const info = bytes.readBigUInt64LE(offset + 8);
      const symbolIndex = Number(info >> 32n);
      assert.ok(symbolIndex < symbols.length);
      const symbol = symbols[symbolIndex];
      if (symbolIndex === 0) continue;
      const targetSection = sections[symbol.sectionIndex];
      const target = symbol.name || targetSection?.name;
      assert.ok(typeof target === "string" && target.length > 0);
      assert.ok(
        (symbol.binding === 0 && symbol.sectionIndex !== 0) ||
          (targetSection !== undefined && (targetSection.flags & 0x1) === 0),
        `${section.name}:${target}`,
      );
      relocationTargets.push(target);
    }
  }

  const stack = sections.find(({ name }) => name === ".note.GNU-stack");
  assert.notEqual(stack, undefined);
  const writableExecutableSectionCount = sections.filter(
    ({ flags }) => (flags & 0x1) !== 0 && (flags & 0x4) !== 0,
  ).length;
  assert.equal(
    sections.some(({ name, size }) => /^\.plt(?:\.|$)/u.test(name) && size > 0),
    false,
  );

  return Object.freeze({
    elfClass: "ELF64",
    elfData: "LSB",
    elfType: "REL",
    elfMachine: "AMD64",
    definedGlobalSymbols: Object.freeze(
      [...new Set(definedGlobalSymbols)].sort(),
    ),
    undefinedSymbols: Object.freeze([...new Set(undefinedSymbols)].sort()),
    pltEntries: Object.freeze([]),
    relocationTargets: Object.freeze([...new Set(relocationTargets)].sort()),
    gnuStackExecutable: (stack.flags & 0x4) !== 0,
    writableExecutableSectionCount,
  });
}

function registerFamily(register) {
  const lower = register.toLowerCase();
  const legacy = new Map([
    ["rax", "rax"],
    ["eax", "rax"],
    ["ax", "rax"],
    ["al", "rax"],
    ["ah", "rax"],
    ["rbx", "rbx"],
    ["ebx", "rbx"],
    ["bx", "rbx"],
    ["bl", "rbx"],
    ["bh", "rbx"],
    ["rcx", "rcx"],
    ["ecx", "rcx"],
    ["cx", "rcx"],
    ["cl", "rcx"],
    ["ch", "rcx"],
    ["rdx", "rdx"],
    ["edx", "rdx"],
    ["dx", "rdx"],
    ["dl", "rdx"],
    ["dh", "rdx"],
    ["rsi", "rsi"],
    ["esi", "rsi"],
    ["si", "rsi"],
    ["sil", "rsi"],
    ["rdi", "rdi"],
    ["edi", "rdi"],
    ["di", "rdi"],
    ["dil", "rdi"],
    ["rbp", "rbp"],
    ["ebp", "rbp"],
    ["bp", "rbp"],
    ["bpl", "rbp"],
    ["rsp", "rsp"],
    ["esp", "rsp"],
    ["sp", "rsp"],
    ["spl", "rsp"],
  ]);
  if (legacy.has(lower)) return legacy.get(lower);
  const numbered = /^r(8|9|1[0-5])(?:d|w|b)?$/u.exec(lower);
  return numbered === null ? null : `r${numbered[1]}`;
}

function registerWidth(register) {
  const lower = register.toLowerCase();
  if (/^(?:r(?:ax|bx|cx|dx|si|di|bp|sp)|r(?:8|9|1[0-5]))$/u.test(lower)) {
    return 64;
  }
  if (/^(?:e(?:ax|bx|cx|dx|si|di|bp|sp)|r(?:8|9|1[0-5])d)$/u.test(lower)) {
    return 32;
  }
  if (/^(?:ax|bx|cx|dx|si|di|bp|sp|r(?:8|9|1[0-5])w)$/u.test(lower)) {
    return 16;
  }
  return 8;
}

function directBranchTarget(operands) {
  const match = /^(?:0x)?([0-9a-f]+)\b/iu.exec(operands);
  return match === null ? null : Number.parseInt(match[1], 16);
}

function instructionIdentity(instruction) {
  return `${instruction.sectionName ?? ".text"}:${instruction.address}`;
}

function buildControlFlow(instructions, label, controlTransferTargets) {
  const identityToIndex = new Map();
  const groups = new Map();
  for (const [index, instruction] of instructions.entries()) {
    const identity = instructionIdentity(instruction);
    assert.equal(identityToIndex.has(identity), false, `${label}:${identity}`);
    identityToIndex.set(identity, index);
    const groupKey = `${instruction.sectionName ?? ".text"}:${instruction.functionName}`;
    const group = groups.get(groupKey) ?? [];
    if (group.length > 0) {
      assert.ok(
        instruction.address > instructions[group.at(-1)].address,
        `${label}:${groupKey}:instruction-order`,
      );
    }
    group.push(index);
    groups.set(groupKey, group);
  }
  const nextByIndex = new Map();
  const sections = new Map();
  for (const [index, instruction] of instructions.entries()) {
    const sectionName = instruction.sectionName ?? ".text";
    const section = sections.get(sectionName) ?? [];
    if (section.length > 0) {
      assert.ok(
        instruction.address > instructions[section.at(-1)].address,
        `${label}:${sectionName}:instruction-order`,
      );
    }
    section.push(index);
    sections.set(sectionName, section);
  }
  for (const section of sections.values()) {
    for (let index = 0; index + 1 < section.length; index += 1) {
      nextByIndex.set(section[index], section[index + 1]);
    }
  }
  const targetIndex = (source, target) => {
    const sectionName = target.sectionName ?? source.sectionName ?? ".text";
    const identity = `${sectionName}:${target.address}`;
    const index = identityToIndex.get(identity);
    assert.notEqual(index, undefined, `${label}:branch-target:${identity}`);
    return index;
  };
  const successors = instructions.map((instruction, index) => {
    const conditional =
      /^j(?!mp$)/u.test(instruction.mnemonic) ||
      /^loop/u.test(instruction.mnemonic);
    if (
      /^ret/u.test(instruction.mnemonic) ||
      /^(?:hlt|ud2)$/u.test(instruction.mnemonic)
    ) {
      return [];
    }
    if (instruction.mnemonic === "jmp" || conditional) {
      const targetAddress = directBranchTarget(instruction.operands);
      const branchSuccessors = [];
      if (targetAddress === null) {
        assert.equal(conditional, false, `${label}:indirect-conditional`);
        const exactTargets =
          controlTransferTargets.get(instructionIdentity(instruction)) ?? [];
        for (const target of exactTargets) {
          branchSuccessors.push(
            targetIndex(
              instruction,
              typeof target === "number"
                ? Object.freeze({ address: target })
                : target,
            ),
          );
        }
        assert.ok(branchSuccessors.length > 0, `${label}:indirect-targets`);
      } else {
        const exactTargets = controlTransferTargets.get(
          instructionIdentity(instruction),
        );
        if (exactTargets === undefined) {
          branchSuccessors.push(
            targetIndex(instruction, Object.freeze({ address: targetAddress })),
          );
        } else {
          for (const target of exactTargets) {
            branchSuccessors.push(targetIndex(instruction, target));
          }
        }
      }
      if (conditional) {
        const fallthrough = nextByIndex.get(index);
        assert.notEqual(fallthrough, undefined, `${label}:fallthrough`);
        branchSuccessors.push(fallthrough);
      }
      return Object.freeze([...new Set(branchSuccessors)]);
    }
    const fallthrough = nextByIndex.get(index);
    assert.notEqual(
      fallthrough,
      undefined,
      `${label}:unterminated-control-flow`,
    );
    return Object.freeze([fallthrough]);
  });
  const targetedGroups = new Set();
  for (const [sourceIndex, branchSuccessors] of successors.entries()) {
    const source = instructions[sourceIndex];
    const sourceGroup = `${source.sectionName ?? ".text"}:${source.functionName}`;
    for (const index of branchSuccessors) {
      const instruction = instructions[index];
      const targetGroup = `${instruction.sectionName ?? ".text"}:${instruction.functionName}`;
      if (targetGroup !== sourceGroup) targetedGroups.add(targetGroup);
    }
  }
  const roots = [];
  for (const [groupKey, group] of groups) {
    if (!targetedGroups.has(groupKey)) roots.push(group[0]);
  }
  if (roots.length === 0 && instructions.length > 0) roots.push(0);
  return {
    roots: Object.freeze(roots),
    successorsFor: (index) => successors[index],
  };
}

function maximumReachableStackAllocation(
  instructions,
  limit = 256,
  jumpTableTargets = new Map(),
) {
  const { roots, successorsFor } = buildControlFlow(
    instructions,
    "stack",
    jumpTableTargets,
  );
  let maximum = 0;
  const incoming = new Map();
  const queue = roots.map((index) => ({ index, depth: 0, rbpDepth: null }));
  while (true) {
    while (queue.length > 0) {
      const state = queue.shift();
      const stateKey = `${state.depth}:${state.rbpDepth ?? "unknown"}`;
      const prior = incoming.get(state.index) ?? new Set();
      if (prior.has(stateKey)) continue;
      prior.add(stateKey);
      incoming.set(state.index, prior);
      const instruction = instructions[state.index];
      const functionName = instruction.functionName;
      const operands = instruction.operands
        .split(",")
        .map((value) => value.trim());
      const compact = instruction.operands.replace(/\s+/gu, "");
      const first = operands[0] ?? "";
      const firstFamily = registerFamily(first);
      let depth = state.depth;
      let rbpDepth = state.rbpDepth;

      for (const memory of compact.matchAll(/\[([^\]]+)\]/gu)) {
        const stackRegister = /\b(rsp|esp|rbp|ebp)\b/u.exec(memory[1]);
        if (stackRegister === null) continue;
        assert.ok(stackRegister[1] === "rsp" || stackRegister[1] === "rbp");
        const base = stackRegister[1] === "rsp" ? depth : rbpDepth;
        assert.notEqual(
          base,
          null,
          `${functionName}:${instruction.address}:unknown-stack-base`,
        );
        const exact = new RegExp(
          `^${stackRegister[1]}(?:([+-])(0x[0-9a-f]+|[0-9]+))?$`,
          "u",
        ).exec(memory[1]);
        assert.notEqual(
          exact,
          null,
          `${functionName}:${instruction.address}:dynamic-stack-reference`,
        );
        const displacement =
          exact[2] === undefined ? 0 : Number.parseInt(exact[2], 0);
        const referenced =
          exact[1] === "-"
            ? base + displacement
            : Math.max(0, base - displacement);
        maximum = Math.max(maximum, referenced);
      }

      const stackImmediate = /^(?:rsp|esp),(0x[0-9a-f]+|[0-9]+)$/u.exec(
        compact,
      );
      const stackLea =
        /^(?:rsp|esp),\[(rsp|esp|rbp|ebp)([+-])(0x[0-9a-f]+|[0-9]+)\]$/u.exec(
          compact,
        );
      const rbpLea =
        /^(?:rbp|ebp),\[(?:rsp|esp)([+-])(0x[0-9a-f]+|[0-9]+)\]$/u.exec(
          compact,
        );
      assert.notEqual(instruction.mnemonic, "call", `${functionName}:call`);
      assert.equal(
        instruction.mnemonic === "enter" ||
          (instruction.mnemonic === "xchg" &&
            operands.some((value) => {
              const family = registerFamily(value);
              return family === "rsp" || family === "rbp";
            })),
        false,
        `${functionName}:${instruction.address}:unmodelled-stack-write`,
      );
      if (/^push(?:f|fq)?$/u.test(instruction.mnemonic)) {
        depth += 8;
      } else if (/^pop(?:f|fq)?$/u.test(instruction.mnemonic)) {
        assert.notEqual(firstFamily, "rsp");
        assert.ok(depth >= 8, `${functionName}:stack-underflow`);
        depth -= 8;
        if (firstFamily === "rbp") rbpDepth = null;
      } else if (instruction.mnemonic === "sub" && firstFamily === "rsp") {
        assert.equal(first, "rsp", `${functionName}:stack-register-width`);
        assert.notEqual(stackImmediate, null, `${functionName}:dynamic-sub`);
        depth += Number.parseInt(stackImmediate[1], 0);
      } else if (instruction.mnemonic === "add" && firstFamily === "rsp") {
        assert.equal(first, "rsp", `${functionName}:stack-register-width`);
        assert.notEqual(stackImmediate, null, `${functionName}:dynamic-add`);
        const adjustment = Number.parseInt(stackImmediate[1], 0);
        assert.ok(depth >= adjustment, `${functionName}:stack-underflow`);
        depth -= adjustment;
      } else if (instruction.mnemonic === "lea" && firstFamily === "rsp") {
        assert.equal(first, "rsp", `${functionName}:stack-register-width`);
        assert.notEqual(stackLea, null, `${functionName}:unresolved-rsp-lea`);
        assert.ok(stackLea[1] === "rsp" || stackLea[1] === "rbp");
        const base = stackLea[1] === "rsp" ? depth : rbpDepth;
        assert.notEqual(base, null, `${functionName}:unknown-rbp`);
        const adjustment = Number.parseInt(stackLea[3], 0);
        depth = stackLea[2] === "-" ? base + adjustment : base - adjustment;
        assert.ok(depth >= 0, `${functionName}:stack-underflow`);
      } else if (instruction.mnemonic === "mov" && firstFamily === "rsp") {
        assert.equal(first, "rsp", `${functionName}:stack-register-width`);
        assert.equal(compact, "rsp,rbp", `${functionName}:rsp-mov`);
        assert.notEqual(rbpDepth, null, `${functionName}:unknown-rbp`);
        depth = rbpDepth;
      } else if (instruction.mnemonic === "leave") {
        assert.notEqual(rbpDepth, null, `${functionName}:unknown-rbp`);
        assert.ok(rbpDepth >= 8, `${functionName}:stack-underflow`);
        depth = rbpDepth - 8;
        rbpDepth = null;
      } else if (instruction.mnemonic === "mov" && firstFamily === "rbp") {
        assert.equal(first, "rbp", `${functionName}:frame-register-width`);
        rbpDepth = compact === "rbp,rsp" ? depth : null;
      } else if (instruction.mnemonic === "lea" && firstFamily === "rbp") {
        assert.equal(first, "rbp", `${functionName}:frame-register-width`);
        assert.notEqual(rbpLea, null, `${functionName}:unresolved-rbp-lea`);
        const adjustment = Number.parseInt(rbpLea[2], 0);
        rbpDepth = rbpLea[1] === "-" ? depth + adjustment : depth - adjustment;
        assert.ok(rbpDepth >= 0, `${functionName}:stack-underflow`);
      } else if (
        firstFamily === "rsp" &&
        !new Set(["bt", "cmp", "jmp", "push", "test"]).has(instruction.mnemonic)
      ) {
        assert.fail(
          `${functionName}:${instruction.address}:unmodelled-rsp-write`,
        );
      } else if (
        firstFamily === "rbp" &&
        !new Set(["bt", "cmp", "push", "test"]).has(instruction.mnemonic)
      ) {
        rbpDepth = null;
      }
      maximum = Math.max(maximum, depth, rbpDepth ?? 0);
      assert.ok(maximum <= limit, `${functionName}:stack-limit`);

      const isReturn = /^ret/u.test(instruction.mnemonic);
      if (isReturn) {
        assert.equal(depth, 0, `${functionName}:unbalanced-return`);
      }
      const successors = successorsFor(state.index);
      for (const index of successors) queue.push({ index, depth, rbpDepth });
    }
    const unvisited = instructions.findIndex(
      (_instruction, index) => !incoming.has(index),
    );
    if (unvisited === -1) break;
    queue.push({ index: unvisited, depth: 0, rbpDepth: null });
  }
  assert.equal(incoming.size, instructions.length, "stack:complete-coverage");
  return maximum;
}

function reachableDirectSyscalls(instructions) {
  const syscallNumbers = [];
  let siteCount = 0;
  for (const [index, site] of instructions.entries()) {
    if (site.mnemonic !== "syscall") continue;
    siteCount += 1;
    assert.ok(index > 0, `${instructionIdentity(site)}:syscall-number-load`);
    const load = instructions[index - 1];
    assert.equal(load.sectionName, site.sectionName);
    assert.equal(load.functionName, site.functionName);
    assert.equal(
      load.address + load.byteLength,
      site.address,
      `${instructionIdentity(site)}:immediate-number-load`,
    );
    assert.match(load.mnemonic, /^(?:mov|movabs)$/u);
    const immediate = /^(?:eax|rax),(0x[0-9a-f]+|[0-9]+)$/u.exec(load.operands);
    assert.notEqual(
      immediate,
      null,
      `${instructionIdentity(site)}:syscall-number-load`,
    );
    syscallNumbers.push(Number.parseInt(immediate[1], 0));
  }
  return Object.freeze({
    directSyscallInstructionCount: siteCount,
    observedSyscallNumbers: Object.freeze(
      [...new Set(syscallNumbers)].sort((left, right) => left - right),
    ),
  });
}

function assertOnlyAuditedKernelTransfers(instructions) {
  const forbidden =
    /^(?:int(?:1|3)?|into|sysenter|sysexit|sysretq?|iret[dlq]?|lcall|ljmp|callf|jmpf|vmcall|vmmcall|rsm|smi|hlt|cli|sti|cpuid|rdtsc|rdtscp|rdpmc|rdrand|rdseed|rdmsr|wrmsr|xgetbv|xsetbv|swapgs|in(?:b|w|l|s[bwl]?)?|out(?:b|w|l|s[bwl]?)?)$/u;
  for (const instruction of instructions) {
    assert.doesNotMatch(
      instruction.mnemonic,
      forbidden,
      `${instructionIdentity(instruction)}:alternate-kernel-transfer`,
    );
  }
}

function parseRelocationExpression(value) {
  const match = /^(\.[a-zA-Z0-9_.-]+?)(?:([+-])0x([0-9a-f]+))?$/u.exec(value);
  if (match === null) return null;
  const magnitude = Number.parseInt(match[3] ?? "0", 16);
  const addend = match[2] === "-" ? -magnitude : magnitude;
  assert.ok(Number.isSafeInteger(addend));
  return Object.freeze({ targetSection: match[1], addend });
}

function parseElfRelocations(output) {
  const relocations = [];
  let sourceSection = null;
  for (const line of output.split("\n")) {
    const section = /^RELOCATION RECORDS FOR \[(.+)\]:$/u.exec(line);
    if (section !== null) {
      sourceSection = section[1];
      continue;
    }
    const record = /^\s*([0-9a-f]+)\s+(R_X86_64_[A-Z0-9_]+)\s+(\S+)\s*$/u.exec(
      line,
    );
    if (record === null || sourceSection === null) continue;
    const expression = parseRelocationExpression(record[3]);
    relocations.push(
      Object.freeze({
        sourceSection,
        offset: Number.parseInt(record[1], 16),
        type: record[2],
        rawTarget: record[3],
        targetSection: expression?.targetSection ?? null,
        addend: expression?.addend ?? null,
      }),
    );
  }
  return Object.freeze(relocations);
}

function parseJumpTableLoad(operands, targetFamily, baseFamily) {
  const compact = operands.replace(/\s+/gu, "");
  const match = /^([a-z0-9]+),dwordptr\[([^\]]+)\]$/u.exec(compact);
  if (
    match === null ||
    registerFamily(match[1]) !== targetFamily ||
    registerWidth(match[1]) !== 64
  ) {
    return null;
  }
  const terms = match[2].split("+");
  if (terms.length !== 2) return null;
  const baseTerms = terms.filter(
    (term) => registerFamily(term) === baseFamily && registerWidth(term) === 64,
  );
  const indexTerms = terms.flatMap((term) => {
    const index = /^([a-z0-9]+)\*4$/u.exec(term);
    const family = index === null ? null : registerFamily(index[1]);
    return family === null || registerWidth(index[1]) !== 64
      ? []
      : [Object.freeze({ family, register: index[1] })];
  });
  return baseTerms.length === 1 && indexTerms.length === 1
    ? indexTerms[0]
    : null;
}

function provenNonClobberingInstruction(instruction, protectedFamilies) {
  if (
    /^(?:cmp|test|bt|nop|endbr64|cld|std|clc|stc|cmc|lfence|mfence|sfence)$/u.test(
      instruction.mnemonic,
    )
  ) {
    return true;
  }
  if (
    /^(?:j[a-z]*|loop[a-z]*|ret|call|syscall|leave)$/u.test(
      instruction.mnemonic,
    )
  ) {
    return false;
  }
  if (
    !/^(?:mov|movabs|movsx|movsxd|movzx|lea|add|sub|adc|sbb|and|or|xor|shl|shr|sar|sal|rol|ror|inc|dec|neg|not|cmov[a-z]+|set[a-z]+|bsf|bsr|popcnt|tzcnt|lzcnt)$/u.test(
      instruction.mnemonic,
    )
  ) {
    return false;
  }
  const destination = instruction.operands.split(",", 1)[0].trim();
  const destinationFamily = registerFamily(destination);
  return (
    destinationFamily !== null && !protectedFamilies.has(destinationFamily)
  );
}

function findPriorInstruction(
  group,
  startIndex,
  protectedFamilies,
  predicate,
  label,
) {
  for (let index = startIndex; index >= 0; index -= 1) {
    const instruction = group[index];
    const value = predicate(instruction);
    if (value !== null) return Object.freeze({ index, instruction, value });
    assert.equal(
      provenNonClobberingInstruction(instruction, protectedFamilies),
      true,
      label,
    );
  }
  assert.fail(label);
}

function bindIndirectJumpTables(instructions, relocations) {
  const byFunction = new Map();
  for (const instruction of instructions) {
    const key = `${instruction.sectionName ?? ".text"}:${instruction.functionName}`;
    const group = byFunction.get(key) ?? [];
    group.push(instruction);
    byFunction.set(key, group);
  }

  const controlTransferTargets = new Map();
  for (const instruction of instructions) {
    if (!/^(?:j[a-z]*|loop[a-z]*)$/u.test(instruction.mnemonic)) continue;
    const direct = directBranchTarget(instruction.operands);
    const end = instruction.address + (instruction.byteLength ?? 0);
    const branchRelocations = relocations.filter(
      (relocation) =>
        relocation.sourceSection === (instruction.sectionName ?? ".text") &&
        relocation.offset >= instruction.address &&
        relocation.offset < end,
    );
    if (direct === null) {
      assert.deepEqual(
        branchRelocations,
        [],
        `${instructionIdentity(instruction)}:relocated-indirect-transfer`,
      );
      continue;
    }
    if (branchRelocations.length === 0) {
      controlTransferTargets.set(
        instructionIdentity(instruction),
        Object.freeze([
          Object.freeze({
            sectionName: instruction.sectionName ?? ".text",
            address: direct,
          }),
        ]),
      );
      continue;
    }
    assert.equal(branchRelocations.length, 1);
    const relocation = branchRelocations[0];
    assert.equal(relocation.type, "R_X86_64_PC32");
    assert.equal(typeof relocation.targetSection, "string");
    assert.equal(typeof relocation.addend, "number");
    assert.match(relocation.targetSection, /^\.text(?:\.|$)/u);
    assert.equal(end - relocation.offset, 4);
    const address = relocation.addend + end - relocation.offset;
    assert.ok(Number.isSafeInteger(address) && address >= 0);
    controlTransferTargets.set(
      instructionIdentity(instruction),
      Object.freeze([
        Object.freeze({ sectionName: relocation.targetSection, address }),
      ]),
    );
  }
  const tables = [];
  for (const [functionName, group] of byFunction) {
    for (let index = 0; index < group.length; index += 1) {
      const branch = group[index];
      if (
        branch.mnemonic !== "jmp" ||
        directBranchTarget(branch.operands) !== null
      ) {
        continue;
      }
      const targetFamily = registerFamily(branch.operands.trim());
      assert.notEqual(targetFamily, null, `${functionName}:indirect-register`);
      assert.equal(
        registerWidth(branch.operands.trim()),
        64,
        `${functionName}:indirect-register-width`,
      );
      assert.notEqual(targetFamily, "rsp", `${functionName}:table-target-rsp`);
      const addMatch = findPriorInstruction(
        group,
        index - 1,
        new Set([targetFamily]),
        (instruction) => {
          if (instruction.mnemonic !== "add") return null;
          const operands = instruction.operands
            .split(",")
            .map((operand) => operand.trim());
          if (registerFamily(operands[0] ?? "") !== targetFamily) return null;
          const baseFamily = registerFamily(operands[1] ?? "");
          return baseFamily === null ||
            registerWidth(operands[0] ?? "") !== 64 ||
            registerWidth(operands[1] ?? "") !== 64
            ? null
            : baseFamily;
        },
        `${functionName}:table-add-flow`,
      );
      const baseFamily = addMatch.value;
      assert.equal(
        new Set(["rsp", "rbp"]).has(baseFamily),
        false,
        `${functionName}:table-base-stack-register`,
      );
      const loadMatch = findPriorInstruction(
        group,
        addMatch.index - 1,
        new Set([targetFamily, baseFamily]),
        (instruction) => {
          if (instruction.mnemonic !== "movsxd") return null;
          return parseJumpTableLoad(
            instruction.operands,
            targetFamily,
            baseFamily,
          );
        },
        `${functionName}:table-load-flow`,
      );
      assert.notEqual(
        baseFamily,
        targetFamily,
        `${functionName}:table-base-target-alias`,
      );
      assert.notEqual(
        baseFamily,
        loadMatch.value.family,
        `${functionName}:table-base-index-alias`,
      );
      const leaMatch = findPriorInstruction(
        group,
        loadMatch.index - 1,
        new Set([baseFamily]),
        (instruction) => {
          if (instruction.mnemonic !== "lea") return null;
          const operands = instruction.operands
            .split(",")
            .map((operand) => operand.trim());
          if (
            registerFamily(operands[0] ?? "") !== baseFamily ||
            registerWidth(operands[0] ?? "") !== 64
          ) {
            return null;
          }
          return /^\[rip(?:[+-](?:0x[0-9a-f]+|[0-9]+))?\]$/u.test(
            operands.slice(1).join(","),
          )
            ? true
            : null;
        },
        `${functionName}:table-base-flow`,
      );
      const lea = leaMatch.instruction;
      assert.ok(leaMatch.index >= 2, `${functionName}:table-range-guard`);
      const guard = group[leaMatch.index - 1];
      const comparison = group[leaMatch.index - 2];
      assert.match(guard.mnemonic, /^jae?$/u);
      assert.notEqual(directBranchTarget(guard.operands), null);
      assert.equal(comparison.mnemonic, "cmp");
      const comparisonOperands = comparison.operands
        .split(",")
        .map((operand) => operand.trim());
      assert.equal(
        registerFamily(comparisonOperands[0] ?? ""),
        loadMatch.value.family,
      );
      const comparisonWidth = registerWidth(comparisonOperands[0]);
      assert.ok(comparisonWidth >= 32);
      const guardLimitMatch = /^(?:0x[0-9a-f]+|[0-9]+)$/u.exec(
        comparisonOperands[1] ?? "",
      );
      assert.notEqual(
        guardLimitMatch,
        null,
        `${functionName}:table-range-limit`,
      );
      const guardLimit = Number.parseInt(guardLimitMatch[0], 0);
      let addressIndexIsZeroExtended = comparisonWidth === 64;
      for (
        let cursor = leaMatch.index - 1;
        cursor < loadMatch.index;
        cursor += 1
      ) {
        if (cursor === leaMatch.index - 1) continue;
        const candidate = group[cursor];
        const selfMove =
          /^(e(?:ax|bx|cx|dx|si|di|bp|sp)|r(?:8|9|1[0-5])d),\1$/u.exec(
            candidate.operands,
          );
        if (
          candidate.mnemonic === "mov" &&
          selfMove !== null &&
          registerFamily(selfMove[1]) === loadMatch.value.family
        ) {
          addressIndexIsZeroExtended = true;
          continue;
        }
        assert.equal(
          provenNonClobberingInstruction(
            candidate,
            new Set([loadMatch.value.family]),
          ),
          true,
          `${functionName}:table-index-clobber`,
        );
      }
      assert.equal(
        addressIndexIsZeroExtended,
        true,
        `${functionName}:table-index-address-width`,
      );
      assert.ok(
        Number.isSafeInteger(lea.byteLength) && lea.byteLength > 0,
        `${functionName}:table-lea-length`,
      );
      const leaEnd = lea.address + lea.byteLength;
      const baseRelocations = relocations.filter(
        (relocation) =>
          relocation.sourceSection === (lea.sectionName ?? ".text") &&
          relocation.offset >= lea.address &&
          relocation.offset < leaEnd &&
          typeof relocation.targetSection === "string" &&
          /^\.rodata(?:\.|$)/u.test(relocation.targetSection),
      );
      assert.equal(
        baseRelocations.length,
        1,
        `${functionName}:table-base-relocation`,
      );
      const baseRelocation = baseRelocations[0];
      assert.equal(baseRelocation.type, "R_X86_64_PC32");
      assert.equal(leaEnd - baseRelocation.offset, 4);
      const baseOffset = baseRelocation.addend + leaEnd - baseRelocation.offset;
      assert.ok(
        Number.isSafeInteger(baseOffset) &&
          baseOffset >= 0 &&
          baseOffset % 4 === 0,
        `${functionName}:table-base-offset`,
      );
      tables.push(
        Object.freeze({
          branch,
          tableSection: baseRelocation.targetSection,
          baseOffset,
          guardKind: guard.mnemonic,
          guardLimit,
          group,
          sliceInterior: Object.freeze(
            group
              .slice(leaMatch.index - 1, index + 1)
              .map(({ address }) => address),
          ),
        }),
      );
    }
  }

  const tableRanges = tables.map((table) => {
    const entryCount =
      table.guardKind === "ja" ? table.guardLimit + 1 : table.guardLimit;
    assert.ok(
      Number.isSafeInteger(entryCount) && entryCount >= 1 && entryCount <= 4096,
      `${instructionIdentity(table.branch)}:table-entry-count`,
    );
    return Object.freeze({
      table,
      start: table.baseOffset,
      end: table.baseOffset + entryCount * 4,
      entryCount,
    });
  });
  const relocationsBySectionAndOffset = new Map();
  const tableSections = new Set(tables.map(({ tableSection }) => tableSection));
  for (const relocation of relocations) {
    if (!tableSections.has(relocation.sourceSection)) continue;
    const section = relocationsBySectionAndOffset.get(relocation.sourceSection);
    const offsets = section ?? new Map();
    assert.equal(
      offsets.has(relocation.offset),
      false,
      `${relocation.sourceSection}:${relocation.offset}:duplicate-relocation`,
    );
    offsets.set(relocation.offset, relocation);
    if (section === undefined) {
      relocationsBySectionAndOffset.set(relocation.sourceSection, offsets);
    }
  }

  for (const { table, entryCount } of tableRanges) {
    const offsets =
      relocationsBySectionAndOffset.get(table.tableSection) ?? new Map();
    const expectedOffsets = Object.freeze(
      Array.from(
        { length: entryCount },
        (_unused, index) => table.baseOffset + index * 4,
      ),
    );
    const actualRangeOffsets = [...offsets.keys()]
      .filter(
        (offset) =>
          offset >= table.baseOffset &&
          offset < table.baseOffset + entryCount * 4,
      )
      .sort((left, right) => left - right);
    assert.deepEqual(
      actualRangeOffsets,
      expectedOffsets,
      `${instructionIdentity(table.branch)}:table-relocation-range`,
    );
    const targets = [];
    for (const offset of expectedOffsets) {
      const relocation = offsets.get(offset);
      assert.notEqual(relocation, undefined);
      assert.equal(relocation.type, "R_X86_64_PC32");
      assert.equal(typeof relocation.targetSection, "string");
      assert.equal(typeof relocation.addend, "number");
      assert.match(relocation.targetSection, /^\.text(?:\.|$)/u);
      const address = relocation.addend - offset + table.baseOffset;
      assert.ok(Number.isSafeInteger(address) && address >= 0);
      targets.push(
        Object.freeze({
          sectionName: relocation.targetSection,
          address,
        }),
      );
    }
    assert.ok(
      targets.length > 0,
      `${instructionIdentity(table.branch)}:empty-table`,
    );
    assert.equal(
      table.guardLimit,
      table.guardKind === "ja" ? targets.length - 1 : targets.length,
      `${instructionIdentity(table.branch)}:table-range-guard`,
    );
    controlTransferTargets.set(
      instructionIdentity(table.branch),
      Object.freeze(
        [
          ...new Map(
            targets.map((target) => [
              `${target.sectionName}:${target.address}`,
              target,
            ]),
          ).values(),
        ].sort(
          (left, right) =>
            left.sectionName.localeCompare(right.sectionName) ||
            left.address - right.address,
        ),
      ),
    );
  }

  const allControlTargets = [];
  for (const instruction of instructions) {
    if (!/^(?:j[a-z]*|loop[a-z]*)$/u.test(instruction.mnemonic)) continue;
    for (const target of controlTransferTargets.get(
      instructionIdentity(instruction),
    ) ?? []) {
      allControlTargets.push(target);
    }
  }
  for (const table of tables) {
    for (const target of allControlTargets) {
      if (target.sectionName !== (table.branch.sectionName ?? ".text"))
        continue;
      assert.equal(
        table.sliceInterior.includes(target.address),
        false,
        `${instructionIdentity(table.branch)}:mid-slice-entry`,
      );
    }
  }
  return controlTransferTargets;
}

function elfRelocationsFromObject(objectPath) {
  const child = spawnSync("/usr/bin/objdump", ["-r", "-w", objectPath], {
    cwd: REPOSITORY_ROOT,
    env: {
      LC_ALL: "C",
      LANG: "C",
      TZ: "UTC",
      SOURCE_DATE_EPOCH: "0",
    },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  return parseElfRelocations(child.stdout);
}

function parseObjectDisassembly(output) {
  const instructions = [];
  let currentFunction = null;
  let currentSection = null;
  for (const line of output.split("\n")) {
    const sectionMatch = /^Disassembly of section (.+):$/u.exec(line);
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1];
      currentFunction = null;
      continue;
    }
    const functionMatch = /^\s*[0-9a-f]+\s+<([^>]+)>:$/u.exec(line);
    if (functionMatch !== null) {
      currentFunction = functionMatch[1];
      continue;
    }
    const instructionMatch =
      /^\s*([0-9a-f]+):\s+((?:(?:[0-9a-f]{2})\s+)+)\s*([a-z][a-z0-9.]*)\s*(.*?)\s*$/iu.exec(
        line,
      );
    if (instructionMatch === null) continue;
    assert.notEqual(currentFunction, null);
    assert.notEqual(currentSection, null);
    let mnemonic = instructionMatch[3].toLowerCase();
    let operands = instructionMatch[4].split("#", 1)[0].trim().toLowerCase();
    while (
      /^(?:notrack|bnd|data16|addr32|lock|xacquire|xrelease|rep|repz|repnz|cs|ds|es|fs|gs|ss|rex(?:\.[a-z])?)$/u.test(
        mnemonic,
      )
    ) {
      const prefixedInstruction = /^([a-z][a-z0-9.]*)\b\s*(.*)$/u.exec(
        operands,
      );
      assert.notEqual(prefixedInstruction, null, "orphan-instruction-prefix");
      mnemonic = prefixedInstruction[1];
      operands = prefixedInstruction[2].trim();
    }
    instructions.push(
      Object.freeze({
        sectionName: currentSection,
        functionName: currentFunction,
        address: Number.parseInt(instructionMatch[1], 16),
        byteLength: instructionMatch[2].trim().split(/\s+/u).length,
        mnemonic,
        operands,
      }),
    );
  }
  assert.ok(instructions.length > 0);
  return Object.freeze(instructions);
}

function assertExactExecutableDisassembly(instructions, executableSections) {
  const expectedNames = executableSections.map(({ name }) => name).sort();
  const actualNames = [
    ...new Set(instructions.map(({ sectionName }) => sectionName)),
  ].sort();
  assert.deepEqual(actualNames, expectedNames, "executable-section-set");
  for (const section of executableSections) {
    const sectionInstructions = instructions
      .filter(({ sectionName }) => sectionName === section.name)
      .sort((left, right) => left.address - right.address);
    assert.ok(sectionInstructions.length > 0, `${section.name}:decoded`);
    let cursor = section.address;
    for (const instruction of sectionInstructions) {
      assert.equal(
        instruction.address,
        cursor,
        `${section.name}:${cursor}:undecoded-executable-byte`,
      );
      assert.ok(
        Number.isSafeInteger(instruction.byteLength) &&
          instruction.byteLength > 0,
        `${section.name}:${cursor}:instruction-length`,
      );
      cursor += instruction.byteLength;
      assert.ok(
        cursor <= section.address + section.size,
        `${section.name}:${cursor}:instruction-overrun`,
      );
    }
    assert.equal(
      cursor,
      section.address + section.size,
      `${section.name}:trailing-undecoded-executable-byte`,
    );
  }
}

function independentlyDisassembleObject(objectPath, objectBytes) {
  const child = spawnSync(
    "/usr/bin/objdump",
    ["-d", "-z", "-w", "-M", "intel", objectPath],
    {
      cwd: REPOSITORY_ROOT,
      env: {
        LC_ALL: "C",
        LANG: "C",
        TZ: "UTC",
        SOURCE_DATE_EPOCH: "0",
      },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      timeout: 30000,
      windowsHide: true,
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  assert.ok(child.stdout.length > 0 && child.stdout.length <= 8 * 1024 * 1024);

  const instructions = parseObjectDisassembly(child.stdout);
  assertExactExecutableDisassembly(
    instructions,
    executableSectionExtents(objectBytes),
  );
  assertOnlyAuditedKernelTransfers(instructions);

  const relocations = elfRelocationsFromObject(objectPath);
  const indirectBranchTargets = bindIndirectJumpTables(
    instructions,
    relocations,
  );

  const maximumStackAllocationBytes = maximumReachableStackAllocation(
    instructions,
    256,
    indirectBranchTargets,
  );

  const syscallProjection = reachableDirectSyscalls(instructions);

  return Object.freeze({
    instructionCount: instructions.length,
    callInstructionCount: instructions.filter(
      ({ mnemonic }) => mnemonic === "call",
    ).length,
    maximumStackAllocationBytes,
    ...syscallProjection,
  });
}

async function independentlyInspectProductionObjects(privateBuildRoot, report) {
  const expectedLayout = Object.freeze([
    Object.freeze([
      "production-0001",
      "containment-guardian-statefs-syscalls-v1.o",
    ]),
    Object.freeze([
      "production-0002",
      "containment-guardian-statefs-syscalls-v1.o",
    ]),
  ]);
  assert.deepEqual((await readdir(privateBuildRoot)).sort(), [
    "production-0001",
    "production-0002",
  ]);
  const objectBytes = [];
  const objectPaths = [];
  for (const [directory, basename] of expectedLayout) {
    const directoryPath = join(privateBuildRoot, directory);
    const directoryStatus = await lstat(directoryPath, { bigint: true });
    assert.equal(directoryStatus.isDirectory(), true);
    assert.equal(directoryStatus.isSymbolicLink(), false);
    assert.equal(Number(directoryStatus.mode & 0o777n), 0o700);
    assert.deepEqual(await readdir(directoryPath), [basename]);
    const objectPath = join(directoryPath, basename);
    objectPaths.push(objectPath);
    const objectStatus = await lstat(objectPath, { bigint: true });
    assert.equal(objectStatus.isFile(), true);
    assert.equal(objectStatus.isSymbolicLink(), false);
    assert.ok(objectStatus.size > 0n && objectStatus.size <= 1048576n);
    objectBytes.push(await readFile(objectPath));
  }
  assert.deepEqual(objectBytes[1], objectBytes[0]);
  assert.equal(report.firstObjectByteLength, objectBytes[0].length);
  assert.equal(report.firstObjectSha256, sha256(objectBytes[0]));
  assert.equal(report.secondObjectByteLength, objectBytes[1].length);
  assert.equal(report.secondObjectSha256, sha256(objectBytes[1]));

  const projection = parseElf64Relocatable(objectBytes[0]);
  for (const field of [
    "elfClass",
    "elfData",
    "elfType",
    "elfMachine",
    "definedGlobalSymbols",
    "undefinedSymbols",
    "pltEntries",
    "relocationTargets",
    "gnuStackExecutable",
    "writableExecutableSectionCount",
  ]) {
    assert.deepEqual(report[field], projection[field], field);
  }
  assert.deepEqual(projection.definedGlobalSymbols, [
    "oxigraph_containment_statefs_execute_v1",
  ]);
  assert.deepEqual(projection.undefinedSymbols, []);
  assert.equal(projection.gnuStackExecutable, false);
  assert.equal(projection.writableExecutableSectionCount, 0);
  const disassembly = independentlyDisassembleObject(
    objectPaths[0],
    objectBytes[0],
  );
  assert.ok(disassembly.instructionCount > 0);
  assert.equal(disassembly.callInstructionCount, 0);
  assert.ok(disassembly.maximumStackAllocationBytes <= 256);
  assert.equal(disassembly.directSyscallInstructionCount, 13);
  assert.deepEqual(
    disassembly.observedSyscallNumbers,
    EXPECTED_SYSCALLS.map(([, number]) => number),
  );
  assert.equal(
    report.directSyscallInstructionCount,
    disassembly.directSyscallInstructionCount,
  );
  assert.deepEqual(
    report.observedSyscallNumbers,
    disassembly.observedSyscallNumbers,
  );
}

function assertProductionReport(
  report,
  privateBuildRoot,
  sourceBytes,
  headerBytes,
) {
  assert.deepEqual(Object.keys(report), EXPECTED_REPORT_FIELDS);
  assert.equal(
    report.schema,
    "oxigraph.candidate-containment-guardian-statefs-syscalls-attestation/v1",
  );
  assert.equal(report.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(report.buildKind, "PRODUCTION");
  assert.equal(report.platform, "linux-x86_64-sysv-little-endian");
  assert.equal(report.compilerRealpath, resolve(report.compilerRealpath));
  assert.ok(Number.isSafeInteger(report.compilerByteLength));
  assert.ok(report.compilerByteLength > 0);
  assert.match(report.compilerSha256, /^[0-9a-f]{64}$/u);
  assert.ok(
    Number.isSafeInteger(report.compilerVersionByteLength) &&
      report.compilerVersionByteLength >= 1 &&
      report.compilerVersionByteLength <= 65536,
  );
  assert.match(report.compilerVersionSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    report.firstProductionArgv,
    reportedArgv(
      report.compilerRealpath,
      privateBuildRoot,
      "production-0001",
      "containment-guardian-statefs-syscalls-v1.o",
    ),
  );
  assert.deepEqual(
    report.secondProductionArgv,
    reportedArgv(
      report.compilerRealpath,
      privateBuildRoot,
      "production-0002",
      "containment-guardian-statefs-syscalls-v1.o",
    ),
  );
  assert.equal(report.faultArgv, null);
  assert.deepEqual(report.environment, EXPECTED_ENVIRONMENT);
  assert.equal(report.headerByteLength, headerBytes.length);
  assert.equal(report.headerSha256, sha256(headerBytes));
  assert.equal(report.sourceByteLength, sourceBytes.length);
  assert.equal(report.sourceSha256, sha256(sourceBytes));
  assert.ok(report.firstObjectByteLength > 0);
  assert.ok(report.firstObjectByteLength <= 1048576);
  assert.equal(report.secondObjectByteLength, report.firstObjectByteLength);
  assert.match(report.firstObjectSha256, /^[0-9a-f]{64}$/u);
  assert.equal(report.secondObjectSha256, report.firstObjectSha256);
  assert.equal(report.repeatedObjectBytesEqual, true);
  assert.equal(report.faultObjectByteLength, null);
  assert.equal(report.faultObjectSha256, null);
  assert.equal(report.faultInspection, null);
  assert.equal(report.elfClass, "ELF64");
  assert.equal(report.elfData, "LSB");
  assert.equal(report.elfType, "REL");
  assert.equal(report.elfMachine, "AMD64");
  assert.deepEqual(report.definedGlobalSymbols, [
    "oxigraph_containment_statefs_execute_v1",
  ]);
  assert.deepEqual(report.undefinedSymbols, []);
  assert.deepEqual(report.pltEntries, []);
  assertDenseSortedUniqueAscii(report.relocationTargets);
  assert.equal(report.gnuStackExecutable, false);
  assert.equal(report.writableExecutableSectionCount, 0);
  assert.equal(report.directSyscallInstructionCount, 13);
  assert.deepEqual(
    report.observedSyscallNumbers,
    EXPECTED_SYSCALLS.map(([, number]) => number),
  );
  assert.equal(report.abiLayoutSha256, EXPECTED_ABI_LAYOUT_SHA256);
  assert.equal(report.faultSelectorPresent, false);
  assert.equal(
    report.reportSha256,
    digestPrecedingFields(report, "reportSha256", EXPECTED_REPORT_FIELDS),
  );
  assert.deepEqual(report.authority, EXPECTED_AUTHORITY);
  assert.deepEqual(report.physicalFacts, EXPECTED_PHYSICAL_FACTS);
  assert.deepEqual(report.nonclaims, EXPECTED_NONCLAIMS);
  assertDeepFrozenNullPrototype(report);
}

function exactMissingAttestationError(error, { sourcePresent }) {
  const expectedMessage = `Cannot find module '${fileURLToPath(
    ATTESTATION_URL,
  )}' imported from ${EVALUATOR_PATH}`;
  const exactBase =
    sourcePresent === false &&
    error !== null &&
    typeof error === "object" &&
    error.code === "ERR_MODULE_NOT_FOUND";
  if (!exactBase) return false;
  if (error.url !== undefined) return error.url === ATTESTATION_URL.href;
  return error.message === expectedMessage;
}

async function filePresence(url) {
  try {
    const status = await lstat(url);
    return Object.freeze({ present: true, regular: status.isFile() });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return Object.freeze({ present: false, regular: false });
  }
}

const sourceTriplet = await Promise.all(
  [HEADER_URL, SOURCE_URL, ATTESTATION_URL].map(filePresence),
);
const presentSourceCount = sourceTriplet.filter(
  ({ present }) => present,
).length;
if (presentSourceCount !== 0 && presentSourceCount !== sourceTriplet.length) {
  throw new Error("STATEFS_EVALUATOR_PARTIAL_SOURCE_TRIPLET");
}
if (presentSourceCount === sourceTriplet.length) {
  assert.deepEqual(
    sourceTriplet.map(({ regular }) => regular),
    [true, true, true],
  );
}

let attestation = null;
let attestationImportError = null;
let attestationImportAttempts = 0;
try {
  attestationImportAttempts += 1;
  attestation = await import(ATTESTATION_URL.href);
} catch (error) {
  if (
    !exactMissingAttestationError(error, {
      sourcePresent: sourceTriplet[2].present,
    })
  ) {
    throw error;
  }
  attestationImportError = error;
}

function candidateTest(name, body) {
  test(
    name,
    { skip: attestation === null ? "candidate source absent" : false },
    body,
  );
}

let privateBuildRoot;

test.after(async () => {
  if (privateBuildRoot !== undefined) {
    await rm(privateBuildRoot, { force: true, recursive: true });
  }
});

test("literal build, ABI, UAPI, syscall, and authority oracle is internally closed", () => {
  assert.deepEqual(Object.keys(EXPECTED_BUILD_REQUIREMENTS), [
    "schema",
    "version",
    "platform",
    "header",
    "source",
    "entrypoint",
    "outputObjects",
    "limits",
    "abi",
    "productionArgv",
    "faultArgvDelta",
    "environment",
    "pathRules",
    "allowedSyscalls",
    "elfRules",
    "reportFields",
    "repeatCount",
    "authority",
    "physicalFacts",
    "nonclaims",
  ]);
  assert.equal(
    semanticSha256(EXPECTED_BUILD_REQUIREMENTS),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    semanticSha256(EXPECTED_ABI.slice(0, 3)),
    EXPECTED_ABI_LAYOUT_SHA256,
  );
  assert.equal(
    semanticSha256(EXPECTED_OPERATION_SHAPES),
    EXPECTED_OPERATION_SHAPES_SHA256,
  );
  assert.equal(semanticSha256(EXPECTED_UAPI), EXPECTED_UAPI_SHA256);
  assert.equal(semanticSha256(EXPECTED_OPERATIONS), EXPECTED_OPERATIONS_SHA256);
  assert.deepEqual(EXPECTED_LIMITS.at(-1), ["directSyscallInstructions", 13]);
  assert.deepEqual(
    EXPECTED_SYSCALLS.map(([, number]) => number),
    [0, 1, 3, 72, 73, 74, 138, 217, 257, 258, 263, 316, 332],
  );
  assert.deepEqual(Object.values(EXPECTED_AUTHORITY), Array(10).fill(false));
  assert.deepEqual(
    Object.values(EXPECTED_PHYSICAL_FACTS),
    Array(12).fill(null),
  );
  assertDeepFrozenNullPrototype(EXPECTED_BUILD_REQUIREMENTS);
});

test("pins the accepted S0 ADR and unchanged harness package bytes", async () => {
  for (const [url, byteLength, expectedSha256] of PREDECESSOR_BYTE_PINS) {
    const bytes = await readFile(url);
    assert.equal(bytes.length, byteLength, fileURLToPath(url));
    assert.equal(sha256(bytes), expectedSha256, fileURLToPath(url));
  }
});

test("ADR pin correction inversely reconstructs accepted S3 syscall evaluator", async () => {
  const acceptedEvaluatorBytes = 128349;
  const acceptedEvaluatorLines = 3966;
  const acceptedEvaluatorSha256 =
    "75e137eb8c4882479687ec2ce9319b7f074b64f965b14db6d28fd0d136701a34";
  const acceptedEvaluatorGitBlob =
    "6dd49c0ae1a9cfeafeb941f2b22b9d5b4ab97a0f";
  const acceptedTestInventory = Object.freeze([
    "literal build, ABI, UAPI, syscall, and authority oracle is internally closed",
    "pins the accepted S0 ADR and unchanged harness package bytes",
    "exports only the three frozen attestation identities",
    "freezes the complete build requirements and ABI digest independently",
    "freezes all eight operations and ten exact request-shape variants",
    "header fixes all three layouts, enum values, UAPI literals, and entrypoint",
    "C source is one direct-syscall translation unit with no ambient authority",
    "production attestation binds deterministic objects, ELF, ABI, and source bytes",
    "build contract enforces BOUNDS before SHAPE before PATH and rejects caller overrides",
    "attestation source declares the exact error vocabulary and contains no ambient effects",
    "literal oracle fixes production nullability and report digest boundaries",
    "local byte-array audit rejects fixed and variable stack scratch without rejecting ABI members",
    "instruction audit follows reachable stack paths and rejects unmodelled stack writes",
    "missing-module attribution rejects wrong code, URL, message, and present source",
    "reports only the exact source-absent attestation import RED",
  ]);
  const currentAdrPin = [
    "    ADR_URL,",
    "    204827,",
    '    "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",',
  ].join("\n");
  const acceptedAdrPin = [
    "    ADR_URL,",
    "    202635,",
    '    "35a9d8990a67f4a9c332d6a32d47314d19ea73c474610efab240a2cf80b7f97d",',
  ].join("\n");
  const correctedAssignmentMatcher = [
    "function assertAssignedSuffix(assignments, suffix, expected, category = null) {",
    "  const candidates = assignments.filter(",
    "    ([identifier]) =>",
    "      (identifier === suffix ||",
    "        (category === null",
    "          ? identifier.endsWith(`_${suffix}`)",
    "          : identifier.endsWith(`_${category}_${suffix}`))),",
    "  );",
    "  assert.deepEqual(",
    "    candidates,",
    "    [[candidates[0]?.[0], expected]],",
    "    `${category ?? \"literal\"}:${suffix}=${expected}`,",
    "  );",
    "}",
  ].join("\n");
  const acceptedAssignmentMatcher = [
    "function assertAssignedSuffix(assignments, suffix, expected, category = null) {",
    "  const candidates = assignments.filter(",
    "    ([identifier]) =>",
    "      (identifier === suffix || identifier.endsWith(`_${suffix}`)) &&",
    "      (category === null || identifier.includes(category)),",
    "  );",
    "  assert.deepEqual(",
    "    candidates,",
    "    [[candidates[0]?.[0], expected]],",
    "    `${category ?? \"literal\"}:${suffix}=${expected}`,",
    "  );",
    "}",
  ].join("\n");
  const overlappingEffectAssignments = Object.freeze([
    Object.freeze(["OXIGRAPH_STATEFS_EFFECT_NO_EFFECT", 0]),
    Object.freeze(["OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT", 1]),
    Object.freeze(["OXIGRAPH_STATEFS_EFFECT_COMPLETE", 2]),
  ]);
  assertAssignedSuffix(overlappingEffectAssignments, "NO_EFFECT", 0, "EFFECT");
  assertAssignedSuffix(
    overlappingEffectAssignments,
    "DEFINITE_NO_EFFECT",
    1,
    "EFFECT",
  );
  const correctionStart =
    '\n\ntest("ADR pin correction inversely reconstructs accepted S3 syscall evaluator", async () => {\n';
  const correctionEnd =
    '\n\ncandidateTest("exports only the three frozen attestation identities", () => {\n';

  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactly = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, label);
    return source.replace(before, after);
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start`);
    assert.equal(countExact(source, end), 1, `${label} end`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };
  const gitBlobSha1 = (bytes) =>
    createHash("sha1")
      .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
      .update(bytes)
      .digest("hex");

  const currentEvaluatorBytes = await readFile(EVALUATOR_PATH);
  const currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");
  assert.equal(
    Buffer.from(currentEvaluatorSource, "utf8").equals(currentEvaluatorBytes),
    true,
  );
  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(
    reconstructPreR14D1P2AdrRepinSource(currentEvaluatorSource),
  );
  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(
    preR13EvaluatorSource,
    [
      '\n\ntest("R8 fixed-register and syscall-immediate correction ',
      'inversely reconstructs the pre-R8 syscall evaluator", async () => {\n',
    ].join(""),
    '\n\ncandidateTest("exports only the three frozen attestation identities", () => {\n',
  );
  acceptedEvaluatorSource = replaceExactly(
    acceptedEvaluatorSource,
    currentAdrPin,
    acceptedAdrPin,
    "current ADR pin replacement count",
  );
  acceptedEvaluatorSource = replaceExactly(
    acceptedEvaluatorSource,
    correctedAssignmentMatcher,
    acceptedAssignmentMatcher,
    "effect assignment matcher correction count",
  );
  acceptedEvaluatorSource = removeRangeExactly(
    acceptedEvaluatorSource,
    correctionStart,
    correctionEnd,
    "correction proof removal",
  );
  const reconstructedBytes = Buffer.from(acceptedEvaluatorSource, "utf8");
  assert.equal(reconstructedBytes.length, acceptedEvaluatorBytes);
  assert.equal(countExact(acceptedEvaluatorSource, "\n"), acceptedEvaluatorLines);
  assert.equal(sha256(reconstructedBytes), acceptedEvaluatorSha256);
  assert.equal(gitBlobSha1(reconstructedBytes), acceptedEvaluatorGitBlob);
  assert.equal(countExact(acceptedEvaluatorSource, currentAdrPin), 0);
  assert.equal(countExact(acceptedEvaluatorSource, acceptedAdrPin), 1);
  assert.deepEqual(
    [
      ...acceptedEvaluatorSource.matchAll(
        /(?:^|\n)(?:test|candidateTest)\(\s*"([^"\n]+)"/gu,
      ),
    ].map((match) => match[1]),
    acceptedTestInventory,
  );
});

const EXPECTED_STATX_OBSERVATION_CONTRACT = deepFreeze(
  orderedRecord([
    ["requiredMask", 0x17ff],
    ["absentMask", 0],
    ["additionalMaskBits", "retained"],
    ["rawNameBytes", "0x01-0x7f-excluding-slash-dot-dotdot"],
    [
      "failurePrefixes",
      [
        ["FD_A_VALIDATED", "zero"],
        ["FD_B_VALIDATED", "zero"],
        ["INTERNAL_DESCRIPTOR_OPENED", "zero"],
        ["DIRECTORY_ENUMERATED", "target-only"],
        ["ENTRY_REOBSERVED", "zero"],
        ["MUTATION_REOBSERVATION", "prior-canonical-slots-only"],
      ],
    ],
    ["incompleteSlots", "zero"],
  ]),
);

function extractNamedCFunctionBody(source, functionName) {
  const clean = stripCStringAndCharacterLiterals(stripCComments(source));
  const matches = [
    ...clean.matchAll(
      new RegExp(
        `(?:^|\\n)[^\\n;{}]*\\b${functionName}\\s*\\([^;{}]*\\)\\s*\\{`,
        "gu",
      ),
    ),
  ];
  assert.equal(matches.length, 1, `${functionName} definition`);
  const open = matches[0].index + matches[0][0].lastIndexOf("{");
  let depth = 1;
  let close = open + 1;
  for (; close < clean.length && depth > 0; close += 1) {
    if (clean[close] === "{") depth += 1;
    if (clean[close] === "}") depth -= 1;
  }
  assert.equal(depth, 0, `${functionName} closing brace`);
  return clean.slice(open + 1, close - 1);
}

function assertStatxObservationSourceContract(source) {
  assert.match(
    source,
    /\bSTATEFS_ALWAYS_INLINE\s+int\s+statefs_observe_statx\s*\(/u,
  );
  const observeBody = extractNamedCFunctionBody(
    source,
    "statefs_observe_statx",
  );
  const requiredMaskGuard = /if\s*\(\s*\(\s*statefs_workspace\.statx\.mask\s*&\s*\(uint32_t\)\s*\(\s*OXIGRAPH_STATEFS_STATX_BASIC_STATS\s*\|\s*OXIGRAPH_STATEFS_STATX_MNT_ID\s*\)\s*\)\s*!=\s*\(uint32_t\)\s*\(\s*OXIGRAPH_STATEFS_STATX_BASIC_STATS\s*\|\s*OXIGRAPH_STATEFS_STATX_MNT_ID\s*\)\s*\)\s*return\s+0\s*;/gu;
  const guards = [...observeBody.matchAll(requiredMaskGuard)];
  assert.equal(guards.length, 1, "one complete required-mask guard");
  const firstGovernedRead = Math.min(
    ...[
      "mode",
      "device_major",
      "device_minor",
      "inode",
      "mount_id",
      "byte_length",
      "link_count",
      "owner_uid",
      "owner_gid",
    ].map((field) => observeBody.indexOf(`statefs_workspace.statx.${field}`)),
  );
  assert.ok(firstGovernedRead >= 0);
  assert.ok(guards[0].index < firstGovernedRead, "mask before governed fields");
  const fullMaskCopies = [
    ...observeBody.matchAll(
      /\bobservation->statx_mask\s*=\s*statefs_workspace\.statx\.mask\s*;/gu,
    ),
  ];
  assert.equal(fullMaskCopies.length, 1, "one full statx mask copy");
  assert.ok(guards[0].index < fullMaskCopies[0].index);
  assert.doesNotMatch(observeBody, /\bobservation->flags\b/u);
  assert.match(observeBody, /\breturn\s+1\s*;\s*$/u);

  const absentBody = extractNamedCFunctionBody(
    source,
    "statefs_observe_absent",
  );
  assert.match(
    absentBody,
    /\bstatefs_zero\s*\(\s*\(uint8_t\s*\*\)\s*observation\s*,\s*384U\s*\)\s*;/u,
  );
  const absentMaskAssignments = [
    ...absentBody.matchAll(/\bstatx_mask\s*=\s*([^;]+)\s*;/gu),
  ];
  assert.ok(absentMaskAssignments.length <= 1);
  for (const assignment of absentMaskAssignments) {
    assert.match(assignment[1], /^\s*0U\s*$/u);
  }
  assert.doesNotMatch(absentBody, /\bflags\s*=/u);

  const executeBody = extractNamedCFunctionBody(
    source,
    "oxigraph_containment_statefs_execute_v1",
  );
  const observationZero = executeBody.search(
    /\bstatefs_zero\s*\(\s*\(uint8_t\s*\*\)\s*observations\s*,\s*\(uint64_t\)\s*request->observation_capacity\s*\*\s*384U\s*\)\s*;/u,
  );
  assert.ok(observationZero >= 0, "complete observation buffer zeroing");
  assert.ok(
    observationZero < executeBody.indexOf("statefs_issue_syscall:"),
    "observation buffers zero before syscall dispatch",
  );
  assert.equal(
    [...executeBody.matchAll(/\bstatefs_observe_statx\s*\(/gu)].length,
    13,
    "all thirteen statx publication sites",
  );
  assert.equal(
    [
      ...executeBody.matchAll(
        /\bif\s*\(\s*!\s*statefs_observe_statx\s*\(/gu,
      ),
    ].length,
    13,
    "every publication site checks mask success before advancing",
  );
  const failBody = extractNamedCFunctionBody(source, "statefs_fail");
  assert.doesNotMatch(failBody, /\bobservation_count\b/u);
  assert.doesNotMatch(failBody, /\bobservations\b/u);
}

function reconstructPreR13S3SyscallEvaluatorSource(source) {
  const count = (value, needle) => {
    assert.notEqual(needle.length, 0);
    let matches = 0;
    let offset = 0;
    while (true) {
      const index = value.indexOf(needle, offset);
      if (index === -1) return matches;
      matches += 1;
      offset = index + needle.length;
    }
  };
  const replaceOne = (value, before, after, label) => {
    assert.equal(count(value, before), 1, label);
    return value.replace(before, after);
  };
  const newAdrPin = [
    "    ADR_URL,",
    "    216620,",
    '    "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",',
  ].join("\n");
  const oldAdrPin = [
    "    ADR_URL,",
    "    204827,",
    '    "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",',
  ].join("\n");
  const oldAdrInverseEntry = [
    "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
    "    currentEvaluatorSource,",
  ].join("\n");
  const newAdrInverseEntry = [
    "  const preR13EvaluatorSource = reconstructPreR13S3SyscallEvaluatorSource(",
    "    currentEvaluatorSource,",
    "  );",
    "  let acceptedEvaluatorSource = reconstructPreR8EvaluatorSource(",
    "    preR13EvaluatorSource,",
  ].join("\n");
  const oldR8InverseEntry = [
    '  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);',
    "  const reconstructedSource = reconstructPreR8EvaluatorSource(",
    "    currentSource,",
  ].join("\n");
  const newR8InverseEntry = [
    '  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);',
    "  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(currentSource);",
    "  const reconstructedSource = reconstructPreR8EvaluatorSource(",
    "    preR13Source,",
  ].join("\n");
  const blockStart =
    "\n\nconst EXPECTED_STATX_OBSERVATION_CONTRACT = deepFreeze(\n";
  const blockEnd = [
    '\n\ntest("R8 fixed-register and syscall-immediate correction ',
    'inversely reconstructs the pre-R8 syscall evaluator", async () => {\n',
  ].join("");
  assert.equal(count(source, blockStart), 1, "R13 block start");
  assert.equal(count(source, blockEnd), 1, "R13 block end");
  const startIndex = source.indexOf(blockStart);
  const endIndex = source.indexOf(blockEnd, startIndex + blockStart.length);
  assert.ok(endIndex > startIndex, "R13 block order");
  let reconstructed = `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  reconstructed = replaceOne(reconstructed, newAdrPin, oldAdrPin, "ADR repin");
  reconstructed = replaceOne(
    reconstructed,
    '["statx_mask", "uint32_t", 76]',
    '["flags", "uint32_t", 76]',
    "observation field rename",
  );
  reconstructed = replaceOne(
    reconstructed,
    '"fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70"',
    '"16756669b08e3898380065d27a8e3e0ad6e4eaaaf7a3a9d445f9506385a9ac23"',
    "requirements digest",
  );
  reconstructed = replaceOne(
    reconstructed,
    '"651ae0afeedca00a87275030238afe7788cb8852acb2f060f44f711712b041a0"',
    '"f69c11d17c0264b2af3eaee0e092bb27ce149207425f8239879d85f1ca589ffd"',
    "ABI digest",
  );
  reconstructed = replaceOne(
    reconstructed,
    newAdrInverseEntry,
    oldAdrInverseEntry,
    "ADR inverse chain",
  );
  reconstructed = replaceOne(
    reconstructed,
    newR8InverseEntry,
    oldR8InverseEntry,
    "R8 inverse chain",
  );
  return reconstructed;
}

test("R13 statx-mask correction inversely reconstructs the exact pre-R13 syscall evaluator", async () => {
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreR13S3SyscallEvaluatorSource(
    reconstructPreR14D1P2AdrRepinSource(currentSource),
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 147416);
  assert.equal(reconstructedSource.split("\n").length - 1, 4459);
  assert.equal(
    sha256(reconstructedBytes),
    "75b60e1ebfe8322f804e715ca926cd7ed943289acc77834488cd9b019470b909",
  );
  assert.equal(
    createHash("sha1")
      .update(Buffer.from(`blob ${reconstructedBytes.length}\0`, "utf8"))
      .update(reconstructedBytes)
      .digest("hex"),
    "e07e312de2b0d7102afd9dd9f613bf495ca8cc77",
  );
});

test("literal statx-mask and complete-prefix oracle is internally closed", () => {
  assert.deepEqual(EXPECTED_STATX_OBSERVATION_CONTRACT, {
    __proto__: null,
    requiredMask: 0x17ff,
    absentMask: 0,
    additionalMaskBits: "retained",
    rawNameBytes: "0x01-0x7f-excluding-slash-dot-dotdot",
    failurePrefixes: [
      ["FD_A_VALIDATED", "zero"],
      ["FD_B_VALIDATED", "zero"],
      ["INTERNAL_DESCRIPTOR_OPENED", "zero"],
      ["DIRECTORY_ENUMERATED", "target-only"],
      ["ENTRY_REOBSERVED", "zero"],
      ["MUTATION_REOBSERVATION", "prior-canonical-slots-only"],
    ],
    incompleteSlots: "zero",
  });
  assertDeepFrozenNullPrototype(EXPECTED_STATX_OBSERVATION_CONTRACT);
});

test("statx source oracle kills incomplete masks, masked copies, and partial publication", () => {
  const publicationSites = Array(13)
    .fill("if (!statefs_observe_statx(observation)) return 0;")
    .join("\n");
  const validSource = `
    STATEFS_ALWAYS_INLINE int statefs_observe_statx(void *unused) {
      if ((statefs_workspace.statx.mask &
           (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                      OXIGRAPH_STATEFS_STATX_MNT_ID)) !=
          (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                     OXIGRAPH_STATEFS_STATX_MNT_ID)) return 0;
      statefs_zero((uint8_t *)observation, 384U);
      observation->kind = statefs_kind_from_mode((uint32_t)statefs_workspace.statx.mode);
      observation->device_major = statefs_workspace.statx.device_major;
      observation->device_minor = statefs_workspace.statx.device_minor;
      observation->inode = statefs_workspace.statx.inode;
      observation->mount_id = statefs_workspace.statx.mount_id;
      observation->byte_length = statefs_workspace.statx.byte_length;
      observation->link_count = statefs_workspace.statx.link_count;
      observation->owner_uid = statefs_workspace.statx.owner_uid;
      observation->owner_gid = statefs_workspace.statx.owner_gid;
      observation->statx_mask = statefs_workspace.statx.mask;
      return 1;
    }
    STATEFS_ALWAYS_INLINE void statefs_observe_absent(void *unused) {
      statefs_zero((uint8_t *)observation, 384U);
      observation->kind = OXIGRAPH_STATEFS_OBSERVATION_ABSENT;
    }
    void statefs_fail(void) { result->status = 1U; }
    int32_t oxigraph_containment_statefs_execute_v1(void) {
      statefs_zero((uint8_t *)observations,
                   (uint64_t)request->observation_capacity * 384U);
      ${publicationSites}
    statefs_issue_syscall:
      return 0;
    }
  `;
  assert.doesNotThrow(() => assertStatxObservationSourceContract(validSource));
  for (const mutation of [
    validSource.replaceAll("OXIGRAPH_STATEFS_STATX_BASIC_STATS |", ""),
    validSource.replaceAll("|\n                      OXIGRAPH_STATEFS_STATX_MNT_ID", ""),
    validSource.replace(
      "observation->statx_mask = statefs_workspace.statx.mask;",
      "observation->statx_mask = statefs_workspace.statx.mask & 0x17ffU;",
    ),
    validSource.replace(
      "observation->kind = OXIGRAPH_STATEFS_OBSERVATION_ABSENT;",
      "observation->statx_mask = 1U;\nobservation->kind = OXIGRAPH_STATEFS_OBSERVATION_ABSENT;",
    ),
    validSource.replace(
      "if (!statefs_observe_statx(observation)) return 0;",
      "statefs_observe_statx(observation);",
    ),
    validSource.replace(
      "statefs_zero((uint8_t *)observations,\n                   (uint64_t)request->observation_capacity * 384U);",
      "",
    ),
    validSource.replace(
      "void statefs_fail(void) { result->status = 1U; }",
      "void statefs_fail(void) { result->observation_count = 0U; }",
    ),
  ]) {
    assert.throws(() => assertStatxObservationSourceContract(mutation));
  }
});

candidateTest(
  "C source copies and gates complete statx evidence before publication",
  async () => {
    assertStatxObservationSourceContract(await readFile(SOURCE_URL, "utf8"));
  },
);

test("R8 fixed-register and syscall-immediate correction inversely reconstructs the pre-R8 syscall evaluator", async () => {
  assert.doesNotThrow(() =>
    assertOnlySyscallInlineAssembly(`
      long invoke(long fourth, long fifth) {
        register long argument_4 __asm__("r10") = fourth;
        register long argument_5 __asm__("r8") = fifth;
        long value;
        __asm__ volatile ("syscall"
                          : "=a" (value), "+r" (argument_4), "+r" (argument_5));
        return value;
      }
    `),
  );
  for (const number of ["0", "257", "316"]) {
    assert.doesNotThrow(() =>
      assertOnlySyscallInlineAssembly(`
        long invoke(void) {
          long value;
          __asm__ volatile ("movl $${number}, %%eax\\n\\tsyscall"
                            : "=a" (value));
          return value;
        }
      `),
    );
  }
  for (const mutation of [
    'long invoke(void) { long value; __asm__ volatile ("movl $999, %%eax\\n\\tsyscall" : "=a" (value)); return value; }',
    'long invoke(void) { long value; __asm__ volatile ("movl $0x101, %%eax\\n\\tsyscall" : "=a" (value)); return value; }',
    'long invoke(void) { long value; __asm__ volatile ("movl $257, %%rax\\n\\tsyscall" : "=a" (value)); return value; }',
    'long invoke(void) { long value; __asm__ volatile ("movl $257, %%eax\\n\\tnop\\n\\tsyscall" : "=a" (value)); return value; }',
    'long invoke(void) { long value; __asm__ volatile ("movl $257, %%eax\\n\\t" "syscall" : "=a" (value)); return value; }',
    '#define SYSCALL_TEMPLATE "movl $257, %%eax\\n\\tsyscall"\nlong invoke(void) { long value; __asm__ volatile (SYSCALL_TEMPLATE : "=a" (value)); return value; }',
    'register long argument_4 __asm__("r10") = fourth; long invoke(void) { __asm__ volatile ("syscall"); return 0; }',
    'long invoke(long fourth) { long argument_4 __asm__("r10") = fourth; __asm__ volatile ("syscall"); return argument_4; }',
    'long invoke(long fourth) { register long argument_4 asm("r10") = fourth; __asm__ volatile ("syscall"); return argument_4; }',
    'long invoke(long fourth) { register long argument_4 __asm__("r9") = fourth; __asm__ volatile ("syscall"); return argument_4; }',
    'long invoke(long fourth) { __asm__("r10"); __asm__ volatile ("syscall"); return fourth; }',
    'long invoke(long fourth) { register long argument_4 __asm__("r10") = fourth; return argument_4; }',
  ]) {
    assert.throws(
      () => assertOnlySyscallInlineAssembly(mutation),
      undefined,
      mutation,
    );
  }

  const proofStart = [
    '\n\ntest("R8 fixed-register and syscall-immediate correction ',
    'inversely reconstructs the pre-R8 syscall evaluator", async () => {\n',
  ].join("");
  const proofEnd =
    '\n\ncandidateTest("exports only the three frozen attestation identities", () => {\n';
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const preR13Source = reconstructPreR13S3SyscallEvaluatorSource(
    reconstructPreR14D1P2AdrRepinSource(currentSource),
  );
  const reconstructedSource = reconstructPreR8EvaluatorSource(
    preR13Source,
    proofStart,
    proofEnd,
  );
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 134818);
  assert.equal(
    reconstructedSource.split("\n").length - 1,
    4121,
  );
  assert.equal(
    sha256(reconstructedBytes),
    "3b8d21a57b70f0ccb6669598c851ad0cfb9aaac78bce93421e9b49c135deaf9e",
  );
  assert.equal(
    createHash("sha1")
      .update(Buffer.from(`blob ${reconstructedBytes.length}\0`, "utf8"))
      .update(reconstructedBytes)
      .digest("hex"),
    "539f331c11edb4c95b0d5df2a854bfd6903ff3b4",
  );
});

candidateTest("exports only the three frozen attestation identities", () => {
  assert.deepEqual(
    Object.keys(attestation).sort(),
    [...EXPECTED_EXPORTS].sort(),
  );
  assert.equal(
    attestation.attestCandidateContainmentGuardianStatefsSyscallsV1.length,
    1,
  );
});

candidateTest(
  "freezes the complete build requirements and ABI digest independently",
  () => {
    assert.deepEqual(
      attestation.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS,
      EXPECTED_BUILD_REQUIREMENTS,
    );
    assert.equal(
      attestation.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256,
      EXPECTED_REQUIREMENTS_SHA256,
    );
    assertDeepFrozenNullPrototype(
      attestation.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS,
    );
    assert.equal(EXPECTED_ABI.length, 4);
    assert.equal(EXPECTED_ABI_LAYOUT_SHA256.length, 64);
  },
);

test("freezes all eight operations and ten exact request-shape variants", () => {
  assert.equal(EXPECTED_OPERATIONS.length - 1, 8);
  assert.equal(EXPECTED_OPERATION_SHAPES.length, 10);
  assert.deepEqual(
    EXPECTED_OPERATIONS.map(([, value]) => value),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(EXPECTED_INVENTORY_KINDS, [
    ["NONE", 0],
    ["DIRECTORY", 1],
    ["REGULAR_FILE", 2],
  ]);
  assert.equal(EXPECTED_DIRECTORY_ROLES.length, 13);
  assert.equal(EXPECTED_OBSERVATION_KINDS.length, 9);
  assert.equal(EXPECTED_RESULT_STATUSES.length, 6);
  assert.equal(EXPECTED_EFFECT_CLASSES.length, 5);
});

candidateTest(
  "header fixes all three layouts, enum values, UAPI literals, and entrypoint",
  async () => {
    const activeHeader = preprocessCandidate(HEADER_URL);
    const activeTranslationUnit = preprocessCandidate(SOURCE_URL);
    const tracedTranslationUnit = preprocessCandidate(SOURCE_URL, {
      preserveLineMarkers: true,
    });
    const acceptedHeaderPaths = new Set([
      fileURLToPath(HEADER_URL),
      relative(REPOSITORY_ROOT, fileURLToPath(HEADER_URL)),
    ]);
    const enteredFiles = [
      ...tracedTranslationUnit.matchAll(/^#\s+[0-9]+\s+"([^"]+)"(?:\s|$)/gmu),
    ].map((match) => match[1]);
    assert.equal(
      enteredFiles.some((pathname) => acceptedHeaderPaths.has(pathname)),
      true,
      "compiled translation unit did not enter the fixed header",
    );
    for (const activeInterface of [activeHeader, activeTranslationUnit]) {
      assertStaticAbi(
        activeInterface,
        "oxigraph_containment_statefs_request_v1",
        8,
        192,
        REQUEST_FIELDS,
      );
      assertStaticAbi(
        activeInterface,
        "oxigraph_containment_statefs_observation_v1",
        8,
        384,
        OBSERVATION_FIELDS,
      );
      assertStaticAbi(
        activeInterface,
        "oxigraph_containment_statefs_result_v1",
        8,
        64,
        RESULT_FIELDS,
      );

      const assignments = cIntegerAssignments(activeInterface);
      for (const [name, value] of EXPECTED_OPERATIONS) {
        assertAssignedSuffix(assignments, name, value, "OPERATION");
      }
      for (const [name, value] of EXPECTED_INVENTORY_KINDS) {
        assertAssignedSuffix(assignments, name, value, "INVENTORY");
      }
      for (const [name, value] of EXPECTED_DIRECTORY_ROLES) {
        assertAssignedSuffix(assignments, name, value, "ROLE");
      }
      for (const [name, value] of EXPECTED_OBSERVATION_KINDS) {
        assertAssignedSuffix(assignments, name, value, "OBSERVATION");
      }
      for (const [name, value] of EXPECTED_RESULT_STATUSES) {
        assertAssignedSuffix(assignments, name, value, "STATUS");
      }
      for (const [name, value] of EXPECTED_EFFECT_CLASSES) {
        assertAssignedSuffix(assignments, name, value, "EFFECT");
      }
      for (const [name, value] of EXPECTED_UAPI) {
        assertAssignedSuffix(assignments, name, value);
      }

      assert.equal(
        [
          ...stripCComments(activeInterface).matchAll(
            /\bint32_t\s+oxigraph_containment_statefs_execute_v1\s*\(\s*const\s+struct\s+oxigraph_containment_statefs_request_v1\s*\*\s*request\s*,\s*struct\s+oxigraph_containment_statefs_result_v1\s*\*\s*result\s*\)\s*;/gu,
          ),
        ].length,
        1,
      );
    }
  },
);

candidateTest(
  "C source is one direct-syscall translation unit with no ambient authority",
  async () => {
    const [rawSource, rawHeader] = await Promise.all([
      readFile(SOURCE_URL, "utf8"),
      readFile(HEADER_URL, "utf8"),
    ]);
    const logicalRawSource = rawSource.replace(/\\(?:\r\n|\n|\r)/gu, "");
    assert.doesNotMatch(logicalRawSource, /^\s*#\s*(?:line\b|[0-9]+\s+")/gmu);
    const includes = [
      ...stripCComments(logicalRawSource).matchAll(
        /^\s*#\s*include\s*([^\n]+?)\s*$/gmu,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(includes, [
      '"containment-guardian-statefs-syscalls-v1.h"',
    ]);
    assertOnlySyscallInlineAssembly(`${rawHeader}\n${rawSource}`);
    for (const structName of [
      "oxigraph_containment_statefs_request_v1",
      "oxigraph_containment_statefs_observation_v1",
      "oxigraph_containment_statefs_result_v1",
    ]) {
      assert.doesNotMatch(
        stripCComments(logicalRawSource),
        new RegExp(`\\bstruct\\s+${structName}\\s*\\{`, "u"),
      );
    }
    const source = preprocessCandidate(SOURCE_URL);
    assertNoFunctionLocalByteArrays(source);
    assert.match(
      source,
      /\bint32_t\s+oxigraph_containment_statefs_execute_v1\s*\(/u,
    );
    for (const [name] of EXPECTED_OPERATIONS.slice(1)) {
      assert.match(source, new RegExp(`(?:^|_)${name}\\b`, "mu"));
    }
    for (const [name] of EXPECTED_SYSCALLS) {
      assert.match(source, new RegExp(`(?:^|_)${name}\\b`, "mu"));
    }
    for (const forbidden of [
      /\b(?:system|popen|fork|vfork|execve|execvpe|posix_spawn)\s*\(/u,
      /\b(?:malloc|calloc|realloc|free)\s*\(/u,
      /\b(?:getenv|setenv|putenv|unsetenv)\s*\(/u,
      /\b(?:dlopen|dlsym|socket|connect|accept|bind|listen)\s*\(/u,
      /\b(?:clock_gettime|getrandom|syslog)\s*\(/u,
      /\b(?:alloca|__builtin_alloca)\s*\(/u,
      /\bAT_FDCWD\b[^;\n]*(?:openat|statx|mkdirat|unlinkat|renameat2)/u,
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
  },
);

candidateTest(
  "production attestation binds deterministic objects, ELF, ABI, and source bytes",
  async () => {
    const [headerBytes, sourceBytes, compilerRealpath] = await Promise.all([
      assertRegularSource(HEADER_URL, 1048576),
      assertRegularSource(SOURCE_URL, 1048576),
      realpath("/usr/bin/cc"),
    ]);
    const compilerStatus = await stat(compilerRealpath, { bigint: true });
    assert.equal(compilerStatus.isFile(), true);
    const compilerVersionBytes =
      independentlyReadCompilerVersion(compilerRealpath);

    privateBuildRoot = await mkdtemp(
      join(tmpdir(), "oxigraph-statefs-attestation-production-"),
    );
    assertInsidePrivateRoot(
      join(privateBuildRoot, "production-0001", "object"),
      privateBuildRoot,
    );
    const report = await Promise.resolve(
      attestation.attestCandidateContainmentGuardianStatefsSyscallsV1({
        repositoryRoot: REPOSITORY_ROOT,
        privateBuildRoot,
        buildKind: "PRODUCTION",
      }),
    );
    assertProductionReport(report, privateBuildRoot, sourceBytes, headerBytes);
    await independentlyInspectProductionObjects(privateBuildRoot, report);
    assert.equal(report.compilerRealpath, compilerRealpath);
    assert.equal(report.compilerByteLength, Number(compilerStatus.size));
    assert.equal(
      report.compilerSha256,
      sha256(await readFile(compilerRealpath)),
    );
    assert.equal(report.compilerVersionByteLength, compilerVersionBytes.length);
    assert.equal(report.compilerVersionSha256, sha256(compilerVersionBytes));
  },
);

candidateTest(
  "build contract enforces BOUNDS before SHAPE before PATH and rejects caller overrides",
  async () => {
    const attest =
      attestation.attestCandidateContainmentGuardianStatefsSyscallsV1;
    const cases = [
      [
        {
          repositoryRoot: `/${"x".repeat(4096)}`,
          privateBuildRoot: REPOSITORY_ROOT,
          buildKind: "OTHER",
          compiler: "/bin/false",
        },
        "STATEFS_ATTEST_BOUNDS",
      ],
      [
        {
          repositoryRoot: REPOSITORY_ROOT,
          privateBuildRoot: REPOSITORY_ROOT,
          buildKind: "OTHER",
          compiler: "/bin/false",
        },
        "STATEFS_ATTEST_SHAPE",
      ],
      [
        {
          repositoryRoot: REPOSITORY_ROOT,
          privateBuildRoot: REPOSITORY_ROOT,
          buildKind: "PRODUCTION",
        },
        "STATEFS_ATTEST_PATH",
      ],
      [{}, "STATEFS_ATTEST_SHAPE"],
      [{ repositoryRoot: REPOSITORY_ROOT }, "STATEFS_ATTEST_SHAPE"],
      [
        {
          repositoryRoot: REPOSITORY_ROOT,
          privateBuildRoot: tmpdir(),
          buildKind: "PRODUCTION",
          flags: [],
        },
        "STATEFS_ATTEST_SHAPE",
      ],
      [
        {
          repositoryRoot: REPOSITORY_ROOT,
          privateBuildRoot: tmpdir(),
          buildKind: "PRODUCTION",
          callback() {},
        },
        "STATEFS_ATTEST_SHAPE",
      ],
    ];
    for (const [input, message] of cases) {
      await assert.rejects(
        Promise.resolve().then(() => attest(input)),
        { message },
      );
    }
  },
);

candidateTest(
  "attestation source declares the exact error vocabulary and contains no ambient effects",
  async () => {
    const source = await readFile(ATTESTATION_URL, "utf8");
    for (const code of [
      "STATEFS_ATTEST_BOUNDS",
      "STATEFS_ATTEST_SHAPE",
      "STATEFS_ATTEST_PATH",
      "STATEFS_ATTEST_COMPILER",
      "STATEFS_ATTEST_BUILD",
      "STATEFS_ATTEST_ELF",
      "STATEFS_ATTEST_ABI",
      "STATEFS_ATTEST_FAULT",
    ]) {
      assert.match(
        source,
        new RegExp(`(?:^|[^A-Z_])${code}(?:$|[^A-Z_])`, "mu"),
      );
    }
    assert.doesNotMatch(source, /\bshell\s*:\s*true\b/u);
    assert.doesNotMatch(source, /\bprocess\.env\b/u);
    assert.doesNotMatch(source, /\b(?:exec|execSync|fork)\s*\(/u);
    assert.doesNotMatch(
      source,
      /\b(?:fetch|WebSocket|node:https?|node:net)\b/u,
    );
    assert.doesNotMatch(
      source,
      /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/u,
    );
  },
);

test("literal oracle fixes production nullability and report digest boundaries", () => {
  assert.equal(EXPECTED_REPORT_FIELDS.indexOf("faultArgv"), 11);
  assert.equal(EXPECTED_REPORT_FIELDS.indexOf("faultInspection"), 24);
  assert.equal(EXPECTED_REPORT_FIELDS.indexOf("reportSha256"), 39);
  assert.deepEqual(EXPECTED_FAULT_INSPECTION_FIELDS.slice(-2), [
    "faultSelectorPresent",
    "inspectionSha256",
  ]);
  assert.equal(EXPECTED_REQUIREMENTS_SHA256.length, 64);
  assert.equal(EXPECTED_SYSCALLS.length, 13);
  assert.equal(EXPECTED_LIMITS.at(-1)[1], EXPECTED_SYSCALLS.length);
});

test("local byte-array audit rejects fixed and variable stack scratch without rejecting ABI members", () => {
  assertOnlySyscallInlineAssembly(`
    int invoke(long number) {
      __asm__ volatile ("syscall" : "+a" (number) : : "rcx", "r11", "memory");
      return (int)number;
    }
  `);
  for (const template of [
    '"sub rsp,0x200\\nsyscall"',
    '"sys" "call"',
    "SYSCALL_TEMPLATE",
  ]) {
    assert.throws(() =>
      assertOnlySyscallInlineAssembly(
        `int invoke(void) { __asm__ volatile (${template}); return 0; }`,
      ),
    );
  }
  assert.throws(() =>
    assertOnlySyscallInlineAssembly(
      'int invoke(void) { __as\\\nm__ volatile ("rdtsc"); return 0; }',
    ),
  );
  assert.throws(() =>
    assertOnlySyscallInlineAssembly(`
      #define JOIN(left, right) left ## right
      int invoke(void) { JOIN(__as, m__) volatile ("rdtsc"); return 0; }
    `),
  );
  assert.throws(() =>
    assertOnlySyscallInlineAssembly(`
      int invoke(void) {
        __asm__ volatile ("syscall");
        const char *open = "/*";
        __asm__ volatile ("rdtsc");
        const char *close = "*/";
        return open == close;
      }
    `),
  );
  assert.match(
    stripCComments(`
      const char *open = "/*";
      #include "not-the-fixed-header.h"
      const char *close = "*/";
    `),
    /^\s*#\s*include\s+"not-the-fixed-header\.h"/mu,
  );
  const productionPrefix = EXPECTED_PRODUCTION_ARGV.slice(
    1,
    EXPECTED_PRODUCTION_ARGV.indexOf("-c"),
  );
  assert.equal(productionPrefix.includes("-O2"), true);
  assert.equal(productionPrefix.includes("-fPIC"), true);
  assert.equal(productionPrefix.includes("-c"), false);
  assert.doesNotThrow(() =>
    assertNoFunctionLocalByteArrays(`
      uint8_t global_bytes[128];
      struct abi_record { uint8_t name[256]; };
      static int32_t execute(const struct abi_record *record) {
        return record->name[0];
      }
    `),
  );
  for (const source of [
    "static int32_t execute(void) { uint8_t scratch[128]; return scratch[0]; }",
    "int32_t execute(uint32_t n) { unsigned char scratch[n]; return 0; }",
    "int execute(void) { const char local_name[4] = {0}; return local_name[0]; }",
    "int f(void) { _Alignas(16) _Alignas(32) uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { _Alignas(_Alignof(uint64_t)) uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { _Atomic(uint8_t) scratch[8]; return scratch[0]; }",
    "int f(void) { static _Thread_local uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { auto uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { return (uint8_t[8]){0}[0]; }",
    "custom_result helper(void) { int8_t hidden[8]; return hidden[0]; }",
    "int f(void) { uint8_t scalar, scratch[128]; return scratch[0] + scalar; }",
    "typedef uint8_t octet; int f(void) { octet scratch[128]; return scratch[0]; }",
    "typedef uint8_t octet; typedef octet byte; int f(void) { byte scratch[128]; return scratch[0]; }",
    "#define OCTET uint8_t\nint f(void) { OCTET scratch[8]; return scratch[0]; }",
    "#define LOCAL_BYTES(name) uint8_t name[8]\nint f(void) { LOCAL_BYTES(scratch); return scratch[0]; }",
    "struct scratch { uint8_t bytes[8]; }; int f(void) { struct scratch local; return local.bytes[0]; }",
    "union scratch { uint8_t bytes[8]; uint64_t word; }; typedef union scratch scratch_t; typedef scratch_t scratch_alias; int f(void) { scratch_alias local; return local.bytes[0]; }",
    "struct scratch { uint8_t bytes[8]; }; struct wrapper { struct scratch nested; }; int f(void) { struct wrapper local; return local.nested.bytes[0]; }",
    "typedef uint8_t scratch_t[8]; int f(void) { scratch_t local; return local[0]; }",
    "struct outer { struct { uint8_t bytes[8]; } inner; }; int f(void) { struct outer local; return local.inner.bytes[0]; }",
    "struct scratch { uint8_t bytes[8]; }; int f(void) { return ((struct scratch){0}).bytes[0]; }",
    ["int f(void) { uint8_", "t scratch[8]; return scratch[0]; }"].join(
      String.fromCharCode(92, 10),
    ),
  ]) {
    assert.throws(
      () => assertNoFunctionLocalByteArrays(source),
      undefined,
      source,
    );
  }
  assert.doesNotThrow(() =>
    assertNoFunctionLocalByteArrays(`
      struct abi_record { uint8_t name[256]; };
      int f(const struct abi_record *record) {
        const struct abi_record *copy = record;
        uint8_t *slots[2] = { 0, 0 };
        _Alignas(_Alignof(uint64_t)) uint8_t *aligned_slots[2] = { 0, 0 };
        uint8_t (*array_pointer)[8] = 0;
        (void)slots;
        (void)aligned_slots;
        (void)array_pointer;
        return copy->name[0];
      }
    `),
  );
});

test("instruction audit follows reachable stack paths and rejects unmodelled stack writes", () => {
  const instruction = (mnemonic, operands, address, byteLength = 1) =>
    Object.freeze({
      functionName: "execute",
      address,
      byteLength,
      mnemonic,
      operands,
    });
  const stackInstruction = (mnemonic, operands, address) =>
    instruction(mnemonic, operands, address);
  assert.equal(
    maximumReachableStackAllocation([
      stackInstruction("push", "rbp", 0),
      stackInstruction("mov", "rbp,rsp", 1),
      stackInstruction("sub", "rsp,0x20", 4),
      stackInstruction("lea", "rsp,[rsp-0x10]", 8),
      stackInstruction("lea", "rsp,[rsp+0x10]", 12),
      stackInstruction("mov", "rsp,rbp", 16),
      stackInstruction("pop", "rbp", 19),
      stackInstruction("ret", "", 20),
    ]),
    56,
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("sub", "rsp,0xc0", 0),
      stackInstruction("je", "10 <alternate>", 4),
      stackInstruction("add", "rsp,0xc0", 8),
      stackInstruction("jmp", "18 <return>", 12),
      stackInstruction("sub", "rsp,0x80", 16),
      stackInstruction("add", "rsp,0x140", 20),
      stackInstruction("ret", "", 24),
    ]),
  );
  assert.equal(
    maximumReachableStackAllocation([
      stackInstruction("cmp", "eax,0x0", 0),
      stackInstruction("je", "10 <alternative>", 2),
      stackInstruction("sub", "rsp,0x80", 4),
      stackInstruction("add", "rsp,0x80", 8),
      stackInstruction("jmp", "18 <return>", 12),
      stackInstruction("sub", "rsp,0xc0", 16),
      stackInstruction("add", "rsp,0xc0", 20),
      stackInstruction("ret", "", 24),
    ]),
    192,
  );
  assert.throws(() =>
    maximumReachableStackAllocation([stackInstruction("mov", "rsp,rax", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("lea", "rsp,[rbp-0x20]", 0),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("mov", "eax,DWORD PTR [rsp-0x120]", 0),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("mov", "eax,DWORD PTR [rsp+rax*8]", 0),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("mov", "eax,DWORD PTR [rbp+rax*8]", 0),
      stackInstruction("ret", "", 4),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("push", "rbp", 0),
      stackInstruction("mov", "rbp,rsp", 1),
      stackInstruction("mov", "eax,DWORD PTR [rbp+rax*8]", 4),
      stackInstruction("leave", "", 8),
      stackInstruction("ret", "", 9),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("mov", "rbp,rsp", 0),
      stackInstruction("sub", "rbp,0x200", 3),
      stackInstruction("mov", "DWORD PTR [rbp],eax", 7),
      stackInstruction("ret", "", 10),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([stackInstruction("xchg", "rsp,rax", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([stackInstruction("sub", "esp,0x20", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([stackInstruction("xchg", "esp,eax", 0)]),
  );
  assert.equal(
    maximumReachableStackAllocation(
      [
        stackInstruction("sub", "rsp,0x20", 0),
        stackInstruction("jmp", "rax", 4),
        stackInstruction("add", "rsp,0x20", 12),
        stackInstruction("ret", "", 16),
        stackInstruction("add", "rsp,0x20", 20),
        stackInstruction("ret", "", 24),
      ],
      256,
      new Map([[".text:4", [12, 20]]]),
    ),
    32,
  );
  // Literal composition of the two disposable GCC -O2/-fPIC objdump forms
  // captured by the root reviewer; this test never invokes a compiler.
  const tableInstructions = parseObjectDisassembly(`
Disassembly of section .text:

0000000000000000 <execute>:
   0:  83 ff 01              cmp    edi,0x1
   3:  0f 87 00 00 00 00     ja     9 <textual_same_section_decoy>
   9:  48 8d 0d 00 00 00 00  lea    rcx,[rip+0x0]
  10:  89 ff                 mov    edi,edi
  12:  48 63 14 b9           movsxd rdx,DWORD PTR [rcx+rdi*4]
  16:  48 01 ca              add    rdx,rcx
  19:  3e ff e2              notrack jmp rdx
  1c:  c3                    ret
  1d:  0f 1f 00              nop    DWORD PTR [rax]
  20:  c3                    ret
  21:  0f 1f 00              nop    DWORD PTR [rax]
  24:  48 83 f8 01           cmp    rax,0x1
  28:  77 16                 ja     40 <default_two>
  2a:  48 8d 35 00 00 00 00  lea    rsi,[rip+0x0]
  31:  48 63 04 86           movsxd rax,DWORD PTR [rsi+rax*4]
  35:  48 01 f0              add    rax,rsi
  38:  ff e0                 jmp    rax
  3a:  66 0f 1f 44 00 00     nop    WORD PTR [rax+rax*1+0x0]
  40:  c3                    ret
  41:  0f 1f 00              nop    DWORD PTR [rax]
  44:  c3                    ret

Disassembly of section .text.unlikely:

0000000000000000 <execute.cold>:
   0:  c3                    ret
`);
  const relocations = parseElfRelocations(`
RELOCATION RECORDS FOR [.text]:
0000000000000005 R_X86_64_PC32 .text.unlikely-0x0000000000000004
000000000000000c R_X86_64_PC32 .rodata-0x0000000000000004
000000000000002d R_X86_64_PC32 .rodata+0x000000000000001c
RELOCATION RECORDS FOR [.rodata]:
0000000000000000 R_X86_64_PC32 .text+0x000000000000001c
0000000000000004 R_X86_64_PC32 .text+0x0000000000000024
0000000000000008 R_X86_64_PC32 .text+0x0000000000000040
0000000000000020 R_X86_64_PC32 .text
0000000000000024 R_X86_64_PC32 .text+0x0000000000000048
RELOCATION RECORDS FOR [.rodata.unused]:
0000000000000000 R_X86_64_PC32 .text+0x0000000000000010
RELOCATION RECORDS FOR [.eh_frame]:
0000000000000020 R_X86_64_PC32 .text+0x0000000000000040
`);
  const tableTargets = bindIndirectJumpTables(tableInstructions, relocations);
  assert.deepEqual(tableTargets.get(".text:3"), [
    { sectionName: ".text.unlikely", address: 0 },
  ]);
  assert.deepEqual(tableTargets.get(".text:25"), [
    { sectionName: ".text", address: 28 },
    { sectionName: ".text", address: 32 },
  ]);
  assert.deepEqual(tableTargets.get(".text:56"), [
    { sectionName: ".text", address: 0 },
    { sectionName: ".text", address: 68 },
  ]);
  const sharedTableTargets = bindIndirectJumpTables(
    tableInstructions,
    relocations.map((relocation) =>
      relocation.sourceSection === ".text" && relocation.offset === 45
        ? Object.freeze({
            ...relocation,
            rawTarget: ".rodata-0x0000000000000004",
            targetSection: ".rodata",
            addend: -4,
          })
        : relocation,
    ),
  );
  assert.deepEqual(sharedTableTargets.get(".text:56"), [
    { sectionName: ".text", address: 28 },
    { sectionName: ".text", address: 32 },
  ]);
  assertExactExecutableDisassembly(tableInstructions, [
    { name: ".text", address: 0, size: 69 },
    { name: ".text.unlikely", address: 0, size: 1 },
  ]);
  assert.throws(() =>
    assertExactExecutableDisassembly(tableInstructions, [
      { name: ".text", address: 0, size: 70 },
      { name: ".text.unlikely", address: 0, size: 1 },
    ]),
  );
  assert.throws(() =>
    assertExactExecutableDisassembly(
      tableInstructions.filter(
        ({ sectionName, address }) =>
          !(sectionName === ".text" && address === 29),
      ),
      [
        { name: ".text", address: 0, size: 69 },
        { name: ".text.unlikely", address: 0, size: 1 },
      ],
    ),
  );
  assert.throws(() =>
    assertExactExecutableDisassembly(tableInstructions, [
      { name: ".text", address: 0, size: 69 },
      { name: ".text.unlikely", address: 0, size: 1 },
      { name: ".text.extra", address: 0, size: 1 },
    ]),
  );
  assert.equal(
    tableTargets
      .get(".text:25")
      .some(
        ({ sectionName, address }) => sectionName === ".text" && address === 29,
      ),
    false,
  );
  assert.throws(() =>
    bindIndirectJumpTables(
      tableInstructions.map((instruction) =>
        instruction.address === 49
          ? Object.freeze({
              ...instruction,
              operands: "rax,DWORD PTR [rsi+rsi*4]",
            })
          : instruction,
      ),
      relocations,
    ),
  );
  for (const [address, replacement] of [
    [16, { mnemonic: "nop", operands: "" }],
    [9, { operands: "ecx,[rip+0x0]" }],
    [18, { operands: "rdx,DWORD PTR [rcx+edi*4]" }],
    [22, { operands: "edx,ecx" }],
    [25, { operands: "edx" }],
  ]) {
    assert.throws(() =>
      bindIndirectJumpTables(
        tableInstructions.map((instruction) =>
          instruction.address === address
            ? Object.freeze({ ...instruction, ...replacement })
            : instruction,
        ),
        relocations,
      ),
    );
  }
  assert.throws(() =>
    bindIndirectJumpTables(
      [
        ...tableInstructions,
        Object.freeze({
          sectionName: ".text",
          functionName: "execute",
          address: 69,
          byteLength: 2,
          mnemonic: "jmp",
          operands: "31 <mid_slice>",
        }),
      ],
      relocations,
    ),
  );
  const hotColdInstructions = [
    Object.freeze({
      sectionName: ".text",
      functionName: "execute",
      address: 0,
      byteLength: 4,
      mnemonic: "sub",
      operands: "rsp,0x20",
    }),
    Object.freeze({
      sectionName: ".text",
      functionName: "execute",
      address: 4,
      byteLength: 6,
      mnemonic: "ja",
      operands: "10 <textual_same_section_decoy>",
    }),
    Object.freeze({
      sectionName: ".text",
      functionName: "execute",
      address: 10,
      byteLength: 4,
      mnemonic: "add",
      operands: "rsp,0x20",
    }),
    Object.freeze({
      sectionName: ".text",
      functionName: "execute",
      address: 14,
      byteLength: 1,
      mnemonic: "ret",
      operands: "",
    }),
    Object.freeze({
      sectionName: ".text.unlikely",
      functionName: "execute.cold",
      address: 0,
      byteLength: 4,
      mnemonic: "add",
      operands: "rsp,0x20",
    }),
    Object.freeze({
      sectionName: ".text.unlikely",
      functionName: "execute.cold",
      address: 4,
      byteLength: 1,
      mnemonic: "ret",
      operands: "",
    }),
  ];
  const hotColdTargets = bindIndirectJumpTables(
    hotColdInstructions,
    Object.freeze([
      Object.freeze({
        sourceSection: ".text",
        offset: 6,
        type: "R_X86_64_PC32",
        rawTarget: ".text.unlikely-0x4",
        targetSection: ".text.unlikely",
        addend: -4,
      }),
    ]),
  );
  assert.deepEqual(hotColdTargets.get(".text:4"), [
    { sectionName: ".text.unlikely", address: 0 },
  ]);
  assert.equal(
    maximumReachableStackAllocation(hotColdInstructions, 256, hotColdTargets),
    32,
  );
  assert.equal(
    maximumReachableStackAllocation([
      stackInstruction("ret", "", 0),
      stackInstruction("nop", "", 1),
      stackInstruction("sub", "rsp,0x20", 2),
      stackInstruction("add", "rsp,0x20", 6),
      stackInstruction("jmp", "1 <padding_cycle>", 10),
    ]),
    32,
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      stackInstruction("ret", "", 0),
      stackInstruction("sub", "rsp,0x120", 1),
      stackInstruction("add", "rsp,0x120", 5),
      stackInstruction("jmp", "1 <disconnected_cycle>", 9),
    ]),
  );
  assert.throws(() =>
    bindIndirectJumpTables(
      tableInstructions.slice(0, 9),
      parseElfRelocations(`
RELOCATION RECORDS FOR [.text]:
000000000000000c R_X86_64_PC32 .rodata-0x4
RELOCATION RECORDS FOR [.rodata]:
0000000000000000 R_X86_64_PC32 .text
0000000000000004 R_X86_64_PC32 hidden_target
`),
    ),
  );
  assert.throws(() =>
    bindIndirectJumpTables(
      tableInstructions.slice(0, 9),
      parseElfRelocations(`
RELOCATION RECORDS FOR [.text]:
000000000000000c R_X86_64_PC32 .rodata-0x4
RELOCATION RECORDS FOR [.rodata]:
0000000000000000 R_X86_64_32 .text
`),
    ),
  );
  assert.throws(() =>
    maximumReachableStackAllocation(
      [
        stackInstruction("sub", "rsp,0x8", 0),
        stackInstruction("jmp", "rax", 4),
      ],
      256,
      new Map([[".text:4", [0]]]),
    ),
  );
  assert.deepEqual(
    reachableDirectSyscalls([
      instruction("mov", "eax,0x3e7", 0),
      instruction("jmp", "8 <invoke>", 5),
      instruction("mov", "eax,0x0", 6, 2),
      instruction("syscall", "", 8),
      instruction("ret", "", 10),
    ]).observedSyscallNumbers,
    [0],
  );
  const allSites = reachableDirectSyscalls([
    instruction("mov", "eax,0x0", 0, 5),
    instruction("syscall", "", 5),
    instruction("ret", "", 7),
    instruction("mov", "eax,0x3e7", 8, 5),
    instruction("syscall", "", 13),
    instruction("ret", "", 15),
  ]);
  assert.equal(allSites.directSyscallInstructionCount, 2);
  assert.deepEqual(allSites.observedSyscallNumbers, [0, 999]);
  assert.throws(() =>
    reachableDirectSyscalls([
      instruction("mov", "eax,0x0", 0, 5),
      instruction("nop", "", 5),
      instruction("syscall", "", 6),
    ]),
  );
  for (const clobber of [
    instruction("xor", "al,al", 5),
    instruction("lodsd", "eax,DWORD PTR ds:[rsi]", 5),
    instruction("lahf", "", 5),
  ]) {
    assert.throws(() =>
      reachableDirectSyscalls([
        instruction("mov", "eax,0x3e7", 0, 5),
        clobber,
        instruction("syscall", "", 8),
        instruction("ret", "", 10),
      ]),
    );
  }
  assert.throws(() =>
    reachableDirectSyscalls([
      instruction("mov", "eax,0x0", 0, 4),
      instruction("syscall", "", 5, 2),
    ]),
  );
  assertOnlyAuditedKernelTransfers([
    instruction("syscall", "", 0, 2),
    instruction("ret", "", 2, 1),
  ]);
  for (const mnemonic of [
    "int",
    "int3",
    "sysenter",
    "sysret",
    "lcall",
    "ljmp",
    "vmcall",
    "rdtsc",
    "cpuid",
    "out",
  ]) {
    assert.throws(() =>
      assertOnlyAuditedKernelTransfers([
        instruction(mnemonic, mnemonic === "int" ? "0x80" : "", 0, 2),
      ]),
    );
  }
});

test("missing-module attribution rejects wrong code, URL, message, and present source", () => {
  const exactShape = Object.freeze({
    code: "ERR_MODULE_NOT_FOUND",
    url: ATTESTATION_URL.href,
    message: `Cannot find module '${fileURLToPath(
      ATTESTATION_URL,
    )}' imported from ${EVALUATOR_PATH}`,
  });
  assert.equal(
    exactMissingAttestationError(exactShape, { sourcePresent: false }),
    true,
  );
  assert.equal(
    exactMissingAttestationError(
      { ...exactShape, code: "ENOENT" },
      { sourcePresent: false },
    ),
    false,
  );
  assert.equal(
    exactMissingAttestationError(
      { ...exactShape, url: `${ATTESTATION_URL.href}.other` },
      { sourcePresent: false },
    ),
    false,
  );
  assert.equal(
    exactMissingAttestationError(
      { ...exactShape, message: `${exactShape.message}.other` },
      { sourcePresent: false },
    ),
    true,
  );
  assert.equal(
    exactMissingAttestationError(exactShape, { sourcePresent: true }),
    false,
  );
  const { url: _url, ...nodeTwentyShape } = exactShape;
  assert.equal(
    exactMissingAttestationError(nodeTwentyShape, { sourcePresent: false }),
    true,
  );
  assert.equal(
    exactMissingAttestationError(
      { ...nodeTwentyShape, message: `${nodeTwentyShape.message}.other` },
      { sourcePresent: false },
    ),
    false,
  );
  assert.equal(
    exactMissingAttestationError(
      { ...nodeTwentyShape, url: null },
      { sourcePresent: false },
    ),
    false,
  );
});

test("reports only the exact source-absent attestation import RED", () => {
  assert.equal(attestationImportAttempts, 1);
  if (attestationImportError !== null) throw attestationImportError;
  assert.notEqual(attestation, null);
});
