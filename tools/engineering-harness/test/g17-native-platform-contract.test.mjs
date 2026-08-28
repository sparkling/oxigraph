import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createG17NativeSessionArtifactForTesting,
  createG17NativeSessionConfiguration,
} from "../src/qualification/native-session-contract.mjs";

import {
  G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
  G17_NATIVE_CONTROLLER_SCHEMA,
  G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
  G17_NATIVE_ISOLATION_INSTANCE_SCHEMA,
  G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  G17_NATIVE_PLATFORM_REQUIRED_ROLES,
  G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
  G17_NATIVE_SOURCE_PLAN_SCHEMA,
  createG17NativeIsolationInstanceArtifact,
  createG17NativeIsolationPolicyArtifact,
  createG17NativePlatformClosureArtifact,
  g17NativePlatformProbeRecipes,
  replayG17NativePlatformProbe,
  verifyG17NativeIsolationInstanceArtifact,
  verifyG17NativeIsolationPolicyArtifact,
  verifyG17NativePlatformBundle,
  verifyG17NativePlatformClosureArtifact,
} from "../src/qualification/native-platform-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  syntheticG17CommandRecord,
  syntheticG17Isolation,
} from "./support/g17-native-session-fixture.mjs";
import { loadG17LegacyV4Contract } from "./support/g17-legacy-v4-contract-fixture.mjs";

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

function probeText(id) {
  switch (id) {
    case "rust-version":
      return {
        stdout: [
          "rustc 1.96.0 (fixture 2026-08-01)",
          "binary: rustc",
          "commit-hash: 0123456789abcdef0123456789abcdef01234567",
          "commit-date: 2026-08-01",
          "host: x86_64-unknown-linux-gnu",
          "release: 1.96.0",
          "LLVM version: 18.1.8",
          "",
        ].join("\n"),
        stderr: "",
      };
    case "cargo-version":
      return {
        stdout: [
          "cargo 1.96.0 (fixture 2026-08-01)",
          "release: 1.96.0",
          "commit-hash: 0123456789abcdef0123456789abcdef01234567",
          "commit-date: 2026-08-01",
          "host: x86_64-unknown-linux-gnu",
          "",
        ].join("\n"),
        stderr: "",
      };
    case "rustfmt-version":
      return {
        stdout: "rustfmt 1.8.0-stable (fixture 2026-08-01)\n",
        stderr: "",
      };
    case "rust-target-libdir":
      return {
        stdout: "/toolchain/lib/rustlib/x86_64-unknown-linux-gnu/lib\n",
        stderr: "",
      };
    case "rust-cfg":
      return {
        stdout: [
          'target_arch="x86_64"',
          'target_env="gnu"',
          'target_os="linux"',
          "",
        ].join("\n"),
        stderr: "",
      };
    case "gcc-version":
      return { stdout: "gcc (fixture) 13.3.0\n", stderr: "" };
    case "gcc-target":
      return { stdout: "x86_64-linux-gnu\n", stderr: "" };
    case "gcc-search-dirs":
      return {
        stdout: [
          "install: /usr/lib/gcc/x86_64-linux-gnu/13/",
          "programs: /usr/libexec/gcc/x86_64-linux-gnu/13/:/usr/bin/",
          "libraries: /usr/lib/gcc/x86_64-linux-gnu/13/:/usr/lib/x86_64-linux-gnu/",
          "",
        ].join("\n"),
        stderr: "",
      };
    case "gxx-version":
      return { stdout: "g++ (fixture) 13.3.0\n", stderr: "" };
    case "binutils-version":
      return { stdout: "GNU ld (fixture) 2.42\n", stderr: "" };
    case "c-include-search":
      return {
        stdout: "",
        stderr: [
          "#include <...> search starts here:",
          " /usr/lib/gcc/x86_64-linux-gnu/13/include",
          " /usr/include",
          "End of search list.",
          "",
        ].join("\n"),
      };
    case "cxx-include-search":
      return {
        stdout: "",
        stderr: [
          "#include <...> search starts here:",
          " /usr/include/c++/13",
          " /usr/include/x86_64-linux-gnu/c++/13",
          " /usr/include",
          "End of search list.",
          "",
        ].join("\n"),
      };
    case "controller-node-version":
      return { stdout: "v24.13.0\n", stderr: "" };
    case "controller-python-version":
      return { stdout: "Python 3.12.3\n", stderr: "" };
    case "libclang-bindgen-smoke":
      return { stdout: "clang version 18.1.3\n", stderr: "" };
    case "python-seccomp-smoke":
      return { stdout: "2.5.5\n", stderr: "" };
    case "glibc-version":
      return { stdout: "ld.so (GNU libc) 2.39\n", stderr: "" };
    default:
      return { stdout: "", stderr: "" };
  }
}

