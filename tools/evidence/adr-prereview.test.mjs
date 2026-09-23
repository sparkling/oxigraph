import assert from "node:assert/strict";
import test from "node:test";
import { findings } from "./adr-prereview.mjs";
import { EMPTY_DIFF_SHA256 } from "./receipt-evidence.mjs";

const context = {
  commitExists: (hash) => hash.startsWith("fede6934"),
  receiptSource: (name) =>
    ({
      "run-CLEAN1": { head: "fede6934aaaa", trackedDiffSha256: EMPTY_DIFF_SHA256 },
      "run-DIRTY1": { head: "f24f54e4aaaa", trackedDiffSha256: "ebdb98c0" },
    })[name] ?? null,
};

test("clean text has no findings", () => {
  assert.deepEqual(findings("Applied in `fede6934`, receipt `run-CLEAN1`.", context), []);
});

test("self-reference, unknown commit, missing and dirty receipts are reported", () => {
  const kinds = findings(
    [
      "This commit adds the fix.",
      "See `deadbeef` and `run-NOPE00`.",
      "Tests pass (`run-DIRTY1`).",
    ].join("\n"),
    context,
  ).map((finding) => `${finding.line}:${finding.kind}`);
  assert.deepEqual(kinds, ["1:self-reference", "2:missing-receipt", "2:unknown-commit", "3:dirty-receipt"]);
});

test("a dirty receipt explicitly marked superseded is allowed", () => {
  assert.deepEqual(findings("`run-DIRTY1` is superseded and not evidence.", context), []);
});

test("the superseded note may wrap onto the next line of the paragraph", () => {
  assert.deepEqual(findings("An earlier run, `run-DIRTY1`, ran with the change\nuncommitted. It is superseded.", context), []);
});

test("allowed external commits are not reported", () => {
  assert.deepEqual(findings("Pinned at `0ccfab4f2832`.", { ...context, allowedCommits: ["0ccfab4f28324edaac59"] }), []);
});
