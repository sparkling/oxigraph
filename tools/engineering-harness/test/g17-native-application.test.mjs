import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
} from "../src/qualification/native-application-contract.mjs";
import {
  createG17NativeApplicationForTesting,
  runG17NativeApplication,
} from "../src/qualification/native-application.mjs";
import { G17NativePlatformFault } from "../src/qualification/native-platform.mjs";
import { G17NativeWorkspaceFault } from "../src/qualification/native-workspace.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifact(name) {
  const stored = Buffer.from(`${name}\n`, "utf8");
  return Object.freeze({
    name,
    get bytes() {
      return Buffer.from(stored);
    },
  });
}

function input() {
  const contractBytes = Buffer.from("sealed contract\n", "utf8");
  return {
    contract: {
      compatibility: {
        nativeSession: {
          maxTotalWallMs: 1_860_000,
          maxResidentBytes: 17_179_869_184,
          maxDiskBytes: 12_884_901_888,
          cargoBuildJobs: 4,
          tasksMax: 512,
          memorySwapMaxBytes: 0,
        },
      },
    },
    contractBytes,
    contractSha256: sha256(contractBytes),
    identity: {
      identitySha256: "a".repeat(64),
      toolchain: [{
        program: "cargo",
        toolchainPath: "/sealed/toolchain/bin/cargo",
        toolchainExecutableSha256: "b".repeat(64),
      }],
    },
    runId: "native-application-fixture",
    repoRoot: "/repository",
  };
}

function fixture({
  sessionStatus = "PASS",
  workspaceCleanupError,
  platformCleanupError,
  acquireError,
  workspaceVerifyError,
  platformVerifyError,
  deferPlatformVerification = false,
} = {}) {
  const calls = [];
  const platform = {
    closure: { manifestSha256: "c".repeat(64) },
    toolchainDirectory: "/generated/toolchain",
    platformDirectory: "/generated/platform",
    artifact: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[0]),
    sourcePlan: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[1]),
    controllerAttestation: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[2]),
  };
  const workspace = {
    sourceDirectory: "/generated/workspace/source",
    cargoHomeDirectory: "/generated/workspace/cargo-home",
  };
  const workspaceProjection = {
    schema: "oxigraph.g1.7-native-workspace/v2",
    sha256: "d".repeat(64),
  };
  const policy = {
    policy: { schema: "oxigraph.g1.7-linux-native-isolation-policy/v4" },
    artifact: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[4]),
  };
  const session = {
    projection: {
      schema: "oxigraph.g1.7-native-session-projection/v2",
      status: sessionStatus,
      lanes: sessionStatus === "PASS"
        ? [{ id: "transaction-compatibility", status: "PASS" }]
        : [],
      totalPassedTests: sessionStatus === "PASS" ? 23 : 0,
    },
    artifact: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[5]),
  };
  const workspaceOwner = {
    artifact: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[3]),
  };
  const instance = {
    artifact: artifact(G17_NATIVE_APPLICATION_ARTIFACT_NAMES[6]),
  };
  let namespaceRead = 0;
  const dependencies = {
    temporaryParent() {
      calls.push("temporary-parent");
      return "/temporary";
    },
    async acquirePlatform(value) {
      calls.push("acquire-platform");
      if (acquireError !== undefined) throw acquireError;
      assert.equal(value.temporaryParent, "/temporary");
      return platform;
    },
    async verifyPlatform(value, phase) {
      calls.push(`verify-platform-${phase}`);
      assert.equal(value, platform);
      if (deferPlatformVerification) {
        await new Promise((resolve) => setImmediate(resolve));
        calls.push("verify-platform-settled");
      }
      if (platformVerifyError !== undefined) throw platformVerifyError;
    },
    async destroyPlatform(value) {
      calls.push("destroy-platform");
      assert.equal(value, platform);
      if (platformCleanupError !== undefined) throw platformCleanupError;
    },
    async createWorkspace(value) {
      calls.push("create-workspace");
      assert.equal(value.platform, platform);
      assert.equal(value.cargoProgram, "/sealed/toolchain/bin/cargo");
      return workspace;
    },
    workspaceProjection(value) {
      calls.push("workspace-projection");
      assert.equal(value, workspace);
      return workspaceProjection;
    },
    async verifyWorkspace(value, phase) {
      calls.push(`verify-workspace-${phase}`);
      assert.equal(value, workspace);
      if (workspaceVerifyError !== undefined) throw workspaceVerifyError;
      return { schema: "oxigraph.g1.7-native-workspace-verification/v2" };
    },
    workspaceOwnerArtifact(value, verification) {
      calls.push("workspace-owner");
      assert.equal(value, workspace);
      assert.equal(
        verification.schema,
        "oxigraph.g1.7-native-workspace-verification/v2",
      );
      return workspaceOwner;
    },
    async destroyWorkspace(value) {
      calls.push("destroy-workspace");
      assert.equal(value, workspace);
      if (workspaceCleanupError !== undefined) throw workspaceCleanupError;
    },
    createPolicyArtifact() {
      calls.push("create-policy");
      return policy;
    },
    async runSession(value) {
      calls.push("run-session");
      assert.deepEqual(value.requestedLimits, {
        totalWallMs: 1_860_000,
        residentBytes: 17_179_869_184,
        diskBytes: 12_884_901_888,
        cargoBuildJobs: 4,
        tasksMax: 512,
        memorySwapBytes: 0,
      });
      assert.equal(value.workspaceProjectionSha256, workspaceProjection.sha256);
      return session;
    },
    createInstanceArtifact(value) {
      calls.push("create-instance");
      assert.deepEqual(value.controllerNamespaces, {
        before: {
          user: "user:[1]",
          mount: "mnt:[2]",
          network: "net:[3]",
          pid: "pid:[4]",
          ipc: "ipc:[5]",
          uts: "uts:[6]",
        },
        after: {
          user: "user:[1]",
          mount: "mnt:[2]",
          network: "net:[3]",
          pid: "pid:[4]",
          ipc: "ipc:[5]",
          uts: "uts:[6]",
        },
      });
      assert.deepEqual(value.sessionBytes, session.artifact.bytes);
      return instance;
    },
    verifyApplication(value) {
      calls.push("pure-replay");
      assert.deepEqual(
        value.artifacts.map(({ name }) => name),
        G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
      );
      return Object.freeze({
        schema: G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
        status: "PASS",
        artifacts: Object.freeze(value.artifacts.map(({ name, bytes }) => ({
          name,
          bytes: bytes.length,
          sha256: sha256(bytes),
        }))),
      });
    },
    async readControllerNamespaces() {
      calls.push(`controller-namespaces-${namespaceRead === 0 ? "before" : "after"}`);
      namespaceRead += 1;
      return {
        user: "user:[1]",
        mount: "mnt:[2]",
        network: "net:[3]",
        pid: "pid:[4]",
        ipc: "ipc:[5]",
        uts: "uts:[6]",
      };
    },
  };
  return { calls, dependencies };
}

