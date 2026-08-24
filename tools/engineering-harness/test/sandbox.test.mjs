import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runSandboxCommand,
  sandboxArguments,
} from "../src/candidate/sandbox.mjs";

test("verifier sandbox is network-isolated, toolchain-scoped, and workspace-read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-sandbox-test-"));
  const workspace = join(root, "workspace");
  const targetRoot = join(root, "target");
  const commandTemp = join(root, "tmp");
  try {
    await Promise.all(
      [workspace, targetRoot, commandTemp].map((path) =>
        mkdir(path, { mode: 0o700 }),
      ),
    );
    const args = sandboxArguments({
      workspace,
      targetRoot,
      commandTemp,
      argv: ["cargo", "--version"],
      cargoBuildJobs: 2,
    });
    assert.ok(args.includes("--unshare-net"));
    assert.ok(args.includes("--clearenv"));
    const canonicalWorkspace = await realpath(workspace);
    const workspaceSource = args.indexOf(canonicalWorkspace);
    assert.equal(args[workspaceSource - 1], "--ro-bind");
    assert.ok(!args.some((value, index) => value === canonicalWorkspace && args[index - 1] === "--bind"));
    assert.deepEqual(args.slice(args.indexOf("--tmpfs"), args.indexOf("--tmpfs") + 2), [
      "--tmpfs",
      "/home",
    ]);
    const result = await runSandboxCommand({
      workspace,
      targetRoot,
      commandTemp,
      argv: ["cargo", "--version"],
      timeoutMs: 30_000,
      maxOutputBytes: 16_384,
      cargoBuildJobs: 2,
    });
    assert.equal(result.outcome.disposition, "completed");
    assert.equal(result.outcome.exitCode, 0);
    assert.match(result.outcome.stdout, /^cargo /);
    assert.equal(result.network, "isolated");
    assert.equal(result.workspace, "read-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
