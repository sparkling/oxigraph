#!/usr/bin/env node

import {
  g17VerificationExitCode,
  g17VerdictExitCode,
  parseG17CliArgs,
} from "../src/qualification/cli.mjs";
import {
  preflightG17Qualification,
  runG17Qualification,
} from "../src/qualification/runner.mjs";
import { verifySealedG17Run } from "../src/qualification/verifier.mjs";

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function applyVerdictExit(verdict) {
  process.exitCode = g17VerdictExitCode(verdict);
}

async function main(args) {
  const command = parseG17CliArgs(args);
  if (command.action === "preflight") {
    const result = await preflightG17Qualification();
    print(result);
    applyVerdictExit(result.final.verdict);
    return;
  }
  if (command.action === "run") {
    const result = await runG17Qualification({ runId: command.runId });
    print(result);
    applyVerdictExit(result.receipt.final.verdict);
    return;
  }
  const result = await verifySealedG17Run({ runId: command.runId });
  print(result);
  process.exitCode = g17VerificationExitCode(result);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`G1.7 qualification: ${error.message}\n`);
  process.exitCode = 2;
});
