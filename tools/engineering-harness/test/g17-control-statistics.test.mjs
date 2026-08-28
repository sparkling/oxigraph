import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_CONTROL_STATISTICS_CONTRACT,
  G17_DARWIN_PAIRED_BOOTSTRAP_BINDING,
} from "../src/qualification/control-statistics-contract.mjs";
import {
  g17CanonicalSampleSetFrameBytes,
  g17ControlSampleSetBytes,
  g17ControlSampleSetSha256,
  replayG17DarwinBootstrapDelta,
  summarizeG17ControlSampleSets,
} from "../src/qualification/control-statistics-replay.mjs";
import { loadG17DarwinFunctions } from "../src/qualification/benchmark-contract.mjs";
import {
  g17ControlSampleSet,
  passingG17ControlSampleSets,
} from "./support/g17-control-statistics-fixture.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const { pairedBootstrapDelta, unpairedBootstrapDelta } =
  await loadG17DarwinFunctions();

test("pure replay is differential-equivalent to the installed Darwin paired algorithm", () => {
  const corpus = [
    { previous: [], next: [], options: undefined },
    { previous: [0], next: [0], options: { samples: 1, seed: 0, minDelta: 0 } },
    {
      previous: [0, 0],
      next: [0.1, 0.2],
      options: { samples: 5_000, seed: 170_017, minDelta: 0 },
    },
    {
      previous: [10, -5, 3],
      next: [11, -4, 2],
      options: { samples: 997, seed: 0xffff_ffff, minDelta: -2 },
    },
    {
      previous: [1, 2],
      next: [4, 5, 6],
      options: { samples: 311, seed: 42, minDelta: 0.05 },
    },
  ];
  for (const entry of corpus) {
    assert.deepEqual(
      replayG17DarwinBootstrapDelta(entry.previous, entry.next, entry.options),
      pairedBootstrapDelta(entry.previous, entry.next, entry.options),
    );
  }
  assert.equal(G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.version, "0.9.3");
  assert.equal(
    G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.statisticsModuleSha256,
    "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
  );
});

test("canonical sample-set bytes preserve the exact ordered inventory and hash", () => {
  const sampleSet = g17ControlSampleSet({ controlName: "negativeControl" });
  const bytes = g17ControlSampleSetBytes(sampleSet, "negativeControl");
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(bytes.subarray(0, -1).includes(0x0a), false);
  assert.equal(sampleSet.rows.length, 196);
  assert.equal(JSON.parse(bytes).runId, "g17-control-fixture");
  assert.deepEqual(JSON.parse(bytes).authorization, {
    contentHash: "f".repeat(64),
    rawSha256: "e".repeat(64),
  });
  assert.equal(
    g17ControlSampleSetSha256(sampleSet, "negativeControl"),
    g17ControlSampleSetSha256(structuredClone(sampleSet), "negativeControl"),
  );
  assert.equal(JSON.parse(bytes).rows[0].caseId, "on-store-memory");
  assert.equal(JSON.parse(bytes).rows.at(-1).caseId, "writers-16-rocksdb");
});

test("canonical sample-set framing matches the independent 512-byte oracle", () => {
  const rows = [
    {
      caseId: "on-store-memory",
      elapsedNs: 10_900,
      implementation: "subject",
    },
    {
      caseId: "on-store-memory",
      elapsedNs: 10_000,
      implementation: "reference",
    },
  ];
  const frame = {
    authorization: {
      contentHash: "1".repeat(64),
      rawSha256: "0".repeat(64),
    },
    controlId: "negative-control",
    rows,
    runId: "run-1",
    schema: "oxigraph.g1.7-control-sample-set/v1",
    suiteHash: "2".repeat(64),
  };
  const expectedPayload =
    '{"authorization":{"contentHash":"1111111111111111111111111111111111111111111111111111111111111111","rawSha256":"0000000000000000000000000000000000000000000000000000000000000000"},"controlId":"negative-control","rows":[{"caseId":"on-store-memory","elapsedNs":10900,"implementation":"subject"},{"caseId":"on-store-memory","elapsedNs":10000,"implementation":"reference"}],"runId":"run-1","schema":"oxigraph.g1.7-control-sample-set/v1","suiteHash":"2222222222222222222222222222222222222222222222222222222222222222"}';
  const bytes = g17CanonicalSampleSetFrameBytes(frame);
  assert.equal(bytes.toString("utf8"), `${expectedPayload}\n`);
  assert.equal(bytes.length, 512);
  assert.equal(
    sha256(bytes),
    "0bc9c99a6f4ba58cd1f0e57f812c56b1e30dc1534681273200926b4d2a3c5c24",
  );
  assert.equal(
    sha256(bytes.subarray(0, -1)),
    "c0ca25133e1607e9e1ca22a7f7343ee746abc1b8ff7c28f1d2d747cc06ffff88",
  );
  assert.equal(
    sha256(
      g17CanonicalSampleSetFrameBytes({
        ...frame,
        rows: [...rows].reverse(),
      }),
    ),
    "e167eec6afcaf2de38ca230820cf7333eca2ae71be9017ba46de0466cadc207a",
  );
});

