import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17_NATIVE_WORKSPACE_ARTIFACT_NAME,
  G17_NATIVE_WORKSPACE_BINDING_SCHEMA,
  G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS,
  G17_NATIVE_WORKSPACE_OWNER_SCHEMA,
  G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA,
  G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS,
  G17_NATIVE_WORKSPACE_VERIFICATION_SCHEMA,
  verifyG17NativeWorkspaceOwnerArtifact,
} from "../src/qualification/native-workspace-contract.mjs";

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

function canonicalBound(value) {
  return {
    bytes: Buffer.byteLength(canonicalJson(value), "utf8"),
    sha256: canonicalSha256(value),
  };
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

const cargoEnvironment = {
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
};

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

function rehash(owner) {
  owner.source.objectClosureSha256 = canonicalSha256({
    schema: "oxigraph.g1.7-source-object-closure/v1",
    objectFormat: "sha1",
    commit: owner.source.commit,
    tree: owner.source.tree,
    requiredGitlinks: owner.source.requiredGitlinks,
    excludedGitlinks: owner.source.excludedGitlinks,
    symlinks: owner.source.symlinks,
  });
  owner.dependencies.packageSetSha256 = canonicalSha256({
    schema: "oxigraph.g1.7-locked-registry-packages/v1",
    packages: owner.dependencies.packages,
  });
  const archives = {
    schema: "oxigraph.g1.7-registry-archive-set/v1",
    cargoLockSha256: owner.dependencies.cargoLock.sha256,
    records: owner.dependencies.archives.records,
  };
  const archiveBound = canonicalBound(archives);
  owner.dependencies.archives.serializedBytes = archiveBound.bytes;
  owner.dependencies.archives.sha256 = archiveBound.sha256;
  const sparse = {
    schema: "oxigraph.g1.7-sparse-bootstrap-set/v1",
    registryDirectory: "index.crates.io-1949cf8c6b5b557f",
    configSha256: owner.dependencies.sparseBootstrap.configSha256,
    records: owner.dependencies.sparseBootstrap.records,
  };
  const sparseBound = canonicalBound(sparse);
  owner.dependencies.sparseBootstrap.serializedBytes = sparseBound.bytes;
  owner.dependencies.sparseBootstrap.entriesSha256 = sparseBound.sha256;
  const checksums = {
    schema: "oxigraph.g1.7-vendor-checksum-set/v1",
    cargoLockSha256: owner.dependencies.cargoLock.sha256,
    packages: owner.dependencies.vendorChecksums.packages,
  };
  const checksumBound = canonicalBound(checksums);
  owner.dependencies.vendorChecksums.serializedBytes = checksumBound.bytes;
  owner.dependencies.vendorChecksums.sha256 = checksumBound.sha256;
  const metadata = {
    schema: owner.dependencies.metadata.schema,
    workspaceRoot: owner.dependencies.metadata.workspaceRoot,
    targetDirectory: owner.dependencies.metadata.targetDirectory,
    packageCount: owner.dependencies.metadata.packageCount,
    registryPackageCount: owner.dependencies.metadata.registryPackageCount,
    packages: owner.dependencies.metadata.packages,
  };
  Object.assign(owner.dependencies.metadata, canonicalBound(metadata));
  owner.dependencies.vendorCommand.environmentSha256 = canonicalSha256(
    owner.dependencies.vendorCommand.environment,
  );
  owner.dependencies.metadataCommand.environmentSha256 = canonicalSha256(
    owner.dependencies.metadataCommand.environment,
  );
  const dependencyBase = Object.fromEntries(
    Object.entries(owner.dependencies).filter(([key]) => key !== "snapshotSha256"),
  );
  owner.dependencies.snapshotSha256 = canonicalSha256(dependencyBase);
  owner.verification.sha256 = canonicalSha256(
    Object.fromEntries(
      Object.entries(owner.verification).filter(([key]) => key !== "sha256"),
    ),
  );
  owner.projection.binding = owner.binding;
  owner.projection.source = projectionSource(owner.source);
  owner.projection.dependencies = projectionDependencies(owner.dependencies);
  owner.projection.sha256 = canonicalSha256(
    Object.fromEntries(
      Object.entries(owner.projection).filter(([key]) => key !== "sha256"),
    ),
  );
  owner.sha256 = canonicalSha256(
    Object.fromEntries(Object.entries(owner).filter(([key]) => key !== "sha256")),
  );
  return owner;
}

function fixture() {
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
  const binding = {
    schema: G17_NATIVE_WORKSPACE_BINDING_SCHEMA,
    subjectIdentitySha256: digest("1"),
    subjectCommit: gitObject("2"),
    subjectTree: gitObject("3"),
    cargoLockBlob: gitBlobSha1(lockBytes),
    cargoLockSha256: sha256(lockBytes),
    platformManifestSha256: digest("4"),
    toolchainRootSha256: digest("5"),
    toolchain: {
      cargo: {
        logicalPath: "/toolchain/bin/cargo",
        executableSha256: digest("6"),
        versionSha256: digest("7"),
      },
      rustc: {
        logicalPath: "/toolchain/bin/rustc",
        executableSha256: digest("8"),
        versionSha256: digest("9"),
      },
    },
  };
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
      (gitlink, index) => ({
        ...gitlink,
        entryCount: index + 2,
        manifestSha256: digest(index === 0 ? "d" : "e"),
      }),
    ),
    excludedGitlinks: G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS.map(
      (gitlink) => ({ ...gitlink }),
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
  const expected = {
    subjectIdentitySha256: binding.subjectIdentitySha256,
    subjectCommit: binding.subjectCommit,
    subjectTree: binding.subjectTree,
    cargoLockBlob: binding.cargoLockBlob,
    cargoLockSha256: binding.cargoLockSha256,
    platformManifestSha256: binding.platformManifestSha256,
    toolchainRootSha256: binding.toolchainRootSha256,
    toolchain: {
      cargo: {
        executableSha256: binding.toolchain.cargo.executableSha256,
        versionSha256: binding.toolchain.cargo.versionSha256,
      },
      rustc: {
        executableSha256: binding.toolchain.rustc.executableSha256,
        versionSha256: binding.toolchain.rustc.versionSha256,
      },
    },
  };
  return { owner, expected };
}

function bytes(owner) {
  return Buffer.from(`${canonicalJson(owner)}\n`, "utf8");
}

test("pure workspace-owner v2 replay validates and freezes the complete envelope", () => {
  const { owner, expected } = fixture();
  const artifactBytes = bytes(owner);
  const verified = verifyG17NativeWorkspaceOwnerArtifact({
    bytes: artifactBytes,
    expected,
  });

  assert.equal(verified.owner.schema, G17_NATIVE_WORKSPACE_OWNER_SCHEMA);
  assert.equal(verified.projection.schema, G17_NATIVE_WORKSPACE_PROJECTION_SCHEMA);
  assert.equal(verified.artifact.name, G17_NATIVE_WORKSPACE_ARTIFACT_NAME);
  assert.equal(verified.artifact.sha256, sha256(artifactBytes));
  assert.deepEqual(verified.artifact.bytes, artifactBytes);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.owner), true);
  assert.equal(Object.isFrozen(verified.owner.binding.toolchain.cargo), true);
  assert.equal(Object.isFrozen(verified.owner.dependencies.packages), true);
  assert.equal(Object.isFrozen(verified.projection), true);
  assert.equal(Object.isFrozen(verified.artifact), true);
  assert.equal(Object.isFrozen(G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS), true);
  assert.equal(Object.isFrozen(G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS[0]), true);
  assert.equal(Object.isFrozen(G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS), true);
  assert.equal(Object.isFrozen(G17_NATIVE_WORKSPACE_EXCLUDED_GITLINKS[0]), true);

  const firstRead = verified.artifact.bytes;
  firstRead[0] ^= 0xff;
  assert.deepEqual(verified.artifact.bytes, artifactBytes);
  assert.throws(() => {
    verified.owner.policy = "mutated";
  }, TypeError);
});

