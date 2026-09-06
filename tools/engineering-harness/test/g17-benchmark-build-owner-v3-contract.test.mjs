import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as fsConstants, readFileSync } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, types } from "node:util";

import { G17_BENCHMARK_BUILD_PLAN } from "../src/qualification/benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
} from "../src/qualification/benchmark-private-build-issuer-v1-contract.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  verifyG17BenchmarkExecutionRequestV2Artifact,
} from "../src/qualification/benchmark-execution-request-v2-contract.mjs";
import {
  createG17BenchmarkPrivateBuildIssuerV1ForTesting,
  isG17BenchmarkPrivateBuildIssuerV1Fault,
  isG17BenchmarkPrivateBuildIssuerV1TestTrace,
  runG17BenchmarkPrivateBuildIssuerV1,
} from "../src/qualification/benchmark-private-build-issuer-v1.mjs";
import { verifyG17CargoExecveatHelperAttestationArtifact } from "../src/qualification/cargo-execveat-helper-attestation-contract.mjs";
import { verifyG17CargoExecveatStatusProtocol } from "../src/qualification/cargo-execveat-status-protocol-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
  verifyG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import { G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256 } from "../src/qualification/non-tmpfs-containment-v2-contract.mjs";
import { verifyG17NonTmpfsContainmentV2Artifact } from "../src/qualification/non-tmpfs-containment-v2-contract.mjs";
import { parseG17Elf64 } from "../src/qualification/native-elf.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  cleanupG17PrivateOwnerV3Fixtures,
  createG17PrivateOwnerV3Fixture,
  G17_PRIVATE_OWNER_V3_TEST_FIXTURE_SCHEMA,
  g17PrivateOwnerV3CanonicalBytes,
  g17PrivateOwnerV3Clone,
  g17PrivateOwnerV3Seal,
  g17PrivateOwnerV3Sha256,
} from "./support/g17-private-owner-v3-v4-fixtures.mjs";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const SOURCE_URL = new URL(
  "../src/qualification/benchmark-build-owner-v3-contract.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const MAX_CANDIDATE_SOURCE_BYTES = 512 * 1024;
const MAX_CANDIDATE_AST_NODES = 100_000;
const MAX_CANDIDATE_TOKENS = MAX_CANDIDATE_AST_NODES * 4;
const MAX_CANDIDATE_DELIMITER_DEPTH = 256;
const EXPECTED_ACORN = Object.freeze({
  version: "8.18.0",
  integrity:
    "sha512-lGq+9yr1/GuAWaVYIHRjvvySG5/4VfKIvC8EWxStPdcDh/Ka7FG3twP6v4d5BkravUilhIAsG4Qj83t02LWUPQ==",
  license: "MIT",
  packageJsonSha256:
    "5c1ed7259579a7899b303f514b0194adcb9fe474fc7d136a84c6a45f10eefc84",
  importEntrypoint: "./dist/acorn.mjs",
  importEntrypointSha256:
    "953573b8fdab71599749ea5f2b33d3e760c2116178f9423ee7458dbe39d59453",
});
const ACORN_PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 2022,
  sourceType: "module",
  allowAwaitOutsideFunction: false,
  allowHashBang: false,
  allowReturnOutsideFunction: false,
  preserveParens: true,
});
const ACORN_PACKAGE_URL = new URL(
  "../node_modules/acorn/package.json",
  import.meta.url,
);
const ACORN_IMPORT_ENTRYPOINT_URL = new URL(
  EXPECTED_ACORN.importEntrypoint,
  ACORN_PACKAGE_URL,
);

const OWNER_SCHEMA = "oxigraph.g1.7-benchmark-build-owner/v3";
const PROJECTION_SCHEMA = "oxigraph.g1.7-benchmark-build-owner-projection/v3";
const ARTIFACT_NAME = "benchmark-build-owner-v3.json";
const STATUS = "BUILD_OWNER_V3_REPLAYED_AUTHORITY_NULL";
const READINESS = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const MAX_BYTES = 4 * 1024 * 1024;
const LIMITS = deepFreeze({
  artifactMaximumBytes: MAX_BYTES,
  sourceProjectionMaximumBytes: 16 * 1024 * 1024,
  executionRequestV2MaximumBytes: 2 * 1024 * 1024,
  helperAttestationV1MaximumBytes: 4 * 1024 * 1024,
  statusTranscriptV1MaximumBytes: 4_096,
  isolationPolicyV2MaximumBytes:
    G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
  containmentV2MaximumBytes: 2 * 1024 * 1024,
  combinedOutputMaximumBytes: 64 * 1024 * 1024,
  executableMaximumBytes: 64 * 1024 * 1024,
  cgroupFileMaximumBytes: 64 * 1024,
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumArrayLength: 4_096,
  maximumPropertiesPerRecord: 4_097,
  aggregateStringUtf8MaximumBytes: 16 * 1024 * 1024,
  singleStringUtf8MaximumBytes: 1024 * 1024,
  propertyNamesCountTowardAggregateStringBudget: true,
  buffersExcludedFromStructuredNodeAndStringBudgets: true,
});
const ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "PRIVATE_CAPABILITY_INVALID",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "IDENTITY_INVALID",
  "PREDECESSOR_BINDING_DRIFT",
  "OBSERVATION_BINDING_DRIFT",
  "LIFECYCLE_CONTRADICTION",
  "AUTHORITY_OVERCLAIM",
  "EXPECTED_INPUT_MISMATCH",
]);
const AUTHORITY = deepFreeze(
  g17PrivateOwnerV3Clone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
);
const NONCLAIMS = deepFreeze({
  ...g17PrivateOwnerV3Clone(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
  serializedReplayProvesPrivateCapabilityConsumption: false,
  syntheticTestCapabilityProvesIssuerOrigin: false,
  buildOwnerV3PhysicalOriginProven: false,
});

function expectedPrivateIssuerTrace() {
  return {
    schema: "oxigraph.g1.7-benchmark-private-build-issuer-test-trace/v1",
    phase: "canonical-build-owner-v3-issuance",
    outcome: "FAIL",
    retained: {
      workspace: false,
      cgroup: false,
      descriptors: false,
      handles: false,
      evidence: false,
    },
    retryAllowed: false,
    relaunchAllowed: false,
    targetReleaseAllowed: false,
    ownerIssuanceAllowed: false,
    durableCommitObserved: true,
    adapterCalls: 1,
    physicalOrigin: false,
    binding: null,
    finalDecisionEligible: false,
    authority: g17PrivateOwnerV3Clone(
      G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
    ),
    nonclaims: g17PrivateOwnerV3Clone(
      G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
    ),
  };
}
const EXPECTED_EXPORTS = Object.freeze([
  "G17_BENCHMARK_BUILD_OWNER_V3_ARTIFACT_NAME",
  "G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY",
  "G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES",
  "G17_BENCHMARK_BUILD_OWNER_V3_LIMITS",
  "G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES",
  "G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS",
  "G17_BENCHMARK_BUILD_OWNER_V3_PROJECTION_SCHEMA",
  "G17_BENCHMARK_BUILD_OWNER_V3_SCHEMA",
  "G17BenchmarkBuildOwnerV3ContractError",
  "createG17BenchmarkBuildOwnerV3Artifact",
  "createG17BenchmarkBuildOwnerV3CapabilityForTesting",
  "g17BenchmarkBuildOwnerV3Readiness",
  "verifyG17BenchmarkBuildOwnerV3Artifact",
]);
const ROOT_KEYS = Object.freeze([
  "schema",
  "status",
  "identity",
  "bindings",
  "observations",
  "physicalOrigin",
  "binding",
  "finalDecisionEligible",
  "authority",
  "nonclaims",
  "contentHash",
]);
const IDENTITY_KEYS = Object.freeze([
  "controlRunId",
  "buildId",
  "productRole",
  "ordinal",
  "ownerGeneration",
  "workspaceGeneration",
  "targetGeneration",
  "processGeneration",
  "containmentGeneration",
  "lifecycleGeneration",
]);
const BINDING_KEYS = Object.freeze([
  "issuerRequirements",
  "sourceProjection",
  "executionRequestV2",
  "helperAttestationV1",
  "statusTranscriptV1",
  "isolationPolicyV2",
  "containmentV2",
  "qualifiedNativeAdapter",
  "qualifiedDurableEffect",
]);
const OBSERVATION_KEYS = Object.freeze([
  "helperImage",
  "status",
  "process",
  "streams",
  "cargo",
  "directReap",
  "cgroupQuiescence",
  "target",
  "workspaceFinish",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const ISSUER_REQUIREMENTS_RAW_SHA256 =
  "9d08f2c7edc43c5151b40c335d0309c743c22515bb16d4473535724940cbf9fa";
const HELPER_SOURCE_SHA256 =
  "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9";
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const CARGO_EXECUTABLE_PATH =
  /^\/state\/target\/release\/deps\/transactional_write-[0-9a-f]{16}$/u;
const GENERATIONS = Object.freeze({
  ownerGeneration: /^g17-owner-[0-9a-f]{64}$/u,
  workspaceGeneration: /^g17-workspace-[0-9a-f]{64}$/u,
  targetGeneration: /^g17-target-[0-9a-f]{64}$/u,
  processGeneration: /^g17-process-[0-9a-f]{64}$/u,
  containmentGeneration: /^g17-containment-[0-9a-f]{64}$/u,
  lifecycleGeneration: /^g17-lifecycle-[0-9a-f]{64}$/u,
});
const SOURCE_AUTHORIZATION = Object.freeze({
  contentHash:
    "964563a364844933066b654dd330841039a140eecbb4aed3d1fe0ae205fb5843",
  rawSha256: "8ae3992245f4075047b284688fdeed8fb4b252eac235e1ee0aa4ecfe5bc8107b",
});
const SOURCE_IDENTITIES = deepFreeze({
  "negative-control": {
    cargoLockBytes: 80_849,
    effectiveTree: "4949301d1b66d7a104692d12230023757bdf1ca0",
    entryCount: 3_643,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "d7f48ddec5de69278331cda275d26409ae0d71dda7b9c0938aa4e017bb525f0b",
    objectClosureSha256:
      "c696f36ad9b3685e74b7ccea467b24311a73a95472ffccb7791670f1fafde946",
    totalBytes: 55_442_023,
  },
  "performance-reference": {
    cargoLockBytes: 80_849,
    effectiveTree: "2f800745c958c8d749af40ae66324c41f6fe409b",
    entryCount: 3_741,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "c7561984854820bd7334b37ea10bfc42b86cc70cb436f4f7068cdee220604840",
    objectClosureSha256:
      "15c3383bbc2a86e8fca7bcd1485bcf3ae142658b226a87d77ce853c9dfa75eda",
    totalBytes: 56_312_782,
  },
  "noise-control-a": {
    cargoLockBytes: 80_849,
    effectiveTree: "a8b0310482b88a813aa602ebb7264b259e066586",
    entryCount: 3_774,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "4a3b41efe8883ec3c77a5ec752c34b20d56c3080bd9c1df05fcffb91b9300473",
    objectClosureSha256:
      "305374693bba169a812f62b2eac4208f3355a5582401e12421b9194aa7b86b75",
    totalBytes: 56_959_926,
  },
  "noise-control-b": {
    cargoLockBytes: 80_849,
    effectiveTree: "a8b0310482b88a813aa602ebb7264b259e066586",
    entryCount: 3_774,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "4a3b41efe8883ec3c77a5ec752c34b20d56c3080bd9c1df05fcffb91b9300473",
    objectClosureSha256:
      "305374693bba169a812f62b2eac4208f3355a5582401e12421b9194aa7b86b75",
    totalBytes: 56_959_926,
  },
});
const FIXTURE_KEYS = Object.freeze([
  "schema",
  "identity",
  "issuerRequirements",
  "sourceProjectionBytes",
  "executionRequestV2Verification",
  "helperAttestationV1Verification",
  "statusTranscriptV1Verification",
  "isolationPolicyV2Bytes",
  "containmentV2Verification",
  "stdoutBytes",
  "stderrBytes",
  "cgroupProcsBytes",
  "cgroupEventsBytes",
  "cgroupPidsCurrentBytes",
  "executableBytes",
  "observations",
  "qualifiedNativeAdapter",
  "qualifiedDurableEffect",
]);
const PREDECESSORS = Object.freeze([
  [
    "tools/engineering-harness/src/qualification/benchmark-private-build-issuer-v1.mjs",
    13_884,
    "2ff35fc6a6748c50c8d88cffe4d137b07e39c3dc9be66147ca2631fb86f7ac21",
  ],
  [
    "tools/engineering-harness/src/qualification/benchmark-private-build-issuer-v1-contract.mjs",
    43_702,
    "4bdbdbad7a657e4506fbea371257b072e638c76fad211476e32a0292f63792e1",
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
    "tools/engineering-harness/src/qualification/non-tmpfs-build-isolation-contract.mjs",
    9_389,
    "04f7e7c3ec121c90594eddcc74d21b11c05881d87490f2ffc0c6eb3618bdf8ad",
  ],
  [
    "tools/engineering-harness/src/qualification/contract.mjs",
    20_060,
    "5f22b1e871f88c316fc0207ff2dfd3bd02fa5aebdba3428ae13f364f60c6e55a",
  ],
  [
    "tools/engineering-harness/src/qualification/control-protocol.mjs",
    29_545,
    "0437c6d564ea93e17acac5066c287b7e8de5c687736503721b72d99910bf0d12",
  ],
  [
    "tools/engineering-harness/src/qualification/native-snapshot.mjs",
    21_740,
    "70208aec8e483a9f8be5a75c751db07bc69fd30f9cc285c350297a5a779d25d1",
  ],
  [
    "tools/engineering-harness/src/qualification/native-snapshot-helper.c",
    26_533,
    "0e80104206a95c115f18c629bf7fa21785aad5b80fc690b11f4144700143e81c",
  ],
  [
    "tools/engineering-harness/test/support/g17-successor-artifact-fixtures.mjs",
    7_063,
    "0f3d302c14045b7f4d841cc6d5111674c6c717e80ae94362a08ff619b7874cda",
  ],
  [
    "tools/engineering-harness/src/qualification/benchmark-execution-plan.mjs",
    9_114,
    "99b70fc6820fe3b5743bccac349cd7936aa3a04abc0e13f254f1ffee86f0e478",
  ],
  [
    "tools/engineering-harness/src/qualification/native-elf.mjs",
    10_660,
    "3bd495bd808c9376b8f81d2ec37834d4b22c68acddb658213ec4a721deb44c8b",
  ],
  [
    "tools/engineering-harness/src/routing/features.mjs",
    2_740,
    "0a1f13a2c85ec0b40f967192dd23d8fda967b9f4eef1825a50a74e995aba5f2d",
  ],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pinParserDependencyBeforeCandidateRead() {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const installedPackageBytes = readFileSync(ACORN_PACKAGE_URL);
  const installed = JSON.parse(installedPackageBytes.toString("utf8"));
  assert.deepEqual(manifest.devDependencies, { acorn: "latest" });
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  const locked = lock.packages["node_modules/acorn"];
  assert.deepEqual(
    {
      version: locked?.version,
      integrity: locked?.integrity,
      license: locked?.license,
    },
    {
      version: EXPECTED_ACORN.version,
      integrity: EXPECTED_ACORN.integrity,
      license: EXPECTED_ACORN.license,
    },
  );
  assert.equal(Object.hasOwn(locked, "dependencies"), false);
  assert.deepEqual(
    { version: installed.version, license: installed.license },
    { version: EXPECTED_ACORN.version, license: EXPECTED_ACORN.license },
  );
  assert.equal(sha256(installedPackageBytes), EXPECTED_ACORN.packageJsonSha256);
  assert.equal(
    installed.exports?.["."]?.[0]?.import,
    EXPECTED_ACORN.importEntrypoint,
  );
  const entrypointBytes = readFileSync(ACORN_IMPORT_ENTRYPOINT_URL);
  assert.equal(sha256(entrypointBytes), EXPECTED_ACORN.importEntrypointSha256);
  return Object.freeze({
    audit: Object.freeze({
      completedBeforeCandidateRead: true,
      policy: manifest.devDependencies.acorn,
      ...EXPECTED_ACORN,
    }),
    importUrl: `data:text/javascript;base64,${entrypointBytes.toString(
      "base64",
    )}#sha256=${EXPECTED_ACORN.importEntrypointSha256}`,
  });
}

const PARSER_SNAPSHOT = pinParserDependencyBeforeCandidateRead();
const SYNCHRONOUS_PARSER_AUDIT = PARSER_SNAPSHOT.audit;
const acornModule = await import(PARSER_SNAPSHOT.importUrl);
assert.equal(acornModule.version, EXPECTED_ACORN.version);
assert.equal(typeof acornModule.parse, "function");
assert.equal(typeof acornModule.tokenizer, "function");
const parse = acornModule.parse;
const tokenizer = acornModule.tokenizer;
const PARSER_LOAD_AUDIT = Object.freeze({
  completedAfterIdentityPin: true,
  completedBeforeCandidateRead: true,
  entrypoint: EXPECTED_ACORN.importEntrypoint,
  exactSnapshotImport: true,
  tokenizerVerified: true,
  version: acornModule.version,
});

function preflightCandidateModuleTokens(
  source,
  maximumTokens = MAX_CANDIDATE_TOKENS,
  maximumDelimiterDepth = MAX_CANDIDATE_DELIMITER_DEPTH,
) {
  const closingDelimiter = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["${", "}"],
    ["`", "`"],
  ]);
  const delimiters = [];
  let tokenCount = 0;
  const tokenStream = tokenizer(source, ACORN_PARSE_OPTIONS);
  for (;;) {
    const token = tokenStream.getToken();
    const label = token.type.label;
    if (label === "eof") break;
    tokenCount += 1;
    assert.equal(
      tokenCount <= maximumTokens,
      true,
      "candidate static validation: token limit exceeded",
    );
    if (label === "`" && delimiters.at(-1) === "`") {
      delimiters.pop();
    } else if (closingDelimiter.has(label)) {
      delimiters.push(label);
      assert.equal(
        delimiters.length <= maximumDelimiterDepth,
        true,
        "candidate static validation: delimiter nesting limit exceeded",
      );
    } else if ([")", "]", "}"].includes(label)) {
      const opener = delimiters.pop();
      assert.equal(
        closingDelimiter.get(opener) === label,
        true,
        "candidate static validation: delimiter nesting mismatch",
      );
    }
  }
  assert.deepEqual(
    delimiters,
    [],
    "candidate static validation: unterminated delimiter nesting",
  );
  return tokenCount;
}

function parseCandidateModuleAst(
  source,
  maximumNodes = MAX_CANDIDATE_AST_NODES,
) {
  try {
    preflightCandidateModuleTokens(source);
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
    throw new Error(
      `candidate static validation: invalid ECMAScript module syntax: ${error.message}`,
    );
  }
  let program;
  try {
    program = parse(source, ACORN_PARSE_OPTIONS);
  } catch (error) {
    throw new Error(
      `candidate static validation: invalid ECMAScript module syntax: ${error.message}`,
    );
  }
  assert.equal(program.type, "Program");
  assert.equal(program.sourceType, "module");
  const stack = [program];
  const visited = new WeakSet();
  let nodeCount = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (visited.has(node)) continue;
    visited.add(node);
    nodeCount += 1;
    assert.equal(
      nodeCount <= maximumNodes,
      true,
      "candidate static validation: AST node limit exceeded",
    );
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child !== null && typeof child?.type === "string") {
            stack.push(child);
          }
        }
      } else if (value !== null && typeof value?.type === "string") {
        stack.push(value);
      }
    }
  }
  return Object.freeze({ program, nodeCount });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  )
    return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function captureCallerInputState(root) {
  const records = [];
  const seen = new WeakSet();
  const visit = (value) => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    records.push({
      value,
      prototype: Object.getPrototypeOf(value),
      extensible: Object.isExtensible(value),
      sealed: Object.isSealed(value),
      frozen: Object.isFrozen(value),
      descriptors,
      bytes: Buffer.isBuffer(value) ? Buffer.from(value) : null,
    });
    for (const descriptor of Object.values(descriptors)) {
      if (Object.hasOwn(descriptor, "value")) visit(descriptor.value);
    }
  };
  visit(root);
  return (label) => {
    for (const record of records) {
      assert.equal(
        Object.getPrototypeOf(record.value),
        record.prototype,
        `${label} prototype`,
      );
      assert.equal(
        Object.isExtensible(record.value),
        record.extensible,
        `${label} extensibility`,
      );
      assert.equal(
        Object.isSealed(record.value),
        record.sealed,
        `${label} sealed state`,
      );
      assert.equal(
        Object.isFrozen(record.value),
        record.frozen,
        `${label} frozen state`,
      );
      const after = Object.getOwnPropertyDescriptors(record.value);
      assert.deepEqual(
        Reflect.ownKeys(after),
        Reflect.ownKeys(record.descriptors),
        `${label} own keys`,
      );
      for (const key of Reflect.ownKeys(record.descriptors)) {
        const beforeDescriptor = record.descriptors[key];
        const afterDescriptor = after[key];
        assert.equal(
          afterDescriptor.enumerable,
          beforeDescriptor.enumerable,
          `${label} ${String(key)} enumerable`,
        );
        assert.equal(
          afterDescriptor.configurable,
          beforeDescriptor.configurable,
          `${label} ${String(key)} configurable`,
        );
        if (Object.hasOwn(beforeDescriptor, "value")) {
          assert.equal(
            afterDescriptor.writable,
            beforeDescriptor.writable,
            `${label} ${String(key)} writable`,
          );
          assert.equal(
            afterDescriptor.value,
            beforeDescriptor.value,
            `${label} ${String(key)} value identity`,
          );
        } else {
          assert.equal(
            afterDescriptor.get,
            beforeDescriptor.get,
            `${label} ${String(key)} getter`,
          );
          assert.equal(
            afterDescriptor.set,
            beforeDescriptor.set,
            `${label} ${String(key)} setter`,
          );
        }
      }
      if (record.bytes !== null) {
        assert.deepEqual(record.value, record.bytes, `${label} bytes`);
      }
    }
  };
}

function exactKeys(value, keys, label, fail) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", `${label} fields drifted`);
  }
  return value;
}

function walkAst(node, visit, parent = null) {
  if (node === null || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node, parent);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const entry of child) walkAst(entry, visit, node);
    } else {
      walkAst(child, visit, node);
    }
  }
}

