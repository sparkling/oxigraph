import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

const bufferPrototype = Buffer.prototype;
const bufferEquals = bufferPrototype.equals;
const bufferIndexOf = bufferPrototype.indexOf;
const bufferReadBigUInt64LE = bufferPrototype.readBigUInt64LE;
const bufferReadUInt16LE = bufferPrototype.readUInt16LE;
const bufferReadUInt32LE = bufferPrototype.readUInt32LE;
const bufferSubarray = bufferPrototype.subarray;
const bufferToString = bufferPrototype.toString;
const objectPrototype = Object.prototype;
const ownDescriptors = Object.getOwnPropertyDescriptors;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const ownPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = ownDescriptor(typedArrayPrototype, "length").get;
const typedArraySet = Uint8Array.prototype.set;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferIsBuffer = Buffer.isBuffer.bind(Buffer);
const isProxy = utilTypes.isProxy.bind(utilTypes);

export const NATIVE_COMPILER_PATH_V1 = "/usr/bin/x86_64-linux-gnu-gcc-13";
export const NATIVE_COMPILER_SHA256_V1 =
  "1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26";
export const NATIVE_COMPILER_BYTES_V1 = 1_023_032;
export const NATIVE_COMPILER_VERSION_SHA256_V1 =
  "ae487f55927d605284a32711e4ecf6bc3be2bcd5a9de414ace0936264b741f85";
export const NATIVE_COMPILER_VERSION_BYTES_V1 = 266;
export const NATIVE_COMPILER_VERSION_ARGV_V1 = Object.freeze([
  NATIVE_COMPILER_PATH_V1,
  "--version",
]);
export const NATIVE_COMPILER_ENVIRONMENT_V1 = deepFreezeV1(
  nullRecord([
    ["HOME", "/nonexistent"],
    ["LANG", "C.UTF-8"],
    ["LC_ALL", "C.UTF-8"],
    ["PATH", "/usr/bin:/bin"],
    ["SOURCE_DATE_EPOCH", "0"],
    ["TZ", "UTC"],
  ]),
);

const AUTHORITY = deepFreezeV1(
  nullRecord([
    ["filesystemExecution", false],
    ["processExecution", false],
    ["cgroupMutation", false],
    ["serviceManagerAuthority", false],
    ["guardianAuthority", false],
    ["reapAuthority", false],
    ["runtimeRegistration", false],
    ["productExecution", false],
    ["g17Execution", false],
    ["qualification", false],
    ["readiness", false],
    ["promotion", false],
    ["publication", false],
  ]),
);

const PHYSICAL_FACTS = deepFreezeV1(
  nullRecord([
    ["serviceManager", null],
    ["delegatedCgroup", null],
    ["productionUnit", null],
    ["stateFilesystem", null],
    ["powerLossDurability", null],
    ["managerHeldExec", null],
    ["guardianHeldExec", null],
    ["liveImageEquality", null],
    ["pidfd", null],
    ["cgroupQuiescence", null],
  ]),
);

const NONCLAIMS = Object.freeze([
  "compiler-causality",
  "cross-host-reproducibility",
  "runtime-syscall-closure",
  "held-executable-live-image-equality",
  "delegated-cgroup",
  "production-service-manager",
  "power-loss-durability",
  "same-uid-tamper-resistance",
  "pidfd-or-waitid-authority",
  "application-output",
  "COMMIT",
  "semantic-qualification",
  "runtime-registration",
  "production-readiness",
  "promotion",
  "publication",
]);

function fail(code) {
  throw new Error(`ADR38_NATIVE_ATTEST_${code}`);
}

export function sha256V1(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

export function deepFreezeV1(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeV1(child, seen);
  return Object.freeze(value);
}

const deepFreeze = deepFreezeV1;

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("REQUIREMENTS");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") fail("REQUIREMENTS");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function semanticSha256V1(value) {
  return sha256V1(Buffer.from(canonicalJson(value), "utf8"));
}

function exactBuffer(value, maximum, code) {
  if (
    !bufferIsBuffer(value) ||
    isProxy(value) ||
    ownPrototype(value) !== bufferPrototype ||
    ownDescriptor(value, "length") !== undefined
  ) {
    fail(code);
  }
  let length;
  try {
    length = typedArrayLength.call(value);
  } catch {
    fail(code);
  }
  if (!Number.isSafeInteger(length) || length === 0 || length > maximum) {
    fail(code);
  }
  const copied = bufferAllocUnsafe(length);
  typedArraySet.call(copied, value);
  return copied;
}