test("workspace-owner replay snapshots accessor bytes exactly once", () => {
  const { owner, expected } = fixture();
  const suppliedBytes = bytes(owner);
  const replayedBytes = Buffer.from(suppliedBytes);
  const substitutedBytes = Buffer.from("not-the-verified-owner\n", "utf8");
  let reads = 0;
  const verified = verifyG17NativeWorkspaceOwnerArtifact({
    get bytes() {
      reads += 1;
      return reads === 1 ? suppliedBytes : substitutedBytes;
    },
    expected,
  });

  suppliedBytes.fill(0);
  substitutedBytes.fill(0);
  assert.equal(reads, 1);
  assert.deepEqual(verified.artifact.bytes, replayedBytes);
  assert.equal(verified.artifact.sha256, sha256(replayedBytes));
  assert.equal(verified.owner.sha256, owner.sha256);
});

test("workspace-owner replay rejects noncanonical, oversized, and inexact envelopes", () => {
  const { owner, expected } = fixture();
  assert.throws(
    () => verifyG17NativeWorkspaceOwnerArtifact({
      bytes: Buffer.from(`${JSON.stringify(owner, null, 2)}\n`, "utf8"),
      expected,
    }),
    /not canonical JSON/u,
  );
  assert.throws(
    () => verifyG17NativeWorkspaceOwnerArtifact({
      bytes: Buffer.from(canonicalJson(owner), "utf8"),
      expected,
    }),
    /newline-terminated/u,
  );
  assert.throws(
    () => verifyG17NativeWorkspaceOwnerArtifact({
      bytes: Buffer.alloc(32 * 1024 * 1024 + 1, 0x20),
      expected,
    }),
    /bounded Buffer/u,
  );
  assert.throws(
    () => verifyG17NativeWorkspaceOwnerArtifact({
      bytes: bytes(owner),
      expected: { ...expected, surplus: true },
    }),
    /fields are not exact/u,
  );
  const surplus = structuredClone(owner);
  surplus.surplus = true;
  assert.throws(
    () => verifyG17NativeWorkspaceOwnerArtifact({ bytes: bytes(surplus), expected }),
    /fields are not exact/u,
  );
});

