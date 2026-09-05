import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNativeArtifactV1,
  inspectNativeArtifactV1,
  runGuardianNativeScenarioV1,
  runTrampolineNativeScenarioV1,
} from "./support/candidate-containment-guardian-native-v1-fixture.mjs";

for (const scenario of [
  "normal-short-epoch",
  "normal-extra-fd",
  "normal-aliased-descriptors",
  "normal-wrong-controller-kind",
  "normal-unconnected-controller",
  "normal-wrong-status-flags",
  "recovery-trailing-request",
]) {
  test(`guardian fails closed for ${scenario}`, async () => {
    const result = await runGuardianNativeScenarioV1(scenario);
    assert.equal(result.exitCode, 125);
    assert.equal(result.signal, null);
    assert.equal(result.status, "");
    assert.equal(result.statusEof, true);
    assert.equal(result.diagnostics, "GUARDIAN_INIT_FAIL\n");
    assert.equal(result.guardianReaped, true);
    assert.equal(result.provisionalChildAbsent, true);
  });
}

test("guardian rejects a truncated oversized one-byte control frame", async () => {
  const result = await runGuardianNativeScenarioV1("normal-trailing-command");
  assert.equal(result.exitCode, 126);
  assert.equal(result.signal, null);
  assert.equal(result.status, "INITIALIZED NORMAL\n");
  assert.equal(result.statusEof, true);
  assert.equal(result.diagnostics, "GUARDIAN_RUNTIME_FAIL\n");
  assert.equal(result.guardianReaped, true);
  assert.equal(result.provisionalChildAbsent, true);
});

test("guardian diagnostics remain fixed and bounded when the reader closes", async () => {
  const result = await runGuardianNativeScenarioV1("normal-closed-diagnostics");
  assert.equal(result.exitCode, 125);
  assert.equal(result.signal, null);
  assert.equal(result.status, "");
  assert.equal(result.diagnostics, "");
  assert.equal(result.guardianReaped, true);
});

test("every trampoline remap prefix fails closed without executing the target", async () => {
  for (let faultStep = 1; faultStep <= 20; faultStep += 1) {
    const result = await runTrampolineNativeScenarioV1({ faultStep });
    assert.equal(result.exitCode, 125, `fault step ${faultStep}`);
    assert.equal(result.signal, null, `fault step ${faultStep}`);
    assert.equal(result.stdout, "", `fault step ${faultStep}`);
  }
});

test("static inspection binds artifact-specific direct syscall surfaces", async () => {
  const expected = new Map([
    ["manager", [0, 1, 3, 72, 73, 74, 138, 217, 231, 257, 258, 263, 316, 332]],
    ["guardian", [0, 1, 3, 5, 8, 13, 34, 52, 55, 56, 61, 62, 72, 73, 231, 436]],
    ["trampoline", [3, 72, 231, 292, 322, 436]],
  ]);
  for (const [kind, syscallNumbers] of expected) {
    const artifact = await buildNativeArtifactV1(kind);
    const inspection = await inspectNativeArtifactV1(kind, artifact.bytes, artifact.path);
    assert.deepEqual(inspection.directSyscallNumbers, syscallNumbers, kind);
  }
});