function bindDirectoryDigests(entries) {
  const childrenByDirectory = new Map();
  for (const entry of entries) {
    const parentPath = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : null;
    if (parentPath === null) continue;
    const parentIdentity = `${entry.root}:${parentPath}`;
    const children = childrenByDirectory.get(parentIdentity) ?? [];
    children.push(entry);
    childrenByDirectory.set(parentIdentity, children);
  }
  const directories = entries
    .filter(({ kind }) => kind === "directory")
    .sort(
      (left, right) =>
        right.path.split("/").length - left.path.split("/").length,
    );
  for (const entry of directories) {
    entry.sha256 = canonicalSha256({
      schema: "oxigraph.g1.7-platform-directory/v2",
      root: entry.root,
      path: entry.path,
      children: (
        childrenByDirectory.get(`${entry.root}:${entry.path}`) ?? []
      ).map(({ path, kind, mode, bytes, sha256: digest, target }) => ({
        path,
        kind,
        mode,
        bytes,
        sha256: digest,
        target,
      })),
    });
  }
}

function platformInput() {
  const entriesById = new Map();
  for (const [index, role] of G17_NATIVE_PLATFORM_REQUIRED_ROLES.entries()) {
    const parts = role.fixturePath.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      const path = parts.slice(0, length).join("/");
      const identity = `${role.root}:${path}`;
      if (!entriesById.has(identity)) {
        entriesById.set(identity, {
          root: role.root,
          path,
          kind: "directory",
          mode: 365,
          bytes: 0,
          sha256: null,
          target: null,
        });
      }
    }
    entriesById.set(`${role.root}:${role.fixturePath}`, {
      root: role.root,
      path: role.fixturePath,
      kind: role.kind,
      mode: 365,
      bytes: role.kind === "directory" ? 0 : index + 1,
      sha256:
        role.kind === "directory"
          ? null
          : sha256(Buffer.from(`${role.id}:${index}`, "utf8")),
      target: null,
    });
  }
  const entries = [...entriesById.values()];
  entries.push({
    root: "toolchain",
    path: "lib/rustlib/x86_64-unknown-linux-gnu/lib",
    kind: "directory",
    mode: 365,
    bytes: 0,
    sha256: null,
    target: null,
  });
  entries.sort((left, right) =>
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`),
  );
  bindDirectoryDigests(entries);
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
  const probes = g17NativePlatformProbeRecipes(roles).map((recipe) => {
    const { stdout, stderr } = probeText(recipe.id);
    const products = recipe.productPaths.map((path) => ({
      path,
      bytes: path.length,
      sha256: sha256(Buffer.from(path, "utf8")),
    }));
    const parsed = replayG17NativePlatformProbe({
      id: recipe.id,
      stdout: stream(stdout),
      stderr: stream(stderr),
      products,
    });
    return {
      id: recipe.id,
      program: recipe.program,
      argv: recipe.argv,
      cwd: recipe.cwd,
      environment: recipe.environment,
      environmentSha256: canonicalSha256(recipe.environment),
      timeoutMs: recipe.timeoutMs,
      maxOutputBytes: recipe.maxOutputBytes,
      disposition: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdout: stream(stdout),
      stderr: stream(stderr),
      stdin: recipe.stdin,
      products,
      parsed,
      parsedSha256: canonicalSha256(parsed),
    };
  });
  const nodes = entries
    .filter(({ kind }) => kind === "file")
    .map(({ root, path, sha256: digest }) => ({
      root,
      path,
      sha256: digest,
      elfClass: 64,
      elfData: "little",
      elfMachine: 62,
      interpreter:
        path.startsWith("bin/") || path.startsWith("usr/bin/")
          ? "platform:lib64/ld-linux-x86-64.so.2"
          : null,
      soname: null,
      needed: [],
      rpath: [],
      runpath: [],
    }));
  return {
    profile: "linux-x86_64-gnu-bundled-rocksdb/v1",
    subjectIdentitySha256: "6".repeat(64),
    sourcePlanSha256: "7".repeat(64),
    controllerAttestationSha256: "8".repeat(64),
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

const sourcePlanSeedFixture = Object.freeze([
  ["rust-cargo", "toolchain", "bin/cargo", []],
  ["rust-rustc", "toolchain", "bin/rustc", []],
  ["rust-rustfmt", "toolchain", "bin/rustfmt", []],
  ["rust-libraries", "toolchain", "lib", []],
  [
    "c-headers",
    "platform",
    "usr/include",
    ["x86_64-linux-gnu/mpi", "x86_64-linux-gnu/openmpi"],
  ],
  ["gcc-libraries", "platform", "usr/lib/gcc/x86_64-linux-gnu/13", []],
  ["gcc-libexec", "platform", "usr/libexec/gcc/x86_64-linux-gnu/13", []],
  ["clang-headers", "platform", "usr/lib/llvm-18/lib/clang/18/include", []],
  ["python-stdlib", "platform", "usr/lib/python3.12", ["sitecustomize.py"]],
  ["cc", "platform", "usr/bin/x86_64-linux-gnu-gcc-13", []],
  ["cxx", "platform", "usr/bin/x86_64-linux-gnu-g++-13", []],
  ["ar", "platform", "usr/bin/x86_64-linux-gnu-ar", []],
  ["as", "platform", "usr/bin/x86_64-linux-gnu-as", []],
  ["ld", "platform", "usr/bin/x86_64-linux-gnu-ld.bfd", []],
  ["nm", "platform", "usr/bin/x86_64-linux-gnu-nm", []],
  ["ranlib", "platform", "usr/bin/x86_64-linux-gnu-ranlib", []],
  ["node", "platform", "usr/bin/node", []],
  ["python", "platform", "usr/bin/python3.12", []],
  ["setpriv", "platform", "usr/bin/setpriv", []],
  ["mount", "platform", "usr/bin/mount", []],
  ["true", "platform", "usr/bin/true", []],
  ["os-release", "platform", "usr/lib/os-release", []],
  [
    "contained-session-worker",
    "platform",
    "runner/contained-session-worker.mjs",
    [],
  ],
  ["seccomp-launcher", "platform", "runner/seccomp-launcher.py", []],
]);

function reseal(value) {
  const { sha256: ignoredSha256, ...binding } = value;
  value.sha256 = canonicalSha256(binding);
  return value;
}

function addBundleEntries(input) {
  const additions = [
    ["runner", "directory", 0, null],
    ["runner/contained-session-worker.mjs", "file", 37, "worker"],
    ["runner/seccomp-launcher.py", "file", 41, "launcher"],
    ["usr/lib/os-release", "file", 29, "os-release"],
  ];
  for (const [path, kind, bytes, content] of additions) {
    input.entries.push({
      root: "platform",
      path,
      kind,
      mode: 365,
      bytes,
      sha256: content === null ? null : sha256(Buffer.from(content, "utf8")),
      target: null,
    });
  }
  input.entries.sort((left, right) =>
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`),
  );
  bindDirectoryDigests(input.entries);
}

