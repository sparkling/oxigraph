import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REQUIREMENTS_URL = new URL(
  "../../../docs/adr/fixtures/0036-guardian-control-requirements-v1.json",
  import.meta.url,
);
const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-control-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const NODE_20_0_MISSING_CANDIDATE_MESSAGE = `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`;
const REQUIREMENTS_ORACLE = JSON.parse(readFileSync(REQUIREMENTS_URL, "utf8"));

const EXPECTED_REQUIREMENTS_SHA256 =
  "0f244f7242eb40a615245a5eda77d5380e368f43a8382f27b3cdb5c1a387e499";
const EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY =
  "additional-non-index-string-and-symbol-properties-ignored-without-enumeration-inspection-read-write-or-invocation;own-length-rejected;semantics-derived-only-from-immediate-intrinsic-copy-of-indexed-bytes/v1";
const EXPECTED_NORMAL_MAP_SHA256 =
  "1f2bcfca0089977fc1c5fdde2bfcfa6eed671e839a2daee87b5c19d3c2b4fffb";
const EXPECTED_RECOVERY_MAP_SHA256 =
  "620b125181725cff59b7d11d08f193250f9046d3aec4021016418d0ab42d4594";
const EXPECTED_RIGHT_MAP_SHA256 =
  "082b09e65c5b58c92a909f27e3f9dd8b83e4833885e35846a31ace14c82744a2";

const EXPECTED_EXPORTS = Object.freeze([
  "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
  "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256",
  "createCandidateContainmentGuardianStartupV1",
  "createCandidateContainmentGuardianAdmissionInputV1",
  "createCandidateContainmentGuardianCancelInputV1",
  "createCandidateContainmentGuardianRecoveryRequestInputV1",
  "createCandidateContainmentGuardianControllerClosedInputV1",
  "createCandidateContainmentGuardianDiagnosticFailureInputV1",
  "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
  "createCandidateContainmentGuardianStatusEofInputV1",
  "initializeCandidateContainmentGuardianControlV1",
  "reduceCandidateContainmentGuardianControlV1",
  "verifyCandidateContainmentGuardianStatusFrameV1",
]);

