import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { resolveNativeExecutable } from "../src/native/executable.mjs";

test("native executable resolution skips PATH shadows and attests trusted absolute bytes", async () => {
  const shadowRoot = await mkdtemp(join(tmpdir(), "oxigraph-shadow-"));
  try {
    const shadow = join(shadowRoot, "codex");
    await writeFile(shadow, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(shadow, 0o755);
    const attestation = resolveNativeExecutable(
      "codex",
      `${shadowRoot}${delimiter}${process.env.PATH ?? ""}`,
    );
    assert.notEqual(attestation.path, shadow);
    assert.ok(attestation.path.startsWith("/"));
    assert.match(attestation.sha256, /^[0-9a-f]{64}$/);
    assert.throws(
      () => resolveNativeExecutable("codex", shadowRoot),
      /no trusted codex executable/,
    );
  } finally {
    await rm(shadowRoot, { recursive: true, force: true });
  }
});
