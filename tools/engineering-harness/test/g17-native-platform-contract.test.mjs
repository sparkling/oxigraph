import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_REQUIRED_PROBES,
  G17_NATIVE_PLATFORM_REQUIRED_ROLES,
  createG17NativeIsolationInstanceArtifact,
  createG17NativeIsolationPolicyArtifact,
  createG17NativePlatformClosureArtifact,
  verifyG17NativeIsolationInstanceArtifact,
  verifyG17NativeIsolationPolicyArtifact,
  verifyG17NativePlatformClosureArtifact,
} from "../src/qualification/native-platform-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function stream(text) {
  const bytes = Buffer.from(text, "utf8");
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function platformInput() {
  const entries = G17_NATIVE_PLATFORM_REQUIRED_ROLES.map((role, index) => ({
    root: role.root,
    path: role.fixturePath,
    kind: role.kind,
    mode: role.kind === "directory" ? 365 : 365,
    bytes: role.kind === "directory" ? 0 : index + 1,
    sha256: role.kind === "directory"
      ? null
      : sha256(Buffer.from(`${role.id}:${index}`, "utf8")),
    target: null,
  }));
  entries.sort((left, right) =>
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`),
  );
  for (const entry of entries.filter(({ kind }) => kind === "directory")) {
    entry.sha256 = canonicalSha256({
      schema: "oxigraph.g1.7-platform-subtree/v1",
      root: entry.root,
      path: entry.path,
      descendants: entries
        .filter(
          (candidate) =>
            candidate.root === entry.root &&
            candidate.path.startsWith(`${entry.path}/`) &&
            candidate.kind !== "directory",
        )
        .map(({ path, kind, mode, bytes, sha256: digest, target }) => ({
          path,
          kind,
          mode,
          bytes,
          sha256: digest,
          target,
        })),
    });
  }
  const roles = Object.fromEntries(
    G17_NATIVE_PLATFORM_REQUIRED_ROLES.map((role) => {
      const entry = entries.find(
        ({ root, path }) => root === role.root && path === role.fixturePath,
      );
      return [
        role.id,
        {
          root: role.root,
          path: role.fixturePath,
          kind: role.kind,
          resolvedPath: role.fixturePath,
          sha256: entry.sha256,
        },
      ];
    }),
  );
  const probes = G17_NATIVE_PLATFORM_REQUIRED_PROBES.map((id) => ({
    id,
    program: "/toolchain/bin/cargo",
    argv: ["/toolchain/bin/cargo", "--version"],
    cwd: "/",
    environment: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/toolchain/bin:/usr/bin" },
    environmentSha256: canonicalSha256({
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/toolchain/bin:/usr/bin",
    }),
    timeoutMs: 10_000,
    maxOutputBytes: 65_536,
    disposition: "completed",
    exitCode: 0,
    signal: null,
    durationMs: 1,
    stdout: stream(`${id}\n`),
    stderr: stream(""),
    parsed: { id, ok: true },
    parsedSha256: canonicalSha256({ id, ok: true }),
  }));
  const nodes = entries
    .filter(({ kind }) => kind === "file")
    .map(({ root, path, sha256: digest }) => ({
      root,
      path,
      sha256: digest,
      elfClass: 64,
      elfData: "little",
      elfMachine: 62,
      interpreter: path.startsWith("bin/") || path.startsWith("usr/bin/")
        ? "platform:lib64/ld-linux-x86-64.so.2"
        : null,
      soname: null,
      needed: [],
      rpath: [],
      runpath: [],
    }));
  return {
    profile: "linux-x86_64-gnu-bundled-rocksdb/v1",
    target: {
      os: "linux",
      architecture: "x86_64",
      abi: "gnu",
      rustTriple: "x86_64-unknown-linux-gnu",
      gccTriple: "x86_64-linux-gnu",
      elfClass: 64,
      elfData: "little",
      elfMachine: 62,
      dynamicLoader: "lib64/ld-linux-x86-64.so.2",
      glibcVersion: "2.39",
    },
    entries,
    roles,
    probes,
    elfGraph: { nodes, edges: [] },
    linkerScripts: { records: [] },
  };
}

function instanceInput(policy, platform) {
  const workspaceProjectionSha256 = "9".repeat(64);
  const mounts = [
    { source: "platform:usr", destination: "/usr", mode: "read-only" },
    { source: "platform:lib", destination: "/lib", mode: "read-only" },
    { source: "platform:lib64", destination: "/lib64", mode: "read-only" },
    { source: "toolchain:", destination: "/toolchain", mode: "read-only" },
    { source: "workspace:source", destination: "/workspace", mode: "read-only" },
    { source: "workspace:cargo-home", destination: "/cargo-home", mode: "read-only" },
    { source: "state:tmpfs", destination: "/state", mode: "read-write-quota" },
  ];
  const environment = {
    AR: "/usr/bin/x86_64-linux-gnu-ar",
    CARGO_BUILD_JOBS: "4",
    CARGO_HOME: "/cargo-home",
    CARGO_INCREMENTAL: "0",
    CARGO_NET_OFFLINE: "true",
    CARGO_PROFILE_TEST_DEBUG: "0",
    CARGO_TARGET_DIR: "/state/target",
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER:
      "/usr/bin/x86_64-linux-gnu-gcc-13",
    CARGO_TERM_COLOR: "never",
    CC: "/usr/bin/x86_64-linux-gnu-gcc-13",
    CXX: "/usr/bin/x86_64-linux-gnu-g++-13",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/state/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LD_LIBRARY_PATH:
      "/toolchain/lib:/usr/lib/llvm-18/lib:/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu",
    LIBCLANG_PATH: "/usr/lib/llvm-18/lib/libclang-18.so.1",
    LLVM_CONFIG_PATH: "/nonexistent",
    NO_COLOR: "1",
    PATH: "/toolchain/bin:/usr/bin",
    RUSTC: "/toolchain/bin/rustc",
    RUSTFMT: "/toolchain/bin/rustfmt",
    SOURCE_DATE_EPOCH: "946684800",
    TEMP: "/state/tmp",
    TERM: "dumb",
    TMP: "/state/tmp",
    TMPDIR: "/state/tmp",
    TZ: "UTC",
    USER: "sandbox",
  };
  const logicalCommands = [
    {
      name: "inventory:fixture",
      argv: ["cargo", "test", "--locked", "--offline", "--target-dir", "/state/target", "--test", "fixture", "--", "--list", "--format", "terse"],
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576,
    },
    {
      name: "execution:fixture",
      argv: ["cargo", "test", "--locked", "--offline", "--target-dir", "/state/target", "--test", "fixture"],
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576,
    },
  ];
  const controllerTools = ["systemd-run", "prlimit", "bwrap"].map((id) => ({
    id,
    executableSha256: sha256(Buffer.from(id)),
    version: stream(`${id} 1\n`),
    dependencyClosureSha256: sha256(Buffer.from(`${id}:closure`)),
  }));
  return {
    platform,
    runId: "platform-contract-fixture",
    policySha256: policy.sha256,
    platformManifestSha256: platform.manifestSha256,
    workspaceProjectionSha256,
    mounts,
    environment,
    logicalCommands,
    controllerTools,
    requestedLimits: {
      totalWallMs: 2_700_000,
      residentBytes: 8_589_934_592,
      diskBytes: 17_179_869_184,
      cargoBuildJobs: 4,
      tasksMax: 512,
      memorySwapBytes: 0,
    },
    effectiveObservations: {
      userNamespace: true,
      mountNamespace: true,
      networkNamespace: true,
      pidNamespace: true,
      ipcNamespace: true,
      utsNamespace: true,
      cgroupV2: true,
      memoryMaxBytes: 8_589_934_592,
      memorySwapMaxBytes: 0,
      tasksMax: 512,
      fileSizeMaxBytes: 17_179_869_184,
      coreSizeMaxBytes: 0,
      finalDescendantsObserved: 0,
    },
    resultArtifact: {
      name: "native-session.json",
      bytes: 512,
      sha256: "8".repeat(64),
    },
  };
}

test("platform closure, isolation policy, and instance artifacts round-trip canonically", () => {
  const platform = createG17NativePlatformClosureArtifact(platformInput());
  assert.equal(platform.artifact.name, G17_NATIVE_PLATFORM_ARTIFACT_NAME);
  assert.deepEqual(
    verifyG17NativePlatformClosureArtifact(platform.artifact.bytes),
    platform.closure,
  );

  const policy = createG17NativeIsolationPolicyArtifact();
  assert.equal(policy.artifact.name, G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME);
  assert.deepEqual(
    verifyG17NativeIsolationPolicyArtifact(policy.artifact.bytes),
    policy.policy,
  );

  const instance = createG17NativeIsolationInstanceArtifact(
    instanceInput(policy.policy, platform.closure),
  );
  assert.equal(instance.artifact.name, G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME);
  assert.deepEqual(
    verifyG17NativeIsolationInstanceArtifact({
      bytes: instance.artifact.bytes,
      policy: policy.policy,
      platform: platform.closure,
      workspaceProjectionSha256: "9".repeat(64),
    }),
    instance.instance,
  );
  assert.doesNotMatch(
    [platform.artifact.bytes, policy.artifact.bytes, instance.artifact.bytes]
      .map((bytes) => bytes.toString("utf8"))
      .join("\n"),
    /(?:\/tmp\/|\/home\/|\/usr$|\/lib64?$)/u,
  );
});

test("platform replay rejects role, entry, probe, graph, and derived-digest tampering", () => {
  const { artifact } = createG17NativePlatformClosureArtifact(platformInput());
  const mutations = [
    (value) => { value.entries[0].sha256 = "0".repeat(64); },
    (value) => { delete value.roles.cargo; },
    (value) => { value.roles.cargo.resolvedPath = "../escape"; },
    (value) => { value.probes[0].stdout.base64 = Buffer.from("changed\n").toString("base64"); },
    (value) => { value.elfGraph.nodes[0].sha256 = "1".repeat(64); },
    (value) => { value.platformRootSha256 = "2".repeat(64); },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(artifact.bytes);
    mutate(value);
    assert.throws(
      () => verifyG17NativePlatformClosureArtifact(canonicalBytes(value)),
      /G1\.7 native platform contract/u,
    );
  }
});

test("isolation replay rejects ambient mounts, mixed bindings, and ineffective limits", () => {
  const platform = createG17NativePlatformClosureArtifact(platformInput());
  const policy = createG17NativeIsolationPolicyArtifact();
  const created = createG17NativeIsolationInstanceArtifact(
    instanceInput(policy.policy, platform.closure),
  );
  const mutations = [
    (value) => { value.mounts[0].source = "/usr"; },
    (value) => { value.policySha256 = "0".repeat(64); },
    (value) => { value.environment.PATH = "/usr/local/bin:/usr/bin"; },
    (value) => { value.controllerTools[0].executableSha256 = "1".repeat(64); },
    (value) => { value.effectiveObservations.memoryMaxBytes -= 1; },
    (value) => { value.effectiveObservations.finalDescendantsObserved = 1; },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(created.artifact.bytes);
    mutate(value);
    assert.throws(
      () => verifyG17NativeIsolationInstanceArtifact({
        bytes: canonicalBytes(value),
        policy: policy.policy,
        platform: platform.closure,
        workspaceProjectionSha256: "9".repeat(64),
      }),
      /G1\.7 native platform contract/u,
    );
  }
});

test("platform contract replay is process- and filesystem-free", async () => {
  const source = await readFile(
    new URL("../src/qualification/native-platform-contract.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["'](?:node:)?(?:child_process|fs(?:\/promises)?)["']|\bprocess\s*(?:\.|\[)/u,
  );
});
