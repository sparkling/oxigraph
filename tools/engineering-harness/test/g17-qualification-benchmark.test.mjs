import assert from "node:assert/strict";
import test from "node:test";

import { bench } from "@metaharness/darwin";
import {
  summarizeG17Samples,
  verifyG17BenchmarkSuite,
} from "../src/qualification/benchmark.mjs";

function fixtureContract() {
  const tasks = [
    {
      id: "writers-1-rocksdb",
      backend: "rocksdb",
      binding: "transaction",
      writers: 1,
      concurrentReaders: true,
      operations: 10,
    },
  ];
  return {
    benchmark: {
      suite: {
        id: "fixture",
        version: "1",
        taskHash: bench.hashTasks(tasks),
        tasks,
      },
      protocol: {
        schedules: [
          ["subject", "reference", "reference", "subject"],
          ["reference", "subject", "subject", "reference"],
        ],
        warmupBlocks: 0,
        measuredBlocks: 1,
        seed: 17,
        seedDerivation: "base-plus-case100000-plus-globalblock2-plus-pair",
      },
      statistics: {
        bootstrapSamples: 5000,
        bootstrapSeed: 17,
      },
    },
  };
}

function samples() {
  return [
    ["subject", 0, 100],
    ["reference", 1, 120],
    ["reference", 2, 100],
    ["subject", 3, 80],
  ].map(([implementation, slot, elapsedNs]) => ({
    schema: "oxigraph.g1.7-qualification-sample/v1",
    caseId: "writers-1-rocksdb",
    phase: "measured",
    block: 0,
    slot,
    repetition: slot,
    seed: 17 + Math.floor(slot / 2),
    implementation,
    elapsedNs,
    operations: 10,
    bytes: 1280,
    readerObservations: 1,
    executableSha256: implementation === "subject" ? "a".repeat(64) : "b".repeat(64),
  }));
}

test("G1.7 benchmark summary verifies Darwin suite and exact ABBA inventory", () => {
  const contract = fixtureContract();
  assert.deepEqual(verifyG17BenchmarkSuite(contract), {
    ok: true,
    expected: contract.benchmark.suite.taskHash,
    actual: contract.benchmark.suite.taskHash,
  });
  const summary = summarizeG17Samples(samples(), contract);
  assert.equal(summary.owner, "@metaharness/darwin");
  assert.equal(summary.cases.length, 1);
  assert.deepEqual(summary.cases[0].subject, {
    count: 2,
    medianElapsedNs: 90,
    p95ElapsedNs: 100,
    medianAbsoluteDeviationNs: 10,
  });
  assert.deepEqual(summary.cases[0].reference, {
    count: 2,
    medianElapsedNs: 110,
    p95ElapsedNs: 120,
    medianAbsoluteDeviationNs: 10,
  });
  const expectedBootstrap = bench.bootstrapDelta(
    [-120, -100],
    [-100, -80],
    { samples: 5000, seed: 17, minDelta: 0 },
  );
  assert.deepEqual(summary.cases[0].bootstrap, expectedBootstrap);
});

test("G1.7 benchmark rejects suite tampering and raw-sample drift", () => {
  const contract = fixtureContract();
  const tamperedSuite = structuredClone(contract);
  tamperedSuite.benchmark.suite.tasks[0].operations = 11;
  assert.throws(
    () => verifyG17BenchmarkSuite(tamperedSuite),
    /Darwin benchmark suite/u,
  );

  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.reverse(),
    (rows) => {
      rows[0].elapsedNs = 1.5;
    },
    (rows) => {
      rows[0].seed += 1;
    },
    (rows) => {
      rows[0].implementation = "candidate";
    },
    (rows) => {
      rows[0].readerObservations = 0;
    },
  ]) {
    const rows = samples();
    mutate(rows);
    assert.throws(() => summarizeG17Samples(rows, contract), /G1\.7 benchmark/u);
  }
});
