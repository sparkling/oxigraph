#!/usr/bin/env node

import { COMMANDS } from "../src/command-registry.mjs";
import { doctorReport } from "../src/doctor.mjs";
import { diagnoseFactory } from "../src/factory-diagnostics.mjs";
import { verifyApplicationReceipt } from "../src/receipts/application.mjs";
import { RouterHistory } from "../src/routing/history.mjs";
import {
  replayTaskProgrammeReceipt,
  runTaskProgramme,
} from "../src/runtime/g12-programme.mjs";
import { runTaskPreflight } from "../src/runtime/preflight.mjs";
import {
  isIgnoredRuntimePath,
  readPrivateRuntimeArtifact,
  runtimePath,
} from "../src/runtime/storage.mjs";
import {
  engineeringTaskRegistry,
  taskProfileBySlug,
} from "../src/task-profile.mjs";

const registeredTaskSlugs = new Set(
  engineeringTaskRegistry.map(({ slug }) => slug),
);

function value(args, option) {
  const index = args.indexOf(option);
  if (index < 0 || index + 1 >= args.length) {
    throw new Error(`missing ${option}`);
  }
  return args[index + 1];
}

function optionalValue(args, option) {
  return args.includes(option) ? value(args, option) : undefined;
}

function help() {
  return [
    "Usage: oxigraph-engineering-harness <command>",
    "",
    ...COMMANDS.map(({ usage }) => `  ${usage}`),
  ].join("\n");
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function applyVerdictExit(result) {
  if (result.final.verdict === "REJECT") process.exitCode = 3;
  if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
}

function publicPreflightResult(profile, preflight) {
  return {
    schema: `oxigraph.${profile.slug}-preflight-result/v1`,
    contractId: preflight.contract.id,
    contractSha256: preflight.contractSha256,
    harnessSha256: preflight.control.harnessSha256,
    evaluator: {
      commit: preflight.contract.evaluator.commit,
      tree: preflight.contract.evaluator.tree,
      patchSha256: preflight.contract.evaluator.patchSha256,
    },
    redBaseline: preflight.redBaseline,
    submodules: preflight.submodules,
    localOnly: true,
    promotionAuthority: false,
  };
}

async function dispatchRegisteredTask(profile, args) {
  const action = args[1];
  if (action === "preflight" && args.length === 2) {
    const preflight = await runTaskPreflight({
      taskId: profile.id,
      signal: shutdown.signal,
    });
    print(publicPreflightResult(profile, preflight));
    return true;
  }

  if (action === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error(`usage: ${profile.slug} run [--run-id <safe-id>]`);
    }
    const result = await runTaskProgramme({
      taskId: profile.id,
      runId,
      signal: shutdown.signal,
    });
    print(result);
    applyVerdictExit(result);
    return true;
  }

  if (action === "replay" && args.length === 4) {
    const result = await replayTaskProgrammeReceipt({
      taskId: profile.id,
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    print(result);
    applyVerdictExit(result);
    return true;
  }

  return false;
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
    print(await doctorReport());
    return;
  }

  if (registeredTaskSlugs.has(args[0])) {
    const profile = taskProfileBySlug(args[0]);
    if (await dispatchRegisteredTask(profile, args)) return;
  }

  if (args[0] === "receipt" && args[1] === "verify" && args.length === 4) {
    const name = value(args, "--receipt");
    const bytes = (await readPrivateRuntimeArtifact(name)).toString("utf8");
    const verification = verifyApplicationReceipt(bytes);
    if (!verification.ok) {
      throw new Error(`invalid application receipt: ${verification.reason}`);
    }
    print({
      schema: "oxigraph.application-receipt-verification/v1",
      name,
      receiptSha256: verification.receiptSha256,
      entryCount: verification.entryCount,
      tailSha256: verification.tailSha256,
      run: verification.receipt.run,
      final: verification.receipt.final,
      selectedCandidate: verification.receipt.selectedCandidate,
    });
    return;
  }
  if (args[0] === "history" && args[1] === "inspect" && args.length === 2) {
    const path = await runtimePath("router-history.jsonl");
    const history = await RouterHistory.open({ path, isIgnoredRuntimePath });
    const entries = await history.reload();
    print({
      schema: "oxigraph.router-history-inspection/v1",
      path,
      entryCount: entries.length,
      tailSha256: entries.at(-1)?.entrySha256 ?? null,
      entries,
    });
    return;
  }
  if (args[0] === "factory" && args[1] === "diagnose") {
    const runTests = args.includes("--run-tests");
    const reports = [
      diagnoseFactory(value(args, "--claude"), "claude-code", { runTests }),
      diagnoseFactory(value(args, "--codex"), "codex", { runTests }),
    ];
    print({ schema: 1, reports });
    return;
  }
  throw new Error(`unknown command: ${args.join(" ")}`);
}

const shutdown = new AbortController();
const abort = () => shutdown.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

main(process.argv.slice(2))
  .catch((error) => {
    const recovery =
      typeof error.receiptPath === "string"
        ? `; replayable receipt: ${error.receiptPath}`
        : "";
    process.stderr.write(`engineering harness: ${error.message}${recovery}\n`);
    process.exitCode = 2;
  })
  .finally(() => {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  });
