#!/usr/bin/env node

import { COMMANDS } from "../src/command-registry.mjs";
import { doctorReport } from "../src/doctor.mjs";
import { diagnoseFactory } from "../src/factory-diagnostics.mjs";

function value(args, option) {
  const index = args.indexOf(option);
  if (index < 0 || index + 1 >= args.length) {
    throw new Error(`missing ${option}`);
  }
  return args[index + 1];
}

function help() {
  return [
    "Usage: oxigraph-engineering-harness <command>",
    "",
    ...COMMANDS.map(({ usage }) => `  ${usage}`),
  ].join("\n");
}

async function main(args) {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (args[0] === "version" || args[0] === "--version") {
    process.stdout.write("0.0.0\n");
    return;
  }
  if (args[0] === "doctor" && args.length === 1) {
    process.stdout.write(`${JSON.stringify(await doctorReport(), null, 2)}\n`);
    return;
  }
  if (args[0] === "factory" && args[1] === "diagnose") {
    const runTests = args.includes("--run-tests");
    const reports = [
      diagnoseFactory(value(args, "--claude"), "claude-code", { runTests }),
      diagnoseFactory(value(args, "--codex"), "codex", { runTests }),
    ];
    process.stdout.write(`${JSON.stringify({ schema: 1, reports }, null, 2)}\n`);
    return;
  }
  throw new Error(`unknown command: ${args.join(" ")}`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`engineering harness: ${error.message}\n`);
  process.exitCode = 2;
});
