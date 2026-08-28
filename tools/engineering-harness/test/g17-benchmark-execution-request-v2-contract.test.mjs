import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY as V1_COMPATIBILITY,
  createG17BenchmarkExecutionRequestArtifact as createV1Request,
  verifyG17BenchmarkExecutionRequestArtifact as verifyV1Request,
} from "../src/qualification/benchmark-execution-request-contract.mjs";
import { verifyG17BenchmarkBuildProcessEvidenceV3 } from "../src/qualification/benchmark-build-process-evidence-v3-contract.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
  G17BenchmarkExecutionRequestV2ContractError,
  createG17BenchmarkExecutionRequestV2Artifact,
  verifyG17BenchmarkExecutionRequestV2Artifact,
} from "../src/qualification/benchmark-execution-request-v2-contract.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "../src/qualification/benchmark-execution-plan.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function input(buildIndex = 0) {
  const build = G17_BENCHMARK_BUILD_PLAN[buildIndex];
  return {
    controlRunId: "execution-request-v2-fixture",
    buildId: build.buildId,
    productRole: build.productRole,
    authorization: {
      schema: "oxigraph.g1.7-control-authorization/v3",
      rawSha256: "1".repeat(64),
      contentHash: "2".repeat(64),
    },
    source: {
      rawSha256: "3".repeat(64),
      contentHash: "4".repeat(64),
      controlRunId: "execution-request-v2-fixture",
      buildId: build.buildId,
      productRole: build.productRole,
      workspaceGeneration: `g17-workspace-${"5".repeat(64)}`,
      targetGeneration: `g17-target-${"6".repeat(64)}`,
    },
    platform: {
      platformRootSha256: "7".repeat(64),
      toolchainRootSha256: "8".repeat(64),
      cargo: {
        logicalPath: "/toolchain/bin/cargo",
        sha256: "9".repeat(64),
        identity: {
          device: "101",
          inode: "201",
          uid: "1000",
          gid: "1000",
          mode: 0o100555,
          nlink: 1,
          size: 1_000_001,
        },
      },
      rustc: {
        logicalPath: "/toolchain/bin/rustc",
        sha256: "a".repeat(64),
        identity: {
          device: "101",
          inode: "202",
          uid: "1000",
          gid: "1000",
          mode: 0o100555,
          nlink: 1,
          size: 2_000_002,
        },
      },
    },
    ownership: {
      ownerGeneration: `g17-owner-${"b".repeat(64)}`,
      processGeneration: `g17-process-${String(buildIndex + 1).padStart(64, "0")}`,
      ordinal: buildIndex + 1,
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNullPrototype(value) {
  if (Array.isArray(value)) return value.map(toNullPrototype);
  if (value === null || typeof value !== "object") return value;
  const output = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    output[key] = toNullPrototype(child);
  }
  return output;
}

function assertNullPrototypeRecords(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertNullPrototypeRecords(child, seen);
    return;
  }
  assert.equal(Object.getPrototypeOf(value), null);
  for (const child of Object.values(value)) {
    assertNullPrototypeRecords(child, seen);
  }
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function reseal(request) {
  const { contentHash: _oldContentHash, ...unsigned } = request;
  request.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(request)}\n`, "utf8");
}

function mutatedBytes(created, mutate, { resealContent = true } = {}) {
  const request = JSON.parse(created.artifact.bytes.toString("utf8"));
  mutate(request);
  return resealContent
    ? reseal(request)
    : Buffer.from(`${canonicalJson(request)}\n`, "utf8");
}

function assertCode(block, code) {
  assert.throws(block, (error) => {
    assert.ok(error instanceof G17BenchmarkExecutionRequestV2ContractError);
    assert.equal(error.code, code);
    assert.equal(typeof error.phase, "string");
    assert.match(
      error.message,
      /^G1\.7 benchmark execution request v2 contract:/u,
    );
    return true;
  });
}

function processV3VersionProbe(executionRequest) {
  const zeroDigest = "0".repeat(64);
  return {
    bytes: Buffer.from("{}\n", "utf8"),
    expected: {
      evidence: { rawSha256: zeroDigest, contentHash: zeroDigest },
      executionRequest,
      containment: null,
      controlRunId: "execution-request-v2-fixture",
      buildId: "negative-control",
      productRole: "negativeControl",
      processGeneration: `g17-process-${zeroDigest}`,
      ordinal: 1,
      targetGeneration: `g17-target-${zeroDigest}`,
      targetRoot: null,
      cargoArtifact: null,
      executableLogicalPath:
        "/state/target/release/deps/transactional_write-probe",
    },
    stdoutBytes: Buffer.alloc(0),
    stderrBytes: Buffer.alloc(0),
    cgroupProcsBytes: Buffer.alloc(0),
    cgroupEventsBytes: Buffer.from("populated 0\n", "utf8"),
    cgroupPidsCurrentBytes: Buffer.from("0\n", "utf8"),
    executableBytes: Buffer.from([0]),
  };
}

function processV3RequestProjection({ schema, launchCompatibilityStatus }) {
  const zeroDigest = "0".repeat(64);
  return {
    schema,
    rawSha256: zeroDigest,
    contentHash: zeroDigest,
    controlRunId: "execution-request-v2-fixture",
    buildId: "negative-control",
    productRole: "negativeControl",
    processGeneration: `g17-process-${zeroDigest}`,
    ordinal: 1,
    targetGeneration: `g17-target-${zeroDigest}`,
    launchCompatibilityStatus,
    physicalLaunchEligible: false,
    binding: null,
    finalDecisionEligible: false,
  };
}

test("request v2 freezes four policy-v2-bound structural requests", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
    "oxigraph.g1.7-benchmark-execution-request/v2",
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA,
    "oxigraph.g1.7-benchmark-execution-request-projection/v2",
  );

  for (const [index, build] of G17_BENCHMARK_BUILD_PLAN.entries()) {
    const expected = input(index);
    const created = createG17BenchmarkExecutionRequestV2Artifact(expected);
    assert.equal(
      created.artifact.name,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME,
    );
    assert.equal(created.artifact.rawSha256, sha256(created.artifact.bytes));
    assert.deepEqual(plain(created.identity), {
      schema: G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
      rawSha256: created.artifact.rawSha256,
      contentHash: created.request.contentHash,
    });
    assert.equal(created.request.buildId, build.buildId);
    assert.equal(created.request.productRole, build.productRole);
    assert.equal(created.request.ownership.ordinal, index + 1);
    assert.equal(
      created.request.isolationPolicy.rawSha256,
      policy.artifact.sha256,
    );
    assert.equal(
      created.request.isolationPolicy.contentHash,
      policy.policy.sha256,
    );
    assert.equal(
      created.request.contentHash,
      canonicalSha256(
        Object.fromEntries(
          Object.entries(created.request).filter(
            ([key]) => key !== "contentHash",
          ),
        ),
      ),
    );
    const verified = verifyG17BenchmarkExecutionRequestV2Artifact({
      bytes: created.artifact.bytes,
      expected,
    });
    assert.deepEqual(verified.request, created.request);
    assert.deepEqual(verified.identity, created.identity);
    assert.deepEqual(verified.projection, created.projection);
    assertNullPrototypeRecords(created.request);
    assertDeepFrozen(created.request);
  }
});

test("request v2 derives the policy, status, descriptor, and execution-plan hash DAG", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
  const { request } = createG17BenchmarkExecutionRequestV2Artifact(input());

  assert.deepEqual(plain(request.executionPlan), {
    schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
    sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
    environmentRecipe: {
      schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
      sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
    },
  });
  assert.deepEqual(plain(request.isolationPolicy), {
    schema: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
    rawSha256: policy.artifact.sha256,
    contentHash: policy.policy.sha256,
    status: policy.policy.status,
    requirementMode: policy.policy.requirementMode,
    fileDescriptorsSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
    statusProtocol: {
      schema:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS.schema,
      requirementsSha256:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
    },
    requiredContainmentSchema:
      policy.policy.containment.requiredSuccessorSchema,
  });
  assert.equal(
    request.isolationPolicy.fileDescriptorsSha256,
    canonicalSha256(G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS),
  );
  const { requirementsSha256: _requirementsSha256, ...statusRequirements } =
    G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS;
  assert.equal(
    request.isolationPolicy.statusProtocol.requirementsSha256,
    canonicalSha256(statusRequirements),
  );
  assert.equal(request.command.program, G17_BENCHMARK_BUILD_PROGRAM);
  assert.equal(request.command.argv0, G17_BENCHMARK_BUILD_PROGRAM);
  assert.deepEqual(plain(request.command.argv), G17_BENCHMARK_BUILD_ARGV);
  assert.deepEqual(
    plain(request.command.environment),
    G17_BENCHMARK_BUILD_ENVIRONMENT,
  );
  assert.equal(
    request.command.environmentSha256,
    G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  );
  assert.equal(request.command.argc, G17_BENCHMARK_BUILD_ARGV.length + 1);
  assert.equal(
    request.command.aggregateArgvUtf8Bytes,
    [G17_BENCHMARK_BUILD_PROGRAM, ...G17_BENCHMARK_BUILD_ARGV].reduce(
      (sum, argument) => sum + Buffer.byteLength(argument, "utf8"),
      0,
    ),
  );
  assert.deepEqual(
    plain(request.command.launcher.initialLaunch),
    plain(policy.policy.helper.initialLaunch),
  );
  assert.deepEqual(plain(request.command.cargoTransition), {
    availability: "STRUCTURALLY_LAUNCHABLE_REQUIREMENTS_ONLY",
    ...plain(policy.policy.cargoTransition),
    execStatusPipeWriterDescriptor: policy.policy.statusProtocol.writerFd,
    execStatusPipeReaderRole: policy.policy.statusProtocol.readerRole,
  });
  assert.deepEqual(plain(request.command.descriptorContract), {
    sha256: G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
    imageMaps: plain(policy.policy.fileDescriptors.imageMaps),
  });
  assert.deepEqual(plain(request.command.statusProtocol), {
    schema: policy.policy.statusProtocol.schema,
    requirementsSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
    writerFd: policy.policy.statusProtocol.writerFd,
    readerRole: policy.policy.statusProtocol.readerRole,
    maximumBytes: policy.policy.statusProtocol.maximumBytes,
    maximumFrames: policy.policy.statusProtocol.maximumFrames,
    timeoutMilliseconds: policy.policy.statusProtocol.timeoutMilliseconds,
  });
  assert.deepEqual(request.limits, G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS);
  assert.deepEqual(request.limits, G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS);
});

test("request v2 is structurally launchable but remains physically ineligible", () => {
  const created = createG17BenchmarkExecutionRequestV2Artifact(input());
  assert.deepEqual(
    plain(G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY),
    {
      status: "POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED",
      compatibilityScope: "STRUCTURAL_POLICY_ONLY",
      boundIsolationPolicySchema:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
      currentPolicyCompatible: true,
      structurallyLaunchable: true,
      physicalLaunchEligible: false,
      privatePhysicalIssuerRequired: true,
      helperAttestationRequired: true,
      nativeContainmentAdapterRequired: true,
      requiredContainmentSchema:
        "oxigraph.g1.7-non-tmpfs-containment-evidence/v2",
      launchBeforePrivateIssuerForbidden: true,
    },
  );
  assert.deepEqual(
    created.request.launchCompatibility,
    G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
  );
  assert.equal(created.request.binding, null);
  assert.equal(created.request.finalDecisionEligible, false);
  assert.equal(created.projection.currentPolicyCompatible, true);
  assert.equal(created.projection.structurallyLaunchable, true);
  assert.equal(created.projection.physicalLaunchEligible, false);
  assert.equal(created.projection.binding, null);
  assert.equal(created.projection.finalDecisionEligible, false);
});

test("request v2 freezes exhaustive false authority and physical nonclaims", () => {
  const expectedAuthority = [
    "buildExecutionAuthority",
    "launchExecutionAuthority",
    "controlExecutionAuthority",
    "qualificationExecutionAuthority",
    "receiptAuthority",
    "promotionAuthority",
    "publicationAuthority",
    "routerQualityAuthority",
    "providerExecutionAuthority",
    "helperExecutionAuthority",
    "cargoExecutionAuthority",
    "containmentExecutionAuthority",
    "physicalIssuanceAuthority",
  ];
  const expectedNonclaims = [
    "physicalOwnerIssued",
    "privatePhysicalIssuerImplemented",
    "nativeHelperImplemented",
    "helperAttestationObserved",
    "helperInitialLaunchObserved",
    "helperDescriptorMapObserved",
    "helperCloexecTransitionObserved",
    "helperStatusProtocolObserved",
    "cargoExecveatObserved",
    "cargoExecutionObserved",
    "rustcExecutionObserved",
    "containmentV2Implemented",
    "nativeContainmentAdapterImplemented",
    "containmentApplied",
    "clone3CgroupPlacementObserved",
    "directChildPidfdWaitidAttested",
    "cgroupQuiescenceObserved",
    "serializedRequestProvesPhysicalLaunch",
    "controlAuthorizationApproved",
  ];
  assert.deepEqual(
    Object.keys(G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY),
    expectedAuthority,
  );
  assert.deepEqual(
    Object.keys(G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS),
    expectedNonclaims,
  );
  assert.ok(
    Object.values(G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY).every(
      (value) => value === false,
    ),
  );
  assert.ok(
    Object.values(G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS).every(
      (value) => value === false,
    ),
  );
  const { request, projection } =
    createG17BenchmarkExecutionRequestV2Artifact(input());
  assert.deepEqual(
    request.authority,
    G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
  );
  assert.deepEqual(
    request.nonclaims,
    G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
  );
  assert.deepEqual(
    projection.authority,
    G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
  );
  assert.deepEqual(
    projection.nonclaims,
    G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
  );
});

test("verifier returns typed failures for sealed policy and authority drift", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestV2Artifact(expected);
  for (const [code, mutate] of [
    [
      "POLICY_BINDING_DRIFT",
      (request) => {
        request.isolationPolicy.rawSha256 = "0".repeat(64);
      },
    ],
    [
      "POLICY_BINDING_DRIFT",
      (request) => {
        request.isolationPolicy.fileDescriptorsSha256 = "0".repeat(64);
      },
    ],
    [
      "POLICY_BINDING_DRIFT",
      (request) => {
        request.isolationPolicy.statusProtocol.requirementsSha256 = "0".repeat(
          64,
        );
      },
    ],
    [
      "COMPATIBILITY_DRIFT",
      (request) => {
        request.launchCompatibility.currentPolicyCompatible = false;
      },
    ],
    [
      "COMPATIBILITY_DRIFT",
      (request) => {
        request.launchCompatibility.physicalLaunchEligible = true;
      },
    ],
    [
      "AUTHORITY_OVERCLAIM",
      (request) => {
        request.binding = {};
      },
    ],
    [
      "AUTHORITY_OVERCLAIM",
      (request) => {
        request.finalDecisionEligible = true;
      },
    ],
  ]) {
    assertCode(
      () =>
        verifyG17BenchmarkExecutionRequestV2Artifact({
          bytes: mutatedBytes(created, mutate),
          expected,
        }),
      code,
    );
  }
  for (const key of Object.keys(G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY)) {
    assertCode(
      () =>
        verifyG17BenchmarkExecutionRequestV2Artifact({
          bytes: mutatedBytes(created, (request) => {
            request.authority[key] = true;
          }),
          expected,
        }),
      "AUTHORITY_OVERCLAIM",
    );
  }
  for (const key of Object.keys(G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS)) {
    assertCode(
      () =>
        verifyG17BenchmarkExecutionRequestV2Artifact({
          bytes: mutatedBytes(created, (request) => {
            request.nonclaims[key] = true;
          }),
          expected,
        }),
      "AUTHORITY_OVERCLAIM",
    );
  }
});

test("verifier returns typed failures for command, limit, identity, and expected drift", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestV2Artifact(expected);
  for (const [code, mutate] of [
    [
      "COMMAND_CONTRACT_DRIFT",
      (request) => {
        request.command.cargoTransition.executableFd = 5;
      },
    ],
    [
      "COMMAND_CONTRACT_DRIFT",
      (request) => {
        request.command.statusProtocol.writerFd = 8;
      },
    ],
    [
      "COMMAND_CONTRACT_DRIFT",
      (request) => {
        request.command.descriptorContract.imageMaps.launcherPrivateFileDescriptors =
          [6, 7];
      },
    ],
    [
      "LIMIT_EXCEEDED",
      (request) => {
        request.limits.timeoutMilliseconds += 1;
      },
    ],
    [
      "IDENTITY_INVALID",
      (request) => {
        request.schema = "oxigraph.g1.7-benchmark-execution-request/v1";
      },
    ],
  ]) {
    assertCode(
      () =>
        verifyG17BenchmarkExecutionRequestV2Artifact({
          bytes: mutatedBytes(created, mutate),
          expected,
        }),
      code,
    );
  }
  const other = input(1);
  assertCode(
    () =>
      verifyG17BenchmarkExecutionRequestV2Artifact({
        bytes: created.artifact.bytes,
        expected: other,
      }),
    "EXPECTED_INPUT_MISMATCH",
  );
});

test("request creation accepts null prototypes and rejects hostile own-data shapes", () => {
  const ordinary = createG17BenchmarkExecutionRequestV2Artifact(input());
  const nullPrototype = createG17BenchmarkExecutionRequestV2Artifact(
    toNullPrototype(input()),
  );
  assert.deepEqual(nullPrototype.artifact.bytes, ordinary.artifact.bytes);

  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(new Proxy(input(), {})),
    "INPUT_SHAPE_INVALID",
  );
  const accessor = input();
  Object.defineProperty(accessor, "controlRunId", {
    enumerable: true,
    get() {
      throw new Error("must not run");
    },
  });
  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(accessor),
    "INPUT_SHAPE_INVALID",
  );
  const symbol = input();
  symbol[Symbol("hidden")] = true;
  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(symbol),
    "INPUT_SHAPE_INVALID",
  );
  const hidden = input();
  Object.defineProperty(hidden, "hidden", { enumerable: false, value: true });
  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(hidden),
    "INPUT_SHAPE_INVALID",
  );
  const foreign = Object.assign(Object.create({ inherited: true }), input());
  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(foreign),
    "INPUT_SHAPE_INVALID",
  );
  const cycle = input();
  cycle.source.loop = cycle;
  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(cycle),
    "INPUT_SHAPE_INVALID",
  );
  const tooDeep = input();
  let cursor = tooDeep.source;
  for (let index = 0; index < 70; index += 1) cursor = cursor.next = {};
  assertCode(
    () => createG17BenchmarkExecutionRequestV2Artifact(tooDeep),
    "LIMIT_EXCEEDED",
  );
});

test("request verification rejects noncanonical, partial, malformed, and ambiguous artifacts", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestV2Artifact(expected);
  const verify = (bytes) =>
    verifyG17BenchmarkExecutionRequestV2Artifact({ bytes, expected });

  const document = JSON.parse(created.artifact.bytes.toString("utf8"));
  assertCode(
    () => verify(Buffer.from(JSON.stringify(document), "utf8")),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () => verify(Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8")),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () => verify(Buffer.from(`${canonicalJson(document)}\n\n`, "utf8")),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () =>
      verify(
        Buffer.from(
          `{"schema":${JSON.stringify(document.schema)},${canonicalJson(document).slice(1)}\n`,
          "utf8",
        ),
      ),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () => verify(Buffer.from(`${canonicalJson(document)} true\n`, "utf8")),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () => verify(Buffer.from('{"schema":\n', "utf8")),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () => verify(Buffer.from([0xff, 0x0a])),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () =>
      verify(Buffer.alloc(G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES + 1)),
    "CANONICAL_ARTIFACT_INVALID",
  );
  assertCode(
    () =>
      verify(
        mutatedBytes(
          created,
          (request) => {
            request.contentHash = "0".repeat(64);
          },
          { resealContent: false },
        ),
      ),
    "CONTENT_HASH_MISMATCH",
  );
  assertCode(
    () =>
      verifyG17BenchmarkExecutionRequestV2Artifact({
        bytes: createV1Request(expected).artifact.bytes,
        expected,
      }),
    "IDENTITY_INVALID",
  );
});

test("verification envelope and artifact buffer handling are intrinsic and defensive", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestV2Artifact(expected);
  assertCode(
    () => verifyG17BenchmarkExecutionRequestV2Artifact(null),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkExecutionRequestV2Artifact(
        new Proxy({ bytes: created.artifact.bytes, expected }, {}),
      ),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkExecutionRequestV2Artifact({
        bytes: created.artifact.bytes,
        expected,
        extra: true,
      }),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkExecutionRequestV2Artifact({
        bytes: new Proxy(created.artifact.bytes, {}),
        expected,
      }),
    "INPUT_SHAPE_INVALID",
  );
  const withOwnLength = created.artifact.bytes;
  Object.defineProperty(withOwnLength, "length", {
    value: withOwnLength.length,
  });
  assertCode(
    () =>
      verifyG17BenchmarkExecutionRequestV2Artifact({
        bytes: withOwnLength,
        expected,
      }),
    "INPUT_SHAPE_INVALID",
  );

  const first = created.artifact.bytes;
  first.fill(0);
  assert.notDeepEqual(first, created.artifact.bytes);
  assert.notStrictEqual(created.artifact.bytes, created.artifact.bytes);
  assert.ok(Object.isFrozen(created.artifact));
  assert.ok(Object.isFrozen(created.projection));
});

test("request v1 remains permanently incompatible with the v2 physical boundary", () => {
  const expected = input();
  const v1 = createV1Request(expected).request;
  const v2 = createG17BenchmarkExecutionRequestV2Artifact(expected);
  assert.equal(V1_COMPATIBILITY.status, "SUCCESSOR_ISOLATION_POLICY_REQUIRED");
  assert.equal(V1_COMPATIBILITY.currentPolicyCompatible, false);
  assert.equal(V1_COMPATIBILITY.physicalLaunchEligible, false);
  assert.equal(
    v1.isolationPolicy.schema,
    "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v1",
  );
  assert.equal(v1.command.programExecution.heldExecutableDescriptor, null);
  assert.equal(
    v1.command.programExecution.execStatusPipeWriterDescriptor,
    null,
  );
  assert.throws(
    () => verifyV1Request({ bytes: v2.artifact.bytes, expected }),
    /G1\.7 benchmark execution request contract: request schema drifted/u,
  );
});

test("process evidence v3 remains request-v1-schema and v1-status only", () => {
  const v2SchemaProbe = processV3VersionProbe(
    processV3RequestProjection({
      schema: G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
      launchCompatibilityStatus:
        G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY.status,
    }),
  );
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(v2SchemaProbe),
    /expected execution request identity schema drifted/u,
  );

  const v2StatusProbe = processV3VersionProbe(
    processV3RequestProjection({
      schema: "oxigraph.g1.7-benchmark-execution-request/v1",
      launchCompatibilityStatus:
        G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY.status,
    }),
  );
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(v2StatusProbe),
    /expected execution request projection overclaims current launch compatibility/u,
  );
});

test("request v2 exposes a finite immutable ADR-160 termination vocabulary", () => {
  assert.deepEqual(G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES, [
    "INPUT_SHAPE_INVALID",
    "LIMIT_EXCEEDED",
    "IDENTITY_INVALID",
    "POLICY_BINDING_DRIFT",
    "COMMAND_CONTRACT_DRIFT",
    "COMPATIBILITY_DRIFT",
    "CANONICAL_ARTIFACT_INVALID",
    "CONTENT_HASH_MISMATCH",
    "AUTHORITY_OVERCLAIM",
    "EXPECTED_INPUT_MISMATCH",
    "DEPENDENCY_UNCERTAIN",
  ]);
  assert.equal(
    Object.isFrozen(G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES),
    true,
  );
  assert.equal(
    new Set(G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES).size,
    G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES.length,
  );
});
