import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
  createG17NativeApplicationVerifierForTesting,
  verifyG17NativeApplicationEvidence,
} from "../src/qualification/native-application-contract.mjs";
import { g17IdentityFixture } from "./support/g17-identity-fixture.mjs";
import { loadG17LegacyV4Contract } from "./support/g17-legacy-v4-contract-fixture.mjs";
import { createG17NativeApplicationFixture } from "./support/g17-native-application-fixture.mjs";

const digest = (character) => character.repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stream(text) {
  const bytes = Buffer.from(text, "utf8");
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function resealIdentity(identity) {
  const { harnessSha256: ignoredHarnessSha256, ...controlBinding } =
    identity.control;
  identity.control.harnessSha256 = canonicalSha256({
    schema: "oxigraph.committed-harness-identity/v1",
    ...controlBinding,
  });
  const { identitySha256: ignoredIdentitySha256, ...binding } = identity;
  identity.identitySha256 = canonicalSha256(binding);
  return identity;
}

function artifacts() {
  return G17_NATIVE_APPLICATION_ARTIFACT_NAMES.map((name) => ({
    name,
    bytes:
      name === "native-workspace-owner.json"
        ? canonicalBytes({ schema: "oxigraph.g1.7-native-workspace-owner/v2" })
        : name === "native-session.json"
          ? canonicalBytes({
              configuration: {
                requestedLimits: {
                  totalWallMs: 3_600_000,
                  residentBytes: 4_294_967_296,
                  diskBytes: 8_589_934_592,
                  cargoBuildJobs: 2,
                  tasksMax: 256,
                  memorySwapBytes: 0,
                },
              },
            })
          : Buffer.from(`${name}\n`, "utf8"),
  }));
}

function platform(identity) {
  const cargo = identity.toolchain.find(({ program }) => program === "cargo");
  const rustc = identity.toolchain.find(({ program }) => program === "rustc");
  return {
    schema: "oxigraph.g1.7-linux-native-platform-closure/v4",
    profile: "linux-x86_64-gnu-bundled-rocksdb/v1",
    subjectIdentitySha256: identity.identitySha256,
    manifestSha256: digest("1"),
    toolchainRootSha256: digest("2"),
    platformRootSha256: digest("3"),
    roles: {
      cargo: {
        root: "toolchain",
        path: "bin/cargo",
        kind: "file",
        sha256: cargo.toolchainExecutableSha256,
      },
      rustc: {
        root: "toolchain",
        path: "bin/rustc",
        kind: "file",
        sha256: rustc.toolchainExecutableSha256,
      },
    },
    probes: [
      {
        id: "cargo-version",
        program: "/toolchain/bin/cargo",
        stdout: stream(`${cargo.versionStdout}\n`),
        stderr: stream(""),
      },
      {
        id: "rust-version",
        program: "/toolchain/bin/rustc",
        stdout: stream(`${rustc.versionStdout}\n`),
        stderr: stream(""),
      },
    ],
  };
}

function boundWorkspaceProjection(expected) {
  const binding = {
    schema: "oxigraph.g1.7-native-workspace-binding/v1",
    subjectIdentitySha256: expected.subjectIdentitySha256,
    subjectCommit: expected.subjectCommit,
    subjectTree: expected.subjectTree,
    cargoLockBlob: expected.cargoLockBlob,
    cargoLockSha256: expected.cargoLockSha256,
    platformManifestSha256: expected.platformManifestSha256,
    toolchainRootSha256: expected.toolchainRootSha256,
    toolchain: {
      cargo: {
        logicalPath: "/toolchain/bin/cargo",
        ...expected.toolchain.cargo,
      },
      rustc: {
        logicalPath: "/toolchain/bin/rustc",
        ...expected.toolchain.rustc,
      },
    },
  };
  const base = {
    schema: "oxigraph.g1.7-native-workspace/v2",
    policy: "detached-committed-source-private-offline-vendor/v1",
    binding,
    source: { manifestSha256: digest("4") },
    dependencies: { snapshotSha256: digest("5") },
  };
  return { ...base, sha256: canonicalSha256(base) };
}

function verifierFixture({
  sessionWorkspaceSha256,
  instanceWorkspaceSha256,
  mutateIdentity,
  mutatePlatform,
} = {}) {
  const calls = [];
  const sealedContract = loadG17LegacyV4Contract();
  const identity = g17IdentityFixture();
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
  resealIdentity(identity);
  mutateIdentity?.(identity);
  const verifiedPlatform = platform(identity);
  mutatePlatform?.(verifiedPlatform);
  const policy = {
    schema: "oxigraph.g1.7-linux-native-isolation-policy/v4",
    sha256: digest("6"),
  };
  let observedWorkspaceExpected;
  let observedConfigurationInput;
  let sessionProjection;
  const dependencies = {
    verifyPlatformBundle(input) {
      calls.push("platform/source-plan/controller");
      assert.deepEqual(Object.keys(input), [
        "platformBytes",
        "sourcePlanBytes",
        "controllerBytes",
      ]);
      return {
        platform: verifiedPlatform,
        sourcePlan: { schema: "oxigraph.g1.7-native-platform-source-plan/v1" },
        sourcePlanProjectionSha256: digest("7"),
        controller: { schema: "oxigraph.g1.7-native-controller-closure/v1" },
      };
    },
    verifyWorkspaceOwnerArtifact({ bytes, expected }) {
      calls.push("workspace-owner");
      observedWorkspaceExpected = expected;
      const projection = boundWorkspaceProjection(expected);
      return {
        owner: { schema: "oxigraph.g1.7-native-workspace-owner/v2" },
        projection,
        artifact: {
          name: "native-workspace-owner.json",
          bytes: Buffer.from(bytes),
          sha256: sha256(bytes),
        },
      };
    },
    verifyPolicyArtifact() {
      calls.push("policy");
      return policy;
    },
    createSessionConfiguration(input) {
      calls.push("session-configuration");
      observedConfigurationInput = input;
      return {
        runId: input.runId,
        requestedLimits: input.requestedLimits,
        bindings: {
          contractSha256: input.contractSha256,
          platformManifestSha256: input.platform.manifestSha256,
          policySha256: input.policy.sha256,
          workspaceProjectionSha256: input.workspaceProjectionSha256,
        },
      };
    },
    verifySessionArtifact({ bytes, expectedConfiguration }) {
      calls.push("session");
      sessionProjection = {
        schema: "oxigraph.g1.7-native-session-projection/v2",
        status: "PASS",
        runId: expectedConfiguration.runId,
        bindings: {
          ...expectedConfiguration.bindings,
          workspaceProjectionSha256:
            sessionWorkspaceSha256 ??
            expectedConfiguration.bindings.workspaceProjectionSha256,
        },
        artifact: {
          name: "native-session.json",
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
        commandsObserved: 6,
        lanes: [
          {
            id: "transaction-compatibility",
            status: "PASS",
            observedPassedTests: 20,
          },
        ],
        totalPassedTests: 23,
        stateBytes: 4_096,
        durationMs: 30,
        reason: null,
        finalDescendantsObserved: 0,
        effectiveIsolation: { normalizedMountTopologyObserved: true },
      };
      return sessionProjection;
    },
    verifyInstanceArtifact({ bytes, workspaceProjectionSha256, sessionBytes }) {
      calls.push("instance");
      const base = {
        schema: "oxigraph.g1.7-linux-native-isolation-instance/v5",
        runId: "application-contract-fixture",
        policySha256: policy.sha256,
        platformManifestSha256: verifiedPlatform.manifestSha256,
        workspaceProjectionSha256:
          instanceWorkspaceSha256 ?? workspaceProjectionSha256,
        sessionArtifact: {
          name: "native-session.json",
          bytes: sessionBytes.length,
          sha256: sha256(sessionBytes),
        },
        sessionProjectionSha256: canonicalSha256(sessionProjection),
        effectiveObservations: {
          normalizedMountTopologyObserved: true,
          cgroupMembershipMatched: true,
        },
        suppliedInstanceBytes: bytes.length,
      };
      return { ...base, sha256: canonicalSha256(base) };
    },
  };
  const contractBytes = Buffer.from(sealedContract.bytes);
  const input = {
    artifacts: artifacts(),
    identity,
    contractBytes,
    contractSha256: sealedContract.contractSha256,
    runId: "application-contract-fixture",
  };
  return {
    calls,
    dependencies,
    input,
    get observedWorkspaceExpected() {
      return observedWorkspaceExpected;
    },
    get observedConfigurationInput() {
      return observedConfigurationInput;
    },
  };
}

test("seven-artifact composite derives one frozen current compatibility projection", () => {
  const fixture = verifierFixture();
  const verify = createG17NativeApplicationVerifierForTesting(
    fixture.dependencies,
  );
  const projection = verify(fixture.input);

  assert.deepEqual(fixture.calls, [
    "platform/source-plan/controller",
    "workspace-owner",
    "policy",
    "session-configuration",
    "session",
    "instance",
  ]);
  assert.equal(projection.schema, G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA);
  assert.equal(
    projection.schema,
    "oxigraph.g1.7-native-compatibility-projection/v2",
  );
  assert.equal(projection.status, "PASS");
  assert.deepEqual(
    projection.artifacts.map(({ name }) => name),
    G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  );
  assert.ok(
    projection.artifacts.every(
      ({ bytes, sha256: hash }) =>
        Number.isSafeInteger(bytes) && /^[0-9a-f]{64}$/u.test(hash),
    ),
  );
  assert.deepEqual(projection.ownerArtifact, projection.artifacts[3]);
  assert.equal(
    projection.workspace.schema,
    "oxigraph.g1.7-native-workspace/v2",
  );
  assert.deepEqual(projection.lanes, projection.session.lanes);
  assert.equal(
    projection.totalPassedTests,
    projection.session.totalPassedTests,
  );
  assert.equal(projection.session.status, "PASS");
  assert.equal(
    projection.isolation.schema,
    "oxigraph.g1.7-linux-native-isolation-instance/v5",
  );
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.artifacts), true);
  assert.equal(
    Object.isFrozen(projection.workspace.binding.toolchain.cargo),
    true,
  );
  assert.doesNotMatch(
    canonicalJson(projection),
    /\/opt\/rust|versionStdout|stdoutBase64|stderrBase64|launchAttestationBase64/u,
  );

  const cargo = fixture.input.identity.toolchain[0];
  assert.deepEqual(fixture.observedWorkspaceExpected.toolchain.cargo, {
    executableSha256: cargo.toolchainExecutableSha256,
    versionSha256: sha256(Buffer.from(cargo.versionStdout, "utf8")),
  });
  assert.equal(
    fixture.observedWorkspaceExpected.platformManifestSha256,
    projection.platform.manifestSha256,
  );
  assert.equal(
    fixture.observedConfigurationInput.workspaceProjectionSha256,
    projection.workspace.sha256,
  );
});

