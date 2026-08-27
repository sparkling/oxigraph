import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  G17_NATIVE_SESSION_ARTIFACT_NAME,
  G17_NATIVE_SESSION_CONFIGURATION_SCHEMA,
  createG17NativeSessionArtifactForTesting,
  createG17NativeSessionConfiguration,
  g17NativeSessionCommands,
  g17NativeSessionEnvironment,
  verifyG17NativeSessionArtifact,
} from "../src/qualification/native-session-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  syntheticG17CommandRecord,
  syntheticG17Isolation,
} from "./support/g17-native-session-fixture.mjs";

const digest = (character) => character.repeat(64);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function platformBinding() {
  return {
    schema: "oxigraph.g1.7-linux-native-platform-closure/v4",
    manifestSha256: digest("a"),
    roles: {
      ar: { root: "platform", path: "usr/bin/x86_64-linux-gnu-ar" },
      cc: { root: "platform", path: "usr/bin/x86_64-linux-gnu-gcc-13" },
      cxx: { root: "platform", path: "usr/bin/x86_64-linux-gnu-g++-13" },
      libclang: {
        root: "platform",
        path: "usr/lib/llvm-18/lib/libclang-18.so.1",
      },
      rustc: { root: "toolchain", path: "bin/rustc" },
      rustfmt: { root: "toolchain", path: "bin/rustfmt" },
    },
  };
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

function configuration() {
  const sealedContract = loadG17Contract();
  return {
    sealedContract,
    value: createG17NativeSessionConfiguration({
      runId: "g17-native-session-fixture",
      contractBytes: sealedContract.bytes,
      contractSha256: sealedContract.contractSha256,
      platform: platformBinding(),
      policy: {
        schema: "oxigraph.g1.7-linux-native-isolation-policy/v4",
        sha256: digest("b"),
      },
      workspaceProjectionSha256: digest("c"),
      requestedLimits: requestedLimits(sealedContract.contract),
    }),
  };
}

function completedSession(configuration, contract) {
  return {
    status: "completed",
    stage: "complete",
    commands: configuration.commands.map((command, index) => {
      const lane = contract.compatibility.native[Math.floor(index / 2)];
      return index % 2 === 0
        ? syntheticG17CommandRecord(
            configuration,
            command,
            index,
            `${lane.expectedTestIds.map((id) => `${id}: test`).join("\n")}\n`,
          )
        : syntheticG17CommandRecord(
            configuration,
            command,
            index,
            `test result: ok. ${lane.expectedPassedTests} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n`,
          );
    }),
    stateBytes: 4_096,
    durationMs: 30,
    error: null,
    finalDescendantsObserved: 0,
    isolation: syntheticG17Isolation(configuration),
  };
}

function rawRecord(bytes) {
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function rewriteLaunchAttestation(value, index, mutate) {
  const command = value.commands[index];
  const attestation = JSON.parse(
    Buffer.from(command.launchAttestationBase64, "base64"),
  );
  mutate(attestation);
  const bytes = Buffer.from(`${canonicalJson(attestation)}\n`, "utf8");
  command.launchAttestationBase64 = bytes.toString("base64");
  command.launchAttestationSha256 = sha256(bytes);
}

test("native session configuration is derived exactly from contract v3 and platform v4", () => {
  const sealedContract = loadG17Contract();
  const platform = platformBinding();
  const policy = {
    schema: "oxigraph.g1.7-linux-native-isolation-policy/v4",
    sha256: digest("b"),
  };
  const limits = requestedLimits(sealedContract.contract);
  const commands = g17NativeSessionCommands({
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });

  assert.equal(commands.length, 6);
  assert.deepEqual(
    commands.map(({ name }) => name),
    [
      "inventory:transaction-compatibility",
      "execution:transaction-compatibility",
      "inventory:bulk-sst-writer-serialization",
      "execution:bulk-sst-writer-serialization",
      "inventory:update-atomicity",
      "execution:update-atomicity",
    ],
  );
  for (const [index, command] of commands.entries()) {
    assert.equal(command.argv[0], "cargo");
    assert.equal(command.argv.filter((value) => value === "--target-dir").length, 1);
    assert.equal(
      command.argv[command.argv.indexOf("--target-dir") + 1],
      "/state/target",
    );
    assert.equal(command.argv.includes("--locked"), true);
    assert.equal(command.argv.includes("--offline"), true);
    assert.equal(command.name.startsWith(index % 2 === 0 ? "inventory:" : "execution:"), true);
  }

  const environment = g17NativeSessionEnvironment(platform, limits.cargoBuildJobs);
  assert.equal(environment.CC, "/usr/bin/x86_64-linux-gnu-gcc-13");
  assert.equal(environment.CXX, "/usr/bin/x86_64-linux-gnu-g++-13");
  assert.equal(environment.AR, "/usr/bin/x86_64-linux-gnu-ar");
  assert.equal(environment.LIBCLANG_PATH, "/usr/lib/llvm-18/lib");
  assert.equal(environment.PATH, "/toolchain/bin:/usr/bin");

  const configuration = createG17NativeSessionConfiguration({
    runId: "g17-native-session-fixture",
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
    platform,
    policy,
    workspaceProjectionSha256: digest("c"),
    requestedLimits: limits,
  });
  assert.equal(configuration.schema, G17_NATIVE_SESSION_CONFIGURATION_SCHEMA);
  assert.deepEqual(configuration.commands, commands);
  assert.deepEqual(configuration.environment, environment);
  assert.deepEqual(configuration.requestedLimits, limits);
  assert.equal(configuration.bindings.contractSha256, sealedContract.contractSha256);
  assert.equal(configuration.bindings.platformManifestSha256, platform.manifestSha256);
  assert.equal(configuration.bindings.policySha256, policy.sha256);
  assert.equal(configuration.bindings.workspaceProjectionSha256, digest("c"));
  assert.equal(configuration.bindings.environmentSha256, canonicalSha256(environment));
  assert.equal(configuration.bindings.logicalArgvSha256, canonicalSha256(commands));
  assert.equal(configuration.bindings.requestedLimitsSha256, canonicalSha256(limits));
  assert.ok(configuration.maxResultBytes > 65_536);
  assert.ok(configuration.maxResultBytes <= 16 * 1024 * 1024);
});

test("native session configuration rejects drift from the reviewed contract", () => {
  const sealedContract = loadG17Contract();
  const platform = platformBinding();
  const policy = {
    schema: "oxigraph.g1.7-linux-native-isolation-policy/v4",
    sha256: digest("b"),
  };
  const limits = requestedLimits(sealedContract.contract);
  for (const mutate of [
    (input) => { input.contractSha256 = digest("d"); },
    (input) => {
      input.contractBytes = Buffer.from(input.contractBytes);
      input.contractBytes[0] ^= 1;
    },
    (input) => { input.platform.manifestSha256 = "not-a-digest"; },
    (input) => { input.policy.schema = "oxigraph.g1.7-linux-native-isolation-policy/v1"; },
    (input) => { input.requestedLimits.cargoBuildJobs += 1; },
    (input) => { input.workspaceProjectionSha256 = "not-a-digest"; },
  ]) {
    const input = {
      runId: "g17-native-session-fixture",
      contractBytes: sealedContract.bytes,
      contractSha256: sealedContract.contractSha256,
      platform: structuredClone(platform),
      policy: structuredClone(policy),
      workspaceProjectionSha256: digest("c"),
      requestedLimits: structuredClone(limits),
    };
    mutate(input);
    assert.throws(
      () => createG17NativeSessionConfiguration(input),
      /G1\.7 native session contract/u,
    );
  }
});

test("native session replay stays process- and filesystem-free", async () => {
  const source = await readFile(
    new URL("../src/qualification/native-session-contract.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    '"node:child_process"',
    '"node:fs"',
    '"node:fs/promises"',
    '"./contained-session.mjs"',
    '"./contract.mjs"',
    '"./native-platform.mjs"',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("native session artifact independently replays all six raw Cargo records", () => {
  const { sealedContract, value: expectedConfiguration } = configuration();
  const created = createG17NativeSessionArtifactForTesting({
    configuration: expectedConfiguration,
    session: completedSession(expectedConfiguration, sealedContract.contract),
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  assert.equal(created.artifact.name, G17_NATIVE_SESSION_ARTIFACT_NAME);
  assert.equal(created.projection.status, "PASS");
  assert.equal(created.projection.totalPassedTests, 23);
  assert.deepEqual(
    created.projection.lanes.map(({ id, observedPassedTests }) => ({
      id,
      observedPassedTests,
    })),
    [
      { id: "transaction-compatibility", observedPassedTests: 20 },
      { id: "bulk-sst-writer-serialization", observedPassedTests: 1 },
      { id: "update-atomicity", observedPassedTests: 2 },
    ],
  );
  assert.deepEqual(
    verifyG17NativeSessionArtifact({
      bytes: created.artifact.bytes,
      expectedConfiguration,
      contractBytes: sealedContract.bytes,
      contractSha256: sealedContract.contractSha256,
    }),
    created.projection,
  );

  const mutable = created.artifact.bytes;
  mutable.fill(0);
  assert.deepEqual(
    verifyG17NativeSessionArtifact({
      bytes: created.artifact.bytes,
      expectedConfiguration,
      contractBytes: sealedContract.bytes,
      contractSha256: sealedContract.contractSha256,
    }),
    created.projection,
  );
});

test("native session replay rejects canonical rehashing of command and binding lies", () => {
  const { sealedContract, value: expectedConfiguration } = configuration();
  const created = createG17NativeSessionArtifactForTesting({
    configuration: expectedConfiguration,
    session: completedSession(expectedConfiguration, sealedContract.contract),
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  for (const mutate of [
    (value) => { value.configuration.bindings.platformManifestSha256 = digest("e"); },
    (value) => { value.commands.reverse(); },
    (value) => { value.durationMs = 1; },
    (value) => {
      const stdout = Buffer.from("invented_test: test\n", "utf8");
      value.commands[0].stdoutBase64 = stdout.toString("base64");
      value.commands[0].stdoutSha256 = sha256(stdout);
    },
    (value) => { value.commands[1].descendantsObserved = 1; },
    (value) => {
      value.commands[0].exitCode = null;
      value.commands[0].signal = "SIGFAKE";
    },
  ]) {
    const value = JSON.parse(created.artifact.bytes);
    mutate(value);
    const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    assert.throws(
      () => verifyG17NativeSessionArtifact({
        bytes,
        expectedConfiguration,
        contractBytes: sealedContract.bytes,
        contractSha256: sealedContract.contractSha256,
      }),
      /G1\.7 native session contract/u,
    );
  }
  assert.throws(
    () => verifyG17NativeSessionArtifact({
      bytes: Buffer.from(JSON.stringify(JSON.parse(created.artifact.bytes)), "utf8"),
      expectedConfiguration,
      contractBytes: sealedContract.bytes,
      contractSha256: sealedContract.contractSha256,
    }),
    /canonical/u,
  );
});

test("native session replay rejects coherently rehashed isolation and launch lies", () => {
  const { sealedContract, value: expectedConfiguration } = configuration();
  const created = createG17NativeSessionArtifactForTesting({
    configuration: expectedConfiguration,
    session: completedSession(expectedConfiguration, sealedContract.contract),
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  for (const mutate of [
    (value) => {
      const text = Buffer.from(
        value.isolation.afterCommands.mountinfoBase64,
        "base64",
      ).toString("utf8");
      value.isolation.afterCommands.mountinfoBase64 = Buffer.from(
        text.replace("/workspace ro", "/workspace rw"),
        "utf8",
      ).toString("base64");
    },
    (value) => {
      for (const observation of [
        value.isolation.beforeCommands,
        value.isolation.afterCommands,
      ]) {
        const mountinfo = Buffer.from(observation.mountinfoBase64, "base64")
          .toString("utf8");
        observation.mountinfoBase64 = Buffer.from(
          `${mountinfo}99 8 8:1 / /state/escape rw - ext4 host rw\n`,
          "utf8",
        ).toString("base64");
      }
    },
    (value) => {
      value.isolation.afterCommands.cgroupFiles.memoryMaxBase64 = Buffer.from(
        "1\n",
        "utf8",
      ).toString("base64");
    },
    (value) => { value.isolation.stateAfter.anchors[0].owner = "1"; },
    (value) => {
      value.isolation.stateBefore.anchors[0].mountId = "99";
      value.isolation.stateAfter.anchors[0].mountId = "99";
    },
    (value) => {
      for (const observation of [
        value.isolation.beforeCommands,
        value.isolation.afterCommands,
      ]) {
        const status = Buffer.from(observation.statusBase64, "base64")
          .toString("utf8")
          .replace("Seccomp:\t0", "Seccomp:\t2")
          .replace("Seccomp_filters:\t0", "Seccomp_filters:\t1");
        observation.statusBase64 = Buffer.from(status, "utf8").toString("base64");
      }
    },
    (value) => {
      value.isolation.finalProcesses.push({
        pid: 99,
        statusBase64: Buffer.from("Pid:\t99\n", "utf8").toString("base64"),
      });
    },
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      const status = Buffer.from(attestation.status.base64, "base64")
        .toString("utf8")
        .replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001");
      attestation.status = rawRecord(Buffer.from(status, "utf8"));
    }),
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      const environment = Buffer.concat([
        Buffer.from(attestation.environ.base64, "base64"),
        Buffer.from("EXTRA_AUTHORITY=1\0", "utf8"),
      ]);
      attestation.environ = rawRecord(environment);
    }),
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      attestation.parentDeathSignal = 0;
    }),
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      attestation.negativeProbes[0].errno = 0;
    }),
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      attestation.negativeProbes[0].syscallNumber = 9_999;
    }),
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      attestation.negativeProbes.at(-1).errno = 0;
    }),
    (value) => rewriteLaunchAttestation(value, 0, (attestation) => {
      attestation.namespaces.network = "net:[999]";
    }),
  ]) {
    const value = JSON.parse(created.artifact.bytes);
    mutate(value);
    assert.throws(
      () => verifyG17NativeSessionArtifact({
        bytes: Buffer.from(`${canonicalJson(value)}\n`, "utf8"),
        expectedConfiguration,
        contractBytes: sealedContract.bytes,
        contractSha256: sealedContract.contractSha256,
      }),
      /G1\.7 native session contract/u,
    );
  }
});

