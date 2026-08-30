import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { copyBoundedBuffer } from "../src/candidate/containment-exact-v2.mjs";

const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-control-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const REQUIREMENTS_URL = new URL(
  "../../../docs/adr/fixtures/0036-guardian-control-requirements-v1.json",
  import.meta.url,
);
const EXACT_V2_URL = new URL(
  "../src/candidate/containment-exact-v2.mjs",
  import.meta.url,
);
const EXPECTED_REQUIREMENTS_SHA256 =
  "0f244f7242eb40a615245a5eda77d5380e368f43a8382f27b3cdb5c1a387e499";
const EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY =
  "additional-non-index-string-and-symbol-properties-ignored-without-enumeration-inspection-read-write-or-invocation;own-length-rejected;semantics-derived-only-from-immediate-intrinsic-copy-of-indexed-bytes/v1";

const BYTE_POSITION_SPECS = Object.freeze([
  Object.freeze({
    name: "startupReportBytes",
    minimumBytes: 0,
    maximumBytes: 8_192,
  }),
  Object.freeze({
    name: "epochBytes",
    minimumBytes: 32,
    maximumBytes: 32,
  }),
  Object.freeze({
    name: "admissionFrameBytes",
    minimumBytes: 0,
    maximumBytes: 131_072,
  }),
  Object.freeze({
    name: "recvmsgReportBytes",
    minimumBytes: 0,
    maximumBytes: 16_384,
  }),
  Object.freeze({
    name: "cancelFrameBytes",
    minimumBytes: 0,
    maximumBytes: 4_096,
  }),
  Object.freeze({
    name: "recoveryRequestFrameBytes",
    minimumBytes: 0,
    maximumBytes: 32_768,
  }),
  Object.freeze({
    name: "diagnosticSummaryReportBytes",
    minimumBytes: 0,
    maximumBytes: 1_024,
  }),
  Object.freeze({
    name: "rawDiagnosticBytes",
    minimumBytes: 0,
    maximumBytes: 16_384,
  }),
  Object.freeze({
    name: "statusFrameBytes",
    minimumBytes: 0,
    maximumBytes: 8_192,
  }),
]);

const BYTE_POSITIONS = Object.freeze(
  BYTE_POSITION_SPECS.map(({ name }) => name),
);

const PRIVATE_STORE_COMMIT_CONTROL_PLAN = Object.freeze([
  Object.freeze({
    store: "startupMetadata",
    operations: Object.freeze(["createCandidateContainmentGuardianStartupV1"]),
    earlyFailure: "startup-report-over-byte-ceiling-before-decode",
    lateFailure: "epoch-eof-or-startup-binding-after-bounded-copies",
    success: "one-startup-brand-commit-after-all-fallible-work",
    failureAfterSuccess:
      "later-failed-startup-construction-does-not-corrupt-the-first-brand",
    crossModule:
      "startup-created-by-instance-a-rejected-by-initializer-instance-b",
  }),
  Object.freeze({
    store: "inputMetadata",
    operations: Object.freeze([
      "createCandidateContainmentGuardianAdmissionInputV1",
      "createCandidateContainmentGuardianCancelInputV1",
      "createCandidateContainmentGuardianRecoveryRequestInputV1",
      "createCandidateContainmentGuardianControllerClosedInputV1",
      "createCandidateContainmentGuardianDiagnosticFailureInputV1",
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
      "createCandidateContainmentGuardianStatusEofInputV1",
    ]),
    earlyFailure:
      "per-constructor-earliest-applicable-failure-before-private-commit",
    lateFailure:
      "per-constructor-latest-applicable-failure-before-private-commit",
    success: "one-input-brand-commit-per-successful-constructor",
    failureAfterSuccess:
      "later-failed-input-construction-does-not-corrupt-the-first-brand",
    crossModule: "input-created-by-instance-a-rejected-by-reducer-instance-b",
  }),
  Object.freeze({
    store: "stateMetadata",
    operations: Object.freeze([
      "initializeCandidateContainmentGuardianControlV1",
      "reduceCandidateContainmentGuardianControlV1",
    ]),
    earlyFailure:
      "per-operation-earliest-applicable-failure-before-private-commit",
    lateFailure:
      "per-operation-latest-applicable-failure-before-private-commit",
    success: "one-state-brand-commit-per-successful-initialize-or-reduce",
    failureAfterSuccess:
      "failed-reduction-does-not-corrupt-the-existing-state-brand",
    crossModule: "state-created-by-instance-a-rejected-by-instance-b",
  }),
]);

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

