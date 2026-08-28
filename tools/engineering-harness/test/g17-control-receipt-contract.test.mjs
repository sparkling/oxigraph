import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_BENCHMARK_OWNER_BATCH_NAME,
  G17_BENCHMARK_OWNER_BATCH_SCHEMA,
  G17_BENCHMARK_OWNER_BATCH_V1_LIMITS,
  G17_CONTROL_RECEIPT_REPLAY_SCHEMA,
  buildG17ControlReceiptCandidate,
  g17BenchmarkOwnerBatchBytes,
  replayG17ControlReceipt,
} from "../src/qualification/control-receipt-contract.mjs";
import { G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA } from "../src/qualification/benchmark-owner-contract.mjs";
import {
  G17_CONTROL_AUTHORIZATION_PROTOCOL,
  G17_CONTROL_RUN_RECEIPT_SCHEMA,
  validateG17NegativeControlSignature,
} from "../src/qualification/control-protocol.mjs";
import { G17_CONTROL_STATISTICS_PROJECTION_SCHEMA } from "../src/qualification/control-statistics-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17_CONTROL_RECEIPT_COMPLETED_AT,
  G17_CONTROL_RECEIPT_FIXTURE_RUN_ID,
  G17_CONTROL_RECEIPT_STARTED_AT,
  createG17ControlReceiptFixture,
  g17ControlReceiptArtifactsByName,
  g17ControlReceiptBytes,
  g17DecodeControlReceipt,
  g17ResealControlReceipt,
  replayG17ControlReceiptFixture,
} from "./support/g17-control-receipt-fixture.mjs";