function assertScopedAmbientReferencePolicy(ast, source) {
  const allowedNodeTypes = new Set([
    "ArrayExpression",
    "ArrayPattern",
    "ArrowFunctionExpression",
    "AssignmentExpression",
    "AssignmentPattern",
    "AwaitExpression",
    "BinaryExpression",
    "BlockStatement",
    "BreakStatement",
    "CallExpression",
    "CatchClause",
    "ChainExpression",
    "ClassBody",
    "ClassDeclaration",
    "ClassExpression",
    "ConditionalExpression",
    "ContinueStatement",
    "DoWhileStatement",
    "EmptyStatement",
    "ExportNamedDeclaration",
    "ExportSpecifier",
    "ExpressionStatement",
    "ForInStatement",
    "ForOfStatement",
    "ForStatement",
    "FunctionDeclaration",
    "FunctionExpression",
    "Identifier",
    "IfStatement",
    "ImportDeclaration",
    "ImportSpecifier",
    "LabeledStatement",
    "Literal",
    "LogicalExpression",
    "MemberExpression",
    "MethodDefinition",
    "NewExpression",
    "ObjectExpression",
    "ObjectPattern",
    "ParenthesizedExpression",
    "Program",
    "Property",
    "PropertyDefinition",
    "RestElement",
    "ReturnStatement",
    "SequenceExpression",
    "SpreadElement",
    "StaticBlock",
    "Super",
    "SwitchCase",
    "SwitchStatement",
    "TemplateElement",
    "TemplateLiteral",
    "ThisExpression",
    "ThrowStatement",
    "TryStatement",
    "UnaryExpression",
    "UpdateExpression",
    "VariableDeclaration",
    "VariableDeclarator",
    "WhileStatement",
  ]);
  const parentForNode = new WeakMap();
  walkAst(ast, (node, parent) => {
    assert.equal(
      allowedNodeTypes.has(node.type),
      true,
      `candidate static validation: unsupported Node 20 AST node ${node.type}`,
    );
    if (parent !== null) parentForNode.set(node, parent);
  });
  const scopeForNode = new WeakMap();
  const bindingIdentifiers = new WeakSet();
  const declaredBindingForIdentifier = new WeakMap();
  const moduleScope = { kind: "module", parent: null, bindings: new Set() };
  const childScope = (kind, parent) => ({ kind, parent, bindings: new Set() });
  const bindingRecords = new WeakMap();
  const recordsForScope = (scope) => {
    let records = bindingRecords.get(scope);
    if (records === undefined) {
      records = new Map();
      bindingRecords.set(scope, records);
    }
    return records;
  };
  const declareIdentifier = (identifier, scope, declarationKind, metadata) => {
    scope.bindings.add(identifier.name);
    bindingIdentifiers.add(identifier);
    const records = recordsForScope(scope);
    let binding = records.get(identifier.name);
    if (binding === undefined) {
      binding = {
        name: identifier.name,
        scope,
        declarationKinds: new Set(),
        declarations: [],
        references: [],
        importSource: null,
        importedName: null,
      };
      records.set(identifier.name, binding);
    }
    binding.declarationKinds.add(declarationKind);
    binding.declarations.push(identifier);
    if (metadata !== undefined) Object.assign(binding, metadata);
    declaredBindingForIdentifier.set(identifier, binding);
    return binding;
  };
  const nearestVarScope = (scope) => {
    let current = scope;
    while (
      current.kind !== "function" &&
      current.kind !== "module" &&
      current.kind !== "static-block"
    ) {
      current = current.parent;
    }
    return current;
  };
  const bindPattern = (pattern, scope, declarationKind = "pattern") => {
    if (pattern === null) return;
    if (pattern.type === "Identifier") {
      declareIdentifier(pattern, scope, declarationKind);
      return;
    }
    if (pattern.type === "RestElement") {
      bindPattern(pattern.argument, scope, declarationKind);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      bindPattern(pattern.left, scope, declarationKind);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) {
        bindPattern(element, scope, declarationKind);
      }
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        bindPattern(
          property.type === "RestElement" ? property.argument : property.value,
          scope,
          declarationKind,
        );
      }
    }
  };
  const children = (node) =>
    Object.values(node).flatMap((value) =>
      Array.isArray(value)
        ? value.filter(
            (child) =>
              child !== null &&
              typeof child === "object" &&
              typeof child.type === "string",
          )
        : value !== null &&
            typeof value === "object" &&
            typeof value.type === "string"
          ? [value]
          : [],
    );
  const buildScopes = (node, scope) => {
    scopeForNode.set(node, scope);
    if (node.type === "Program") {
      for (const child of children(node)) buildScopes(child, scope);
      return;
    }
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        declareIdentifier(specifier.local, scope, "import", {
          importSource: node.source.value,
          importedName: specifier.imported.name,
        });
      }
      for (const child of children(node)) {
        scopeForNode.set(child, scope);
        for (const descendant of children(child))
          buildScopes(descendant, scope);
      }
      return;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      if (node.type === "FunctionDeclaration" && node.id !== null) {
        declareIdentifier(node.id, scope, "function");
      }
      const parameterScope = childScope("parameters", scope);
      if (node.type === "FunctionExpression" && node.id !== null) {
        declareIdentifier(node.id, parameterScope, "function-name");
      }
      if (node.id !== null) scopeForNode.set(node.id, parameterScope);
      for (const parameter of node.params) {
        bindPattern(parameter, parameterScope, "parameter");
        buildScopes(parameter, parameterScope);
      }
      const functionScope = childScope("function", parameterScope);
      buildScopes(node.body, functionScope);
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration" && node.id !== null) {
        declareIdentifier(node.id, scope, "class");
      }
      const classScope = childScope("class", scope);
      if (node.type === "ClassExpression" && node.id !== null) {
        declareIdentifier(node.id, classScope, "class-name");
      }
      if (node.id !== null) scopeForNode.set(node.id, classScope);
      if (node.superClass !== null) buildScopes(node.superClass, classScope);
      buildScopes(node.body, classScope);
      return;
    }
    if (node.type === "CatchClause") {
      const catchScope = childScope("catch", scope);
      if (node.param !== null) {
        bindPattern(node.param, catchScope, "catch");
        buildScopes(node.param, catchScope);
      }
      buildScopes(node.body, catchScope);
      return;
    }
    if (node.type === "SwitchStatement") {
      buildScopes(node.discriminant, scope);
      const switchScope = childScope("block", scope);
      for (const switchCase of node.cases) {
        scopeForNode.set(switchCase, switchScope);
        if (switchCase.test !== null) {
          buildScopes(switchCase.test, switchScope);
        }
        for (const consequent of switchCase.consequent) {
          buildScopes(consequent, switchScope);
        }
      }
      return;
    }
    if (node.type === "StaticBlock") {
      const staticBlockScope = childScope("static-block", scope);
      scopeForNode.set(node, staticBlockScope);
      for (const child of children(node)) {
        buildScopes(child, staticBlockScope);
      }
      return;
    }
    if (
      node.type === "BlockStatement" ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      const blockScope = childScope("block", scope);
      scopeForNode.set(node, blockScope);
      for (const child of children(node)) buildScopes(child, blockScope);
      return;
    }
    if (node.type === "VariableDeclaration") {
      const target = node.kind === "var" ? nearestVarScope(scope) : scope;
      for (const declaration of node.declarations) {
        bindPattern(declaration.id, target, node.kind);
      }
    }
    for (const child of children(node)) buildScopes(child, scope);
  };
  buildScopes(ast, moduleScope);

  const resolveBinding = (name, scope) => {
    let current = scope;
    while (current !== null) {
      if (current.bindings.has(name)) {
        return recordsForScope(current).get(name);
      }
      current = current.parent;
    }
    return null;
  };
  const resolves = (name, scope) => resolveBinding(name, scope) !== null;
  const allowedAmbientIdentifiers = new Set([
    "Array",
    "ArrayBuffer",
    "Buffer",
    "Error",
    "JSON",
    "Number",
    "Object",
    "Reflect",
    "Set",
    "String",
    "TextDecoder",
    "TypeError",
    "WeakMap",
    "WeakSet",
    "undefined",
  ]);
  const allowedAmbientMembers = new Map([
    ["Array", new Set(["isArray", "prototype"])],
    ["ArrayBuffer", new Set(["isView"])],
    ["Buffer", new Set(["byteLength", "from", "isBuffer", "prototype"])],
    ["JSON", new Set(["parse"])],
    ["Number", new Set(["isFinite", "isSafeInteger"])],
    [
      "Object",
      new Set([
        "entries",
        "freeze",
        "fromEntries",
        "getOwnPropertyDescriptors",
        "getPrototypeOf",
        "hasOwn",
        "is",
        "keys",
        "prototype",
        "values",
      ]),
    ],
    ["Reflect", new Set(["ownKeys"])],
  ]);
  const allowedAmbientCalls = new Set(["Array", "Number", "String"]);
  const allowedAmbientConstructors = new Set([
    "Error",
    "Set",
    "TextDecoder",
    "TypeError",
    "WeakMap",
    "WeakSet",
  ]);
  const isAllowedAmbientIdentifierUse = (node, parent) =>
    node.name === "undefined" ||
    (parent.type === "MemberExpression" && parent.object === node) ||
    (parent.type === "CallExpression" &&
      parent.callee === node &&
      parent.optional === false &&
      allowedAmbientCalls.has(node.name)) ||
    (parent.type === "NewExpression" &&
      parent.callee === node &&
      allowedAmbientConstructors.has(node.name)) ||
    ((parent.type === "ClassDeclaration" ||
      parent.type === "ClassExpression") &&
      parent.superClass === node &&
      node.name === "Error");
  const staticMemberPath = (node) => {
    if (node.type === "Identifier") return { root: node, path: [node.name] };
    if (
      node.type !== "MemberExpression" ||
      node.computed ||
      node.property.type !== "Identifier"
    ) {
      return null;
    }
    const parentPath = staticMemberPath(node.object);
    return parentPath === null
      ? null
      : {
          root: parentPath.root,
          path: [...parentPath.path, node.property.name],
        };
  };
  const prototypeTokenPaths = new Set([
    "Array.prototype",
    "Buffer.prototype",
    "Object.prototype",
  ]);
  const isAmbientStaticPath = (node, expectedPath) => {
    const member = staticMemberPath(node);
    return (
      member !== null &&
      member.path.join(".") === expectedPath &&
      !resolves(member.root.name, scopeForNode.get(member.root))
    );
  };
  const isPrototypeTokenExpression = (node) => {
    if (node.type === "ParenthesizedExpression") {
      return isPrototypeTokenExpression(node.expression);
    }
    if (node.type === "ConditionalExpression") {
      return (
        isPrototypeTokenExpression(node.consequent) &&
        isPrototypeTokenExpression(node.alternate)
      );
    }
    const member = staticMemberPath(node);
    return (
      member !== null &&
      prototypeTokenPaths.has(member.path.join(".")) &&
      !resolves(member.root.name, scopeForNode.get(member.root))
    );
  };
  const isDirectPrototypeCall = (node) =>
    node.type === "CallExpression" &&
    isAmbientStaticPath(node.callee, "Object.getPrototypeOf");
  const isPrototypeTokenUse = (node) => {
    let expression = node;
    let parent = parentForNode.get(expression);
    while (parent?.type === "ParenthesizedExpression") {
      expression = parent;
      parent = parentForNode.get(expression);
    }
    if (parent?.type === "ConditionalExpression") {
      expression = parent;
      parent = parentForNode.get(expression);
    }
    while (parent?.type === "ParenthesizedExpression") {
      expression = parent;
      parent = parentForNode.get(expression);
    }
    if (
      parent?.type !== "BinaryExpression" ||
      !["===", "!=="].includes(parent.operator)
    ) {
      return false;
    }
    const counterpart =
      parent.left === expression
        ? parent.right
        : parent.right === expression
          ? parent.left
          : null;
    return (
      counterpart !== null &&
      isPrototypeTokenExpression(expression) &&
      isDirectPrototypeCall(counterpart)
    );
  };
  const isExpectedErrorConstructorThis = (node) => {
    let current = parentForNode.get(node);
    while (current !== undefined) {
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression"
      ) {
        const method = parentForNode.get(current);
        if (
          method?.type !== "MethodDefinition" ||
          method.kind !== "constructor" ||
          method.value !== current
        ) {
          return false;
        }
        const classBody = parentForNode.get(method);
        const classNode = parentForNode.get(classBody);
        return (
          classBody?.type === "ClassBody" &&
          classNode?.type === "ClassDeclaration" &&
          classNode.id?.name === "G17BenchmarkBuildOwnerV3ContractError" &&
          classNode.superClass?.type === "Identifier" &&
          classNode.superClass.name === "Error" &&
          !resolves("Error", scopeForNode.get(classNode.superClass))
        );
      }
      current = parentForNode.get(current);
    }
    return false;
  };
  const isNonReferenceIdentifier = (node, parent) =>
    bindingIdentifiers.has(node) ||
    (parent.type === "MemberExpression" &&
      parent.property === node &&
      !parent.computed) ||
    ((parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition") &&
      parent.key === node &&
      parent.value !== node &&
      !parent.computed) ||
    (parent.type === "ImportSpecifier" && parent.imported === node) ||
    (parent.type === "ExportSpecifier" && parent.exported === node) ||
    (parent.type === "LabeledStatement" && parent.label === node) ||
    ((parent.type === "BreakStatement" ||
      parent.type === "ContinueStatement") &&
      parent.label === node);
  const referenceBindingForNode = new WeakMap();
  walkAst(ast, (node, parent) => {
    if (
      node.type !== "Identifier" ||
      parent === null ||
      isNonReferenceIdentifier(node, parent)
    ) {
      return;
    }
    const binding = resolveBinding(node.name, scopeForNode.get(node));
    if (binding !== null) {
      binding.references.push(node);
      referenceBindingForNode.set(node, binding);
    }
  });
  const directCallImports = new Set([
    "canonicalJson",
    "canonicalSha256",
    "createG17BenchmarkPrivateBuildIssuerV1ForTesting",
    "createHash",
    "isDeepStrictEqual",
    "isG17BenchmarkPrivateBuildIssuerV1Fault",
    "isG17BenchmarkPrivateBuildIssuerV1TestTrace",
    "parseG17Elf64",
    "runG17BenchmarkPrivateBuildIssuerV1",
    "verifyG17BenchmarkExecutionRequestV2Artifact",
    "verifyG17CargoExecveatHelperAttestationArtifact",
    "verifyG17CargoExecveatStatusProtocol",
    "verifyG17NonTmpfsBuildIsolationV2PolicyArtifact",
    "verifyG17NonTmpfsContainmentV2Artifact",
  ]);
  const importedObjectMembers = new Map([["types", new Set(["isProxy"])]]);
  const forbiddenIndirectCallMembers = new Set(["apply", "bind", "call"]);
  const callOnlyMemberNames = new Set([
    "add",
    "at",
    "charCodeAt",
    "concat",
    "decode",
    "delete",
    "digest",
    "endsWith",
    "entries",
    "equals",
    "every",
    "filter",
    "find",
    "flatMap",
    "get",
    "has",
    "includes",
    "keys",
    "map",
    "set",
    "slice",
    "some",
    "sort",
    "split",
    "startsWith",
    "test",
    "toString",
    "trimEnd",
    "update",
    "values",
  ]);
  const writtenReferences = new WeakSet();
  const markWriteTarget = (target) => {
    if (target === null) return;
    if (target.type === "Identifier" || target.type === "MemberExpression") {
      writtenReferences.add(target);
      return;
    }
    if (target.type === "AssignmentPattern") {
      markWriteTarget(target.left);
      return;
    }
    if (target.type === "RestElement") {
      markWriteTarget(target.argument);
      return;
    }
    if (target.type === "ArrayPattern") {
      for (const element of target.elements) markWriteTarget(element);
      return;
    }
    if (target.type === "ObjectPattern") {
      for (const property of target.properties) {
        markWriteTarget(
          property.type === "RestElement" ? property.argument : property.value,
        );
      }
    }
  };
  walkAst(ast, (node) => {
    if (node.type === "AssignmentExpression") markWriteTarget(node.left);
    if (node.type === "UpdateExpression") markWriteTarget(node.argument);
    if (node.type === "UnaryExpression" && node.operator === "delete") {
      markWriteTarget(node.argument);
    }
    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      markWriteTarget(node.left);
    }
  });
  walkAst(ast, (node, parent) => {
    assert.notEqual(node.type, "ImportExpression");
    assert.notEqual(node.type, "MetaProperty");
    const scope = scopeForNode.get(node);
    assert.notEqual(scope, undefined, `missing lexical scope for ${node.type}`);
    if (
      node.type === "ClassDeclaration" &&
      node.id?.name === "G17BenchmarkBuildOwnerV3ContractError"
    ) {
      assert.equal(
        node.superClass?.type === "Identifier" &&
          node.superClass.name === "Error" &&
          !resolves("Error", scopeForNode.get(node.superClass)),
        true,
        "exact contract error class must extend unresolved intrinsic Error",
      );
    }
    if (node.type === "Super") {
      assert.equal(
        isExpectedErrorConstructorThis(node) &&
          parent?.type === "CallExpression" &&
          parent.callee === node &&
          parent.optional === false,
        true,
        "super outside the exact contract-error constructor call",
      );
    }
    if (node.type === "ThisExpression") {
      assert.equal(
        isExpectedErrorConstructorThis(node) &&
          parent?.type === "MemberExpression" &&
          parent.object === node &&
          !parent.computed &&
          ["code", "name", "phase"].includes(parent.property.name),
        true,
        "this expression outside the exact contract-error constructor fields",
      );
    }
    if (
      node.type === "Property" ||
      node.type === "MethodDefinition" ||
      node.type === "PropertyDefinition"
    ) {
      assert.equal(node.computed, false, "computed property definition");
      const propertyName =
        node.key.type === "Identifier" || node.key.type === "Literal"
          ? String(node.key.name ?? node.key.value)
          : null;
      if (node.type === "Property") {
        assert.equal(
          ["__proto__", "constructor", "prototype"].includes(propertyName),
          false,
          `forbidden property definition ${propertyName}`,
        );
      }
    }
    if (
      node.type === "Identifier" &&
      parent !== null &&
      !isNonReferenceIdentifier(node, parent) &&
      !resolves(node.name, scope)
    ) {
      assert.equal(
        writtenReferences.has(node),
        false,
        `ambient identifier write ${node.name}`,
      );
      assert.equal(
        allowedAmbientIdentifiers.has(node.name),
        true,
        `ambient identifier ${node.name}`,
      );
      assert.equal(
        isAllowedAmbientIdentifierUse(node, parent),
        true,
        `ambient identifier use ${node.name}`,
      );
    }
    if (node.type === "MemberExpression") {
      assert.equal(
        node.computed,
        false,
        `computed member ${source.slice(node.start, node.end)}`,
      );
      if (!node.computed) {
        assert.notEqual(node.property.name, "constructor");
        assert.notEqual(node.property.name, "__proto__");
        assert.equal(
          forbiddenIndirectCallMembers.has(node.property.name),
          false,
          `forbidden indirect-call member ${node.property.name}`,
        );
        if (
          callOnlyMemberNames.has(node.property.name) &&
          !writtenReferences.has(node)
        ) {
          assert.equal(
            node.optional === false &&
              parent?.type === "CallExpression" &&
              parent.callee === node &&
              parent.optional === false,
            true,
            `method member used as value ${node.property.name}`,
          );
        }
        const member = staticMemberPath(node);
        if (node.property.name === "prototype") {
          assert.equal(
            member !== null &&
              prototypeTokenPaths.has(member.path.join(".")) &&
              isPrototypeTokenUse(node),
            true,
            "prototype member outside direct identity comparison",
          );
        }
        if (
          member !== null &&
          !resolves(member.root.name, scopeForNode.get(member.root)) &&
          allowedAmbientIdentifiers.has(member.path[0])
        ) {
          assert.equal(member.path.length, 2, member.path.join("."));
          assert.equal(
            allowedAmbientMembers.has(member.path[0]) &&
              allowedAmbientMembers.get(member.path[0]).has(member.path[1]),
            true,
            member.path.join("."),
          );
          assert.equal(
            writtenReferences.has(node),
            false,
            `ambient member write ${member.path.join(".")}`,
          );
          assert.equal(
            (node.optional === false &&
              parent.type === "CallExpression" &&
              parent.callee === node &&
              parent.optional === false) ||
              (member.path[1] === "prototype" &&
                prototypeTokenPaths.has(member.path.join(".")) &&
                isPrototypeTokenUse(node)),
            true,
            `ambient member use ${member.path.join(".")}`,
          );
        }
      }
    }
    if (node.type === "Identifier") {
      const binding = referenceBindingForNode.get(node);
      if (binding?.declarationKinds.has("import") === true) {
        assert.equal(
          writtenReferences.has(node),
          false,
          `imported binding write ${binding.name}`,
        );
        if (directCallImports.has(binding.importedName)) {
          assert.equal(
            parent?.type === "CallExpression" &&
              parent.callee === node &&
              parent.optional === false,
            true,
            `imported function used as value ${binding.importedName}`,
          );
        } else if (importedObjectMembers.has(binding.importedName)) {
          const member = parent?.type === "MemberExpression" ? parent : null;
          const memberParent =
            member === null ? null : parentForNode.get(member);
          assert.equal(
            member !== null &&
              member.object === node &&
              member.computed === false &&
              member.optional === false &&
              member.property.type === "Identifier" &&
              importedObjectMembers
                .get(binding.importedName)
                .has(member.property.name) &&
              memberParent?.type === "CallExpression" &&
              memberParent.callee === member &&
              memberParent.optional === false,
            true,
            `imported object used outside direct member call ${binding.importedName}`,
          );
        } else {
          assert.equal(
            parent?.type === "ReturnStatement" ||
              parent?.type === "SpreadElement" ||
              (parent?.type === "VariableDeclarator" && parent.init === node) ||
              (parent?.type === "AssignmentExpression" &&
                parent.right === node) ||
              (parent?.type === "Property" && parent.value === node) ||
              (parent?.type === "ExportSpecifier" && parent.local === node) ||
              (parent?.type === "CallExpression" && parent.callee === node) ||
              (parent?.type === "NewExpression" && parent.callee === node),
            false,
            `imported value escape ${binding.importedName}`,
          );
          if (
            parent?.type === "MemberExpression" &&
            parent.object === node &&
            parentForNode.get(parent)?.type === "CallExpression" &&
            parentForNode.get(parent).callee === parent
          ) {
            assert.equal(
              binding.importedName === "G17_BENCHMARK_BUILD_PLAN" &&
                parent.computed === false &&
                parent.optional === false &&
                parent.property.name === "at" &&
                parentForNode.get(parent).optional === false,
              true,
              `imported value member call ${binding.importedName}`,
            );
          }
        }
      }
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      !resolves(node.callee.name, scopeForNode.get(node.callee)) &&
      allowedAmbientIdentifiers.has(node.callee.name)
    ) {
      assert.equal(
        allowedAmbientCalls.has(node.callee.name) && node.optional === false,
        true,
        `ambient call ${node.callee.name}`,
      );
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression"
    ) {
      const callee = staticMemberPath(node.callee);
      if (
        callee !== null &&
        callee.path.join(".") === "Object.getPrototypeOf" &&
        !resolves(callee.root.name, scopeForNode.get(callee.root))
      ) {
        const counterpart =
          parent?.type === "BinaryExpression"
            ? parent.left === node
              ? parent.right
              : parent.right === node
                ? parent.left
                : null
            : null;
        assert.equal(
          parent?.type === "BinaryExpression" &&
            ["===", "!=="].includes(parent.operator) &&
            counterpart !== null &&
            (isPrototypeTokenExpression(counterpart) ||
              isDirectPrototypeCall(counterpart)),
          true,
          "Object.getPrototypeOf result outside direct identity comparison",
        );
      }
    }
    if (
      node.type === "NewExpression" &&
      node.callee.type === "Identifier" &&
      !resolves(node.callee.name, scopeForNode.get(node.callee)) &&
      allowedAmbientIdentifiers.has(node.callee.name)
    ) {
      assert.equal(
        allowedAmbientConstructors.has(node.callee.name),
        true,
        `ambient constructor ${node.callee.name}`,
      );
    }
  });

  const sensitiveBindingKinds = new Map();
  const sensitiveInputBindings = new Map();
  for (const records of [recordsForScope(moduleScope)]) {
    for (const binding of records.values()) {
      if (!binding.declarationKinds.has("import")) continue;
      sensitiveBindingKinds.set(
        binding,
        directCallImports.has(binding.importedName)
          ? "import-function"
          : importedObjectMembers.has(binding.importedName)
            ? "import-object"
            : "import-value",
      );
    }
  }
  const unwrapTransparentExpression = (node) => {
    let current = node;
    while (
      current?.type === "ParenthesizedExpression" ||
      current?.type === "ChainExpression"
    ) {
      current = current.expression;
    }
    return current;
  };
  const ambientMemberCallPath = (node) => {
    const call = unwrapTransparentExpression(node);
    if (call?.type !== "CallExpression") return null;
    const callee = unwrapTransparentExpression(call.callee);
    const member = staticMemberPath(callee);
    if (
      member === null ||
      resolves(member.root.name, scopeForNode.get(member.root))
    ) {
      return null;
    }
    return member.path.join(".");
  };
  const isExactBuildPlanLookupCall = (node) => {
    const call = unwrapTransparentExpression(node);
    if (call?.type !== "CallExpression" || call.optional !== false) {
      return false;
    }
    const callee = unwrapTransparentExpression(call.callee);
    const member = staticMemberPath(callee);
    if (
      member?.path.length !== 2 ||
      member.path[1] !== "at" ||
      callee.type !== "MemberExpression" ||
      callee.computed ||
      callee.optional !== false
    ) {
      return false;
    }
    const rootBinding = referenceBindingForNode.get(member.root);
    return (
      rootBinding?.declarationKinds.has("import") === true &&
      rootBinding.importedName === "G17_BENCHMARK_BUILD_PLAN"
    );
  };
  const reflectionOriginKind = (node) => {
    const path = ambientMemberCallPath(node);
    if (path === "Object.getOwnPropertyDescriptors") {
      return "descriptor-map";
    }
    if (path === "Reflect.ownKeys" || path === "Object.keys") {
      return "reflection-view";
    }
    if (path === "Object.entries" || path === "Object.values") {
      const call = unwrapTransparentExpression(node);
      const argumentKind = sensitiveKindForExpression(call.arguments[0]);
      return argumentKind === "descriptor-map"
        ? "descriptor-entry-view"
        : "reflection-view";
    }
    return null;
  };
  const mergeSensitiveKinds = (kinds) => {
    const present = kinds.filter((kind) => kind !== null);
    if (present.length === 0) return null;
    if (present.every((kind) => kind === present[0])) return present[0];
    if (present.includes("reflected-value")) return "reflected-value";
    if (present.includes("descriptor-record")) return "reflected-value";
    if (
      present.includes("reflection-view") ||
      present.includes("descriptor-entry-view")
    ) {
      return "reflection-view";
    }
    return present[0];
  };
  function sensitiveKindForExpression(node) {
    const expression = unwrapTransparentExpression(node);
    if (expression === null || expression === undefined) return null;
    if (expression.type === "Identifier") {
      const binding = referenceBindingForNode.get(expression);
      return binding === undefined
        ? null
        : (sensitiveBindingKinds.get(binding) ?? null);
    }
    if (expression.type === "CallExpression") {
      const originKind = reflectionOriginKind(expression);
      if (originKind !== null) return originKind;
      const callee = unwrapTransparentExpression(expression.callee);
      if (callee.type === "MemberExpression") {
        const receiverKind = sensitiveKindForExpression(callee.object);
        if (
          receiverKind === "reflection-view" ||
          receiverKind === "descriptor-entry-view"
        ) {
          if (
            callee.computed === false &&
            callee.property.type === "Identifier" &&
            ["every", "includes", "some"].includes(callee.property.name)
          ) {
            return null;
          }
          return "reflected-value";
        }
        if (
          receiverKind === "descriptor-map" ||
          receiverKind === "descriptor-record" ||
          receiverKind === "reflected-value"
        ) {
          return "reflected-value";
        }
        if (receiverKind === "import-value") {
          return isExactBuildPlanLookupCall(expression)
            ? "derived-import-value"
            : null;
        }
        if (
          receiverKind === "derived-import-value" ||
          receiverKind === "derived-import-member"
        ) {
          return "derived-import-member";
        }
      }
      return null;
    }
    if (expression.type === "MemberExpression") {
      const receiverKind = sensitiveKindForExpression(expression.object);
      if (
        (receiverKind === "reflection-view" ||
          receiverKind === "descriptor-entry-view") &&
        expression.computed === false &&
        expression.property.name === "length"
      ) {
        return null;
      }
      if (receiverKind === "descriptor-map") return "descriptor-record";
      if (receiverKind === "descriptor-record") {
        return ["value", "get", "set"].includes(expression.property.name)
          ? "reflected-value"
          : null;
      }
      if (receiverKind === "reflected-value") return "reflected-value";
      if (receiverKind === "import-value") return "import-value";
      if (
        receiverKind === "derived-import-value" ||
        receiverKind === "derived-import-member"
      ) {
        return "derived-import-member";
      }
      return null;
    }
    if (expression.type === "AwaitExpression") {
      return sensitiveKindForExpression(expression.argument);
    }
    if (expression.type === "ConditionalExpression") {
      return mergeSensitiveKinds([
        sensitiveKindForExpression(expression.consequent),
        sensitiveKindForExpression(expression.alternate),
      ]);
    }
    if (expression.type === "LogicalExpression") {
      return mergeSensitiveKinds([
        sensitiveKindForExpression(expression.left),
        sensitiveKindForExpression(expression.right),
      ]);
    }
    if (expression.type === "SequenceExpression") {
      return mergeSensitiveKinds(
        expression.expressions.map(sensitiveKindForExpression),
      );
    }
    return null;
  }
  function sensitiveInputBindingForExpression(node) {
    const expression = unwrapTransparentExpression(node);
    if (expression === null || expression === undefined) return null;
    if (expression.type === "Identifier") {
      const binding = referenceBindingForNode.get(expression);
      return binding === undefined
        ? null
        : (sensitiveInputBindings.get(binding) ?? null);
    }
    if (expression.type === "CallExpression") {
      const originKind = reflectionOriginKind(expression);
      if (originKind !== null) {
        const call = unwrapTransparentExpression(expression);
        const input = unwrapTransparentExpression(call.arguments[0]);
        if (originKind === "descriptor-map" && input?.type === "Identifier") {
          return referenceBindingForNode.get(input) ?? null;
        }
        return sensitiveInputBindingForExpression(input);
      }
      const callee = unwrapTransparentExpression(expression.callee);
      return callee.type === "MemberExpression"
        ? sensitiveInputBindingForExpression(callee.object)
        : null;
    }
    if (expression.type === "MemberExpression") {
      return sensitiveInputBindingForExpression(expression.object);
    }
    if (expression.type === "AwaitExpression") {
      return sensitiveInputBindingForExpression(expression.argument);
    }
    const alternatives =
      expression.type === "ConditionalExpression"
        ? [expression.consequent, expression.alternate]
        : expression.type === "LogicalExpression"
          ? [expression.left, expression.right]
          : expression.type === "SequenceExpression"
            ? expression.expressions
            : [];
    const inputs = alternatives
      .map(sensitiveInputBindingForExpression)
      .filter((binding) => binding !== null);
    return inputs.length > 0 && inputs.every((binding) => binding === inputs[0])
      ? inputs[0]
      : null;
  }
  const ownerDeclaratorForOrigin = (node) => {
    let expression = node;
    let parent = parentForNode.get(expression);
    while (
      parent?.type === "ParenthesizedExpression" ||
      parent?.type === "ChainExpression"
    ) {
      expression = parent;
      parent = parentForNode.get(expression);
    }
    if (
      parent?.type !== "VariableDeclarator" ||
      parent.init !== expression ||
      parent.id.type !== "Identifier"
    ) {
      return null;
    }
    const declaration = parentForNode.get(parent);
    return declaration?.type === "VariableDeclaration" &&
      declaration.kind === "const"
      ? parent
      : null;
  };
  walkAst(ast, (node) => {
    const originKind = reflectionOriginKind(node);
    if (originKind === null) return;
    const declarator = ownerDeclaratorForOrigin(node);
    if (declarator === null) return;
    const binding = declaredBindingForIdentifier.get(declarator.id);
    assert.notEqual(binding, undefined, "missing reflection owner binding");
    assert.equal(
      sensitiveBindingKinds.has(binding),
      false,
      `reflection result has multiple owners ${binding.name}`,
    );
    sensitiveBindingKinds.set(binding, originKind);
    const inputBinding = sensitiveInputBindingForExpression(node);
    if (inputBinding !== null) {
      sensitiveInputBindings.set(binding, inputBinding);
    }
  });
  walkAst(ast, (node) => {
    if (node.type !== "CallExpression" || !isExactBuildPlanLookupCall(node)) {
      return;
    }
    const declarator = ownerDeclaratorForOrigin(node);
    const declaration =
      declarator === null ? null : parentForNode.get(declarator);
    const declarationParent =
      declaration === null ? null : parentForNode.get(declaration);
    assert.equal(
      declarator !== null &&
        declaration?.type === "VariableDeclaration" &&
        declaration.kind === "const" &&
        declaration.declarations.length === 1 &&
        declarationParent?.type !== "ExportNamedDeclaration",
      true,
      "build-plan lookup requires one const derived binding",
    );
    const binding = declaredBindingForIdentifier.get(declarator.id);
    assert.notEqual(binding, undefined, "missing build-plan owner binding");
    assert.equal(
      binding.declarationKinds.size === 1 &&
        binding.declarationKinds.has("const") &&
        binding.declarations.length === 1 &&
        !sensitiveBindingKinds.has(binding),
      true,
      `build-plan lookup has invalid derived binding ${binding.name}`,
    );
    sensitiveBindingKinds.set(binding, "derived-import-value");
  });
  const bindSensitivePattern = (pattern, kind, inputBinding) => {
    if (pattern.type === "Identifier") {
      const binding = declaredBindingForIdentifier.get(pattern);
      assert.notEqual(binding, undefined, "missing reflected binding");
      assert.equal(
        sensitiveBindingKinds.has(binding),
        false,
        `reflection result has multiple owners ${binding.name}`,
      );
      sensitiveBindingKinds.set(binding, kind);
      if (inputBinding !== null) {
        sensitiveInputBindings.set(binding, inputBinding);
      }
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      bindSensitivePattern(pattern.left, kind, inputBinding);
      return;
    }
    if (pattern.type === "RestElement") {
      bindSensitivePattern(pattern.argument, kind, inputBinding);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) {
        if (element !== null) {
          bindSensitivePattern(element, kind, inputBinding);
        }
      }
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        bindSensitivePattern(
          property.type === "RestElement" ? property.argument : property.value,
          kind,
          inputBinding,
        );
      }
    }
  };
  walkAst(ast, (node) => {
    if (node.type !== "ForOfStatement") return;
    const rightKind = sensitiveKindForExpression(node.right);
    if (
      rightKind !== "reflection-view" &&
      rightKind !== "descriptor-entry-view"
    ) {
      return;
    }
    const inputBinding = sensitiveInputBindingForExpression(node.right);
    assert.equal(
      node.left.type === "VariableDeclaration" &&
        node.left.kind === "const" &&
        node.left.declarations.length === 1,
      true,
      "reflection iteration requires one const binding pattern",
    );
    const pattern = node.left.declarations[0].id;
    if (rightKind === "descriptor-entry-view") {
      assert.equal(
        pattern.type === "ArrayPattern" &&
          pattern.elements.length === 2 &&
          pattern.elements[0]?.type === "Identifier" &&
          pattern.elements[1]?.type === "Identifier",
        true,
        "descriptor iteration requires [key, descriptor]",
      );
      bindSensitivePattern(pattern.elements[0], "reflection-key", inputBinding);
      bindSensitivePattern(
        pattern.elements[1],
        "descriptor-record",
        inputBinding,
      );
    } else {
      bindSensitivePattern(pattern, "reflection-key", inputBinding);
    }
  });
  const reflectionOwnerKinds = new Set([
    "descriptor-map",
    "reflection-view",
    "descriptor-entry-view",
  ]);
  const reflectedKinds = new Set([
    "descriptor-record",
    "reflected-value",
    "reflection-key",
  ]);
  const sensitiveEscapeParents = new Set([
    "ArrayExpression",
    "PropertyDefinition",
    "ReturnStatement",
    "SpreadElement",
    "TemplateLiteral",
  ]);
  const crossesFunctionBoundary = (binding, reference) => {
    let scope = scopeForNode.get(reference);
    while (scope !== null && scope !== binding.scope) {
      if (scope.kind === "function") return true;
      scope = scope.parent;
    }
    return false;
  };
  const descriptorMemberNames = new Set([
    "configurable",
    "enumerable",
    "get",
    "set",
    "value",
    "writable",
  ]);
  const enclosingFunctionForNode = (node) => {
    let current = parentForNode.get(node);
    while (current !== undefined) {
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression"
      ) {
        return current;
      }
      current = parentForNode.get(current);
    }
    return null;
  };
  const isExactRecursivePlainDataSnapshotArgument = (node, call) => {
    if (
      call.type !== "CallExpression" ||
      call.optional !== false ||
      call.arguments[0] !== node ||
      node.type !== "MemberExpression" ||
      node.computed ||
      node.optional !== false ||
      node.object.type !== "Identifier" ||
      node.property.type !== "Identifier" ||
      node.property.name !== "value"
    ) {
      return false;
    }
    const descriptorBinding = referenceBindingForNode.get(node.object);
    if (
      descriptorBinding === undefined ||
      sensitiveBindingKinds.get(descriptorBinding) !== "descriptor-record"
    ) {
      return false;
    }
    const callee = call.callee;
    if (callee.type !== "Identifier") return false;
    const calleeBinding = referenceBindingForNode.get(callee);
    if (
      calleeBinding === undefined ||
      calleeBinding.declarationKinds.size !== 1 ||
      !calleeBinding.declarationKinds.has("function") ||
      calleeBinding.declarations.length !== 1 ||
      calleeBinding.references.some((reference) =>
        writtenReferences.has(reference),
      )
    ) {
      return false;
    }
    const functionNode = parentForNode.get(calleeBinding.declarations[0]);
    if (
      functionNode?.type !== "FunctionDeclaration" ||
      enclosingFunctionForNode(call) !== functionNode ||
      functionNode.params[0]?.type !== "Identifier"
    ) {
      return false;
    }
    const inputBinding = declaredBindingForIdentifier.get(
      functionNode.params[0],
    );
    const referencesDescriptor = (candidate) =>
      candidate?.type === "Identifier" &&
      referenceBindingForNode.get(candidate) === descriptorBinding;
    const isExactMembershipCheck = (candidate) => {
      const expression = unwrapTransparentExpression(candidate);
      if (
        expression?.type === "CallExpression" &&
        expression.optional === false &&
        ambientMemberCallPath(expression) === "Object.hasOwn"
      ) {
        const callee = unwrapTransparentExpression(expression.callee);
        const name = unwrapTransparentExpression(expression.arguments[1]);
        return (
          callee.type === "MemberExpression" &&
          callee.optional === false &&
          referencesDescriptor(expression.arguments[0]) &&
          name?.type === "Literal" &&
          name.value === "value"
        );
      }
      if (
        expression?.type === "BinaryExpression" &&
        expression.operator === "in" &&
        referencesDescriptor(expression.right)
      ) {
        const name = unwrapTransparentExpression(expression.left);
        return name?.type === "Literal" && name.value === "value";
      }
      return false;
    };
    const isExactEnumerableCheck = (candidate) => {
      const expression = unwrapTransparentExpression(candidate);
      return (
        expression?.type === "MemberExpression" &&
        expression.computed === false &&
        expression.optional === false &&
        referencesDescriptor(expression.object) &&
        expression.property.type === "Identifier" &&
        expression.property.name === "enumerable"
      );
    };
    const isExactNegativeCheck = (candidate, positiveCheck) => {
      const expression = unwrapTransparentExpression(candidate);
      if (
        expression?.type === "UnaryExpression" &&
        expression.operator === "!"
      ) {
        return positiveCheck(expression.argument);
      }
      if (
        expression?.type === "BinaryExpression" &&
        expression.operator === "!==" &&
        positiveCheck(expression.left)
      ) {
        const expected = unwrapTransparentExpression(expression.right);
        return expected?.type === "Literal" && expected.value === true;
      }
      return false;
    };
    const exactRejectingGuardKind = (statement) => {
      if (
        statement.type !== "IfStatement" ||
        statement.alternate !== null ||
        !(
          statement.consequent.type === "ThrowStatement" ||
          (statement.consequent.type === "BlockStatement" &&
            statement.consequent.body.length === 1 &&
            statement.consequent.body[0].type === "ThrowStatement")
        )
      ) {
        return null;
      }
      const test = unwrapTransparentExpression(statement.test);
      if (isExactNegativeCheck(test, isExactMembershipCheck)) {
        return "membership";
      }
      if (isExactNegativeCheck(test, isExactEnumerableCheck)) {
        return "enumerable";
      }
      if (test?.type !== "LogicalExpression" || test.operator !== "||") {
        return null;
      }
      const leftMembership = isExactNegativeCheck(
        test.left,
        isExactMembershipCheck,
      );
      const rightMembership = isExactNegativeCheck(
        test.right,
        isExactMembershipCheck,
      );
      const leftEnumerable = isExactNegativeCheck(
        test.left,
        isExactEnumerableCheck,
      );
      const rightEnumerable = isExactNegativeCheck(
        test.right,
        isExactEnumerableCheck,
      );
      return (leftMembership && rightEnumerable) ||
        (rightMembership && leftEnumerable)
        ? "combined"
        : null;
    };
    let containingStatement = call;
    let containingBlock = parentForNode.get(containingStatement);
    while (
      containingBlock !== undefined &&
      containingBlock.type !== "BlockStatement"
    ) {
      containingStatement = containingBlock;
      containingBlock = parentForNode.get(containingStatement);
    }
    if (containingBlock?.type !== "BlockStatement") return false;
    const statementIndex = containingBlock.body.indexOf(containingStatement);
    if (statementIndex < 0) return false;
    const guardKinds = new Set(
      containingBlock.body
        .slice(0, statementIndex)
        .map(exactRejectingGuardKind)
        .filter((kind) => kind !== null),
    );
    const hasDominatingDescriptorGuard =
      guardKinds.has("combined") ||
      (guardKinds.has("membership") && guardKinds.has("enumerable"));
    return (
      inputBinding !== undefined &&
      sensitiveInputBindings.get(descriptorBinding) === inputBinding &&
      hasDominatingDescriptorGuard
    );
  };
  const isExactDescriptorConsumer = (node, parent) => {
    if (parent?.type !== "CallExpression" || !parent.arguments.includes(node)) {
      return false;
    }
    const path = ambientMemberCallPath(parent);
    return path === "Object.entries" || path === "Reflect.ownKeys";
  };
  const validateSensitiveConsumer = (node, kind) => {
    const parent = parentForNode.get(node);
    assert.notEqual(parent, undefined, `unparented sensitive ${kind}`);
    assert.equal(
      writtenReferences.has(node),
      false,
      `sensitive value write ${kind}`,
    );
    if (reflectionOwnerKinds.has(kind)) {
      if (
        kind === "descriptor-map" &&
        isExactDescriptorConsumer(node, parent)
      ) {
        return;
      }
      if (parent.type === "ForOfStatement" && parent.right === node) return;
      if (
        (kind === "reflection-view" || kind === "descriptor-entry-view") &&
        parent.type === "MemberExpression" &&
        parent.object === node &&
        parent.computed === false &&
        parent.property.name === "length" &&
        !writtenReferences.has(parent)
      ) {
        return;
      }
      assert.fail(`reflection result escape ${kind}`);
    }
    if (kind === "descriptor-record") {
      if (
        parent.type === "MemberExpression" &&
        parent.object === node &&
        parent.computed === false &&
        descriptorMemberNames.has(parent.property.name) &&
        !writtenReferences.has(parent)
      ) {
        return;
      }
      if (
        parent.type === "CallExpression" &&
        parent.arguments.includes(node) &&
        ambientMemberCallPath(parent) === "Object.hasOwn"
      ) {
        return;
      }
      if (
        parent.type === "BinaryExpression" &&
        parent.operator === "in" &&
        parent.right === node &&
        unwrapTransparentExpression(parent.left)?.type === "Literal" &&
        unwrapTransparentExpression(parent.left).value === "value"
      ) {
        return;
      }
      assert.fail("descriptor record escape");
    }
    if (kind === "reflection-key") {
      assert.equal(
        parent.type === "UnaryExpression" &&
          parent.operator === "typeof" &&
          parent.argument === node,
        true,
        "reflection key escape",
      );
      return;
    }
    if (kind === "reflected-value") {
      assert.equal(
        parent.type === "CallExpression" &&
          parent.arguments[0] === node &&
          isExactRecursivePlainDataSnapshotArgument(node, parent),
        true,
        "reflected value outside exact recursive plain-data snapshot argument",
      );
      return;
    }
    if (kind === "import-value") {
      if (
        parent.type === "CallExpression" &&
        parent.callee === node &&
        node.type === "MemberExpression"
      ) {
        const member = staticMemberPath(node);
        const rootBinding =
          member === null ? null : referenceBindingForNode.get(member.root);
        if (
          member?.path.length === 2 &&
          member.path[1] === "at" &&
          rootBinding?.importedName === "G17_BENCHMARK_BUILD_PLAN" &&
          node.optional === false &&
          parent.optional === false
        ) {
          return;
        }
      }
      if (parent.type === "CallExpression" && parent.arguments.includes(node)) {
        assert.fail("imported value argument escape");
      }
      assert.equal(
        sensitiveEscapeParents.has(parent.type) ||
          (parent.type === "VariableDeclarator" && parent.init === node) ||
          (parent.type === "AssignmentExpression" && parent.right === node) ||
          (parent.type === "Property" && parent.value === node) ||
          (parent.type === "ExportSpecifier" && parent.local === node) ||
          (parent.type === "CallExpression" && parent.callee === node) ||
          (parent.type === "NewExpression" && parent.callee === node),
        false,
        "imported value escape",
      );
    }
    if (kind === "derived-import-value") {
      assert.equal(
        parent.type === "MemberExpression" &&
          parent.object === node &&
          parent.computed === false &&
          parent.optional === false,
        true,
        "derived imported plan escape",
      );
      return;
    }
    if (kind === "derived-import-member") {
      if (parent.type === "CallExpression" && parent.arguments.includes(node)) {
        assert.fail("derived imported plan member argument escape");
      }
      assert.equal(
        parent.type === "BinaryExpression" &&
          ["===", "!=="].includes(parent.operator) &&
          (parent.left === node || parent.right === node),
        true,
        "derived imported plan member outside direct identity comparison",
      );
    }
  };
  for (const records of [
    ...(() => {
      const scopes = [];
      const seen = new Set();
      walkAst(ast, (node) => {
        const scope = scopeForNode.get(node);
        if (scope !== undefined && !seen.has(scope)) {
          seen.add(scope);
          scopes.push(recordsForScope(scope));
        }
      });
      return scopes;
    })(),
  ]) {
    for (const binding of records.values()) {
      const kind = sensitiveBindingKinds.get(binding);
      if (kind === undefined) continue;
      for (const reference of binding.references) {
        if (reflectionOwnerKinds.has(kind) || reflectedKinds.has(kind)) {
          assert.equal(
            crossesFunctionBoundary(binding, reference),
            false,
            `sensitive value captured by nested function ${binding.name}`,
          );
        }
        if (kind === "import-function" || kind === "import-object") continue;
        validateSensitiveConsumer(reference, kind);
      }
    }
  }
  walkAst(ast, (node) => {
    const originKind = reflectionOriginKind(node);
    if (originKind === null) return;
    const parent = parentForNode.get(node);
    if (ownerDeclaratorForOrigin(node) !== null) return;
    if (
      originKind === "descriptor-map" &&
      isExactDescriptorConsumer(node, parent)
    ) {
      return;
    }
    if (
      (originKind === "reflection-view" ||
        originKind === "descriptor-entry-view") &&
      parent?.type === "ForOfStatement" &&
      parent.right === node
    ) {
      return;
    }
    assert.fail(`reflection result escape ${originKind}`);
  });
  walkAst(ast, (node, parent) => {
    if (
      node.type !== "MemberExpression" ||
      sensitiveKindForExpression(node) !== "reflected-value"
    ) {
      return;
    }
    validateSensitiveConsumer(node, "reflected-value");
  });
  walkAst(ast, (node) => {
    if (
      node.type === "Identifier" ||
      sensitiveKindForExpression(node) !== "import-value"
    ) {
      return;
    }
    validateSensitiveConsumer(node, "import-value");
  });
  walkAst(ast, (node) => {
    if (
      node.type !== "CallExpression" ||
      !isExactBuildPlanLookupCall(node) ||
      ownerDeclaratorForOrigin(node) !== null
    ) {
      return;
    }
    assert.fail("build-plan lookup requires one const derived binding");
  });
  walkAst(ast, (node) => {
    if (node.type === "Identifier") return;
    const kind = sensitiveKindForExpression(node);
    if (
      kind === "derived-import-value" &&
      node.type === "CallExpression" &&
      isExactBuildPlanLookupCall(node)
    ) {
      return;
    }
    if (kind === "derived-import-value" || kind === "derived-import-member") {
      validateSensitiveConsumer(node, kind);
    }
  });
  walkAst(ast, (node, parent) => {
    if (parent?.type !== "CallExpression" || !parent.arguments.includes(node)) {
      return;
    }
    const kind = sensitiveKindForExpression(node);
    if (kind === "reflected-value") return;
    assert.notEqual(kind, "import-value", "imported value argument escape");
    assert.notEqual(
      kind,
      "derived-import-member",
      "derived imported plan member argument escape",
    );
  });
}

