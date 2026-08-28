import { createHash } from "node:crypto";

import {
  G17_BENCHMARK_CASES,
  G17_CONTROL_SAMPLE_SCHEMA,
  G17_CONTROL_SAMPLE_SET_SCHEMA,
  G17_CONTROL_STATISTICS_CONTRACT,
} from "../../src/qualification/control-statistics-contract.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function g17ControlSampleSet({
  controlName,
  runId = "g17-control-fixture",
  authorization = {
    rawSha256: "e".repeat(64),
    contentHash: "f".repeat(64),
  },
  elapsedNs = ({ arm }) => (arm === "subject" ? 120_000 : 100_000),
} = {}) {
  const contract = G17_CONTROL_STATISTICS_CONTRACT;
  const control = contract.controls[controlName];
  if (control === undefined)
    throw new Error(`unsupported fixture control: ${controlName}`);
  const rows = [];
  for (const [caseIndex, task] of G17_BENCHMARK_CASES.entries()) {
    for (const [phase, blocks] of [
      ["warmup", contract.sampleSet.warmupBlocks],
      ["measured", contract.sampleSet.measuredBlocks],
    ]) {
      for (let block = 0; block < blocks; block += 1) {
        const globalBlock =
          phase === "measured"
            ? contract.sampleSet.warmupBlocks + block
            : block;
        const schedule =
          contract.sampleSet.schedules[
            globalBlock % contract.sampleSet.schedules.length
          ];
        for (const [slot, arm] of schedule.entries()) {
          const pair = Math.floor(slot / 2);
          const seed =
            contract.sampleSet.executionSeed.base +
            caseIndex * 100_000 +
            globalBlock * 2 +
            pair;
          const elapsed = elapsedNs({
            controlName,
            task,
            caseIndex,
            phase,
            block,
            globalBlock,
            pair,
            slot,
            arm,
          });
          const build = control[arm];
          rows.push({
            schema: G17_CONTROL_SAMPLE_SCHEMA,
            controlId: control.id,
            caseId: task.id,
            phase,
            block,
            pair,
            slot,
            repetition: globalBlock * schedule.length + slot,
            seed,
            arm,
            productRole: build.productRole,
            buildId: build.buildId,
            elapsedNs: elapsed,
            operations: task.operations * task.writers,
            bytes: 1_280,
            readerObservations: task.concurrentReaders ? 1 : 0,
            executableSha256:
              build.buildId === "negative-control"
                ? "a".repeat(64)
                : build.buildId === "performance-reference"
                  ? "b".repeat(64)
                  : build.buildId === "noise-control-a"
                    ? "c".repeat(64)
                    : "d".repeat(64),
            rawSampleSha256: sha256(
              `${control.id}:${task.id}:${phase}:${block}:${pair}:${slot}:${seed}:${arm}:${elapsed}`,
            ),
          });
        }
      }
    }
  }
  return {
    schema: G17_CONTROL_SAMPLE_SET_SCHEMA,
    runId,
    suiteHash: contract.suite.taskHash,
    controlId: control.id,
    authorization,
    rows,
  };
}

export function passingG17ControlSampleSets() {
  return {
    negativeControl: g17ControlSampleSet({
      controlName: "negativeControl",
      elapsedNs: ({ arm }) => (arm === "subject" ? 120_000 : 100_000),
    }),
    aaNoiseControl: g17ControlSampleSet({
      controlName: "aaNoiseControl",
      elapsedNs: () => 100_000,
    }),
  };
}
