import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { parseG17Elf64 } from "./native-elf.mjs";
import { G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA } from "./cargo-execveat-status-protocol-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "./non-tmpfs-build-isolation-v2-contract.mjs";

// Pure replay for the reviewed C17 Cargo launcher helper. The caller supplies
// all bytes and metadata. This module performs no I/O, invokes no compiler,
// opens no descriptor, and launches neither the helper nor Cargo. Its output is
// therefore a dormant, non-authoritative attestation projection only.

export const G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA =
  "oxigraph.g1.7-cargo-execveat-helper-attestation/v1";
export const G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA =
  "oxigraph.g1.7-cargo-execveat-helper-attestation-replay/v1";
export const G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME =
  "cargo-execveat-helper-attestation.json";
export const G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES = 4 * 1024 * 1024;
export const G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME =
  "cargo-execveat-helper.c";
export const G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES = 14_703;
export const G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256 =
  "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9";
export const G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH =
  "/usr/bin/x86_64-linux-gnu-gcc-13";

const SOURCE_MAX_BYTES = 1024 * 1024;
const COMPILER_MAX_BYTES = 4 * 1024 * 1024;
const VERSION_MAX_BYTES = 128 * 1024;
const COMPILE_STREAM_MAX_BYTES = 1024 * 1024;
const EXECUTABLE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 65_536;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_PROPERTIES = 4_097;
const MAX_STRING_BYTES = G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferIsBuffer = Buffer.isBuffer.bind(Buffer);
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const bufferFrom = Buffer.from.bind(Buffer);
const bufferToString = Buffer.prototype.toString;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`G1.7 Cargo execveat helper attestation: ${message}`);
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