const EXPECTED_FUNCTION_SIGNATURES = Object.freeze([
  Object.freeze({
    name: "createCandidateContainmentGuardianStartupV1",
    parameters: Object.freeze([
      "startupReportBytes",
      "epochBytes",
      "epochEofObserved",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianAdmissionInputV1",
    parameters: Object.freeze([
      "currentState",
      "admissionFrameBytes",
      "recvmsgReportBytes",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianCancelInputV1",
    parameters: Object.freeze([
      "currentState",
      "cancelFrameBytes",
      "messageTruncated",
      "controlTruncated",
      "controlMessageCount",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianRecoveryRequestInputV1",
    parameters: Object.freeze([
      "currentState",
      "recoveryRequestFrameBytes",
      "requestEofObserved",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianControllerClosedInputV1",
    parameters: Object.freeze(["currentState"]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    parameters: Object.freeze([
      "currentState",
      "diagnosticSummaryReportBytes",
      "rawDiagnosticBytes",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    parameters: Object.freeze(["currentState"]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianStatusEofInputV1",
    parameters: Object.freeze(["currentState"]),
  }),
  Object.freeze({
    name: "initializeCandidateContainmentGuardianControlV1",
    parameters: Object.freeze(["startupProjection"]),
  }),
  Object.freeze({
    name: "reduceCandidateContainmentGuardianControlV1",
    parameters: Object.freeze(["currentState", "brandedInput"]),
  }),
  Object.freeze({
    name: "verifyCandidateContainmentGuardianStatusFrameV1",
    parameters: Object.freeze(["startupProjection", "statusFrameBytes"]),
  }),
]);

const EXPECTED_EXPORT_MANIFEST = Object.freeze([
  Object.freeze({
    name: "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
    kind: "const",
    arity: null,
  }),
  Object.freeze({
    name: "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256",
    kind: "const",
    arity: null,
  }),
  ...EXPECTED_FUNCTION_SIGNATURES.map(({ name, parameters }) =>
    Object.freeze({ name, kind: "function", arity: parameters.length }),
  ),
]);

const EXPECTED_REQUIREMENTS_TOP_LEVEL_FIELDS = Object.freeze([
  "schema",
  "version",
  "predecessors",
  "schemas",
  "limits",
  "modes",
  "startupMaps",
  "admissionRights",
  "frameFields",
  "vocabularies",
  "legalSequences",
  "privateStateStores",
  "authority",
  "physicalFacts",
  "nonclaims",
]);

function assertPinnedRequirementsOracleForStaticPolicy() {
  assert.equal(
    REQUIREMENTS_ORACLE !== null &&
      typeof REQUIREMENTS_ORACLE === "object" &&
      !Array.isArray(REQUIREMENTS_ORACLE),
    true,
  );
  assert.equal(
    semanticSha256(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.schema,
    "oxigraph.candidate-containment-guardian-control-requirements/v1",
  );
  assert.equal(REQUIREMENTS_ORACLE.version, 1);
  assert.deepEqual(
    Object.keys(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_TOP_LEVEL_FIELDS,
  );
  return REQUIREMENTS_ORACLE;
}

// Source-policy allowlists may only be derived after this synchronous pin.
// The later node:test repeats the checks as independently visible evidence.
const STATIC_POLICY_REQUIREMENTS_ORACLE =
  assertPinnedRequirementsOracleForStaticPolicy();

const EXPANSION_ANCHORS = Object.freeze({
  namedExports: 13,
  wholeTransitionAndStateGoldens: 20,
  emittedStatusByteGoldens: 15,
  atomicTwoStatusInternalPrefixControls: 4,
  completeSequenceWireFrameCounts: Object.freeze({
    N1: 4,
    N2: 6,
    N3: 3,
    N4: 5,
    N5a: 2,
    N5b: 4,
    R1: 3,
    R2: 3,
  }),
  terminalEventCounts: Object.freeze({
    N1: 5,
    N2: 7,
    N3: 5,
    N4: 7,
    N5a: 4,
    N5b: 6,
    R1: 5,
    R2: 5,
  }),
});

// Independently measured from the five ratified files. The fixture is verified
// against these constants, never used to supply them.
const PREDECESSOR_SOURCE_GOLDENS = Object.freeze([
  Object.freeze({
    kind: "direct",
    specifier: "./containment-exact-v2.mjs",
    byteLength: 10_833,
    sha256: "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
  }),
  Object.freeze({
    kind: "direct",
    specifier: "./containment-guardian-recovery-v1.mjs",
    byteLength: 143_143,
    sha256: "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
  }),
  Object.freeze({
    kind: "direct",
    specifier: "./containment-launch-capsule-v3.mjs",
    byteLength: 17_977,
    sha256: "9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d",
  }),
  Object.freeze({
    kind: "evidenceOnly",
    specifier: "./containment-supervisor-control-v2.mjs",
    byteLength: 31_785,
    sha256: "92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842",
  }),
  Object.freeze({
    kind: "evidenceOnly",
    specifier: "./containment-supervisor-preflight-v4.mjs",
    byteLength: 60_224,
    sha256: "747c913e60768c53bdeeec923a6ff2f1319121d743bddd8e4db663c1a03d23ff",
  }),
]);

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

function semanticSha256(value) {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

function byteSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertPinnedPredecessorBytes(bytes, golden) {
  if (
    bytes.length !== golden.byteLength ||
    byteSha256(bytes) !== golden.sha256
  ) {
    throw new Error(`predecessor source pin mismatch: ${golden.specifier}`);
  }
}

function predecessorByteMutations(bytes) {
  assert.equal(bytes.length > 2, true);
  const mutations = [];
  for (const index of [0, Math.floor(bytes.length / 2), bytes.length - 1]) {
    const mutated = Buffer.from(bytes);
    mutated[index] ^= 1;
    mutations.push(mutated);
  }
  mutations.push(Buffer.concat([bytes, Buffer.from([0x0a])]));
  mutations.push(Buffer.from(bytes.subarray(0, bytes.length - 1)));
  return Object.freeze(mutations);
}

function assertRequirementsValue(actual, expected) {
  if (expected === null || typeof expected !== "object") {
    assert.equal(actual, expected);
    return;
  }
  assert.equal(Object.isFrozen(actual), true);
  if (Array.isArray(expected)) {
    assert.equal(Array.isArray(actual), true);
    assert.equal(Object.getPrototypeOf(actual), Array.prototype);
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      assertRequirementsValue(actual[index], expected[index]);
    }
    return;
  }
  assert.equal(Object.getPrototypeOf(actual), null);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) {
    assertRequirementsValue(actual[key], expected[key]);
  }
}

function assertCandidateModuleContract(moduleNamespace) {
  assert.equal(Object.getPrototypeOf(moduleNamespace), null);
  assert.equal(Object.isExtensible(moduleNamespace), false);
  assert.deepEqual(Reflect.ownKeys(moduleNamespace), [
    ...[...EXPECTED_EXPORTS].sort(),
    Symbol.toStringTag,
  ]);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(moduleNamespace, Symbol.toStringTag),
    {
      value: "Module",
      writable: false,
      enumerable: false,
      configurable: false,
    },
  );
  for (const { name, kind, arity } of EXPECTED_EXPORT_MANIFEST) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(moduleNamespace, name), {
      value: moduleNamespace[name],
      writable: true,
      enumerable: true,
      configurable: false,
    });
    if (kind !== "function") continue;
    const value = moduleNamespace[name];
    assert.equal(typeof value, "function");
    assert.equal(value.name, name);
    assert.equal(value.length, arity);
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, "name"), {
      value: name,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, "length"), {
      value: arity,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    const prototype = Object.getOwnPropertyDescriptor(value, "prototype");
    assert.equal(typeof prototype.value, "object");
    assert.equal(Object.getPrototypeOf(prototype.value), Object.prototype);
    assert.deepEqual(
      {
        writable: prototype.writable,
        enumerable: prototype.enumerable,
        configurable: prototype.configurable,
      },
      { writable: true, enumerable: false, configurable: false },
    );
  }
  assert.equal(
    moduleNamespace.CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256,
    EXPECTED_REQUIREMENTS_SHA256,
  );
  const requirements =
    moduleNamespace.CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS;
  assertRequirementsValue(requirements, REQUIREMENTS_ORACLE);
  assert.deepEqual(requirements, REQUIREMENTS_ORACLE);
  assert.equal(semanticSha256(requirements), EXPECTED_REQUIREMENTS_SHA256);
}

function startupDescriptor(
  fd,
  role,
  kind,
  accessMode,
  direction,
  statusFlags,
  currentOffset,
  {
    socketFamily = null,
    socketType = null,
    connected = null,
    lockHeld = null,
  } = {},
) {
  return Object.freeze({
    fd,
    role,
    kind,
    accessMode,
    closeOnExec: false,
    direction,
    statusFlags,
    openFileDescriptionClass: fd,
    byteBinding: "NONE",
    currentOffset,
    socketFamily,
    socketType,
    connected,
    lockHeld,
  });
}

// Independently authored from ADR-0036. These are not read from the candidate
// module or copied out of the normative requirements fixture.
const NORMAL_STARTUP_MAP_GOLDEN = Object.freeze([
  startupDescriptor(
    0,
    "controllerChannel",
    "unix-seqpacket",
    "O_RDWR",
    "BIDIRECTIONAL",
    "NONE",
    null,
    {
      socketFamily: "AF_UNIX",
      socketType: "SOCK_SEQPACKET",
      connected: true,
    },
  ),
  startupDescriptor(
    1,
    "statusWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    2,
    "diagnosticsWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    3,
    "stateRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
    { lockHeld: true },
  ),
  startupDescriptor(
    4,
    "delegatedRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    5,
    "guardianLifetimeCgroup",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    6,
    "epochRead",
    "pipe",
    "O_RDONLY",
    "MANAGER_TO_GUARDIAN",
    "NONE",
    null,
  ),
  startupDescriptor(
    7,
    "supervisorExecutable",
    "regular",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE",
    0,
  ),
]);

const RECOVERY_STARTUP_MAP_GOLDEN = Object.freeze([
  startupDescriptor(
    0,
    "recoveryRequestRead",
    "pipe",
    "O_RDONLY",
    "MANAGER_TO_GUARDIAN",
    "NONE",
    null,
  ),
  startupDescriptor(
    1,
    "statusWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    2,
    "diagnosticsWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    3,
    "stateRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
    { lockHeld: true },
  ),
  startupDescriptor(
    4,
    "delegatedRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    5,
    "recoveryActorLifetimeCgroup",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    6,
    "epochRead",
    "pipe",
    "O_RDONLY",
    "MANAGER_TO_GUARDIAN",
    "NONE",
    null,
  ),
  null,
]);

const RIGHT_ROLES = Object.freeze([
  "childExecutable",
  "childStdin",
  "supervisorSelf",
  "payloadSandboxWorker",
  "payloadProcess",
  "payloadBuildCommand",
  "payloadEvidenceLimits",
  "payloadSessionLimits",
  "payloadTaskFailures",
  "payloadRoutingFeatures",
  "payloadSeccompLauncher",
  "launchArgv",
  "launchEnvironment",
  "childResult",
]);

const ADMISSION_RIGHT_MAP_GOLDEN = Object.freeze(
  RIGHT_ROLES.map((role, index) =>
    Object.freeze({
      index,
      role,
      targetSupervisorFd: index + 4,
      kind: "regular",
      accessMode: index === 13 ? "O_RDWR" : "O_RDONLY",
      closeOnExec: true,
      statusFlags: "O_LARGEFILE",
      openFileDescriptionClass: index + 8,
      byteBinding: "MATCH_LAUNCH_CAPSULE_V3_ROLE",
      currentOffset: 0,
    }),
  ),
);

const ALLOWED_IMPORTS = new Map([
  [
    "./containment-exact-v2.mjs",
    [
      "boundedInteger",
      "canonicalJsonBytes",
      "canonicalJsonLine",
      "copyBoundedBuffer",
      "decodeCanonicalBase64",
      "decodeCanonicalJsonLine",
      "deepFreeze",
      "exactBoolean",
      "exactDigest",
      "exactRecord",
      "frozenCopyOnReadBytes",
      "nullRecord",
      "sha256",
    ],
  ],
  [
    "./containment-guardian-recovery-v1.mjs",
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1",
    ],
  ],
  [
    "./containment-launch-capsule-v3.mjs",
    [
      "CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3",
      "CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3",
      "verifyCandidateContainmentLaunchCapsuleV3",
    ],
  ],
]);

const ALLOWED_AMBIENT_INTRINSICS = Object.freeze([
  "Array",
  "Boolean",
  "Error",
  "Number",
  "Object",
  "Reflect",
  "Set",
  "String",
  "WeakMap",
]);

const FORBIDDEN_SOURCE_IDENTIFIERS = Object.freeze([
  "ArrayBuffer",
  "AsyncFunction",
  "AsyncGeneratorFunction",
  "Atomics",
  "BigInt64Array",
  "BigUint64Array",
  "BroadcastChannel",
  "Buffer",
  "Bun",
  "DataView",
  "Date",
  "Deno",
  "EventSource",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Function",
  "GeneratorFunction",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "JSON",
  "Math",
  "MessageChannel",
  "MessagePort",
  "Promise",
  "Proxy",
  "SharedArrayBuffer",
  "SharedWorker",
  "TextDecoder",
  "TextEncoder",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakRef",
  "WeakSet",
  "WebAssembly",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "__dirname",
  "__filename",
  "__proto__",
  "arguments",
  "atob",
  "btoa",
  "clearImmediate",
  "clearInterval",
  "clearTimeout",
  "console",
  "constructor",
  "crypto",
  "eval",
  "fetch",
  "global",
  "globalThis",
  "module",
  "navigator",
  "performance",
  "process",
  "prototype",
  "queueMicrotask",
  "require",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "structuredClone",
]);

const FORBIDDEN_MEMBER_NAMES = Object.freeze([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "arguments",
  "callee",
  "caller",
  "constructor",
  "prototype",
]);

const FORBIDDEN_EXACT_COMPILE_TIME_STRINGS = new Set(
  [
    ...FORBIDDEN_SOURCE_IDENTIFIERS,
    ...FORBIDDEN_MEMBER_NAMES,
    "OPENROUTER_API_KEY",
    "openrouter",
  ].map((value) => value.toLowerCase()),
);

const FORBIDDEN_COMPILE_TIME_PATH_PREFIXES = Object.freeze([
  "file://",
  "node:",
  "/proc/",
]);

const FORBIDDEN_COMPILE_TIME_PATH_SUFFIXES = Object.freeze([
  "OPENROUTER_API_KEY",
  "candidate-containment-guardian-control-v1.test.mjs",
  "candidate-containment-guardian-control-v1-adversarial.test.mjs",
]);

const ASSIGNMENT_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "^=",
  "|=",
  "&&=",
  "||=",
  "??=",
]);

const PURE_MODULE_INITIALIZER_CALL_ARITIES = new Map([
  ["canonicalJsonBytes", 1],
  ["deepFreeze", 1],
  ["nullRecord", 1],
  ["sha256", 1],
]);

const SOURCE_KEYWORDS = new Set([
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "let",
  "new",
  "null",
  "of",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "typeof",
  "void",
  "while",
]);

const ALLOWED_AMBIENT_MEMBERS = new Map([
  ["Array", new Set(["isArray"])],
  ["Boolean", new Set()],
  ["Error", new Set()],
  ["Number", new Set(["isFinite", "isInteger", "isSafeInteger"])],
  [
    "Object",
    new Set([
      "create",
      "defineProperty",
      "freeze",
      "hasOwn",
      "isExtensible",
      "isFrozen",
    ]),
  ],
  ["Reflect", new Set()],
  ["Set", new Set()],
  ["String", new Set()],
  ["WeakMap", new Set()],
]);

function collectOracleRecordKeys(value, keys = new Set()) {
  if (value === null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const child of value) collectOracleRecordKeys(child, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectOracleRecordKeys(child, keys);
  }
  return keys;
}

function collectOracleSourceLiterals(value, literals = new Set()) {
  if (typeof value === "string") {
    literals.add(value);
    return literals;
  }
  if (value === null || typeof value !== "object") return literals;
  if (Array.isArray(value)) {
    for (const child of value) collectOracleSourceLiterals(child, literals);
    return literals;
  }
  for (const child of Object.values(value)) {
    collectOracleSourceLiterals(child, literals);
  }
  return literals;
}

const PINNED_NORMATIVE_SOURCE_LITERALS = collectOracleSourceLiterals(
  STATIC_POLICY_REQUIREMENTS_ORACLE,
);

const ALLOWED_MEMBER_NAMES = new Set([
  ...collectOracleRecordKeys(STATIC_POLICY_REQUIREMENTS_ORACLE),
  ...Object.values(STATIC_POLICY_REQUIREMENTS_ORACLE.frameFields).flat(),
  "add",
  "artifact",
  "at",
  "binding",
  "byteLength",
  "bytes",
  "files",
  "get",
  "has",
  "identity",
  "includes",
  "initialOffset",
  "length",
  "name",
  "projectionSha256",
  "push",
  "rawSha256",
  "set",
  "sha256",
  "size",
  "slice",
  "value",
]);

const UNTRUSTED_PUBLIC_PARAMETER_NAMES = new Set(
  EXPECTED_FUNCTION_SIGNATURES.flatMap(({ parameters }) => parameters),
);

function lexCandidateSource(source) {
  if (typeof source !== "string") throw new Error("static gate: source");
  const tokens = [];
  let index = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  const fail = (reason) => {
    throw new Error(`static gate: ${reason}`);
  };
  const push = (type, value, start, end) => {
    tokens.push(
      Object.freeze({
        type,
        value,
        raw: source.slice(start, end),
        start,
        end,
        braceDepth,
        parenDepth,
        bracketDepth,
      }),
    );
  };
  const identifierStart = (value) =>
    value !== undefined && /[$_\p{ID_Start}]/u.test(value);
  const identifierPart = (value) =>
    value !== undefined && /[$_\u200c\u200d\p{ID_Continue}]/u.test(value);
  const codePointAt = (position) => {
    if (position >= source.length) return null;
    const value = String.fromCodePoint(source.codePointAt(position));
    return { value, end: position + value.length };
  };
  const unicodeEscapeAt = (position) => {
    if (source[position] !== "\\" || source[position + 1] !== "u") return null;
    let cursor = position + 2;
    let hexadecimal;
    if (source[cursor] === "{") {
      const close = source.indexOf("}", cursor + 1);
      if (close === -1) fail("unterminated Unicode escape");
      hexadecimal = source.slice(cursor + 1, close);
      if (!/^[0-9A-Fa-f]{1,6}$/u.test(hexadecimal)) {
        fail("malformed Unicode escape");
      }
      cursor = close + 1;
    } else {
      hexadecimal = source.slice(cursor, cursor + 4);
      if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) {
        fail("malformed Unicode escape");
      }
      cursor += 4;
    }
    const codePoint = Number.parseInt(hexadecimal, 16);
    if (codePoint > 0x10ffff) fail("Unicode escape outside scalar range");
    return { value: String.fromCodePoint(codePoint), end: cursor };
  };
  const escapedValue = () => {
    if (index >= source.length) fail("unterminated escape");
    const value = source[index++];
    const simple = {
      0: "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (Object.hasOwn(simple, value)) return simple[value];
    if (["\n", "\u2028", "\u2029"].includes(value)) return "";
    if (value === "\r") {
      if (source[index] === "\n") index += 1;
      return "";
    }
    if (value === "x") {
      const hexadecimal = source.slice(index, index + 2);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hexadecimal)) {
        fail("malformed hexadecimal escape");
      }
      index += 2;
      return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    }
    if (value === "u") {
      index -= 2;
      const decoded = unicodeEscapeAt(index);
      index = decoded.end;
      return decoded.value;
    }
    return value;
  };
  const scanString = (quote) => {
    const start = index++;
    let value = "";
    while (index < source.length) {
      const character = source[index++];
      if (character === quote) {
        push("string", value, start, index);
        return;
      }
      if (character === "\n" || character === "\r") {
        fail("unterminated string");
      }
      value += character === "\\" ? escapedValue() : character;
    }
    fail("unterminated string");
  };
  const scanIdentifier = () => {
    const start = index;
    let value = "";
    let first = true;
    while (index < source.length) {
      const escaped = unicodeEscapeAt(index);
      const decoded = escaped ?? codePointAt(index);
      if (decoded === null) break;
      if (
        !(first
          ? identifierStart(decoded.value)
          : identifierPart(decoded.value))
      ) {
        break;
      }
      value += decoded.value;
      index = decoded.end;
      first = false;
    }
    if (first) fail("malformed identifier");
    push("identifier", value, start, index);
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (
        index < source.length &&
        !/[\r\n\u2028\u2029]/u.test(source[index])
      ) {
        index += 1;
      }
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      const end = source.indexOf("*/", index);
      if (end === -1) fail("unterminated comment");
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      scanString(character);
      continue;
    }
    if (character === "`") fail("template literal outside bounded subset");
    const escaped = unicodeEscapeAt(index);
    const codePoint = codePointAt(index);
    if (
      (escaped !== null && identifierStart(escaped.value)) ||
      (codePoint !== null && identifierStart(codePoint.value))
    ) {
      scanIdentifier();
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index++;
      while (/[0-9]/u.test(source[index] ?? "")) index += 1;
      const raw = source.slice(start, index);
      const continuation = codePointAt(index)?.value;
      if (
        !/^(?:0|[1-9][0-9]*)$/u.test(raw) ||
        source[index] === "." ||
        source[index] === "\\" ||
        identifierPart(continuation)
      ) {
        fail("numeric literal outside bounded decimal-integer subset");
      }
      push("number", source.slice(start, index), start, index);
      continue;
    }
    const start = index;
    const four = source.slice(index, index + 4);
    const three = source.slice(index, index + 3);
    const two = source.slice(index, index + 2);
    let punctuator = character;
    if (four === ">>>=") {
      punctuator = four;
    } else if (
      [
        "...",
        "===",
        "!==",
        ">>>",
        "**=",
        "<<=",
        ">>=",
        "&&=",
        "||=",
        "??=",
      ].includes(three)
    ) {
      punctuator = three;
    } else if (
      [
        "=>",
        "++",
        "--",
        "?.",
        "**",
        "&&",
        "||",
        "??",
        "==",
        "!=",
        "<=",
        ">=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "&=",
        "|=",
        "^=",
        "<<",
        ">>",
      ].includes(two)
    ) {
      punctuator = two;
    }
    index += punctuator.length;
    if (punctuator === "{") {
      push("punctuator", punctuator, start, index);
      braceDepth += 1;
    } else if (punctuator === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) fail("unbalanced closing brace");
      push("punctuator", punctuator, start, index);
    } else if (punctuator === "(") {
      push("punctuator", punctuator, start, index);
      parenDepth += 1;
    } else if (punctuator === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) fail("unbalanced closing parenthesis");
      push("punctuator", punctuator, start, index);
    } else if (punctuator === "[") {
      push("punctuator", punctuator, start, index);
      bracketDepth += 1;
    } else if (punctuator === "]") {
      bracketDepth -= 1;
      if (bracketDepth < 0) fail("unbalanced closing bracket");
      push("punctuator", punctuator, start, index);
    } else {
      push("punctuator", punctuator, start, index);
    }
  }
  if (braceDepth !== 0 || parenDepth !== 0 || bracketDepth !== 0) {
    fail("unbalanced source");
  }
  return Object.freeze(tokens);
}

function matchingToken(tokens, openingIndex, opening, closing) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    if (tokens[index].value === closing) depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`static gate: unterminated ${opening}`);
}

