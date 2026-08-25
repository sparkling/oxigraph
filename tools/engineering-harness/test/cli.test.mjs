import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { COMMANDS, commandIds } from "../src/command-registry.mjs";

const execute = promisify(execFile);
const executable = new URL("../bin/oxigraph-engineering-harness.mjs", import.meta.url);

test("canonical CLI registry exposes programme, replay, receipt, and history commands", async () => {
  assert.deepEqual(commandIds(), [
    "doctor",
    "g1.2.preflight",
    "g1.3.preflight",
    "g1.4.preflight",
    "g1.5.preflight",
    "g1.5b.preflight",
    "g1.2.run",
    "g1.2.replay",
    "g1.3.run",
    "g1.3.replay",
    "g1.4.run",
    "g1.4.replay",
    "g1.5.run",
    "g1.5.replay",
    "g1.5b.run",
    "g1.5b.replay",
    "receipt.verify",
    "history.inspect",
    "factory.diagnose",
    "help",
    "version",
  ]);
  const { stdout, stderr } = await execute(process.execPath, [executable.pathname, "help"]);
  assert.equal(stderr, "");
  for (const { usage } of COMMANDS) assert.match(stdout, new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
});

test("unknown CLI commands fail closed with the operational exit code", async () => {
  await assert.rejects(
    execute(process.execPath, [executable.pathname, "g1.2", "publish"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /unknown command: g1\.2 publish/u);
      return true;
    },
  );
});