function snapshotOwnData(
  value,
  label,
  ancestors = new WeakSet(),
  depth = 0,
  budget = { nodes: 0, strings: 0 },
) {
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail(`${label} contains a Proxy`);
  }
  if (depth > MAX_DEPTH) fail(`${label} exceeds the depth limit`);
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) fail(`${label} exceeds the node limit`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = bufferByteLength(value, "utf8");
    budget.strings += bytes;
    if (bytes > MAX_SINGLE_STRING_BYTES || budget.strings > MAX_STRING_BYTES) {
      fail(`${label} exceeds the string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} is not finite`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    ArrayBuffer.isView(value)
  ) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    fail(`${label} prototype cannot be inspected: ${error.message}`);
  }
  const array = Array.isArray(value);
  if (
    prototype !== (array ? arrayPrototype : objectPrototype) &&
    !(prototype === null && !array)
  ) {
    fail(`${label} contains a foreign prototype`);
  }
  ancestors.add(value);
  try {
    let descriptors;
    try {
      descriptors = objectGetOwnPropertyDescriptors(value);
    } catch (error) {
      fail(`${label} properties cannot be inspected: ${error.message}`);
    }
    const keys = reflectOwnKeys(descriptors);
    if (
      keys.length > MAX_PROPERTIES ||
      keys.some((key) => typeof key !== "string")
    ) {
      fail(`${label} exceeds its property budget or contains symbols`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      budget.strings += bufferByteLength(key, "utf8");
      if (budget.strings > MAX_STRING_BYTES) {
        fail(`${label} exceeds the key budget`);
      }
      if (!("value" in descriptor)) {
        fail(`${label}.${key} is not an own data property`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fail(`${label} is not a bounded dense array`);
      }
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
        fail(`${label} is not a field-free dense array`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotOwnData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
          depth + 1,
          budget,
        ),
      );
    }
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      output[key] = snapshotOwnData(
        descriptor.value,
        `${label}.${key}`,
        ancestors,
        depth + 1,
        budget,
      );
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function exactRecord(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value)
  ) {
    fail(`${label} must be a plain own-data record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch (error) {
    fail(`${label} cannot be inspected: ${error.message}`);
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(`${label} must have an ordinary or null prototype`);
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort()) ||
    keys.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    )
  ) {
    fail(`${label} fields must be exact enumerable own data`);
  }
  return nullRecord(expected.map((key) => [key, descriptors[key].value]));
}

function copyBoundedBuffer(value, maximum, label, allowEmpty = false) {
  if (
    !bufferIsBuffer(value) ||
    types.isProxy(value) ||
    objectGetPrototypeOf(value) !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(`${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(`${label} length cannot be read intrinsically: ${error.message}`);
  }
  if (
    !Number.isSafeInteger(length) ||
    length > maximum ||
    (!allowEmpty && length === 0)
  ) {
    fail(`${label} is outside its byte bound`);
  }
  try {
    const copied = bufferAllocUnsafe(length);
    typedArraySet.call(copied, value);
    return copied;
  } catch (error) {
    fail(`${label} cannot be copied intrinsically: ${error.message}`);
  }
}

function decimal(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    fail(`${label} is not a bounded canonical decimal`);
  }
  const number = BigInt(value);
  if (positive ? number < 1n : number < 0n) {
    fail(`${label} is outside its range`);
  }
  return value;
}

function validateIdentity(input, label, bytes, kind) {
  const value = exactRecord(
    input,
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
  decimal(value.device, `${label} device`, { positive: true });
  decimal(value.inode, `${label} inode`, { positive: true });
  decimal(value.mode, `${label} mode`, { positive: true });
  decimal(value.links, `${label} links`, { positive: true });
  decimal(value.size, `${label} size`, { positive: true });
  decimal(value.modifiedNs, `${label} modifiedNs`);
  decimal(value.changedNs, `${label} changedNs`);
  decimal(value.ownerUid, `${label} ownerUid`);
  decimal(value.ownerGid, `${label} ownerGid`);
  const mode = BigInt(value.mode);
  if (
    mode > 0o177777n ||
    (mode & 0o170000n) !== 0o100000n ||
    value.size !== String(typedArrayLengthGetter.call(bytes))
  ) {
    fail(`${label} is not the supplied regular-file identity`);
  }
  if (kind === "compiler") {
    if ((mode & 0o111n) === 0n) {
      fail("compiler identity is not executable");
    }
  } else if (value.links !== "1" || (mode & 0o777n) !== 0o500n) {
    fail("helper executable identity is not exact 0500 single-link storage");
  }
  return value;
}

function rawRecord(bytes) {
  return nullRecord([
    ["bytes", typedArrayLengthGetter.call(bytes)],
    ["sha256", sha256(bytes)],
    ["base64", bufferToString.call(bytes, "base64")],
  ]);
}

function validateVersion(bytes) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`compiler version is not UTF-8: ${error.message}`);
  }
  const firstLine = text.split("\n", 1)[0];
  if (
    !text.endsWith("\n") ||
    firstLine.length < 1 ||
    !firstLine.includes("gcc") ||
    !/(?:^|[^0-9])13\.[0-9]/u.test(firstLine)
  ) {
    fail("compiler version is not an exact raw GCC-13 observation");
  }
}

function validateElf(bytes, label) {
  let parsed;
  try {
    parsed = parseG17Elf64(bytes);
  } catch (error) {
    fail(`${label} is not a valid x86-64 ELF: ${error.message}`);
  }
  if (
    parsed === null ||
    parsed.elfClass !== 64 ||
    parsed.elfData !== "little" ||
    parsed.elfMachine !== 62 ||
    parsed.interpreter === null
  ) {
    fail(`${label} is not the required dynamic x86-64 ELF`);
  }
  return snapshotOwnData(parsed, `${label} ELF`);
}

const policyArtifact = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
const policy = policyArtifact.policy;

export const G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV = deepFreeze(
  snapshotOwnData(
    policy.helper.attestation.compileArgv,
    "frozen helper compile argv",
  ),
);

