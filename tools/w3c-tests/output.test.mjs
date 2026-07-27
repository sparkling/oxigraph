import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJsonAtomically } from "./output.mjs";

test("publishes audit JSON inside a canonical repository directory", (t) => {
  const root = temporary(t);
  const path = join(root, "target/w3c/audit.json");
  writeJsonAtomically(path, { schemaVersion: 1 }, { root });
  assert.deepEqual(JSON.parse(readFileSync(path)), { schemaVersion: 1 });
});

test("rejects escaping and symlinked audit output parents", (t) => {
  const root = temporary(t);
  const outside = temporary(t);
  assert.throws(
    () =>
      writeJsonAtomically(
        join(outside, "audit.json"),
        { schemaVersion: 1 },
        { root },
      ),
    /escapes repository/,
  );
  symlinkSync(outside, join(root, "target"), "dir");
  assert.throws(
    () =>
      writeJsonAtomically(
        join(root, "target/audit.json"),
        { schemaVersion: 1 },
        { root },
      ),
    /contains a symbolic link/,
  );
  assert.equal(existsSync(join(outside, "audit.json")), false);
});

test("rejects a symlinked audit destination without changing its target", (t) => {
  const root = temporary(t);
  const outside = temporary(t);
  const parent = join(root, "target");
  const target = join(outside, "target.json");
  const path = join(parent, "audit.json");
  mkdirSync(parent);
  writeFileSync(target, "unchanged\n");
  symlinkSync(target, path);
  assert.throws(
    () => writeJsonAtomically(path, { schemaVersion: 1 }, { root }),
    /not a regular file/,
  );
  assert.equal(readFileSync(target, "utf8"), "unchanged\n");
});

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-w3c-output-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
