import { createHash } from "node:crypto";

import { canonicalJson, canonicalSha256 } from "../../src/routing/features.mjs";
import { loadG17Contract } from "../../src/qualification/contract.mjs";
import {
  G17_NATIVE_CONTROLLER_ARTIFACT_NAME,
  G17_NATIVE_CONTROLLER_SCHEMA,
  G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME,
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
} from "../../src/qualification/native-platform-contract.mjs";
import {
  G17_NATIVE_SESSION_ARTIFACT_NAME,
  createG17NativeSessionArtifactForTesting,
  createG17NativeSessionConfiguration,
} from "../../src/qualification/native-session-contract.mjs";
import {
  G17_NATIVE_WORKSPACE_ARTIFACT_NAME,
  G17_NATIVE_WORKSPACE_BINDING_SCHEMA,
  G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS,
  G17_NATIVE_WORKSPACE_OWNER_SCHEMA,
  G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA,
  G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS,
  G17_NATIVE_WORKSPACE_VERIFICATION_SCHEMA,
} from "../../src/qualification/native-workspace-contract.mjs";
import { g17IdentityFixture } from "./g17-identity-fixture.mjs";
import {
  syntheticG17CommandRecord,
  syntheticG17Isolation,
} from "./g17-native-session-fixture.mjs";

const digest = (character) => character.repeat(64);
const gitObject = (character) => character.repeat(40);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function canonicalBound(value) {
  return {
    bytes: Buffer.byteLength(canonicalJson(value), "utf8"),
    sha256: canonicalSha256(value),
  };
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
      return { stdout: "rustfmt 1.8.0-stable (fixture 2026-08-01)\n", stderr: "" };
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
    const identity = `${entry.root}:${parentPath}`;
    const children = childrenByDirectory.get(identity) ?? [];
    children.push(entry);
    childrenByDirectory.set(identity, children);
  }
  for (const entry of entries
    .filter(({ kind }) => kind === "directory")
    .sort((left, right) => right.path.split("/").length - left.path.split("/").length)) {
    entry.sha256 = canonicalSha256({
      schema: "oxigraph.g1.7-platform-directory/v2",
      root: entry.root,
      path: entry.path,
      children: (childrenByDirectory.get(`${entry.root}:${entry.path}`) ?? [])
        .map(({ path, kind, mode, bytes, sha256: hash, target }) => ({
          path,
          kind,
          mode,
          bytes,
          sha256: hash,
          target,
        })),
    });
  }
}

