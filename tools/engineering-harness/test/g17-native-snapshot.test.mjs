import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  rename,
  rmdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  G17NativeSnapshotFault,
  buildG17NativeSnapshotHelper,
  closeG17NativeSnapshotHelper,
  deleteG17NativeNode,
  snapshotG17NativeNode,
  verifyG17NativeSnapshotHelper,
} from "../src/qualification/native-snapshot.mjs";

async function deleteTree(helper, parent, root, overrides = {}) {
  const parentHandle = await open(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const rootHandle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    return await deleteG17NativeNode({
      helper,
      parentHandle,
      rootHandle,
      targetName: root.slice(parent.length + 1),
      maxEntries: 64,
      maxDepth: 16,
      timeoutMs: 10_000,
      signal: undefined,
      ...overrides,
    });
  } finally {
    await Promise.allSettled([parentHandle.close(), rootHandle.close()]);
  }
}

test("openat2 snapshot helper copies exact files, directories, links, and exclusions", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-"));
  let helper;
  try {
    const controller = join(root, "controller");
    const source = join(root, "source");
    const destination = join(root, "destination");
    await Promise.all([
      mkdir(controller, { mode: 0o700 }),
      mkdir(join(source, "nested"), { recursive: true, mode: 0o700 }),
      mkdir(join(source, "excluded"), { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      writeFile(join(source, "nested", "data"), "exact bytes\n"),
      writeFile(join(source, "excluded", "secret"), "not copied\n"),
      symlink("nested/data", join(source, "alias")),
    ]);
    await chmod(join(source, "nested", "data"), 0o700);
    helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    const result = await snapshotG17NativeNode({
      helper,
      source,
      destination,
      maxFileBytes: 1024 * 1024,
      maxBytes: 1024 * 1024,
      maxEntries: 32,
      excludes: ["excluded"],
      signal: undefined,
    });
    assert.equal(result.schema, "oxigraph.g1.7-openat2-snapshot/v2");
    assert.equal(result.bytes, 23);
    assert.equal(result.directories, 2);
    assert.equal(result.entries, 4);
    assert.equal(result.files, 1);
    assert.equal(result.symlinks, 1);
    assert.equal(result.operation, "copy");
    assert.equal(result.source.name, "source");
    assert.equal(result.destination.name, "destination");
    assert.deepEqual(result.limits, {
      maxFileBytes: 1024 * 1024,
      maxBytes: 1024 * 1024,
      maxEntries: 32,
    });
    assert.equal(await readFile(join(destination, "nested", "data"), "utf8"), "exact bytes\n");
    assert.equal(await readlink(join(destination, "alias")), "nested/data");
    await assert.rejects(lstat(join(destination, "excluded")), { code: "ENOENT" });
    assert.equal((await lstat(destination)).mode & 0o777, 0o555);
    assert.equal((await lstat(join(destination, "nested", "data"))).mode & 0o777, 0o555);
    assert.equal(
      (await verifyG17NativeSnapshotHelper(helper)).schema,
      "oxigraph.g1.7-native-snapshot-helper/v2",
    );
  } finally {
    if (helper !== undefined) await closeG17NativeSnapshotHelper(helper);
    await chmod(join(root, "destination", "nested"), 0o700).catch(() => {});
    await chmod(join(root, "destination"), 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("openat2 snapshot helper rejects collisions, ceilings, and symlink ancestors", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-reject-"));
  let helper;
  try {
    const controller = join(root, "controller");
    const source = join(root, "source");
    const realParent = join(root, "real-parent");
    await Promise.all([
      mkdir(controller, { mode: 0o700 }),
      mkdir(source, { mode: 0o700 }),
      mkdir(realParent, { mode: 0o700 }),
    ]);
    await writeFile(join(source, "data"), "too many bytes\n");
    helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    const destination = join(root, "collision");
    await mkdir(destination);
    await assert.rejects(
      snapshotG17NativeNode({
        helper,
        source,
        destination,
        maxFileBytes: 1024,
        maxBytes: 1024,
        maxEntries: 8,
        excludes: [],
        signal: undefined,
      }),
      G17NativeSnapshotFault,
    );
    await assert.rejects(
      snapshotG17NativeNode({
        helper,
        source,
        destination: join(root, "too-small"),
        maxFileBytes: 1,
        maxBytes: 1,
        maxEntries: 8,
        excludes: [],
        signal: undefined,
      }),
      /byte ceiling/u,
    );
    await symlink(realParent, join(root, "aliased-parent"));
    await assert.rejects(
      snapshotG17NativeNode({
        helper,
        source,
        destination: join(root, "aliased-parent", "copy"),
        maxFileBytes: 1024,
        maxBytes: 1024,
        maxEntries: 8,
        excludes: [],
        signal: undefined,
      }),
      /canonical directory|openat2/u,
    );
  } finally {
    if (helper !== undefined) await closeG17NativeSnapshotHelper(helper);
    await rm(root, { recursive: true, force: true });
  }
});

test("openat2 snapshot helper rejects hard links, overlaps, and bounded inventories", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-hardening-"));
  let helper;
  try {
    const controller = join(root, "controller");
    const hardlinked = join(root, "hardlinked");
    const bounded = join(root, "bounded");
    await Promise.all([
      mkdir(controller, { mode: 0o700 }),
      mkdir(hardlinked, { mode: 0o700 }),
      mkdir(bounded, { mode: 0o700 }),
    ]);
    await writeFile(join(hardlinked, "original"), "same inode\n");
    await link(join(hardlinked, "original"), join(hardlinked, "alias"));
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        writeFile(join(bounded, `entry-${index}`), `${index}\n`)),
    );
    helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    await assert.rejects(
      snapshotG17NativeNode({
        helper,
        source: hardlinked,
        destination: join(root, "hardlinked-copy"),
        maxFileBytes: 1024,
        maxBytes: 4096,
        maxEntries: 16,
        excludes: [],
        signal: undefined,
      }),
      /multiple hard links/u,
    );
    await assert.rejects(
      snapshotG17NativeNode({
        helper,
        source: bounded,
        destination: join(root, "bounded-copy"),
        maxFileBytes: 1024,
        maxBytes: 4096,
        maxEntries: 3,
        excludes: [],
        signal: undefined,
      }),
      /directory inventory/u,
    );
    await assert.rejects(
      snapshotG17NativeNode({
        helper,
        source: bounded,
        destination: join(bounded, "nested-copy"),
        maxFileBytes: 1024,
        maxBytes: 4096,
        maxEntries: 16,
        excludes: [],
        signal: undefined,
      }),
      /overlap/u,
    );
  } finally {
    if (helper !== undefined) await closeG17NativeSnapshotHelper(helper);
    await rm(root, { recursive: true, force: true });
  }
});

test("descriptor-pinned delete removes only the exact bounded tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-delete-"));
  let helper;
  try {
    const controller = join(root, "controller");
    const target = join(root, "target");
    const sentinel = join(root, "sentinel");
    await Promise.all([
      mkdir(controller, { mode: 0o700 }),
      mkdir(join(target, "nested"), { recursive: true, mode: 0o700 }),
      writeFile(sentinel, "outside\n"),
    ]);
    await Promise.all([
      writeFile(join(target, "data"), "root data\n"),
      writeFile(join(target, "nested", "data"), "nested data\n"),
      symlink(sentinel, join(target, "outside-link")),
    ]);
    helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    const result = await deleteTree(helper, root, target);
    assert.deepEqual(result, {
      schema: "oxigraph.g1.7-openat2-delete/v1",
      directories: 2,
      entries: 5,
      files: 2,
      symlinks: 1,
      operation: "delete",
      limits: {
        maxEntries: 64,
        maxDepth: 16,
        timeoutMs: 10_000,
      },
    });
    await assert.rejects(lstat(target), { code: "ENOENT" });
    assert.equal(await readFile(sentinel, "utf8"), "outside\n");
  } finally {
    if (helper !== undefined) await closeG17NativeSnapshotHelper(helper);
    await rm(root, { recursive: true, force: true });
  }
});

