import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17NativeElfFault,
  parseG17Elf64,
  parseG17GnuLinkerScript,
} from "../src/qualification/native-elf.mjs";

test("pure ELF64 replay derives the executable dependency metadata", async () => {
  const parsed = parseG17Elf64(await readFile("/usr/bin/true"));
  assert.equal(parsed.elfClass, 64);
  assert.equal(parsed.elfData, "little");
  assert.equal(parsed.elfMachine, 62);
  assert.match(parsed.interpreter, /^\/(?:usr\/)?lib64?\//u);
  assert.equal(parsed.needed.includes("libc.so.6"), true);
  assert.equal(Object.isFrozen(parsed), true);
});

test("pure ELF64 replay rejects malformed ELF and ignores ordinary bytes", () => {
  assert.equal(parseG17Elf64(Buffer.from("ordinary bytes\n")), null);
  const truncated = Buffer.alloc(8);
  truncated.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  assert.throws(() => parseG17Elf64(truncated), G17NativeElfFault);
});

test("GNU linker-script replay extracts nested exact inputs", async () => {
  const libc = parseG17GnuLinkerScript(
    await readFile("/usr/lib/x86_64-linux-gnu/libc.so"),
  );
  assert.deepEqual(libc.directives, ["GROUP", "AS_NEEDED"]);
  assert.deepEqual(libc.inputs, [
    "/lib/x86_64-linux-gnu/libc.so.6",
    "/usr/lib/x86_64-linux-gnu/libc_nonshared.a",
    "/lib64/ld-linux-x86-64.so.2",
  ]);
});

test("linker-script replay rejects ambiguity and ignores ELF", async () => {
  assert.equal(parseG17GnuLinkerScript(await readFile("/usr/bin/true")), null);
  assert.throws(
    () => parseG17GnuLinkerScript(Buffer.from("GROUP(libc.so libc.so)\n")),
    /duplicated/u,
  );
  assert.throws(
    () => parseG17GnuLinkerScript(Buffer.from("GROUP(libc.so\n")),
    /unbalanced/u,
  );
});

test("native ELF replay is filesystem- and process-free", async () => {
  const source = await readFile(
    new URL("../src/qualification/native-elf.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["'](?:node:)?(?:child_process|fs(?:\/promises)?)["']|\bprocess\s*(?:\.|\[)/u,
  );
});
