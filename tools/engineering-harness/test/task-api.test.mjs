import assert from "node:assert/strict";
import test from "node:test";

import * as programme from "../src/runtime/g12-programme.mjs";
import * as preflight from "../src/runtime/preflight.mjs";

test("generic task APIs remain available beside all legacy G1 wrappers", () => {
  for (const name of [
    "runTaskProgramme",
    "replayTaskProgrammeReceipt",
    "runG12Programme",
    "runG13Programme",
    "runG14Programme",
    "runG15Programme",
    "runG15bProgramme",
    "runG15cProgramme",
    "runG16Programme",
    "replayG12ProgrammeReceipt",
    "replayG13ProgrammeReceipt",
    "replayG14ProgrammeReceipt",
    "replayG15ProgrammeReceipt",
    "replayG15bProgrammeReceipt",
    "replayG15cProgrammeReceipt",
    "replayG16ProgrammeReceipt",
  ]) {
    assert.equal(typeof programme[name], "function", name);
  }
  for (const name of [
    "runTaskPreflight",
    "runG12Preflight",
    "runG13Preflight",
    "runG14Preflight",
    "runG15Preflight",
    "runG15bPreflight",
    "runG15cPreflight",
    "runG16Preflight",
  ]) {
    assert.equal(typeof preflight[name], "function", name);
  }
});

test("generic APIs reject contractPath before any runtime or receipt I/O", async () => {
  await assert.rejects(
    preflight.runTaskPreflight({ contractPath: "/tmp/copied-contract.json" }),
    /contractPath selection is forbidden/u,
  );
  await assert.rejects(
    programme.runTaskProgramme({ contractPath: "/tmp/copied-contract.json" }),
    /contractPath selection is forbidden/u,
  );
  await assert.rejects(
    programme.replayTaskProgrammeReceipt({
      name: "does-not-exist.json",
      contractPath: "/tmp/copied-contract.json",
    }),
    /contractPath selection is forbidden/u,
  );
});

test("generic APIs reject unregistered task ids before side effects", async () => {
  const taskId = "g9.9-unregistered";
  await assert.rejects(
    preflight.runTaskPreflight({ taskId }),
    /unsupported engineering task/u,
  );
  await assert.rejects(
    programme.runTaskProgramme({ taskId }),
    /unsupported engineering task/u,
  );
  await assert.rejects(
    programme.replayTaskProgrammeReceipt({
      name: "does-not-exist.json",
      taskId,
    }),
    /unsupported engineering task/u,
  );
});
