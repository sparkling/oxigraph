import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createG17Run,
  openSealedG17Run,
} from "../src/qualification/storage.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-store-"));
  await chmod(root, 0o700);
  const runsRoot = join(root, "runs");
  await mkdir(runsRoot, { mode: 0o700 });
  t.after(async () => {
    for (const entry of await readdir(runsRoot).catch(() => [])) {
      await chmod(join(runsRoot, entry), 0o700).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  });
  return runsRoot;
}

test("G1.7 run storage is owner-only, write-once, receipt-last, and sealed", async (t) => {
  const runsRoot = await fixture(t);
  const run = await createG17Run({ runId: "run-00000001", runsRoot });
  await run.write("contract.json", Buffer.from("contract\n"));
  await run.write("manifest.json", Buffer.from("manifest\n"));
  await assert.rejects(run.write("contract.json", Buffer.from("replacement\n")), /already exists/u);
  await assert.rejects(run.write("../escape.json", Buffer.from("escape\n")), /safe artifact/u);
  await run.seal(Buffer.from("receipt\n"));
  await assert.rejects(run.write("late.json", Buffer.from("late\n")), /sealed/u);

  const metadata = await lstat(run.path);
  assert.equal(metadata.mode & 0o777, 0o500);
  const sealed = await openSealedG17Run({ runId: run.runId, runsRoot });
  assert.deepEqual(sealed.entries, ["contract.json", "manifest.json", "receipt.json"]);
  assert.equal((await sealed.read("receipt.json")).toString(), "receipt\n");
  await assert.rejects(
    createG17Run({ runId: run.runId, runsRoot }),
    /already exists/u,
  );
});

test("G1.7 sealed reads reject links, extra entries, permissions, and oversized files", async (t) => {
  const runsRoot = await fixture(t);
  const run = await createG17Run({ runId: "run-00000002", runsRoot });
  await run.write("contract.json", Buffer.from("contract\n"));
  await run.seal(Buffer.from("receipt\n"));
  await chmod(run.path, 0o700);
  await symlink("contract.json", join(run.path, "alias.json"));
  await chmod(run.path, 0o500);
  await assert.rejects(
    openSealedG17Run({ runId: run.runId, runsRoot }),
    /sealed run entries/u,
  );

  const second = await createG17Run({ runId: "run-00000003", runsRoot });
  await second.write("contract.json", Buffer.from("contract\n"));
  await second.seal(Buffer.from("receipt\n"));
  await chmod(second.path, 0o700);
  await chmod(join(second.path, "contract.json"), 0o644);
  await chmod(second.path, 0o500);
  const sealed = await openSealedG17Run({ runId: second.runId, runsRoot });
  await assert.rejects(sealed.read("contract.json"), /private regular file/u);

  const third = await createG17Run({ runId: "run-00000004", runsRoot });
  await third.write("contract.json", Buffer.from("contract\n"));
  await third.seal(Buffer.from("receipt\n"));
  await chmod(third.path, 0o700);
  await writeFile(join(third.path, "contract.json"), Buffer.alloc(1025));
  await chmod(third.path, 0o500);
  const bounded = await openSealedG17Run({ runId: third.runId, runsRoot });
  await assert.rejects(
    bounded.read("contract.json", { maxBytes: 1024 }),
    /private regular file/u,
  );
});
