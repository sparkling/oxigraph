import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import process from "node:process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { types as utilTypes } from "node:util";

const HEADER_RELATIVE =
  "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.h";
const SOURCE_RELATIVE =
  "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c";
const ENTRYPOINT = "oxigraph_containment_statefs_execute_v1";
const PLATFORM = "linux-x86_64-sysv-little-endian";
const COMPILER = "/usr/bin/cc";
const OBJDUMP = "/usr/bin/objdump";
const ABI_LAYOUT_SHA256 =
  "651ae0afeedca00a87275030238afe7788cb8852acb2f060f44f711712b041a0";
const PATH_BYTES = 4096;
const COMPILER_VERSION_BYTES = 65536;
const SOURCE_BYTES = 1048576;
const OBJECT_BYTES = 1048576;
const REPORT_BYTES = 1048576;
const INSPECTION_BYTES = 8 * 1024 * 1024;
const MAX_SECTIONS = 256;
const MAX_SYMBOLS = 512;
const MAX_RELOCATIONS = 4096;
const EXPECTED_SYSCALL_NUMBERS = Object.freeze([
  0, 1, 3, 72, 73, 74, 138, 217, 257, 258, 263, 316, 332,
]);
const INPUT_FIELDS = Object.freeze([
  "repositoryRoot",
  "privateBuildRoot",
  "buildKind",
]);

const objectPrototype = Object.prototype;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;

function fail(code) {
  throw new Error(code);
}

