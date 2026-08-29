import { createHash } from "node:crypto";
import { isDeepStrictEqual, types as utilTypes } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CANCEL_DECISION_SCHEMA_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4,
  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4,
} from "./containment-supervisor-preflight-v4.mjs";

// Pure static replay for the first executable preflight source. The caller
// supplies every byte and metadata observation. This module invokes no
// compiler, opens no descriptor, executes no artifact, and performs no native
// or containment mechanic.

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-attestation/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_PROJECTION_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-attestation-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_STATUS_V4 =
  "STATIC_PREFLIGHT_SUPERVISOR_ATTESTATION_ONLY";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_ARTIFACT_NAME_V4 =
  "candidate-containment-supervisor-preflight-attestation-v1.json";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_MAX_BYTES_V4 =
  4 * 1024 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_LOGICAL_NAME_V4 =
  "containment-supervisor-preflight-v4.c";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_BYTES_V4 = 85_575;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_SHA256_V4 =
  "8a194daf57ab90aa7d73cfc8f75c4019cfae932075866fa5a4668f870ffbbb34";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4 =
  "/usr/bin/x86_64-linux-gnu-gcc-13";

const compilerBytesExpected = 1_023_032;
const compilerSha256Expected =
  "1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26";
const sourceMaximumBytes = 1024 * 1024;
const compilerMaximumBytes = 2 * 1024 * 1024;
const versionMaximumBytes = 128 * 1024;
const compileStreamMaximumBytes = 1024 * 1024;
const executableMaximumBytes = 1024 * 1024;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const objectPrototype = Object.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const bufferIndexOf = Buffer.prototype.indexOf;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(
    `candidate containment supervisor preflight attestation v4: ${message}`,
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function frozenArtifactBytes(name, bytes) {
  const retained = bufferFrom(bytes);
  const artifact = Object.create(null);
  artifact.name = name;
  Object.defineProperty(artifact, "bytes", {
    configurable: false,
    enumerable: true,
    get() {
      return bufferFrom(retained);
    },
  });
  artifact.sha256 = sha256(retained);
  return Object.freeze(artifact);
}

function exactRecord(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    fail(`${label} must be a plain own-data record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} cannot be inspected`);
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(`${label} has a foreign prototype`);
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort()) ||
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
    fail(`${label} fields are not exact enumerable own data`);
  }
  return nullRecord(expected.map((key) => [key, descriptors[key].value]));
}

