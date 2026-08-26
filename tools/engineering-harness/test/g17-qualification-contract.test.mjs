import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bench } from "@metaharness/darwin";
import {
  g17ContractPath,
  loadG17Contract,
  validateG17Contract,
} from "../src/qualification/contract.mjs";

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
    loaded.contract.compatibility.native.map(({ id, expectedPassedTests }) => ({
      id,
      expectedPassedTests,
    })),
    [
      { id: "transaction-compatibility", expectedPassedTests: 20 },
      { id: "bulk-sst-writer-serialization", expectedPassedTests: 1 },
      { id: "update-atomicity", expectedPassedTests: 2 },
    ],
  );
  assert.equal(Object.isFrozen(loaded.contract), true);
  assert.equal(Object.isFrozen(loaded.contract.benchmark.suite.tasks), true);
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