test("negative control detects a quiet ten-percent non-inferiority breach", () => {
  const passing = passingG17ControlSampleSets();
  const projection = summarizeG17ControlSampleSets(passing);
  assert.equal(projection.status, "CONTROL_SEALED_PASS");
  assert.equal(
    projection.reason,
    "NEGATIVE_BREACH_AND_AA_EQUIVALENCE_CONFIRMED",
  );
  assert.equal(projection.negativeControl.quietBreaches.length, 7);
  assert.deepEqual(projection.aaNoiseControl.quietDirectionFailures, []);
  assert.equal(projection.authority.controlReceipt, false);
  assert.equal(projection.authority.qualificationExecution, false);

  for (const [ratio, expectedStrictPass] of [
    [1.099, true],
    [1.1, false],
    [1.101, false],
  ]) {
    const sets = passingG17ControlSampleSets();
    sets.negativeControl = g17ControlSampleSet({
      controlName: "negativeControl",
      elapsedNs: ({ arm }) =>
        arm === "subject" ? Math.round(100_000 * ratio) : 100_000,
    });
    const result = summarizeG17ControlSampleSets(sets);
    assert.equal(
      result.negativeControl.cases.every(
        ({ nonInferiority }) =>
          nonInferiority.strictPass === expectedStrictPass,
      ),
      true,
    );
  }
});

test("A/A TOST uses one shared seed and both strict five-percent directions", () => {
  for (const [ratio, expectedStatus] of [
    [1.049, "CONTROL_SEALED_PASS"],
    [1.05, "CONTROL_SEALED_FAIL"],
    [1.051, "CONTROL_SEALED_FAIL"],
    [1 / 1.049, "CONTROL_SEALED_PASS"],
    [1 / 1.05, "CONTROL_SEALED_FAIL"],
  ]) {
    const sets = passingG17ControlSampleSets();
    sets.aaNoiseControl = g17ControlSampleSet({
      controlName: "aaNoiseControl",
      elapsedNs: ({ arm }) =>
        arm === "subject" ? Math.round(100_000 * ratio) : 100_000,
    });
    const projection = summarizeG17ControlSampleSets(sets);
    assert.equal(projection.status, expectedStatus, `ratio ${ratio}`);
    for (const { equivalence } of projection.aaNoiseControl.cases) {
      assert.equal(equivalence.aWithinB.seed, equivalence.bWithinA.seed);
      assert.equal(equivalence.sharedResampleSeed, equivalence.aWithinB.seed);
    }
    assert.deepEqual(
      projection.aaNoiseControl.cases.map(
        ({ equivalence }) => equivalence.sharedResampleSeed,
      ),
      [170_017, 170_018, 170_019, 170_020, 170_021, 170_022, 170_023],
    );
  }
});

test("lower95 zero is a strict failure", () => {
  assert.deepEqual(
    replayG17DarwinBootstrapDelta([0, 0], [0, 0], {
      samples: 5_000,
      seed: 170_017,
      minDelta: 0,
    }),
    {
      meanDelta: 0,
      lower95: 0,
      upper95: 0,
      promote: false,
      samples: 5_000,
      pValue: 1,
    },
  );
  assert.equal(
    replayG17DarwinBootstrapDelta([0, 0], [0.000001, 0.000001], {
      samples: 5_000,
      seed: 170_017,
      minDelta: 0,
    }).promote,
    true,
  );
});

test("oracle seed vector binds case-index seed derivation exactly", () => {
  const reference = new Array(10).fill(100_000);
  const subject = [
    95_000, 97_000, 99_000, 101_000, 103_000, 105_000, 107_000, 109_000,
    111_000, 113_000,
  ];
  const margins = reference.map(
    (value, index) =>
      Math.round(
        (Math.log(value) - Math.log(subject[index]) + Math.log1p(0.1)) * 1e12,
      ) / 1e12,
  );
  assert.deepEqual(
    margins,
    [
      0.146603474192, 0.125769387289, 0.105360515658, 0.085359848951,
      0.065751377563, 0.046520015635, 0.027651531331, 0.009132483563,
      -0.00904983552, -0.02690745292,
    ],
  );
  assert.deepEqual(
    replayG17DarwinBootstrapDelta(new Array(10).fill(0), margins, {
      samples: 5_000,
      seed: 170_017,
      minDelta: 0,
    }),
    {
      meanDelta: 0.057689,
      lower95: 0.022926,
      upper95: 0.092745,
      promote: true,
      samples: 5_000,
      pValue: 0,
    },
  );
  assert.deepEqual(
    replayG17DarwinBootstrapDelta(new Array(10).fill(0), margins, {
      samples: 5_000,
      seed: 170_018,
      minDelta: 0,
    }),
    {
      meanDelta: 0.058064,
      lower95: 0.024712,
      upper95: 0.092545,
      promote: true,
      samples: 5_000,
      pValue: 0.0004,
    },
  );
});

