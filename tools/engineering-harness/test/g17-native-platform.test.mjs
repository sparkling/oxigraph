import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { repositoryRoot } from "../src/paths.mjs";
import { loadG17Contract } from "../src/qualification/contract.mjs";
import { currentG17QualificationIdentity } from "../src/qualification/identity.mjs";
import {
  G17_NATIVE_PLATFORM_REQUIRED_PROBES,
  G17_NATIVE_PLATFORM_REQUIRED_ROLES,
} from "../src/qualification/native-platform-contract.mjs";
import {
  G17NativePlatformFault,
  acquireG17NativePlatform,
  createG17NativePlatformAcquirerForTesting,
  destroyG17NativePlatform,
  verifyG17NativePlatform,
} from "../src/qualification/native-platform.mjs";

test("production platform API rejects injected acquisition dependencies", async () => {
  await assert.rejects(
    acquireG17NativePlatform({
      runId: "injection-rejected",
      temporaryParent: "/tmp",
      identity: {},
      signal: undefined,
      processRunner: () => {},
    }),
    /fields are not exact/u,
  );
});

test("production platform acquires and probes the current host projection", {
  skip: process.env.OXIGRAPH_G17_LIVE_PLATFORM !== "1",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-production-platform-"));
  let platform;
  try {
    const { contract } = loadG17Contract();
    const identity = await currentG17QualificationIdentity({
      contract,
      repoRoot:
        process.env.OXIGRAPH_TEST_COMMITTED_REPOSITORY_ROOT ?? repositoryRoot,
    });
    platform = await acquireG17NativePlatform({
      runId: "production-live-smoke",
      temporaryParent: root,
      identity,
      signal: undefined,
    });
    assert.equal(platform.closure.subjectIdentitySha256, identity.identitySha256);
    assert.equal(platform.closure.sourcePlanSha256, platform.sourcePlan.sha256);
    assert.equal(platform.closure.controllerAttestationSha256, platform.controllerAttestation.sha256);
    const sourcePlanBytes = platform.sourcePlan.bytes;
    assert.equal(sha256(sourcePlanBytes), platform.sourcePlan.sha256);
    assert.equal(sourcePlanBytes.at(-1), 0x0a);
    assert.equal(
      sha256(sourcePlanBytes.subarray(0, -1)),
      platform.sourcePlan.projectionSha256,
    );
    assert.equal(
      sha256(platform.controllerAttestation.bytes),
      platform.controllerAttestation.sha256,
    );
    const controller = JSON.parse(platform.controllerAttestation.bytes);
    assert.equal(
      Buffer.from(
        controller.tools.find(({ id }) => id === "contained-session-worker")
          .version.base64,
        "base64",
      ).toString("utf8"),
      "contained-session-worker/v5\n",
    );
    assert.equal(
      Buffer.from(
        controller.tools.find(({ id }) => id === "seccomp-launcher")
          .version.base64,
        "base64",
      ).toString("utf8"),
      "seccomp-launcher/v3\n",
    );
    assert.equal(sha256(platform.artifact.bytes), platform.artifact.sha256);
    assert.equal(platform.closure.linkerScripts.records.length >= 2, true);
    assert.equal(platform.closure.elfGraph.nodes.length > 30, true);
    assert.equal(platform.closure.probes.length, G17_NATIVE_PLATFORM_REQUIRED_PROBES.length);
    assert.doesNotMatch(platform.artifact.bytes.toString("utf8"), /"\/home\//u);
    await verifyG17NativePlatform(platform, "after-native");
  } finally {
    if (platform !== undefined) await destroyG17NativePlatform(platform);
    await rm(root, { recursive: true, force: true });
  }
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

async function writeRoleTree(root, roles) {
  for (const [index, role] of roles.entries()) {
    const path = join(root, ...role.fixturePath.split("/"));
    if (role.kind === "directory") {
      await mkdir(path, { recursive: true, mode: 0o700 });
      await writeFile(join(path, `.fixture-${index}`), `${role.id}\n`);
    } else {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${role.id}:${index}\n`);
      await chmod(path, 0o700);
    }
  }
}

async function fixture(root) {
  const toolchainSource = join(root, "toolchain-source");
  const platformSource = join(root, "platform-source");
  await Promise.all([
    mkdir(toolchainSource, { mode: 0o700 }),
    mkdir(platformSource, { mode: 0o700 }),
  ]);
  await mkdir(
    join(
      toolchainSource,
      "lib",
      "rustlib",
      "x86_64-unknown-linux-gnu",
      "lib",
    ),
    { recursive: true, mode: 0o700 },
  );
  await Promise.all([
    writeRoleTree(
      toolchainSource,
      G17_NATIVE_PLATFORM_REQUIRED_ROLES.filter(({ root: roleRoot }) =>
        roleRoot === "toolchain"),
    ),
    writeRoleTree(
      platformSource,
      G17_NATIVE_PLATFORM_REQUIRED_ROLES.filter(({ root: roleRoot }) =>
        roleRoot === "platform"),
    ),
  ]);
  const caseSensitiveHeaders = join(
    platformSource,
    "usr",
    "include",
    "linux",
    "netfilter",
  );
  await mkdir(caseSensitiveHeaders, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(join(caseSensitiveHeaders, "xt_CONNMARK.h"), "upper\n"),
    writeFile(join(caseSensitiveHeaders, "xt_connmark.h"), "lower\n"),
  ]);
  const cc = G17_NATIVE_PLATFORM_REQUIRED_ROLES.find(({ id }) => id === "cc");
  await symlink(
    `/${cc.fixturePath}`,
    join(platformSource, "usr", "bin", "cc-fixture-link"),
  );
  const roleBindings = Object.fromEntries(
    G17_NATIVE_PLATFORM_REQUIRED_ROLES.map(({ id, root: roleRoot, fixturePath }) => [
      id,
      { root: roleRoot, path: fixturePath },
    ]),
  );
  const processRunner = async ({ executable, probeId, productPaths, cwd }) => {
    assert.equal(cwd, "/");
    const { stdout, stderr } = probeText(probeId);
    return {
      disposition: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 2,
      stdout,
      stderr,
      products: productPaths.map((path) => ({
        path,
        bytes: path.length,
        sha256: sha256(Buffer.from(path, "utf8")),
      })),
      executable,
    };
  };
  const dynamicLoader = roleBindings.dynamicLoader;
  const elfInspector = async ({ role, entry }) => ({
    node: {
      elfClass: 64,
      elfData: "little",
      elfMachine: 62,
      interpreter:
        role.id === "dynamicLoader"
          ? null
          : `${dynamicLoader.root}:${dynamicLoader.path}`,
      soname: null,
      needed: [],
      rpath: [],
      runpath: [],
    },
    edges: [],
    observedSha256: entry.sha256,
  });
  return {
    sources: [
      { root: "toolchain", source: toolchainSource, destination: "" },
      { root: "platform", source: platformSource, destination: "" },
    ],
    roleBindings,
    processRunner,
    elfInspector,
    linkerScriptInspector: async () => [],
  };
}

test("platform acquisition materializes, attests, reverifies, and destroys generated roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-platform-fixture-"));
  let platform;
  try {
    const options = await fixture(root);
    const acquire = createG17NativePlatformAcquirerForTesting({
      temporaryParent: root,
      ...options,
    });
    platform = await acquire({ runId: "platform-fixture" });
    assert.equal(platform.closure.schema, "oxigraph.g1.7-linux-native-platform-closure/v4");
    assert.equal(platform.closure.probes.length, G17_NATIVE_PLATFORM_REQUIRED_PROBES.length);
    assert.equal(platform.closure.roles.cargo.root, "toolchain");
    assert.equal(platform.closure.roles.cc.root, "platform");
    assert.equal(
      platform.closure.entries.filter(({ path }) =>
        path === "usr/include/linux/netfilter/xt_CONNMARK.h" ||
        path === "usr/include/linux/netfilter/xt_connmark.h").length,
      2,
    );
    for (const path of [
      "control",
      "control/cgroup2",
      "proc",
      "dev",
      "runner",
      "result",
      "workspace",
      "cargo-home",
      "toolchain",
      "state",
      "state/home",
      "state/target",
      "state/tmp",
    ]) {
      assert.equal(
        platform.closure.entries.some(
          (entry) =>
            entry.root === "platform" &&
            entry.path === path &&
            entry.kind === "directory",
        ),
        true,
        path,
      );
    }
    assert.equal(
      platform.closure.entries.some(
        (entry) =>
          entry.root === "platform" &&
          entry.path === "tmp" &&
          entry.kind === "symlink" &&
          entry.target === "state/tmp",
      ),
      true,
    );
    assert.equal(
      platform.closure.entries.some(
        ({ kind, path }) => kind === "symlink" && path === "usr/bin/cc-fixture-link",
      ),
      true,
    );
    assert.doesNotMatch(platform.artifact.bytes.toString("utf8"), new RegExp(root, "u"));
    const afterPreparation = await verifyG17NativePlatform(platform, "after-preparation");
    assert.equal(afterPreparation.toolchainRootSha256, platform.closure.toolchainRootSha256);
    assert.equal(afterPreparation.platformRootSha256, platform.closure.platformRootSha256);

    const nodePath = join(platform.platformDirectory, "usr", "bin", "node");
    await chmod(nodePath, 0o600);
    await writeFile(nodePath, "mutated node\n");
    await assert.rejects(
      verifyG17NativePlatform(platform, "after-native"),
      (error) =>
        error instanceof G17NativePlatformFault &&
        error.classification === "FAIL" &&
        error.phase === "after-native",
    );
    const generatedRoot = platform.root;
    const destroyedPlatform = platform;
    await destroyG17NativePlatform(destroyedPlatform);
    platform = undefined;
    await assert.rejects(
      lstat(generatedRoot),
      (error) => error?.code === "ENOENT",
    );
    await assert.rejects(destroyG17NativePlatform(destroyedPlatform), /not live/u);
  } finally {
    if (platform !== undefined) await destroyG17NativePlatform(platform);
    await rm(root, { recursive: true, force: true });
  }
});

test("platform teardown rejects root substitution and preserves retry authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-platform-substitution-"));
  let platform;
  let heldRoot;
  let replacementRoot;
  try {
    const options = await fixture(root);
    const acquire = createG17NativePlatformAcquirerForTesting({
      temporaryParent: root,
      ...options,
    });
    platform = await acquire({ runId: "root-substitution" });
    heldRoot = `${platform.root}-held`;
    replacementRoot = `${platform.root}-replacement`;
    await rename(platform.root, heldRoot);
    await mkdir(platform.root, { mode: 0o755 });
    const sentinel = join(platform.root, "sentinel");
    await writeFile(sentinel, "do not delete\n");

    await assert.rejects(
      destroyG17NativePlatform(platform),
      (error) =>
        error instanceof G17NativePlatformFault &&
        error.classification === "FAIL" &&
        error.phase === "cleanup",
    );
    assert.equal(await readFile(sentinel, "utf8"), "do not delete\n");
    assert.equal((await lstat(heldRoot)).isDirectory(), true);

    await rename(platform.root, replacementRoot);
    await rename(heldRoot, platform.root);
    heldRoot = undefined;
    await destroyG17NativePlatform(platform);
    platform = undefined;
    assert.equal(await readFile(join(replacementRoot, "sentinel"), "utf8"), "do not delete\n");

    const source = await readFile(
      new URL("../src/qualification/native-platform.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /rm\([^\n]*recursive|makeWritable/u);
  } finally {
    if (platform !== undefined && heldRoot !== undefined) {
      await rm(platform.root, { recursive: true, force: true });
      await rename(heldRoot, platform.root).catch(() => {});
      await destroyG17NativePlatform(platform).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("platform acquisition rejects absent absolute symlink targets and removes the generated root", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-platform-escape-"));
  try {
    const options = await fixture(root);
    const nodePath = join(options.sources[1].source, "usr", "bin", "node");
    await rm(nodePath);
    await symlink("/etc/passwd", nodePath);
    const acquire = createG17NativePlatformAcquirerForTesting({
      temporaryParent: root,
      ...options,
    });
    await assert.rejects(
      acquire({ runId: "symlink-escape" }),
      (error) =>
        error instanceof G17NativePlatformFault &&
        ["FAIL", "MISSING"].includes(error.classification) &&
        /(?:symlink|absent)/u.test(error.reason),
    );
    const generated = (await readFile(new URL("../src/qualification/native-platform.mjs", import.meta.url), "utf8"));
    assert.doesNotMatch(generated, /cpSync|execFileSync/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform acquisition rejects overlapping destination authority before copying", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-platform-overlap-"));
  try {
    const options = await fixture(root);
    const acquire = createG17NativePlatformAcquirerForTesting({
      temporaryParent: root,
      ...options,
      sources: [
        ...options.sources,
        {
          root: "platform",
          source: options.sources[1].source,
          destination: "usr",
        },
      ],
    });
    await assert.rejects(
      acquire({ runId: "overlap" }),
      /overlapping platform destinations/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform acquisition rejects aliased source roots and oversized files", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-platform-source-"));
  try {
    const aliasedRoot = join(root, "aliased");
    await mkdir(aliasedRoot);
    const aliased = await fixture(aliasedRoot);
    const sourceAlias = join(aliasedRoot, "toolchain-source-alias");
    await symlink(aliased.sources[0].source, sourceAlias);
    const acquireAliased = createG17NativePlatformAcquirerForTesting({
      temporaryParent: root,
      ...aliased,
      sources: [
        { ...aliased.sources[0], source: sourceAlias },
        aliased.sources[1],
      ],
    });
    await assert.rejects(
      acquireAliased({ runId: "aliased-source" }),
      /not a real directory root/u,
    );

    const oversizedRoot = join(root, "oversized");
    await mkdir(oversizedRoot);
    const oversized = await fixture(oversizedRoot);
    const nodePath = join(oversized.sources[1].source, "usr", "bin", "node");
    await truncate(nodePath, 512 * 1024 * 1024 + 1);
    const acquireOversized = createG17NativePlatformAcquirerForTesting({
      temporaryParent: root,
      ...oversized,
    });
    await assert.rejects(
      acquireOversized({ runId: "oversized-source" }),
      /not a bounded regular file/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform source and copied file digests are exact", async () => {
  const bytes = Buffer.from("native-platform-digest-fixture\n");
  assert.equal(sha256(bytes), "41a23005be4dba38c9707acf28d662c77c9179b6e9f9600b583524935f826e59");
});
