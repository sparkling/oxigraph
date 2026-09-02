import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  APPLICATION_RECEIPT_SCHEMA,
  replayApplicationReceipt,
  serializeApplicationReceipt,
  verifyApplicationReceipt,
} from "../src/receipts/application.mjs";
import { validateCandidatePatch } from "../src/policy/paths.mjs";

const contractHashes = Object.freeze({
  "g1.2": "7bf542ce439173c840e244713e311968ff478e1248267fcb08b12f09deb16b17",
  "g1.3": "fd30c797263e3f0b001c816c56cdacbeee095fa4da1ad948a6211734b982a461",
  "g1.4": "cc20ae29420ff2a3b328b35bdc8f26dcd6cd39e978ec6fcfc0de93290334df39",
  "g1.4a": "fa8d1028cb3e1c27c2f1771e77451a08ddc84ce6a2c7c673c2435deda574a6fd",
  "g1.4b": "926724ae8c8d206b4a4de576eb0120fc21c75aa96c99fb4f38664a2bdf3b44c8",
  "g1.5": "e77e11a02e55e995583f0bab118878a42c490b562e0826c6b1611db096c6dfec",
  "g1.5b": "ab01ef3e29fbded8c8c042359851bd0c02c9fa1fd97afbc00eadc0b3a48e1525",
  "g1.5c": "05b6ba498344fc412a810bb79eb80344f90577a442ce03c41637cbabd4a26ce1",
  "g1.6": "abd16ee2f4d2c7c4b89b651e9412e126cac468456e7a1633c1143dce1f5accd3",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function creationPatch(path) {
  return (
    `diff --git a/${path} b/${path}\n` +
    "new file mode 100644\n" +
    `index ${"0".repeat(40)}..${"1".repeat(40)}\n` +
    "--- /dev/null\n" +
    `+++ b/${path}\n` +
    "@@ -0,0 +1 @@\n" +
    "+created\n"
  );
}

test("all committed schema-v1 task contracts remain byte-identical and creation-closed", async () => {
  const committedTaskDirectories = (
    await readdir(new URL("../tasks/g1/", import.meta.url), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    committedTaskDirectories,
    Object.keys(contractHashes).sort(),
  );

  for (const [slug, expectedSha256] of Object.entries(contractHashes)) {
    const bytes = await readFile(
      new URL(`../tasks/g1/${slug}/contract.json`, import.meta.url),
    );
    assert.equal(sha256(bytes), expectedSha256, `${slug} raw contract drifted`);
    const contract = JSON.parse(bytes.toString("utf8"));
    assert.equal(contract.schemaVersion, 1, `${slug} changed task schema`);
    assert.equal(contract.scope.allowCreate, false, `${slug} enabled creation`);
    assert.equal(
      Object.hasOwn(contract.scope, "createExact"),
      false,
      `${slug} acquired a v2 creation field`,
    );
    assert.throws(
      () =>
        validateCandidatePatch(
          creationPatch(contract.scope.mutableExact[0]),
          contract,
        ),
      /may not create files/u,
      `${slug} accepted creation metadata`,
    );
  }
});

test("the committed G1.4b application-receipt-v6 fixture remains exact and replayable", async () => {
  const encoded = await readFile(
    new URL(
      "fixtures/g14b-accepted-application-receipt-v6.json.gz.b64",
      import.meta.url,
    ),
  );
  assert.equal(encoded.length, 21_192);
  assert.equal(
    sha256(encoded),
    "a17e38fa3f5bb8367d23d8d0a8dad8353ba2ba76fd20609e44515a586a287cb6",
  );

  const receiptBytes = gunzipSync(
    Buffer.from(encoded.toString("utf8").replaceAll(/\s/gu, ""), "base64"),
  );
  assert.equal(receiptBytes.length, 95_990);
  assert.equal(
    sha256(receiptBytes),
    "6273c29d7221d820ac6e46bc784deca5867045aa3704470e269f862a459d3205",
  );

  const receiptText = receiptBytes.toString("utf8");
  const verification = verifyApplicationReceipt(receiptText);
  assert.equal(verification.ok, true, verification.reason);
  assert.equal(
    APPLICATION_RECEIPT_SCHEMA,
    "oxigraph.engineering-application-receipt/v6",
  );
  assert.equal(verification.receipt.schema, APPLICATION_RECEIPT_SCHEMA);
  assert.equal(
    verification.receiptSha256,
    "d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad",
  );
  const replayed = replayApplicationReceipt(receiptText);
  assert.equal(replayed.schema, APPLICATION_RECEIPT_SCHEMA);
  assert.equal(serializeApplicationReceipt(replayed), receiptText);
  assert.equal(
    APPLICATION_RECEIPT_SCHEMA,
    "oxigraph.engineering-application-receipt/v6",
  );
});
