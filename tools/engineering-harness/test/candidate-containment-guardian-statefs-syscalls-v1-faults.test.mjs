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
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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
    202635,
    "35a9d8990a67f4a9c332d6a32d47314d19ea73c474610efab240a2cf80b7f97d",
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

const EXPECTED_REQUIREMENTS_SHA256 =
  "16756669b08e3898380065d27a8e3e0ad6e4eaaaf7a3a9d445f9506385a9ac23";
const EXPECTED_ABI_LAYOUT_SHA256 =
  "f69c11d17c0264b2af3eaee0e092bb27ce149207425f8239879d85f1ca589ffd";

const EXPECTED_STEPS = Object.freeze([
  ["NONE", 0],
  ["REQUEST_VALIDATED", 1],
  ["FD_A_VALIDATED", 2],
  ["FD_B_VALIDATED", 3],
  ["LOCK_ACQUIRED", 4],
  ["INTERNAL_DESCRIPTOR_OPENED", 5],
  ["DIRECTORY_ENUMERATED", 6],
  ["ENTRY_REOBSERVED", 7],
  ["TEMP_CREATED", 8],
  ["TEMP_WRITTEN", 9],
  ["TEMP_READ_BACK", 10],
  ["TEMP_FILE_SYNCED", 11],
  ["FINAL_INSTALLED", 12],
  ["CHILD_DIRECTORY_CREATED", 13],
  ["CHILD_DIRECTORY_SYNCED", 14],
  ["SOURCE_REOBSERVED", 15],
  ["GENERATION_MOVED", 16],
  ["SOURCE_PARENT_SYNCED", 17],
  ["DESTINATION_PARENT_SYNCED", 18],
  ["TEMP_UNLINKED", 19],
  ["PARENT_SYNCED", 20],
  ["DESTINATION_REOBSERVED", 21],
  ["SOURCE_ABSENCE_REOBSERVED", 22],
  ["TEMP_ABSENCE_REOBSERVED", 23],
  ["INVENTORY_DESCRIPTOR_CLOSED", 24],
  ["TEMP_READ_DESCRIPTOR_OPENED", 25],
  ["TEMP_READ_DESCRIPTOR_CLOSED", 26],
  ["TEMP_WRITE_DESCRIPTOR_CLOSED", 27],
  ["FINAL_READ_DESCRIPTOR_OPENED", 28],
  ["FINAL_READ_DESCRIPTOR_CLOSED", 29],
  ["CHILD_DESCRIPTOR_CLOSED", 30],
  ["PRE_SYNC_DESTINATION_REOBSERVED", 31],
  ["DIRECTORY_HANDLE_TRANSFERRED", 32],
  ["CREATED_METADATA_VALIDATED", 33],
  ["DIRECTORY_RELEASED", 34],
]);

const EXPECTED_SEQUENCES = deepFreeze(
  orderedRecord([
    ["LOCK_EX_NB", [1, 2, 4]],
    ["INVENTORY/DIRECTORY/ROOT", [1, 2, 5, 6, 24]],
    ["INVENTORY/DIRECTORY/CHILD", [1, 2, 5, 6, 32]],
    ["INVENTORY/REGULAR_FILE/PRESENT", [1, 2, 5, 7, 24]],
    ["INVENTORY/REGULAR_FILE/ABSENT", [1, 2, 7]],
    [
      "PERSIST_NOREPLACE",
      [1, 2, 8, 33, 9, 25, 10, 26, 11, 27, 12, 20, 28, 21, 29],
    ],
    ["MKDIR_SYNC", [1, 2, 13, 33, 5, 14, 30, 20, 21]],
    ["MOVE_NOREPLACE_SYNC", [1, 2, 3, 15, 16, 17, 18, 22, 21]],
    ["MOVE_SYNC_REOBSERVE", [1, 2, 3, 15, 31, 17, 18, 22, 21]],
    ["TEMP_CLEANUP", [1, 2, 15, 19, 20, 23]],
    ["RELEASE_DIRECTORY", [1, 2, 34]],
  ]),
);

const EXPECTED_FAULT_CLASSES = deepFreeze(
  orderedRecord([
    [
      "LOCK_EX_NB",
      orderedRecord([
        ["before", "DDD"],
        ["after", "DDU"],
      ]),
    ],
    [
      "INVENTORY/DIRECTORY/ROOT",
      orderedRecord([
        ["before", "DDDDD"],
        ["after", "DDDDD"],
      ]),
    ],
    [
      "INVENTORY/DIRECTORY/CHILD",
      orderedRecord([
        ["before", "DDDDD"],
        ["after", "DDDDD"],
      ]),
    ],
    [
      "INVENTORY/REGULAR_FILE/PRESENT",
      orderedRecord([
        ["before", "DDDDD"],
        ["after", "DDDDD"],
      ]),
    ],
    [
      "INVENTORY/REGULAR_FILE/ABSENT",
      orderedRecord([
        ["before", "DDD"],
        ["after", "DDD"],
      ]),
    ],
    [
      "PERSIST_NOREPLACE",
      orderedRecord([
        ["before", "DDDMMMMMMMMMMMM"],
        ["after", "DDMMMMMMMMMMMMU"],
      ]),
    ],
    [
      "MKDIR_SYNC",
      orderedRecord([
        ["before", "DDDMMMMMM"],
        ["after", "DDMMMMMMU"],
      ]),
    ],
    [
      "MOVE_NOREPLACE_SYNC",
      orderedRecord([
        ["before", "DDDDDMMMM"],
        ["after", "DDDDMMMMU"],
      ]),
    ],
    [
      "MOVE_SYNC_REOBSERVE",
      orderedRecord([
        ["before", "UUUUUUUUU"],
        ["after", "UUUUUUUUU"],
      ]),
    ],
    [
      "TEMP_CLEANUP",
      orderedRecord([
        ["before", "DDDDMM"],
        ["after", "DDDMMU"],
      ]),
    ],
    [
      "RELEASE_DIRECTORY",
      orderedRecord([
        ["before", "DDD"],
        ["after", "DDU"],
      ]),
    ],
  ]),
);

const EXPECTED_ERRNOS = Object.freeze([
  ["EPERM", 1],
  ["ENOENT", 2],
  ["EINTR", 4],
  ["EIO", 5],
  ["EBADF", 9],
  ["EAGAIN", 11],
  ["EWOULDBLOCK", 11],
  ["EACCES", 13],
  ["EFAULT", 14],
  ["EEXIST", 17],
  ["ENOTDIR", 20],
  ["EISDIR", 21],
  ["EINVAL", 22],
  ["EFBIG", 27],
  ["ENOSPC", 28],
  ["EROFS", 30],
  ["EMLINK", 31],
  ["ENAMETOOLONG", 36],
  ["ENOSYS", 38],
  ["ENOTEMPTY", 39],
  ["ELOOP", 40],
  ["EOVERFLOW", 75],
  ["EOPNOTSUPP", 95],
  ["ESTALE", 116],
]);