function parseExactImports(tokens) {
  const declarations = [];
  const syntaxIndexes = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || token.value !== "import") continue;
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      throw new Error("static gate: nested or dynamic import");
    }
    const expectedEntry = [...ALLOWED_IMPORTS][declarations.length];
    if (expectedEntry === undefined || tokens[index + 1]?.value !== "{") {
      throw new Error("static gate: import form");
    }
    const [expectedSpecifier, expectedNames] = expectedEntry;
    let cursor = index + 2;
    const names = [];
    while (tokens[cursor]?.value !== "}") {
      const imported = tokens[cursor];
      if (imported?.type !== "identifier") {
        throw new Error("static gate: named import");
      }
      names.push(imported.value);
      cursor += 1;
      if (tokens[cursor]?.value === ",") {
        cursor += 1;
      } else if (tokens[cursor]?.value !== "}") {
        throw new Error("static gate: named import separator");
      }
    }
    if (
      tokens[cursor + 1]?.value !== "from" ||
      tokens[cursor + 2]?.type !== "string"
    ) {
      throw new Error("static gate: named import source");
    }
    const specifier = tokens[cursor + 2].value;
    assert.equal(specifier, expectedSpecifier, "static gate: import order");
    assert.deepEqual(names, expectedNames, "static gate: import names");
    for (let covered = index; covered <= cursor + 2; covered += 1) {
      syntaxIndexes.add(covered);
    }
    declarations.push(
      Object.freeze({
        specifier,
        names: Object.freeze(names),
        start: index,
        end: cursor + 2,
      }),
    );
    index = cursor + 2;
  }
  assert.equal(declarations.length, ALLOWED_IMPORTS.size);
  assert.equal(
    declarations.reduce(
      (count, declaration) => count + declaration.names.length,
      0,
    ),
    23,
  );
  return Object.freeze({
    declarations: Object.freeze(declarations),
    syntaxIndexes,
  });
}

