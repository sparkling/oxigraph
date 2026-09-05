import { isDeepStrictEqual, types } from "node:util";

import {
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
} from "./benchmark-private-build-issuer-v1-contract.mjs";

const READINESS = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const TEST_CAPABILITY_SCHEMA =
  "oxigraph.g1.7-benchmark-private-build-issuer-test-capability/v1";
const TEST_TRACE_SCHEMA =
  "oxigraph.g1.7-benchmark-private-build-issuer-test-trace/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const LIFECYCLE = Object.freeze(
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.lifecycle.map(
    ({ phase }) => phase,
  ),
);
const DESCRIPTOR_BOUNDARY = structuredClone(
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.descriptorBoundary,
);
const OBSERVATION_KEYS = Object.freeze([
  "buildOwnerV3Issued",
  "cargoExitObserved",
  "cargoJsonlValid",
  "cgroupEventsPopulatedZeroObserved",
  "cgroupProcsEmptyObserved",
  "childMayExist",
  "cleanupOutcomeCertain",
  "directChildReapObserved",
  "durableCommitObserved",
  "exclusiveWaitidPidfdObserved",
  "heldTargetAncestryObserved",
  "heldTargetElfObserved",
  "heldTargetMetadataObserved",
  "helperExecImageProven",
  "pidfdReadableObserved",
  "pidsCurrentZeroObserved",
  "productionWorkspaceFinishObserved",
  "reservedExitAgreementObserved",
  "statusEofObserved",
  "statusTerminalSequenceObserved",
  "statusWithinByteLimit",
  "statusWithinFrameLimit",
  "statusWithinTimeout",
  "stderrClosedObserved",
  "stderrEofObserved",
  "stderrWithinBound",
  "stdoutClosedObserved",
  "stdoutEofObserved",
  "stdoutWithinBound",
]);

const liveCapabilities = new WeakMap();
const brandedFaults = new WeakSet();
const brandedTraces = new WeakSet();

function clone(value) {
  return structuredClone(value);
}