const EXPECTED_EFFECTS = deepFreeze(
  orderedRecord([
    [
      "D",
      orderedRecord([
        ["effectClass", "DEFINITE_NO_EFFECT"],
        ["outcome", "FAILED_DEFINITE_NO_EFFECT"],
      ]),
    ],
    [
      "M",
      orderedRecord([
        ["effectClass", "MUTATION_OBSERVED_NOT_FULLY_SYNCED"],
        ["outcome", "FAILED_MUTATION_NOT_FULLY_SYNCED"],
      ]),
    ],
    [
      "U",
      orderedRecord([
        ["effectClass", "EFFECT_UNCERTAIN"],
        ["outcome", "FAILED_EFFECT_UNCERTAIN"],
      ]),
    ],
  ]),
);

const EXPECTED_ERRNO_CLASS_ROWS = deepFreeze([
  ["LOCK_EX_NB", [2, 4], "D"],
  ["INVENTORY", [2, 5, 6, 7, 32], "D"],
  ["INVENTORY/ROOT_OR_PRESENT_FILE_CLOSE", [24], "U"],
  ["PERSIST_NOREPLACE", [8], "D"],
  ["PERSIST_NOREPLACE", [33, 9, 25, 10, 11, 12], "M"],
  ["PERSIST_NOREPLACE", [26, 27, 20, 28, 21, 29], "U"],
  ["MKDIR_SYNC", [13], "D"],
  ["MKDIR_SYNC", [33, 5, 14], "M"],
  ["MKDIR_SYNC", [30, 20, 21], "U"],
  ["MOVE_NOREPLACE_SYNC", [2, 3, 15, 16], "D"],
  ["MOVE_NOREPLACE_SYNC", [17, 18], "M"],
  ["MOVE_NOREPLACE_SYNC", [22, 21], "U"],
  ["MOVE_SYNC_REOBSERVE", "EVERY_SYSCALL_STEP", "U"],
  ["TEMP_CLEANUP", [2, 15, 19], "D"],
  ["TEMP_CLEANUP", [20, 23], "U"],
  ["RELEASE_DIRECTORY", [2], "D"],
  ["RELEASE_DIRECTORY", [34], "U"],
]);

const EXPECTED_ZERO_IO_RULES = deepFreeze([
  orderedRecord([
    ["case", "zero-write-before-input-complete"],
    ["status", "VERIFICATION_FAILED"],
    ["effect", "M"],
    ["errno", 0],
    ["failedStep", 9],
    ["lastCompletedStep", 33],
    ["bytesConsumed", "EXACT_PARTIAL_POSITIVE_BYTES"],
  ]),
  orderedRecord([
    ["case", "regular-file-premature-zero-or-extra-byte"],
    ["status", "VERIFICATION_FAILED"],
    ["effect", "D"],
    ["errno", 0],
    ["failedStep", 7],
    ["lastCompletedStep", 5],
    ["zeroLengthRequiresOneZeroRead", true],
  ]),
  orderedRecord([
    ["case", "temporary-readback-premature-zero-or-extra-byte"],
    ["status", "VERIFICATION_FAILED"],
    ["effect", "M"],
    ["errno", 0],
    ["failedStep", 10],
    ["lastCompletedStep", 25],
  ]),
  orderedRecord([
    ["case", "final-readback-premature-zero-or-extra-byte"],
    ["status", "VERIFICATION_FAILED"],
    ["effect", "U"],
    ["errno", 0],
    ["failedStep", 21],
    ["lastCompletedStep", 28],
  ]),
]);

