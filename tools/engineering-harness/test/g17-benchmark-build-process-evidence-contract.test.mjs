import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_PROCESS_AUTHORITY,
  G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_SCHEMA,
  G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS,
  G17_BENCHMARK_BUILD_PROCESS_PROJECTION_SCHEMA,
  verifyG17BenchmarkBuildProcessEvidence,
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
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const PROCESS_ERROR = /G1\.7 benchmark build process evidence/u;

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

function minimalElf(suffix = 0x61) {
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

function identity(device, inode, size, mode = 0o040700) {
  return {
    device,
    inode,
    uid: "1000",
    gid: "1000",
    mode,
    nlink: (mode & 0o170000) === 0o040000 ? 2 : 1,
    size,
  };
}

function heldWorkspaceParent(source) {
  const observed = identity(source.device, source.inode, 4_096);
  return {
    heldFd: true,
    inheritedFd: 3,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: source.filesystemType,
  };
}

function heldWorkspaceChild(source, inheritedFd) {
  const observed = identity(
    source.device,
    source.inode,
    4_096,
    source.leafName === "source" ? 0o040555 : 0o040700,
  );
  return {
    leafName: source.leafName,
    heldFd: true,
    inheritedFd,
    parentDevice: source.parentDevice,
    parentInode: source.parentInode,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: source.filesystemType,
  };
}

function heldPrivate(logicalPath, device, inode) {
  const observed = identity(device, inode, 4_096);
  return {
    logicalPath,
    heldFd: true,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: "61267",
    private: true,
  };
}

function heldToolchainRoot() {
  const observed = identity("20", "200", 4_096, 0o040555);
  return {
    logicalPath: "/toolchain",
    heldFd: true,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: "61267",
  };
}

function heldToolchainBin() {
  const observed = identity("20", "201", 4_096, 0o040555);
  return {
    logicalPath: "/toolchain/bin",
    leafName: "bin",
    heldFd: true,
    parentDevice: "20",
    parentInode: "200",
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: "61267",
  };
}

function heldFile(logicalPath, bytes, device, inode, parentDevice, parentInode) {
  const observed = identity(device, inode, bytes.length, 0o100555);
  return {
    logicalPath,
    parentDevice,
    parentInode,
    heldFd: true,
    before: structuredClone(observed),
    after: structuredClone(observed),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function heldOutputAncestor(
  logicalPath,
  leafName,
  device,
  inode,
  parentDevice,
  parentInode,
) {
  const observed = identity(device, inode, 4_096);
  return {
    logicalPath,
    leafName,
    heldFd: true,
    parentDevice,
    parentInode,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: "61267",
  };
}

function sourceBinding() {
  const parentRoot = {
    device: "10",
    inode: "100",
    uid: "1000",
    gid: "1000",
    filesystemType: "61267",
  };
  return {
    rawSha256: digest("source-raw"),
    contentHash: digest("source-content"),
    workspaceGeneration: `g17-workspace-${digest("workspace")}`,
    targetGeneration: `g17-target-${digest("target")}`,
    parentRoot,
    sourceChild: {
      leafName: "source",
      device: "10",
      inode: "101",
      uid: "1000",
      gid: "1000",
      filesystemType: "61267",
      parentDevice: parentRoot.device,
      parentInode: parentRoot.inode,
    },
    targetChild: {
      leafName: "target",
      device: "10",
      inode: "102",
      uid: "1000",
      gid: "1000",
      filesystemType: "61267",
      parentDevice: parentRoot.device,
      parentInode: parentRoot.inode,
    },
  };
}

function fixture({ alternateElf = false } = {}) {
  const cargoExecutableBytes = Buffer.from("cargo:0", "utf8");
  const rustcExecutableBytes = Buffer.from("rustc:1", "utf8");
  const stdoutBytes = Buffer.from("cargo stdout\n", "utf8");
  const stderrBytes = Buffer.alloc(0);
  const executableBytes = minimalElf(alternateElf ? 0x62 : 0x61);
  const authorization = {
    rawSha256: digest("authorization-raw"),
    contentHash: digest("authorization-content"),
  };
  const source = sourceBinding();
  const executable = {
    logicalPath:
      "/state/target/release/deps/transactional_write-process-fixture",
    bytes: executableBytes.length,
    sha256: sha256(executableBytes),
  };
  const expectedBase = {
    authorization,
    executionPlanSha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
    controlRunId: "process-evidence-fixture",
    buildId: "negative-control",
    productRole: "negativeControl",
    source,
    logicalOwners: {
      workspaceOwnerRawSha256: digest("workspace-owner"),
      buildOwnerRawSha256: digest("build-owner"),
    },
    platform: {
      platformRootSha256: digest("platform-root"),
      toolchainRootSha256: digest("toolchain-root"),
      cargo: {
        logicalPath: "/toolchain/bin/cargo",
        sha256: sha256(cargoExecutableBytes),
      },
      rustc: {
        logicalPath: "/toolchain/bin/rustc",
        sha256: sha256(rustcExecutableBytes),
      },
    },
    executable,
    ordinal: 1,
  };
  const value = seal({
    schema: G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_SCHEMA,
    controlRunId: expectedBase.controlRunId,
    authorization: structuredClone(authorization),
    executionPlan: {
      schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
      sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipe: {
        schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
        sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      },
    },
    buildId: expectedBase.buildId,
    productRole: expectedBase.productRole,
    source: {
      rawSha256: source.rawSha256,
      contentHash: source.contentHash,
    },
    platform: {
      platformRootSha256: expectedBase.platform.platformRootSha256,
      toolchainRootSha256: expectedBase.platform.toolchainRootSha256,
    },
    workspace: {
      generation: source.workspaceGeneration,
      targetGeneration: source.targetGeneration,
      parentRoot: heldWorkspaceParent(source.parentRoot),
      sourceChild: heldWorkspaceChild(source.sourceChild, 4),
      targetChild: heldWorkspaceChild(source.targetChild, 5),
      mounts: [
        {
          child: "sourceChild",
          mountPoint: "/workspace/source",
          filesystemType: source.sourceChild.filesystemType,
          mountOptions: ["bind", "nodev", "noexec", "nosuid", "ro"],
          readOnly: true,
        },
        {
          child: "targetChild",
          mountPoint: "/state/target",
          filesystemType: source.targetChild.filesystemType,
          mountOptions: ["bind", "nodev", "nosuid", "rw"],
          readOnly: false,
        },
      ],
      targetEmptyAtStart: { observed: true, entryCount: 0 },
      privateDirectories: {
        cargoHome: heldPrivate("/cargo-home", "30", "300"),
        home: heldPrivate("/state/home", "30", "301"),
        temporary: heldPrivate("/state/tmp", "30", "302"),
      },
    },
    process: {
      generation: `g17-process-${digest("process")}`,
      ordinal: 1,
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
        contentSha256: expectedBase.platform.toolchainRootSha256,
        root: heldToolchainRoot(),
        bin: heldToolchainBin(),
        cargo: heldFile(
          "/toolchain/bin/cargo",
          cargoExecutableBytes,
          "20",
          "202",
          "20",
          "201",
        ),
        rustc: heldFile(
          "/toolchain/bin/rustc",
          rustcExecutableBytes,
          "20",
          "203",
          "20",
          "201",
        ),
      },
    },
    logicalOwners: structuredClone(expectedBase.logicalOwners),
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
          source.targetChild.device,
          "498",
          source.targetChild.device,
          source.targetChild.inode,
        ),
        heldOutputAncestor(
          "/state/target/release/deps",
          "deps",
          source.targetChild.device,
          "499",
          source.targetChild.device,
          "498",
        ),
      ],
      executable: heldFile(
        executable.logicalPath,
        executableBytes,
        source.targetChild.device,
        "500",
        source.targetChild.device,
        "499",
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
    input: {
      bytes,
      expected: {
        ...expectedBase,
        evidence: { rawSha256: sha256(bytes), contentHash: value.contentHash },
      },
      cargoExecutableBytes,
      rustcExecutableBytes,
      stdoutBytes,
      stderrBytes,
      executableBytes,
    },
  };
}

function resealEvidence(item, { trust = true } = {}) {
  item.value = seal(item.value);
  item.input.bytes = canonicalBytes(item.value);
  if (trust) {
    item.input.expected.evidence = {
      rawSha256: sha256(item.input.bytes),
      contentHash: item.value.contentHash,
    };
  }
}

test("process v2 replays exact Cargo request, workspace chain, and nonclaims without authority", () => {
  const item = fixture();
  const projection = verifyG17BenchmarkBuildProcessEvidence(item.input);
  assert.equal(
    projection.schema,
    G17_BENCHMARK_BUILD_PROCESS_PROJECTION_SCHEMA,
  );
  assert.equal(
    projection.status,
    "CARGO_INVOCATION_ENVIRONMENT_AND_CAPTURE_CLAIMS_REPLAYED",
  );
  assert.equal(projection.finalDecisionEligible, false);
  assert.equal(projection.binding, null);
  assert.equal(projection.program, "/toolchain/bin/cargo");
  assert.equal(
    projection.environmentSha256,
    G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  );
  assert.deepEqual(projection.nonclaims, G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS);
  assert.deepEqual(projection.authority, G17_BENCHMARK_BUILD_PROCESS_AUTHORITY);
  assert.equal(Object.isFrozen(projection), true);
});

test("trusted raw identity rejects coherent process and alternate ELF replacement", () => {
  const trusted = fixture();
  for (const forged of [fixture(), fixture({ alternateElf: true })]) {
    forged.value.process.generation = `g17-process-${digest("forged")}`;
    resealEvidence(forged);
    forged.input.expected.evidence = structuredClone(
      trusted.input.expected.evidence,
    );
    forged.input.expected.executable = structuredClone(
      trusted.input.expected.executable,
    );
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(forged.input),
      PROCESS_ERROR,
    );
  }
});

test("host paths, alternate RUSTC, wrappers, and inherited environment fail closed", () => {
  for (const mutate of [
    (value) => {
      value.process.environment.PATH = "/usr/local/bin:/usr/bin";
    },
    (value) => {
      value.process.environment.CARGO_HOME = "/home/user/.cargo";
    },
    (value) => {
      value.process.environment.CARGO_TARGET_DIR = "/tmp/target";
    },
    (value) => {
      value.process.environment.RUSTC = "/usr/bin/rustc";
    },
    (value) => {
      value.process.environment.RUSTC_WRAPPER = "/tmp/wrapper";
    },
    (value) => {
      value.process.environment.INHERITED_SECRET = "unexpected";
    },
  ]) {
    const item = fixture();
    mutate(item.value);
    item.value.process.environmentSha256 = canonicalSha256(
      item.value.process.environment,
    );
    resealEvidence(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }
});

test("workspace ancestry, source/target mounts, target-empty proof, and private dirs fail closed", () => {
  for (const mutate of [
    (value) => {
      [value.workspace.sourceChild, value.workspace.targetChild] = [
        value.workspace.targetChild,
        value.workspace.sourceChild,
      ];
    },
    (value) => {
      value.workspace.sourceChild.parentInode = "999";
    },
    (value) => {
      value.workspace.mounts[0].readOnly = false;
      value.workspace.mounts[0].mountOptions = ["bind", "rw"];
    },
    (value) => {
      value.workspace.mounts[1].mountPoint = "/workspace/source";
    },
    (value) => {
      value.workspace.targetEmptyAtStart.entryCount = 1;
    },
    (value) => {
      delete value.workspace.privateDirectories.cargoHome;
    },
    (value) => {
      delete value.workspace.privateDirectories.home;
    },
    (value) => {
      delete value.workspace.privateDirectories.temporary;
    },
    (value) => {
      value.workspace.privateDirectories.home.before = structuredClone(
        value.workspace.targetChild.before,
      );
      value.workspace.privateDirectories.home.after = structuredClone(
        value.workspace.targetChild.after,
      );
    },
  ]) {
    const item = fixture();
    mutate(item.value);
    resealEvidence(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }
});

test("workspace held-directory modes, links, owners, and device chain fail closed", () => {
  const evidenceMutations = [
    (item) => {
      item.value.workspace.parentRoot.before.mode = 0o040755;
      item.value.workspace.parentRoot.after.mode = 0o040755;
    },
    (item) => {
      item.value.workspace.sourceChild.before.mode = 0o040700;
      item.value.workspace.sourceChild.after.mode = 0o040700;
    },
    (item) => {
      item.value.workspace.targetChild.before.mode = 0o040755;
      item.value.workspace.targetChild.after.mode = 0o040755;
    },
    (item) => {
      item.value.workspace.sourceChild.before.nlink = 1;
      item.value.workspace.sourceChild.after.nlink = 1;
    },
    (item) => {
      item.value.workspace.targetChild.before.mode += 2 ** 32;
      item.value.workspace.targetChild.after.mode += 2 ** 32;
    },
  ];
  for (const mutate of evidenceMutations) {
    const item = fixture();
    mutate(item);
    resealEvidence(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }

  for (const mutate of [
    (item) => {
      item.input.expected.source.sourceChild.device = "999";
      item.value.workspace.sourceChild.before.device = "999";
      item.value.workspace.sourceChild.after.device = "999";
    },
    (item) => {
      item.input.expected.source.targetChild.uid = "4242";
      item.value.workspace.targetChild.before.uid = "4242";
      item.value.workspace.targetChild.after.uid = "4242";
    },
  ]) {
    const item = fixture();
    mutate(item);
    resealEvidence(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }
});

test("private directory mode and owner stay explicit nonclaims while aliases fail", () => {
  for (const mutate of [
    (directory) => {
      directory.before.mode = 0o040777;
      directory.after.mode = 0o040777;
    },
    (directory) => {
      directory.before.uid = "4242";
      directory.after.uid = "4242";
      directory.before.gid = "4343";
      directory.after.gid = "4343";
    },
  ]) {
    const item = fixture();
    mutate(item.value.workspace.privateDirectories.cargoHome);
    resealEvidence(item);
    const projection = verifyG17BenchmarkBuildProcessEvidence(item.input);
    assert.equal(projection.binding, null);
    assert.equal(projection.finalDecisionEligible, false);
    assert.equal(
      projection.nonclaims.privateDirectoryOwnershipIndependentlyVerified,
      false,
    );
    assert.equal(
      projection.nonclaims.privateDirectoryPermissionsIndependentlyVerified,
      false,
    );
  }

  const alias = fixture();
  alias.value.workspace.privateDirectories.cargoHome.before = structuredClone(
    alias.value.workspace.privateDirectories.home.before,
  );
  alias.value.workspace.privateDirectories.cargoHome.after = structuredClone(
    alias.value.workspace.privateDirectories.home.after,
  );
  resealEvidence(alias);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(alias.input),
    PROCESS_ERROR,
  );
});

test("program, held-tool ancestry, unrelated tools, streams, and executable bytes fail closed", () => {
  const semanticMutations = [
    (value) => {
      value.process.program = "/toolchain/bin/unrelated";
      value.process.toolchain.cargo.logicalPath = "/toolchain/bin/unrelated";
    },
    (value) => {
      value.process.toolchain.cargo.parentInode = "999";
    },
    (value) => {
      value.process.toolchain.cargo.before.device = "999";
      value.process.toolchain.cargo.after.device = "999";
    },
    (value) => {
      value.process.toolchain.rustc.before.uid = "4242";
      value.process.toolchain.rustc.after.uid = "4242";
      value.process.toolchain.rustc.before.gid = "4343";
      value.process.toolchain.rustc.after.gid = "4343";
    },
    (value) => {
      value.process.toolchain.bin.before.device = "999";
      value.process.toolchain.bin.after.device = "999";
    },
    (value) => {
      value.process.toolchain.bin.filesystemType = "999";
    },
    (value) => {
      value.process.toolchain.rustc.after.inode = "999";
    },
    (value) => {
      value.process.argv = value.process.argv.filter(
        (argument) => argument !== "--offline",
      );
    },
    (value) => {
      value.result.executable.parentInode = "777";
    },
    (value) => {
      value.result.executableAncestors[0].parentInode = "777";
    },
    (value) => {
      value.result.executableAncestors[1].leafName = "objects";
    },
    (value) => {
      value.result.executableAncestors[1].before.inode =
        value.result.executableAncestors[0].before.inode;
      value.result.executableAncestors[1].after.inode =
        value.result.executableAncestors[0].after.inode;
    },
    (value) => {
      value.result.executableAncestors[0].before = structuredClone(
        value.workspace.sourceChild.before,
      );
      value.result.executableAncestors[0].after = structuredClone(
        value.workspace.sourceChild.after,
      );
      value.result.executableAncestors[1].parentDevice =
        value.workspace.sourceChild.before.device;
      value.result.executableAncestors[1].parentInode =
        value.workspace.sourceChild.before.inode;
    },
    (value) => {
      value.result.executableAncestors[1].before.uid = "4242";
      value.result.executableAncestors[1].after.uid = "4242";
    },
    (value) => {
      value.result.executableAncestors[1].filesystemType = "999";
    },
    (value) => {
      value.result.executable.before.nlink = 2;
      value.result.executable.after.nlink = 2;
    },
    (value) => {
      value.result.executable.before.device =
        value.workspace.sourceChild.before.device;
      value.result.executable.before.inode =
        value.workspace.sourceChild.before.inode;
      value.result.executable.after.device =
        value.workspace.sourceChild.after.device;
      value.result.executable.after.inode =
        value.workspace.sourceChild.after.inode;
    },
    (value) => {
      value.result.executable.before.mode += 2 ** 32;
      value.result.executable.after.mode += 2 ** 32;
    },
  ];
  for (const mutate of semanticMutations) {
    const item = fixture();
    mutate(item.value);
    resealEvidence(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }
  for (const mutate of [
    (item) => item.input.cargoExecutableBytes.fill(0x61),
    (item) => item.input.rustcExecutableBytes.fill(0x62),
    (item) => item.input.stdoutBytes.fill(0x63),
    (item) => item.input.executableBytes.fill(0x64),
  ]) {
    const item = fixture();
    mutate(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }
});

test("nonclaims, binding, eligibility, and every authority field are exact", () => {
  for (const mutate of [
    (value) => {
      value.nonclaims.cargoSelectedRequestedRustcIndependentlyVerified = true;
    },
    (value) => {
      value.nonclaims.privateDirectoryCreationIndependentlyVerified = true;
    },
    (value) => {
      delete value.nonclaims.privateDirectoryAncestryIndependentlyVerified;
    },
    (value) => {
      value.binding = { sha256: digest("binding") };
    },
    (value) => {
      value.finalDecisionEligible = true;
    },
    (value) => {
      value.authority.buildExecutionAuthority = true;
    },
    (value) => {
      delete value.authority.launchExecutionAuthority;
    },
  ]) {
    const item = fixture();
    mutate(item.value);
    resealEvidence(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidence(item.input),
      PROCESS_ERROR,
    );
  }
});

test("top-level getters and Proxies are rejected before observation", () => {
  const accessor = fixture();
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
    () => verifyG17BenchmarkBuildProcessEvidence(accessor.input),
    PROCESS_ERROR,
  );
  assert.equal(getterReads, 0);

  const proxied = fixture();
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
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(input),
    PROCESS_ERROR,
  );
  assert.equal(proxyReads, 0);
});

test("canonical framing, unknown fields, wide keys, sparse arrays, and depth fail closed", () => {
  const pretty = fixture();
  pretty.input.bytes = Buffer.from(
    `${JSON.stringify(pretty.value, null, 2)}\n`,
    "utf8",
  );
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(pretty.input),
    PROCESS_ERROR,
  );

  const unknown = fixture();
  unknown.value.unreviewed = false;
  resealEvidence(unknown);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(unknown.input),
    PROCESS_ERROR,
  );

  const wide = fixture();
  wide.input.unreviewed = Object.fromEntries(
    Array.from({ length: 5_000 }, (_, index) => [`k${index}`, false]),
  );
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(wide.input),
    PROCESS_ERROR,
  );

  const sparse = fixture();
  sparse.input.unreviewed = new Array(100_000);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(sparse.input),
    PROCESS_ERROR,
  );

  const deep = fixture();
  let cursor = deep.input;
  for (let index = 0; index < 80; index += 1) {
    cursor.unreviewed = {};
    cursor = cursor.unreviewed;
  }
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidence(deep.input),
    PROCESS_ERROR,
  );
});