function rejectDuplicateJsonMembers(source, label, fail) {
  let index = 0;
  let nodes = 0;
  const failJson = (reason) =>
    fail(
      "OBSERVATION_BINDING_DRIFT",
      "cargo-jsonl-validation",
      `${label} ${reason}`,
    );
  const whitespace = () => {
    while ([" ", "\t", "\r", "\n"].includes(source[index])) index += 1;
  };
  const stringToken = () => {
    if (source[index] !== '"') failJson("has a non-string object member");
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (error) {
          failJson(`has an invalid string token: ${error.message}`);
        }
      }
      if (character === "\\") {
        index += 1;
        const escape = source[index];
        if (escape === "u") {
          const digits = source.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) {
            failJson("has an invalid Unicode escape");
          }
          index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          failJson("has an invalid string escape");
        }
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        failJson("has an unescaped control character");
      }
      index += 1;
    }
    failJson("has an unterminated string");
  };
  const value = (depth) => {
    if (depth > LIMITS.maximumDepth) failJson("exceeds the JSON depth limit");
    nodes += 1;
    if (nodes > LIMITS.maximumNodes) failJson("exceeds the JSON node limit");
    whitespace();
    if (source[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        const key = stringToken();
        if (keys.has(key))
          failJson(`duplicates object member ${JSON.stringify(key)}`);
        keys.add(key);
        if (keys.size > LIMITS.maximumPropertiesPerRecord) {
          failJson("exceeds the object-member limit");
        }
        whitespace();
        if (source[index] !== ":") failJson("has an object member without ':'");
        index += 1;
        value(depth + 1);
        whitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") failJson("has an unterminated object");
        index += 1;
        whitespace();
      }
      failJson("has an unterminated object");
    }
    if (source[index] === "[") {
      index += 1;
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      let length = 0;
      while (index < source.length) {
        length += 1;
        if (length > LIMITS.maximumArrayLength)
          failJson("exceeds the array limit");
        value(depth + 1);
        whitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") failJson("has an unterminated array");
        index += 1;
      }
      failJson("has an unterminated array");
    }
    if (source[index] === '"') {
      stringToken();
      return;
    }
    const start = index;
    while (
      index < source.length &&
      ![",", "]", "}", " ", "\t", "\r", "\n"].includes(source[index])
    ) {
      index += 1;
    }
    if (index === start) failJson("has an invalid JSON value");
    try {
      const primitive = JSON.parse(source.slice(start, index));
      if (primitive !== null && typeof primitive === "object") {
        failJson("has an invalid primitive value");
      }
    } catch (error) {
      failJson(`has an invalid primitive value: ${error.message}`);
    }
  };
  value(0);
  whitespace();
  if (index !== source.length) failJson("has trailing JSON data");
}

function snapshot(value, label, fail, context = undefined, depth = 0) {
  const budget = context ?? {
    ancestors: new WeakSet(),
    nodes: 0,
    stringBytes: 0,
  };
  if (depth > LIMITS.maximumDepth) {
    fail("LIMIT_EXCEEDED", "input-snapshot", `${label} exceeds depth`);
  }
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} contains Proxy`);
  }
  if (Buffer.isBuffer(value)) {
    if (Object.getPrototypeOf(value) !== Buffer.prototype) {
      fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} Buffer drifted`);
    }
    return Buffer.from(value);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > LIMITS.singleStringUtf8MaximumBytes ||
      budget.stringBytes > LIMITS.aggregateStringUtf8MaximumBytes
    ) {
      fail("LIMIT_EXCEEDED", "input-snapshot", `${label} exceeds strings`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} number drifted`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} is non-JSON`);
  }
  if (budget.ancestors.has(value)) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} contains cycle`);
  }
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} prototype drifted`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} has symbol fields`);
  }
  if (
    keys.length > LIMITS.maximumPropertiesPerRecord ||
    (array && value.length > LIMITS.maximumArrayLength)
  ) {
    fail("LIMIT_EXCEEDED", "input-snapshot", `${label} shape exceeds bound`);
  }
  budget.nodes += 1;
  if (budget.nodes > LIMITS.maximumNodes) {
    fail("LIMIT_EXCEEDED", "input-snapshot", `${label} exceeds nodes`);
  }
  budget.ancestors.add(value);
  try {
    const output = array ? [] : {};
    const expectedArrayKeys = array
      ? [...Array(value.length).keys()].map(String).concat("length")
      : null;
    if (array && !isDeepStrictEqual(keys, expectedArrayKeys)) {
      fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} array is sparse`);
    }
    for (const key of keys) {
      if (key === "length" && array) continue;
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        fail(
          "INPUT_SHAPE_INVALID",
          "input-snapshot",
          `${label}.${key} is not own enumerable data`,
        );
      }
      budget.stringBytes += Buffer.byteLength(key, "utf8");
      if (budget.stringBytes > LIMITS.aggregateStringUtf8MaximumBytes) {
        fail(
          "LIMIT_EXCEEDED",
          "input-snapshot",
          `${label} exceeds aggregate property-name and value strings`,
        );
      }
      output[key] = snapshot(
        descriptor.value,
        `${label}.${key}`,
        fail,
        budget,
        depth + 1,
      );
    }
    return output;
  } finally {
    budget.ancestors.delete(value);
  }
}