const FORBIDDEN = Object.freeze([
  "Buffer",
  "Date",
  "JSON",
  "Promise",
  "Proxy",
  "WeakSet",
  "__proto__",
  "constructor",
  "eval",
  "fetch",
  "globalThis",
  "process",
  "prototype",
  "setTimeout",
]);

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

function maskCommentsAndStrings(source) {
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      const stop = end === -1 ? source.length : end;
      output += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("static gate: comment");
      const stop = end + 2;
      output += source.slice(index, stop).replace(/[^\n]/gu, " ");
      index = stop;
      continue;
    }
    if (
      source[index] === '"' ||
      source[index] === "'" ||
      source[index] === "`"
    ) {
      const quote = source[index];
      let stop = index + 1;
      while (stop < source.length) {
        if (source[stop] === "\\") stop += 2;
        else if (source[stop] === quote) {
          stop += 1;
          break;
        } else stop += 1;
      }
      if (source[stop - 1] !== quote) throw new Error("static gate: string");
      output += source.slice(index, stop).replace(/[^\n]/gu, " ");
      index = stop;
      continue;
    }
    output += source[index];
    index += 1;
  }
  return output;
}

function independentStaticAudit(source) {
  const imports = [
    ...source.matchAll(
      /(^|\n)\s*import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\3\s*;?/gu,
    ),
  ].map((match) => ({
    specifier: match[4],
    names: match[2]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  }));
  const masked = maskCommentsAndStrings(source);
  assert.equal(imports.length, masked.match(/\bimport\b/gu)?.length ?? 0);
  assert.equal(imports.length, 3);
  assert.equal(new Set(imports.map(({ specifier }) => specifier)).size, 3);
  for (const { specifier, names } of imports) {
    assert.deepEqual(names, ALLOWED_IMPORTS.get(specifier));
  }
  assert.equal(/\bexport\s+(?:\*|\{[^}]*\})\s+from\b/gu.test(masked), false);
  assert.equal(/\\u(?:\{|[0-9a-fA-F]{4})/gu.test(masked), false);
  for (const token of FORBIDDEN) {
    assert.equal(new RegExp(`\\b${token}\\b`, "u").test(masked), false, token);
  }
  const stores = [
    ...masked.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*new\s+WeakMap\s*\(\s*\)/gu,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(stores, [
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
  return Object.freeze({ imports: imports.length, stores: stores.length });
}

function validSkeleton(extra = "") {
  const imports = [...ALLOWED_IMPORTS]
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
  return `${imports}\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n${exports}\n${extra}`;
}

function snapshotCarrier(
  value,
  { label = "guardian byte carrier", minimumBytes = 0, maximumBytes = 64 } = {},
) {
  return copyBoundedBuffer(
    value,
    label,
    { minimumBytes, maximumBytes },
    (message) => {
      throw new TypeError(message);
    },
  );
}

function snapshotCarrierAtPosition(spec, value) {
  return snapshotCarrier(value, {
    label: spec.name,
    minimumBytes: spec.minimumBytes,
    maximumBytes: spec.maximumBytes,
  });
}

function sampleCarrierBytes(spec) {
  if (spec.name === "epochBytes") return Buffer.alloc(32, 0x45);
  if (spec.name === "rawDiagnosticBytes") return Buffer.from([0x64]);
  return Buffer.from([0x7b, 0x7d, 0x0a]);
}

function trapEveryObjectOperation(value, label) {
  const sentinel = new Error(`${label}: Buffer Proxy trap ran`);
  const state = { hits: 0 };
  const trap = () => {
    state.hits += 1;
    throw sentinel;
  };
  return Object.freeze({
    sentinel,
    state,
    value: new Proxy(value, {
      defineProperty: trap,
      deleteProperty: trap,
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      isExtensible: trap,
      ownKeys: trap,
      preventExtensions: trap,
      set: trap,
      setPrototypeOf: trap,
    }),
  });
}

function assertCarrierRejection(invoke, expectedMessage, sentinel = null) {
  assert.throws(invoke, (error) => {
    if (sentinel !== null) assert.notEqual(error, sentinel);
    assert.match(error.message, expectedMessage);
    return true;
  });
}

function ignoredPropertyVariants() {
  const variants = [];
  for (const keyKind of ["string", "symbol"]) {
    for (const descriptorKind of ["data", "getter", "setter"]) {
      for (const enumerable of [false, true]) {
        variants.push(Object.freeze({ keyKind, descriptorKind, enumerable }));
      }
    }
  }
  return Object.freeze(variants);
}

const IGNORED_PROPERTY_VARIANTS = ignoredPropertyVariants();

function exportedFunctionSource(source, name) {
  const marker = `export function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\nexport function ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function sourceIndependentStaticControls() {
  const cases = [
    'import value from "node:fs";',
    'import * as exact from "./containment-exact-v2.mjs";',
    'export { sha256 } from "./containment-exact-v2.mjs";',
    'const dynamic = import("./containment-exact-v2.mjs");',
    "const metadata = import.meta.url;",
    "const escaped = gl\\u006fbalThis;",
    "const gadget = value.constructor;",
    "const callback = setTimeout;",
  ];
  let evaluationAttempts = 0;
  for (const value of cases) {
    assert.throws(() => {
      independentStaticAudit(validSkeleton(value));
      evaluationAttempts += 1;
    });
  }
  assert.equal(evaluationAttempts, 0);
  assert.doesNotThrow(() => independentStaticAudit(validSkeleton()));
  return Object.freeze({ rejected: cases.length, evaluationAttempts });
}

function evaluateCandidateOnlyWhenSourceAbsent(source, evaluate) {
  if (source !== null) {
    throw new Error(
      "candidate evaluation disabled until exhaustive positive-allowlist parser closure is implemented",
    );
  }
  return evaluate();
}

const STATIC_CONTROLS = sourceIndependentStaticControls();
let candidateSourceGateError = null;
let source = null;
try {
  source = readFileSync(SOURCE_PATH, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (source !== null) {
  try {
    evaluateCandidateOnlyWhenSourceAbsent(source, () => {
      throw new Error("candidate evaluation attempted");
    });
  } catch (error) {
    candidateSourceGateError = error;
  }
}

test("independently verifies the fixture digest in the adversarial lane", () => {
  const fixture = JSON.parse(readFileSync(REQUIREMENTS_URL, "utf8"));
  assert.equal(digest(fixture), EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(
    fixture.vocabularies.byteCarrierAdditionalOwnPropertyPolicy,
    EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY,
  );
});

test("keeps its own pre-import gate green with zero evaluation attempts", () => {
  assert.deepEqual(STATIC_CONTROLS, { rejected: 8, evaluationAttempts: 0 });
  let sourcePresentEvaluationAttempts = 0;
  assert.throws(
    () =>
      evaluateCandidateOnlyWhenSourceAbsent(validSkeleton(), () => {
        sourcePresentEvaluationAttempts += 1;
      }),
    /evaluation disabled until exhaustive positive-allowlist parser closure/gu,
  );
  assert.equal(sourcePresentEvaluationAttempts, 0);
});

test("pins the bounded snapshot path against extra-property traversal", () => {
  const exactSource = readFileSync(EXACT_V2_URL, "utf8");
  const copySource = exportedFunctionSource(exactSource, "copyBoundedBuffer");
  const lengthSource = exportedFunctionSource(
    exactSource,
    "exactBufferByteLength",
  );
  for (const source of [copySource, lengthSource]) {
    assert.doesNotMatch(
      source,
      /reflectOwnKeys|objectGetOwnPropertyDescriptors|objectKeys|objectValues/gu,
    );
  }
  assert.match(
    lengthSource,
    /objectGetOwnPropertyDescriptor\(value,\s*"length"\)/gu,
  );
  assert.match(
    copySource,
    /reflectApply\(typedArraySet,\s*copied,\s*\[value\]\)/gu,
  );
});

test("pins source-independent exact-v2 copy controls for all nine byte positions", () => {
  assert.deepEqual(BYTE_POSITION_SPECS, [
    { name: "startupReportBytes", minimumBytes: 0, maximumBytes: 8_192 },
    { name: "epochBytes", minimumBytes: 32, maximumBytes: 32 },
    { name: "admissionFrameBytes", minimumBytes: 0, maximumBytes: 131_072 },
    { name: "recvmsgReportBytes", minimumBytes: 0, maximumBytes: 16_384 },
    { name: "cancelFrameBytes", minimumBytes: 0, maximumBytes: 4_096 },
    {
      name: "recoveryRequestFrameBytes",
      minimumBytes: 0,
      maximumBytes: 32_768,
    },
    {
      name: "diagnosticSummaryReportBytes",
      minimumBytes: 0,
      maximumBytes: 1_024,
    },
    { name: "rawDiagnosticBytes", minimumBytes: 0, maximumBytes: 16_384 },
    { name: "statusFrameBytes", minimumBytes: 0, maximumBytes: 8_192 },
  ]);
  assert.deepEqual(BYTE_POSITIONS, [
    "startupReportBytes",
    "epochBytes",
    "admissionFrameBytes",
    "recvmsgReportBytes",
    "cancelFrameBytes",
    "recoveryRequestFrameBytes",
    "diagnosticSummaryReportBytes",
    "rawDiagnosticBytes",
    "statusFrameBytes",
  ]);

  let overBoundGetterHits = 0;
  let overBoundControls = 0;
  for (const spec of BYTE_POSITION_SPECS) {
    const atMaximum = Buffer.alloc(spec.maximumBytes, 0x61);
    const maximumSnapshot = snapshotCarrierAtPosition(spec, atMaximum);
    assert.equal(maximumSnapshot.length, spec.maximumBytes, spec.name);
    assert.notEqual(maximumSnapshot, atMaximum, spec.name);

    const oversized = Buffer.alloc(spec.maximumBytes + 1, 0x61);
    Object.defineProperty(oversized, `ignored-${spec.name}`, {
      configurable: true,
      enumerable: true,
      get() {
        overBoundGetterHits += 1;
        throw new Error(`${spec.name}: over-bound getter ran`);
      },
    });
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, oversized),
      /outside its byte bound/gu,
    );
    overBoundControls += 1;
  }
  assert.deepEqual(
    { overBoundControls, overBoundGetterHits },
    { overBoundControls: 9, overBoundGetterHits: 0 },
  );

  assertCarrierRejection(
    () =>
      snapshotCarrierAtPosition(BYTE_POSITION_SPECS[1], Buffer.alloc(31, 0x45)),
    /outside its byte bound/gu,
  );
});

test("normalizes 12 string and symbol own-property controls at every byte position", () => {
  const touches = { reads: 0, writes: 0, invocations: 0 };
  let controls = 0;
  for (const spec of BYTE_POSITION_SPECS) {
    const baseline = sampleCarrierBytes(spec);
    const baselineSnapshot = snapshotCarrierAtPosition(spec, baseline);
    for (const variant of IGNORED_PROPERTY_VARIANTS) {
      const bytes = Buffer.from(baseline);
      const callable = new Proxy(() => null, {
        apply() {
          touches.invocations += 1;
          return null;
        },
      });
      const label = `${spec.name}-${variant.keyKind}-${variant.descriptorKind}-${variant.enumerable}`;
      const key =
        variant.keyKind === "string" ? `extra-${label}` : Symbol(label);
      const descriptor = {
        configurable: true,
        enumerable: variant.enumerable,
      };
      if (variant.descriptorKind === "getter") {
        descriptor.get = () => {
          touches.reads += 1;
          return callable;
        };
      } else if (variant.descriptorKind === "setter") {
        descriptor.set = () => {
          touches.writes += 1;
        };
      } else {
        descriptor.value = callable;
        descriptor.writable = true;
      }
      Object.defineProperty(bytes, key, descriptor);
      const descriptorBefore = Object.getOwnPropertyDescriptor(bytes, key);
      const decoratedSnapshot = snapshotCarrierAtPosition(spec, bytes);
      const descriptorAfter = Object.getOwnPropertyDescriptor(bytes, key);

      assert.deepEqual(decoratedSnapshot, baselineSnapshot, label);
      assert.notEqual(decoratedSnapshot, bytes, label);
      assert.equal(Object.getPrototypeOf(decoratedSnapshot), Buffer.prototype);
      assert.equal(Object.hasOwn(decoratedSnapshot, key), false, label);
      assert.equal(
        Object.getOwnPropertyDescriptor(decoratedSnapshot, "length"),
        undefined,
      );
      assert.deepEqual(
        Reflect.ownKeys(decoratedSnapshot),
        Reflect.ownKeys(baselineSnapshot),
        label,
      );
      assert.deepEqual(descriptorAfter, descriptorBefore, label);
      assert.equal(Object.hasOwn(bytes, key), true, label);

      const originalFirstByte = decoratedSnapshot[0];
      bytes[0] ^= 0xff;
      assert.equal(decoratedSnapshot[0], originalFirstByte, label);
      controls += 1;
    }
  }
  assert.deepEqual(
    {
      positions: BYTE_POSITIONS.length,
      variants: IGNORED_PROPERTY_VARIANTS.length,
      controls,
      touches,
    },
    {
      positions: 9,
      variants: 12,
      controls: 108,
      touches: { reads: 0, writes: 0, invocations: 0 },
    },
  );
});

test("rejects every hostile byte-carrier class trap-free at all positions", () => {
  class LocalBufferSubclass extends Buffer {}

  const totals = {
    brandedLookalikes: 0,
    foreignPrototypes: 0,
    nonBufferViews: 0,
    ownLength: 0,
    ownLengthGetterHits: 0,
    proxies: 0,
    proxyTrapHits: 0,
    sharedBacking: 0,
    subclasses: 0,
  };

  for (const spec of BYTE_POSITION_SPECS) {
    const sample = sampleCarrierBytes(spec);

    const trapped = trapEveryObjectOperation(Buffer.from(sample), spec.name);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, trapped.value),
      /exact non-Proxy Buffer/gu,
      trapped.sentinel,
    );
    totals.proxies += 1;
    totals.proxyTrapHits += trapped.state.hits;

    const shared = Buffer.from(new SharedArrayBuffer(sample.length));
    shared.set(sample);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, shared),
      /shared mutable backing/gu,
    );
    totals.sharedBacking += 1;

    const subclass = Buffer.from(sample);
    Object.setPrototypeOf(subclass, LocalBufferSubclass.prototype);
    assert.equal(Buffer.isBuffer(subclass), true);
    assert.notEqual(Object.getPrototypeOf(subclass), Buffer.prototype);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, subclass),
      /exact non-Proxy Buffer/gu,
    );
    totals.subclasses += 1;

    const foreignPrototype = runInNewContext("Object.create(bufferPrototype)", {
      bufferPrototype: Buffer.prototype,
    });
    const foreign = Buffer.from(sample);
    Object.setPrototypeOf(foreign, foreignPrototype);
    assert.equal(Buffer.isBuffer(foreign), true);
    assert.notEqual(Object.getPrototypeOf(foreign), Buffer.prototype);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, foreign),
      /exact non-Proxy Buffer/gu,
    );
    totals.foreignPrototypes += 1;

    const ownLength = Buffer.from(sample);
    const ownLengthSentinel = new Error(`${spec.name}: own length getter ran`);
    Object.defineProperty(ownLength, "length", {
      configurable: true,
      get() {
        totals.ownLengthGetterHits += 1;
        throw ownLengthSentinel;
      },
    });
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, ownLength),
      /exact non-Proxy Buffer/gu,
      ownLengthSentinel,
    );
    totals.ownLength += 1;

    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, new Uint8Array(sample)),
      /exact non-Proxy Buffer/gu,
    );
    totals.nonBufferViews += 1;

    const brandedLookalike = Object.create(Buffer.prototype);
    Object.defineProperty(brandedLookalike, "_isBuffer", {
      configurable: true,
      enumerable: true,
      value: true,
    });
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, brandedLookalike),
      /(?:exact non-Proxy Buffer|length cannot be read intrinsically)/gu,
    );
    totals.brandedLookalikes += 1;
  }

  assert.deepEqual(totals, {
    brandedLookalikes: 9,
    foreignPrototypes: 9,
    nonBufferViews: 9,
    ownLength: 9,
    ownLengthGetterHits: 0,
    proxies: 9,
    proxyTrapHits: 0,
    sharedBacking: 9,
    subclasses: 9,
  });
});

test("freezes the 10-operation private-store evaluator design without claiming candidate execution", () => {
  assert.deepEqual(
    PRIVATE_STORE_COMMIT_CONTROL_PLAN.map(({ store }) => store),
    ["startupMetadata", "inputMetadata", "stateMetadata"],
  );
  const expectedOperations = [
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
  ];
  const operations = PRIVATE_STORE_COMMIT_CONTROL_PLAN.flatMap(
    (entry) => entry.operations,
  );
  assert.deepEqual(operations, expectedOperations);
  assert.equal(new Set(operations).size, 10);
  assert.deepEqual(
    EXPECTED_EXPORTS.filter(
      (name) =>
        !name.startsWith(
          "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
        ) && name !== "verifyCandidateContainmentGuardianStatusFrameV1",
    ),
    expectedOperations,
  );
  const phases = [
    "earlyFailure",
    "lateFailure",
    "success",
    "failureAfterSuccess",
    "crossModule",
  ];
  const controls = [];
  for (const entry of PRIVATE_STORE_COMMIT_CONTROL_PLAN) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.operations), true);
    assert.equal(entry.operations.length > 0, true);
    for (const phase of phases) {
      assert.equal(typeof entry[phase], "string");
      assert.notEqual(entry[phase].length, 0);
      controls.push(`${entry.store}:${phase}:${entry[phase]}`);
    }
  }
  assert.equal(new Set(controls).size, 15);
  assert.equal(Object.isFrozen(PRIVATE_STORE_COMMIT_CONTROL_PLAN), true);
});

test("keeps snapshot cost byte-bounded despite many extra own properties", () => {
  const bytes = Buffer.from([0x61]);
  let accessorHits = 0;
  for (let index = 0; index < 2_048; index += 1) {
    Object.defineProperty(bytes, `extra-${index}`, {
      configurable: true,
      enumerable: true,
      get() {
        accessorHits += 1;
        return index;
      },
    });
    bytes[Symbol(`extra-${index}`)] = index;
  }
  const snapshot = snapshotCarrier(bytes, { maximumBytes: 1 });
  assert.deepEqual(snapshot, Buffer.from([0x61]));
  assert.equal(accessorHits, 0);
  assert.deepEqual(Reflect.ownKeys(snapshot), ["0"]);
});

test("does not create a second missing-module failure", () => {
  if (candidateSourceGateError !== null) throw candidateSourceGateError;
  assert.equal(source, null);
});

test(
  "connect the source-independent 9-position matrices to the candidate after static-audit closure, including over-byte collisions with own-length, subclass, foreign-prototype, and shared backing under CONTROL_BOUNDS-before-CONTROL_SHAPE while Proxy and non-Buffer carriers reject immediately trap-free",
  { todo: true },
  () => {},
);
test(
  "execute early, late, success, failure-after-success, and cross-module commit controls for every one of the 10 listed private-store mutating exports after static-audit closure",
  { todo: true },
  () => {},
);
test(
  "replace the fail-closed source-presence stop with exhaustive positive-allowlist parser closure for free identifiers, imports, exports, encoded identifiers, computed access, ambient authority, and test-gaming paths",
  { todo: true },
  () => {},
);