function parseExactExports(tokens) {
  const declarations = [];
  const syntaxIndexes = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || token.value !== "export") continue;
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      throw new Error("static gate: nested export");
    }
    const expected = EXPECTED_EXPORT_MANIFEST[declarations.length];
    const kind = tokens[index + 1]?.value;
    const name = tokens[index + 2]?.value;
    if (
      expected === undefined ||
      kind !== expected.kind ||
      name !== expected.name ||
      tokens[index + 2]?.type !== "identifier"
    ) {
      throw new Error("static gate: export inventory");
    }
    syntaxIndexes.add(index);
    syntaxIndexes.add(index + 1);
    syntaxIndexes.add(index + 2);
    if (kind === "function") {
      if (tokens[index + 3]?.value !== "(") {
        throw new Error("static gate: export signature");
      }
      const closing = matchingToken(tokens, index + 3, "(", ")");
      const parameters = [];
      let cursor = index + 4;
      while (cursor < closing) {
        if (tokens[cursor]?.type !== "identifier") {
          throw new Error("static gate: export parameter");
        }
        parameters.push(tokens[cursor].value);
        syntaxIndexes.add(cursor);
        cursor += 1;
        if (cursor < closing) {
          if (tokens[cursor]?.value !== ",") {
            throw new Error("static gate: export parameter separator");
          }
          cursor += 1;
        }
      }
      const signature = EXPECTED_FUNCTION_SIGNATURES.find(
        (candidate) => candidate.name === name,
      );
      assert.deepEqual(parameters, signature.parameters);
      if (tokens[closing + 1]?.value !== "{") {
        throw new Error("static gate: export function body");
      }
      declarations.push(
        Object.freeze({
          name,
          kind,
          arity: parameters.length,
          parameters: Object.freeze(parameters),
          functionIndex: index + 1,
          bodyOpenIndex: closing + 1,
        }),
      );
    } else {
      if (tokens[index + 3]?.value !== "=") {
        throw new Error("static gate: exported const initializer");
      }
      declarations.push(Object.freeze({ name, kind, arity: null }));
    }
  }
  assert.deepEqual(
    declarations.map(({ name, kind, arity }) => ({ name, kind, arity })),
    EXPECTED_EXPORT_MANIFEST,
  );
  return Object.freeze({
    declarations: Object.freeze(declarations),
    syntaxIndexes,
  });
}

function buildLexicalScopes(tokens) {
  const scopes = [{ parent: null, bindings: new Map() }];
  const scopeAt = [];
  const childScopeAtBrace = new Map();
  const stack = [0];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "}") stack.pop();
    if (stack.length === 0) throw new Error("static gate: scope underflow");
    scopeAt[index] = stack.at(-1);
    if (token.value === "{") {
      const child = scopes.length;
      scopes.push({ parent: stack.at(-1), bindings: new Map() });
      childScopeAtBrace.set(index, child);
      stack.push(child);
    }
  }
  if (stack.length !== 1) throw new Error("static gate: scope imbalance");
  return { scopes, scopeAt, childScopeAtBrace };
}

function assertPositiveIdentifierClosure(tokens, imports, exports) {
  const { scopes, scopeAt, childScopeAtBrace } = buildLexicalScopes(tokens);
  const syntaxIndexes = new Set([
    ...imports.syntaxIndexes,
    ...exports.syntaxIndexes,
  ]);
  const protectedBindings = new Set([
    ...ALLOWED_AMBIENT_INTRINSICS,
    ...FORBIDDEN_SOURCE_IDENTIFIERS,
    ...EXPECTED_EXPORTS,
    ...[...ALLOWED_IMPORTS.values()].flat(),
  ]);
  const addBinding = (
    scope,
    name,
    tokenIndex,
    { protectedSeed = false } = {},
  ) => {
    if (!protectedSeed && protectedBindings.has(name)) {
      throw new Error(`static gate: protected binding ${name}`);
    }
    const bindings = scopes[scope].bindings;
    const existing = bindings.get(name);
    if (existing !== undefined && existing !== tokenIndex) {
      throw new Error(`static gate: duplicate binding ${name}`);
    }
    bindings.set(name, tokenIndex);
    syntaxIndexes.add(tokenIndex);
  };
  for (const declaration of imports.declarations) {
    for (const name of declaration.names)
      addBinding(0, name, declaration.start, { protectedSeed: true });
  }
  for (const declaration of exports.declarations) {
    const tokenIndex = tokens.findIndex(
      (token, index) =>
        index >= 0 &&
        token.value === declaration.name &&
        tokens[index - 2]?.value === "export",
    );
    addBinding(0, declaration.name, tokenIndex, { protectedSeed: true });
  }

  const functionBodies = new Map(
    exports.declarations
      .filter(({ kind }) => kind === "function")
      .map((declaration) => [
        declaration.functionIndex,
        declaration.bodyOpenIndex,
      ]),
  );
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "function") continue;
    const previous = tokens[index - 1]?.value;
    if (![undefined, ";", "{", "}", "export"].includes(previous)) {
      throw new Error(
        "static gate: function expression outside bounded subset",
      );
    }
    const nameToken = tokens[index + 1];
    if (nameToken?.type !== "identifier" || tokens[index + 2]?.value !== "(") {
      throw new Error("static gate: function declaration");
    }
    const closing = matchingToken(tokens, index + 2, "(", ")");
    const bodyOpenIndex = closing + 1;
    if (tokens[bodyOpenIndex]?.value !== "{") {
      throw new Error("static gate: function body");
    }
    const bodyScope = childScopeAtBrace.get(bodyOpenIndex);
    if (bodyScope === undefined) throw new Error("static gate: function scope");
    if (!functionBodies.has(index)) {
      addBinding(scopeAt[index], nameToken.value, index + 1);
    }
    syntaxIndexes.add(index);
    syntaxIndexes.add(index + 1);
    let cursor = index + 3;
    while (cursor < closing) {
      const parameter = tokens[cursor];
      if (parameter?.type !== "identifier") {
        throw new Error("static gate: simple parameters required");
      }
      addBinding(bodyScope, parameter.value, cursor);
      cursor += 1;
      if (cursor < closing) {
        if (tokens[cursor]?.value !== ",") {
          throw new Error("static gate: parameter separator");
        }
        cursor += 1;
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const declarationKind = tokens[index].value;
    if (declarationKind === "var") {
      throw new Error("static gate: var outside bounded subset");
    }
    if (!["const", "let"].includes(declarationKind)) continue;
    syntaxIndexes.add(index);
    const nameToken = tokens[index + 1];
    if (nameToken?.type !== "identifier") {
      throw new Error("static gate: simple binding required");
    }
    const forOf =
      tokens[index - 1]?.value === "(" && tokens[index - 2]?.value === "for";
    if (forOf) {
      if (tokens[index + 2]?.value !== "of") {
        throw new Error("static gate: only braced for-of loops are permitted");
      }
      const closing = matchingToken(tokens, index - 1, "(", ")");
      if (tokens[closing + 1]?.value !== "{") {
        throw new Error("static gate: for-of body must be braced");
      }
      addBinding(
        childScopeAtBrace.get(closing + 1),
        nameToken.value,
        index + 1,
      );
      syntaxIndexes.add(index + 2);
      continue;
    }
    if (tokens[index - 1]?.value === "export") {
      continue;
    }
    if (!["=", ";"].includes(tokens[index + 2]?.value)) {
      throw new Error("static gate: one simple declarator per statement");
    }
    addBinding(scopeAt[index], nameToken.value, index + 1);
    const base = tokens[index];
    for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      if (
        token.value === ";" &&
        token.braceDepth === base.braceDepth &&
        token.parenDepth === base.parenDepth &&
        token.bracketDepth === base.bracketDepth
      ) {
        break;
      }
      if (
        token.value === "," &&
        token.braceDepth === base.braceDepth &&
        token.parenDepth === base.parenDepth &&
        token.bracketDepth === base.bracketDepth
      ) {
        throw new Error("static gate: multiple declarators");
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "catch") continue;
    if (
      tokens[index + 1]?.value !== "(" ||
      tokens[index + 2]?.type !== "identifier" ||
      tokens[index + 3]?.value !== ")" ||
      tokens[index + 4]?.value !== "{"
    ) {
      throw new Error("static gate: catch binding");
    }
    addBinding(
      childScopeAtBrace.get(index + 4),
      tokens[index + 2].value,
      index + 2,
    );
    syntaxIndexes.add(index);
  }

  const resolve = (name, startingScope) => {
    let scope = startingScope;
    while (scope !== null) {
      if (scopes[scope].bindings.has(name)) return true;
      scope = scopes[scope].parent;
    }
    return false;
  };
  const forbiddenMembers = new Set(FORBIDDEN_MEMBER_NAMES);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    if (token.raw.includes("\\")) {
      throw new Error("static gate: encoded identifier");
    }
    if (syntaxIndexes.has(index) || SOURCE_KEYWORDS.has(token.value)) continue;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous?.value === ".") {
      if (
        forbiddenMembers.has(token.value) ||
        !ALLOWED_MEMBER_NAMES.has(token.value)
      ) {
        throw new Error(`static gate: forbidden member ${token.value}`);
      }
      const base = tokens[index - 2];
      if (UNTRUSTED_PUBLIC_PARAMETER_NAMES.has(base?.value)) {
        throw new Error(
          `static gate: direct member access on public input ${base.value}`,
        );
      }
      const ambientMembers = ALLOWED_AMBIENT_MEMBERS.get(base?.value);
      if (ambientMembers !== undefined && !ambientMembers.has(token.value)) {
        throw new Error(
          `static gate: ambient member ${base.value}.${token.value}`,
        );
      }
      continue;
    }
    const objectKey =
      ["{", ","].includes(previous?.value) && next?.value === ":";
    if (objectKey) {
      if (forbiddenMembers.has(token.value)) {
        throw new Error(`static gate: forbidden key ${token.value}`);
      }
      continue;
    }
    if (
      !ALLOWED_AMBIENT_INTRINSICS.includes(token.value) &&
      !resolve(token.value, scopeAt[index])
    ) {
      throw new Error(`static gate: free identifier ${token.value}`);
    }
  }
  return Object.freeze({
    scopeCount: scopes.length,
    bindingCount: scopes.reduce(
      (total, scope) => total + scope.bindings.size,
      0,
    ),
  });
}