test("paired analysis is not substituted with the unpaired estimator", () => {
  const reference = [
    100_000, 1_000_000, 125_000, 1_250_000, 150_000, 1_500_000, 175_000,
    1_750_000, 200_000, 2_000_000,
  ];
  const subject = reference.map((value) => value * 1.09);
  const pairedMargins = reference.map(
    (value, index) =>
      Math.round(
        (Math.log(value) - Math.log(subject[index]) + Math.log1p(0.1)) * 1e12,
      ) / 1e12,
  );
  assert.deepEqual(pairedMargins, new Array(10).fill(0.009132483563));
  assert.deepEqual(
    replayG17DarwinBootstrapDelta(
      new Array(reference.length).fill(0),
      pairedMargins,
      {
        samples: 5_000,
        seed: 170_017,
        minDelta: 0,
      },
    ),
    {
      meanDelta: 0.009132,
      lower95: 0.009132,
      upper95: 0.009132,
      promote: true,
      samples: 5_000,
      pValue: 0,
    },
  );
  assert.deepEqual(
    unpairedBootstrapDelta(
      subject.map((value) => Math.log(value)),
      reference.map((value) => Math.log(value) + Math.log1p(0.1)),
      { samples: 5_000, seed: 170_017, minDelta: 0 },
    ),
    {
      meanDelta: -0.017715,
      lower95: -2.763456,
      upper95: 2.781721,
      promote: false,
      samples: 5_000,
      pValue: 0.456,
    },
  );
});

test("MAD equality passes and one unit over is noisy", () => {
  const target = G17_CONTROL_STATISTICS_CONTRACT.suite.caseIds[0];
  const sampleSet = (deviation) =>
    g17ControlSampleSet({
      controlName: "aaNoiseControl",
      elapsedNs: ({ task, phase, block, pair, arm }) => {
        if (task.id !== target || phase !== "measured" || arm === "reference")
          return 10_000;
        return block * 2 + pair < 5 ? 10_000 - deviation : 10_000 + deviation;
      },
    });
  const atBoundary = passingG17ControlSampleSets();
  atBoundary.aaNoiseControl = sampleSet(500);
  assert.equal(
    summarizeG17ControlSampleSets(atBoundary).aaNoiseControl.cases[0].noise
      .status,
    "PASS",
  );
  const over = passingG17ControlSampleSets();
  over.aaNoiseControl = sampleSet(501);
  assert.equal(
    summarizeG17ControlSampleSets(over).status,
    "CONTROL_SEALED_INCONCLUSIVE",
  );
});

test("verdict precedence is mechanical across failure and noise combinations", () => {
  const noisyNegativeWithoutBreach = passingG17ControlSampleSets();
  noisyNegativeWithoutBreach.negativeControl = g17ControlSampleSet({
    controlName: "negativeControl",
    elapsedNs: ({ phase, block, pair, arm }) => {
      if (phase !== "measured" || arm === "reference") return 100_000;
      return block * 2 + pair < 5 ? 94_000 : 106_000;
    },
  });
  assert.equal(
    summarizeG17ControlSampleSets(noisyNegativeWithoutBreach).status,
    "CONTROL_SEALED_INCONCLUSIVE",
  );

  const breachWithUnrelatedNoise = passingG17ControlSampleSets();
  breachWithUnrelatedNoise.negativeControl = g17ControlSampleSet({
    controlName: "negativeControl",
    elapsedNs: ({ task, phase, block, pair, arm }) => {
      if (task.id !== "on-store-memory")
        return arm === "subject" ? 120_000 : 100_000;
      if (phase !== "measured" || arm === "reference") return 100_000;
      return block * 2 + pair < 5 ? 94_000 : 106_000;
    },
  });
  assert.equal(
    summarizeG17ControlSampleSets(breachWithUnrelatedNoise).negativeControl
      .status,
    "CONTROL_SEALED_PASS",
  );

  const missedNegative = passingG17ControlSampleSets();
  missedNegative.negativeControl = g17ControlSampleSet({
    controlName: "negativeControl",
    elapsedNs: ({ arm }) => (arm === "subject" ? 100_000 : 100_000),
  });
  assert.equal(
    summarizeG17ControlSampleSets(missedNegative).status,
    "CONTROL_SEALED_FAIL",
  );

  const aaFailWithNoise = passingG17ControlSampleSets();
  aaFailWithNoise.aaNoiseControl = g17ControlSampleSet({
    controlName: "aaNoiseControl",
    elapsedNs: ({ task, phase, block, pair, arm }) => {
      if (task.id === "on-store-memory")
        return arm === "subject" ? 106_000 : 100_000;
      if (
        task.id === "on-dataset-memory" &&
        phase === "measured" &&
        arm === "subject"
      ) {
        return block * 2 + pair < 5 ? 94_000 : 106_000;
      }
      return 100_000;
    },
  });
  assert.equal(
    summarizeG17ControlSampleSets(aaFailWithNoise).status,
    "CONTROL_SEALED_FAIL",
  );
});

