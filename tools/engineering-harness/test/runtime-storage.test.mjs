import assert from "node:assert/strict";
import { lstat, readFile, rm } from "node:fs/promises";
import test from "node:test";
import {
  ensureRuntimeRoot,
  isIgnoredRuntimePath,
  runtimePath,
  writePrivateRuntimeArtifact,
} from "../src/runtime/storage.mjs";

test("runtime artifacts are private, ignored, atomic, and non-overwriting", async (t) => {
  const name = `storage-test-${process.pid}-${Date.now()}.json`;
  const path = await runtimePath(name);
  t.after(() => rm(path, { force: true }));
  assert.equal(await isIgnoredRuntimePath(path), true);
  assert.equal(await isIgnoredRuntimePath("/tmp/not-oxigraph-runtime"), false);
  await writePrivateRuntimeArtifact(name, '{"ok":true}\n');
  assert.equal(await readFile(path, "utf8"), '{"ok":true}\n');
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  await assert.rejects(
    writePrivateRuntimeArtifact(name, "replacement"),
    /already exists/,
  );
  assert.equal((await lstat(await ensureRuntimeRoot())).mode & 0o777, 0o700);
});

test("runtime artifact names cannot escape their ignored directory", async () => {
  for (const name of ["../escape", "nested/file", "", "bad\u0000name"]) {
    await assert.rejects(runtimePath(name), /single safe path component/);
  }
});
