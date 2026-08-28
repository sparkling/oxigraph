import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_PROCESS_AUTHORITY,
  G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_SCHEMA,
  G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS,
} from "../src/qualification/benchmark-build-process-evidence-contract.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "../src/qualification/benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_PRODUCT_BUILD_PLAN,
  G17_BENCHMARK_PRODUCT_OWNER_AUTHORITY,
  G17_BENCHMARK_PRODUCT_OWNER_NONCLAIMS,
  G17_BENCHMARK_PRODUCT_OWNER_PROJECTION_SCHEMA,
  G17_BENCHMARK_PRODUCT_OWNER_SCHEMA,
  G17_PRODUCT_SOURCE_PROJECTION_SCHEMA,
  verifyG17BenchmarkProductOwner,
} from "../src/qualification/benchmark-product-owner-contract.mjs";
import {
  G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
  verifyG17NativeIsolationPolicyArtifact,
  verifyG17NativePlatformBundle,
} from "../src/qualification/native-platform-contract.mjs";
import {
  beginG17ProductSourceBuild,
  createG17ProductSourceGateForTesting,
  createG17ProductSourceWorkspace,
  destroyG17ProductSourceWorkspace,
  finishG17ProductSourceBuildForTesting,
  g17ProductSourceBuildInputs,
  G17_PRODUCT_SOURCE_PROJECTION_SCHEMA as LIVE_PRODUCT_SOURCE_PROJECTION_SCHEMA,
  mintG17ProductSourceCompletedReapProofForTesting,
} from "../src/qualification/product-source-workspace.mjs";
import {
  buildG17NativeSnapshotHelper,
  closeG17NativeSnapshotHelper,
} from "../src/qualification/native-snapshot.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  EXPECTED_G17_BENCHMARK_BUILD_PLAN,
  createG17BenchmarkOwnerFixture,
  resealG17BenchmarkOwnerArtifact,
} from "./support/g17-benchmark-owner-fixture.mjs";
import { createG17NativeApplicationFixture } from "./support/g17-native-application-fixture.mjs";