test("workspace-owner replay rejects externally reanchored binding drift", () => {
  const { owner, expected } = fixture();
  owner.binding.platformManifestSha256 = digest("0");
  owner.projection.binding.platformManifestSha256 = digest("0");
  owner.verification.bindingSha256 = canonicalSha256(owner.binding);
  rehash(owner);
  assert.throws(
    () => verifyG17NativeWorkspaceOwnerArtifact({ bytes: bytes(owner), expected }),
    /external expected anchors/u,
  );
});

test("workspace-owner replay rejects semantically rehashed source and dependency drift", () => {
  const cases = [
    {
      label: "empty required root Gitlink policy",
      mutate(owner) {
        owner.source.requiredGitlinks = [];
      },
      pattern: /required root Gitlink identities/u,
    },
    {
      label: "substituted required root Gitlink identity",
      mutate(owner) {
        owner.source.requiredGitlinks[0].commit = gitObject("0");
      },
      pattern: /required root Gitlink identities/u,
    },
    {
      label: "empty excluded root Gitlink policy",
      mutate(owner) {
        owner.source.excludedGitlinks = [];
      },
      pattern: /excluded root Gitlink identities/u,
    },
    {
      label: "substituted excluded root Gitlink identity",
      mutate(owner) {
        owner.source.excludedGitlinks[0].commit = gitObject("0");
      },
      pattern: /excluded root Gitlink identities/u,
    },
    {
      label: "Cargo.lock bytes detached from their Git and digest anchors",
      mutate(owner) {
        const lock = Buffer.from(owner.source.cargoLock.base64, "base64");
        lock[0] ^= 0x01;
        owner.source.cargoLock.base64 = lock.toString("base64");
      },
      pattern: /does not replay to its Git and external bindings/u,
    },
    {
      label: "self-rehashed package set detached from Cargo.lock",
      mutate(owner) {
        owner.dependencies.packages[0].name = "other";
      },
      pattern: /externally bound Cargo\.lock bytes/u,
    },
    {
      label: "escaping source symlink",
      mutate(owner) {
        owner.source.symlinks[0].target = "../outside";
        owner.source.symlinks[0].gitBlob = gitBlobSha1(Buffer.from("../outside"));
      },
      pattern: /escapes the source root/u,
    },
    {
      label: "archive not bound to lock",
      mutate(owner) {
        owner.dependencies.archives.records[0].archiveName = "other.crate";
      },
      pattern: /differs from its locked package/u,
    },
    {
      label: "sparse traversal",
      mutate(owner) {
        owner.dependencies.sparseBootstrap.records[0].path = "../demo";
      },
      pattern: /confined portable relative path/u,
    },
    {
      label: "vendor checksum traversal",
      mutate(owner) {
        owner.dependencies.vendorChecksums.packages[0].files[0].path = "../secret";
      },
      pattern: /confined portable relative path/u,
    },
    {
      label: "metadata host path",
      mutate(owner) {
        owner.dependencies.metadata.packages[0].manifestPath = "/home/user/Cargo.toml";
      },
      pattern: /logical root allowlist/u,
    },
    {
      label: "Cargo program authority",
      mutate(owner) {
        owner.dependencies.vendorCommand.program = "/usr/bin/cargo";
      },
      pattern: /offline Cargo process contract/u,
    },
    {
      label: "Rust compiler authority",
      mutate(owner) {
        owner.dependencies.metadataCommand.environment.RUSTC = "/usr/bin/rustc";
      },
      pattern: /offline Cargo process contract/u,
    },
    {
      label: "vendor before-after drift",
      mutate(owner) {
        owner.dependencies.vendor.afterSha256 = digest("0");
      },
      pattern: /vendor filesystem summary/u,
    },
  ];

  for (const { label, mutate, pattern } of cases) {
    const { owner, expected } = fixture();
    mutate(owner);
    rehash(owner);
    assert.throws(
      () => verifyG17NativeWorkspaceOwnerArtifact({ bytes: bytes(owner), expected }),
      pattern,
      label,
    );
  }
});

