#!/usr/bin/env node

import { COMMANDS } from "../src/command-registry.mjs";
import { doctorReport } from "../src/doctor.mjs";
import { diagnoseFactory } from "../src/factory-diagnostics.mjs";
import { verifyApplicationReceipt } from "../src/receipts/application.mjs";
import { RouterHistory } from "../src/routing/history.mjs";
import {
  replayG12ProgrammeReceipt,
  replayG13ProgrammeReceipt,
  replayG14ProgrammeReceipt,
  replayG15ProgrammeReceipt,
  replayG15bProgrammeReceipt,
  replayG15cProgrammeReceipt,
  runG12Programme,
  runG13Programme,
  runG14Programme,
  runG15Programme,
  runG15bProgramme,
  runG15cProgramme,
} from "../src/runtime/g12-programme.mjs";
import {
  runG12Preflight,
  runG13Preflight,
  runG14Preflight,
  runG15Preflight,
  runG15bPreflight,
  runG15cPreflight,
} from "../src/runtime/preflight.mjs";
import {
  isIgnoredRuntimePath,
  readPrivateRuntimeArtifact,
  runtimePath,
} from "../src/runtime/storage.mjs";

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
  if (args[0] === "g1.2" && args[1] === "preflight" && args.length === 2) {
    const preflight = await runG12Preflight({ signal: shutdown.signal });
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.g1.2-preflight-result/v1",
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "g1.3" && args[1] === "preflight" && args.length === 2) {
    const preflight = await runG13Preflight({ signal: shutdown.signal });
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.g1.3-preflight-result/v1",
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "g1.4" && args[1] === "preflight" && args.length === 2) {
    const preflight = await runG14Preflight({ signal: shutdown.signal });
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.g1.4-preflight-result/v1",
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "g1.5" && args[1] === "preflight" && args.length === 2) {
    const preflight = await runG15Preflight({ signal: shutdown.signal });
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.g1.5-preflight-result/v1",
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "g1.5b" && args[1] === "preflight" && args.length === 2) {
    const preflight = await runG15bPreflight({ signal: shutdown.signal });
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.g1.5b-preflight-result/v1",
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "g1.5c" && args[1] === "preflight" && args.length === 2) {
    const preflight = await runG15cPreflight({ signal: shutdown.signal });
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.g1.5c-preflight-result/v1",
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "g1.2" && args[1] === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error("usage: g1.2 run [--run-id <safe-id>]");
    }
    const result = await runG12Programme({ runId, signal: shutdown.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.3" && args[1] === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error("usage: g1.3 run [--run-id <safe-id>]");
    }
    const result = await runG13Programme({ runId, signal: shutdown.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.4" && args[1] === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error("usage: g1.4 run [--run-id <safe-id>]");
    }
    const result = await runG14Programme({ runId, signal: shutdown.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.5" && args[1] === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error("usage: g1.5 run [--run-id <safe-id>]");
    }
    const result = await runG15Programme({ runId, signal: shutdown.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.5b" && args[1] === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error("usage: g1.5b run [--run-id <safe-id>]");
    }
    const result = await runG15bProgramme({ runId, signal: shutdown.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.5c" && args[1] === "run") {
    const runId = optionalValue(args, "--run-id");
    const allowedLength = runId === undefined ? 2 : 4;
    if (args.length !== allowedLength) {
      throw new Error("usage: g1.5c run [--run-id <safe-id>]");
    }
    const result = await runG15cProgramme({ runId, signal: shutdown.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.2" && args[1] === "replay" && args.length === 4) {
    const result = await replayG12ProgrammeReceipt({
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.3" && args[1] === "replay" && args.length === 4) {
    const result = await replayG13ProgrammeReceipt({
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.4" && args[1] === "replay" && args.length === 4) {
    const result = await replayG14ProgrammeReceipt({
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.5" && args[1] === "replay" && args.length === 4) {
    const result = await replayG15ProgrammeReceipt({
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.5b" && args[1] === "replay" && args.length === 4) {
    const result = await replayG15bProgrammeReceipt({
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "g1.5c" && args[1] === "replay" && args.length === 4) {
    const result = await replayG15cProgrammeReceipt({
      name: value(args, "--receipt"),
      signal: shutdown.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.final.verdict === "REJECT") process.exitCode = 3;
    if (result.final.verdict === "INCONCLUSIVE") process.exitCode = 4;
    return;
  }
  if (args[0] === "receipt" && args[1] === "verify" && args.length === 4) {
    const name = value(args, "--receipt");
    const bytes = (await readPrivateRuntimeArtifact(name)).toString("utf8");
    const verification = verifyApplicationReceipt(bytes);
    if (!verification.ok) throw new Error(`invalid application receipt: ${verification.reason}`);
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.application-receipt-verification/v1",
          name,
          receiptSha256: verification.receiptSha256,
          entryCount: verification.entryCount,
          tailSha256: verification.tailSha256,
          run: verification.receipt.run,
          final: verification.receipt.final,
          selectedCandidate: verification.receipt.selectedCandidate,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (args[0] === "history" && args[1] === "inspect" && args.length === 2) {
    const path = await runtimePath("router-history.jsonl");
    const history = await RouterHistory.open({ path, isIgnoredRuntimePath });
    const entries = await history.reload();
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "oxigraph.router-history-inspection/v1",
          path,
          entryCount: entries.length,
          tailSha256: entries.at(-1)?.entrySha256 ?? null,
          entries,
        },
        null,
        2,
      )}\n`,
    );
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
