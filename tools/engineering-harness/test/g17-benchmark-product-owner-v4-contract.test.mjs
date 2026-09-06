import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, types } from "node:util";

import {
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "../src/qualification/benchmark-execution-plan.mjs";
import {
  createG17BenchmarkBuildOwnerV3Artifact,
  createG17BenchmarkBuildOwnerV3CapabilityForTesting,
  G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY,
  G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES,
  G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS,
  verifyG17BenchmarkBuildOwnerV3Artifact,
} from "../src/qualification/benchmark-build-owner-v3-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  cleanupG17PrivateOwnerV3Fixtures,
  createG17PrivateOwnerV3Fixture,
  g17PrivateOwnerV3Clone,
} from "./support/g17-private-owner-v3-v4-fixtures.mjs";

// ADR-0041 S7 is evaluator-first. This file freezes a replay-only product
// owner contract while its S8 source remains absent. The fixture contains
// exact source and request bytes, but only serialized platform/toolchain
// identities; the contract therefore cross-binds those identities without
// claiming independent replay of unavailable platform/toolchain byte images.

const SOURCE_URL = new URL(
  "../src/qualification/benchmark-product-owner-v4-contract.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const MAX_CANDIDATE_SOURCE_BYTES = 384 * 1024;
const MAX_CANDIDATE_AST_NODES = 100_000;
const MAX_CANDIDATE_AST_DEPTH = 256;
const MAX_CANDIDATE_LOOP_ITERATIONS = 4 * 1024 * 1024;
const MAX_CANDIDATE_CALL_DEPTH = 128;
const MAX_CANDIDATE_STATIC_WORK = 512n * 1024n * 1024n;
const CANDIDATE_BOUNDED_INTRINSIC_WORK = 1024n;
const MAX_CANDIDATE_TOKENS = MAX_CANDIDATE_AST_NODES * 4;
const MAX_CANDIDATE_DELIMITER_DEPTH = 256;
const PINNED_CANDIDATE_SNAPSHOT_JSON_SOURCE = `function snapshotJson(parsed, label, fail) {
  const pending = [Object.freeze({ value: parsed, depth: 0 })];
  let completed = 0;
  let nodes = 0;
  let stringBytes = 0;
  for (
    let cursor = 0;
    cursor < G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.artifactMaximumBytes &&
    cursor < pending.length;
    cursor += 1
  ) {
    const frame = pending[cursor];
    const value = frame.value;
    if (frame.depth > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumDepth) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds depth");
    }
    if (value === null || typeof value === "boolean") {
      completed += 1;
      continue;
    }
    if (typeof value === "string") {
      const bytes = Buffer.byteLength(value, "utf8");
      stringBytes += bytes;
      if (
        bytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.singleStringUtf8MaximumBytes ||
        stringBytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.aggregateStringUtf8MaximumBytes
      ) {
        fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds strings");
      }
      completed += 1;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " number drifted");
      }
      completed += 1;
      continue;
    }
    if (typeof value !== "object" || types.isProxy(value)) {
      fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " is non-JSON");
    }
    const array = Array.isArray(value);
    if (
      Object.getPrototypeOf(value) !==
      (array ? Array.prototype : Object.prototype)
    ) {
      fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " prototype drifted");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumPropertiesPerRecord ||
      (array && value.length > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumArrayLength)
    ) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " shape exceeds bound");
    }
    nodes += 1;
    if (nodes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumNodes) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds nodes");
    }
    let arrayIndexes = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") {
        fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " has a symbol key");
      }
      if (array && key === "length") continue;
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
        fail(
          "INPUT_SHAPE_INVALID",
          "artifact-snapshot",
          label + " contains non-enumerable data",
        );
      }
      if (array) {
        if (key !== String(arrayIndexes)) {
          fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " array is sparse");
        }
        arrayIndexes += 1;
      }
      const keyBytes = Buffer.byteLength(key, "utf8");
      stringBytes += keyBytes;
      if (
        keyBytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.singleStringUtf8MaximumBytes ||
        stringBytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.aggregateStringUtf8MaximumBytes
      ) {
        fail(
          "LIMIT_EXCEEDED",
          "artifact-snapshot",
          label + " exceeds property-name and value strings",
        );
      }
      pending.push(
        Object.freeze({
          value: descriptor.value,
          depth: frame.depth + 1,
        }),
      );
    }
    if (array && arrayIndexes !== value.length) {
      fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " array is sparse");
    }
    Object.freeze(value);
    completed += 1;
  }
  if (completed !== pending.length) {
    fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds work bound");
  }
  return parsed;
}`;
const PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE = `function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value) + "\\n", "utf8");
}`;
const PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE = `function ownerContentHash(value) {
  return canonicalSha256(value);
}`;
const PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE = `function snapshotBuilds(builds) {
  if (types.isProxy(builds)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "builds proxy");
  }
  if (
    !Array.isArray(builds) ||
    Object.getPrototypeOf(builds) !== Array.prototype ||
    builds.length !== 4
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "builds shape drifted");
  }
  const descriptors = Object.getOwnPropertyDescriptors(builds);
  if (
    !isDeepStrictEqual(Reflect.ownKeys(descriptors), [
      "0",
      "1",
      "2",
      "3",
      "length",
    ])
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "builds fields drifted");
  }
  if (
    !Object.hasOwn(descriptors[0], "value") ||
    descriptors[0].enumerable !== true ||
    !Object.hasOwn(descriptors[1], "value") ||
    descriptors[1].enumerable !== true ||
    !Object.hasOwn(descriptors[2], "value") ||
    descriptors[2].enumerable !== true ||
    !Object.hasOwn(descriptors[3], "value") ||
    descriptors[3].enumerable !== true ||
    !Object.hasOwn(descriptors.length, "value") ||
    descriptors.length.value !== 4 ||
    descriptors.length.enumerable !== false
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      "input-shape",
      "builds descriptors drifted",
    );
  }
  return Object.freeze([
    snapshotBuild(descriptors[0], 0),
    snapshotBuild(descriptors[1], 1),
    snapshotBuild(descriptors[2], 2),
    snapshotBuild(descriptors[3], 3),
  ]);
}`;
const PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE = `function decodeVerifiedOwnerBeforeBuildReplay(envelope) {
  const value = envelope.bytes;
  if (
    !Buffer.isBuffer(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Buffer.prototype
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "product owner is not an exact Buffer");
  }
  const bytes = Buffer.from(value);
  if (bytes.length > G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES) {
    fail("LIMIT_EXCEEDED", "input-bounds", "product owner exceeds bound");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner is not UTF-8",
      error,
    );
  }
  if (!text.endsWith("\\n") || text.slice(0, -1).includes("\\n")) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner framing drifted",
    );
  }
  let owner;
  try {
    owner = snapshotJson(JSON.parse(text), "product owner", fail);
  } catch (error) {
    if (error instanceof G17BenchmarkProductOwnerV4ContractError) throw error;
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner JSON drifted",
      error,
    );
  }
  const canonical = Buffer.from(canonicalJson(owner) + "\\n", "utf8");
  if (!bytes.equals(canonical)) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner is not canonical JSON plus LF",
    );
  }
  if (
    owner === null ||
    typeof owner !== "object" ||
    Array.isArray(owner) ||
    Object.getPrototypeOf(owner) !== Object.prototype
  ) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner root is not a plain record",
    );
  }
  const { contentHash, ...unsigned } = owner;
  if (
    typeof contentHash !== "string" ||
    contentHash !== canonicalSha256(unsigned)
  ) {
    fail(
      "CONTENT_HASH_MISMATCH",
      "content-hash-validation",
      "product owner contentHash does not verify",
    );
  }
  const rootKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(owner));
  if (
    rootKeys.length !== 11 ||
    rootKeys[0] !== "authority" ||
    rootKeys[1] !== "binding" ||
    rootKeys[2] !== "bindings" ||
    rootKeys[3] !== "builds" ||
    rootKeys[4] !== "contentHash" ||
    rootKeys[5] !== "controlRunId" ||
    rootKeys[6] !== "finalDecisionEligible" ||
    rootKeys[7] !== "nonclaims" ||
    rootKeys[8] !== "physicalOrigin" ||
    rootKeys[9] !== "schema" ||
    rootKeys[10] !== "status"
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "product owner fields drifted",
    );
  }
  if (
    owner.schema !== "oxigraph.g1.7-benchmark-product-owner/v4" ||
    owner.status !== "PRODUCT_OWNER_V4_REPLAYED_AUTHORITY_NULL" ||
    owner.bindings === null ||
    typeof owner.bindings !== "object" ||
    Array.isArray(owner.bindings) ||
    Object.getPrototypeOf(owner.bindings) !== Object.prototype ||
    !Array.isArray(owner.builds) ||
    owner.builds.length !== G17_BENCHMARK_BUILD_PLAN.length
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "product owner identity drifted",
    );
  }
  const bindingKeys = Reflect.ownKeys(
    Object.getOwnPropertyDescriptors(owner.bindings),
  );
  if (
    bindingKeys.length !== 4 ||
    bindingKeys[0] !== "authorization" ||
    bindingKeys[1] !== "executionPlan" ||
    bindingKeys[2] !== "platform" ||
    bindingKeys[3] !== "toolchain"
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "product owner bindings drifted",
    );
  }
  for (let index = 0; index < G17_BENCHMARK_BUILD_PLAN.length; index += 1) {
    const build = owner.builds[index];
    if (
      build === null ||
      typeof build !== "object" ||
      Array.isArray(build) ||
      Object.getPrototypeOf(build) !== Object.prototype ||
      build.generations === null ||
      typeof build.generations !== "object" ||
      Array.isArray(build.generations) ||
      Object.getPrototypeOf(build.generations) !== Object.prototype
    ) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "product owner build identity drifted",
      );
    }
    const buildKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(build));
    const generationKeys = Reflect.ownKeys(
      Object.getOwnPropertyDescriptors(build.generations),
    );
    if (
      buildKeys.length !== 8 ||
      buildKeys[0] !== "buildId" ||
      buildKeys[1] !== "executionRequestV2" ||
      buildKeys[2] !== "generations" ||
      buildKeys[3] !== "ordinal" ||
      buildKeys[4] !== "owner" ||
      buildKeys[5] !== "productRole" ||
      buildKeys[6] !== "sourceProjection" ||
      buildKeys[7] !== "target" ||
      generationKeys.length !== 6 ||
      generationKeys[0] !== "containment" ||
      generationKeys[1] !== "lifecycle" ||
      generationKeys[2] !== "owner" ||
      generationKeys[3] !== "process" ||
      generationKeys[4] !== "target" ||
      generationKeys[5] !== "workspace"
    ) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "product owner build fields drifted",
      );
    }
  }
  return Object.freeze({ owner, bytes });
}`;
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

const OWNER_SCHEMA = "oxigraph.g1.7-benchmark-product-owner/v4";
const PROJECTION_SCHEMA = "oxigraph.g1.7-benchmark-product-owner-projection/v4";
const ARTIFACT_NAME = "benchmark-product-owner-v4.json";
const STATUS = "PRODUCT_OWNER_V4_REPLAYED_AUTHORITY_NULL";
const READINESS = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const MAX_BYTES = 4 * 1024 * 1024;
const LIMITS = deepFreeze({
  artifactMaximumBytes: MAX_BYTES,
  buildOwnerMaximumBytes: G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES,
  buildCount: G17_BENCHMARK_BUILD_PLAN.length,
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumArrayLength: 4_096,
  maximumPropertiesPerRecord: 4_097,
  aggregateStringUtf8MaximumBytes: 2 * 1024 * 1024,
  singleStringUtf8MaximumBytes: 1024 * 1024,
});
const ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "BUILD_OWNER_INVALID",
  "IDENTITY_INVALID",
  "GENERATION_COLLISION",
  "SOURCE_BINDING_DRIFT",
  "AUTHORIZATION_BINDING_DRIFT",
  "EXECUTION_PLAN_BINDING_DRIFT",
  "PLATFORM_BINDING_DRIFT",
  "TOOLCHAIN_BINDING_DRIFT",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "AUTHORITY_OVERCLAIM",
  "EXPECTED_INPUT_MISMATCH",
]);
const AUTHORITY = deepFreeze(
  g17PrivateOwnerV3Clone(G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY),
);
const NONCLAIMS = deepFreeze({
  ...g17PrivateOwnerV3Clone(G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS),
  serializedBuildOwnerSetProvesProductOrigin: false,
  productOwnerV4PhysicalOriginProven: false,
});
const EXECUTION_PLAN = deepFreeze({
  schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
  environmentRecipe: {
    schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
    sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  },
});
const EXPECTED_EXPORTS = Object.freeze([
  "G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_PROJECTION_SCHEMA",
  "G17_BENCHMARK_PRODUCT_OWNER_V4_SCHEMA",
  "G17BenchmarkProductOwnerV4ContractError",
  "createG17BenchmarkProductOwnerV4Artifact",
  "g17BenchmarkProductOwnerV4Readiness",
  "verifyG17BenchmarkProductOwnerV4Artifact",
]);
const EXPECTED_IMPORT_BINDINGS = Object.freeze([
  "../routing/features.mjs:canonicalJson:canonicalJson",
  "../routing/features.mjs:canonicalSha256:canonicalSha256",
  "./benchmark-build-owner-v3-contract.mjs:G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY:G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY",
  "./benchmark-build-owner-v3-contract.mjs:G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES:G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES",
  "./benchmark-build-owner-v3-contract.mjs:G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS:G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS",
  "./benchmark-build-owner-v3-contract.mjs:verifyG17BenchmarkBuildOwnerV3Artifact:verifyG17BenchmarkBuildOwnerV3Artifact",
  "./benchmark-execution-plan.mjs:G17_BENCHMARK_BUILD_PLAN:G17_BENCHMARK_BUILD_PLAN",
  "./benchmark-execution-plan.mjs:G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA:G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA",
  "./benchmark-execution-plan.mjs:G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256:G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256",
  "./benchmark-execution-plan.mjs:G17_BENCHMARK_EXECUTION_PLAN_SCHEMA:G17_BENCHMARK_EXECUTION_PLAN_SCHEMA",
  "./benchmark-execution-plan.mjs:G17_BENCHMARK_EXECUTION_PLAN_SHA256:G17_BENCHMARK_EXECUTION_PLAN_SHA256",
  "node:crypto:createHash:createHash",
  "node:util:isDeepStrictEqual:isDeepStrictEqual",
  "node:util:types:types",
]);
const EXPECTED_IMPORT_SOURCES = Object.freeze([
  "../routing/features.mjs",
  "./benchmark-build-owner-v3-contract.mjs",
  "./benchmark-execution-plan.mjs",
  "node:crypto",
  "node:util",
]);
const ERROR_PHASES = deepFreeze({
  INPUT_SHAPE_INVALID: ["input-shape"],
  LIMIT_EXCEEDED: ["artifact-snapshot", "canonical-encoding", "input-bounds"],
  BUILD_OWNER_INVALID: ["build-owner-replay"],
  IDENTITY_INVALID: [
    "build-order-validation",
    "control-run-validation",
    "identity-validation",
  ],
  GENERATION_COLLISION: ["generation-validation", "owner-identity-validation"],
  SOURCE_BINDING_DRIFT: ["request-binding", "source-binding"],
  AUTHORIZATION_BINDING_DRIFT: ["authorization-binding"],
  EXECUTION_PLAN_BINDING_DRIFT: ["execution-plan-binding"],
  PLATFORM_BINDING_DRIFT: ["platform-binding"],
  TOOLCHAIN_BINDING_DRIFT: ["toolchain-binding"],
  CANONICAL_ARTIFACT_INVALID: ["canonical-decoding"],
  CONTENT_HASH_MISMATCH: ["content-hash-validation"],
  AUTHORITY_OVERCLAIM: ["authority-validation"],
  EXPECTED_INPUT_MISMATCH: ["expected-input-validation"],
});
const ALLOWED_CANDIDATE_AST_NODES = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "BinaryExpression",
  "BlockStatement",
  "BreakStatement",
  "CallExpression",
  "CatchClause",
  "ClassBody",
  "ClassDeclaration",
  "ConditionalExpression",
  "ContinueStatement",
  "EmptyStatement",
  "ExportNamedDeclaration",
  "ExpressionStatement",
  "ForStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "Identifier",
  "IfStatement",
  "ImportDeclaration",
  "ImportSpecifier",
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
  "RestElement",
  "ReturnStatement",
  "Super",
  "TemplateElement",
  "TemplateLiteral",
  "ThisExpression",
  "ThrowStatement",
  "TryStatement",
  "UnaryExpression",
  "UpdateExpression",
  "VariableDeclaration",
  "VariableDeclarator",
]);
const ROOT_KEYS = Object.freeze([
  "authority",
  "binding",
  "bindings",
  "builds",
  "contentHash",
  "controlRunId",
  "finalDecisionEligible",
  "nonclaims",
  "physicalOrigin",
  "schema",
  "status",
]);
const BINDING_KEYS = Object.freeze([
  "authorization",
  "executionPlan",
  "platform",
  "toolchain",
]);
const BUILD_KEYS = Object.freeze([
  "buildId",
  "executionRequestV2",
  "generations",
  "ordinal",
  "owner",
  "productRole",
  "sourceProjection",
  "target",
]);
const GENERATION_KEYS = Object.freeze([
  "containment",
  "lifecycle",
  "owner",
  "process",
  "target",
  "workspace",
]);
const TARGET_KEYS = Object.freeze(["executable", "generation"]);
const EXECUTABLE_KEYS = Object.freeze(["bytes", "logicalPath", "sha256"]);
const IDENTITY_KEYS = Object.freeze(["schema", "rawSha256", "contentHash"]);
const ARTIFACT_KEYS = Object.freeze(["name", "rawSha256", "bytes"]);
const CREATED_KEYS = Object.freeze([
  "owner",
  "identity",
  "projection",
  "artifact",
]);
const VERIFIED_KEYS = Object.freeze(["owner", "identity", "projection"]);
const PROJECTION_KEYS = Object.freeze([
  "authority",
  "binding",
  "bindings",
  "builds",
  "controlRunId",
  "finalDecisionEligible",
  "nonclaims",
  "physicalOrigin",
  "productOwner",
  "schema",
  "status",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const PREDECESSORS = Object.freeze([
  [
    "../src/qualification/benchmark-build-owner-v3-contract.mjs",
    89_504,
    "029de5d4a49c484cfc9d6811393b4dd5e34e21f4579b98c4cc36e50bf1256d84",
  ],
  [
    "./g17-benchmark-build-owner-v3-contract.test.mjs",
    305_004,
    "86688f3cfa85af3a25932fb979c5472a69314bc104c06bbd4ace23714252ded9",
  ],
  [
    "./support/g17-private-owner-v3-v4-fixtures.mjs",
    20_871,
    "95c70f14af029dcfb676e46409450825bb94da402afe626477c2aa76f3d9ce88",
  ],
  [
    "../src/qualification/benchmark-execution-plan.mjs",
    9_114,
    "99b70fc6820fe3b5743bccac349cd7936aa3a04abc0e13f254f1ffee86f0e478",
  ],
  [
    "../src/qualification/benchmark-product-owner-contract.mjs",
    42_427,
    "889eb6a7e5817d709f61e485107dbb234974d0d9784ec3709ce1680fde965b64",
  ],
  [
    "./g17-benchmark-product-owner-contract.test.mjs",
    43_950,
    "960aa1caa85db7cbeed7f40573ef2754810b457a059fcbf73a812cc9982df9c1",
  ],
  [
    "../src/routing/features.mjs",
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
const acornModule = await import(PARSER_SNAPSHOT.importUrl);
assert.equal(acornModule.version, EXPECTED_ACORN.version);
assert.equal(typeof acornModule.parse, "function");
assert.equal(typeof acornModule.tokenizer, "function");
const parse = acornModule.parse;
const tokenizer = acornModule.tokenizer;

function preflightCandidateModuleTokens(source) {
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
      tokenCount <= MAX_CANDIDATE_TOKENS,
      true,
      "candidate token limit exceeded",
    );
    if (label === "`" && delimiters.at(-1) === "`") delimiters.pop();
    else if (closingDelimiter.has(label)) {
      delimiters.push(label);
      assert.equal(
        delimiters.length <= MAX_CANDIDATE_DELIMITER_DEPTH,
        true,
        "candidate delimiter nesting exceeds bound",
      );
    } else if ([")", "]", "}"].includes(label)) {
      assert.equal(
        closingDelimiter.get(delimiters.pop()),
        label,
        "candidate delimiter nesting drifted",
      );
    }
  }
  assert.deepEqual(delimiters, []);
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
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function deepFreezeJson(value) {
  return JSON.parse(canonicalJson(value), (_key, child) =>
    child !== null && typeof child === "object" ? Object.freeze(child) : child,
  );
}

function clone(value) {
  return g17PrivateOwnerV3Clone(value);
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function exactKeys(value, keys) {
  assert.deepEqual(Reflect.ownKeys(value), keys);
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function reseal(value) {
  const { contentHash: _ignored, ...unsigned } = clone(value);
  return { ...unsigned, contentHash: canonicalSha256(unsigned) };
}

function ownDataRecord(value, keys, label, fail) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      "input-shape",
      `${label} is not a plain record`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!isDeepStrictEqual(Reflect.ownKeys(descriptors), keys)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", `${label} fields drifted`);
  }
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      fail(
        "INPUT_SHAPE_INVALID",
        "input-shape",
        `${label}.${key} is not own enumerable data`,
      );
    }
    output[key] = descriptor.value;
  }
  return output;
}

function denseArray(value, length, label, fail) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== length
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", `${label} cardinality drifted`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = Array.from({ length }, (_unused, index) => `${index}`);
  expectedKeys.push("length");
  if (!isDeepStrictEqual(Reflect.ownKeys(descriptors), expectedKeys)) {
    fail(
      "INPUT_SHAPE_INVALID",
      "input-shape",
      `${label} is sparse or extended`,
    );
  }
  return expectedKeys.slice(0, -1).map((key) => {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      fail(
        "INPUT_SHAPE_INVALID",
        "input-shape",
        `${label}.${key} is not own enumerable data`,
      );
    }
    return descriptor.value;
  });
}

function copiedBuffer(value, maximum, label, fail) {
  if (
    !Buffer.isBuffer(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Buffer.prototype
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      "input-shape",
      `${label} is not an exact Buffer`,
    );
  }
  const copied = Buffer.from(value);
  if (copied.length > maximum) {
    fail("LIMIT_EXCEEDED", "input-bounds", `${label} exceeds bound`);
  }
  return copied;
}

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, keys) {
  return (
    isPlainRecord(value) && isDeepStrictEqual(Reflect.ownKeys(value), keys)
  );
}

function snapshotJson(value, label, fail, context = undefined, depth = 0) {
  const budget = context ?? {
    ancestors: new WeakSet(),
    nodes: 0,
    stringBytes: 0,
  };
  if (depth > LIMITS.maximumDepth) {
    fail("LIMIT_EXCEEDED", "artifact-snapshot", `${label} exceeds depth`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > LIMITS.singleStringUtf8MaximumBytes ||
      budget.stringBytes > LIMITS.aggregateStringUtf8MaximumBytes
    ) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", `${label} exceeds strings`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(
        "INPUT_SHAPE_INVALID",
        "artifact-snapshot",
        `${label} number drifted`,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || types.isProxy(value)) {
    fail("INPUT_SHAPE_INVALID", "artifact-snapshot", `${label} is non-JSON`);
  }
  if (budget.ancestors.has(value)) {
    fail("INPUT_SHAPE_INVALID", "artifact-snapshot", `${label} contains cycle`);
  }
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      "artifact-snapshot",
      `${label} prototype drifted`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length > LIMITS.maximumPropertiesPerRecord ||
    (array && value.length > LIMITS.maximumArrayLength)
  ) {
    fail("LIMIT_EXCEEDED", "artifact-snapshot", `${label} shape exceeds bound`);
  }
  budget.nodes += 1;
  if (budget.nodes > LIMITS.maximumNodes) {
    fail("LIMIT_EXCEEDED", "artifact-snapshot", `${label} exceeds nodes`);
  }
  if (array) {
    const enumerableKeys = Object.keys(value);
    if (
      enumerableKeys.length !== value.length ||
      keys.length !== value.length + 1
    ) {
      fail(
        "INPUT_SHAPE_INVALID",
        "artifact-snapshot",
        `${label} array is sparse`,
      );
    }
  }
  budget.ancestors.add(value);
  try {
    const outputEntries = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length" && array) continue;
      if (!("value" in descriptor) || descriptor.enumerable !== true) {
        fail(
          "INPUT_SHAPE_INVALID",
          "artifact-snapshot",
          `${label}.${key} is not own enumerable data`,
        );
      }
      const keyBytes = Buffer.byteLength(key, "utf8");
      budget.stringBytes += keyBytes;
      if (
        keyBytes > LIMITS.singleStringUtf8MaximumBytes ||
        budget.stringBytes > LIMITS.aggregateStringUtf8MaximumBytes
      ) {
        fail(
          "LIMIT_EXCEEDED",
          "artifact-snapshot",
          `${label} exceeds property-name and value strings`,
        );
      }
      outputEntries.push([
        key,
        snapshotJson(
          descriptor.value,
          `${label}.${key}`,
          fail,
          budget,
          depth + 1,
        ),
      ]);
    }
    return array
      ? outputEntries.map((entry) => entry[1])
      : Object.fromEntries(outputEntries);
  } finally {
    budget.ancestors.delete(value);
  }
}

function decodeVerifiedJson(bytes) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function createReferenceCandidate() {
  const codes = new Set(ERROR_CODES);

  class G17BenchmarkProductOwnerV4ContractError extends Error {
    constructor(code, phase, message, options = undefined) {
      if (!codes.has(code))
        throw new TypeError("unknown product-owner-v4 code");
      super(
        `G1.7 benchmark product owner v4 contract: [${code}] ${phase}: ${message}`,
        options,
      );
      this.name = "G17BenchmarkProductOwnerV4ContractError";
      this.code = code;
      this.phase = phase;
    }
  }

  function fail(code, phase, message, cause = undefined) {
    throw new G17BenchmarkProductOwnerV4ContractError(
      code,
      phase,
      message,
      cause === undefined ? undefined : { cause },
    );
  }

  function validateDigest(value, label) {
    if (typeof value !== "string" || !DIGEST.test(value)) {
      fail("IDENTITY_INVALID", "identity-validation", `${label} drifted`);
    }
  }

  function normalizeBuilds(rawBuilds) {
    const builds = denseArray(
      rawBuilds,
      G17_BENCHMARK_BUILD_PLAN.length,
      "product builds",
      fail,
    );
    const normalized = builds.map((rawBuild, index) => {
      const build = ownDataRecord(
        rawBuild,
        ["bytes", "fixture"],
        `product build ${index}`,
        fail,
      );
      const bytes = copiedBuffer(
        build.bytes,
        G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES,
        `product build ${index} owner`,
        fail,
      );
      let replay;
      try {
        replay = verifyG17BenchmarkBuildOwnerV3Artifact({
          bytes,
          fixture: build.fixture,
        });
      } catch (error) {
        fail(
          "BUILD_OWNER_INVALID",
          "build-owner-replay",
          `product build ${index} did not replay`,
          error,
        );
      }
      return Object.freeze({ bytes, fixture: build.fixture, replay });
    });
    return normalized;
  }

  function projectBuild(entry, index) {
    const plan = G17_BENCHMARK_BUILD_PLAN[index];
    const owner = entry.replay.owner;
    const identity = owner.identity;
    if (
      identity.ordinal !== index + 1 ||
      identity.buildId !== plan.buildId ||
      identity.productRole !== plan.productRole
    ) {
      fail(
        "IDENTITY_INVALID",
        "build-order-validation",
        `product build ${index} order drifted`,
      );
    }
    const fixture = ownDataRecord(
      entry.fixture,
      [
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
      ],
      `product build ${index} fixture`,
      fail,
    );
    const requestEnvelope = ownDataRecord(
      fixture.executionRequestV2Verification,
      ["bytes", "expected"],
      `product build ${index} request verification`,
      fail,
    );
    const requestBytes = copiedBuffer(
      requestEnvelope.bytes,
      2 * 1024 * 1024,
      `product build ${index} request`,
      fail,
    );
    const request = decodeVerifiedJson(requestBytes);
    const sourceBytes = copiedBuffer(
      fixture.sourceProjectionBytes,
      16 * 1024 * 1024,
      `product build ${index} source projection`,
      fail,
    );
    const source = decodeVerifiedJson(sourceBytes);
    if (
      !isDeepStrictEqual(request.source, owner.bindings.sourceProjection) ||
      source.schema !== request.source.schema ||
      sha256(sourceBytes) !== request.source.rawSha256 ||
      source.contentHash !== request.source.contentHash ||
      source.controlRunId !== identity.controlRunId ||
      source.buildId !== identity.buildId ||
      source.productRole !== identity.productRole ||
      source.workspace.generation !== identity.workspaceGeneration ||
      source.workspace.targetGeneration !== identity.targetGeneration
    ) {
      fail(
        "SOURCE_BINDING_DRIFT",
        "source-binding",
        `product build ${index} source binding drifted`,
      );
    }
    if (
      request.schema !== owner.bindings.executionRequestV2.schema ||
      sha256(requestBytes) !== owner.bindings.executionRequestV2.rawSha256 ||
      request.contentHash !== owner.bindings.executionRequestV2.contentHash ||
      request.controlRunId !== identity.controlRunId ||
      request.buildId !== identity.buildId ||
      request.productRole !== identity.productRole ||
      request.ownership.ordinal !== identity.ordinal ||
      request.ownership.ownerGeneration !== identity.ownerGeneration ||
      request.ownership.processGeneration !== identity.processGeneration
    ) {
      fail(
        "SOURCE_BINDING_DRIFT",
        "request-binding",
        `product build ${index} request binding drifted`,
      );
    }
    if (!isDeepStrictEqual(request.executionPlan, EXECUTION_PLAN)) {
      fail(
        "EXECUTION_PLAN_BINDING_DRIFT",
        "execution-plan-binding",
        `product build ${index} execution plan drifted`,
      );
    }
    const authorization = request.authorization;
    const { schema: authorizationSchema, ...sourceAuthorizationBinding } =
      authorization ?? {};
    if (
      authorization === null ||
      typeof authorization !== "object" ||
      authorizationSchema !== "oxigraph.g1.7-control-authorization/v3" ||
      !isDeepStrictEqual(sourceAuthorizationBinding, source.authorization)
    ) {
      fail(
        "AUTHORIZATION_BINDING_DRIFT",
        "authorization-binding",
        `product build ${index} authorization drifted`,
      );
    }
    validateDigest(authorization.rawSha256, "authorization rawSha256");
    validateDigest(authorization.contentHash, "authorization contentHash");
    const platform = {
      platformRootSha256: request.platform.platformRootSha256,
    };
    const toolchain = {
      toolchainRootSha256: request.platform.toolchainRootSha256,
      cargo: clone(request.platform.cargo),
      rustc: clone(request.platform.rustc),
    };
    validateDigest(platform.platformRootSha256, "platform root");
    validateDigest(toolchain.toolchainRootSha256, "toolchain root");
    validateDigest(toolchain.cargo.sha256, "Cargo image");
    validateDigest(toolchain.rustc.sha256, "rustc image");
    if (
      toolchain.cargo.logicalPath === toolchain.rustc.logicalPath ||
      toolchain.cargo.sha256 === toolchain.rustc.sha256 ||
      isDeepStrictEqual(toolchain.cargo.identity, toolchain.rustc.identity)
    ) {
      fail(
        "TOOLCHAIN_BINDING_DRIFT",
        "toolchain-binding",
        `product build ${index} toolchain aliases`,
      );
    }
    const generations = {
      owner: identity.ownerGeneration,
      workspace: identity.workspaceGeneration,
      target: identity.targetGeneration,
      process: identity.processGeneration,
      containment: identity.containmentGeneration,
      lifecycle: identity.lifecycleGeneration,
    };
    const generationValues = Object.values(generations);
    if (new Set(generationValues).size !== generationValues.length) {
      fail(
        "GENERATION_COLLISION",
        "generation-validation",
        `product build ${index} generations collide`,
      );
    }
    const executable = owner.observations.target.executable;
    return {
      authorization,
      platform,
      toolchain,
      generationValues,
      value: {
        buildId: identity.buildId,
        productRole: identity.productRole,
        ordinal: identity.ordinal,
        owner: clone(entry.replay.identity),
        sourceProjection: clone(owner.bindings.sourceProjection),
        executionRequestV2: clone(owner.bindings.executionRequestV2),
        generations,
        target: {
          generation: identity.targetGeneration,
          executable: {
            logicalPath: executable.logicalPath,
            bytes: executable.bytes,
            sha256: executable.sha256,
          },
        },
      },
    };
  }

  function expectedOwner(normalized) {
    const projected = normalized.map(projectBuild);
    const controlRunId = projected[0].value.sourceProjection.controlRunId;
    if (
      projected.some(
        ({ value }) => value.sourceProjection.controlRunId !== controlRunId,
      )
    ) {
      fail(
        "IDENTITY_INVALID",
        "control-run-validation",
        "product builds do not share one control run",
      );
    }
    const ownerIdentities = projected.map(({ value }) => value.owner.rawSha256);
    if (new Set(ownerIdentities).size !== ownerIdentities.length) {
      fail(
        "GENERATION_COLLISION",
        "owner-identity-validation",
        "product build-owner identities are not distinct",
      );
    }
    const generations = projected.flatMap(({ generationValues }) =>
      generationValues.slice(),
    );
    if (new Set(generations).size !== generations.length) {
      fail(
        "GENERATION_COLLISION",
        "generation-validation",
        "product generations are not globally distinct",
      );
    }
    const authorization = projected[0].authorization;
    if (
      projected.some(
        (build) => !isDeepStrictEqual(build.authorization, authorization),
      )
    ) {
      fail(
        "AUTHORIZATION_BINDING_DRIFT",
        "authorization-binding",
        "product builds do not share authorization",
      );
    }
    const platform = projected[0].platform;
    if (
      projected.some((build) => !isDeepStrictEqual(build.platform, platform))
    ) {
      fail(
        "PLATFORM_BINDING_DRIFT",
        "platform-binding",
        "product builds do not share platform identity",
      );
    }
    const toolchain = projected[0].toolchain;
    if (
      projected.some((build) => !isDeepStrictEqual(build.toolchain, toolchain))
    ) {
      fail(
        "TOOLCHAIN_BINDING_DRIFT",
        "toolchain-binding",
        "product builds do not share toolchain identity",
      );
    }
    const unsigned = {
      schema: OWNER_SCHEMA,
      status: STATUS,
      controlRunId,
      bindings: {
        authorization: clone(authorization),
        executionPlan: clone(EXECUTION_PLAN),
        platform: clone(platform),
        toolchain: clone(toolchain),
      },
      builds: projected.map(({ value }) => value),
      physicalOrigin: false,
      binding: null,
      finalDecisionEligible: false,
      authority: AUTHORITY,
      nonclaims: NONCLAIMS,
    };
    return deepFreezeJson({
      ...unsigned,
      contentHash: canonicalSha256(unsigned),
    });
  }

  function identityFor(owner, bytes) {
    return Object.freeze({
      schema: OWNER_SCHEMA,
      rawSha256: sha256(bytes),
      contentHash: owner.contentHash,
    });
  }

  function projectionFor(owner, identity) {
    return deepFreezeJson({
      schema: PROJECTION_SCHEMA,
      status: STATUS,
      productOwner: identity,
      controlRunId: owner.controlRunId,
      bindings: owner.bindings,
      builds: owner.builds,
      physicalOrigin: false,
      binding: null,
      finalDecisionEligible: false,
      authority: AUTHORITY,
      nonclaims: NONCLAIMS,
    });
  }

  function artifactFor(bytes) {
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
    const result = {
      owner,
      identity,
      projection: projectionFor(owner, identity),
    };
    if (includeArtifact) result.artifact = artifactFor(bytes);
    return Object.freeze(result);
  }

  function createArtifact(input) {
    const envelope = ownDataRecord(input, ["builds"], "creation input", fail);
    const owner = expectedOwner(normalizeBuilds(envelope.builds));
    const bytes = canonicalBytes(owner);
    if (bytes.length > MAX_BYTES) {
      fail(
        "LIMIT_EXCEEDED",
        "canonical-encoding",
        "product owner exceeds bound",
      );
    }
    return created(owner, bytes, true);
  }

  function decodeOwner(bytes) {
    const captured = copiedBuffer(bytes, MAX_BYTES, "product owner", fail);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(captured);
    } catch (error) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "product owner is not UTF-8",
        error,
      );
    }
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "product owner framing drifted",
      );
    }
    let owner;
    try {
      owner = snapshotJson(JSON.parse(text), "product owner", fail);
    } catch (error) {
      if (error instanceof G17BenchmarkProductOwnerV4ContractError) throw error;
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "product owner JSON drifted",
        error,
      );
    }
    if (!isPlainRecord(owner)) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "product owner root is not a plain record",
      );
    }
    if (!captured.equals(canonicalBytes(owner))) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "product owner is not canonical JSON plus LF",
      );
    }
    const { contentHash, ...unsigned } = owner;
    if (
      typeof contentHash !== "string" ||
      !DIGEST.test(contentHash) ||
      contentHash !== canonicalSha256(unsigned)
    ) {
      fail(
        "CONTENT_HASH_MISMATCH",
        "content-hash-validation",
        "product owner contentHash does not verify",
      );
    }
    return { owner, bytes: captured };
  }

  function verifyArtifact(input) {
    const envelope = ownDataRecord(
      input,
      ["bytes", "builds"],
      "verification input",
      fail,
    );
    const decoded = decodeOwner(envelope.bytes);
    if (!hasExactKeys(decoded.owner, ROOT_KEYS)) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "product owner fields drifted",
      );
    }
    if (
      decoded.owner.schema !== OWNER_SCHEMA ||
      decoded.owner.status !== STATUS ||
      !hasExactKeys(decoded.owner.bindings, BINDING_KEYS) ||
      !Array.isArray(decoded.owner.builds) ||
      decoded.owner.builds.length !== G17_BENCHMARK_BUILD_PLAN.length ||
      decoded.owner.builds.some((build) => !hasExactKeys(build, BUILD_KEYS)) ||
      decoded.owner.builds.some(
        (build) => !hasExactKeys(build.generations, GENERATION_KEYS),
      )
    ) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "product owner identity drifted",
      );
    }
    const expected = expectedOwner(normalizeBuilds(envelope.builds));
    if (
      decoded.owner.physicalOrigin !== false ||
      decoded.owner.binding !== null ||
      decoded.owner.finalDecisionEligible !== false ||
      !isDeepStrictEqual(decoded.owner.authority, AUTHORITY) ||
      !isDeepStrictEqual(decoded.owner.nonclaims, NONCLAIMS)
    ) {
      fail(
        "AUTHORITY_OVERCLAIM",
        "authority-validation",
        "product owner overclaims origin, authority, or eligibility",
      );
    }
    for (let index = 0; index < decoded.owner.builds.length; index += 1) {
      const actualBuild = decoded.owner.builds[index];
      const expectedBuild = expected.builds[index];
      if (
        !isDeepStrictEqual(
          actualBuild.sourceProjection,
          expectedBuild.sourceProjection,
        ) ||
        !isDeepStrictEqual(
          actualBuild.executionRequestV2,
          expectedBuild.executionRequestV2,
        )
      ) {
        fail(
          "SOURCE_BINDING_DRIFT",
          "source-binding",
          `product build ${index} serialized source or request binding drifted`,
        );
      }
    }
    if (
      !isDeepStrictEqual(
        decoded.owner.bindings.authorization,
        expected.bindings.authorization,
      )
    ) {
      fail(
        "AUTHORIZATION_BINDING_DRIFT",
        "authorization-binding",
        "product authorization binding drifted",
      );
    }
    if (
      !isDeepStrictEqual(
        decoded.owner.bindings.executionPlan,
        expected.bindings.executionPlan,
      )
    ) {
      fail(
        "EXECUTION_PLAN_BINDING_DRIFT",
        "execution-plan-binding",
        "product execution-plan binding drifted",
      );
    }
    if (
      !isDeepStrictEqual(
        decoded.owner.bindings.platform,
        expected.bindings.platform,
      )
    ) {
      fail(
        "PLATFORM_BINDING_DRIFT",
        "platform-binding",
        "product platform binding drifted",
      );
    }
    if (
      !isDeepStrictEqual(
        decoded.owner.bindings.toolchain,
        expected.bindings.toolchain,
      )
    ) {
      fail(
        "TOOLCHAIN_BINDING_DRIFT",
        "toolchain-binding",
        "product toolchain binding drifted",
      );
    }
    if (!isDeepStrictEqual(decoded.owner, expected)) {
      fail(
        "EXPECTED_INPUT_MISMATCH",
        "expected-input-validation",
        "product owner differs from expected build inputs",
      );
    }
    return created(deepFreezeJson(decoded.owner), decoded.bytes, false);
  }

  return Object.freeze({
    G17_BENCHMARK_PRODUCT_OWNER_V4_SCHEMA: OWNER_SCHEMA,
    G17_BENCHMARK_PRODUCT_OWNER_V4_PROJECTION_SCHEMA: PROJECTION_SCHEMA,
    G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME: ARTIFACT_NAME,
    G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES: MAX_BYTES,
    G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS: LIMITS,
    G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES: ERROR_CODES,
    G17BenchmarkProductOwnerV4ContractError,
    G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY: AUTHORITY,
    G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS: NONCLAIMS,
    g17BenchmarkProductOwnerV4Readiness() {
      return READINESS;
    },
    createG17BenchmarkProductOwnerV4Artifact: createArtifact,
    verifyG17BenchmarkProductOwnerV4Artifact: verifyArtifact,
  });
}

