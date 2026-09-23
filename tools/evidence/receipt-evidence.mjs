#!/usr/bin/env node
// Render ADR evidence table rows directly from delivery receipts, so a
// written claim cannot drift from what the receipt recorded. Each row states
// the receipt's own head and whether its tracked diff was empty.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EMPTY_DIFF_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// Counts compiler/Clippy diagnostics from the per-target "generated N
// warnings" summaries, which cover rustc lints as well as Clippy's own.
export function countWarnings(log) {
  let total = 0;
  for (const match of log.matchAll(/generated (\d+) warnings?/g)) {
    total += Number(match[1]);
  }
  return total;
}

export function summarizeReceipt(name, receipt, stderr = "") {
  const source = receipt.source ?? {};
  const result = receipt.result ?? {};
  const clean =
    source.trackedDiffSha256 === EMPTY_DIFF_SHA256 &&
    (source.untracked ?? []).length === 0;
  const cargo = result.observedCargoTestSummary?.summaries ?? [];
  const tests =
    cargo.length > 0
      ? {
          passed: cargo.reduce((sum, entry) => sum + entry.passed, 0),
          failed: cargo.reduce((sum, entry) => sum + entry.failed, 0),
          ignored: cargo.reduce((sum, entry) => sum + entry.ignored, 0),
        }
      : null;
  return {
    receipt: name,
    command: result.display ?? [receipt.command?.program, ...(receipt.command?.args ?? [])].join(" "),
    head: (source.head ?? "").slice(0, 8),
    clean,
    sourceStable: receipt.sourceStable === true,
    status: receipt.status,
    exitCode: result.code ?? null,
    tests,
    warnings: countWarnings(stderr),
  };
}

export function renderRow(summary) {
  const outcome = [summary.status, `exit ${summary.exitCode}`];
  if (summary.warnings > 0) outcome.push(`**${summary.warnings} compiler warnings**`);
  if (summary.tests) {
    outcome.push(
      `${summary.tests.passed} passed, ${summary.tests.failed} failed, ${summary.tests.ignored} ignored`,
    );
  }
  const source = summary.clean ? "clean" : "**dirty: not evidence for a commit**";
  return `| \`${summary.command}\` | \`${summary.receipt}\` | \`${summary.head}\` | ${source} | ${outcome.join("; ")} |`;
}

export const HEADER = [
  "| Command | Receipt | Head | Source | Outcome |",
  "| --- | --- | --- | --- | --- |",
];

export function render(root, names) {
  const rows = names.map((name) => {
    const directory = join(root, "target/engineering-delivery", name);
    const receipt = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
    let stderr = "";
    try {
      stderr = readFileSync(join(directory, "stderr.log"), "utf8");
    } catch {
      // Older receipts may lack a captured log; report no warnings then.
    }
    return renderRow(summarizeReceipt(name, receipt, stderr));
  });
  return [...HEADER, ...rows].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    process.stderr.write("usage: receipt-evidence.mjs run-XXXXXX [run-YYYYYY ...]\n");
    process.exit(2);
  }
  process.stdout.write(`${render(resolve(import.meta.dirname, "../.."), names)}\n`);
}