function assertComputedMembersAreStaticIndexes(tokens) {
  const canEndBase = (token) =>
    token !== undefined &&
    (["identifier", "number", "string"].includes(token.type) ||
      [")", "]", "}"].includes(token.value));
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "[") continue;
    const closing = matchingToken(tokens, index, "[", "]");
    const previous = tokens[index - 1];
    if (
      ["{", ","].includes(previous?.value) &&
      tokens[closing + 1]?.value === ":"
    ) {
      throw new Error("static gate: computed object key");
    }
    if (!canEndBase(previous)) continue;
    const key = tokens.slice(index + 1, closing);
    if (
      key.length !== 1 ||
      key[0].type !== "number" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(key[0].value)
    ) {
      throw new Error("static gate: dynamic computed member");
    }
    index = closing;
  }
}

function decodedCompileTimeStrings(tokens) {
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "string") continue;
    let value = tokens[index].value;
    values.push(value);
    let cursor = index;
    while (
      tokens[cursor + 1]?.value === "+" &&
      tokens[cursor + 2]?.type === "string"
    ) {
      value += tokens[cursor + 2].value;
      values.push(value);
      cursor += 2;
    }
  }
  return values;
}

function assertBoundedSourceSubset(tokens) {
  for (const token of tokens) {
    if (["...", "=>", "++", "--", "?.", "/", "/="].includes(token.value)) {
      throw new Error(`static gate: punctuator ${token.value}`);
    }
    if (
      token.type === "identifier" &&
      [
        "async",
        "await",
        "class",
        "debugger",
        "delete",
        "extends",
        "instanceof",
        "super",
        "this",
        "with",
        "yield",
      ].includes(token.value)
    ) {
      throw new Error(`static gate: syntax ${token.value}`);
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "new") continue;
    if (!["Error", "Set", "WeakMap"].includes(tokens[index + 1]?.value)) {
      throw new Error("static gate: constructor outside bounded subset");
    }
  }
  for (const value of decodedCompileTimeStrings(tokens)) {
    if (PINNED_NORMATIVE_SOURCE_LITERALS.has(value)) continue;
    const normalized = value.toLowerCase();
    const fragment = [...FORBIDDEN_EXACT_COMPILE_TIME_STRINGS].find(
      (candidate) => normalized.includes(candidate),
    );
    if (fragment !== undefined) {
      throw new Error(`static gate: forbidden string fragment ${fragment}`);
    }
    const prefix = FORBIDDEN_COMPILE_TIME_PATH_PREFIXES.find((candidate) =>
      normalized.startsWith(candidate.toLowerCase()),
    );
    if (prefix !== undefined) {
      throw new Error(`static gate: forbidden path prefix ${prefix}`);
    }
    const suffix = FORBIDDEN_COMPILE_TIME_PATH_SUFFIXES.find((candidate) =>
      normalized.endsWith(candidate.toLowerCase()),
    );
    if (suffix !== undefined) {
      throw new Error(`static gate: forbidden path suffix ${suffix}`);
    }
  }
  assertComputedMembersAreStaticIndexes(tokens);
}

function assertExactPrivateStoreManifest(tokens) {
  const stores = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index].value === "const" &&
      tokens[index].braceDepth === 0 &&
      tokens[index].parenDepth === 0 &&
      tokens[index].bracketDepth === 0 &&
      tokens[index + 1]?.type === "identifier" &&
      tokens[index + 2]?.value === "=" &&
      tokens[index + 3]?.value === "new" &&
      tokens[index + 4]?.value === "WeakMap" &&
      tokens[index + 5]?.value === "(" &&
      tokens[index + 6]?.value === ")" &&
      tokens[index + 7]?.value === ";"
    ) {
      stores.push(tokens[index + 1].value);
    }
  }
  assert.deepEqual(stores, [
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  assert.equal(
    tokens.filter(
      (token, index) =>
        token.value === "new" && tokens[index + 1]?.value === "WeakMap",
    ).length,
    3,
  );
  for (const name of stores) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].value !== name) continue;
      if (
        ASSIGNMENT_OPERATORS.has(tokens[index + 1]?.value) ||
        (tokens[index + 1]?.value === "." &&
          ASSIGNMENT_OPERATORS.has(tokens[index + 3]?.value))
      ) {
        const declaration =
          tokens[index - 1]?.value === "const" &&
          tokens[index - 1]?.braceDepth === 0 &&
          tokens[index - 1]?.parenDepth === 0 &&
          tokens[index - 1]?.bracketDepth === 0 &&
          tokens[index + 1]?.value === "=" &&
          tokens[index + 2]?.value === "new";
        if (!declaration) {
          throw new Error(`static gate: private store reassignment ${name}`);
        }
      }
    }
  }
  return Object.freeze(stores);
}

function statementTerminator(tokens, start) {
  const base = tokens[start];
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.value === ";" &&
      token.braceDepth === base.braceDepth &&
      token.parenDepth === base.parenDepth &&
      token.bracketDepth === base.bracketDepth
    ) {
      return index;
    }
  }
  throw new Error("static gate: unterminated module statement");
}

function functionDeclarationEnd(tokens, start) {
  const functionIndex = tokens[start].value === "export" ? start + 1 : start;
  if (
    tokens[functionIndex]?.value !== "function" ||
    tokens[functionIndex + 1]?.type !== "identifier" ||
    tokens[functionIndex + 2]?.value !== "("
  ) {
    throw new Error("static gate: module function declaration");
  }
  const parametersEnd = matchingToken(tokens, functionIndex + 2, "(", ")");
  const bodyStart = parametersEnd + 1;
  if (tokens[bodyStart]?.value !== "{") {
    throw new Error("static gate: module function body");
  }
  return matchingToken(tokens, bodyStart, "{", "}");
}

function assertModuleStatementTopology(tokens) {
  let statementCount = 0;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      throw new Error("static gate: module statement depth");
    }
    if (token.value === ";") {
      index += 1;
      continue;
    }
    if (token.value === "import" || token.value === "const") {
      index = statementTerminator(tokens, index) + 1;
      statementCount += 1;
      continue;
    }
    if (token.value === "function") {
      index = functionDeclarationEnd(tokens, index) + 1;
      statementCount += 1;
      continue;
    }
    if (token.value === "export") {
      if (tokens[index + 1]?.value === "const") {
        index = statementTerminator(tokens, index) + 1;
        statementCount += 1;
        continue;
      }
      if (tokens[index + 1]?.value === "function") {
        index = functionDeclarationEnd(tokens, index) + 1;
        statementCount += 1;
        continue;
      }
    }
    throw new Error(`static gate: module statement ${token.value}`);
  }
  return statementCount;
}

function assertPureModuleInitializer(tokens, start, end, pureBindings) {
  for (let index = start; index < end; index += 1) {
    if (ASSIGNMENT_OPERATORS.has(tokens[index].value)) {
      throw new Error("static gate: assignment in module initializer");
    }
  }

  let cursor = start;
  const result = (immutable, freezable) =>
    Object.freeze({ immutable, freezable });
  const primitiveResult = result(true, true);
  let parseValue;

  const parseDelimitedValues = (closing) => {
    const values = [];
    if (tokens[cursor]?.value === closing) {
      cursor += 1;
      return values;
    }
    while (cursor < end) {
      values.push(parseValue());
      if (tokens[cursor]?.value === closing) {
        cursor += 1;
        return values;
      }
      if (tokens[cursor]?.value !== ",") {
        throw new Error("static gate: pure initializer separator");
      }
      cursor += 1;
      if (tokens[cursor]?.value === closing) {
        cursor += 1;
        return values;
      }
    }
    throw new Error(`static gate: unterminated pure initializer ${closing}`);
  };

  parseValue = () => {
    const token = tokens[cursor];
    if (token === undefined || cursor >= end) {
      throw new Error("static gate: missing pure initializer value");
    }
    if (token.type === "string" || token.type === "number") {
      cursor += 1;
      return primitiveResult;
    }
    if (["false", "null", "true"].includes(token.value)) {
      cursor += 1;
      return primitiveResult;
    }
    if (token.value === "-") {
      if (
        tokens[cursor + 1]?.type !== "number" ||
        tokens[cursor + 1]?.value === "0"
      ) {
        throw new Error("static gate: bounded negative integer");
      }
      cursor += 2;
      return primitiveResult;
    }
    if (token.value === "[") {
      cursor += 1;
      const children = parseDelimitedValues("]");
      return result(
        false,
        children.every(({ freezable }) => freezable),
      );
    }
    if (token.value === "{") {
      cursor += 1;
      const children = [];
      if (tokens[cursor]?.value === "}") {
        cursor += 1;
        return result(false, true);
      }
      while (cursor < end) {
        const key = tokens[cursor];
        if (!["identifier", "number", "string"].includes(key?.type)) {
          throw new Error("static gate: static object key");
        }
        cursor += 1;
        if (tokens[cursor]?.value !== ":") {
          throw new Error("static gate: explicit object value");
        }
        cursor += 1;
        children.push(parseValue());
        if (tokens[cursor]?.value === "}") {
          cursor += 1;
          break;
        }
        if (tokens[cursor]?.value !== ",") {
          throw new Error("static gate: object initializer separator");
        }
        cursor += 1;
        if (tokens[cursor]?.value === "}") {
          cursor += 1;
          break;
        }
      }
      return result(
        false,
        children.every(({ freezable }) => freezable),
      );
    }
    if (token.value === "(") {
      cursor += 1;
      const nested = parseValue();
      if (tokens[cursor]?.value !== ")") {
        throw new Error("static gate: pure initializer parenthesis");
      }
      cursor += 1;
      return nested;
    }
    if (token.type === "identifier") {
      if (tokens[cursor + 1]?.value === "(") {
        const expectedArity = PURE_MODULE_INITIALIZER_CALL_ARITIES.get(
          token.value,
        );
        if (expectedArity === undefined) {
          throw new Error(
            `static gate: module initializer effect call ${token.value}`,
          );
        }
        cursor += 2;
        const parameters = parseDelimitedValues(")");
        if (parameters.length !== expectedArity) {
          throw new Error(`static gate: pure initializer arity ${token.value}`);
        }
        const [parameter] = parameters;
        if (token.value === "deepFreeze") {
          if (!parameter.freezable) {
            throw new Error("static gate: non-freezable deepFreeze input");
          }
          return primitiveResult;
        }
        if (token.value === "canonicalJsonBytes") {
          if (!parameter.freezable) {
            throw new Error("static gate: unsafe canonical JSON input");
          }
          return result(false, false);
        }
        if (token.value === "nullRecord") {
          if (!parameter.freezable) {
            throw new Error("static gate: unsafe null-record input");
          }
          return result(false, true);
        }
        return primitiveResult;
      }
      if (!pureBindings.has(token.value)) {
        throw new Error(`static gate: module initializer alias ${token.value}`);
      }
      cursor += 1;
      return primitiveResult;
    }
    throw new Error(`static gate: impure module initializer ${token.value}`);
  };

  const initializer = parseValue();
  if (cursor !== end) {
    throw new Error("static gate: trailing module initializer syntax");
  }
  if (!initializer.immutable) {
    throw new Error("static gate: mutable module initializer result");
  }
}