const EXPECTED_SPECIAL_RULES = deepFreeze([
  ["flock-eagain-ewouldblock", "SYSCALL_FAILED/D/LOCK_CONTENDED"],
  ["initial-file-enoent", "COMPLETE/COMPLETE/INVENTORY_OBSERVED/errno=0"],
  ["read-write-eintr", "retry-at-most-8-consecutive-reset-on-progress"],
  ["ninth-consecutive-read-write-eintr", "report-original-errno"],
  ["every-other-errno", "1..4095/OTHER/no-symbolic-default"],
  ["step-1-validation", "REJECTED/NO_EFFECT/REJECTED/errno=0"],
  ["step-2-or-3-metadata-mismatch", "REJECTED/NO_EFFECT/REJECTED/errno=0"],
  [
    "inventory-step-24-close-failure",
    "SYSCALL_FAILED/U/FAILED_EFFECT_UNCERTAIN",
  ],
  ["before-step-24", "D-upgraded-to-U-only-if-cleanup-close-fails"],
  ["after-step-24", "D"],
  ["after-step-32", "D/provisional-fd-best-effort-close/no-map-insertion"],
  ["before-step-34", "D/no-c-close/no-retry/adapter-teardown-once"],
  ["after-step-34", "U/fd-integer-retired/no-retry"],
  ["mutating-eexist-enoent", "same-row-as-every-other-errno"],
  [
    "cleanup-close",
    "reverse-open-once/no-step/no-errno-replacement/D-or-M-to-U",
  ],
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

const EXPECTED_ENVIRONMENT = Object.freeze([
  Object.freeze(["LC_ALL", "C"]),
  Object.freeze(["LANG", "C"]),
  Object.freeze(["TZ", "UTC"]),
  Object.freeze(["SOURCE_DATE_EPOCH", "0"]),
]);

const EXPECTED_PRODUCTION_ARGV_TAIL = Object.freeze([
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
  `-ffile-prefix-map=${REPOSITORY_ROOT}=.`,
  `-fdebug-prefix-map=${REPOSITORY_ROOT}=.`,
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

const EXPECTED_ATTESTATION_ERRORS = Object.freeze([
  "STATEFS_ATTEST_BOUNDS",
  "STATEFS_ATTEST_SHAPE",
  "STATEFS_ATTEST_PATH",
  "STATEFS_ATTEST_COMPILER",
  "STATEFS_ATTEST_BUILD",
  "STATEFS_ATTEST_ELF",
  "STATEFS_ATTEST_ABI",
  "STATEFS_ATTEST_FAULT",
]);

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
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
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

function digestPrecedingFields(value, digestField, fields) {
  const end = fields.indexOf(digestField);
  assert.ok(end > 0);
  return semanticSha256(
    orderedRecord(fields.slice(0, end).map((key) => [key, value[key]])),
  );
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

function independentlyParseElf(bytes) {
  checkedRange(bytes, 0, 64, "elf-header");
  assert.deepEqual(
    [...bytes.subarray(0, 7)],
    [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1],
  );
  assert.equal(bytes.readUInt16LE(16), 1);
  assert.equal(bytes.readUInt16LE(18), 62);
  assert.equal(bytes.readUInt16LE(52), 64);
  const sectionOffset = boundedU64(bytes, 40, "section-table");
  const sectionEntrySize = bytes.readUInt16LE(58);
  const sectionCount = bytes.readUInt16LE(60);
  const namesIndex = bytes.readUInt16LE(62);
  assert.equal(sectionEntrySize, 64);
  assert.ok(sectionCount >= 1 && sectionCount <= 256);
  assert.ok(namesIndex > 0 && namesIndex < sectionCount);
  checkedRange(
    bytes,
    sectionOffset,
    sectionEntrySize * sectionCount,
    "sections",
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
      entrySize: boundedU64(bytes, offset + 56, `section-${index}-entry-size`),
    });
  }
  const nameSection = sections[namesIndex];
  checkedRange(bytes, nameSection.offset, nameSection.size, "section-names");
  const names = bytes.subarray(
    nameSection.offset,
    nameSection.offset + nameSection.size,
  );
  for (const section of sections) {
    section.name = asciiCString(
      names,
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
  let symbolCount = 0;
  for (const section of sections.filter(({ type }) => type === 2)) {
    assert.equal(section.entrySize, 24);
    assert.equal(section.size % 24, 0);
    const stringSection = sections[section.link];
    assert.notEqual(stringSection, undefined);
    const strings = bytes.subarray(
      stringSection.offset,
      stringSection.offset + stringSection.size,
    );
    const symbols = [];
    const count = section.size / 24;
    symbolCount += count;
    assert.ok(symbolCount <= 512);
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * 24;
      const name = asciiCString(
        strings,
        bytes.readUInt32LE(offset),
        `${section.name}:symbol-${index}`,
      );
      const info = bytes[offset + 4];
      const symbol = {
        name,
        binding: info >> 4,
        sectionIndex: bytes.readUInt16LE(offset + 6),
      };
      symbols.push(symbol);
      if (name !== "" && symbol.sectionIndex === 0) undefinedSymbols.push(name);
      if (name !== "" && symbol.sectionIndex !== 0 && symbol.binding !== 0) {
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
    const entrySize = section.type === 4 ? 24 : 16;
    assert.equal(section.entrySize, entrySize);
    assert.equal(section.size % entrySize, 0);
    const symbols = symbolTables.get(section.link);
    assert.notEqual(symbols, undefined);
    const count = section.size / entrySize;
    relocationCount += count;
    assert.ok(relocationCount <= 4096);
    for (let index = 0; index < count; index += 1) {
      const offset = section.offset + index * entrySize;
      const symbolIndex = Number(bytes.readBigUInt64LE(offset + 8) >> 32n);
      assert.ok(symbolIndex < symbols.length);
      if (symbolIndex === 0) continue;
      const symbol = symbols[symbolIndex];
      const targetSection = sections[symbol.sectionIndex];
      const target = symbol.name || targetSection?.name;
      assert.ok(typeof target === "string" && target.length > 0);
      assert.ok(
        (symbol.binding === 0 && symbol.sectionIndex !== 0) ||
          (targetSection !== undefined && (targetSection.flags & 0x1) === 0),
      );
      relocationTargets.push(target);
    }
  }

  const stack = sections.find(({ name }) => name === ".note.GNU-stack");
  assert.notEqual(stack, undefined);
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
    writableExecutableSectionCount: sections.filter(
      ({ flags }) => (flags & 0x1) !== 0 && (flags & 0x4) !== 0,
    ).length,
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
  assert.deepEqual(values, [...new Set(values)].sort());
  for (const value of values) assert.match(value, /^[\x20-\x7e]+$/u);
}

function expectedArgv(compiler, privateBuildRoot, child, basename, fault) {
  const argv = [
    compiler,
    ...EXPECTED_PRODUCTION_ARGV_TAIL,
    ...(fault ? ["-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1"] : []),
    "-c",
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c",
    "-o",
    join(privateBuildRoot, child, basename),
  ];
  return argv;
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
  const occurrences = [...masked.matchAll(/\b(?:__asm__|__asm|asm)\b/gu)];
  assert.ok(occurrences.length > 0, "direct syscall assembly required");
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
    assert.equal(
      clean.slice(open + 1, templateEnd).trim(),
      '"syscall"',
      "inline-assembly-template",
    );
  }
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

function preprocessCandidate(
  url,
  { fault = false, preserveLineMarkers = false } = {},
) {
  const child = spawnSync(
    "/usr/bin/cc",
    [
      ...EXPECTED_PRODUCTION_ARGV_TAIL,
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

function preprocessCandidateSource({ fault }) {
  return preprocessCandidate(SOURCE_URL, { fault });
}

function faultConditionalPolarity(directive, expression) {
  const target = "OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS";
  if (directive === "ifdef") return expression.trim() === target ? 1 : 0;
  if (directive === "ifndef") return expression.trim() === target ? -1 : 0;
  const compact = expression.replace(/\s+/gu, "");
  if (!compact.includes(target)) return 0;
  if (new RegExp(`^!?defined\\(?${target}\\)?(?:&&.*)?$`, "u").test(compact)) {
    return compact.startsWith("!") ? -1 : 1;
  }
  if (new RegExp(`^${target}(?:==1)?(?:&&.*)?$`, "u").test(compact)) {
    return 1;
  }
  if (new RegExp(`^!?${target}(?:==0)(?:&&.*)?$`, "u").test(compact)) {
    return compact.startsWith("!") ? 1 : -1;
  }
  assert.fail(`unsupported fault conditional: ${expression.trim()}`);
}

function conditionalSourceLines(source) {
  const logical = stripCComments(source.replace(/\\(?:\r\n|\n|\r)/gu, ""));
  const stack = [];
  const lines = [];
  for (const [index, line] of logical.split(/\r?\n/u).entries()) {
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)$/u.exec(
      line,
    );
    if (directive !== null) {
      assert.notEqual(directive[1], "elif", `unsupported elif:${index + 1}`);
      if (["if", "ifdef", "ifndef"].includes(directive[1])) {
        stack.push({
          polarity: faultConditionalPolarity(directive[1], directive[2]),
          elseSeen: false,
        });
      } else if (directive[1] === "else") {
        assert.ok(stack.length > 0, `preprocessor else:${index + 1}`);
        const frame = stack.at(-1);
        assert.equal(frame.elseSeen, false, `duplicate else:${index + 1}`);
        frame.elseSeen = true;
        frame.polarity = -frame.polarity;
      } else {
        assert.ok(stack.length > 0, `preprocessor endif:${index + 1}`);
        stack.pop();
      }
      continue;
    }
    const hasFaultGuard = stack.some(({ polarity }) => polarity === 1);
    const hasProductionGuard = stack.some(({ polarity }) => polarity === -1);
    lines.push(
      Object.freeze({
        line,
        lineNumber: index + 1,
        faultOnly: hasFaultGuard && !hasProductionGuard,
        productionOnly: hasProductionGuard && !hasFaultGuard,
      }),
    );
  }
  assert.equal(stack.length, 0, "unterminated preprocessor conditional");
  return lines;
}

function assertFaultMacroPartition(rawSource, productionSource, faultSource) {
  const lines = conditionalSourceLines(rawSource);
  const faultOnlySource = lines
    .filter(({ faultOnly }) => faultOnly)
    .map(({ line }) => line)
    .join("\n");
  const productionOnlySource = lines
    .filter(({ productionOnly }) => productionOnly)
    .map(({ line }) => line)
    .join("\n");
  assert.match(faultOnlySource, /\S/u);
  assert.match(productionOnlySource, /\S/u);

  const activeCode = (source) =>
    stripCComments(source).replace(/^\s*#.*$/gmu, "");
  const production = activeCode(productionSource);
  const fault = activeCode(faultSource);
  assert.notEqual(production, fault);
  const productionLines = new Set(
    production
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const faultLines = new Set(
    fault
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const productionOnly = [...productionLines]
    .filter((line) => !faultLines.has(line))
    .join("\n");
  const faultOnly = [...faultLines]
    .filter((line) => !productionLines.has(line))
    .join("\n");
  assert.match(productionOnly, /\S/u);
  assert.match(faultOnly, /\S/u);
}

function assertElfProjection(value, { faultSelectorPresent }) {
  assert.equal(value.elfClass, "ELF64");
  assert.equal(value.elfData, "LSB");
  assert.equal(value.elfType, "REL");
  assert.equal(value.elfMachine, "AMD64");
  assert.deepEqual(value.definedGlobalSymbols, [
    "oxigraph_containment_statefs_execute_v1",
  ]);
  assert.deepEqual(value.undefinedSymbols, []);
  assert.deepEqual(value.pltEntries, []);
  assertDenseSortedUniqueAscii(value.relocationTargets);
  assert.equal(value.gnuStackExecutable, false);
  assert.equal(value.writableExecutableSectionCount, 0);
  assert.equal(value.directSyscallInstructionCount, 13);
  assert.deepEqual(
    value.observedSyscallNumbers,
    EXPECTED_SYSCALLS.map(([, number]) => number),
  );
  assert.match(value.abiLayoutSha256, /^[0-9a-f]{64}$/u);
  assert.equal(value.faultSelectorPresent, faultSelectorPresent);
}

function faultCases() {
  const cases = [];
  for (const operation of Object.keys(EXPECTED_SEQUENCES)) {
    const sequence = EXPECTED_SEQUENCES[operation];
    const classes = EXPECTED_FAULT_CLASSES[operation];
    assert.equal(classes.before.length, sequence.length, `${operation}:before`);
    assert.equal(classes.after.length, sequence.length, `${operation}:after`);
    for (const [index, step] of sequence.entries()) {
      cases.push(
        deepFreeze(
          orderedRecord([
            ["operation", operation],
            ["position", index],
            ["boundary", "before"],
            ["selector", 2 * step - 1],
            ["status", "FAULT_INJECTED"],
            ["errno", 5],
            ["completedPrefix", sequence.slice(0, index)],
            ["completedStepCount", index],
            ["lastCompletedStep", index === 0 ? 0 : sequence[index - 1]],
            ["failedStep", step],
            ["class", classes.before[index]],
          ]),
        ),
        deepFreeze(
          orderedRecord([
            ["operation", operation],
            ["position", index],
            ["boundary", "after"],
            ["selector", 2 * step],
            ["status", "FAULT_INJECTED"],
            ["errno", 5],
            ["completedPrefix", sequence.slice(0, index + 1)],
            ["completedStepCount", index + 1],
            ["lastCompletedStep", step],
            ["failedStep", 0],
            ["class", classes.after[index]],
          ]),
        ),
      );
    }
  }
  return Object.freeze(cases);
}

const EXPECTED_FAULT_CASES = faultCases();
const EXPECTED_ORACLE_SHA256 = deepFreeze(
  orderedRecord([
    [
      "steps",
      "0072c5fee916727db69307e3810a355892430d500c89e5401466e6bb270a7b33",
    ],
    [
      "sequences",
      "e8c0609c5bdc55d08f53b3bfc6e7a97b3d7a594414307cc1fcb30998efeb3d98",
    ],
    [
      "faultClasses",
      "e27b1133bfc745bfbe4540c591c9f00fb36bec63ace4c19d83e5bc1691c10a80",
    ],
    [
      "faultCases",
      "a981c76099f703d117413925705bd4255d37787fe36f189c9c7bddc84c4c692c",
    ],
    [
      "errnos",
      "69c57ae2075a5e8cd21ef0ee39388e09a7e77133acc83ff56ab732df29565a82",
    ],
    [
      "effects",
      "ffee57618f014c42e5cc88bd107f0cbc292ceee74cae9e17986561805009dc5c",
    ],
    [
      "errnoRows",
      "6aeb9100fdb77f1a8bd310db816d2789f13ba99bacdaf8418b36e00df3336be1",
    ],
    [
      "zeroIo",
      "2bae671baed1314e3eab3ba164f824acd698f24ba0297413b694b63079611445",
    ],
    [
      "specialRules",
      "360083e614f4535031365141bdd592d8a812ecd32952d045f4858711f7421cd9",
    ],
  ]),
);

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
  throw new Error("STATEFS_FAULT_EVALUATOR_PARTIAL_SOURCE_TRIPLET");
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

test("independently freezes every numeric operation step and dense sequence", () => {
  assert.deepEqual(
    orderedRecord([
      ["steps", semanticSha256(EXPECTED_STEPS)],
      ["sequences", semanticSha256(EXPECTED_SEQUENCES)],
      ["faultClasses", semanticSha256(EXPECTED_FAULT_CLASSES)],
      ["faultCases", semanticSha256(EXPECTED_FAULT_CASES)],
      ["errnos", semanticSha256(EXPECTED_ERRNOS)],
      ["effects", semanticSha256(EXPECTED_EFFECTS)],
      ["errnoRows", semanticSha256(EXPECTED_ERRNO_CLASS_ROWS)],
      ["zeroIo", semanticSha256(EXPECTED_ZERO_IO_RULES)],
      ["specialRules", semanticSha256(EXPECTED_SPECIAL_RULES)],
    ]),
    EXPECTED_ORACLE_SHA256,
  );
  assert.deepEqual(
    EXPECTED_STEPS.map(([, number]) => number),
    Array.from({ length: 35 }, (_, index) => index),
  );
  assert.equal(Object.keys(EXPECTED_SEQUENCES).length, 11);
  assert.deepEqual(
    [...new Set(Object.values(EXPECTED_SEQUENCES).flat())].sort(
      (left, right) => left - right,
    ),
    Array.from({ length: 34 }, (_, index) => index + 1),
  );
  assert.deepEqual(EXPECTED_SEQUENCES["INVENTORY/DIRECTORY/ROOT"].at(-1), 24);
  assert.deepEqual(EXPECTED_SEQUENCES["INVENTORY/DIRECTORY/CHILD"].at(-1), 32);
  assert.deepEqual(EXPECTED_SEQUENCES.RELEASE_DIRECTORY.at(-1), 34);
});

test("pins the accepted S0 ADR and unchanged harness package bytes", async () => {
  for (const [url, byteLength, expectedSha256] of PREDECESSOR_BYTE_PINS) {
    const bytes = await readFile(url);
    assert.equal(bytes.length, byteLength, fileURLToPath(url));
    assert.equal(sha256(bytes), expectedSha256, fileURLToPath(url));
  }
});

test("freezes all 144 numeric-step before/after selector results", () => {
  assert.equal(EXPECTED_FAULT_CASES.length, 144);
  for (const faultCase of EXPECTED_FAULT_CASES) {
    const sequence = EXPECTED_SEQUENCES[faultCase.operation];
    const step = sequence[faultCase.position];
    assert.equal(
      faultCase.selector,
      faultCase.boundary === "before" ? 2 * step - 1 : 2 * step,
    );
    assert.equal(faultCase.status, "FAULT_INJECTED");
    assert.equal(faultCase.errno, 5);
    assert.deepEqual(
      faultCase.completedPrefix,
      faultCase.boundary === "before"
        ? sequence.slice(0, faultCase.position)
        : sequence.slice(0, faultCase.position + 1),
    );
    assert.deepEqual(
      Object.entries(EXPECTED_EFFECTS[faultCase.class]),
      Object.entries(
        faultCase.class === "D"
          ? {
              effectClass: "DEFINITE_NO_EFFECT",
              outcome: "FAILED_DEFINITE_NO_EFFECT",
            }
          : faultCase.class === "M"
            ? {
                effectClass: "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
                outcome: "FAILED_MUTATION_NOT_FULLY_SYNCED",
              }
            : {
                effectClass: "EFFECT_UNCERTAIN",
                outcome: "FAILED_EFFECT_UNCERTAIN",
              },
      ),
    );
  }
});

test("fault matrices retain final-failure, transferred-FD, close, and cleanup edges", () => {
  for (const operation of [
    "PERSIST_NOREPLACE",
    "MKDIR_SYNC",
    "MOVE_NOREPLACE_SYNC",
    "MOVE_SYNC_REOBSERVE",
    "TEMP_CLEANUP",
    "RELEASE_DIRECTORY",
  ]) {
    assert.equal(EXPECTED_FAULT_CLASSES[operation].after.at(-1), "U");
  }
  for (const operation of [
    "INVENTORY/DIRECTORY/ROOT",
    "INVENTORY/DIRECTORY/CHILD",
    "INVENTORY/REGULAR_FILE/PRESENT",
    "INVENTORY/REGULAR_FILE/ABSENT",
  ]) {
    assert.equal(EXPECTED_FAULT_CLASSES[operation].after.at(-1), "D");
  }
  assert.equal(
    EXPECTED_FAULT_CASES.find(
      ({ operation, boundary, lastCompletedStep }) =>
        operation === "INVENTORY/DIRECTORY/CHILD" &&
        boundary === "after" &&
        lastCompletedStep === 32,
    ).class,
    "D",
  );
  assert.ok(EXPECTED_SPECIAL_RULES.some(([name]) => name === "before-step-24"));
  assert.ok(EXPECTED_SPECIAL_RULES.some(([name]) => name === "after-step-34"));
});

test("errno partition, retry limit, and zero-I/O verifier edges are literal", () => {
  assert.equal(EXPECTED_ERRNOS.length, 24);
  assert.equal(new Map(EXPECTED_ERRNOS).get("EIO"), 5);
  assert.equal(new Map(EXPECTED_ERRNOS).get("EAGAIN"), 11);
  assert.equal(new Map(EXPECTED_ERRNOS).get("EWOULDBLOCK"), 11);
  assert.equal(EXPECTED_ERRNO_CLASS_ROWS.length, 17);
  assert.equal(EXPECTED_ZERO_IO_RULES.length, 4);
  assert.deepEqual(
    EXPECTED_ZERO_IO_RULES.map(({ errno }) => errno),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    EXPECTED_ZERO_IO_RULES.map(({ failedStep }) => failedStep),
    [9, 7, 10, 21],
  );
  assert.ok(
    EXPECTED_SPECIAL_RULES.some(
      ([name, rule]) =>
        name === "read-write-eintr" && rule.includes("8-consecutive"),
    ),
  );
});

test("instruction audit follows reachable stack and syscall-number paths", () => {
  const instruction = (mnemonic, operands, address, byteLength = 1) =>
    Object.freeze({
      functionName: "execute",
      address,
      byteLength,
      mnemonic,
      operands,
    });
  assert.equal(
    maximumReachableStackAllocation([
      instruction("push", "rbp", 0),
      instruction("mov", "rbp,rsp", 1),
      instruction("sub", "rsp,0x20", 4),
      instruction("lea", "rsp,[rsp-0x10]", 8),
      instruction("lea", "rsp,[rsp+0x10]", 12),
      instruction("mov", "rsp,rbp", 16),
      instruction("pop", "rbp", 19),
      instruction("ret", "", 20),
    ]),
    56,
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("sub", "rsp,0xc0", 0),
      instruction("je", "10 <alternate>", 4),
      instruction("add", "rsp,0xc0", 8),
      instruction("jmp", "18 <return>", 12),
      instruction("sub", "rsp,0x80", 16),
      instruction("add", "rsp,0x140", 20),
      instruction("ret", "", 24),
    ]),
  );
  assert.equal(
    maximumReachableStackAllocation([
      instruction("cmp", "eax,0x0", 0),
      instruction("je", "10 <alternative>", 2),
      instruction("sub", "rsp,0x80", 4),
      instruction("add", "rsp,0x80", 8),
      instruction("jmp", "18 <return>", 12),
      instruction("sub", "rsp,0xc0", 16),
      instruction("add", "rsp,0xc0", 20),
      instruction("ret", "", 24),
    ]),
    192,
  );
  assert.throws(() =>
    maximumReachableStackAllocation([instruction("mov", "rsp,rax", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([instruction("lea", "rsp,[rbp-0x20]", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("mov", "eax,DWORD PTR [rsp-0x120]", 0),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("mov", "eax,DWORD PTR [rsp+rax*8]", 0),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("mov", "eax,DWORD PTR [rbp+rax*8]", 0),
      instruction("ret", "", 4),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("push", "rbp", 0),
      instruction("mov", "rbp,rsp", 1),
      instruction("mov", "eax,DWORD PTR [rbp+rax*8]", 4),
      instruction("leave", "", 8),
      instruction("ret", "", 9),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("mov", "rbp,rsp", 0),
      instruction("sub", "rbp,0x200", 3),
      instruction("mov", "DWORD PTR [rbp],eax", 7),
      instruction("ret", "", 10),
    ]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([instruction("xchg", "rsp,rax", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([instruction("sub", "esp,0x20", 0)]),
  );
  assert.throws(() =>
    maximumReachableStackAllocation([instruction("xchg", "esp,eax", 0)]),
  );
  assert.equal(
    maximumReachableStackAllocation(
      [
        instruction("sub", "rsp,0x20", 0),
        instruction("jmp", "rax", 4),
        instruction("add", "rsp,0x20", 12),
        instruction("ret", "", 16),
        instruction("add", "rsp,0x20", 20),
        instruction("ret", "", 24),
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
      instruction("ret", "", 0),
      instruction("nop", "", 1),
      instruction("sub", "rsp,0x20", 2),
      instruction("add", "rsp,0x20", 6),
      instruction("jmp", "1 <padding_cycle>", 10),
    ]),
    32,
  );
  assert.throws(() =>
    maximumReachableStackAllocation([
      instruction("ret", "", 0),
      instruction("sub", "rsp,0x120", 1),
      instruction("add", "rsp,0x120", 5),
      instruction("jmp", "1 <disconnected_cycle>", 9),
    ]),
  );
  assert.throws(() =>
    bindIndirectJumpTables(
      tableInstructions.slice(0, 7),
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
      tableInstructions.slice(0, 7),
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
      [instruction("sub", "rsp,0x8", 0), instruction("jmp", "rax", 4)],
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
  assertNoFunctionLocalByteArrays(
    "int f(void) { uint8_t scalar = 0; return scalar; }",
  );
  assert.throws(() =>
    assertNoFunctionLocalByteArrays(
      "int f(void) { uint8_t scalar, scratch[8]; return scratch[0]; }",
    ),
  );
  assert.throws(() =>
    assertNoFunctionLocalByteArrays(`
      #define LOCAL_BYTES(name) uint8_t name[8]
      int f(void) { LOCAL_BYTES(scratch); return scratch[0]; }
    `),
  );
  for (const source of [
    "int f(void) { _Alignas(16) _Alignas(32) uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { _Alignas(_Alignof(uint64_t)) uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { _Atomic(uint8_t) scratch[8]; return scratch[0]; }",
    "int f(void) { static _Thread_local uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { auto uint8_t scratch[8]; return scratch[0]; }",
    "int f(void) { return (uint8_t[8]){0}[0]; }",
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
  const goodRaw = `
    int execute(const struct request *request, struct result *result) {
    #ifndef OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS
      if (request->test_fault_selector != 0U) return -1;
    #endif
    #ifdef OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS
      if (request->test_fault_selector == 2U * step - 1U) {
        result->status = FAULT_INJECTED; result->errno_value = EIO;
      }
      if (request->test_fault_selector == 2U * step) {
        result->status = FAULT_INJECTED; result->errno_value = EIO;
      }
    #endif
      return 0;
    }
  `;
  const production = `
    int execute(const struct request *request, struct result *result) {
      if (request->test_fault_selector != 0U) return -1;
      return 0;
    }
  `;
  const fault = `
    int execute(const struct request *request, struct result *result) {
      if (request->test_fault_selector == 2U * step - 1U) {
        result->status = FAULT_INJECTED; result->errno_value = EIO;
      }
      if (request->test_fault_selector == 2U * step) {
        result->status = FAULT_INJECTED; result->errno_value = EIO;
      }
      return 0;
    }
  `;
  assert.doesNotThrow(() =>
    assertFaultMacroPartition(goodRaw, production, fault),
  );
  assert.throws(() =>
    assertFaultMacroPartition(
      goodRaw.replace(
        "#ifdef OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS",
        "#ifdef UNRELATED_FEATURE",
      ),
      production,
      fault,
    ),
  );
  assert.throws(() => assertFaultMacroPartition(goodRaw, fault, fault));
  assert.throws(() =>
    conditionalSourceLines(`
      #if defined(OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS)
      int fault_branch;
      #elif defined(OTHER_FEATURE)
      int alternate_branch;
      #endif
    `),
  );
  assert.throws(() =>
    conditionalSourceLines(`
      const char *open = "/*";
      #if defined(OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS)
      int fault_branch;
      #elif defined(OTHER_FEATURE)
      int alternate_branch;
      #endif
      const char *close = "*/";
    `),
  );
  assert.throws(() =>
    conditionalSourceLines(`
      #if defined(OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS)
      int fault_branch;
      #el\
if defined(OTHER_FEATURE)
      int alternate_branch;
      #endif
    `),
  );
  const splitFaultMacro = conditionalSourceLines(`
    #if defined(OXIGRAPH_CONTAINMENT_STATEFS_TEST_FA\
ULTS)
    int split_fault_branch;
    #endif
  `);
  assert.equal(
    splitFaultMacro.find(({ line }) => line.includes("split_fault_branch"))
      ?.faultOnly,
    true,
  );
});

candidateTest(
  "fault source keeps active production and fault macro partitions distinct",
  async () => {
    const [source, header] = await Promise.all([
      readFile(SOURCE_URL, "utf8"),
      readFile(HEADER_URL, "utf8"),
    ]);
    const logicalSource = source.replace(/\\(?:\r\n|\n|\r)/gu, "");
    assert.doesNotMatch(logicalSource, /^\s*#\s*(?:line\b|[0-9]+\s+")/gmu);
    assert.deepEqual(
      [
        ...stripCComments(logicalSource).matchAll(
          /^\s*#\s*include\s*([^\n]+?)\s*$/gmu,
        ),
      ].map((match) => match[1]),
      ['"containment-guardian-statefs-syscalls-v1.h"'],
    );
    assertOnlySyscallInlineAssembly(`${header}\n${source}`);
    const activeHeader = preprocessCandidate(HEADER_URL);
    const productionSource = preprocessCandidateSource({ fault: false });
    const faultSource = preprocessCandidateSource({ fault: true });
    assertNoFunctionLocalByteArrays(productionSource);
    assertNoFunctionLocalByteArrays(faultSource);
    const tracedFaultSource = preprocessCandidate(SOURCE_URL, {
      fault: true,
      preserveLineMarkers: true,
    });
    const acceptedHeaderPaths = new Set([
      fileURLToPath(HEADER_URL),
      relative(REPOSITORY_ROOT, fileURLToPath(HEADER_URL)),
    ]);
    const enteredFiles = [
      ...tracedFaultSource.matchAll(/^#\s+[0-9]+\s+"([^"]+)"(?:\s|$)/gmu),
    ].map((match) => match[1]);
    assert.equal(
      enteredFiles.some((pathname) => acceptedHeaderPaths.has(pathname)),
      true,
      "compiled fault translation unit did not enter the fixed header",
    );
    for (const activeInterface of [
      activeHeader,
      productionSource,
      faultSource,
    ]) {
      for (const structName of [
        "oxigraph_containment_statefs_request_v1",
        "oxigraph_containment_statefs_observation_v1",
        "oxigraph_containment_statefs_result_v1",
      ]) {
        assert.equal(
          [
            ...stripCComments(activeInterface).matchAll(
              new RegExp(`\\bstruct\\s+${structName}\\s*\\{`, "gu"),
            ),
          ].length,
          1,
          structName,
        );
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
    assertFaultMacroPartition(source, productionSource, faultSource);
    const combined = faultSource;
    for (const [name] of EXPECTED_STEPS) {
      assert.match(combined, new RegExp(`(?:^|_)${name}\\b`, "mu"));
    }
    for (const [name] of EXPECTED_ERRNOS) {
      assert.match(combined, new RegExp(`(?:^|_)${name}\\b`, "mu"));
    }
    assert.match(source, /\bOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS\b/u);
    assert.doesNotMatch(
      faultSource,
      /\b(?:getenv|setenv|putenv|unsetenv)\s*\(/u,
    );
    assert.doesNotMatch(
      faultSource,
      /\b(?:set|install|register)_?fault\w*\s*\(/u,
    );
  },
);

candidateTest(
  "FAULT attestation keeps production objects selector-free and isolates fault ELF",
  async () => {
    const [
      headerStatus,
      sourceStatus,
      headerBytes,
      sourceBytes,
      compilerRealpath,
    ] = await Promise.all([
      lstat(HEADER_URL, { bigint: true }),
      lstat(SOURCE_URL, { bigint: true }),
      readFile(HEADER_URL),
      readFile(SOURCE_URL),
      realpath("/usr/bin/cc"),
    ]);
    assert.equal(headerStatus.isFile(), true);
    assert.equal(headerStatus.isSymbolicLink(), false);
    assert.equal(sourceStatus.isFile(), true);
    assert.equal(sourceStatus.isSymbolicLink(), false);
    assert.ok(headerBytes.length > 0 && headerBytes.length <= 1048576);
    assert.ok(sourceBytes.length > 0 && sourceBytes.length <= 1048576);
    const compilerStatus = await lstat(compilerRealpath, { bigint: true });
    assert.equal(compilerStatus.isFile(), true);
    assert.equal(compilerStatus.isSymbolicLink(), false);
    const compilerBytes = await readFile(compilerRealpath);
    const compilerVersionBytes =
      independentlyReadCompilerVersion(compilerRealpath);

    privateBuildRoot = await mkdtemp(
      join(tmpdir(), "oxigraph-statefs-attestation-fault-"),
    );
    const report = await Promise.resolve(
      attestation.attestCandidateContainmentGuardianStatefsSyscallsV1({
        repositoryRoot: REPOSITORY_ROOT,
        privateBuildRoot,
        buildKind: "FAULT",
      }),
    );

    assert.deepEqual((await readdir(privateBuildRoot)).sort(), [
      "fault-0001",
      "production-0001",
      "production-0002",
    ]);
    const objectSpecifications = [
      ["production-0001", "containment-guardian-statefs-syscalls-v1.o"],
      ["production-0002", "containment-guardian-statefs-syscalls-v1.o"],
      ["fault-0001", "containment-guardian-statefs-syscalls-v1-fault.o"],
    ];
    const objectBytes = [];
    const objectPaths = [];
    for (const [directory, basename] of objectSpecifications) {
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
    assert.notDeepEqual(objectBytes[2], objectBytes[0]);

    assert.deepEqual(Object.keys(report), EXPECTED_REPORT_FIELDS);
    assert.equal(
      report.schema,
      "oxigraph.candidate-containment-guardian-statefs-syscalls-attestation/v1",
    );
    assert.equal(report.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
    assert.equal(report.buildKind, "FAULT");
    assert.equal(report.platform, "linux-x86_64-sysv-little-endian");
    assert.equal(report.compilerRealpath, compilerRealpath);
    assert.equal(report.compilerByteLength, compilerBytes.length);
    assert.equal(report.compilerSha256, sha256(compilerBytes));
    assert.equal(report.compilerVersionByteLength, compilerVersionBytes.length);
    assert.equal(report.compilerVersionSha256, sha256(compilerVersionBytes));
    assert.deepEqual(
      report.firstProductionArgv,
      expectedArgv(
        compilerRealpath,
        privateBuildRoot,
        "production-0001",
        "containment-guardian-statefs-syscalls-v1.o",
        false,
      ),
    );
    assert.deepEqual(
      report.secondProductionArgv,
      expectedArgv(
        compilerRealpath,
        privateBuildRoot,
        "production-0002",
        "containment-guardian-statefs-syscalls-v1.o",
        false,
      ),
    );
    assert.deepEqual(
      report.faultArgv,
      expectedArgv(
        compilerRealpath,
        privateBuildRoot,
        "fault-0001",
        "containment-guardian-statefs-syscalls-v1-fault.o",
        true,
      ),
    );
    assert.deepEqual(report.environment, EXPECTED_ENVIRONMENT);
    assert.equal(report.headerByteLength, headerBytes.length);
    assert.equal(report.headerSha256, sha256(headerBytes));
    assert.equal(report.sourceByteLength, sourceBytes.length);
    assert.equal(report.sourceSha256, sha256(sourceBytes));
    assert.equal(report.firstObjectByteLength, report.secondObjectByteLength);
    assert.equal(report.firstObjectSha256, report.secondObjectSha256);
    assert.equal(report.firstObjectByteLength, objectBytes[0].length);
    assert.equal(report.firstObjectSha256, sha256(objectBytes[0]));
    assert.equal(report.secondObjectByteLength, objectBytes[1].length);
    assert.equal(report.secondObjectSha256, sha256(objectBytes[1]));
    assert.equal(report.repeatedObjectBytesEqual, true);
    assert.ok(report.faultObjectByteLength > 0);
    assert.ok(report.faultObjectByteLength <= 1048576);
    assert.match(report.faultObjectSha256, /^[0-9a-f]{64}$/u);
    assert.equal(report.faultObjectByteLength, objectBytes[2].length);
    assert.equal(report.faultObjectSha256, sha256(objectBytes[2]));
    assert.notEqual(report.faultObjectSha256, report.firstObjectSha256);
    assertElfProjection(report, { faultSelectorPresent: false });
    assert.equal(report.abiLayoutSha256, EXPECTED_ABI_LAYOUT_SHA256);
    const productionProjection = independentlyParseElf(objectBytes[0]);
    for (const field of Object.keys(productionProjection)) {
      assert.deepEqual(report[field], productionProjection[field], field);
    }
    const productionDisassembly = independentlyDisassembleObject(
      objectPaths[0],
      objectBytes[0],
    );
    assert.equal(productionDisassembly.callInstructionCount, 0);
    assert.ok(productionDisassembly.maximumStackAllocationBytes <= 256);
    assert.equal(productionDisassembly.directSyscallInstructionCount, 13);
    assert.deepEqual(
      productionDisassembly.observedSyscallNumbers,
      EXPECTED_SYSCALLS.map(([, number]) => number),
    );
    assert.equal(
      report.directSyscallInstructionCount,
      productionDisassembly.directSyscallInstructionCount,
    );
    assert.deepEqual(
      report.observedSyscallNumbers,
      productionDisassembly.observedSyscallNumbers,
    );

    const inspection = report.faultInspection;
    assert.deepEqual(Object.keys(inspection), EXPECTED_FAULT_INSPECTION_FIELDS);
    assert.equal(
      inspection.schema,
      "oxigraph.candidate-containment-guardian-statefs-syscalls-fault-inspection/v1",
    );
    assert.equal(inspection.objectSha256, report.faultObjectSha256);
    assertElfProjection(inspection, { faultSelectorPresent: true });
    assert.equal(inspection.abiLayoutSha256, EXPECTED_ABI_LAYOUT_SHA256);
    const faultProjection = independentlyParseElf(objectBytes[2]);
    for (const field of Object.keys(faultProjection)) {
      assert.deepEqual(inspection[field], faultProjection[field], field);
    }
    const faultDisassembly = independentlyDisassembleObject(
      objectPaths[2],
      objectBytes[2],
    );
    assert.equal(faultDisassembly.callInstructionCount, 0);
    assert.ok(faultDisassembly.maximumStackAllocationBytes <= 256);
    assert.equal(faultDisassembly.directSyscallInstructionCount, 13);
    assert.deepEqual(
      faultDisassembly.observedSyscallNumbers,
      EXPECTED_SYSCALLS.map(([, number]) => number),
    );
    assert.equal(
      inspection.directSyscallInstructionCount,
      faultDisassembly.directSyscallInstructionCount,
    );
    assert.deepEqual(
      inspection.observedSyscallNumbers,
      faultDisassembly.observedSyscallNumbers,
    );
    assert.equal(inspection.abiLayoutSha256, report.abiLayoutSha256);
    assert.equal(
      inspection.inspectionSha256,
      digestPrecedingFields(
        inspection,
        "inspectionSha256",
        EXPECTED_FAULT_INSPECTION_FIELDS,
      ),
    );
    assert.equal(
      report.reportSha256,
      digestPrecedingFields(report, "reportSha256", EXPECTED_REPORT_FIELDS),
    );
    assert.deepEqual(report.authority, EXPECTED_AUTHORITY);
    assert.deepEqual(report.physicalFacts, EXPECTED_PHYSICAL_FACTS);
    assert.deepEqual(report.nonclaims, EXPECTED_NONCLAIMS);
    assertDeepFrozenNullPrototype(report);
  },
);

candidateTest(
  "fault build retains exact exports, requirements binding, and no authority",
  () => {
    assert.deepEqual(
      Object.keys(attestation).sort(),
      [...EXPECTED_EXPORTS].sort(),
    );
    const requirements =
      attestation.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS;
    const requirementsSha256 =
      attestation.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256;
    assert.equal(requirementsSha256, semanticSha256(requirements));
    assert.deepEqual(requirements.allowedSyscalls, EXPECTED_SYSCALLS);
    assert.deepEqual(requirements.environment, EXPECTED_ENVIRONMENT);
    assert.deepEqual(requirements.elfRules[10], [
      "relocationTargetRule",
      "defined-local-or-nonwritable-section-only",
    ]);
    assert.equal(requirements.elfRules[11][1], 13);
    assert.equal(requirements.elfRules[12][1], false);
    assert.equal(requirements.repeatCount, 2);
    assert.deepEqual(
      Object.values(requirements.authority),
      Array(10).fill(false),
    );
    assert.deepEqual(
      Object.values(requirements.physicalFacts),
      Array(12).fill(null),
    );
    assert.equal(requirements.nonclaims.includes("publication"), true);
    assertDeepFrozenNullPrototype(requirements);
  },
);

candidateTest(
  "attestation binds conflicting BOUNDS, SHAPE, and PATH precedence without authority",
  async () => {
    const attest =
      attestation.attestCandidateContainmentGuardianStatefsSyscallsV1;
    for (const [input, message] of [
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
          buildKind: "FAULT",
        },
        "STATEFS_ATTEST_PATH",
      ],
    ]) {
      await assert.rejects(
        Promise.resolve().then(() => attest(input)),
        { message },
      );
    }
    const source = await readFile(ATTESTATION_URL, "utf8");
    for (const code of EXPECTED_ATTESTATION_ERRORS) {
      assert.match(
        source,
        new RegExp(`(?:^|[^A-Z_])${code}(?:$|[^A-Z_])`, "mu"),
      );
    }
    assert.doesNotMatch(
      source,
      /\b(?:qualify|qualification|promotion|publication)\s*:\s*true\b/u,
    );
    assert.doesNotMatch(
      source,
      /\b(?:g1\.7|metaharness|darwin|gepa|openrouter)\b/iu,
    );
  },
);

test("fault import attribution rejects wrong code, URL, message, and present source", () => {
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

test("reports only the exact source-absent fault-attestation import RED", () => {
  assert.equal(attestationImportAttempts, 1);
  if (attestationImportError !== null) throw attestationImportError;
  assert.notEqual(attestation, null);
});
