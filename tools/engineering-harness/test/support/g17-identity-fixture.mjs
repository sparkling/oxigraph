import { canonicalSha256 } from "../../src/routing/features.mjs";

const digest = (character) => character.repeat(64);
const objectId = (character) => character.repeat(40);

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
  subjectCommit = objectId("a"),
  dependencies = defaultDependencies(),
  cargoVersion = "cargo 1.91.0",
  rustcVersion = "rustc 1.91.0\nhost: x86_64-unknown-linux-gnu",
} = {}) {
  const controlBinding = {
    controlCommit: subjectCommit,
    harnessTree: objectId("c"),
    harnessManifestSha256: digest("d"),
    manifestSha256: digest("e"),
    lockfileSha256: digest("f"),
    npmrcSha256: digest("1"),
    dependencies: structuredClone(dependencies),
  };
  const binding = {
    schema: "oxigraph.g1.7-qualified-subject-identity/v1",
    subject: {
      commit: subjectCommit,
      tree: objectId("b"),
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
    cargoLock: { blob: objectId("7"), sha256: digest("8") },
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