function assertModuleInitializationClosure(tokens) {
  assertModuleStatementTopology(tokens);
  const privateStores = new Set([
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  const pureBindings = new Set();
  let checked = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.value !== "const" ||
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      continue;
    }
    const name = tokens[index + 1]?.value;
    const initializer = tokens[index + 3];
    if (
      tokens[index + 1]?.type !== "identifier" ||
      tokens[index + 2]?.value !== "=" ||
      initializer === undefined
    ) {
      throw new Error("static gate: module declaration shape");
    }
    checked += 1;
    const declarationEnd = statementTerminator(tokens, index);
    if (privateStores.has(name)) {
      if (
        initializer.value !== "new" ||
        tokens[index + 4]?.value !== "WeakMap" ||
        tokens[index + 5]?.value !== "(" ||
        tokens[index + 6]?.value !== ")" ||
        declarationEnd !== index + 7
      ) {
        throw new Error("static gate: private store initializer");
      }
      continue;
    }
    assertPureModuleInitializer(
      tokens,
      index + 3,
      declarationEnd,
      pureBindings,
    );
    pureBindings.add(name);
  }
  return checked;
}

function auditCandidateSource(source) {
  const tokens = lexCandidateSource(source);
  assertBoundedSourceSubset(tokens);
  const imports = parseExactImports(tokens);
  const exports = parseExactExports(tokens);
  const privateStores = assertExactPrivateStoreManifest(tokens);
  const moduleStoreCount = assertModuleInitializationClosure(tokens);
  const identifierClosure = assertPositiveIdentifierClosure(
    tokens,
    imports,
    exports,
  );
  return Object.freeze({
    importCount: imports.declarations.length,
    importedNameCount: imports.declarations.reduce(
      (count, declaration) => count + declaration.names.length,
      0,
    ),
    exportCount: exports.declarations.length,
    privateStoreCount: privateStores.length,
    scopeCount: identifierClosure.scopeCount,
    bindingCount: identifierClosure.bindingCount,
    moduleStoreCount,
  });
}

