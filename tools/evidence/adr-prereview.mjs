#!/usr/bin/env node
// Cheap checks run before an independent review, aimed at the write-up
// defects reviewers rejected most often: a cited commit or receipt that does
// not exist, a receipt taken on a dirty tree, and self-referential wording
// ("this commit") that goes stale on the next record-only commit.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EMPTY_DIFF_SHA256 } from "./receipt-evidence.mjs";

const SELF_REFERENCE = /\b(this|the present|the current) commit\b/gi;
const RECEIPT = /`(run-[A-Za-z0-9]{6})`/g;
const COMMIT = /`([0-9a-f]{8,40})`/g;

// A dirty receipt is acceptable only when its paragraph says it is not
// evidence; wrapped Markdown splits that note across lines.
function paragraphAt(lines, index) {
  let start = index;
  while (start > 0 && lines[start - 1].trim() !== "") start -= 1;
  let end = index;
  while (end < lines.length - 1 && lines[end + 1].trim() !== "") end += 1;
  return lines.slice(start, end + 1).join(" ");
}

export function findings(text, { commitExists, receiptSource, allowedCommits = [] }) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const at = index + 1;
    for (const match of line.matchAll(SELF_REFERENCE)) {
      out.push({ line: at, kind: "self-reference", detail: `"${match[0]}": name the commit hash instead` });
    }
    for (const [, name] of line.matchAll(RECEIPT)) {
      const source = receiptSource(name);
      if (source === null) {
        out.push({ line: at, kind: "missing-receipt", detail: name });
      } else if (source.trackedDiffSha256 !== EMPTY_DIFF_SHA256 && !/\b(dirty tree|superseded|not evidence)\b/i.test(paragraphAt(lines, index).replace(RECEIPT, ""))) {
        out.push({ line: at, kind: "dirty-receipt", detail: `${name} ran on ${source.head.slice(0, 8)} with a non-empty tracked diff` });
      }
    }
    for (const [, hash] of line.matchAll(COMMIT)) {
      if (/^[0-9]+$/.test(hash)) continue;
      if (allowedCommits.some((allowed) => allowed.startsWith(hash) || hash.startsWith(allowed))) continue;
      // A hash may also be a review session ID or an upstream commit, so an
      // unknown hash is a warning for the author to confirm, not a failure.
      if (!commitExists(hash)) out.push({ line: at, kind: "unknown-commit", warning: true, detail: hash });
    }
  });
  return out;
}

function repoContext(root) {
  return {
    commitExists(hash) {
      try {
        execFileSync("git", ["-C", root, "cat-file", "-e", `${hash}^{commit}`], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    receiptSource(name) {
      const path = join(root, "target/engineering-delivery", name, "result.json");
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8")).source ?? {};
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // --allow-commit HASH names a hash from another repository, such as a
  // pinned upstream specification revision.
  const argv = process.argv.slice(2);
  const allowedCommits = [];
  const files = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--allow-commit") allowedCommits.push(argv[++index]);
    else files.push(argv[index]);
  }
  if (files.length === 0) {
    process.stderr.write("usage: adr-prereview.mjs FILE.md [FILE.md ...]\n");
    process.exit(2);
  }
  const root = resolve(import.meta.dirname, "../..");
  const context = { ...repoContext(root), allowedCommits };
  let count = 0;
  for (const file of files) {
    for (const finding of findings(readFileSync(file, "utf8"), context)) {
      if (!finding.warning) count += 1;
      const level = finding.warning ? "warning" : "error";
      process.stdout.write(`${file}:${finding.line}: ${level}: ${finding.kind}: ${finding.detail}\n`);
    }
  }
  process.exitCode = count === 0 ? 0 : 1;
}