test("pure replay anchors Git identities while filesystem manifests remain producer attestations", () => {
  const { owner, expected } = fixture();
  const substitutedManifest = digest("0");
  owner.source.requiredGitlinks[0].manifestSha256 = substitutedManifest;
  owner.source.manifestSha256 = substitutedManifest;
  owner.source.beforeSha256 = substitutedManifest;
  owner.source.afterSha256 = substitutedManifest;
  owner.verification.source.beforeSha256 = substitutedManifest;
  owner.verification.source.afterSha256 = substitutedManifest;
  rehash(owner);

  const verified = verifyG17NativeWorkspaceOwnerArtifact({
    bytes: bytes(owner),
    expected,
  });
  assert.equal(verified.owner.source.manifestSha256, substitutedManifest);
  assert.deepEqual(
    verified.owner.source.requiredGitlinks.map(({ path, commit, tree }) => ({
      path,
      commit,
      tree,
    })),
    G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS,
  );
  assert.equal(verified.owner.source.commit, expected.subjectCommit);
  assert.equal(verified.owner.source.tree, expected.subjectTree);
});

test("workspace-owner replay independently rejects verification and projection drift", () => {
  {
    const { owner, expected } = fixture();
    owner.verification.phase = "after-preparation";
    rehash(owner);
    assert.throws(
      () => verifyG17NativeWorkspaceOwnerArtifact({ bytes: bytes(owner), expected }),
      /verification replay drifted/u,
    );
  }
  {
    const { owner, expected } = fixture();
    rehash(owner);
    owner.projection.dependencies.archiveBytes += 1;
    owner.projection.sha256 = canonicalSha256(
      Object.fromEntries(
        Object.entries(owner.projection).filter(([key]) => key !== "sha256"),
      ),
    );
    owner.sha256 = canonicalSha256(
      Object.fromEntries(Object.entries(owner).filter(([key]) => key !== "sha256")),
    );
    assert.throws(
      () => verifyG17NativeWorkspaceOwnerArtifact({ bytes: bytes(owner), expected }),
      /independently replay/u,
    );
  }
  {
    const { owner, expected } = fixture();
    owner.sha256 = digest("0");
    assert.throws(
      () => verifyG17NativeWorkspaceOwnerArtifact({ bytes: bytes(owner), expected }),
      /owner hash replay drifted/u,
    );
  }
});

test("workspace-owner verifier has no live-producer or host-execution imports", async () => {
  const source = await readFile(
    new URL("../src/qualification/native-workspace-contract.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "native-workspace.mjs",
    "native-platform.mjs",
    "identity.mjs",
    "application-evidence.mjs",
    "runner.mjs",
    "receipt.mjs",
    "node:fs",
    "node:child_process",
  ]) {
    assert.doesNotMatch(source, new RegExp(`from [\"'].*${forbidden.replace(".", "\\.")}`, "u"));
  }
});
