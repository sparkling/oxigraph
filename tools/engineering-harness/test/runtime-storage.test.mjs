import assert from "node:assert/strict";
import { chmod, link, lstat, readFile, rm, symlink } from "node:fs/promises";
import test from "node:test";
import {
  ensureRuntimeRoot,
  isIgnoredRuntimePath,
  readPrivateRuntimeArtifact,
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
  assert.equal(
    (await readPrivateRuntimeArtifact(name)).toString("utf8"),
    '{"ok":true}\n',
  );
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  await assert.rejects(
    writePrivateRuntimeArtifact(name, "replacement"),
    /already exists/,
  );
  assert.equal((await lstat(await ensureRuntimeRoot())).mode & 0o777, 0o700);
});

test("runtime reads fail closed on aliases, links, permissions, and ceilings", async (t) => {
  const nonce = `${process.pid}-${Date.now()}`;
  const originalName = `storage-read-${nonce}.json`;
  const aliasName = `storage-alias-${nonce}.json`;
  const symlinkName = `storage-symlink-${nonce}.json`;
  const original = await runtimePath(originalName);
  const alias = await runtimePath(aliasName);
  const symbolic = await runtimePath(symlinkName);
  t.after(() => Promise.all([
    rm(original, { force: true }),
    rm(alias, { force: true }),
    rm(symbolic, { force: true }),
  ]));

  await writePrivateRuntimeArtifact(originalName, "private");
  await assert.rejects(
    readPrivateRuntimeArtifact(originalName, { maxBytes: 3 }),
    /bounded private regular file/,
  );
  await link(original, alias);
  await assert.rejects(
    readPrivateRuntimeArtifact(originalName),
    /bounded private regular file/,
  );
  await rm(alias);
  await chmod(original, 0o640);
  await assert.rejects(
    readPrivateRuntimeArtifact(originalName),
    /bounded private regular file/,
  );
  await chmod(original, 0o600);
  await symlink(original, symbolic);
  await assert.rejects(readPrivateRuntimeArtifact(symlinkName));
});

test("runtime artifact names cannot escape their ignored directory", async () => {
  for (const name of ["../escape", "nested/file", "", "bad\u0000name"]) {
    await assert.rejects(runtimePath(name), /single safe path component/);
  }
});