function exactInput(value, manager) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    (ownPrototype(value) !== objectPrototype && ownPrototype(value) !== null)
  ) {
    fail("INPUT");
  }
  const fields = [
    "sourceBytes",
    "compilerBytes",
    "compilerVersionBytes",
    "firstExecutableBytes",
    "secondExecutableBytes",
  ];
  if (manager) {
    fields.push("statefsHeaderBytes", "statefsSourceBytes", "statefsObjectBytes");
  }
  const descriptors = ownDescriptors(value);
  const keys = ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    [...keys].sort().join("\0") !== [...fields].sort().join("\0") ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined;
    })
  ) {
    fail("INPUT");
  }
  return nullRecord(fields.map((field) => [field, descriptors[field].value]));
}

function countOccurrences(bytes, needle) {
  const bytesLength = typedArrayLength.call(bytes);
  const needleLength = typedArrayLength.call(needle);
  let count = 0;
  let offset = 0;
  while (offset <= bytesLength - needleLength) {
    const found = bufferIndexOf.call(bytes, needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + needleLength;
  }
  return count;
}

function inspectElf(bytes, selfDescription) {
  const bytesLength = typedArrayLength.call(bytes);
  if (
    bytesLength < 64 ||
    bytes[0] !== 0x7f ||
    bufferToString.call(bufferSubarray.call(bytes, 1, 4), "ascii") !== "ELF" ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bufferReadUInt16LE.call(bytes, 16) !== 2 ||
    bufferReadUInt16LE.call(bytes, 18) !== 62 ||
    bufferReadUInt16LE.call(bytes, 54) !== 56
  ) {
    fail("ELF");
  }
  const programOffset = Number(bufferReadBigUInt64LE.call(bytes, 32));
  const programCount = bufferReadUInt16LE.call(bytes, 56);
  if (programCount < 1 || programCount > 64 || programOffset + programCount * 56 > bytesLength) {
    fail("ELF");
  }
  let interpreter = 0;
  let dynamic = 0;
  let executableStack = false;
  let writeExecutableLoad = false;
  let readOnlySelfDescriptionOccurrences = 0;
  const selfDescriptionBytes = bufferFrom(selfDescription, "utf8");
  for (let index = 0; index < programCount; index += 1) {
    const offset = programOffset + index * 56;
    const type = bufferReadUInt32LE.call(bytes, offset);
    const flags = bufferReadUInt32LE.call(bytes, offset + 4);
    if (type === 3) interpreter += 1;
    if (type === 2) dynamic += 1;
    if (type === 0x6474e551 && (flags & 1) !== 0) executableStack = true;
    if (type === 1 && (flags & 2) !== 0 && (flags & 1) !== 0) writeExecutableLoad = true;
    if (type === 1 && (flags & 2) === 0) {
      const fileOffset = Number(bufferReadBigUInt64LE.call(bytes, offset + 8));
      const fileBytes = Number(bufferReadBigUInt64LE.call(bytes, offset + 32));
      if (
        fileOffset < 0 ||
        fileBytes < 0 ||
        fileOffset + fileBytes > bytesLength
      ) {
        fail("ELF");
      }
      readOnlySelfDescriptionOccurrences += countOccurrences(
        bufferSubarray.call(bytes, fileOffset, fileOffset + fileBytes),
        selfDescriptionBytes,
      );
    }
  }
  const selfDescriptionOccurrences = countOccurrences(
    bytes,
    selfDescriptionBytes,
  );
  if (
    interpreter !== 0 ||
    dynamic !== 0 ||
    executableStack ||
    writeExecutableLoad ||
    selfDescriptionOccurrences !== 1 ||
    readOnlySelfDescriptionOccurrences !== 1
  ) {
    fail("ELF");
  }
  return deepFreeze(
    nullRecord([
      ["staticElf", true],
      ["interpreter", null],
      ["dynamicSegment", false],
      ["writeExecutableLoad", false],
      ["gnuStackExecutable", false],
      ["selfDescriptionOccurrences", 1],
      ["selfDescriptionReadOnlyLoadOccurrences", 1],
    ]),
  );
}

export function createNativeAttestationV1(config) {
  const frozenConfig = deepFreeze(config);
  if (semanticSha256V1(frozenConfig.requirements) !== frozenConfig.requirementsSha256) {
    fail("REQUIREMENTS");
  }
  return function attestV1(candidate) {
    const input = exactInput(candidate, frozenConfig.manager === true);
    const source = exactBuffer(input.sourceBytes, 1024 * 1024, "SOURCE");
    const compiler = exactBuffer(input.compilerBytes, 2 * 1024 * 1024, "COMPILER");
    const compilerVersion = exactBuffer(
      input.compilerVersionBytes,
      128 * 1024,
      "COMPILER_VERSION",
    );
    const first = exactBuffer(input.firstExecutableBytes, 8 * 1024 * 1024, "ELF");
    const second = exactBuffer(input.secondExecutableBytes, 8 * 1024 * 1024, "ELF");
    if (typedArrayLength.call(source) !== frozenConfig.sourceBytes || sha256V1(source) !== frozenConfig.sourceSha256) fail("SOURCE");
    if (typedArrayLength.call(compiler) !== NATIVE_COMPILER_BYTES_V1 || sha256V1(compiler) !== NATIVE_COMPILER_SHA256_V1) fail("COMPILER");
    if (
      typedArrayLength.call(compilerVersion) !== NATIVE_COMPILER_VERSION_BYTES_V1 ||
      sha256V1(compilerVersion) !== NATIVE_COMPILER_VERSION_SHA256_V1
    ) {
      fail("COMPILER_VERSION");
    }
    if (!bufferEquals.call(first, second) || typedArrayLength.call(first) !== frozenConfig.elfBytes || sha256V1(first) !== frozenConfig.elfSha256) {
      fail("ELF_IDENTITY");
    }
    const inspection = inspectElf(first, frozenConfig.selfDescription);
    let statefs = null;
    if (frozenConfig.manager === true) {
      const header = exactBuffer(input.statefsHeaderBytes, 1024 * 1024, "STATEFS_HEADER");
      const statefsSource = exactBuffer(input.statefsSourceBytes, 1024 * 1024, "STATEFS_SOURCE");
      const statefsObject = exactBuffer(input.statefsObjectBytes, 1024 * 1024, "STATEFS_OBJECT");
      if (sha256V1(header) !== frozenConfig.statefsHeaderSha256) fail("STATEFS_HEADER");
      if (sha256V1(statefsSource) !== frozenConfig.statefsSourceSha256) fail("STATEFS_SOURCE");
      if (
        typedArrayLength.call(statefsObject) !== frozenConfig.statefsObjectBytes ||
        sha256V1(statefsObject) !== frozenConfig.statefsObjectSha256
      ) {
        fail("STATEFS_OBJECT");
      }
      statefs = deepFreeze(
        nullRecord([
          ["headerSha256", frozenConfig.statefsHeaderSha256],
          ["sourceSha256", frozenConfig.statefsSourceSha256],
          ["objectByteLength", frozenConfig.statefsObjectBytes],
          ["objectSha256", frozenConfig.statefsObjectSha256],
          ["buildRequirementsSha256", frozenConfig.statefsBuildRequirementsSha256],
          ["entrypoint", "oxigraph_containment_statefs_execute_v1"],
          ["invoked", false],
        ]),
      );
    }
    return deepFreeze(
      nullRecord([
        ["schema", frozenConfig.attestationSchema],
        ["artifact", frozenConfig.kind],
        ["sourceSha256", frozenConfig.sourceSha256],
        ["requirementsSha256", frozenConfig.requirementsSha256],
        ["compileArgv", frozenConfig.compileArgv],
        ["linkArgv", frozenConfig.linkArgv],
        ["compilerEnvironment", NATIVE_COMPILER_ENVIRONMENT_V1],
        ["compilerSha256", NATIVE_COMPILER_SHA256_V1],
        ["compilerVersionSha256", NATIVE_COMPILER_VERSION_SHA256_V1],
        ["elfByteLength", frozenConfig.elfBytes],
        ["elfSha256", frozenConfig.elfSha256],
        ["repeatedBuildByteIdentical", true],
        ["inspection", inspection],
        ["statefs", statefs],
        ["authority", AUTHORITY],
        ["physicalFacts", PHYSICAL_FACTS],
        ["nonclaims", NONCLAIMS],
        ["readiness", deepFreeze(nullRecord([["status", "unavailable"], ["reason", "native-adapter-unavailable"]]))],
      ]),
    );
  };
}