function nullRecord(entries) {
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
    if (!Number.isFinite(value)) fail("STATEFS_ATTEST_SHAPE");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") fail("STATEFS_ATTEST_SHAPE");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

const AUTHORITY = deepFreeze(
  nullRecord([
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
  ]),
);

const PHYSICAL_FACTS = deepFreeze(
  nullRecord([
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
  ]),
);

const NONCLAIMS = deepFreeze([
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

const REQUEST_FIELDS = deepFreeze([
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

const OBSERVATION_FIELDS = deepFreeze([
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

const RESULT_FIELDS = deepFreeze([
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

const ABI = deepFreeze([
  ["request", ["alignment", 8, "size", 192, "fields", REQUEST_FIELDS]],
  [
    "observation",
    ["alignment", 8, "size", 384, "fields", OBSERVATION_FIELDS],
  ],
  ["result", ["alignment", 8, "size", 64, "fields", RESULT_FIELDS]],
  ["return", ["resultProduced", 0, "fixedBoundaryFailure", -1]],
]);

const LIMITS = deepFreeze([
  ["pathBytes", PATH_BYTES],
  ["compilerVersionBytes", COMPILER_VERSION_BYTES],
  ["headerBytes", SOURCE_BYTES],
  ["sourceBytes", SOURCE_BYTES],
  ["objectBytes", OBJECT_BYTES],
  ["argvElements", 64],
  ["argvElementBytes", PATH_BYTES],
  ["environmentEntries", 4],
  ["elfSections", MAX_SECTIONS],
  ["elfSymbols", MAX_SYMBOLS],
  ["elfRelocations", MAX_RELOCATIONS],
  ["reportCanonicalBytes", REPORT_BYTES],
  ["directSyscallInstructions", 13],
]);

const PRODUCTION_ARGV_TEMPLATE = deepFreeze([
  COMPILER,
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
  SOURCE_RELATIVE,
  "-o",
  "OUTPUT_OBJECT",
]);

const ENVIRONMENT = deepFreeze([
  ["LC_ALL", "C"],
  ["LANG", "C"],
  ["TZ", "UTC"],
  ["SOURCE_DATE_EPOCH", "0"],
]);

const SYSCALLS = deepFreeze([
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

const REPORT_FIELDS = deepFreeze([
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

const FAULT_INSPECTION_FIELDS = deepFreeze([
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

export const CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS =
  deepFreeze(
    nullRecord([
      [
        "schema",
        "oxigraph.candidate-containment-guardian-statefs-syscalls-build-requirements/v1",
      ],
      ["version", 1],
      ["platform", PLATFORM],
      ["header", HEADER_RELATIVE],
      ["source", SOURCE_RELATIVE],
      ["entrypoint", ENTRYPOINT],
      [
        "outputObjects",
        [
          "BUILD_ROOT/production-0001/containment-guardian-statefs-syscalls-v1.o",
          "BUILD_ROOT/production-0002/containment-guardian-statefs-syscalls-v1.o",
          "BUILD_ROOT/fault-0001/containment-guardian-statefs-syscalls-v1-fault.o",
        ],
      ],
      ["limits", LIMITS],
      ["abi", ABI],
      ["productionArgv", PRODUCTION_ARGV_TEMPLATE],
      [
        "faultArgvDelta",
        ["insert-before-c", "-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1"],
      ],
      ["environment", ENVIRONMENT],
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
          ["compiler", COMPILER],
          ["cwd", "repositoryRoot"],
          ["pathSearch", false],
        ],
      ],
      ["allowedSyscalls", SYSCALLS],
      [
        "elfRules",
        [
          ["class", "ELF64"],
          ["data", "LSB"],
          ["type", "REL"],
          ["machine", "AMD64"],
          ["definedGlobals", [ENTRYPOINT]],
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
      ["reportFields", REPORT_FIELDS],
      ["repeatCount", 2],
      ["authority", AUTHORITY],
      ["physicalFacts", PHYSICAL_FACTS],
      ["nonclaims", NONCLAIMS],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256 =
  semanticSha256(
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS,
  );

function inspectInputBounds(input) {
  if (input === null || typeof input !== "object" || utilTypes.isProxy(input)) {
    return;
  }
  let descriptors;
  try {
    descriptors = objectGetOwnPropertyDescriptors(input);
  } catch {
    return;
  }
  for (const key of ["repositoryRoot", "privateBuildRoot"]) {
    const descriptor = descriptors[key];
    if (
      descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string" &&
      Buffer.byteLength(descriptor.value, "utf8") > PATH_BYTES
    ) {
      fail("STATEFS_ATTEST_BOUNDS");
    }
  }
}

function exactInput(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    utilTypes.isProxy(input)
  ) {
    fail("STATEFS_ATTEST_SHAPE");
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(input);
    descriptors = objectGetOwnPropertyDescriptors(input);
  } catch {
    fail("STATEFS_ATTEST_SHAPE");
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    (prototype !== objectPrototype && prototype !== null) ||
    keys.some((key) => typeof key !== "string") ||
    keys.length !== INPUT_FIELDS.length ||
    INPUT_FIELDS.some((key) => !keys.includes(key)) ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return !(
        "value" in descriptor &&
        descriptor.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    })
  ) {
    fail("STATEFS_ATTEST_SHAPE");
  }
  const repositoryRoot = descriptors.repositoryRoot.value;
  const privateBuildRoot = descriptors.privateBuildRoot.value;
  const buildKind = descriptors.buildKind.value;
  if (
    typeof repositoryRoot !== "string" ||
    typeof privateBuildRoot !== "string" ||
    (buildKind !== "PRODUCTION" && buildKind !== "FAULT")
  ) {
    fail("STATEFS_ATTEST_SHAPE");
  }
  return { repositoryRoot, privateBuildRoot, buildKind };
}

function validateDerivedBounds(input) {
  const values = [
    `-ffile-prefix-map=${input.repositoryRoot}=.`,
    `-fdebug-prefix-map=${input.repositoryRoot}=.`,
    join(
      input.privateBuildRoot,
      "production-0001",
      "containment-guardian-statefs-syscalls-v1.o",
    ),
    join(
      input.privateBuildRoot,
      "production-0002",
      "containment-guardian-statefs-syscalls-v1.o",
    ),
    join(
      input.privateBuildRoot,
      "fault-0001",
      "containment-guardian-statefs-syscalls-v1-fault.o",
    ),
  ];
  if (values.some((value) => Buffer.byteLength(value, "utf8") > PATH_BYTES)) {
    fail("STATEFS_ATTEST_BOUNDS");
  }
}

async function exactDirectory(pathname, mode, ownerRequired) {
  let status;
  let canonical;
  try {
    status = await lstat(pathname, { bigint: true });
    canonical = await realpath(pathname);
  } catch {
    fail("STATEFS_ATTEST_PATH");
  }
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    canonical !== resolve(pathname) ||
    (mode !== null && Number(status.mode & 0o777n) !== mode) ||
    (ownerRequired &&
      (status.uid !== BigInt(process.getuid()) ||
        status.gid !== BigInt(process.getgid())))
  ) {
    fail("STATEFS_ATTEST_PATH");
  }
  return status;
}

async function validatePaths(input) {
  const { repositoryRoot, privateBuildRoot } = input;
  if (
    repositoryRoot.length === 0 ||
    privateBuildRoot.length === 0 ||
    repositoryRoot.includes("\0") ||
    privateBuildRoot.includes("\0") ||
    !isAbsolute(repositoryRoot) ||
    !isAbsolute(privateBuildRoot)
  ) {
    fail("STATEFS_ATTEST_PATH");
  }
  await exactDirectory(repositoryRoot, null, false);
  await exactDirectory(privateBuildRoot, 0o700, true);
  const projected = relative(resolve(repositoryRoot), resolve(privateBuildRoot));
  if (
    projected === "" ||
    projected === ".." ||
    (!projected.startsWith(`..${sep}`) && !isAbsolute(projected))
  ) {
    fail("STATEFS_ATTEST_PATH");
  }
  let children;
  try {
    children = await readdir(privateBuildRoot);
  } catch {
    fail("STATEFS_ATTEST_PATH");
  }
  if (children.length !== 0) fail("STATEFS_ATTEST_PATH");
}

function stripCComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\r\n]*/gu, " ");
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
  if (matches.length !== 1) fail("STATEFS_ATTEST_ABI");
  const fields = [];
  for (const raw of matches[0][1].split(";")) {
    const declaration = raw.trim();
    if (declaration.length === 0) continue;
    const field = declaration.match(
      /^(uint32_t|int32_t|uint64_t|uint8_t)\s+([a-z][a-z0-9_]*)(?:\s*\[\s*([0-9]+)\s*\])?$/u,
    );
    if (field === null) fail("STATEFS_ATTEST_ABI");
    fields.push([field[2], normalizeCType(field[1], field[3])]);
  }
  return fields;
}

function validateStaticStruct(header, structName, alignment, size, fields) {
  const actual = extractStructFields(header, structName);
  const expected = fields.map(([name, type]) => [name, type]);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("STATEFS_ATTEST_ABI");
  }
  const alignmentPattern = new RegExp(
    `_Static_assert\\s*\\(\\s*_Alignof\\s*\\(\\s*struct\\s+${structName}\\s*\\)\\s*==\\s*${alignment}\\b`,
    "u",
  );
  const sizePattern = new RegExp(
    `_Static_assert\\s*\\(\\s*sizeof\\s*\\(\\s*struct\\s+${structName}\\s*\\)\\s*==\\s*${size}\\b`,
    "u",
  );
  if (!alignmentPattern.test(header) || !sizePattern.test(header)) {
    fail("STATEFS_ATTEST_ABI");
  }
  for (const [field, , offset] of fields) {
    const pattern = new RegExp(
      `_Static_assert\\s*\\(\\s*(?:__builtin_)?offsetof\\s*\\(\\s*struct\\s+${structName}\\s*,\\s*${field}\\s*\\)\\s*==\\s*${offset}\\b`,
      "u",
    );
    if (!pattern.test(header)) fail("STATEFS_ATTEST_ABI");
  }
}

function validateHeaderAbi(headerBytes) {
  const header = headerBytes.toString("utf8");
  if (!Buffer.from(header, "utf8").equals(headerBytes)) {
    fail("STATEFS_ATTEST_ABI");
  }
  validateStaticStruct(
    header,
    "oxigraph_containment_statefs_request_v1",
    8,
    192,
    REQUEST_FIELDS,
  );
  validateStaticStruct(
    header,
    "oxigraph_containment_statefs_observation_v1",
    8,
    384,
    OBSERVATION_FIELDS,
  );
  validateStaticStruct(
    header,
    "oxigraph_containment_statefs_result_v1",
    8,
    64,
    RESULT_FIELDS,
  );
  const entrypointPattern =
    /\bint32_t\s+oxigraph_containment_statefs_execute_v1\s*\(\s*const\s+struct\s+oxigraph_containment_statefs_request_v1\s*\*\s*request\s*,\s*struct\s+oxigraph_containment_statefs_result_v1\s*\*\s*result\s*\)\s*;/gu;
  if ([...stripCComments(header).matchAll(entrypointPattern)].length !== 1) {
    fail("STATEFS_ATTEST_ABI");
  }
  if (semanticSha256(ABI.slice(0, 3)) !== ABI_LAYOUT_SHA256) {
    fail("STATEFS_ATTEST_ABI");
  }
}

async function readBoundedRegular(pathname, maximum, errorCode) {
  let status;
  let bytes;
  try {
    status = await lstat(pathname, { bigint: true });
    if (
      !status.isFile() ||
      status.isSymbolicLink() ||
      status.size < 1n ||
      status.size > BigInt(maximum)
    ) {
      fail(errorCode);
    }
    bytes = await readFile(pathname);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    fail(errorCode);
  }
  if (bytes.length !== Number(status.size)) fail(errorCode);
  return { status, bytes };
}

function exactEnvironment() {
  return nullRecord([
    ["LC_ALL", "C"],
    ["LANG", "C"],
    ["TZ", "UTC"],
    ["SOURCE_DATE_EPOCH", "0"],
  ]);
}

function boundedArgv(argv) {
  if (
    argv.length > 64 ||
    argv.some(
      (argument) =>
        typeof argument !== "string" ||
        Buffer.byteLength(argument, "utf8") > PATH_BYTES,
    )
  ) {
    fail("STATEFS_ATTEST_BOUNDS");
  }
}

function compilerArgv(
  compilerRealpath,
  repositoryRoot,
  objectPath,
  fault,
) {
  const argv = [];
  for (const argument of PRODUCTION_ARGV_TEMPLATE) {
    if (argument === COMPILER) {
      argv.push(compilerRealpath);
    } else if (argument === "-ffile-prefix-map=REQ_ROOT=.") {
      argv.push(`-ffile-prefix-map=${repositoryRoot}=.`);
    } else if (argument === "-fdebug-prefix-map=REQ_ROOT=.") {
      argv.push(`-fdebug-prefix-map=${repositoryRoot}=.`);
    } else if (argument === "OUTPUT_OBJECT") {
      argv.push(objectPath);
    } else {
      if (fault && argument === "-c") {
        argv.push("-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1");
      }
      argv.push(argument);
    }
  }
  boundedArgv(argv);
  return argv;
}

function exactChild(executable, argv, cwd, maximum, errorCode) {
  boundedArgv([executable, ...argv]);
  let child;
  try {
    child = spawnSync(executable, argv, {
      cwd,
      env: exactEnvironment(),
      encoding: null,
      maxBuffer: maximum,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      windowsHide: true,
    });
  } catch {
    fail(errorCode);
  }
  if (
    child.error !== undefined ||
    child.status !== 0 ||
    child.signal !== null ||
    !Buffer.isBuffer(child.stdout) ||
    !Buffer.isBuffer(child.stderr)
  ) {
    fail(errorCode);
  }
  return child;
}

async function makePrivateChild(privateBuildRoot, name) {
  const pathname = join(privateBuildRoot, name);
  try {
    await mkdir(pathname, { mode: 0o700, recursive: false });
    const status = await lstat(pathname, { bigint: true });
    if (
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      Number(status.mode & 0o777n) !== 0o700 ||
      status.uid !== BigInt(process.getuid()) ||
      status.gid !== BigInt(process.getgid())
    ) {
      fail("STATEFS_ATTEST_PATH");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "STATEFS_ATTEST_PATH") {
      throw error;
    }
    fail("STATEFS_ATTEST_PATH");
  }
  return pathname;
}

async function compileObject({
  compilerRealpath,
  repositoryRoot,
  privateBuildRoot,
  directory,
  basename,
  fault,
}) {
  const childDirectory = await makePrivateChild(privateBuildRoot, directory);
  const objectPath = join(childDirectory, basename);
  const argv = compilerArgv(
    compilerRealpath,
    repositoryRoot,
    objectPath,
    fault,
  );
  const child = exactChild(
    compilerRealpath,
    argv.slice(1),
    repositoryRoot,
    OBJECT_BYTES,
    "STATEFS_ATTEST_BUILD",
  );
  if (child.stdout.length !== 0 || child.stderr.length !== 0) {
    fail("STATEFS_ATTEST_BUILD");
  }
  let children;
  try {
    children = await readdir(childDirectory);
  } catch {
    fail("STATEFS_ATTEST_BUILD");
  }
  if (children.length !== 1 || children[0] !== basename) {
    fail("STATEFS_ATTEST_BUILD");
  }
  const object = await readBoundedRegular(
    objectPath,
    OBJECT_BYTES,
    "STATEFS_ATTEST_BUILD",
  );
  return { argv, objectPath, objectBytes: object.bytes };
}

async function validateBuildTopology(privateBuildRoot, buildKind) {
  const expected =
    buildKind === "FAULT"
      ? ["fault-0001", "production-0001", "production-0002"]
      : ["production-0001", "production-0002"];
  let actual;
  try {
    actual = (await readdir(privateBuildRoot)).sort();
  } catch {
    fail("STATEFS_ATTEST_PATH");
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("STATEFS_ATTEST_PATH");
  }
  for (const child of expected) {
    await exactDirectory(join(privateBuildRoot, child), 0o700, true);
  }
}

function checkedRange(bytes, offset, length) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    fail("STATEFS_ATTEST_ELF");
  }
}

function boundedU64(bytes, offset) {
  checkedRange(bytes, offset, 8);
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("STATEFS_ATTEST_ELF");
  return Number(value);
}

function asciiCString(bytes, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
    fail("STATEFS_ATTEST_ELF");
  }
  const end = bytes.indexOf(0, offset);
  if (end < offset) fail("STATEFS_ATTEST_ELF");
  const value = bytes.subarray(offset, end).toString("latin1");
  if (!/^[\x20-\x7e]*$/u.test(value)) fail("STATEFS_ATTEST_ELF");
  return value;
}

function readElfSections(bytes) {
  checkedRange(bytes, 0, 64);
  if (
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1 ||
    bytes.readUInt16LE(16) !== 1 ||
    bytes.readUInt16LE(18) !== 62 ||
    bytes.readUInt16LE(52) !== 64
  ) {
    fail("STATEFS_ATTEST_ELF");
  }
  const sectionOffset = boundedU64(bytes, 40);
  const entrySize = bytes.readUInt16LE(58);
  const count = bytes.readUInt16LE(60);
  const nameIndex = bytes.readUInt16LE(62);
  if (
    entrySize !== 64 ||
    count < 1 ||
    count > MAX_SECTIONS ||
    nameIndex < 1 ||
    nameIndex >= count
  ) {
    fail("STATEFS_ATTEST_ELF");
  }
  checkedRange(bytes, sectionOffset, entrySize * count);
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    const offset = sectionOffset + index * entrySize;
    sections.push({
      index,
      nameOffset: bytes.readUInt32LE(offset),
      type: bytes.readUInt32LE(offset + 4),
      flags: boundedU64(bytes, offset + 8),
      address: boundedU64(bytes, offset + 16),
      offset: boundedU64(bytes, offset + 24),
      size: boundedU64(bytes, offset + 32),
      link: bytes.readUInt32LE(offset + 40),
      info: bytes.readUInt32LE(offset + 44),
      entrySize: boundedU64(bytes, offset + 56),
    });
  }
  const namesSection = sections[nameIndex];
  checkedRange(bytes, namesSection.offset, namesSection.size);
  const names = bytes.subarray(
    namesSection.offset,
    namesSection.offset + namesSection.size,
  );
  for (const section of sections) {
    section.name = asciiCString(names, section.nameOffset);
    if (section.type !== 8) {
      checkedRange(bytes, section.offset, section.size);
    }
  }
  return sections;
}

function inspectElf(bytes) {
  if (!Buffer.isBuffer(bytes)) fail("STATEFS_ATTEST_ELF");
  const sections = readElfSections(bytes);
  const symbolTables = new Map();
  const definedGlobalSymbols = [];
  const undefinedSymbols = [];
  let totalSymbols = 0;
  for (const section of sections) {
    if (section.type !== 2) continue;
    if (
      section.entrySize !== 24 ||
      section.size % section.entrySize !== 0 ||
      section.link >= sections.length
    ) {
      fail("STATEFS_ATTEST_ELF");
    }
    const stringSection = sections[section.link];
    checkedRange(bytes, stringSection.offset, stringSection.size);
    const strings = bytes.subarray(
      stringSection.offset,
      stringSection.offset + stringSection.size,
    );
    const symbols = [];
    const count = section.size / section.entrySize;
    totalSymbols += count;
    if (totalSymbols > MAX_SYMBOLS) fail("STATEFS_ATTEST_ELF");
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * section.entrySize;
      const name = asciiCString(strings, bytes.readUInt32LE(offset));
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
  for (const section of sections) {
    if (section.type !== 4 && section.type !== 9) continue;
    const expectedEntrySize = section.type === 4 ? 24 : 16;
    const symbols = symbolTables.get(section.link);
    if (
      section.entrySize !== expectedEntrySize ||
      section.size % section.entrySize !== 0 ||
      symbols === undefined
    ) {
      fail("STATEFS_ATTEST_ELF");
    }
    const count = section.size / section.entrySize;
    relocationCount += count;
    if (relocationCount > MAX_RELOCATIONS) fail("STATEFS_ATTEST_ELF");
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * section.entrySize;
      const info = bytes.readBigUInt64LE(offset + 8);
      const symbolIndex = Number(info >> 32n);
      if (symbolIndex >= symbols.length) fail("STATEFS_ATTEST_ELF");
      if (symbolIndex === 0) continue;
      const symbol = symbols[symbolIndex];
      const targetSection = sections[symbol.sectionIndex];
      const target = symbol.name || targetSection?.name;
      if (
        typeof target !== "string" ||
        target.length === 0 ||
        !/^[\x20-\x7e]+$/u.test(target) ||
        !(
          (symbol.binding === 0 && symbol.sectionIndex !== 0) ||
          (targetSection !== undefined && (targetSection.flags & 0x1) === 0)
        )
      ) {
        fail("STATEFS_ATTEST_ELF");
      }
      relocationTargets.push(target);
    }
  }

  const defined = [...new Set(definedGlobalSymbols)].sort();
  const undefinedNames = [...new Set(undefinedSymbols)].sort();
  const relocations = [...new Set(relocationTargets)].sort();
  const stack = sections.find(({ name }) => name === ".note.GNU-stack");
  const writableExecutableSectionCount = sections.filter(
    ({ flags }) => (flags & 0x1) !== 0 && (flags & 0x4) !== 0,
  ).length;
  const pltPresent = sections.some(
    ({ name, size }) => /^\.plt(?:\.|$)/u.test(name) && size > 0,
  );
  if (
    stack === undefined ||
    pltPresent ||
    (stack.flags & 0x4) !== 0 ||
    writableExecutableSectionCount !== 0 ||
    canonicalJson(defined) !== canonicalJson([ENTRYPOINT]) ||
    undefinedNames.length !== 0
  ) {
    fail("STATEFS_ATTEST_ELF");
  }
  return {
    projection: deepFreeze(
      nullRecord([
        ["elfClass", "ELF64"],
        ["elfData", "LSB"],
        ["elfType", "REL"],
        ["elfMachine", "AMD64"],
        ["definedGlobalSymbols", defined],
        ["undefinedSymbols", undefinedNames],
        ["pltEntries", []],
        ["relocationTargets", relocations],
        ["gnuStackExecutable", false],
        ["writableExecutableSectionCount", writableExecutableSectionCount],
      ]),
    ),
    sections,
  };
}

function executableSectionExtents(bytes, sections) {
  const executable = [];
  for (const section of sections) {
    if ((section.flags & 0x4) === 0 || section.size === 0) continue;
    if (section.type === 8) fail("STATEFS_ATTEST_ELF");
    checkedRange(bytes, section.offset, section.size);
    executable.push({
      name: section.name,
      address: section.address,
      size: section.size,
    });
  }
  if (
    executable.length === 0 ||
    new Set(executable.map(({ name }) => name)).size !== executable.length
  ) {
    fail("STATEFS_ATTEST_ELF");
  }
  return executable;
}

function parseDisassembly(output) {
  const instructions = [];
  let currentFunction = null;
  let currentSection = null;
  for (const line of output.split("\n")) {
    const sectionMatch = line.match(/^Disassembly of section (.+):$/u);
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1];
      currentFunction = null;
      continue;
    }
    const functionMatch = line.match(/^\s*[0-9a-f]+\s+<([^>]+)>:$/u);
    if (functionMatch !== null) {
      currentFunction = functionMatch[1];
      continue;
    }
    const instructionMatch = line.match(
      /^\s*([0-9a-f]+):\s+((?:(?:[0-9a-f]{2})\s+)+)\s*([a-z][a-z0-9.]*)\s*(.*?)\s*$/iu,
    );
    if (instructionMatch === null) continue;
    if (currentFunction === null || currentSection === null) {
      fail("STATEFS_ATTEST_ELF");
    }
    let mnemonic = instructionMatch[3].toLowerCase();
    let operands = instructionMatch[4].split("#", 1)[0].trim().toLowerCase();
    while (
      /^(?:notrack|bnd|data16|addr32|lock|xacquire|xrelease|rep|repz|repnz|cs|ds|es|fs|gs|ss|rex(?:\.[a-z])?)$/u.test(
        mnemonic,
      )
    ) {
      const prefixed = operands.match(/^([a-z][a-z0-9.]*)\b\s*(.*)$/u);
      if (prefixed === null) fail("STATEFS_ATTEST_ELF");
      mnemonic = prefixed[1];
      operands = prefixed[2].trim();
    }
    instructions.push({
      sectionName: currentSection,
      functionName: currentFunction,
      address: Number.parseInt(instructionMatch[1], 16),
      byteLength: instructionMatch[2].trim().split(/\s+/u).length,
      mnemonic,
      operands,
    });
  }
  if (instructions.length === 0) fail("STATEFS_ATTEST_ELF");
  return instructions;
}

function verifyDecodedExtents(instructions, extents) {
  const expectedNames = extents.map(({ name }) => name).sort();
  const actualNames = [
    ...new Set(instructions.map(({ sectionName }) => sectionName)),
  ].sort();
  if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) {
    fail("STATEFS_ATTEST_ELF");
  }
  for (const section of extents) {
    const sectionInstructions = instructions
      .filter(({ sectionName }) => sectionName === section.name)
      .sort((left, right) => left.address - right.address);
    let cursor = section.address;
    if (sectionInstructions.length === 0) fail("STATEFS_ATTEST_ELF");
    for (const instruction of sectionInstructions) {
      if (
        instruction.address !== cursor ||
        !Number.isSafeInteger(instruction.byteLength) ||
        instruction.byteLength < 1
      ) {
        fail("STATEFS_ATTEST_ELF");
      }
      cursor += instruction.byteLength;
      if (cursor > section.address + section.size) fail("STATEFS_ATTEST_ELF");
    }
    if (cursor !== section.address + section.size) fail("STATEFS_ATTEST_ELF");
  }
}

function validateInstructionSafety(instructions) {
  const forbidden =
    /^(?:int(?:1|3)?|into|sysenter|sysexit|sysretq?|iret[dlq]?|lcall|ljmp|callf|jmpf|vmcall|vmmcall|rsm|smi|hlt|cli|sti|cpuid|rdtsc|rdtscp|rdpmc|rdrand|rdseed|rdmsr|wrmsr|xgetbv|xsetbv|swapgs|in(?:b|w|l|s[bwl]?)?|out(?:b|w|l|s[bwl]?)?)$/u;
  const syscallNumbers = [];
  const conservativeStackBytes = new Map();
  for (const [index, instruction] of instructions.entries()) {
    if (forbidden.test(instruction.mnemonic) || instruction.mnemonic === "call") {
      fail("STATEFS_ATTEST_ELF");
    }
    const compact = instruction.operands.replace(/\s+/gu, "");
    const stackAdjustment = compact.match(
      /^(?:rsp|esp),(0x[0-9a-f]+|[0-9]+)$/u,
    );
    let newlyReserved = 0;
    if (/^push(?:f|fq)?$/u.test(instruction.mnemonic)) {
      newlyReserved = 8;
    } else if (instruction.mnemonic === "sub") {
      if (compact.startsWith("rsp,") || compact.startsWith("esp,")) {
        if (stackAdjustment === null) fail("STATEFS_ATTEST_ELF");
        newlyReserved = Number.parseInt(stackAdjustment[1], 0);
      }
    } else if (
      instruction.mnemonic === "lea" &&
      /^(?:rsp|esp),\[(?:rsp|esp)-/u.test(compact)
    ) {
      const match = compact.match(
        /^(?:rsp|esp),\[(?:rsp|esp)-(0x[0-9a-f]+|[0-9]+)\]$/u,
      );
      if (match === null) fail("STATEFS_ATTEST_ELF");
      newlyReserved = Number.parseInt(match[1], 0);
    }
    if (newlyReserved > 0) {
      const reserved =
        (conservativeStackBytes.get(instruction.functionName) ?? 0) +
        newlyReserved;
      if (reserved > 256) fail("STATEFS_ATTEST_ELF");
      conservativeStackBytes.set(instruction.functionName, reserved);
    }
    for (const memory of compact.matchAll(/\[([^\]]+)\]/gu)) {
      if (!/\b(?:rsp|esp|rbp|ebp)\b/u.test(memory[1])) continue;
      const exact = memory[1].match(
        /^(?:rsp|esp|rbp|ebp)(?:([+-])(0x[0-9a-f]+|[0-9]+))?$/u,
      );
      if (exact === null) fail("STATEFS_ATTEST_ELF");
      if (
        exact[1] === "-" &&
        Number.parseInt(exact[2] ?? "0", 0) > 256
      ) {
        fail("STATEFS_ATTEST_ELF");
      }
    }
    if (instruction.mnemonic !== "syscall") continue;
    if (index === 0) fail("STATEFS_ATTEST_ELF");
    const load = instructions[index - 1];
    const immediate = load.operands.match(
      /^(?:eax|rax),(0x[0-9a-f]+|[0-9]+)$/u,
    );
    if (
      load.sectionName !== instruction.sectionName ||
      load.functionName !== instruction.functionName ||
      load.address + load.byteLength !== instruction.address ||
      !/^(?:mov|movabs)$/u.test(load.mnemonic) ||
      immediate === null
    ) {
      fail("STATEFS_ATTEST_ELF");
    }
    syscallNumbers.push(Number.parseInt(immediate[1], 0));
  }
  const observed = [...new Set(syscallNumbers)].sort((left, right) => left - right);
  if (
    syscallNumbers.length !== 13 ||
    canonicalJson(observed) !== canonicalJson(EXPECTED_SYSCALL_NUMBERS)
  ) {
    fail("STATEFS_ATTEST_ELF");
  }
  return deepFreeze(
    nullRecord([
      ["directSyscallInstructionCount", syscallNumbers.length],
      ["observedSyscallNumbers", observed],
    ]),
  );
}

function inspectDisassembly(objectPath, objectBytes, sections, repositoryRoot) {
  const child = exactChild(
    OBJDUMP,
    ["-d", "-z", "-w", "-M", "intel", objectPath],
    repositoryRoot,
    INSPECTION_BYTES,
    "STATEFS_ATTEST_ELF",
  );
  if (child.stderr.length !== 0 || child.stdout.length === 0) {
    fail("STATEFS_ATTEST_ELF");
  }
  let output;
  try {
    output = child.stdout.toString("utf8");
  } catch {
    fail("STATEFS_ATTEST_ELF");
  }
  if (!Buffer.from(output, "utf8").equals(child.stdout)) {
    fail("STATEFS_ATTEST_ELF");
  }
  const instructions = parseDisassembly(output);
  verifyDecodedExtents(
    instructions,
    executableSectionExtents(objectBytes, sections),
  );
  return validateInstructionSafety(instructions);
}

function inspectObject(objectPath, objectBytes, repositoryRoot) {
  const elf = inspectElf(objectBytes);
  const disassembly = inspectDisassembly(
    objectPath,
    objectBytes,
    elf.sections,
    repositoryRoot,
  );
  return deepFreeze(
    nullRecord([
      ...Object.entries(elf.projection),
      [
        "directSyscallInstructionCount",
        disassembly.directSyscallInstructionCount,
      ],
      ["observedSyscallNumbers", disassembly.observedSyscallNumbers],
      ["abiLayoutSha256", ABI_LAYOUT_SHA256],
    ]),
  );
}

function exactMatchCount(value, pattern) {
  const matches = value.match(pattern);
  return matches === null ? 0 : matches.length;
}

function validateFaultSource(sourceBytes) {
  const source = sourceBytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(sourceBytes)) {
    fail("STATEFS_ATTEST_FAULT");
  }
  const marker = "OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS";
  const injectionPartition = source.match(
    new RegExp(
      `^\\s*#\\s*ifdef\\s+${marker}\\s*$([\\s\\S]*?)^\\s*#\\s*else\\s*$([\\s\\S]*?)^\\s*#\\s*endif\\s*$`,
      "mu",
    ),
  );
  const validationPartition = source.match(
    new RegExp(
      `^\\s*#\\s*ifndef\\s+${marker}\\s*$([\\s\\S]*?)^\\s*#\\s*else\\s*$([\\s\\S]*?)^\\s*#\\s*endif\\s*$`,
      "mu",
    ),
  );
  if (
    injectionPartition === null ||
    validationPartition === null ||
    exactMatchCount(source, new RegExp(marker, "gu")) !== 2 ||
    exactMatchCount(source, /test_fault_selector/gu) !== 3 ||
    exactMatchCount(source, /OXIGRAPH_STATEFS_EIO/gu) !== 1
  ) {
    fail("STATEFS_ATTEST_FAULT");
  }
  const faultInjection = injectionPartition[1];
  const productionInjection = injectionPartition[2];
  const productionValidation = validationPartition[1];
  const faultValidation = validationPartition[2];
  if (
    !/STATEFS_ALWAYS_INLINE\s+int\s+statefs_fault_selector_is_valid\s*\(/u.test(
      faultInjection,
    ) ||
    !/uint32_t\s+operation\s*=\s*request->operation\s*;/u.test(
      faultInjection,
    ) ||
    !/uint32_t\s+inventory_kind\s*=\s*request->inventory_kind\s*;/u.test(
      faultInjection,
    ) ||
    !/uint32_t\s+selector\s*=\s*request->test_fault_selector\s*;/u.test(
      faultInjection,
    ) ||
    !/request->inventory_directory_role/u.test(faultInjection) ||
    !/STATEFS_ALWAYS_INLINE\s+int\s+statefs_inject\s*\(/u.test(
      faultInjection,
    ) ||
    !/uint32_t\s+selector\s*=\s*after\s*!=\s*0U\s*\?\s*2U\s*\*\s*step\s*:\s*2U\s*\*\s*step\s*-\s*1U\s*;/u.test(
      faultInjection,
    ) ||
    !/if\s*\(request->test_fault_selector\s*!=\s*selector\)\s*return\s+0\s*;/u.test(
      faultInjection,
    ) ||
    !/result->status\s*=\s*OXIGRAPH_STATEFS_STATUS_FAULT_INJECTED\s*;/u.test(
      faultInjection,
    ) ||
    !/result->errno_value\s*=\s*OXIGRAPH_STATEFS_EIO\s*;/u.test(
      faultInjection,
    ) ||
    !/^\s*#\s*define\s+statefs_inject\s*\([^\n]*\)\s+0\s*$/mu.test(
      productionInjection,
    ) ||
    !/^\s*if\s*\(request->test_fault_selector\s*!=\s*0U\)\s*return\s+0\s*;\s*$/mu.test(
      productionValidation,
    ) ||
    !/if\s*\(!statefs_fault_selector_is_valid\s*\(\s*request\s*\)\)\s*return\s+0\s*;/u.test(
      faultValidation,
    ) ||
    exactMatchCount(faultInjection, /test_fault_selector/gu) !== 2 ||
    exactMatchCount(faultValidation, /test_fault_selector/gu) !== 0 ||
    exactMatchCount(productionValidation, /test_fault_selector/gu) !== 1 ||
    exactMatchCount(productionInjection, /test_fault_selector/gu) !== 0 ||
    exactMatchCount(faultInjection, /OXIGRAPH_STATEFS_EIO/gu) !== 1 ||
    exactMatchCount(productionInjection, /OXIGRAPH_STATEFS_EIO/gu) !== 0 ||
    exactMatchCount(productionValidation, /OXIGRAPH_STATEFS_EIO/gu) !== 0 ||
    exactMatchCount(faultValidation, /OXIGRAPH_STATEFS_EIO/gu) !== 0
  ) {
    fail("STATEFS_ATTEST_FAULT");
  }
  return deepFreeze(
    nullRecord([
      ["productionFaultSelectorPresent", false],
      ["faultFaultSelectorPresent", true],
    ]),
  );
}

function makeFaultInspection(
  objectSha256,
  projection,
  faultSelectorPresent,
) {
  const unsigned = nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-syscalls-fault-inspection/v1",
    ],
    ["objectSha256", objectSha256],
    ["elfClass", projection.elfClass],
    ["elfData", projection.elfData],
    ["elfType", projection.elfType],
    ["elfMachine", projection.elfMachine],
    ["definedGlobalSymbols", projection.definedGlobalSymbols],
    ["undefinedSymbols", projection.undefinedSymbols],
    ["pltEntries", projection.pltEntries],
    ["relocationTargets", projection.relocationTargets],
    ["gnuStackExecutable", projection.gnuStackExecutable],
    [
      "writableExecutableSectionCount",
      projection.writableExecutableSectionCount,
    ],
    [
      "directSyscallInstructionCount",
      projection.directSyscallInstructionCount,
    ],
    ["observedSyscallNumbers", projection.observedSyscallNumbers],
    ["abiLayoutSha256", projection.abiLayoutSha256],
    ["faultSelectorPresent", faultSelectorPresent],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["inspectionSha256", semanticSha256(unsigned)],
    ]),
  );
}

