import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

import { parseG17CliArgs } from "../src/qualification/cli.mjs";

const execute = promisify(execFile);
const executable = new URL("../bin/oxigraph-g1.7-qualification.mjs", import.meta.url);

test("dedicated G1.7 parser accepts only preflight, run, and verify", () => {
  assert.deepEqual(parseG17CliArgs(["preflight"]), { action: "preflight" });
  assert.deepEqual(parseG17CliArgs(["run"]), { action: "run", runId: undefined });
  assert.deepEqual(parseG17CliArgs(["run", "--run-id", "run-00000001"]), {
    action: "run",
    runId: "run-00000001",
  });
  assert.deepEqual(parseG17CliArgs(["verify", "--run-id", "run-00000001"]), {
    action: "verify",
    runId: "run-00000001",
  });
  for (const args of [
    [],
    ["help"],
    ["publish"],
    ["replay"],
    ["verify"],
    ["verify", "--receipt", "receipt.json"],
    ["run", "--contract", "contract.json"],
    ["run", "--run-id", "../escape"],
    ["run", "--run-id", "one", "--run-id", "two"],
  ]) {
    assert.throws(() => parseG17CliArgs(args), /G1\.7 qualification usage/u);
  }
});

test("dedicated G1.7 CLI rejects malformed input with operational exit 2", async () => {
  for (const args of [
    ["publish"],
    ["verify"],
    ["run", "--contract", "contract.json"],
  ]) {
    await assert.rejects(execute(process.execPath, [executable.pathname, ...args]), (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /G1\.7 qualification usage/u);
      return true;
    });
  }
});

test("package exposes scripts only; application bin and latest dependency surface stay exact", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    {
      preflight: manifest.scripts["g1.7:preflight"],
      run: manifest.scripts["g1.7:run"],
      verify: manifest.scripts["g1.7:verify"],
    },
    {
      preflight: "node bin/oxigraph-g1.7-qualification.mjs preflight",
      run: "node bin/oxigraph-g1.7-qualification.mjs run",
      verify: "node bin/oxigraph-g1.7-qualification.mjs verify",
    },
  );
  assert.deepEqual(manifest.bin, {
    "oxigraph-engineering-harness": "bin/oxigraph-engineering-harness.mjs",
  });
  assert.deepEqual(lock.packages[""].bin, manifest.bin);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(Object.keys(manifest.dependencies).length, 5);
  assert.ok(Object.values(manifest.dependencies).every((value) => value === "latest"));
});

test("dedicated CLI source has no application, Router, publish, or replay imports", async () => {
  const source = await readFile(executable, "utf8");
  assert.doesNotMatch(
    source,
    /application-admission|g12-programme|Router|routing\/history|publish|replay/u,
  );
});
