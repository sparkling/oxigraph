import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  COMMANDS,
  DORMANT_TASK_V2_COMMANDS,
  commandIds,
  dormantTaskV2CommandIds,
  resolveDormantTaskV2Command,
  validateCommandRegistry,
  validateDormantTaskV2CommandRegistry,
} from "../src/command-registry.mjs";

const execute = promisify(execFile);
const executable = new URL("../bin/oxigraph-engineering-harness.mjs", import.meta.url);

const dormantCommandKeys = Object.freeze([
  "id",
  "usage",
  "taskId",
  "taskSlug",
  "action",
  "contractSchemaVersion",
  "executionGate",
  "registrationMode",
  "productAuthority",
]);

function cloneDormantCommand(command) {
  return Object.fromEntries(
    dormantCommandKeys.map((key) => [key, command[key]]),
  );
}

function cloneDormantRegistry() {
  return DORMANT_TASK_V2_COMMANDS.map(cloneDormantCommand);
}

test("canonical CLI registry exposes programme, replay, receipt, and history commands", async () => {
  assert.deepEqual(commandIds(), [
    "doctor",
    "g1.2.preflight",
    "g1.3.preflight",
    "g1.4.preflight",
    "g1.4a.preflight",
    "g1.4b.preflight",
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
    "g1.4a.run",
    "g1.4a.replay",
    "g1.4b.run",
    "g1.4b.replay",
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
  assert.equal(COMMANDS.length, 33);
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

test("dormant schema-v2 command literals are exact and separate from active authority", () => {
  const expected = [
    {
      id: "dormant.harness-create-exact-v2.preflight",
      usage: "dormant harness-create-exact-v2 preflight",
      taskId: "harness-create-exact-v2-control",
      taskSlug: "harness-create-exact-v2",
      action: "preflight",
      contractSchemaVersion: 2,
      executionGate: "native-containment-qualification-v1",
      registrationMode: "dormant-control",
      productAuthority: false,
    },
    {
      id: "dormant.harness-create-exact-v2.run",
      usage:
        "dormant harness-create-exact-v2 run [--run-id <safe-id>]",
      taskId: "harness-create-exact-v2-control",
      taskSlug: "harness-create-exact-v2",
      action: "run",
      contractSchemaVersion: 2,
      executionGate: "native-containment-qualification-v1",
      registrationMode: "dormant-control",
      productAuthority: false,
    },
    {
      id: "dormant.harness-create-exact-v2.replay",
      usage:
        "dormant harness-create-exact-v2 replay --receipt <runtime-name>",
      taskId: "harness-create-exact-v2-control",
      taskSlug: "harness-create-exact-v2",
      action: "replay",
      contractSchemaVersion: 2,
      executionGate: "native-containment-qualification-v1",
      registrationMode: "dormant-control",
      productAuthority: false,
    },
  ];

  assert.deepEqual(DORMANT_TASK_V2_COMMANDS, expected);
  assert.deepEqual(dormantTaskV2CommandIds(), expected.map(({ id }) => id));
  assert.equal(validateDormantTaskV2CommandRegistry(DORMANT_TASK_V2_COMMANDS), true);
  assert.equal(Object.isFrozen(DORMANT_TASK_V2_COMMANDS), true);
  for (const [index, command] of DORMANT_TASK_V2_COMMANDS.entries()) {
    assert.deepEqual(Object.keys(command), dormantCommandKeys);
    assert.equal(Object.isFrozen(command), true);
    assert.equal(
      resolveDormantTaskV2Command("dormant", command.taskSlug, command.action),
      command,
    );
    assert.equal(command, DORMANT_TASK_V2_COMMANDS[index]);
  }

  assert.equal(COMMANDS.length, 33);
  assert.equal(commandIds().length, 33);
  assert.doesNotMatch(JSON.stringify(COMMANDS), /dormant|harness-create|g2\.2/u);
  assert.doesNotMatch(JSON.stringify(DORMANT_TASK_V2_COMMANDS), /g2\.2/u);
  for (const selection of [
    ["active", "harness-create-exact-v2", "preflight"],
    ["dormant", "harness-create-exact-v2-control", "preflight"],
    ["dormant", "g1.2", "preflight"],
    ["dormant", "g2.2", "preflight"],
    ["dormant", "HARNESS-CREATE-EXACT-V2", "preflight"],
    ["dormant", "harness-create-exact", "preflight"],
    ["dormant", "harness-create-exact-v2", "verify"],
    ["dormant", "../harness-create-exact-v2", "preflight"],
  ]) {
    assert.equal(resolveDormantTaskV2Command(...selection), null);
  }
});

test("dormant schema-v2 command registry rejects hostile authority trap-free", () => {
  const valid = cloneDormantRegistry();
  assert.equal(validateDormantTaskV2CommandRegistry(valid), true);

  let traps = 0;
  const hostileRegistry = new Proxy([], {
    get() {
      traps += 1;
      throw new Error("registry trap");
    },
    ownKeys() {
      traps += 1;
      throw new Error("registry trap");
    },
  });
  const hostileCommand = new Proxy(valid[0], {
    getOwnPropertyDescriptor() {
      traps += 1;
      throw new Error("command trap");
    },
    ownKeys() {
      traps += 1;
      throw new Error("command trap");
    },
  });
  assert.throws(
    () => validateDormantTaskV2CommandRegistry(hostileRegistry),
    /plain dense array/u,
  );
  assert.throws(
    () =>
      validateDormantTaskV2CommandRegistry([
        hostileCommand,
        valid[1],
        valid[2],
      ]),
    /plain own-data record/u,
  );
  assert.equal(traps, 0);

  const sparse = new Array(3);
  sparse[0] = valid[0];
  sparse[2] = valid[2];
  assert.throws(
    () => validateDormantTaskV2CommandRegistry(sparse),
    /plain dense array/u,
  );
  class CommandArray extends Array {}
  assert.throws(
    () =>
      validateDormantTaskV2CommandRegistry(
        new CommandArray(valid[0], valid[1], valid[2]),
      ),
    /plain dense array/u,
  );
  const foreignRegistry = runInNewContext("[null, null, null]");
  foreignRegistry.splice(0, 3, ...valid);
  assert.throws(
    () => validateDormantTaskV2CommandRegistry(foreignRegistry),
    /plain dense array/u,
  );

  const accessor = cloneDormantCommand(valid[0]);
  let getterCalls = 0;
  Object.defineProperty(accessor, "id", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid[0].id;
    },
  });
  assert.throws(
    () =>
      validateDormantTaskV2CommandRegistry([
        accessor,
        valid[1],
        valid[2],
      ]),
    /plain own-data record/u,
  );
  assert.equal(getterCalls, 0);

  const foreignCommand = runInNewContext("({})");
  Object.assign(foreignCommand, valid[0]);
  assert.throws(
    () =>
      validateDormantTaskV2CommandRegistry([
        foreignCommand,
        valid[1],
        valid[2],
      ]),
    /plain own-data record/u,
  );
  const hidden = cloneDormantCommand(valid[0]);
  Object.defineProperty(hidden, "hidden", { value: true });
  const symbolic = cloneDormantCommand(valid[0]);
  symbolic[Symbol("authority")] = true;
  const reordered = Object.fromEntries([
    ["usage", valid[0].usage],
    ["id", valid[0].id],
    ...dormantCommandKeys.slice(2).map((key) => [key, valid[0][key]]),
  ]);
  for (const command of [hidden, symbolic, reordered]) {
    assert.throws(
      () =>
        validateDormantTaskV2CommandRegistry([
          command,
          valid[1],
          valid[2],
        ]),
      /plain own-data record/u,
    );
  }

  for (const [key, value] of [
    ["id", "dormant.harness-create-exact-v2.alias"],
    ["usage", "dormant harness-create-exact-v2 verify"],
    ["taskId", "g2.2-product"],
    ["taskSlug", "g2.2"],
    ["action", "verify"],
    ["contractSchemaVersion", 1],
    ["executionGate", "permissive"],
    ["registrationMode", "active"],
    ["productAuthority", true],
  ]) {
    const changed = cloneDormantRegistry();
    changed[0][key] = value;
    assert.throws(
      () => validateDormantTaskV2CommandRegistry(changed),
      /not canonical/u,
    );
  }

  const duplicate = cloneDormantRegistry();
  duplicate[1] = cloneDormantCommand(duplicate[0]);
  assert.throws(
    () => validateDormantTaskV2CommandRegistry(duplicate),
    /not canonical/u,
  );
  const oversized = cloneDormantRegistry();
  const hostileLiteral = "x".repeat(193);
  oversized[0].id = hostileLiteral;
  assert.throws(
    () => validateDormantTaskV2CommandRegistry(oversized),
    (error) => {
      assert.match(error.message, /bounded literal shape/u);
      assert.doesNotMatch(error.message, new RegExp(hostileLiteral, "u"));
      return true;
    },
  );

  assert.throws(() => DORMANT_TASK_V2_COMMANDS.push(valid[0]), TypeError);
  assert.throws(
    () => {
      DORMANT_TASK_V2_COMMANDS[0].productAuthority = true;
    },
    TypeError,
  );
});

test("unknown CLI commands fail closed with the operational exit code", async () => {
  for (const args of [
    ["g1.2", "publish"],
    ["dormant", "harness-create-exact-v2", "preflight"],
  ]) {
    await assert.rejects(
      execute(process.execPath, [executable.pathname, ...args]),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /unknown command:/u);
        assert.doesNotMatch(error.stderr, /ENOENT|native-adapter/u);
        return true;
      },
    );
  }
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

test("package scripts expose G1.4a, G1.4b, and G1.6 without pinning upstream MetaHarness ranges", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["g1.4a:preflight"],
    "node bin/oxigraph-engineering-harness.mjs g1.4a preflight",
  );
  assert.equal(
    packageJson.scripts["g1.4a:run"],
    "node bin/oxigraph-engineering-harness.mjs g1.4a run",
  );
  assert.equal(
    packageJson.scripts["g1.4b:preflight"],
    "node bin/oxigraph-engineering-harness.mjs g1.4b preflight",
  );
  assert.equal(
    packageJson.scripts["g1.4b:run"],
    "node bin/oxigraph-engineering-harness.mjs g1.4b run",
  );
  assert.equal(
    packageJson.scripts["g1.6:preflight"],
    "node bin/oxigraph-engineering-harness.mjs g1.6 preflight",
  );
  assert.equal(
    packageJson.scripts["g1.6:run"],
    "node bin/oxigraph-engineering-harness.mjs g1.6 run",
  );
  assert.equal(
    Object.keys(packageJson.scripts).some((name) => name.startsWith("dormant:")),
    false,
  );
  assert.ok(
    Object.values(packageJson.dependencies).every((version) => version === "latest"),
  );
});
