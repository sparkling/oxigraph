import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hiddenIndexEntriesWithFiles } from "./hidden-entries.mjs";

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function repository(names) {
  const root = mkdtempSync(join(tmpdir(), "hidden-entries-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "test"]);
  for (const name of names) writeFileSync(join(root, name), "original\n");
  git(root, ["add", "--", ...names.map((name) => name.toString("latin1"))]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

test("hidden entries are reported only while their files are present", () => {
  const root = repository(["kept.txt", "absent.txt", "assumed.txt"]);
  try {
    git(root, ["update-index", "--skip-worktree", "kept.txt", "absent.txt"]);
    git(root, ["update-index", "--assume-unchanged", "assumed.txt"]);
    rmSync(join(root, "absent.txt"));
    writeFileSync(join(root, "kept.txt"), "tampered\n");
    assert.equal(git(root, ["status", "--porcelain=v1"]), "");
    assert.deepEqual(hiddenIndexEntriesWithFiles(root).sort(), ["assumed.txt", "kept.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path that is not valid UTF-8 is still checked", () => {
  const name = Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74]);
  const root = mkdtempSync(join(tmpdir(), "hidden-entries-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "test"]);
    writeFileSync(Buffer.concat([Buffer.from(`${root}/`), name]), "original\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "fixture"]);
    const listed = spawnSync("git", ["-C", root, "ls-files", "-z"]).stdout;
    const entry = listed.subarray(0, listed.indexOf(0));
    spawnSync("git", ["-C", root, "update-index", "--skip-worktree", "-z", "--stdin"], {
      input: Buffer.concat([entry, Buffer.from([0])]),
    });
    writeFileSync(Buffer.concat([Buffer.from(`${root}/`), name]), "tampered\n");
    assert.equal(git(root, ["status", "--porcelain=v1"]), "");
    assert.equal(hiddenIndexEntriesWithFiles(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
