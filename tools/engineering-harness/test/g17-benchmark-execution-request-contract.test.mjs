import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_BENCHMARK_EXECUTION_REQUEST_ARGV_MAX_BYTES,
  G17_BENCHMARK_EXECUTION_REQUEST_ARTIFACT_NAME,
  G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY,
  G17_BENCHMARK_EXECUTION_REQUEST_CARGO_LAUNCH_MECHANISM,
  G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY,
  G17_BENCHMARK_EXECUTION_REQUEST_LIMITS,
  G17_BENCHMARK_EXECUTION_REQUEST_MAX_BYTES,
  G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS,
  G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_SUCCESSOR_ISOLATION_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_TIMEOUT_MS,
  createG17BenchmarkExecutionRequestArtifact,
  verifyG17BenchmarkExecutionRequestArtifact,
} from "../src/qualification/benchmark-execution-request-contract.mjs";
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
  G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
  createG17NonTmpfsBuildIsolationPolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /G1\.7 benchmark execution request contract/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function input(buildIndex = 0) {
  const build = G17_BENCHMARK_BUILD_PLAN[buildIndex];
  return {
    controlRunId: "execution-request-fixture",
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
      controlRunId: "execution-request-fixture",
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
      processGeneration: `g17-process-${String(buildIndex + 1).padStart(
        64,
        "0",
      )}`,
      ordinal: buildIndex + 1,
    },
  };
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

function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function mutatedBytes(created, mutate) {
  const request = JSON.parse(created.artifact.bytes.toString("utf8"));
  mutate(request);
  return reseal(request);
}

test("execution request v1 freezes all four pre-execution build identities", () => {
  const isolation = createG17NonTmpfsBuildIsolationPolicyArtifact();

  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA,
    "oxigraph.g1.7-benchmark-execution-request/v1",
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_CARGO_LAUNCH_MECHANISM,
    "execveat-held-fd-empty-path/v1",
  );

  for (const [index, build] of G17_BENCHMARK_BUILD_PLAN.entries()) {
    const expected = input(index);
    const created = createG17BenchmarkExecutionRequestArtifact(expected);
    const { request, identity, artifact } = created;

    assert.equal(artifact.name, G17_BENCHMARK_EXECUTION_REQUEST_ARTIFACT_NAME);
    assert.equal(artifact.rawSha256, sha256(artifact.bytes));
    assert.deepEqual(plainJson(identity), {
      schema: G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA,
      rawSha256: artifact.rawSha256,
      contentHash: request.contentHash,
    });
    assert.equal(request.buildId, build.buildId);
    assert.equal(request.productRole, build.productRole);
    assert.equal(request.ownership.ordinal, index + 1);
    assert.deepEqual(plainJson(request.authorization), expected.authorization);
    assert.deepEqual(plainJson(request.source), {
      schema: "oxigraph.g1.7-product-source-projection/v1",
      ...expected.source,
    });
    assert.deepEqual(plainJson(request.platform), expected.platform);
    assert.deepEqual(plainJson(request.ownership), expected.ownership);
    assert.deepEqual(plainJson(request.executionPlan), {
      schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
      sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipe: {
        schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
        sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      },
    });
    assert.deepEqual(plainJson(request.isolationPolicy), {
      schema: G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA,
      rawSha256: isolation.artifact.sha256,
      contentHash: isolation.policy.sha256,
    });
    assert.equal(request.command.program, G17_BENCHMARK_BUILD_PROGRAM);
    assert.deepEqual(plainJson(request.command.programExecution), {
      mechanism: "execveat-held-fd-empty-path/v1",
      availability: "UNAVAILABLE_UNDER_BOUND_ISOLATION_POLICY",
      emptyPathRequired: true,
      pathnameLaunchForbidden: true,
      heldExecutableDescriptor: null,
      execStatusPipeWriterDescriptor: null,
    });
    assert.equal(request.command.argv0, G17_BENCHMARK_BUILD_PROGRAM);
    assert.deepEqual(plainJson(request.command.argv), G17_BENCHMARK_BUILD_ARGV);
    assert.equal(
      request.command.aggregateArgvUtf8Bytes,
      [G17_BENCHMARK_BUILD_PROGRAM, ...G17_BENCHMARK_BUILD_ARGV].reduce(
        (sum, argument) => sum + Buffer.byteLength(argument, "utf8"),
        0,
      ),
    );
    assert.ok(
      request.command.aggregateArgvUtf8Bytes <=
        request.limits.aggregateArgvUtf8MaximumBytes,
    );
    assert.deepEqual(
      plainJson(request.command.environment),
      G17_BENCHMARK_BUILD_ENVIRONMENT,
    );
    assert.equal(
      request.command.environmentSha256,
      G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
    );
    assert.equal(
      request.command.cwd,
      G17_BENCHMARK_EXECUTION_PLAN.build.workingDirectory,
    );
    assert.equal(
      request.command.targetDirectory,
      G17_BENCHMARK_EXECUTION_PLAN.build.targetDirectory,
    );
    assert.deepEqual(
      plainJson(request.command.inheritedFileDescriptors),
      isolation.policy.process.stdio.inheritedFileDescriptors,
    );
    assert.deepEqual(request.limits, G17_BENCHMARK_EXECUTION_REQUEST_LIMITS);
    assert.deepEqual(
      request.launchCompatibility,
      G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY,
    );
    assert.deepEqual(
      request.authority,
      G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY,
    );
    assert.deepEqual(
      request.nonclaims,
      G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS,
    );
    assert.equal(request.binding, null);
    assert.equal(request.finalDecisionEligible, false);
    assert.equal(
      request.contentHash,
      canonicalSha256(
        Object.fromEntries(
          Object.entries(request).filter(([key]) => key !== "contentHash"),
        ),
      ),
    );
    const verified = verifyG17BenchmarkExecutionRequestArtifact({
      bytes: artifact.bytes,
      expected,
    });
    assert.deepEqual(verified.request, request);
    assert.deepEqual(verified.identity, identity);
    assert.equal(Object.getPrototypeOf(verified), null);
    assertNullPrototypeRecords(request);
    assertDeepFrozen(request);
  }
});