test("production composite replays seven canonical artifacts without raw evidence leaks", () => {
  const fixture = createG17NativeApplicationFixture();
  const projection = verifyG17NativeApplicationEvidence(fixture.input);
  const serialized = canonicalJson(projection);

  assert.equal(projection.schema, G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA);
  assert.equal(projection.status, "PASS");
  assert.deepEqual(
    projection.artifacts.map(({ name }) => name),
    G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  );
  assert.deepEqual(projection.ownerArtifact, projection.artifacts[3]);
  assert.equal(projection.session.commandsObserved, 6);
  assert.equal(
    projection.isolation.effectiveObservations.normalizedMountTopologyObserved,
    true,
  );
  assert.equal(Object.isFrozen(projection), true);
  assert.doesNotMatch(
    serialized,
    /"(?:base64|stdoutBase64|stderrBase64|launchAttestationBase64|versionStdout)"/u,
  );
  assert.doesNotMatch(serialized, /(?:cargo|rustc) 1\.96\.0/u);
  for (const forbidden of fixture.forbiddenProjectionText) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      forbidden.slice(0, 120),
    );
  }
});

test("production composite rejects an evaluator outside the reviewed contract", () => {
  const fixture = createG17NativeApplicationFixture();
  fixture.input.identity.evaluator.commit = "f".repeat(40);
  resealIdentity(fixture.input.identity);

  assert.throws(
    () => verifyG17NativeApplicationEvidence(fixture.input),
    /sealed evaluator differs from the reviewed contract/u,
  );
});

