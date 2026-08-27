import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../src/routing/features.mjs";
import {
  G17_DARWIN_RUNTIME_MODULES,
  loadG17DarwinFunctions,
} from "../src/qualification/benchmark-contract.mjs";
import {
  summarizeG17Samples,
  verifyG17BenchmarkSuite,
} from "../src/qualification/benchmark.mjs";
import { loadG17Contract } from "../src/qualification/contract.mjs";
import { loadG17DecisionSet } from "../src/qualification/decision-contract.mjs";
import { g17BenchmarkSamples } from "./support/g17-benchmark-fixture.mjs";

const { unpairedBootstrapDelta } = await loadG17DarwinFunctions();

function fixture() {
  const loaded = loadG17Contract();
  return {
    contract: loaded.contract,
    decisions: loadG17DecisionSet({ contract: loaded.contract }),
  };
}

test("G1.7 v4 verifies 196 rows, 140 measured rows, and ten pairs per case", () => {
  const { contract, decisions } = fixture();
  assert.deepEqual(verifyG17BenchmarkSuite(contract), {
    ok: true,
    expected: contract.benchmark.suite.taskHash,
    actual: contract.benchmark.suite.taskHash,
  });
  const rows = g17BenchmarkSamples({ contract });
  const summary = summarizeG17Samples(rows, contract, decisions);
  assert.equal(summary.owner, "@metaharness/darwin");
  assert.equal(summary.statisticsApi, "security.bootstrapDelta");
  assert.equal(summary.sampleCount, 196);
  assert.equal(summary.measuredSampleCount, 140);
  assert.equal(summary.status, "INCONCLUSIVE");
  assert.equal(summary.statisticalStatus, "PASS");
  assert.equal(summary.authority, "DIAGNOSTIC_ONLY");
  assert.equal(summary.decisionSetSha256, decisions.decisionSetSha256);
  assert.deepEqual(summary.darwin, {
    package: "@metaharness/darwin",
    version: "0.9.3",
    packageIntegrity:
      "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
    statisticsModuleSha256:
      "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
    moduleSha256: G17_DARWIN_RUNTIME_MODULES,
    resolvedEntry: "dist/index.js",
  });
  assert.deepEqual(summary.budgetBreaches, []);
  assert.deepEqual(summary.diagnosticBudgetBreaches, []);
  assert.deepEqual(summary.noisyCases, []);
  assert.equal(summary.cases.length, 7);
  assert.equal(
    summary.cases.every(
      ({ subject, reference, noise, nonInferiority }) =>
        subject.count === 10 &&
        reference.count === 10 &&
        noise.status === "PASS" &&
        nonInferiority.status === "PASS" &&
        nonInferiority.pairedSamples === 10 &&
        nonInferiority.bootstrap.promote === true &&
        nonInferiority.bootstrap.lower95 > 0,
    ),
    true,
  );
});

test("paired log non-inferiority passes 1.09 and fails 1.10 and 1.11", () => {
  const { contract, decisions } = fixture();
  for (const [basisPoints, expectedStatus] of [
    [1_090, "PASS"],
    [1_100, "FAIL"],
    [1_110, "FAIL"],
  ]) {
    const rows = g17BenchmarkSamples({
      contract,
      elapsedNs: ({ implementation }) =>
        implementation === "subject" ? basisPoints * 10 : 10_000,
    });
    const summary = summarizeG17Samples(rows, contract, decisions);
    assert.equal(summary.status, "INCONCLUSIVE");
    assert.equal(
      summary.statisticalStatus,
      expectedStatus,
      `${basisPoints / 1_000} boundary`,
    );
    assert.equal(
      summary.cases.every(
        ({ nonInferiority }) => nonInferiority.status === expectedStatus,
      ),
      true,
    );
    if (basisPoints === 1_100) {
      assert.equal(summary.cases[0].nonInferiority.bootstrap.lower95, 0);
      assert.equal(summary.cases[0].nonInferiority.bootstrap.promote, false);
    }
  }
});

test("v4 validates sample key sets independently of JSON insertion order", () => {
  const { contract, decisions } = fixture();
  const canonicalRows = g17BenchmarkSamples({ contract }).map((row) =>
    JSON.parse(canonicalJson(row)),
  );
  assert.equal(
    summarizeG17Samples(canonicalRows, contract, decisions).statisticalStatus,
    "PASS",
  );
});

test("exact 5% MAD passes and one unit over becomes noisy without a breach", () => {
  const { contract, decisions } = fixture();
  const target = contract.benchmark.suite.tasks[0].id;
  const elapsed =
    (deviation) =>
    ({ task, phase, block, pair, implementation }) => {
      if (phase !== "measured" || task.id !== target) {
        return implementation === "subject" ? 9_000 : 11_000;
      }
      if (implementation === "reference") return 11_000;
      return block * 2 + pair < 5 ? 10_000 - deviation : 10_000 + deviation;
    };
  const atBoundary = summarizeG17Samples(
    g17BenchmarkSamples({ contract, elapsedNs: elapsed(500) }),
    contract,
    decisions,
  );
  assert.equal(atBoundary.cases[0].subject.medianElapsedNs, 10_000);
  assert.equal(atBoundary.cases[0].subject.medianAbsoluteDeviationNs, 500);
  assert.equal(atBoundary.cases[0].noise.status, "PASS");
  assert.equal(atBoundary.status, "INCONCLUSIVE");
  assert.equal(atBoundary.statisticalStatus, "PASS");

  const over = summarizeG17Samples(
    g17BenchmarkSamples({ contract, elapsedNs: elapsed(501) }),
    contract,
    decisions,
  );
  assert.equal(over.cases[0].subject.medianAbsoluteDeviationNs, 501);
  assert.equal(over.cases[0].noise.status, "NOISY");
  assert.equal(over.cases[0].nonInferiority.status, "INCONCLUSIVE");
  assert.equal(over.status, "INCONCLUSIVE");
  assert.equal(over.statisticalStatus, "NOISY");
  assert.deepEqual(over.budgetBreaches, []);
  assert.deepEqual(over.diagnosticBudgetBreaches, []);
  assert.deepEqual(over.noisyCases, [target]);
});