function controllerClosure(id) {
  const records = [
    {
      path: `/usr/bin/${id}`,
      bytes: id.length,
      sha256: sha256(Buffer.from(`${id}:executable`, "utf8")),
      soname: null,
      needed: [],
    },
  ];
  return { records, sha256: canonicalSha256(records) };
}

function platformBundleFixture() {
  const input = platformInput();
  addBundleEntries(input);
  const sourceTarget = { ...input.target };
  delete sourceTarget.glibcVersion;
  const sourcePlan = {
    schema: G17_NATIVE_SOURCE_PLAN_SCHEMA,
    subjectIdentitySha256: input.subjectIdentitySha256,
    target: sourceTarget,
    generations: {
      gccMajor: "13",
      llvmMajor: "18",
      pythonVersion: "python3.12",
    },
    seeds: sourcePlanSeedFixture.map(([id, root, destination, excludes]) => ({
      id,
      root,
      destination,
      excludes,
    })),
    roles: Object.fromEntries(
      Object.entries(input.roles).map(([id, role]) => [
        id,
        { root: role.root, path: role.path },
      ]),
    ),
    dependencySourcePrefixes: [
      "toolchain:lib",
      "platform:usr/lib/x86_64-linux-gnu",
      "platform:usr/lib/llvm-18/lib",
      "platform:usr/lib/gcc/x86_64-linux-gnu/13",
      "platform:usr/libexec/gcc/x86_64-linux-gnu/13",
      "platform:usr/lib64",
    ],
  };
  const sourcePlanBytes = canonicalBytes(sourcePlan);

  const closures = Object.fromEntries(
    ["systemd-run", "prlimit", "bwrap"].map((id) => [
      id,
      controllerClosure(id),
    ]),
  );
  const snapshotHelper = reseal({
    schema: "oxigraph.g1.7-native-snapshot-helper/v2",
    source: { bytes: 1, sha256: sha256(Buffer.from("source", "utf8")) },
    compiler: {
      path: "/usr/bin/x86_64-linux-gnu-gcc-13",
      executableSha256: input.roles.cc.sha256,
      version: stream("gcc fixture 13.3.0\n"),
    },
    compile: {
      argv: [
        "/usr/bin/x86_64-linux-gnu-gcc-13",
        "-std=c17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-fstack-protector-strong",
        "-D_FORTIFY_SOURCE=2",
        "-Wl,-z,relro,-z,now",
        "native-snapshot-helper.c",
        "-o",
        "g17-native-snapshot-helper",
      ],
      stdout: stream(""),
      stderr: stream(""),
    },
    executable: {
      bytes: 1,
      sha256: sha256(Buffer.from("helper", "utf8")),
      identity: {
        device: "1",
        inode: "2",
        mode: "33088",
        links: "1",
        size: "1",
        modifiedNs: "3",
        changedNs: "4",
      },
    },
    sha256: "0".repeat(64),
  });
  const worker = input.entries.find(
    ({ root, path }) =>
      root === "platform" && path === "runner/contained-session-worker.mjs",
  );
  const launcher = input.entries.find(
    ({ root, path }) =>
      root === "platform" && path === "runner/seccomp-launcher.py",
  );
  const tools = [
    ...["systemd-run", "prlimit", "bwrap"].map((id) => ({
      id,
      executableSha256: closures[id].records[0].sha256,
      version: stream(`${id} fixture\n`),
      dependencyClosureSha256: closures[id].sha256,
    })),
    {
      id: "native-snapshot-helper",
      executableSha256: snapshotHelper.executable.sha256,
      version: stream(`${snapshotHelper.schema}\n`),
      dependencyClosureSha256: canonicalSha256({
        source: snapshotHelper.source,
        compiler: snapshotHelper.compiler,
      }),
    },
    {
      id: "contained-session-worker",
      executableSha256: worker.sha256,
      version: stream("contained-session-worker/v5\n"),
      dependencyClosureSha256: worker.sha256,
    },
    {
      id: "seccomp-launcher",
      executableSha256: launcher.sha256,
      version: stream("seccomp-launcher/v3\n"),
      dependencyClosureSha256: launcher.sha256,
    },
  ];
  const controller = reseal({
    schema: G17_NATIVE_CONTROLLER_SCHEMA,
    tools,
    closures,
    snapshotHelper,
    sha256: "0".repeat(64),
  });
  const controllerBytes = canonicalBytes(controller);
  input.sourcePlanSha256 = sha256(sourcePlanBytes);
  input.controllerAttestationSha256 = sha256(controllerBytes);
  const platform = createG17NativePlatformClosureArtifact(input);
  return {
    input,
    platform,
    sourcePlan,
    sourcePlanBytes,
    controller,
    controllerBytes,
  };
}