export const G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV = deepFreeze(
  snapshotOwnData(
    [G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH, "--version"],
    "frozen helper compiler version argv",
  ),
);

export const G17_CARGO_EXECVEAT_HELPER_POLICY_BINDINGS = deepFreeze(
  snapshotOwnData(
    {
      isolationPolicySchema: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
      isolationPolicyRawSha256: policyArtifact.artifact.sha256,
      isolationPolicyContentHash: policy.sha256,
      fileDescriptorMapSha256:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
      statusProtocolSchema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
      statusProtocolRequirementsSha256:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
    },
    "frozen helper policy bindings",
  ),
);

export const G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER = deepFreeze(
  snapshotOwnData(
    {
      status: "SUCCESSOR_EXECUTION_REQUEST_REQUIRED",
      requiredSchema: "oxigraph.g1.7-benchmark-execution-request/v2",
      requiredBindingOwner: "future-private-co-located-issuer",
      rawSha256: null,
      contentHash: null,
      exactBindingPresent: false,
      runtimeArgvBound: false,
      runtimeEnvironmentBound: false,
      physicalLaunchEligible: false,
    },
    "frozen helper request binding placeholder",
  ),
);

export const G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY = deepFreeze(
  snapshotOwnData(
    {
      helperAttestationAuthority: false,
      helperExecutionAuthority: false,
      cargoExecutionAuthority: false,
      launchExecutionAuthority: false,
      nativeObservationAuthority: false,
      containmentExecutionAuthority: false,
      buildExecutionAuthority: false,
      controlExecutionAuthority: false,
      qualificationExecutionAuthority: false,
      receiptAuthority: false,
      promotionAuthority: false,
      publicationAuthority: false,
      routerQualityAuthority: false,
      providerExecutionAuthority: false,
    },
    "frozen helper attestation authority",
  ),
);

export const G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS = deepFreeze(
  snapshotOwnData(
    {
      callerSuppliedBytesProveNativeOrigin: false,
      sourceDigestProvesReviewedSemantics: false,
      compilerDigestProvesInvocation: false,
      compilerVersionReplayProvesObservedProcess: false,
      compileStreamsProveCompilerRan: false,
      executableDigestProvesCompilerOutput: false,
      metadataReplayProvesHeldDescriptor: false,
      elfReplayProvesSafeExecution: false,
      attestationReplayBindsExecutionRequest: false,
      requestPlaceholderIsExecutionBinding: false,
      helperRuntimeArgvBoundToExecutionRequest: false,
      helperRuntimeEnvironmentBoundToExecutionRequest: false,
      helperValidatesExecutionRequestBinding: false,
      helperExecutionObserved: false,
      cargoExecveatObserved: false,
      cargoExecutionObserved: false,
      privateCoLocatedIssuerImplemented: false,
      physicalEligibility: false,
    },
    "frozen helper attestation nonclaims",
  ),
);