test("a quiet NI breach takes precedence over noise in another case", () => {
  const { contract, decisions } = fixture();
  const [noisyCase, failingCase] = contract.benchmark.suite.tasks.map(
    ({ id }) => id,
  );
  const rows = g17BenchmarkSamples({
    contract,
    elapsedNs: ({ task, phase, block, pair, implementation }) => {
      if (phase === "measured" && task.id === noisyCase) {
        if (implementation === "reference") return 11_000;
        return block * 2 + pair < 5 ? 9_499 : 10_501;
      }
      if (task.id === failingCase) {
        return implementation === "subject" ? 11_100 : 10_000;
      }
      return implementation === "subject" ? 9_000 : 10_000;
    },
  });
  const summary = summarizeG17Samples(rows, contract, decisions);
  assert.equal(summary.status, "INCONCLUSIVE");
  assert.equal(summary.statisticalStatus, "FAIL");
  assert.deepEqual(summary.noisyCases, [noisyCase]);
  assert.deepEqual(summary.budgetBreaches, []);
  assert.deepEqual(summary.diagnosticBudgetBreaches, [failingCase]);
  assert.equal(summary.cases[0].nonInferiority.status, "INCONCLUSIVE");
  assert.equal(summary.cases[1].nonInferiority.status, "FAIL");
});

test("paired security bootstrap is not substituted with unpaired bench bootstrap", () => {
  const { contract, decisions } = fixture();
  const variedCase = contract.benchmark.suite.tasks[0].id;
  const rows = g17BenchmarkSamples({
    contract,
    elapsedNs: ({ task, phase, block, pair, implementation }) => {
      if (phase !== "measured" || task.id !== variedCase) {
        return implementation === "subject" ? 9_000 : 10_000;
      }
      const reference = block * 2 + pair < 5 ? 100_000 : 1_000_000;
      return implementation === "subject"
        ? Math.floor(reference * 1.09)
        : reference;
    },
  });
  const summary = summarizeG17Samples(rows, contract, decisions);
  const diagnostic = summary.cases[0].nonInferiority;
  assert.equal(diagnostic.bootstrap.promote, true);
  const measured = rows.filter(
    ({ caseId, phase }) => caseId === variedCase && phase === "measured",
  );
  const referenceScores = measured
    .filter(({ implementation }) => implementation === "reference")
    .map(({ elapsedNs }) => -elapsedNs);
  const subjectScores = measured
    .filter(({ implementation }) => implementation === "subject")
    .map(({ elapsedNs }) => -elapsedNs);
  assert.equal(
    unpairedBootstrapDelta(referenceScores, subjectScores, {
      samples: 5_000,
      seed: 170_017,
      minDelta: 0,
    }).promote,
    false,
  );
});

test("G1.7 rejects suite tampering and missing, duplicate, reordered, or mismatched pairs", () => {
  const { contract, decisions } = fixture();
  const tamperedSuite = structuredClone(contract);
  tamperedSuite.benchmark.suite.tasks[0].operations += 1;
  assert.throws(
    () => verifyG17BenchmarkSuite(tamperedSuite),
    /Darwin benchmark suite/u,
  );

  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => {
      rows[1] = structuredClone(rows[0]);
    },
    (rows) => rows.reverse(),
    (rows) => {
      rows[0].pair += 1;
    },
    (rows) => {
      rows[0].rawSampleSha256 = "not-a-digest";
    },
    (rows) => {
      const measuredSubject = rows.find(
        ({ phase, implementation }) =>
          phase === "measured" && implementation === "subject",
      );
      measuredSubject.bytes += 1;
    },
  ]) {
    const rows = g17BenchmarkSamples({ contract });
    mutate(rows);
    assert.throws(
      () => summarizeG17Samples(rows, contract, decisions),
      /G1\.7 benchmark/u,
    );
  }
});

test("proposed or tampered decisions cannot authorize benchmark results", () => {
  const { contract, decisions } = fixture();
  const rows = g17BenchmarkSamples({ contract });
  const proposed = summarizeG17Samples(rows, contract, decisions);
  assert.equal(proposed.status, "INCONCLUSIVE");
  assert.equal(proposed.authority, "DIAGNOSTIC_ONLY");

  for (const mutate of [
    (candidate) => {
      candidate.performance.cases[0].maximumSlowdownBasisPoints = 999;
    },
    (candidate) => {
      candidate.noise.cases[0].maximumMadBasisPoints = 501;
    },
    (candidate) => {
      candidate.noise.suiteHash = "a".repeat(64);
    },
    (candidate) => {
      candidate.reference.status = "SELECTED";
    },
  ]) {
    const candidate = structuredClone(decisions);
    mutate(candidate);
    assert.throws(
      () => summarizeG17Samples(rows, contract, candidate),
      /G1\.7 benchmark: G1\.7 decision contract/u,
    );
  }
});

test("same seeded samples produce an identical paired diagnostic", () => {
  const { contract, decisions } = fixture();
  const rows = g17BenchmarkSamples({ contract });
  assert.deepEqual(
    summarizeG17Samples(rows, contract, decisions),
    summarizeG17Samples(structuredClone(rows), contract, decisions),
  );
});