test("execution request pins the exact G1.7 byte, timeout, and reap limits", () => {
  assert.equal(G17_BENCHMARK_EXECUTION_REQUEST_TIMEOUT_MS, 300_000);
  assert.equal(G17_BENCHMARK_EXECUTION_REQUEST_ARGV_MAX_BYTES, 1024 * 1024);
  assert.deepEqual(plainJson(G17_BENCHMARK_EXECUTION_REQUEST_LIMITS), {
    timeoutMilliseconds: 300_000,
    combinedOutputMaximumBytes: G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
    termGraceMilliseconds: G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
    closeReapTimeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
    aggregateArgvUtf8MaximumBytes: 1024 * 1024,
  });
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_LIMITS.combinedOutputMaximumBytes,
    64 * 1024 * 1024,
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_LIMITS.termGraceMilliseconds,
    250,
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_LIMITS.closeReapTimeoutMilliseconds,
    2_000,
  );
});

test("request fails closed until a successor policy models launcher-private fds", () => {
  const request = createG17BenchmarkExecutionRequestArtifact(input()).request;
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_SUCCESSOR_ISOLATION_SCHEMA,
    "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2",
  );
  assert.deepEqual(plainJson(request.launchCompatibility), {
    status: "SUCCESSOR_ISOLATION_POLICY_REQUIRED",
    boundIsolationPolicySchema:
      "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v1",
    requiredSuccessorPolicySchema:
      "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2",
    currentPolicyCompatible: false,
    physicalLaunchEligible: false,
    launchBeforeSuccessorPolicyForbidden: true,
    requiredCapabilities: [
      "launcher-private-held-cargo-fd-cloexec",
      "launcher-private-exec-status-pipe-writer-cloexec",
      "exact-launcher-private-vs-cargo-image-inherited-fd-separation",
    ],
  });
  assert.equal(
    request.nonclaims.boundIsolationPolicySupportsRequiredLauncherDescriptors,
    false,
  );
  assert.deepEqual(
    request.command.inheritedFileDescriptors.map(({ childFd }) => childFd),
    [3, 4, 5],
  );
  assert.equal(request.command.programExecution.heldExecutableDescriptor, null);
  assert.equal(
    request.command.programExecution.execStatusPipeWriterDescriptor,
    null,
  );
  assert.equal(request.command.programExecution.pathnameLaunchForbidden, true);
});

