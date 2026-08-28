import { canonicalSha256 } from "../../src/routing/features.mjs";

const digest = (character) => character.repeat(64);
const objectId = (character) => character.repeat(40);
const currentSubject = Object.freeze({
  commit: "e9d2db1b7c4eb974b406136e667e09ba06e34b48",
  tree: "fcc5bb75c469fbbf80f77bc330279d3a7c593bfe",
  cargoLockBlob: "763b2fedd24173c0b1d9f67e30fe3f971b4a2afd",
  cargoLockSha256:
    "587e4563371c9573d27732b1ed8d8b0c1392e0f12ceec6b38124fcb578dd5a75",
});
const descendantControlCommit = "285e6e4b96980f060b450ba96393c13ea5e5c5dd";

function defaultDependencies() {
  return [
    "@metaharness/avo",
    "@metaharness/darwin",
    "@metaharness/harness",
    "@metaharness/router",
    "metaharness",
  ].map((name, index) => ({
    name,
    policy: "latest",
    version: `1.0.${index}`,
    resolved: `https://registry.npmjs.org/${name}/-/fixture-${index}.tgz`,
    integrity: `sha512-fixture-${index}`,
    installedPackageJsonSha256: String(index + 1).repeat(64),
  }));
}

export function g17IdentityFixture({
  subjectCommit = currentSubject.commit,
  subjectTree = currentSubject.tree,
  controlCommit = descendantControlCommit,
  cargoLockBlob = currentSubject.cargoLockBlob,
  cargoLockSha256 = currentSubject.cargoLockSha256,
  dependencies = defaultDependencies(),
  cargoVersion = "cargo 1.91.0",
  rustcVersion = "rustc 1.91.0\nhost: x86_64-unknown-linux-gnu",
} = {}) {
  const controlBinding = {
    controlCommit,
    harnessTree: objectId("c"),
    harnessManifestSha256: digest("d"),
    manifestSha256: digest("e"),
    lockfileSha256: digest("f"),
    npmrcSha256: digest("1"),
    dependencies: structuredClone(dependencies),
  };
  const binding = {
    schema: "oxigraph.g1.7-qualified-subject-identity/v2",
    subject: {
      commit: subjectCommit,
      tree: subjectTree,
      trackedClean: true,
    },
    control: {
      ...controlBinding,
      harnessSha256: canonicalSha256({
        schema: "oxigraph.committed-harness-identity/v1",
        ...controlBinding,
      }),
    },
    evaluator: {
      commit: objectId("2"),
      parent: objectId("3"),
      tree: objectId("4"),
      patchSha256: digest("5"),
      blobSetSha256: digest("6"),
    },
    cargoLock: { blob: cargoLockBlob, sha256: cargoLockSha256 },
    toolchain: [
      {
        program: "cargo",
        invokedPath: "/opt/rust/bin/cargo",
        path: "/opt/rust/bin/rustup",
        executableSha256: digest("9"),
        toolchainPath: "/opt/rust/toolchains/stable/bin/cargo",
        toolchainExecutableSha256: digest("a"),
        versionStdout: cargoVersion,
      },
      {
        program: "rustc",
        invokedPath: "/opt/rust/bin/rustc",
        path: "/opt/rust/bin/rustup",
        executableSha256: digest("9"),
        toolchainPath: "/opt/rust/toolchains/stable/bin/rustc",
        toolchainExecutableSha256: digest("b"),
        versionStdout: rustcVersion,
      },
    ],
    host: {
      platform: "linux",
      kernelRelease: "fixture",
      architecture: "x64",
      targetTriple: "x86_64-unknown-linux-gnu",
      cpuModel: "fixture",
      cpuCount: 1,
      totalMemoryBytes: 1,
    },
  };
  return { ...binding, identitySha256: canonicalSha256(binding) };
}
