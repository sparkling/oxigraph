import { createHash } from "node:crypto";
import { isDeepStrictEqual, types as utilTypes } from "node:util";

import {
  CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
} from "./containment-protocol-v2.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

// Pure replay for a deliberately dormant freestanding artifact. The caller
// supplies all bytes and metadata. This module invokes no compiler, executes no
// artifact, opens no descriptor, and performs no containment mechanic.

export const CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-attestation/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-attestation-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_STATUS_V2 =
  "DORMANT_STATIC_SUPERVISOR_ATTESTATION_ONLY";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_ARTIFACT_NAME_V2 =
  "candidate-containment-supervisor-attestation-v1.json";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_MAX_BYTES_V2 =
  4 * 1024 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_LOGICAL_NAME_V2 =
  "containment-supervisor-v2.c";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_BYTES_V2 = 2_109;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_SHA256_V2 =
  "756b6d730e78d72b9ce5c984f89ef6b9431f0376501f0c8e872c1f2601277e57";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2 =
  "/usr/bin/x86_64-linux-gnu-gcc-13";

const compilerBytesExpected = 1_023_032;
const compilerSha256Expected =
  "1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26";
const sourceMaximumBytes = 1024 * 1024;
const compilerMaximumBytes = 2 * 1024 * 1024;
const versionMaximumBytes = 128 * 1024;
const compileStreamMaximumBytes = 1024 * 1024;
const executableMaximumBytes = 1024 * 1024;
const digestPattern = /^[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
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
  throw new Error(`candidate containment supervisor attestation: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
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
      loads.push({ virtualAddress, memoryBytes, executable });
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
  const selfDescription = bufferFrom(
    CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2,
    "utf8",
  );
  const selfDescriptionOccurrences = occurrences(bytes, selfDescription);
  if (
    loads.length < 1 ||
    entryLoads.length !== 1 ||
    interpreterCount !== 0 ||
    dynamicCount !== 0 ||
    writeExecutableLoad ||
    gnuStackCount !== 1 ||
    gnuStackExecutable ||
    selfDescriptionOccurrences !== 1
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
    ]),
  );
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILE_ARGV_V2 = deepFreeze([
  CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2,
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
  "-Wl,-e,oxigraph_supervisor_dormant_entry",
  CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_LOGICAL_NAME_V2,
  "-o",
  "candidate-containment-supervisor-v1",
]);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_VERSION_ARGV_V2 =
  deepFreeze([CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2, "--version"]);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_ENVIRONMENT_V2 =
  deepFreeze(
    nullRecord([
      ["HOME", "/nonexistent"],
      ["LANG", "C.UTF-8"],
      ["LC_ALL", "C.UTF-8"],
      ["PATH", "/usr/bin:/bin"],
      ["SOURCE_DATE_EPOCH", "0"],
    ]),
  );

const attestationAuthority = deepFreeze(
  nullRecord([
    ...Object.entries(CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2),
    ["compileAuthority", false],
    ["supervisorExecutionAuthority", false],
    ["helperIdentityAuthority", false],
  ]),
);

const attestationNonclaims = deepFreeze(
  nullRecord([
    ...Object.entries(CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2),
    ["attestationProvesCompilerInvocation", false],
    ["attestationProvesSourceToBinaryCausality", false],
    ["compilerDriverClosesToolchain", false],
    ["assemblerAndLinkerClosure", false],
    ["suppliedOutputEqualityProvesCrossHostReproducibility", false],
    ["embeddedDescriptionProvesRuntimeEnforcement", false],
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
    sourceBytes.length !== CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_BYTES_V2 ||
    sha256(sourceBytes) !== CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_SHA256_V2
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
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_SCHEMA_V2],
    ["status", CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_STATUS_V2],
    [
      "source",
      deepFreeze(
        nullRecord([
          [
            "logicalName",
            CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_LOGICAL_NAME_V2,
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
          ["path", CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2],
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
                  CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_VERSION_ARGV_V2,
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
          ["argv", CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILE_ARGV_V2],
          [
            "environment",
            CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_ENVIRONMENT_V2,
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
          ["logicalName", "candidate-containment-supervisor-v1"],
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
              CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2,
              "utf8",
            ),
          ],
          [
            "sha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SHA256_V2,
          ],
          ["value", CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_V2],
        ]),
      ),
    ],
    [
      "protocolBindings",
      deepFreeze(
        nullRecord([
          ["requestSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2],
          ["statusSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2],
          [
            "requirementsSha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
          ],
          [
            "fileDescriptorMapSha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
          ],
          [
            "selfDescriptionSha256",
            CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SHA256_V2,
          ],
        ]),
      ),
    ],
    [
      "implementation",
      deepFreeze(
        nullRecord([
          ["requestParserImplemented", false],
          ["statusWriterImplemented", false],
          ["mechanicsImplemented", false],
          ["artifactExecuted", false],
        ]),
      ),
    ],
    ["binding", null],
    ["physicalLaunchEligible", false],
    ["finalDecisionEligible", false],
    ["authority", attestationAuthority],
    ["nonclaims", attestationNonclaims],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["contentHash", canonicalSha256(unsigned)],
    ]),
  );
}

export function createCandidateContainmentSupervisorAttestationV2(evidence) {
  const normalized = normalizeEvidence(evidence);
  const attestation = buildAttestation(normalized);
  const bytes = bufferFrom(`${canonicalJson(attestation)}\n`, "utf8");
  if (
    bytes.length > CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_MAX_BYTES_V2
  ) {
    fail("attestation artifact exceeds its byte ceiling");
  }
  return Object.freeze({
    attestation,
    artifact: frozenArtifactBytes(
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_ARTIFACT_NAME_V2,
      bytes,
    ),
  });
}

function canonicalArtifactBytes(value) {
  const bytes = copyBuffer(
    value,
    CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_MAX_BYTES_V2,
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

export function verifyCandidateContainmentSupervisorAttestationV2(value) {
  const input = exactRecord(
    value,
    ["artifactBytes", "evidence"],
    "replay input",
  );
  const supplied = canonicalArtifactBytes(input.artifactBytes);
  const recreated = createCandidateContainmentSupervisorAttestationV2(
    input.evidence,
  );
  if (!bufferEquals.call(supplied, recreated.artifact.bytes)) {
    fail("artifact does not independently reconstruct from supplied evidence");
  }
  const attestation = recreated.attestation;
  const unsigned = nullRecord([
    [
      "schema",
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_PROJECTION_SCHEMA_V2,
    ],
    ["status", "DORMANT_STATIC_SUPERVISOR_ATTESTATION_REPLAYED"],
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
    ["authority", attestationAuthority],
    ["nonclaims", attestationNonclaims],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}