const RECEIPT_ERROR = /G1\.7 control receipt/u;
const REPLAY_ERROR = /G1\.7 (?:benchmark owner|control receipt)/u;
const AUTHORITY = Object.freeze({
  controlExecution: false,
  qualificationExecution: false,
  promotion: false,
  publication: false,
  routerQuality: false,
  providerExecution: false,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function decodeBatch(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function resealBatch(value) {
  const { contentHash: ignored, ...unsigned } = structuredClone(value);
  const batch = { ...unsigned, contentHash: canonicalSha256(unsigned) };
  return Buffer.from(`${canonicalJson(batch)}\n`, "utf8");
}

function receiptAndArtifactsForBatch(fixture, batchBytes, mutateReceipt) {
  const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
  receipt.inventory[0] = {
    ...receipt.inventory[0],
    bytes: batchBytes.length,
    sha256: sha256(batchBytes),
  };
  mutateReceipt?.(receipt);
  const sealed = g17ResealControlReceipt(receipt);
  return {
    receiptBytes: g17ControlReceiptBytes(sealed),
    artifactsByName: g17ControlReceiptArtifactsByName(batchBytes),
  };
}

function eachByteLeaf(batch) {
  const leaves = [];
  for (const build of batch.builds) {
    leaves.push(
      build.workspaceOwner,
      build.buildOwner,
      build.buildStdout,
      build.buildStderr,
    );
  }
  for (const control of batch.controls) {
    leaves.push(control.sessionOwner, control.sampleSet);
    for (const launch of control.launches) {
      leaves.push(launch.attestation, launch.stdout, launch.stderr);
    }
  }
  return leaves;
}

function nestedObject(depth) {
  let value = "leaf";
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

function publicApiOptionCases(fixture) {
  return [
    {
      name: "g17BenchmarkOwnerBatchBytes",
      accessorKey: "artifacts",
      invoke: (options) => g17BenchmarkOwnerBatchBytes(options),
      options: {
        controlRunId: fixture.controlRunId,
        artifacts: fixture.artifacts,
      },
    },
    {
      name: "buildG17ControlReceiptCandidate",
      accessorKey: "authorizationBytes",
      invoke: (options) => buildG17ControlReceiptCandidate(options),
      options: {
        authorizationBytes: fixture.authorizationBytes,
        controlRunId: fixture.controlRunId,
        startedAt: fixture.startedAt,
        completedAt: fixture.completedAt,
        artifacts: fixture.artifacts,
      },
    },
    {
      name: "replayG17ControlReceipt",
      accessorKey: "receiptBytes",
      invoke: (options) => replayG17ControlReceipt(options),
      options: {
        authorizationBytes: fixture.authorizationBytes,
        receiptBytes: fixture.receiptBytes,
        artifactsByName: fixture.artifactsByName,
      },
    },
  ];
}

function noncanonicalJsonVariants(bytes) {
  const body = Buffer.from(bytes.subarray(0, -1));
  const value = JSON.parse(bytes.toString("utf8"));
  const reverseOrdered = Object.fromEntries(Object.entries(value).reverse());
  const duplicateSchema = Buffer.from(
    `{"schema":${JSON.stringify(value.schema)},${body.toString("utf8").slice(1)}\n`,
    "utf8",
  );
  return [
    ["missing LF", body],
    ["CRLF", Buffer.concat([body, Buffer.from("\r\n", "utf8")])],
    ["double LF", Buffer.concat([bytes, Buffer.from("\n", "utf8")])],
    ["trailing whitespace", Buffer.concat([body, Buffer.from(" \n", "utf8")])],
    ["pretty JSON", Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")],
    [
      "alternate key order",
      Buffer.from(`${JSON.stringify(reverseOrdered)}\n`, "utf8"),
    ],
    ["duplicate key", duplicateSchema],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28, 0x0a])],
  ];
}

test("all public APIs reject non-exact or nonordinary option envelopes without invoking accessors", () => {
  const fixture = createG17ControlReceiptFixture();
  for (const { name, accessorKey, invoke, options } of publicApiOptionCases(
    fixture,
  )) {
    let accessorReads = 0;
    const accessorEnvelope = { ...options };
    Object.defineProperty(accessorEnvelope, accessorKey, {
      get() {
        accessorReads += 1;
        return options[accessorKey];
      },
      enumerable: true,
      configurable: true,
    });
    assert.throws(() => invoke(accessorEnvelope), RECEIPT_ERROR, name);
    assert.equal(accessorReads, 0, `${name} invoked a top-level accessor`);

    const symbolEnvelope = { ...options };
    symbolEnvelope[Symbol("unapproved")] = true;
    assert.throws(() => invoke(symbolEnvelope), RECEIPT_ERROR, name);

    const cyclicEnvelope = { ...options };
    cyclicEnvelope.unapprovedCycle = cyclicEnvelope;
    assert.throws(() => invoke(cyclicEnvelope), RECEIPT_ERROR, name);

    const foreignEnvelope = Object.assign(
      Object.create({ inherited: true }),
      options,
    );
    assert.throws(() => invoke(foreignEnvelope), RECEIPT_ERROR, name);

    assert.throws(
      () => invoke({ ...options, unapproved: true }),
      RECEIPT_ERROR,
      name,
    );
  }
});

test("nested owner data rejects accessors, symbols, cycles, sparse or fieldful arrays, and foreign prototypes", () => {
  const fixture = createG17ControlReceiptFixture();
  const build = (artifacts) =>
    buildG17ControlReceiptCandidate({
      authorizationBytes: fixture.authorizationBytes,
      controlRunId: fixture.controlRunId,
      startedAt: fixture.startedAt,
      completedAt: fixture.completedAt,
      artifacts,
    });

  let accessorReads = 0;
  const accessorArtifacts = { ...fixture.artifacts };
  Object.defineProperty(accessorArtifacts, "builds", {
    get() {
      accessorReads += 1;
      return fixture.artifacts.builds;
    },
    enumerable: true,
    configurable: true,
  });
  assert.throws(() => build(accessorArtifacts), RECEIPT_ERROR);
  assert.equal(accessorReads, 0);

  const symbolArtifacts = { ...fixture.artifacts };
  symbolArtifacts[Symbol("unapproved")] = true;
  assert.throws(() => build(symbolArtifacts), RECEIPT_ERROR);

  const cyclicArtifacts = { ...fixture.artifacts };
  cyclicArtifacts.unapprovedCycle = cyclicArtifacts;
  assert.throws(() => build(cyclicArtifacts), RECEIPT_ERROR);

  const foreignArtifacts = Object.assign(
    Object.create({ inherited: true }),
    fixture.artifacts,
  );
  assert.throws(() => build(foreignArtifacts), RECEIPT_ERROR);

  const sparseBuilds = [...fixture.artifacts.builds];
  delete sparseBuilds[1];
  assert.throws(
    () => build({ ...fixture.artifacts, builds: sparseBuilds }),
    RECEIPT_ERROR,
  );

  const fieldfulControls = [...fixture.artifacts.controls];
  fieldfulControls.unapproved = true;
  assert.throws(
    () =>
      build({
        ...fixture.artifacts,
        controls: fieldfulControls,
      }),
    RECEIPT_ERROR,
  );
});

test("receipt artifact maps reject subclasses and own fields", () => {
  const fixture = createG17ControlReceiptFixture();
  class ArtifactMap extends Map {}

  const subclass = new ArtifactMap(fixture.artifactsByName);
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, { artifactsByName: subclass }),
    RECEIPT_ERROR,
  );

  const fieldful = new Map(fixture.artifactsByName);
  fieldful.unapproved = true;
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, { artifactsByName: fieldful }),
    RECEIPT_ERROR,
  );
});

test("receipt and owner batch replay reject every noncanonical byte framing", () => {
  const fixture = createG17ControlReceiptFixture();
  for (const [name, receiptBytes] of noncanonicalJsonVariants(
    fixture.receiptBytes,
  )) {
    assert.throws(
      () => replayG17ControlReceiptFixture(fixture, { receiptBytes }),
      RECEIPT_ERROR,
      `receipt ${name}`,
    );
  }

  for (const [name, ownerBatchBytes] of noncanonicalJsonVariants(
    fixture.ownerBatchBytes,
  )) {
    assert.throws(
      () =>
        replayG17ControlReceiptFixture(fixture, {
          artifactsByName: g17ControlReceiptArtifactsByName(ownerBatchBytes),
        }),
      RECEIPT_ERROR,
      `owner batch ${name}`,
    );
  }
});