function createReferenceCandidate() {
  const liveCapabilities = new WeakMap();
  const codes = new Set(ERROR_CODES);

  class G17BenchmarkBuildOwnerV3ContractError extends Error {
    constructor(code, phase, message, options = undefined) {
      if (!codes.has(code)) throw new TypeError("unknown build-owner-v3 code");
      super(
        `G1.7 benchmark build owner v3 contract: [${code}] ${phase}: ${message}`,
        options,
      );
      this.name = "G17BenchmarkBuildOwnerV3ContractError";
      this.code = code;
      this.phase = phase;
    }
  }

  function fail(code, phase, message, cause = undefined) {
    throw new G17BenchmarkBuildOwnerV3ContractError(
      code,
      phase,
      message,
      cause === undefined ? undefined : { cause },
    );
  }

  function bounded(bytes, maximum, label) {
    if (!Buffer.isBuffer(bytes) || types.isProxy(bytes)) {
      fail(
        "INPUT_SHAPE_INVALID",
        "buffer-validation",
        `${label} is not Buffer`,
      );
    }
    const copied = Buffer.from(bytes);
    if (copied.length > maximum) {
      fail("LIMIT_EXCEEDED", "buffer-validation", `${label} exceeds bound`);
    }
    return copied;
  }

  function digest(value, label) {
    if (typeof value !== "string" || !DIGEST.test(value)) {
      fail("IDENTITY_INVALID", "identity-validation", `${label} drifted`);
    }
    return value;
  }

  function decodeSealed(bytes, maximum, label) {
    const captured = bounded(bytes, maximum, label);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(captured);
    } catch (error) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} is not UTF-8`,
        error,
      );
    }
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} framing drifted`,
      );
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} JSON drifted`,
        error,
      );
    }
    value = snapshot(value, label, fail);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} is not a record`,
      );
    }
    if (!captured.equals(g17PrivateOwnerV3CanonicalBytes(value))) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} is not canonical`,
      );
    }
    const { contentHash, ...unsigned } = value;
    if (
      typeof contentHash !== "string" ||
      contentHash !== canonicalSha256(unsigned)
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-self-hash",
        `${label} contentHash drifted`,
      );
    }
    return {
      value,
      bytes: captured,
      identity: {
        schema: value.schema,
        rawSha256: sha256(captured),
        contentHash,
      },
    };
  }

  function exactIdentity(value, label) {
    exactKeys(value, ["schema", "rawSha256", "contentHash"], label, fail);
    digest(value.rawSha256, `${label}.rawSha256`);
    digest(value.contentHash, `${label}.contentHash`);
    return value;
  }

  function replayDependency(
    label,
    operation,
    code = "PREDECESSOR_BINDING_DRIFT",
  ) {
    try {
      return operation();
    } catch (error) {
      fail(
        code,
        "predecessor-verification",
        `${label} did not pass its native verifier`,
        error,
      );
    }
  }

  function validateSourceProjection(bytes, expected) {
    const source = decodeSealed(
      bytes,
      LIMITS.sourceProjectionMaximumBytes,
      "source projection",
    );
    const value = source.value;
    exactKeys(
      value,
      [
        "authority",
        "authorization",
        "buildId",
        "contentHash",
        "controlRunId",
        "evaluator",
        "product",
        "productRole",
        "schema",
        "source",
        "workspace",
      ],
      "source projection",
      fail,
    );
    exactKeys(
      value.authority,
      [
        "build",
        "control",
        "launch",
        "promotion",
        "provider",
        "publication",
        "qualification",
        "routerQuality",
      ],
      "source authority",
      fail,
    );
    exactKeys(
      value.authorization,
      ["contentHash", "rawSha256"],
      "source authorization",
      fail,
    );
    exactKeys(
      value.product,
      ["cargoLockBlob", "cargoLockSha256", "commit", "tree"],
      "source product",
      fail,
    );
    exactKeys(
      value.evaluator,
      ["commit", "composition", "parent", "patchSha256", "paths", "tree"],
      "source evaluator",
      fail,
    );
    exactKeys(
      value.evaluator.composition,
      [
        "baseManifestBlob",
        "effectiveManifestBlob",
        "effectiveManifestSha256",
        "effectiveTree",
        "mode",
      ],
      "source evaluator composition",
      fail,
    );
    if (
      !Array.isArray(value.evaluator.paths) ||
      value.evaluator.paths.length < 1
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-verification",
        "source evaluator paths drifted",
      );
    }
    for (const [index, path] of value.evaluator.paths.entries()) {
      exactKeys(
        path,
        ["blob", "changeStatus", "contentSha256", "path"],
        `source evaluator path ${index}`,
        fail,
      );
    }
    exactKeys(
      value.workspace,
      [
        "generation",
        "isolated",
        "parentRoot",
        "sourceChild",
        "sourceReadOnlyAtBuildStart",
        "targetChild",
        "targetEmptyAtBuildStart",
        "targetGeneration",
        "targetIsolated",
      ],
      "source workspace",
      fail,
    );
    exactKeys(
      value.workspace.parentRoot,
      ["device", "filesystemType", "gid", "inode", "uid"],
      "source workspace parent",
      fail,
    );
    for (const [childName, child] of [
      ["sourceChild", value.workspace.sourceChild],
      ["targetChild", value.workspace.targetChild],
    ]) {
      exactKeys(
        child,
        [
          "device",
          "filesystemType",
          "gid",
          "inode",
          "leafName",
          "parentDevice",
          "parentInode",
          "uid",
        ],
        `source workspace ${childName}`,
        fail,
      );
    }
    exactKeys(
      value.source,
      [
        "cargoLock",
        "effectiveTree",
        "entryCount",
        "evaluatorPatch",
        "excludedGitlinks",
        "manifestSha256",
        "objectClosureSha256",
        "productCommit",
        "productTree",
        "requiredGitlinks",
        "symlinks",
        "totalBytes",
      ],
      "source materialization",
      fail,
    );
    exactKeys(
      value.source.cargoLock,
      ["blob", "bytes", "sha256"],
      "source Cargo lock",
      fail,
    );
    exactKeys(
      value.source.evaluatorPatch,
      ["bytes", "sha256"],
      "source evaluator patch",
      fail,
    );
    for (const [name, entries, keys] of [
      ["excludedGitlinks", value.source.excludedGitlinks, ["commit", "path"]],
      [
        "requiredGitlinks",
        value.source.requiredGitlinks,
        ["commit", "entryCount", "manifestSha256", "path", "tree"],
      ],
      ["symlinks", value.source.symlinks, ["gitBlob", "path", "target"]],
    ]) {
      if (!Array.isArray(entries)) {
        fail(
          "PREDECESSOR_BINDING_DRIFT",
          "predecessor-verification",
          `source ${name} is not an array`,
        );
      }
      for (const [index, entry] of entries.entries()) {
        exactKeys(entry, keys, `source ${name} ${index}`, fail);
      }
    }
    const sourceIdentity = Object.hasOwn(
      SOURCE_IDENTITIES,
      expected.identity.buildId,
    )
      ? Object.entries(SOURCE_IDENTITIES)
          .find(([buildId]) => buildId === expected.identity.buildId)
          ?.at(1)
      : undefined;
    const sourcePaths = [
      ...value.evaluator.paths.map(({ path }) => path),
      ...value.source.requiredGitlinks.map(({ path }) => path),
      ...value.source.excludedGitlinks.map(({ path }) => path),
      ...value.source.symlinks.map(({ path }) => path),
    ];
    const gitObjects = [
      value.product.cargoLockBlob,
      value.product.commit,
      value.product.tree,
      value.evaluator.commit,
      value.evaluator.parent,
      value.evaluator.tree,
      value.evaluator.composition.baseManifestBlob,
      value.evaluator.composition.effectiveManifestBlob,
      value.evaluator.composition.effectiveTree,
      ...value.evaluator.paths.map(({ blob }) => blob),
      ...value.source.requiredGitlinks.flatMap(({ commit, tree }) => [
        commit,
        tree,
      ]),
      ...value.source.excludedGitlinks.map(({ commit }) => commit),
      ...value.source.symlinks.map(({ gitBlob }) => gitBlob),
    ];
    const sourceObjectClosureSha256 = canonicalSha256({
      schema: "oxigraph.g1.7-product-source-object-closure/v1",
      product: value.product,
      evaluator: value.evaluator,
      effectiveTree: value.source.effectiveTree,
      requiredGitlinks: value.source.requiredGitlinks,
      excludedGitlinks: value.source.excludedGitlinks,
      symlinks: value.source.symlinks,
    });
    const generationCoordinate = {
      schema: "oxigraph.g1.7-product-source-generation-coordinate/v1",
      controlRunId: value.controlRunId,
      buildId: value.buildId,
      productRole: value.productRole,
      authorization: value.authorization,
      parentRoot: value.workspace.parentRoot,
      sourceChild: value.workspace.sourceChild,
      targetChild: value.workspace.targetChild,
    };
    const workspaceGeneration = `g17-workspace-${canonicalSha256({
      ...generationCoordinate,
      kind: "workspace",
    })}`;
    const targetGeneration = `g17-target-${canonicalSha256({
      ...generationCoordinate,
      kind: "target",
    })}`;
    if (
      value.schema !== "oxigraph.g1.7-product-source-projection/v1" ||
      value.controlRunId !== expected.identity.controlRunId ||
      value.buildId !== expected.identity.buildId ||
      value.productRole !== expected.identity.productRole ||
      sourceIdentity === undefined ||
      !isDeepStrictEqual(value.authorization, SOURCE_AUTHORIZATION) ||
      value.workspace.generation !== workspaceGeneration ||
      value.workspace.targetGeneration !== targetGeneration ||
      value.workspace.generation !== expected.identity.workspaceGeneration ||
      value.workspace.targetGeneration !== expected.identity.targetGeneration ||
      value.workspace.isolated !== true ||
      value.workspace.targetIsolated !== true ||
      value.workspace.sourceReadOnlyAtBuildStart !== true ||
      value.workspace.targetEmptyAtBuildStart !== true ||
      value.workspace.sourceChild.leafName !== "source" ||
      value.workspace.targetChild.leafName !== "target" ||
      value.workspace.sourceChild.parentDevice !==
        value.workspace.parentRoot.device ||
      value.workspace.sourceChild.parentInode !==
        value.workspace.parentRoot.inode ||
      value.workspace.targetChild.parentDevice !==
        value.workspace.parentRoot.device ||
      value.workspace.targetChild.parentInode !==
        value.workspace.parentRoot.inode ||
      value.source.productCommit !== value.product.commit ||
      value.source.productTree !== value.product.tree ||
      value.source.cargoLock.blob !== value.product.cargoLockBlob ||
      value.source.cargoLock.sha256 !== value.product.cargoLockSha256 ||
      value.source.evaluatorPatch.sha256 !== value.evaluator.patchSha256 ||
      value.source.effectiveTree !==
        value.evaluator.composition.effectiveTree ||
      value.source.objectClosureSha256 !== sourceObjectClosureSha256 ||
      value.source.effectiveTree !== sourceIdentity.effectiveTree ||
      value.source.entryCount !== sourceIdentity.entryCount ||
      value.source.manifestSha256 !== sourceIdentity.manifestSha256 ||
      value.source.objectClosureSha256 !== sourceIdentity.objectClosureSha256 ||
      value.source.totalBytes !== sourceIdentity.totalBytes ||
      value.source.cargoLock.bytes !== sourceIdentity.cargoLockBytes ||
      value.source.evaluatorPatch.bytes !==
        sourceIdentity.evaluatorPatchBytes ||
      !Number.isSafeInteger(value.source.entryCount) ||
      value.source.entryCount < 1 ||
      !Number.isSafeInteger(value.source.totalBytes) ||
      value.source.totalBytes < 1 ||
      gitObjects.some((object) => !GIT_OBJECT.test(object ?? "")) ||
      sourcePaths.some(
        (path) =>
          typeof path !== "string" ||
          path.length === 0 ||
          path.startsWith("/") ||
          path.split("/").some((part) => part === "" || part === ".."),
      ) ||
      new Set(sourcePaths).size !== sourcePaths.length ||
      Object.values(value.authority).some((claim) => claim !== false)
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-verification",
        "source projection structure drifted",
      );
    }
    for (const digestValue of [
      value.authorization.rawSha256,
      value.authorization.contentHash,
      value.product.cargoLockSha256,
      value.evaluator.patchSha256,
      value.evaluator.composition.effectiveManifestSha256,
      ...value.evaluator.paths.map(({ contentSha256 }) => contentSha256),
      value.source.cargoLock.sha256,
      value.source.evaluatorPatch.sha256,
      value.source.manifestSha256,
      value.source.objectClosureSha256,
      ...value.source.requiredGitlinks.map(
        ({ manifestSha256 }) => manifestSha256,
      ),
    ]) {
      digest(digestValue, "source projection digest");
    }
    for (const entry of value.source.requiredGitlinks) {
      if (!Number.isSafeInteger(entry.entryCount) || entry.entryCount < 1) {
        fail(
          "PREDECESSOR_BINDING_DRIFT",
          "predecessor-verification",
          "source required Gitlink entry count drifted",
        );
      }
    }
    return source;
  }

  function validateFixture(raw) {
    const fixture = snapshot(raw, "test fixture", fail);
    exactKeys(fixture, FIXTURE_KEYS, "test fixture", fail);
    if (fixture.schema !== G17_PRIVATE_OWNER_V3_TEST_FIXTURE_SCHEMA) {
      fail("IDENTITY_INVALID", "identity-validation", "fixture schema drifted");
    }
    exactKeys(fixture.identity, IDENTITY_KEYS, "fixture identity", fail);
    const plan = G17_BENCHMARK_BUILD_PLAN.at(fixture.identity.ordinal - 1);
    if (
      plan === undefined ||
      fixture.identity.buildId !== plan.buildId ||
      fixture.identity.productRole !== plan.productRole ||
      typeof fixture.identity.controlRunId !== "string"
    ) {
      fail("IDENTITY_INVALID", "identity-validation", "build order drifted");
    }
    const generationValues = [];
    for (const [field, pattern, generationValue] of [
      [
        "ownerGeneration",
        GENERATIONS.ownerGeneration,
        fixture.identity.ownerGeneration,
      ],
      [
        "workspaceGeneration",
        GENERATIONS.workspaceGeneration,
        fixture.identity.workspaceGeneration,
      ],
      [
        "targetGeneration",
        GENERATIONS.targetGeneration,
        fixture.identity.targetGeneration,
      ],
      [
        "processGeneration",
        GENERATIONS.processGeneration,
        fixture.identity.processGeneration,
      ],
      [
        "containmentGeneration",
        GENERATIONS.containmentGeneration,
        fixture.identity.containmentGeneration,
      ],
      [
        "lifecycleGeneration",
        GENERATIONS.lifecycleGeneration,
        fixture.identity.lifecycleGeneration,
      ],
    ]) {
      if (!pattern.test(generationValue ?? "")) {
        fail("IDENTITY_INVALID", "identity-validation", `${field} drifted`);
      }
      generationValues.push(generationValue);
    }
    if (new Set(generationValues).size !== generationValues.length) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "generation identities are not distinct",
      );
    }
    const issuerRequirements = exactIdentity(
      fixture.issuerRequirements,
      "issuer requirements",
    );
    if (
      issuerRequirements.schema !==
        "oxigraph.g1.7-benchmark-private-build-issuer-requirements/v1" ||
      issuerRequirements.rawSha256 !== ISSUER_REQUIREMENTS_RAW_SHA256 ||
      issuerRequirements.contentHash !==
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-binding",
        "issuer requirements schema drifted",
      );
    }
    const source = validateSourceProjection(fixture.sourceProjectionBytes, {
      identity: fixture.identity,
    });
    exactKeys(
      fixture.executionRequestV2Verification,
      ["bytes", "expected"],
      "execution request v2 verification",
      fail,
    );
    const requestVerification = {
      bytes: bounded(
        fixture.executionRequestV2Verification.bytes,
        LIMITS.executionRequestV2MaximumBytes,
        "execution request v2",
      ),
      expected: fixture.executionRequestV2Verification.expected,
    };
    const request = replayDependency("execution request v2", () =>
      verifyG17BenchmarkExecutionRequestV2Artifact(requestVerification),
    );
    exactKeys(
      fixture.helperAttestationV1Verification,
      ["bytes", "evidence"],
      "helper attestation v1 verification",
      fail,
    );
    const helperVerification = {
      bytes: bounded(
        fixture.helperAttestationV1Verification.bytes,
        LIMITS.helperAttestationV1MaximumBytes,
        "helper attestation v1",
      ),
      evidence: fixture.helperAttestationV1Verification.evidence,
    };
    const helper = replayDependency("helper attestation v1", () =>
      verifyG17CargoExecveatHelperAttestationArtifact(helperVerification),
    );
    const helperDocument = decodeSealed(
      helperVerification.bytes,
      LIMITS.helperAttestationV1MaximumBytes,
      "helper attestation v1",
    );
    const policyBytes = bounded(
      fixture.isolationPolicyV2Bytes,
      LIMITS.isolationPolicyV2MaximumBytes,
      "isolation policy v2",
    );
    const policy = replayDependency("isolation policy v2", () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(policyBytes),
    );
    exactKeys(
      fixture.containmentV2Verification,
      ["bytes", "expected"],
      "containment v2 verification",
      fail,
    );
    const containmentVerification = {
      bytes: bounded(
        fixture.containmentV2Verification.bytes,
        LIMITS.containmentV2MaximumBytes,
        "containment v2",
      ),
      expected: fixture.containmentV2Verification.expected,
    };
    const containment = replayDependency("containment v2", () =>
      verifyG17NonTmpfsContainmentV2Artifact(containmentVerification),
    );
    const containmentDocument = decodeSealed(
      containmentVerification.bytes,
      LIMITS.containmentV2MaximumBytes,
      "containment v2",
    );
    exactKeys(
      fixture.statusTranscriptV1Verification,
      ["bytes", "observation"],
      "status transcript v1 verification",
      fail,
    );
    const statusBytes = bounded(
      fixture.statusTranscriptV1Verification.bytes,
      LIMITS.statusTranscriptV1MaximumBytes,
      "status transcript",
    );
    const status = replayDependency(
      "status protocol v1",
      () =>
        verifyG17CargoExecveatStatusProtocol({
          bytes: statusBytes,
          observation: fixture.statusTranscriptV1Verification.observation,
        }),
      "OBSERVATION_BINDING_DRIFT",
    );
    const id = fixture.identity;
    const policyBinding = G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING;
    const containmentNodes = containment.dependencyDag.nodes;
    if (
      source.value.controlRunId !== id.controlRunId ||
      source.value.buildId !== id.buildId ||
      source.value.productRole !== id.productRole ||
      source.value.workspace.generation !== id.workspaceGeneration ||
      source.value.workspace.targetGeneration !== id.targetGeneration ||
      request.request.controlRunId !== id.controlRunId ||
      request.request.buildId !== id.buildId ||
      request.request.productRole !== id.productRole ||
      request.request.source.rawSha256 !== source.identity.rawSha256 ||
      request.request.source.contentHash !== source.identity.contentHash ||
      request.request.source.workspaceGeneration !== id.workspaceGeneration ||
      request.request.source.targetGeneration !== id.targetGeneration ||
      request.request.ownership.ownerGeneration !== id.ownerGeneration ||
      request.request.ownership.processGeneration !== id.processGeneration ||
      request.request.ownership.ordinal !== id.ordinal ||
      !isDeepStrictEqual(request.request.isolationPolicy, policyBinding) ||
      policyBinding.rawSha256 !== sha256(policyBytes) ||
      policyBinding.contentHash !== policy.sha256 ||
      helper.status !== "DORMANT_HELPER_ATTESTATION_REPLAYED" ||
      helperDocument.value.source.logicalName !== "cargo-execveat-helper.c" ||
      helperDocument.value.source.sha256 !== HELPER_SOURCE_SHA256 ||
      helper.physicalLaunchEligible !== false ||
      helper.binding !== null ||
      helper.finalDecisionEligible !== false ||
      containment.runIdentity.controlRunId !== id.controlRunId ||
      containment.runIdentity.buildId !== id.buildId ||
      containment.runIdentity.ownerGeneration !== id.ownerGeneration ||
      containment.runIdentity.processGeneration !== id.processGeneration ||
      containment.runIdentity.workspaceGeneration !== id.workspaceGeneration ||
      containment.runIdentity.targetGeneration !== id.targetGeneration ||
      id.containmentGeneration !==
        `g17-containment-${containment.identity.rawSha256}` ||
      containmentNodes.containmentRequirements.sha256 !==
        G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256 ||
      containment.physicalOriginProven !== false ||
      containment.binding !== null ||
      containment.finalDecisionEligible !== false ||
      !isDeepStrictEqual(containmentNodes.executionRequest, request.identity) ||
      !isDeepStrictEqual(containmentNodes.helperAttestation, helper.identity) ||
      !isDeepStrictEqual(containmentNodes.isolationPolicy, policyBinding) ||
      fixture.qualifiedNativeAdapter !== null ||
      fixture.qualifiedDurableEffect !== null
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-binding",
        "predecessor identity DAG drifted",
      );
    }

    if (
      status.status !== "READY_EOF_REPLAYED" ||
      status.sequence !== "READY->EOF" ||
      status.outcome !== "READY" ||
      status.frameCount !== 1 ||
      status.byteLength !== statusBytes.length ||
      status.physicalLaunchEligible !== false ||
      status.binding !== null ||
      status.finalDecisionEligible !== false
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "status-validation",
        "status transcript is not exact READY then EOF",
      );
    }

    const stdoutBytes = bounded(
      fixture.stdoutBytes,
      LIMITS.combinedOutputMaximumBytes,
      "stdout",
    );
    const stderrBytes = bounded(
      fixture.stderrBytes,
      LIMITS.combinedOutputMaximumBytes,
      "stderr",
    );
    if (
      stdoutBytes.length + stderrBytes.length >
      LIMITS.combinedOutputMaximumBytes
    ) {
      fail("LIMIT_EXCEEDED", "stream-validation", "streams exceed bound");
    }
    const executableBytes = bounded(
      fixture.executableBytes,
      LIMITS.executableMaximumBytes,
      "executable",
    );
    const cgroupProcsBytes = bounded(
      fixture.cgroupProcsBytes,
      LIMITS.cgroupFileMaximumBytes,
      "cgroup.procs",
    );
    const cgroupEventsBytes = bounded(
      fixture.cgroupEventsBytes,
      LIMITS.cgroupFileMaximumBytes,
      "cgroup.events",
    );
    const cgroupPidsCurrentBytes = bounded(
      fixture.cgroupPidsCurrentBytes,
      LIMITS.cgroupFileMaximumBytes,
      "pids.current",
    );
    exactKeys(fixture.observations, OBSERVATION_KEYS, "observations", fail);
    const observations = fixture.observations;
    for (const [value, keys, label] of [
      [
        observations.helperImage,
        [
          "heldFd",
          "sourceLogicalName",
          "sourceSha256",
          "executableSha256",
          "observed",
        ],
        "helper image observation",
      ],
      [
        observations.status,
        [
          "sequence",
          "outcome",
          "byteLength",
          "frameCount",
          "eofObserved",
          "reservedExitCode",
        ],
        "status observation",
      ],
      [
        observations.process,
        [
          "disposition",
          "spawned",
          "exitCode",
          "signal",
          "statusAgreement",
          "captureComplete",
          "outputTruncated",
        ],
        "process observation",
      ],
      [
        observations.streams,
        ["stdout", "stderr", "combinedBytes"],
        "streams observation",
      ],
      [
        observations.streams.stdout,
        ["bytes", "sha256", "closed", "eof"],
        "stdout observation",
      ],
      [
        observations.streams.stderr,
        ["bytes", "sha256", "closed", "eof"],
        "stderr observation",
      ],
      [
        observations.cargo,
        [
          "lineCount",
          "compilerArtifactLine",
          "buildFinishedLine",
          "buildFinishedSuccess",
          "executableLogicalPath",
          "executableSha256",
        ],
        "Cargo observation",
      ],
      [
        observations.directReap,
        [
          "pidfdReadable",
          "waitMechanism",
          "exclusive",
          "directChild",
          "reaped",
          "exitCode",
          "signal",
          "pidfdClosed",
        ],
        "direct reap observation",
      ],
      [
        observations.cgroupQuiescence,
        [
          "path",
          "procsSha256",
          "eventsSha256",
          "pidsCurrentSha256",
          "processCount",
          "populated",
          "pidsCurrent",
        ],
        "cgroup quiescence observation",
      ],
      [
        observations.target,
        ["generation", "root", "ancestors", "executable"],
        "target observation",
      ],
      [
        observations.workspaceFinish,
        [
          "observed",
          "lifecycleGeneration",
          "sourceProjectionRawSha256",
          "workspaceGeneration",
          "targetGeneration",
        ],
        "workspace finish observation",
      ],
    ]) {
      exactKeys(value, keys, label, fail);
    }
    let stdoutText;
    try {
      stdoutText = new TextDecoder("utf-8", { fatal: true }).decode(
        stdoutBytes,
      );
    } catch (error) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL is not UTF-8",
        error,
      );
    }
    if (
      !stdoutText.endsWith("\n") ||
      stdoutText.includes("\r") ||
      stdoutText.includes("\0")
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL framing drifted",
      );
    }
    const lines = stdoutText.slice(0, -1).split("\n");
    if (
      lines.length < 2 ||
      lines.length > LIMITS.maximumArrayLength ||
      lines.some(
        (line) =>
          line.length === 0 ||
          Buffer.byteLength(line, "utf8") > LIMITS.singleStringUtf8MaximumBytes,
      )
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL line inventory drifted",
      );
    }
    let cargoLines;
    try {
      cargoLines = lines.map((line, index) => {
        rejectDuplicateJsonMembers(line, `Cargo JSONL line ${index + 1}`, fail);
        const record = JSON.parse(line);
        if (
          record === null ||
          typeof record !== "object" ||
          Array.isArray(record) ||
          typeof record.reason !== "string"
        ) {
          fail(
            "OBSERVATION_BINDING_DRIFT",
            "cargo-jsonl-validation",
            `Cargo JSONL line ${index + 1} is not a reasoned record`,
          );
        }
        return record;
      });
      cargoLines = snapshot(cargoLines, "Cargo JSONL", fail);
    } catch (error) {
      if (error instanceof G17BenchmarkBuildOwnerV3ContractError) throw error;
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL drifted",
        error,
      );
    }
    const matchingArtifacts = cargoLines
      .map((record, index) => ({ record, index }))
      .filter(
        ({ record }) =>
          record.reason === "compiler-artifact" &&
          record.package_id ===
            "path+file:///workspace/source/lib/oxigraph#0.6.0-dev" &&
          record.manifest_path ===
            "/workspace/source/lib/oxigraph/Cargo.toml" &&
          record.target?.name === "transactional_write",
      );
    const selectedPathClaims = cargoLines
      .map((record, index) => ({ record, index }))
      .filter(
        ({ record }) =>
          record.reason === "compiler-artifact" &&
          (record.executable === observations.cargo.executableLogicalPath ||
            (Array.isArray(record.filenames) &&
              record.filenames.includes(
                observations.cargo.executableLogicalPath,
              ))),
      );
    const finished = cargoLines
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.reason === "build-finished");
    const artifact = matchingArtifacts.at(0)?.record;
    const artifactTarget = artifact?.target;
    const artifactProfile = artifact?.profile;
    const { "required-features": artifactRequiredFeatures } =
      artifactTarget ?? {};
    const cargoRecordShapeValid =
      artifact !== undefined &&
      isDeepStrictEqual(Object.keys(artifact).sort(), [
        "executable",
        "features",
        "filenames",
        "fresh",
        "manifest_path",
        "package_id",
        "profile",
        "reason",
        "target",
      ]) &&
      isDeepStrictEqual(Object.keys(artifactTarget ?? {}).sort(), [
        "crate_types",
        "doc",
        "doctest",
        "edition",
        "kind",
        "name",
        "required-features",
        "src_path",
        "test",
      ]) &&
      isDeepStrictEqual(Object.keys(artifactProfile ?? {}).sort(), [
        "debug_assertions",
        "debuginfo",
        "opt_level",
        "overflow_checks",
        "test",
      ]);
    if (
      observations.status.sequence !== status.sequence ||
      observations.status.outcome !== status.outcome ||
      observations.status.byteLength !== status.byteLength ||
      observations.status.frameCount !== status.frameCount ||
      observations.status.eofObserved !== status.observation.eofObserved ||
      observations.status.reservedExitCode !== status.reservedExitCode ||
      observations.helperImage.heldFd !== 8 ||
      observations.helperImage.observed !== true ||
      observations.helperImage.sourceLogicalName !==
        helperDocument.value.source.logicalName ||
      observations.helperImage.sourceSha256 !==
        helperDocument.value.source.sha256 ||
      observations.helperImage.executableSha256 !==
        helperDocument.value.executable.sha256 ||
      observations.streams.stdout.bytes !== stdoutBytes.length ||
      observations.streams.stdout.sha256 !== sha256(stdoutBytes) ||
      observations.streams.stderr.bytes !== stderrBytes.length ||
      observations.streams.stderr.sha256 !== sha256(stderrBytes) ||
      observations.streams.combinedBytes !==
        stdoutBytes.length + stderrBytes.length ||
      matchingArtifacts.length !== 1 ||
      selectedPathClaims.length !== 1 ||
      selectedPathClaims.at(0)?.index !== matchingArtifacts.at(0)?.index ||
      cargoRecordShapeValid !== true ||
      !isDeepStrictEqual(artifactTarget.kind, ["bench"]) ||
      !isDeepStrictEqual(artifactTarget.crate_types, ["bin"]) ||
      artifactTarget.src_path !==
        "/workspace/source/lib/oxigraph/benches/transactional_write.rs" ||
      artifactTarget.edition !== "2024" ||
      artifactTarget.doc !== false ||
      artifactTarget.doctest !== false ||
      artifactTarget.test !== false ||
      !isDeepStrictEqual(artifactRequiredFeatures, ["rocksdb"]) ||
      artifactProfile.opt_level !== "3" ||
      artifactProfile.debuginfo !== 0 ||
      artifactProfile.debug_assertions !== false ||
      artifactProfile.overflow_checks !== false ||
      artifactProfile.test !== true ||
      !isDeepStrictEqual(artifact.features, [
        "default",
        "oxrocksdb-sys",
        "rocksdb",
      ]) ||
      !CARGO_EXECUTABLE_PATH.test(
        observations.cargo.executableLogicalPath ?? "",
      ) ||
      !isDeepStrictEqual(artifact.filenames, [
        observations.cargo.executableLogicalPath,
      ]) ||
      artifact.executable !== observations.cargo.executableLogicalPath ||
      artifact.fresh !== false ||
      finished.length !== 1 ||
      finished.at(0)?.index !== cargoLines.length - 1 ||
      !isDeepStrictEqual(Object.keys(finished.at(0)?.record ?? {}).sort(), [
        "reason",
        "success",
      ]) ||
      finished.at(0)?.record.success !== true ||
      observations.cargo.lineCount !== cargoLines.length ||
      observations.cargo.compilerArtifactLine !==
        matchingArtifacts.at(0)?.index + 1 ||
      observations.cargo.buildFinishedLine !== finished.at(0)?.index + 1 ||
      observations.cargo.buildFinishedSuccess !== true
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "observation-binding",
        "status, helper, stream, or Cargo observation drifted",
      );
    }
    if (
      observations.process.disposition !== "completed" ||
      observations.process.spawned !== true ||
      observations.process.exitCode !== 0 ||
      observations.process.signal !== null ||
      observations.process.statusAgreement !== true ||
      observations.process.captureComplete !== true ||
      observations.process.outputTruncated !== false ||
      observations.streams.stdout.closed !== true ||
      observations.streams.stdout.eof !== true ||
      observations.streams.stderr.closed !== true ||
      observations.streams.stderr.eof !== true ||
      observations.directReap.pidfdReadable !== true ||
      observations.directReap.waitMechanism !== "waitid-P_PIDFD-WEXITED" ||
      observations.directReap.exclusive !== true ||
      observations.directReap.directChild !== true ||
      observations.directReap.reaped !== true ||
      observations.directReap.exitCode !== 0 ||
      observations.directReap.signal !== null ||
      observations.directReap.pidfdClosed !== true
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "process-and-reap-validation",
        "successful process or exclusive reap is unproved",
      );
    }
    if (
      cgroupProcsBytes.length !== 0 ||
      cgroupEventsBytes.toString("utf8") !== "populated 0\nfrozen 0\n" ||
      cgroupPidsCurrentBytes.toString("utf8") !== "0\n" ||
      observations.cgroupQuiescence.path !== containment.cgroupPath ||
      observations.cgroupQuiescence.procsSha256 !== sha256(cgroupProcsBytes) ||
      observations.cgroupQuiescence.eventsSha256 !==
        sha256(cgroupEventsBytes) ||
      observations.cgroupQuiescence.pidsCurrentSha256 !==
        sha256(cgroupPidsCurrentBytes) ||
      observations.cgroupQuiescence.processCount !== 0 ||
      observations.cgroupQuiescence.populated !== false ||
      observations.cgroupQuiescence.pidsCurrent !== 0
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "quiescence-validation",
        "complete cgroup quiescence is unproved",
      );
    }
    const executable = observations.target.executable;
    if (
      !Array.isArray(observations.target.ancestors) ||
      observations.target.ancestors.length !== 2
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "target-validation",
        "held target ancestry is not exact",
      );
    }
    const [release, deps] = observations.target.ancestors;
    const directoryKeys = [
      "logicalPath",
      "leafName",
      "heldFd",
      "device",
      "inode",
      "uid",
      "gid",
      "mode",
      "filesystemType",
    ];
    exactKeys(observations.target.root, directoryKeys, "target root", fail);
    for (const [index, ancestor] of observations.target.ancestors.entries()) {
      exactKeys(
        ancestor,
        [...directoryKeys, "parentDevice", "parentInode"],
        `target ancestor ${index}`,
        fail,
      );
    }
    exactKeys(
      executable,
      [
        "logicalPath",
        "leafName",
        "heldFd",
        "device",
        "inode",
        "uid",
        "gid",
        "mode",
        "parentDevice",
        "parentInode",
        "bytes",
        "sha256",
        "elf",
      ],
      "target executable",
      fail,
    );
    exactKeys(
      executable.elf,
      [
        "elfClass",
        "elfData",
        "elfMachine",
        "interpreter",
        "soname",
        "needed",
        "rpath",
        "runpath",
        "sha256",
      ],
      "target ELF",
      fail,
    );
    let elf;
    try {
      elf = parseG17Elf64(executableBytes);
    } catch (error) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "target-validation",
        "held target ELF is invalid",
        error,
      );
    }
    if (
      elf === null ||
      executable.bytes !== executableBytes.length ||
      executable.sha256 !== sha256(executableBytes) ||
      executable.elf.sha256 !== executable.sha256 ||
      !isDeepStrictEqual(
        Object.fromEntries(
          Object.entries(executable.elf).filter(([key]) => key !== "sha256"),
        ),
        elf,
      ) ||
      observations.target.generation !== id.targetGeneration ||
      observations.target.root.logicalPath !== "/state/target" ||
      observations.target.root.leafName !== "target" ||
      observations.target.root.heldFd !== true ||
      observations.target.root.device !==
        source.value.workspace.targetChild.device ||
      observations.target.root.inode !==
        source.value.workspace.targetChild.inode ||
      observations.target.root.uid !== source.value.workspace.targetChild.uid ||
      observations.target.root.gid !== source.value.workspace.targetChild.gid ||
      observations.target.root.filesystemType !==
        source.value.workspace.targetChild.filesystemType ||
      observations.target.root.leafName !==
        source.value.workspace.targetChild.leafName ||
      release?.logicalPath !== "/state/target/release" ||
      release?.leafName !== "release" ||
      release?.heldFd !== true ||
      deps?.logicalPath !== "/state/target/release/deps" ||
      deps?.leafName !== "deps" ||
      deps?.heldFd !== true ||
      executable.heldFd !== true ||
      !CARGO_EXECUTABLE_PATH.test(executable.logicalPath ?? "") ||
      executable.logicalPath !== `${deps.logicalPath}/${executable.leafName}` ||
      release.parentDevice !== observations.target.root.device ||
      release.parentInode !== observations.target.root.inode ||
      deps.parentDevice !== release.device ||
      deps.parentInode !== release.inode ||
      executable.parentDevice !== deps.device ||
      executable.parentInode !== deps.inode ||
      [observations.target.root, release, deps].some(
        (directory) =>
          directory.mode !== 0o040755 ||
          directory.device !== observations.target.root.device ||
          directory.uid !== observations.target.root.uid ||
          directory.gid !== observations.target.root.gid ||
          directory.filesystemType !== observations.target.root.filesystemType,
      ) ||
      executable.mode !== 0o100555 ||
      executable.device !== observations.target.root.device ||
      executable.uid !== observations.target.root.uid ||
      executable.gid !== observations.target.root.gid ||
      observations.cargo.executableLogicalPath !== executable.logicalPath ||
      observations.cargo.executableSha256 !== executable.sha256
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "target-validation",
        "held target ancestry, metadata, or ELF drifted",
      );
    }
    if (
      observations.workspaceFinish.observed !== true ||
      observations.workspaceFinish.lifecycleGeneration !==
        id.lifecycleGeneration ||
      observations.workspaceFinish.sourceProjectionRawSha256 !==
        source.identity.rawSha256 ||
      observations.workspaceFinish.workspaceGeneration !==
        id.workspaceGeneration ||
      observations.workspaceFinish.targetGeneration !== id.targetGeneration
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "workspace-finish-validation",
        "workspace finish drifted",
      );
    }
    return deepFreeze({
      fixture,
      issuerRequirements,
      source,
      request,
      helper,
      helperDocument,
      policyBinding,
      containment,
      containmentDocument,
      status,
      statusBytes,
      observations: g17PrivateOwnerV3Clone(observations),
    });
  }

  function buildOwner(normalized) {
    const unsigned = {
      schema: OWNER_SCHEMA,
      status: STATUS,
      identity: g17PrivateOwnerV3Clone(normalized.fixture.identity),
      bindings: {
        issuerRequirements: g17PrivateOwnerV3Clone(
          normalized.issuerRequirements,
        ),
        sourceProjection: {
          ...g17PrivateOwnerV3Clone(normalized.source.identity),
          controlRunId: normalized.fixture.identity.controlRunId,
          buildId: normalized.fixture.identity.buildId,
          productRole: normalized.fixture.identity.productRole,
          workspaceGeneration: normalized.fixture.identity.workspaceGeneration,
          targetGeneration: normalized.fixture.identity.targetGeneration,
        },
        executionRequestV2: g17PrivateOwnerV3Clone(normalized.request.identity),
        helperAttestationV1: {
          ...g17PrivateOwnerV3Clone(normalized.helper.identity),
          requestRawSha256: normalized.request.identity.rawSha256,
          requestContentHash: normalized.request.identity.contentHash,
        },
        statusTranscriptV1: {
          schema: "oxigraph.g1.7-cargo-execveat-status/v1",
          rawSha256: sha256(normalized.statusBytes),
          bytes: normalized.statusBytes.length,
        },
        isolationPolicyV2: g17PrivateOwnerV3Clone(normalized.policyBinding),
        containmentV2: {
          ...g17PrivateOwnerV3Clone(normalized.containment.identity),
          requirementsSha256: G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
          executionRequestRawSha256: normalized.request.identity.rawSha256,
          helperAttestationRawSha256: normalized.helper.identity.rawSha256,
        },
        qualifiedNativeAdapter: null,
        qualifiedDurableEffect: null,
      },
      observations: g17PrivateOwnerV3Clone(normalized.observations),
      physicalOrigin: false,
      binding: null,
      finalDecisionEligible: false,
      authority: g17PrivateOwnerV3Clone(AUTHORITY),
      nonclaims: g17PrivateOwnerV3Clone(NONCLAIMS),
    };
    return deepFreeze({
      ...unsigned,
      contentHash: canonicalSha256(unsigned),
    });
  }

  function identityFor(owner, bytes) {
    return deepFreeze({
      schema: OWNER_SCHEMA,
      rawSha256: sha256(bytes),
      contentHash: owner.contentHash,
    });
  }

  function projectionFor(owner, identity) {
    return deepFreeze({
      schema: PROJECTION_SCHEMA,
      status: STATUS,
      owner: g17PrivateOwnerV3Clone(identity),
      identity: g17PrivateOwnerV3Clone(owner.identity),
      bindings: g17PrivateOwnerV3Clone(owner.bindings),
      observations: g17PrivateOwnerV3Clone(owner.observations),
      physicalOrigin: false,
      binding: null,
      finalDecisionEligible: false,
      authority: g17PrivateOwnerV3Clone(AUTHORITY),
      nonclaims: g17PrivateOwnerV3Clone(NONCLAIMS),
    });
  }

  function artifactEnvelope(bytes) {
    const stored = Buffer.from(bytes);
    return Object.freeze({
      name: ARTIFACT_NAME,
      rawSha256: sha256(stored),
      get bytes() {
        return Buffer.from(stored);
      },
    });
  }

  function created(owner, bytes, includeArtifact) {
    const identity = identityFor(owner, bytes);
    const entries = {
      owner,
      identity,
      projection: projectionFor(owner, identity),
    };
    if (includeArtifact) entries.artifact = artifactEnvelope(bytes);
    return Object.freeze(entries);
  }

  function createCapability(input) {
    const envelope = snapshot(input, "test capability input", fail);
    exactKeys(envelope, ["fixture"], "test capability input", fail);
    const normalized = validateFixture(envelope.fixture);
    const scenario = {
      predecessorAttestationsExact: true,
      sourceWorkspaceRevalidated: true,
      requestV2: g17PrivateOwnerV3Clone(normalized.request.identity),
      helperAttestation: {
        ...g17PrivateOwnerV3Clone(normalized.helper.identity),
        requestRawSha256: normalized.request.identity.rawSha256,
        requestContentHash: normalized.request.identity.contentHash,
        sourceLogicalName: normalized.helperDocument.value.source.logicalName,
        sourceSha256: normalized.helperDocument.value.source.sha256,
        executableSha256: normalized.helperDocument.value.executable.sha256,
      },
      heldHelperFd8: {
        fd: 8,
        role: "helperSelfExecutable",
        kind: "regular-file",
        descriptorAccess: "read-only",
        cloexecImmediatelyBeforeCargoExecveat: true,
        sourceLogicalName: normalized.helperDocument.value.source.logicalName,
        sourceSha256: normalized.helperDocument.value.source.sha256,
        executableSha256: normalized.helperDocument.value.executable.sha256,
      },
      descriptorBoundary: g17PrivateOwnerV3Clone(
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.descriptorBoundary,
      ),
    };
    const adapter = async (observedScenario) => {
      if (!isDeepStrictEqual(observedScenario, scenario)) {
        throw new TypeError("issuer scenario differs from verified fixture");
      }
      return Object.fromEntries(
        [
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
        ].map((key) => [key, true]),
      );
    };
    const capability = createG17BenchmarkPrivateBuildIssuerV1ForTesting({
      adapter,
      scenario,
    });
    liveCapabilities.set(capability, { normalized });
    return capability;
  }

  async function createArtifact(capability) {
    const state =
      capability !== null &&
      (typeof capability === "object" || typeof capability === "function")
        ? liveCapabilities.get(capability)
        : undefined;
    if (state === undefined) {
      fail(
        "PRIVATE_CAPABILITY_INVALID",
        "capability-consumption",
        "private test capability is not live for this module instance",
      );
    }
    liveCapabilities.delete(capability);
    let trace;
    try {
      trace = await runG17BenchmarkPrivateBuildIssuerV1(capability);
    } catch (error) {
      if (isG17BenchmarkPrivateBuildIssuerV1Fault(error)) {
        fail(
          "PRIVATE_CAPABILITY_INVALID",
          "capability-consumption",
          "private issuer capability is no longer live",
          error,
        );
      }
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "issuer-execution",
        "private issuer dependency failed unexpectedly",
        error,
      );
    }
    const expectedTrace = expectedPrivateIssuerTrace();
    if (
      !isG17BenchmarkPrivateBuildIssuerV1TestTrace(trace) ||
      !isDeepStrictEqual(trace, expectedTrace)
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "issuer-trace-validation",
        "private issuer terminal trace drifted",
      );
    }
    const owner = buildOwner(state.normalized);
    const bytes = g17PrivateOwnerV3CanonicalBytes(owner);
    if (bytes.length > MAX_BYTES) {
      fail("LIMIT_EXCEEDED", "canonical-encoding", "owner exceeds bound");
    }
    return created(owner, bytes, true);
  }

  function decodeOwner(bytes) {
    const captured = bounded(bytes, MAX_BYTES, "owner artifact");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(captured);
    } catch (error) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner is not UTF-8",
        error,
      );
    }
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner framing drifted",
      );
    }
    let owner;
    try {
      owner = JSON.parse(text);
      owner = snapshot(owner, "owner document", fail);
    } catch (error) {
      if (error instanceof G17BenchmarkBuildOwnerV3ContractError) throw error;
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner JSON drifted",
        error,
      );
    }
    if (owner === null || typeof owner !== "object" || Array.isArray(owner)) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner JSON is not a record",
      );
    }
    if (!captured.equals(g17PrivateOwnerV3CanonicalBytes(owner))) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner is not canonical JSON plus LF",
      );
    }
    return { owner, bytes: captured };
  }

  function verifyArtifact(input) {
    const envelope = snapshot(input, "verification input", fail);
    exactKeys(envelope, ["bytes", "fixture"], "verification input", fail);
    const decoded = decodeOwner(envelope.bytes);
    const { contentHash, ...unsigned } = decoded.owner;
    if (
      typeof contentHash !== "string" ||
      !DIGEST.test(contentHash) ||
      contentHash !== canonicalSha256(unsigned)
    ) {
      fail(
        "CONTENT_HASH_MISMATCH",
        "content-hash-validation",
        "owner contentHash does not verify",
      );
    }
    exactKeys(decoded.owner, ROOT_KEYS, "owner", fail);
    exactKeys(decoded.owner.identity, IDENTITY_KEYS, "owner identity", fail);
    if (
      decoded.owner.schema !== OWNER_SCHEMA ||
      decoded.owner.status !== STATUS
    ) {
      fail("IDENTITY_INVALID", "identity-validation", "owner identity drifted");
    }
    const normalized = validateFixture(envelope.fixture);
    const expected = buildOwner(normalized);
    if (!isDeepStrictEqual(decoded.owner.identity, expected.identity)) {
      fail(
        "EXPECTED_INPUT_MISMATCH",
        "expected-identity-validation",
        "owner identity differs from expected fixture",
      );
    }
    exactKeys(decoded.owner.bindings, BINDING_KEYS, "owner bindings", fail);
    if (!isDeepStrictEqual(decoded.owner.bindings, expected.bindings)) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-binding",
        "owner predecessor bindings drifted",
      );
    }
    exactKeys(
      decoded.owner.observations,
      OBSERVATION_KEYS,
      "owner observations",
      fail,
    );
    if (!isDeepStrictEqual(decoded.owner.observations, expected.observations)) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "observation-binding",
        "owner observations drifted",
      );
    }
    if (
      decoded.owner.physicalOrigin !== false ||
      decoded.owner.binding !== null ||
      decoded.owner.finalDecisionEligible !== false ||
      !isDeepStrictEqual(decoded.owner.authority, AUTHORITY) ||
      !isDeepStrictEqual(decoded.owner.nonclaims, NONCLAIMS) ||
      decoded.owner.bindings.qualifiedNativeAdapter !== null ||
      decoded.owner.bindings.qualifiedDurableEffect !== null
    ) {
      fail(
        "AUTHORITY_OVERCLAIM",
        "authority-validation",
        "owner overclaims origin, authority, or eligibility",
      );
    }
    return created(deepFreeze(decoded.owner), decoded.bytes, false);
  }

  return Object.freeze({
    G17_BENCHMARK_BUILD_OWNER_V3_SCHEMA: OWNER_SCHEMA,
    G17_BENCHMARK_BUILD_OWNER_V3_PROJECTION_SCHEMA: PROJECTION_SCHEMA,
    G17_BENCHMARK_BUILD_OWNER_V3_ARTIFACT_NAME: ARTIFACT_NAME,
    G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES: MAX_BYTES,
    G17_BENCHMARK_BUILD_OWNER_V3_LIMITS: LIMITS,
    G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES: ERROR_CODES,
    G17BenchmarkBuildOwnerV3ContractError,
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY: AUTHORITY,
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS: NONCLAIMS,
    g17BenchmarkBuildOwnerV3Readiness() {
      return READINESS;
    },
    createG17BenchmarkBuildOwnerV3CapabilityForTesting: createCapability,
    createG17BenchmarkBuildOwnerV3Artifact: createArtifact,
    verifyG17BenchmarkBuildOwnerV3Artifact: verifyArtifact,
  });
}

function assertErrorSurface(error, candidate, code, label, expected = {}) {
  const prefix = `G1.7 benchmark build owner v3 contract: [${code}] `;
  assert.equal(
    error instanceof candidate.G17BenchmarkBuildOwnerV3ContractError,
    true,
    label,
  );
  assert.equal(error.name, "G17BenchmarkBuildOwnerV3ContractError", label);
  assert.equal(Object.hasOwn(error, "code"), true, label);
  assert.equal(error.code, code, label);
  assert.equal(Object.hasOwn(error, "phase"), true, label);
  assert.equal(typeof error.phase, "string", label);
  assert.equal(
    error.message.startsWith(`${prefix}${error.phase}: `),
    true,
    label,
  );
  assert.equal(
    error.message.length > prefix.length + error.phase.length + 2,
    true,
    label,
  );
  if (expected.phase !== undefined) {
    assert.equal(error.phase, expected.phase, label);
  }
  if (expected.message !== undefined) {
    assert.equal(
      error.message,
      `${prefix}${error.phase}: ${expected.message}`,
      label,
    );
  }
}

function assertContractError(candidate, code, operation, label, expected = {}) {
  assert.throws(operation, (error) => {
    assertErrorSurface(error, candidate, code, label, expected);
    return true;
  });
}

async function assertContractRejects(
  candidate,
  code,
  operation,
  label,
  expected = {},
) {
  await assert.rejects(operation, (error) => {
    assertErrorSurface(error, candidate, code, label, expected);
    return true;
  });
}

function resealOwner(owner) {
  const { contentHash: _ignored, ...unsigned } = owner;
  return g17PrivateOwnerV3CanonicalBytes({
    ...unsigned,
    contentHash: canonicalSha256(unsigned),
  });
}

function rebindFixtureStdout(fixture) {
  fixture.observations.streams.stdout.bytes = fixture.stdoutBytes.length;
  fixture.observations.streams.stdout.sha256 = sha256(fixture.stdoutBytes);
  fixture.observations.streams.combinedBytes =
    fixture.stdoutBytes.length + fixture.stderrBytes.length;
}

function rewriteCargoRecords(fixture, mutate) {
  const records = fixture.stdoutBytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  mutate(records);
  fixture.stdoutBytes = Buffer.from(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  rebindFixtureStdout(fixture);
}

function mutateCargoCompilerArtifact(fixture, mutate) {
  rewriteCargoRecords(fixture, (records) => {
    const artifacts = records.filter(
      (record) => record.reason === "compiler-artifact",
    );
    assert.equal(artifacts.length, 1);
    mutate(artifacts[0]);
  });
}

function assertCandidateSourceStructure(source) {
  const { program: ast } = parseCandidateModuleAst(source);
  const importDeclarations = ast.body.filter(
    (node) => node.type === "ImportDeclaration",
  );
  assert.deepEqual(importDeclarations.map((node) => node.source.value).sort(), [
    "../routing/features.mjs",
    "./benchmark-execution-plan.mjs",
    "./benchmark-execution-request-v2-contract.mjs",
    "./benchmark-private-build-issuer-v1-contract.mjs",
    "./benchmark-private-build-issuer-v1.mjs",
    "./cargo-execveat-helper-attestation-contract.mjs",
    "./cargo-execveat-status-protocol-contract.mjs",
    "./native-elf.mjs",
    "./non-tmpfs-build-isolation-v2-contract.mjs",
    "./non-tmpfs-containment-v2-contract.mjs",
    "node:crypto",
    "node:util",
  ]);
  const importedBindings = importDeclarations
    .flatMap((declaration) =>
      declaration.specifiers.map((specifier) => {
        assert.equal(specifier.type, "ImportSpecifier");
        assert.equal(specifier.imported.type, "Identifier");
        assert.equal(specifier.local.type, "Identifier");
        return `${declaration.source.value}:${specifier.imported.name}:${specifier.local.name}`;
      }),
    )
    .sort();
  assert.deepEqual(importedBindings, [
    "../routing/features.mjs:canonicalJson:canonicalJson",
    "../routing/features.mjs:canonicalSha256:canonicalSha256",
    "./benchmark-execution-plan.mjs:G17_BENCHMARK_BUILD_PLAN:G17_BENCHMARK_BUILD_PLAN",
    "./benchmark-execution-request-v2-contract.mjs:G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING:G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING",
    "./benchmark-execution-request-v2-contract.mjs:verifyG17BenchmarkExecutionRequestV2Artifact:verifyG17BenchmarkExecutionRequestV2Artifact",
    "./benchmark-private-build-issuer-v1-contract.mjs:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY",
    "./benchmark-private-build-issuer-v1-contract.mjs:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS",
    "./benchmark-private-build-issuer-v1-contract.mjs:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS",
    "./benchmark-private-build-issuer-v1-contract.mjs:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256:G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256",
    "./benchmark-private-build-issuer-v1.mjs:createG17BenchmarkPrivateBuildIssuerV1ForTesting:createG17BenchmarkPrivateBuildIssuerV1ForTesting",
    "./benchmark-private-build-issuer-v1.mjs:isG17BenchmarkPrivateBuildIssuerV1Fault:isG17BenchmarkPrivateBuildIssuerV1Fault",
    "./benchmark-private-build-issuer-v1.mjs:isG17BenchmarkPrivateBuildIssuerV1TestTrace:isG17BenchmarkPrivateBuildIssuerV1TestTrace",
    "./benchmark-private-build-issuer-v1.mjs:runG17BenchmarkPrivateBuildIssuerV1:runG17BenchmarkPrivateBuildIssuerV1",
    "./cargo-execveat-helper-attestation-contract.mjs:verifyG17CargoExecveatHelperAttestationArtifact:verifyG17CargoExecveatHelperAttestationArtifact",
    "./cargo-execveat-status-protocol-contract.mjs:verifyG17CargoExecveatStatusProtocol:verifyG17CargoExecveatStatusProtocol",
    "./native-elf.mjs:parseG17Elf64:parseG17Elf64",
    "./non-tmpfs-build-isolation-v2-contract.mjs:G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES:G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES",
    "./non-tmpfs-build-isolation-v2-contract.mjs:verifyG17NonTmpfsBuildIsolationV2PolicyArtifact:verifyG17NonTmpfsBuildIsolationV2PolicyArtifact",
    "./non-tmpfs-containment-v2-contract.mjs:G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256:G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256",
    "./non-tmpfs-containment-v2-contract.mjs:verifyG17NonTmpfsContainmentV2Artifact:verifyG17NonTmpfsContainmentV2Artifact",
    "node:crypto:createHash:createHash",
    "node:util:isDeepStrictEqual:isDeepStrictEqual",
    "node:util:types:types",
  ]);
  assert.equal(
    ast.body.some(
      (node) =>
        (node.type === "ExportAllDeclaration" ||
          node.type === "ExportNamedDeclaration") &&
        node.source !== null,
    ),
    false,
  );
  assertScopedAmbientReferencePolicy(ast, source);
  assert.doesNotMatch(source, /openrouter/iu);
}

async function assertCandidateContract(candidate, source = null) {
  assert.deepEqual(Object.keys(candidate).sort(), [...EXPECTED_EXPORTS].sort());
  assert.equal(candidate.G17_BENCHMARK_BUILD_OWNER_V3_SCHEMA, OWNER_SCHEMA);
  assert.equal(
    candidate.G17_BENCHMARK_BUILD_OWNER_V3_PROJECTION_SCHEMA,
    PROJECTION_SCHEMA,
  );
  assert.equal(
    candidate.G17_BENCHMARK_BUILD_OWNER_V3_ARTIFACT_NAME,
    ARTIFACT_NAME,
  );
  assert.equal(candidate.G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES, MAX_BYTES);
  assert.deepEqual(candidate.G17_BENCHMARK_BUILD_OWNER_V3_LIMITS, LIMITS);
  assert.deepEqual(
    candidate.G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES,
    ERROR_CODES,
  );
  assert.deepEqual(candidate.G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY, AUTHORITY);
  assert.deepEqual(candidate.G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS, NONCLAIMS);
  const readiness = candidate.g17BenchmarkBuildOwnerV3Readiness();
  assert.deepEqual(readiness, READINESS);
  assert.equal(Object.isFrozen(readiness), true);
  assert.equal(candidate.g17BenchmarkBuildOwnerV3Readiness.length, 0);
  assert.equal(
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting.length,
    1,
  );
  assert.equal(candidate.createG17BenchmarkBuildOwnerV3Artifact.length, 1);
  assert.equal(candidate.verifyG17BenchmarkBuildOwnerV3Artifact.length, 1);
  assert.equal(candidate.G17BenchmarkBuildOwnerV3ContractError.length, 3);
  const publicError = new candidate.G17BenchmarkBuildOwnerV3ContractError(
    "INPUT_SHAPE_INVALID",
    "contract-surface",
    "example",
  );
  assertErrorSurface(
    publicError,
    candidate,
    "INPUT_SHAPE_INVALID",
    "public error constructor",
    { phase: "contract-surface", message: "example" },
  );
  assert.deepEqual(Object.keys(publicError), ["name", "code", "phase"]);
  assert.equal(publicError.cause, undefined);
  assert.throws(
    () =>
      new candidate.G17BenchmarkBuildOwnerV3ContractError(
        "UNKNOWN",
        "contract-surface",
        "example",
      ),
    (error) =>
      error instanceof TypeError &&
      error.message === "unknown build-owner-v3 code",
  );
  assertDeepFrozen(candidate.G17_BENCHMARK_BUILD_OWNER_V3_LIMITS);
  assertDeepFrozen(candidate.G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES);
  assertDeepFrozen(candidate.G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY);
  assertDeepFrozen(candidate.G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS);
  assert.equal(
    Object.keys(candidate.G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY).length,
    16,
  );
  assert.equal(
    Object.values(candidate.G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    Object.values(candidate.G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS).every(
      (value) => value === false,
    ),
    true,
  );

  const allGenerations = [];
  for (const [index, plan] of G17_BENCHMARK_BUILD_PLAN.entries()) {
    const fixture = await createG17PrivateOwnerV3Fixture({
      buildIndex: index,
      salt: String(index + 1),
    });
    const reference = createReferenceCandidate();
    const referenceCapability =
      reference.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: g17PrivateOwnerV3Clone(fixture),
      });
    const expected =
      await reference.createG17BenchmarkBuildOwnerV3Artifact(
        referenceCapability,
      );
    const capabilityInput = { fixture };
    const assertCapabilityInputUnchanged =
      captureCallerInputState(capabilityInput);
    const capability =
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting(
        capabilityInput,
      );
    assertCapabilityInputUnchanged("capability mint input");
    assert.deepEqual(Object.keys(capability), ["schema"]);
    assert.equal(
      capability.schema,
      "oxigraph.g1.7-benchmark-private-build-issuer-test-capability/v1",
    );
    assert.equal(Object.isFrozen(capability), true);
    const createdPromise =
      candidate.createG17BenchmarkBuildOwnerV3Artifact(capability);
    assert.equal(createdPromise instanceof Promise, true);
    const created = await createdPromise;
    assert.equal(Object.isFrozen(created), true);
    assertDeepFrozen(created);
    assert.deepEqual(created.owner, expected.owner);
    assert.deepEqual(created.identity, expected.identity);
    assert.deepEqual(created.projection, expected.projection);
    assert.deepEqual(created.artifact.name, expected.artifact.name);
    assert.deepEqual(created.artifact.rawSha256, expected.artifact.rawSha256);
    assert.deepEqual(created.artifact.bytes, expected.artifact.bytes);
    assert.deepEqual(Object.keys(created), [
      "owner",
      "identity",
      "projection",
      "artifact",
    ]);
    assert.equal(created.owner.identity.buildId, plan.buildId);
    assert.equal(created.owner.identity.productRole, plan.productRole);
    assert.equal(created.owner.identity.ordinal, index + 1);
    assert.equal(created.owner.physicalOrigin, false);
    assert.equal(created.owner.binding, null);
    assert.equal(created.owner.finalDecisionEligible, false);
    assert.equal(created.owner.bindings.qualifiedNativeAdapter, null);
    assert.equal(created.owner.bindings.qualifiedDurableEffect, null);
    assert.deepEqual(Object.keys(created.owner.bindings.sourceProjection), [
      "schema",
      "rawSha256",
      "contentHash",
      "controlRunId",
      "buildId",
      "productRole",
      "workspaceGeneration",
      "targetGeneration",
    ]);
    allGenerations.push(
      ...Object.entries(created.owner.identity)
        .filter(([key]) => key.endsWith("Generation"))
        .map(([, value]) => value),
    );
    assert.equal(created.artifact.name, ARTIFACT_NAME);
    assert.equal(created.artifact.rawSha256, sha256(created.artifact.bytes));
    assert.notEqual(created.artifact.bytes, created.artifact.bytes);
    const mutableArtifactRead = created.artifact.bytes;
    const immutableArtifactBytes = Buffer.from(expected.artifact.bytes);
    mutableArtifactRead.fill(0);
    assert.deepEqual(created.artifact.bytes, immutableArtifactBytes);
    assert.equal(created.artifact.rawSha256, sha256(immutableArtifactBytes));
    assert.deepEqual(created.owner, expected.owner);
    assert.deepEqual(created.projection, expected.projection);
    assert.deepEqual(
      Object.keys(JSON.parse(created.artifact.bytes.toString("utf8"))),
      [...ROOT_KEYS].sort(),
    );
    const verificationBytes = created.artifact.bytes;
    const verificationFixture = g17PrivateOwnerV3Clone(fixture);
    const verificationBytesBefore = Buffer.from(verificationBytes);
    const verificationFixtureBefore =
      g17PrivateOwnerV3Clone(verificationFixture);
    const verificationInput = {
      bytes: verificationBytes,
      fixture: verificationFixture,
    };
    const assertVerificationInputUnchanged =
      captureCallerInputState(verificationInput);
    const verified =
      await candidate.verifyG17BenchmarkBuildOwnerV3Artifact(verificationInput);
    assertVerificationInputUnchanged("verification input");
    assert.deepEqual(verificationBytes, verificationBytesBefore);
    assert.deepEqual(verificationFixture, verificationFixtureBefore);
    const referenceVerified = reference.verifyG17BenchmarkBuildOwnerV3Artifact({
      bytes: created.artifact.bytes,
      fixture: g17PrivateOwnerV3Clone(fixture),
    });
    const candidateVerifiedReference =
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: expected.artifact.bytes,
        fixture: g17PrivateOwnerV3Clone(fixture),
      });
    assert.deepEqual(verified.owner, created.owner);
    assert.deepEqual(verified.identity, created.identity);
    assert.deepEqual(verified.projection, created.projection);
    assert.deepEqual(referenceVerified.owner, created.owner);
    assert.deepEqual(candidateVerifiedReference.owner, expected.owner);
    assert.deepEqual(Object.keys(verified), [
      "owner",
      "identity",
      "projection",
    ]);
    assert.equal(Object.isFrozen(verified), true);
    assertDeepFrozen(verified);
    assertDeepFrozen(created.owner);
    assertDeepFrozen(created.projection);
    assertDeepFrozen(verified.owner);
    assertDeepFrozen(verified.projection);
    await assertContractRejects(
      candidate,
      "PRIVATE_CAPABILITY_INVALID",
      () => candidate.createG17BenchmarkBuildOwnerV3Artifact(capability),
      "capability reuse",
    );
    await assert.rejects(
      () => runG17BenchmarkPrivateBuildIssuerV1(capability),
      (error) => isG17BenchmarkPrivateBuildIssuerV1Fault(error),
    );
  }
  assert.equal(allGenerations.length, G17_BENCHMARK_BUILD_PLAN.length * 6);
  assert.equal(new Set(allGenerations).size, allGenerations.length);

  const issuerProofCapability =
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: await createG17PrivateOwnerV3Fixture(),
    });
  const issuerTracePromise = runG17BenchmarkPrivateBuildIssuerV1(
    issuerProofCapability,
  );
  assert.equal(issuerTracePromise instanceof Promise, true);
  const issuerTrace = await issuerTracePromise;
  assert.equal(isG17BenchmarkPrivateBuildIssuerV1TestTrace(issuerTrace), true);
  assert.deepEqual(issuerTrace, expectedPrivateIssuerTrace());
  await assertContractRejects(
    candidate,
    "PRIVATE_CAPABILITY_INVALID",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3Artifact(issuerProofCapability),
    "capability carries the private issuer brand",
    {
      phase: "capability-consumption",
      message: "private issuer capability is no longer live",
    },
  );

  for (const mutate of [
    (fixture) => {
      fixture.identity.ordinal = 2;
    },
    (fixture) => {
      fixture.identity.productRole = "performanceReference";
    },
    (fixture) => {
      fixture.identity.targetGeneration = fixture.identity.workspaceGeneration;
    },
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    mutate(fixture);
    assertContractError(
      candidate,
      "IDENTITY_INVALID",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      "role, ordinal, or generation substitution",
    );
  }
  const outOfRangeOrdinal = await createG17PrivateOwnerV3Fixture();
  outOfRangeOrdinal.identity.ordinal = G17_BENCHMARK_BUILD_PLAN.length + 1;
  assertContractError(
    candidate,
    "IDENTITY_INVALID",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: outOfRangeOrdinal,
      }),
    "out-of-range build ordinal",
    { phase: "identity-validation", message: "build order drifted" },
  );

  for (const lookalike of [
    {},
    {
      schema: "oxigraph.g1.7-benchmark-private-build-issuer-test-capability/v1",
    },
    new Proxy({}, {}),
    Object.create({
      schema: "oxigraph.g1.7-benchmark-private-build-issuer-test-capability/v1",
    }),
  ]) {
    await assertContractRejects(
      candidate,
      "PRIVATE_CAPABILITY_INVALID",
      () => candidate.createG17BenchmarkBuildOwnerV3Artifact(lookalike),
      "capability lookalike",
    );
  }
  const originalFixture = await createG17PrivateOwnerV3Fixture();
  const originalCapability =
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: originalFixture,
    });
  for (const forged of [
    new Proxy(originalCapability, {}),
    Object.create(originalCapability),
    { ...originalCapability },
    structuredClone(originalCapability),
  ]) {
    await assertContractRejects(
      candidate,
      "PRIVATE_CAPABILITY_INVALID",
      () => candidate.createG17BenchmarkBuildOwnerV3Artifact(forged),
      "capability forgery",
    );
  }
  await candidate.createG17BenchmarkBuildOwnerV3Artifact(originalCapability);
  const concurrentCapability =
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: await createG17PrivateOwnerV3Fixture(),
    });
  const concurrent = await Promise.allSettled([
    candidate.createG17BenchmarkBuildOwnerV3Artifact(concurrentCapability),
    candidate.createG17BenchmarkBuildOwnerV3Artifact(concurrentCapability),
  ]);
  assert.equal(
    concurrent.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const rejectedConcurrent = concurrent.find(
    ({ status }) => status === "rejected",
  );
  assert.equal(
    rejectedConcurrent.reason instanceof
      candidate.G17BenchmarkBuildOwnerV3ContractError,
    true,
  );
  assert.equal(rejectedConcurrent.reason.code, "PRIVATE_CAPABILITY_INVALID");
  const otherInstance = createReferenceCandidate();
  const foreignCapability =
    otherInstance.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: await createG17PrivateOwnerV3Fixture(),
    });
  await assertContractRejects(
    candidate,
    "PRIVATE_CAPABILITY_INVALID",
    () => candidate.createG17BenchmarkBuildOwnerV3Artifact(foreignCapability),
    "foreign module brand",
  );
  await otherInstance.createG17BenchmarkBuildOwnerV3Artifact(foreignCapability);

  const detachedFixture = await createG17PrivateOwnerV3Fixture();
  const detachedReference = createReferenceCandidate();
  const detachedExpected =
    await detachedReference.createG17BenchmarkBuildOwnerV3Artifact(
      detachedReference.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: g17PrivateOwnerV3Clone(detachedFixture),
      }),
    );
  const detachedCapability =
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: detachedFixture,
    });
  detachedFixture.identity.controlRunId = "mutated-after-mint";
  detachedFixture.sourceProjectionBytes.fill(0);
  detachedFixture.executionRequestV2Verification.bytes.fill(0);
  detachedFixture.observations.process.exitCode = 99;
  const detachedCreated =
    await candidate.createG17BenchmarkBuildOwnerV3Artifact(detachedCapability);
  assert.deepEqual(detachedCreated.owner, detachedExpected.owner);
  assert.deepEqual(
    detachedCreated.artifact.bytes,
    detachedExpected.artifact.bytes,
  );

  const hostileBases = await Promise.all(
    Array.from({ length: 4 }, () => createG17PrivateOwnerV3Fixture()),
  );
  for (const hostile of [
    new Proxy(hostileBases[0], {}),
    Object.create(hostileBases[1]),
    (() => {
      const fixture = hostileBases[2];
      Object.defineProperty(fixture, "schema", {
        enumerable: true,
        get() {
          throw new Error("fixture accessor executed");
        },
      });
      return fixture;
    })(),
    (() => {
      const fixture = hostileBases[3];
      fixture[Symbol("extra")] = true;
      return fixture;
    })(),
  ]) {
    assertContractError(
      candidate,
      "INPUT_SHAPE_INVALID",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture: hostile,
        }),
      "hostile fixture",
    );
  }
  assertContractError(
    candidate,
    "INPUT_SHAPE_INVALID",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: {},
      }),
    "missing fixture fields",
    { phase: "input-shape" },
  );
  let arrayAccessorReads = 0;
  const accessorArray = [null];
  Object.defineProperty(accessorArray, "0", {
    configurable: true,
    enumerable: true,
    get() {
      arrayAccessorReads += 1;
      return null;
    },
  });
  assertContractError(
    candidate,
    "INPUT_SHAPE_INVALID",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: accessorArray,
      }),
    "array accessor fixture",
    { phase: "input-snapshot" },
  );
  assert.equal(arrayAccessorReads, 0, "array accessor was not invoked");
  const nestedAccessorFixture = await createG17PrivateOwnerV3Fixture();
  const nestedAccessorArray =
    nestedAccessorFixture.observations.target.ancestors;
  const nestedAccessorValue = nestedAccessorArray[0];
  let nestedArrayAccessorReads = 0;
  Object.defineProperty(nestedAccessorArray, "0", {
    configurable: true,
    enumerable: true,
    get() {
      nestedArrayAccessorReads += 1;
      return nestedAccessorValue;
    },
  });
  assertContractError(
    candidate,
    "INPUT_SHAPE_INVALID",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: nestedAccessorFixture,
      }),
    "nested array accessor fixture",
    {
      phase: "input-snapshot",
      message:
        "test capability input.fixture.observations.target.ancestors.0 is not own enumerable data",
    },
  );
  assert.equal(
    nestedArrayAccessorReads,
    0,
    "nested array accessor was not invoked",
  );
  for (const [label, mutate, message] of [
    [
      "sparse nested array fixture",
      (array) => {
        delete array[0];
      },
      "test capability input.fixture.observations.target.ancestors array is sparse",
    ],
    [
      "extra-field nested array fixture",
      (array) => {
        array.extra = null;
      },
      "test capability input.fixture.observations.target.ancestors array is sparse",
    ],
    [
      "symbol-field nested array fixture",
      (array) => {
        array[Symbol("extra")] = null;
      },
      "test capability input.fixture.observations.target.ancestors has symbol fields",
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    mutate(fixture.observations.target.ancestors);
    assertContractError(
      candidate,
      "INPUT_SHAPE_INVALID",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      label,
      { phase: "input-snapshot", message },
    );
  }
  for (const mutate of [
    (fixture) => {
      fixture.observations.extra = false;
    },
    (fixture) => {
      fixture.observations.helperImage.extra = false;
    },
    (fixture) => {
      fixture.observations.status.extra = false;
    },
    (fixture) => {
      fixture.observations.process.extra = false;
    },
    (fixture) => {
      fixture.observations.streams.extra = false;
    },
    (fixture) => {
      fixture.observations.streams.stdout.extra = false;
    },
    (fixture) => {
      fixture.observations.streams.stderr.extra = false;
    },
    (fixture) => {
      fixture.observations.cargo.extra = false;
    },
    (fixture) => {
      fixture.observations.directReap.extra = false;
    },
    (fixture) => {
      fixture.observations.cgroupQuiescence.extra = false;
    },
    (fixture) => {
      fixture.observations.target.extra = false;
    },
    (fixture) => {
      fixture.observations.target.root.extra = false;
    },
    (fixture) => {
      fixture.observations.target.ancestors[0].extra = false;
    },
    (fixture) => {
      fixture.observations.target.executable.extra = false;
    },
    (fixture) => {
      fixture.observations.target.executable.elf.extra = false;
    },
    (fixture) => {
      fixture.observations.workspaceFinish.extra = false;
    },
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    mutate(fixture);
    assertContractError(
      candidate,
      "INPUT_SHAPE_INVALID",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      "nested observation fields",
    );
  }
  for (const [label, mutate] of [
    ["source projection", (value) => (value.guessedClaim = false)],
    ["source authority", (value) => (value.authority.guessedClaim = false)],
    [
      "source authorization",
      (value) => (value.authorization.guessedClaim = false),
    ],
    ["source product", (value) => (value.product.guessedClaim = false)],
    ["source evaluator", (value) => (value.evaluator.guessedClaim = false)],
    [
      "source evaluator composition",
      (value) => (value.evaluator.composition.guessedClaim = false),
    ],
    [
      "source evaluator path",
      (value) => (value.evaluator.paths[0].guessedClaim = false),
    ],
    [
      "source workspace parent",
      (value) => (value.workspace.parentRoot.guessedClaim = false),
    ],
    ["source workspace", (value) => (value.workspace.guessedClaim = false)],
    [
      "source workspace source child",
      (value) => (value.workspace.sourceChild.guessedClaim = false),
    ],
    [
      "source workspace target child",
      (value) => (value.workspace.targetChild.guessedClaim = false),
    ],
    ["source materialization", (value) => (value.source.guessedClaim = false)],
    [
      "source materialization Cargo lock",
      (value) => (value.source.cargoLock.guessedClaim = false),
    ],
    [
      "source materialization evaluator patch",
      (value) => (value.source.evaluatorPatch.guessedClaim = false),
    ],
    [
      "source excluded Gitlink",
      (value) => (value.source.excludedGitlinks[0].guessedClaim = false),
    ],
    [
      "source required Gitlink",
      (value) => (value.source.requiredGitlinks[0].guessedClaim = false),
    ],
    [
      "source symlink",
      (value) => (value.source.symlinks[0].guessedClaim = false),
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    const sourceValue = JSON.parse(
      fixture.sourceProjectionBytes.toString("utf8"),
    );
    delete sourceValue.contentHash;
    mutate(sourceValue);
    fixture.sourceProjectionBytes = g17PrivateOwnerV3Seal(sourceValue).bytes;
    assertContractError(
      candidate,
      "INPUT_SHAPE_INVALID",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      `${label} extra field`,
      { phase: "input-shape" },
    );
  }
  for (const [label, mutate] of [
    [
      "source product relation",
      (value) => {
        value.source.productCommit = "0".repeat(40);
      },
    ],
    [
      "source Cargo lock relation",
      (value) => {
        value.source.cargoLock.sha256 = "0".repeat(64);
      },
    ],
    [
      "source evaluator patch relation",
      (value) => {
        value.source.evaluatorPatch.sha256 = "0".repeat(64);
      },
    ],
    [
      "source workspace generation relation",
      (value) => {
        value.workspace.generation = `g17-workspace-${"f".repeat(64)}`;
      },
    ],
    [
      "source manifest identity",
      (value) => {
        value.source.manifestSha256 = "0".repeat(64);
      },
    ],
    [
      "source Cargo lock byte count",
      (value) => {
        value.source.cargoLock.bytes += 1;
      },
    ],
    [
      "source evaluator patch byte count",
      (value) => {
        value.source.evaluatorPatch.bytes += 1;
      },
    ],
    [
      "source generation coordinate",
      (value) => {
        value.workspace.parentRoot.inode = `${value.workspace.parentRoot.inode}0`;
        value.workspace.sourceChild.parentInode =
          value.workspace.parentRoot.inode;
        value.workspace.targetChild.parentInode =
          value.workspace.parentRoot.inode;
      },
    ],
    [
      "coordinated source object-closure substitution",
      (value) => {
        value.product.commit = "0".repeat(40);
        value.source.productCommit = value.product.commit;
        value.source.objectClosureSha256 = canonicalSha256({
          schema: "oxigraph.g1.7-product-source-object-closure/v1",
          product: value.product,
          evaluator: value.evaluator,
          effectiveTree: value.source.effectiveTree,
          requiredGitlinks: value.source.requiredGitlinks,
          excludedGitlinks: value.source.excludedGitlinks,
          symlinks: value.source.symlinks,
        });
      },
    ],
    [
      "coordinated source effective-tree substitution",
      (value) => {
        value.evaluator.composition.effectiveTree = "0".repeat(40);
        value.source.effectiveTree = value.evaluator.composition.effectiveTree;
        value.source.objectClosureSha256 = canonicalSha256({
          schema: "oxigraph.g1.7-product-source-object-closure/v1",
          product: value.product,
          evaluator: value.evaluator,
          effectiveTree: value.source.effectiveTree,
          requiredGitlinks: value.source.requiredGitlinks,
          excludedGitlinks: value.source.excludedGitlinks,
          symlinks: value.source.symlinks,
        });
      },
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    const sourceValue = JSON.parse(
      fixture.sourceProjectionBytes.toString("utf8"),
    );
    delete sourceValue.contentHash;
    mutate(sourceValue);
    fixture.sourceProjectionBytes = g17PrivateOwnerV3Seal(sourceValue).bytes;
    assertContractError(
      candidate,
      "PREDECESSOR_BINDING_DRIFT",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      label,
      { phase: "predecessor-verification" },
    );
  }
  for (const [label, bytes] of [
    ["null", Buffer.from("null\n", "utf8")],
    ["scalar", Buffer.from("1\n", "utf8")],
    ["array", Buffer.from("[]\n", "utf8")],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    fixture.sourceProjectionBytes = bytes;
    assertContractError(
      candidate,
      "PREDECESSOR_BINDING_DRIFT",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      `source projection ${label}`,
      { phase: "predecessor-decoding" },
    );
  }
  for (const [label, mutate] of [
    [
      "compiler artifact reason",
      (artifact) => {
        artifact.reason = "compiler-message";
      },
    ],
    [
      "compiler artifact package",
      (artifact) => {
        artifact.package_id = "path+file:///workspace/source/lib/other#0.1.0";
      },
    ],
    [
      "compiler artifact manifest",
      (artifact) => {
        artifact.manifest_path = "/workspace/source/lib/other/Cargo.toml";
      },
    ],
    [
      "compiler artifact target name",
      (artifact) => {
        artifact.target.name = "store";
      },
    ],
    [
      "compiler artifact target kind",
      (artifact) => {
        artifact.target.kind = ["bin"];
      },
    ],
    [
      "compiler artifact target crate type",
      (artifact) => {
        artifact.target.crate_types = ["lib"];
      },
    ],
    [
      "compiler artifact target source",
      (artifact) => {
        artifact.target.src_path =
          "/workspace/source/lib/oxigraph/benches/store.rs";
      },
    ],
    [
      "compiler artifact target edition",
      (artifact) => {
        artifact.target.edition = "2021";
      },
    ],
    [
      "compiler artifact target doc",
      (artifact) => {
        artifact.target.doc = true;
      },
    ],
    [
      "compiler artifact target doctest",
      (artifact) => {
        artifact.target.doctest = true;
      },
    ],
    [
      "compiler artifact target test",
      (artifact) => {
        artifact.target.test = true;
      },
    ],
    [
      "missing target required features",
      (artifact) => {
        delete artifact.target["required-features"];
      },
    ],
    [
      "substituted target required features",
      (artifact) => {
        artifact.target["required-features"] = [];
      },
    ],
    [
      "missing enabled Cargo features",
      (artifact) => {
        delete artifact.features;
      },
    ],
    [
      "substituted enabled Cargo features",
      (artifact) => {
        artifact.features = [];
      },
    ],
    [
      "compiler artifact target extension",
      (artifact) => {
        artifact.target.guessed = false;
      },
    ],
    [
      "compiler artifact profile optimization",
      (artifact) => {
        artifact.profile.opt_level = "2";
      },
    ],
    [
      "compiler artifact profile debug info",
      (artifact) => {
        artifact.profile.debuginfo = 1;
      },
    ],
    [
      "compiler artifact profile assertions",
      (artifact) => {
        artifact.profile.debug_assertions = true;
      },
    ],
    [
      "compiler artifact profile overflow checks",
      (artifact) => {
        artifact.profile.overflow_checks = true;
      },
    ],
    [
      "compiler artifact profile test mode",
      (artifact) => {
        artifact.profile.test = false;
      },
    ],
    [
      "compiler artifact profile extension",
      (artifact) => {
        artifact.profile.guessed = false;
      },
    ],
    [
      "compiler artifact filename",
      (artifact) => {
        artifact.filenames = [
          "/state/target/release/deps/transactional_write-ffffffffffffffff",
        ];
      },
    ],
    [
      "compiler artifact executable",
      (artifact) => {
        artifact.executable =
          "/state/target/release/deps/transactional_write-ffffffffffffffff";
      },
    ],
    [
      "compiler artifact freshness",
      (artifact) => {
        artifact.fresh = true;
      },
    ],
    [
      "compiler artifact extension",
      (artifact) => {
        artifact.guessed = false;
      },
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    mutateCargoCompilerArtifact(fixture, mutate);
    assertContractError(
      candidate,
      "OBSERVATION_BINDING_DRIFT",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      label,
      { phase: "observation-binding" },
    );
  }
  for (const [label, mutate, phase = "observation-binding"] of [
    [
      "duplicate selected compiler artifact",
      (fixture, records) => {
        records.splice(1, 0, g17PrivateOwnerV3Clone(records[0]));
        fixture.observations.cargo.lineCount = 3;
        fixture.observations.cargo.buildFinishedLine = 3;
      },
    ],
    [
      "duplicate build-finished record",
      (fixture, records) => {
        records.push(g17PrivateOwnerV3Clone(records.at(-1)));
        fixture.observations.cargo.lineCount = 3;
        fixture.observations.cargo.buildFinishedLine = 3;
      },
    ],
    [
      "unrelated artifact aliases selected executable",
      (fixture, records) => {
        const alias = g17PrivateOwnerV3Clone(records[0]);
        alias.package_id = "path+file:///workspace/source/lib/other#0.1.0";
        alias.manifest_path = "/workspace/source/lib/other/Cargo.toml";
        alias.target.name = "other";
        alias.target.src_path = "/workspace/source/lib/other/benches/other.rs";
        records.unshift(alias);
        fixture.observations.cargo.lineCount = 3;
        fixture.observations.cargo.compilerArtifactLine = 2;
        fixture.observations.cargo.buildFinishedLine = 3;
      },
    ],
    [
      "non-terminal build-finished record",
      (fixture, records) => {
        records.reverse();
        fixture.observations.cargo.compilerArtifactLine = 2;
        fixture.observations.cargo.buildFinishedLine = 1;
      },
    ],
    [
      "unsuccessful build-finished record",
      (fixture, records) => {
        records.at(-1).success = false;
        fixture.observations.cargo.buildFinishedSuccess = false;
      },
    ],
    [
      "extended build-finished record",
      (_fixture, records) => {
        records.at(-1).guessed = false;
      },
    ],
    [
      "missing build-finished record",
      (fixture, records) => {
        records.pop();
        fixture.observations.cargo.lineCount = 1;
        fixture.observations.cargo.buildFinishedLine = 0;
        fixture.observations.cargo.buildFinishedSuccess = false;
      },
      "cargo-jsonl-validation",
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    rewriteCargoRecords(fixture, (records) => mutate(fixture, records));
    assertContractError(
      candidate,
      "OBSERVATION_BINDING_DRIFT",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      label,
      { phase },
    );
  }
  const unrelatedCargoRecords = await createG17PrivateOwnerV3Fixture();
  rewriteCargoRecords(unrelatedCargoRecords, (records) => {
    const unrelatedArtifact = g17PrivateOwnerV3Clone(records[0]);
    unrelatedArtifact.package_id =
      "path+file:///workspace/source/lib/other#0.1.0";
    unrelatedArtifact.manifest_path = "/workspace/source/lib/other/Cargo.toml";
    unrelatedArtifact.target.name = "other";
    unrelatedArtifact.target.src_path =
      "/workspace/source/lib/other/benches/other.rs";
    unrelatedArtifact.filenames = [
      "/state/target/release/deps/other-0000000000000000",
    ];
    unrelatedArtifact.executable = unrelatedArtifact.filenames[0];
    records.unshift(
      {
        reason: "compiler-message",
        package_id: unrelatedArtifact.package_id,
        message: { rendered: null },
      },
      unrelatedArtifact,
    );
  });
  unrelatedCargoRecords.observations.cargo.lineCount = 4;
  unrelatedCargoRecords.observations.cargo.compilerArtifactLine = 3;
  unrelatedCargoRecords.observations.cargo.buildFinishedLine = 4;
  const unrelatedCargoCapability =
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: unrelatedCargoRecords,
    });
  await candidate.createG17BenchmarkBuildOwnerV3Artifact(
    unrelatedCargoCapability,
  );
  const invalidCargoUtf8 = await createG17PrivateOwnerV3Fixture();
  const packageVersionOffset = invalidCargoUtf8.stdoutBytes.indexOf(
    Buffer.from("0.6.0-dev", "utf8"),
  );
  assert.notEqual(packageVersionOffset, -1);
  invalidCargoUtf8.stdoutBytes[packageVersionOffset] = 0xff;
  rebindFixtureStdout(invalidCargoUtf8);
  assertContractError(
    candidate,
    "OBSERVATION_BINDING_DRIFT",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: invalidCargoUtf8,
      }),
    "Cargo JSONL invalid UTF-8 inside a string",
    { phase: "cargo-jsonl-validation", message: "Cargo JSONL is not UTF-8" },
  );

  const duplicateCargoMember = await createG17PrivateOwnerV3Fixture();
  duplicateCargoMember.stdoutBytes = Buffer.from(
    duplicateCargoMember.stdoutBytes
      .toString("utf8")
      .replace(
        /^\{"reason":"compiler-artifact",/u,
        '{"reason":"compiler-artifact","reason":"compiler-artifact",',
      ),
    "utf8",
  );
  rebindFixtureStdout(duplicateCargoMember);
  assertContractError(
    candidate,
    "OBSERVATION_BINDING_DRIFT",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: duplicateCargoMember,
      }),
    "Cargo JSONL duplicate member",
    { phase: "cargo-jsonl-validation" },
  );

  const duplicateNestedCargoMember = await createG17PrivateOwnerV3Fixture();
  duplicateNestedCargoMember.stdoutBytes = Buffer.from(
    duplicateNestedCargoMember.stdoutBytes
      .toString("utf8")
      .replace(
        '"target":{"kind":["bench"],',
        '"target":{"kind":["bench"],"kind":["bench"],',
      ),
    "utf8",
  );
  rebindFixtureStdout(duplicateNestedCargoMember);
  assertContractError(
    candidate,
    "OBSERVATION_BINDING_DRIFT",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: duplicateNestedCargoMember,
      }),
    "Cargo JSONL nested duplicate member",
    { phase: "cargo-jsonl-validation" },
  );

  const nonArrayAncestry = await createG17PrivateOwnerV3Fixture();
  nonArrayAncestry.observations.target.ancestors = null;
  assertContractError(
    candidate,
    "LIFECYCLE_CONTRADICTION",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: nonArrayAncestry,
      }),
    "non-array target ancestry",
    { phase: "target-validation" },
  );
  const coordinatedTargetRoot = await createG17PrivateOwnerV3Fixture();
  coordinatedTargetRoot.observations.target.root.inode = `${coordinatedTargetRoot.observations.target.root.inode}0`;
  coordinatedTargetRoot.observations.target.ancestors[0].parentInode =
    coordinatedTargetRoot.observations.target.root.inode;
  assertContractError(
    candidate,
    "LIFECYCLE_CONTRADICTION",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: coordinatedTargetRoot,
      }),
    "target root source identity cross-binding",
    { phase: "target-validation" },
  );

  const baseFixture = await createG17PrivateOwnerV3Fixture();
  const baseCapability =
    candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: baseFixture,
    });
  const base =
    await candidate.createG17BenchmarkBuildOwnerV3Artifact(baseCapability);
  const other = await createG17PrivateOwnerV3Fixture({
    buildIndex: 1,
    salt: "2",
  });
  assertContractError(
    candidate,
    "EXPECTED_INPUT_MISMATCH",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: base.artifact.bytes,
        fixture: other,
      }),
    "artifact identity differs from expected fixture",
    {
      phase: "expected-identity-validation",
      message: "owner identity differs from expected fixture",
    },
  );
  for (const [label, expectedCode, mutate] of [
    [
      "sourceProjectionBytes",
      "PREDECESSOR_BINDING_DRIFT",
      (fixture) => {
        fixture.sourceProjectionBytes = Buffer.from(
          other.sourceProjectionBytes,
        );
      },
    ],
    [
      "executionRequestV2Verification",
      "PREDECESSOR_BINDING_DRIFT",
      (fixture) => {
        fixture.executionRequestV2Verification = g17PrivateOwnerV3Clone(
          other.executionRequestV2Verification,
        );
      },
    ],
    [
      "helperAttestationV1Verification",
      "PREDECESSOR_BINDING_DRIFT",
      (fixture) => {
        fixture.helperAttestationV1Verification.bytes[0] ^= 1;
      },
    ],
    [
      "containmentV2Verification",
      "PREDECESSOR_BINDING_DRIFT",
      (fixture) => {
        fixture.containmentV2Verification = g17PrivateOwnerV3Clone(
          other.containmentV2Verification,
        );
      },
    ],
    [
      "statusTranscriptV1Verification",
      "OBSERVATION_BINDING_DRIFT",
      (fixture) => {
        fixture.statusTranscriptV1Verification.bytes[0] ^= 1;
      },
    ],
    [
      "stdoutBytes",
      "OBSERVATION_BINDING_DRIFT",
      (fixture) => {
        fixture.stdoutBytes[0] ^= 1;
      },
    ],
    [
      "stderrBytes",
      "OBSERVATION_BINDING_DRIFT",
      (fixture) => {
        fixture.stderrBytes[0] ^= 1;
      },
    ],
    [
      "executableBytes",
      "LIFECYCLE_CONTRADICTION",
      (fixture) => {
        fixture.executableBytes[0] ^= 1;
      },
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    mutate(fixture);
    assertContractError(
      candidate,
      expectedCode,
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      label,
    );
  }

  const tooDeep = {};
  let depthCursor = tooDeep;
  for (let depth = 0; depth <= LIMITS.maximumDepth; depth += 1) {
    depthCursor.child = {};
    depthCursor = depthCursor.child;
  }
  const tooManyNodes = Array.from({ length: 25 }, () =>
    Array.from({ length: LIMITS.maximumArrayLength }, () => ({})),
  );
  const oversizedPropertyFixture = await createG17PrivateOwnerV3Fixture();
  oversizedPropertyFixture.observations[
    "x".repeat(LIMITS.aggregateStringUtf8MaximumBytes + 1)
  ] = null;
  assertContractError(
    candidate,
    "LIMIT_EXCEEDED",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: oversizedPropertyFixture,
      }),
    "deep property names count toward aggregate strings",
    {
      phase: "input-snapshot",
      message:
        "test capability input.fixture.observations exceeds aggregate property-name and value strings",
    },
  );
  for (const [label, input] of [
    ["maximum depth", { fixture: tooDeep }],
    ["maximum nodes", { fixture: tooManyNodes }],
    [
      "maximum array length",
      { fixture: Array(LIMITS.maximumArrayLength + 1).fill(null) },
    ],
    [
      "maximum record properties",
      {
        fixture: Object.fromEntries(
          Array.from(
            { length: LIMITS.maximumPropertiesPerRecord + 1 },
            (_, index) => [`field${index}`, null],
          ),
        ),
      },
    ],
    [
      "single string maximum",
      { fixture: "x".repeat(LIMITS.singleStringUtf8MaximumBytes + 1) },
    ],
    [
      "aggregate string maximum",
      {
        fixture: Array(17).fill(
          "x".repeat(LIMITS.singleStringUtf8MaximumBytes),
        ),
      },
    ],
    [
      "property names count toward aggregate strings",
      {
        fixture: {
          ["x".repeat(LIMITS.aggregateStringUtf8MaximumBytes + 1)]: null,
        },
      },
    ],
  ]) {
    assertContractError(
      candidate,
      "LIMIT_EXCEEDED",
      () => candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting(input),
      label,
      { phase: "input-snapshot" },
    );
  }

  for (const [label, mutate] of [
    [
      "source projection maximum",
      (fixture) => {
        fixture.sourceProjectionBytes = Buffer.alloc(
          LIMITS.sourceProjectionMaximumBytes + 1,
        );
      },
    ],
    [
      "execution request maximum",
      (fixture) => {
        fixture.executionRequestV2Verification.bytes = Buffer.alloc(
          LIMITS.executionRequestV2MaximumBytes + 1,
        );
      },
    ],
    [
      "helper attestation maximum",
      (fixture) => {
        fixture.helperAttestationV1Verification.bytes = Buffer.alloc(
          LIMITS.helperAttestationV1MaximumBytes + 1,
        );
      },
    ],
    [
      "status transcript maximum",
      (fixture) => {
        fixture.statusTranscriptV1Verification.bytes = Buffer.alloc(
          LIMITS.statusTranscriptV1MaximumBytes + 1,
        );
      },
    ],
    [
      "isolation policy maximum",
      (fixture) => {
        fixture.isolationPolicyV2Bytes = Buffer.alloc(
          LIMITS.isolationPolicyV2MaximumBytes + 1,
        );
      },
    ],
    [
      "containment maximum",
      (fixture) => {
        fixture.containmentV2Verification.bytes = Buffer.alloc(
          LIMITS.containmentV2MaximumBytes + 1,
        );
      },
    ],
    [
      "combined output maximum",
      (fixture) => {
        fixture.stdoutBytes = Buffer.alloc(LIMITS.combinedOutputMaximumBytes);
      },
    ],
    [
      "executable maximum",
      (fixture) => {
        fixture.executableBytes = Buffer.alloc(
          LIMITS.executableMaximumBytes + 1,
        );
      },
    ],
    [
      "cgroup file maximum",
      (fixture) => {
        fixture.cgroupEventsBytes = Buffer.alloc(
          LIMITS.cgroupFileMaximumBytes + 1,
        );
      },
    ],
  ]) {
    const fixture = await createG17PrivateOwnerV3Fixture();
    mutate(fixture);
    assertContractError(
      candidate,
      "LIMIT_EXCEEDED",
      () =>
        candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
          fixture,
        }),
      label,
    );
  }

  assertContractError(
    candidate,
    "INPUT_SHAPE_INVALID",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: base.artifact.bytes,
        fixture: baseFixture,
        extra: false,
      }),
    "verification shape before artifact validation",
    { phase: "input-shape" },
  );
  assertContractError(
    candidate,
    "INPUT_SHAPE_INVALID",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: Buffer.alloc(MAX_BYTES + 1),
        fixture: baseFixture,
        extra: false,
      }),
    "verification shape before artifact limit and canonical decoding",
    { phase: "input-shape" },
  );
  assertContractError(
    candidate,
    "LIMIT_EXCEEDED",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: Buffer.alloc(MAX_BYTES + 1),
        fixture: baseFixture,
      }),
    "artifact limit before canonical decoding",
    { phase: "buffer-validation" },
  );
  const baseValue = JSON.parse(base.artifact.bytes.toString("utf8"));
  const baseBytes = base.artifact.bytes;
  for (const [label, bytes] of [
    ["leading whitespace", Buffer.from(` ${baseBytes.toString("utf8")}`)],
    ["missing LF", baseBytes.subarray(0, baseBytes.length - 1)],
    ["double LF", Buffer.concat([baseBytes, Buffer.from("\n")])],
    [
      "CRLF",
      Buffer.concat([
        baseBytes.subarray(0, baseBytes.length - 1),
        Buffer.from("\r\n"),
      ]),
    ],
    ["invalid UTF-8", Buffer.from([0xff, 0x0a])],
    ["null JSON", Buffer.from("null\n")],
    ["scalar JSON", Buffer.from("1\n")],
    ["array JSON", Buffer.from("[]\n")],
    [
      "reordered JSON",
      Buffer.from(
        `${JSON.stringify(Object.fromEntries(Object.entries(baseValue).reverse()))}\n`,
      ),
    ],
    [
      "duplicate key",
      Buffer.from(
        baseBytes.toString("utf8").replace(/^\{/u, '{"schema":"duplicate",'),
      ),
    ],
  ]) {
    assertContractError(
      candidate,
      "CANONICAL_ARTIFACT_INVALID",
      () =>
        candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
          bytes,
          fixture: baseFixture,
        }),
      label,
      { phase: "canonical-decoding" },
    );
  }

  const hashDrift = g17PrivateOwnerV3Clone(baseValue);
  hashDrift.contentHash = "0".repeat(64);
  assertContractError(
    candidate,
    "CANONICAL_ARTIFACT_INVALID",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: Buffer.from(
          ` ${g17PrivateOwnerV3CanonicalBytes(hashDrift).toString("utf8")}`,
          "utf8",
        ),
        fixture: baseFixture,
      }),
    "canonical decoding before content hash",
    { phase: "canonical-decoding" },
  );
  assertContractError(
    candidate,
    "CONTENT_HASH_MISMATCH",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: g17PrivateOwnerV3CanonicalBytes(hashDrift),
        fixture: baseFixture,
      }),
    "self hash",
    {
      phase: "content-hash-validation",
      message: "owner contentHash does not verify",
    },
  );
  const extraOwnerField = g17PrivateOwnerV3Clone(baseValue);
  delete extraOwnerField.contentHash;
  extraOwnerField.guessedClaim = false;
  assertContractError(
    candidate,
    "INPUT_SHAPE_INVALID",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: g17PrivateOwnerV3Seal(extraOwnerField).bytes,
        fixture: baseFixture,
      }),
    "resealed owner extra field",
    { phase: "input-shape" },
  );
  const hashBeforeIdentity = g17PrivateOwnerV3Clone(baseValue);
  hashBeforeIdentity.contentHash = "0".repeat(64);
  hashBeforeIdentity.schema = `${OWNER_SCHEMA}-other`;
  assertContractError(
    candidate,
    "CONTENT_HASH_MISMATCH",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: g17PrivateOwnerV3CanonicalBytes(hashBeforeIdentity),
        fixture: baseFixture,
      }),
    "content hash before identity",
    { phase: "content-hash-validation" },
  );
  const identityDrift = g17PrivateOwnerV3Clone(baseValue);
  identityDrift.schema = `${OWNER_SCHEMA}-other`;
  identityDrift.authority.buildExecutionAuthority = true;
  assertContractError(
    candidate,
    "IDENTITY_INVALID",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: resealOwner(identityDrift),
        fixture: baseFixture,
      }),
    "identity before authority",
    { phase: "identity-validation" },
  );
  const identityBeforeExpected = g17PrivateOwnerV3Clone(baseValue);
  identityBeforeExpected.schema = `${OWNER_SCHEMA}-other`;
  assertContractError(
    candidate,
    "IDENTITY_INVALID",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: resealOwner(identityBeforeExpected),
        fixture: other,
      }),
    "identity before expected input",
    { phase: "identity-validation" },
  );
  const expectedBeforePredecessor = g17PrivateOwnerV3Clone(baseValue);
  expectedBeforePredecessor.bindings.sourceProjection.rawSha256 = "f".repeat(
    64,
  );
  assertContractError(
    candidate,
    "EXPECTED_INPUT_MISMATCH",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: resealOwner(expectedBeforePredecessor),
        fixture: other,
      }),
    "expected identity before predecessor binding",
    { phase: "expected-identity-validation" },
  );
  const predecessorDrift = g17PrivateOwnerV3Clone(baseValue);
  predecessorDrift.bindings.sourceProjection.rawSha256 = "f".repeat(64);
  predecessorDrift.observations.process.exitCode = 9;
  assertContractError(
    candidate,
    "PREDECESSOR_BINDING_DRIFT",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: resealOwner(predecessorDrift),
        fixture: baseFixture,
      }),
    "predecessor before observation",
    { phase: "predecessor-binding" },
  );
  const observationDrift = g17PrivateOwnerV3Clone(baseValue);
  observationDrift.observations.process.exitCode = 9;
  observationDrift.authority.buildExecutionAuthority = true;
  assertContractError(
    candidate,
    "OBSERVATION_BINDING_DRIFT",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: resealOwner(observationDrift),
        fixture: baseFixture,
      }),
    "observation before authority",
    { phase: "observation-binding" },
  );
  const observationBeforeLifecycleFixture =
    await createG17PrivateOwnerV3Fixture();
  const observationBeforeLifecycleOffset =
    observationBeforeLifecycleFixture.stdoutBytes.indexOf(
      Buffer.from("0.6.0-dev", "utf8"),
    );
  assert.notEqual(observationBeforeLifecycleOffset, -1);
  observationBeforeLifecycleFixture.stdoutBytes[
    observationBeforeLifecycleOffset
  ] = 0xff;
  rebindFixtureStdout(observationBeforeLifecycleFixture);
  observationBeforeLifecycleFixture.observations.process.exitCode = 9;
  assertContractError(
    candidate,
    "OBSERVATION_BINDING_DRIFT",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
        fixture: observationBeforeLifecycleFixture,
      }),
    "Cargo observation before process lifecycle",
    { phase: "cargo-jsonl-validation" },
  );
  const lifecycleBeforeAuthorityFixture =
    await createG17PrivateOwnerV3Fixture();
  lifecycleBeforeAuthorityFixture.observations.process.exitCode = 9;
  const lifecycleBeforeAuthorityOwner = g17PrivateOwnerV3Clone(baseValue);
  lifecycleBeforeAuthorityOwner.authority.buildExecutionAuthority = true;
  assertContractError(
    candidate,
    "LIFECYCLE_CONTRADICTION",
    () =>
      candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
        bytes: resealOwner(lifecycleBeforeAuthorityOwner),
        fixture: lifecycleBeforeAuthorityFixture,
      }),
    "fixture lifecycle before owner authority",
    { phase: "process-and-reap-validation" },
  );
  await assertContractRejects(
    candidate,
    "PRIVATE_CAPABILITY_INVALID",
    () =>
      candidate.createG17BenchmarkBuildOwnerV3Artifact({
        bytes: base.artifact.bytes,
        fixture: baseFixture,
      }),
    "serialized canonical owner cannot bypass capability consumption",
    { phase: "capability-consumption" },
  );
  for (const mutate of [
    (value) => {
      value.physicalOrigin = true;
    },
    (value) => {
      value.binding = { claimed: true };
    },
    (value) => {
      value.finalDecisionEligible = true;
    },
    (value) => {
      value.authority.buildExecutionAuthority = true;
    },
    (value) => {
      value.nonclaims.syntheticTestCapabilityProvesIssuerOrigin = true;
    },
  ]) {
    const changed = g17PrivateOwnerV3Clone(baseValue);
    mutate(changed);
    assertContractError(
      candidate,
      "AUTHORITY_OVERCLAIM",
      () =>
        candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
          bytes: resealOwner(changed),
          fixture: baseFixture,
        }),
      "authority null",
      { phase: "authority-validation" },
    );
  }
  for (const field of ["qualifiedNativeAdapter", "qualifiedDurableEffect"]) {
    const changed = g17PrivateOwnerV3Clone(baseValue);
    changed.bindings[field] = { guessed: true };
    assertContractError(
      candidate,
      "PREDECESSOR_BINDING_DRIFT",
      () =>
        candidate.verifyG17BenchmarkBuildOwnerV3Artifact({
          bytes: resealOwner(changed),
          fixture: baseFixture,
        }),
      `${field} must remain null`,
    );
  }

  if (source !== null) assertCandidateSourceStructure(source);
}

async function assertCandidateInstanceIsolation(firstInstance) {
  const secondPresence = await sourcePresence();
  assert.equal(secondPresence.present, true);
  const { candidate: secondInstance } = await loadCandidateForEvaluation(
    secondPresence,
    {
      readSource: readCandidateSourceBounded,
      importSource: (url) => import(url),
      instance: "adr0041-s5-instance-second",
    },
  );
  assert.deepEqual(
    Object.keys(secondInstance).sort(),
    [...EXPECTED_EXPORTS].sort(),
  );

  const firstCapability =
    firstInstance.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: await createG17PrivateOwnerV3Fixture({ salt: "instance-first" }),
    });
  await assertContractRejects(
    secondInstance,
    "PRIVATE_CAPABILITY_INVALID",
    () =>
      secondInstance.createG17BenchmarkBuildOwnerV3Artifact(firstCapability),
    "second candidate rejects first candidate capability",
    {
      phase: "capability-consumption",
      message: "private test capability is not live for this module instance",
    },
  );
  await firstInstance.createG17BenchmarkBuildOwnerV3Artifact(firstCapability);

  const secondCapability =
    secondInstance.createG17BenchmarkBuildOwnerV3CapabilityForTesting({
      fixture: await createG17PrivateOwnerV3Fixture({
        salt: "instance-second",
      }),
    });
  await assertContractRejects(
    firstInstance,
    "PRIVATE_CAPABILITY_INVALID",
    () =>
      firstInstance.createG17BenchmarkBuildOwnerV3Artifact(secondCapability),
    "first candidate rejects second candidate capability",
    {
      phase: "capability-consumption",
      message: "private test capability is not live for this module instance",
    },
  );
  await secondInstance.createG17BenchmarkBuildOwnerV3Artifact(secondCapability);
}

async function sourcePresence() {
  try {
    const status = await lstat(SOURCE_URL);
    return Object.freeze({
      present: true,
      regular: status.isFile(),
      size: status.size,
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return Object.freeze({ present: false, regular: false, size: null });
  }
}

function sameSourceIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSourceSnapshot(left, right) {
  return (
    sameSourceIdentity(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function readCandidateSourceBounded(
  sourceUrl = SOURCE_URL,
  { openFile = open, lstatPath = lstat } = {},
) {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await openFile(sourceUrl, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (
      noFollow === 0 ||
      !["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)
    ) {
      throw error;
    }
    handle = await openFile(sourceUrl, fsConstants.O_RDONLY);
  }
  try {
    const before = await handle.stat({ bigint: true });
    const pathBefore = await lstatPath(sourceUrl, { bigint: true });
    assert.equal(
      before.isFile() && pathBefore.isFile(),
      true,
      "candidate source must be a regular file",
    );
    assert.equal(
      sameSourceSnapshot(before, pathBefore),
      true,
      "candidate source identity changed before bounded read",
    );
    assert.equal(
      before.size >= 0n && before.size <= BigInt(MAX_CANDIDATE_SOURCE_BYTES),
      true,
      "candidate source byte limit exceeded",
    );
    const expectedSize = Number(before.size);
    const sourceBytes = Buffer.allocUnsafe(
      Math.min(MAX_CANDIDATE_SOURCE_BYTES + 1, expectedSize + 1),
    );
    let offset = 0;
    while (offset < sourceBytes.length) {
      const { bytesRead } = await handle.read(
        sourceBytes,
        offset,
        sourceBytes.length - offset,
        offset,
      );
      assert.equal(
        Number.isSafeInteger(bytesRead) &&
          bytesRead >= 0 &&
          bytesRead <= sourceBytes.length - offset,
        true,
        "candidate source read returned an invalid byte count",
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    assert.equal(
      offset <= MAX_CANDIDATE_SOURCE_BYTES,
      true,
      "candidate source byte limit exceeded",
    );
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstatPath(sourceUrl, { bigint: true });
    assert.equal(
      after.isFile() && pathAfter.isFile(),
      true,
      "candidate source must remain a regular file",
    );
    assert.equal(
      sameSourceSnapshot(before, after) &&
        sameSourceSnapshot(after, pathAfter) &&
        sameSourceSnapshot(pathBefore, pathAfter) &&
        offset === expectedSize,
      true,
      "candidate source changed during bounded read",
    );
    return Buffer.from(sourceBytes.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

function exactMissingSourceError(error, presence) {
  const expectedMessage = `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`;
  if (
    presence.present ||
    error === null ||
    typeof error !== "object" ||
    error.code !== "ERR_MODULE_NOT_FOUND" ||
    error.message !== expectedMessage
  ) {
    return false;
  }
  return error.url === SOURCE_URL.href;
}

function missingCandidateSourceError() {
  const error = new Error(
    `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
  );
  error.code = "ERR_MODULE_NOT_FOUND";
  error.url = SOURCE_URL.href;
  return error;
}