function platformInput(subjectIdentitySha256) {
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
      sha256: role.kind === "directory"
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
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`));
  bindDirectoryDigests(entries);
  const roles = Object.fromEntries(
    G17_NATIVE_PLATFORM_REQUIRED_ROLES.map((role) => {
      const entry = entries.find(
        ({ root, path }) => root === role.root && path === role.fixturePath,
      );
      return [role.id, {
        root: role.root,
        path: role.fixturePath,
        kind: role.kind,
        resolvedPath: role.fixturePath,
        sha256: entry.sha256,
      }];
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
    .map(({ root, path, sha256: hash }) => ({
      root,
      path,
      sha256: hash,
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
    subjectIdentitySha256,
    sourcePlanSha256: digest("7"),
    controllerAttestationSha256: digest("8"),
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

const sourcePlanSeeds = Object.freeze([
  ["rust-cargo", "toolchain", "bin/cargo", []],
  ["rust-rustc", "toolchain", "bin/rustc", []],
  ["rust-rustfmt", "toolchain", "bin/rustfmt", []],
  ["rust-libraries", "toolchain", "lib", []],
  ["c-headers", "platform", "usr/include", ["x86_64-linux-gnu/mpi", "x86_64-linux-gnu/openmpi"]],
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
  ["contained-session-worker", "platform", "runner/contained-session-worker.mjs", []],
  ["seccomp-launcher", "platform", "runner/seccomp-launcher.py", []],
]);

function reseal(value) {
  const { sha256: ignoredSha256, ...binding } = value;
  value.sha256 = canonicalSha256(binding);
  return value;
}

function addBundleEntries(input) {
  for (const [path, kind, bytes, content] of [
    ["runner", "directory", 0, null],
    ["runner/contained-session-worker.mjs", "file", 37, "worker"],
    ["runner/seccomp-launcher.py", "file", 41, "launcher"],
    ["usr/lib/os-release", "file", 29, "os-release"],
  ]) {
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
    `${left.root}\0${left.path}`.localeCompare(`${right.root}\0${right.path}`));
  bindDirectoryDigests(input.entries);
}

function controllerClosure(id) {
  const records = [{
    path: `/usr/bin/${id}`,
    bytes: id.length,
    sha256: sha256(Buffer.from(`${id}:executable`, "utf8")),
    soname: null,
    needed: [],
  }];
  return { records, sha256: canonicalSha256(records) };
}

function platformBundle(identity) {
  const input = platformInput(identity.identitySha256);
  for (const program of ["cargo", "rustc"]) {
    identity.toolchain.find((tool) => tool.program === program)
      .toolchainExecutableSha256 = input.roles[program].sha256;
  }
  resealIdentity(identity);
  input.subjectIdentitySha256 = identity.identitySha256;
  addBundleEntries(input);
  const sourceTarget = { ...input.target };
  delete sourceTarget.glibcVersion;
  const sourcePlan = {
    schema: G17_NATIVE_SOURCE_PLAN_SCHEMA,
    subjectIdentitySha256: input.subjectIdentitySha256,
    target: sourceTarget,
    generations: { gccMajor: "13", llvmMajor: "18", pythonVersion: "python3.12" },
    seeds: sourcePlanSeeds.map(([id, root, destination, excludes]) => ({
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
    ["systemd-run", "prlimit", "bwrap"].map((id) => [id, controllerClosure(id)]),
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
    sha256: digest("0"),
  });
  const worker = input.entries.find(
    ({ root, path }) => root === "platform" && path === "runner/contained-session-worker.mjs",
  );
  const launcher = input.entries.find(
    ({ root, path }) => root === "platform" && path === "runner/seccomp-launcher.py",
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
    sha256: digest("0"),
  });
  const controllerBytes = canonicalBytes(controller);
  input.sourcePlanSha256 = sha256(sourcePlanBytes);
  input.controllerAttestationSha256 = sha256(controllerBytes);
  const platform = createG17NativePlatformClosureArtifact(input);
  return { platform, sourcePlanBytes, controllerBytes };
}

function resealIdentity(identity) {
  const { harnessSha256: ignoredHarnessSha256, ...controlBinding } = identity.control;
  identity.control.harnessSha256 = canonicalSha256({
    schema: "oxigraph.committed-harness-identity/v1",
    ...controlBinding,
  });
  const { identitySha256: ignoredIdentitySha256, ...binding } = identity;
  identity.identitySha256 = canonicalSha256(binding);
  return identity;
}

function finalCargoConfigSha256() {
  return sha256(Buffer.from([
    "[build]",
    'target-dir = "/state/target"',
    "",
    "[net]",
    "offline = true",
    "",
    "[source.crates-io]",
    'replace-with = "g17-vendored-sources"',
    "",
    "[source.g17-vendored-sources]",
    'directory = "/cargo-home/vendor"',
    "",
  ].join("\n"), "utf8"));
}

const cargoEnvironment = Object.freeze({
  CARGO_HOME: "/control/bootstrap-cargo-home",
  CARGO_NET_OFFLINE: "true",
  CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
  CARGO_TERM_COLOR: "never",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/home",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  NO_COLOR: "1",
  PATH: "/toolchain/bin:/usr/bin:/bin",
  RUSTC: "/toolchain/bin/rustc",
  SOURCE_DATE_EPOCH: "946684800",
  TEMP: "/control/tmp",
  TERM: "dumb",
  TMP: "/control/tmp",
  TMPDIR: "/control/tmp",
});

function processEvidence(argv, maxOutputBytes, stdout = Buffer.alloc(0)) {
  const stderr = Buffer.alloc(0);
  return {
    program: "/toolchain/bin/cargo",
    argv,
    cwd: "/workspace",
    environment: structuredClone(cargoEnvironment),
    environmentSha256: canonicalSha256(cargoEnvironment),
    timeoutMs: 300_000,
    maxOutputBytes,
    disposition: "completed",
    exitCode: 0,
    signal: null,
    durationMs: 25,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  };
}

function projectionSource(source) {
  return {
    policy: source.policy,
    commit: source.commit,
    tree: source.tree,
    cargoLockSha256: source.cargoLock.sha256,
    requiredGitlinks: source.requiredGitlinks,
    excludedGitlinks: source.excludedGitlinks,
    objectClosureSha256: source.objectClosureSha256,
    entryCount: source.entryCount,
    totalBytes: source.totalBytes,
    manifestSha256: source.manifestSha256,
  };
}

function projectionDependencies(dependencies) {
  return {
    schema: dependencies.schema,
    policy: dependencies.policy,
    packageCount: dependencies.packageCount,
    packageSetSha256: dependencies.packageSetSha256,
    archiveCount: dependencies.archives.count,
    archiveBytes: dependencies.archives.bytes,
    archiveSetSha256: dependencies.archives.sha256,
    sparseEntryCount: dependencies.sparseBootstrap.uniqueCrateCount,
    sparseEntrySetSha256: dependencies.sparseBootstrap.entriesSha256,
    vendorChecksumSetSha256: dependencies.vendorChecksums.sha256,
    vendorManifestSha256: dependencies.vendor.afterSha256,
    metadataProjectionSha256: dependencies.metadata.sha256,
    finalConfigSha256: dependencies.finalConfigSha256,
    snapshotSha256: dependencies.snapshotSha256,
  };
}

function workspaceOwner(binding, lockBytes) {
  const symlinkTarget = "src/lib.rs";
  const source = {
    schema: "oxigraph.g1.7-source-snapshot/v1",
    policy: "temporary-index-exact-git-object-closure/v1",
    commit: binding.subjectCommit,
    tree: binding.subjectTree,
    cargoLock: {
      blob: binding.cargoLockBlob,
      bytes: lockBytes.length,
      sha256: binding.cargoLockSha256,
      base64: lockBytes.toString("base64"),
    },
    requiredGitlinks: G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS.map(
      (item, index) => ({
        ...item,
        entryCount: 2,
        manifestSha256: digest(index === 0 ? "d" : "e"),
      }),
    ),
    excludedGitlinks: G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS.map(
      (item) => ({ ...item }),
    ),
    symlinks: [{
      path: "lib-alias",
      target: symlinkTarget,
      gitBlob: gitBlobSha1(Buffer.from(symlinkTarget, "utf8")),
    }],
    objectClosureSha256: "",
    entryCount: 12,
    totalBytes: lockBytes.length + 1_024,
    manifestSha256: digest("f"),
    beforeSha256: digest("f"),
    afterSha256: digest("f"),
  };
  source.objectClosureSha256 = canonicalSha256({
    schema: "oxigraph.g1.7-source-object-closure/v1",
    objectFormat: "sha1",
    commit: source.commit,
    tree: source.tree,
    requiredGitlinks: source.requiredGitlinks,
    excludedGitlinks: source.excludedGitlinks,
    symlinks: source.symlinks,
  });
  const packages = [{
    name: "demo",
    version: "1.2.3",
    source: "registry+https://github.com/rust-lang/crates.io-index",
    checksum: digest("a"),
  }];
  const archiveRecords = [{
    name: "demo",
    version: "1.2.3",
    source: packages[0].source,
    lockChecksum: packages[0].checksum,
    archiveName: "demo-1.2.3.crate",
    bytes: 512,
    sha256: packages[0].checksum,
  }];
  const archiveProjection = {
    schema: "oxigraph.g1.7-registry-archive-set/v1",
    cargoLockSha256: binding.cargoLockSha256,
    records: archiveRecords,
  };
  const sparseRecords = [{
    crate: "demo",
    path: "de/mo/demo",
    bytes: 128,
    sha256: digest("b"),
  }];
  const sparseConfigSha256 = digest("c");
  const sparseProjection = {
    schema: "oxigraph.g1.7-sparse-bootstrap-set/v1",
    registryDirectory: "index.crates.io-1949cf8c6b5b557f",
    configSha256: sparseConfigSha256,
    records: sparseRecords,
  };
  const vendorPackages = [{
    name: "demo",
    version: "1.2.3",
    packageChecksum: packages[0].checksum,
    files: [{ path: "src/lib.rs", sha256: digest("d") }],
  }];
  const vendorChecksumProjection = {
    schema: "oxigraph.g1.7-vendor-checksum-set/v1",
    cargoLockSha256: binding.cargoLockSha256,
    packages: vendorPackages,
  };
  const metadataPackages = [
    {
      name: "oxigraph",
      version: "0.5.0",
      source: null,
      manifestPath: "/workspace/lib/oxigraph/Cargo.toml",
    },
    {
      name: "demo",
      version: "1.2.3",
      source: packages[0].source,
      manifestPath: "/cargo-home/vendor/demo-1.2.3/Cargo.toml",
    },
  ];
  const metadataProjection = {
    schema: "oxigraph.g1.7-cargo-metadata-projection/v1",
    workspaceRoot: "/workspace",
    targetDirectory: "/state/target",
    packageCount: metadataPackages.length,
    registryPackageCount: 1,
    packages: metadataPackages,
  };
  const dependencies = {
    schema: "oxigraph.g1.7-private-cargo-dependencies/v1",
    policy: "lock-checksummed-archive-to-directory-source/v1",
    cargoLock: {
      blob: binding.cargoLockBlob,
      bytes: lockBytes.length,
      sha256: binding.cargoLockSha256,
    },
    registrySource: packages[0].source,
    registryDirectory: "index.crates.io-1949cf8c6b5b557f",
    packageCount: packages.length,
    packageSetSha256: canonicalSha256({
      schema: "oxigraph.g1.7-locked-registry-packages/v1",
      packages,
    }),
    packages,
    archives: {
      schema: archiveProjection.schema,
      records: archiveRecords,
      count: archiveRecords.length,
      bytes: 512,
      serializedBytes: canonicalBound(archiveProjection).bytes,
      sha256: canonicalBound(archiveProjection).sha256,
    },
    sparseBootstrap: {
      schema: sparseProjection.schema,
      records: sparseRecords,
      uniqueCrateCount: 1,
      bytes: 128,
      serializedBytes: canonicalBound(sparseProjection).bytes,
      configSha256: sparseConfigSha256,
      entriesSha256: canonicalBound(sparseProjection).sha256,
    },
    vendorChecksums: {
      schema: vendorChecksumProjection.schema,
      packageCount: 1,
      fileCount: 1,
      serializedBytes: canonicalBound(vendorChecksumProjection).bytes,
      packages: vendorPackages,
      sha256: canonicalBound(vendorChecksumProjection).sha256,
    },
    vendorCommand: processEvidence([
      "vendor",
      "--locked",
      "--offline",
      "--versioned-dirs",
      "--color=never",
      "--manifest-path",
      "/workspace/Cargo.toml",
      "/cargo-home/vendor",
    ], 1024 * 1024),
    metadataCommand: processEvidence([
      "metadata",
      "--locked",
      "--offline",
      "--format-version",
      "1",
      "--manifest-path",
      "/workspace/Cargo.toml",
    ], 16 * 1024 * 1024, Buffer.from("{}\n", "utf8")),
    metadata: {
      ...metadataProjection,
      ...canonicalBound(metadataProjection),
    },
    vendor: {
      packageCount: 1,
      entryCount: 3,
      bytes: 1_024,
      beforeSha256: digest("e"),
      afterSha256: digest("e"),
    },
    finalConfigSha256: finalCargoConfigSha256(),
    snapshotSha256: "",
  };
  dependencies.snapshotSha256 = canonicalSha256(
    Object.fromEntries(
      Object.entries(dependencies).filter(([key]) => key !== "snapshotSha256"),
    ),
  );
  const verificationBase = {
    schema: G17_NATIVE_WORKSPACE_VERIFICATION_SCHEMA,
    phase: "after-native",
    bindingSha256: canonicalSha256(binding),
    source: {
      entryCount: source.entryCount,
      totalBytes: source.totalBytes,
      beforeSha256: source.beforeSha256,
      afterSha256: source.afterSha256,
    },
    vendor: { ...dependencies.vendor },
    vendorChecksumSha256: dependencies.vendorChecksums.sha256,
    finalConfigSha256: dependencies.finalConfigSha256,
  };
  const projectionBase = {
    schema: G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA,
    policy: "detached-committed-source-private-offline-vendor/v1",
    binding,
    source: projectionSource(source),
    dependencies: projectionDependencies(dependencies),
  };
  const owner = {
    schema: G17_NATIVE_WORKSPACE_OWNER_SCHEMA,
    policy: "detached-committed-source-private-offline-vendor/v1",
    binding,
    source,
    dependencies,
    verification: {
      ...verificationBase,
      sha256: canonicalSha256(verificationBase),
    },
    projection: {
      ...projectionBase,
      sha256: canonicalSha256(projectionBase),
    },
    sha256: "",
  };
  owner.sha256 = canonicalSha256(
    Object.fromEntries(Object.entries(owner).filter(([key]) => key !== "sha256")),
  );
  return { owner, bytes: canonicalBytes(owner), projection: owner.projection };
}

function requestedLimits(contract) {
  const reviewed = contract.compatibility.nativeSession;
  return {
    totalWallMs: reviewed.maxTotalWallMs,
    residentBytes: reviewed.maxResidentBytes,
    diskBytes: reviewed.maxDiskBytes,
    cargoBuildJobs: reviewed.cargoBuildJobs,
    tasksMax: reviewed.tasksMax,
    memorySwapBytes: reviewed.memorySwapMaxBytes,
  };
}

function controllerNamespaces() {
  return {
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
  };
}

export function createG17NativeApplicationFixture({
  runId = "native-application-production-fixture",
} = {}) {
  const sealedContract = loadG17Contract();
  const lockBytes = Buffer.from([
    "version = 4",
    "",
    "[[package]]",
    'name = "demo"',
    'version = "1.2.3"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${digest("a")}"`,
    "",
  ].join("\n"), "utf8");
  const identity = g17IdentityFixture({
    subjectCommit: gitObject("2"),
    cargoVersion: probeText("cargo-version").stdout.trimEnd(),
    rustcVersion: probeText("rust-version").stdout.trimEnd(),
  });
  identity.evaluator = {
    commit: sealedContract.contract.evaluator.commit,
    parent: sealedContract.contract.evaluator.parent,
    tree: sealedContract.contract.evaluator.tree,
    patchSha256: sealedContract.contract.evaluator.patchSha256,
    blobSetSha256: canonicalSha256(
      sealedContract.contract.evaluator.paths.map(
        ({ path, blob, contentSha256 }) => ({ path, blob, contentSha256 }),
      ),
    ),
  };
  identity.subject.tree = gitObject("3");
  identity.cargoLock = {
    blob: gitBlobSha1(lockBytes),
    sha256: sha256(lockBytes),
  };
  resealIdentity(identity);
  const bundle = platformBundle(identity);
  const platform = bundle.platform.closure;
  const workspaceBinding = {
    schema: G17_NATIVE_WORKSPACE_BINDING_SCHEMA,
    subjectIdentitySha256: identity.identitySha256,
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    cargoLockBlob: identity.cargoLock.blob,
    cargoLockSha256: identity.cargoLock.sha256,
    platformManifestSha256: platform.manifestSha256,
    toolchainRootSha256: platform.toolchainRootSha256,
    toolchain: Object.fromEntries(["cargo", "rustc"].map((program) => {
      const tool = identity.toolchain.find((candidate) => candidate.program === program);
      return [program, {
        logicalPath: `/toolchain/bin/${program}`,
        executableSha256: tool.toolchainExecutableSha256,
        versionSha256: sha256(Buffer.from(tool.versionStdout, "utf8")),
      }];
    })),
  };
  const workspace = workspaceOwner(workspaceBinding, lockBytes);
  const policy = createG17NativeIsolationPolicyArtifact();
  const configuration = createG17NativeSessionConfiguration({
    runId,
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
    platform,
    policy: policy.policy,
    workspaceProjectionSha256: workspace.projection.sha256,
    requestedLimits: requestedLimits(sealedContract.contract),
  });
  const rawCommandEvidence = [];
  const commands = configuration.commands.map((command, index) => {
    const lane = sealedContract.contract.compatibility.native[Math.floor(index / 2)];
    const stdout = index % 2 === 0
      ? `${lane.expectedTestIds.map((id) => `${id}: test`).join("\n")}\n`
      : `test result: ok. ${lane.expectedPassedTests} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n`;
    const stderr = index === 0 ? "fixture-raw-stderr-marker: diagnostic only\n" : "";
    rawCommandEvidence.push(stdout, Buffer.from(stdout, "utf8").toString("base64"));
    if (stderr.length > 0) {
      rawCommandEvidence.push(stderr, Buffer.from(stderr, "utf8").toString("base64"));
    }
    return syntheticG17CommandRecord(configuration, command, index, stdout, stderr);
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
  const instance = createG17NativeIsolationInstanceArtifact({
    runId,
    policy: policy.policy,
    platform,
    controllerBytes: bundle.controllerBytes,
    workspaceProjectionSha256: workspace.projection.sha256,
    controllerNamespaces: controllerNamespaces(),
    sessionBytes: session.artifact.bytes,
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  return {
    input: {
      artifacts: [
        { name: G17_NATIVE_PLATFORM_ARTIFACT_NAME, bytes: bundle.platform.artifact.bytes },
        { name: G17_NATIVE_SOURCE_PLAN_ARTIFACT_NAME, bytes: bundle.sourcePlanBytes },
        { name: G17_NATIVE_CONTROLLER_ARTIFACT_NAME, bytes: bundle.controllerBytes },
        { name: G17_NATIVE_WORKSPACE_ARTIFACT_NAME, bytes: workspace.bytes },
        { name: G17_NATIVE_ISOLATION_POLICY_ARTIFACT_NAME, bytes: policy.artifact.bytes },
        { name: G17_NATIVE_SESSION_ARTIFACT_NAME, bytes: session.artifact.bytes },
        { name: G17_NATIVE_ISOLATION_INSTANCE_ARTIFACT_NAME, bytes: instance.artifact.bytes },
      ],
      identity,
      contractBytes: Buffer.from(sealedContract.bytes),
      contractSha256: sealedContract.contractSha256,
      runId,
    },
    forbiddenProjectionText: [
      ...identity.toolchain.flatMap((tool) => [
        tool.invokedPath,
        tool.path,
        tool.toolchainPath,
        tool.versionStdout,
        Buffer.from(`${tool.versionStdout}\n`, "utf8").toString("base64"),
      ]),
      ...rawCommandEvidence,
    ],
  };
}