const CONTRACT_ERROR = /G1\.7 benchmark product owner contract/u;
const SOURCE_OBJECT_CLOSURE_SCHEMA =
  "oxigraph.g1.7-product-source-object-closure/v1";
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const SOURCE_AUTHORITY = Object.freeze({
  build: false,
  launch: false,
  control: false,
  qualification: false,
  promotion: false,
  publication: false,
  provider: false,
  routerQuality: false,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function seal(value) {
  const { contentHash: ignored, ...unsigned } = structuredClone(value);
  return { ...unsigned, contentHash: canonicalSha256(unsigned) };
}

function decode(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function minimalElf(suffix) {
  const bytes = Buffer.alloc(121);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x40_0000n, 24);
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(1, 64);
  bytes.writeUInt32LE(5, 68);
  bytes.writeBigUInt64LE(0n, 72);
  bytes.writeBigUInt64LE(0x40_0000n, 80);
  bytes.writeBigUInt64LE(0x40_0000n, 88);
  bytes.writeBigUInt64LE(120n, 96);
  bytes.writeBigUInt64LE(120n, 104);
  bytes.writeBigUInt64LE(4_096n, 112);
  bytes[120] = suffix;
  return bytes;
}

const nativeFixture = createG17NativeApplicationFixture({
  runId: "benchmark-product-platform-fixture",
});
const nativeArtifacts = new Map(
  nativeFixture.input.artifacts.map(({ name, bytes }) => [name, bytes]),
);
const basePlatformArtifacts = Object.freeze({
  platformBytes: Buffer.from(nativeArtifacts.get(G17_NATIVE_PLATFORM_ARTIFACT_NAME)),
  sourcePlanBytes: Buffer.from(
    nativeArtifacts.get(G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME),
  ),
  controllerBytes: Buffer.from(
    nativeArtifacts.get(G17_NATIVE_CONTROLLER_ARTIFACT_NAME),
  ),
  isolationPolicyBytes: Buffer.from(
    nativeArtifacts.get(G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME),
  ),
});
const baseToolchainArtifacts = Object.freeze({
  cargoExecutableBytes: Buffer.from("cargo:0", "utf8"),
  rustcExecutableBytes: Buffer.from("rustc:1", "utf8"),
});

function cloneBuffers(value) {
  return Object.fromEntries(
    Object.entries(value).map(([name, bytes]) => [name, Buffer.from(bytes)]),
  );
}

function expectedEvaluator(authorization, productRole) {
  const evaluator = authorization.protocol.evaluatorOverlay;
  return {
    commit: evaluator.commit,
    parent: evaluator.parent,
    tree: evaluator.tree,
    patchSha256: evaluator.patchSha256,
    paths: structuredClone(evaluator.paths),
    composition: structuredClone(evaluator.roleCompositions[productRole]),
  };
}

function platformProjection(platformArtifacts, toolchainArtifacts) {
  const bundle = verifyG17NativePlatformBundle({
    platformBytes: platformArtifacts.platformBytes,
    sourcePlanBytes: platformArtifacts.sourcePlanBytes,
    controllerBytes: platformArtifacts.controllerBytes,
  });
  const policy = verifyG17NativeIsolationPolicyArtifact(
    platformArtifacts.isolationPolicyBytes,
  );
  const logicalTool = (role) => ({
    logicalPath: `/${role.root}/${role.resolvedPath}`,
    sha256: role.sha256,
  });
  const projection = {
    closure: {
      rawSha256: sha256(platformArtifacts.platformBytes),
      manifestSha256: bundle.platform.manifestSha256,
      platformRootSha256: bundle.platform.platformRootSha256,
      toolchainRootSha256: bundle.platform.toolchainRootSha256,
    },
    sourcePlan: {
      rawSha256: sha256(platformArtifacts.sourcePlanBytes),
      projectionSha256: bundle.sourcePlanProjectionSha256,
    },
    controller: {
      rawSha256: sha256(platformArtifacts.controllerBytes),
      contentSha256: bundle.controller.sha256,
    },
    isolationPolicy: {
      rawSha256: sha256(platformArtifacts.isolationPolicyBytes),
      contentSha256: policy.sha256,
    },
    toolchain: {
      rootSha256: bundle.platform.toolchainRootSha256,
      cargo: logicalTool(bundle.platform.roles.cargo),
      rustc: logicalTool(bundle.platform.roles.rustc),
    },
  };
  const expectation = {
    platformRawSha256: projection.closure.rawSha256,
    sourcePlanRawSha256: projection.sourcePlan.rawSha256,
    controllerRawSha256: projection.controller.rawSha256,
    isolationPolicyRawSha256: projection.isolationPolicy.rawSha256,
    platformRootSha256: projection.closure.platformRootSha256,
    toolchainRootSha256: projection.closure.toolchainRootSha256,
    cargoExecutableSha256: sha256(toolchainArtifacts.cargoExecutableBytes),
    rustcExecutableSha256: sha256(toolchainArtifacts.rustcExecutableBytes),
  };
  assert.equal(
    expectation.cargoExecutableSha256,
    projection.toolchain.cargo.sha256,
  );
  assert.equal(
    expectation.rustcExecutableSha256,
    projection.toolchain.rustc.sha256,
  );
  return { projection, expectation };
}

function authorizationFor(logical, approvedBy) {
  const authorization = structuredClone(logical.authorization);
  authorization.approval.approvedBy = approvedBy;
  const { contentHash: ignored, ...unsigned } = authorization;
  authorization.contentHash = canonicalSha256(unsigned);
  const bytes = canonicalBytes(authorization);
  return {
    value: authorization,
    bytes,
    binding: { rawSha256: sha256(bytes), contentHash: authorization.contentHash },
  };
}

function fileIdentity(index, bytes, kind = "file") {
  return {
    device: String(10_000 + index),
    inode: String(20_000 + index),
    uid: "1000",
    gid: "1000",
    mode: kind === "file" ? 0o100555 : 0o040700,
    nlink: kind === "file" ? 1 : 2,
    size: bytes,
  };
}

function heldFile(
  logicalPath,
  bytes,
  index,
  { device, parentDevice, parentInode } = {},
) {
  const identity = {
    ...fileIdentity(index, bytes.length),
    device: device ?? String(10_000 + index),
  };
  return {
    logicalPath,
    parentDevice: parentDevice ?? "20",
    parentInode: parentInode ?? "201",
    heldFd: true,
    before: identity,
    after: structuredClone(identity),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function heldDirectory(root, index, afterSize = 4_096) {
  const before = {
    ...fileIdentity(index, 4_096, "directory"),
    device: root?.device ?? String(30_000 + index),
    inode: root?.inode ?? String(40_000 + index),
    uid: root?.uid ?? "1000",
    gid: root?.gid ?? "1000",
  };
  return {
    heldFd: true,
    before,
    after: { ...before, size: afterSize },
    filesystemType: root?.filesystemType ?? "61267",
  };
}

function heldOutputAncestor(
  logicalPath,
  leafName,
  target,
  inode,
  parentInode,
) {
  const before = {
    ...fileIdentity(Number(inode), 4_096, "directory"),
    device: target.device,
    inode,
    uid: target.uid,
    gid: target.gid,
  };
  return {
    logicalPath,
    leafName,
    heldFd: true,
    parentDevice: target.device,
    parentInode,
    before,
    after: structuredClone(before),
    filesystemType: target.filesystemType,
  };
}

function heldWorkspaceParent(root) {
  return {
    ...heldDirectory(root, 100),
    inheritedFd: 3,
  };
}

function heldWorkspaceChild(child, inheritedFd) {
  const held = heldDirectory(child, Number(child.inode));
  const mode = child.leafName === "source" ? 0o040555 : 0o040700;
  held.before.mode = mode;
  held.after.mode = mode;
  return {
    leafName: child.leafName,
    ...held,
    inheritedFd,
    parentDevice: child.parentDevice,
    parentInode: child.parentInode,
  };
}

function heldPrivateDirectory(logicalPath, index) {
  return {
    logicalPath,
    ...heldDirectory(null, index),
    private: true,
  };
}

function heldToolchainRoot(index) {
  const held = heldDirectory(
    { device: "20", inode: String(200 + index), filesystemType: "61267" },
    200 + index,
  );
  held.before.mode = 0o040555;
  held.after.mode = 0o040555;
  return { logicalPath: "/toolchain", ...held };
}

function heldToolchainBin(index) {
  const held = heldDirectory(
    { device: "20", inode: String(300 + index), filesystemType: "61267" },
    300 + index,
  );
  held.before.mode = 0o040555;
  held.after.mode = 0o040555;
  return {
    logicalPath: "/toolchain/bin",
    leafName: "bin",
    ...held,
    parentDevice: "20",
    parentInode: String(200 + index),
  };
}

function sourceProjection({
  authorization,
  authorizationBinding,
  controlRunId,
  buildId,
  productRole,
  workspaceOwner,
  index,
  salt,
}) {
  const product = structuredClone(authorization.protocol.products[productRole]);
  const evaluator = expectedEvaluator(authorization, productRole);
  const requiredGitlinks = [];
  const excludedGitlinks = [];
  const symlinks = [];
  const effectiveTree = evaluator.composition.effectiveTree;
  const parentRoot = {
    device: String(100 + index),
    inode: String(1_000 + index * 10),
    uid: "1000",
    gid: "1000",
    filesystemType: "61267",
  };
  const child = (leafName, offset) => ({
    leafName,
    device: parentRoot.device,
    inode: String(1_000 + index * 10 + offset),
    uid: parentRoot.uid,
    gid: parentRoot.gid,
    filesystemType: parentRoot.filesystemType,
    parentDevice: parentRoot.device,
    parentInode: parentRoot.inode,
  });
  const value = seal({
    schema: G17_PRODUCT_SOURCE_PROJECTION_SCHEMA,
    controlRunId,
    authorization: structuredClone(authorizationBinding),
    buildId,
    productRole,
    product,
    evaluator,
    workspace: {
      generation: workspaceOwner.workspace.generation,
      targetGeneration: workspaceOwner.workspace.targetGeneration,
      isolated: true,
      targetIsolated: true,
      sourceReadOnlyAtBuildStart: true,
      targetEmptyAtBuildStart: true,
      parentRoot,
      sourceChild: child("source", 1),
      targetChild: child("target", 2),
    },
    source: {
      productCommit: product.commit,
      productTree: product.tree,
      effectiveTree,
      cargoLock: {
        blob: product.cargoLockBlob,
        bytes: 1_024,
        sha256: product.cargoLockSha256,
      },
      evaluatorPatch: {
        bytes: 2_048,
        sha256: authorization.protocol.evaluatorOverlay.patchSha256,
      },
      requiredGitlinks,
      excludedGitlinks,
      symlinks,
      objectClosureSha256: canonicalSha256({
        schema: SOURCE_OBJECT_CLOSURE_SCHEMA,
        product,
        evaluator,
        effectiveTree,
        requiredGitlinks,
        excludedGitlinks,
        symlinks,
      }),
      entryCount: 1_024,
      totalBytes: 4_194_304,
      manifestSha256: digest(`${buildId}:source-manifest:${salt}`),
    },
    authority: structuredClone(SOURCE_AUTHORITY),
  });
  const bytes = canonicalBytes(value);
  return {
    value,
    bytes,
    expected: {
      rawSha256: sha256(bytes),
      contentHash: value.contentHash,
      buildId,
      productRole,
      controlRunId,
      workspaceGeneration: value.workspace.generation,
      targetGeneration: value.workspace.targetGeneration,
    },
  };
}

function resealSourceProjection(source) {
  source.value = seal(source.value);
  source.bytes = canonicalBytes(source.value);
  source.expected = {
    rawSha256: sha256(source.bytes),
    contentHash: source.value.contentHash,
    buildId: source.value.buildId,
    productRole: source.value.productRole,
    controlRunId: source.value.controlRunId,
    workspaceGeneration: source.value.workspace.generation,
    targetGeneration: source.value.workspace.targetGeneration,
  };
}

function capturedSourceProjection(bytesValue) {
  const bytes = Buffer.from(bytesValue);
  const value = decode(bytes);
  return {
    value,
    bytes,
    expected: {
      rawSha256: sha256(bytes),
      contentHash: value.contentHash,
      buildId: value.buildId,
      productRole: value.productRole,
      controlRunId: value.controlRunId,
      workspaceGeneration: value.workspace.generation,
      targetGeneration: value.workspace.targetGeneration,
    },
  };
}

function processEvidence({
  authorizationBinding,
  controlRunId,
  buildId,
  productRole,
  source,
  workspaceOwnerBytes,
  buildOwnerBytes,
  stdoutBytes,
  stderrBytes,
  executableBytes,
  executableLogicalPath,
  platform,
  toolchainArtifacts,
  index,
  salt,
}) {
  const target = source.value.workspace.targetChild;
  const releaseInode = String(7_000 + index * 10);
  const depsInode = String(7_001 + index * 10);
  const value = seal({
    schema: G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_SCHEMA,
    controlRunId,
    authorization: structuredClone(authorizationBinding),
    executionPlan: {
      schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
      sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipe: {
        schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
        sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      },
    },
    buildId,
    productRole,
    source: {
      rawSha256: source.expected.rawSha256,
      contentHash: source.expected.contentHash,
    },
    platform: {
      platformRootSha256: platform.closure.platformRootSha256,
      toolchainRootSha256: platform.closure.toolchainRootSha256,
    },
    workspace: {
      generation: source.expected.workspaceGeneration,
      targetGeneration: source.expected.targetGeneration,
      parentRoot: heldWorkspaceParent(source.value.workspace.parentRoot),
      sourceChild: heldWorkspaceChild(
        source.value.workspace.sourceChild,
        4,
      ),
      targetChild: heldWorkspaceChild(
        source.value.workspace.targetChild,
        5,
      ),
      mounts: [
        {
          child: "sourceChild",
          mountPoint: "/workspace/source",
          filesystemType: source.value.workspace.sourceChild.filesystemType,
          mountOptions: ["bind", "nodev", "noexec", "nosuid", "ro"],
          readOnly: true,
        },
        {
          child: "targetChild",
          mountPoint: "/state/target",
          filesystemType: source.value.workspace.targetChild.filesystemType,
          mountOptions: ["bind", "nodev", "nosuid", "rw"],
          readOnly: false,
        },
      ],
      targetEmptyAtStart: { observed: true, entryCount: 0 },
      privateDirectories: {
        cargoHome: heldPrivateDirectory("/cargo-home", 600 + index * 3),
        home: heldPrivateDirectory("/state/home", 601 + index * 3),
        temporary: heldPrivateDirectory("/state/tmp", 602 + index * 3),
      },
    },
    process: {
      generation: `g17-process-${digest(`${buildId}:${salt}`)}`,
      ordinal: index + 1,
      serialized: true,
      isolationClass: "linux-x86_64-cgroup-v2-non-tmpfs-serialized",
      network: "isolated",
      program: G17_BENCHMARK_BUILD_PROGRAM,
      argv: structuredClone(G17_BENCHMARK_BUILD_ARGV),
      environment: structuredClone(G17_BENCHMARK_BUILD_ENVIRONMENT),
      environmentSha256: G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
      cwd: "/workspace/source",
      targetDirectory: "/state/target",
      toolchain: {
        contentSha256: platform.closure.toolchainRootSha256,
        root: heldToolchainRoot(index),
        bin: heldToolchainBin(index),
        cargo: heldFile(
          platform.toolchain.cargo.logicalPath,
          toolchainArtifacts.cargoExecutableBytes,
          300 + index,
          {
            device: "20",
            parentDevice: "20",
            parentInode: String(300 + index),
          },
        ),
        rustc: heldFile(
          platform.toolchain.rustc.logicalPath,
          toolchainArtifacts.rustcExecutableBytes,
          400 + index,
          {
            device: "20",
            parentDevice: "20",
            parentInode: String(300 + index),
          },
        ),
      },
    },
    logicalOwners: {
      workspaceOwnerRawSha256: sha256(workspaceOwnerBytes),
      buildOwnerRawSha256: sha256(buildOwnerBytes),
    },
    result: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: { bytes: stdoutBytes.length, sha256: sha256(stdoutBytes) },
      stderr: { bytes: stderrBytes.length, sha256: sha256(stderrBytes) },
      executableAncestors: [
        heldOutputAncestor(
          "/state/target/release",
          "release",
          target,
          releaseInode,
          target.inode,
        ),
        heldOutputAncestor(
          "/state/target/release/deps",
          "deps",
          target,
          depsInode,
          releaseInode,
        ),
      ],
      executable: heldFile(
        executableLogicalPath,
        executableBytes,
        500 + index,
        {
          device: source.value.workspace.targetChild.device,
          parentDevice: source.value.workspace.targetChild.device,
          parentInode: depsInode,
        },
      ),
    },
    nonclaims: structuredClone(G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS),
    authority: structuredClone(G17_BENCHMARK_BUILD_PROCESS_AUTHORITY),
    binding: null,
    finalDecisionEligible: false,
  });
  const bytes = canonicalBytes(value);
  return {
    value,
    bytes,
    expected: { rawSha256: sha256(bytes), contentHash: value.contentHash },
  };
}

function physicalFixture({
  approvedBy = "benchmark-product-owner-fixture-reviewer",
  sourceSalt = "base",
  processSalt = "base",
  alternateElf = false,
  sourceMutator,
  sourceProjectionOverrides = {},
} = {}) {
  const logical = createG17BenchmarkOwnerFixture({
    controlRunId: "benchmark-product-owner-fixture",
  });
  const authorization = authorizationFor(logical, approvedBy);
  const platformArtifacts = cloneBuffers(basePlatformArtifacts);
  const toolchainArtifacts = cloneBuffers(baseToolchainArtifacts);
  const platform = platformProjection(platformArtifacts, toolchainArtifacts);
  const artifacts = [];
  const ownerBuilds = [];
  const expectedBuilds = [];
  for (const [index, logicalArtifact] of logical.artifacts.builds.entries()) {
    const { buildId, productRole } = logicalArtifact;
    let source = Object.hasOwn(sourceProjectionOverrides, buildId)
      ? capturedSourceProjection(sourceProjectionOverrides[buildId])
      : undefined;
    const workspaceOwner = decode(logicalArtifact.workspaceOwnerBytes);
    workspaceOwner.authorization = structuredClone(authorization.binding);
    workspaceOwner.workspace.generation =
      source?.expected.workspaceGeneration ??
      `g17-workspace-${digest(`${buildId}:workspace`)}`;
    workspaceOwner.workspace.targetGeneration =
      source?.expected.targetGeneration ??
      `g17-target-${digest(`${buildId}:target`)}`;
    const workspaceOwnerBytes = resealG17BenchmarkOwnerArtifact(workspaceOwner);
    const executableBytes = minimalElf(
      alternateElf && index === 0 ? 9 : index < 2 ? index + 1 : 3,
    );
    const buildOwner = decode(logicalArtifact.buildOwnerBytes);
    buildOwner.authorization = structuredClone(authorization.binding);
    buildOwner.workspaceOwner = {
      rawSha256: sha256(workspaceOwnerBytes),
      contentHash: decode(workspaceOwnerBytes).contentHash,
    };
    buildOwner.executable.sha256 = sha256(executableBytes);
    const buildOwnerBytes = resealG17BenchmarkOwnerArtifact(buildOwner);
    source ??= sourceProjection({
      authorization: authorization.value,
      authorizationBinding: authorization.binding,
      controlRunId: logical.controlRunId,
      buildId,
      productRole,
      workspaceOwner: decode(workspaceOwnerBytes),
      index,
      salt: index === 0 ? sourceSalt : "base",
    });
    if (index === 0 && sourceMutator !== undefined) {
      sourceMutator(source.value);
      resealSourceProjection(source);
    }
    const process = processEvidence({
      authorizationBinding: authorization.binding,
      controlRunId: logical.controlRunId,
      buildId,
      productRole,
      source,
      workspaceOwnerBytes,
      buildOwnerBytes,
      stdoutBytes: logicalArtifact.buildStdoutBytes,
      stderrBytes: logicalArtifact.buildStderrBytes,
      executableBytes,
      executableLogicalPath: buildOwner.executable.logicalPath,
      platform: platform.projection,
      toolchainArtifacts,
      index,
      salt: index === 0 ? processSalt : "base",
    });
    const executable = {
      logicalPath: buildOwner.executable.logicalPath,
      bytes: executableBytes.length,
      sha256: sha256(executableBytes),
    };
    artifacts.push({
      buildId,
      productRole,
      sourceProjectionBytes: source.bytes,
      workspaceOwnerBytes,
      buildOwnerBytes,
      buildStdoutBytes: Buffer.from(logicalArtifact.buildStdoutBytes),
      buildStderrBytes: Buffer.from(logicalArtifact.buildStderrBytes),
      processEvidenceBytes: process.bytes,
      executableBytes,
    });
    ownerBuilds.push({
      buildId,
      productRole,
      sourceProjection: {
        rawSha256: source.expected.rawSha256,
        contentHash: source.expected.contentHash,
      },
      processEvidence: structuredClone(process.expected),
      executable,
    });
    expectedBuilds.push({
      buildId,
      productRole,
      sourceProjection: structuredClone(source.expected),
      processEvidence: structuredClone(process.expected),
      executable: structuredClone(executable),
    });
  }
  const ownerValue = seal({
    schema: G17_BENCHMARK_PRODUCT_OWNER_SCHEMA,
    controlRunId: logical.controlRunId,
    authorization: structuredClone(authorization.binding),
    executionPlan: {
      schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
      sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipe: {
        schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
        sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      },
    },
    platform: structuredClone(platform.projection),
    builds: ownerBuilds,
    nonclaims: structuredClone(G17_BENCHMARK_PRODUCT_OWNER_NONCLAIMS),
    authority: structuredClone(G17_BENCHMARK_PRODUCT_OWNER_AUTHORITY),
    binding: null,
    finalDecisionEligible: false,
  });
  return {
    ownerValue,
    input: {
      bytes: canonicalBytes(ownerValue),
      authorizationBytes: Buffer.from(authorization.bytes),
      platformArtifacts,
      toolchainArtifacts,
      artifacts: { builds: artifacts },
      expected: {
        authorization: structuredClone(authorization.binding),
        executionPlanSha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
        controlRunId: logical.controlRunId,
        platform: structuredClone(platform.expectation),
        builds: expectedBuilds,
      },
    },
  };
}

function resealOwner(fixture) {
  fixture.ownerValue = seal(fixture.ownerValue);
  fixture.input.bytes = canonicalBytes(fixture.ownerValue);
}

function replaceProcessEvidence(fixture, buildIndex, mutate) {
  const artifact = fixture.input.artifacts.builds[buildIndex];
  const process = decode(artifact.processEvidenceBytes);
  mutate(process);
  const sealed = seal(process);
  artifact.processEvidenceBytes = canonicalBytes(sealed);
  const binding = {
    rawSha256: sha256(artifact.processEvidenceBytes),
    contentHash: sealed.contentHash,
  };
  fixture.input.expected.builds[buildIndex].processEvidence =
    structuredClone(binding);
  fixture.ownerValue.builds[buildIndex].processEvidence =
    structuredClone(binding);
  resealOwner(fixture);
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

function exactKeys(value, expected) {
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...expected].sort());
}

function literalImportSpecifiers(source) {
  return [
    ...source.matchAll(
      /^\s*import\s+(?:(?:[\w*{},\s]+)\s+from\s+)?["']([^"']+)["']\s*;/gmu,
    ),
    ...source.matchAll(
      /^\s*export\s+(?:[\w*{},\s]+)\s+from\s+["']([^"']+)["']\s*;/gmu,
    ),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map((match) => match[1]);
}

async function localImportClosure(entry) {
  const pending = [new URL(entry, import.meta.url)];
  const sources = new Map();
  const specifiers = new Set();
  while (pending.length > 0) {
    const url = pending.pop();
    if (sources.has(url.href)) continue;
    const source = await readFile(url, "utf8");
    sources.set(url.href, source);
    for (const specifier of literalImportSpecifiers(source)) {
      specifiers.add(specifier);
      if (specifier.startsWith(".")) pending.push(new URL(specifier, url));
    }
  }
  return { sources, specifiers };
}

test("product owner v3 freezes the trusted replay surface without authority", () => {
  assert.equal(
    G17_BENCHMARK_PRODUCT_OWNER_SCHEMA,
    "oxigraph.g1.7-benchmark-product-owner/v3",
  );
  assert.equal(
    G17_BENCHMARK_PRODUCT_OWNER_PROJECTION_SCHEMA,
    "oxigraph.g1.7-benchmark-product-owner-projection/v3",
  );
  assert.deepEqual(
    G17_BENCHMARK_PRODUCT_BUILD_PLAN,
    EXPECTED_G17_BENCHMARK_BUILD_PLAN,
  );
  assert.equal(
    Object.values(G17_BENCHMARK_PRODUCT_OWNER_AUTHORITY).every(
      (value) => value === false,
    ),
    true,
  );
  assertDeepFrozen(G17_BENCHMARK_PRODUCT_BUILD_PLAN);
});

test("synthetic replay mirrors the source-lane v1 workspace schema exactly", () => {
  assert.equal(
    G17_PRODUCT_SOURCE_PROJECTION_SCHEMA,
    LIVE_PRODUCT_SOURCE_PROJECTION_SCHEMA,
  );
  const fixture = physicalFixture();
  const source = decode(
    fixture.input.artifacts.builds[0].sourceProjectionBytes,
  );
  exactKeys(source.workspace, [
    "generation",
    "targetGeneration",
    "isolated",
    "targetIsolated",
    "sourceReadOnlyAtBuildStart",
    "targetEmptyAtBuildStart",
    "parentRoot",
    "sourceChild",
    "targetChild",
  ]);
  assert.match(source.workspace.generation, /^g17-workspace-[0-9a-f]{64}$/u);
  assert.match(source.workspace.targetGeneration, /^g17-target-[0-9a-f]{64}$/u);
  assert.equal(source.workspace.sourceChild.leafName, "source");
  assert.equal(source.workspace.targetChild.leafName, "target");
  for (const child of [
    source.workspace.sourceChild,
    source.workspace.targetChild,
  ]) {
    assert.equal(child.parentDevice, source.workspace.parentRoot.device);
    assert.equal(child.parentInode, source.workspace.parentRoot.inode);
  }
});

test(
  "v3 replays exact source bytes emitted by the test-gated materializer",
  { timeout: 120_000 },
  async (t) => {
    const approvedBy = "benchmark-product-owner-fixture-reviewer";
    const logical = createG17BenchmarkOwnerFixture({
      controlRunId: "benchmark-product-owner-fixture",
    });
    const authorization = authorizationFor(logical, approvedBy);
    const helperRoot = await mkdtemp(
      join(tmpdir(), "g17-product-replay-helper-"),
    );
    const workspaceParent = await mkdtemp(
      join(tmpdir(), "g17-product-replay-workspace-"),
    );
    const workspaceRoot = join(workspaceParent, "workspace");
    await mkdir(workspaceRoot, { mode: 0o700 });
    let cleanupHelper;
    let sourceWorkspace;
    let capability;
    let reapProof;
    t.after(async () => {
      const failures = [];
      if (capability !== undefined) {
        try {
          reapProof ??=
            mintG17ProductSourceCompletedReapProofForTesting(capability);
          await finishG17ProductSourceBuildForTesting(capability, reapProof);
        } catch (error) {
          failures.push(error);
        }
        capability = undefined;
      }
      if (sourceWorkspace !== undefined) {
        try {
          await destroyG17ProductSourceWorkspace(sourceWorkspace);
          sourceWorkspace = undefined;
        } catch (error) {
          failures.push(error);
        }
      }
      if (cleanupHelper !== undefined) {
        try {
          await closeG17NativeSnapshotHelper(cleanupHelper);
        } catch (error) {
          failures.push(error);
        }
        cleanupHelper = undefined;
      }
      if (sourceWorkspace === undefined) {
        await chmod(workspaceRoot, 0o700).catch(() => {});
        await rm(workspaceParent, { recursive: true, force: true });
      }
      await rm(helperRoot, { recursive: true, force: true });
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "test-gated materializer cleanup did not complete exactly",
        );
      }
    });

    cleanupHelper = await buildG17NativeSnapshotHelper({
      outputDirectory: helperRoot,
      signal: undefined,
    });
    const gate = await createG17ProductSourceGateForTesting({
      authorizationBytes: authorization.bytes,
      cleanupHelper,
      repoRoot: repositoryRoot,
      workspaceRoot,
      controlRunId: logical.controlRunId,
      buildId: "negative-control",
      signal: undefined,
    });
    sourceWorkspace = await createG17ProductSourceWorkspace(gate);
    capability = await beginG17ProductSourceBuild(sourceWorkspace);
    const sourceProjectionBytes = Buffer.from(
      g17ProductSourceBuildInputs(capability).sourceProjectionBytes,
    );
    reapProof = mintG17ProductSourceCompletedReapProofForTesting(capability);
    await finishG17ProductSourceBuildForTesting(capability, reapProof);
    capability = undefined;
    reapProof = undefined;
    await destroyG17ProductSourceWorkspace(sourceWorkspace);
    sourceWorkspace = undefined;

    const fixture = physicalFixture({
      approvedBy,
      sourceProjectionOverrides: {
        "negative-control": sourceProjectionBytes,
      },
    });
    assert.deepEqual(
      fixture.input.artifacts.builds[0].sourceProjectionBytes,
      sourceProjectionBytes,
    );
    const replay = verifyG17BenchmarkProductOwner(fixture.input);
    assert.equal(replay.binding, null);
    assert.equal(replay.finalDecisionEligible, false);
    assert.equal(
      replay.builds[0].sourceProjection.rawSha256,
      sha256(sourceProjectionBytes),
    );
  },
);

test("trusted replay binds exact authorization, plan, source, process, toolchain, streams, and ELF bytes", () => {
  const fixture = physicalFixture();
  const projection = verifyG17BenchmarkProductOwner(fixture.input);
  exactKeys(projection, [
    "schema",
    "status",
    "finalDecisionEligible",
    "binding",
    "controlRunId",
    "owner",
    "authorization",
    "executionPlan",
    "platform",
    "builds",
    "inventory",
    "nonclaims",
    "authority",
  ]);
  assert.equal(projection.status, "BUILD_EVIDENCE_AND_CAPTURE_CLAIMS_REPLAYED");
  assert.equal(projection.finalDecisionEligible, false);
  assert.equal(projection.binding, null);
  assert.deepEqual(projection.nonclaims, G17_BENCHMARK_PRODUCT_OWNER_NONCLAIMS);
  assert.deepEqual(
    projection.builds.map(({ buildId, productRole }) => ({ buildId, productRole })),
    EXPECTED_G17_BENCHMARK_BUILD_PLAN,
  );
  assert.equal(projection.inventory.fileCount, 36);
  assert.equal(Object.values(projection.authority).every((value) => !value), true);
  assertDeepFrozen(projection);
});

test("separately trusted expectations reject coherent authorization, source, process, and ELF substitution", () => {
  const trusted = physicalFixture();
  for (const [name, forged] of [
    ["authorization", physicalFixture({ approvedBy: "coherent-attacker" })],
    ["source", physicalFixture({ sourceSalt: "coherent-forgery" })],
    ["process", physicalFixture({ processSalt: "coherent-forgery" })],
    ["ELF", physicalFixture({ alternateElf: true })],
  ]) {
    forged.input.expected = structuredClone(trusted.input.expected);
    assert.throws(
      () => verifyG17BenchmarkProductOwner(forged.input),
      CONTRACT_ERROR,
      name,
    );
  }
});

test("raw source, process, toolchain, stream, and executable substitution fails", () => {
  for (const [name, mutate] of [
    ["source", (fixture) => fixture.input.artifacts.builds[0].sourceProjectionBytes.fill(0x78)],
    ["process", (fixture) => fixture.input.artifacts.builds[0].processEvidenceBytes.fill(0x79)],
    ["Cargo", (fixture) => fixture.input.toolchainArtifacts.cargoExecutableBytes.fill(0x7a)],
    ["rustc", (fixture) => fixture.input.toolchainArtifacts.rustcExecutableBytes.fill(0x7b)],
    ["stdout", (fixture) => fixture.input.artifacts.builds[0].buildStdoutBytes.fill(0x7c)],
    ["executable", (fixture) => fixture.input.artifacts.builds[0].executableBytes.fill(0x7d)],
  ]) {
    const fixture = physicalFixture();
    mutate(fixture);
    assert.throws(
      () => verifyG17BenchmarkProductOwner(fixture.input),
      CONTRACT_ERROR,
      name,
    );
  }
});

test("source producer identity invariants reject device, owner, ancestry, and inode drift", () => {
  for (const mutate of [
    (source) => {
      source.workspace.sourceChild.device = "999";
    },
    (source) => {
      source.workspace.targetChild.uid = "4242";
    },
    (source) => {
      source.workspace.targetChild.gid = "4343";
    },
    (source) => {
      source.workspace.sourceChild.filesystemType = "999";
    },
    (source) => {
      source.workspace.sourceChild.parentInode = "999";
    },
    (source) => {
      source.workspace.sourceChild.inode = source.workspace.parentRoot.inode;
    },
    (source) => {
      source.workspace.targetChild.inode = source.workspace.sourceChild.inode;
    },
  ]) {
    const fixture = physicalFixture({ sourceMutator: mutate });
    assert.throws(
      () => verifyG17BenchmarkProductOwner(fixture.input),
      CONTRACT_ERROR,
    );
  }
});

test("trusted process identities still reject workspace swaps, private-target aliasing, and mount drift", () => {
  for (const mutate of [
    (process) => {
      [process.workspace.sourceChild, process.workspace.targetChild] = [
        process.workspace.targetChild,
        process.workspace.sourceChild,
      ];
    },
    (process) => {
      process.workspace.privateDirectories.cargoHome.before = structuredClone(
        process.workspace.targetChild.before,
      );
      process.workspace.privateDirectories.cargoHome.after = structuredClone(
        process.workspace.targetChild.after,
      );
    },
    (process) => {
      process.workspace.mounts[0].readOnly = false;
      process.workspace.mounts[0].mountOptions = ["bind", "rw"];
    },
    (process) => {
      process.process.toolchain.cargo.before.device = "999";
      process.process.toolchain.cargo.after.device = "999";
    },
    (process) => {
      process.process.toolchain.bin.filesystemType = "999";
    },
    (process) => {
      process.result.executable.parentInode = "999";
    },
    (process) => {
      process.result.executableAncestors[0].parentInode = "999";
    },
    (process) => {
      process.result.executableAncestors[1].before.inode =
        process.result.executableAncestors[0].before.inode;
      process.result.executableAncestors[1].after.inode =
        process.result.executableAncestors[0].after.inode;
    },
    (process) => {
      process.result.executableAncestors[0].before = structuredClone(
        process.workspace.sourceChild.before,
      );
      process.result.executableAncestors[0].after = structuredClone(
        process.workspace.sourceChild.after,
      );
      process.result.executableAncestors[1].parentDevice =
        process.workspace.sourceChild.before.device;
      process.result.executableAncestors[1].parentInode =
        process.workspace.sourceChild.before.inode;
    },
    (process) => {
      process.result.executable.before.nlink = 2;
      process.result.executable.after.nlink = 2;
    },
    (process) => {
      process.result.executable.before.mode += 2 ** 32;
      process.result.executable.after.mode += 2 ** 32;
    },
  ]) {
    const fixture = physicalFixture();
    replaceProcessEvidence(fixture, 0, mutate);
    assert.throws(
      () => verifyG17BenchmarkProductOwner(fixture.input),
      CONTRACT_ERROR,
    );
  }
});

test("plan, owner authority, exact fields, and canonical framing fail closed", () => {
  const expectedPlan = physicalFixture();
  expectedPlan.input.expected.executionPlanSha256 = "0".repeat(64);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(expectedPlan.input),
    CONTRACT_ERROR,
  );

  const ownerPlan = physicalFixture();
  ownerPlan.ownerValue.executionPlan.sha256 = "0".repeat(64);
  resealOwner(ownerPlan);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(ownerPlan.input),
    CONTRACT_ERROR,
  );

  const authority = physicalFixture();
  authority.ownerValue.authority.buildExecutionAuthority = true;
  resealOwner(authority);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(authority.input),
    CONTRACT_ERROR,
  );

  const binding = physicalFixture();
  binding.ownerValue.binding = { sha256: digest("forbidden-binding") };
  resealOwner(binding);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(binding.input),
    CONTRACT_ERROR,
  );

  const nonclaim = physicalFixture();
  nonclaim.ownerValue.nonclaims.heldCargoExecutionViaExecveatVerified = true;
  resealOwner(nonclaim);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(nonclaim.input),
    CONTRACT_ERROR,
  );

  const unknown = physicalFixture();
  unknown.ownerValue.unreviewed = false;
  resealOwner(unknown);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(unknown.input),
    CONTRACT_ERROR,
  );

  const pretty = physicalFixture();
  pretty.input.bytes = Buffer.from(
    `${JSON.stringify(pretty.ownerValue, null, 2)}\n`,
    "utf8",
  );
  assert.throws(
    () => verifyG17BenchmarkProductOwner(pretty.input),
    CONTRACT_ERROR,
  );
});