function exactCandidateImportUrl(source, sourceBytes, instance) {
  const { program } = parseCandidateModuleAst(source);
  const specifiers = program.body
    .filter((node) => node.type === "ImportDeclaration")
    .map((node) => node.source)
    .sort((left, right) => right.start - left.start);
  let importSource = source;
  for (const specifier of specifiers) {
    importSource = `${importSource.slice(0, specifier.start)}${JSON.stringify(
      new URL(specifier.value, SOURCE_URL).href,
    )}${importSource.slice(specifier.end)}`;
  }
  const payload = Buffer.from(importSource, "utf8").toString("base64");
  const instanceBinding =
    instance === null ? "" : `&instance=${encodeURIComponent(instance)}`;
  return `data:text/javascript;base64,${payload}#source-sha256=${sha256(
    sourceBytes,
  )}${instanceBinding}`;
}

async function loadCandidateForEvaluation(
  presence,
  {
    readSource,
    importSource,
    validateSource = assertCandidateSourceStructure,
    instance = null,
  },
) {
  if (!presence.present) throw missingCandidateSourceError();
  let candidateSource = null;
  assert.equal(
    presence.regular,
    true,
    "candidate source must be a regular file",
  );
  assert.equal(
    Number.isSafeInteger(presence.size) && presence.size >= 0,
    true,
    "candidate source size must be an exact non-negative integer",
  );
  assert.equal(
    presence.size <= MAX_CANDIDATE_SOURCE_BYTES,
    true,
    "candidate source byte limit exceeded",
  );
  const sourceBytes = await readSource(SOURCE_URL);
  assert.equal(Buffer.isBuffer(sourceBytes), true, "candidate source bytes");
  assert.equal(
    sourceBytes.length,
    presence.size,
    "candidate source changed during bounded read",
  );
  try {
    candidateSource = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(sourceBytes);
  } catch (error) {
    throw new Error(`candidate source is not valid UTF-8: ${error.message}`);
  }
  validateSource(candidateSource);
  const candidateImportUrl = exactCandidateImportUrl(
    candidateSource,
    sourceBytes,
    instance,
  );
  const candidate = await importSource(candidateImportUrl);
  return Object.freeze({ candidate, candidateImportUrl, candidateSource });
}