test("request input accepts ordinary or null-prototype own-data records deterministically", () => {
  const ordinary = createG17BenchmarkExecutionRequestArtifact(input());
  const nullPrototype = createG17BenchmarkExecutionRequestArtifact(
    toNullPrototype(input()),
  );

  assert.deepEqual(nullPrototype.artifact.bytes, ordinary.artifact.bytes);
  assert.deepEqual(nullPrototype.identity, ordinary.identity);
  assertNullPrototypeRecords(nullPrototype.request);
  assert.equal(Object.getPrototypeOf(nullPrototype), null);
  assert.equal(Object.getPrototypeOf(nullPrototype.identity), null);
  assert.equal(Object.getPrototypeOf(nullPrototype.artifact), null);

  const first = ordinary.artifact.bytes;
  first.fill(0);
  assert.notDeepEqual(first, ordinary.artifact.bytes);
  assert.notStrictEqual(ordinary.artifact.bytes, ordinary.artifact.bytes);
});

test("request input rejects proxies, accessors, symbols, hidden data, and foreign prototypes", () => {
  const proxy = new Proxy(input(), {});
  assert.throws(
    () => createG17BenchmarkExecutionRequestArtifact(proxy),
    CONTRACT_ERROR,
  );

  const accessor = input();
  Object.defineProperty(accessor.authorization, "rawSha256", {
    get: () => "1".repeat(64),
    enumerable: true,
  });
  assert.throws(
    () => createG17BenchmarkExecutionRequestArtifact(accessor),
    CONTRACT_ERROR,
  );

  const symbol = input();
  symbol[Symbol("unexpected")] = true;
  assert.throws(
    () => createG17BenchmarkExecutionRequestArtifact(symbol),
    CONTRACT_ERROR,
  );

  const hidden = input();
  Object.defineProperty(hidden.platform, "hidden", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => createG17BenchmarkExecutionRequestArtifact(hidden),
    CONTRACT_ERROR,
  );

  const foreign = input();
  Object.setPrototypeOf(foreign.ownership, { inheritedAuthority: true });
  assert.throws(
    () => createG17BenchmarkExecutionRequestArtifact(foreign),
    CONTRACT_ERROR,
  );
});

test("request input rejects invalid run, generation, ordinal, and platform identities", () => {
  const mutations = [
    (value) => {
      value.controlRunId = "unsafe run";
    },
    (value) => {
      value.ownership.ownerGeneration = "g17-owner-1";
    },
    (value) => {
      value.ownership.processGeneration = "g17-process-1";
    },
    (value) => {
      value.source.workspaceGeneration = "g17-workspace-1";
    },
    (value) => {
      value.source.targetGeneration = "g17-target-1";
    },
    (value) => {
      value.source.controlRunId = "different-run";
    },
    (value) => {
      value.source.buildId = "noise-control-a";
    },
    (value) => {
      value.source.productRole = "noiseControl";
    },
    (value) => {
      value.ownership.ordinal = 0;
    },
    (value) => {
      value.ownership.ordinal = 5;
    },
    (value) => {
      value.buildId = "noise-control-a";
    },
    (value) => {
      value.platform.cargo.logicalPath = "/usr/bin/cargo";
    },
    (value) => {
      value.platform.cargo.identity.mode = 0o100444;
    },
    (value) => {
      value.platform.cargo.identity.inode = "0";
    },
    (value) => {
      value.platform.rustc.identity.inode = value.platform.cargo.identity.inode;
    },
    (value) => {
      value.platform.rustc.sha256 = value.platform.cargo.sha256;
    },
    (value) => {
      value.unexpected = true;
    },
  ];

  for (const mutate of mutations) {
    const candidate = input();
    mutate(candidate);
    assert.throws(
      () => createG17BenchmarkExecutionRequestArtifact(candidate),
      CONTRACT_ERROR,
    );
  }
});

