import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import { G17_COMPATIBILITY_EVIDENCE_SCHEMA } from "../src/qualification/evidence-contract.mjs";
import {
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  g17G14bPrerequisiteProjectionSha256,
  replayG17G14bPrerequisite,
} from "../src/qualification/g14b-prerequisite.mjs";
import {
  combineG17CompatibilityEvidence,
  g17AgenticProfileContract,
  inspectG17AgenticEvidence,
  verifyG17ImplementationFiles,
} from "../src/qualification/application-evidence.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function acceptedG14b() {
  const encoded = await readFile(
    new URL(
      "fixtures/g14b-accepted-application-receipt-v6.json.gz.b64",
      import.meta.url,
    ),
    "utf8",
  );
  const bytes = gunzipSync(
    Buffer.from(encoded.replaceAll(/\s/gu, ""), "base64"),
  );
  const projection = replayG17G14bPrerequisite({ receiptBytes: bytes });
  return Object.freeze({
    status: "PASS",
    sha256: g17G14bPrerequisiteProjectionSha256(projection),
    reasons: Object.freeze([]),
    projection,
    artifacts: Object.freeze([
      Object.freeze({
        name: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
        bytes,
      }),
    ]),
  });
}

test("G1.7 contract matches the checked-in 11-command/66-test Agentic profile definition", () => {
  const { contract } = loadG17Contract();
  assert.deepEqual(g17AgenticProfileContract(contract), {
    profile: "g1-regression",
    commandIds: contract.compatibility.agenticQe.commandIds,
    expectedCommands: 11,
    expectedPassedTests: 66,
  });
});

test("missing fixed Agentic publication is evidence-missing, not success", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-agentic-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { contract } = loadG17Contract();
  assert.deepEqual(
    await inspectG17AgenticEvidence({
      contract,
      identity: { subject: { commit: "a".repeat(40) } },
      evidenceRepositoryRoot: root,
      maximumGeneratedAtMs: Date.now(),
    }),
    {
      status: "MISSING",
      sha256: null,
      reasons: ["agentic-receipt-absent"],
      projection: null,
      artifacts: [],
    },
  );
});

test("G1.7 reopens legitimate empty implementation inputs without weakening evidence files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-empty-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(0);
  await writeFile(join(root, "empty.rs"), bytes);
  const files = [{ path: "empty.rs", bytes: 0, sha256: sha256(bytes) }];
  assert.doesNotThrow(() =>
    verifyG17ImplementationFiles(
      {
        implementation: {
          files,
          contentHash: sha256(JSON.stringify(files)),
        },
      },
      root,
    ),
  );

  files[0].sha256 = "0".repeat(64);
  assert.throws(
    () =>
      verifyG17ImplementationFiles(
        {
          implementation: {
            files,
            contentHash: sha256(JSON.stringify(files)),
          },
        },
        root,
      ),
    /differs from its receipt/u,
  );
});

test("compatibility combiner always emits the explicit current outer schema", () => {
  const missing = Object.freeze({
    status: "MISSING",
    sha256: null,
    reasons: Object.freeze(["fixture-missing"]),
    projection: null,
    artifacts: Object.freeze([]),
  });
  const result = combineG17CompatibilityEvidence({
    agenticQe: missing,
    native: missing,
  });
  assert.equal(result.status, "MISSING");
  assert.equal(result.projection.schema, G17_COMPATIBILITY_EVIDENCE_SCHEMA);
  assert.equal(result.projection.status, "MISSING");
  assert.deepEqual(result.projection.applicationReceipts, []);
  assert.deepEqual(result.reasons, [
    "fixture-missing",
    "fixture-missing",
    "g1.4b-application-receipt-absent",
  ]);
});

test("compatibility PASS requires and copies the exactly replayed G1.4b prerequisite", async () => {
  const pass = Object.freeze({
    status: "PASS",
    sha256: "0".repeat(64),
    reasons: Object.freeze([]),
    projection: Object.freeze({ status: "PASS" }),
    artifacts: Object.freeze([]),
  });
  const g14bPrerequisite = await acceptedG14b();
  const result = combineG17CompatibilityEvidence({
    agenticQe: pass,
    native: pass,
    g14bPrerequisite,
  });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.projection.applicationReceipts, [
    g14bPrerequisite.projection,
  ]);
  assert.equal(
    result.artifacts.at(-1).name,
    G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  );

  const fabricated = {
    ...g14bPrerequisite,
    projection: structuredClone(g14bPrerequisite.projection),
  };
  fabricated.projection.binding.claim.crashDurability = true;
  assert.throws(
    () =>
      combineG17CompatibilityEvidence({
        agenticQe: pass,
        native: pass,
        g14bPrerequisite: fabricated,
      }),
    /prerequisite PASS projection drifted/u,
  );
});
test("application evidence module has no Router, admission, or replay authority imports", async () => {
  const source = await readFile(
    new URL("../src/qualification/application-evidence.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /RouterHistory|QualityFirstRouter|admitApplication|verifyPinnedApplication|replayApplication|applicationReceiptQuality/u,
  );
});