function captureEvidence(input) {
  const value = exactRecord(
    input,
    [
      "sourceBytes",
      "compilerBytes",
      "compilerVersionBytes",
      "compilerVersionStderrBytes",
      "compilerVersionExitCode",
      "compilerVersionSignal",
      "compileStdoutBytes",
      "compileStderrBytes",
      "compileExitCode",
      "compileSignal",
      "executableBytes",
      "compilerIdentity",
      "executableIdentity",
    ],
    "evidence",
  );
  const captured = {
    sourceBytes: copyBoundedBuffer(
      value.sourceBytes,
      SOURCE_MAX_BYTES,
      "helper source bytes",
    ),
    compilerBytes: copyBoundedBuffer(
      value.compilerBytes,
      COMPILER_MAX_BYTES,
      "compiler bytes",
    ),
    compilerVersionBytes: copyBoundedBuffer(
      value.compilerVersionBytes,
      VERSION_MAX_BYTES,
      "compiler version stdout bytes",
    ),
    compilerVersionStderrBytes: copyBoundedBuffer(
      value.compilerVersionStderrBytes,
      VERSION_MAX_BYTES,
      "compiler version stderr bytes",
      true,
    ),
    compileStdoutBytes: copyBoundedBuffer(
      value.compileStdoutBytes,
      COMPILE_STREAM_MAX_BYTES,
      "compile stdout bytes",
      true,
    ),
    compileStderrBytes: copyBoundedBuffer(
      value.compileStderrBytes,
      COMPILE_STREAM_MAX_BYTES,
      "compile stderr bytes",
      true,
    ),
    executableBytes: copyBoundedBuffer(
      value.executableBytes,
      EXECUTABLE_MAX_BYTES,
      "helper executable bytes",
    ),
  };
  if (
    value.compilerVersionExitCode !== 0 ||
    value.compilerVersionSignal !== null ||
    value.compileExitCode !== 0 ||
    value.compileSignal !== null
  ) {
    fail("compiler version or compile process did not exit exactly zero");
  }
  if (
    typedArrayLengthGetter.call(captured.compilerVersionStderrBytes) !== 0 ||
    typedArrayLengthGetter.call(captured.compileStdoutBytes) !== 0 ||
    typedArrayLengthGetter.call(captured.compileStderrBytes) !== 0
  ) {
    fail("GCC-13 version stderr or compile raw streams are not exactly empty");
  }
  if (
    typedArrayLengthGetter.call(captured.sourceBytes) !==
      G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES ||
    sha256(captured.sourceBytes) !== G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256
  ) {
    fail("helper source bytes differ from the reviewed C17 source");
  }
  validateVersion(captured.compilerVersionBytes);
  captured.compilerIdentity = validateIdentity(
    value.compilerIdentity,
    "compiler identity",
    captured.compilerBytes,
    "compiler",
  );
  captured.executableIdentity = validateIdentity(
    value.executableIdentity,
    "helper executable identity",
    captured.executableBytes,
    "helper",
  );
  captured.compilerElf = validateElf(captured.compilerBytes, "compiler");
  captured.executableElf = validateElf(
    captured.executableBytes,
    "helper executable",
  );
  if (sha256(captured.compilerBytes) === sha256(captured.executableBytes)) {
    fail("helper executable aliases the compiler bytes");
  }
  return captured;
}

function buildAttestation(input) {
  const captured = captureEvidence(input);
  const unsigned = nullRecord([
    ["schema", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA],
    ["status", "DORMANT_ATTESTATION_ONLY"],
    [
      "source",
      nullRecord([
        ["logicalName", G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME],
        ["bytes", typedArrayLengthGetter.call(captured.sourceBytes)],
        ["sha256", sha256(captured.sourceBytes)],
      ]),
    ],
    [
      "compiler",
      nullRecord([
        ["path", G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH],
        ["major", "13"],
        [
          "executable",
          nullRecord([
            ["bytes", typedArrayLengthGetter.call(captured.compilerBytes)],
            ["sha256", sha256(captured.compilerBytes)],
            ["identity", captured.compilerIdentity],
            ["elf", captured.compilerElf],
          ]),
        ],
        [
          "version",
          nullRecord([
            ["argv", G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV],
            ["stdout", rawRecord(captured.compilerVersionBytes)],
            ["stderr", rawRecord(captured.compilerVersionStderrBytes)],
            ["exitCode", 0],
            ["signal", null],
          ]),
        ],
      ]),
    ],
    [
      "compile",
      nullRecord([
        ["argv", G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV],
        ["stdout", rawRecord(captured.compileStdoutBytes)],
        ["stderr", rawRecord(captured.compileStderrBytes)],
        ["exitCode", 0],
        ["signal", null],
      ]),
    ],
    [
      "executable",
      nullRecord([
        ["logicalName", "g17-cargo-execveat-helper"],
        ["bytes", typedArrayLengthGetter.call(captured.executableBytes)],
        ["sha256", sha256(captured.executableBytes)],
        ["identity", captured.executableIdentity],
        ["elf", captured.executableElf],
      ]),
    ],
    ["policyBindings", G17_CARGO_EXECVEAT_HELPER_POLICY_BINDINGS],
    ["requestBinding", G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER],
    [
      "implementation",
      nullRecord([
        ["privateIssuerImplemented", false],
        ["physicalHelperLaunchObserved", false],
        ["cargoExecveatObserved", false],
        ["physicalLaunchEligible", false],
      ]),
    ],
    ["physicalLaunchEligible", false],
    ["binding", null],
    ["finalDecisionEligible", false],
    ["nonclaims", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS],
    ["authority", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["contentHash", canonicalSha256(unsigned)],
    ]),
  );
}