test("native session replay preserves an honest infrastructure null", () => {
  const { sealedContract, value: expectedConfiguration } = configuration();
  const created = createG17NativeSessionArtifactForTesting({
    configuration: expectedConfiguration,
    session: {
      status: "error",
      stage: "infrastructure",
      commands: [],
      stateBytes: null,
      durationMs: 1,
      error: "generated platform unavailable",
      finalDescendantsObserved: null,
      isolation: null,
    },
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  assert.equal(created.projection.status, "ERROR");
  assert.equal(created.projection.effectiveIsolation, null);
  assert.deepEqual(created.projection.lanes, []);
});

test("native session replay preserves an honest contained-null outcome without promoting it", () => {
  const { sealedContract, value: expectedConfiguration } = configuration();
  const complete = completedSession(expectedConfiguration, sealedContract.contract);
  const first = complete.commands[0];
  const contained = syntheticG17CommandRecord(
    expectedConfiguration,
    expectedConfiguration.commands[1],
    1,
    "test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
    "",
    { descendantsObserved: 1 },
  );
  const created = createG17NativeSessionArtifactForTesting({
    configuration: expectedConfiguration,
    session: {
      status: "incomplete",
      stage: "containment",
      commands: [first, contained],
      stateBytes: 4_096,
      durationMs: 10,
      error: "live-descendants:execution:transaction-compatibility",
      finalDescendantsObserved: 0,
      isolation: syntheticG17Isolation(expectedConfiguration),
    },
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
  assert.equal(created.projection.status, "INCOMPLETE");
  assert.equal(created.projection.totalPassedTests, 0);
  assert.deepEqual(created.projection.lanes, []);
  assert.equal(created.projection.commandsObserved, 2);
});
