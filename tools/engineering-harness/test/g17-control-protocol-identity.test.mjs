import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_LEGACY_V5_PROTOCOL_ARTIFACTS,
  G17_LEGACY_V6_PROTOCOL_ARTIFACTS,
  decodeG17LegacyV5ProtocolArtifact,
  decodeG17LegacyV6ProtocolArtifact,
} from "../src/qualification/control-protocol-identity.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlob(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

const archives = [
  {
    version: "v5",
    generation: "LEGACY_V5",
    descriptors: G17_LEGACY_V5_PROTOCOL_ARTIFACTS,
    decode: decodeG17LegacyV5ProtocolArtifact,
    fixtures: {
      controlAuthorization: new URL(
        "fixtures/qualification/g1.7/v5/control-authorization.json",
        import.meta.url,
      ),
      finalDecisionSet: new URL(
        "fixtures/qualification/g1.7/v5/final-decision-set.json",
        import.meta.url,
      ),
    },
    expected: {
      controlAuthorization: {
        schema: "oxigraph.g1.7-control-authorization/v1",
        id: "control-authorization",
        status: "CONTROL_AUTH_PROPOSED",
        rawSha256:
          "b9ee0f7615a885cda10157d1a6fdeebe4dc8175b267e6b25cd2c5bc636603515",
        contentHash:
          "5cb0f48f232784e7b6d0206b5ddbf72c7cd89d78f1924930a85ddba1cdf298b4",
        bytes: 7_140,
        blob: "d803fe3d657c937770c7336e00148998cdaa415c",
      },
      finalDecisionSet: {
        schema: "oxigraph.g1.7-final-decision-set/v1",
        id: "final-decision-set",
        status: "PROPOSED",
        rawSha256:
          "2fd16b9ef0228fc054efb80a6f338fafeb6a289f1371b20f774e7c6f10ea0bce",
        contentHash:
          "ba49181b0c19ccc065f51510837a035aa64cccb746e089ac13d68a39c1d89898",
        bytes: 5_686,
        blob: "2297cbe59a65d95a90523af148bd873832b449fb",
      },
    },
  },
  {
    version: "v6",
    generation: "LEGACY_V6",
    descriptors: G17_LEGACY_V6_PROTOCOL_ARTIFACTS,
    decode: decodeG17LegacyV6ProtocolArtifact,
    fixtures: {
      controlAuthorization: new URL(
        "fixtures/qualification/g1.7/v6/control-authorization.json",
        import.meta.url,
      ),
      finalDecisionSet: new URL(
        "fixtures/qualification/g1.7/v6/final-decision-set.json",
        import.meta.url,
      ),
    },
    expected: {
      controlAuthorization: {
        schema: "oxigraph.g1.7-control-authorization/v2",
        id: "control-authorization",
        status: "CONTROL_AUTH_PROPOSED",
        rawSha256:
          "285c86fd0ec6d3f00cb8bc48e30d0fe41e800f21ef03799d770b253a3a6ff839",
        contentHash:
          "5e223cf4e11540eadef1e725794e05af838e2d5d347b5959091e424d7140961a",
        bytes: 10_768,
        blob: "fdc062673095962faf3e29606cb39eb4e424250a",
      },
      finalDecisionSet: {
        schema: "oxigraph.g1.7-final-decision-set/v2",
        id: "final-decision-set",
        status: "PROPOSED",
        rawSha256:
          "e2884b738c59232e9b4b3b750adbd419f338a0781aba70c6b3091672cb610732",
        contentHash:
          "7eb0dcfbc35d70dc6b1fcf5debf69bd083900d9e9356c1cef745fc29271345c5",
        bytes: 5_686,
        blob: "3772ad51923553e2bcc9b06372042df6bde4649c",
      },
    },
  },
];

test("v5 and v6 proposed protocol artifacts replay from exact archived bytes only", async () => {
  for (const archive of archives) {
    for (const [kind, url] of Object.entries(archive.fixtures)) {
      const descriptor = archive.descriptors[kind];
      const { blob, ...expectedDescriptor } = archive.expected[kind];
      assert.deepEqual(descriptor, expectedDescriptor);
      const bytes = await readFile(url);
      assert.equal(bytes.length, expectedDescriptor.bytes);
      assert.equal(sha256(bytes), expectedDescriptor.rawSha256);
      assert.equal(gitBlob(bytes), blob);
      const decoded = archive.decode(kind, {
        bytes,
        receiptSha256: expectedDescriptor.rawSha256,
      });
      assert.equal(decoded.generation, archive.generation);
      assert.equal(decoded.value.status, expectedDescriptor.status);
      assert.equal(Object.isFrozen(decoded.value), true);
      assert.equal(decoded.byteLength, expectedDescriptor.bytes);
      assert.equal("bytes" in decoded, false);
    }
  }
});

test("legacy protocol replay rejects accessors before reads and rejects tampering", async () => {
  for (const archive of archives) {
    const descriptor = archive.descriptors.controlAuthorization;
    const bytes = await readFile(archive.fixtures.controlAuthorization);
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
      () => archive.decode("controlAuthorization", accessorInput),
      /accessor fields/u,
    );
    assert.equal(byteReads, 0);
    assert.equal(digestReads, 0);

    assert.throws(
      () =>
        archive.decode("controlAuthorization", {
          bytes: tampered,
          receiptSha256: sha256(tampered),
        }),
      new RegExp(`reviewed ${archive.version} identity`, "u"),
    );
  }
});

test("legacy protocol replay rejects symbols, unknown fields, prototypes, and setter fields", async () => {
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
  for (const archive of archives) {
    const descriptor = archive.descriptors.controlAuthorization;
    const bytes = await readFile(archive.fixtures.controlAuthorization);
    for (const mutate of mutations) {
      const input = {
        bytes,
        receiptSha256: descriptor.rawSha256,
      };
      mutate(input);
      assert.throws(
        () => archive.decode("controlAuthorization", input),
        /G1\.7 control protocol identity/u,
      );
    }
  }
});

test("legacy protocol replay copies Buffer aliases and exposes no mutable trusted bytes", async () => {
  for (const archive of archives) {
    const descriptor = archive.descriptors.controlAuthorization;
    const fixture = await readFile(archive.fixtures.controlAuthorization);
    const backing = Buffer.alloc(fixture.length + 2);
    fixture.copy(backing, 1);
    const alias = backing.subarray(1, -1);
    const decoded = archive.decode("controlAuthorization", {
      bytes: alias,
      receiptSha256: descriptor.rawSha256,
    });
    backing.fill(0);
    assert.equal(decoded.value.schema, descriptor.schema);
    assert.equal(decoded.value.contentHash, descriptor.contentHash);
    assert.equal(decoded.byteLength, descriptor.bytes);
    assert.equal("bytes" in decoded, false);
  }
});

test("legacy protocol identity replay has no filesystem, process, Router, or Darwin import", async () => {
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
