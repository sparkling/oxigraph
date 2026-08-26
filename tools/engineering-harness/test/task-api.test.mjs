import assert from "node:assert/strict";
import test from "node:test";

import * as programme from "../src/runtime/g12-programme.mjs";
import * as preflight from "../src/runtime/preflight.mjs";

test("legacy G1 task wrappers remain available beside generic task APIs", () => {
  for (const name of [
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
    "runTaskProgramme",
    "replayTaskProgrammeReceipt",
  ]) {
    assert.equal(typeof programme[name], "function", name);
  }
  for (const name of [
    "runG12Preflight",
    "runG13Preflight",
    "runG14Preflight",
    "runG15Preflight",
    "runG15bPreflight",
    "runG15cPreflight",
    "runG16Preflight",
    "runTaskPreflight",
  ]) {
    assert.equal(typeof preflight[name], "function", name);
  }
});

test("generic programme and replay APIs reject contractPath before side effects", async () => {
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