const presence = await sourcePresence();
let candidate = null;
let candidateSource = null;
let candidateImportError = null;
let candidateImportAttempts = 0;
try {
  const loaded = await loadCandidateForEvaluation(presence, {
    readSource: readCandidateSourceBounded,
    importSource: async (url) => {
      candidateImportAttempts += 1;
      return import(url);
    },
  });
  ({ candidate, candidateSource } = loaded);
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
          ? "candidate build-owner-v3 source is intentionally absent"
          : false,
    },
    body,
  );
}

test("ADR-0041 S5 validates candidate source before module evaluation", async () => {
  assert.deepEqual(SYNCHRONOUS_PARSER_AUDIT, {
    completedBeforeCandidateRead: true,
    policy: "latest",
    ...EXPECTED_ACORN,
  });
  assert.deepEqual(PARSER_LOAD_AUDIT, {
    completedAfterIdentityPin: true,
    completedBeforeCandidateRead: true,
    entrypoint: EXPECTED_ACORN.importEntrypoint,
    exactSnapshotImport: true,
    tokenizerVerified: true,
    version: EXPECTED_ACORN.version,
  });
  assert.match(PARSER_SNAPSHOT.importUrl, /^data:text\/javascript;base64,/u);
  assert.match(
    PARSER_SNAPSHOT.importUrl,
    new RegExp(`#sha256=${EXPECTED_ACORN.importEntrypointSha256}$`, "u"),
  );
  assert.equal(preflightCandidateModuleTokens("({ value: [0] });"), 10);
  assert.throws(
    () => preflightCandidateModuleTokens("0;", 1),
    /token limit exceeded/u,
  );
  assert.throws(
    () => preflightCandidateModuleTokens("(((0)));", 16, 2),
    /delimiter nesting limit exceeded/u,
  );
  assert.throws(
    () => parseCandidateModuleAst("0;", 0),
    /AST node limit exceeded/u,
  );
  let importAttempts = 0;
  let absentReadAttempts = 0;
  let absentImportAttempts = 0;
  const absentThenPresent = { present: false };
  const absentFailure = loadCandidateForEvaluation(absentThenPresent, {
    readSource: async () => {
      absentReadAttempts += 1;
      return Buffer.from("export const replacement = true;");
    },
    importSource: async () => {
      absentImportAttempts += 1;
      return Object.freeze({ replacement: true });
    },
  });
  absentThenPresent.present = true;
  await assert.rejects(absentFailure, (error) =>
    exactMissingSourceError(error, { present: false }),
  );
  assert.equal(absentThenPresent.present, true);
  assert.equal(absentReadAttempts, 0);
  assert.equal(absentImportAttempts, 0);
  for (const [label, candidatePresence, bytes, expected] of [
    [
      "non-regular source",
      { present: true, regular: false, size: 0 },
      Buffer.alloc(0),
      /regular file/u,
    ],
    [
      "source overflow",
      {
        present: true,
        regular: true,
        size: MAX_CANDIDATE_SOURCE_BYTES + 1,
      },
      Buffer.alloc(0),
      /byte limit/u,
    ],
    [
      "source read drift",
      { present: true, regular: true, size: 1 },
      Buffer.alloc(0),
      /changed during bounded read/u,
    ],
    [
      "invalid UTF-8",
      { present: true, regular: true, size: 2 },
      Buffer.from([0xc3, 0x28]),
      /not valid UTF-8/u,
    ],
    [
      "invalid source structure",
      {
        present: true,
        regular: true,
        size: Buffer.byteLength("Object = {};"),
      },
      Buffer.from("Object = {};"),
      /Expected values to be strictly deep-equal/u,
    ],
  ]) {
    await assert.rejects(
      loadCandidateForEvaluation(candidatePresence, {
        readSource: async () => bytes,
        importSource: async () => {
          importAttempts += 1;
          return Object.freeze({});
        },
      }),
      expected,
      label,
    );
  }
  await assert.rejects(
    loadCandidateForEvaluation(
      { present: true, regular: true, size: 1 },
      {
        readSource: async () => Buffer.from("0"),
        validateSource: () => {
          throw new Error(
            "candidate static validation: AST node limit exceeded",
          );
        },
        importSource: async () => {
          importAttempts += 1;
          return Object.freeze({});
        },
      },
    ),
    /AST node limit exceeded/u,
  );
  assert.equal(importAttempts, 0);

  const sourceStat = (size, stamp = 1n) => ({
    dev: 1n,
    ino: 2n,
    mode: 0o100644n,
    size,
    mtimeNs: stamp,
    ctimeNs: stamp,
    isFile: () => true,
  });
  let oversizedReadCalls = 0;
  let oversizedClosed = false;
  const oversizedStat = sourceStat(BigInt(MAX_CANDIDATE_SOURCE_BYTES + 1));
  await assert.rejects(
    readCandidateSourceBounded(SOURCE_URL, {
      openFile: async () => ({
        stat: async () => oversizedStat,
        read: async () => {
          oversizedReadCalls += 1;
          return { bytesRead: 0 };
        },
        close: async () => {
          oversizedClosed = true;
        },
      }),
      lstatPath: async () => oversizedStat,
    }),
    /candidate source byte limit exceeded/u,
  );
  assert.equal(oversizedReadCalls, 0);
  assert.equal(oversizedClosed, true);

  const originalStat = sourceStat(1n);
  const replacementStat = sourceStat(
    BigInt(MAX_CANDIDATE_SOURCE_BYTES + 64),
    2n,
  );
  let descriptorStatCalls = 0;
  let pathStatCalls = 0;
  let replacementBytesRequested = 0;
  let replacementClosed = false;
  let replacementValidationAttempts = 0;
  let replacementImportAttempts = 0;
  await assert.rejects(
    loadCandidateForEvaluation(
      { present: true, regular: true, size: 1 },
      {
        readSource: () =>
          readCandidateSourceBounded(SOURCE_URL, {
            openFile: async () => ({
              stat: async () =>
                descriptorStatCalls++ === 0 ? originalStat : replacementStat,
              read: async (buffer, offset, length) => {
                replacementBytesRequested += length;
                buffer.fill(0x20, offset, offset + length);
                return { bytesRead: length };
              },
              close: async () => {
                replacementClosed = true;
              },
            }),
            lstatPath: async () =>
              pathStatCalls++ === 0 ? originalStat : replacementStat,
          }),
        validateSource: () => {
          replacementValidationAttempts += 1;
        },
        importSource: async () => {
          replacementImportAttempts += 1;
          return Object.freeze({});
        },
      },
    ),
    /candidate source changed during bounded read/u,
  );
  assert.equal(replacementBytesRequested, 2);
  assert.equal(replacementBytesRequested < Number(replacementStat.size), true);
  assert.equal(replacementClosed, true);
  assert.equal(replacementValidationAttempts, 0);
  assert.equal(replacementImportAttempts, 0);

  const validatedSource = Buffer.from(
    "import { G17_BENCHMARK_BUILD_PLAN } from './benchmark-execution-plan.mjs'; export const marker = G17_BENCHMARK_BUILD_PLAN.at(0).buildId;",
    "utf8",
  );
  const replacementSource = Buffer.from(
    "export const marker = 'replacement-executed';",
    "utf8",
  );
  const events = [];
  let currentSource = validatedSource;
  const loadImmutableInstance = async (instance) => {
    currentSource = validatedSource;
    return loadCandidateForEvaluation(
      { present: true, regular: true, size: validatedSource.length },
      {
        readSource: async () => Buffer.from(currentSource),
        validateSource: (source) => {
          events.push(`validate:${instance ?? "default"}`);
          assert.equal(source, validatedSource.toString("utf8"));
          currentSource = replacementSource;
        },
        importSource: async (url) => {
          events.push(`import:${instance ?? "default"}`);
          assert.match(url, /^data:text\/javascript;base64,/u);
          assert.match(
            url,
            new RegExp(`source-sha256=${sha256(validatedSource)}`, "u"),
          );
          assert.doesNotMatch(url, /replacement-executed/u);
          return import(url);
        },
        instance,
      },
    );
  };
  const first = await loadImmutableInstance(null);
  assert.notEqual(first.candidateImportUrl, SOURCE_URL.href);
  assert.equal(first.candidate.marker, "negative-control");
  assert.strictEqual(await import(first.candidateImportUrl), first.candidate);
  const second = await loadImmutableInstance("second");
  assert.equal(second.candidate.marker, "negative-control");
  assert.notStrictEqual(second.candidate, first.candidate);
  assert.deepEqual(events, [
    "validate:default",
    "import:default",
    "validate:second",
    "import:second",
  ]);
});