test("receipt replay rejects coherently rehashed unknown fields at every envelope level", () => {
  const fixture = createG17ControlReceiptFixture();
  const receiptMutations = [
    (receipt) => {
      receipt.unapproved = true;
    },
    (receipt) => {
      receipt.authorization.unapproved = true;
    },
    (receipt) => {
      receipt.ownerBundle.unapproved = true;
    },
    (receipt) => {
      receipt.statistics.unapproved = true;
    },
    (receipt) => {
      receipt.inventory[0].unapproved = true;
    },
    (receipt) => {
      receipt.authority.unapproved = false;
    },
  ];
  for (const mutate of receiptMutations) {
    const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
    mutate(receipt);
    const receiptBytes = g17ControlReceiptBytes(
      g17ResealControlReceipt(receipt),
    );
    assert.throws(
      () => replayG17ControlReceiptFixture(fixture, { receiptBytes }),
      RECEIPT_ERROR,
    );
  }

  const batchMutations = [
    (batch) => {
      batch.unapproved = true;
    },
    (batch) => {
      batch.builds[0].unapproved = true;
    },
    (batch) => {
      batch.controls[0].unapproved = true;
    },
    (batch) => {
      batch.controls[0].launches[0].unapproved = true;
    },
    (batch) => {
      batch.controls[0].launches[0].stdout.unapproved = true;
    },
  ];
  for (const mutate of batchMutations) {
    const batch = decodeBatch(fixture.ownerBatchBytes);
    mutate(batch);
    const ownerBatchBytes = resealBatch(batch);
    const inputs = receiptAndArtifactsForBatch(fixture, ownerBatchBytes);
    assert.throws(
      () =>
        replayG17ControlReceipt({
          authorizationBytes: fixture.authorizationBytes,
          ...inputs,
        }),
      RECEIPT_ERROR,
    );
  }
});

test("receipt and owner batch raw hashes are independent from their inner hashes", () => {
  const fixture = createG17ControlReceiptFixture();
  const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
  const batch = decodeBatch(fixture.ownerBatchBytes);
  assert.notEqual(sha256(fixture.receiptBytes), receipt.receiptSha256);
  assert.notEqual(sha256(fixture.ownerBatchBytes), batch.contentHash);

  receipt.receiptSha256 = "0".repeat(64);
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        receiptBytes: g17ControlReceiptBytes(receipt),
      }),
    RECEIPT_ERROR,
  );

  const originalReceipt = g17DecodeControlReceipt(fixture.receiptBytes);
  const noncanonicalRawReceipt = Buffer.concat([
    fixture.receiptBytes.subarray(0, -1),
    Buffer.from(" \n", "utf8"),
  ]);
  assert.equal(
    JSON.parse(noncanonicalRawReceipt.toString("utf8")).receiptSha256,
    originalReceipt.receiptSha256,
  );
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        receiptBytes: noncanonicalRawReceipt,
      }),
    RECEIPT_ERROR,
  );

  batch.contentHash = "0".repeat(64);
  const wrongInnerBatchBytes = Buffer.from(`${canonicalJson(batch)}\n`, "utf8");
  const wrongInnerInputs = receiptAndArtifactsForBatch(
    fixture,
    wrongInnerBatchBytes,
  );
  assert.throws(
    () =>
      replayG17ControlReceipt({
        authorizationBytes: fixture.authorizationBytes,
        ...wrongInnerInputs,
      }),
    RECEIPT_ERROR,
  );

  const wrongInventoryReceipt = g17DecodeControlReceipt(fixture.receiptBytes);
  wrongInventoryReceipt.inventory[0].sha256 = "f".repeat(64);
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        receiptBytes: g17ControlReceiptBytes(
          g17ResealControlReceipt(wrongInventoryReceipt),
        ),
      }),
    RECEIPT_ERROR,
  );
});