function reboundBundle(fixture, sourcePlan, controller) {
  const sourcePlanBytes = canonicalBytes(sourcePlan);
  const controllerBytes = canonicalBytes(controller);
  const input = structuredClone(fixture.input);
  input.sourcePlanSha256 = sha256(sourcePlanBytes);
  input.controllerAttestationSha256 = sha256(controllerBytes);
  return {
    platformBytes: createG17NativePlatformClosureArtifact(input).artifact.bytes,
    sourcePlanBytes,
    controllerBytes,
  };
}

function instanceInput(policy, platform, controllerBytes) {
  const workspaceProjectionSha256 = "9".repeat(64);
  const sealedContract = loadG17LegacyV4Contract();
  const reviewed = sealedContract.contract.compatibility.nativeSession;
  const configuration = createG17NativeSessionConfiguration({
    runId: "platform-contract-fixture",
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
    platform,
    policy,
    workspaceProjectionSha256,
    requestedLimits: {
      totalWallMs: reviewed.maxTotalWallMs,
      residentBytes: reviewed.maxResidentBytes,
      diskBytes: reviewed.maxDiskBytes,
      cargoBuildJobs: reviewed.cargoBuildJobs,
      tasksMax: reviewed.tasksMax,
      memorySwapBytes: reviewed.memorySwapMaxBytes,
    },
  });
  const commands = configuration.commands.map((command, index) => {
    const lane =
      sealedContract.contract.compatibility.native[Math.floor(index / 2)];
    return syntheticG17CommandRecord(
      configuration,
      command,
      index,
      index % 2 === 0
        ? `${lane.expectedTestIds.map((id) => `${id}: test`).join("\n")}\n`
        : `test result: ok. ${lane.expectedPassedTests} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n`,
    );
  });
  const session = createG17NativeSessionArtifactForTesting({
    configuration,
    session: {
      outcome: "pass",
      reason: null,
      commands,
      stateBytes: 4_096,
      durationMs: 30,
      finalDescendantsObserved: 0,
      isolation: syntheticG17Isolation(configuration),
    },
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  return {
    runId: "platform-contract-fixture",
    policy,
    platform,
    controllerBytes,
    workspaceProjectionSha256,
    controllerNamespaces: {
      before: {
        user: "user:[201]",
        mount: "mnt:[202]",
        network: "net:[203]",
        pid: "pid:[204]",
        ipc: "ipc:[205]",
        uts: "uts:[206]",
      },
      after: {
        user: "user:[201]",
        mount: "mnt:[202]",
        network: "net:[203]",
        pid: "pid:[204]",
        ipc: "ipc:[205]",
        uts: "uts:[206]",
      },
    },
    sessionBytes: session.artifact.bytes,
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  };
}

test("platform closure, isolation policy, and instance artifacts round-trip canonically", () => {
  const bundle = platformBundleFixture();
  const { input, platform } = bundle;
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.entries), false);
  assert.equal(
    Object.hasOwn(G17_NATIVE_PLATFORM_REQUIRED_ROLES[0], "pathPattern"),
    false,
  );
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

  const instanceFixture = instanceInput(
    policy.policy,
    platform.closure,
    bundle.controllerBytes,
  );
  const instance = createG17NativeIsolationInstanceArtifact(instanceFixture);
  assert.equal(
    instance.artifact.name,
    G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
  );
  assert.equal(
    G17_NATIVE_ISOLATION_INSTANCE_SCHEMA,
    "oxigraph.g1.7-linux-native-isolation-instance/v5",
  );
  assert.equal(instance.instance.schema, G17_NATIVE_ISOLATION_INSTANCE_SCHEMA);
  assert.equal(
    instance.instance.effectiveObservations.normalizedMountTopologyObserved,
    true,
  );
  assert.equal(
    instance.instance.effectiveObservations.cgroupMembershipMatched,
    true,
  );
  assert.deepEqual(
    verifyG17NativeIsolationInstanceArtifact({
      bytes: instance.artifact.bytes,
      policy: policy.policy,
      platform: platform.closure,
      controllerBytes: bundle.controllerBytes,
      workspaceProjectionSha256: "9".repeat(64),
      sessionBytes: instanceFixture.sessionBytes,
      contractBytes: instanceFixture.contractBytes,
      contractSha256: instanceFixture.contractSha256,
    }),
    instance.instance,
  );
  assert.doesNotMatch(
    [platform.artifact.bytes, policy.artifact.bytes, instance.artifact.bytes]
      .map((bytes) => bytes.toString("utf8"))
      .join("\n"),
    /(?:\/tmp\/|\/home\/|\/usr$|\/lib64?$)/u,
  );

  const mutableCopy = platform.artifact.bytes;
  mutableCopy.fill(0);
  assert.equal(sha256(platform.artifact.bytes), platform.artifact.sha256);
  assert.deepEqual(
    verifyG17NativePlatformClosureArtifact(platform.artifact.bytes),
    platform.closure,
  );
});