test("snapshot limits reject accessors, huge sparse arrays, cycles, and foreign prototypes before traversal", () => {
  const accessor = physicalFixture();
  const entry = accessor.input.artifacts.builds[0];
  const bytes = entry.executableBytes;
  let reads = 0;
  Object.defineProperty(entry, "executableBytes", {
    enumerable: true,
    get() {
      reads += 1;
      return bytes;
    },
  });
  assert.throws(
    () => verifyG17BenchmarkProductOwner(accessor.input),
    CONTRACT_ERROR,
  );
  assert.equal(reads, 0);

  const sparse = physicalFixture();
  sparse.input.unreviewed = new Array(100_000);
  assert.throws(
    () => verifyG17BenchmarkProductOwner(sparse.input),
    CONTRACT_ERROR,
  );

  const wide = physicalFixture();
  wide.input.unreviewed = Object.fromEntries(
    Array.from({ length: 5_000 }, (_, index) => [`k${index}`, false]),
  );
  assert.throws(
    () => verifyG17BenchmarkProductOwner(wide.input),
    CONTRACT_ERROR,
  );

  const cyclic = physicalFixture();
  cyclic.input.expected.cycle = cyclic.input.expected;
  assert.throws(
    () => verifyG17BenchmarkProductOwner(cyclic.input),
    CONTRACT_ERROR,
  );

  const foreign = physicalFixture();
  Object.setPrototypeOf(foreign.input.expected, { inheritedAuthority: true });
  assert.throws(
    () => verifyG17BenchmarkProductOwner(foreign.input),
    CONTRACT_ERROR,
  );
});