test("control receipt batch is one canonical, exact-byte owner inventory", () => {
  const fixture = createG17ControlReceiptFixture();
  const bytes = g17BenchmarkOwnerBatchBytes({
    controlRunId: fixture.controlRunId,
    artifacts: fixture.artifacts,
  });
  assert.equal(bytes.equals(fixture.ownerBatchBytes), true);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(bytes.subarray(0, -1).includes(0x0a), false);

  const batch = decodeBatch(bytes);
  exactKeys(batch, [
    "schema",
    "controlRunId",
    "builds",
    "controls",
    "contentHash",
  ]);
  assert.equal(batch.schema, G17_BENCHMARK_OWNER_BATCH_SCHEMA);
  assert.equal(batch.controlRunId, fixture.controlRunId);
  assert.equal(batch.builds.length, 4);
  assert.deepEqual(
    batch.controls.map(({ controlName, launches }) => [
      controlName,
      launches.length,
    ]),
    [
      ["negativeControl", 196],
      ["aaNoiseControl", 196],
    ],
  );
  const { contentHash, ...unsigned } = batch;
  assert.equal(contentHash, canonicalSha256(unsigned));

  for (const leaf of eachByteLeaf(batch)) {
    exactKeys(leaf, ["bytes", "sha256", "base64"]);
    const decoded = Buffer.from(leaf.base64, "base64");
    assert.equal(decoded.length, leaf.bytes);
    assert.equal(sha256(decoded), leaf.sha256);
    assert.equal(decoded.toString("base64"), leaf.base64);
  }
  assert.equal(
    Buffer.from(batch.builds[0].workspaceOwner.base64, "base64").equals(
      fixture.artifacts.builds[0].workspaceOwnerBytes,
    ),
    true,
  );
  assert.equal(
    Buffer.from(batch.controls[1].launches[195].stdout.base64, "base64").equals(
      fixture.artifacts.controls[1].launches[195].stdoutBytes,
    ),
    true,
  );
});

test("control receipt candidate replay recomputes evidence without emitting a final binding", () => {
  const fixture = createG17ControlReceiptFixture();
  const replay = replayG17ControlReceiptFixture(fixture);
  const receipt = g17DecodeControlReceipt(fixture.receiptBytes);

  exactKeys(receipt, [
    "schema",
    "status",
    "runId",
    "authorization",
    "startedAt",
    "completedAt",
    "environmentClass",
    "ownerBundle",
    "statistics",
    "negativeControlSignature",
    "inventory",
    "authority",
    "receiptSha256",
  ]);
  assert.equal(receipt.schema, G17_CONTROL_RUN_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "CONTROL_SEALED_PASS");
  assert.equal(receipt.runId, G17_CONTROL_RECEIPT_FIXTURE_RUN_ID);
  assert.deepEqual(receipt.authorization, {
    schema: fixture.authorization.schema,
    rawSha256: fixture.authorizationRawSha256,
    contentHash: fixture.authorization.contentHash,
  });
  assert.equal(receipt.startedAt, G17_CONTROL_RECEIPT_STARTED_AT);
  assert.equal(receipt.completedAt, G17_CONTROL_RECEIPT_COMPLETED_AT);
  assert.equal(
    receipt.environmentClass,
    G17_CONTROL_AUTHORIZATION_PROTOCOL.environment.class,
  );
  assert.deepEqual(receipt.ownerBundle, {
    schema: G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
    projectionSha256: canonicalSha256(replay.ownerProjection),
  });
  assert.deepEqual(receipt.statistics, {
    schema: G17_CONTROL_STATISTICS_PROJECTION_SCHEMA,
    status: replay.statistics.status,
    reason: replay.statistics.reason,
    projectionSha256: canonicalSha256(replay.statistics),
  });
  assert.deepEqual(receipt.inventory, [
    {
      name: G17_BENCHMARK_OWNER_BATCH_NAME,
      schema: G17_BENCHMARK_OWNER_BATCH_SCHEMA,
      bytes: fixture.ownerBatchBytes.length,
      sha256: sha256(fixture.ownerBatchBytes),
    },
  ]);
  assert.deepEqual(receipt.authority, AUTHORITY);
  const { receiptSha256, ...unsigned } = receipt;
  assert.equal(receiptSha256, canonicalSha256(unsigned));

  exactKeys(replay, [
    "schema",
    "status",
    "outcome",
    "receiptCandidateReplayComplete",
    "finalDecisionEligible",
    "receipt",
    "receiptRawSha256",
    "ownerProjection",
    "statistics",
    "negativeControlSignature",
    "binding",
    "authority",
  ]);
  assert.equal(replay.schema, G17_CONTROL_RECEIPT_REPLAY_SCHEMA);
  assert.equal(replay.status, "CANDIDATE_REPLAYED");
  assert.equal(replay.outcome, "CONTROL_SEALED_PASS");
  assert.equal(replay.receiptCandidateReplayComplete, true);
  assert.equal(replay.finalDecisionEligible, false);
  assert.equal(replay.binding, null);
  assert.equal(Object.hasOwn(replay, "candidateBinding"), false);
  assert.equal(replay.receiptRawSha256, sha256(fixture.receiptBytes));
  assert.equal(replay.ownerProjection.replay.buildCount, 4);
  assert.equal(replay.ownerProjection.replay.controlCount, 2);
  assert.equal(replay.ownerProjection.replay.launchCount, 392);
  assert.equal(replay.statistics.status, "CONTROL_SEALED_PASS");
  assert.equal(replay.statistics.negativeControl.quietBreaches.length, 7);
  assert.deepEqual(replay.statistics.aaNoiseControl.quietDirectionFailures, []);
  assert.deepEqual(
    replay.negativeControlSignature,
    validateG17NegativeControlSignature(receipt.negativeControlSignature),
  );
  assert.deepEqual(replay.authority, AUTHORITY);
  assertDeepFrozen(replay);
});