test("ADR-0041 S5 ambient-reference policy resolves lexical scope", () => {
  for (const [source, identifier] of [
    [
      "function decoy(process) { return process; } function leak() { return process; }",
      "process",
    ],
    [
      "function leak() { function decoy(process) { return process; } return process; }",
      "process",
    ],
    ["{ const console = 0; void console; } console.log('x');", "console"],
    ["try {} catch (globalThis) {} globalThis.process;", "globalThis"],
    [
      "function decoy() { const require = () => {}; return require; } require('node:fs');",
      "require",
    ],
    ["function leak() { return { process }; }", "process"],
    [
      "function leak(value = process) { const process = 1; return value; }",
      "process",
    ],
    [
      "function leak(value = process) { var process; return value; }",
      "process",
    ],
  ]) {
    assert.throws(
      () =>
        assertScopedAmbientReferencePolicy(
          parse(source, ACORN_PARSE_OPTIONS),
          source,
        ),
      new RegExp(`ambient identifier ${identifier}`, "u"),
    );
  }
  for (const [source, message] of [
    ["Error.prepareStackTrace;", "Error.prepareStackTrace"],
    ["const J = JSON; J.parse('{}');", "ambient identifier use JSON"],
    ["const R = Reflect; R.get({}, 'x');", "ambient identifier use Reflect"],
    [
      "let alias; switch ((alias = JSON, 0)) { default: let JSON; } alias.parse('{}');",
      "ambient identifier use JSON",
    ],
    [
      "let ambient; switch ((ambient = process, 0)) { default: let process; } ambient.version;",
      "ambient identifier process",
    ],
    [
      "class C { static { var process; } } process.version;",
      "ambient identifier process",
    ],
    [
      "class C { constructor(value = process) { var process; } }",
      "ambient identifier process",
    ],
    ["const parse = JSON.parse; parse('{}');", "ambient member use JSON.parse"],
    ["Number?.('1');", "ambient call Number"],
    ["Object?.freeze({});", "ambient member use Object.freeze"],
    ["Object.freeze?.({});", "ambient member use Object.freeze"],
    [
      "const prototype = Buffer.prototype; void prototype;",
      "prototype member outside direct identity comparison",
    ],
    [
      "const P = Object.getPrototypeOf({}); P.polluted = true;",
      "Object.getPrototypeOf result outside direct identity comparison",
    ],
    [
      "Object.getPrototypeOf({}).polluted = true;",
      "Object.getPrototypeOf result outside direct identity comparison",
    ],
    ["({}).__proto__.polluted = true;", "__proto__"],
    [
      "class Fault extends Error {} const E = Object.getPrototypeOf(Fault); E.prepareStackTrace = () => {};",
      "Object.getPrototypeOf result outside direct identity comparison",
    ],
    [
      "function f() { return this.process; }",
      "this expression outside the exact contract-error constructor fields",
    ],
    [
      "const D = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => {})); const { constructor: { value: F } } = D; F('return process')();",
      "Object.getPrototypeOf result outside direct identity comparison",
    ],
    [
      "const { constructor: F } = {};",
      "forbidden property definition constructor",
    ],
    ["Object = {};", "ambient identifier write Object"],
    ["Object.entries = () => [];", "ambient member write Object.entries"],
    ["delete JSON.parse;", "ambient member write JSON.parse"],
    [
      "const Error = class {}; class G17BenchmarkBuildOwnerV3ContractError extends Error {}",
      "exact contract error class must extend unresolved intrinsic Error",
    ],
    [
      "({ value: Object.entries } = { value: () => [] });",
      "ambient member write Object.entries",
    ],
    ["[Object.entries] = [() => []];", "ambient member write Object.entries"],
    [
      "for ({ value: Object.entries } of [{ value: () => [] }]) {}",
      "ambient member write Object.entries",
    ],
  ]) {
    assert.throws(
      () =>
        assertScopedAmbientReferencePolicy(
          parse(source, ACORN_PARSE_OPTIONS),
          source,
        ),
      new RegExp(message, "u"),
    );
  }
  for (const source of [
    "function local(process) { return process; }",
    "const process = {}; function nested() { return process; }",
    "function hoisted() { return process; var process; }",
    "function local(Object) { return Object.custom(); }",
    "Object.freeze({}); Number('1'); new WeakSet(); void undefined;",
    "class Fault extends Error {}",
    "Buffer.prototype === Object.getPrototypeOf(Buffer.from('x'));",
    "class G17BenchmarkBuildOwnerV3ContractError extends Error { constructor(code, phase) { super('x'); this.name = 'G17BenchmarkBuildOwnerV3ContractError'; this.code = code; this.phase = phase; } }",
    "switch (0) { case process: let process; }",
    "class C { static { var process; void process; } }",
    "class C { constructor() { void process; var process; } }",
    "const X = class Y extends Y {}; void X;",
  ]) {
    assert.doesNotThrow(() =>
      assertScopedAmbientReferencePolicy(
        parse(source, ACORN_PARSE_OPTIONS),
        source,
      ),
    );
  }
});