function cloneInput(input) {
  return {
    builds: input.builds.map(({ bytes, fixture }) => ({
      bytes: Buffer.from(bytes),
      fixture: clone(fixture),
    })),
  };
}

function captureBorrowedOwnership(root) {
  const seen = new WeakSet();
  const entries = [];
  const visit = (value) => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Buffer.isBuffer(value)) {
      entries.push(
        Object.freeze({
          value,
          prototype: Object.getPrototypeOf(value),
          extensible: Object.isExtensible(value),
          sealed: Object.isSealed(value),
          frozen: Object.isFrozen(value),
          bytes: Buffer.from(value),
          descriptors: null,
        }),
      );
      return;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorSnapshot = Reflect.ownKeys(descriptors).map((key) => {
      const descriptor = descriptors[key];
      if (Object.hasOwn(descriptor, "value")) visit(descriptor.value);
      return Object.freeze({
        key,
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        value: descriptor.value,
        get: descriptor.get,
        set: descriptor.set,
      });
    });
    entries.push(
      Object.freeze({
        value,
        prototype: Object.getPrototypeOf(value),
        extensible: Object.isExtensible(value),
        sealed: Object.isSealed(value),
        frozen: Object.isFrozen(value),
        bytes: Buffer.isBuffer(value) ? Buffer.from(value) : null,
        descriptors: Object.freeze(descriptorSnapshot),
      }),
    );
  };
  visit(root);
  return Object.freeze(entries);
}

function assertBorrowedOwnershipUnchanged(snapshot) {
  for (const entry of snapshot) {
    assert.equal(Object.getPrototypeOf(entry.value), entry.prototype);
    assert.equal(Object.isExtensible(entry.value), entry.extensible);
    assert.equal(Object.isSealed(entry.value), entry.sealed);
    assert.equal(Object.isFrozen(entry.value), entry.frozen);
    if (entry.bytes !== null) assert.deepEqual(entry.value, entry.bytes);
    if (entry.descriptors === null) continue;
    const descriptors = Object.getOwnPropertyDescriptors(entry.value);
    assert.deepEqual(
      Reflect.ownKeys(descriptors),
      entry.descriptors.map(({ key }) => key),
    );
    for (const expected of entry.descriptors) {
      const actual = descriptors[expected.key];
      assert.notEqual(actual, undefined);
      assert.equal(actual.configurable, expected.configurable);
      assert.equal(actual.enumerable, expected.enumerable);
      assert.equal(actual.writable, expected.writable);
      assert.equal(actual.value, expected.value);
      assert.equal(actual.get, expected.get);
      assert.equal(actual.set, expected.set);
    }
  }
}

async function createBuildInput(buildIndex, salt) {
  const fixture = await createG17PrivateOwnerV3Fixture({ buildIndex, salt });
  const capability = createG17BenchmarkBuildOwnerV3CapabilityForTesting({
    fixture,
  });
  const created = await createG17BenchmarkBuildOwnerV3Artifact(capability);
  verifyG17BenchmarkBuildOwnerV3Artifact({
    bytes: created.artifact.bytes,
    fixture,
  });
  return { bytes: created.artifact.bytes, fixture };
}

async function remintBuildInput(buildInput, mutateFixture) {
  const fixture = clone(buildInput.fixture);
  mutateFixture(fixture);
  const capability = createG17BenchmarkBuildOwnerV3CapabilityForTesting({
    fixture,
  });
  const created = await createG17BenchmarkBuildOwnerV3Artifact(capability);
  verifyG17BenchmarkBuildOwnerV3Artifact({
    bytes: created.artifact.bytes,
    fixture,
  });
  return { bytes: created.artifact.bytes, fixture };
}

async function createProductInput(salt) {
  const builds = [];
  for (let index = 0; index < G17_BENCHMARK_BUILD_PLAN.length; index += 1) {
    builds.push(await createBuildInput(index, salt));
  }
  return { builds };
}

let baseInputPromise;
const observedContractErrorCodes = new WeakMap();
function baseInput() {
  baseInputPromise ??= createProductInput("s7-base");
  return baseInputPromise;
}

function assertContractError(
  candidate,
  code,
  action,
  { cause = false, phase = null } = {},
) {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.notEqual(caught, null, `expected ${code}`);
  assert.equal(
    caught instanceof candidate.G17BenchmarkProductOwnerV4ContractError,
    true,
  );
  assert.equal(caught instanceof Error, true);
  assert.equal(caught.name, "G17BenchmarkProductOwnerV4ContractError");
  assert.equal(caught.code, code);
  observedContractErrorCodes.get(candidate)?.add(code);
  assert.equal(typeof caught.phase, "string");
  assert.equal(
    ERROR_PHASES[code].includes(caught.phase),
    true,
    `${code} phase ${caught.phase}`,
  );
  if (phase !== null) assert.equal(caught.phase, phase);
  assert.match(
    caught.message,
    new RegExp(
      `^G1\\.7 benchmark product owner v4 contract: \\[${code}\\] ${caught.phase}:`,
      "u",
    ),
  );
  if (cause) assert.equal(caught.cause instanceof Error, true);
  return caught;
}

async function assertCandidateContract(candidate) {
  observedContractErrorCodes.set(candidate, new Set());
  assert.deepEqual(Object.keys(candidate).sort(), [...EXPECTED_EXPORTS].sort());
  assert.equal(candidate.G17BenchmarkProductOwnerV4ContractError.length, 3);
  assert.equal(candidate.createG17BenchmarkProductOwnerV4Artifact.length, 1);
  assert.equal(candidate.verifyG17BenchmarkProductOwnerV4Artifact.length, 1);
  assert.equal(candidate.g17BenchmarkProductOwnerV4Readiness.length, 0);
  const publicError = new candidate.G17BenchmarkProductOwnerV4ContractError(
    "IDENTITY_INVALID",
    "identity-validation",
    "public surface",
  );
  assert.equal(publicError instanceof Error, true);
  assert.deepEqual(Object.keys(publicError), ["name", "code", "phase"]);
  assert.equal(Object.hasOwn(publicError, "message"), true);
  assert.equal(Object.hasOwn(publicError, "stack"), true);
  assert.equal(publicError.cause, undefined);
  assert.equal(
    publicError.message,
    "G1.7 benchmark product owner v4 contract: [IDENTITY_INVALID] identity-validation: public surface",
  );
  assert.throws(
    () =>
      new candidate.G17BenchmarkProductOwnerV4ContractError(
        "UNKNOWN",
        "identity-validation",
        "unknown",
      ),
    {
      name: "TypeError",
      message: "unknown product-owner-v4 code",
    },
  );
  assert.equal(candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_SCHEMA, OWNER_SCHEMA);
  assert.equal(
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_PROJECTION_SCHEMA,
    PROJECTION_SCHEMA,
  );
  assert.equal(
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME,
    ARTIFACT_NAME,
  );
  assert.equal(candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES, MAX_BYTES);
  assert.deepEqual(candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS, LIMITS);
  assert.deepEqual(
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES,
    ERROR_CODES,
  );
  assert.deepEqual(
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY,
    AUTHORITY,
  );
  assert.deepEqual(
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS,
    NONCLAIMS,
  );
  assert.deepEqual(candidate.g17BenchmarkProductOwnerV4Readiness(), READINESS);
  for (const value of [
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS,
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES,
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY,
    candidate.G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS,
    candidate.g17BenchmarkProductOwnerV4Readiness(),
  ]) {
    assertDeepFrozen(value);
  }

  const oracleInput = cloneInput(await baseInput());
  const oracle = createReferenceCandidate();
  const expectedCreated = oracle.createG17BenchmarkProductOwnerV4Artifact(
    cloneInput(oracleInput),
  );
  const actualCreated = candidate.createG17BenchmarkProductOwnerV4Artifact(
    cloneInput(oracleInput),
  );
  assert.deepEqual(Reflect.ownKeys(actualCreated), CREATED_KEYS);
  assert.deepEqual(Reflect.ownKeys(actualCreated.identity), IDENTITY_KEYS);
  assert.deepEqual(Reflect.ownKeys(actualCreated.artifact), ARTIFACT_KEYS);
  assert.deepEqual(actualCreated.owner, expectedCreated.owner);
  assert.deepEqual(actualCreated.identity, expectedCreated.identity);
  assert.deepEqual(actualCreated.projection, expectedCreated.projection);
  assert.equal(actualCreated.artifact.name, expectedCreated.artifact.name);
  assert.equal(
    actualCreated.artifact.rawSha256,
    expectedCreated.artifact.rawSha256,
  );
  assert.deepEqual(
    actualCreated.artifact.bytes,
    expectedCreated.artifact.bytes,
  );
  const candidateCrossVerified =
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: expectedCreated.artifact.bytes,
      builds: cloneInput(oracleInput).builds,
    });
  const referenceCrossVerified =
    oracle.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: actualCreated.artifact.bytes,
      builds: cloneInput(oracleInput).builds,
    });
  for (const result of [candidateCrossVerified, referenceCrossVerified]) {
    assert.deepEqual(Reflect.ownKeys(result), VERIFIED_KEYS);
    assert.deepEqual(Reflect.ownKeys(result.identity), IDENTITY_KEYS);
    assert.deepEqual(result.owner, expectedCreated.owner);
    assert.deepEqual(result.identity, expectedCreated.identity);
    assert.deepEqual(result.projection, expectedCreated.projection);
  }

  const input = cloneInput(await baseInput());
  const borrowedOwnership = captureBorrowedOwnership(input);
  const created = candidate.createG17BenchmarkProductOwnerV4Artifact(input);
  assertBorrowedOwnershipUnchanged(borrowedOwnership);
  exactKeys(created.owner, ROOT_KEYS);
  exactKeys(created.owner.bindings, BINDING_KEYS);
  assert.equal(created.owner.builds.length, G17_BENCHMARK_BUILD_PLAN.length);
  for (const [index, build] of created.owner.builds.entries()) {
    exactKeys(build, BUILD_KEYS);
    exactKeys(build.generations, GENERATION_KEYS);
    exactKeys(build.target, TARGET_KEYS);
    exactKeys(build.target.executable, EXECUTABLE_KEYS);
    assert.equal(build.ordinal, index + 1);
    assert.equal(build.buildId, G17_BENCHMARK_BUILD_PLAN[index].buildId);
    assert.equal(
      build.productRole,
      G17_BENCHMARK_BUILD_PLAN[index].productRole,
    );
  }
  const allGenerations = created.owner.builds.flatMap((build) =>
    Object.values(build.generations),
  );
  assert.equal(new Set(allGenerations).size, 24);
  assert.equal(
    new Set(created.owner.builds.map((build) => build.owner.rawSha256)).size,
    4,
  );
  assert.equal(created.owner.physicalOrigin, false);
  assert.equal(created.owner.binding, null);
  assert.equal(created.owner.finalDecisionEligible, false);
  assert.deepEqual(created.owner.authority, AUTHORITY);
  assert.deepEqual(created.owner.nonclaims, NONCLAIMS);
  exactKeys(created.projection, PROJECTION_KEYS);
  assert.deepEqual(created.projection.productOwner, created.identity);
  assert.deepEqual(created.projection.bindings, created.owner.bindings);
  assert.deepEqual(created.projection.builds, created.owner.builds);
  assert.equal(created.projection.physicalOrigin, false);
  assert.equal(created.projection.binding, null);
  assert.equal(created.projection.finalDecisionEligible, false);
  assertDeepFrozen(created.owner);
  assertDeepFrozen(created.projection);
  assertDeepFrozen(created.identity);

  const firstBytes = created.artifact.bytes;
  const secondBytes = created.artifact.bytes;
  assert.notEqual(firstBytes, secondBytes);
  assert.deepEqual(firstBytes, secondBytes);
  firstBytes.fill(0);
  assert.deepEqual(created.artifact.bytes, secondBytes);
  assert.equal(created.artifact.rawSha256, sha256(secondBytes));
  assert.equal(secondBytes.length <= MAX_BYTES, true);

  input.builds[0].fixture.identity.controlRunId = "changed-after-create";
  input.builds[0].bytes.fill(0);
  assert.deepEqual(created.artifact.bytes, secondBytes);

  const verified = candidate.verifyG17BenchmarkProductOwnerV4Artifact({
    bytes: secondBytes,
    builds: cloneInput(await baseInput()).builds,
  });
  assert.deepEqual(verified.owner, created.owner);
  assert.deepEqual(verified.identity, created.identity);
  assert.deepEqual(verified.projection, created.projection);
  assert.equal(Object.hasOwn(verified, "artifact"), false);
  assertDeepFrozen(verified.owner);

  let coercionHooks = 0;
  const hookedBytes = Buffer.from(secondBytes);
  Object.defineProperty(hookedBytes, Symbol.toPrimitive, {
    configurable: false,
    enumerable: false,
    value() {
      coercionHooks += 1;
      return 0;
    },
    writable: false,
  });
  const hookVerified = candidate.verifyG17BenchmarkProductOwnerV4Artifact({
    bytes: hookedBytes,
    builds: cloneInput(await baseInput()).builds,
  });
  assert.deepEqual(hookVerified.identity, created.identity);
  assert.equal(coercionHooks, 0);

  const fewer = cloneInput(await baseInput());
  fewer.builds.pop();
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(fewer),
  );

  const reordered = cloneInput(await baseInput());
  [reordered.builds[0], reordered.builds[1]] = [
    reordered.builds[1],
    reordered.builds[0],
  ];
  assertContractError(candidate, "IDENTITY_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(reordered),
  );

  const noiseReordered = cloneInput(await baseInput());
  [noiseReordered.builds[2], noiseReordered.builds[3]] = [
    noiseReordered.builds[3],
    noiseReordered.builds[2],
  ];
  assertContractError(candidate, "IDENTITY_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(noiseReordered),
  );

  const duplicate = cloneInput(await baseInput());
  duplicate.builds[1] = cloneInput(await baseInput()).builds[0];
  assertContractError(candidate, "IDENTITY_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(duplicate),
  );

  const bytesOnlySwap = cloneInput(await baseInput());
  bytesOnlySwap.builds[0].bytes = Buffer.from(bytesOnlySwap.builds[1].bytes);
  assertContractError(
    candidate,
    "BUILD_OWNER_INVALID",
    () => candidate.createG17BenchmarkProductOwnerV4Artifact(bytesOnlySwap),
    { cause: true, phase: "build-owner-replay" },
  );

  const mixed = cloneInput(await baseInput());
  mixed.builds[2] = await createBuildInput(2, "s7-other");
  assertContractError(candidate, "IDENTITY_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(mixed),
  );

  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "builds", {
    enumerable: true,
    get() {
      reads += 1;
      return cloneInput(input).builds;
    },
  });
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(accessor),
  );
  assert.equal(reads, 0);
  let callbackCalls = 0;
  const callbackInput = cloneInput(await baseInput());
  callbackInput.sideEffect = () => {
    callbackCalls += 1;
  };
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(callbackInput),
  );
  assert.equal(callbackCalls, 0);
  let extraReads = 0;
  const extraAccessorInput = cloneInput(await baseInput());
  Object.defineProperty(extraAccessorInput, "sideEffect", {
    enumerable: true,
    get() {
      extraReads += 1;
      return () => {};
    },
  });
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(extraAccessorInput),
  );
  assert.equal(extraReads, 0);

  const sparse = cloneInput(await baseInput());
  delete sparse.builds[1];
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(sparse),
  );
  const extendedBuilds = cloneInput(await baseInput());
  extendedBuilds.builds.extra = true;
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(extendedBuilds),
  );
  const symbolBuilds = cloneInput(await baseInput());
  symbolBuilds.builds[Symbol("extra")] = true;
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(symbolBuilds),
  );
  const proxiedBuild = cloneInput(await baseInput());
  proxiedBuild.builds[0] = new Proxy(proxiedBuild.builds[0], {});
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(proxiedBuild),
  );
  let buildsProxyTraps = 0;
  const proxiedBuilds = cloneInput(await baseInput());
  proxiedBuilds.builds = new Proxy(proxiedBuilds.builds, {
    get() {
      buildsProxyTraps += 1;
      return undefined;
    },
    getOwnPropertyDescriptor() {
      buildsProxyTraps += 1;
      return undefined;
    },
    getPrototypeOf() {
      buildsProxyTraps += 1;
      return null;
    },
    ownKeys() {
      buildsProxyTraps += 1;
      return [];
    },
  });
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(proxiedBuilds),
  );
  assert.equal(buildsProxyTraps, 0);
  const bufferPrototypeDrift = cloneInput(await baseInput());
  Object.setPrototypeOf(
    bufferPrototypeDrift.builds[0].bytes,
    Uint8Array.prototype,
  );
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(bufferPrototypeDrift),
  );
  let nestedReads = 0;
  const nestedAccessor = cloneInput(await baseInput());
  Object.defineProperty(nestedAccessor.builds[0], "bytes", {
    enumerable: true,
    get() {
      nestedReads += 1;
      return Buffer.alloc(0);
    },
  });
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(nestedAccessor),
  );
  assert.equal(nestedReads, 0);
  let proxyTraps = 0;
  const proxiedInputTarget = cloneInput(await baseInput());
  const proxiedInput = new Proxy(proxiedInputTarget, {
    get(target, key, receiver) {
      proxyTraps += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      proxyTraps += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      proxyTraps += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      proxyTraps += 1;
      return Reflect.ownKeys(target);
    },
  });
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(proxiedInput),
  );
  assert.equal(proxyTraps, 0);
  const symbolInput = cloneInput(await baseInput());
  symbolInput[Symbol("extra")] = true;
  assertContractError(candidate, "INPUT_SHAPE_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(symbolInput),
  );

  const generationCollision = cloneInput(await baseInput());
  const collidingLifecycle =
    generationCollision.builds[0].fixture.identity.lifecycleGeneration;
  generationCollision.builds[1] = await remintBuildInput(
    generationCollision.builds[1],
    (fixture) => {
      fixture.identity.lifecycleGeneration = collidingLifecycle;
      fixture.observations.workspaceFinish.lifecycleGeneration =
        collidingLifecycle;
    },
  );
  assertContractError(candidate, "GENERATION_COLLISION", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(generationCollision),
  );
  const invalidBeforeCollision = cloneInput(generationCollision);
  invalidBeforeCollision.builds[0].bytes[0] ^= 1;
  assertContractError(
    candidate,
    "BUILD_OWNER_INVALID",
    () =>
      candidate.createG17BenchmarkProductOwnerV4Artifact(
        invalidBeforeCollision,
      ),
    { cause: true, phase: "build-owner-replay" },
  );
  const identityBeforeCollision = cloneInput(generationCollision);
  [identityBeforeCollision.builds[0], identityBeforeCollision.builds[1]] = [
    identityBeforeCollision.builds[1],
    identityBeforeCollision.builds[0],
  ];
  assertContractError(candidate, "IDENTITY_INVALID", () =>
    candidate.createG17BenchmarkProductOwnerV4Artifact(identityBeforeCollision),
  );

  const verificationBuilds = cloneInput(await baseInput()).builds;
  const assertResealedMutation = (code, mutate) => {
    const owner = clone(created.owner);
    mutate(owner);
    const changed = reseal(owner);
    assertContractError(candidate, code, () =>
      candidate.verifyG17BenchmarkProductOwnerV4Artifact({
        bytes: canonicalBytes(changed),
        builds: verificationBuilds,
      }),
    );
  };

  for (const mutate of [
    (owner) => {
      owner.builds[0].sourceProjection.rawSha256 = "0".repeat(64);
    },
    (owner) => {
      owner.builds[0].executionRequestV2.rawSha256 = "0".repeat(64);
    },
  ]) {
    assertResealedMutation("SOURCE_BINDING_DRIFT", mutate);
  }
  assertResealedMutation("AUTHORIZATION_BINDING_DRIFT", (owner) => {
    owner.bindings.authorization.rawSha256 = "0".repeat(64);
  });
  assertResealedMutation("EXECUTION_PLAN_BINDING_DRIFT", (owner) => {
    owner.bindings.executionPlan.sha256 = "0".repeat(64);
  });
  assertResealedMutation("PLATFORM_BINDING_DRIFT", (owner) => {
    owner.bindings.platform.platformRootSha256 = "0".repeat(64);
  });
  assertResealedMutation("TOOLCHAIN_BINDING_DRIFT", (owner) => {
    owner.bindings.toolchain.toolchainRootSha256 = "0".repeat(64);
  });

  for (const mutate of [
    (owner) => {
      owner.physicalOrigin = true;
    },
    (owner) => {
      owner.binding = {};
    },
    (owner) => {
      owner.finalDecisionEligible = true;
    },
    ...Object.keys(AUTHORITY).map((key) => (owner) => {
      owner.authority[key] = true;
    }),
    ...Object.keys(NONCLAIMS).map((key) => (owner) => {
      owner.nonclaims[key] = true;
    }),
  ]) {
    assertResealedMutation("AUTHORITY_OVERCLAIM", mutate);
  }

  const assertCombinedMutation = (
    code,
    mutations,
    builds = verificationBuilds,
  ) => {
    const owner = clone(created.owner);
    for (const mutate of mutations) mutate(owner);
    const changed = reseal(owner);
    assertContractError(candidate, code, () =>
      candidate.verifyG17BenchmarkProductOwnerV4Artifact({
        bytes: canonicalBytes(changed),
        builds,
      }),
    );
  };
  const wrongHashAndSchema = clone(created.owner);
  wrongHashAndSchema.schema = "wrong-schema";
  wrongHashAndSchema.contentHash = "0".repeat(64);
  assertContractError(candidate, "CONTENT_HASH_MISMATCH", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(wrongHashAndSchema),
      builds: verificationBuilds,
    }),
  );
  const invalidPredecessorBuilds = cloneInput(await baseInput()).builds;
  invalidPredecessorBuilds.pop();
  assertContractError(candidate, "CONTENT_HASH_MISMATCH", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(wrongHashAndSchema),
      builds: invalidPredecessorBuilds,
    }),
  );
  assertCombinedMutation(
    "IDENTITY_INVALID",
    [
      (owner) => {
        owner.schema = "wrong-schema";
      },
    ],
    invalidPredecessorBuilds,
  );
  assertCombinedMutation(
    "INPUT_SHAPE_INVALID",
    [
      (owner) => {
        owner.physicalOrigin = true;
      },
    ],
    invalidPredecessorBuilds,
  );
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: Buffer.alloc(MAX_BYTES + 1),
      builds: invalidPredecessorBuilds,
    }),
  );
  assertCombinedMutation("IDENTITY_INVALID", [
    (owner) => {
      owner.schema = "wrong-schema";
    },
    (owner) => {
      owner.builds[0].sourceProjection.rawSha256 = "0".repeat(64);
    },
  ]);
  assertCombinedMutation("AUTHORITY_OVERCLAIM", [
    (owner) => {
      owner.physicalOrigin = true;
    },
    (owner) => {
      owner.builds[0].sourceProjection.rawSha256 = "0".repeat(64);
    },
  ]);
  assertCombinedMutation("SOURCE_BINDING_DRIFT", [
    (owner) => {
      owner.builds[0].sourceProjection.rawSha256 = "0".repeat(64);
    },
    (owner) => {
      owner.bindings.authorization.rawSha256 = "0".repeat(64);
    },
  ]);
  assertCombinedMutation("AUTHORIZATION_BINDING_DRIFT", [
    (owner) => {
      owner.bindings.authorization.rawSha256 = "0".repeat(64);
    },
    (owner) => {
      owner.bindings.executionPlan.sha256 = "0".repeat(64);
    },
  ]);
  assertCombinedMutation("EXECUTION_PLAN_BINDING_DRIFT", [
    (owner) => {
      owner.bindings.executionPlan.sha256 = "0".repeat(64);
    },
    (owner) => {
      owner.bindings.platform.platformRootSha256 = "0".repeat(64);
    },
  ]);
  assertCombinedMutation("PLATFORM_BINDING_DRIFT", [
    (owner) => {
      owner.bindings.platform.platformRootSha256 = "0".repeat(64);
    },
    (owner) => {
      owner.bindings.toolchain.toolchainRootSha256 = "0".repeat(64);
    },
  ]);
  assertCombinedMutation("TOOLCHAIN_BINDING_DRIFT", [
    (owner) => {
      owner.bindings.toolchain.toolchainRootSha256 = "0".repeat(64);
    },
    (owner) => {
      owner.builds[0].target.executable.bytes += 1;
    },
  ]);
  for (const mutate of [
    (owner) => {
      delete owner.authority[Object.keys(AUTHORITY)[0]];
    },
    (owner) => {
      owner.authority.extraAuthority = false;
    },
    (owner) => {
      owner.authority = null;
    },
    (owner) => {
      delete owner.nonclaims[Object.keys(NONCLAIMS)[0]];
    },
    (owner) => {
      owner.nonclaims.extraNonclaim = false;
    },
    (owner) => {
      owner.nonclaims = null;
    },
  ]) {
    assertResealedMutation("AUTHORITY_OVERCLAIM", mutate);
  }

  const wrongHash = { ...clone(created.owner), contentHash: "0".repeat(64) };
  assertContractError(candidate, "CONTENT_HASH_MISMATCH", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(wrongHash),
      builds: verificationBuilds,
    }),
  );

  assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: Buffer.from(`${JSON.stringify(created.owner, null, 2)}\n`, "utf8"),
      builds: verificationBuilds,
    }),
  );
  assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: Buffer.from([0xff, 0x0a]),
      builds: verificationBuilds,
    }),
  );
  assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: Buffer.concat([secondBytes, Buffer.from("\n", "utf8")]),
      builds: verificationBuilds,
    }),
  );
  assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(null),
      builds: verificationBuilds,
    }),
  );
  for (const invalidRoot of [false, 1, "root", []]) {
    assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
      candidate.verifyG17BenchmarkProductOwnerV4Artifact({
        bytes: canonicalBytes(invalidRoot),
        builds: verificationBuilds,
      }),
    );
  }
  for (const malformedBytes of [
    Buffer.from(canonicalJson(created.owner), "utf8"),
    Buffer.from(` ${canonicalJson(created.owner)}\n`, "utf8"),
    Buffer.from(`${canonicalJson(created.owner)}\r\n`, "utf8"),
    Buffer.from(
      `{"schema":"${OWNER_SCHEMA}","schema":"${OWNER_SCHEMA}"}\n`,
      "utf8",
    ),
  ]) {
    assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
      candidate.verifyG17BenchmarkProductOwnerV4Artifact({
        bytes: malformedBytes,
        builds: verificationBuilds,
      }),
    );
  }
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: Buffer.alloc(MAX_BYTES + 1),
      builds: invalidPredecessorBuilds,
    }),
  );

  for (const mutate of [
    (owner) => {
      owner.bindings = null;
    },
    (owner) => {
      owner.builds[0] = null;
    },
    (owner) => {
      owner.builds[0].generations = null;
    },
  ]) {
    assertResealedMutation("IDENTITY_INVALID", mutate);
  }

  const fewerForPrecedence = cloneInput(await baseInput());
  fewerForPrecedence.builds.pop();
  assertContractError(candidate, "CANONICAL_ARTIFACT_INVALID", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: Buffer.from([0xff, 0x0a]),
      builds: fewerForPrecedence.builds,
    }),
  );

  const deepOwner = clone(created.owner);
  let deepCursor = deepOwner;
  for (let depth = 0; depth < LIMITS.maximumDepth + 2; depth += 1) {
    deepCursor.extra = {};
    deepCursor = deepCursor.extra;
  }
  const deepSealed = reseal(deepOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(deepSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const mixedDepthOwner = clone(created.owner);
  let mixedDepthCursor = mixedDepthOwner;
  for (let depth = 0; depth < LIMITS.maximumDepth + 2; depth += 1) {
    if (depth % 2 === 0) {
      mixedDepthCursor[`branch${depth}`] = [{}];
      mixedDepthCursor = mixedDepthCursor[`branch${depth}`][0];
    } else {
      mixedDepthCursor[`leaf${depth}`] = {};
      mixedDepthCursor = mixedDepthCursor[`leaf${depth}`];
    }
  }
  const mixedDepthSealed = reseal(mixedDepthOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(mixedDepthSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const wideOwner = clone(created.owner);
  wideOwner.extra = Array.from(
    { length: LIMITS.maximumArrayLength + 1 },
    () => null,
  );
  const wideSealed = reseal(wideOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(wideSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const longStringOwner = clone(created.owner);
  longStringOwner.extra = "x".repeat(LIMITS.singleStringUtf8MaximumBytes + 1);
  const longStringSealed = reseal(longStringOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(longStringSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const longKeyOwner = clone(created.owner);
  longKeyOwner["k".repeat(LIMITS.singleStringUtf8MaximumBytes + 1)] = null;
  const longKeySealed = reseal(longKeyOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(longKeySealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const tooManyPropertiesOwner = clone(created.owner);
  tooManyPropertiesOwner.extra = Object.fromEntries(
    Array.from(
      { length: LIMITS.maximumPropertiesPerRecord + 1 },
      (_unused, index) => [`p${index}`, null],
    ),
  );
  const tooManyPropertiesSealed = reseal(tooManyPropertiesOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(tooManyPropertiesSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const tooManyNodesOwner = clone(created.owner);
  tooManyNodesOwner.extra = Object.fromEntries(
    Array.from({ length: 4_096 }, (_unused, index) => [
      `n${index}`,
      Array.from({ length: 25 }, () => ({})),
    ]),
  );
  const tooManyNodesSealed = reseal(tooManyNodesOwner);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(tooManyNodesSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const aggregateStringsOwner = clone(created.owner);
  aggregateStringsOwner.extra = Array.from({ length: 3 }, () =>
    "x".repeat(768 * 1024),
  );
  const aggregateStringsSealed = reseal(aggregateStringsOwner);
  assert.equal(canonicalBytes(aggregateStringsSealed).length < MAX_BYTES, true);
  assertContractError(candidate, "LIMIT_EXCEEDED", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(aggregateStringsSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  const highFanoutOwner = clone(created.owner);
  highFanoutOwner["q".repeat(512 * 1024)] = Array.from(
    { length: 2_048 },
    () => null,
  );
  const highFanoutSealed = reseal(highFanoutOwner);
  assert.equal(canonicalBytes(highFanoutSealed).length < MAX_BYTES, true);
  assertContractError(candidate, "IDENTITY_INVALID", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: canonicalBytes(highFanoutSealed),
      builds: invalidPredecessorBuilds,
    }),
  );

  assertResealedMutation("EXPECTED_INPUT_MISMATCH", (owner) => {
    owner.builds[0].target.executable.bytes += 1;
  });

  const otherInput = await createProductInput("s7-replay-other");
  assertContractError(candidate, "SOURCE_BINDING_DRIFT", () =>
    candidate.verifyG17BenchmarkProductOwnerV4Artifact({
      bytes: secondBytes,
      builds: otherInput.builds,
    }),
  );
  assert.deepEqual(
    [...observedContractErrorCodes.get(candidate)].sort(),
    [...ERROR_CODES].sort(),
  );
}

function parseCandidateSource(source) {
  preflightCandidateModuleTokens(source);
  return parse(source, ACORN_PARSE_OPTIONS);
}

function walkAst(value, visit, parent = null, ancestors = []) {
  const stack = [{ value, parent, ancestors }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.value === null || typeof current.value !== "object") continue;
    assert.equal(
      current.ancestors.length <= MAX_CANDIDATE_AST_DEPTH,
      true,
      "candidate AST depth exceeds bound",
    );
    if (typeof current.value.type === "string") {
      visit(current.value, current.parent, current.ancestors);
    }
    const childAncestors = [...current.ancestors, current.value];
    const children = [];
    for (const child of Object.values(current.value)) {
      if (Array.isArray(child)) children.push(...child);
      else children.push(child);
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        value: children[index],
        parent: current.value,
        ancestors: childAncestors,
      });
    }
  }
}

function importBindings(program) {
  return program.body
    .filter((node) => node.type === "ImportDeclaration")
    .flatMap((declaration) =>
      declaration.specifiers.map((specifier) => {
        assert.equal(specifier.type, "ImportSpecifier");
        assert.equal(specifier.imported.type, "Identifier");
        assert.equal(specifier.local.type, "Identifier");
        return `${declaration.source.value}:${specifier.imported.name}:${specifier.local.name}`;
      }),
    )
    .sort();
}

function patternNames(pattern, names = []) {
  if (pattern === null) return names;
  if (pattern.type === "Identifier") names.push(pattern.name);
  else if (pattern.type === "RestElement")
    patternNames(pattern.argument, names);
  else if (pattern.type === "AssignmentPattern")
    patternNames(pattern.left, names);
  else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) patternNames(element, names);
  } else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      patternNames(
        property.type === "RestElement" ? property.argument : property.value,
        names,
      );
    }
  }
  return names;
}

function declaredNames(node) {
  if (node.type === "VariableDeclarator") return patternNames(node.id);
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    const names = node.id === null ? [] : [node.id.name];
    for (const parameter of node.params) patternNames(parameter, names);
    return names;
  }
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    return node.id === null ? [] : [node.id.name];
  }
  if (node.type === "CatchClause") return patternNames(node.param);
  return [];
}

function memberRoot(member) {
  let root = member;
  while (root?.type === "MemberExpression") root = root.object;
  return root;
}

function memberPropertyName(member) {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (
    member.computed &&
    member.property.type === "Literal" &&
    typeof member.property.value === "string"
  ) {
    return member.property.value;
  }
  return null;
}

function isMutationTarget(node, parent) {
  return (
    (parent?.type === "AssignmentExpression" && parent.left === node) ||
    (parent?.type === "UpdateExpression" && parent.argument === node) ||
    (parent?.type === "UnaryExpression" &&
      parent.operator === "delete" &&
      parent.argument === node)
  );
}

function buildCandidateLexicalScopes(program) {
  const scopeForNode = new WeakMap();
  const declarationIdentifiers = new WeakSet();
  const moduleScope = {
    parent: null,
    functionScope: true,
    bindings: new Set(),
  };
  const childScope = (parent, functionScope = false) => ({
    parent,
    functionScope,
    bindings: new Set(),
  });
  const nearestFunctionScope = (scope) => {
    let current = scope;
    while (!current.functionScope) current = current.parent;
    return current;
  };
  const declarePattern = (pattern, scope) => {
    if (pattern === null) return;
    if (pattern.type === "Identifier") {
      declarationIdentifiers.add(pattern);
      scope.bindings.add(pattern.name);
    } else if (pattern.type === "RestElement") {
      declarePattern(pattern.argument, scope);
    } else if (pattern.type === "AssignmentPattern") {
      declarePattern(pattern.left, scope);
    } else if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) declarePattern(element, scope);
    } else if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        declarePattern(
          property.type === "RestElement" ? property.argument : property.value,
          scope,
        );
      }
    }
  };
  const children = (node) =>
    Object.values(node).flatMap((value) => {
      if (Array.isArray(value)) {
        return value.filter(
          (child) => child !== null && typeof child?.type === "string",
        );
      }
      return value !== null && typeof value?.type === "string" ? [value] : [];
    });
  const build = (node, scope) => {
    scopeForNode.set(node, scope);
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        declarationIdentifiers.add(specifier.local);
        scope.bindings.add(specifier.local.name);
      }
      for (const child of children(node)) scopeForNode.set(child, scope);
      return;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      if (node.type === "FunctionDeclaration" && node.id !== null) {
        declarationIdentifiers.add(node.id);
        scope.bindings.add(node.id.name);
      }
      const functionScope = childScope(scope, true);
      if (node.id !== null) {
        declarationIdentifiers.add(node.id);
        functionScope.bindings.add(node.id.name);
      }
      for (const parameter of node.params) {
        declarePattern(parameter, functionScope);
      }
      if (node.id !== null) {
        scopeForNode.set(
          node.id,
          node.type === "FunctionDeclaration" ? scope : functionScope,
        );
      }
      for (const parameter of node.params) build(parameter, functionScope);
      build(node.body, functionScope);
      return;
    }
    if (node.type === "ClassDeclaration") {
      if (node.id !== null) {
        declarationIdentifiers.add(node.id);
        scope.bindings.add(node.id.name);
      }
    }
    if (node.type === "VariableDeclaration") {
      const target = node.kind === "var" ? nearestFunctionScope(scope) : scope;
      for (const declaration of node.declarations) {
        declarePattern(declaration.id, target);
      }
    }
    if (node.type === "CatchClause") {
      const catchScope = childScope(scope);
      declarePattern(node.param, catchScope);
      if (node.param !== null) build(node.param, catchScope);
      build(node.body, catchScope);
      return;
    }
    if (node.type === "BlockStatement" && node !== program) {
      const blockScope = childScope(scope);
      for (const child of node.body) build(child, blockScope);
      return;
    }
    if (
      node.type === "ForStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement"
    ) {
      const loopScope = childScope(scope);
      for (const child of children(node)) build(child, loopScope);
      return;
    }
    for (const child of children(node)) build(child, scope);
  };
  build(program, moduleScope);
  const resolves = (identifier) => {
    let scope = scopeForNode.get(identifier);
    while (scope !== null && scope !== undefined) {
      if (scope.bindings.has(identifier.name)) return true;
      scope = scope.parent;
    }
    return false;
  };
  const isReference = (identifier, parent) => {
    if (declarationIdentifiers.has(identifier)) return false;
    if (
      parent?.type === "MemberExpression" &&
      parent.property === identifier &&
      !parent.computed
    ) {
      return false;
    }
    if (
      (parent?.type === "Property" || parent?.type === "MethodDefinition") &&
      parent.key === identifier &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return false;
    }
    return true;
  };
  return Object.freeze({ isReference, resolves });
}