test("negative-control signature is derived only from the recomputed quiet breaches", () => {
  const fixture = createG17ControlReceiptFixture();
  const expected = fixture.replay.negativeControlSignature;
  assert.deepEqual(
    expected.budgetBreaches,
    fixture.replay.statistics.negativeControl.quietBreaches,
  );
  assert.equal(
    expected.sampleSetSha256,
    fixture.replay.statistics.sampleSets.negativeControl.sha256,
  );

  for (const mutate of [
    (signature) => {
      signature.budgetBreaches = [];
    },
    (signature) => {
      signature.budgetBreaches.reverse();
    },
    (signature) => {
      signature.status = "PASS";
    },
  ]) {
    const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
    mutate(receipt.negativeControlSignature);
    const { contentHash: ignored, ...signatureUnsigned } =
      receipt.negativeControlSignature;
    receipt.negativeControlSignature.contentHash =
      canonicalSha256(signatureUnsigned);
    const receiptBytes = g17ControlReceiptBytes(
      g17ResealControlReceipt(receipt),
    );
    assert.throws(
      () => replayG17ControlReceiptFixture(fixture, { receiptBytes }),
      RECEIPT_ERROR,
    );
  }
});

test("honest failing and inconclusive controls remain replayable but non-authorizing", () => {
  const offset = ({ caseIndex, globalBlock, slot }) =>
    caseIndex * 1_000 + globalBlock * 10 + slot;
  const cases = [
    {
      runId: "g17-aa-fail-fixture",
      elapsedNs: (coordinates) =>
        coordinates.controlName === "negativeControl"
          ? (coordinates.arm === "subject" ? 120_000 : 100_000) +
            offset(coordinates)
          : (coordinates.arm === "subject" ? 130_000 : 100_000) +
            offset(coordinates),
      status: "CONTROL_SEALED_FAIL",
      reason: "QUIET_AA_DIRECTION_FAILURE",
      negativeStatus: "CONTROL_SEALED_PASS",
      aaStatus: "CONTROL_SEALED_FAIL",
      breaches: 7,
      directionFailures: 7,
      noisyCases: 0,
      signatureBreaches: 7,
    },
    {
      runId: "g17-negative-fail-fixture",
      elapsedNs: (coordinates) => 100_000 + offset(coordinates),
      status: "CONTROL_SEALED_FAIL",
      reason: "NEGATIVE_CONTROL_DETECTOR_MISSED",
      negativeStatus: "CONTROL_SEALED_FAIL",
      aaStatus: "CONTROL_SEALED_PASS",
      breaches: 0,
      directionFailures: 0,
      noisyCases: 0,
      signatureBreaches: null,
    },
    {
      runId: "g17-noisy-inconclusive-fixture",
      elapsedNs: (coordinates) =>
        ((coordinates.globalBlock + coordinates.slot) % 2 === 0
          ? 65_000
          : 160_000) +
        offset(coordinates) +
        (coordinates.controlName === "negativeControl" &&
        coordinates.arm === "subject"
          ? 20_000
          : 0),
      status: "CONTROL_SEALED_INCONCLUSIVE",
      reason: "CONTROL_NOISE_INCONCLUSIVE",
      negativeStatus: "CONTROL_SEALED_INCONCLUSIVE",
      aaStatus: "CONTROL_SEALED_INCONCLUSIVE",
      breaches: 0,
      directionFailures: 0,
      noisyCases: 7,
      signatureBreaches: null,
    },
  ];

  for (const expected of cases) {
    const fixture = createG17ControlReceiptFixture({
      controlRunId: expected.runId,
      elapsedNs: expected.elapsedNs,
    });
    const replay = replayG17ControlReceiptFixture(fixture);
    assert.equal(replay.status, "CANDIDATE_REPLAYED");
    assert.equal(replay.outcome, expected.status);
    assert.equal(replay.statistics.status, expected.status);
    assert.equal(replay.statistics.reason, expected.reason);
    assert.equal(
      replay.statistics.negativeControl.status,
      expected.negativeStatus,
    );
    assert.equal(replay.statistics.aaNoiseControl.status, expected.aaStatus);
    assert.equal(
      replay.statistics.negativeControl.quietBreaches.length,
      expected.breaches,
    );
    assert.equal(
      replay.statistics.aaNoiseControl.quietDirectionFailures.length,
      expected.directionFailures,
    );
    assert.equal(
      replay.statistics.negativeControl.noisyCases.length,
      expected.noisyCases,
    );
    assert.equal(
      replay.statistics.aaNoiseControl.noisyCases.length,
      expected.noisyCases,
    );
    assert.equal(
      replay.negativeControlSignature?.budgetBreaches.length ?? null,
      expected.signatureBreaches,
    );
    assert.equal(
      replay.receipt.negativeControlSignature?.contentHash ?? null,
      replay.negativeControlSignature?.contentHash ?? null,
    );
    assert.equal(replay.finalDecisionEligible, false);
    assert.equal(replay.binding, null);
    assert.deepEqual(replay.authority, AUTHORITY);
  }
});