test("native application returns seven-artifact PASS only after exact cleanup", async () => {
  const { calls, dependencies } = fixture();
  const run = createG17NativeApplicationForTesting(dependencies);
  const result = await run(input());

  assert.equal(result.status, "PASS");
  assert.equal(result.projection.schema, G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA);
  assert.deepEqual(
    result.artifacts.map(({ name }) => name),
    G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  );
  assert.deepEqual(calls, [
    "temporary-parent",
    "acquire-platform",
    "create-workspace",
    "workspace-projection",
    "create-policy",
    "controller-namespaces-before",
    "run-session",
    "controller-namespaces-after",
    "verify-workspace-after-native",
    "verify-platform-after-native",
    "workspace-owner",
    "create-instance",
    "pure-replay",
    "destroy-workspace",
    "destroy-platform",
  ]);
  const first = result.artifacts[0].bytes;
  first[0] ^= 0xff;
  assert.notDeepEqual(first, result.artifacts[0].bytes);
});

test("native application maps non-PASS session truth without minting current artifacts", async () => {
  for (const [sessionStatus, expected] of [
    ["FAIL", "FAIL"],
    ["INCOMPLETE", "MISSING"],
    ["ERROR", "MISSING"],
  ]) {
    const { calls, dependencies } = fixture({ sessionStatus });
    const result = await createG17NativeApplicationForTesting(dependencies)(input());
    assert.equal(result.status, expected);
    assert.equal(result.artifacts.length, 0);
    assert.equal(result.projection.ownerArtifact, null);
    assert.equal(calls.includes("pure-replay"), false);
    assert.deepEqual(calls.slice(-2), ["destroy-workspace", "destroy-platform"]);
  }
});

test("native application cleanup uncertainty overrides and erases a candidate PASS", async () => {
  for (const options of [
    { workspaceCleanupError: new Error("workspace cleanup failed") },
    { platformCleanupError: new Error("platform cleanup failed") },
  ]) {
    const { calls, dependencies } = fixture(options);
    const result = await createG17NativeApplicationForTesting(dependencies)(input());
    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.reasons, ["native-cleanup-unconfirmed"]);
    assert.equal(result.artifacts.length, 0);
    assert.deepEqual(calls.slice(-2), ["destroy-workspace", "destroy-platform"]);
  }
});

test("native application awaits every post-session verifier before cleanup", async () => {
  const { calls, dependencies } = fixture({
    workspaceVerifyError: new G17NativeWorkspaceFault(
      "MISSING",
      "after-native",
      "workspace verification failed",
    ),
    platformVerifyError: new G17NativePlatformFault(
      "FAIL",
      "after-native",
      "platform verification failed",
    ),
    deferPlatformVerification: true,
  });
  const result = await createG17NativeApplicationForTesting(dependencies)(input());

  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.reasons, ["native-platform-after-native-fail"]);
  assert.equal(result.artifacts.length, 0);
  assert.ok(
    calls.indexOf("verify-platform-settled") < calls.indexOf("destroy-workspace"),
  );
  assert.deepEqual(calls.slice(-2), ["destroy-workspace", "destroy-platform"]);
});

test("native application rejects surplus authority and keeps production dependencies closed", () => {
  const { dependencies } = fixture();
  assert.throws(
    () => createG17NativeApplicationForTesting({ ...dependencies, authority: true }),
    /fields are not exact/u,
  );
  assert.equal(typeof runG17NativeApplication, "function");
});