test("canonical verifier rejects non-canonical, malformed, and oversized bytes", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestArtifact(expected);
  const request = JSON.parse(created.artifact.bytes.toString("utf8"));
  const invalid = [
    Buffer.from(`${JSON.stringify(request, null, 2)}\n`, "utf8"),
    created.artifact.bytes.subarray(0, created.artifact.bytes.length - 1),
    Buffer.concat([created.artifact.bytes, Buffer.from("\n")]),
    Buffer.from([0xff, 0x0a]),
    Buffer.alloc(G17_BENCHMARK_EXECUTION_REQUEST_MAX_BYTES + 1, 0x20),
  ];

  for (const bytes of invalid) {
    assert.throws(
      () => verifyG17BenchmarkExecutionRequestArtifact({ bytes, expected }),
      CONTRACT_ERROR,
    );
  }
});

test("verifier rejects every authority, binding, and eligibility overclaim", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestArtifact(expected);
  assert.deepEqual(plainJson(G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY), {
    buildExecutionAuthority: false,
    launchExecutionAuthority: false,
    controlExecutionAuthority: false,
    qualificationExecutionAuthority: false,
    receiptAuthority: false,
    promotionAuthority: false,
    publicationAuthority: false,
    routerQualityAuthority: false,
    providerExecutionAuthority: false,
  });
  assert.deepEqual(plainJson(G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS), {
    physicalOwnerIssued: false,
    currentNodeExecveatAdapterImplemented: false,
    boundIsolationPolicySupportsRequiredLauncherDescriptors: false,
    cargoExecutionObserved: false,
    rustcExecutionObserved: false,
    containmentApplied: false,
    directChildReaped: false,
    cgroupQuiescenceObserved: false,
  });
  const mutations = [
    ...Object.keys(G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY).map(
      (key) => (value) => {
        value.authority[key] = true;
      },
    ),
    ...Object.keys(G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS).map(
      (key) => (value) => {
        value.nonclaims[key] = true;
      },
    ),
    (value) => {
      value.launchCompatibility.currentPolicyCompatible = true;
    },
    (value) => {
      value.launchCompatibility.physicalLaunchEligible = true;
    },
    (value) => {
      value.launchCompatibility.status = "CURRENT_POLICY_COMPATIBLE";
    },
    (value) => {
      value.binding = { physicallyIssued: true };
    },
    (value) => {
      value.finalDecisionEligible = true;
    },
  ];

  for (const mutate of mutations) {
    assert.throws(
      () =>
        verifyG17BenchmarkExecutionRequestArtifact({
          bytes: mutatedBytes(created, mutate),
          expected,
        }),
      CONTRACT_ERROR,
    );
  }
});

