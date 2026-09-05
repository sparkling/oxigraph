import assert from "node:assert/strict";
import test from "node:test";

import {
  runGuardianNativeScenarioV1,
  runManagerNativeScenarioV1,
  runTrampolineNativeScenarioV1,
} from "./support/candidate-containment-guardian-native-v1-fixture.mjs";

test("service-manager child links StateFS but remains fail-closed before adapter registration", async () => {
  const result = await runManagerNativeScenarioV1();
  assert.equal(result.exitCode, 125);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("normal guardian validates the exact startup inventory and reaps a provisional child on injected launch failure", async () => {
  const result = await runGuardianNativeScenarioV1("normal-provisional-failure");
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.diagnostics, "");
  assert.equal(
    result.status,
    "INITIALIZED NORMAL\nPROVISIONAL_CHILD_CLEANED\nTERMINAL_RELEASED\n",
  );
  assert.equal(result.statusEof, true);
  assert.equal(result.guardianReaped, true);
  assert.equal(result.provisionalChildAbsent, true);
});

test("recovery-only guardian validates its distinct inventory and tears down terminally", async () => {
  const result = await runGuardianNativeScenarioV1("recovery-terminal");
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.diagnostics, "");
  assert.equal(
    result.status,
    "INITIALIZED RECOVERY_ONLY\nTERMINAL_RELEASED\n",
  );
  assert.equal(result.statusEof, true);
  assert.equal(result.guardianReaped, true);
  assert.equal(result.provisionalChildAbsent, true);
});

test("launch trampoline performs only its fixed remap plan before held-file execveat", async () => {
  const result = await runTrampolineNativeScenarioV1();
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "TRAMPOLINE_TARGET_EXECUTED\n");
  assert.equal(result.stderr, "");
});