test("ADR-0041 S5 static policy owns reflection and imported values", () => {
  const validate = (source) =>
    assertScopedAmbientReferencePolicy(
      parse(source, ACORN_PARSE_OPTIONS),
      source,
    );
  for (const [source, message] of [
    [
      "function* unsupported() { yield 1; }",
      "unsupported Node 20 AST node YieldExpression",
    ],
    [
      "import { canonicalJson } from './dependency.mjs'; const encode = canonicalJson;",
      "imported function used as value canonicalJson",
    ],
    [
      "import { types } from 'node:util'; const utilTypes = types;",
      "imported object used outside direct member call types",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; const plan = G17_BENCHMARK_BUILD_PLAN;",
      "imported value escape G17_BENCHMARK_BUILD_PLAN",
    ],
    [
      "import { canonicalJson } from './dependency.mjs'; canonicalJson?.({});",
      "imported function used as value canonicalJson",
    ],
    [
      "import { types } from 'node:util'; types?.isProxy({});",
      "imported object used outside direct member call types",
    ],
    [
      "import { types } from 'node:util'; types.isProxy?.({});",
      "imported object used outside direct member call types",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; G17_BENCHMARK_BUILD_PLAN?.at(0);",
      "method member used as value at",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; G17_BENCHMARK_BUILD_PLAN.at?.(0);",
      "method member used as value at",
    ],
    [
      "function leak(value) { return Object.getOwnPropertyDescriptors(value); }",
      "reflection result escape descriptor-map",
    ],
    [
      "function leak(value) { const descriptors = Object.getOwnPropertyDescriptors(value); return descriptors; }",
      "reflection result escape descriptor-map",
    ],
    [
      "const descriptors = Object.getOwnPropertyDescriptors({}); const alias = descriptors;",
      "reflection result escape descriptor-map",
    ],
    [
      "const descriptors = Object.getOwnPropertyDescriptors({}); Object.freeze(descriptors);",
      "reflection result escape descriptor-map",
    ],
    [
      "const descriptors = Object.getOwnPropertyDescriptors({}); descriptors.field = {};",
      "reflection result escape descriptor-map",
    ],
    [
      "function leak(value) { return Reflect.ownKeys(value); }",
      "reflection result escape reflection-view",
    ],
    [
      "const keys = Reflect.ownKeys({}); keys.sort();",
      "reflection result escape reflection-view",
    ],
    [
      "function leak(value) { return Object.entries(value); }",
      "reflection result escape reflection-view",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { const callable = descriptor.value; callable(); } }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { descriptor.value(); } }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function take(value) { return value; } function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { take(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function take(value) { return value; } function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { take((descriptor.value)); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const other = {}; const descriptors = Object.getOwnPropertyDescriptors(other); for (const [key, descriptor] of Object.entries(descriptors)) { snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { Object.hasOwn(descriptor, 'value'); descriptor.enumerable; snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true) throw new TypeError('inverted'); snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {} snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { snapshot(descriptor.value); if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('late'); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); void descriptor.value; } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); String(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "async function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); await descriptor.value; } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); descriptor.value || null; } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); descriptor.value === null; } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); snapshot = () => ({}); snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); snapshot(descriptor.value); snapshot++; } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function snapshot(value) { function snapshot(value) { return value; } const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); snapshot(descriptor.value); } return {}; }",
      "reflected value outside exact recursive plain-data snapshot argument",
    ],
    [
      "function take(value) { return value; } function inspect(value) { for (const key of Reflect.ownKeys(value)) { take(key); } }",
      "reflection key escape",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; function take(value) { return value; } take(G17_BENCHMARK_BUILD_PLAN.length);",
      "imported value argument escape",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; G17_BENCHMARK_BUILD_PLAN.at(0);",
      "build-plan lookup requires one const derived binding",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; let plan = G17_BENCHMARK_BUILD_PLAN.at(0); plan.buildId === 'x';",
      "build-plan lookup requires one const derived binding",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; const plan = G17_BENCHMARK_BUILD_PLAN.at(0), other = 0; plan.buildId === 'x'; void other;",
      "build-plan lookup requires one const derived binding",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; export const plan = G17_BENCHMARK_BUILD_PLAN.at(0);",
      "build-plan lookup requires one const derived binding",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; const plan = G17_BENCHMARK_BUILD_PLAN.at(0); const alias = plan; void alias;",
      "derived imported plan escape",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; const plan = G17_BENCHMARK_BUILD_PLAN.at(0); plan = {};",
      "sensitive value write derived-import-value",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; const plan = G17_BENCHMARK_BUILD_PLAN.at(0); plan.buildId = 'x';",
      "sensitive value write derived-import-member",
    ],
    [
      "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; function take(value) { return value; } const plan = G17_BENCHMARK_BUILD_PLAN.at(0); take(plan.buildId);",
      "derived imported plan member argument escape",
    ],
    ["const method = [].map;", "method member used as value map"],
    ["JSON.parse.call(null, '{}');", "forbidden indirect-call member call"],
  ]) {
    assert.throws(() => validate(source), new RegExp(message, "u"), source);
  }
  for (const source of [
    "import { canonicalJson } from './dependency.mjs'; canonicalJson({});",
    "import { types } from 'node:util'; types.isProxy({});",
    "import { G17_BENCHMARK_BUILD_PLAN } from './dependency.mjs'; const plan = G17_BENCHMARK_BUILD_PLAN.at(0); plan.buildId === 'negative-control';",
    "function parsed(text) { const value = JSON.parse(text); return value; }",
    "function copied(bytes) { return Buffer.from(bytes); }",
    "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors); for (const key of keys) { if (typeof key !== 'string') throw new TypeError('symbol'); } for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('descriptor'); snapshot(descriptor.value); } return {}; }",
    "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('descriptor'); if (descriptor.enumerable !== true) throw new TypeError('enumerable'); snapshot(descriptor.value); } return {}; }",
    "function snapshot(value) { const descriptors = Object.getOwnPropertyDescriptors(value); for (const [key, descriptor] of Object.entries(descriptors)) { if (!('value' in descriptor) || descriptor.enumerable !== true) throw new TypeError('descriptor'); snapshot(descriptor.value); } return {}; }",
    "function plain(value, array) { return Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype); }",
  ]) {
    assert.doesNotThrow(() => validate(source), source);
  }
});

test.after(cleanupG17PrivateOwnerV3Fixtures);

test("ADR-0041 S5 pins exact dormant predecessor source bytes", async () => {
  for (const [path, expectedBytes, expectedSha256] of PREDECESSORS) {
    const bytes = await readFile(new URL(path, REPOSITORY_ROOT));
    assert.equal(bytes.length, expectedBytes, path);
    assert.equal(sha256(bytes), expectedSha256, path);
  }
});

test("ADR-0041 S5 reference freezes the authority-null build-owner-v3 contract", async () => {
  await assertCandidateContract(createReferenceCandidate());
});

candidateTest(
  "ADR-0041 S5 candidate satisfies the frozen evaluator",
  async () => {
    await assertCandidateContract(candidate, candidateSource);
    await assertCandidateInstanceIsolation(candidate);
  },
);

test("missing-source attribution rejects wrong code, URL, message, and present source", () => {
  const shape = {
    code: "ERR_MODULE_NOT_FOUND",
    url: SOURCE_URL.href,
    message: `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
  };
  const absent = { present: false };
  assert.equal(exactMissingSourceError(shape, absent), true);
  assert.equal(
    exactMissingSourceError({ ...shape, code: "ENOENT" }, absent),
    false,
  );
  assert.equal(
    exactMissingSourceError({ ...shape, url: `${shape.url}.other` }, absent),
    false,
  );
  assert.equal(
    exactMissingSourceError(
      { ...shape, message: `${shape.message}.other` },
      absent,
    ),
    false,
  );
  const { url: _ignored, ...nodeTwentyShape } = shape;
  assert.equal(exactMissingSourceError(nodeTwentyShape, absent), false);
  assert.equal(exactMissingSourceError(shape, { present: true }), false);
});

test("ADR-0041 S5 RED reports only the exact missing build-owner-v3 source", () => {
  assert.equal(candidateImportAttempts, presence.present ? 1 : 0);
  if (candidateImportError !== null) {
    assert.equal(candidate, null);
    assert.equal(candidateSource, null);
    throw candidateImportError;
  }
  assert.notEqual(candidate, null);
});