function assertSafeModuleInitializer(
  node,
  safeBindings,
  { ownedFrozenLiteral = false } = {},
) {
  if (node.type === "Literal") {
    if (node.regex !== undefined) {
      assert.equal(/[gy]/u.test(node.regex.flags), false);
    }
    return;
  }
  if (node.type === "Identifier") {
    assert.equal(
      node.name === "undefined" || safeBindings.has(node.name),
      true,
      `module initializer binding ${node.name} is not admitted`,
    );
    return;
  }
  if (node.type === "ArrayExpression") {
    assert.equal(
      ownedFrozenLiteral,
      true,
      "module initializer arrays must be directly frozen",
    );
    for (const element of node.elements) {
      assert.notEqual(element, null, "module initializer arrays must be dense");
      assert.notEqual(
        element.type,
        "SpreadElement",
        "module initializer spreads are forbidden",
      );
      assertSafeModuleInitializer(element, safeBindings);
    }
    return;
  }
  if (node.type === "ObjectExpression") {
    assert.equal(
      ownedFrozenLiteral,
      true,
      "module initializer records must be directly frozen",
    );
    for (const property of node.properties) {
      assert.equal(property.type, "Property");
      assert.equal(property.kind, "init");
      assert.equal(property.method, false);
      assert.equal(property.computed, false);
      assertSafeModuleInitializer(property.value, safeBindings);
    }
    return;
  }
  if (
    node.type === "UnaryExpression" &&
    ["!", "+", "-"].includes(node.operator)
  ) {
    assertSafeModuleInitializer(node.argument, safeBindings);
    return;
  }
  if (node.type === "TemplateLiteral") {
    assert.equal(node.expressions.length, 0);
    return;
  }
  if (node.type === "MemberExpression") {
    assert.equal(node.optional, false);
    assert.equal(node.object.type === "Identifier", true);
    assert.equal(safeBindings.has(node.object.name), true);
    assert.equal(
      !node.computed ||
        (node.property.type === "Literal" &&
          Number.isSafeInteger(node.property.value) &&
          node.property.value >= 0),
      true,
    );
    return;
  }
  if (node.type === "CallExpression") {
    assert.equal(node.optional, false);
    assert.equal(node.callee.type, "MemberExpression");
    assert.equal(node.callee.computed, false);
    assert.equal(node.callee.object.type, "Identifier");
    assert.equal(node.callee.object.name, "Object");
    assert.equal(memberPropertyName(node.callee), "freeze");
    assert.equal(node.arguments.length, 1);
    assert.equal(
      ["ArrayExpression", "ObjectExpression"].includes(node.arguments[0].type),
      true,
      "Object.freeze module initializers must own their literal input",
    );
    assertSafeModuleInitializer(node.arguments[0], safeBindings, {
      ownedFrozenLiteral: true,
    });
    return;
  }
  assert.fail(`module initializer ${node.type} is not admitted`);
}

function assertCandidateModuleSurface(program, source) {
  const imports = program.body.filter(
    (node) => node.type === "ImportDeclaration",
  );
  assert.equal(imports.length, EXPECTED_IMPORT_SOURCES.length);
  assert.deepEqual(
    imports.map((node) => node.source.value).sort(),
    [...EXPECTED_IMPORT_SOURCES].sort(),
  );
  for (const declaration of imports) {
    assert.equal(
      declaration.specifiers.length > 0,
      true,
      "side-effect and empty imports are forbidden",
    );
  }
  const safeBindings = new Set(
    imports.flatMap((declaration) =>
      declaration.specifiers.map((specifier) => specifier.local.name),
    ),
  );
  for (const node of program.body) {
    if (node.type === "ImportDeclaration") continue;
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (node.type === "ExportNamedDeclaration") {
      assert.equal(node.source, null, "candidate source may not re-export");
      assert.equal(node.specifiers.length, 0, "exports must be direct");
      assert.notEqual(declaration, null, "export declaration is absent");
    }
    assert.equal(
      declaration.type === "FunctionDeclaration" ||
        declaration.type === "ClassDeclaration" ||
        (declaration.type === "VariableDeclaration" &&
          declaration.kind === "const"),
      true,
      `forbidden module-level statement ${node.type}`,
    );
    if (declaration.type === "VariableDeclaration") {
      assert.equal(declaration.declarations.length, 1);
      const [entry] = declaration.declarations;
      assert.equal(entry.id.type, "Identifier");
      assert.notEqual(entry.init, null);
      assertSafeModuleInitializer(entry.init, safeBindings);
      safeBindings.add(entry.id.name);
    }
    if (declaration.type === "ClassDeclaration") {
      assert.equal(
        declaration.id?.name,
        "G17BenchmarkProductOwnerV4ContractError",
      );
      assert.equal(declaration.superClass?.type, "Identifier");
      assert.equal(declaration.superClass.name, "Error");
      assert.equal(declaration.body.body.length, 1);
      for (const method of declaration.body.body) {
        assert.equal(method.type, "MethodDefinition");
        assert.equal(method.computed, false);
        assert.equal(method.static, false);
        assert.equal(method.key.type, "Identifier");
        assert.equal(method.key.name, "constructor");
        assert.equal(method.kind, "constructor");
        assert.equal(method.value.params.length, 4);
        assert.deepEqual(
          method.value.params.slice(0, 3).map((parameter) => {
            assert.equal(parameter.type, "Identifier");
            return parameter.name;
          }),
          ["code", "phase", "message"],
        );
        assert.equal(method.value.params[3].type, "RestElement");
        assert.equal(method.value.params[3].argument.type, "Identifier");
        assert.equal(method.value.params[3].argument.name, "options");
        assert.equal(method.value.body.body.length, 6);
        const [
          codeGuard,
          fieldGuard,
          superStatement,
          nameStatement,
          codeStatement,
          phaseStatement,
        ] = method.value.body.body;
        assert.equal(codeGuard.type, "IfStatement");
        assert.equal(codeGuard.alternate, null);
        assert.equal(codeGuard.test.type, "UnaryExpression");
        assert.equal(codeGuard.test.operator, "!");
        assert.equal(codeGuard.test.argument.type, "CallExpression");
        assert.equal(codeGuard.test.argument.callee.type, "MemberExpression");
        assert.equal(codeGuard.test.argument.callee.computed, false);
        assert.equal(codeGuard.test.argument.callee.object.type, "Identifier");
        assert.equal(
          codeGuard.test.argument.callee.object.name,
          "G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES",
        );
        assert.equal(
          memberPropertyName(codeGuard.test.argument.callee),
          "includes",
        );
        assert.deepEqual(
          codeGuard.test.argument.arguments.map((argument) => {
            assert.equal(argument.type, "Identifier");
            return argument.name;
          }),
          ["code"],
        );
        assert.equal(codeGuard.consequent.type, "BlockStatement");
        assert.equal(codeGuard.consequent.body.length, 1);
        assert.equal(codeGuard.consequent.body[0].type, "ThrowStatement");
        assert.equal(
          codeGuard.consequent.body[0].argument.type,
          "NewExpression",
        );
        assert.equal(
          codeGuard.consequent.body[0].argument.callee.type,
          "Identifier",
        );
        assert.equal(
          codeGuard.consequent.body[0].argument.callee.name,
          "TypeError",
        );
        assert.equal(fieldGuard.type, "IfStatement");
        assert.equal(fieldGuard.alternate, null);
        assert.equal(fieldGuard.test.type, "LogicalExpression");
        assert.equal(fieldGuard.test.operator, "||");
        for (const [test, parameterName] of [
          [fieldGuard.test.left, "phase"],
          [fieldGuard.test.right, "message"],
        ]) {
          assert.equal(test.type, "BinaryExpression");
          assert.equal(test.operator, "!==");
          assert.equal(test.left.type, "UnaryExpression");
          assert.equal(test.left.operator, "typeof");
          assert.equal(test.left.argument.type, "Identifier");
          assert.equal(test.left.argument.name, parameterName);
          assert.equal(test.right.type, "Literal");
          assert.equal(test.right.value, "string");
        }
        assert.equal(fieldGuard.consequent.type, "BlockStatement");
        assert.equal(fieldGuard.consequent.body.length, 1);
        assert.equal(fieldGuard.consequent.body[0].type, "ThrowStatement");
        assert.equal(
          fieldGuard.consequent.body[0].argument.type,
          "NewExpression",
        );
        assert.equal(
          fieldGuard.consequent.body[0].argument.callee.type,
          "Identifier",
        );
        assert.equal(
          fieldGuard.consequent.body[0].argument.callee.name,
          "TypeError",
        );
        assert.equal(superStatement.type, "ExpressionStatement");
        assert.equal(superStatement.expression.type, "CallExpression");
        assert.equal(superStatement.expression.callee.type, "Super");
        assert.equal(superStatement.expression.arguments.length, 2);
        assert.equal(
          source.slice(
            superStatement.expression.start,
            superStatement.expression.end,
          ),
          'super("G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message, options[0])',
          "error constructor super call must equal the pinned message and options expression",
        );
        assert.equal(
          superStatement.expression.arguments[0].type,
          "BinaryExpression",
        );
        assert.equal(
          superStatement.expression.arguments[1].type,
          "MemberExpression",
        );
        assert.equal(superStatement.expression.arguments[1].computed, true);
        assert.equal(
          superStatement.expression.arguments[1].object.type,
          "Identifier",
        );
        assert.equal(
          superStatement.expression.arguments[1].object.name,
          "options",
        );
        assert.equal(
          superStatement.expression.arguments[1].property.type,
          "Literal",
        );
        assert.equal(superStatement.expression.arguments[1].property.value, 0);
        const admittedOptionsIdentifiers = new Set([
          superStatement.expression.arguments[1].object,
        ]);
        const observedOptionsIdentifiers = [];
        walkAst(method.value.body, (candidate) => {
          if (candidate.type === "Identifier" && candidate.name === "options") {
            observedOptionsIdentifiers.push(candidate);
            assert.equal(
              admittedOptionsIdentifiers.has(candidate),
              true,
              "error constructor options may only supply the super options argument",
            );
          }
        });
        assert.equal(observedOptionsIdentifiers.length, 1);
        for (const [statement, property, rightType, rightValue] of [
          [
            nameStatement,
            "name",
            "Literal",
            "G17BenchmarkProductOwnerV4ContractError",
          ],
          [codeStatement, "code", "Identifier", "code"],
          [phaseStatement, "phase", "Identifier", "phase"],
        ]) {
          assert.equal(statement.type, "ExpressionStatement");
          assert.equal(statement.expression.type, "AssignmentExpression");
          assert.equal(statement.expression.operator, "=");
          assert.equal(statement.expression.left.type, "MemberExpression");
          assert.equal(statement.expression.left.computed, false);
          assert.equal(statement.expression.left.object.type, "ThisExpression");
          assert.equal(memberPropertyName(statement.expression.left), property);
          assert.equal(statement.expression.right.type, rightType);
          if (rightType === "Identifier") {
            assert.equal(statement.expression.right.name, rightValue);
          } else {
            assert.equal(statement.expression.right.value, rightValue);
          }
        }
      }
    }
  }
}

function literalExports(program) {
  const names = new Set();
  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    assert.equal(node.source, null, "candidate source may not re-export");
    assert.equal(node.specifiers.length, 0, "candidate exports must be direct");
    const declaration = node.declaration;
    assert.notEqual(
      declaration,
      null,
      "candidate export declaration is absent",
    );
    if (declaration.type === "VariableDeclaration") {
      assert.equal(declaration.kind, "const");
      for (const entry of declaration.declarations) {
        assert.equal(entry.id.type, "Identifier");
        names.add(entry.id.name);
      }
    } else {
      assert.equal(
        declaration.type === "ClassDeclaration" ||
          declaration.type === "FunctionDeclaration",
        true,
      );
      names.add(declaration.id.name);
    }
  }
  return [...names].sort();
}