function copyBuffer(value, maximum, label, allowEmpty = false) {
  if (
    !Buffer.isBuffer(value) ||
    utilTypes.isProxy(value) ||
    objectGetPrototypeOf(value) !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(`${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch {
    fail(`${label} length cannot be read intrinsically`);
  }
  if (
    !Number.isSafeInteger(length) ||
    length > maximum ||
    (!allowEmpty && length === 0)
  ) {
    fail(`${label} is outside its byte bound`);
  }
  const copied = bufferAllocUnsafe(length);
  typedArraySet.call(copied, value);
  return copied;
}

function decimal(value, label, positive = false) {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !decimalPattern.test(value)
  ) {
    fail(`${label} is not a bounded canonical decimal`);
  }
  const parsed = BigInt(value);
  if (positive ? parsed < 1n : parsed < 0n) {
    fail(`${label} is outside its range`);
  }
  return value;
}

function metadataIdentity(value, label, bytes, kind) {
  const identity = exactRecord(
    value,
    [
      "device",
      "inode",
      "mode",
      "links",
      "size",
      "modifiedNs",
      "changedNs",
      "ownerUid",
      "ownerGid",
    ],
    label,
  );
  decimal(identity.device, `${label} device`, true);
  decimal(identity.inode, `${label} inode`, true);
  decimal(identity.mode, `${label} mode`, true);
  decimal(identity.links, `${label} links`, true);
  decimal(identity.size, `${label} size`, true);
  decimal(identity.modifiedNs, `${label} modifiedNs`);
  decimal(identity.changedNs, `${label} changedNs`);
  decimal(identity.ownerUid, `${label} ownerUid`);
  decimal(identity.ownerGid, `${label} ownerGid`);
  const mode = BigInt(identity.mode);
  if (
    mode > 0o177777n ||
    (mode & 0o170000n) !== 0o100000n ||
    identity.size !== String(bytes.length)
  ) {
    fail(`${label} is not the supplied regular-file identity`);
  }
  if (kind === "compiler") {
    if ((mode & 0o111n) === 0n) fail("compiler identity is not executable");
  } else if (identity.links !== "1" || (mode & 0o777n) !== 0o400n) {
    fail("supervisor executable is not exact private 0400 single-link storage");
  }
  return identity;
}

function rawRecord(bytes) {
  return nullRecord([
    ["bytes", bytes.length],
    ["sha256", sha256(bytes)],
    ["base64", bytes.toString("base64")],
  ]);
}

function boundedNumber(value, label, maximum) {
  if (value < 0n || value > BigInt(maximum)) {
    fail(`${label} is outside its bound`);
  }
  return Number(value);
}

function region(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length ||
    length > bytes.length - offset
  ) {
    fail(`${label} is outside the executable`);
  }
}

function occurrences(bytes, needle) {
  let count = 0;
  let offset = 0;
  while (offset <= bytes.length - needle.length) {
    const found = bufferIndexOf.call(bytes, needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + 1;
  }
  return count;
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4 =
  '{"allowedSyscalls":["read","write","close","fstat","fcntl","rt_sigaction","close_range","exit_group"],"artifact":"candidate-containment-supervisor-preflight-v1","authority":{"applicationReceiptAuthority":false,"applicationResultAuthority":false,"containmentExecutionAuthority":false,"descriptorAuthority":false,"filesystemDurabilityAuthority":false,"finalDecisionAuthority":false,"guardianAuthority":false,"nativeObservationAuthority":false,"productionContainment":false,"promotionAuthority":false,"publicationAuthority":false,"qualificationAuthority":false,"reapAuthority":false,"runtimeRegistrationAuthority":false,"sandboxReportAuthority":false,"supervisorAuthority":false},"binding":null,"cancelOnlyTerminalWriterImplemented":true,"candidateExecutionImplemented":false,"canonicalCapsuleEnvelopeParserImplemented":true,"canonicalStartParserImplemented":true,"cgroupMechanicsImplemented":false,"cloneImplemented":false,"commandEofRequiredAfterCancel":true,"descriptorPreflightImplemented":true,"descriptorThreeSemantics":"opaque-read-only-directory-only","descriptorsClosedBeforeReadyFrom":18,"entry":"oxigraph_supervisor_preflight_entry","entryStackAlignmentImplemented":true,"failureDiagnosticBase64":"UFJFRkxJR0hUX0ZBSUwhCg==","failureDiagnosticBytes":16,"physicalLaunchEligible":false,"requirementsSha256":"47e429123d0a74dbbd6d8d82f4b5d0c62d565674868f5424df0e2f46b717dbc4","schema":"oxigraph.candidate-containment-supervisor-preflight-self-description/v1","sha256Implemented":true,"statusEofRequiredAfterFinalStatus":true,"strictBase64DecoderImplemented":true,"supervisorDescriptorRangeEnd":17,"supervisorDescriptorRangeStart":0,"target":"linux-x86_64-freestanding-static","trailingCommandBytesPermitted":false}\n';
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_SHA256_V4 =
  "f90f02b1a05a8bdc6b49b136e4158690e5b321f09fcb8f554404418136a7bcab";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_V4 =
  deepFreeze(
    JSON.parse(
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4.slice(
        0,
        -1,
      ),
    ),
  );

if (
  `${canonicalJson(
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_V4,
  )}\n` !==
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4 ||
  sha256(
    bufferFrom(
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4,
      "utf8",
    ),
  ) !== CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_SHA256_V4
) {
  throw new Error(
    "candidate containment supervisor preflight attestation v4: self-description drift",
  );
}

function parseStaticElf(bytes) {
  if (
    bytes.length < 64 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1
  ) {
    fail("supervisor output is not an ELF64 little-endian executable");
  }
  const elfType = bytes.readUInt16LE(16);
  const elfMachine = bytes.readUInt16LE(18);
  if (elfType !== 2 || elfMachine !== 62) {
    fail("supervisor ELF type or machine changed");
  }
  const entry = bytes.readBigUInt64LE(24);
  const programHeaderOffset = boundedNumber(
    bytes.readBigUInt64LE(32),
    "program-header offset",
    bytes.length,
  );
  const programHeaderEntryBytes = bytes.readUInt16LE(54);
  const programHeaderCount = bytes.readUInt16LE(56);
  if (
    entry === 0n ||
    programHeaderEntryBytes < 56 ||
    programHeaderCount < 1 ||
    programHeaderCount > 128
  ) {
    fail("supervisor ELF header inventory changed");
  }
  region(
    bytes,
    programHeaderOffset,
    programHeaderEntryBytes * programHeaderCount,
    "program-header table",
  );
  const loads = [];
  const readOnlyLoads = [];
  let interpreterCount = 0;
  let dynamicCount = 0;
  let writeExecutableLoad = false;
  let gnuStackCount = 0;
  let gnuStackExecutable = false;
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + index * programHeaderEntryBytes;
    const type = bytes.readUInt32LE(offset);
    const flags = bytes.readUInt32LE(offset + 4);
    const fileOffset = boundedNumber(
      bytes.readBigUInt64LE(offset + 8),
      `program header ${index} file offset`,
      bytes.length,
    );
    const virtualAddress = bytes.readBigUInt64LE(offset + 16);
    const fileBytes = boundedNumber(
      bytes.readBigUInt64LE(offset + 32),
      `program header ${index} file bytes`,
      bytes.length,
    );
    const memoryBytes = bytes.readBigUInt64LE(offset + 40);
    region(bytes, fileOffset, fileBytes, `program header ${index}`);
    if (BigInt(fileBytes) > memoryBytes) {
      fail(`program header ${index} file bytes exceed memory bytes`);
    }
    if (type === 1) {
      const writable = (flags & 2) !== 0;
      const executable = (flags & 1) !== 0;
      if (writable && executable) writeExecutableLoad = true;
      if (!writable) readOnlyLoads.push({ fileOffset, fileBytes });
      loads.push({
        fileOffset,
        fileBytes,
        virtualAddress,
        memoryBytes,
        executable,
      });
    } else if (type === 2) {
      dynamicCount += 1;
    } else if (type === 3) {
      interpreterCount += 1;
    } else if (type === 0x6474e551) {
      gnuStackCount += 1;
      if ((flags & 1) !== 0) gnuStackExecutable = true;
    }
  }
  const entryLoads = loads.filter(
    ({ virtualAddress, memoryBytes, executable }) =>
      executable &&
      entry >= virtualAddress &&
      entry < virtualAddress + memoryBytes,
  );
  let entryStackAlignmentShim = false;
  let entryCallTargetInExecutableLoad = false;
  if (entryLoads.length === 1) {
    const entryLoad = entryLoads[0];
    const entryDelta = entry - entryLoad.virtualAddress;
    if (entryDelta + 11n <= BigInt(entryLoad.fileBytes)) {
      const entryOffset = entryLoad.fileOffset + Number(entryDelta);
      if (entryOffset <= bytes.length - 11) {
        entryStackAlignmentShim =
          bytes[entryOffset] === 0x48 &&
          bytes[entryOffset + 1] === 0x83 &&
          bytes[entryOffset + 2] === 0xe4 &&
          bytes[entryOffset + 3] === 0xf0 &&
          bytes[entryOffset + 4] === 0xe8 &&
          bytes[entryOffset + 9] === 0x0f &&
          bytes[entryOffset + 10] === 0x0b;
        if (entryStackAlignmentShim) {
          const relativeCall = bytes.readInt32LE(entryOffset + 5);
          const callTarget = entry + 9n + BigInt(relativeCall);
          entryCallTargetInExecutableLoad = loads.some(
            ({ virtualAddress, memoryBytes, executable }) =>
              executable &&
              callTarget >= virtualAddress &&
              callTarget < virtualAddress + memoryBytes,
          );
        }
      }
    }
  }
  const selfDescription = bufferFrom(
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4,
    "utf8",
  );
  const selfDescriptionOccurrences = occurrences(bytes, selfDescription);
  const readOnlySelfDescriptionOccurrences = readOnlyLoads.reduce(
    (total, { fileOffset, fileBytes }) =>
      total +
      occurrences(
        bytes.subarray(fileOffset, fileOffset + fileBytes),
        selfDescription,
      ),
    0,
  );
  if (
    loads.length < 1 ||
    entryLoads.length !== 1 ||
    interpreterCount !== 0 ||
    dynamicCount !== 0 ||
    writeExecutableLoad ||
    gnuStackCount !== 1 ||
    gnuStackExecutable ||
    !entryStackAlignmentShim ||
    !entryCallTargetInExecutableLoad ||
    selfDescriptionOccurrences !== 1 ||
    readOnlySelfDescriptionOccurrences !== 1
  ) {
    fail("supervisor static ELF or embedded self-description changed");
  }
  return deepFreeze(
    nullRecord([
      ["elfClass", 64],
      ["elfData", "little"],
      ["elfType", "ET_EXEC"],
      ["elfMachine", 62],
      ["entry", entry.toString()],
      ["entryInExecutableLoad", true],
      ["entryStackAlignmentShim", true],
      ["entryCallTargetInExecutableLoad", true],
      ["loadSegments", loads.length],
      ["interpreter", null],
      ["dynamicSegment", false],
      ["writeExecutableLoad", false],
      ["gnuStackExecutable", false],
      ["needed", Object.freeze([])],
      ["rpath", Object.freeze([])],
      ["runpath", Object.freeze([])],
      ["soname", null],
      ["selfDescriptionOccurrences", selfDescriptionOccurrences],
      [
        "selfDescriptionReadOnlyLoadOccurrences",
        readOnlySelfDescriptionOccurrences,
      ],
    ]),
  );
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILE_ARGV_V4 =
  deepFreeze([
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
    "-std=c17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-ffreestanding",
    "-fno-builtin",
    "-fno-pie",
    "-no-pie",
    "-fno-stack-protector",
    "-fno-asynchronous-unwind-tables",
    "-fno-unwind-tables",
    "-fno-ident",
    "-nostdlib",
    "-nostartfiles",
    "-nodefaultlibs",
    "-static",
    "-Wl,--build-id=none",
    "-Wl,--fatal-warnings",
    "-Wl,-z,noexecstack,-z,separate-code",
    "-Wl,-e,oxigraph_supervisor_preflight_entry",
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_LOGICAL_NAME_V4,
    "-o",
    "candidate-containment-supervisor-preflight-v1",
  ]);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_VERSION_ARGV_V4 =
  deepFreeze([
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
    "--version",
  ]);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_ENVIRONMENT_V4 =
  deepFreeze(
    nullRecord([
      ["HOME", "/nonexistent"],
      ["LANG", "C.UTF-8"],
      ["LC_ALL", "C.UTF-8"],
      ["PATH", "/usr/bin:/bin"],
      ["SOURCE_DATE_EPOCH", "0"],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_AUTHORITY_V4 =
  deepFreeze(
    nullRecord([
      ...Object.entries(
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
      ),
      ["compileAuthority", false],
      ["helperIdentityAuthority", false],
      ["sourceToBinaryCausalityAuthority", false],
      ["supervisorExecutionAuthority", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_NONCLAIMS_V4 =
  deepFreeze(
    nullRecord([
      ...Object.entries(
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
      ),
      ["assemblerAndLinkerClosure", false],
      ["attestationBindsExecutableToLiveProcess", false],
      ["attestationBindsExecutableToStartIdentity", false],
      ["attestationProvesCompilerInvocation", false],
      ["attestationProvesDescriptorInheritance", false],
      ["attestationProvesJournalDurability", false],
      ["attestationProvesNativeExecution", false],
      ["attestationProvesPhysicalContainment", false],
      ["attestationProvesSourceToBinaryCausality", false],
      ["compilerDriverClosesToolchain", false],
      ["embeddedDescriptionProvesRuntimeEnforcement", false],
      ["sourceReviewProvesRuntimeSyscallClosure", false],
      ["staticElfInspectionProvesRuntimeSyscallClosure", false],
      ["suppliedOutputEqualityProvesCrossHostReproducibility", false],
    ]),
  );

const syscallSurface = deepFreeze(
  nullRecord([
    [
      "allowed",
      Object.freeze([
        "read",
        "write",
        "close",
        "fstat",
        "fcntl",
        "rt_sigaction",
        "close_range",
        "exit_group",
      ]),
    ],
    ["readRestrictedToCommandFdZero", true],
    ["writeRestrictedToStatusAndDiagnostics", true],
    ["fcntlInspectionOnly", true],
    ["closeRangeStartsAtEighteen", true],
    ["candidateExecutionPermitted", false],
    ["sourceReviewProvesRuntimeClosure", false],
  ]),
);

const implementation = deepFreeze(
  nullRecord([
    ["canonicalStartParserImplemented", true],
    ["canonicalCapsuleEnvelopeParserImplemented", true],
    ["strictBase64DecoderImplemented", true],
    ["sha256Implemented", true],
    ["descriptorPreflightImplemented", true],
    ["cancelOnlyTerminalWriterImplemented", true],
    ["entryStackAlignmentImplemented", true],
    ["candidateExecutionImplemented", false],
    ["cloneImplemented", false],
    ["cgroupMechanicsImplemented", false],
    ["artifactExecuted", false],
  ]),
);

function validateCompilerVersion(bytes) {
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    fail("compiler version is not UTF-8");
  }
  const firstLine = text.split("\n", 1)[0];
  if (
    !text.endsWith("\n") ||
    !firstLine.includes("gcc") ||
    !/(?:^|[^0-9])13\.[0-9]/u.test(firstLine)
  ) {
    fail("compiler version is not an exact GCC-13 observation");
  }
}

function normalizeEvidence(value) {
  const evidence = exactRecord(
    value,
    [
      "sourceBytes",
      "compilerBytes",
      "compilerIdentity",
      "compilerVersionBytes",
      "compilerVersionStderrBytes",
      "compilerVersionExitCode",
      "compilerVersionSignal",
      "compileStdoutBytes",
      "compileStderrBytes",
      "compileExitCode",
      "compileSignal",
      "executableBytes",
      "secondExecutableBytes",
      "executableIdentity",
    ],
    "evidence",
  );
  const sourceBytes = copyBuffer(
    evidence.sourceBytes,
    sourceMaximumBytes,
    "source bytes",
  );
  if (
    sourceBytes.length !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_BYTES_V4 ||
    sha256(sourceBytes) !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_SHA256_V4
  ) {
    fail("reviewed source bytes changed");
  }
  const compilerBytes = copyBuffer(
    evidence.compilerBytes,
    compilerMaximumBytes,
    "compiler bytes",
  );
  if (
    compilerBytes.length !== compilerBytesExpected ||
    sha256(compilerBytes) !== compilerSha256Expected
  ) {
    fail("reviewed compiler bytes changed");
  }
  const compilerVersionBytes = copyBuffer(
    evidence.compilerVersionBytes,
    versionMaximumBytes,
    "compiler version stdout",
  );
  const compilerVersionStderrBytes = copyBuffer(
    evidence.compilerVersionStderrBytes,
    versionMaximumBytes,
    "compiler version stderr",
    true,
  );
  validateCompilerVersion(compilerVersionBytes);
  if (
    compilerVersionStderrBytes.length !== 0 ||
    evidence.compilerVersionExitCode !== 0 ||
    evidence.compilerVersionSignal !== null
  ) {
    fail("compiler version observation changed");
  }
  const compileStdoutBytes = copyBuffer(
    evidence.compileStdoutBytes,
    compileStreamMaximumBytes,
    "compile stdout",
    true,
  );
  const compileStderrBytes = copyBuffer(
    evidence.compileStderrBytes,
    compileStreamMaximumBytes,
    "compile stderr",
    true,
  );
  if (
    compileStdoutBytes.length !== 0 ||
    compileStderrBytes.length !== 0 ||
    evidence.compileExitCode !== 0 ||
    evidence.compileSignal !== null
  ) {
    fail("compile terminal observation changed");
  }
  const executableBytes = copyBuffer(
    evidence.executableBytes,
    executableMaximumBytes,
    "executable bytes",
  );
  const secondExecutableBytes = copyBuffer(
    evidence.secondExecutableBytes,
    executableMaximumBytes,
    "second executable bytes",
  );
  if (!bufferEquals.call(executableBytes, secondExecutableBytes)) {
    fail("supplied repeated executable bytes differ");
  }
  const compilerIdentity = metadataIdentity(
    evidence.compilerIdentity,
    "compiler identity",
    compilerBytes,
    "compiler",
  );
  const executableIdentity = metadataIdentity(
    evidence.executableIdentity,
    "executable identity",
    executableBytes,
    "executable",
  );
  const elf = parseStaticElf(executableBytes);
  return {
    sourceBytes,
    compilerBytes,
    compilerIdentity,
    compilerVersionBytes,
    compilerVersionStderrBytes,
    compileStdoutBytes,
    compileStderrBytes,
    executableBytes,
    executableIdentity,
    elf,
  };
}

function buildAttestation(normalized) {
  const unsigned = nullRecord([
    [
      "schema",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_SCHEMA_V4,
    ],
    [
      "status",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_STATUS_V4,
    ],
    [
      "source",
      deepFreeze(
        nullRecord([
          [
            "logicalName",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_LOGICAL_NAME_V4,
          ],
          ["bytes", normalized.sourceBytes.length],
          ["sha256", sha256(normalized.sourceBytes)],
        ]),
      ),
    ],
    [
      "compiler",
      deepFreeze(
        nullRecord([
          ["path", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4],
          [
            "executable",
            deepFreeze(
              nullRecord([
                ["bytes", normalized.compilerBytes.length],
                ["sha256", sha256(normalized.compilerBytes)],
                ["identity", normalized.compilerIdentity],
              ]),
            ),
          ],
          [
            "version",
            deepFreeze(
              nullRecord([
                [
                  "argv",
                  CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_VERSION_ARGV_V4,
                ],
                ["stdout", rawRecord(normalized.compilerVersionBytes)],
                ["stderr", rawRecord(normalized.compilerVersionStderrBytes)],
                ["exitCode", 0],
                ["signal", null],
              ]),
            ),
          ],
        ]),
      ),
    ],
    [
      "compile",
      deepFreeze(
        nullRecord([
          ["argv", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILE_ARGV_V4],
          [
            "environment",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_ENVIRONMENT_V4,
          ],
          ["stdout", rawRecord(normalized.compileStdoutBytes)],
          ["stderr", rawRecord(normalized.compileStderrBytes)],
          ["exitCode", 0],
          ["signal", null],
        ]),
      ),
    ],
    [
      "executable",
      deepFreeze(
        nullRecord([
          ["logicalName", "candidate-containment-supervisor-preflight-v1"],
          ["bytes", normalized.executableBytes.length],
          ["sha256", sha256(normalized.executableBytes)],
          ["identity", normalized.executableIdentity],
          ["suppliedRepeatedExecutableBytesEqual", true],
          ["elf", normalized.elf],
        ]),
      ),
    ],
    [
      "selfDescription",
      deepFreeze(
        nullRecord([
          [
            "bytes",
            Buffer.byteLength(
              CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4,
              "utf8",
            ),
          ],
          [
            "sha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_SHA256_V4,
          ],
          [
            "value",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_V4,
          ],
        ]),
      ),
    ],
    [
      "protocolBindings",
      deepFreeze(
        nullRecord([
          [
            "startSchema",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4,
          ],
          [
            "capsuleSchema",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4,
          ],
          [
            "controlSchema",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4,
          ],
          [
            "statusSchema",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4,
          ],
          [
            "cancelDecisionSchema",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CANCEL_DECISION_SCHEMA_V4,
          ],
          [
            "requirementsSha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
          ],
          [
            "selfDescriptionSha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_SHA256_V4,
          ],
        ]),
      ),
    ],
    ["syscallSurface", syscallSurface],
    ["implementation", implementation],
    ["binding", null],
    ["physicalLaunchEligible", false],
    ["finalDecisionEligible", false],
    [
      "authority",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_AUTHORITY_V4,
    ],
    [
      "nonclaims",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_NONCLAIMS_V4,
    ],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["contentHash", canonicalSha256(unsigned)],
    ]),
  );
}

export function createCandidateContainmentSupervisorPreflightAttestationV4(
  evidence,
) {
  const normalized = normalizeEvidence(evidence);
  const attestation = buildAttestation(normalized);
  const bytes = bufferFrom(`${canonicalJson(attestation)}\n`, "utf8");
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_MAX_BYTES_V4
  ) {
    fail("attestation artifact exceeds its byte ceiling");
  }
  return Object.freeze({
    attestation,
    artifact: frozenArtifactBytes(
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_ARTIFACT_NAME_V4,
      bytes,
    ),
  });
}

function canonicalArtifactBytes(value) {
  const bytes = copyBuffer(
    value,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_MAX_BYTES_V4,
    "artifact bytes",
  );
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    fail("artifact bytes are not UTF-8");
  }
  if (
    text.includes("\0") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.slice(0, -1).includes("\n")
  ) {
    fail("artifact framing changed");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(0, -1));
  } catch {
    fail("artifact is not JSON");
  }
  if (`${canonicalJson(parsed)}\n` !== text) {
    fail("artifact is not exact canonical JSON plus LF");
  }
  return bytes;
}

export function verifyCandidateContainmentSupervisorPreflightAttestationV4(
  value,
) {
  const input = exactRecord(
    value,
    ["artifactBytes", "evidence"],
    "replay input",
  );
  const supplied = canonicalArtifactBytes(input.artifactBytes);
  const recreated = createCandidateContainmentSupervisorPreflightAttestationV4(
    input.evidence,
  );
  if (!bufferEquals.call(supplied, recreated.artifact.bytes)) {
    fail("artifact does not independently reconstruct from supplied evidence");
  }
  const attestation = recreated.attestation;
  const unsigned = nullRecord([
    [
      "schema",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_PROJECTION_SCHEMA_V4,
    ],
    ["status", "STATIC_PREFLIGHT_SUPERVISOR_ATTESTATION_REPLAYED"],
    ["artifactSha256", recreated.artifact.sha256],
    ["contentHash", attestation.contentHash],
    ["sourceSha256", attestation.source.sha256],
    ["compilerSha256", attestation.compiler.executable.sha256],
    ["executableSha256", attestation.executable.sha256],
    ["selfDescriptionSha256", attestation.selfDescription.sha256],
    ["protocolBindings", attestation.protocolBindings],
    ["suppliedRepeatedExecutableBytesEqual", true],
    ["binding", null],
    ["physicalLaunchEligible", false],
    ["finalDecisionEligible", false],
    [
      "authority",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_AUTHORITY_V4,
    ],
    [
      "nonclaims",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_NONCLAIMS_V4,
    ],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}
