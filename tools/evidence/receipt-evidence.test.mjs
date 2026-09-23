import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_DIFF_SHA256, renderRow, summarizeReceipt } from "./receipt-evidence.mjs";

function receipt(overrides = {}) {
  return {
    status: "command-passed",
    sourceStable: true,
    command: { program: "cargo", args: ["test", "-p", "oxshacl"] },
    source: { head: "0df117ff745f", trackedDiffSha256: EMPTY_DIFF_SHA256, untracked: [] },
    result: {
      display: "cargo test -p oxshacl",
      code: 0,
      observedCargoTestSummary: {
        summaries: [
          { passed: 100, failed: 0, ignored: 1 },
          { passed: 143, failed: 0, ignored: 0 },
        ],
      },
    },
    ...overrides,
  };
}

test("clean cargo receipt sums every test binary", () => {
  const summary = summarizeReceipt("run-A", receipt());
  assert.equal(summary.clean, true);
  assert.equal(summary.head, "0df117ff");
  assert.deepEqual(summary.tests, { passed: 243, failed: 0, ignored: 1 });
  assert.equal(
    renderRow(summary),
    "| `cargo test -p oxshacl` | `run-A` | `0df117ff` | clean | command-passed; exit 0; 243 passed, 0 failed, 1 ignored |",
  );
});

test("a dirty tracked diff is flagged, never reported as clean", () => {
  const summary = summarizeReceipt(
    "run-B",
    receipt({ source: { head: "f24f54e4aa", trackedDiffSha256: "ebdb98c0", untracked: [] } }),
  );
  assert.equal(summary.clean, false);
  assert.match(renderRow(summary), /dirty: not evidence for a commit/);
});

test("untracked files also make the source dirty", () => {
  const summary = summarizeReceipt(
    "run-C",
    receipt({ source: { head: "abc", trackedDiffSha256: EMPTY_DIFF_SHA256, untracked: ["x.rs"] } }),
  );
  assert.equal(summary.clean, false);
});

test("a non-cargo failed receipt reports its exit code without test counts", () => {
  const summary = summarizeReceipt(
    "run-D",
    receipt({
      status: "failed",
      command: { program: "node", args: ["tools/shacl-tests/run.mjs"] },
      result: { display: "node tools/shacl-tests/run.mjs", code: 1 },
    }),
  );
  assert.equal(summary.tests, null);
  assert.match(renderRow(summary), /failed; exit 1 \|$/);
});