function canonicalAttestationBytes(attestation) {
  const bytes = bufferFrom(`${canonicalJson(attestation)}\n`, "utf8");
  if (
    bytes.length < 2 ||
    bytes.length > G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES
  ) {
    fail("attestation artifact exceeds its byte ceiling");
  }
  return bytes;
}

function artifactEnvelope(bytes) {
  const stored = bufferFrom(bytes);
  const artifact = Object.create(null);
  Object.defineProperties(artifact, {
    name: {
      value: G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME,
      enumerable: true,
    },
    rawSha256: { value: sha256(stored), enumerable: true },
    bytes: {
      get() {
        return bufferFrom(stored);
      },
      enumerable: true,
    },
  });
  return Object.freeze(artifact);
}

function identityFor(attestation, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA],
      ["rawSha256", sha256(bytes)],
      ["contentHash", attestation.contentHash],
    ]),
  );
}

export function createG17CargoExecveatHelperAttestationArtifact(evidence) {
  try {
    const attestation = buildAttestation(evidence);
    const bytes = canonicalAttestationBytes(attestation);
    return Object.freeze(
      nullRecord([
        ["attestation", attestation],
        ["identity", identityFor(attestation, bytes)],
        ["artifact", artifactEnvelope(bytes)],
      ]),
    );
  } catch (error) {
    if (error?.message?.startsWith("G1.7 Cargo execveat helper attestation:")) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}

function verificationInput(input) {
  const value = exactRecord(input, ["bytes", "evidence"], "verification input");
  return {
    bytes: copyBoundedBuffer(
      value.bytes,
      G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES,
      "attestation artifact bytes",
    ),
    evidence: value.evidence,
  };
}

function decodeCanonicalAttestation(bytes) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`attestation artifact is not UTF-8: ${error.message}`);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("attestation artifact must be one LF-terminated JSON value");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`attestation artifact is invalid JSON: ${error.message}`);
  }
  const attestation = snapshotOwnData(parsed, "attestation document");
  if (!bufferEquals.call(bytes, canonicalAttestationBytes(attestation))) {
    fail("attestation artifact is not canonical JSON plus one LF");
  }
  return attestation;
}

export function verifyG17CargoExecveatHelperAttestationArtifact(input) {
  try {
    const captured = verificationInput(input);
    const expected = buildAttestation(captured.evidence);
    const attestation = decodeCanonicalAttestation(captured.bytes);
    if (!isDeepStrictEqual(attestation, expected)) {
      fail("attestation differs from the exact supplied evidence and policy");
    }
    const identity = identityFor(attestation, captured.bytes);
    return deepFreeze(
      nullRecord([
        ["schema", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA],
        ["status", "DORMANT_HELPER_ATTESTATION_REPLAYED"],
        ["identity", identity],
        [
          "requestBinding",
          G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
        ],
        ["physicalLaunchEligible", false],
        ["binding", null],
        ["finalDecisionEligible", false],
        ["nonclaims", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS],
        ["authority", G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY],
      ]),
    );
  } catch (error) {
    if (error?.message?.startsWith("G1.7 Cargo execveat helper attestation:")) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}