test("sample replay rejects missing, duplicate, reordered, and cross-paired rows", () => {
  for (const mutate of [
    (sampleSet) => sampleSet.rows.pop(),
    (sampleSet) => {
      sampleSet.rows[1] = structuredClone(sampleSet.rows[0]);
    },
    (sampleSet) => sampleSet.rows.reverse(),
    (sampleSet) => {
      sampleSet.rows[0].pair += 1;
    },
    (sampleSet) => {
      sampleSet.rows[8].bytes += 1;
    },
  ]) {
    const sets = passingG17ControlSampleSets();
    mutate(sets.negativeControl);
    assert.throws(
      () => summarizeG17ControlSampleSets(sets),
      /G1\.7 control statistics/u,
    );
  }
});

test("sample replay rejects non-positive, unsafe elapsed values and unsafe counts", () => {
  for (const [field, values] of [
    ["elapsedNs", [0, -1, Number.MAX_SAFE_INTEGER + 1]],
    ["operations", [0, Number.MAX_SAFE_INTEGER + 1]],
    ["bytes", [0, Number.MAX_SAFE_INTEGER + 1]],
    ["readerObservations", [-1, Number.MAX_SAFE_INTEGER + 1]],
  ]) {
    for (const value of values) {
      const sets = passingG17ControlSampleSets();
      sets.negativeControl.rows[0][field] = value;
      assert.throws(
        () => summarizeG17ControlSampleSets(sets),
        /G1\.7 control statistics/u,
        `${field}=${value}`,
      );
    }
  }
});

test("sample replay rejects accessors, prototypes, symbols, cycles, sparse arrays, Buffer aliases, and unknown fields", () => {
  const mutations = [
    (sets) => {
      let reads = 0;
      Object.defineProperty(sets.negativeControl.rows[0], "elapsedNs", {
        enumerable: true,
        get() {
          reads += 1;
          return 120_000;
        },
      });
      return () => assert.equal(reads, 0);
    },
    (sets) =>
      Object.setPrototypeOf(sets.negativeControl.rows[0], { polluted: true }),
    (sets) => {
      sets.negativeControl.rows[0][Symbol("authority")] = true;
    },
    (sets) => {
      sets.negativeControl.rows[0].cycle = sets.negativeControl.rows[0];
    },
    (sets) => {
      delete sets.negativeControl.rows[3];
    },
    (sets) => {
      sets.negativeControl.rows[0].rawSampleSha256 = Buffer.from(
        "a".repeat(64),
      );
    },
    (sets) => {
      sets.negativeControl.rows[0].execute = true;
    },
    (sets) => {
      sets.negativeControl.authorization.rawSha256 = Buffer.from(
        "e".repeat(64),
      );
    },
  ];
  for (const mutate of mutations) {
    const sets = passingG17ControlSampleSets();
    const after = mutate(sets);
    assert.throws(
      () => summarizeG17ControlSampleSets(sets),
      /G1\.7 control statistics/u,
    );
    if (typeof after === "function") after();
  }
});

test("sample sets must share one run and authorization binding", () => {
  for (const mutate of [
    (sets) => {
      sets.aaNoiseControl.runId = "another-run";
    },
    (sets) => {
      sets.aaNoiseControl.authorization.contentHash = "0".repeat(64);
    },
  ]) {
    const sets = passingG17ControlSampleSets();
    mutate(sets);
    assert.throws(
      () => summarizeG17ControlSampleSets(sets),
      /do not share one run and authorization binding/u,
    );
  }
});

test("pure replay import graph excludes I/O, process, Router, and the live Darwin loader", async () => {
  for (const path of [
    "../src/qualification/control-statistics-contract.mjs",
    "../src/qualification/control-statistics-replay.mjs",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const imports = [
      ...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gmu),
    ].map(([, specifier]) => specifier);
    assert.equal(
      imports.some(
        (specifier) =>
          specifier.startsWith("node:fs") ||
          specifier === "node:child_process" ||
          specifier.includes("routing/") ||
          specifier.includes("benchmark-contract") ||
          specifier.startsWith("@metaharness/darwin"),
      ),
      false,
    );
    assert.doesNotMatch(source, /\bprocess\./u);
  }
});
