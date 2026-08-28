import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  G17_G14B_APPLICATION_RECEIPT_BYTES,
  G17_G14B_APPLICATION_RECEIPT_RAW_SHA256,
  G17_G14B_APPLICATION_RECEIPT_SHA256,
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  G17_G14B_PREREQUISITE_SCHEMA,
  g17G14bPrerequisiteProjectionSha256,
  inspectG17G14bPrerequisite,
  loadG17G14bPrerequisite,
  replayG17G14bPrerequisite,
} from "../src/qualification/g14b-prerequisite.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixtureBytes() {
  const encoded = await readFile(
    new URL(
      "fixtures/g14b-accepted-application-receipt-v6.json.gz.b64",
      import.meta.url,
    ),
    "utf8",
  );
  return gunzipSync(Buffer.from(encoded.replaceAll(/\s/gu, ""), "base64"));
}

test("accepted G1.4b bytes replay to the exact frozen prerequisite boundary", async () => {
  const bytes = await fixtureBytes();
  assert.equal(bytes.length, G17_G14B_APPLICATION_RECEIPT_BYTES);
  assert.equal(sha256(bytes), G17_G14B_APPLICATION_RECEIPT_RAW_SHA256);
  assert.notEqual(bytes.at(-1), 0x0a);

  const projection = replayG17G14bPrerequisite({ receiptBytes: bytes });
  assert.equal(projection.schema, G17_G14B_PREREQUISITE_SCHEMA);
  assert.equal(projection.status, "PASS");
  assert.equal(projection.binding.schema, G17_G14B_PREREQUISITE_BINDING_SCHEMA);
  assert.deepEqual(projection.binding.contract.success, {
    publicPassed: 8,
    independentPassed: 7,
    regressionPassed: 20,
  });
  assert.deepEqual(projection.binding.selectedCandidate, {
    commit: "a1ca1eb45dba23c246ce84f70d67740c9bd388ab",
    tree: "ab5b281da2ee40c12122a9598d19d33b699d0b86",
    patchSha256:
      "02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314",
  });
  assert.deepEqual(projection.binding.claim, {
    scope: "simulated-storage-call-pre-and-post-write-faults-only/v1",
    crashDurability: false,
    powerLossDurability: false,
    fsyncDurability: false,
  });
  assert.equal(
    projection.binding.applicationReceipt.receiptSha256,
    G17_G14B_APPLICATION_RECEIPT_SHA256,
  );
  assert.deepEqual(projection.artifact, {
    name: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
    bytes: G17_G14B_APPLICATION_RECEIPT_BYTES,
    sha256: G17_G14B_APPLICATION_RECEIPT_RAW_SHA256,
  });
  assert.match(
    g17G14bPrerequisiteProjectionSha256(projection),
    /^[0-9a-f]{64}$/u,
  );
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.binding), true);
  assert.equal(Object.isFrozen(projection.binding.contract.success), true);
  assert.equal(Object.isFrozen(projection.binding.claim), true);
});

test("replay snapshots an accessor exactly once and never retains caller bytes", async () => {
  const supplied = await fixtureBytes();
  const expected = Buffer.from(supplied);
  const substitute = Buffer.alloc(supplied.length, 0x20);
  let reads = 0;
  const projection = replayG17G14bPrerequisite({
    get receiptBytes() {
      reads += 1;
      return reads === 1 ? supplied : substitute;
    },
  });
  supplied.fill(0);
  substitute.fill(0);
  assert.equal(reads, 1);
  assert.deepEqual(
    projection,
    replayG17G14bPrerequisite({ receiptBytes: expected }),
  );
});

test("exact-byte replay rejects tampering, reserialization, and a trailing LF", async () => {
  const bytes = await fixtureBytes();
  const tampered = Buffer.from(bytes);
  tampered[Math.floor(tampered.length / 2)] ^= 0x01;
  assert.throws(
    () => replayG17G14bPrerequisite({ receiptBytes: tampered }),
    /raw SHA-256 differs/u,
  );

  const parsed = JSON.parse(bytes);
  const reserialized = Buffer.from(
    JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())),
    "utf8",
  );
  assert.equal(reserialized.length, bytes.length);
  assert.throws(
    () => replayG17G14bPrerequisite({ receiptBytes: reserialized }),
    /raw SHA-256 differs/u,
  );
  assert.throws(
    () =>
      replayG17G14bPrerequisite({
        receiptBytes: Buffer.concat([bytes, Buffer.from("\n", "utf8")]),
      }),
    /must not have a trailing LF/u,
  );
});

test("task, inner hash, counts, and claim drift fail closed", async () => {
  const bytes = await fixtureBytes();
  for (const mutate of [
    (receipt) => {
      receipt.run.taskId = receipt.run.taskId.replace("g1.4b", "g1.4a");
    },
    (receipt) => {
      receipt.receiptSha256 = "0".repeat(64);
    },
    (receipt) => {
      receipt.contract.success.publicPassed = 9;
    },
  ]) {
    const receipt = JSON.parse(bytes);
    mutate(receipt);
    assert.throws(
      () =>
        replayG17G14bPrerequisite({
          receiptBytes: Buffer.from(JSON.stringify(receipt), "utf8"),
        }),
      /exactly 95990 bytes|raw SHA-256 differs/u,
    );
  }

  const projection = structuredClone(
    replayG17G14bPrerequisite({ receiptBytes: bytes }),
  );
  projection.binding.claim.crashDurability = true;
  assert.throws(
    () => g17G14bPrerequisiteProjectionSha256(projection),
    /projection differs from the accepted binding/u,
  );
});

test("stable reader copies the exact source and refuses symlink or stale input", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g14b-prerequisite-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receiptPath = join(root, "receipt.json");
  const linkPath = join(root, "receipt-link.json");
  const bytes = await fixtureBytes();
  await writeFile(receiptPath, bytes, { mode: 0o600 });
  await symlink(receiptPath, linkPath);

  const evidence = loadG17G14bPrerequisite({ receiptPath });
  await writeFile(receiptPath, Buffer.alloc(bytes.length, 0x20));
  assert.equal(evidence.status, "PASS");
  assert.equal(
    sha256(evidence.artifacts[0].bytes),
    G17_G14B_APPLICATION_RECEIPT_RAW_SHA256,
  );
  assert.throws(
    () => loadG17G14bPrerequisite({ receiptPath: linkPath }),
    /cannot be read safely/u,
  );
  assert.equal(inspectG17G14bPrerequisite({ receiptPath }).status, "STALE");
  assert.deepEqual(inspectG17G14bPrerequisite(), {
    status: "MISSING",
    sha256: null,
    reasons: ["g1.4b-application-receipt-absent"],
    projection: null,
    artifacts: [],
  });
});

test("prerequisite source imports replay only and no Router or admission authority", async () => {
  const source = await readFile(
    new URL("../src/qualification/g14b-prerequisite.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{ replayApplicationReceipt \} from "\.\.\/receipts\/application\.mjs";/u,
  );
  assert.doesNotMatch(
    source,
    /replayTaskProgrammeReceipt|application-admission|QualityFirstRouter|RouterHistory/u,
  );
});
