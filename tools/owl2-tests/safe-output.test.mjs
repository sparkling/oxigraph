import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicWrite, repositoryRoot } from "./safe-output.mjs";

test("writes and replaces a regular in-repository receipt atomically", () => {
  const directory = mkdtempSync(join(repositoryRoot, "target", "owl-output-test-"));
  try {
    const output = join(directory, "receipt.json");
    atomicWrite(output, "one\n");
    atomicWrite(output, "two\n");
    assert.equal(readFileSync(output, "utf8"), "two\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects output outside the repository", () => {
  const directory = mkdtempSync(join(tmpdir(), "owl-output-test-"));
  try {
    assert.throws(
      () => atomicWrite(join(directory, "receipt.json"), "{}\n"),
      /must remain inside the repository/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an escaping output-directory symlink", (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges");
    return;
  }
  const local = mkdtempSync(join(repositoryRoot, "target", "owl-output-test-"));
  const external = mkdtempSync(join(tmpdir(), "owl-output-test-"));
  try {
    const link = join(local, "escape");
    symlinkSync(external, link, "dir");
    assert.throws(
      () => atomicWrite(join(link, "receipt.json"), "{}\n"),
      /contains a symlink/,
    );
  } finally {
    rmSync(local, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
