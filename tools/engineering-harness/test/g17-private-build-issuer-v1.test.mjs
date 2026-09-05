import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, types } from "node:util";

import { CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256 } from "../src/candidate/containment-guardian-manager-protocol-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256 } from "../src/candidate/containment-guardian-manager-transition-consumer-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 } from "../src/candidate/containment-guardian-native-adapter-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1 } from "../src/candidate/containment-guardian-recovery-executor-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256 } from "../src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256 } from "../src/candidate/containment-guardian-statefs-v1.mjs";
import {
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
  createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact,
} from "../src/qualification/benchmark-private-build-issuer-v1-contract.mjs";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const SOURCE_URL = new URL(
  "../src/qualification/benchmark-private-build-issuer-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);

const EXPECTED_EXPORTS = Object.freeze([
  "createG17BenchmarkPrivateBuildIssuerV1ForTesting",
  "g17BenchmarkPrivateBuildIssuerV1Readiness",
  "isG17BenchmarkPrivateBuildIssuerV1Fault",
  "isG17BenchmarkPrivateBuildIssuerV1TestTrace",
  "runG17BenchmarkPrivateBuildIssuerV1",
]);
const EXPECTED_READINESS = Object.freeze({
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
const EXPECTED_DESCRIPTOR_BOUNDARY = structuredClone(
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.descriptorBoundary,
);

const EXACT_PREDECESSOR_INPUTS = Object.freeze([
  [
    "tools/engineering-harness/src/qualification/benchmark-private-build-issuer-v1-contract.mjs",
    43_702,
    "4bdbdbad7a657e4506fbea371257b072e638c76fad211476e32a0292f63792e1",
  ],
  [
    "tools/engineering-harness/test/g17-private-build-issuer-v1-contract.test.mjs",
    76_260,
    "d8c9dad7f561d228af4ebc7b6de4f65a8027bf7c6c9e819afdac34281922c33b",
  ],
  [
    "tools/engineering-harness/src/qualification/benchmark-execution-request-v2-contract.mjs",
    38_624,
    "b708df2f3dfa44502e8c66afb9deaa5bac87e0dc2cb714929dd8b53623167edb",
  ],
  [
    "tools/engineering-harness/src/qualification/cargo-execveat-helper-attestation-contract.mjs",
    24_809,
    "f7dfcd24c27d8a1405c147f3de948c4ec07859ea117618e8badc1cb922748f1b",
  ],
  [
    "tools/engineering-harness/src/qualification/cargo-execveat-helper.c",
    14_703,
    "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9",
  ],
  [
    "tools/engineering-harness/src/qualification/cargo-execveat-status-protocol-contract.mjs",
    13_200,
    "17f6355bf8706516ba4aab94c2a88131f0a1e8dc4eace8bb02664558b94e200d",
  ],
  [
    "tools/engineering-harness/src/qualification/non-tmpfs-build-isolation-v2-contract.mjs",
    32_145,
    "4207ff86faa52119d375299afa26237c1511890ef5e943ddd91e4183fa9ffded",
  ],
  [
    "tools/engineering-harness/src/qualification/non-tmpfs-containment-v2-contract.mjs",
    54_508,
    "22996e2ad91e85fe2e1304fb74ac8a0b055386e31c49e6fb8b5804b153dddf9b",
  ],
  [
    "tools/engineering-harness/src/qualification/product-source-workspace.mjs",
    111_533,
    "0574d599f50764540e3dbdb167ff5b7dbbceb8881ca16bbc51c137e7d7fe84f3",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-v1.mjs",
    189_577,
    "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-manager-protocol-v1.mjs",
    153_380,
    "79c6dec19e6f7e1c68090dae36eab72b6c0f956f07b52ff0fa2d84b4f187b158",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.h",
    18_709,
    "358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c",
    182_758,
    "f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs",
    52_072,
    "09f016c0686289bb39cb52af52b120a94e3de4c338cf8f1b72e834a3ab56a779",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-native-adapter-v1.mjs",
    27_800,
    "d8bc60a333608d7b94bce870c13facfe1e75fce878c46aca2b97b8dd78a4225a",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-recovery-executor-v1.mjs",
    27_265,
    "e1ccb7a436db91fb6589b6126b5279148c04d8bf435fa44d8ed73061c4149f2a",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-manager-transition-consumer-v1.mjs",
    4_814,
    "d7de4cdf7422586d495b93b8870a6207bd3e1800a09870927b56c1810ac31858",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s3a-red.test.mjs",
    10_547,
    "ed58122fc8e1e984e9b7e7c170e460d9a4351310eaec06241f289053b13c2d0a",
  ],
]);

const EXPECTED_INTERFACE_IDENTITIES = Object.freeze({
  privateIssuerRequirements:
    "d791698d9119ad2e49c001354df13e4122cdf39552385c87c2e85625ae6e0534",
  statefsRequirements:
    "9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42",
  managerRequirements:
    "a6e98c1956c0a4a37a4b8a5ca46e56b0e9e66bf76928cd1669e43e4db1a68d02",
  statefsBuildRequirements:
    "fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70",
  statefsObject:
    "73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043",
  nativeReplayRequirements:
    "be25697d389f5b6023faebaf851095ed18d0d61501a755590f8c432bac809bba",
  recoveryRequirements:
    "b6ad1ab0bdcae784e4cd348e1833015d8d693a1a94c7a2cc07971878c6a394a5",
  transitionConsumerRequirements:
    "62cc5c020663523629f42e5ac8170ef74bfc663ff1ad77515f1abbef1431c32a",
});

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainClone(value) {
  return structuredClone(value);
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
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
    helper.schema !==
      "oxigraph.g1.7-cargo-execveat-helper-attestation/v1" ||
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

function createFixture(overrides = {}) {
  const requestRawSha256 = "1".repeat(64);
  const requestContentHash = "2".repeat(64);
  const helperExecutableSha256 = "3".repeat(64);
  return {
    predecessorAttestationsExact: true,
    sourceWorkspaceRevalidated: true,
    requestV2: {
      schema: "oxigraph.g1.7-benchmark-execution-request/v2",
      rawSha256: requestRawSha256,
      contentHash: requestContentHash,
    },
    helperAttestation: {
      schema: "oxigraph.g1.7-cargo-execveat-helper-attestation/v1",
      rawSha256: "4".repeat(64),
      contentHash: "5".repeat(64),
      requestRawSha256,
      requestContentHash,
      sourceLogicalName: "cargo-execveat-helper.c",
      sourceSha256:
        "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9",
      executableSha256: helperExecutableSha256,
    },
    heldHelperFd8: {
      fd: 8,
      role: "helperSelfExecutable",
      kind: "regular-file",
      descriptorAccess: "read-only",
      cloexecImmediatelyBeforeCargoExecveat: true,
      sourceLogicalName: "cargo-execveat-helper.c",
      sourceSha256:
        "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9",
      executableSha256: helperExecutableSha256,
    },
    descriptorBoundary: plainClone(EXPECTED_DESCRIPTOR_BOUNDARY),
    ...overrides,
  };
}

function changedScalar(value) {
  if (value === null) return "unexpected";
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") return `${value}-changed`;
  throw new TypeError("descriptor scalar mutation is unsupported");
}

function valueAtPath(root, path) {
  return path.reduce((value, component) => value[component], root);
}

function descriptorBoundaryMutations() {
  const mutations = [];
  function visit(value, path) {
    if (value !== null && typeof value === "object") {
      if (!Array.isArray(value)) {
        const extended = plainClone(EXPECTED_DESCRIPTOR_BOUNDARY);
        valueAtPath(extended, path).unexpected = true;
        mutations.push([`${path.join(".") || "root"}:extend`, extended]);
        for (const key of Object.keys(value)) {
          const reduced = plainClone(EXPECTED_DESCRIPTOR_BOUNDARY);
          delete valueAtPath(reduced, path)[key];
          mutations.push(
            [`${path.join(".") || "root"}.${key}:drop`, reduced],
          );
        }
      } else if (value.length > 0) {
        const dropped = plainClone(EXPECTED_DESCRIPTOR_BOUNDARY);
        valueAtPath(dropped, path).pop();
        mutations.push([`${path.join(".")}:drop`, dropped]);
        const extended = plainClone(EXPECTED_DESCRIPTOR_BOUNDARY);
        const target = valueAtPath(extended, path);
        target.push(plainClone(target[0]));
        mutations.push([`${path.join(".")}:extend`, extended]);
        if (value.length > 1) {
          const reordered = plainClone(EXPECTED_DESCRIPTOR_BOUNDARY);
          valueAtPath(reordered, path).reverse();
          mutations.push([`${path.join(".")}:reorder`, reordered]);
        }
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, [...path, key]);
      }
      return;
    }
    const changed = plainClone(EXPECTED_DESCRIPTOR_BOUNDARY);
    const parent = valueAtPath(changed, path.slice(0, -1));
    parent[path.at(-1)] = changedScalar(value);
    mutations.push([path.join("."), changed]);
  }
  visit(EXPECTED_DESCRIPTOR_BOUNDARY, []);
  return mutations;
}

function completeObservation(overrides = {}) {
  return Object.fromEntries([
    ...OBSERVATION_KEYS.map((key) => [key, true]),
    ["buildOwnerV3Issued", false],
    ...Object.entries(overrides),
  ]);
}

function createReferenceCandidate() {
  const liveCapabilities = new WeakMap();
  const brandedFaults = new WeakSet();
  const brandedTraces = new WeakSet();

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

  function readiness() {
    return EXPECTED_READINESS;
  }

  function createForTesting(input) {
    let envelope;
    try {
      envelope = exactOrdinaryRecord(
        input,
        ["adapter", "scenario"],
        "test issuer input",
      );
      if (typeof envelope.adapter !== "function" || types.isProxy(envelope.adapter)) {
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
      scenario = plainClone(scenario);
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

  function trace(phaseIndex, outcome, durableCommitObserved, adapterCalls) {
    const retained = outcome === "INCONCLUSIVE_RETAINED";
    const value = deepFreeze({
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
      authority: plainClone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
      nonclaims: plainClone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
    });
    brandedTraces.add(value);
    return value;
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
        !isDeepStrictEqual(
          scenario.descriptorBoundary,
          EXPECTED_DESCRIPTOR_BOUNDARY,
        )
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

  async function run(input) {
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
    if (earlyPhase !== null) return trace(earlyPhase, "FAIL", false, 0);

    let observation;
    try {
      const raw = await state.adapter(state.scenario);
      observation = exactOrdinaryRecord(raw, OBSERVATION_KEYS, "test observation");
      for (const key of OBSERVATION_KEYS) {
        if (typeof observation[key] !== "boolean") {
          throw new TypeError(`test observation ${key} must be boolean`);
        }
      }
    } catch {
      return trace(4, "INCONCLUSIVE_RETAINED", false, 1);
    }
    const failedPhase = observationFailure(observation);
    if (failedPhase === null) {
      return trace(11, "FAIL", observation.durableCommitObserved, 1);
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
    return trace(
      failedPhase,
      ambiguous ? "INCONCLUSIVE_RETAINED" : "FAIL",
      observation.durableCommitObserved,
      1,
    );
  }

  function isFault(value) {
    return brandedFaults.has(value);
  }

  function isTrace(value) {
    return brandedTraces.has(value);
  }

  return Object.freeze({
    createG17BenchmarkPrivateBuildIssuerV1ForTesting: createForTesting,
    g17BenchmarkPrivateBuildIssuerV1Readiness: readiness,
    isG17BenchmarkPrivateBuildIssuerV1Fault: isFault,
    isG17BenchmarkPrivateBuildIssuerV1TestTrace: isTrace,
    runG17BenchmarkPrivateBuildIssuerV1: run,
  });
}

function assertFault(candidate, block, phase = LIFECYCLE[0]) {
  return assert.rejects(Promise.resolve().then(block), (error) => {
    assert.equal(candidate.isG17BenchmarkPrivateBuildIssuerV1Fault(error), true);
    assert.equal(error.phase, phase);
    assert.equal(error.outcome, "FAIL");
    return true;
  });
}

function createCapability(candidate, scenario, adapter) {
  return candidate.createG17BenchmarkPrivateBuildIssuerV1ForTesting({
    adapter,
    scenario,
  });
}

async function assertCandidateContract(candidate, source = null) {
  assert.deepEqual(Object.keys(candidate).sort(), [...EXPECTED_EXPORTS].sort());
  assert.equal(candidate.g17BenchmarkPrivateBuildIssuerV1Readiness.length, 0);
  assert.equal(candidate.runG17BenchmarkPrivateBuildIssuerV1.length, 1);
  assert.equal(
    candidate.createG17BenchmarkPrivateBuildIssuerV1ForTesting.length,
    1,
  );
  assert.equal(candidate.isG17BenchmarkPrivateBuildIssuerV1Fault.length, 1);
  assert.equal(candidate.isG17BenchmarkPrivateBuildIssuerV1TestTrace.length, 1);
  assert.deepEqual(
    candidate.g17BenchmarkPrivateBuildIssuerV1Readiness(),
    EXPECTED_READINESS,
  );
  assert.equal(
    Object.isFrozen(candidate.g17BenchmarkPrivateBuildIssuerV1Readiness()),
    true,
  );

  let productionReads = 0;
  const productionInput = new Proxy(
    {},
    {
      get() {
        productionReads += 1;
        throw new Error("production input was inspected");
      },
      ownKeys() {
        productionReads += 1;
        throw new Error("production input was enumerated");
      },
    },
  );
  await assertFault(candidate, () =>
    candidate.runG17BenchmarkPrivateBuildIssuerV1(productionInput),
  );
  assert.equal(productionReads, 0);

  const fixture = createFixture();
  for (const invalid of [
    new Proxy({ adapter() {}, scenario: fixture }, {}),
    { adapter() {} },
    { adapter() {}, scenario: fixture, extra: true },
    { adapter: new Proxy(() => completeObservation(), {}), scenario: fixture },
  ]) {
    await assertFault(candidate, () =>
      candidate.createG17BenchmarkPrivateBuildIssuerV1ForTesting(invalid),
    );
  }
  const accessor = { adapter() {} };
  Object.defineProperty(accessor, "scenario", {
    enumerable: true,
    get() {
      throw new Error("scenario accessor executed");
    },
  });
  await assertFault(candidate, () =>
    candidate.createG17BenchmarkPrivateBuildIssuerV1ForTesting(accessor),
  );
  const symbolic = { adapter() {}, scenario: fixture };
  symbolic[Symbol("extra")] = true;
  await assertFault(candidate, () =>
    candidate.createG17BenchmarkPrivateBuildIssuerV1ForTesting(symbolic),
  );
  const missingScenarioField = createFixture();
  delete missingScenarioField.heldHelperFd8;
  const extraScenarioField = { ...createFixture(), extra: true };
  const scenarioAccessor = createFixture();
  Object.defineProperty(scenarioAccessor, "requestV2", {
    enumerable: true,
    get() {
      throw new Error("request accessor executed");
    },
  });
  for (const scenario of [
    new Proxy(createFixture(), {}),
    missingScenarioField,
    extraScenarioField,
    scenarioAccessor,
  ]) {
    await assertFault(candidate, () =>
      candidate.createG17BenchmarkPrivateBuildIssuerV1ForTesting({
        adapter() {},
        scenario,
      }),
    );
  }

  let adapterCalls = 0;
  let adapterInput;
  const capability = createCapability(candidate, fixture, async (input) => {
    adapterCalls += 1;
    adapterInput = input;
    return completeObservation();
  });
  const trace = await candidate.runG17BenchmarkPrivateBuildIssuerV1(capability);
  assert.equal(adapterCalls, 1);
  assert.equal(Object.isFrozen(adapterInput), true);
  assert.equal(candidate.isG17BenchmarkPrivateBuildIssuerV1TestTrace(trace), true);
  assert.deepEqual(
    Object.keys(trace),
    [
      "schema",
      "phase",
      "outcome",
      "retained",
      "retryAllowed",
      "relaunchAllowed",
      "targetReleaseAllowed",
      "ownerIssuanceAllowed",
      "durableCommitObserved",
      "adapterCalls",
      "physicalOrigin",
      "binding",
      "finalDecisionEligible",
      "authority",
      "nonclaims",
    ],
  );
  assert.equal(trace.schema, TEST_TRACE_SCHEMA);
  assert.equal(trace.phase, LIFECYCLE[11]);
  assert.equal(trace.outcome, "FAIL");
  assert.equal(trace.retryAllowed, false);
  assert.equal(trace.relaunchAllowed, false);
  assert.equal(trace.targetReleaseAllowed, false);
  assert.equal(trace.ownerIssuanceAllowed, false);
  assert.equal(trace.physicalOrigin, false);
  assert.equal(trace.binding, null);
  assert.equal(trace.finalDecisionEligible, false);
  assert.deepEqual(
    trace.authority,
    plainClone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
  );
  assert.deepEqual(
    trace.nonclaims,
    plainClone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
  );
  assert.equal(Object.keys(trace.authority).length, 16);
  assert.equal(Object.keys(trace.nonclaims).length, 92);
  assert.deepEqual(new Set(Object.values(trace.authority)), new Set([false]));
  assert.deepEqual(new Set(Object.values(trace.nonclaims)), new Set([false]));
  assertDeepFrozen(trace);
  assert.equal(
    candidate.isG17BenchmarkPrivateBuildIssuerV1TestTrace(plainClone(trace)),
    false,
  );
  await assertFault(candidate, () =>
    candidate.runG17BenchmarkPrivateBuildIssuerV1(capability),
  );
  await assertFault(candidate, () =>
    candidate.runG17BenchmarkPrivateBuildIssuerV1({ ...capability }),
  );
  const foreignCandidate = createReferenceCandidate();
  const foreignCapability = createCapability(
    foreignCandidate,
    createFixture(),
    () => completeObservation(),
  );
  await assertFault(candidate, () =>
    candidate.runG17BenchmarkPrivateBuildIssuerV1(foreignCapability),
  );
  const cloneBeforeUse = createCapability(
    candidate,
    createFixture(),
    () => completeObservation(),
  );
  await assertFault(candidate, () =>
    candidate.runG17BenchmarkPrivateBuildIssuerV1({ ...cloneBeforeUse }),
  );
  const cloneControl = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
    cloneBeforeUse,
  );
  assert.equal(cloneControl.phase, LIFECYCLE[11]);

  const mutableScenario = createFixture();
  const snapshotCapability = createCapability(
    candidate,
    mutableScenario,
    () => completeObservation(),
  );
  mutableScenario.sourceWorkspaceRevalidated = false;
  mutableScenario.requestV2.schema = "changed-after-capture";
  const snapshotTrace = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
    snapshotCapability,
  );
  assert.equal(snapshotTrace.phase, LIFECYCLE[11]);

  const phaseInputs = [
    {
      scenario: createFixture({ predecessorAttestationsExact: false }),
      phase: 0,
      adapterCalls: 0,
    },
    {
      scenario: createFixture({ sourceWorkspaceRevalidated: false }),
      phase: 1,
      adapterCalls: 0,
    },
    {
      scenario: createFixture({
        requestV2: { ...fixture.requestV2, schema: `${fixture.requestV2.schema}-v3` },
      }),
      phase: 2,
      adapterCalls: 0,
    },
    {
      scenario: createFixture({
        helperAttestation: {
          ...fixture.helperAttestation,
          requestContentHash: "6".repeat(64),
        },
      }),
      phase: 3,
      adapterCalls: 0,
    },
  ];
  for (const item of phaseInputs) {
    let calls = 0;
    const phaseCapability = createCapability(candidate, item.scenario, () => {
      calls += 1;
      return completeObservation();
    });
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
      phaseCapability,
    );
    assert.equal(result.phase, LIFECYCLE[item.phase]);
    assert.equal(result.outcome, "FAIL");
    assert.equal(calls, item.adapterCalls);
  }

  for (const change of [
    { field: "requestRawSha256", value: "6".repeat(64) },
    { field: "requestContentHash", value: "6".repeat(64) },
    { field: "sourceLogicalName", value: "other-helper.c" },
    { field: "sourceSha256", value: "6".repeat(64) },
    { field: "executableSha256", value: "6".repeat(64) },
  ]) {
    const helperAttestation = {
      ...fixture.helperAttestation,
      [change.field]: change.value,
    };
    let calls = 0;
    const changed = createCapability(
      candidate,
      createFixture({ helperAttestation }),
      () => {
        calls += 1;
        return completeObservation();
      },
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(changed);
    assert.equal(result.phase, LIFECYCLE[3], `helper ${change.field}`);
    assert.equal(calls, 0);
  }
  for (const change of [
    { field: "fd", value: 7 },
    { field: "role", value: "cargoExecutable" },
    { field: "kind", value: "directory" },
    { field: "descriptorAccess", value: "write-only" },
    { field: "cloexecImmediatelyBeforeCargoExecveat", value: false },
    { field: "sourceLogicalName", value: "other-helper.c" },
    { field: "sourceSha256", value: "6".repeat(64) },
    { field: "executableSha256", value: "6".repeat(64) },
  ]) {
    const heldHelperFd8 = {
      ...fixture.heldHelperFd8,
      [change.field]: change.value,
    };
    let calls = 0;
    const changed = createCapability(
      candidate,
      createFixture({ heldHelperFd8 }),
      () => {
        calls += 1;
        return completeObservation();
      },
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(changed);
    assert.equal(result.phase, LIFECYCLE[3], `held FD-8 ${change.field}`);
    assert.equal(calls, 0);
  }

  for (const [field, phase] of [
    ["durableCommitObserved", 4],
    ["helperExecImageProven", 4],
    ["statusTerminalSequenceObserved", 5],
    ["reservedExitAgreementObserved", 5],
    ["statusWithinByteLimit", 5],
    ["statusWithinFrameLimit", 5],
    ["statusWithinTimeout", 5],
    ["statusEofObserved", 5],
    ["cargoExitObserved", 6],
    ["cargoJsonlValid", 6],
    ["stdoutClosedObserved", 6],
    ["stdoutEofObserved", 6],
    ["stdoutWithinBound", 6],
    ["stderrClosedObserved", 6],
    ["stderrEofObserved", 6],
    ["stderrWithinBound", 6],
    ["pidfdReadableObserved", 7],
    ["exclusiveWaitidPidfdObserved", 7],
    ["directChildReapObserved", 7],
    ["cgroupProcsEmptyObserved", 8],
    ["cgroupEventsPopulatedZeroObserved", 8],
    ["pidsCurrentZeroObserved", 8],
    ["cleanupOutcomeCertain", 8],
    ["heldTargetAncestryObserved", 9],
    ["heldTargetMetadataObserved", 9],
    ["heldTargetElfObserved", 9],
    ["productionWorkspaceFinishObserved", 10],
    ["buildOwnerV3Issued", 11],
  ]) {
    const phaseCapability = createCapability(candidate, createFixture(), () =>
      completeObservation({ [field]: false }),
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
      phaseCapability,
    );
    assert.equal(result.phase, LIFECYCLE[phase], field);
    const expectedOutcome = [
      "directChildReapObserved",
      "cgroupProcsEmptyObserved",
      "cgroupEventsPopulatedZeroObserved",
      "pidsCurrentZeroObserved",
      "cleanupOutcomeCertain",
    ].includes(field)
      ? "INCONCLUSIVE_RETAINED"
      : "FAIL";
    assert.equal(result.outcome, expectedOutcome, field);
    assert.equal(
      Object.values(result.retained).every(Boolean),
      expectedOutcome === "INCONCLUSIVE_RETAINED",
      field,
    );
  }

  for (const [changes, expectedPhase] of [
    [
      {
        statusTerminalSequenceObserved: false,
        cargoJsonlValid: false,
        heldTargetElfObserved: false,
      },
      5,
    ],
    [
      {
        cargoJsonlValid: false,
        cgroupProcsEmptyObserved: false,
        heldTargetElfObserved: false,
      },
      6,
    ],
    [
      {
        cgroupProcsEmptyObserved: false,
        heldTargetElfObserved: false,
        productionWorkspaceFinishObserved: false,
      },
      8,
    ],
  ]) {
    const precedenceCapability = createCapability(
      candidate,
      createFixture(),
      () => completeObservation(changes),
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
      precedenceCapability,
    );
    assert.equal(result.phase, LIFECYCLE[expectedPhase]);
  }

  for (const [label, descriptorBoundary] of descriptorBoundaryMutations()) {
    let calls = 0;
    const changed = createCapability(
      candidate,
      createFixture({ descriptorBoundary }),
      () => {
        calls += 1;
        return completeObservation();
      },
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(changed);
    assert.equal(result.phase, LIFECYCLE[3], label);
    assert.equal(result.outcome, "FAIL", label);
    assert.equal(calls, 0, label);
  }

  for (const [observation, expectedOutcome] of [
    [
      completeObservation({
        directChildReapObserved: false,
        heldTargetElfObserved: false,
      }),
      "INCONCLUSIVE_RETAINED",
    ],
    [
      completeObservation({
        cgroupEventsPopulatedZeroObserved: false,
        heldTargetElfObserved: false,
      }),
      "INCONCLUSIVE_RETAINED",
    ],
    [completeObservation({ heldTargetElfObserved: false }), "FAIL"],
  ]) {
    const retainedCapability = createCapability(
      candidate,
      createFixture(),
      () => observation,
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
      retainedCapability,
    );
    assert.equal(result.outcome, expectedOutcome);
    assert.equal(
      Object.values(result.retained).every(Boolean),
      expectedOutcome === "INCONCLUSIVE_RETAINED",
    );
    assert.equal(result.retryAllowed, false);
    assert.equal(result.relaunchAllowed, false);
    assert.equal(result.targetReleaseAllowed, false);
    assert.equal(result.ownerIssuanceAllowed, false);
  }

  const noChild = createCapability(candidate, createFixture(), () =>
    completeObservation({
      childMayExist: false,
      durableCommitObserved: false,
      helperExecImageProven: false,
    }),
  );
  const noChildTrace = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
    noChild,
  );
  assert.equal(noChildTrace.phase, LIFECYCLE[4]);
  assert.equal(noChildTrace.outcome, "FAIL");
  assert.deepEqual(
    new Set(Object.values(noChildTrace.retained)),
    new Set([false]),
  );

  for (const change of [
    (value) => ({ ...value, extra: true }),
    (value) => {
      const { statusEofObserved: _removed, ...missing } = value;
      return missing;
    },
    (value) => {
      const symbolic = { ...value };
      symbolic[Symbol("extra")] = true;
      return symbolic;
    },
    (value) => new Proxy(value, {}),
    (value) => {
      const accessor = { ...value };
      Object.defineProperty(accessor, "statusEofObserved", {
        enumerable: true,
        get() {
          throw new Error("status accessor executed");
        },
      });
      return accessor;
    },
    (value) => ({ ...value, statusEofObserved: "true" }),
  ]) {
    const invalidObservation = createCapability(
      candidate,
      createFixture(),
      () => change(completeObservation()),
    );
    const result = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
      invalidObservation,
    );
    assert.equal(result.phase, LIFECYCLE[4]);
    assert.equal(result.outcome, "INCONCLUSIVE_RETAINED");
    assert.deepEqual(new Set(Object.values(result.retained)), new Set([true]));
  }

  const dormantAllTrue = createCapability(candidate, createFixture(), () =>
    completeObservation({ buildOwnerV3Issued: true }),
  );
  const dormantAllTrueTrace =
    await candidate.runG17BenchmarkPrivateBuildIssuerV1(dormantAllTrue);
  assert.equal(dormantAllTrueTrace.outcome, "FAIL");
  assert.equal(dormantAllTrueTrace.physicalOrigin, false);
  assert.equal(dormantAllTrueTrace.targetReleaseAllowed, false);
  assert.equal(dormantAllTrueTrace.ownerIssuanceAllowed, false);

  const adapterFailure = createCapability(candidate, createFixture(), async () => {
    throw new Error("test adapter stopped without a terminal observation");
  });
  const retained = await candidate.runG17BenchmarkPrivateBuildIssuerV1(
    adapterFailure,
  );
  assert.equal(retained.phase, LIFECYCLE[4]);
  assert.equal(retained.outcome, "INCONCLUSIVE_RETAINED");
  assert.deepEqual(new Set(Object.values(retained.retained)), new Set([true]));

  if (source !== null) {
    const importSpecifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gmu),
    ].map((match) => match[1]);
    assert.deepEqual([...new Set(importSpecifiers)].sort(), [
      "./benchmark-private-build-issuer-v1-contract.mjs",
      "node:util",
    ]);
    for (const forbidden of [
      /node:(?:fs|child_process|os|net|http|https|dgram|cluster|worker_threads)/u,
      /product-source-workspace/u,
      /containment-guardian-(?:statefs|manager|native|recovery)/u,
      /application-receipt|qualification-runner/u,
      /openrouter/iu,
      /\bprocess(?:\.|\[)/u,
      /\bimport\s*\(/u,
      /\b(?:eval|Function)\s*\(/u,
      /\b(?:fetch|setTimeout|setInterval|queueMicrotask)\s*\(/u,
      /\b(?:spawn|spawnSync|exec|execFile|fork)\s*\(/u,
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
  }
}

async function sourcePresence() {
  try {
    const status = await lstat(SOURCE_URL);
    return Object.freeze({ present: true, regular: status.isFile() });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return Object.freeze({ present: false, regular: false });
  }
}

function exactMissingSourceError(error, presence) {
  const expectedMessage =
    `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`;
  if (
    presence.present ||
    error === null ||
    typeof error !== "object" ||
    error.code !== "ERR_MODULE_NOT_FOUND" ||
    error.message !== expectedMessage
  ) {
    return false;
  }
  return error.url === undefined || error.url === SOURCE_URL.href;
}

const presence = await sourcePresence();
if (presence.present && !presence.regular) {
  throw new Error("G17_PRIVATE_BUILD_ISSUER_SOURCE_NOT_REGULAR");
}
let candidate = null;
let candidateSource = null;
let candidateImportError = null;
let candidateImportAttempts = 0;
try {
  candidateImportAttempts += 1;
  candidate = await import(SOURCE_URL.href);
  candidateSource = await readFile(SOURCE_URL, "utf8");
} catch (error) {
  if (!exactMissingSourceError(error, presence)) throw error;
  candidateImportError = error;
}

function candidateTest(name, body) {
  test(
    name,
    {
      skip:
        candidate === null
          ? "candidate physical-issuer source is intentionally absent"
          : false,
    },
    body,
  );
}

test("ADR-0041 S3 pins selected exact S2 and ADR-0037/0038 repository interfaces", async () => {
  for (const [path, expectedBytes, expectedSha256] of EXACT_PREDECESSOR_INPUTS) {
    const bytes = await readFile(new URL(path, REPOSITORY_ROOT));
    assert.equal(bytes.length, expectedBytes, path);
    assert.equal(sha256(bytes), expectedSha256, path);
  }
});

test("ADR-0041 S3 freezes predecessor interfaces without rewriting dormant S2 activation fields", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  assert.equal(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
    EXPECTED_INTERFACE_IDENTITIES.privateIssuerRequirements,
  );
  assert.equal(created.artifact.bytes.length, 26_543);
  assert.equal(
    created.artifact.rawSha256,
    "9d08f2c7edc43c5151b40c335d0309c743c22515bb16d4473535724940cbf9fa",
  );
  assert.deepEqual(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.predecessors.activationDependencies.map(
      ({ adr, exactInterface, available }) => ({ adr, exactInterface, available }),
    ),
    [
      { adr: "ADR-0037", exactInterface: null, available: false },
      { adr: "ADR-0038", exactInterface: null, available: false },
      { adr: "ADR-0039", exactInterface: undefined, available: false },
      { adr: "ADR-0040", exactInterface: null, available: false },
    ],
  );
  assert.equal(Object.keys(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY).length, 16);
  assert.equal(Object.keys(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS).length, 92);
  assert.deepEqual(EXPECTED_INTERFACE_IDENTITIES, {
    privateIssuerRequirements:
      G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
    statefsRequirements:
      CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
    managerRequirements:
      CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256,
    statefsBuildRequirements:
      CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256,
    statefsObject:
      "73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043",
    nativeReplayRequirements:
      CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1,
    recoveryRequirements:
      CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1,
    transitionConsumerRequirements:
      CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256,
  });
});

test("ADR-0041 S3 reference freezes the dormant private-issuer contract", async () => {
  await assertCandidateContract(createReferenceCandidate());
});

candidateTest("ADR-0041 S3 candidate satisfies the frozen dormant evaluator", async () => {
  await assertCandidateContract(candidate, candidateSource);
});

test.todo(
  "host-positive evaluator amendment: freeze the exact co-located production entrypoint after ADR-0039/0040 interfaces exist",
);
test.todo(
  "host-positive evaluator amendment: freeze held FD-8, helper, streams, exclusive wait, quiescence, and target-ELF observations",
);
test.todo(
  "host-positive gate: run the amended evaluator unchanged only with exact receipt-bound same-host activation",
);

test("missing-source attribution rejects wrong code, URL, message, and present source", () => {
  const shape = {
    code: "ERR_MODULE_NOT_FOUND",
    url: SOURCE_URL.href,
    message: `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
  };
  const absent = { present: false };
  assert.equal(exactMissingSourceError(shape, absent), true);
  assert.equal(exactMissingSourceError({ ...shape, code: "ENOENT" }, absent), false);
  assert.equal(
    exactMissingSourceError({ ...shape, url: `${shape.url}.other` }, absent),
    false,
  );
  assert.equal(
    exactMissingSourceError({ ...shape, message: `${shape.message}.other` }, absent),
    false,
  );
  const { url: _url, ...nodeTwentyShape } = shape;
  assert.equal(exactMissingSourceError(nodeTwentyShape, absent), true);
  assert.equal(exactMissingSourceError(shape, { present: true }), false);
});

test("ADR-0041 S3 RED reports only the exact missing private-issuer source", () => {
  assert.equal(candidateImportAttempts, 1);
  if (candidateImportError !== null) {
    assert.equal(candidate, null);
    assert.equal(candidateSource, null);
    throw candidateImportError;
  }
  assert.notEqual(candidate, null);
});