test("production composite snapshots artifact accessors exactly once", () => {
  const fixture = createG17NativeApplicationFixture();
  const platformArtifact = fixture.input.artifacts[0];
  const suppliedBytes = platformArtifact.bytes;
  const replayedBytes = Buffer.from(suppliedBytes);
  const substitutedBytes = Buffer.from(
    "different-unverified-platform-artifact\n",
    "utf8",
  );
  let nameReads = 0;
  let byteReads = 0;
  fixture.input.artifacts[0] = {
    get name() {
      nameReads += 1;
      return nameReads === 1
        ? platformArtifact.name
        : "substituted-platform.json";
    },
    get bytes() {
      byteReads += 1;
      return byteReads === 1 ? suppliedBytes : substitutedBytes;
    },
  };

  const projection = verifyG17NativeApplicationEvidence(fixture.input);
  suppliedBytes.fill(0);
  substitutedBytes.fill(0);

  assert.equal(projection.status, "PASS");
  assert.equal(nameReads, 1);
  assert.equal(byteReads, 1);
  assert.deepEqual(projection.artifacts[0], {
    name: platformArtifact.name,
    bytes: replayedBytes.length,
    sha256: sha256(replayedBytes),
  });
});

test("production composite snapshots top-level and nested authority exactly once", () => {
  const fixture = createG17NativeApplicationFixture();
  const suppliedArtifacts = fixture.input.artifacts;
  const suppliedIdentity = fixture.input.identity;
  const suppliedContractBytes = fixture.input.contractBytes;
  const contractSha256 = fixture.input.contractSha256;
  const runId = fixture.input.runId;
  const subjectCommit = suppliedIdentity.subject.commit;
  const reads = {
    artifacts: 0,
    identity: 0,
    contractBytes: 0,
    contractSha256: 0,
    runId: 0,
    subjectCommit: 0,
  };
  Object.defineProperty(suppliedIdentity.subject, "commit", {
    configurable: true,
    enumerable: true,
    get() {
      reads.subjectCommit += 1;
      return reads.subjectCommit === 1 ? subjectCommit : "f".repeat(40);
    },
  });
  const input = {};
  Object.defineProperties(input, {
    artifacts: {
      enumerable: true,
      get() {
        reads.artifacts += 1;
        return reads.artifacts === 1 ? suppliedArtifacts : [];
      },
    },
    identity: {
      enumerable: true,
      get() {
        reads.identity += 1;
        return reads.identity === 1 ? suppliedIdentity : {};
      },
    },
    contractBytes: {
      enumerable: true,
      get() {
        reads.contractBytes += 1;
        return reads.contractBytes === 1
          ? suppliedContractBytes
          : Buffer.from("substituted-contract\n", "utf8");
      },
    },
    contractSha256: {
      enumerable: true,
      get() {
        reads.contractSha256 += 1;
        return reads.contractSha256 === 1 ? contractSha256 : digest("f");
      },
    },
    runId: {
      enumerable: true,
      get() {
        reads.runId += 1;
        return reads.runId === 1 ? runId : "substituted-final-run";
      },
    },
  });

  const projection = verifyG17NativeApplicationEvidence(input);
  suppliedContractBytes.fill(0);
  suppliedArtifacts.splice(0);

  assert.equal(projection.status, "PASS");
  assert.deepEqual(reads, {
    artifacts: 1,
    identity: 1,
    contractBytes: 1,
    contractSha256: 1,
    runId: 1,
    subjectCommit: 1,
  });
  assert.equal(projection.runId, runId);
  assert.equal(projection.contractSha256, contractSha256);
  assert.equal(
    projection.subjectIdentitySha256,
    suppliedIdentity.identitySha256,
  );
  assert.equal(
    projection.artifacts.length,
    G17_NATIVE_APPLICATION_ARTIFACT_NAMES.length,
  );
});