test("product verifier rejects top-level getters and Proxies before observation", () => {
  const accessor = physicalFixture();
  const bytes = accessor.input.bytes;
  let getterReads = 0;
  Object.defineProperty(accessor.input, "bytes", {
    enumerable: true,
    get() {
      getterReads += 1;
      return bytes;
    },
  });
  assert.throws(
    () => verifyG17BenchmarkProductOwner(accessor.input),
    CONTRACT_ERROR,
  );
  assert.equal(getterReads, 0);

  const proxied = physicalFixture();
  let proxyReads = 0;
  const input = new Proxy(proxied.input, {
    get(target, key, receiver) {
      proxyReads += 1;
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) {
      proxyReads += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(() => verifyG17BenchmarkProductOwner(input), CONTRACT_ERROR);
  assert.equal(proxyReads, 0);
});

test("projection is detached and deeply frozen", () => {
  const fixture = physicalFixture();
  const projection = verifyG17BenchmarkProductOwner(fixture.input);
  const before = canonicalJson(projection);
  fixture.input.bytes.fill(0x61);
  fixture.input.authorizationBytes.fill(0x62);
  fixture.input.artifacts.builds[0].sourceProjectionBytes.fill(0x63);
  fixture.input.artifacts.builds[0].processEvidenceBytes.fill(0x64);
  fixture.input.artifacts.builds[0].executableBytes.fill(0x65);
  assert.equal(canonicalJson(projection), before);
  assertDeepFrozen(projection);
});

test("pure product replay has a recursive literal import closure with no live owner or runtime capability", async () => {
  const closure = await localImportClosure(
    "../src/qualification/benchmark-product-owner-contract.mjs",
  );
  for (const forbidden of [
    "node:child_process",
    "node:fs",
    "node:http",
    "node:https",
    "node:net",
    "node:os",
    "node:process",
    "@metaharness/darwin",
    "contained-session",
    "native-application.mjs",
    "native-platform.mjs",
    "native-workspace.mjs",
    "product-source-workspace.mjs",
    "runner.mjs",
    "storage.mjs",
  ]) {
    assert.equal(
      [...closure.specifiers].some((specifier) => specifier.includes(forbidden)),
      false,
      forbidden,
    );
  }
  for (const [url, source] of closure.sources) {
    assert.doesNotMatch(
      source,
      /\bimport\s*\(\s*(?!["'])/u,
      `computed import in ${url}`,
    );
    assert.doesNotMatch(
      source,
      /\b(?:require|createRequire|eval|Function)\s*\(/u,
      `runtime loading in ${url}`,
    );
  }
});