function makeReport({
  buildKind,
  compilerRealpath,
  compilerBytes,
  compilerVersionBytes,
  headerBytes,
  sourceBytes,
  first,
  second,
  fault,
  productionProjection,
  faultProjection,
  faultSourcePartition,
}) {
  const firstSha256 = sha256(first.objectBytes);
  const secondSha256 = sha256(second.objectBytes);
  const faultSha256 = fault === null ? null : sha256(fault.objectBytes);
  const faultInspection =
    fault === null
      ? null
      : makeFaultInspection(
          faultSha256,
          faultProjection,
          faultSourcePartition.faultFaultSelectorPresent,
        );
  const unsigned = nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-syscalls-attestation/v1",
    ],
    [
      "requirementsSha256",
      CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256,
    ],
    ["buildKind", buildKind],
    ["platform", PLATFORM],
    ["compilerRealpath", compilerRealpath],
    ["compilerByteLength", compilerBytes.length],
    ["compilerSha256", sha256(compilerBytes)],
    ["compilerVersionByteLength", compilerVersionBytes.length],
    ["compilerVersionSha256", sha256(compilerVersionBytes)],
    ["firstProductionArgv", first.argv],
    ["secondProductionArgv", second.argv],
    ["faultArgv", fault === null ? null : fault.argv],
    ["environment", ENVIRONMENT],
    ["headerByteLength", headerBytes.length],
    ["headerSha256", sha256(headerBytes)],
    ["sourceByteLength", sourceBytes.length],
    ["sourceSha256", sha256(sourceBytes)],
    ["firstObjectByteLength", first.objectBytes.length],
    ["firstObjectSha256", firstSha256],
    ["secondObjectByteLength", second.objectBytes.length],
    ["secondObjectSha256", secondSha256],
    ["repeatedObjectBytesEqual", true],
    ["faultObjectByteLength", fault === null ? null : fault.objectBytes.length],
    ["faultObjectSha256", faultSha256],
    ["faultInspection", faultInspection],
    ["elfClass", productionProjection.elfClass],
    ["elfData", productionProjection.elfData],
    ["elfType", productionProjection.elfType],
    ["elfMachine", productionProjection.elfMachine],
    ["definedGlobalSymbols", productionProjection.definedGlobalSymbols],
    ["undefinedSymbols", productionProjection.undefinedSymbols],
    ["pltEntries", productionProjection.pltEntries],
    ["relocationTargets", productionProjection.relocationTargets],
    ["gnuStackExecutable", productionProjection.gnuStackExecutable],
    [
      "writableExecutableSectionCount",
      productionProjection.writableExecutableSectionCount,
    ],
    [
      "directSyscallInstructionCount",
      productionProjection.directSyscallInstructionCount,
    ],
    ["observedSyscallNumbers", productionProjection.observedSyscallNumbers],
    ["abiLayoutSha256", productionProjection.abiLayoutSha256],
    [
      "faultSelectorPresent",
      faultSourcePartition.productionFaultSelectorPresent,
    ],
  ]);
  const report = deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["reportSha256", semanticSha256(unsigned)],
      ["authority", AUTHORITY],
      ["physicalFacts", PHYSICAL_FACTS],
      ["nonclaims", NONCLAIMS],
    ]),
  );
  if (
    Object.keys(report).length !== REPORT_FIELDS.length ||
    REPORT_FIELDS.some((field, index) => Object.keys(report)[index] !== field) ||
    Buffer.byteLength(canonicalJson(report), "utf8") > REPORT_BYTES
  ) {
    fail("STATEFS_ATTEST_BOUNDS");
  }
  if (
    faultInspection !== null &&
    (Object.keys(faultInspection).length !== FAULT_INSPECTION_FIELDS.length ||
      FAULT_INSPECTION_FIELDS.some(
        (field, index) => Object.keys(faultInspection)[index] !== field,
      ))
  ) {
    fail("STATEFS_ATTEST_FAULT");
  }
  return report;
}