test("coherently resealed projection, statistics, signature, environment, and authority substitutions fail closed", () => {
  const mutations = [
    (receipt) => {
      receipt.ownerBundle.projectionSha256 = "0".repeat(64);
    },
    (receipt) => {
      receipt.statistics.projectionSha256 = "1".repeat(64);
    },
    (receipt) => {
      receipt.statistics.reason = "POST_RESULT_TUNING";
    },
    (receipt) => {
      receipt.negativeControlSignature.sampleSetSha256 = "2".repeat(64);
      const { contentHash: ignored, ...unsigned } =
        receipt.negativeControlSignature;
      receipt.negativeControlSignature.contentHash = canonicalSha256(unsigned);
    },
    (receipt) => {
      receipt.environmentClass = "linux-x86_64-tmpfs-unserialized";
    },
    (receipt) => {
      receipt.authority.qualificationExecution = true;
    },
  ];
  for (const mutate of mutations) {
    const fixture = createG17ControlReceiptFixture();
    const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
    mutate(receipt);
    const bytes = g17ControlReceiptBytes(g17ResealControlReceipt(receipt));
    assert.throws(
      () => replayG17ControlReceiptFixture(fixture, { receiptBytes: bytes }),
      RECEIPT_ERROR,
    );
  }
});

test("receipt replay rejects missing, extra, substituted, and coherently misdescribed inventory", () => {
  const fixture = createG17ControlReceiptFixture();
  for (const artifactsByName of [
    new Map(),
    new Map([
      ...fixture.artifactsByName,
      ["unreviewed.json", Buffer.from("{}\n", "utf8")],
    ]),
    g17ControlReceiptArtifactsByName(
      Buffer.concat([fixture.ownerBatchBytes, Buffer.from(" ", "utf8")]),
    ),
  ]) {
    assert.throws(
      () => replayG17ControlReceiptFixture(fixture, { artifactsByName }),
      RECEIPT_ERROR,
    );
  }

  for (const mutate of [
    (entry) => {
      entry.name = "../escape.json";
    },
    (entry) => {
      entry.schema = "oxigraph.g1.7-unreviewed-owner-batch/v1";
    },
    (entry) => {
      entry.bytes += 1;
    },
    (entry) => {
      entry.sha256 = "f".repeat(64);
    },
  ]) {
    const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
    mutate(receipt.inventory[0]);
    const receiptBytes = g17ControlReceiptBytes(
      g17ResealControlReceipt(receipt),
    );
    assert.throws(
      () => replayG17ControlReceiptFixture(fixture, { receiptBytes }),
      RECEIPT_ERROR,
    );
  }
});

test("coherently resealed batch reordering and owner substitution fail raw replay", () => {
  const mutations = [
    (batch) => {
      batch.builds.reverse();
    },
    (batch) => {
      batch.controls.reverse();
    },
    (batch) => {
      batch.controls[0].launches.reverse();
    },
    (batch) => {
      batch.controls[0].launches[1] = structuredClone(
        batch.controls[0].launches[0],
      );
    },
    (batch) => {
      batch.builds[1].workspaceOwner = structuredClone(
        batch.builds[0].workspaceOwner,
      );
    },
  ];
  for (const mutate of mutations) {
    const fixture = createG17ControlReceiptFixture();
    const batch = decodeBatch(fixture.ownerBatchBytes);
    mutate(batch);
    const batchBytes = resealBatch(batch);
    const inputs = receiptAndArtifactsForBatch(fixture, batchBytes);
    assert.throws(
      () =>
        replayG17ControlReceipt({
          authorizationBytes: fixture.authorizationBytes,
          ...inputs,
        }),
      REPLAY_ERROR,
    );
  }
});