function snapshotExactData(value, label, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError(`${label} contains unsupported data`);
    }
    return value;
  }
  if (types.isProxy(value) || seen.has(value)) {
    throw new TypeError(`${label} contains non-ordinary or cyclic data`);
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} contains symbolic data`);
  }
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      keys.length !== value.length + 1 ||
      descriptors.length === undefined
    ) {
      throw new TypeError(`${label} array shape is not exact`);
    }
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        "get" in descriptor ||
        "set" in descriptor ||
        !descriptor.enumerable
      ) {
        throw new TypeError(
          `${label}[${index}] must be an enumerable data field`,
        );
      }
      output.push(
        snapshotExactData(descriptor.value, `${label}[${index}]`, seen),
      );
    }
    seen.delete(value);
    return output;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} contains a non-ordinary record`);
  }
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`);
    }
    output[key] = snapshotExactData(descriptor.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function exactOrdinaryRecord(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be an exact ordinary record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    !isDeepStrictEqual(Object.keys(descriptors).sort(), [...keys].sort())
  ) {
    throw new TypeError(`${label} fields are not exact`);
  }
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      "get" in descriptor ||
      "set" in descriptor ||
      !descriptor.enumerable
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validateRequestIdentity(value) {
  const request = exactOrdinaryRecord(
    value,
    ["schema", "rawSha256", "contentHash"],
    "request v2 identity",
  );
  if (request.schema !== "oxigraph.g1.7-benchmark-execution-request/v2") {
    throw new TypeError("request v2 schema drifted");
  }
  exactDigest(request.rawSha256, "request v2 raw identity");
  exactDigest(request.contentHash, "request v2 content identity");
  return request;
}

function validateHelperIdentity(value) {
  const helper = exactOrdinaryRecord(
    value,
    [
      "schema",
      "rawSha256",
      "contentHash",
      "requestRawSha256",
      "requestContentHash",
      "sourceLogicalName",
      "sourceSha256",
      "executableSha256",
    ],
    "helper attestation identity",
  );
  if (
    helper.schema !== "oxigraph.g1.7-cargo-execveat-helper-attestation/v1" ||
    helper.sourceLogicalName !== "cargo-execveat-helper.c" ||
    helper.sourceSha256 !==
      "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9"
  ) {
    throw new TypeError("helper attestation identity drifted");
  }
  for (const key of [
    "rawSha256",
    "contentHash",
    "requestRawSha256",
    "requestContentHash",
    "sourceSha256",
    "executableSha256",
  ]) {
    exactDigest(helper[key], `helper attestation ${key}`);
  }
  return helper;
}

function validateHeldHelperIdentity(value) {
  const held = exactOrdinaryRecord(
    value,
    [
      "fd",
      "role",
      "kind",
      "descriptorAccess",
      "cloexecImmediatelyBeforeCargoExecveat",
      "sourceLogicalName",
      "sourceSha256",
      "executableSha256",
    ],
    "held helper FD-8 identity",
  );
  if (
    held.fd !== 8 ||
    held.role !== "helperSelfExecutable" ||
    held.kind !== "regular-file" ||
    held.descriptorAccess !== "read-only" ||
    held.cloexecImmediatelyBeforeCargoExecveat !== true ||
    held.sourceLogicalName !== "cargo-execveat-helper.c"
  ) {
    throw new TypeError("held helper FD-8 identity drifted");
  }
  exactDigest(held.sourceSha256, "held helper source identity");
  exactDigest(held.executableSha256, "held helper executable identity");
  return held;
}

function makeFault(phase, message) {
  const error = new Error(`G1.7 private build issuer ${phase}: ${message}`);
  Object.defineProperties(error, {
    name: { value: "G17BenchmarkPrivateBuildIssuerV1Fault" },
    phase: { value: phase, enumerable: true },
    outcome: { value: "FAIL", enumerable: true },
  });
  Object.freeze(error);
  brandedFaults.add(error);
  return error;
}

function makeTrace(phaseIndex, outcome, durableCommitObserved, adapterCalls) {
  const retained = outcome === "INCONCLUSIVE_RETAINED";
  const trace = deepFreeze({
    schema: TEST_TRACE_SCHEMA,
    phase: LIFECYCLE[phaseIndex],
    outcome,
    retained: {
      workspace: retained,
      cgroup: retained,
      descriptors: retained,
      handles: retained,
      evidence: retained,
    },
    retryAllowed: false,
    relaunchAllowed: false,
    targetReleaseAllowed: false,
    ownerIssuanceAllowed: false,
    durableCommitObserved,
    adapterCalls,
    physicalOrigin: false,
    binding: null,
    finalDecisionEligible: false,
    authority: clone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
    nonclaims: clone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
  });
  brandedTraces.add(trace);
  return trace;
}

function preAdapterFailure(scenario) {
  if (scenario.predecessorAttestationsExact !== true) return 0;
  if (scenario.sourceWorkspaceRevalidated !== true) return 1;
  try {
    validateRequestIdentity(scenario.requestV2);
  } catch {
    return 2;
  }
  try {
    const helper = validateHelperIdentity(scenario.helperAttestation);
    const held = validateHeldHelperIdentity(scenario.heldHelperFd8);
    if (
      helper.requestRawSha256 !== scenario.requestV2.rawSha256 ||
      helper.requestContentHash !== scenario.requestV2.contentHash ||
      held.sourceLogicalName !== helper.sourceLogicalName ||
      held.sourceSha256 !== helper.sourceSha256 ||
      held.executableSha256 !== helper.executableSha256 ||
      !isDeepStrictEqual(scenario.descriptorBoundary, DESCRIPTOR_BOUNDARY)
    ) {
      return 3;
    }
  } catch {
    return 3;
  }
  return null;
}

function observationFailure(observation) {
  const phases = [
    [4, ["durableCommitObserved", "helperExecImageProven"]],
    [
      5,
      [
        "statusTerminalSequenceObserved",
        "reservedExitAgreementObserved",
        "statusWithinByteLimit",
        "statusWithinFrameLimit",
        "statusWithinTimeout",
        "statusEofObserved",
      ],
    ],
    [
      6,
      [
        "cargoExitObserved",
        "cargoJsonlValid",
        "stdoutClosedObserved",
        "stdoutEofObserved",
        "stdoutWithinBound",
        "stderrClosedObserved",
        "stderrEofObserved",
        "stderrWithinBound",
      ],
    ],
    [
      7,
      [
        "pidfdReadableObserved",
        "exclusiveWaitidPidfdObserved",
        "directChildReapObserved",
      ],
    ],
    [
      8,
      [
        "cgroupProcsEmptyObserved",
        "cgroupEventsPopulatedZeroObserved",
        "pidsCurrentZeroObserved",
        "cleanupOutcomeCertain",
      ],
    ],
    [
      9,
      [
        "heldTargetAncestryObserved",
        "heldTargetMetadataObserved",
        "heldTargetElfObserved",
      ],
    ],
    [10, ["productionWorkspaceFinishObserved"]],
    [11, ["buildOwnerV3Issued"]],
  ];
  for (const [phase, keys] of phases) {
    if (keys.some((key) => observation[key] !== true)) return phase;
  }
  return null;
}

export function g17BenchmarkPrivateBuildIssuerV1Readiness() {
  return READINESS;
}

export function createG17BenchmarkPrivateBuildIssuerV1ForTesting(input) {
  try {
    const envelope = exactOrdinaryRecord(
      input,
      ["adapter", "scenario"],
      "test issuer input",
    );
    if (
      typeof envelope.adapter !== "function" ||
      types.isProxy(envelope.adapter)
    ) {
      throw new TypeError("test adapter must be one exact function");
    }
    let scenario = exactOrdinaryRecord(
      envelope.scenario,
      [
        "predecessorAttestationsExact",
        "sourceWorkspaceRevalidated",
        "requestV2",
        "helperAttestation",
        "heldHelperFd8",
        "descriptorBoundary",
      ],
      "test issuer scenario",
    );
    scenario = snapshotExactData(scenario, "test issuer scenario");
    deepFreeze(scenario);
    const capability = Object.freeze({ schema: TEST_CAPABILITY_SCHEMA });
    liveCapabilities.set(capability, {
      adapter: envelope.adapter,
      scenario,
      used: false,
    });
    return capability;
  } catch (error) {
    if (brandedFaults.has(error)) throw error;
    throw makeFault(LIFECYCLE[0], error.message);
  }
}

export async function runG17BenchmarkPrivateBuildIssuerV1(input) {
  const state = liveCapabilities.get(input);
  if (state === undefined) {
    throw makeFault(
      LIFECYCLE[0],
      "production readiness is unavailable/native-adapter-unavailable",
    );
  }
  if (state.used) throw makeFault(LIFECYCLE[0], "test capability is not live");
  state.used = true;

  const earlyPhase = preAdapterFailure(state.scenario);
  if (earlyPhase !== null) return makeTrace(earlyPhase, "FAIL", false, 0);

  let observation;
  try {
    const raw = await state.adapter(state.scenario);
    observation = exactOrdinaryRecord(
      raw,
      OBSERVATION_KEYS,
      "test observation",
    );
    for (const key of OBSERVATION_KEYS) {
      if (typeof observation[key] !== "boolean") {
        throw new TypeError(`test observation ${key} must be boolean`);
      }
    }
  } catch {
    return makeTrace(4, "INCONCLUSIVE_RETAINED", false, 1);
  }

  const failedPhase = observationFailure(observation);
  if (failedPhase === null) {
    return makeTrace(11, "FAIL", observation.durableCommitObserved, 1);
  }
  const completeQuiescence =
    observation.cgroupProcsEmptyObserved &&
    observation.cgroupEventsPopulatedZeroObserved &&
    observation.pidsCurrentZeroObserved;
  const ambiguous =
    observation.childMayExist &&
    (!observation.directChildReapObserved ||
      !completeQuiescence ||
      !observation.cleanupOutcomeCertain);
  return makeTrace(
    failedPhase,
    ambiguous ? "INCONCLUSIVE_RETAINED" : "FAIL",
    observation.durableCommitObserved,
    1,
  );
}

export function isG17BenchmarkPrivateBuildIssuerV1Fault(value) {
  return brandedFaults.has(value);
}

export function isG17BenchmarkPrivateBuildIssuerV1TestTrace(value) {
  return brandedTraces.has(value);
}
