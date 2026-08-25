import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeInvocation } from "../src/native/claude.mjs";
import { codexInvocation } from "../src/native/codex.mjs";
import { validateProviderInvocation } from "../src/policy/providers.mjs";

test("native invocations are explicit, read-only, ephemeral, and provider-local", () => {
  const executionRoot = mkdtempSync(join(tmpdir(), "oxigraph-provider-test-"));
  try {
    const codex = codexInvocation({
      executionRoot,
      model: "gpt-5.6-sol",
      prompt: "inspect",
    });
    const claude = claudeInvocation({
      executionRoot,
      model: "opus",
      prompt: "inspect",
    });
    assert.equal(validateProviderInvocation(codex), true);
    assert.equal(validateProviderInvocation(claude), true);
    assert.ok(codex.args.includes("read-only"));
    assert.ok(codex.args.includes("--ignore-user-config"));
    assert.ok(!codex.args.includes("--enable"));
    assert.ok(codex.args.includes("shell_tool"));
    assert.ok(claude.args.includes("--safe-mode"));
    assert.ok(claude.args.includes('{"mcpServers":{}}'));
    assert.equal(claude.args[claude.args.indexOf("--tools") + 1], "");
    const claudeSchema = JSON.parse(
      claude.args[claude.args.indexOf("--json-schema") + 1],
    );
    assert.equal(Object.hasOwn(claudeSchema, "$schema"), false);
    assert.deepEqual(claudeSchema.required, [
      "summary",
      "patch",
      "findings",
      "verdict",
    ]);
    assert.ok(!claude.args.includes("--bare"));
    for (const invocation of [codex, claude]) {
      assert.doesNotMatch(JSON.stringify(invocation.args), /openrouter/i);
      assert.ok(invocation.executable.startsWith("/"));
      assert.match(invocation.attestation.sha256, /^[0-9a-f]{64}$/);
      assert.ok(!Object.keys(invocation.environment).some((name) => /token|secret|api_?key/i.test(name)));
    }
  } finally {
    rmSync(executionRoot, { recursive: true, force: true });
  }
});

test("provider policy rejects cross-provider and authority injection", () => {
  const executionRoot = mkdtempSync(join(tmpdir(), "oxigraph-provider-test-"));
  try {
    const canonical = codexInvocation({
      executionRoot,
      model: "gpt-test",
      prompt: "inspect",
    });
    for (const injected of [
      [...canonical.args, "--sandbox", "danger-full-access"],
      [...canonical.args, "-s", "danger-full-access"],
      [...canonical.args, "--config=provider=openrouter"],
    ]) {
      assert.throws(
        () => validateProviderInvocation({ ...canonical, args: injected }),
        /canonical|OpenRouter|prohibited/,
      );
    }
    assert.throws(
      () =>
        validateProviderInvocation({
          ...canonical,
          executable: "/tmp/codex",
        }),
      /attested native executable/,
    );
    assert.throws(
      () =>
        validateProviderInvocation({
          ...canonical,
          environment: { ...canonical.environment, HOME: "/tmp/fake-home" },
        }),
      /canonical minimal environment/,
    );
  } finally {
    rmSync(executionRoot, { recursive: true, force: true });
  }
});
