import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  captureCandidateContainmentSupervisorPreflightStatusForTestV4,
  runCandidateContainmentSupervisorPreflightNativeScenarioV4,
} from "./support/candidate-containment-supervisor-preflight-native-v4-fixture.mjs";

const nativeTest =
  process.platform === "linux" && process.arch === "x64" ? test : test.skip;
const failureDiagnostic = Buffer.from("PREFLIGHT_FAIL!\n", "utf8");

async function assertScenarioCleanup(result) {
  assert.equal(result.cleanupTimedOut, false);
  await assert.rejects(access(result.privateRootPath), { code: "ENOENT" });
}

test("status capture rejects a fourth frame instead of omitting it", async () => {
  await assert.rejects(
    captureCandidateContainmentSupervisorPreflightStatusForTestV4([
      Buffer.from("{}\n{}\n{}\n{}\n", "utf8"),
    ]),
    /status frame count exceeded/u,
  );
});

for (const scenario of [
  "alias-fd4-fd5",
  "fd17-readonly",
  "fd3-regular",
  "fd4-directory",
  "opath-fd3",
  "opath-fd4",
]) {
  nativeTest(
    `${scenario} is a descriptor failure and never reaches READY`,
    { timeout: 30_000 },
    async () => {
      const result =
        await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
          scenario,
        );
      assert.equal(result.exitCode, 126);
      assert.equal(result.signal, null);
      assert.equal(result.reaped, true);
      assert.equal(result.timedOut, false);
      assert.equal(result.readyBytes, null);
      assert.deepEqual(result.statusBytes, Buffer.alloc(0));
      assert.deepEqual(result.diagnosticsBytes, failureDiagnostic);
      await assertScenarioCleanup(result);
    },
  );
}

for (const [scenario, expectedReady] of [
  ["partial-start-open", false],
  ["cancel-without-eof", true],
]) {
  nativeTest(
    `${scenario} is classified as a bounded harness timeout`,
    { timeout: 30_000 },
    async () => {
      const result =
        await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
          scenario,
        );
      assert.equal(result.exitCode, null);
      assert.equal(result.signal, "SIGKILL");
      assert.equal(result.reaped, true);
      assert.equal(result.timedOut, true);
      assert.equal(result.readyBytes !== null, expectedReady);
      assert.deepEqual(
        result.statusBytes,
        expectedReady ? result.readyBytes : Buffer.alloc(0),
      );
      assert.deepEqual(result.diagnosticsBytes, Buffer.alloc(0));
      await assertScenarioCleanup(result);
    },
  );
}

for (const [scenario, expectedDiagnostics] of [
  ["alias-fd1-fd2", Buffer.alloc(0)],
  ["fd0-writeonly", Buffer.alloc(0)],
  ["fd1-regular", Buffer.alloc(0)],
  ["status-reader-closed", failureDiagnostic],
]) {
  nativeTest(
    `${scenario} is an I/O or descriptor failure with only safe diagnostics`,
    { timeout: 30_000 },
    async () => {
      const result =
        await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
          scenario,
        );
      assert.equal(result.exitCode, 126);
      assert.equal(result.signal, null);
      assert.equal(result.reaped, true);
      assert.equal(result.timedOut, false);
      assert.equal(result.readyBytes, null);
      assert.deepEqual(result.statusBytes, Buffer.alloc(0));
      assert.deepEqual(result.diagnosticsBytes, expectedDiagnostics);
      await assertScenarioCleanup(result);
    },
  );
}

for (const scenario of [
  "capsule-padding-bits",
  "capsule-stale-hash",
  "commit-start",
  "crlf-start",
  "duplicate-start-key",
  "empty-command",
  "extra-capsule-field",
  "extra-start-field",
  "oversized-start",
  "truncated-capsule",
  "truncated-start",
  "wrong-start-schema",
]) {
  nativeTest(
    `${scenario} is a malformed or unsupported protocol failure`,
    { timeout: 30_000 },
    async () => {
      const result =
        await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
          scenario,
        );
      assert.equal(result.exitCode, 125);
      assert.equal(result.signal, null);
      assert.equal(result.reaped, true);
      assert.equal(result.timedOut, false);
      assert.equal(result.readyBytes, null);
      assert.deepEqual(result.statusBytes, Buffer.alloc(0));
      assert.deepEqual(result.diagnosticsBytes, failureDiagnostic);
      await assertScenarioCleanup(result);
    },
  );
}

for (const scenario of [
  "commit-control",
  "eof-after-ready",
  "stale-ready-control",
  "trailing-after-cancel",
]) {
  nativeTest(
    `${scenario} fails after exactly one READY frame`,
    { timeout: 30_000 },
    async () => {
      const result =
        await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
          scenario,
        );
      assert.equal(result.exitCode, 125);
      assert.equal(result.signal, null);
      assert.equal(result.reaped, true);
      assert.equal(result.timedOut, false);
      assert.notEqual(result.readyBytes, null);
      assert.deepEqual(result.statusBytes, result.readyBytes);
      assert.deepEqual(result.diagnosticsBytes, failureDiagnostic);
      await assertScenarioCleanup(result);
    },
  );
}

nativeTest(
  "malformed input cannot write diagnostics through an unvalidated regular FD2",
  { timeout: 30_000 },
  async () => {
    const result =
      await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
        "unvalidated-diagnostic-regular",
      );
    assert.equal(result.exitCode, 125);
    assert.equal(result.signal, null);
    assert.equal(result.reaped, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.readyBytes, null);
    assert.deepEqual(result.statusBytes, Buffer.alloc(0));
    assert.deepEqual(result.diagnosticsBytes, Buffer.alloc(0));
    assert.deepEqual(
      result.diagnosticRegularFileBytes,
      result.diagnosticRegularFileInitialBytes,
    );
    await assertScenarioCleanup(result);
  },
);

nativeTest(
  "otherwise valid input cannot write diagnostics through a regular FD2",
  { timeout: 30_000 },
  async () => {
    const result =
      await runCandidateContainmentSupervisorPreflightNativeScenarioV4(
        "fd2-regular-valid",
      );
    assert.equal(result.exitCode, 126);
    assert.equal(result.signal, null);
    assert.equal(result.reaped, true);
    assert.equal(result.timedOut, false);
    assert.equal(result.readyBytes, null);
    assert.deepEqual(result.statusBytes, Buffer.alloc(0));
    assert.deepEqual(result.diagnosticsBytes, Buffer.alloc(0));
    assert.deepEqual(
      result.diagnosticRegularFileBytes,
      result.diagnosticRegularFileInitialBytes,
    );
    await assertScenarioCleanup(result);
  },
);