test("verifier rejects pathname launch and drift in every frozen command boundary", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestArtifact(expected);
  const mutations = [
    (value) => {
      value.command.programExecution.mechanism = "pathname-spawn/v1";
    },
    (value) => {
      value.command.programExecution.pathnameLaunchForbidden = false;
    },
    (value) => {
      value.command.programExecution.availability = "AVAILABLE";
      value.command.programExecution.heldExecutableDescriptor = 6;
      value.command.programExecution.execStatusPipeWriterDescriptor = 7;
    },
    (value) => {
      value.command.program = "cargo";
    },
    (value) => {
      value.command.argv0 = "cargo";
    },
    (value) => {
      value.command.argv.unshift("cargo");
    },
    (value) => {
      value.command.aggregateArgvUtf8Bytes += 1;
    },
    (value) => {
      value.command.environment.CARGO_BUILD_JOBS = "8";
    },
    (value) => {
      value.command.cwd = "/workspace/other";
    },
    (value) => {
      value.command.inheritedFileDescriptors[1].childFd = 6;
    },
    (value) => {
      value.command.inheritedFileDescriptors.reverse();
    },
    (value) => {
      value.limits.timeoutMilliseconds += 1;
    },
    (value) => {
      value.limits.combinedOutputMaximumBytes -= 1;
    },
    (value) => {
      value.limits.termGraceMilliseconds += 1;
    },
    (value) => {
      value.limits.closeReapTimeoutMilliseconds += 1;
    },
    (value) => {
      value.limits.aggregateArgvUtf8MaximumBytes += 1;
    },
  ];

  for (const mutate of mutations) {
    assert.throws(
      () =>
        verifyG17BenchmarkExecutionRequestArtifact({
          bytes: mutatedBytes(created, mutate),
          expected,
        }),
      CONTRACT_ERROR,
    );
  }
});

test("verifier binds exact authorization, plan, policy, source, platform, and ownership", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestArtifact(expected);
  const requestMutations = [
    (value) => {
      value.authorization.rawSha256 = "c".repeat(64);
    },
    (value) => {
      value.executionPlan.sha256 = "d".repeat(64);
    },
    (value) => {
      value.isolationPolicy.rawSha256 = "e".repeat(64);
    },
    (value) => {
      value.source.workspaceGeneration = `g17-workspace-${"f".repeat(64)}`;
    },
    (value) => {
      value.platform.cargo.sha256 = "c".repeat(64);
    },
    (value) => {
      value.ownership.processGeneration = `g17-process-${"d".repeat(64)}`;
    },
  ];
  for (const mutate of requestMutations) {
    assert.throws(
      () =>
        verifyG17BenchmarkExecutionRequestArtifact({
          bytes: mutatedBytes(created, mutate),
          expected,
        }),
      CONTRACT_ERROR,
    );
  }

  const expectedMutations = [
    (value) => {
      value.authorization.contentHash = "c".repeat(64);
    },
    (value) => {
      value.source.rawSha256 = "d".repeat(64);
    },
    (value) => {
      value.platform.rustc.identity.inode = "203";
    },
    (value) => {
      value.ownership.ownerGeneration = `g17-owner-${"e".repeat(64)}`;
    },
  ];
  for (const mutate of expectedMutations) {
    const driftedExpected = input();
    mutate(driftedExpected);
    assert.throws(
      () =>
        verifyG17BenchmarkExecutionRequestArtifact({
          bytes: created.artifact.bytes,
          expected: driftedExpected,
        }),
      CONTRACT_ERROR,
    );
  }
});

test("verification envelope itself requires exact own enumerable data", () => {
  const expected = input();
  const created = createG17BenchmarkExecutionRequestArtifact(expected);
  const accessor = { expected };
  Object.defineProperty(accessor, "bytes", {
    get: () => created.artifact.bytes,
    enumerable: true,
  });
  assert.throws(
    () => verifyG17BenchmarkExecutionRequestArtifact(accessor),
    CONTRACT_ERROR,
  );

  assert.throws(
    () =>
      verifyG17BenchmarkExecutionRequestArtifact({
        bytes: created.artifact.bytes,
        expected,
        authority: true,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17BenchmarkExecutionRequestArtifact(
        new Proxy({ bytes: created.artifact.bytes, expected }, {}),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17BenchmarkExecutionRequestArtifact({
        bytes: new Proxy(created.artifact.bytes, {}),
        expected,
      }),
    CONTRACT_ERROR,
  );
});
