import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

import {
  COMMANDS,
  commandIds,
  validateCommandRegistry,
} from "../src/command-registry.mjs";

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
    "g1.5c.preflight",
    "g1.6.preflight",
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
    "g1.5c.run",
    "g1.5c.replay",
    "g1.6.run",
    "g1.6.replay",
    "receipt.verify",
    "history.inspect",
    "factory.diagnose",
    "help",
    "version",
  ]);
  assert.equal(COMMANDS.length, 27);
  assert.equal(Object.isFrozen(COMMANDS), true);
  assert.equal(validateCommandRegistry(COMMANDS), true);
  for (const entry of COMMANDS) {
    assert.deepEqual(Object.keys(entry), ["id", "usage"]);
    assert.equal(Object.isFrozen(entry), true);
  }
  const { stdout, stderr } = await execute(process.execPath, [executable.pathname, "help"]);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    [
      "Usage: oxigraph-engineering-harness <command>",
      "",
      ...COMMANDS.map(({ usage }) => `  ${usage}`),
      "",
    ].join("\n"),
  );

  const source = await readFile(executable, "utf8");
  assert.doesNotMatch(source, /\b(?:run|replay)G1/u);
  assert.match(source, /runTaskPreflight/u);
  assert.match(source, /runTaskProgramme/u);
  assert.match(source, /replayTaskProgrammeReceipt/u);
});

test("canonical CLI registry rejects duplicate and non-canonical entries", () => {
  const duplicateId = COMMANDS.map((entry) => ({ ...entry }));
  duplicateId[1].id = duplicateId[0].id;
  assert.throws(
    () => validateCommandRegistry(duplicateId),
    /duplicate command id: doctor/u,
  );

  const duplicateUsage = COMMANDS.map((entry) => ({ ...entry }));
  duplicateUsage[1].usage = duplicateUsage[0].usage;
  assert.throws(
    () => validateCommandRegistry(duplicateUsage),
    /duplicate command usage: doctor/u,
  );

  const unsafe = COMMANDS.map((entry) => ({ ...entry }));
  unsafe[1] = { ...unsafe[1], contractPath: "tasks/g1/g1.2/contract.json" };
  assert.throws(
    () => validateCommandRegistry(unsafe),
    /must contain exactly \{id, usage\}/u,
  );
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

test("unregistered and path-selected tasks fail closed before runtime", async () => {
  for (const args of [
    ["tasks/g1/g1.2", "preflight"],
    ["g1.2", "preflight", "--contract-path", "tasks/g1/g1.2/contract.json"],
    ["g1.7", "preflight"],
    ["g1.7", "run"],
    ["g1.7", "verify"],
  ]) {
    await assert.rejects(execute(process.execPath, [executable.pathname, ...args]), (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /unknown command:/u);
      assert.doesNotMatch(error.stderr, /ENOENT|unsupported engineering task/u);
      return true;
    });
  }
});

test("late registered tasks use dynamic dispatch and reject malformed arguments", async () => {
  for (const [args, message] of [
    [
      ["g1.6", "run", "--unsupported", "value"],
      /usage: g1\.6 run \[--run-id <safe-id>\]/u,
    ],
    [
      ["g1.6", "replay", "--contract-path", "contract.json"],
      /missing --receipt/u,
    ],
  ]) {
    await assert.rejects(execute(process.execPath, [executable.pathname, ...args]), (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, message);
      assert.doesNotMatch(error.stderr, /ENOENT/u);
      return true;
    });
  }
});

test("help and version aliases preserve the public CLI surface", async () => {
  const [{ stdout: helpStdout, stderr: helpStderr }, version] = await Promise.all([
    execute(process.execPath, [executable.pathname, "--help"]),
    execute(process.execPath, [executable.pathname, "--version"]),
  ]);
  assert.equal(helpStderr, "");
  assert.match(helpStdout, /^Usage: oxigraph-engineering-harness <command>$/mu);
  assert.deepEqual(version, { stdout: "0.0.0\n", stderr: "" });
});

test("package scripts expose G1.6 without pinning upstream MetaHarness ranges", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["g1.6:preflight"],
    "node bin/oxigraph-engineering-harness.mjs g1.6 preflight",
  );
  assert.equal(
    packageJson.scripts["g1.6:run"],
    "node bin/oxigraph-engineering-harness.mjs g1.6 run",
  );
  assert.ok(
    Object.values(packageJson.dependencies).every((version) => version === "latest"),
  );
});
