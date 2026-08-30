import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const BYTE_POSITIONS = Object.freeze([
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

function snapshotCarrier(value, maximumBytes = 64) {
  return copyBoundedBuffer(
    value,
    "guardian byte carrier",
    { minimumBytes: 0, maximumBytes },
    (message) => {
      throw new TypeError(message);
    },
  );
}

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

test("normalizes extra own properties identically at every byte position", () => {
  const mutations = ["getter", "setter", "symbol", "data"];
  const touches = { reads: 0, writes: 0, invocations: 0 };
  let controls = 0;
  for (const position of BYTE_POSITIONS) {
    const baseline = Buffer.from([0x7b, 0x7d, 0x0a]);
    const baselineSnapshot = snapshotCarrier(baseline);
    for (const mutation of mutations) {
      const bytes = Buffer.from([0x7b, 0x7d, 0x0a]);
      const callable = new Proxy(() => null, {
        apply() {
          touches.invocations += 1;
          return null;
        },
      });
      if (mutation === "getter") {
        Object.defineProperty(bytes, `extra-${position}`, {
          configurable: true,
          enumerable: true,
          get() {
            touches.reads += 1;
            return callable;
          },
        });
      } else if (mutation === "setter") {
        Object.defineProperty(bytes, `extra-${position}`, {
          configurable: true,
          enumerable: true,
          set() {
            touches.writes += 1;
          },
        });
      } else if (mutation === "symbol") {
        bytes[Symbol(position)] = callable;
      } else {
        bytes[`extra-${position}`] = callable;
      }
      const decoratedSnapshot = snapshotCarrier(bytes);
      assert.deepEqual(decoratedSnapshot, baselineSnapshot);
      assert.notEqual(decoratedSnapshot, bytes);
      assert.deepEqual(
        Reflect.ownKeys(decoratedSnapshot),
        Reflect.ownKeys(baselineSnapshot),
      );
      bytes[0] = 0;
      assert.equal(decoratedSnapshot[0], 0x7b);
      controls += 1;
    }
  }
  assert.deepEqual(
    { positions: BYTE_POSITIONS.length, controls, touches },
    {
      positions: 9,
      controls: 36,
      touches: { reads: 0, writes: 0, invocations: 0 },
    },
  );
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
  const snapshot = snapshotCarrier(bytes, 1);
  assert.deepEqual(snapshot, Buffer.from([0x61]));
  assert.equal(accessorHits, 0);
  assert.deepEqual(Reflect.ownKeys(snapshot), ["0"]);
});

test("rejects an own length property without invoking it", () => {
  const bytes = Buffer.from([0x61]);
  let lengthGetterHits = 0;
  Object.defineProperty(bytes, "length", {
    configurable: true,
    get() {
      lengthGetterHits += 1;
      return 1;
    },
  });
  assert.throws(() => snapshotCarrier(bytes, 1), /exact non-Proxy Buffer/gu);
  assert.equal(lengthGetterHits, 0);
});

test("does not create a second missing-module failure", () => {
  if (candidateSourceGateError !== null) throw candidateSourceGateError;
  assert.equal(source, null);
});

test.todo("connect all 9 byte-position normalization controls to production");
test.todo(
  "expand Proxy, shared-backing, subclass, and foreign-Buffer controls",
);
test.todo("expand three-store early, late, success, and cross-module commits");
test.todo(
  "replace the fail-closed source-presence stop with exhaustive positive-allowlist parser closure for free identifiers, imports, exports, encoded identifiers, computed access, ambient authority, and test-gaming paths",
);
