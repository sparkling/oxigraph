import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { G17_BENCHMARK_BUILD_PLAN } from "../../src/qualification/benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  createG17BenchmarkExecutionRequestV2Artifact,
} from "../../src/qualification/benchmark-execution-request-v2-contract.mjs";
import { createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact } from "../../src/qualification/benchmark-private-build-issuer-v1-contract.mjs";
import { G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS } from "../../src/qualification/non-tmpfs-build-isolation-contract.mjs";
import { createG17NonTmpfsBuildIsolationV2PolicyArtifact } from "../../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import { createG17NonTmpfsContainmentV2Artifact } from "../../src/qualification/non-tmpfs-containment-v2-contract.mjs";
import { loadG17Contract } from "../../src/qualification/contract.mjs";
import { loadG17ControlProtocol } from "../../src/qualification/control-protocol.mjs";
import {
  buildG17NativeSnapshotHelper,
  closeG17NativeSnapshotHelper,
} from "../../src/qualification/native-snapshot.mjs";
import {
  beginG17ProductSourceBuild,
  createG17ProductSourceGateForTesting,
  createG17ProductSourceWorkspace,
  destroyG17ProductSourceWorkspace,
  finishG17ProductSourceBuildForTesting,
  g17ProductSourceBuildInputs,
  mintG17ProductSourceCompletedReapProofForTesting,
  verifyG17ProductSourceWorkspace,
} from "../../src/qualification/product-source-workspace.mjs";
import { canonicalJson, canonicalSha256 } from "../../src/routing/features.mjs";
import {
  cleanupG17SuccessorArtifactFixtures,
  createG17HelperAttestationVerification,
} from "./g17-successor-artifact-fixtures.mjs";

// Test-only fixtures for ADR-0041 S5/S7. Every predecessor envelope below is
// produced by its real constructor and is replayed by its real pure verifier in
// the evaluator. Product-source bytes come from the existing test-only
// workspace lifecycle. This support module owns no private issuer brand and
// grants no production, execution, qualification, or publication authority.

export const G17_PRIVATE_OWNER_V3_TEST_FIXTURE_SCHEMA =
  "oxigraph.g1.7-private-owner-v3-test-fixture/v1";

const STATUS_SCHEMA = "oxigraph.g1.7-cargo-execveat-status/v1";
const EXECUTABLE_PATH =
  "/state/target/release/deps/transactional_write-11c415ab6e987b35";
const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../..");

let snapshotHelperPromise;
let snapshotHelperRoot;
const fixturePromises = new Map();

export function g17PrivateOwnerV3Sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function g17PrivateOwnerV3CanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function g17PrivateOwnerV3Seal(unsigned) {
  const value = {
    ...g17PrivateOwnerV3Clone(unsigned),
    contentHash: canonicalSha256(unsigned),
  };
  const bytes = g17PrivateOwnerV3CanonicalBytes(value);
  return { value, bytes };
}

export function g17PrivateOwnerV3Clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) {
    return value.map((child) => g17PrivateOwnerV3Clone(child));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        g17PrivateOwnerV3Clone(child),
      ]),
    );
  }
  return value;
}

function generation(role, seed) {
  return `g17-${role}-${g17PrivateOwnerV3Sha256(
    Buffer.from(`${role}:${seed}`, "utf8"),
  )}`;
}

