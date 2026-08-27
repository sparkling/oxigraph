import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bench } from "@metaharness/darwin";
import {
  G17_CONTRACT_GENERATION,
  G17_LEGACY_CONTRACT_SHA256,
  decodeSealedG17Contract,
  g17ContractCompatibilityGeneration,
  g17ContractPath,
  loadG17Contract,
  validateG17Contract,
} from "../src/qualification/contract.mjs";

const legacyContractUrl = new URL(
  "fixtures/g17-qualification-contract-v1.json",
  import.meta.url,
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlob(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

const CASE_IDS = [
  "on-store-memory",
  "on-dataset-memory",
  "on-store-rocksdb",
  "on-dataset-rocksdb",
  "writers-1-rocksdb",
  "writers-4-rocksdb",
  "writers-16-rocksdb",
];

test("G1.7 freezes an immutable Darwin suite and honest unapproved decisions", async () => {
  const loaded = loadG17Contract();
  assert.equal(loaded.generation, G17_CONTRACT_GENERATION.CURRENT_V3);
  assert.match(loaded.contractSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    loaded.contract.benchmark.suite.tasks.map(({ id }) => id),
    CASE_IDS,
  );
  assert.equal(
    loaded.contract.benchmark.suite.taskHash,
    bench.hashTasks(loaded.contract.benchmark.suite.tasks),
  );
  assert.deepEqual(bench.verifySuite(loaded.contract.benchmark.suite), {
    ok: true,
    expected: loaded.contract.benchmark.suite.taskHash,
    actual: loaded.contract.benchmark.suite.taskHash,
  });
  assert.deepEqual(loaded.contract.referenceDecision, {
    status: "UNSELECTED",
    commit: null,
    tree: null,
    approvedBy: null,
    approvedAt: null,
  });
  assert.equal(loaded.contract.budgetDecision.status, "ABSENT");
  assert.equal(loaded.contract.noiseDecision.status, "ABSENT");
  assert.deepEqual(loaded.contract.benchmark.protocol.schedules, [
    ["subject", "reference", "reference", "subject"],
    ["reference", "subject", "subject", "reference"],
  ]);
  assert.equal(
    loaded.contract.benchmark.protocol.seedDerivation,
    "base-plus-case100000-plus-globalblock2-plus-pair",
  );
  assert.equal(loaded.contract.benchmark.protocol.adaptiveStopping, false);
  assert.equal(loaded.contract.benchmark.protocol.outlierDeletion, false);
  assert.deepEqual(loaded.contract.authority, {
    localOnly: true,
    promotionAuthority: false,
    routerQualityAuthority: false,
    publicationAuthority: false,
  });
  assert.deepEqual(loaded.contract.compatibility.agenticQe, {
    profile: "g1-regression",
    commandIds: [
      "g11TransactionStateModel",
      "g12TransactionConcurrency",
      "g13TransactionCapabilities",
      "g14RocksdbWriterSerialization",
      "g15SparqlEgressPolicy",
      "g15bSparqlUpdateCancellation",
      "g15cSparqlNegotiatedUpdate",
      "g16EffectiveCapabilities",
      "g16ServiceClaims",
      "g16CompatibilityCanary",
      "g16SparqlVersion",
    ],
    expectedCommands: 11,
    expectedPassedTests: 66,
  });
  assert.deepEqual(
    loaded.contract.compatibility.native.map(
      ({ id, expectedTestIds, expectedPassedTests, maxOutputBytes, timeoutMs }) => ({
        id,
        expectedTestIds: expectedTestIds.length,
        expectedPassedTests,
        maxOutputBytes,
        timeoutMs,
      }),
    ),
    [
      {
        id: "transaction-compatibility",
        expectedTestIds: 20,
        expectedPassedTests: 20,
        maxOutputBytes: 1_048_576,
        timeoutMs: 300_000,
      },
      {
        id: "bulk-sst-writer-serialization",
        expectedTestIds: 1,
        expectedPassedTests: 1,
        maxOutputBytes: 1_048_576,
        timeoutMs: 300_000,
      },
      {
        id: "update-atomicity",
        expectedTestIds: 2,
        expectedPassedTests: 2,
        maxOutputBytes: 1_048_576,
        timeoutMs: 300_000,
      },
    ],
  );
  for (const lane of loaded.contract.compatibility.native) {
    assert.deepEqual(lane.expectedTestIds, [...lane.expectedTestIds].sort());
    assert.equal(new Set(lane.expectedTestIds).size, lane.expectedTestIds.length);
  }
  assert.deepEqual(loaded.contract.compatibility.nativeSession, {
    maxTotalWallMs: 1_860_000,
    maxResidentBytes: 17_179_869_184,
    maxDiskBytes: 12_884_901_888,
    cargoBuildJobs: 4,
    tasksMax: 512,
    memorySwapMaxBytes: 0,
  });
  assert.equal(Object.isFrozen(loaded.contract), true);
  assert.equal(Object.isFrozen(loaded.contract.benchmark.suite.tasks), true);
});

test("sealed contract dispatch authenticates exact legacy bytes before schema parsing", async () => {
  const legacyBytes = await readFile(legacyContractUrl);
  assert.equal(legacyBytes.length, 6_945);
  assert.equal(
    sha256(legacyBytes),
    "e267e4d276a3d0b7997c2522d3f24ca7a32f669282c5f2ea332a752c3322c54c",
  );
  assert.equal(
    gitBlob(legacyBytes),
    "d281db1f02b0a67e19edcd16a49435301b6eca4c",
  );
  assert.equal(G17_LEGACY_CONTRACT_SHA256, sha256(legacyBytes));
  const decoded = decodeSealedG17Contract({
    bytes: legacyBytes,
    receiptSha256: sha256(legacyBytes),
  });
  assert.equal(decoded.generation, G17_CONTRACT_GENERATION.LEGACY_V1);
  assert.equal(decoded.contract.schema, "oxigraph.g1.7-qualification-contract/v1");
  assert.equal(Object.isFrozen(decoded.contract), true);

  assert.throws(
    () => decodeSealedG17Contract({
      bytes: legacyBytes,
      receiptSha256: "0".repeat(64),
    }),
    /receipt digest/u,
  );
  for (const bytes of [
    Buffer.concat([legacyBytes, Buffer.from(" ")]),
    Buffer.from(
      legacyBytes.toString("utf8").replace(
        "qualification-contract/v1",
        "qualification-contract/v2",
      ),
      "utf8",
    ),
  ]) {
    assert.throws(
      () => decodeSealedG17Contract({ bytes, receiptSha256: sha256(bytes) }),
      /unsupported byte identity/u,
    );
  }
});

test("contract and compatibility generations cannot be mixed for PASS evidence", () => {
  assert.deepEqual(
    g17ContractCompatibilityGeneration({
      contractGeneration: G17_CONTRACT_GENERATION.LEGACY_V1,
      compatibilityStatus: "PASS",
      compatibilitySchemaState: "LEGACY_REPLAY_ONLY",
    }),
    {
      currentContract: false,
      currentCompatibility: false,
      legacyReplayOnly: true,
    },
  );
  assert.deepEqual(
    g17ContractCompatibilityGeneration({
      contractGeneration: G17_CONTRACT_GENERATION.CURRENT_V3,
      compatibilityStatus: "PASS",
      compatibilitySchemaState: "CURRENT_SCHEMA_UNREPLAYED",
    }),
    {
      currentContract: true,
      currentCompatibility: true,
      legacyReplayOnly: false,
    },
  );
  for (const [contractGeneration, compatibilitySchemaState] of [
    [G17_CONTRACT_GENERATION.LEGACY_V1, "CURRENT_SCHEMA_UNREPLAYED"],
    [G17_CONTRACT_GENERATION.CURRENT_V3, "LEGACY_REPLAY_ONLY"],
  ]) {
    assert.throws(
      () => g17ContractCompatibilityGeneration({
        contractGeneration,
        compatibilityStatus: "PASS",
        compatibilitySchemaState,
      }),
      /generations are mixed/u,
    );
  }
});

test("G1.7 contract validation rejects suite, decision, evaluator, and authority drift", async () => {
  const pristine = JSON.parse(await readFile(g17ContractPath, "utf8"));
  for (const mutate of [
    (contract) => {
      contract.benchmark.suite.tasks[0].operations += 1;
    },
    (contract) => {
      contract.referenceDecision.commit = "a".repeat(40);
    },
    (contract) => {
      contract.budgetDecision.path = "docs/budget.json";
    },
    (contract) => {
      contract.noiseDecision.sha256 = "b".repeat(64);
    },
    (contract) => {
      contract.evaluator.parent = contract.evaluator.commit;
    },
    (contract) => {
      contract.authority.promotionAuthority = true;
    },
    (contract) => {
      contract.benchmark.protocol.outlierDeletion = true;
    },
  ]) {
    const candidate = structuredClone(pristine);
    mutate(candidate);
    assert.throws(() => validateG17Contract(candidate), /G1\.7 qualification contract/u);
  }
});

test("G1.7 contract is a regular committed-path artifact", async () => {
  const bytes = await readFile(g17ContractPath);
  assert.ok(bytes.length > 0 && bytes.length < 1024 * 1024);
  assert.match(g17ContractPath, /qualification\/g1\.7\/contract\.json$/u);
});