test("batch replay rejects malformed byte leaves even when outer hashes are resealed", () => {
  const mutations = [
    (leaf) => {
      leaf.base64 = `${leaf.base64}=`;
    },
    (leaf) => {
      leaf.bytes += 1;
    },
    (leaf) => {
      leaf.sha256 = "0".repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const fixture = createG17ControlReceiptFixture();
    const batch = decodeBatch(fixture.ownerBatchBytes);
    mutate(batch.controls[0].launches[0].stdout);
    const batchBytes = resealBatch(batch);
    const inputs = receiptAndArtifactsForBatch(fixture, batchBytes);
    assert.throws(
      () =>
        replayG17ControlReceipt({
          authorizationBytes: fixture.authorizationBytes,
          ...inputs,
        }),
      RECEIPT_ERROR,
    );
  }
});

test("receipt construction enforces strict approval, start, and completion ordering", () => {
  const fixture = createG17ControlReceiptFixture();
  const approvedAt = fixture.authorization.approval.approvedAt;
  for (const [startedAt, completedAt] of [
    [approvedAt, G17_CONTROL_RECEIPT_COMPLETED_AT],
    [G17_CONTROL_RECEIPT_STARTED_AT, G17_CONTROL_RECEIPT_STARTED_AT],
    [G17_CONTROL_RECEIPT_COMPLETED_AT, G17_CONTROL_RECEIPT_STARTED_AT],
    ["2026-08-28T08:01:00Z", G17_CONTROL_RECEIPT_COMPLETED_AT],
  ]) {
    assert.throws(
      () =>
        buildG17ControlReceiptCandidate({
          authorizationBytes: fixture.authorizationBytes,
          controlRunId: fixture.controlRunId,
          startedAt,
          completedAt,
          artifacts: fixture.artifacts,
        }),
      RECEIPT_ERROR,
    );
  }
});

test("authorization is recomputed from exact canonical bytes and claimed raw hashes are impossible", () => {
  const fixture = createG17ControlReceiptFixture();
  const receipt = g17DecodeControlReceipt(fixture.receiptBytes);
  assert.equal(
    receipt.authorization.rawSha256,
    sha256(fixture.authorizationBytes),
  );

  const proposed = structuredClone(fixture.authorization);
  proposed.status = "CONTROL_AUTH_PROPOSED";
  proposed.approval = {
    status: "UNAPPROVED",
    approvedBy: null,
    approvedAt: null,
  };
  const { contentHash: ignored, ...unsigned } = proposed;
  proposed.contentHash = canonicalSha256(unsigned);
  const proposedBytes = Buffer.from(`${canonicalJson(proposed)}\n`, "utf8");
  assert.throws(
    () =>
      buildG17ControlReceiptCandidate({
        authorizationBytes: proposedBytes,
        controlRunId: fixture.controlRunId,
        startedAt: fixture.startedAt,
        completedAt: fixture.completedAt,
        artifacts: fixture.artifacts,
      }),
    RECEIPT_ERROR,
  );

  const noncanonicalAuthorizationBytes = Buffer.concat([
    fixture.authorizationBytes.subarray(0, -1),
    Buffer.from(" \n", "utf8"),
  ]);
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        authorizationBytes: noncanonicalAuthorizationBytes,
      }),
    REPLAY_ERROR,
  );

  assert.throws(
    () =>
      buildG17ControlReceiptCandidate({
        authorizationBytes: fixture.authorizationBytes,
        authorizationRawSha256: "0".repeat(64),
        controlRunId: fixture.controlRunId,
        startedAt: fixture.startedAt,
        completedAt: fixture.completedAt,
        artifacts: fixture.artifacts,
      }),
    RECEIPT_ERROR,
  );
  assert.throws(
    () =>
      replayG17ControlReceipt({
        authorizationBytes: fixture.authorizationBytes,
        authorizationRawSha256: "0".repeat(64),
        receiptBytes: fixture.receiptBytes,
        artifactsByName: fixture.artifactsByName,
      }),
    RECEIPT_ERROR,
  );
});

test("single-batch v1 rejects oversized evidence before copying or base64 encoding", () => {
  assert.deepEqual(G17_BENCHMARK_OWNER_BATCH_V1_LIMITS, {
    maxEncodedBytes: 67_108_864,
    maxDecodedBytes: 48 * 1024 * 1024,
    maxBuffers: 2_048,
    maxArrayLength: 4_096,
    maxDepth: 64,
    maxStringBytes: 4 * 1024 * 1024,
    maxSingleStringBytes: 1024 * 1024,
  });
  const fixture = createG17ControlReceiptFixture();
  const oversizedArtifacts = {
    ...fixture.artifacts,
    builds: fixture.artifacts.builds.map((build, index) =>
      index === 0
        ? {
            ...build,
            buildStdoutBytes: Buffer.alloc(
              G17_BENCHMARK_OWNER_BATCH_V1_LIMITS.maxDecodedBytes + 1,
            ),
          }
        : build,
    ),
  };
  assert.throws(
    () =>
      g17BenchmarkOwnerBatchBytes({
        controlRunId: fixture.controlRunId,
        artifacts: oversizedArtifacts,
      }),
    /v1 owner-batch byte budget/u,
  );
  const oversizedStringArtifacts = {
    ...fixture.artifacts,
    builds: fixture.artifacts.builds.map((build, index) =>
      index === 0
        ? {
            ...build,
            buildId: "x".repeat(
              G17_BENCHMARK_OWNER_BATCH_V1_LIMITS.maxSingleStringBytes + 1,
            ),
          }
        : build,
    ),
  };
  assert.throws(
    () =>
      g17BenchmarkOwnerBatchBytes({
        controlRunId: fixture.controlRunId,
        artifacts: oversizedStringArtifacts,
      }),
    /v1 owner-batch string budget/u,
  );
  assert.throws(
    () =>
      buildG17ControlReceiptCandidate({
        authorizationBytes: fixture.authorizationBytes,
        controlRunId: fixture.controlRunId,
        startedAt: fixture.startedAt,
        completedAt: fixture.completedAt,
        artifacts: oversizedArtifacts,
      }),
    /v1 owner-batch byte budget/u,
  );
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        authorizationBytes: Buffer.alloc(131_073, 0x61),
      }),
    /per-file ceiling/u,
  );
});

