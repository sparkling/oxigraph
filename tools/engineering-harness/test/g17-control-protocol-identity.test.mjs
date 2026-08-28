import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_LEGACY_V5_PROTOCOL_ARTIFACTS,
  decodeG17LegacyV5ProtocolArtifact,
} from "../src/qualification/control-protocol-identity.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const fixtures = {
  controlAuthorization: new URL(
    "fixtures/qualification/g1.7/v5/control-authorization.json",
    import.meta.url,
  ),
  finalDecisionSet: new URL(
    "fixtures/qualification/g1.7/v5/final-decision-set.json",
    import.meta.url,
  ),
};

test("v5 proposed protocol artifacts replay from exact archived bytes only", async () => {
  for (const [kind, url] of Object.entries(fixtures)) {
    const descriptor = G17_LEGACY_V5_PROTOCOL_ARTIFACTS[kind];
    const bytes = await readFile(url);
    assert.equal(bytes.length, descriptor.bytes);
    assert.equal(sha256(bytes), descriptor.rawSha256);
    const decoded = decodeG17LegacyV5ProtocolArtifact(kind, {
      bytes,
      receiptSha256: descriptor.rawSha256,
    });
    assert.equal(decoded.generation, "LEGACY_V5");
    assert.equal(decoded.value.status, descriptor.status);
    assert.equal(Object.isFrozen(decoded.value), true);
    assert.equal(decoded.byteLength, descriptor.bytes);
    assert.equal("bytes" in decoded, false);
  }
});

test("v5 protocol replay rejects accessors before reads and rejects tampering", async () => {
  const descriptor = G17_LEGACY_V5_PROTOCOL_ARTIFACTS.controlAuthorization;
  const bytes = await readFile(fixtures.controlAuthorization);
  const tampered = Buffer.from(bytes);
  tampered[0] ^= 1;
  let byteReads = 0;
  let digestReads = 0;
  const accessorInput = {
    get bytes() {
      byteReads += 1;
      return bytes;
    },
    get receiptSha256() {
      digestReads += 1;
      return descriptor.rawSha256;
    },
  };
  assert.throws(
    () =>
      decodeG17LegacyV5ProtocolArtifact("controlAuthorization", accessorInput),
    /accessor fields/u,
  );
  assert.equal(byteReads, 0);
  assert.equal(digestReads, 0);

  assert.throws(
    () =>
      decodeG17LegacyV5ProtocolArtifact("controlAuthorization", {
        bytes: tampered,
        receiptSha256: sha256(tampered),
      }),
    /reviewed v5 identity/u,
  );
});

test("v5 protocol replay rejects symbols, unknown fields, prototypes, and setter fields", async () => {
  const descriptor = G17_LEGACY_V5_PROTOCOL_ARTIFACTS.controlAuthorization;
  const bytes = await readFile(fixtures.controlAuthorization);
  const mutations = [
    (input) => {
      input[Symbol("authority")] = true;
    },
    (input) => {
      input.execute = true;
    },
    (input) => {
      Object.setPrototypeOf(input, { authority: true });
    },
    (input) => {
      Object.defineProperty(input, "receiptSha256", {
        enumerable: true,
        set() {},
      });
    },
  ];
  for (const mutate of mutations) {
    const input = {
      bytes,
      receiptSha256: descriptor.rawSha256,
    };
    mutate(input);
    assert.throws(
      () => decodeG17LegacyV5ProtocolArtifact("controlAuthorization", input),
      /G1\.7 control protocol identity/u,
    );
  }
});

test("v5 protocol replay copies Buffer aliases and exposes no mutable trusted bytes", async () => {
  const descriptor = G17_LEGACY_V5_PROTOCOL_ARTIFACTS.controlAuthorization;
  const fixture = await readFile(fixtures.controlAuthorization);
  const backing = Buffer.alloc(fixture.length + 2);
  fixture.copy(backing, 1);
  const alias = backing.subarray(1, -1);
  const decoded = decodeG17LegacyV5ProtocolArtifact("controlAuthorization", {
    bytes: alias,
    receiptSha256: descriptor.rawSha256,
  });
  backing.fill(0);
  assert.equal(decoded.value.schema, descriptor.schema);
  assert.equal(decoded.value.contentHash, descriptor.contentHash);
  assert.equal(decoded.byteLength, descriptor.bytes);
  assert.equal("bytes" in decoded, false);
});

test("v5 protocol identity replay has no filesystem, process, Router, or Darwin import", async () => {
  const source = await readFile(
    new URL(
      "../src/qualification/control-protocol-identity.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+"(?:node:fs|node:child_process|.*routing\/|.*benchmark-contract|@metaharness\/darwin)/u,
  );
  assert.doesNotMatch(source, /\bprocess\./u);
});