function targetDirectory(
  logicalPath,
  leafName,
  identity,
  parentInode = undefined,
) {
  const value = {
    logicalPath,
    leafName,
    heldFd: true,
    device: identity.device,
    inode: identity.inode,
    uid: identity.uid,
    gid: identity.gid,
    mode: 0o040755,
    filesystemType: identity.filesystemType,
  };
  if (parentInode !== undefined) {
    value.parentDevice = identity.device;
    value.parentInode = parentInode;
  }
  return value;
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

function approvedAuthorizationBytes() {
  const { contract } = loadG17Contract();
  const protocol = loadG17ControlProtocol({ contract });
  const authorization = structuredClone(protocol.authorization);
  authorization.status = "CONTROL_AUTHORIZED";
  authorization.approval = {
    status: "APPROVED",
    approvedBy: "adr-0041-s5-test-fixture",
    approvedAt: "2026-09-05T00:00:00.000Z",
  };
  const { contentHash: _ignored, ...unsigned } = authorization;
  authorization.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(authorization)}\n`, "utf8");
}

async function snapshotHelper() {
  if (snapshotHelperPromise !== undefined) return snapshotHelperPromise;
  snapshotHelperPromise = (async () => {
    snapshotHelperRoot = await mkdtemp(
      join(tmpdir(), "oxigraph-g17-owner-v3-snapshot-helper-"),
    );
    return buildG17NativeSnapshotHelper({
      outputDirectory: snapshotHelperRoot,
      signal: undefined,
    });
  })();
  return snapshotHelperPromise;
}

async function productSourceProjection(plan, controlRunId) {
  const parent = await mkdtemp(
    join(tmpdir(), `oxigraph-g17-owner-v3-${plan.buildId}-`),
  );
  const root = join(parent, "workspace");
  await mkdir(root, { mode: 0o700 });
  let workspace;
  let capability;
  try {
    const gate = await createG17ProductSourceGateForTesting({
      authorizationBytes: approvedAuthorizationBytes(),
      cleanupHelper: await snapshotHelper(),
      repoRoot: REPOSITORY_ROOT,
      workspaceRoot: root,
      controlRunId,
      buildId: plan.buildId,
      signal: undefined,
    });
    workspace = await createG17ProductSourceWorkspace(gate);
    await verifyG17ProductSourceWorkspace(workspace);
    capability = await beginG17ProductSourceBuild(workspace);
    const inputs = g17ProductSourceBuildInputs(capability);
    const bytes = Buffer.from(inputs.sourceProjectionBytes);
    const binding = g17PrivateOwnerV3Clone(inputs.sourceProjection);
    const proof = mintG17ProductSourceCompletedReapProofForTesting(capability);
    await finishG17ProductSourceBuildForTesting(capability, proof);
    capability = undefined;
    await destroyG17ProductSourceWorkspace(workspace);
    workspace = undefined;
    return { bytes, binding };
  } finally {
    if (capability !== undefined) {
      const proof =
        mintG17ProductSourceCompletedReapProofForTesting(capability);
      await finishG17ProductSourceBuildForTesting(capability, proof).catch(
        () => {},
      );
    }
    if (workspace !== undefined) {
      await destroyG17ProductSourceWorkspace(workspace).catch(() => {});
    }
    await chmod(root, 0o700).catch(() => {});
    await rm(parent, { force: true, recursive: true });
  }
}

function cgroupDirectory() {
  return {
    role: "cgroupDirectory",
    kind: "directory",
    descriptorCapabilities: "held-directory-openat-read-write-children",
    fixedFd: null,
    parentOnly: true,
    entersHelperImage: false,
    entersCargoImage: false,
    identity: {
      device: "52",
      inode: "7001",
      mode: String(0o40700),
      links: "2",
      mountId: "49",
      filesystemType: String(0x63677270),
      ownerUid: "1000",
      ownerGid: "1000",
    },
  };
}

function placement() {
  return {
    claimSource: "CALLER_SUPPLIED_SERIALIZED_NONAUTHORITATIVE",
    syscall: "clone3",
    cloneArgsSizeBytes: 88,
    cloneArgs: {
      flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
      pidfdOutput: {
        role: "directChildPidfd",
        ownership: "parent",
        storage: "caller-provided-output-pointer",
      },
      childTidPointer: 0,
      parentTidPointer: 0,
      exitSignal: "SIGCHLD",
      stackPointer: 0,
      stackSizeBytes: 0,
      tlsPointer: 0,
      setTidPointer: 0,
      setTidSize: 0,
      setTidEntries: [],
      cgroupDescriptorRole: "cgroupDirectory",
    },
    result: "SUCCESS",
    errno: null,
    workerPlacedBeforeUserCodeRunnable: true,
    postSpawnCgroupProcsWritten: false,
    forkThenMoveFallbackUsed: false,
    cloneWithoutIntoCgroupFallbackUsed: false,
    serializedHelperImageReachedClaim: true,
    pidfd: {
      role: "directChildPidfd",
      kind: "pidfd",
      descriptorCapabilities: "poll-signal-waitid",
      fixedFd: null,
      parentOnly: true,
      entersHelperImage: false,
      entersCargoImage: false,
      fdCloexec: true,
    },
  };
}

function supervision() {
  return {
    claimSource: "CALLER_SUPPLIED_SERIALIZED_NONAUTHORITATIVE",
    pidfdRole: "directChildPidfd",
    boundedWait: {
      mechanism: "pidfd-poll-before-waitid",
      timeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
      timeoutDisposition: "INCONCLUSIVE_RETAIN_HANDLES_NO_CLEANUP",
    },
    poll: {
      syscall: "poll",
      descriptorRole: "directChildPidfd",
      events: ["POLLIN"],
      timeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
      result: "READY",
      revents: ["POLLIN"],
      errno: null,
    },
    waitid: {
      syscall: "waitid",
      idType: "P_PIDFD",
      pidfdRole: "directChildPidfd",
      options: ["WEXITED"],
      result: "REAPED",
      siCode: "CLD_EXITED",
      exitCode: 0,
      signal: null,
      coreDumped: false,
      callerSuppliedReapProofAccepted: false,
    },
    close: {
      syscall: "close",
      descriptorRole: "directChildPidfd",
      result: "CLOSED",
      errno: null,
      afterWaitid: true,
    },
  };
}

function cargoStdout() {
  return Buffer.from(
    `${JSON.stringify({
      reason: "compiler-artifact",
      package_id: "path+file:///workspace/source/lib/oxigraph#0.6.0-dev",
      manifest_path: "/workspace/source/lib/oxigraph/Cargo.toml",
      target: {
        kind: ["bench"],
        crate_types: ["bin"],
        name: "transactional_write",
        src_path:
          "/workspace/source/lib/oxigraph/benches/transactional_write.rs",
        edition: "2024",
        "required-features": ["rocksdb"],
        doc: false,
        doctest: false,
        test: false,
      },
      profile: {
        opt_level: "3",
        debuginfo: 0,
        debug_assertions: false,
        overflow_checks: false,
        test: true,
      },
      features: ["default", "oxrocksdb-sys", "rocksdb"],
      filenames: [EXECUTABLE_PATH],
      executable: EXECUTABLE_PATH,
      fresh: false,
    })}\n${JSON.stringify({ reason: "build-finished", success: true })}\n`,
    "utf8",
  );
}

async function buildFixture({ buildIndex = 0, salt = "1" } = {}) {
  const plan = G17_BENCHMARK_BUILD_PLAN[buildIndex];
  if (plan === undefined) throw new RangeError("fixture buildIndex is invalid");
  const controlRunId = `build-owner-v3-${salt}`;
  const source = await productSourceProjection(plan, controlRunId);
  const sourceValue = JSON.parse(source.bytes.toString("utf8"));
  const authorization = {
    schema: "oxigraph.g1.7-control-authorization/v3",
    ...g17PrivateOwnerV3Clone(sourceValue.authorization),
  };
  const generationSeed = `${controlRunId}:${plan.buildId}:${plan.productRole}`;
  const ownerGeneration = generation("owner", generationSeed);
  const workspaceGeneration = source.binding.workspaceGeneration;
  const targetGeneration = source.binding.targetGeneration;
  const processGeneration = generation("process", generationSeed);
  const executableBytes = minimalElf(buildIndex + 1);
  const executableSha256 = g17PrivateOwnerV3Sha256(executableBytes);

  const requestInput = {
    controlRunId,
    buildId: plan.buildId,
    productRole: plan.productRole,
    authorization,
    source: {
      rawSha256: source.binding.rawSha256,
      contentHash: source.binding.contentHash,
      controlRunId,
      buildId: plan.buildId,
      productRole: plan.productRole,
      workspaceGeneration,
      targetGeneration,
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
      ownerGeneration,
      processGeneration,
      ordinal: buildIndex + 1,
    },
  };
  const request = createG17BenchmarkExecutionRequestV2Artifact(requestInput);
  const requestVerification = {
    bytes: request.artifact.bytes,
    expected: requestInput,
  };
  const helper = await createG17HelperAttestationVerification();
  const cgroupProcsBytes = Buffer.alloc(0);
  const cgroupEventsBytes = Buffer.from("populated 0\nfrozen 0\n", "utf8");
  const cgroupPidsCurrentBytes = Buffer.from("0\n", "utf8");
  const containmentInput = {
    executionRequestVerification: requestVerification,
    helperAttestationVerification: helper.verification,
    cgroupDirectory: cgroupDirectory(),
    placement: placement(),
    supervision: supervision(),
    cgroupProcsBytes,
    cgroupEventsBytes,
    cgroupPidsCurrentBytes,
  };
  const containment = createG17NonTmpfsContainmentV2Artifact(containmentInput);
  const containmentVerification = {
    bytes: containment.artifact.bytes,
    expected: containmentInput,
  };
  const containmentGeneration = `g17-containment-${containment.identity.rawSha256}`;
  const lifecycleGeneration = generation(
    "lifecycle",
    `${generationSeed}:${containment.identity.rawSha256}`,
  );

  const statusTranscriptV1Bytes = Buffer.from(
    `${canonicalJson({
      schema: STATUS_SCHEMA,
      type: "READY",
      stage: "execveat",
      errno: null,
      reservedExitCode: null,
    })}\n`,
    "utf8",
  );
  const statusObservation = {
    statusDeadlineMilliseconds: 2_000,
    statusTimedOut: false,
    eofObserved: true,
    eofCount: 1,
    eofAfterFinalFrame: true,
    readError: null,
    writerCountAtLaunch: 1,
    writerDuplicationObserved: false,
  };
  const stdoutBytes = cargoStdout();
  const stderrBytes = Buffer.from("reviewed synthetic warning\n", "utf8");
  const targetIdentity = sourceValue.workspace.targetChild;
  const targetRoot = targetDirectory("/state/target", "target", targetIdentity);
  const release = targetDirectory(
    "/state/target/release",
    "release",
    { ...targetIdentity, inode: `${targetIdentity.inode}1` },
    targetRoot.inode,
  );
  const deps = targetDirectory(
    "/state/target/release/deps",
    "deps",
    { ...targetIdentity, inode: `${targetIdentity.inode}2` },
    release.inode,
  );

  const isolationPolicy = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
  const issuer = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  return {
    schema: G17_PRIVATE_OWNER_V3_TEST_FIXTURE_SCHEMA,
    identity: {
      controlRunId,
      buildId: plan.buildId,
      productRole: plan.productRole,
      ordinal: buildIndex + 1,
      ownerGeneration,
      workspaceGeneration,
      targetGeneration,
      processGeneration,
      containmentGeneration,
      lifecycleGeneration,
    },
    issuerRequirements: g17PrivateOwnerV3Clone(issuer.identity),
    sourceProjectionBytes: source.bytes,
    executionRequestV2Verification: requestVerification,
    helperAttestationV1Verification: helper.verification,
    statusTranscriptV1Verification: {
      bytes: statusTranscriptV1Bytes,
      observation: statusObservation,
    },
    isolationPolicyV2Bytes: isolationPolicy.artifact.bytes,
    containmentV2Verification: containmentVerification,
    stdoutBytes,
    stderrBytes,
    cgroupProcsBytes,
    cgroupEventsBytes,
    cgroupPidsCurrentBytes,
    executableBytes,
    observations: {
      helperImage: {
        heldFd: 8,
        sourceLogicalName: helper.created.attestation.source.logicalName,
        sourceSha256: helper.created.attestation.source.sha256,
        executableSha256: helper.created.attestation.executable.sha256,
        observed: true,
      },
      status: {
        sequence: "READY->EOF",
        outcome: "READY",
        byteLength: statusTranscriptV1Bytes.length,
        frameCount: 1,
        eofObserved: true,
        reservedExitCode: null,
      },
      process: {
        disposition: "completed",
        spawned: true,
        exitCode: 0,
        signal: null,
        statusAgreement: true,
        captureComplete: true,
        outputTruncated: false,
      },
      streams: {
        stdout: {
          bytes: stdoutBytes.length,
          sha256: g17PrivateOwnerV3Sha256(stdoutBytes),
          closed: true,
          eof: true,
        },
        stderr: {
          bytes: stderrBytes.length,
          sha256: g17PrivateOwnerV3Sha256(stderrBytes),
          closed: true,
          eof: true,
        },
        combinedBytes: stdoutBytes.length + stderrBytes.length,
      },
      cargo: {
        lineCount: 2,
        compilerArtifactLine: 1,
        buildFinishedLine: 2,
        buildFinishedSuccess: true,
        executableLogicalPath: EXECUTABLE_PATH,
        executableSha256,
      },
      directReap: {
        pidfdReadable: true,
        waitMechanism: "waitid-P_PIDFD-WEXITED",
        exclusive: true,
        directChild: true,
        reaped: true,
        exitCode: 0,
        signal: null,
        pidfdClosed: true,
      },
      cgroupQuiescence: {
        path: containment.projection.cgroupPath,
        procsSha256: g17PrivateOwnerV3Sha256(cgroupProcsBytes),
        eventsSha256: g17PrivateOwnerV3Sha256(cgroupEventsBytes),
        pidsCurrentSha256: g17PrivateOwnerV3Sha256(cgroupPidsCurrentBytes),
        processCount: 0,
        populated: false,
        pidsCurrent: 0,
      },
      target: {
        generation: targetGeneration,
        root: targetRoot,
        ancestors: [release, deps],
        executable: {
          logicalPath: EXECUTABLE_PATH,
          leafName: "transactional_write-11c415ab6e987b35",
          heldFd: true,
          device: targetIdentity.device,
          inode: `${targetIdentity.inode}3`,
          uid: targetIdentity.uid,
          gid: targetIdentity.gid,
          mode: 0o100555,
          parentDevice: targetIdentity.device,
          parentInode: deps.inode,
          bytes: executableBytes.length,
          sha256: executableSha256,
          elf: {
            elfClass: 64,
            elfData: "little",
            elfMachine: 62,
            interpreter: null,
            soname: null,
            needed: [],
            rpath: [],
            runpath: [],
            sha256: executableSha256,
          },
        },
      },
      workspaceFinish: {
        observed: true,
        lifecycleGeneration,
        sourceProjectionRawSha256: source.binding.rawSha256,
        workspaceGeneration,
        targetGeneration,
      },
    },
    qualifiedNativeAdapter: null,
    qualifiedDurableEffect: null,
  };
}

export async function createG17PrivateOwnerV3Fixture(options = {}) {
  const buildIndex = options.buildIndex ?? 0;
  const salt = options.salt ?? "1";
  const key = `${buildIndex}:${salt}`;
  if (!fixturePromises.has(key)) {
    fixturePromises.set(key, buildFixture({ buildIndex, salt }));
  }
  return g17PrivateOwnerV3Clone(await fixturePromises.get(key));
}

export async function cleanupG17PrivateOwnerV3Fixtures() {
  await cleanupG17SuccessorArtifactFixtures();
  if (snapshotHelperPromise !== undefined) {
    const helper = await snapshotHelperPromise.catch(() => undefined);
    if (helper !== undefined) await closeG17NativeSnapshotHelper(helper);
  }
  if (snapshotHelperRoot !== undefined) {
    await rm(snapshotHelperRoot, { force: true, recursive: true });
  }
  snapshotHelperPromise = undefined;
  snapshotHelperRoot = undefined;
  fixturePromises.clear();
}