test("seven-artifact composite rejects missing, extra, reordered, and renamed inventory", () => {
  for (const mutate of [
    (value) => {
      value.artifacts.pop();
    },
    (value) => {
      value.artifacts.push({ name: "extra.json", bytes: Buffer.from("extra") });
    },
    (value) => {
      [value.artifacts[0], value.artifacts[1]] = [
        value.artifacts[1],
        value.artifacts[0],
      ];
    },
    (value) => {
      value.artifacts[3].name = "native-compatibility-owner.json";
    },
    (value) => {
      value.artifacts[0].sha256 = digest("f");
    },
  ]) {
    const fixture = verifierFixture();
    mutate(fixture.input);
    const verify = createG17NativeApplicationVerifierForTesting(
      fixture.dependencies,
    );
    assert.throws(
      () => verify(fixture.input),
      /artifact|inventory|fields are not exact/u,
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test("seven-artifact composite rejects v1 and legacy workspace-owner substitution", () => {
  for (const schema of [
    "oxigraph.g1.7-native-workspace-owner/v1",
    "oxigraph.g1.7-native-compatibility-owner/v1",
  ]) {
    const fixture = verifierFixture();
    fixture.input.artifacts[3].bytes = canonicalBytes({ schema });
    const verify = createG17NativeApplicationVerifierForTesting(
      fixture.dependencies,
    );
    assert.throws(() => verify(fixture.input), /current v2 owner schema/u);
    assert.deepEqual(fixture.calls, ["platform/source-plan/controller"]);
  }
});

test("seven-artifact composite rejects workspace hash drift in session and instance", () => {
  for (const options of [
    { sessionWorkspaceSha256: digest("a") },
    { instanceWorkspaceSha256: digest("b") },
  ]) {
    const fixture = verifierFixture(options);
    const verify = createG17NativeApplicationVerifierForTesting(
      fixture.dependencies,
    );
    assert.throws(
      () => verify(fixture.input),
      /(?:native session replay|isolation instance replay)/u,
    );
  }
});

test("seven-artifact composite derives tool anchors from both identity and platform", () => {
  for (const mutatePlatform of [
    (value) => {
      value.roles.cargo.sha256 = digest("c");
    },
    (value) => {
      value.probes[1].stdout = stream("invented rustc version\n");
    },
  ]) {
    const fixture = verifierFixture({ mutatePlatform });
    const verify = createG17NativeApplicationVerifierForTesting(
      fixture.dependencies,
    );
    assert.throws(
      () => verify(fixture.input),
      /verified platform (?:cargo role|rustc version)/u,
    );
    assert.deepEqual(fixture.calls, ["platform/source-plan/controller"]);
  }
});

test("seven-artifact composite rejects coherently rehashed malformed sealed identities", () => {
  for (const [label, mutateIdentity, pattern] of [
    [
      "evaluator contract relation",
      (identity) => {
        identity.evaluator.commit = "f".repeat(40);
        resealIdentity(identity);
      },
      /sealed evaluator differs from the reviewed contract/u,
    ],
    [
      "control-subject relation",
      (identity) => {
        identity.control.controlCommit = "f".repeat(40);
        resealIdentity(identity);
      },
      /subject, control, evaluator, or Cargo\.lock binding/u,
    ],
    [
      "dependency policy",
      (identity) => {
        identity.control.dependencies[0].policy = "pinned";
        resealIdentity(identity);
      },
      /dependency .* binding is invalid/u,
    ],
    [
      "dependency ordering",
      (identity) => {
        [identity.control.dependencies[0], identity.control.dependencies[1]] = [
          identity.control.dependencies[1],
          identity.control.dependencies[0],
        ];
        resealIdentity(identity);
      },
      /dependency .* binding is invalid/u,
    ],
    [
      "empty dependency inventory",
      (identity) => {
        identity.control.dependencies = [];
        resealIdentity(identity);
      },
      /dependency inventory is not bounded/u,
    ],
    [
      "dependency text bound",
      (identity) => {
        identity.control.dependencies[0].resolved = "";
        resealIdentity(identity);
      },
      /dependency resolved is not bounded text/u,
    ],
    [
      "evaluator object",
      (identity) => {
        identity.evaluator.commit = "not-a-git-object";
        resealIdentity(identity);
      },
      /subject, control, evaluator, or Cargo\.lock binding/u,
    ],
    [
      "host capacity",
      (identity) => {
        identity.host.cpuCount = 0;
        resealIdentity(identity);
      },
      /host capacity/u,
    ],
    [
      "host text bound",
      (identity) => {
        identity.host.cpuModel = "";
        resealIdentity(identity);
      },
      /host cpuModel is not bounded text/u,
    ],
    [
      "tool path",
      (identity) => {
        identity.toolchain[0].toolchainPath = "/opt/rust/../escaped/cargo";
        resealIdentity(identity);
      },
      /canonical absolute path/u,
    ],
    [
      "tool executable digest",
      (identity) => {
        identity.toolchain[0].executableSha256 = "not-a-digest";
        resealIdentity(identity);
      },
      /tool binding is invalid/u,
    ],
    [
      "control digest field",
      (identity) => {
        identity.control.manifestSha256 = "not-a-digest";
        resealIdentity(identity);
      },
      /subject, control, evaluator, or Cargo\.lock binding/u,
    ],
    [
      "control field inventory",
      (identity) => {
        identity.control.surplus = true;
        resealIdentity(identity);
      },
      /sealed control fields are not exact/u,
    ],
  ]) {
    const fixture = verifierFixture({ mutateIdentity });
    const verify = createG17NativeApplicationVerifierForTesting(
      fixture.dependencies,
    );
    assert.throws(() => verify(fixture.input), pattern, label);
    assert.deepEqual(fixture.calls, [], label);
  }
});

test("native application composite imports only pure replay contracts", async () => {
  const source = await readFile(
    new URL(
      "../src/qualification/native-application-contract.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const forbidden of [
    '"node:child_process"',
    '"node:fs"',
    '"node:fs/promises"',
    '"node:os"',
    '"./application-evidence.mjs"',
    '"./identity.mjs"',
    '"node:process"',
    '"./native-platform.mjs"',
    '"./native-workspace.mjs"',
    '"./runner.mjs"',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const workspaceAnchorDerivation = source.slice(
    source.indexOf("function deriveWorkspaceExpected"),
    source.indexOf("function artifactInventory"),
  );
  assert.equal(
    [...workspaceAnchorDerivation.matchAll(/^\s*toolchainRootSha256:/gmu)]
      .length,
    1,
  );
  assert.equal(typeof verifyG17NativeApplicationEvidence, "function");
});