test("descriptor-pinned delete fails closed on replacement, depth, inventory, and special files", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-delete-reject-"));
  let helper;
  let parentHandle;
  let targetHandle;
  try {
    const controller = join(root, "controller");
    const target = join(root, "target");
    const displaced = join(root, "target-displaced");
    await Promise.all([
      mkdir(controller, { mode: 0o700 }),
      mkdir(join(target, "one", "two"), { recursive: true, mode: 0o700 }),
    ]);
    await writeFile(join(target, "one", "two", "data"), "data\n");
    helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    parentHandle = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    targetHandle = await open(
      target,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const request = {
      helper,
      parentHandle,
      rootHandle: targetHandle,
      targetName: "target",
      maxEntries: 64,
      maxDepth: 16,
      timeoutMs: 10_000,
      signal: undefined,
    };
    await rename(target, displaced);
    await mkdir(target, { mode: 0o700 });
    await assert.rejects(
      deleteG17NativeNode(request),
      /pinned delete root and parent leaf do not match/u,
    );
    assert.equal((await lstat(target)).isDirectory(), true);
    assert.equal((await lstat(displaced)).isDirectory(), true);
    await rmdir(target);
    await rename(displaced, target);

    await assert.rejects(
      deleteG17NativeNode({ ...request, maxDepth: 1 }),
      /depth ceiling/u,
    );
    await assert.rejects(
      deleteG17NativeNode({ ...request, maxEntries: 2 }),
      /entry ceiling|inventory/u,
    );
    const fifo = join(target, "unsupported-fifo");
    execFileSync("/usr/bin/mkfifo", [fifo]);
    await assert.rejects(
      deleteG17NativeNode(request),
      /entry type is unsupported/u,
    );
    await rm(fifo);
    await deleteG17NativeNode(request);
    await assert.rejects(lstat(target), { code: "ENOENT" });
  } finally {
    await Promise.allSettled([parentHandle?.close(), targetHandle?.close()]);
    if (helper !== undefined) await closeG17NativeSnapshotHelper(helper);
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot helper lifecycle rejects overlapping verification and cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-lifecycle-"));
  try {
    const controller = join(root, "controller");
    await mkdir(controller, { mode: 0o700 });
    const helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    const verification = verifyG17NativeSnapshotHelper(helper);
    await assert.rejects(closeG17NativeSnapshotHelper(helper), /not live/u);
    await verification;
    await closeG17NativeSnapshotHelper(helper);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closed snapshot helpers cannot be reused", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-openat2-close-"));
  try {
    const controller = join(root, "controller");
    await mkdir(controller, { mode: 0o700 });
    const helper = await buildG17NativeSnapshotHelper({
      outputDirectory: controller,
      signal: undefined,
    });
    await closeG17NativeSnapshotHelper(helper);
    await assert.rejects(verifyG17NativeSnapshotHelper(helper), /not live/u);
    await assert.rejects(closeG17NativeSnapshotHelper(helper), /not live/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