test("hostile replay enforces v1 array, buffer-count, and depth ceilings", () => {
  const fixture = createG17ControlReceiptFixture();

  const oversizedArrayBatch = decodeBatch(fixture.ownerBatchBytes);
  oversizedArrayBatch.builds = Array.from(
    { length: G17_BENCHMARK_OWNER_BATCH_V1_LIMITS.maxArrayLength + 1 },
    () => structuredClone(oversizedArrayBatch.builds[0]),
  );
  const oversizedArrayBytes = resealBatch(oversizedArrayBatch);
  assert.throws(
    () =>
      replayG17ControlReceipt({
        authorizationBytes: fixture.authorizationBytes,
        ...receiptAndArtifactsForBatch(fixture, oversizedArrayBytes),
      }),
    /array length is invalid/u,
  );

  const excessiveBufferBatch = decodeBatch(fixture.ownerBatchBytes);
  const launch = excessiveBufferBatch.controls[0].launches[0];
  excessiveBufferBatch.controls[0].launches = Array.from(
    { length: 500 },
    (_, sequence) => ({ ...structuredClone(launch), sequence }),
  );
  const excessiveBufferBytes = resealBatch(excessiveBufferBatch);
  assert.throws(
    () =>
      replayG17ControlReceipt({
        authorizationBytes: fixture.authorizationBytes,
        ...receiptAndArtifactsForBatch(fixture, excessiveBufferBytes),
      }),
    /v1 owner-batch replay budget/u,
  );

  const deepAuthorization = JSON.parse(fixture.authorizationBytes);
  deepAuthorization.unapproved = nestedObject(
    G17_BENCHMARK_OWNER_BATCH_V1_LIMITS.maxDepth + 1,
  );
  const deepAuthorizationBytes = Buffer.from(
    `${canonicalJson(deepAuthorization)}\n`,
    "utf8",
  );
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        authorizationBytes: deepAuthorizationBytes,
      }),
    /depth ceiling/u,
  );

  const deepReceipt = g17DecodeControlReceipt(fixture.receiptBytes);
  deepReceipt.unapproved = nestedObject(
    G17_BENCHMARK_OWNER_BATCH_V1_LIMITS.maxDepth + 1,
  );
  assert.throws(
    () =>
      replayG17ControlReceiptFixture(fixture, {
        receiptBytes: Buffer.from(`${canonicalJson(deepReceipt)}\n`, "utf8"),
      }),
    /depth ceiling/u,
  );

  const deepArtifacts = {
    ...fixture.artifacts,
    unapproved: nestedObject(G17_BENCHMARK_OWNER_BATCH_V1_LIMITS.maxDepth + 1),
  };
  assert.throws(
    () =>
      buildG17ControlReceiptCandidate({
        authorizationBytes: fixture.authorizationBytes,
        controlRunId: fixture.controlRunId,
        startedAt: fixture.startedAt,
        completedAt: fixture.completedAt,
        artifacts: deepArtifacts,
      }),
    /depth ceiling/u,
  );
});

test("receipt replay snapshots all inputs and returns a detached immutable projection", () => {
  const fixture = createG17ControlReceiptFixture();
  const replay = replayG17ControlReceiptFixture(fixture);
  const before = canonicalJson(replay);
  fixture.authorizationBytes.fill(0x77);
  fixture.receiptBytes.fill(0x78);
  fixture.ownerBatchBytes.fill(0x79);
  fixture.artifactsByName.get(G17_BENCHMARK_OWNER_BATCH_NAME).fill(0x7a);
  assert.equal(canonicalJson(replay), before);
  assertDeepFrozen(replay);
});

test("control receipt replay imports no live owner, filesystem, process, storage, runner, or Darwin module", async () => {
  const source = await readFile(
    new URL(
      "../src/qualification/control-receipt-contract.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const forbidden of [
    "node:child_process",
    "node:fs",
    "node:os",
    "node:process",
    "@metaharness/darwin",
    "benchmark-contract.mjs",
    "contained-session",
    "native-platform.mjs",
    "native-workspace.mjs",
    "runner.mjs",
    "storage.mjs",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`from ["'][^"']*${forbidden.replaceAll(".", "\\.")}`, "u"),
      forbidden,
    );
  }
  assert.doesNotMatch(source, /\bprocess\./u);
});