test("platform bundle replays exact source-plan and controller artifacts", () => {
  const fixture = platformBundleFixture();
  const replayed = verifyG17NativePlatformBundle({
    platformBytes: fixture.platform.artifact.bytes,
    sourcePlanBytes: fixture.sourcePlanBytes,
    controllerBytes: fixture.controllerBytes,
  });
  assert.deepEqual(replayed.platform, fixture.platform.closure);
  assert.deepEqual(replayed.sourcePlan, fixture.sourcePlan);
  assert.deepEqual(replayed.controller, fixture.controller);
  assert.equal(
    Buffer.from(
      replayed.controller.tools.find(
        ({ id }) => id === "contained-session-worker",
      ).version.base64,
      "base64",
    ).toString("utf8"),
    "contained-session-worker/v5\n",
  );
  assert.equal(
    Buffer.from(
      replayed.controller.tools.find(({ id }) => id === "seccomp-launcher")
        .version.base64,
      "base64",
    ).toString("utf8"),
    "seccomp-launcher/v3\n",
  );
  assert.equal(
    replayed.sourcePlanProjectionSha256,
    sha256(fixture.sourcePlanBytes.subarray(0, -1)),
  );
  assert.equal(
    fixture.platform.artifact.name,
    G17_NATIVE_PLATFORM_ARTIFACT_NAME,
  );
  assert.equal(
    G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME,
    "linux-native-source-plan.json",
  );
  assert.equal(
    G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
    "linux-native-controller-closure.json",
  );
});

