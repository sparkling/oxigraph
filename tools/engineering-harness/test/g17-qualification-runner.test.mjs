import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalSha256 } from "../src/routing/features.mjs";
import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  preflightG17Qualification,
  runG17Qualification,
} from "../src/qualification/runner.mjs";
import { verifySealedG17Run } from "../src/qualification/verifier.mjs";

function identity() {
  const binding = {
    schema: "oxigraph.g1.7-qualified-subject-identity/v1",
    subject: {
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      trackedClean: true,
    },
    control: {
      controlCommit: "a".repeat(40),
      harnessSha256: "c".repeat(64),
    },
    evaluator: {
      commit: "d".repeat(40),
      blobSetSha256: "e".repeat(64),
    },
    cargoLock: { blob: "f".repeat(40), sha256: "1".repeat(64) },
    toolchain: [],
    host: { targetTriple: "x86_64-unknown-linux-gnu" },
  };
  return { ...binding, identitySha256: canonicalSha256(binding) };
}

function missing(status, reason) {
  return {
    status,
    sha256: status === "MISSING" ? null : "2".repeat(64),
    reasons: [reason],
    projection: null,
    artifacts: [],
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-runner-"));
  await chmod(root, 0o700);
  const runsRoot = join(root, "runs");
  await mkdir(runsRoot, { mode: 0o700 });
  t.after(async () => {
    for (const entry of await readdir(runsRoot).catch(() => [])) {
      await chmod(join(runsRoot, entry), 0o700).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  });
  return { root, runsRoot };
}

test("G1.7 preflight reports honest inconclusive decisions without side effects", async () => {
  const loaded = loadG17Contract();
  const result = await preflightG17Qualification({
    contractLoader: () => loaded,
    identityProvider: async () => identity(),
  });
  assert.equal(result.schema, "oxigraph.g1.7-qualification-preflight/v1");
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.ok(result.final.reasons.includes("reference-unselected"));
  assert.ok(result.final.reasons.includes("performance-budget-absent"));
  assert.ok(result.final.reasons.includes("noise-budget-absent"));
  assert.deepEqual(result.authority, {
    localOnly: true,
    promotionAuthority: false,
    routerQualityAuthority: false,
    publicationAuthority: false,
  });
});

test("G1.7 run writes artifacts first, receipt last, and independently verifies sealed bytes", async (t) => {
  const { root, runsRoot } = await fixture(t);
  const routerHistory = join(root, "router-history.jsonl");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(routerHistory, "immutable-router-history\n", { mode: 0o600 }),
  );
  const beforeHistory = await readFile(routerHistory);
  const loaded = loadG17Contract();
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await runG17Qualification({
    runId: "run-00000001",
    runsRoot,
    contractLoader: () => loaded,
    identityProvider: async () => identity(),
    semanticProvider: async () => missing("MISSING", "independent-verification-absent"),
    compatibilityProvider: async () => missing("STALE", "agentic-evidence-stale"),
    clock: () => times.shift(),
  });
  assert.equal(result.receipt.final.verdict, "INCONCLUSIVE");
  assert.equal(result.receipt.benchmark.status, "NOT_RUN");
  assert.deepEqual(await readFile(routerHistory), beforeHistory);

  const verification = await verifySealedG17Run({
    runId: result.receipt.run.id,
    runsRoot,
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.receiptSha256, result.receipt.receiptSha256);
  assert.equal(verification.verdict, "INCONCLUSIVE");
  await assert.rejects(
    runG17Qualification({
      runId: "run-00000001",
      runsRoot,
      contractLoader: () => loaded,
      identityProvider: async () => identity(),
      semanticProvider: async () => missing("MISSING", "missing"),
      compatibilityProvider: async () => missing("MISSING", "missing"),
    }),
    /already exists/u,
  );
});

test("sealed verifier imports no live identity, evidence, process, Git, or Router modules", async () => {
  const source = await readFile(
    new URL("../src/qualification/verifier.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /currentG17|application-evidence|child_process|Router|routing\/history|\bgit\b/u,
  );
});

test("sealed verifier rejects a hash-consistent compatibility PASS without copied owner evidence", async (t) => {
  const { runsRoot } = await fixture(t);
  const loaded = loadG17Contract();
  const projection = {
    status: "PASS",
    agenticQe: {
      status: "PASS",
      subjectCommit: "a".repeat(40),
      profile: "g1-regression",
      runId: "00000000-0000-4000-8000-000000000000",
      generatedAt: "2026-08-26T17:59:59.000Z",
      commandCount: 11,
      passedTests: 66,
      receiptSha256: "1".repeat(64),
      oracleSha256: "2".repeat(64),
      contentHash: "3".repeat(64),
      executionHash: "4".repeat(64),
      implementationContentHash: "5".repeat(64),
      artifactContentHash: "6".repeat(64),
      archiveContentHash: "7".repeat(64),
      archiveFileCount: 1,
    },
    native: [],
    applicationReceipts: [],
  };
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await runG17Qualification({
    runId: "run-vacuous-pass",
    runsRoot,
    contractLoader: () => loaded,
    identityProvider: async () => identity(),
    semanticProvider: async () => missing("MISSING", "missing"),
    compatibilityProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: [],
      projection,
      artifacts: [],
    }),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /compatibility PASS artifacts are incomplete/u,
  );
});
