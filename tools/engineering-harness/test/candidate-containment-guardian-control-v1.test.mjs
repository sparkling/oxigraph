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

const FORBIDDEN_SOURCE_TOKENS = Object.freeze([
  "Buffer",
  "Date",
  "JSON",
  "Promise",
  "Proxy",
  "WeakSet",
  "WebAssembly",
  "__proto__",
  "constructor",
  "eval",
  "fetch",
  "globalThis",
  "process",
  "prototype",
  "queueMicrotask",
  "require",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);

function stripCommentsAndStrings(source) {
  let output = "";
  for (let index = 0; index < source.length;) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      const stop = end === -1 ? source.length : end;
      output += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (current === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("static gate: unterminated comment");
      const stop = end + 2;
      output += source.slice(index, stop).replace(/[^\n]/gu, " ");
      index = stop;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      const quote = current;
      let stop = index + 1;
      for (; stop < source.length; stop += 1) {
        if (source[stop] === "\\") {
          stop += 1;
          continue;
        }
        if (source[stop] === quote) {
          stop += 1;
          break;
        }
      }
      if (stop > source.length || source[stop - 1] !== quote) {
        throw new Error("static gate: unterminated string");
      }
      output += source.slice(index, stop).replace(/[^\n]/gu, " ");
      index = stop;
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

function auditCandidateSource(source) {
  if (typeof source !== "string") throw new Error("static gate: source");
  const imports = [];
  const importPattern =
    /(^|\n)\s*import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\3\s*;?/gu;
  for (const match of source.matchAll(importPattern)) {
    const names = match[2]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    imports.push({ specifier: match[4], names });
  }
  const masked = stripCommentsAndStrings(source);
  const importTokenCount = masked.match(/\bimport\b/gu)?.length ?? 0;
  if (imports.length !== importTokenCount) {
    throw new Error("static gate: non-static or malformed import");
  }
  if (/\bexport\s+(?:\*|\{[^}]*\})\s+from\b/gu.test(masked)) {
    throw new Error("static gate: re-export");
  }
  if (/\\u(?:\{|[0-9a-fA-F]{4})/gu.test(masked)) {
    throw new Error("static gate: encoded identifier");
  }
  assert.equal(imports.length, ALLOWED_IMPORTS.size);
  const seen = new Set();
  for (const { specifier, names } of imports) {
    const expected = ALLOWED_IMPORTS.get(specifier);
    if (expected === undefined || seen.has(specifier)) {
      throw new Error("static gate: import specifier");
    }
    seen.add(specifier);
    if (names.some((name) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name))) {
      throw new Error("static gate: aliased or malformed named import");
    }
    assert.deepEqual(names, expected);
  }
  for (const token of FORBIDDEN_SOURCE_TOKENS) {
    const pattern = new RegExp(`\\b${token}\\b`, "u");
    if (pattern.test(masked)) throw new Error(`static gate: ${token}`);
  }
  const weakMaps = [
    ...masked.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*new\s+WeakMap\s*\(\s*\)/gu,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(weakMaps, [
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  const exported = [
    ...masked.matchAll(
      /\bexport\s+(?:const|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(exported.sort(), [...EXPECTED_EXPORTS].sort());
  return Object.freeze({
    importCount: imports.length,
    exportCount: exported.length,
    privateStoreCount: weakMaps.length,
  });
}

function sourceSkeleton(extra = "") {
  const importText = [...ALLOWED_IMPORTS]
    .map(
      ([specifier, names]) =>
        `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  const exports = EXPECTED_EXPORTS.map((name, index) =>
    index < 2
      ? `export const ${name} = ${index};`
      : `export function ${name}() { return null; }`,
  ).join("\n");
  return `${importText}\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n${exports}\n${extra}\n`;
}

function runStaticNegativeControls() {
  const mutations = [
    'import fs from "node:fs";',
    'import * as exact from "./containment-exact-v2.mjs";',
    'import "./containment-exact-v2.mjs";',
    'export * from "./containment-exact-v2.mjs";',
    'const late = import("./containment-exact-v2.mjs");',
    "const metadata = import.meta.url;",
    "const delayed = setTimeout;",
    "const escaped = pr\\u006fcess;",
    "const gadget = value.constructor;",
    "const forbidden = new WeakSet();",
  ];
  let evaluationAttempts = 0;
  for (const mutation of mutations) {
    assert.throws(() => {
      auditCandidateSource(sourceSkeleton(mutation));
      evaluationAttempts += 1;
    });
  }
  assert.equal(evaluationAttempts, 0);
  assert.doesNotThrow(() => auditCandidateSource(sourceSkeleton()));
  return Object.freeze({ rejected: mutations.length, evaluationAttempts });
}

function evaluateCandidateOnlyWhenSourceAbsent(source, evaluate) {
  if (source !== null) {
    throw new Error(
      "candidate evaluation disabled until exhaustive positive-allowlist parser closure is implemented",
    );
  }
  return evaluate();
}

const STATIC_NEGATIVE_CONTROLS = runStaticNegativeControls();
const REQUIREMENTS_ORACLE = JSON.parse(readFileSync(REQUIREMENTS_URL, "utf8"));

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
  candidate = await evaluateCandidateOnlyWhenSourceAbsent(
    sourceText,
    () => import(SOURCE_URL.href),
  );
} catch (error) {
  if (sourceText !== null) {
    candidateSourceGateError = error;
  } else if (
    error?.code === "ERR_MODULE_NOT_FOUND" &&
    error?.url === SOURCE_URL.href
  ) {
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

test("pins all direct and evidence-only predecessor source bytes independently", () => {
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
  for (const golden of PREDECESSOR_SOURCE_GOLDENS) {
    const bytes = readFileSync(
      new URL(`../src/candidate/${golden.specifier.slice(2)}`, import.meta.url),
    );
    assert.equal(bytes.length, golden.byteLength, golden.specifier);
    assert.equal(byteSha256(bytes), golden.sha256, golden.specifier);
    assert.equal(
      fixturePins.get(golden.specifier),
      golden.sha256,
      golden.specifier,
    );
  }
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
    rejected: 10,
    evaluationAttempts: 0,
  });
  let sourcePresentEvaluationAttempts = 0;
  assert.throws(
    () =>
      evaluateCandidateOnlyWhenSourceAbsent(sourceSkeleton(), () => {
        sourcePresentEvaluationAttempts += 1;
      }),
    /evaluation disabled until exhaustive positive-allowlist parser closure/gu,
  );
  assert.equal(sourcePresentEvaluationAttempts, 0);
});

test("reports the absent production module only through the controlled import", () => {
  if (candidateSourceGateError !== null) throw candidateSourceGateError;
  if (candidateImportError !== null) throw candidateImportError;
  assert.notEqual(candidate, null);
  assert.deepEqual(Object.keys(candidate).sort(), [...EXPECTED_EXPORTS].sort());
});

test.todo("expand 20 exact whole-transition and state goldens");
test.todo("expand 15 independently encoded emitted-status byte goldens");
test.todo("expand 4 atomic two-status internal wire-prefix controls");
test.todo("expand every proper prefix and mutation of N1 through R2");
test.todo(
  "replace the fail-closed source-presence stop with exhaustive positive-allowlist parser closure for free identifiers, imports, exports, encoded identifiers, computed access, ambient authority, and test-gaming paths",
);
test.todo(
  "complete all remaining ADR-0036 acceptance groups: 252 descriptor aliases; every bound, error-precedence rule, and frame field; predecessor-drift mutations; the full static gate; export arities and descriptors; transition, status-byte, and prefix goldens; recovery binding; WeakMap failure atomicity; and the complete Node 20 and non-G1.7 matrix",
);