test("platform bundle rejects semantically rehashed source and controller drift", () => {
  const fixture = platformBundleFixture();
  const mutations = [
    () => {
      const sourcePlan = structuredClone(fixture.sourcePlan);
      sourcePlan.subjectIdentitySha256 = "a".repeat(64);
      return reboundBundle(fixture, sourcePlan, fixture.controller);
    },
    () => {
      const sourcePlan = structuredClone(fixture.sourcePlan);
      sourcePlan.seeds[0].destination = sourcePlan.seeds[1].destination;
      return reboundBundle(fixture, sourcePlan, fixture.controller);
    },
    () => {
      const sourcePlan = structuredClone(fixture.sourcePlan);
      sourcePlan.generations.gccMajor = "14";
      return reboundBundle(fixture, sourcePlan, fixture.controller);
    },
    () => {
      const sourcePlan = structuredClone(fixture.sourcePlan);
      sourcePlan.target.architecture = "aarch64";
      return reboundBundle(fixture, sourcePlan, fixture.controller);
    },
    () => {
      const sourcePlan = structuredClone(fixture.sourcePlan);
      sourcePlan.roles.cargo.path = sourcePlan.roles.rustc.path;
      return reboundBundle(fixture, sourcePlan, fixture.controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      const tool = controller.tools.find(
        ({ id }) => id === "contained-session-worker",
      );
      tool.executableSha256 = "a".repeat(64);
      tool.dependencyClosureSha256 = tool.executableSha256;
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      const tool = controller.tools.find(
        ({ id }) => id === "contained-session-worker",
      );
      tool.version = stream("contained-session-worker/v4\n");
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      const tool = controller.tools.find(({ id }) => id === "seccomp-launcher");
      tool.version = stream("seccomp-launcher/v2\n");
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.snapshotHelper.compiler.executableSha256 = "b".repeat(64);
      reseal(controller.snapshotHelper);
      const tool = controller.tools.find(
        ({ id }) => id === "native-snapshot-helper",
      );
      tool.dependencyClosureSha256 = canonicalSha256({
        source: controller.snapshotHelper.source,
        compiler: controller.snapshotHelper.compiler,
      });
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.snapshotHelper.compiler.path =
        "/usr/bin/x86_64-linux-gnu-gcc-14";
      controller.snapshotHelper.compile.argv[0] =
        controller.snapshotHelper.compiler.path;
      reseal(controller.snapshotHelper);
      const tool = controller.tools.find(
        ({ id }) => id === "native-snapshot-helper",
      );
      tool.dependencyClosureSha256 = canonicalSha256({
        source: controller.snapshotHelper.source,
        compiler: controller.snapshotHelper.compiler,
      });
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.snapshotHelper.executable.identity.size = "2";
      reseal(controller.snapshotHelper);
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.snapshotHelper.executable.identity.mode = String(0o100700);
      reseal(controller.snapshotHelper);
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.snapshotHelper.executable.identity.mode =
        String(0x1_0000_8140);
      reseal(controller.snapshotHelper);
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.closures.bwrap.records[0].path = "/usr/bin/not-bwrap";
      controller.closures.bwrap.sha256 = canonicalSha256(
        controller.closures.bwrap.records,
      );
      const tool = controller.tools.find(({ id }) => id === "bwrap");
      tool.dependencyClosureSha256 = controller.closures.bwrap.sha256;
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.closures.prlimit.records[0].needed = ["missing.so.1"];
      controller.closures.prlimit.sha256 = canonicalSha256(
        controller.closures.prlimit.records,
      );
      const tool = controller.tools.find(({ id }) => id === "prlimit");
      tool.dependencyClosureSha256 = controller.closures.prlimit.sha256;
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
    () => {
      const controller = structuredClone(fixture.controller);
      controller.tools[0].version.base64 =
        Buffer.from("changed\n").toString("base64");
      reseal(controller);
      return reboundBundle(fixture, fixture.sourcePlan, controller);
    },
  ];
  for (const mutate of mutations) {
    assert.throws(
      () => verifyG17NativePlatformBundle(mutate()),
      /G1\.7 native platform contract/u,
    );
  }
});

test("platform bundle rejects noncanonical artifact framing", () => {
  const fixture = platformBundleFixture();
  for (const [sourcePlanBytes, controllerBytes] of [
    [
      Buffer.from(JSON.stringify(fixture.sourcePlan), "utf8"),
      fixture.controllerBytes,
    ],
    [
      fixture.sourcePlanBytes,
      Buffer.from(JSON.stringify(fixture.controller), "utf8"),
    ],
  ]) {
    assert.throws(
      () =>
        verifyG17NativePlatformBundle({
          platformBytes: fixture.platform.artifact.bytes,
          sourcePlanBytes,
          controllerBytes,
        }),
      /G1\.7 native platform contract/u,
    );
  }
});

test("platform replay rejects role, entry, probe, graph, and derived-digest tampering", () => {
  const { artifact } = createG17NativePlatformClosureArtifact(platformInput());
  const mutations = [
    (value) => {
      value.entries[0].sha256 = "0".repeat(64);
    },
    (value) => {
      delete value.roles.cargo;
    },
    (value) => {
      value.roles.cargo.resolvedPath = "../escape";
    },
    (value) => {
      value.probes[0].stdout.base64 =
        Buffer.from("changed\n").toString("base64");
    },
    (value) => {
      value.elfGraph.nodes[0].sha256 = "1".repeat(64);
    },
    (value) => {
      value.platformRootSha256 = "2".repeat(64);
    },
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

test("platform replay re-executes exact probe recipes and cross-version checks", () => {
  const { artifact } = createG17NativePlatformClosureArtifact(platformInput());
  const mutations = [
    (value) => {
      value.probes[0].program = "/toolchain/bin/cargo";
    },
    (value) => {
      value.probes[0].argv = [value.probes[0].program, "--version"];
    },
    (value) => {
      value.probes[0].cwd = "/state";
    },
    (value) => {
      value.probes[0].environment.PATH = "/usr/bin";
    },
    (value) => {
      value.probes[11].stdin = stream("different input\n");
    },
    (value) => {
      value.probes[0].parsed.facts.release = "1.95.0";
      value.probes[0].parsedSha256 = canonicalSha256(value.probes[0].parsed);
    },
    (value) => {
      const probe = value.probes.find(({ id }) => id === "rust-version");
      const changed = probeText("rust-version").stdout.replaceAll(
        "1.96.0",
        "1.95.0",
      );
      probe.stdout = stream(changed);
      probe.parsed = replayG17NativePlatformProbe({
        id: probe.id,
        stdout: probe.stdout,
        stderr: probe.stderr,
        products: probe.products,
      });
      probe.parsedSha256 = canonicalSha256(probe.parsed);
    },
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

test("platform roles require owner-readable and owner-executable modes", () => {
  for (const [roleId, mode] of [
    ["cargo", 0o001],
    ["libclang", 0o004],
    ["cHeaders", 0o001],
  ]) {
    const input = platformInput();
    const role = input.roles[roleId];
    const entry = input.entries.find(
      ({ root, path }) => root === role.root && path === role.resolvedPath,
    );
    entry.mode = mode;
    bindDirectoryDigests(input.entries);
    assert.throws(
      () => createG17NativePlatformClosureArtifact(input),
      /G1\.7 native platform contract/u,
    );
  }
});

test("platform paths model only the mounted namespace and real directory ancestry", () => {
  const valid = platformInput();
  valid.entries.push({
    root: "platform",
    path: "usr/bin/cc-alias",
    kind: "symlink",
    mode: null,
    bytes: null,
    sha256: null,
    target: "/usr/bin/x86_64-linux-gnu-gcc-13",
  });
  valid.entries.sort((left, right) =>
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`),
  );
  bindDirectoryDigests(valid.entries);
  assert.equal(
    createG17NativePlatformClosureArtifact(valid).closure.entries.some(
      ({ root, path, target }) =>
        root === "platform" &&
        path === "usr/bin/cc-alias" &&
        target === "/usr/bin/x86_64-linux-gnu-gcc-13",
    ),
    true,
  );

  const mergedUsr = platformInput();
  const loaderRole = mergedUsr.roles.dynamicLoader;
  const loaderEntry = mergedUsr.entries.find(
    ({ root, path }) => root === "platform" && path === loaderRole.path,
  );
  const lib64Entry = mergedUsr.entries.find(
    ({ root, path }) => root === "platform" && path === "lib64",
  );
  Object.assign(lib64Entry, {
    kind: "symlink",
    mode: null,
    bytes: null,
    sha256: null,
    target: "usr/lib64",
  });
  loaderEntry.path = `usr/${loaderEntry.path}`;
  mergedUsr.entries.push({
    root: "platform",
    path: "usr/lib64",
    kind: "directory",
    mode: 365,
    bytes: 0,
    sha256: null,
    target: null,
  });
  loaderRole.resolvedPath = loaderEntry.path;
  const loaderNode = mergedUsr.elfGraph.nodes.find(
    ({ root, path }) =>
      root === "platform" && path === "lib64/ld-linux-x86-64.so.2",
  );
  loaderNode.path = loaderEntry.path;
  for (const node of mergedUsr.elfGraph.nodes) {
    if (node.interpreter === "platform:lib64/ld-linux-x86-64.so.2") {
      node.interpreter = `platform:${loaderEntry.path}`;
    }
  }
  mergedUsr.elfGraph.nodes.sort((left, right) =>
    `${left.root}:${left.path}`.localeCompare(`${right.root}:${right.path}`),
  );
  mergedUsr.entries.sort((left, right) =>
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`),
  );
  bindDirectoryDigests(mergedUsr.entries);
  assert.equal(
    createG17NativePlatformClosureArtifact(mergedUsr).closure.roles
      .dynamicLoader.resolvedPath,
    "usr/lib64/ld-linux-x86-64.so.2",
  );

  for (const mutate of [
    (input) => {
      input.entries = input.entries.filter(
        ({ root, path }) => !(root === "platform" && path === "usr/bin"),
      );
    },
    (input) => {
      input.entries.push({
        root: "platform",
        path: `usr/${"a".repeat(256)}`,
        kind: "file",
        mode: 365,
        bytes: 1,
        sha256: "1".repeat(64),
        target: null,
      });
      input.entries.sort((left, right) =>
        `${left.root}\0${left.path}`.localeCompare(
          `${right.root}\0${right.path}`,
        ),
      );
    },
    (input) => {
      const entry = input.entries.find(
        ({ root, path }) => root === "platform" && path === "usr/bin",
      );
      Object.assign(entry, {
        kind: "symlink",
        mode: null,
        bytes: null,
        sha256: null,
        target: "/usr/lib",
      });
    },
    (input) => {
      input.entries.push({
        root: "platform",
        path: "usr/bin/escape",
        kind: "symlink",
        mode: null,
        bytes: null,
        sha256: null,
        target: "/etc/passwd",
      });
      input.entries.sort((left, right) =>
        `${left.root}\0${left.path}`.localeCompare(
          `${right.root}\0${right.path}`,
        ),
      );
      bindDirectoryDigests(input.entries);
    },
  ]) {
    const input = platformInput();
    mutate(input);
    assert.throws(
      () => createG17NativePlatformClosureArtifact(input),
      /G1\.7 native platform contract/u,
    );
  }
});

test("isolation replay rejects drifted bindings, controller observations, and derived claims", () => {
  const bundle = platformBundleFixture();
  const { platform } = bundle;
  const policy = createG17NativeIsolationPolicyArtifact();
  const fixture = instanceInput(
    policy.policy,
    platform.closure,
    bundle.controllerBytes,
  );
  const created = createG17NativeIsolationInstanceArtifact(fixture);
  const mutations = [
    (value) => {
      value.policySha256 = "0".repeat(64);
    },
    (value) => {
      value.controllerTools[0].executableSha256 = "1".repeat(64);
      value.controllerToolsSha256 = canonicalSha256(value.controllerTools);
      reseal(value);
    },
    (value) => {
      value.effectiveObservations.memoryMaxBytes -= 1;
    },
    (value) => {
      value.effectiveObservations.finalDescendantsObserved = 1;
    },
    (value) => {
      value.effectiveObservations.normalizedMountTopologyObserved = false;
      reseal(value);
    },
    (value) => {
      value.effectiveObservations.cgroupMembershipMatched = false;
      reseal(value);
    },
    (value) => {
      value.controllerNamespaces.before.user = "user:[105]";
    },
    (value) => {
      value.sessionArtifact.sha256 = "1".repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(created.artifact.bytes);
    mutate(value);
    assert.throws(
      () =>
        verifyG17NativeIsolationInstanceArtifact({
          bytes: canonicalBytes(value),
          policy: policy.policy,
          platform: platform.closure,
          controllerBytes: bundle.controllerBytes,
          workspaceProjectionSha256: "9".repeat(64),
          sessionBytes: fixture.sessionBytes,
          contractBytes: fixture.contractBytes,
          contractSha256: fixture.contractSha256,
        }),
      /G1\.7 native platform contract/u,
    );
  }
});

test("isolation replay consumes the supplied sealed session bytes", () => {
  const bundle = platformBundleFixture();
  const { platform } = bundle;
  const policy = createG17NativeIsolationPolicyArtifact();
  const fixture = instanceInput(
    policy.policy,
    platform.closure,
    bundle.controllerBytes,
  );
  const created = createG17NativeIsolationInstanceArtifact(fixture);
  const mutatedSession = JSON.parse(fixture.sessionBytes);
  mutatedSession.stateBytes += 1;

  assert.throws(
    () =>
      verifyG17NativeIsolationInstanceArtifact({
        bytes: created.artifact.bytes,
        policy: policy.policy,
        platform: platform.closure,
        controllerBytes: bundle.controllerBytes,
        workspaceProjectionSha256: "9".repeat(64),
        sessionBytes: canonicalBytes(mutatedSession),
        contractBytes: fixture.contractBytes,
        contractSha256: fixture.contractSha256,
      }),
    /G1\.7 native platform contract:/u,
  );
});

test("isolation replay prefixes malformed verification inputs", () => {
  assert.throws(
    () => verifyG17NativeIsolationInstanceArtifact(null),
    /^Error: G1\.7 native platform contract:/u,
  );
});

test("platform contract replay is process- and filesystem-free", async () => {
  const source = await readFile(
    new URL(
      "../src/qualification/native-platform-contract.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["'](?:node:)?(?:child_process|fs(?:\/promises)?)["']|\bprocess\s*(?:\.|\[)/u,
  );
});
