import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  G17_NATIVE_COMPATIBILITY_ARTIFACT_NAME,
  createG17NativeCompatibilityEvidence,
  g17NativeExecutionArgv,
  g17NativeInventoryArgv,
  verifyG17NativeCompatibilityEvidence,
} from "../src/qualification/native-compatibility-contract.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import { g17IdentityFixture } from "./support/g17-identity-fixture.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function identity() {
  return g17IdentityFixture({
    cargoVersion: "cargo 1.91.0\nrelease: 1.91.0",
  });
}

function processResult(stdout, stderr = "") {
  const stdoutBytes = Buffer.from(stdout);
  const stderrBytes = Buffer.from(stderr);
  return {
    code: 0,
    signal: null,
    spawnError: null,
    timedOut: false,
    outputLimitExceeded: false,
    scanLimitExceeded: false,
    timeoutMs: 300_000,
    durationMs: 12,
    output: {
      stdoutBytes: stdoutBytes.length,
      stderrBytes: stderrBytes.length,
      stdoutSha256: sha256(stdoutBytes),
      stderrSha256: sha256(stderrBytes),
    },
    capturedOutput: {
      limitBytes: 1_048_576,
      stdout: stdoutBytes,
      stderr: stderrBytes,
    },
  };
}

function observations(contract, subjectIdentity, workspace) {
  const cargo = subjectIdentity.toolchain.find(({ program }) => program === "cargo");
  return contract.compatibility.native.map((lane) => ({
    id: lane.id,
    inventory: {
      program: cargo.toolchainPath,
      args: g17NativeInventoryArgv(
        g17NativeExecutionArgv(lane.argv, workspace.targetDirectory),
      ).slice(1),
      result: processResult(
        `${lane.expectedTestIds.map((id) => `${id}: test`).join("\n")}\n`,
        "inventory diagnostic\n",
      ),
    },
    execution: {
      program: cargo.toolchainPath,
      args: g17NativeExecutionArgv(
        lane.argv,
        workspace.targetDirectory,
      ).slice(1),
      result: {
        ...processResult(
          [
            `running ${lane.expectedPassedTests} tests`,
            `test result: ok. ${lane.expectedPassedTests} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`,
            "",
          ].join("\n"),
          "execution diagnostic\n",
        ),
        observedPassedTests: lane.expectedPassedTests,
      },
    },
  }));
}

function fixture() {
  const { contract } = loadG17Contract();
  const subjectIdentity = identity();
  const workspace = {
    policy: "exclusive-temporary-home-and-target-v1",
    root: "/tmp/oxigraph-g17-run-native-owner-01-fixture",
    homeDirectory: "/tmp/oxigraph-g17-run-native-owner-01-fixture/home",
    targetDirectory: "/tmp/oxigraph-g17-run-native-owner-01-fixture/target",
    cargoCachePolicy: "sanitized-symlinked-registry-lock-checksum-v1",
    cargoCachePackageCount: 1,
    cargoCacheSha256: "5".repeat(64),
  };
  const created = createG17NativeCompatibilityEvidence({
    runId: "run-native-owner-01",
    contract,
    identity: subjectIdentity,
    workspace,
    observations: observations(contract, subjectIdentity, workspace),
  });
  return { contract, subjectIdentity, created };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

test("native owner evidence reparses bounded raw Cargo bytes and derives all public claims", () => {
  const { contract, subjectIdentity, created } = fixture();
  assert.equal(created.artifact.name, G17_NATIVE_COMPATIBILITY_ARTIFACT_NAME);
  assert.equal(
    created.artifact.sha256,
    sha256(created.artifact.bytes),
  );
  assert.equal(created.projection.status, "PASS");
  assert.equal(created.projection.totalPassedTests, 23);
  assert.deepEqual(
    created.projection.lanes.map(({ id, inventoriedTestIds }) => ({
      id,
      count: inventoriedTestIds.length,
    })),
    [
      { id: "transaction-compatibility", count: 20 },
      { id: "bulk-sst-writer-serialization", count: 1 },
      { id: "update-atomicity", count: 2 },
    ],
  );
  assert.deepEqual(
    verifyG17NativeCompatibilityEvidence({
      runId: "run-native-owner-01",
      contract,
      identity: subjectIdentity,
      bytes: created.artifact.bytes,
    }),
    created.projection,
  );
  assert.equal(
    JSON.stringify(JSON.parse(created.artifact.bytes)).includes(
      "inventory diagnostic",
    ),
    false,
  );
});

test("native owner replay rejects rehashed subject, tool, lane, argv, timeout, and raw-output tampering", () => {
  const { contract, subjectIdentity, created } = fixture();
  const mutations = [
    (owner) => {
      owner.identity.subjectCommit = "9".repeat(40);
    },
    (owner) => {
      owner.toolchain.cargo.toolchainExecutableSha256 = "9".repeat(64);
    },
    (owner) => {
      owner.toolchain.rustc.toolchainExecutableSha256 = "9".repeat(64);
    },
    (owner) => {
      owner.lanes.reverse();
    },
    (owner) => {
      owner.lanes[0].reviewedArgv.push("--ignored");
    },
    (owner) => {
      owner.lanes[0].timeoutMs += 1;
    },
    (owner) => {
      owner.lanes[0].execution.durationMs =
        owner.lanes[0].timeoutMs + 1;
    },
    (owner) => {
      owner.lanes[0].inventory.stdout.base64 = Buffer.from(
        "substituted: test\n",
      ).toString("base64");
      owner.lanes[0].inventory.stdout.bytes = 18;
      owner.lanes[0].inventory.stdout.sha256 = sha256(
        Buffer.from("substituted: test\n"),
      );
    },
    (owner) => {
      owner.lanes[0].execution.stdout.base64 = Buffer.from(
        "test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n" +
          "test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
      ).toString("base64");
      const bytes = Buffer.from(owner.lanes[0].execution.stdout.base64, "base64");
      owner.lanes[0].execution.stdout.bytes = bytes.length;
      owner.lanes[0].execution.stdout.sha256 = sha256(bytes);
    },
  ];
  for (const mutate of mutations) {
    const owner = JSON.parse(created.artifact.bytes);
    mutate(owner);
    assert.throws(
      () =>
        verifyG17NativeCompatibilityEvidence({
          runId: "run-native-owner-01",
          contract,
          identity: subjectIdentity,
          bytes: canonicalBytes(owner),
        }),
      /G1\.7 native compatibility owner/u,
    );
  }
});

test("native owner replay rejects noncanonical bytes and is process-free", async () => {
  const { contract, subjectIdentity, created } = fixture();
  const owner = JSON.parse(created.artifact.bytes);
  assert.throws(
    () =>
      verifyG17NativeCompatibilityEvidence({
        runId: "run-native-owner-01",
        contract,
        identity: subjectIdentity,
        bytes: Buffer.from(JSON.stringify(owner), "utf8"),
      }),
    /canonical JSON/u,
  );
  const source = await readFile(
    new URL(
      "../src/qualification/native-compatibility-contract.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /(?:node:)?(?:child_process|fs(?:\/promises)?)|\bprocess\s*(?:\.|\[)|application-evidence/u,
  );
});