function assertCandidateSourceStructure(source) {
  assert.equal(
    Buffer.byteLength(source, "utf8") <= MAX_CANDIDATE_SOURCE_BYTES,
    true,
    "candidate source exceeds bound",
  );
  const program = parseCandidateSource(source);
  walkAst(program, () => {});
  assertCandidateModuleSurface(program, source);
  assert.deepEqual(importBindings(program), EXPECTED_IMPORT_BINDINGS);
  assert.deepEqual(literalExports(program), [...EXPECTED_EXPORTS].sort());
  const lexical = buildCandidateLexicalScopes(program);
  const moduleReadOnlyDeclarations = new Map();
  const moduleFunctionBindings = new Set();
  const moduleClassBindings = new Set();
  const moduleRegexBindings = new Set();
  for (const node of program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type === "VariableDeclaration") {
      for (const entry of declaration.declarations) {
        assert.equal(entry.id.type, "Identifier");
        moduleReadOnlyDeclarations.set(entry.id.name, entry);
        if (entry.init?.type === "Literal" && entry.init.regex !== undefined) {
          moduleRegexBindings.add(entry.id.name);
        }
      }
    } else if (
      declaration?.type === "FunctionDeclaration" ||
      declaration?.type === "ClassDeclaration"
    ) {
      moduleReadOnlyDeclarations.set(declaration.id.name, declaration);
      if (declaration.type === "FunctionDeclaration") {
        moduleFunctionBindings.add(declaration.id.name);
      } else {
        moduleClassBindings.add(declaration.id.name);
      }
    }
  }
  const moduleReadOnlyBindings = new Set(moduleReadOnlyDeclarations.keys());
  const assertLeadingProxyRejection = (declaration, parameterName) => {
    assert.equal(declaration.body.body.length > 0, true);
    const [statement] = declaration.body.body;
    assert.equal(statement.type, "IfStatement");
    assert.equal(statement.alternate, null);
    assert.equal(statement.test.type, "CallExpression");
    assert.equal(statement.test.callee.type, "MemberExpression");
    assert.equal(statement.test.callee.computed, false);
    assert.equal(statement.test.callee.object.type, "Identifier");
    assert.equal(statement.test.callee.object.name, "types");
    assert.equal(memberPropertyName(statement.test.callee), "isProxy");
    assert.equal(statement.test.arguments.length, 1);
    assert.equal(statement.test.arguments[0].type, "Identifier");
    assert.equal(statement.test.arguments[0].name, parameterName);
    assert.equal(statement.consequent.type, "BlockStatement");
    assert.equal(statement.consequent.body.length, 1);
    const [failureStatement] = statement.consequent.body;
    assert.equal(failureStatement.type, "ExpressionStatement");
    assert.equal(failureStatement.expression.type, "CallExpression");
    assert.equal(failureStatement.expression.callee.type, "Identifier");
    assert.equal(failureStatement.expression.callee.name, "fail");
  };
  const normalizationDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" &&
      node.id?.name === "normalizeBuilds",
  );
  assert.equal(normalizationDeclarations.length, 1);
  const normalizationDeclaration = normalizationDeclarations[0];
  assert.equal(normalizationDeclaration.params.length, 1);
  assert.equal(normalizationDeclaration.params[0].type, "Identifier");
  assert.equal(normalizationDeclaration.params[0].name, "builds");
  const canonicalBytesDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "canonicalBytes",
  );
  assert.equal(canonicalBytesDeclarations.length, 1);
  const canonicalBytesDeclaration = canonicalBytesDeclarations[0];
  assert.equal(
    source.slice(
      canonicalBytesDeclaration.start,
      canonicalBytesDeclaration.end,
    ),
    PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE,
    "canonicalBytes must equal the pinned canonical-JSON-plus-LF helper",
  );
  const ownerContentHashDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" &&
      node.id?.name === "ownerContentHash",
  );
  assert.equal(ownerContentHashDeclarations.length, 1);
  const [ownerContentHashDeclaration] = ownerContentHashDeclarations;
  assert.equal(
    source.slice(
      ownerContentHashDeclaration.start,
      ownerContentHashDeclaration.end,
    ),
    PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE,
    "ownerContentHash must equal the pinned canonical SHA-256 helper",
  );
  const snapshotDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "snapshotBuilds",
  );
  assert.equal(snapshotDeclarations.length, 1);
  const snapshotDeclaration = snapshotDeclarations[0];
  assert.equal(snapshotDeclaration.params.length, 1);
  assert.equal(snapshotDeclaration.params[0].type, "Identifier");
  assert.equal(snapshotDeclaration.params[0].name, "builds");
  assert.equal(
    source.slice(snapshotDeclaration.start, snapshotDeclaration.end),
    PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE,
    "snapshotBuilds must equal the pinned dense four-build helper",
  );
  const snapshotBuildDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "snapshotBuild",
  );
  assert.equal(snapshotBuildDeclarations.length, 1);
  const snapshotBuildDeclaration = snapshotBuildDeclarations[0];
  assert.equal(snapshotBuildDeclaration.params.length, 2);
  assert.equal(snapshotBuildDeclaration.params[0].type, "Identifier");
  assert.equal(snapshotBuildDeclaration.params[0].name, "descriptor");
  assert.equal(snapshotBuildDeclaration.params[1].type, "Identifier");
  assert.equal(snapshotBuildDeclaration.params[1].name, "index");
  const validateBuildDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "validateBuild",
  );
  assert.equal(validateBuildDeclarations.length, 1);
  const validateBuildDeclaration = validateBuildDeclarations[0];
  assert.equal(validateBuildDeclaration.params.length, 2);
  assert.equal(validateBuildDeclaration.params[0].type, "Identifier");
  assert.equal(validateBuildDeclaration.params[0].name, "value");
  assert.equal(validateBuildDeclaration.params[1].type, "Identifier");
  assert.equal(validateBuildDeclaration.params[1].name, "index");
  const snapshotBuildBody = snapshotBuildDeclaration.body.body;
  assert.equal(snapshotBuildBody.length, 5);
  const [
    valueStatement,
    validationStatement,
    bytesStatement,
    fixtureStatement,
    snapshotBuildReturn,
  ] = snapshotBuildBody;
  assert.equal(valueStatement.type, "VariableDeclaration");
  assert.equal(valueStatement.kind, "const");
  assert.equal(valueStatement.declarations.length, 1);
  const valueDeclaration = valueStatement.declarations[0];
  assert.equal(valueDeclaration.id.type, "Identifier");
  assert.equal(valueDeclaration.id.name, "value");
  assert.equal(valueDeclaration.init?.type, "MemberExpression");
  assert.equal(valueDeclaration.init.computed, false);
  assert.equal(valueDeclaration.init.object.type, "Identifier");
  assert.equal(valueDeclaration.init.object.name, "descriptor");
  assert.equal(memberPropertyName(valueDeclaration.init), "value");
  assert.equal(validationStatement.type, "ExpressionStatement");
  assert.equal(validationStatement.expression.type, "CallExpression");
  assert.equal(validationStatement.expression.callee.type, "Identifier");
  assert.equal(validationStatement.expression.callee.name, "validateBuild");
  assert.equal(validationStatement.expression.arguments.length, 2);
  assert.equal(validationStatement.expression.arguments[0].type, "Identifier");
  assert.equal(validationStatement.expression.arguments[0].name, "value");
  assert.equal(validationStatement.expression.arguments[1].type, "Identifier");
  assert.equal(validationStatement.expression.arguments[1].name, "index");
  assert.equal(bytesStatement.type, "VariableDeclaration");
  assert.equal(bytesStatement.kind, "const");
  assert.equal(bytesStatement.declarations.length, 1);
  const bytesDeclaration = bytesStatement.declarations[0];
  assert.equal(bytesDeclaration.id.type, "Identifier");
  assert.equal(bytesDeclaration.id.name, "bytes");
  assert.equal(bytesDeclaration.init?.type, "CallExpression");
  assert.equal(bytesDeclaration.init.callee.type, "MemberExpression");
  assert.equal(bytesDeclaration.init.callee.computed, false);
  assert.equal(bytesDeclaration.init.callee.object.type, "Identifier");
  assert.equal(bytesDeclaration.init.callee.object.name, "Buffer");
  assert.equal(memberPropertyName(bytesDeclaration.init.callee), "from");
  assert.equal(bytesDeclaration.init.arguments.length, 1);
  assert.equal(bytesDeclaration.init.arguments[0].type, "MemberExpression");
  assert.equal(bytesDeclaration.init.arguments[0].computed, false);
  assert.equal(bytesDeclaration.init.arguments[0].object.type, "Identifier");
  assert.equal(bytesDeclaration.init.arguments[0].object.name, "value");
  assert.equal(memberPropertyName(bytesDeclaration.init.arguments[0]), "bytes");
  assert.equal(fixtureStatement.type, "VariableDeclaration");
  assert.equal(fixtureStatement.kind, "const");
  assert.equal(fixtureStatement.declarations.length, 1);
  const fixtureDeclaration = fixtureStatement.declarations[0];
  assert.equal(fixtureDeclaration.id.type, "Identifier");
  assert.equal(fixtureDeclaration.id.name, "fixture");
  assert.equal(fixtureDeclaration.init?.type, "MemberExpression");
  assert.equal(fixtureDeclaration.init.computed, false);
  assert.equal(fixtureDeclaration.init.object.type, "Identifier");
  assert.equal(fixtureDeclaration.init.object.name, "value");
  assert.equal(memberPropertyName(fixtureDeclaration.init), "fixture");
  assert.equal(snapshotBuildReturn.type, "ReturnStatement");
  assert.equal(snapshotBuildReturn.argument?.type, "CallExpression");
  assert.equal(snapshotBuildReturn.argument.callee.type, "MemberExpression");
  assert.equal(snapshotBuildReturn.argument.callee.computed, false);
  assert.equal(snapshotBuildReturn.argument.callee.object.type, "Identifier");
  assert.equal(snapshotBuildReturn.argument.callee.object.name, "Object");
  assert.equal(
    memberPropertyName(snapshotBuildReturn.argument.callee),
    "freeze",
  );
  assert.equal(snapshotBuildReturn.argument.arguments.length, 1);
  assert.equal(
    snapshotBuildReturn.argument.arguments[0].type,
    "ObjectExpression",
  );
  assert.deepEqual(
    snapshotBuildReturn.argument.arguments[0].properties.map((property) => {
      assert.equal(property.type, "Property");
      assert.equal(property.kind, "init");
      assert.equal(property.computed, false);
      assert.equal(property.shorthand, true);
      assert.equal(property.key.type, "Identifier");
      assert.equal(property.value.type, "Identifier");
      assert.equal(property.key.name, property.value.name);
      return property.key.name;
    }),
    ["bytes", "fixture"],
  );
  const descriptorDeclarations = snapshotDeclaration.body.body
    .filter(
      (statement) =>
        statement.type === "VariableDeclaration" && statement.kind === "const",
    )
    .flatMap((statement) => statement.declarations)
    .filter(
      (declaration) =>
        declaration.id.type === "Identifier" &&
        declaration.id.name === "descriptors",
    );
  assert.equal(descriptorDeclarations.length, 1);
  const descriptorDeclaration = descriptorDeclarations[0];
  assert.equal(descriptorDeclaration.init?.type, "CallExpression");
  assert.equal(descriptorDeclaration.init.callee.type, "MemberExpression");
  assert.equal(descriptorDeclaration.init.callee.computed, false);
  assert.equal(descriptorDeclaration.init.callee.object.type, "Identifier");
  assert.equal(descriptorDeclaration.init.callee.object.name, "Object");
  assert.equal(
    memberPropertyName(descriptorDeclaration.init.callee),
    "getOwnPropertyDescriptors",
  );
  assert.equal(descriptorDeclaration.init.arguments.length, 1);
  assert.equal(descriptorDeclaration.init.arguments[0].type, "Identifier");
  assert.equal(descriptorDeclaration.init.arguments[0].name, "builds");
  const snapshotReturn = snapshotDeclaration.body.body.at(-1);
  assert.equal(snapshotReturn?.type, "ReturnStatement");
  const snapshotBoundaries = [];
  const snapshotNestedFunctions = [];
  walkAst(snapshotDeclaration.body, (node) => {
    if (
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression",
      ].includes(node.type)
    ) {
      snapshotNestedFunctions.push(node);
    }
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") {
      snapshotBoundaries.push(node);
    }
  });
  assert.deepEqual(snapshotNestedFunctions, []);
  assert.equal(snapshotBoundaries.length, 1);
  assert.equal(snapshotBoundaries[0], snapshotReturn);
  assert.equal(snapshotReturn.argument?.type, "CallExpression");
  assert.equal(snapshotReturn.argument.callee.type, "MemberExpression");
  assert.equal(snapshotReturn.argument.callee.computed, false);
  assert.equal(snapshotReturn.argument.callee.object.type, "Identifier");
  assert.equal(snapshotReturn.argument.callee.object.name, "Object");
  assert.equal(memberPropertyName(snapshotReturn.argument.callee), "freeze");
  assert.equal(snapshotReturn.argument.arguments.length, 1);
  const snapshotArray = snapshotReturn.argument.arguments[0];
  assert.equal(snapshotArray.type, "ArrayExpression");
  assert.equal(snapshotArray.elements.length, G17_BENCHMARK_BUILD_PLAN.length);
  for (const [index, element] of snapshotArray.elements.entries()) {
    assert.equal(element.type, "CallExpression");
    assert.equal(element.callee.type, "Identifier");
    assert.equal(element.callee.name, "snapshotBuild");
    assert.equal(element.arguments.length, 2);
    const descriptor = element.arguments[0];
    assert.equal(descriptor.type, "MemberExpression");
    assert.equal(descriptor.computed, true);
    assert.equal(descriptor.object.type, "Identifier");
    assert.equal(descriptor.object.name, "descriptors");
    assert.equal(descriptor.property.type, "Literal");
    assert.equal(descriptor.property.value, index);
    assert.equal(element.arguments[1].type, "Literal");
    assert.equal(element.arguments[1].value, index);
  }
  const createdDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "created",
  );
  assert.equal(createdDeclarations.length, 1);
  const [createdDeclaration] = createdDeclarations;
  assert.deepEqual(
    createdDeclaration.params.map((parameter) => {
      assert.equal(parameter.type, "Identifier");
      return parameter.name;
    }),
    ["owner", "bytes", "includeArtifact"],
  );
  const ownerDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "expectedOwner",
  );
  assert.equal(ownerDeclarations.length, 1);
  const ownerDeclaration = ownerDeclarations[0];
  assert.equal(ownerDeclaration.params.length, 3);
  assert.equal(ownerDeclaration.params[0].type, "Identifier");
  assert.equal(ownerDeclaration.params[0].name, "verified");
  assert.equal(ownerDeclaration.params[1].type, "Identifier");
  assert.equal(ownerDeclaration.params[1].name, "envelope");
  assert.equal(ownerDeclaration.params[2].type, "Identifier");
  assert.equal(ownerDeclaration.params[2].name, "builds");
  const canonicalBytesCalls = [];
  const canonicalBytesIdentifiers = [];
  walkAst(program, (node, parent, ancestors) => {
    if (node.type === "Identifier" && node.name === "canonicalBytes") {
      canonicalBytesIdentifiers.push(node);
    }
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      node.callee.name !== "canonicalBytes"
    ) {
      return;
    }
    const containing = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    canonicalBytesCalls.push({ node, parent, ancestors, containing });
  });
  assert.equal(canonicalBytesCalls.length, 1);
  const [canonicalBytesCall] = canonicalBytesCalls;
  assert.equal(canonicalBytesCall.containing, ownerDeclaration);
  assert.equal(canonicalBytesCall.node.arguments.length, 1);
  assert.equal(canonicalBytesCall.node.arguments[0].type, "Identifier");
  assert.equal(canonicalBytesCall.node.arguments[0].name, "owner");
  assert.deepEqual(
    canonicalBytesIdentifiers,
    [canonicalBytesDeclaration.id, canonicalBytesCall.node.callee],
    "canonicalBytes may only be declared once and called directly by expectedOwner",
  );
  const ownerBytesDeclaration = canonicalBytesCall.parent;
  assert.equal(ownerBytesDeclaration.type, "VariableDeclarator");
  assert.equal(ownerBytesDeclaration.id.type, "Identifier");
  assert.equal(ownerBytesDeclaration.id.name, "bytes");
  assert.equal(ownerBytesDeclaration.init, canonicalBytesCall.node);
  const ownerBytesStatements = canonicalBytesCall.ancestors.filter(
    (ancestor) => ancestor.type === "VariableDeclaration",
  );
  assert.equal(ownerBytesStatements.length, 1);
  const [ownerBytesStatement] = ownerBytesStatements;
  assert.equal(ownerBytesStatement.kind, "const");
  assert.deepEqual(ownerBytesStatement.declarations, [ownerBytesDeclaration]);
  const ownerStatements = ownerDeclaration.body.body.filter(
    (statement) =>
      statement.type === "VariableDeclaration" &&
      statement.kind === "const" &&
      statement.declarations.length === 1 &&
      statement.declarations[0].id.type === "Identifier" &&
      statement.declarations[0].id.name === "owner",
  );
  assert.equal(ownerStatements.length, 1);
  const [ownerStatement] = ownerStatements;
  const [ownerVariable] = ownerStatement.declarations;
  assert.equal(ownerVariable.init?.type, "CallExpression");
  assert.equal(ownerVariable.init.callee.type, "MemberExpression");
  assert.equal(ownerVariable.init.callee.computed, false);
  assert.equal(ownerVariable.init.callee.object.type, "Identifier");
  assert.equal(ownerVariable.init.callee.object.name, "Object");
  assert.equal(memberPropertyName(ownerVariable.init.callee), "freeze");
  assert.equal(ownerVariable.init.arguments.length, 1);
  assert.equal(ownerVariable.init.arguments[0].type, "ObjectExpression");
  const ownerContentHashProperties =
    ownerVariable.init.arguments[0].properties.filter(
      (property) =>
        property.type === "Property" &&
        property.computed === false &&
        property.key.type === "Identifier" &&
        property.key.name === "contentHash",
    );
  assert.equal(ownerContentHashProperties.length, 1);
  const [ownerContentHashProperty] = ownerContentHashProperties;
  assert.equal(ownerContentHashProperty.kind, "init");
  assert.equal(ownerContentHashProperty.method, false);
  assert.equal(ownerContentHashProperty.value.type, "CallExpression");
  assert.equal(ownerContentHashProperty.value.callee.type, "Identifier");
  assert.equal(ownerContentHashProperty.value.callee.name, "ownerContentHash");
  assert.equal(ownerContentHashProperty.value.arguments.length, 1);
  assert.equal(ownerContentHashProperty.value.arguments[0].type, "Identifier");
  assert.equal(ownerContentHashProperty.value.arguments[0].name, "unsigned");
  const unsignedStatements = ownerDeclaration.body.body.filter(
    (statement) =>
      statement.type === "VariableDeclaration" &&
      statement.kind === "const" &&
      statement.declarations.length === 1 &&
      statement.declarations[0].id.type === "Identifier" &&
      statement.declarations[0].id.name === "unsigned",
  );
  assert.equal(unsignedStatements.length, 1);
  const [unsignedStatement] = unsignedStatements;
  const [unsignedVariable] = unsignedStatement.declarations;
  assert.equal(unsignedVariable.init?.type, "CallExpression");
  assert.equal(unsignedVariable.init.callee.type, "MemberExpression");
  assert.equal(unsignedVariable.init.callee.computed, false);
  assert.equal(unsignedVariable.init.callee.object.type, "Identifier");
  assert.equal(unsignedVariable.init.callee.object.name, "Object");
  assert.equal(memberPropertyName(unsignedVariable.init.callee), "freeze");
  assert.equal(unsignedVariable.init.arguments.length, 1);
  assert.equal(unsignedVariable.init.arguments[0].type, "ObjectExpression");
  const ownerStatementIndex = ownerDeclaration.body.body.indexOf(ownerStatement);
  const unsignedStatementIndex =
    ownerDeclaration.body.body.indexOf(unsignedStatement);
  const bytesStatementIndex =
    ownerDeclaration.body.body.indexOf(ownerBytesStatement);
  assert.equal(ownerStatementIndex >= 0, true);
  assert.equal(
    ownerStatementIndex,
    unsignedStatementIndex + 1,
    "the sealed owner must immediately follow its frozen unsigned projection",
  );
  assert.equal(
    bytesStatementIndex,
    ownerStatementIndex + 1,
    "canonical bytes must immediately follow the frozen owner declaration",
  );
  const ownerReturn = ownerDeclaration.body.body.at(-1);
  assert.equal(ownerReturn?.type, "ReturnStatement");
  assert.equal(bytesStatementIndex < ownerDeclaration.body.body.length - 1, true);
  assert.equal(ownerReturn.argument?.type, "CallExpression");
  assert.equal(ownerReturn.argument.callee.type, "Identifier");
  assert.equal(ownerReturn.argument.callee.name, "created");
  assert.equal(ownerReturn.argument.arguments.length, 3);
  assert.deepEqual(
    ownerReturn.argument.arguments.slice(0, 2).map((argument) => {
      assert.equal(argument.type, "Identifier");
      return argument.name;
    }),
    ["owner", "bytes"],
    "the returned result must consume the exact frozen owner and canonical bytes",
  );
  const includeArtifact = ownerReturn.argument.arguments[2];
  assert.equal(includeArtifact.type, "BinaryExpression");
  assert.equal(includeArtifact.operator, "===");
  assert.equal(includeArtifact.left.type, "Identifier");
  assert.equal(includeArtifact.left.name, "verified");
  assert.equal(includeArtifact.right.type, "Identifier");
  assert.equal(includeArtifact.right.name, "undefined");
  const ownerContentHashIdentifiers = [];
  walkAst(program, (node) => {
    if (node.type === "Identifier" && node.name === "ownerContentHash") {
      ownerContentHashIdentifiers.push(node);
    }
  });
  assert.deepEqual(
    ownerContentHashIdentifiers,
    [ownerContentHashDeclaration.id, ownerContentHashProperty.value.callee],
    "ownerContentHash may only be declared once and seal the expected owner",
  );
  const ownerCompletionBoundaries = [];
  walkAst(ownerDeclaration.body, (node, _parent, ancestors) => {
    if (
      (node.type === "ReturnStatement" || node.type === "ThrowStatement") &&
      !ancestors.some((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
    ) {
      ownerCompletionBoundaries.push(node);
    }
  });
  assert.deepEqual(
    ownerCompletionBoundaries,
    [ownerReturn],
    "the canonical owner result must be the sole expected-owner completion path",
  );
  const createdIdentifiers = [];
  walkAst(program, (node) => {
    if (node.type === "Identifier" && node.name === "created") {
      createdIdentifiers.push(node);
    }
  });
  assert.deepEqual(
    createdIdentifiers,
    [createdDeclaration.id, ownerReturn.argument.callee],
    "created may only be declared once and called by the expected-owner return",
  );
  const inputRecordDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "ownDataRecord",
  );
  assert.equal(inputRecordDeclarations.length, 1);
  const inputRecordDeclaration = inputRecordDeclarations[0];
  assert.equal(inputRecordDeclaration.params.length, 1);
  assert.equal(inputRecordDeclaration.params[0].type, "Identifier");
  assert.equal(inputRecordDeclaration.params[0].name, "input");
  const validateInputDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "validateInput",
  );
  assert.equal(validateInputDeclarations.length, 1);
  const validateInputDeclaration = validateInputDeclarations[0];
  assert.equal(validateInputDeclaration.params.length, 1);
  assert.equal(validateInputDeclaration.params[0].type, "Identifier");
  assert.equal(validateInputDeclaration.params[0].name, "input");
  const verificationPreflightDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" &&
      node.id?.name === "validateVerifiedOwnerBeforeBuildReplay",
  );
  assert.equal(verificationPreflightDeclarations.length, 1);
  const verificationPreflightDeclaration = verificationPreflightDeclarations[0];
  assert.equal(verificationPreflightDeclaration.params.length, 1);
  assert.equal(verificationPreflightDeclaration.params[0].type, "Identifier");
  assert.equal(verificationPreflightDeclaration.params[0].name, "envelope");
  const jsonSnapshotDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "snapshotJson",
  );
  assert.equal(jsonSnapshotDeclarations.length, 1);
  const jsonSnapshotDeclaration = jsonSnapshotDeclarations[0];
  assert.equal(
    source.slice(jsonSnapshotDeclaration.start, jsonSnapshotDeclaration.end),
    PINNED_CANDIDATE_SNAPSHOT_JSON_SOURCE,
    "snapshotJson must equal the pinned bounded owned-JSON helper",
  );
  const verifiedOwnerDecoderDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" &&
      node.id?.name === "decodeVerifiedOwnerBeforeBuildReplay",
  );
  assert.equal(verifiedOwnerDecoderDeclarations.length, 1);
  const verifiedOwnerDecoderDeclaration = verifiedOwnerDecoderDeclarations[0];
  assert.equal(
    source.slice(
      verifiedOwnerDecoderDeclaration.start,
      verifiedOwnerDecoderDeclaration.end,
    ),
    PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE,
    "verified-owner decoder must equal the pinned bounded byte-to-owner helper",
  );
  const preflightBody = verificationPreflightDeclaration.body.body;
  assert.equal(preflightBody.length, 2);
  const preflightDecodeStatement = preflightBody[0];
  assert.equal(preflightDecodeStatement.type, "VariableDeclaration");
  assert.equal(preflightDecodeStatement.kind, "const");
  assert.equal(preflightDecodeStatement.declarations.length, 1);
  const preflightDecodeDeclaration = preflightDecodeStatement.declarations[0];
  assert.equal(preflightDecodeDeclaration.id.type, "Identifier");
  assert.equal(preflightDecodeDeclaration.id.name, "verified");
  assert.equal(preflightDecodeDeclaration.init?.type, "CallExpression");
  assert.equal(preflightDecodeDeclaration.init.callee.type, "Identifier");
  assert.equal(
    preflightDecodeDeclaration.init.callee.name,
    "decodeVerifiedOwnerBeforeBuildReplay",
  );
  assert.deepEqual(
    preflightDecodeDeclaration.init.arguments.map((argument) => {
      assert.equal(argument.type, "Identifier");
      return argument.name;
    }),
    ["envelope"],
  );
  const preflightReturn = preflightBody.at(-1);
  assert.equal(preflightReturn.type, "ReturnStatement");
  assert.equal(preflightReturn.argument?.type, "Identifier");
  assert.equal(preflightReturn.argument.name, "verified");
  const preflightBoundaries = [];
  walkAst(verificationPreflightDeclaration.body, (node, _parent, ancestors) => {
    if (
      ancestors.some(
        (ancestor) =>
          ancestor !== verificationPreflightDeclaration &&
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
      )
    ) {
      return;
    }
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") {
      preflightBoundaries.push(node);
    }
  });
  assert.deepEqual(preflightBoundaries, [preflightReturn]);
  const artifactFactoryDeclarations = program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" && node.id?.name === "artifactFor",
  );
  assert.equal(artifactFactoryDeclarations.length, 1);
  const artifactFactoryDeclaration = artifactFactoryDeclarations[0];
  assert.equal(artifactFactoryDeclaration.params.length, 1);
  assert.equal(artifactFactoryDeclaration.params[0].type, "Identifier");
  assert.equal(artifactFactoryDeclaration.params[0].name, "bytes");
  assert.equal(artifactFactoryDeclaration.body.body.length, 2);
  assertLeadingProxyRejection(validateInputDeclaration, "input");
  assertLeadingProxyRejection(validateBuildDeclaration, "value");
  const inputBody = inputRecordDeclaration.body.body;
  assert.equal(inputBody.length, 5);
  const [
    inputValidationStatement,
    inputDescriptorsStatement,
    inputBuildsStatement,
    inputBytesStatement,
    inputReturn,
  ] = inputBody;
  assert.equal(inputValidationStatement.type, "ExpressionStatement");
  assert.equal(inputValidationStatement.expression.type, "CallExpression");
  assert.equal(inputValidationStatement.expression.callee.type, "Identifier");
  assert.equal(
    inputValidationStatement.expression.callee.name,
    "validateInput",
  );
  assert.deepEqual(
    inputValidationStatement.expression.arguments.map((argument) => {
      assert.equal(argument.type, "Identifier");
      return argument.name;
    }),
    ["input"],
  );
  assert.equal(inputDescriptorsStatement.type, "VariableDeclaration");
  assert.equal(inputDescriptorsStatement.kind, "const");
  assert.equal(inputDescriptorsStatement.declarations.length, 1);
  const inputDescriptorsDeclaration = inputDescriptorsStatement.declarations[0];
  assert.equal(inputDescriptorsDeclaration.id.type, "Identifier");
  assert.equal(inputDescriptorsDeclaration.id.name, "descriptors");
  assert.equal(inputDescriptorsDeclaration.init?.type, "CallExpression");
  assert.equal(
    inputDescriptorsDeclaration.init.callee.type,
    "MemberExpression",
  );
  assert.equal(inputDescriptorsDeclaration.init.callee.computed, false);
  assert.equal(
    inputDescriptorsDeclaration.init.callee.object.type,
    "Identifier",
  );
  assert.equal(inputDescriptorsDeclaration.init.callee.object.name, "Object");
  assert.equal(
    memberPropertyName(inputDescriptorsDeclaration.init.callee),
    "getOwnPropertyDescriptors",
  );
  assert.equal(inputDescriptorsDeclaration.init.arguments.length, 1);
  assert.equal(
    inputDescriptorsDeclaration.init.arguments[0].type,
    "Identifier",
  );
  assert.equal(inputDescriptorsDeclaration.init.arguments[0].name, "input");
  assert.equal(inputBuildsStatement.type, "VariableDeclaration");
  assert.equal(inputBuildsStatement.kind, "const");
  assert.equal(inputBuildsStatement.declarations.length, 1);
  const inputBuildsDeclaration = inputBuildsStatement.declarations[0];
  assert.equal(inputBuildsDeclaration.id.type, "Identifier");
  assert.equal(inputBuildsDeclaration.id.name, "builds");
  assert.equal(inputBuildsDeclaration.init?.type, "MemberExpression");
  assert.equal(inputBuildsDeclaration.init.computed, false);
  assert.equal(memberPropertyName(inputBuildsDeclaration.init), "value");
  assert.equal(inputBuildsDeclaration.init.object.type, "MemberExpression");
  assert.equal(inputBuildsDeclaration.init.object.computed, false);
  assert.equal(inputBuildsDeclaration.init.object.object.type, "Identifier");
  assert.equal(inputBuildsDeclaration.init.object.object.name, "descriptors");
  assert.equal(
    memberPropertyName(inputBuildsDeclaration.init.object),
    "builds",
  );
  assert.equal(inputBytesStatement.type, "VariableDeclaration");
  assert.equal(inputBytesStatement.kind, "const");
  assert.equal(inputBytesStatement.declarations.length, 1);
  const inputBytesDeclaration = inputBytesStatement.declarations[0];
  assert.equal(inputBytesDeclaration.id.type, "Identifier");
  assert.equal(inputBytesDeclaration.id.name, "bytes");
  assert.equal(inputBytesDeclaration.init?.type, "ConditionalExpression");
  const inputBytesCondition = inputBytesDeclaration.init;
  assert.equal(inputBytesCondition.test.type, "CallExpression");
  assert.equal(inputBytesCondition.test.callee.type, "MemberExpression");
  assert.equal(inputBytesCondition.test.callee.computed, false);
  assert.equal(inputBytesCondition.test.callee.object.type, "Identifier");
  assert.equal(inputBytesCondition.test.callee.object.name, "Object");
  assert.equal(memberPropertyName(inputBytesCondition.test.callee), "hasOwn");
  assert.equal(inputBytesCondition.test.arguments.length, 2);
  assert.equal(inputBytesCondition.test.arguments[0].type, "Identifier");
  assert.equal(inputBytesCondition.test.arguments[0].name, "descriptors");
  assert.equal(inputBytesCondition.test.arguments[1].type, "Literal");
  assert.equal(inputBytesCondition.test.arguments[1].value, "bytes");
  assert.equal(inputBytesCondition.consequent.type, "MemberExpression");
  assert.equal(inputBytesCondition.consequent.computed, false);
  assert.equal(memberPropertyName(inputBytesCondition.consequent), "value");
  assert.equal(inputBytesCondition.consequent.object.type, "MemberExpression");
  assert.equal(inputBytesCondition.consequent.object.computed, false);
  assert.equal(inputBytesCondition.consequent.object.object.type, "Identifier");
  assert.equal(
    inputBytesCondition.consequent.object.object.name,
    "descriptors",
  );
  assert.equal(
    memberPropertyName(inputBytesCondition.consequent.object),
    "bytes",
  );
  assert.equal(inputBytesCondition.alternate.type, "Identifier");
  assert.equal(inputBytesCondition.alternate.name, "undefined");
  assert.equal(inputReturn.type, "ReturnStatement");
  assert.equal(inputReturn.argument?.type, "CallExpression");
  assert.equal(inputReturn.argument.callee.type, "MemberExpression");
  assert.equal(inputReturn.argument.callee.computed, false);
  assert.equal(inputReturn.argument.callee.object.type, "Identifier");
  assert.equal(inputReturn.argument.callee.object.name, "Object");
  assert.equal(memberPropertyName(inputReturn.argument.callee), "freeze");
  assert.equal(inputReturn.argument.arguments.length, 1);
  assert.equal(inputReturn.argument.arguments[0].type, "ObjectExpression");
  assert.deepEqual(
    inputReturn.argument.arguments[0].properties.map((property) => {
      assert.equal(property.type, "Property");
      assert.equal(property.kind, "init");
      assert.equal(property.computed, false);
      assert.equal(property.shorthand, true);
      assert.equal(property.key.type, "Identifier");
      assert.equal(property.value.type, "Identifier");
      assert.equal(property.key.name, property.value.name);
      return property.key.name;
    }),
    ["builds", "bytes"],
  );
  const failDeclarations = program.body.filter(
    (node) => node.type === "FunctionDeclaration" && node.id?.name === "fail",
  );
  assert.equal(failDeclarations.length, 1);
  const failDeclaration = failDeclarations[0];
  assert.deepEqual(
    failDeclaration.params.map((parameter) => {
      assert.equal(parameter.type, "Identifier");
      return parameter.name;
    }),
    ["code", "phase", "message", "cause"],
  );
  assert.equal(failDeclaration.body.body.length, 1);
  const [failThrow] = failDeclaration.body.body;
  assert.equal(failThrow.type, "ThrowStatement");
  assert.equal(failThrow.argument.type, "NewExpression");
  assert.equal(failThrow.argument.callee.type, "Identifier");
  assert.equal(
    failThrow.argument.callee.name,
    "G17BenchmarkProductOwnerV4ContractError",
  );
  assert.equal(failThrow.argument.arguments.length, 4);
  assert.deepEqual(
    failThrow.argument.arguments.slice(0, 3).map((argument) => {
      assert.equal(argument.type, "Identifier");
      return argument.name;
    }),
    ["code", "phase", "message"],
  );
  const failOptions = failThrow.argument.arguments[3];
  assert.equal(failOptions.type, "ConditionalExpression");
  assert.equal(failOptions.test.type, "BinaryExpression");
  assert.equal(failOptions.test.operator, "===");
  assert.equal(failOptions.test.left.type, "Identifier");
  assert.equal(failOptions.test.left.name, "cause");
  assert.equal(failOptions.test.right.type, "Identifier");
  assert.equal(failOptions.test.right.name, "undefined");
  assert.equal(failOptions.consequent.type, "Identifier");
  assert.equal(failOptions.consequent.name, "undefined");
  assert.equal(failOptions.alternate.type, "ObjectExpression");
  assert.equal(failOptions.alternate.properties.length, 1);
  const [causeProperty] = failOptions.alternate.properties;
  assert.equal(causeProperty.type, "Property");
  assert.equal(causeProperty.kind, "init");
  assert.equal(causeProperty.method, false);
  assert.equal(causeProperty.computed, false);
  assert.equal(causeProperty.shorthand, true);
  assert.equal(causeProperty.key.type, "Identifier");
  assert.equal(causeProperty.key.name, "cause");
  assert.equal(causeProperty.value.type, "Identifier");
  assert.equal(causeProperty.value.name, "cause");
  let verifierCalls = 0;
  let snapshotCalls = 0;
  let ownerCalls = 0;
  let createNormalizationCalls = 0;
  let verifyNormalizationCalls = 0;
  let verificationPreflightCalls = 0;
  let verifiedOwnerDecoderCalls = 0;
  let artifactByteGetters = 0;
  let astNodes = 0;
  const candidateLoopBounds = new WeakMap();
  const importedNames = new Set(
    EXPECTED_IMPORT_BINDINGS.map((binding) => binding.split(":").at(-1)),
  );
  const forbiddenIdentifiers = new Set([
    "Function",
    "Proxy",
    "SharedArrayBuffer",
    "WebSocket",
    "XMLHttpRequest",
    "clearImmediate",
    "clearInterval",
    "clearTimeout",
    "console",
    "global",
    "module",
    "navigator",
    "eval",
    "fetch",
    "globalThis",
    "process",
    "require",
    "setImmediate",
    "setInterval",
    "setTimeout",
  ]);
  const directCallImports = new Set([
    "canonicalJson",
    "canonicalSha256",
    "createHash",
    "isDeepStrictEqual",
    "verifyG17BenchmarkBuildOwnerV3Artifact",
  ]);
  const allowedAmbientMembers = new Map([
    ["Array", new Set(["isArray"])],
    ["ArrayBuffer", new Set(["isView"])],
    ["Buffer", new Set(["byteLength", "from", "isBuffer"])],
    ["JSON", new Set(["parse"])],
    ["Number", new Set(["isFinite", "isSafeInteger"])],
    [
      "Object",
      new Set([
        "freeze",
        "getOwnPropertyDescriptors",
        "getPrototypeOf",
        "hasOwn",
        "is",
      ]),
    ],
    ["Reflect", new Set(["ownKeys"])],
  ]);
  const allowedAmbientBindings = new Set([
    ...allowedAmbientMembers.keys(),
    "Error",
    "Set",
    "TextDecoder",
    "TypeError",
    "undefined",
  ]);
  const forbiddenMutatingMembers = new Set([
    "add",
    "clear",
    "copyWithin",
    "delete",
    "fill",
    "pop",
    "push",
    "reverse",
    "set",
    "shift",
    "sort",
    "splice",
    "unshift",
  ]);
  const isCreateHashInvocation = (node) =>
    node?.type === "CallExpression" &&
    node.optional === false &&
    node.callee.type === "Identifier" &&
    node.callee.name === "createHash";
  const isHashUpdateInvocation = (node) =>
    node?.type === "CallExpression" &&
    node.optional === false &&
    node.callee.type === "MemberExpression" &&
    node.callee.optional === false &&
    node.callee.computed === false &&
    memberPropertyName(node.callee) === "update" &&
    isCreateHashInvocation(node.callee.object);
  const isAllowedCandidateMemberCall = (member) => {
    const root = memberRoot(member);
    const property = memberPropertyName(member);
    if (
      root.type === "Identifier" &&
      allowedAmbientMembers.get(root.name)?.has(property)
    ) {
      return true;
    }
    if (
      root.type === "Identifier" &&
      root.name === "types" &&
      property === "isProxy"
    ) {
      return true;
    }
    if (
      root.type === "Identifier" &&
      moduleRegexBindings.has(root.name) &&
      property === "test"
    ) {
      return true;
    }
    if (
      root.type === "Identifier" &&
      root.name === "G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES" &&
      property === "includes"
    ) {
      return true;
    }
    if (
      property === "map" &&
      member.object.type === "CallExpression" &&
      member.object.callee.type === "Identifier" &&
      member.object.callee.name === "snapshotBuilds"
    ) {
      return true;
    }
    if (property === "update" && isCreateHashInvocation(member.object)) {
      return true;
    }
    if (property === "digest" && isHashUpdateInvocation(member.object)) {
      return true;
    }
    return (
      property === "decode" &&
      member.object.type === "NewExpression" &&
      member.object.callee.type === "Identifier" &&
      member.object.callee.name === "TextDecoder"
    );
  };
  const isSafeBorrowedArgumentCall = (call) => {
    if (call.callee.type === "Super") return true;
    if (call.callee.type !== "MemberExpression") return false;
    const root = memberRoot(call.callee);
    const property = memberPropertyName(call.callee);
    return (
      root.type === "Identifier" &&
      ((root.name === "types" && property === "isProxy") ||
        (root.name === "Array" && property === "isArray") ||
        (root.name === "Buffer" && property === "isBuffer") ||
        (root.name === "Number" &&
          ["isFinite", "isSafeInteger"].includes(property)) ||
        (root.name === "Object" &&
          ["getOwnPropertyDescriptors", "getPrototypeOf", "is"].includes(
            property,
          )) ||
        (root.name === "G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES" &&
          property === "includes"))
    );
  };
  const isAllowedValidationMemberCall = (member) => {
    const root = memberRoot(member);
    const property = memberPropertyName(member);
    if (root.type !== "Identifier") return false;
    if (root.name === "types") return property === "isProxy";
    if (root.name === "Array") return property === "isArray";
    if (root.name === "Buffer") {
      return ["byteLength", "isBuffer"].includes(property);
    }
    if (root.name === "Number") {
      return ["isFinite", "isSafeInteger"].includes(property);
    }
    if (root.name === "Object") {
      return [
        "getOwnPropertyDescriptors",
        "getPrototypeOf",
        "hasOwn",
        "is",
      ].includes(property);
    }
    return root.name === "Reflect" && property === "ownKeys";
  };
  const isExactBuildOwnerByteBound = (node, containing) => {
    if (
      containing !== validateBuildDeclaration ||
      node.type !== "BinaryExpression" ||
      node.operator !== ">" ||
      node.right.type !== "Identifier" ||
      node.right.name !== "G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES"
    ) {
      return false;
    }
    const byteLength = node.left;
    if (
      byteLength.type !== "CallExpression" ||
      byteLength.callee.type !== "MemberExpression" ||
      byteLength.callee.computed !== false ||
      byteLength.callee.object.type !== "Identifier" ||
      byteLength.callee.object.name !== "Buffer" ||
      memberPropertyName(byteLength.callee) !== "byteLength" ||
      byteLength.arguments.length !== 1
    ) {
      return false;
    }
    const descriptorValue = byteLength.arguments[0];
    if (
      descriptorValue.type !== "MemberExpression" ||
      descriptorValue.computed !== false ||
      memberPropertyName(descriptorValue) !== "value" ||
      descriptorValue.object.type !== "MemberExpression" ||
      descriptorValue.object.computed !== false ||
      memberPropertyName(descriptorValue.object) !== "bytes"
    ) {
      return false;
    }
    const descriptorCall = descriptorValue.object.object;
    return (
      descriptorCall.type === "CallExpression" &&
      descriptorCall.callee.type === "MemberExpression" &&
      descriptorCall.callee.computed === false &&
      descriptorCall.callee.object.type === "Identifier" &&
      descriptorCall.callee.object.name === "Object" &&
      memberPropertyName(descriptorCall.callee) ===
        "getOwnPropertyDescriptors" &&
      descriptorCall.arguments.length === 1 &&
      descriptorCall.arguments[0].type === "Identifier" &&
      descriptorCall.arguments[0].name === "value"
    );
  };
  const expressionReferencesAmbient = (expression) => {
    let found = false;
    walkAst(expression, (candidate, candidateParent) => {
      if (
        candidate.type === "Identifier" &&
        lexical.isReference(candidate, candidateParent) &&
        !lexical.resolves(candidate) &&
        allowedAmbientBindings.has(candidate.name)
      ) {
        found = true;
      }
    });
    return found;
  };
  const functionNodes = [];
  walkAst(program, (node) => {
    if (
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression",
      ].includes(node.type)
    ) {
      functionNodes.push(node);
    }
  });
  const namedFunctionNodes = new Map(
    functionNodes
      .filter((node) => node.type === "FunctionDeclaration")
      .map((node) => [node.id.name, node]),
  );
  const borrowedBindings = new Map(
    functionNodes.map((node) => [node, new Set()]),
  );
  const borrowedReturns = new Set();
  for (const declaration of functionNodes) {
    if (
      declaration.type !== "FunctionDeclaration" ||
      [
        "createG17BenchmarkProductOwnerV4Artifact",
        "verifyG17BenchmarkProductOwnerV4Artifact",
      ].includes(declaration.id.name)
    ) {
      for (const parameter of declaration.params) {
        for (const name of patternNames(parameter)) {
          borrowedBindings.get(declaration).add(name);
        }
      }
    }
  }
  for (const [declaration, names] of [
    [ownerDeclaration, ["envelope", "builds"]],
    [inputRecordDeclaration, ["input"]],
    [validateInputDeclaration, ["input"]],
    [normalizationDeclaration, ["builds"]],
    [snapshotDeclaration, ["builds"]],
    [snapshotBuildDeclaration, ["descriptor"]],
    [validateBuildDeclaration, ["value"]],
    [verificationPreflightDeclaration, ["envelope"]],
  ]) {
    const borrowed = borrowedBindings.get(declaration);
    for (const name of names) borrowed.add(name);
  }
  walkAst(program, (node, _parent, ancestors) => {
    if (node.type !== "CatchClause" || node.param === null) return;
    const containing = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    if (containing === undefined) return;
    const borrowed = borrowedBindings.get(containing);
    for (const name of patternNames(node.param)) borrowed.add(name);
  });
  const callHasOwnedResult = (call) => {
    if (call.callee.type === "Identifier") {
      return (
        directCallImports.has(call.callee.name) ||
        call.callee.name === "snapshotJson" ||
        call.callee.name === "decodeVerifiedOwnerBeforeBuildReplay" ||
        call.callee.name === "validateVerifiedOwnerBeforeBuildReplay"
      );
    }
    if (call.callee.type !== "MemberExpression") return false;
    const root = memberRoot(call.callee);
    const property = memberPropertyName(call.callee);
    if (root.type !== "Identifier") {
      return (
        property === "decode" &&
        call.callee.object.type === "NewExpression" &&
        call.callee.object.callee.type === "Identifier" &&
        call.callee.object.callee.name === "TextDecoder"
      );
    }
    if (root.name === "types") return property === "isProxy";
    if (root.name === "Array") return property === "isArray";
    if (root.name === "Buffer") {
      return ["byteLength", "from", "isBuffer"].includes(property);
    }
    if (root.name === "JSON") return property === "parse";
    if (root.name === "Number") {
      return ["isFinite", "isSafeInteger"].includes(property);
    }
    if (root.name === "Object") {
      return [
        "getOwnPropertyDescriptors",
        "getPrototypeOf",
        "hasOwn",
        "is",
      ].includes(property);
    }
    return root.name === "Reflect" && property === "ownKeys";
  };
  const expressionIsBorrowed = (expression, containing) => {
    const borrowed = borrowedBindings.get(containing) ?? new Set();
    const stack = [{ node: expression, parent: null }];
    while (stack.length > 0) {
      const { node: current, parent } = stack.pop();
      if (
        current !== expression &&
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(current.type)
      ) {
        continue;
      }
      if (
        current.type === "Identifier" &&
        lexical.isReference(current, parent) &&
        borrowed.has(current.name)
      ) {
        return true;
      }
      if (current.type === "CallExpression") {
        if (callHasOwnedResult(current)) continue;
        if (
          current.callee.type === "Identifier" &&
          namedFunctionNodes.has(current.callee.name)
        ) {
          if (
            borrowedReturns.has(namedFunctionNodes.get(current.callee.name))
          ) {
            return true;
          }
          continue;
        }
      }
      for (const value of Object.values(current)) {
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child !== null && typeof child?.type === "string") {
              stack.push({ node: child, parent: current });
            }
          }
        } else if (value !== null && typeof value?.type === "string") {
          stack.push({ node: value, parent: current });
        }
      }
    }
    return false;
  };
  let provenanceChanged = true;
  let provenanceIterations = 0;
  while (provenanceChanged) {
    provenanceIterations += 1;
    assert.equal(
      provenanceIterations <= MAX_CANDIDATE_CALL_DEPTH + 1,
      true,
      "candidate provenance does not converge within the call-depth bound",
    );
    provenanceChanged = false;
    walkAst(program, (node, _parent, ancestors) => {
      const containing = ancestors
        .filter((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
        .at(-1);
      if (
        containing === undefined ||
        containing === canonicalBytesDeclaration ||
        containing === ownerContentHashDeclaration ||
        containing === snapshotDeclaration ||
        containing === jsonSnapshotDeclaration ||
        containing === verifiedOwnerDecoderDeclaration
      ) {
        return;
      }
      const borrowed = borrowedBindings.get(containing);
      if (
        node.type === "VariableDeclarator" &&
        node.id.type === "Identifier" &&
        node.init !== null &&
        expressionIsBorrowed(node.init, containing) &&
        !borrowed.has(node.id.name)
      ) {
        borrowed.add(node.id.name);
        provenanceChanged = true;
      }
      if (
        node.type === "AssignmentExpression" &&
        node.left.type === "Identifier" &&
        expressionIsBorrowed(node.right, containing) &&
        !borrowed.has(node.left.name)
      ) {
        borrowed.add(node.left.name);
        provenanceChanged = true;
      }
      if (
        node.type === "ForOfStatement" &&
        node.left.type === "VariableDeclaration" &&
        expressionIsBorrowed(node.right, containing)
      ) {
        for (const declaration of node.left.declarations) {
          for (const name of patternNames(declaration.id)) {
            if (!borrowed.has(name)) {
              borrowed.add(name);
              provenanceChanged = true;
            }
          }
        }
      }
      if (
        node.type === "ReturnStatement" &&
        node.argument !== null &&
        expressionIsBorrowed(node.argument, containing) &&
        !borrowedReturns.has(containing)
      ) {
        borrowedReturns.add(containing);
        provenanceChanged = true;
      }
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        namedFunctionNodes.has(node.callee.name)
      ) {
        const callee = namedFunctionNodes.get(node.callee.name);
        const calleeBorrowed = borrowedBindings.get(callee);
        for (const [index, argument] of node.arguments.entries()) {
          if (!expressionIsBorrowed(argument, containing)) continue;
          const parameter = callee.params[index];
          if (parameter === undefined) continue;
          for (const name of patternNames(parameter)) {
            if (!calleeBorrowed.has(name)) {
              calleeBorrowed.add(name);
              provenanceChanged = true;
            }
          }
        }
      }
    });
  }
  assert.equal(
    borrowedBindings.get(ownerDeclaration).has("envelope"),
    true,
    "expectedOwner envelope must remain caller-derived",
  );
  const aggregateReadOnlyIdentities = new Map(
    [
      "G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY",
      "G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS",
      "G17_BENCHMARK_BUILD_PLAN",
    ].map((name) => [name, new Set([`@module:${name}`])]),
  );
  const aggregateReadOnlyRoots = new Map(
    [...aggregateReadOnlyIdentities.keys()].map((name) => [name, [name]]),
  );
  const aggregateReadOnlyMemberIdentities = new Map();
  const extendReadOnlyIdentity = (identity, segments) => {
    if (segments.length === 0) return identity;
    if (identity.startsWith("@member:")) {
      return `@member:${JSON.stringify([
        ...JSON.parse(identity.slice("@member:".length)),
        ...segments,
      ])}`;
    }
    if (identity.startsWith("@module-member:")) {
      return `@module-member:${JSON.stringify([
        ...JSON.parse(identity.slice("@module-member:".length)),
        ...segments,
      ])}`;
    }
    if (identity.startsWith("@module:")) {
      return `@module-member:${JSON.stringify([
        identity.slice("@module:".length),
        ...segments,
      ])}`;
    }
    return `@member:${JSON.stringify([identity, ...segments])}`;
  };
  const staticReadOnlyMemberPath = (member) => {
    const segments = [];
    let current = member;
    while (current.type === "MemberExpression") {
      const property =
        !current.computed && current.property.type === "Identifier"
          ? current.property.name
          : current.computed &&
              current.property.type === "Literal" &&
              (typeof current.property.value === "string" ||
                (Number.isSafeInteger(current.property.value) &&
                  current.property.value >= 0))
            ? current.property.value
            : null;
      if (property === null) return null;
      segments.unshift(property);
      current = current.object;
    }
    if (current.type !== "Identifier") return null;
    const root = aggregateReadOnlyRoots.get(current.name);
    return root === undefined ? null : [...root, ...segments];
  };
  const readOnlyMemberIdentitiesFromPath = (path) => {
    for (let length = path.length; length > 0; length -= 1) {
      const prefix = JSON.stringify(path.slice(0, length));
      const identities = aggregateReadOnlyMemberIdentities.get(prefix);
      if (identities === undefined) continue;
      const suffix = path.slice(length);
      return new Set(
        [...identities].map((identity) =>
          extendReadOnlyIdentity(identity, suffix),
        ),
      );
    }
    return new Set([`@module-member:${JSON.stringify(path)}`]);
  };
  const initializerContainedIdentities = (expression) => {
    if (expression.type === "Identifier") {
      return new Set(aggregateReadOnlyIdentities.get(expression.name) ?? []);
    }
    if (expression.type === "MemberExpression") {
      const path = staticReadOnlyMemberPath(expression);
      return path === null ? new Set() : readOnlyMemberIdentitiesFromPath(path);
    }
    if (expression.type === "CallExpression") {
      return new Set(
        expression.arguments.flatMap((argument) => [
          ...initializerContainedIdentities(argument),
        ]),
      );
    }
    if (expression.type === "ArrayExpression") {
      return new Set(
        expression.elements.flatMap((element) =>
          element === null ? [] : [...initializerContainedIdentities(element)],
        ),
      );
    }
    if (expression.type === "ObjectExpression") {
      return new Set(
        expression.properties.flatMap((property) =>
          property.type === "Property"
            ? [...initializerContainedIdentities(property.value)]
            : [],
        ),
      );
    }
    if (expression.type === "ParenthesizedExpression") {
      return initializerContainedIdentities(expression.expression);
    }
    if (
      expression.type === "ConditionalExpression" ||
      expression.type === "LogicalExpression"
    ) {
      return new Set([
        ...initializerContainedIdentities(
          expression.type === "ConditionalExpression"
            ? expression.consequent
            : expression.left,
        ),
        ...initializerContainedIdentities(
          expression.type === "ConditionalExpression"
            ? expression.alternate
            : expression.right,
        ),
      ]);
    }
    if (expression.type === "SequenceExpression") {
      return initializerContainedIdentities(expression.expressions.at(-1));
    }
    return new Set();
  };
  const recordReadOnlyAggregateMembers = (rootName, expression, path = []) => {
    const aggregate =
      expression.type === "CallExpression" &&
      expression.callee.type === "MemberExpression" &&
      expression.callee.computed === false &&
      expression.callee.object.type === "Identifier" &&
      expression.callee.object.name === "Object" &&
      memberPropertyName(expression.callee) === "freeze" &&
      expression.arguments.length === 1
        ? expression.arguments[0]
        : expression;
    const entries =
      aggregate.type === "ArrayExpression"
        ? aggregate.elements.map((value, index) => [index, value])
        : aggregate.type === "ObjectExpression"
          ? aggregate.properties.map((property) => [
              property.key.type === "Identifier"
                ? property.key.name
                : property.key.value,
              property.value,
            ])
          : [];
    for (const [key, value] of entries) {
      if (value === null) continue;
      const childPath = [...path, key];
      const identities = initializerContainedIdentities(value);
      const ownsNestedAggregate =
        value.type === "CallExpression" &&
        value.callee.type === "MemberExpression" &&
        value.callee.computed === false &&
        value.callee.object.type === "Identifier" &&
        value.callee.object.name === "Object" &&
        memberPropertyName(value.callee) === "freeze" &&
        value.arguments.length === 1 &&
        ["ArrayExpression", "ObjectExpression"].includes(
          value.arguments[0].type,
        );
      if (identities.size > 0 || ownsNestedAggregate) {
        aggregateReadOnlyMemberIdentities.set(
          JSON.stringify([rootName, ...childPath]),
          new Set([
            ...(ownsNestedAggregate
              ? [`@module-member:${JSON.stringify([rootName, ...childPath])}`]
              : []),
            ...identities,
          ]),
        );
      }
      if (ownsNestedAggregate) {
        recordReadOnlyAggregateMembers(rootName, value, childPath);
      }
    }
  };
  for (const node of program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type !== "VariableDeclaration") continue;
    const [entry] = declaration.declarations;
    const identities = initializerContainedIdentities(entry.init);
    const ownsFrozenAggregate =
      entry.init.type === "CallExpression" &&
      entry.init.callee.type === "MemberExpression" &&
      entry.init.callee.computed === false &&
      entry.init.callee.object.type === "Identifier" &&
      entry.init.callee.object.name === "Object" &&
      memberPropertyName(entry.init.callee) === "freeze" &&
      entry.init.arguments.length === 1 &&
      ["ArrayExpression", "ObjectExpression"].includes(
        entry.init.arguments[0].type,
      );
    if (ownsFrozenAggregate) {
      aggregateReadOnlyIdentities.set(
        entry.id.name,
        new Set([`@module:${entry.id.name}`, ...identities]),
      );
      aggregateReadOnlyRoots.set(entry.id.name, [entry.id.name]);
      recordReadOnlyAggregateMembers(entry.id.name, entry.init);
    } else if (identities.size > 0) {
      aggregateReadOnlyIdentities.set(entry.id.name, identities);
      if (entry.init.type === "Identifier") {
        const root = aggregateReadOnlyRoots.get(entry.init.name);
        if (root !== undefined) {
          aggregateReadOnlyRoots.set(entry.id.name, [...root]);
        }
      } else if (entry.init.type === "MemberExpression") {
        const path = staticReadOnlyMemberPath(entry.init);
        if (path !== null) aggregateReadOnlyRoots.set(entry.id.name, path);
      }
    }
  }
  const aggregateReadOnlyBindings = new Set(aggregateReadOnlyIdentities.keys());
  const aliasParents = new Map(functionNodes.map((node) => [node, new Map()]));
  const aliasFind = (containing, name) => {
    const parents = aliasParents.get(containing);
    if (parents === undefined) return name;
    if (!parents.has(name)) parents.set(name, name);
    let root = name;
    while (parents.get(root) !== root) root = parents.get(root);
    let current = name;
    while (parents.get(current) !== root) {
      const next = parents.get(current);
      parents.set(current, root);
      current = next;
    }
    return root;
  };
  const aliasUnion = (containing, left, right) => {
    const parents = aliasParents.get(containing);
    if (parents === undefined) return false;
    const leftRoot = aliasFind(containing, left);
    const rightRoot = aliasFind(containing, right);
    if (leftRoot === rightRoot) return false;
    parents.set(leftRoot, rightRoot);
    return true;
  };
  const descriptorOrigins = new Map(
    functionNodes.map((node) => [node, new Map()]),
  );
  const descriptorAliasDeclarations = new Map(
    functionNodes.map((node) => [node, new Map()]),
  );
  const descriptorRecordOrigins = new Map(
    functionNodes.map((node) => [node, new Map()]),
  );
  const projectedAggregateOrigins = new Map(
    functionNodes.map((node) => [node, new Map()]),
  );
  const projectedThrownOrigins = new Map(
    functionNodes.map((node) => [node, new Map()]),
  );
  const functionIdentityIndices = new Map(
    functionNodes.map((node, index) => [node, index]),
  );
  walkAst(program, (node, parent, ancestors) => {
    let binding;
    let initializer;
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init !== null
    ) {
      binding = node.id.name;
      initializer = node.init;
    } else if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left.type === "Identifier"
    ) {
      binding = node.left.name;
      initializer = node.right;
    } else {
      return;
    }
    const descriptorProperty =
      initializer.type !== "MemberExpression"
        ? null
        : !initializer.computed && initializer.property.type === "Identifier"
          ? initializer.property.name
          : initializer.computed &&
              initializer.property.type === "Literal" &&
              (typeof initializer.property.value === "string" ||
                (Number.isSafeInteger(initializer.property.value) &&
                  initializer.property.value >= 0))
            ? initializer.property.value
            : null;
    const descriptorCall =
      descriptorProperty === null ? initializer : initializer.object;
    if (
      descriptorCall.type !== "CallExpression" ||
      descriptorCall.callee.type !== "MemberExpression" ||
      descriptorCall.callee.computed !== false ||
      descriptorCall.callee.object.type !== "Identifier" ||
      descriptorCall.callee.object.name !== "Object" ||
      memberPropertyName(descriptorCall.callee) !==
        "getOwnPropertyDescriptors" ||
      descriptorCall.arguments.length !== 1 ||
      descriptorCall.arguments[0].type !== "Identifier"
    ) {
      return;
    }
    const containing = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    if (containing !== undefined) {
      if (descriptorProperty === null) {
        const origins = descriptorOrigins.get(containing);
        if (!origins.has(binding)) origins.set(binding, new Set());
        origins.get(binding).add(descriptorCall.arguments[0].name);
        if (
          node.type === "VariableDeclarator" &&
          parent?.type === "VariableDeclaration"
        ) {
          const declarations = descriptorAliasDeclarations.get(containing);
          if (!declarations.has(binding)) declarations.set(binding, []);
          declarations.get(binding).push({
            kind: parent.kind,
            origin: descriptorCall.arguments[0].name,
          });
        }
      } else {
        const origins = descriptorRecordOrigins.get(containing);
        if (!origins.has(binding)) origins.set(binding, new Set());
        origins
          .get(binding)
          .add(
            JSON.stringify([
              descriptorCall.arguments[0].name,
              descriptorProperty,
            ]),
          );
      }
    }
  });
  walkAst(program, (node, _parent, ancestors) => {
    let binding;
    let initializer;
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init !== null
    ) {
      binding = node.id.name;
      initializer = node.init;
    } else if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left.type === "Identifier"
    ) {
      binding = node.left.name;
      initializer = node.right;
    } else {
      return;
    }
    const containing = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    if (containing === undefined) return;
    const origins = projectedAggregateOrigins.get(containing);
    if (!origins.has(binding)) origins.set(binding, new Set());
    origins.get(binding).add(initializer);
  });
  const localMemberIdentityFromParts = (rootName, segments, containing) => {
    let identity = aliasFind(containing, rootName);
    for (const segment of segments) {
      identity = aliasFind(
        containing,
        extendReadOnlyIdentity(identity, [segment]),
      );
    }
    return identity;
  };
  const localIdentityParts = (identity) => {
    if (!identity.startsWith("@member:")) {
      return { root: identity, segments: [] };
    }
    const [root, ...segments] = JSON.parse(identity.slice("@member:".length));
    return { root, segments };
  };
  const descriptorMemberIdentities = (member, containing) => {
    const split = splitMemberExpression(member);
    if (
      split?.root.type === "CallExpression" &&
      split.root.callee.type === "MemberExpression" &&
      split.root.callee.computed === false &&
      split.root.callee.object.type === "Identifier" &&
      split.root.callee.object.name === "Object" &&
      memberPropertyName(split.root.callee) === "getOwnPropertyDescriptors" &&
      split.root.arguments.length === 1 &&
      split.root.arguments[0].type === "Identifier" &&
      split.segments.length >= 2 &&
      split.segments[1] === "value"
    ) {
      return new Set([
        localMemberIdentityFromParts(
          split.root.arguments[0].name,
          [split.segments[0], ...split.segments.slice(2)],
          containing,
        ),
      ]);
    }
    if (split?.root.type !== "Identifier") return new Set();
    const normalized = localIdentityParts(
      aliasFind(containing, split.root.name),
    );
    const identities = new Set();
    for (const [descriptorRecord, origins] of descriptorRecordOrigins.get(
      containing,
    ) ?? []) {
      if (
        aliasFind(containing, descriptorRecord) !==
        aliasFind(containing, normalized.root)
      ) {
        continue;
      }
      const relative = [...normalized.segments, ...split.segments];
      if (relative[0] !== "value") continue;
      for (const encoded of origins) {
        const [origin, property] = JSON.parse(encoded);
        identities.add(
          localMemberIdentityFromParts(
            origin,
            [property, ...relative.slice(1)],
            containing,
          ),
        );
      }
    }
    for (const [descriptorMap, origins] of descriptorOrigins.get(containing) ??
      []) {
      if (
        aliasFind(containing, descriptorMap) !==
        aliasFind(containing, normalized.root)
      ) {
        continue;
      }
      const relative = [...normalized.segments, ...split.segments];
      if (relative.length < 2 || relative[1] !== "value") continue;
      for (const origin of origins) {
        identities.add(
          localMemberIdentityFromParts(
            origin,
            [relative[0], ...relative.slice(2)],
            containing,
          ),
        );
      }
    }
    return identities;
  };
  const aliasMemberIdentity = (member, containing) => {
    const segments = [];
    let current = member;
    while (current.type === "MemberExpression") {
      const property =
        !current.computed && current.property.type === "Identifier"
          ? current.property.name
          : current.computed &&
              current.property.type === "Literal" &&
              (typeof current.property.value === "string" ||
                (Number.isSafeInteger(current.property.value) &&
                  current.property.value >= 0))
            ? current.property.value
            : null;
      if (property === null) return null;
      segments.unshift(property);
      current = current.object;
    }
    if (
      current.type !== "Identifier" ||
      !lexical.resolves(current) ||
      moduleReadOnlyBindings.has(current.name) ||
      importedNames.has(current.name)
    ) {
      return null;
    }
    return localMemberIdentityFromParts(current.name, segments, containing);
  };
  const moduleMemberIdentities = (member) => {
    const path = staticReadOnlyMemberPath(member);
    if (path !== null) return readOnlyMemberIdentitiesFromPath(path);
    const split = splitMemberExpression(member);
    return split?.root.type === "CallExpression"
      ? projectedReturnedModuleIdentities(split.root, split.segments)
      : new Set();
  };
  const functionModuleReturnIdentities = new Map(
    [...namedFunctionNodes].map(([name]) => [name, new Set()]),
  );
  const splitMemberExpression = (member) => {
    const segments = [];
    let root = member;
    while (root.type === "MemberExpression") {
      const property =
        !root.computed && root.property.type === "Identifier"
          ? root.property.name
          : root.computed &&
              root.property.type === "Literal" &&
              (typeof root.property.value === "string" ||
                (Number.isSafeInteger(root.property.value) &&
                  root.property.value >= 0))
            ? root.property.value
            : null;
      if (property === null) return null;
      segments.unshift(property);
      root = root.object;
    }
    return { root, segments };
  };
  function projectedReturnedModuleIdentities(expression, segments, depth = 0) {
    assert.equal(
      depth <= MAX_CANDIDATE_CALL_DEPTH,
      true,
      "candidate return projection exceeds call-depth bound",
    );
    if (segments.length === 0) return returnedModuleIdentities(expression);
    if (expression.type === "ParenthesizedExpression") {
      return projectedReturnedModuleIdentities(
        expression.expression,
        segments,
        depth,
      );
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "MemberExpression" &&
      expression.callee.computed === false &&
      expression.callee.object.type === "Identifier" &&
      expression.callee.object.name === "Object" &&
      memberPropertyName(expression.callee) === "freeze" &&
      expression.arguments.length === 1
    ) {
      return projectedReturnedModuleIdentities(
        expression.arguments[0],
        segments,
        depth,
      );
    }
    if (expression.type === "ObjectExpression") {
      const [head, ...tail] = segments;
      const property = expression.properties.find(
        (candidate) =>
          candidate.type === "Property" &&
          !candidate.computed &&
          (candidate.key.type === "Identifier"
            ? candidate.key.name
            : candidate.key.value) === head,
      );
      return property === undefined
        ? new Set()
        : projectedReturnedModuleIdentities(property.value, tail, depth);
    }
    if (expression.type === "ArrayExpression") {
      const [head, ...tail] = segments;
      const element = Number.isSafeInteger(head)
        ? expression.elements[head]
        : undefined;
      return element === undefined || element === null
        ? new Set()
        : projectedReturnedModuleIdentities(element, tail, depth);
    }
    if (
      expression.type === "Identifier" &&
      aggregateReadOnlyRoots.has(expression.name)
    ) {
      return readOnlyMemberIdentitiesFromPath([
        ...aggregateReadOnlyRoots.get(expression.name),
        ...segments,
      ]);
    }
    if (expression.type === "MemberExpression") {
      const split = splitMemberExpression(expression);
      if (split === null) return new Set();
      if (split.root.type === "CallExpression") {
        return projectedReturnedModuleIdentities(
          split.root,
          [...split.segments, ...segments],
          depth,
        );
      }
      const direct = moduleMemberIdentities(expression);
      return new Set(
        [...direct].map((identity) =>
          extendReadOnlyIdentity(identity, segments),
        ),
      );
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "Identifier" &&
      namedFunctionNodes.has(expression.callee.name)
    ) {
      const projected = new Set();
      const declaration = namedFunctionNodes.get(expression.callee.name);
      walkAst(declaration, (node, _parent, ancestors) => {
        if (node.type !== "ReturnStatement" || node.argument === null) return;
        const containing = ancestors
          .filter((ancestor) =>
            [
              "ArrowFunctionExpression",
              "FunctionDeclaration",
              "FunctionExpression",
            ].includes(ancestor.type),
          )
          .at(-1);
        if (containing !== declaration) return;
        for (const identity of projectedReturnedModuleIdentities(
          node.argument,
          segments,
          depth + 1,
        )) {
          projected.add(identity);
        }
      });
      if (projected.size > 0) return projected;
    }
    if (
      expression.type === "ConditionalExpression" ||
      expression.type === "LogicalExpression"
    ) {
      return new Set([
        ...projectedReturnedModuleIdentities(
          expression.type === "ConditionalExpression"
            ? expression.consequent
            : expression.left,
          segments,
          depth,
        ),
        ...projectedReturnedModuleIdentities(
          expression.type === "ConditionalExpression"
            ? expression.alternate
            : expression.right,
          segments,
          depth,
        ),
      ]);
    }
    return new Set(
      [...returnedModuleIdentities(expression)].map((identity) =>
        extendReadOnlyIdentity(identity, segments),
      ),
    );
  }
  const returnedModuleIdentities = (expression) => {
    if (
      expression.type === "Identifier" &&
      aggregateReadOnlyBindings.has(expression.name)
    ) {
      return new Set(aggregateReadOnlyIdentities.get(expression.name));
    }
    if (expression.type === "MemberExpression") {
      const direct = moduleMemberIdentities(expression);
      if (direct.size > 0) return direct;
      const split = splitMemberExpression(expression);
      return split?.root.type === "CallExpression"
        ? projectedReturnedModuleIdentities(split.root, split.segments)
        : new Set();
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "Identifier"
    ) {
      return new Set([
        ...(functionModuleReturnIdentities.get(expression.callee.name) ?? []),
        ...expression.arguments.flatMap((argument) => [
          ...returnedModuleIdentities(argument),
        ]),
      ]);
    }
    if (expression.type === "CallExpression") {
      return new Set(
        expression.arguments.flatMap((argument) => [
          ...returnedModuleIdentities(argument),
        ]),
      );
    }
    if (expression.type === "ArrayExpression") {
      return new Set(
        expression.elements.flatMap((element) =>
          element === null ? [] : [...returnedModuleIdentities(element)],
        ),
      );
    }
    if (expression.type === "ObjectExpression") {
      return new Set(
        expression.properties.flatMap((property) =>
          property.type === "Property"
            ? [...returnedModuleIdentities(property.value)]
            : [],
        ),
      );
    }
    if (expression.type === "ParenthesizedExpression") {
      return returnedModuleIdentities(expression.expression);
    }
    if (
      expression.type === "ConditionalExpression" ||
      expression.type === "LogicalExpression"
    ) {
      return new Set([
        ...returnedModuleIdentities(
          expression.type === "ConditionalExpression"
            ? expression.consequent
            : expression.left,
        ),
        ...returnedModuleIdentities(
          expression.type === "ConditionalExpression"
            ? expression.alternate
            : expression.right,
        ),
      ]);
    }
    if (expression.type === "SequenceExpression") {
      return returnedModuleIdentities(expression.expressions.at(-1));
    }
    return new Set();
  };
  let returnIdentitiesChanged = true;
  let returnIdentityIterations = 0;
  while (returnIdentitiesChanged) {
    returnIdentitiesChanged = false;
    returnIdentityIterations += 1;
    assert.equal(
      returnIdentityIterations <= namedFunctionNodes.size + 1,
      true,
      "candidate module-return identities do not converge",
    );
    for (const [name, declaration] of namedFunctionNodes) {
      const identities = functionModuleReturnIdentities.get(name);
      walkAst(declaration, (node, _parent, ancestors) => {
        if (node.type !== "ReturnStatement" || node.argument === null) return;
        const containing = ancestors
          .filter((ancestor) =>
            [
              "ArrowFunctionExpression",
              "FunctionDeclaration",
              "FunctionExpression",
            ].includes(ancestor.type),
          )
          .at(-1);
        if (containing !== declaration) return;
        for (const identity of returnedModuleIdentities(node.argument)) {
          if (!identities.has(identity)) {
            identities.add(identity);
            returnIdentitiesChanged = true;
          }
        }
      });
    }
  }
  const knownFreshResultDeclarations = new Set([
    artifactFactoryDeclaration,
    inputRecordDeclaration,
    normalizationDeclaration,
    ownerDeclaration,
    snapshotBuildDeclaration,
    snapshotDeclaration,
    verificationPreflightDeclaration,
    verifiedOwnerDecoderDeclaration,
  ]);
  const identityAnalysisMaximumSteps =
    MAX_CANDIDATE_AST_NODES * (MAX_CANDIDATE_CALL_DEPTH + 1);
  const observeIdentityAnalysisStep = (state) => {
    state.steps += 1;
    assert.equal(
      state.steps <= identityAnalysisMaximumSteps,
      true,
      "candidate identity analysis exceeds work bound",
    );
  };
  const identityFrameIndex = (state, frame) => {
    if (frame === null) return 0;
    if (state.frameIndices === undefined) {
      state.frameIndices = new WeakMap();
      state.nextFrameIndex = 1;
    }
    if (!state.frameIndices.has(frame)) {
      state.frameIndices.set(frame, state.nextFrameIndex);
      state.nextFrameIndex += 1;
    }
    return state.frameIndices.get(frame);
  };
  const directFunctionReturns = (declaration) => {
    const returns = [];
    walkAst(declaration, (node, _parent, ancestors) => {
      if (node.type !== "ReturnStatement" || node.argument === null) return;
      const containing = ancestors
        .filter((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
        .at(-1);
      if (containing === declaration) returns.push(node.argument);
    });
    return returns;
  };
  const callIdentityFrame = (call, callerContaining, callerFrame) => {
    if (
      call.callee.type !== "Identifier" ||
      !namedFunctionNodes.has(call.callee.name)
    ) {
      return null;
    }
    const declaration = namedFunctionNodes.get(call.callee.name);
    const bindings = new Map();
    for (const [index, parameter] of declaration.params.entries()) {
      const argument = call.arguments[index];
      if (argument === undefined) continue;
      for (const name of patternNames(parameter)) {
        bindings.set(name, {
          expression: argument,
          containing: callerContaining,
          frame: callerFrame,
        });
      }
    }
    return { bindings, declaration };
  };
  const projectedLocalIdentities = (
    expression,
    segments,
    containing,
    frame = null,
    depth = 0,
    state = { steps: 0 },
  ) => {
    observeIdentityAnalysisStep(state);
    assert.equal(
      depth <= MAX_CANDIDATE_CALL_DEPTH,
      true,
      "candidate identity projection exceeds call-depth bound",
    );
    assert.equal(
      segments.length <= MAX_CANDIDATE_AST_DEPTH,
      true,
      "candidate identity projection exceeds path bound",
    );
    if (expression.type === "ParenthesizedExpression") {
      return projectedLocalIdentities(
        expression.expression,
        segments,
        containing,
        frame,
        depth,
        state,
      );
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "MemberExpression" &&
      expression.callee.computed === false &&
      expression.callee.object.type === "Identifier" &&
      expression.callee.object.name === "Object" &&
      memberPropertyName(expression.callee) === "getOwnPropertyDescriptors" &&
      expression.arguments.length === 1 &&
      expression.arguments[0].type === "Identifier" &&
      segments.length >= 2 &&
      segments[1] === "value"
    ) {
      return projectedLocalIdentities(
        expression.arguments[0],
        [segments[0], ...segments.slice(2)],
        containing,
        frame,
        depth,
        state,
      );
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "MemberExpression" &&
      expression.callee.computed === false &&
      expression.callee.object.type === "Identifier" &&
      expression.callee.object.name === "Object" &&
      memberPropertyName(expression.callee) === "freeze" &&
      expression.arguments.length === 1
    ) {
      return projectedLocalIdentities(
        expression.arguments[0],
        segments,
        containing,
        frame,
        depth,
        state,
      );
    }
    if (expression.type === "ObjectExpression") {
      if (segments.length === 0) return new Set();
      const [head, ...tail] = segments;
      const property = expression.properties.find(
        (candidate) =>
          candidate.type === "Property" &&
          !candidate.computed &&
          (candidate.key.type === "Identifier"
            ? candidate.key.name
            : candidate.key.value) === head,
      );
      return property === undefined
        ? new Set()
        : projectedLocalIdentities(
            property.value,
            tail,
            containing,
            frame,
            depth,
            state,
          );
    }
    if (expression.type === "ArrayExpression") {
      if (segments.length === 0) return new Set();
      const [head, ...tail] = segments;
      const element = Number.isSafeInteger(head)
        ? expression.elements[head]
        : undefined;
      return element === undefined || element === null
        ? new Set()
        : projectedLocalIdentities(
            element,
            tail,
            containing,
            frame,
            depth,
            state,
          );
    }
    if (expression.type === "Identifier") {
      if (aggregateReadOnlyRoots.has(expression.name)) {
        return readOnlyMemberIdentitiesFromPath([
          ...aggregateReadOnlyRoots.get(expression.name),
          ...segments,
        ]);
      }
      if (
        !lexical.resolves(expression) ||
        moduleReadOnlyBindings.has(expression.name) ||
        importedNames.has(expression.name)
      ) {
        return new Set();
      }
      if (segments.length > 0) {
        const projected = projectedAggregateMemberIdentities(
          expression.name,
          segments,
          containing,
          frame,
          depth,
          state,
        );
        if (projected.size > 0) return projected;
      }
      const identity = localMemberIdentityFromParts(
        expression.name,
        segments,
        containing,
      );
      if (frame === null) return new Set([identity]);
      const parts = localIdentityParts(identity);
      const binding = frame.bindings.get(parts.root);
      return binding === undefined
        ? new Set()
        : projectedLocalIdentities(
            binding.expression,
            parts.segments,
            binding.containing,
            binding.frame,
            depth,
            state,
          );
    }
    if (expression.type === "MemberExpression") {
      const split = splitMemberExpression(expression);
      if (split === null) return new Set();
      const combinedSegments = [...split.segments, ...segments];
      if (
        split.root.type === "CallExpression" &&
        split.root.callee.type === "MemberExpression" &&
        split.root.callee.computed === false &&
        split.root.callee.object.type === "Identifier" &&
        split.root.callee.object.name === "Object" &&
        memberPropertyName(split.root.callee) === "getOwnPropertyDescriptors" &&
        split.root.arguments.length === 1 &&
        split.root.arguments[0].type === "Identifier" &&
        combinedSegments.length >= 2 &&
        combinedSegments[1] === "value"
      ) {
        return projectedLocalIdentities(
          split.root.arguments[0],
          [combinedSegments[0], ...combinedSegments.slice(2)],
          containing,
          frame,
          depth,
          state,
        );
      }
      if (split.root.type === "Identifier") {
        return projectedLocalIdentities(
          split.root,
          combinedSegments,
          containing,
          frame,
          depth,
          state,
        );
      }
      if (split.root.type === "CallExpression") {
        return projectedLocalIdentities(
          split.root,
          combinedSegments,
          containing,
          frame,
          depth,
          state,
        );
      }
      return new Set();
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "Identifier" &&
      namedFunctionNodes.has(expression.callee.name)
    ) {
      const next = callIdentityFrame(expression, containing, frame);
      if (knownFreshResultDeclarations.has(next.declaration)) return new Set();
      const identities = new Set();
      for (const returned of directFunctionReturns(next.declaration)) {
        for (const identity of projectedLocalIdentities(
          returned,
          segments,
          next.declaration,
          next,
          depth + 1,
          state,
        )) {
          identities.add(identity);
        }
      }
      return identities;
    }
    if (
      expression.type === "ConditionalExpression" ||
      expression.type === "LogicalExpression"
    ) {
      return new Set([
        ...projectedLocalIdentities(
          expression.type === "ConditionalExpression"
            ? expression.consequent
            : expression.left,
          segments,
          containing,
          frame,
          depth,
          state,
        ),
        ...projectedLocalIdentities(
          expression.type === "ConditionalExpression"
            ? expression.alternate
            : expression.right,
          segments,
          containing,
          frame,
          depth,
          state,
        ),
      ]);
    }
    if (expression.type === "SequenceExpression") {
      return projectedLocalIdentities(
        expression.expressions.at(-1),
        segments,
        containing,
        frame,
        depth,
        state,
      );
    }
    if (
      expression.type === "AssignmentExpression" &&
      expression.operator === "="
    ) {
      return projectedLocalIdentities(
        expression.right,
        segments,
        containing,
        frame,
        depth,
        state,
      );
    }
    return new Set(
      [...projectedReturnedModuleIdentities(expression, segments)].filter(
        (identity) => identity.startsWith("@module"),
      ),
    );
  };
  const projectedAggregateMemberIdentities = (
    rootName,
    segments,
    containing,
    frame = null,
    depth = 0,
    state = { steps: 0 },
  ) => {
    const identities = new Set();
    if (state.activeOrigins === undefined) state.activeOrigins = new Set();
    let current = aliasFind(containing, rootName);
    for (let index = 0; index < segments.length; index += 1) {
      for (const [binding, origins] of projectedAggregateOrigins.get(
        containing,
      ) ?? []) {
        if (aliasFind(containing, binding) !== current) continue;
        for (const origin of origins) {
          const remaining = segments.slice(index);
          const originKey = JSON.stringify([
            functionIdentityIndices.get(containing),
            identityFrameIndex(state, frame),
            binding,
            origin.start,
            origin.end,
            ...remaining,
          ]);
          if (state.activeOrigins.has(originKey)) continue;
          state.activeOrigins.add(originKey);
          try {
            for (const identity of projectedLocalIdentities(
              origin,
              remaining,
              containing,
              frame,
              depth + 1,
              state,
            )) {
              if (identity !== current) identities.add(identity);
            }
          } finally {
            state.activeOrigins.delete(originKey);
          }
        }
      }
      for (const [binding, calls] of projectedThrownOrigins.get(containing) ??
        []) {
        if (aliasFind(containing, binding) !== current) continue;
        const remaining = segments.slice(index);
        for (const call of calls) {
          for (const identity of possibleThrownIdentities(
            call,
            containing,
            frame,
            depth + 1,
            state,
            new Set(),
            remaining,
          )) {
            if (identity !== current) identities.add(identity);
          }
        }
      }
      current = aliasFind(
        containing,
        extendReadOnlyIdentity(current, [segments[index]]),
      );
    }
    return identities;
  };
  const identityAliasNames = (expression, containing) => {
    if (expression.type === "Identifier") {
      if (aggregateReadOnlyBindings.has(expression.name)) {
        return new Set(aggregateReadOnlyIdentities.get(expression.name));
      }
      return lexical.resolves(expression) &&
        !moduleReadOnlyBindings.has(expression.name) &&
        !importedNames.has(expression.name)
        ? new Set([expression.name])
        : new Set();
    }
    if (expression.type === "MemberExpression") {
      const descriptorIdentities = descriptorMemberIdentities(
        expression,
        containing,
      );
      if (descriptorIdentities.size > 0) return descriptorIdentities;
      const split = splitMemberExpression(expression);
      if (split?.root.type === "CallExpression") {
        const projected = projectedLocalIdentities(
          split.root,
          split.segments,
          containing,
        );
        if (projected.size > 0) return projected;
      }
      if (split?.root.type === "Identifier") {
        const projected = projectedAggregateMemberIdentities(
          split.root.name,
          split.segments,
          containing,
        );
        if (projected.size > 0) return projected;
      }
      const identity = aliasMemberIdentity(expression, containing);
      return identity === null
        ? moduleMemberIdentities(expression)
        : new Set([identity]);
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "Identifier" &&
      namedFunctionNodes.has(expression.callee.name) &&
      !knownFreshResultDeclarations.has(
        namedFunctionNodes.get(expression.callee.name),
      )
    ) {
      const projected = projectedLocalIdentities(expression, [], containing);
      const moduleReturns =
        functionModuleReturnIdentities.get(expression.callee.name) ?? [];
      if (projected.size > 0 || moduleReturns.size > 0) {
        return new Set([...projected, ...moduleReturns]);
      }
      return new Set();
    }
    if (
      expression.type === "CallExpression" &&
      expression.callee.type === "MemberExpression" &&
      expression.callee.computed === false &&
      expression.callee.object.type === "Identifier" &&
      expression.callee.object.name === "Object" &&
      memberPropertyName(expression.callee) === "freeze" &&
      expression.arguments.length === 1
    ) {
      return identityAliasNames(expression.arguments[0], containing);
    }
    if (
      expression.type === "AssignmentExpression" &&
      expression.operator === "="
    ) {
      return identityAliasNames(expression.right, containing);
    }
    if (expression.type === "ParenthesizedExpression") {
      return identityAliasNames(expression.expression, containing);
    }
    if (
      expression.type === "ConditionalExpression" ||
      expression.type === "LogicalExpression"
    ) {
      return new Set([
        ...identityAliasNames(
          expression.type === "ConditionalExpression"
            ? expression.consequent
            : expression.left,
          containing,
        ),
        ...identityAliasNames(
          expression.type === "ConditionalExpression"
            ? expression.alternate
            : expression.right,
          containing,
        ),
      ]);
    }
    if (expression.type === "SequenceExpression") {
      return identityAliasNames(expression.expressions.at(-1), containing);
    }
    return new Set();
  };
  const bindAggregateInitializer = (
    containing,
    rootName,
    expression,
    path = [],
  ) => {
    const aggregate =
      expression.type === "CallExpression" &&
      expression.callee.type === "MemberExpression" &&
      expression.callee.computed === false &&
      expression.callee.object.type === "Identifier" &&
      expression.callee.object.name === "Object" &&
      memberPropertyName(expression.callee) === "freeze" &&
      expression.arguments.length === 1
        ? expression.arguments[0]
        : expression;
    if (aggregate.type === "ParenthesizedExpression") {
      return bindAggregateInitializer(
        containing,
        rootName,
        aggregate.expression,
        path,
      );
    }
    if (
      aggregate.type === "ConditionalExpression" ||
      aggregate.type === "LogicalExpression"
    ) {
      const left =
        aggregate.type === "ConditionalExpression"
          ? aggregate.consequent
          : aggregate.left;
      const right =
        aggregate.type === "ConditionalExpression"
          ? aggregate.alternate
          : aggregate.right;
      const leftChanged = bindAggregateInitializer(
        containing,
        rootName,
        left,
        path,
      );
      const rightChanged = bindAggregateInitializer(
        containing,
        rootName,
        right,
        path,
      );
      return leftChanged || rightChanged;
    }
    if (aggregate.type === "SequenceExpression") {
      return bindAggregateInitializer(
        containing,
        rootName,
        aggregate.expressions.at(-1),
        path,
      );
    }
    const entries =
      aggregate.type === "ArrayExpression"
        ? aggregate.elements.map((value, index) => [index, value])
        : aggregate.type === "ObjectExpression"
          ? aggregate.properties.map((property) => [
              property.key.type === "Identifier"
                ? property.key.name
                : property.key.value,
              property.value,
            ])
          : [];
    let changed = false;
    for (const [key, value] of entries) {
      if (value === null) continue;
      const childPath = [...path, key];
      const memberIdentity = localMemberIdentityFromParts(
        rootName,
        childPath,
        containing,
      );
      for (const valueIdentity of identityAliasNames(value, containing)) {
        changed =
          aliasUnion(containing, memberIdentity, valueIdentity) || changed;
      }
      changed =
        bindAggregateInitializer(containing, rootName, value, childPath) ||
        changed;
    }
    return changed;
  };
  let aliasesChanged = true;
  let aliasIterations = 0;
  while (aliasesChanged) {
    aliasesChanged = false;
    aliasIterations += 1;
    assert.equal(
      aliasIterations <= MAX_CANDIDATE_CALL_DEPTH + 1,
      true,
      "candidate local identities do not converge within the call-depth bound",
    );
    walkAst(program, (node, _parent, ancestors) => {
      const containing = ancestors
        .filter((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
        .at(-1);
      if (
        containing === undefined ||
        containing === canonicalBytesDeclaration ||
        containing === ownerContentHashDeclaration ||
        containing === snapshotDeclaration ||
        containing === jsonSnapshotDeclaration ||
        containing === verifiedOwnerDecoderDeclaration
      ) {
        return;
      }
      let leftName;
      let right;
      if (
        node.type === "VariableDeclarator" &&
        node.id.type === "Identifier" &&
        node.init !== null
      ) {
        leftName = node.id.name;
        right = node.init;
      } else if (
        node.type === "AssignmentExpression" &&
        node.operator === "=" &&
        node.left.type === "Identifier"
      ) {
        leftName = node.left.name;
        right = node.right;
      } else {
        return;
      }
      for (const rightName of identityAliasNames(right, containing)) {
        aliasesChanged =
          aliasUnion(containing, leftName, rightName) || aliasesChanged;
      }
      aliasesChanged =
        bindAggregateInitializer(containing, leftName, right) || aliasesChanged;
    });
  }
  const possibleThrownIdentities = (
    call,
    containing,
    frame = null,
    depth = 0,
    state = { steps: 0 },
    active = new Set(),
    segments = [],
  ) => {
    observeIdentityAnalysisStep(state);
    if (
      call.callee.type !== "Identifier" ||
      !namedFunctionNodes.has(call.callee.name)
    ) {
      return new Set();
    }
    assert.equal(
      depth <= MAX_CANDIDATE_CALL_DEPTH,
      true,
      "candidate thrown-identity analysis exceeds call-depth bound",
    );
    assert.equal(
      active.has(call.callee.name),
      false,
      `candidate recursive thrown-identity cycle at ${call.callee.name}`,
    );
    const next = callIdentityFrame(call, containing, frame);
    const nextActive = new Set(active).add(call.callee.name);
    const identities = new Set();
    walkAst(next.declaration, (node, _parent, ancestors) => {
      const directContaining = ancestors
        .filter((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
        .at(-1);
      if (directContaining !== next.declaration) return;
      if (node.type === "ThrowStatement") {
        for (const identity of projectedLocalIdentities(
          node.argument,
          segments,
          next.declaration,
          next,
          depth + 1,
          state,
        )) {
          identities.add(identity);
        }
      } else if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        namedFunctionNodes.has(node.callee.name)
      ) {
        for (const identity of possibleThrownIdentities(
          node,
          next.declaration,
          next,
          depth + 1,
          state,
          nextActive,
          segments,
        )) {
          identities.add(identity);
        }
      }
    });
    return identities;
  };
  walkAst(program, (node, _parent, ancestors) => {
    if (node.type !== "CatchClause" || node.param === null) return;
    const containing = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    const ownerTry = ancestors
      .filter(
        (ancestor) =>
          ancestor.type === "TryStatement" && ancestor.handler === node,
      )
      .at(-1);
    if (containing === undefined || ownerTry === undefined) return;
    const catchNames = patternNames(node.param);
    walkAst(ownerTry.block, (candidate, _candidateParent, nestedAncestors) => {
      if (
        nestedAncestors.some((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
      ) {
        return;
      }
      let thrownIdentities;
      if (candidate.type === "ThrowStatement") {
        thrownIdentities = identityAliasNames(candidate.argument, containing);
        for (const catchName of catchNames) {
          const origins = projectedAggregateOrigins.get(containing);
          if (!origins.has(catchName)) origins.set(catchName, new Set());
          origins.get(catchName).add(candidate.argument);
        }
      } else if (
        candidate.type === "CallExpression" &&
        candidate.callee.type === "Identifier" &&
        namedFunctionNodes.has(candidate.callee.name)
      ) {
        thrownIdentities = possibleThrownIdentities(candidate, containing);
        for (const catchName of catchNames) {
          const origins = projectedThrownOrigins.get(containing);
          if (!origins.has(catchName)) origins.set(catchName, new Set());
          origins.get(catchName).add(candidate);
        }
      } else {
        return;
      }
      for (const thrownIdentity of thrownIdentities) {
        for (const catchName of catchNames) {
          aliasUnion(containing, catchName, thrownIdentity);
        }
      }
    });
  });
  const isGuardedDescriptorAlias = (expression, containing) => {
    if (
      expression.type !== "Identifier" ||
      containing?.type !== "FunctionDeclaration"
    ) {
      return false;
    }
    const origins = descriptorOrigins.get(containing)?.get(expression.name);
    if (origins === undefined || origins.size !== 1) return false;
    const [origin] = origins;
    const declarations = descriptorAliasDeclarations
      .get(containing)
      ?.get(expression.name);
    if (
      declarations?.length !== 1 ||
      declarations[0].kind !== "const" ||
      declarations[0].origin !== origin
    ) {
      return false;
    }
    let definitions = 0;
    let writes = 0;
    walkAst(containing.body, (node, _parent, ancestors) => {
      if (
        ancestors.some((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
      ) {
        return;
      }
      if (declaredNames(node).includes(expression.name)) {
        definitions += 1;
      }
      if (
        node.type === "AssignmentExpression" &&
        patternNames(node.left).includes(expression.name)
      ) {
        writes += 1;
      }
      if (
        node.type === "UpdateExpression" &&
        node.argument.type === "Identifier" &&
        node.argument.name === expression.name
      ) {
        writes += 1;
      }
      if (
        ["ForInStatement", "ForOfStatement"].includes(node.type) &&
        node.left.type !== "VariableDeclaration" &&
        patternNames(node.left).includes(expression.name)
      ) {
        writes += 1;
      }
    });
    return (
      definitions === 1 &&
      writes === 0 &&
      containing.params.some(
        (parameter) =>
          parameter.type === "Identifier" && parameter.name === origin,
      )
    );
  };
  walkAst(program, (node, parent, ancestors) => {
    const containingFunction = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    const insideValidation =
      containingFunction === validateInputDeclaration ||
      containingFunction === validateBuildDeclaration;
    const insidePinnedJsonSnapshot =
      node === jsonSnapshotDeclaration ||
      ancestors.includes(jsonSnapshotDeclaration);
    const insidePinnedCanonicalBytes =
      node === canonicalBytesDeclaration ||
      ancestors.includes(canonicalBytesDeclaration);
    const insidePinnedOwnerContentHash =
      node === ownerContentHashDeclaration ||
      ancestors.includes(ownerContentHashDeclaration);
    const insidePinnedSnapshotBuilds =
      node === snapshotDeclaration || ancestors.includes(snapshotDeclaration);
    const insidePinnedVerifiedOwnerDecoder =
      node === verifiedOwnerDecoderDeclaration ||
      ancestors.includes(verifiedOwnerDecoderDeclaration);
    astNodes += 1;
    assert.equal(
      astNodes <= MAX_CANDIDATE_AST_NODES,
      true,
      "candidate AST exceeds bound",
    );
    if (
      insidePinnedCanonicalBytes ||
      insidePinnedOwnerContentHash ||
      insidePinnedSnapshotBuilds ||
      insidePinnedJsonSnapshot ||
      insidePinnedVerifiedOwnerDecoder
    ) {
      return;
    }
    assert.equal(
      ALLOWED_CANDIDATE_AST_NODES.has(node.type),
      true,
      `candidate AST node ${node.type} is forbidden`,
    );
    if (node.type === "FunctionExpression") {
      assert.equal(node.id, null, "named function expressions are forbidden");
    }
    if (node.type === "RestElement") {
      const containingMethod = ancestors
        .filter((ancestor) => ancestor.type === "MethodDefinition")
        .at(-1);
      const containingClass = ancestors
        .filter((ancestor) => ancestor.type === "ClassDeclaration")
        .at(-1);
      assert.equal(
        parent === containingMethod?.value &&
          containingMethod?.kind === "constructor" &&
          containingMethod.key?.type === "Identifier" &&
          containingMethod.key.name === "constructor" &&
          containingClass?.id?.name ===
            "G17BenchmarkProductOwnerV4ContractError" &&
          parent.params.length === 4 &&
          parent.params[3] === node &&
          node.argument.type === "Identifier" &&
          node.argument.name === "options",
        true,
        "candidate rest parameters are forbidden outside the error constructor",
      );
    }
    if (node.type === "TemplateLiteral") {
      assert.equal(
        node.expressions.length,
        0,
        "template coercion is forbidden",
      );
    }
    if (node.type === "Literal" && node.regex !== undefined) {
      assert.fail("candidate regular expression literals are forbidden");
    }
    if (
      node.type === "Literal" &&
      (node.bigint !== undefined || typeof node.value === "bigint")
    ) {
      assert.fail("candidate BigInt literals are forbidden");
    }
    if (["ArrayExpression", "ObjectExpression"].includes(node.type)) {
      const localReferences = new Map();
      const observeAggregateIdentity = (identity) => {
        const count = (localReferences.get(identity) ?? 0) + 1;
        localReferences.set(identity, count);
        assert.equal(
          count <= 1,
          true,
          `candidate aggregate duplicates local value ${identity}`,
        );
      };
      const stack = [{ node, parent }];
      while (stack.length > 0) {
        const current = stack.pop();
        if (
          current.node !== node &&
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(current.node.type)
        ) {
          continue;
        }
        if (
          current.node.type === "Identifier" &&
          lexical.isReference(current.node, current.parent) &&
          !(
            current.parent?.type === "Property" &&
            current.parent.key === current.node
          ) &&
          lexical.resolves(current.node) &&
          (!importedNames.has(current.node.name) ||
            aggregateReadOnlyBindings.has(current.node.name))
        ) {
          if (aggregateReadOnlyBindings.has(current.node.name)) {
            for (const identity of aggregateReadOnlyIdentities.get(
              current.node.name,
            )) {
              observeAggregateIdentity(identity);
            }
          } else if (!moduleReadOnlyBindings.has(current.node.name)) {
            observeAggregateIdentity(
              aliasFind(containingFunction, current.node.name),
            );
          }
        }
        if (current.node.type === "MemberExpression") {
          const memberIdentities = identityAliasNames(
            current.node,
            containingFunction,
          );
          if (memberIdentities.size > 0) {
            for (const identity of memberIdentities) {
              observeAggregateIdentity(identity);
            }
            continue;
          }
        }
        if (
          current.node.type === "CallExpression" ||
          current.node.type === "NewExpression"
        ) {
          if (current.node.type === "CallExpression") {
            const returnedIdentities = identityAliasNames(
              current.node,
              containingFunction,
            );
            if (returnedIdentities.size > 0) {
              for (const identity of returnedIdentities) {
                observeAggregateIdentity(identity);
              }
              continue;
            }
          }
          for (const argument of current.node.arguments) {
            stack.push({ node: argument, parent: current.node });
          }
          continue;
        }
        if (current.node.type === "AssignmentExpression") {
          stack.push({ node: current.node.right, parent: current.node });
          continue;
        }
        if (
          current.node !== node &&
          ![
            "ArrayExpression",
            "ConditionalExpression",
            "LogicalExpression",
            "ObjectExpression",
            "ParenthesizedExpression",
            "Property",
          ].includes(current.node.type)
        ) {
          continue;
        }
        for (const value of Object.values(current.node)) {
          if (Array.isArray(value)) {
            for (const child of value) {
              if (child !== null && typeof child?.type === "string") {
                stack.push({ node: child, parent: current.node });
              }
            }
          } else if (value !== null && typeof value?.type === "string") {
            stack.push({ node: value, parent: current.node });
          }
        }
      }
    }
    if (node.type === "ObjectPattern") {
      assert.equal(parent?.type, "ArrowFunctionExpression");
      assert.equal(parent.params.length, 1);
      assert.equal(parent.params[0], node);
      assert.equal(
        ancestors.includes(normalizationDeclaration),
        true,
        "object patterns are limited to the replay-map callback",
      );
      assert.deepEqual(
        node.properties.map((property) => {
          assert.equal(property.type, "Property");
          assert.equal(property.kind, "init");
          assert.equal(property.computed, false);
          assert.equal(property.shorthand, true);
          assert.equal(property.key.type, "Identifier");
          assert.equal(property.value.type, "Identifier");
          assert.equal(property.key.name, property.value.name);
          return property.key.name;
        }),
        ["bytes", "fixture"],
      );
    }
    if (
      [
        "ArrowFunctionExpression",
        "FunctionDeclaration",
        "FunctionExpression",
      ].includes(node.type)
    ) {
      assert.equal(node.async, false, "async functions are forbidden");
      assert.equal(node.generator, false, "generator functions are forbidden");
    }
    if (node.type === "VariableDeclaration") {
      assert.notEqual(node.kind, "var", "var declarations are forbidden");
    }
    if (node.type === "AssignmentExpression") {
      assert.equal(
        ["Identifier", "MemberExpression"].includes(node.left.type),
        true,
        "destructuring assignments are forbidden",
      );
      if (node.operator !== "=") {
        assert.equal(
          parent?.type === "ForStatement" &&
            parent.update === node &&
            node.operator === "+=" &&
            node.right.type === "Literal" &&
            node.right.value === 1,
          true,
          "compound assignments are limited to counted-loop updates",
        );
      }
    }
    if (node.type === "ForStatement") {
      assert.equal(
        ancestors.some((ancestor) => ancestor.type === "ForStatement"),
        false,
        "candidate loops may not nest",
      );
      assert.equal(node.init?.type, "VariableDeclaration");
      assert.equal(node.init.kind, "let");
      assert.equal(node.init.declarations.length, 1);
      const [counterDeclaration] = node.init.declarations;
      assert.equal(counterDeclaration.id.type, "Identifier");
      assert.equal(counterDeclaration.init?.type, "Literal");
      assert.equal(counterDeclaration.init.value, 0);
      const counterName = counterDeclaration.id.name;
      assert.equal(node.test?.type, "BinaryExpression");
      assert.equal(node.test.operator, "<");
      assert.equal(node.test.left.type, "Identifier");
      assert.equal(node.test.left.name, counterName);
      assert.equal(node.test.right.type, "Literal");
      assert.equal(
        Number.isSafeInteger(node.test.right.value) &&
          node.test.right.value >= 0 &&
          node.test.right.value <= MAX_CANDIDATE_LOOP_ITERATIONS,
        true,
        "candidate loop requires a literal finite upper bound",
      );
      candidateLoopBounds.set(node, node.test.right.value);
      const testCounterWrites = [];
      walkAst(node.test, (candidateNode, candidateParent) => {
        if (
          candidateNode.type === "Identifier" &&
          candidateNode.name === counterName &&
          isMutationTarget(candidateNode, candidateParent)
        ) {
          testCounterWrites.push(candidateNode);
        }
      });
      assert.deepEqual(
        testCounterWrites,
        [],
        "candidate loop test may not rewrite its counter",
      );
      assert.equal(
        (node.update?.type === "UpdateExpression" &&
          node.update.operator === "++" &&
          node.update.argument.type === "Identifier" &&
          node.update.argument.name === counterName) ||
          (node.update?.type === "AssignmentExpression" &&
            node.update.operator === "+=" &&
            node.update.left.type === "Identifier" &&
            node.update.left.name === counterName &&
            node.update.right.type === "Literal" &&
            node.update.right.value === 1),
        true,
        "candidate loop counter must advance by one",
      );
      const bodyCounterWrites = [];
      walkAst(node.body, (candidateNode, candidateParent) => {
        if (
          candidateNode.type === "Identifier" &&
          candidateNode.name === counterName &&
          isMutationTarget(candidateNode, candidateParent)
        ) {
          bodyCounterWrites.push(candidateNode);
        }
      });
      assert.deepEqual(
        bodyCounterWrites,
        [],
        "candidate loop body may not rewrite its counter",
      );
    }
    if (node.type === "ForOfStatement") {
      assert.equal(
        node.left.type,
        "VariableDeclaration",
        "for-of assignment targets must be locally declared",
      );
    }
    if (node.type === "UnaryExpression") {
      assert.notEqual(node.operator, "delete", "delete is forbidden");
      if (
        insideValidation ||
        expressionIsBorrowed(node.argument, containingFunction)
      ) {
        assert.equal(
          ["!", "typeof"].includes(node.operator),
          true,
          "unary operations must not coerce borrowed values",
        );
      }
    }
    if (node.type === "UpdateExpression") {
      assert.equal(
        parent?.type === "ForStatement" && parent.update === node,
        true,
        "updates are limited to counted-loop counters",
      );
    }
    if (node.type === "BinaryExpression" && node.operator === "+") {
      assert.equal(
        ancestors.some(
          (ancestor) =>
            ancestor.type === "ClassDeclaration" &&
            ancestor.id?.name === "G17BenchmarkProductOwnerV4ContractError",
        ),
        true,
        "candidate value growth through addition is forbidden",
      );
    }
    if (
      node.type === "BinaryExpression" &&
      (expressionIsBorrowed(node.left, containingFunction) ||
        expressionIsBorrowed(node.right, containingFunction)) &&
      !ancestors.some(
        (ancestor) =>
          ancestor.type === "ClassDeclaration" &&
          ancestor.id?.name === "G17BenchmarkProductOwnerV4ContractError",
      )
    ) {
      assert.equal(
        ["===", "!=="].includes(node.operator) ||
          isExactBuildOwnerByteBound(node, containingFunction),
        true,
        "binary operations must not coerce borrowed values",
      );
    }
    if (
      ancestors.some((ancestor) => ancestor.type === "ForStatement") &&
      ["ArrayExpression", "ObjectExpression"].includes(node.type)
    ) {
      assert.fail("candidate loops may not grow aggregate values");
    }
    if (node.type === "CallExpression") {
      assert.equal(node.optional, false);
      assert.equal(
        ["Identifier", "MemberExpression", "Super"].includes(node.callee.type),
        true,
        `call target ${node.callee.type} has no admitted origin`,
      );
      if (node.callee.type === "Identifier") {
        assert.equal(
          moduleFunctionBindings.has(node.callee.name) ||
            directCallImports.has(node.callee.name),
          true,
          `direct call ${node.callee.name} has no admitted origin`,
        );
      }
      const borrowedArguments = node.arguments.filter((argument) =>
        expressionIsBorrowed(argument, containingFunction),
      );
      if (borrowedArguments.length > 0) {
        const directLocalCall =
          node.callee.type === "Identifier" &&
          namedFunctionNodes.has(node.callee.name);
        const exactBuildReplay =
          node.callee.type === "Identifier" &&
          node.callee.name === "verifyG17BenchmarkBuildOwnerV3Artifact";
        const freshLiteralFreeze =
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Object" &&
          memberPropertyName(node.callee) === "freeze" &&
          node.arguments.length === 1 &&
          ["ArrayExpression", "ObjectExpression"].includes(
            node.arguments[0].type,
          );
        const exactBorrowedBufferCopy = node === bytesDeclaration.init;
        const exactGuardedDescriptorSnapshot =
          node === inputDescriptorsDeclaration.init ||
          node === descriptorDeclaration.init;
        const exactOwnedDescriptorHasOwn = node === inputBytesCondition.test;
        assert.equal(
          directLocalCall ||
            exactBuildReplay ||
            freshLiteralFreeze ||
            exactBorrowedBufferCopy ||
            exactGuardedDescriptorSnapshot ||
            exactOwnedDescriptorHasOwn ||
            isSafeBorrowedArgumentCall(node) ||
            (insideValidation &&
              node.callee.type === "MemberExpression" &&
              isAllowedValidationMemberCall(node.callee)),
          true,
          "borrowed values may only cross certified call boundaries",
        );
      }
      if (insideValidation) {
        assert.equal(
          (node.callee.type === "Identifier" && node.callee.name === "fail") ||
            (node.callee.type === "MemberExpression" &&
              isAllowedValidationMemberCall(node.callee)),
          true,
          "validation helpers may only call inert inspection operations",
        );
      }
      if (node.callee.type === "MemberExpression") {
        const property = memberPropertyName(node.callee);
        assert.equal(
          isAllowedCandidateMemberCall(node.callee),
          true,
          `member call ${property} has no admitted receiver origin`,
        );
        assert.equal(
          forbiddenMutatingMembers.has(property) ||
            property?.startsWith("swap") ||
            property?.startsWith("write"),
          false,
          `mutating member call ${property} is forbidden`,
        );
        if (
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Object" &&
          property === "freeze"
        ) {
          assert.equal(node.arguments.length, 1);
          assert.equal(
            ["ArrayExpression", "ObjectExpression"].includes(
              node.arguments[0].type,
            ),
            true,
            "Object.freeze must own a fresh literal",
          );
        }
        if (
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "JSON" &&
          property === "parse"
        ) {
          assert.fail(
            "JSON.parse is private to the pinned verified-owner decoder",
          );
        }
        if (
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Object" &&
          property === "getOwnPropertyDescriptors"
        ) {
          assert.equal(node.arguments.length, 1);
          const [reflectedValue] = node.arguments;
          assert.equal(
            reflectedValue.type,
            "Identifier",
            "reflected values must be guarded formal parameters",
          );
          assert.equal(containingFunction?.type, "FunctionDeclaration");
          assert.equal(
            containingFunction.params.some(
              (parameter) =>
                parameter.type === "Identifier" &&
                parameter.name === reflectedValue.name,
            ),
            true,
            "reflected values must be guarded formal parameters",
          );
          if (containingFunction === inputRecordDeclaration) {
            assert.equal(reflectedValue.name, "input");
          } else {
            assertLeadingProxyRejection(
              containingFunction,
              reflectedValue.name,
            );
          }
        }
        if (
          insideValidation &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Object" &&
          ["getPrototypeOf", "hasOwn"].includes(property)
        ) {
          assert.equal(node.arguments.length >= 1, true);
          const [inspectedValue] = node.arguments;
          const ownedDescriptorView =
            inspectedValue.type === "CallExpression" &&
            inspectedValue.callee.type === "MemberExpression" &&
            inspectedValue.callee.computed === false &&
            inspectedValue.callee.object.type === "Identifier" &&
            inspectedValue.callee.object.name === "Object" &&
            memberPropertyName(inspectedValue.callee) ===
              "getOwnPropertyDescriptors";
          const ownedDescriptorAlias = isGuardedDescriptorAlias(
            inspectedValue,
            containingFunction,
          );
          if (!ownedDescriptorView && !ownedDescriptorAlias) {
            assert.equal(
              inspectedValue.type,
              "Identifier",
              `${property} values must be guarded formal parameters or owned descriptor views`,
            );
            assert.equal(containingFunction?.type, "FunctionDeclaration");
            assert.equal(
              containingFunction.params.some(
                (parameter) =>
                  parameter.type === "Identifier" &&
                  parameter.name === inspectedValue.name,
              ),
              true,
              `${property} values must be guarded formal parameters or owned descriptor views`,
            );
            assertLeadingProxyRejection(
              containingFunction,
              inspectedValue.name,
            );
          }
        }
        if (
          insideValidation &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Reflect" &&
          property === "ownKeys"
        ) {
          assert.equal(node.arguments.length, 1);
          const [inspectedValue] = node.arguments;
          const directDescriptorCall =
            inspectedValue.type === "CallExpression" &&
            inspectedValue.callee.type === "MemberExpression" &&
            inspectedValue.callee.computed === false &&
            inspectedValue.callee.object.type === "Identifier" &&
            inspectedValue.callee.object.name === "Object" &&
            memberPropertyName(inspectedValue.callee) ===
              "getOwnPropertyDescriptors";
          assert.equal(
            directDescriptorCall ||
              isGuardedDescriptorAlias(inspectedValue, containingFunction),
            true,
            "Reflect.ownKeys requires an owned descriptor view",
          );
        }
        if (
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Reflect" &&
          property === "ownKeys"
        ) {
          assert.equal(node.arguments.length, 1);
          const [descriptorCall] = node.arguments;
          if (!isGuardedDescriptorAlias(descriptorCall, containingFunction)) {
            assert.equal(descriptorCall.type, "CallExpression");
            assert.equal(descriptorCall.callee.type, "MemberExpression");
            assert.equal(descriptorCall.callee.computed, false);
            assert.equal(descriptorCall.callee.object.type, "Identifier");
            assert.equal(descriptorCall.callee.object.name, "Object");
            assert.equal(
              memberPropertyName(descriptorCall.callee),
              "getOwnPropertyDescriptors",
            );
            assert.equal(descriptorCall.arguments.length, 1);
          }
        }
      }
      if (
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Object" &&
        memberPropertyName(node.callee) === "getPrototypeOf"
      ) {
        assert.equal(
          parent?.type === "BinaryExpression" &&
            ["===", "!=="].includes(parent.operator) &&
            (parent.left === node || parent.right === node),
          true,
          "Object.getPrototypeOf results are strict-comparison-only",
        );
      }
    }
    if (node.type === "NewExpression") {
      assert.equal(
        insideValidation,
        false,
        "validation helpers may not construct values",
      );
      const borrowedArguments = node.arguments.filter((argument) =>
        expressionIsBorrowed(argument, containingFunction),
      );
      if (borrowedArguments.length > 0) {
        assert.equal(
          containingFunction === failDeclaration &&
            node.callee.name === "G17BenchmarkProductOwnerV4ContractError",
          true,
          "borrowed values may not cross constructor boundaries",
        );
      }
      assert.equal(node.callee.type, "Identifier");
      assert.equal(
        moduleClassBindings.has(node.callee.name) ||
          ["Set", "TextDecoder", "TypeError"].includes(node.callee.name),
        true,
        `constructor ${node.callee.name} has no admitted origin`,
      );
      if (node.callee.name === "Set") {
        assert.equal(node.arguments.length, 1);
        assert.equal(node.arguments[0].type, "ArrayExpression");
        assert.equal(node.arguments[0].elements.length <= 64, true);
      }
    }
    if (node.type === "MemberExpression") {
      assert.equal(node.optional, false);
      const property = memberPropertyName(node);
      if (node.computed) {
        assert.equal(
          node.property.type === "Literal" &&
            Number.isSafeInteger(node.property.value) &&
            node.property.value >= 0,
          true,
          "computed members require a non-negative integer literal",
        );
      }
      assert.equal(
        ["__proto__", "apply", "bind", "call", "constructor"].includes(
          property,
        ),
        false,
        `forbidden member ${property}`,
      );
      const root = memberRoot(node);
      if (
        insideValidation &&
        !(
          root.type === "Identifier" &&
          (allowedAmbientMembers.has(root.name) ||
            root.name === "types" ||
            moduleRegexBindings.has(root.name))
        )
      ) {
        const descriptorPath = [];
        let descriptorRoot = node;
        while (descriptorRoot.type === "MemberExpression") {
          descriptorPath.unshift(
            descriptorRoot.computed
              ? descriptorRoot.property.value
              : descriptorRoot.property.name,
          );
          descriptorRoot = descriptorRoot.object;
        }
        const descriptorCall = descriptorRoot;
        const fromDescriptorMap =
          descriptorCall.type === "CallExpression" &&
          descriptorCall.callee.type === "MemberExpression" &&
          descriptorCall.callee.computed === false &&
          descriptorCall.callee.object.type === "Identifier" &&
          descriptorCall.callee.object.name === "Object" &&
          memberPropertyName(descriptorCall.callee) ===
            "getOwnPropertyDescriptors" &&
          descriptorPath.length <= 2 &&
          (descriptorPath.length < 2 ||
            [
              "configurable",
              "enumerable",
              "get",
              "set",
              "value",
              "writable",
            ].includes(descriptorPath[1]));
        const fromReflectionView =
          descriptorCall.type === "CallExpression" &&
          descriptorCall.callee.type === "MemberExpression" &&
          descriptorCall.callee.computed === false &&
          descriptorCall.callee.object.type === "Identifier" &&
          descriptorCall.callee.object.name === "Reflect" &&
          memberPropertyName(descriptorCall.callee) === "ownKeys" &&
          descriptorPath.length === 1 &&
          (descriptorPath[0] === "length" ||
            (Number.isSafeInteger(descriptorPath[0]) &&
              descriptorPath[0] >= 0));
        const fromDescriptorAlias =
          descriptorRoot.type === "Identifier" &&
          isGuardedDescriptorAlias(descriptorRoot, containingFunction) &&
          descriptorPath.length <= 2 &&
          (descriptorPath.length < 2 ||
            [
              "configurable",
              "enumerable",
              "get",
              "set",
              "value",
              "writable",
            ].includes(descriptorPath[1]));
        assert.equal(
          fromDescriptorMap || fromReflectionView || fromDescriptorAlias,
          true,
          "validation member reads require a reflected owned origin",
        );
      }
      if (property === "prototype") {
        assert.fail("prototype access and escape are forbidden");
      }
      if (isMutationTarget(node, parent)) {
        assert.equal(
          node.object.type === "ThisExpression" &&
            ["name", "code", "phase"].includes(property) &&
            ancestors.some(
              (ancestor) =>
                ancestor.type === "ClassDeclaration" &&
                ancestor.id?.name === "G17BenchmarkProductOwnerV4ContractError",
            ) &&
            ancestors.some(
              (ancestor) =>
                ancestor.type === "MethodDefinition" &&
                ancestor.kind === "constructor",
            ),
          true,
          "member writes are limited to public error initialization",
        );
        assert.equal(
          expressionReferencesAmbient(node.object),
          false,
          "values derived from ambient bindings are read-only",
        );
      }
      if (root.type === "Identifier" && allowedAmbientMembers.has(root.name)) {
        assert.equal(
          isMutationTarget(node, parent),
          false,
          `ambient binding ${root.name} is read-only`,
        );
        assert.equal(
          allowedAmbientMembers.get(root.name).has(property),
          true,
          `ambient member ${root.name}.${property} is forbidden`,
        );
      }
      if (root.type === "Identifier" && importedNames.has(root.name)) {
        assert.equal(
          isMutationTarget(node, parent),
          false,
          `imported binding ${root.name} is read-only`,
        );
        if (root.name === "types") {
          assert.equal(property, "isProxy");
          assert.equal(
            parent?.type === "CallExpression" && parent.callee === node,
            true,
            "types.isProxy is direct-callee-only",
          );
        }
      }
      if (root.type === "Identifier" && moduleReadOnlyBindings.has(root.name)) {
        assert.equal(
          isMutationTarget(node, parent),
          false,
          `module binding ${root.name} is read-only`,
        );
      }
    }
    if (node.type === "Property") {
      if (node.kind === "get") {
        artifactByteGetters += 1;
        assert.equal(node.method, false);
        assert.equal(node.computed, false);
        assert.equal(node.key.type, "Identifier");
        assert.equal(node.key.name, "bytes");
        assert.equal(parent?.type, "ObjectExpression");
        const freezeCall = ancestors.at(-2);
        assert.equal(freezeCall?.type, "CallExpression");
        assert.equal(freezeCall.callee.type, "MemberExpression");
        assert.equal(freezeCall.callee.computed, false);
        assert.equal(freezeCall.callee.object.type, "Identifier");
        assert.equal(freezeCall.callee.object.name, "Object");
        assert.equal(memberPropertyName(freezeCall.callee), "freeze");
        assert.deepEqual(freezeCall.arguments, [parent]);
        const artifactFunctions = ancestors.filter((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        );
        assert.deepEqual(artifactFunctions, [artifactFactoryDeclaration]);
        const [storedStatement, artifactReturn] =
          artifactFactoryDeclaration.body.body;
        assert.equal(storedStatement.type, "VariableDeclaration");
        assert.equal(storedStatement.kind, "const");
        assert.equal(storedStatement.declarations.length, 1);
        const [storedDeclaration] = storedStatement.declarations;
        assert.equal(storedDeclaration.id.type, "Identifier");
        assert.equal(storedDeclaration.id.name, "stored");
        assert.equal(storedDeclaration.init?.type, "CallExpression");
        assert.equal(storedDeclaration.init.callee.type, "MemberExpression");
        assert.equal(storedDeclaration.init.callee.computed, false);
        assert.equal(storedDeclaration.init.callee.object.type, "Identifier");
        assert.equal(storedDeclaration.init.callee.object.name, "Buffer");
        assert.equal(memberPropertyName(storedDeclaration.init.callee), "from");
        assert.equal(storedDeclaration.init.arguments.length, 1);
        assert.equal(storedDeclaration.init.arguments[0].type, "Identifier");
        assert.equal(storedDeclaration.init.arguments[0].name, "bytes");
        assert.equal(artifactReturn.type, "ReturnStatement");
        assert.equal(ancestors.at(-3), artifactReturn);
        assert.equal(artifactReturn.argument, freezeCall);
        assert.equal(node.value.type, "FunctionExpression");
        assert.equal(node.value.async, false);
        assert.equal(node.value.generator, false);
        assert.equal(node.value.params.length, 0);
        assert.equal(node.value.body.body.length, 1);
        const [getterReturn] = node.value.body.body;
        assert.equal(getterReturn.type, "ReturnStatement");
        assert.equal(getterReturn.argument?.type, "CallExpression");
        assert.equal(getterReturn.argument.callee.type, "MemberExpression");
        assert.equal(getterReturn.argument.callee.computed, false);
        assert.equal(getterReturn.argument.callee.object.type, "Identifier");
        assert.equal(getterReturn.argument.callee.object.name, "Buffer");
        assert.equal(memberPropertyName(getterReturn.argument.callee), "from");
        assert.deepEqual(
          getterReturn.argument.arguments.map((argument) => {
            assert.equal(argument.type, "Identifier");
            return argument.name;
          }),
          ["stored"],
        );
      } else {
        assert.equal(node.kind, "init", "candidate setters are forbidden");
        assert.equal(
          node.method,
          false,
          "candidate object methods are forbidden",
        );
        assert.equal(
          node.computed,
          false,
          "candidate computed properties are forbidden",
        );
      }
      const property =
        node.key.type === "Identifier" && !node.computed
          ? node.key.name
          : node.key.type === "Literal"
            ? node.key.value
            : null;
      assert.equal(
        property === "__proto__" || property === "constructor",
        false,
        `forbidden property ${property}`,
      );
    }
    if (insideValidation && node.type === "BinaryExpression") {
      assert.equal(
        ["===", "!=="].includes(node.operator) ||
          isExactBuildOwnerByteBound(node, containingFunction),
        true,
        "validation comparisons must not coerce borrowed values",
      );
    }
    if (insideValidation && node.type === "ReturnStatement") {
      assert.equal(
        node.argument,
        null,
        "validation reflection results may not escape",
      );
    }
    if (node.type === "Identifier") {
      if (
        lexical.isReference(node, parent) &&
        ((containingFunction === validateInputDeclaration &&
          node.name === "input") ||
          (containingFunction === validateBuildDeclaration &&
            node.name === "value"))
      ) {
        assert.equal(
          (parent?.type === "UnaryExpression" &&
            parent.operator === "typeof" &&
            parent.argument === node) ||
            (parent?.type === "BinaryExpression" &&
              ["===", "!=="].includes(parent.operator)) ||
            (parent?.type === "CallExpression" &&
              parent.arguments.includes(node) &&
              isSafeBorrowedArgumentCall(parent)),
          true,
          `${node.name} may only be inspected without escape or property access`,
        );
      }
      assert.equal(
        forbiddenIdentifiers.has(node.name),
        false,
        `forbidden ambient identifier ${node.name}`,
      );
      if (
        moduleReadOnlyBindings.has(node.name) &&
        lexical.isReference(node, parent)
      ) {
        assert.equal(
          isMutationTarget(node, parent),
          false,
          `module binding ${node.name} is read-only`,
        );
        const grandparent = ancestors.at(-2);
        assert.equal(
          parent?.type === "VariableDeclarator" ||
            (parent?.type === "MemberExpression" &&
              grandparent?.type === "VariableDeclarator"),
          false,
          `module binding ${node.name} may not be aliased`,
        );
        if (moduleFunctionBindings.has(node.name)) {
          assert.equal(
            parent?.type === "CallExpression" && parent.callee === node,
            true,
            `module function ${node.name} is direct-callee-only`,
          );
        }
        if (moduleClassBindings.has(node.name)) {
          assert.equal(
            (parent?.type === "NewExpression" && parent.callee === node) ||
              (parent?.type === "BinaryExpression" &&
                parent.operator === "instanceof" &&
                parent.right === node),
            true,
            `module class ${node.name} is constructor-or-instanceof-only`,
          );
        }
        if (moduleRegexBindings.has(node.name)) {
          assert.equal(
            parent?.type === "MemberExpression" && parent.object === node,
            true,
            `module regular expression ${node.name} is test-only`,
          );
          assert.equal(memberPropertyName(parent), "test");
          assert.equal(
            grandparent?.type === "CallExpression" &&
              grandparent.callee === parent,
            true,
            `module regular expression ${node.name} is test-only`,
          );
        }
      }
      if (lexical.isReference(node, parent) && !lexical.resolves(node)) {
        assert.equal(
          allowedAmbientBindings.has(node.name),
          true,
          `unbound ambient identifier ${node.name} is forbidden`,
        );
        const grandparent = ancestors.at(-2);
        if (allowedAmbientMembers.has(node.name)) {
          assert.equal(
            parent?.type === "MemberExpression" && parent.object === node,
            true,
            `ambient binding ${node.name} may not be aliased`,
          );
          const property = memberPropertyName(parent);
          assert.equal(
            grandparent?.type === "CallExpression" &&
              grandparent.callee === parent,
            true,
            `ambient member ${node.name}.${property} is direct-callee-only`,
          );
        } else if (
          ["Set", "TextDecoder", "TypeError", "WeakSet"].includes(node.name)
        ) {
          assert.equal(
            parent?.type === "NewExpression" && parent.callee === node,
            true,
            `ambient constructor ${node.name} is new-only`,
          );
        } else if (node.name === "Error") {
          assert.equal(
            (parent?.type === "ClassDeclaration" &&
              parent.superClass === node) ||
              (parent?.type === "BinaryExpression" &&
                parent.operator === "instanceof" &&
                parent.right === node),
            true,
            "Error is limited to superclass and instanceof checks",
          );
        }
      }
      if (importedNames.has(node.name) && parent?.type !== "ImportSpecifier") {
        assert.equal(
          isMutationTarget(node, parent),
          false,
          `imported binding ${node.name} is read-only`,
        );
        if (directCallImports.has(node.name)) {
          assert.equal(
            parent?.type === "CallExpression" && parent.callee === node,
            true,
            `imported function ${node.name} is direct-callee-only`,
          );
        }
        if (node.name === "types") {
          assert.equal(
            parent?.type === "MemberExpression" && parent.object === node,
            true,
            "types binding may only root types.isProxy",
          );
        }
      }
      if (
        node.name === "decodeVerifiedOwnerBeforeBuildReplay" &&
        lexical.isReference(node, parent)
      ) {
        assert.equal(
          parent?.type === "CallExpression" && parent.callee === node,
          true,
          "verified-owner decoder is direct-callee-only",
        );
        assert.equal(containingFunction, verificationPreflightDeclaration);
        assert.equal(parent, preflightDecodeDeclaration.init);
        verifiedOwnerDecoderCalls += 1;
      }
      if (node.name === "snapshotJson" && lexical.isReference(node, parent)) {
        assert.fail(
          "snapshotJson is private to the pinned verified-owner decoder",
        );
      }
      if (
        node.name === "validateVerifiedOwnerBeforeBuildReplay" &&
        lexical.isReference(node, parent)
      ) {
        assert.equal(
          parent?.type === "CallExpression" && parent.callee === node,
          true,
          "verification preflight is direct-callee-only",
        );
        const functionAncestors = ancestors.filter((ancestor) =>
          [
            "FunctionDeclaration",
            "FunctionExpression",
            "ArrowFunctionExpression",
          ].includes(ancestor.type),
        );
        assert.equal(
          functionAncestors.length,
          1,
          "verification preflight must be directly inside the verifier entrypoint",
        );
        const [entrypoint] = functionAncestors;
        assert.equal(entrypoint.type, "FunctionDeclaration");
        assert.equal(
          entrypoint.id?.name,
          "verifyG17BenchmarkProductOwnerV4Artifact",
        );
        assert.equal(parent.arguments.length, 1);
        assert.equal(parent.arguments[0].type, "Identifier");
        assert.equal(parent.arguments[0].name, "envelope");
        const declaration = ancestors.at(-2);
        assert.equal(declaration?.type, "VariableDeclarator");
        assert.equal(declaration.init, parent);
        assert.equal(declaration.id.type, "Identifier");
        assert.equal(declaration.id.name, "verified");
        const statement = ancestors.at(-3);
        assert.equal(statement?.type, "VariableDeclaration");
        assert.equal(statement.kind, "const");
        assert.deepEqual(statement.declarations, [declaration]);
        assert.equal(entrypoint.body.body.length, 3);
        assert.equal(entrypoint.body.body[1], statement);
        verificationPreflightCalls += 1;
      }
      if (
        node.name === "normalizeBuilds" &&
        lexical.isReference(node, parent)
      ) {
        assert.equal(
          parent?.type === "CallExpression" && parent.callee === node,
          true,
          "normalizeBuilds is direct-callee-only",
        );
        const functionAncestors = ancestors.filter((ancestor) =>
          [
            "FunctionDeclaration",
            "FunctionExpression",
            "ArrowFunctionExpression",
          ].includes(ancestor.type),
        );
        assert.equal(
          functionAncestors.length,
          1,
          "normalizeBuilds calls must be directly inside an entrypoint",
        );
        const [containingFunction] = functionAncestors;
        assert.equal(containingFunction?.type, "FunctionDeclaration");
        assert.equal(containingFunction.params.length, 1);
        assert.equal(containingFunction.params[0].type, "Identifier");
        assert.equal(containingFunction.params[0].name, "input");
        assert.equal(parent.arguments.length, 1);
        const buildsMember = parent.arguments[0];
        assert.equal(buildsMember.type, "MemberExpression");
        assert.equal(buildsMember.computed, false);
        assert.equal(memberPropertyName(buildsMember), "builds");
        assert.equal(buildsMember.object.type, "Identifier");
        const envelopeName = buildsMember.object.name;
        const envelopeDeclarations = containingFunction.body.body
          .filter(
            (statement) =>
              statement.type === "VariableDeclaration" &&
              statement.kind === "const",
          )
          .flatMap((statement) => statement.declarations)
          .filter(
            (declaration) =>
              declaration.id.type === "Identifier" &&
              declaration.id.name === envelopeName,
          );
        assert.equal(
          envelopeDeclarations.length,
          1,
          "entrypoint build input must come from one const envelope",
        );
        const envelopeDeclaration = envelopeDeclarations[0];
        assert.equal(envelopeDeclaration.init?.type, "CallExpression");
        assert.equal(envelopeDeclaration.init.callee.type, "Identifier");
        assert.equal(envelopeDeclaration.init.callee.name, "ownDataRecord");
        assert.equal(envelopeDeclaration.init.arguments.length, 1);
        assert.equal(envelopeDeclaration.init.arguments[0].type, "Identifier");
        assert.equal(envelopeDeclaration.init.arguments[0].name, "input");
        assert.equal(envelopeDeclaration.start < parent.start, true);
        const ownerCall = ancestors.at(-2);
        assert.equal(ownerCall?.type, "CallExpression");
        assert.equal(ownerCall.callee.type, "Identifier");
        assert.equal(ownerCall.callee.name, "expectedOwner");
        assert.equal(ownerCall.arguments.length, 3);
        assert.equal(ownerCall.arguments[0].type, "Identifier");
        assert.equal(ownerCall.arguments[1].type, "Identifier");
        assert.equal(ownerCall.arguments[1].name, envelopeName);
        assert.equal(ownerCall.arguments[2], parent);
        const entrypointReturn = ancestors.at(-3);
        assert.equal(entrypointReturn?.type, "ReturnStatement");
        assert.equal(
          entrypointReturn.argument,
          ownerCall,
          "entrypoint must directly return the owner result",
        );
        const verificationEntrypoint =
          containingFunction.id?.name ===
          "verifyG17BenchmarkProductOwnerV4Artifact";
        assert.equal(
          containingFunction.body.body.length,
          verificationEntrypoint ? 3 : 2,
        );
        assert.equal(
          containingFunction.body.body[0].type,
          "VariableDeclaration",
        );
        assert.equal(containingFunction.body.body[0].kind, "const");
        assert.equal(containingFunction.body.body[0].declarations.length, 1);
        assert.equal(
          containingFunction.body.body[0].declarations[0],
          envelopeDeclaration,
        );
        if (verificationEntrypoint) {
          const preflightStatement = containingFunction.body.body[1];
          assert.equal(preflightStatement.type, "VariableDeclaration");
          assert.equal(preflightStatement.kind, "const");
          assert.equal(preflightStatement.declarations.length, 1);
          const verifiedDeclaration = preflightStatement.declarations[0];
          assert.equal(verifiedDeclaration.id.type, "Identifier");
          assert.equal(verifiedDeclaration.id.name, "verified");
          assert.equal(verifiedDeclaration.init?.type, "CallExpression");
          assert.equal(verifiedDeclaration.init.callee.type, "Identifier");
          assert.equal(
            verifiedDeclaration.init.callee.name,
            "validateVerifiedOwnerBeforeBuildReplay",
          );
          assert.deepEqual(
            verifiedDeclaration.init.arguments.map((argument) => {
              assert.equal(argument.type, "Identifier");
              return argument.name;
            }),
            [envelopeName],
          );
          assert.equal(ownerCall.arguments[0].type, "Identifier");
          assert.equal(
            ownerCall.arguments[0].name,
            verifiedDeclaration.id.name,
          );
          assert.equal(preflightStatement.start < parent.start, true);
          assert.equal(containingFunction.body.body[2], entrypointReturn);
        } else {
          assert.equal(ownerCall.arguments[0].type, "Identifier");
          assert.equal(ownerCall.arguments[0].name, "undefined");
          assert.equal(containingFunction.body.body[1], entrypointReturn);
        }
        assert.equal(
          ancestors.some((ancestor) =>
            [
              "ConditionalExpression",
              "DoWhileStatement",
              "ForOfStatement",
              "ForStatement",
              "IfStatement",
              "LogicalExpression",
              "WhileStatement",
            ].includes(ancestor.type),
          ),
          false,
          "entrypoint build replay may not be conditional",
        );
        const earlierEntrypointBoundaries = [];
        walkAst(
          containingFunction.body,
          (candidateNode, _candidateParent, nested) => {
            if (
              nested.some((ancestor) =>
                [
                  "ArrowFunctionExpression",
                  "FunctionDeclaration",
                  "FunctionExpression",
                ].includes(ancestor.type),
              )
            ) {
              return;
            }
            if (
              (candidateNode.type === "ReturnStatement" ||
                candidateNode.type === "ThrowStatement") &&
              !ancestors.includes(candidateNode) &&
              candidateNode.start < parent.start
            ) {
              earlierEntrypointBoundaries.push(candidateNode.start);
            }
          },
        );
        assert.deepEqual(
          earlierEntrypointBoundaries,
          [],
          "entrypoint may not return or throw before build replay",
        );
        if (
          containingFunction.id?.name ===
          "createG17BenchmarkProductOwnerV4Artifact"
        ) {
          createNormalizationCalls += 1;
        } else if (
          containingFunction.id?.name ===
          "verifyG17BenchmarkProductOwnerV4Artifact"
        ) {
          verifyNormalizationCalls += 1;
        } else {
          assert.fail(
            "normalizeBuilds call is outside create/verify entrypoints",
          );
        }
      }
      if (node.name === "snapshotBuilds" && lexical.isReference(node, parent)) {
        assert.equal(
          parent?.type === "CallExpression" && parent.callee === node,
          true,
          "snapshotBuilds is direct-callee-only",
        );
        assert.equal(parent.arguments.length, 1);
        assert.equal(parent.arguments[0].type, "Identifier");
        assert.equal(parent.arguments[0].name, "builds");
        const functionAncestors = ancestors.filter((ancestor) =>
          [
            "FunctionDeclaration",
            "FunctionExpression",
            "ArrowFunctionExpression",
          ].includes(ancestor.type),
        );
        assert.deepEqual(functionAncestors, [normalizationDeclaration]);
        snapshotCalls += 1;
      }
      if (node.name === "expectedOwner" && lexical.isReference(node, parent)) {
        assert.equal(
          parent?.type === "CallExpression" && parent.callee === node,
          true,
          "expectedOwner is direct-callee-only",
        );
        assert.equal(parent.arguments.length, 3);
        assert.equal(parent.arguments[0].type, "Identifier");
        assert.equal(parent.arguments[1].type, "Identifier");
        assert.equal(parent.arguments[2].type, "CallExpression");
        assert.equal(parent.arguments[2].callee.type, "Identifier");
        assert.equal(parent.arguments[2].callee.name, "normalizeBuilds");
        const entrypointReturn = ancestors.at(-2);
        assert.equal(entrypointReturn?.type, "ReturnStatement");
        assert.equal(entrypointReturn.argument, parent);
        ownerCalls += 1;
      }
    }
    if (node.type !== "ImportSpecifier") {
      for (const name of declaredNames(node)) {
        assert.equal(
          allowedAmbientBindings.has(name),
          false,
          `candidate may not shadow ambient binding ${name}`,
        );
        assert.equal(
          importedNames.has(name),
          false,
          `candidate may not shadow imported binding ${name}`,
        );
        if (moduleReadOnlyDeclarations.has(name)) {
          assert.equal(
            node === moduleReadOnlyDeclarations.get(name),
            true,
            `candidate may not shadow module binding ${name}`,
          );
        }
        if (
          name === "normalizeBuilds" ||
          name === "snapshotBuilds" ||
          name === "snapshotBuild" ||
          name === "snapshotJson" ||
          name === "decodeVerifiedOwnerBeforeBuildReplay" ||
          name === "created" ||
          name === "ownerContentHash" ||
          name === "expectedOwner" ||
          name === "ownDataRecord" ||
          name === "validateVerifiedOwnerBeforeBuildReplay" ||
          name === "fail"
        ) {
          const protectedDeclaration = {
            created: createdDeclaration,
            ownerContentHash: ownerContentHashDeclaration,
            expectedOwner: ownerDeclaration,
            fail: failDeclaration,
            normalizeBuilds: normalizationDeclaration,
            ownDataRecord: inputRecordDeclaration,
            snapshotBuild: snapshotBuildDeclaration,
            snapshotBuilds: snapshotDeclaration,
            snapshotJson: jsonSnapshotDeclaration,
            decodeVerifiedOwnerBeforeBuildReplay:
              verifiedOwnerDecoderDeclaration,
            validateVerifiedOwnerBeforeBuildReplay:
              verificationPreflightDeclaration,
          }[name];
          assert.equal(
            node === protectedDeclaration,
            true,
            `${name} may not be shadowed`,
          );
        }
      }
    }
    if (
      node.type === "Identifier" &&
      node.name === "verifyG17BenchmarkBuildOwnerV3Artifact"
    ) {
      if (parent?.type === "ImportSpecifier") return;
      assert.equal(
        parent?.type === "CallExpression" && parent.callee === node,
        true,
        "S6 verifier binding may only be used as a direct callee",
      );
      assert.equal(parent.arguments.length, 1);
      const replayInput = parent.arguments[0];
      assert.equal(replayInput.type, "ObjectExpression");
      assert.deepEqual(
        replayInput.properties.map((property) => {
          assert.equal(property.type, "Property");
          assert.equal(property.kind, "init");
          assert.equal(property.computed, false);
          assert.equal(property.shorthand, true);
          assert.equal(property.key.type, "Identifier");
          assert.equal(property.value.type, "Identifier");
          assert.equal(property.key.name, property.value.name);
          return property.key.name;
        }),
        ["bytes", "fixture"],
      );
      const functionAncestors = ancestors.filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      );
      assert.equal(functionAncestors.length, 2);
      const [normalizationFunction, mapCallback] = functionAncestors;
      assert.equal(normalizationFunction.type, "FunctionDeclaration");
      assert.equal(normalizationFunction.id?.name, "normalizeBuilds");
      assert.equal(mapCallback.type, "ArrowFunctionExpression");
      assert.equal(mapCallback.params.length, 1);
      assert.equal(mapCallback.params[0].type, "ObjectPattern");
      assert.deepEqual(
        mapCallback.params[0].properties.map((property) => {
          assert.equal(property.type, "Property");
          assert.equal(property.kind, "init");
          assert.equal(property.computed, false);
          assert.equal(property.shorthand, true);
          assert.equal(property.key.type, "Identifier");
          assert.equal(property.value.type, "Identifier");
          assert.equal(property.key.name, property.value.name);
          return property.key.name;
        }),
        ["bytes", "fixture"],
      );
      const mapCall = ancestors.at(ancestors.indexOf(mapCallback) - 1);
      assert.equal(mapCall?.type, "CallExpression");
      assert.deepEqual(mapCall.arguments, [mapCallback]);
      assert.equal(mapCall.callee.type, "MemberExpression");
      assert.equal(mapCall.callee.computed, false);
      assert.equal(memberPropertyName(mapCall.callee), "map");
      const snapshotCall = mapCall.callee.object;
      assert.equal(snapshotCall.type, "CallExpression");
      assert.equal(snapshotCall.callee.type, "Identifier");
      assert.equal(snapshotCall.callee.name, "snapshotBuilds");
      assert.equal(snapshotCall.arguments.length, 1);
      assert.equal(snapshotCall.arguments[0].type, "Identifier");
      assert.equal(snapshotCall.arguments[0].name, "builds");
      const normalizationReturn = ancestors.find(
        (ancestor) => ancestor.type === "ReturnStatement",
      );
      assert.notEqual(
        normalizationReturn,
        undefined,
        "build map must be returned by normalizeBuilds",
      );
      assert.equal(
        normalizationReturn.argument,
        mapCall,
        "normalizeBuilds must directly return the replay map",
      );
      const replayAssignment = ancestors.at(-2);
      assert.equal(replayAssignment?.type, "AssignmentExpression");
      assert.equal(replayAssignment.operator, "=");
      assert.equal(replayAssignment.left.type, "Identifier");
      assert.equal(replayAssignment.left.name, "replay");
      assert.equal(replayAssignment.right, parent);
      assert.equal(mapCallback.body.type, "BlockStatement");
      assert.equal(mapCallback.body.body.length, 3);
      const [replayStatement, replayTry, replayReturn] = mapCallback.body.body;
      assert.equal(replayStatement.type, "VariableDeclaration");
      assert.equal(replayStatement.kind, "let");
      assert.equal(replayStatement.declarations.length, 1);
      const replayDeclaration = replayStatement.declarations[0];
      assert.equal(replayDeclaration.id.type, "Identifier");
      assert.equal(replayDeclaration.id.name, "replay");
      assert.equal(replayDeclaration.init, null);
      assert.equal(replayTry.type, "TryStatement");
      assert.equal(replayTry.block.body.length, 1);
      assert.equal(replayTry.block.body[0].type, "ExpressionStatement");
      assert.equal(replayTry.block.body[0].expression, replayAssignment);
      assert.notEqual(replayTry.handler, null);
      assert.equal(replayTry.handler.param.type, "Identifier");
      assert.equal(replayTry.handler.param.name, "error");
      assert.equal(replayTry.handler.body.body.length, 1);
      assert.equal(replayTry.handler.body.body[0].type, "ExpressionStatement");
      const replayFailure = replayTry.handler.body.body[0].expression;
      assert.equal(replayFailure.type, "CallExpression");
      assert.equal(replayFailure.callee.type, "Identifier");
      assert.equal(replayFailure.callee.name, "fail");
      assert.equal(replayFailure.arguments.length, 4);
      assert.equal(replayFailure.arguments[0].type, "Literal");
      assert.equal(replayFailure.arguments[0].value, "BUILD_OWNER_INVALID");
      assert.equal(replayFailure.arguments[1].type, "Literal");
      assert.equal(replayFailure.arguments[1].value, "build-owner-replay");
      assert.equal(replayFailure.arguments[2].type, "Literal");
      assert.equal(typeof replayFailure.arguments[2].value, "string");
      assert.equal(replayFailure.arguments[3].type, "Identifier");
      assert.equal(replayFailure.arguments[3].name, "error");
      assert.equal(replayTry.finalizer, null);
      assert.equal(replayReturn.type, "ReturnStatement");
      const replayWrites = [];
      walkAst(mapCallback.body, (candidateNode, candidateParent) => {
        if (
          candidateNode.type === "Identifier" &&
          candidateNode.name === "replay" &&
          isMutationTarget(candidateNode, candidateParent)
        ) {
          replayWrites.push(candidateNode);
        }
      });
      assert.equal(replayWrites.length, 1);
      assert.equal(replayWrites[0], replayAssignment.left);
      const frozenReplay = replayReturn.argument;
      assert.equal(frozenReplay.type, "CallExpression");
      assert.equal(frozenReplay.callee.type, "MemberExpression");
      assert.equal(frozenReplay.callee.computed, false);
      assert.equal(frozenReplay.callee.object.type, "Identifier");
      assert.equal(frozenReplay.callee.object.name, "Object");
      assert.equal(memberPropertyName(frozenReplay.callee), "freeze");
      assert.equal(frozenReplay.arguments.length, 1);
      assert.equal(frozenReplay.arguments[0].type, "ObjectExpression");
      assert.deepEqual(
        frozenReplay.arguments[0].properties.map((property) => {
          assert.equal(property.type, "Property");
          assert.equal(property.kind, "init");
          assert.equal(property.computed, false);
          assert.equal(property.shorthand, true);
          assert.equal(property.key.type, "Identifier");
          assert.equal(property.value.type, "Identifier");
          assert.equal(property.key.name, property.value.name);
          return property.key.name;
        }),
        ["bytes", "fixture", "replay"],
      );
      const earlierNormalizationBoundaries = [];
      walkAst(
        normalizationFunction.body,
        (candidateNode, _candidateParent, nested) => {
          if (
            nested.some((ancestor) =>
              [
                "ArrowFunctionExpression",
                "FunctionDeclaration",
                "FunctionExpression",
              ].includes(ancestor.type),
            )
          ) {
            return;
          }
          if (
            candidateNode !== normalizationReturn &&
            (candidateNode.type === "ReturnStatement" ||
              candidateNode.type === "ThrowStatement") &&
            candidateNode.start < normalizationReturn.start
          ) {
            earlierNormalizationBoundaries.push(candidateNode.start);
          }
        },
      );
      assert.deepEqual(
        earlierNormalizationBoundaries,
        [],
        "normalizeBuilds may not return or throw before the build map",
      );
      assert.equal(
        ancestors.some((ancestor) =>
          [
            "ConditionalExpression",
            "DoWhileStatement",
            "ForOfStatement",
            "ForStatement",
            "IfStatement",
            "LogicalExpression",
            "SwitchCase",
            "WhileStatement",
          ].includes(ancestor.type),
        ),
        false,
        "S6 verifier call may not be conditionally unreachable",
      );
      verifierCalls += 1;
    }
  });
  assert.equal(
    artifactByteGetters,
    1,
    "candidate requires one exact copy-on-read artifact bytes getter",
  );
  const functionDeclarations = new Map();
  for (const node of program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type !== "FunctionDeclaration") continue;
    assert.equal(
      functionDeclarations.has(declaration.id.name),
      false,
      `duplicate function ${declaration.id.name}`,
    );
    functionDeclarations.set(declaration.id.name, declaration);
  }
  const staticWorkOverflow = MAX_CANDIDATE_STATIC_WORK + 1n;
  const saturatingAdd = (left, right) => {
    if (left >= staticWorkOverflow || right >= staticWorkOverflow) {
      return staticWorkOverflow;
    }
    const result = left + right;
    return result > MAX_CANDIDATE_STATIC_WORK ? staticWorkOverflow : result;
  };
  const saturatingMultiply = (left, right) => {
    if (left === 0n || right === 0n) return 0n;
    if (left >= staticWorkOverflow || right >= staticWorkOverflow) {
      return staticWorkOverflow;
    }
    if (left > MAX_CANDIDATE_STATIC_WORK / right) {
      return staticWorkOverflow;
    }
    return left * right;
  };
  const astChildren = (node) =>
    Object.values(node).flatMap((value) => {
      if (Array.isArray(value)) {
        return value.filter(
          (child) => child !== null && typeof child?.type === "string",
        );
      }
      return value !== null && typeof value?.type === "string" ? [value] : [];
    });
  const functionSummaries = new Map();
  for (const [name, declaration] of functionDeclarations) {
    const summary = {
      allocatesAggregate: false,
      edges: new Map(),
      hasLoop: false,
      localWork: 0n,
    };
    if (declaration === jsonSnapshotDeclaration) {
      summary.hasLoop = true;
      summary.localWork = MAX_CANDIDATE_STATIC_WORK / 4n;
      functionSummaries.set(name, summary);
      continue;
    }
    if (declaration === verifiedOwnerDecoderDeclaration) {
      summary.edges.set("snapshotJson", 1n);
      summary.localWork = MAX_CANDIDATE_STATIC_WORK / 8n;
      functionSummaries.set(name, summary);
      continue;
    }
    const stack = [
      { multiplier: 1n, node: declaration.body, parent: declaration },
    ];
    while (stack.length > 0) {
      const current = stack.pop();
      const { multiplier, node, parent } = current;
      if (
        name !== "fail" &&
        ["ArrayExpression", "ObjectExpression"].includes(node.type)
      ) {
        summary.allocatesAggregate = true;
      }
      let operationWeight = 1n;
      if (
        node.type === "NewExpression" ||
        (node.type === "CallExpression" &&
          (node.callee.type === "MemberExpression" ||
            (node.callee.type === "Identifier" &&
              directCallImports.has(node.callee.name))))
      ) {
        let boundedIntrinsic =
          name === "fail" &&
          node.type === "NewExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === "G17BenchmarkProductOwnerV4ContractError";
        if (
          node.type === "CallExpression" &&
          node.callee.type === "MemberExpression"
        ) {
          const property = memberPropertyName(node.callee);
          const object = node.callee.object;
          boundedIntrinsic ||=
            object.type === "Identifier" &&
            ((object.name === "Array" && property === "isArray") ||
              (object.name === "Buffer" && property === "isBuffer") ||
              (object.name === "Number" &&
                ["isFinite", "isSafeInteger"].includes(property)) ||
              (object.name === "Object" &&
                (["freeze", "getPrototypeOf", "is"].includes(property) ||
                  (property === "hasOwn" &&
                    node.arguments.length === 2 &&
                    node.arguments[1].type === "Literal" &&
                    typeof node.arguments[1].value === "string"))) ||
              (object.name === "types" && property === "isProxy") ||
              (object.name ===
                "G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES" &&
                property === "includes"));
          boundedIntrinsic ||=
            property === "map" &&
            object.type === "CallExpression" &&
            object.callee.type === "Identifier" &&
            object.callee.name === "snapshotBuilds";
        }
        operationWeight = boundedIntrinsic
          ? CANDIDATE_BOUNDED_INTRINSIC_WORK
          : BigInt(MAX_CANDIDATE_LOOP_ITERATIONS);
      }
      summary.localWork = saturatingAdd(
        summary.localWork,
        saturatingMultiply(multiplier, operationWeight),
      );
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        functionDeclarations.has(node.callee.name)
      ) {
        summary.edges.set(
          node.callee.name,
          saturatingAdd(summary.edges.get(node.callee.name) ?? 0n, multiplier),
        );
      }
      if (node.type === "ForStatement") {
        summary.hasLoop = true;
        const loopBound = candidateLoopBounds.get(node);
        assert.notEqual(loopBound, undefined, "candidate loop bound missing");
        const iterations = BigInt(loopBound);
        for (const [child, childMultiplier] of [
          [node.init, multiplier],
          [node.test, saturatingMultiply(multiplier, iterations + 1n)],
          [node.update, saturatingMultiply(multiplier, iterations)],
          [
            node.body,
            saturatingMultiply(multiplier, iterations === 0n ? 1n : iterations),
          ],
        ]) {
          if (child !== null) {
            stack.push({
              multiplier: childMultiplier,
              node: child,
              parent: node,
            });
          }
        }
        continue;
      }
      let childMultiplier = multiplier;
      if (
        node.type === "ArrowFunctionExpression" &&
        parent?.type === "CallExpression" &&
        parent.arguments.includes(node) &&
        parent.callee.type === "MemberExpression" &&
        memberPropertyName(parent.callee) === "map"
      ) {
        childMultiplier = saturatingMultiply(
          multiplier,
          BigInt(G17_BENCHMARK_BUILD_PLAN.length),
        );
      }
      const children = astChildren(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        stack.push({
          multiplier:
            node.type === "ArrowFunctionExpression" && child === node.body
              ? childMultiplier
              : multiplier,
          node: child,
          parent: node,
        });
      }
    }
    functionSummaries.set(name, summary);
  }
  const indegrees = new Map(
    [...functionDeclarations.keys()].map((name) => [name, 0]),
  );
  for (const summary of functionSummaries.values()) {
    for (const target of summary.edges.keys()) {
      indegrees.set(target, indegrees.get(target) + 1);
    }
  }
  const readyFunctions = [...indegrees]
    .filter(([, indegree]) => indegree === 0)
    .map(([name]) => name)
    .sort();
  const topologicalFunctions = [];
  for (let index = 0; index < readyFunctions.length; index += 1) {
    const name = readyFunctions[index];
    topologicalFunctions.push(name);
    for (const target of functionSummaries.get(name).edges.keys()) {
      const nextIndegree = indegrees.get(target) - 1;
      indegrees.set(target, nextIndegree);
      if (nextIndegree === 0) readyFunctions.push(target);
    }
  }
  assert.equal(
    topologicalFunctions.length,
    functionDeclarations.size,
    `recursive function cycle at ${[...indegrees]
      .filter(([, indegree]) => indegree > 0)
      .map(([name]) => name)
      .sort()
      .join(",")}`,
  );
  const functionMetrics = new Map();
  for (const name of [...topologicalFunctions].reverse()) {
    const summary = functionSummaries.get(name);
    let callDepth = 1;
    let reachesAggregate = summary.allocatesAggregate;
    let reachesLoop = summary.hasLoop;
    let transitiveWork = summary.localWork;
    for (const [target, multiplicity] of summary.edges) {
      const targetMetric = functionMetrics.get(target);
      assert.notEqual(targetMetric, undefined);
      callDepth = Math.max(callDepth, targetMetric.callDepth + 1);
      transitiveWork = saturatingAdd(
        transitiveWork,
        saturatingMultiply(multiplicity, targetMetric.transitiveWork),
      );
      if (summary.hasLoop && targetMetric.reachesLoop) {
        assert.fail(`candidate loop-to-loop call path ${name} -> ${target}`);
      }
      if (summary.hasLoop && targetMetric.reachesAggregate) {
        assert.fail(
          `candidate loop-to-aggregate call path ${name} -> ${target}`,
        );
      }
      reachesAggregate ||= targetMetric.reachesAggregate;
      reachesLoop ||= targetMetric.reachesLoop;
    }
    assert.equal(
      callDepth <= MAX_CANDIDATE_CALL_DEPTH,
      true,
      `candidate call depth exceeds bound at ${name}`,
    );
    assert.equal(
      transitiveWork <= MAX_CANDIDATE_STATIC_WORK,
      true,
      `candidate static work exceeds bound at ${name}`,
    );
    functionMetrics.set(name, {
      callDepth,
      reachesAggregate,
      reachesLoop,
      transitiveWork,
    });
  }
  const argumentIdentityKeys = (argument, containing) => {
    const identities = new Set();
    const stack = [{ node: argument, parent: null }];
    while (stack.length > 0) {
      const { node: current, parent } = stack.pop();
      if (
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(current.type)
      ) {
        continue;
      }
      if (
        current.type === "CallExpression" ||
        current.type === "NewExpression"
      ) {
        if (current.type === "CallExpression") {
          const returnedIdentities = identityAliasNames(current, containing);
          if (returnedIdentities.size > 0) {
            for (const identity of returnedIdentities) {
              identities.add(identity);
            }
            continue;
          }
        }
        for (const nestedArgument of current.arguments) {
          stack.push({ node: nestedArgument, parent: current });
        }
        continue;
      }
      if (current.type === "MemberExpression") {
        for (const identity of identityAliasNames(current, containing)) {
          identities.add(identity);
        }
        continue;
      }
      if (
        current.type === "Identifier" &&
        lexical.isReference(current, parent) &&
        lexical.resolves(current) &&
        (!importedNames.has(current.name) ||
          aggregateReadOnlyBindings.has(current.name))
      ) {
        if (aggregateReadOnlyBindings.has(current.name)) {
          for (const identity of aggregateReadOnlyIdentities.get(
            current.name,
          )) {
            identities.add(identity);
          }
        } else if (!moduleReadOnlyBindings.has(current.name)) {
          identities.add(aliasFind(containing, current.name));
        }
        continue;
      }
      for (const child of astChildren(current)) {
        stack.push({ node: child, parent: current });
      }
    }
    return identities;
  };
  walkAst(program, (node, _parent, ancestors) => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      !functionMetrics.get(node.callee.name)?.reachesAggregate
    ) {
      return;
    }
    const containing = ancestors
      .filter((ancestor) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(ancestor.type),
      )
      .at(-1);
    if (
      containing === undefined ||
      containing === canonicalBytesDeclaration ||
      containing === ownerContentHashDeclaration ||
      containing === snapshotDeclaration ||
      containing === jsonSnapshotDeclaration ||
      containing === verifiedOwnerDecoderDeclaration
    ) {
      return;
    }
    const seen = new Set();
    for (const argument of node.arguments) {
      for (const identity of argumentIdentityKeys(argument, containing)) {
        assert.equal(
          seen.has(identity),
          false,
          `candidate aggregate-producing call ${node.callee.name} duplicates ${identity}`,
        );
        seen.add(identity);
      }
    }
  });
  assert.equal(
    verifierCalls,
    1,
    "candidate must directly call the S6 verifier once",
  );
  assert.equal(snapshotCalls, 1);
  assert.equal(ownerCalls, 2);
  assert.equal(createNormalizationCalls, 1);
  assert.equal(verifyNormalizationCalls, 1);
  assert.equal(
    verificationPreflightCalls,
    1,
    "candidate must perform one verification preflight before build replay",
  );
  assert.equal(
    verifiedOwnerDecoderCalls,
    1,
    "candidate must decode the verified owner exactly once before build replay",
  );
}

function exactCandidateImportUrl(source, sourceBytes) {
  const program = parseCandidateSource(source);
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
  return `data:text/javascript;base64,${payload}#source-sha256=${sha256(
    sourceBytes,
  )}`;
}

async function loadCandidateForEvaluation(
  presence,
  {
    readSource = readBoundedCandidateSource,
    importSource = (url) => import(url),
    validateSource = assertCandidateSourceStructure,
  } = {},
) {
  if (!presence.present) throw missingCandidateSourceError();
  assert.equal(
    presence.regular,
    true,
    "candidate source must be a regular file",
  );
  assert.equal(
    Number.isSafeInteger(presence.size) &&
      presence.size >= 0 &&
      presence.size <= MAX_CANDIDATE_SOURCE_BYTES,
    true,
    "candidate source size is invalid",
  );
  const sourceBytes = await readSource(presence);
  assert.equal(Buffer.isBuffer(sourceBytes), true, "candidate source bytes");
  assert.equal(
    sourceBytes.length,
    presence.size,
    "candidate source changed during bounded read",
  );
  let source;
  try {
    source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(sourceBytes);
  } catch (error) {
    throw new Error(`candidate source is not valid UTF-8: ${error.message}`);
  }
  validateSource(source);
  const importUrl = exactCandidateImportUrl(source, sourceBytes);
  const loaded = await importSource(importUrl);
  return Object.freeze({ candidate: loaded, importUrl, source });
}

async function readBoundedCandidateSource(presence) {
  assert.notEqual(presence.handle, undefined, "candidate source handle");
  const capacity = presence.size + 1;
  assert.equal(
    capacity <= MAX_CANDIDATE_SOURCE_BYTES + 1,
    true,
    "candidate source read capacity",
  );
  const buffer = Buffer.alloc(capacity);
  let offset = 0;
  while (offset < capacity) {
    const { bytesRead } = await presence.handle.read(
      buffer,
      offset,
      capacity - offset,
      offset,
    );
    assert.equal(
      Number.isSafeInteger(bytesRead) && bytesRead >= 0,
      true,
      "candidate source read result",
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  const after = await presence.handle.stat({ bigint: true });
  assert.equal(after.isFile(), true, "candidate source must remain regular");
  assert.deepEqual(
    {
      device: after.dev,
      inode: after.ino,
      size: after.size,
      modifiedNanoseconds: after.mtimeNs,
      changedNanoseconds: after.ctimeNs,
    },
    presence.identity,
    "candidate source changed during bounded handle read",
  );
  assert.equal(
    offset,
    presence.size,
    "candidate source changed during bounded handle read",
  );
  return buffer.subarray(0, offset);
}

async function sourcePresence({ openSource = open } = {}) {
  let handle;
  try {
    handle = await openSource(
      SOURCE_URL,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat({ bigint: true });
    return {
      present: true,
      regular: stat.isFile(),
      size: Number(stat.size),
      identity: Object.freeze({
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
        modifiedNanoseconds: stat.mtimeNs,
        changedNanoseconds: stat.ctimeNs,
      }),
      handle,
    };
  } catch (error) {
    if (handle !== undefined) await handle.close();
    if (error?.code === "ENOENT") return { present: false };
    throw error;
  }
}

function missingCandidateSourceError() {
  const error = new Error(
    `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
  );
  error.code = "ERR_MODULE_NOT_FOUND";
  error.url = SOURCE_URL.href;
  return error;
}

function exactMissingSourceError(error, presence) {
  return (
    !presence.present &&
    error !== null &&
    typeof error === "object" &&
    error.code === "ERR_MODULE_NOT_FOUND" &&
    error.url === SOURCE_URL.href &&
    error.message ===
      `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`
  );
}

const presence = await sourcePresence();
let candidate = null;
let candidateSource = null;
let candidateImportError = null;
let candidateImportAttempts = 0;
try {
  const loaded = await loadCandidateForEvaluation(presence, {
    importSource: async (url) => {
      candidateImportAttempts += 1;
      return import(url);
    },
  });
  candidate = loaded.candidate;
  candidateSource = loaded.source;
} catch (error) {
  if (!exactMissingSourceError(error, presence)) throw error;
  candidateImportError = error;
} finally {
  if (presence.present) await presence.handle.close();
}

function candidateTest(name, body) {
  test(
    name,
    {
      skip:
        candidate === null
          ? "candidate product-owner-v4 source is intentionally absent"
          : false,
    },
    body,
  );
}

test.after(cleanupG17PrivateOwnerV3Fixtures);

test("ADR-0041 S7 pins exact S6 and legacy product-owner predecessors", async () => {
  for (const [path, expectedBytes, expectedSha256] of PREDECESSORS) {
    const bytes = await readFile(new URL(path, import.meta.url));
    assert.equal(bytes.length, expectedBytes, path);
    assert.equal(sha256(bytes), expectedSha256, path);
  }
});

test("ADR-0041 S7 reference freezes the authority-null product-owner-v4 contract", async () => {
  await assertCandidateContract(createReferenceCandidate());
});

test("ADR-0041 S7 source policy keeps product-owner-v4 pure and additive", async () => {
  const imports = [
    'import { createHash } from "node:crypto";',
    'import { isDeepStrictEqual, types } from "node:util";',
    'import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";',
    'import { G17_BENCHMARK_BUILD_PLAN, G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA, G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256, G17_BENCHMARK_EXECUTION_PLAN_SCHEMA, G17_BENCHMARK_EXECUTION_PLAN_SHA256 } from "./benchmark-execution-plan.mjs";',
    'import { G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY, G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES, G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS, verifyG17BenchmarkBuildOwnerV3Artifact } from "./benchmark-build-owner-v3-contract.mjs";',
  ].join("\n");
  const exports = EXPECTED_EXPORTS.filter(
    (name) =>
      name !== "createG17BenchmarkProductOwnerV4Artifact" &&
      name !== "verifyG17BenchmarkProductOwnerV4Artifact" &&
      name !== "G17BenchmarkProductOwnerV4ContractError",
  )
    .map((name) => `export const ${name} = 0;`)
    .join("\n");
  const errorClass =
    'export class G17BenchmarkProductOwnerV4ContractError extends Error { constructor(code, phase, message, ...options) { if (!G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES.includes(code)) { throw new TypeError("unknown product-owner-v4 code"); } if (typeof phase !== "string" || typeof message !== "string") { throw new TypeError("invalid product-owner-v4 error fields"); } super("G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message, options[0]); this.name = "G17BenchmarkProductOwnerV4ContractError"; this.code = code; this.phase = phase; } }';
  const pureInitializer =
    "const PURE_INITIALIZER_FIXTURE = Object.freeze({ plan: G17_BENCHMARK_BUILD_PLAN, limits: Object.freeze([1, 2]) });";
  const normalizer =
    'function normalizeBuilds(builds) { return snapshotBuilds(builds).map(({ bytes, fixture }) => { let replay; try { replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); } catch (error) { fail("BUILD_OWNER_INVALID", "build-owner-replay", "S6 build owner did not replay", error); } return Object.freeze({ bytes, fixture, replay }); }); }';
  const snapshotter = PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE;
  const inputValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } }';
  const buildValidator =
    'function validateBuild(value, index) { if (types.isProxy(value)) { fail("INPUT_SHAPE_INVALID", "input-shape", "build proxy"); } }';
  const reflectedInputValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const descriptors = Object.getOwnPropertyDescriptors(input); if (Reflect.ownKeys(descriptors).length !== 1 || typeof descriptors.builds.writable !== "boolean") { fail("INPUT_SHAPE_INVALID", "input-shape", "input fields drifted"); } }';
  const reflectedInputHasOwnValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const descriptors = Object.getOwnPropertyDescriptors(input); if (!Object.hasOwn(descriptors, "builds")) { fail("INPUT_SHAPE_INVALID", "input-shape", "input fields drifted"); } }';
  const boundedBuildValidator =
    'function validateBuild(value, index) { if (types.isProxy(value)) { fail("INPUT_SHAPE_INVALID", "input-shape", "build proxy"); } if (Buffer.byteLength(Object.getOwnPropertyDescriptors(value).bytes.value) > G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES) { fail("INPUT_SHAPE_INVALID", "input-shape", "build bytes drifted"); } }';
  const reboundDescriptorValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const borrowed = Object.getOwnPropertyDescriptors(input).builds.value; let descriptors = Object.getOwnPropertyDescriptors(input); descriptors = borrowed; Reflect.ownKeys(descriptors); }';
  const mutableDescriptorValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } let descriptors = Object.getOwnPropertyDescriptors(input); Reflect.ownKeys(descriptors); }';
  const functionShadowDescriptorValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const descriptors = Object.getOwnPropertyDescriptors(input); { function descriptors() {} Reflect.ownKeys(descriptors); } }';
  const classShadowDescriptorValidator =
    'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const descriptors = Object.getOwnPropertyDescriptors(input); { class descriptors {} Reflect.ownKeys(descriptors); } }';
  const artifactFactory =
    'function artifactFor(bytes) { const stored = Buffer.from(bytes); return Object.freeze({ name: G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME, rawSha256: createHash("sha256").update(stored).digest("hex"), get bytes() { return Buffer.from(stored); } }); }';
  const createdBuilder =
    "function created(owner, bytes, includeArtifact) { return Object.freeze({ owner, bytes, includeArtifact }); }";
  const ownerBuilder =
    "function expectedOwner(verified, envelope, builds) { const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); return created(owner, bytes, verified === undefined); }";
  const ownedVerifiedOwnerBuilder =
    'function expectedOwner(verified, envelope, builds) { if (verified !== undefined && !isDeepStrictEqual(verified.owner.authority, G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY)) { fail("AUTHORITY_OVERCLAIM", "authority-validation", "owner authority drifted"); } const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); return created(owner, bytes, verified === undefined); }';
  const replay = [
    "function fail(code, phase, message, cause) { throw new G17BenchmarkProductOwnerV4ContractError(code, phase, message, cause === undefined ? undefined : { cause }); }",
    PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE,
    PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE,
    artifactFactory,
    inputValidator,
    'function ownDataRecord(input) { validateInput(input); const descriptors = Object.getOwnPropertyDescriptors(input); const builds = descriptors.builds.value; const bytes = Object.hasOwn(descriptors, "bytes") ? descriptors.bytes.value : undefined; return Object.freeze({ builds, bytes }); }',
    buildValidator,
    "function snapshotBuild(descriptor, index) { const value = descriptor.value; validateBuild(value, index); const bytes = Buffer.from(value.bytes); const fixture = value.fixture; return Object.freeze({ bytes, fixture }); }",
    snapshotter,
    normalizer,
    PINNED_CANDIDATE_SNAPSHOT_JSON_SOURCE,
    PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE,
    "function validateVerifiedOwnerBeforeBuildReplay(envelope) { const verified = decodeVerifiedOwnerBeforeBuildReplay(envelope); return verified; }",
    createdBuilder,
    ownerBuilder,
  ].join("\n");
  const createEntrypoint =
    "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); return expectedOwner(undefined, envelope, normalizeBuilds(envelope.builds)); }";
  const verifyEntrypoint =
    "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); const verified = validateVerifiedOwnerBeforeBuildReplay(envelope); return expectedOwner(verified, envelope, normalizeBuilds(envelope.builds)); }";
  const entrypoints = [createEntrypoint, verifyEntrypoint].join("\n");
  const admitted = `${imports}\n${pureInitializer}\n${replay}\n${exports}\n${errorClass}\n${entrypoints}`;
  assert.doesNotThrow(() => assertCandidateSourceStructure(admitted));
  assert.doesNotThrow(() =>
    assertCandidateSourceStructure(
      admitted.replace(inputValidator, reflectedInputValidator),
    ),
  );
  assert.doesNotThrow(() =>
    assertCandidateSourceStructure(
      admitted.replace(inputValidator, reflectedInputHasOwnValidator),
    ),
  );
  assert.doesNotThrow(() =>
    assertCandidateSourceStructure(
      admitted.replace(buildValidator, boundedBuildValidator),
    ),
  );
  assert.doesNotThrow(() =>
    assertCandidateSourceStructure(
      admitted.replace(ownerBuilder, ownedVerifiedOwnerBuilder),
    ),
  );
  assert.doesNotThrow(() =>
    assertCandidateSourceStructure(
      admitted.replace(
        ownerBuilder,
        "function expectedOwner(verified, envelope, builds) { if (envelope.bytes !== undefined) { Buffer.isBuffer(envelope.bytes); } const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); return created(owner, bytes, verified === undefined); }",
      ),
    ),
  );
  assert.equal(PARSER_SNAPSHOT.audit.completedBeforeCandidateRead, true);
  assert.deepEqual(PARSER_SNAPSHOT.audit, {
    completedBeforeCandidateRead: true,
    policy: "latest",
    ...EXPECTED_ACORN,
  });
  const deepCallChain = Array.from(
    { length: MAX_CANDIDATE_CALL_DEPTH + 1 },
    (_unused, index) =>
      `function depth${index}() { return ${
        index === MAX_CANDIDATE_CALL_DEPTH ? "0" : `depth${index + 1}()`
      }; }`,
  ).join("\n");
  const amplifiedCallDag = Array.from({ length: 31 }, (_unused, index) =>
    index === 30
      ? `function amplify${index}() { return 0; }`
      : `function amplify${index}() { amplify${index + 1}(); return amplify${
          index + 1
        }(); }`,
  ).join("\n");
  const boundedIntrinsicSequence = Array.from(
    { length: 129 },
    () => "Object.freeze({});",
  ).join(" ");
  const inputScaledSequence = Array.from(
    { length: 129 },
    () => 'Buffer.from("bounded");',
  ).join(" ");
  const nonliteralHasOwnSequence = Array.from(
    { length: 129 },
    () => "Object.hasOwn({}, key);",
  ).join(" ");
  const sequentialAggregateAmplification = Array.from(
    { length: 40 },
    () => "payload = [payload, payload];",
  ).join(" ");
  const sequentialAliasAmplification = Array.from(
    { length: 40 },
    (_unused, index) =>
      `const left${index} = payload; const right${index} = payload; payload = [left${index}, right${index}];`,
  ).join(" ");
  const mutations = [
    admitted.replace(inputValidator, reboundDescriptorValidator),
    admitted.replace(inputValidator, mutableDescriptorValidator),
    admitted.replace(inputValidator, functionShadowDescriptorValidator),
    admitted.replace(inputValidator, classShadowDescriptorValidator),
    `${admitted}\nprocess.exitCode = 0;`,
    `${admitted}\nimport("./other.mjs");`,
    `${admitted}\nfetch("https://example.invalid");`,
    `${admitted}\nimport { readFile } from "node:fs";`,
    `${admitted}\nimport "node:fs";`,
    `${admitted}\nimport {} from "node:fs";`,
    `${admitted}\nexport default console.log("module initializer ran");`,
    `${admitted}\nfunction poison() { types.isProxy = () => false; }`,
    admitted.replace(
      inputValidator,
      reflectedInputValidator.replace(
        'if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } ',
        "",
      ),
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } return Object.getOwnPropertyDescriptors(input); }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const descriptors = Object.getOwnPropertyDescriptors({}); Reflect.ownKeys(descriptors); }',
    ),
    admitted.replace(
      buildValidator,
      boundedBuildValidator.replace(
        ") > G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES",
        ") >= G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES",
      ),
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (Object.hasOwn(input, "sideEffect")) input.sideEffect(); return input; }',
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { const callback = input.sideEffect; callback(); }",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { while (true) {} }",
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } for (let i = 0; i < 4 && (i = 0) === 0; i++) {} }',
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { validateInput(input); }",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { Array.from({ length: 1_000_000_000 }); }",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { return { ...input }; }",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { return Object.values(input); }",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { return new Set(input); }",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { const { builds } = input; return builds; }",
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const builds = Object.getOwnPropertyDescriptors(input).builds.value; Object.getOwnPropertyDescriptors(builds); }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const builds = Object.getOwnPropertyDescriptors(input).builds.value; return +builds; }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } let builds = Object.getOwnPropertyDescriptors(input).builds.value; builds += ""; }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } let builds = Object.getOwnPropertyDescriptors(input).builds.value; builds++; }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const builds = Object.getOwnPropertyDescriptors(input).builds.value; return Object.hasOwn(builds, "x"); }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { if (types.isProxy(input)) { fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy"); } const builds = Object.getOwnPropertyDescriptors(input).builds.value; return Object.getPrototypeOf(builds) === null; }',
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { return `${input}`; }",
    ),
    admitted.replace(PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE, ""),
    `${admitted}\n${PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE}`,
    admitted.replace(
      PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE,
      PINNED_CANDIDATE_CANONICAL_BYTES_SOURCE.replace(
        'canonicalJson(value) + "\\n"',
        "canonicalJson(value)",
      ),
    ),
    admitted.replace(PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE, ""),
    `${admitted}\n${PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE}`,
    admitted.replace(
      PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE,
      PINNED_CANDIDATE_OWNER_CONTENT_HASH_SOURCE.replace(
        "canonicalSha256(value)",
        'createHash("sha256").update(value).digest("hex")',
      ),
    ),
    admitted.replace(
      ownerBuilder,
      'function expectedOwner(verified, envelope, builds) { const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = verified === undefined ? canonicalBytes(owner) : Buffer.from("fabricated"); return created(owner, bytes, verified === undefined); }',
    ),
    admitted.replace(
      ownerBuilder,
      'function expectedOwner(verified, envelope, builds) { const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); canonicalBytes(owner); const bytes = Buffer.from("fabricated"); return created(owner, bytes, verified === undefined); }',
    ),
    admitted.replace(
      ownerBuilder,
      'function expectedOwner(verified, envelope, builds) { const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); return created(owner, Buffer.from("fabricated"), verified === undefined); }',
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); if (verified === undefined) { return created(owner, bytes, true); } return created(owner, bytes, false); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { if (verified === undefined) { return null; } const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); return created(owner, bytes, verified === undefined); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { if (envelope.bytes !== undefined) { return null; } const unsigned = Object.freeze({ verified, envelope, builds }); const owner = Object.freeze({ verified, envelope, builds, contentHash: ownerContentHash(unsigned) }); const bytes = canonicalBytes(owner); return created(owner, bytes, verified === undefined); }",
    ),
    admitted.replace(PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE, ""),
    `${admitted}\n${PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE}`,
    admitted.replace(
      PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE,
      PINNED_CANDIDATE_SNAPSHOT_BUILDS_SOURCE.replace(
        '"3",\n      "length",',
        '"length",',
      ),
    ),
    `${admitted}\nfunction escape() { return ({}).constructor.constructor("return process")(); }`,
    `${admitted}\nfunction metadata() { return import.meta.url; }`,
    `${admitted}\nfunction timer() { return setInterval(() => {}, 1); }`,
    `${admitted}\nfunction clock() { return Date.now() + Math.random() + performance.now(); }`,
    admitted.replace(
      'super("G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message, options[0]);',
      'super("G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message + (options[1] === undefined ? "" : options[1]), options[0]);',
    ),
    admitted.replace(
      'super("G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message, options[0]);',
      'super(phase === "canonical-encoding" ? message + "\\n" : "G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message, options[0]);',
    ),
    `${admitted}\nfunction queued() { return queueMicrotask(() => {}); }`,
    `${admitted}\nfunction localGetter() { return ({ get value() { return 1; } }).value; }`,
    `${admitted}\nfunction localSetter() { return { set value(next) {} }; }`,
    `${admitted}\nfunction localMethod() { return { value() { return 1; } }; }`,
    `${admitted}\nfunction computedProperty() { return { [0]: 1 }; }`,
    admitted.replace(
      "get bytes() { return Buffer.from(stored); }",
      "get bytes() { return stored; }",
    ),
    admitted.replace(
      "get bytes() { return Buffer.from(stored); }",
      "bytes: stored",
    ),
    admitted.replace(
      "const stored = Buffer.from(bytes);",
      "const stored = bytes;",
    ),
    admitted.replace(
      artifactFactory,
      'function artifactFor(bytes) { const stored = Buffer.from(bytes); return Object.freeze({ name: G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME, rawSha256: createHash("sha256").update(stored).digest("hex"), bytes: stored, decoy: Object.freeze({ get bytes() { return Buffer.from(stored); } }) }); }',
    ),
    admitted.replace(
      artifactFactory,
      'function artifactFor(bytes) { const stored = Buffer.from(bytes); function decoy() { return Object.freeze({ get bytes() { return Buffer.from(stored); } }); } return Object.freeze({ name: G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME, rawSha256: createHash("sha256").update(stored).digest("hex"), bytes: stored }); }',
    ),
    admitted.replace(
      PINNED_CANDIDATE_SNAPSHOT_JSON_SOURCE,
      PINNED_CANDIDATE_SNAPSHOT_JSON_SOURCE.replace(
        "return parsed;",
        "return pending;",
      ),
    ),
    `${admitted}\n${PINNED_CANDIDATE_SNAPSHOT_JSON_SOURCE}`,
    admitted.replace(
      'snapshotJson(JSON.parse(text), "product owner", fail)',
      'snapshotJson(envelope, "product owner", fail)',
    ),
    admitted.replace(PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE, ""),
    `${admitted}\n${PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE}`,
    admitted.replace(
      PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE,
      PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE.replace(
        'typeof contentHash !== "string" ||\n    contentHash !== canonicalSha256(unsigned)',
        'typeof contentHash !== "string" ||\n    !DIGEST.test(contentHash) ||\n    contentHash !== canonicalSha256(unsigned)',
      ),
    ),
    admitted.replace(
      PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE,
      PINNED_CANDIDATE_VERIFIED_OWNER_DECODER_SOURCE.replace(
        'typeof contentHash !== "string" ||\n    contentHash !== canonicalSha256(unsigned)',
        "contentHash !== canonicalSha256(unsigned)",
      ),
    ),
    admitted.replace(
      "const verified = decodeVerifiedOwnerBeforeBuildReplay(envelope); return verified;",
      "decodeVerifiedOwnerBeforeBuildReplay(envelope); return envelope;",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); const verified = validateVerifiedOwnerBeforeBuildReplay(envelope); return expectedOwner(undefined, envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); const verified = undefined; return expectedOwner(verified, envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); const normalized = normalizeBuilds(envelope.builds); const verified = validateVerifiedOwnerBeforeBuildReplay(envelope); return expectedOwner(verified, envelope, normalized); }",
    ),
    `${admitted}\nfunction extraSnapshot(value) { return snapshotJson(value, "extra", fail); }`,
    `${admitted}\nfunction shadowDecoder(decodeVerifiedOwnerBeforeBuildReplay) { return decodeVerifiedOwnerBeforeBuildReplay; }`,
    admitted.replace(
      createEntrypoint,
      'export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); snapshotJson(JSON.parse("{}"), "product owner", fail); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }',
    ),
    `${admitted}\nfunction parseWithReviver() { return JSON.parse("{}", (_key, value) => value); }`,
    `${admitted}\nconst unsafePattern = /(a+)+$/u; function runUnsafePattern() { return unsafePattern.test("aaaaaaaaaaaaaaaa!"); }`,
    `${admitted}\nfunction growText() { let payload = "a"; for (let index = 0; index < 28; index += 1) { payload += payload; } return Buffer.from(payload); }`,
    `${admitted}\nfunction doubleText() { let payload = "a"; payload = payload + payload; return Buffer.from(payload); }`,
    `${admitted}\nfunction growAggregate() { let payload = null; for (let index = 0; index < 28; index += 1) { payload = [payload, payload]; } return payload; }`,
    `${admitted}\nfunction sequentialAggregateGrowth() { let payload = null; ${sequentialAggregateAmplification} return canonicalJson(payload); }`,
    `${admitted}\nfunction sequentialAliasAggregateGrowth() { let payload = null; ${sequentialAliasAmplification} return payload; }`,
    `${admitted}\nfunction duplicateAggregate(value) { return [value, value]; }`,
    `${admitted}\nfunction pair(left, right) { return [left, right]; } function duplicatePair(value) { return pair(value, value); }`,
    `${admitted}\nfunction aliasPair(value) { const left = value; const right = left; return pairAlias(left, right); } function pairAlias(left, right) { return [left, right]; }`,
    `${admitted}\nfunction multiHopAlias(value) { const first = value; const second = first; return { first, second }; }`,
    `${admitted}\nfunction identityValue(value) { return value; } function duplicateIdentityResult(value) { return [identityValue(value), identityValue(value)]; }`,
    `${admitted}\nfunction identityForPair(value) { return value; } function duplicateNestedPair(value) { return pairNested(identityForPair(value), identityForPair(value)); } function pairNested(left, right) { return [left, right]; }`,
    `${admitted}\nfunction selectRest(...values) { return values[0]; } function duplicateRest(value) { return [selectRest(value), value]; }`,
    `${admitted}\nfunction duplicateMemberValue(holder) { const left = holder.value; const right = holder.value; return [left, right]; }`,
    `${admitted}\nfunction duplicateMemberAlias(holder) { const local = holder.value; return [local, holder.value]; }`,
    `${admitted}\nfunction duplicateNestedMemberAlias(holder) { const local = holder.value; return [local.child, holder.value.child]; }`,
    `${admitted}\nfunction duplicateThroughObject(value) { const holder = { value }; return [holder.value, value]; }`,
    `${admitted}\nfunction duplicateThroughArray(value) { const holder = [value]; return [holder[0], value]; }`,
    `${admitted}\nfunction duplicateAssignedMember(holder) { let local = null; return [(local = holder.value), local]; }`,
    `${admitted}\nfunction duplicateAssignmentArray(value) { let local = null; const holder = [(local = value)]; return [holder[0], value]; }`,
    `${admitted}\nfunction duplicateAssignmentObject(value) { let local = null; const holder = { item: (local = value) }; return [holder.item, value]; }`,
    `${admitted}\nfunction duplicateFrozenAlias(value) { const alias = Object.freeze(value); return [alias, value]; }`,
    `${admitted}\nfunction wrapLocalObject(value) { return Object.freeze({ inner: value }); } function duplicateLocalObjectProjection(value) { return [wrapLocalObject(value).inner, value]; }`,
    `${admitted}\nfunction wrapLocalArray(value) { return Object.freeze([value]); } function duplicateLocalArrayProjection(value) { return [wrapLocalArray(value)[0], value]; }`,
    `${admitted}\nfunction wrapInnerLocal(value) { return Object.freeze({ inner: value }); } function wrapOuterLocal(value) { return Object.freeze({ outer: wrapInnerLocal(value) }); } function duplicateNestedLocalProjection(value) { return [wrapOuterLocal(value).outer.inner, value]; }`,
    `${admitted}\nfunction selectLocalMember(holder) { return holder.item; } function duplicateSelectedLocalMember(holder) { return [selectLocalMember(holder), holder.item]; }`,
    `${admitted}\nfunction wrapAssignedLocal(value) { let holder = null; return (holder = Object.freeze({ inner: value })); } function duplicateAssignedLocalProjection(value) { return [wrapAssignedLocal(value).inner, value]; }`,
    `${admitted}\nfunction makeAssignedObject(value) { return Object.freeze({ inner: value }); } function duplicateAssignedObjectMember(value) { const assigned = makeAssignedObject(value); return [assigned.inner, value]; }`,
    `${admitted}\nfunction makeAssignedArray(value) { return Object.freeze([value]); } function duplicateAssignedArrayMember(value) { const assigned = makeAssignedArray(value); return [assigned[0], value]; }`,
    `${admitted}\nfunction makeNestedAssignedObject(value) { return Object.freeze({ wrapper: Object.freeze({ inner: value }) }); } function duplicateNestedAssignedMember(value) { const assigned = makeNestedAssignedObject(value); return [assigned.wrapper.inner, value]; }`,
    `${admitted}\nfunction makeStoredObject(value) { return Object.freeze({ inner: value }); } function duplicateStoredObjectMember(value) { const holder = Object.freeze({ wrapper: makeStoredObject(value) }); return [holder.wrapper.inner, value]; }`,
    `${admitted}\nfunction makeRelayedObject(value) { return Object.freeze({ inner: value }); } function relayLocalObject(value) { const result = makeRelayedObject(value); return result; } function duplicateRelayedObjectMember(value) { const assigned = relayLocalObject(value); return [assigned.inner, value]; }`,
    `${admitted}\nfunction duplicateLaterSelectedLocalMember(holder) { return [selectLaterLocalMember(holder), holder.item]; } function selectLaterLocalMember(holder) { return holder.item; }`,
    `${admitted}\nfunction duplicateNestedHolder(value) { const inner = Object.freeze({ value }); const outer = Object.freeze({ inner }); return [outer.inner.value, value]; }`,
    `${admitted}\nfunction duplicateConditionalAggregate(value, choose) { const holder = choose ? Object.freeze({ item: value }) : Object.freeze({ item: null }); return [holder.item, value]; }`,
    `${admitted}\nfunction duplicateLogicalAggregate(value, choose) { const holder = choose && Object.freeze({ item: value }); return [holder.item, value]; }`,
    `${admitted}\nfunction duplicateLogical(value) { return [true && value, true && value]; }`,
    `${admitted}\nconst MODULE_SHARED_MEMBER = Object.freeze([Object.freeze({})]); function duplicateModuleMember() { return [MODULE_SHARED_MEMBER[0], MODULE_SHARED_MEMBER[0]]; }`,
    `${admitted}\nconst MODULE_SHARED_RESULT = Object.freeze({}); function sameModuleResult() { return MODULE_SHARED_RESULT; } function duplicateModuleResult() { return [sameModuleResult(), sameModuleResult()]; }`,
    `${admitted}\nconst MODULE_PASSED_RESULT = Object.freeze({}); function passModuleResult(value) { return value; } function wrappedPassedModuleResult() { return passModuleResult(MODULE_PASSED_RESULT); } function duplicatePassedModuleResult() { return [wrappedPassedModuleResult(), wrappedPassedModuleResult()]; }`,
    `${admitted}\nconst MODULE_WRAPPED_RESULT = Object.freeze({}); function wrapModuleResult() { return Object.freeze({ shared: MODULE_WRAPPED_RESULT }); } function duplicateWrappedModuleResult() { return Object.freeze([wrapModuleResult(), wrapModuleResult()]); }`,
    `${admitted}\nfunction wrapImportedResult() { return Object.freeze({ shared: G17_BENCHMARK_BUILD_PLAN }); } function duplicateWrappedImportedResult() { return Object.freeze([wrapImportedResult(), wrapImportedResult()]); }`,
    `${admitted}\nconst MODULE_PATH_LEAF = Object.freeze({}); const MODULE_PATH_WRAP = Object.freeze({ plan: MODULE_PATH_LEAF }); const MODULE_PATH_DUPLICATE = Object.freeze([MODULE_PATH_WRAP.plan, MODULE_PATH_LEAF]);`,
    `${admitted}\nconst IMPORTED_PATH_WRAP = Object.freeze({ plan: G17_BENCHMARK_BUILD_PLAN }); const IMPORTED_PATH_DUPLICATE = Object.freeze([IMPORTED_PATH_WRAP.plan, G17_BENCHMARK_BUILD_PLAN]);`,
    `${admitted}\nfunction returnedPlan() { return G17_BENCHMARK_BUILD_PLAN; } function returnedPlanEntry() { return returnedPlan()[0]; } function duplicateReturnedPlanEntry() { return [returnedPlanEntry(), returnedPlanEntry()]; }`,
    `${admitted}\nfunction duplicateImportedAlias() { const alias = G17_BENCHMARK_BUILD_PLAN; return [alias, G17_BENCHMARK_BUILD_PLAN]; }`,
    `${admitted}\nfunction duplicateCaughtValue(value) { try { throw value; } catch (error) { return [error, value]; } }`,
    `${admitted}\nfunction duplicateCaughtObjectMember(value) { try { throw Object.freeze({ inner: value }); } catch (error) { return [error.inner, value]; } }`,
    `${admitted}\nfunction throwLocalValue(value) { throw value; } function duplicateCaughtHelperValue(value) { try { throwLocalValue(value); } catch (error) { return [error, value]; } }`,
    `${admitted}\nfunction throwLocalObject(value) { throw Object.freeze({ inner: value }); } function duplicateCaughtHelperObjectMember(value) { try { throwLocalObject(value); } catch (error) { return [error.inner, value]; } }`,
    `${admitted}\nfunction throwLocalValueTwo(value) { throw value; } function relayThrownLocalValue(value) { throwLocalValueTwo(value); } function duplicateCaughtTwoHopValue(value) { try { relayThrownLocalValue(value); } catch (error) { return [error, value]; } }`,
    `${admitted}\nfunction duplicateDescriptorValue(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } const descriptors = Object.getOwnPropertyDescriptors(holder); const value = descriptors.item.value; return [value, holder.item]; }`,
    `${admitted}\nfunction duplicateDescriptorMapAlias(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } const descriptors = Object.getOwnPropertyDescriptors(holder); const mapAlias = descriptors; const value = mapAlias.item.value; return [value, holder.item]; }`,
    `${admitted}\nfunction duplicateDescriptorMemberAlias(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } const descriptors = Object.getOwnPropertyDescriptors(holder); const descriptor = descriptors.item; const descriptorAlias = descriptor; const value = descriptorAlias.value; return [value, holder.item]; }`,
    `${admitted}\nfunction duplicateDescriptorAssignment(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } let descriptors = null; descriptors = Object.getOwnPropertyDescriptors(holder); const value = descriptors.item.value; return [value, holder.item]; }`,
    `${admitted}\nfunction duplicateInlineDescriptor(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } return [Object.getOwnPropertyDescriptors(holder).item.value, holder.item]; }`,
    `${admitted}\nfunction duplicateDirectDescriptorRecord(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } const descriptor = Object.getOwnPropertyDescriptors(holder).item; return [descriptor.value, holder.item]; }`,
    `${admitted}\nfunction duplicateDirectNumericDescriptorRecord(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } const descriptor = Object.getOwnPropertyDescriptors(holder)[0]; return [descriptor.value, holder[0]]; }`,
    `${admitted}\nfunction duplicateAssignedDescriptorRecord(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } let descriptor = null; descriptor = Object.getOwnPropertyDescriptors(holder).item; return [descriptor.value, holder.item]; }`,
    `${admitted}\nfunction localDescriptorRecord(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } return Object.getOwnPropertyDescriptors(holder).item; } function duplicateAssignedDescriptorHelper(holder) { const descriptor = localDescriptorRecord(holder); return [descriptor.value, holder.item]; }`,
    `${admitted}\nfunction localNumericDescriptorRecord(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } return Object.getOwnPropertyDescriptors(holder)[0]; } function duplicateAssignedNumericDescriptorHelper(holder) { const descriptor = localNumericDescriptorRecord(holder); return [descriptor.value, holder[0]]; }`,
    `${admitted}\nfunction localDescriptorMap(holder) { if (types.isProxy(holder)) { fail("INPUT_SHAPE_INVALID", "input-shape", "holder proxy"); } return Object.getOwnPropertyDescriptors(holder); } function duplicateAssignedDescriptorMapHelper(holder) { const descriptors = localDescriptorMap(holder); return [descriptors.item.value, holder.item]; }`,
    `${admitted}\nfunction duplicateThroughForOf(value) { let selected = null; for (const item of [value]) { selected = item; } return [selected, value]; }`,
    `${admitted}\nconst MODULE_DAG_ZERO = Object.freeze({}); const MODULE_DAG_ONE = Object.freeze([MODULE_DAG_ZERO, MODULE_DAG_ZERO]); const MODULE_DAG_TWO = Object.freeze([MODULE_DAG_ONE, MODULE_DAG_ONE]);`,
    `${admitted}\nconst MODULE_ALIAS_TO_PLAN = G17_BENCHMARK_BUILD_PLAN; function duplicateModuleAlias() { return [MODULE_ALIAS_TO_PLAN, MODULE_ALIAS_TO_PLAN]; }`,
    `${admitted}\nconst MODULE_TRANSITIVE_ZERO = Object.freeze({}); const MODULE_TRANSITIVE_ONE = Object.freeze([MODULE_TRANSITIVE_ZERO]); const MODULE_TRANSITIVE_TWO = Object.freeze([MODULE_TRANSITIVE_ONE, MODULE_TRANSITIVE_ZERO]);`,
    `${admitted}\nconst IMPORTED_DAG = Object.freeze([G17_BENCHMARK_BUILD_PLAN, G17_BENCHMARK_BUILD_PLAN]);`,
    `${admitted}\nfunction identityAssigned(value) { return value; } function duplicateAssignedIdentity(value) { const left = identityAssigned(value); const right = identityAssigned(value); return [left, right]; }`,
    `${admitted}\nfunction bigintGrowth() { let value = 2n; value = value * value; return value; }`,
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { envelope.bytes < 0; return Object.freeze({ verified, envelope, builds }); }",
    ),
    `${admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { coerceBorrowed(envelope.bytes); return Object.freeze({ verified, envelope, builds }); }",
    )}\nfunction coerceBorrowed(value) { return value < 0; }`,
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { JSON.parse(envelope.bytes); return Object.freeze({ verified, envelope, builds }); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { canonicalJson(envelope); return Object.freeze({ verified, envelope, builds }); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { canonicalSha256(envelope); return Object.freeze({ verified, envelope, builds }); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { isDeepStrictEqual(envelope, builds); return Object.freeze({ verified, envelope, builds }); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { Buffer.from(envelope); return Object.freeze({ verified, envelope, builds }); }",
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { new TypeError(envelope); return Object.freeze({ verified, envelope, builds }); }",
    ),
    admitted.replace(
      ownerBuilder,
      'function expectedOwner(verified, envelope, builds) { createHash("sha256").update(envelope); return Object.freeze({ verified, envelope, builds }); }',
    ),
    admitted.replace(
      ownerBuilder,
      'function expectedOwner(verified, envelope, builds) { Object.hasOwn(envelope.builds, "x"); return Object.freeze({ verified, envelope, builds }); }',
    ),
    `${admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { unsafeBorrowed(envelope.bytes); return Object.freeze({ verified, envelope, builds }); }",
    )}\nfunction unsafeBorrowed(value) { return JSON.parse(value); }`,
    admitted.replace(
      'catch (error) { fail("BUILD_OWNER_INVALID",',
      'catch (error) { new TypeError(error); fail("BUILD_OWNER_INVALID",',
    ),
    admitted.replace(
      ownerBuilder,
      "function expectedOwner(verified, envelope, builds) { for (const value of [envelope.bytes]) { JSON.parse(value); } return Object.freeze({ verified, envelope, builds }); }",
    ),
    `${admitted}\nfunction repeatedCanonical(builds) { if (types.isProxy(builds)) { fail("INPUT_SHAPE_INVALID", "input-shape", "builds proxy"); } for (let index = 0; index < 4194304; index += 1) { canonicalJson(builds); } }`,
    `${admitted}\nfunction arrayDeclaration() { const [first] = [1]; return first; }`,
    `${admitted}\nfunction arrayParameter([first]) { return first; }`,
    `${admitted}\nfunction loopSink() { for (let sink = 0; sink < 1; sink += 1) {} } function loopSource() { for (let source = 0; source < 1; source += 1) { loopSink(); } }`,
    `${admitted}\nfunction multiLoopSink() { for (let sink = 0; sink < 1; sink += 1) {} } function loopBridge() { multiLoopSink(); } function multiLoopSource() { for (let source = 0; source < 1; source += 1) {} loopBridge(); }`,
    `${admitted}\nfunction allocateAggregate() { return []; } function allocationLoop() { for (let index = 0; index < 1; index += 1) { allocateAggregate(); } }`,
    `${admitted}\nfunction bridgedAllocation() { return []; } function allocationBridge() { return bridgedAllocation(); } function bridgedAllocationLoop() { for (let index = 0; index < 1; index += 1) { allocationBridge(); } }`,
    `${admitted}\n${deepCallChain}`,
    `${admitted}\n${amplifiedCallDag}`,
    `${admitted}\nfunction platformEscape() { return Atomics.wait(); }`,
    `${admitted}\nfunction parameterScope(value = Date.now()) { var Date; return value; }`,
    `${admitted}\nconst moduleHang = (() => { while (true) {} })();`,
    `${admitted}\nconst moduleAllocation = Array.from({ length: 1_000_000_000 });`,
    `${admitted}\nconst expansion0 = Object.freeze([0]); const expansion1 = Object.freeze([...expansion0, ...expansion0]);`,
    `${admitted}\nconst mutableModuleState = [0]; function mutateModuleState() { mutableModuleState[0] += 1; }`,
    `${admitted}\nconst frozenModuleState = Object.freeze([0]); function mutateFrozenModuleState() { frozenModuleState[0] += 1; }`,
    `${admitted}\nconst freezeImportedValue = Object.freeze(G17_BENCHMARK_BUILD_PLAN);`,
    `${admitted}\nconst namedFunction = function Date() {}; function ambientClock() { return Date.now(); }`,
    `${admitted}\nconst namedClass = class Date {}; function ambientClassClock() { return Date.now(); }`,
    `${admitted}\nfunction switchAlias() { switch (0) { case 0: { const Date = {}; break; } } return Date.now(); }`,
    `${admitted}\nconst objectAlias = Object; const poisonIntrinsic = (objectAlias.freeze = (value) => value);`,
    `${admitted}\nconst arrayPrototype = Array.prototype;`,
    `${admitted}\nconst bufferPrototype = Buffer.prototype;`,
    `${admitted}\nconst objectPrototype = Object.prototype;`,
    `${admitted}\nconst poisonArrayPrototype = (Object.getPrototypeOf([]).map = () => []);`,
    `${admitted}\nconst poisonBufferPrototype = (Object.getPrototypeOf(Buffer.from("")).equals = () => true);`,
    `${admitted}\nconst poisonObjectPrototype = (Object.getPrototypeOf({}).polluted = true);`,
    `${admitted}\nconst arrayPrototypeAlias = Object.getPrototypeOf([]); const poisonArrayAlias = (arrayPrototypeAlias.map = () => []);`,
    `${admitted}\nconst bufferPrototypeAlias = Object.getPrototypeOf(Buffer.from("")); const poisonBufferAlias = (bufferPrototypeAlias.equals = () => true);`,
    `${admitted}\nconst objectPrototypeAlias = Object.getPrototypeOf({}); const poisonObjectAlias = (objectPrototypeAlias.polluted = true);`,
    admitted.replace(
      "constructor(code, phase, message, ...options)",
      "[(() => { while (true) {} })()](code, phase, message, ...options)",
    ),
    admitted.replace(
      'this.name = "G17BenchmarkProductOwnerV4ContractError";',
      'this.cause.name = "G17BenchmarkProductOwnerV4ContractError";',
    ),
    admitted.replace("extends Error", "extends (() => { while (true) {} })()"),
    `${admitted}\nconst dynamicKey = "constructor"; const hiddenProcess = ({})[dynamicKey][dynamicKey]("return process")();`,
    admitted.replace(
      "verifyG17BenchmarkBuildOwnerV3Artifact }",
      "verifyG17BenchmarkBuildOwnerV3Artifact as verifyOwner }",
    ),
    admitted.replace(
      'import { createHash } from "node:crypto";',
      'import createHash from "node:crypto";',
    ),
    admitted.replace(
      'import { createHash } from "node:crypto";',
      'import * as crypto from "node:crypto";',
    ),
    admitted.replace(
      "canonicalJson, canonicalSha256",
      "canonicalJson, canonicalSha256, extra",
    ),
    `${admitted}\nfunction shadow(verifyG17BenchmarkBuildOwnerV3Artifact) { return verifyG17BenchmarkBuildOwnerV3Artifact; }`,
    `${admitted}\nconst verifyOwner = verifyG17BenchmarkBuildOwnerV3Artifact;`,
    admitted.replace(
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture })",
      "verifyG17BenchmarkBuildOwnerV3Artifact.call(null, { bytes, fixture })",
    ),
    admitted.replace(
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture })",
      "null",
    ),
    admitted.replace(
      "replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture });",
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); replay = null;",
    ),
    admitted.replace(
      "replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture });",
      "replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); replay = null;",
    ),
    admitted.replace(
      "try { replay = verifyG17BenchmarkBuildOwnerV3Artifact",
      "try { let replay; replay = verifyG17BenchmarkBuildOwnerV3Artifact",
    ),
    admitted.replace(
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture })",
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes })",
    ),
    admitted.replace(
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture })",
      "verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture: null })",
    ),
    admitted.replace("snapshotBuilds(builds).map", "[].map"),
    admitted.replace("snapshotBuilds(builds).map", "snapshotBuilds([]).map"),
    admitted.replace(
      snapshotter,
      "function snapshotBuilds(builds) { return { map: (_callback) => [] }; }",
    ),
    admitted.replace(
      "snapshotBuild(descriptors[3], 3)",
      "snapshotBuild(descriptors[2], 2)",
    ),
    admitted.replace("    snapshotBuild(descriptors[3], 3),\n", ""),
    admitted.replace(
      snapshotter,
      "function snapshotBuilds(builds) { const descriptors = Object.getOwnPropertyDescriptors(builds); return Object.freeze([snapshotBuild(descriptors[1], 1), snapshotBuild(descriptors[0], 0), snapshotBuild(descriptors[2], 2), snapshotBuild(descriptors[3], 3)]); }",
    ),
    admitted.replace(
      snapshotter,
      "function snapshotBuilds(builds) { builds = []; const descriptors = Object.getOwnPropertyDescriptors(builds); return Object.freeze([snapshotBuild(descriptors[0], 0), snapshotBuild(descriptors[1], 1), snapshotBuild(descriptors[2], 2), snapshotBuild(descriptors[3], 3)]); }",
    ),
    admitted.replace(
      snapshotter,
      "function snapshotBuilds(builds) { const descriptors = Object.getOwnPropertyDescriptors(builds); descriptors[0] = descriptors[1]; return Object.freeze([snapshotBuild(descriptors[0], 0), snapshotBuild(descriptors[1], 1), snapshotBuild(descriptors[2], 2), snapshotBuild(descriptors[3], 3)]); }",
    ),
    admitted.replace(
      "function snapshotBuild(descriptor, index) { const value = descriptor.value; validateBuild(value, index); const bytes = Buffer.from(value.bytes); const fixture = value.fixture; return Object.freeze({ bytes, fixture }); }",
      'function snapshotBuild(descriptor, index) { const value = descriptor.value; validateBuild(value, index); const bytes = Buffer.from("fabricated"); const fixture = Object.freeze({}); return Object.freeze({ bytes, fixture }); }',
    ),
    admitted.replace(
      "const bytes = Buffer.from(value.bytes);",
      "const bytes = Buffer.from(value.fixture);",
    ),
    admitted.replace(
      "const fixture = value.fixture;",
      "const fixture = value.bytes;",
    ),
    admitted.replace("({ bytes, fixture })", "({ bytes })"),
    admitted.replace(
      "return Object.freeze({ bytes, fixture, replay });",
      "return Object.freeze({ bytes, fixture, replay: null });",
    ),
    admitted.replace(
      normalizer,
      "function normalizeBuilds(builds) { return (snapshotBuilds(builds).map(({ bytes, fixture }) => { let replay; replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); return Object.freeze({ bytes, fixture, replay }); }), builds); }",
    ),
    admitted.replace(
      "replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture });",
      "if (false) { replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); }",
    ),
    admitted.replace(
      "replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture });",
      "for (; false;) { replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); }",
    ),
    admitted.replace(
      "replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture });",
      "for (const ignored of []) { replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); }",
    ),
    admitted.replace(
      'fail("BUILD_OWNER_INVALID", "build-owner-replay", "S6 build owner did not replay", error);',
      "replay = null;",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); return envelope.builds; }",
    ),
    admitted.replace("normalizeBuilds(envelope.builds)", "normalizeBuilds([])"),
    admitted.replace(
      "normalizeBuilds(envelope.builds)",
      "normalizeBuilds(envelope.other)",
    ),
    admitted.replace(
      createEntrypoint,
      createEntrypoint.replace("ownDataRecord(input)", "ownDataRecord({})"),
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { input = {}; const envelope = ownDataRecord(input); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { input.builds.reverse(); const envelope = ownDataRecord(input); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      createEntrypoint,
      createEntrypoint.replace(
        "ownDataRecord(input)",
        "ownDataRecord(input, input)",
      ),
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); if (false) { return expectedOwner(envelope, normalizeBuilds(envelope.builds)); } return envelope; }",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); return envelope; return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); function neverCalled() { return expectedOwner(envelope, normalizeBuilds(envelope.builds)); } return envelope; }",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); return [expectedOwner(envelope, normalizeBuilds(envelope.builds)), envelope].at(1); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); validateVerifiedOwnerBeforeBuildReplay(input); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); validateVerifiedOwnerBeforeBuildReplay(envelope); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); validateVerifiedOwnerBeforeBuildReplay(envelope); validateVerifiedOwnerBeforeBuildReplay(envelope); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); if (true) { validateVerifiedOwnerBeforeBuildReplay(envelope); } return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); function neverCalled() { validateVerifiedOwnerBeforeBuildReplay(envelope); } return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      verifyEntrypoint,
      "export function verifyG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); const normalized = normalizeBuilds(envelope.builds); validateVerifiedOwnerBeforeBuildReplay(envelope); return expectedOwner(envelope, normalized); }",
    ),
    admitted.replace(
      createEntrypoint,
      "export function createG17BenchmarkProductOwnerV4Artifact(input) { const envelope = ownDataRecord(input); validateVerifiedOwnerBeforeBuildReplay(envelope); return expectedOwner(envelope, normalizeBuilds(envelope.builds)); }",
    ),
    admitted.replace(
      "return Object.freeze({ builds, bytes });",
      "return Object.freeze({ builds: [], bytes: null });",
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { input.builds.reverse(); return input; }",
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { ({ value: input.name } = { value: "changed" }); return input; }',
    ),
    admitted.replace(
      inputValidator,
      'function validateInput(input) { for (input.name of ["changed"]) {} return input; }',
    ),
    admitted.replace(
      inputValidator,
      "function validateInput(input) { Object.freeze(input); return input; }",
    ),
    admitted.replace(
      "function fail(code, phase, message, cause) { throw new G17BenchmarkProductOwnerV4ContractError(code, phase, message, cause === undefined ? undefined : { cause }); }",
      "function fail(code, phase, message, cause) { return cause; }",
    ),
    admitted.replace(
      buildValidator,
      "function validateBuild(value, index) { value.bytes.fill(index); return value; }",
    ),
    admitted.replace(
      "return expectedOwner(undefined, envelope, normalizeBuilds(envelope.builds));",
      "normalizeBuilds(envelope.builds); return envelope;",
    ),
    admitted.replace(
      normalizer,
      normalizer.replace(
        "return snapshotBuilds(builds).map",
        "return builds; return snapshotBuilds(builds).map",
      ),
    ),
    admitted.replace(
      normalizer,
      "function normalizeBuilds(builds) { return builds; function neverCalled() { return snapshotBuilds(builds).map(({ bytes, fixture }) => { let replay; replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture }); return Object.freeze({ bytes, fixture, replay }); }); } }",
    ),
    `${admitted}\nfunction shadow(snapshotBuilds) { return snapshotBuilds; }`,
    `${admitted}\nfunction shadow(snapshotBuild) { return snapshotBuild; }`,
    `${admitted}\nfunction shadow(expectedOwner) { return expectedOwner; }`,
    `${admitted}\nfunction shadow(ownDataRecord) { return ownDataRecord; }`,
    `${admitted}\nfunction shadow(validateVerifiedOwnerBeforeBuildReplay) { return validateVerifiedOwnerBeforeBuildReplay; }`,
    `${admitted}\nfunction shadow(fail) { return fail; }`,
    admitted.replace(
      "function normalizeBuilds(builds)",
      "function* normalizeBuilds(builds)",
    ),
    admitted.replace(
      "function snapshotBuilds(builds)",
      "async function snapshotBuilds(builds)",
    ),
    admitted.replace(
      ".map(({ bytes, fixture }) =>",
      ".map(async ({ bytes, fixture }) =>",
    ),
    admitted.replace(
      normalizer,
      normalizer.replace(
        "{ return snapshotBuilds",
        "{ const Object = { freeze: (value) => value }; return snapshotBuilds",
      ),
    ),
    admitted.replace(
      '"./benchmark-build-owner-v3-contract.mjs"',
      '"./benchmark-product-owner-contract.mjs"',
    ),
  ];
  assert.doesNotThrow(() =>
    assertCandidateSourceStructure(
      `${admitted}\nfunction boundedIntrinsicWork() { ${boundedIntrinsicSequence} }`,
    ),
    "bounded constant-time intrinsics must fit below the static-work ceiling",
  );
  assert.throws(
    () =>
      assertCandidateSourceStructure(
        `${admitted}\nfunction inputScaledWork() { ${inputScaledSequence} }`,
      ),
    /candidate static work exceeds bound at inputScaledWork/u,
    "input-scaled byte copies must retain the high static-work weight",
  );
  assert.throws(
    () =>
      assertCandidateSourceStructure(
        `${admitted}\nfunction nonliteralHasOwnWork() { const key = "field"; ${nonliteralHasOwnSequence} }`,
      ),
    /candidate static work exceeds bound at nonliteralHasOwnWork/u,
    "nonliteral property-key coercion must retain the high static-work weight",
  );
  for (const [index, mutation] of mutations.entries()) {
    assert.notEqual(
      mutation,
      admitted,
      `source-policy mutation ${index} must change the admitted source`,
    );
    assert.throws(
      () => assertCandidateSourceStructure(mutation),
      undefined,
      `source-policy mutation ${index}`,
    );
    let importAttempts = 0;
    const bytes = Buffer.from(mutation, "utf8");
    await assert.rejects(() =>
      loadCandidateForEvaluation(
        { present: true, regular: true, size: bytes.length },
        {
          readSource: async () => Buffer.from(bytes),
          importSource: async () => {
            importAttempts += 1;
            return {};
          },
        },
      ),
    );
    assert.equal(importAttempts, 0);
  }
});

test("ADR-0041 S7 loader holds one no-follow handle and caps the source read", async () => {
  const sourceBytes = Buffer.from('export const marker = "stable";', "utf8");
  const stat = () => ({
    isFile: () => true,
    dev: 11n,
    ino: 17n,
    size: BigInt(sourceBytes.length),
    mtimeNs: 23n,
    ctimeNs: 29n,
  });
  const readRequests = [];
  let closeCount = 0;
  const stableHandle = {
    stat: async () => stat(),
    read: async (buffer, offset, length, position) => {
      readRequests.push({ length, position });
      const bytesRead = sourceBytes.copy(
        buffer,
        offset,
        position,
        Math.min(position + length, sourceBytes.length),
      );
      return { bytesRead, buffer };
    },
    close: async () => {
      closeCount += 1;
    },
  };
  let openCount = 0;
  const stablePresence = await sourcePresence({
    openSource: async (url, flags) => {
      openCount += 1;
      assert.equal(url, SOURCE_URL);
      assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
      assert.equal(flags & constants.O_NONBLOCK, constants.O_NONBLOCK);
      return stableHandle;
    },
  });
  let importCount = 0;
  try {
    const loaded = await loadCandidateForEvaluation(stablePresence, {
      validateSource: () => {},
      importSource: async () => {
        importCount += 1;
        return { marker: "stable" };
      },
    });
    assert.equal(loaded.source, sourceBytes.toString("utf8"));
    assert.equal(loaded.candidate.marker, "stable");
  } finally {
    await stablePresence.handle.close();
  }
  assert.equal(openCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(importCount, 1);
  assert.deepEqual(readRequests, [
    { length: sourceBytes.length + 1, position: 0 },
    { length: 1, position: sourceBytes.length },
  ]);

  const growthBytes = Buffer.concat([sourceBytes, Buffer.from("x")]);
  const growthHandle = {
    stat: async () => stat(),
    read: async (buffer, offset, length, position) => ({
      bytesRead: growthBytes.copy(
        buffer,
        offset,
        position,
        Math.min(position + length, growthBytes.length),
      ),
      buffer,
    }),
    close: async () => {},
  };
  const growthPresence = await sourcePresence({
    openSource: async () => growthHandle,
  });
  let growthImportCount = 0;
  try {
    await assert.rejects(
      () =>
        loadCandidateForEvaluation(growthPresence, {
          validateSource: () => {},
          importSource: async () => {
            growthImportCount += 1;
            return {};
          },
        }),
      /candidate source changed during bounded handle read/u,
    );
  } finally {
    await growthPresence.handle.close();
  }
  assert.equal(growthImportCount, 0);
});

test("ADR-0041 S7 loader executes the exact validated candidate bytes", async () => {
  const validatedBytes = Buffer.from(
    'import { G17_BENCHMARK_BUILD_PLAN } from "./benchmark-execution-plan.mjs"; export const marker = G17_BENCHMARK_BUILD_PLAN[0].buildId;',
    "utf8",
  );
  const replacementBytes = Buffer.from(
    'export const marker = "replacement-executed";',
    "utf8",
  );
  let currentBytes = validatedBytes;
  const loaded = await loadCandidateForEvaluation(
    { present: true, regular: true, size: validatedBytes.length },
    {
      readSource: async () => Buffer.from(currentBytes),
      validateSource: (source) => {
        assert.equal(source, validatedBytes.toString("utf8"));
        currentBytes = replacementBytes;
      },
      importSource: async (url) => {
        assert.match(url, /^data:text\/javascript;base64,/u);
        assert.match(
          url,
          new RegExp(`source-sha256=${sha256(validatedBytes)}`, "u"),
        );
        const payload = url.slice(
          "data:text/javascript;base64,".length,
          url.indexOf("#"),
        );
        const executedSource = Buffer.from(payload, "base64").toString("utf8");
        assert.doesNotMatch(executedSource, /replacement-executed/u);
        return import(url);
      },
    },
  );
  assert.equal(loaded.candidate.marker, "negative-control");
  assert.notEqual(loaded.importUrl, SOURCE_URL.href);
});

test("missing product-owner-v4 source attribution is exact", () => {
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
  assert.equal(exactMissingSourceError(shape, { present: true }), false);
});

candidateTest(
  "ADR-0041 S7 candidate satisfies the frozen evaluator",
  async () => {
    await assertCandidateContract(candidate);
    assertCandidateSourceStructure(candidateSource);
  },
);

test("ADR-0041 S7 RED reports only the exact missing product-owner-v4 source", () => {
  assert.equal(candidateImportAttempts, presence.present ? 1 : 0);
  if (candidateImportError !== null) {
    assert.equal(candidate, null);
    assert.equal(candidateSource, null);
    throw candidateImportError;
  }
  assert.notEqual(candidate, null);
});
