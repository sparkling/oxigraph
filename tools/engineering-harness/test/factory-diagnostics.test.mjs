import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { diagnoseFactory } from "../src/factory-diagnostics.mjs";

async function fixture(host) {
  const root = await mkdtemp(join(tmpdir(), `oxigraph-factory-${host}-`));
  await mkdir(join(root, "bin"));
  const cli = join(root, "bin/cli.js");
  await writeFile(
    cli,
    "#!/usr/bin/env node\nif (process.argv.includes('--help')) { console.log('init doctor'); process.exit(0); } console.error('Unknown command'); process.exit(2);\n",
  );
  await chmod(cli, 0o755);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      publishConfig: { access: "public" },
      dependencies: { "@metaharness/kernel": "^0.1.0" },
    }),
  );
  if (host === "claude-code") {
    await mkdir(join(root, ".claude"));
    await writeFile(
      join(root, ".claude/settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(npx claude*)", "Bash(npm run*)"] },
        mcpServers: {
          generated: { command: "npx", args: ["generated@latest", "mcp", "start"] },
          index: { command: "npx", args: ["generated@latest", "mcp", "index"] },
        },
      }),
    );
  } else {
    await mkdir(join(root, ".codex"));
    await writeFile(
      join(root, ".codex/config.toml"),
      '[mcp_servers.generated]\ncommand = "npx"\nargs = ["generated@latest", "mcp", "start"]\n',
    );
  }
  return root;
}

test("factory diagnostics reject generated claims that the generated CLI cannot serve", async () => {
  const claude = diagnoseFactory(await fixture("claude-code"), "claude-code");
  const codex = diagnoseFactory(await fixture("codex"), "codex");
  assert.equal(claude.accepted, false);
  assert.equal(codex.accepted, false);
  assert.ok(claude.issues.includes("declared-mcp-command-missing"));
  assert.ok(claude.issues.includes("declared-mcp-index-command-unreviewed"));
  assert.ok(claude.issues.includes("broad-shell-permission"));
  assert.ok(codex.issues.includes("declared-mcp-command-missing"));
  assert.ok(codex.issues.includes("public-publish-config"));
  assert.ok(codex.issues.includes("legacy-caret-dependencies"));
});