function sourceSkeleton(extra = "") {
  const importText = [...ALLOWED_IMPORTS]
    .map(
      ([specifier, names]) =>
        `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  const exports = EXPECTED_EXPORT_MANIFEST.map((entry, index) => {
    if (entry.kind === "const") return `export const ${entry.name} = ${index};`;
    const signature = EXPECTED_FUNCTION_SIGNATURES.find(
      ({ name }) => name === entry.name,
    );
    return `export function ${entry.name}(${signature.parameters.join(", ")}) { return null; }`;
  }).join("\n");
  return `${importText}\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n${exports}\n${extra}\n`;
}

function sourceWithImportMutation(mutate) {
  const [firstSpecifier, firstNames] = [...ALLOWED_IMPORTS][0];
  const original = `import { ${firstNames.join(", ")} } from ${JSON.stringify(firstSpecifier)};`;
  return sourceSkeleton().replace(original, mutate(original, firstNames));
}

function runStaticNegativeControls() {
  const imports = [
    () => sourceWithImportMutation(() => 'import value from "node:fs";'),
    () =>
      sourceWithImportMutation(
        () => 'import * as exact from "./containment-exact-v2.mjs";',
      ),
    () =>
      sourceWithImportMutation(() => 'import "./containment-exact-v2.mjs";'),
    () =>
      sourceWithImportMutation((original) =>
        original.replace("boundedInteger", "boundedInteger as bounded"),
      ),
    () =>
      sourceWithImportMutation((original) =>
        original.replace("boundedInteger, ", ""),
      ),
    () =>
      sourceWithImportMutation((original) =>
        original.replace("boundedInteger", "boundedInteger, extraHelper"),
      ),
    () =>
      sourceWithImportMutation((original) =>
        original.replace(
          "./containment-exact-v2.mjs",
          "./containment-exact-v1.mjs",
        ),
      ),
    () =>
      `${sourceSkeleton()}\nimport { sha256 } from "./containment-exact-v2.mjs";`,
    () =>
      `${sourceSkeleton()}\nconst late = import("./containment-exact-v2.mjs");`,
    () => `${sourceSkeleton()}\nconst metadata = import.meta;`,
  ];
  const exports = [
    () => `${sourceSkeleton()}\nexport default null;`,
    () => `${sourceSkeleton()}\nexport { sha256 };`,
    () => `${sourceSkeleton()}\nexport * from "./containment-exact-v2.mjs";`,
    () =>
      sourceSkeleton().replace(
        "export function createCandidateContainmentGuardianStartupV1(",
        "export const createCandidateContainmentGuardianStartupV1 = function(",
      ),
    () =>
      sourceSkeleton().replace(
        "startupReportBytes, epochBytes, epochEofObserved",
        "startupReportBytes, epochBytes",
      ),
    () =>
      sourceSkeleton().replace(
        "startupReportBytes, epochBytes, epochEofObserved",
        "startupReportBytes, epochBytes, observedEof",
      ),
    () =>
      sourceSkeleton().replace(
        "startupReportBytes, epochBytes, epochEofObserved",
        "startupReportBytes, epochBytes, epochEofObserved = true",
      ),
  ];
  const authorityAndGadgets = [
    "const escaped = pr\\u006fcess;",
    "const direct = process;",
    "function hidden() { const local = null; } const leaked = local;",
    "{ const sibling = null; } const leaked = sibling;",
    "function process() { return null; }",
    "const gadget = value.constructor;",
    'const gadget = value["constructor"];',
    'const gadget = value["con" + "structor"];',
    "const gadget = Reflect.construct;",
    "const delayed = setTimeout;",
    "const callback = new Function();",
    "const proxied = new Proxy();",
    "const weak = new WeakSet();",
    "const metadata = globalThis.process;",
    "const worker = new Worker();",
    "const dynamic = value[key];",
    "const spread = [...value];",
    "const arrow = () => null;",
    "const expression = function named() { return null; };",
    "class Hidden {}",
    "async function hidden() { return null; }",
    'const path = "node:" + "fs";',
    'const testPath = "candidate-containment-guardian-control-v1.test.mjs";',
    'const hostPath = "/proc/self/fd";',
    "const regularExpression = /^[a-z]+$/u;",
    "const template = `static text`;",
  ];
  const stores = [
    sourceSkeleton().replace("const startupMetadata", "let startupMetadata"),
    sourceSkeleton().replace("startupMetadata", "startupMetadataWrong"),
    sourceSkeleton().replace(
      "const stateMetadata = new WeakMap();",
      "const stateMetadata = new WeakMap();\nconst extraMetadata = new WeakMap();",
    ),
    `${sourceSkeleton()}\nstartupMetadata = stateMetadata;`,
    sourceSkeleton("const permissionStore = new Set();"),
    sourceSkeleton("const mutableArray = [];"),
    sourceSkeleton("const mutableRecord = {};"),
    sourceSkeleton("let mutableSession = null;"),
    sourceSkeleton("const frozenSet = deepFreeze(new Set());"),
    sourceSkeleton("function populate() { return null; } populate();"),
  ];
  const namedStaticGateEscapes = Object.freeze([
    Object.freeze({
      name: "nested private-store set call",
      source: sourceSkeleton(
        "const stable = deepFreeze([startupMetadata.set(null, null)]);",
      ),
    }),
    Object.freeze({
      name: "nested member assignment",
      source: sourceSkeleton(
        "const permissionStore = deepFreeze([]);\nconst stable = deepFreeze([permissionStore.set = null]);",
      ),
    }),
    Object.freeze({
      name: "bare-block private-store declarations",
      source: sourceSkeleton().replace(
        "const startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();",
        "{\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n}",
      ),
    }),
    Object.freeze({
      name: "nested compound member assignment",
      source: sourceSkeleton(
        "const permissionStore = deepFreeze([]);\nconst stable = deepFreeze([permissionStore.set += 1]);",
      ),
    }),
    Object.freeze({
      name: "private-store frozen alias",
      source: sourceSkeleton("const stable = deepFreeze([startupMetadata]);"),
    }),
    Object.freeze({
      name: "imported-function frozen alias",
      source: sourceSkeleton("const stable = deepFreeze([sha256]);"),
    }),
    Object.freeze({
      name: "deepFreeze retains mutable canonical bytes",
      source: sourceSkeleton(
        'const stable = deepFreeze(canonicalJsonBytes("safe"));',
      ),
      expected: /non-freezable deepFreeze input/u,
    }),
    Object.freeze({
      name: "fixture key is not a normative string-value exception",
      source: sourceSkeleton(`
function deriveAuthorityKey() {
  return "processAuthority".slice(0, 7);
}`),
      expected: /forbidden string fragment process/u,
    }),
    Object.freeze({
      name: "numeric member-chain authority gadget",
      source: sourceSkeleton(
        'const stable = deepFreeze([0..constructor.constructor("return pro" + ("cess"))()]);',
      ),
      expected: /numeric literal outside bounded decimal-integer subset/u,
    }),
    Object.freeze({
      name: "parenthesized top-level invocation",
      source: sourceSkeleton(
        "function moduleEffect() { return null; }\n(moduleEffect)();",
      ),
      expected: /module statement \(/u,
    }),
    Object.freeze({
      name: "parenthesized private-store method invocation",
      source: sourceSkeleton("(startupMetadata.set)(nullRecord([]), null);"),
      expected: /module statement \(/u,
    }),
    Object.freeze({
      name: "non-normative substring Reflect authority gadget",
      source: sourceSkeleton(`
function reflectedAuthority(startupReportBytes) {
  const mirror = Reflect;
  const key = "xconstructor".slice(1);
  const first = mirror.get(startupReportBytes, key);
  const second = mirror.get(first, key);
  const source = "xreturn process".slice(1);
  return second(source)();
}`),
      expected: /forbidden string fragment constructor/u,
    }),
    Object.freeze({
      name: "U+2028 line-comment import smuggling",
      source: sourceSkeleton(
        '// audit comment\u2028import fs from "node:fs"; fs.readFileSync("/proc/self/status");',
      ),
      expected: /forbidden path prefix node:/u,
    }),
    Object.freeze({
      name: "U+2029 line-comment import smuggling",
      source: sourceSkeleton(
        '// audit comment\u2029import fs from "node:fs"; fs.readFileSync("/proc/self/status");',
      ),
      expected: /forbidden path prefix node:/u,
    }),
    Object.freeze({
      name: "U+2028 string-continuation authority spelling",
      source: sourceSkeleton(
        `const forbidden = "pro\\${String.fromCodePoint(0x2028)}cess";`,
      ),
      expected: /forbidden string fragment process/u,
    }),
    Object.freeze({
      name: "U+2029 string-continuation authority spelling",
      source: sourceSkeleton(
        `const forbidden = "pro\\${String.fromCodePoint(0x2029)}cess";`,
      ),
      expected: /forbidden string fragment process/u,
    }),
  ]);
  const sources = [
    ...imports.map((create) => create()),
    ...exports.map((create) => create()),
    ...authorityAndGadgets.map((body) => sourceSkeleton(body)),
    ...stores,
  ];
  let evaluationAttempts = 0;
  for (const source of sources) {
    assert.throws(() => {
      auditCandidateSource(source);
      evaluationAttempts += 1;
    });
  }
  const namedRejected = [];
  for (const { name, source, expected } of namedStaticGateEscapes) {
    assert.throws(
      () => {
        auditCandidateSource(source);
        evaluationAttempts += 1;
      },
      expected,
      `static policy control: ${name}`,
    );
    namedRejected.push(name);
  }
  assert.equal(evaluationAttempts, 0);
  const requiredNormativeLiterals = Object.freeze([
    "Array",
    "Set",
    "String",
    "WeakMap",
    "currentOffset",
    "oxigraph.candidate-containment-guardian-control-requirements/v1",
    EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY,
  ]);
  for (const value of requiredNormativeLiterals) {
    assert.equal(PINNED_NORMATIVE_SOURCE_LITERALS.has(value), true, value);
  }
  const positiveSources = [
    sourceSkeleton(),
    sourceSkeleton(
      "function localHelper(value) { const localValue = value; return localValue; }",
    ),
    sourceSkeleton(
      "function select(values) { for (const value of values) { if (value) { return value; } } return null; }",
    ),
    sourceSkeleton("const frozenLocalTable = deepFreeze([]);"),
    sourceSkeleton(
      `const pinnedNormativeLiterals = deepFreeze(${JSON.stringify(requiredNormativeLiterals)});`,
    ),
    sourceSkeleton(
      'const localRequirements = deepFreeze(nullRecord([["schema", "safe"]]));\nconst localDigest = sha256(canonicalJsonBytes(localRequirements));',
    ),
    sourceSkeleton(
      "const unquotedNormativeObjectKey = deepFreeze({ processAuthority: false });",
    ),
  ];
  for (const source of positiveSources) {
    assert.doesNotThrow(() => auditCandidateSource(source));
  }
  return Object.freeze({
    rejected: sources.length + namedRejected.length,
    namedRejected: Object.freeze(namedRejected),
    accepted: positiveSources.length,
    namedAccepted: Object.freeze([
      "pinned normative source literals",
      "pure requirements and ephemeral canonical digest initializers",
      "unquoted normative object key",
    ]),
    evaluationAttempts,
  });
}

function evaluateCandidateOnlyWhenEvaluatorCloses(source, evaluate) {
  if (source !== null) {
    auditCandidateSource(source);
    throw new Error(
      "candidate evaluation disabled until the complete evaluator matrix is executable and receiver-origin; ambient-binding/alias/member-write, computed-key, and indirect-call; path-sensitive normative key-literal representation; module/import/export-binding-write; and private-store commit-position closure are proved",
    );
  }
  return evaluate();
}

function isExpectedAbsentCandidateModuleError(error, candidateSourceText) {
  if (candidateSourceText !== null || error?.code !== "ERR_MODULE_NOT_FOUND") {
    return false;
  }
  if (error.url !== undefined) return error.url === SOURCE_URL.href;
  return error.message === NODE_20_0_MISSING_CANDIDATE_MESSAGE;
}

function pinPredecessorSourcesBeforeCandidateRead() {
  const fixturePins = new Map(
    [
      ...STATIC_POLICY_REQUIREMENTS_ORACLE.predecessors.direct,
      ...STATIC_POLICY_REQUIREMENTS_ORACLE.predecessors.evidenceOnly,
    ].map(({ specifier, sha256: expectedSha256 }) => [
      specifier,
      expectedSha256,
    ]),
  );
  assert.equal(fixturePins.size, PREDECESSOR_SOURCE_GOLDENS.length);
  let directCount = 0;
  let evidenceOnlyCount = 0;
  for (const golden of PREDECESSOR_SOURCE_GOLDENS) {
    const bytes = readFileSync(
      new URL(`../src/candidate/${golden.specifier.slice(2)}`, import.meta.url),
    );
    assertPinnedPredecessorBytes(bytes, golden);
    assert.equal(fixturePins.get(golden.specifier), golden.sha256);
    if (golden.kind === "direct") directCount += 1;
    else if (golden.kind === "evidenceOnly") evidenceOnlyCount += 1;
    else throw new Error(`unknown predecessor kind: ${golden.kind}`);
  }
  return Object.freeze({
    completedBeforeCandidateRead: true,
    directCount,
    evidenceOnlyCount,
    sourceCount: PREDECESSOR_SOURCE_GOLDENS.length,
  });
}

const SYNCHRONOUS_PREDECESSOR_AUDIT =
  pinPredecessorSourcesBeforeCandidateRead();
const STATIC_NEGATIVE_CONTROLS = runStaticNegativeControls();

let candidate = null;
let candidateImportError = null;
let candidateSourceGateError = null;
let sourceText = null;
try {
  sourceText = readFileSync(SOURCE_PATH, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
try {
  candidate = await evaluateCandidateOnlyWhenEvaluatorCloses(
    sourceText,
    () => import(SOURCE_URL.href),
  );
} catch (error) {
  if (sourceText !== null) {
    candidateSourceGateError = error;
  } else if (isExpectedAbsentCandidateModuleError(error, sourceText)) {
    candidateImportError = error;
  } else {
    throw error;
  }
}

test("independently canonicalizes the normative requirements fixture", () => {
  assert.equal(
    semanticSha256(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.schema,
    "oxigraph.candidate-containment-guardian-control-requirements/v1",
  );
  assert.equal(REQUIREMENTS_ORACLE.version, 1);
  assert.equal(
    REQUIREMENTS_ORACLE.vocabularies.byteCarrierAdditionalOwnPropertyPolicy,
    EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.predecessors.direct.length,
    ALLOWED_IMPORTS.size,
  );
  assert.deepEqual(
    Object.keys(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_TOP_LEVEL_FIELDS,
  );
  assert.deepEqual(REQUIREMENTS_ORACLE.modes, ["NORMAL", "RECOVERY_ONLY"]);
  assert.deepEqual(REQUIREMENTS_ORACLE.privateStateStores, [
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  assert.deepEqual(
    REQUIREMENTS_ORACLE.vocabularies.ambientIntrinsics,
    ALLOWED_AMBIENT_INTRINSICS,
  );
  assert.deepEqual(REQUIREMENTS_ORACLE.authority, {
    transportAuthority: false,
    descriptorAuthority: false,
    filesystemAuthority: false,
    cgroupAuthority: false,
    processAuthority: false,
    recoveryAuthority: false,
    runtimeAuthority: false,
  });
  assert.deepEqual(REQUIREMENTS_ORACLE.physicalFacts, {
    socketTransfer: null,
    descriptorInventory: null,
    epochOrigin: null,
    guardianExecution: null,
    recoveryExecution: null,
    cleanup: null,
  });
  assert.deepEqual(
    REQUIREMENTS_ORACLE.predecessors.direct.map(
      ({ specifier, sha256, requirementsSha256, imports }) => ({
        specifier,
        sha256,
        requirementsSha256,
        imports,
      }),
    ),
    [
      {
        specifier: "./containment-exact-v2.mjs",
        sha256:
          "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
        requirementsSha256: null,
        imports: ALLOWED_IMPORTS.get("./containment-exact-v2.mjs"),
      },
      {
        specifier: "./containment-guardian-recovery-v1.mjs",
        sha256:
          "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
        requirementsSha256:
          "278031a43b331036e6c849f796d480e7fe680219d07bdb5b30185668a9337c5a",
        imports: ALLOWED_IMPORTS.get("./containment-guardian-recovery-v1.mjs"),
      },
      {
        specifier: "./containment-launch-capsule-v3.mjs",
        sha256:
          "9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d",
        requirementsSha256:
          "4432b3334ff07b847f1ee8abe49c184df5c993545c21f405ccc1247ecb20604a",
        imports: ALLOWED_IMPORTS.get("./containment-launch-capsule-v3.mjs"),
      },
    ],
  );
});

test("reconstructs all three map digests from separately authored goldens", () => {
  assert.equal(
    semanticSha256(NORMAL_STARTUP_MAP_GOLDEN),
    EXPECTED_NORMAL_MAP_SHA256,
  );
  assert.equal(
    semanticSha256(RECOVERY_STARTUP_MAP_GOLDEN),
    EXPECTED_RECOVERY_MAP_SHA256,
  );
  assert.equal(
    semanticSha256(ADMISSION_RIGHT_MAP_GOLDEN),
    EXPECTED_RIGHT_MAP_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.startupMaps.normalSha256,
    EXPECTED_NORMAL_MAP_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.startupMaps.recoveryOnlySha256,
    EXPECTED_RECOVERY_MAP_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.admissionRights.sha256,
    EXPECTED_RIGHT_MAP_SHA256,
  );
});

test("pins all predecessor bytes and rejects independent drift mutations", () => {
  assert.deepEqual(SYNCHRONOUS_PREDECESSOR_AUDIT, {
    completedBeforeCandidateRead: true,
    directCount: 3,
    evidenceOnlyCount: 2,
    sourceCount: 5,
  });
  const fixturePins = new Map(
    [
      ...REQUIREMENTS_ORACLE.predecessors.direct,
      ...REQUIREMENTS_ORACLE.predecessors.evidenceOnly,
    ].map(({ specifier, sha256 }) => [specifier, sha256]),
  );
  assert.equal(PREDECESSOR_SOURCE_GOLDENS.length, 5);
  assert.equal(
    PREDECESSOR_SOURCE_GOLDENS.filter(({ kind }) => kind === "direct").length,
    3,
  );
  assert.equal(
    PREDECESSOR_SOURCE_GOLDENS.filter(({ kind }) => kind === "evidenceOnly")
      .length,
    2,
  );
  let rejectedMutations = 0;
  for (const golden of PREDECESSOR_SOURCE_GOLDENS) {
    const bytes = readFileSync(
      new URL(`../src/candidate/${golden.specifier.slice(2)}`, import.meta.url),
    );
    assert.doesNotThrow(() => assertPinnedPredecessorBytes(bytes, golden));
    assert.equal(
      fixturePins.get(golden.specifier),
      golden.sha256,
      golden.specifier,
    );
    for (const mutated of predecessorByteMutations(bytes)) {
      assert.throws(
        () => assertPinnedPredecessorBytes(mutated, golden),
        /predecessor source pin mismatch/gu,
      );
      rejectedMutations += 1;
    }
  }
  assert.equal(rejectedMutations, 25);
});

test("freezes the evaluator expansion-count anchors without claiming coverage", () => {
  assert.equal(EXPECTED_EXPORTS.length, EXPANSION_ANCHORS.namedExports);
  assert.deepEqual(EXPANSION_ANCHORS.completeSequenceWireFrameCounts, {
    N1: 4,
    N2: 6,
    N3: 3,
    N4: 5,
    N5a: 2,
    N5b: 4,
    R1: 3,
    R2: 3,
  });
  assert.deepEqual(EXPANSION_ANCHORS.terminalEventCounts, {
    N1: 5,
    N2: 7,
    N3: 5,
    N4: 7,
    N5a: 4,
    N5b: 6,
    R1: 5,
    R2: 5,
  });
});

test("rejects static-policy negative controls before any evaluation attempt", () => {
  assert.deepEqual(STATIC_NEGATIVE_CONTROLS, {
    rejected: 69,
    namedRejected: [
      "nested private-store set call",
      "nested member assignment",
      "bare-block private-store declarations",
      "nested compound member assignment",
      "private-store frozen alias",
      "imported-function frozen alias",
      "deepFreeze retains mutable canonical bytes",
      "fixture key is not a normative string-value exception",
      "numeric member-chain authority gadget",
      "parenthesized top-level invocation",
      "parenthesized private-store method invocation",
      "non-normative substring Reflect authority gadget",
      "U+2028 line-comment import smuggling",
      "U+2029 line-comment import smuggling",
      "U+2028 string-continuation authority spelling",
      "U+2029 string-continuation authority spelling",
    ],
    accepted: 7,
    namedAccepted: [
      "pinned normative source literals",
      "pure requirements and ephemeral canonical digest initializers",
      "unquoted normative object key",
    ],
    evaluationAttempts: 0,
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(auditCandidateSource(sourceSkeleton())).filter(([key]) =>
        [
          "importCount",
          "importedNameCount",
          "exportCount",
          "privateStoreCount",
        ].includes(key),
      ),
    ),
    {
      importCount: 3,
      importedNameCount: 23,
      exportCount: 13,
      privateStoreCount: 3,
    },
  );
  let sourcePresentEvaluationAttempts = 0;
  assert.throws(
    () =>
      evaluateCandidateOnlyWhenEvaluatorCloses(sourceSkeleton(), () => {
        sourcePresentEvaluationAttempts += 1;
      }),
    /evaluation disabled until the complete evaluator matrix is executable/gu,
  );
  assert.equal(sourcePresentEvaluationAttempts, 0);
});

test("recognizes only exact absent-candidate module-load failures", () => {
  const urlShape = Object.freeze({
    code: "ERR_MODULE_NOT_FOUND",
    message: "URL-bearing runtimes use the authoritative URL field",
    url: SOURCE_URL.href,
  });
  const node20Shape = Object.freeze({
    code: "ERR_MODULE_NOT_FOUND",
    message: NODE_20_0_MISSING_CANDIDATE_MESSAGE,
  });
  assert.equal(isExpectedAbsentCandidateModuleError(urlShape, null), true);
  assert.equal(isExpectedAbsentCandidateModuleError(node20Shape, null), true);

  const negativeControls = Object.freeze([
    Object.freeze({
      name: "source text is present",
      error: urlShape,
      sourceText: "export const present = true;",
    }),
    Object.freeze({
      name: "wrong error code",
      error: Object.freeze({
        ...node20Shape,
        code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong candidate path",
      error: Object.freeze({
        ...node20Shape,
        message: `Cannot find module '${SOURCE_PATH}.other' imported from ${EVALUATOR_PATH}`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong importer",
      error: Object.freeze({
        ...node20Shape,
        message: `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}.other`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong message",
      error: Object.freeze({
        ...node20Shape,
        message: `Cannot load module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "message suffix",
      error: Object.freeze({
        ...node20Shape,
        message: `${NODE_20_0_MISSING_CANDIDATE_MESSAGE}\nextra`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong URL",
      error: Object.freeze({ ...urlShape, url: `${SOURCE_URL.href}.other` }),
      sourceText: null,
    }),
    Object.freeze({
      name: "non-undefined URL cannot use the message fallback",
      error: Object.freeze({ ...node20Shape, url: null }),
      sourceText: null,
    }),
  ]);
  for (const {
    name,
    error,
    sourceText: syntheticSourceText,
  } of negativeControls) {
    assert.equal(
      isExpectedAbsentCandidateModuleError(error, syntheticSourceText),
      false,
      name,
    );
  }
  assert.equal(negativeControls.length, 8);
});