async function compilerEvidence(repositoryRoot) {
  let compilerRealpath;
  let compiler;
  try {
    compilerRealpath = await realpath(COMPILER);
    if (!isAbsolute(compilerRealpath)) fail("STATEFS_ATTEST_COMPILER");
    compiler = await readBoundedRegular(
      compilerRealpath,
      SOURCE_BYTES,
      "STATEFS_ATTEST_COMPILER",
    );
  } catch (error) {
    if (error instanceof Error && error.message === "STATEFS_ATTEST_COMPILER") {
      throw error;
    }
    fail("STATEFS_ATTEST_COMPILER");
  }
  const version = exactChild(
    compilerRealpath,
    ["--version"],
    repositoryRoot,
    COMPILER_VERSION_BYTES,
    "STATEFS_ATTEST_COMPILER",
  );
  if (
    version.stderr.length !== 0 ||
    version.stdout.length < 1 ||
    version.stdout.length > COMPILER_VERSION_BYTES
  ) {
    fail("STATEFS_ATTEST_COMPILER");
  }
  return {
    compilerRealpath,
    compilerBytes: compiler.bytes,
    compilerVersionBytes: version.stdout,
  };
}

export async function attestCandidateContainmentGuardianStatefsSyscallsV1(
  input,
) {
  inspectInputBounds(input);
  const normalized = exactInput(input);
  validateDerivedBounds(normalized);
  await validatePaths(normalized);

  const headerPath = join(normalized.repositoryRoot, HEADER_RELATIVE);
  const sourcePath = join(normalized.repositoryRoot, SOURCE_RELATIVE);
  const [header, source] = await Promise.all([
    readBoundedRegular(headerPath, SOURCE_BYTES, "STATEFS_ATTEST_BOUNDS"),
    readBoundedRegular(sourcePath, SOURCE_BYTES, "STATEFS_ATTEST_BOUNDS"),
  ]);
  const compiler = await compilerEvidence(normalized.repositoryRoot);

  let first;
  let second;
  let fault = null;
  const previousUmask = process.umask(0o077);
  try {
    first = await compileObject({
      compilerRealpath: compiler.compilerRealpath,
      repositoryRoot: normalized.repositoryRoot,
      privateBuildRoot: normalized.privateBuildRoot,
      directory: "production-0001",
      basename: "containment-guardian-statefs-syscalls-v1.o",
      fault: false,
    });
    second = await compileObject({
      compilerRealpath: compiler.compilerRealpath,
      repositoryRoot: normalized.repositoryRoot,
      privateBuildRoot: normalized.privateBuildRoot,
      directory: "production-0002",
      basename: "containment-guardian-statefs-syscalls-v1.o",
      fault: false,
    });
    if (normalized.buildKind === "FAULT") {
      fault = await compileObject({
        compilerRealpath: compiler.compilerRealpath,
        repositoryRoot: normalized.repositoryRoot,
        privateBuildRoot: normalized.privateBuildRoot,
        directory: "fault-0001",
        basename: "containment-guardian-statefs-syscalls-v1-fault.o",
        fault: true,
      });
    }
  } finally {
    process.umask(previousUmask);
  }

  await validateBuildTopology(
    normalized.privateBuildRoot,
    normalized.buildKind,
  );

  const [headerAfterBuild, sourceAfterBuild, compilerAfterBuild] =
    await Promise.all([
      readBoundedRegular(headerPath, SOURCE_BYTES, "STATEFS_ATTEST_BUILD"),
      readBoundedRegular(sourcePath, SOURCE_BYTES, "STATEFS_ATTEST_BUILD"),
      readBoundedRegular(
        compiler.compilerRealpath,
        SOURCE_BYTES,
        "STATEFS_ATTEST_BUILD",
      ),
    ]);
  if (
    !header.bytes.equals(headerAfterBuild.bytes) ||
    !source.bytes.equals(sourceAfterBuild.bytes) ||
    !compiler.compilerBytes.equals(compilerAfterBuild.bytes)
  ) {
    fail("STATEFS_ATTEST_BUILD");
  }

  if (!first.objectBytes.equals(second.objectBytes)) {
    fail("STATEFS_ATTEST_BUILD");
  }
  const productionProjection = inspectObject(
    first.objectPath,
    first.objectBytes,
    normalized.repositoryRoot,
  );
  const secondProjection = inspectObject(
    second.objectPath,
    second.objectBytes,
    normalized.repositoryRoot,
  );
  if (canonicalJson(productionProjection) !== canonicalJson(secondProjection)) {
    fail("STATEFS_ATTEST_ELF");
  }
  let faultProjection = null;
  if (fault !== null) {
    faultProjection = inspectObject(
      fault.objectPath,
      fault.objectBytes,
      normalized.repositoryRoot,
    );
  }

  validateHeaderAbi(header.bytes);
  const faultSourcePartition = validateFaultSource(source.bytes);
  if (fault !== null && fault.objectBytes.equals(first.objectBytes)) {
    fail("STATEFS_ATTEST_FAULT");
  }

  return makeReport({
    buildKind: normalized.buildKind,
    compilerRealpath: compiler.compilerRealpath,
    compilerBytes: compiler.compilerBytes,
    compilerVersionBytes: compiler.compilerVersionBytes,
    headerBytes: header.bytes,
    sourceBytes: source.bytes,
    first,
    second,
    fault,
    productionProjection,
    faultProjection,
    faultSourcePartition,
  });
}
