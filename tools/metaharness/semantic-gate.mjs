#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, "../..");
const adapter = resolve(repoRoot, "tools/agentic-qe/oxigraph-aqe.mjs");

const child = spawn(
  process.execPath,
  [adapter, "run", "metaharness-semantic-gate"],
  {
    cwd: repoRoot,
    env: process.env,
    shell: false,
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`unable to start the semantic gate: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`semantic gate terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