test("loads the candidate once and freezes its exact module contract", () => {
  if (candidateSourceGateError !== null) throw candidateSourceGateError;
  if (candidateImportError !== null) throw candidateImportError;
  assert.notEqual(candidate, null);
  assertCandidateModuleContract(candidate);
});

test(
  "expand 20 exact whole-transition and state goldens",
  { todo: true },
  () => {},
);
test(
  "expand 15 independently encoded emitted-status byte goldens",
  { todo: true },
  () => {},
);
test(
  "expand 4 atomic two-status internal wire-prefix controls",
  { todo: true },
  () => {},
);
test(
  "expand every proper prefix and mutation of N1 through R2",
  { todo: true },
  () => {},
);
test(
  "close receiver-origin and alias dataflow; ambient binding, alias, and member writes, computed-key construction, and indirect calls; path-sensitive normative key-literal representation; module/import/export binding and member writes; and private-store owning-operation commit-position proof before lifting the source-presence stop",
  { todo: true },
  () => {},
);
test(
  "complete all remaining ADR-0036 acceptance groups: 252 descriptor aliases; every bound, error-precedence rule, and frame field; transition, status-byte, and prefix goldens; recovery binding; WeakMap failure atomicity; and the complete Node 20 and non-G1.7 matrix",
  { todo: true },
  () => {},
);
