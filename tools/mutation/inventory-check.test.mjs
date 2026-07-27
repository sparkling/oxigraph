import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCurrentInventoryMatches,
  listCurrentMutationInventory,
} from "./inventory-check.mjs";

function temporaryRepository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "inventory-check-test-")));
  mkdirSync(join(root, "lib"), { recursive: true });
  mkdirSync(join(root, "tools", "mutation"), { recursive: true });
  writeFileSync(join(root, "Cargo.lock"), "lock\n");
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
  writeFileSync(join(root, "lib", "source.rs"), "source\n");
  writeFileSync(
    join(root, "tools", "mutation", "oxdatalog.toml"),
    'test_package = ["oxdatalog"]\n',
  );
  return root;
}

function inventory() {
  const file = "lib/oxdatalog/src/source.rs";
  return [
    {
      diff: "--- old\n+++ new\n",
      name: `${file}:1:1: replace value with false`,
      package: "oxdatalog",
      file,
      function: null,
      span: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 5 },
      },
      replacement: "false",
      genre: "BinaryOperator",
    },
  ];
}

test("independent inventory uses the exact bounded reviewed invocation", () => {
  const root = temporaryRepository();
  try {
    let invoked = false;
    const result = listCurrentMutationInventory(root, {
      timeoutMs: 5_000,
      execute(program, args, options) {
        invoked = true;
        assert.equal(program, "cargo");
        assert.deepEqual(args, [
          "mutants",
          "--config",
          join(root, "tools", "mutation", "oxdatalog.toml"),
          "--package",
          "oxdatalog",
          "--colors",
          "never",
          "--annotations",
          "none",
          "--list",
          "--json",
        ]);
        assert.equal(options.cwd, root);
        assert.equal(options.timeout, 5_000);
        return JSON.stringify(inventory());
      },
    });
    assert.equal(invoked, true);
    assert.deepEqual(result.inventory, inventory());
    assert.deepEqual(result.before, result.after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("independent inventory rejects source drift and mismatched archives", () => {
  const root = temporaryRepository();
  try {
    assert.throws(
      () =>
        listCurrentMutationInventory(root, {
          execute() {
            writeFileSync(join(root, "lib", "source.rs"), "changed\n");
            return JSON.stringify(inventory());
          },
        }),
      /snapshots do not equal current source/,
    );
    const changed = inventory();
    changed[0].replacement = "true";
    assert.throws(
      () => assertCurrentInventoryMatches(inventory(), changed),
      /does not match current source inventory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
