import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function g17BenchmarkSamples({
  contract,
  elapsedNs = ({ implementation }) =>
    implementation === "subject" ? 90_000 : 100_000,
} = {}) {
  const rows = [];
  const { protocol, suite } = contract.benchmark;
  for (const [caseIndex, task] of suite.tasks.entries()) {
    for (const [phase, blocks] of [
      ["warmup", protocol.warmupBlocks],
      ["measured", protocol.measuredBlocks],
    ]) {
      for (let block = 0; block < blocks; block += 1) {
        const globalBlock =
          (phase === "measured" ? protocol.warmupBlocks : 0) + block;
        const schedule =
          protocol.schedules[globalBlock % protocol.schedules.length];
        for (const [slot, implementation] of schedule.entries()) {
          const pair = Math.floor(slot / 2);
          const seed =
            protocol.seed + caseIndex * 100_000 + globalBlock * 2 + pair;
          const elapsed = elapsedNs({
            task,
            caseIndex,
            phase,
            block,
            globalBlock,
            pair,
            slot,
            implementation,
          });
          rows.push({
            schema: protocol.qualificationSampleSchema,
            caseId: task.id,
            phase,
            block,
            pair,
            slot,
            repetition: globalBlock * schedule.length + slot,
            seed,
            implementation,
            elapsedNs: elapsed,
            operations: task.operations * task.writers,
            bytes: 1_280,
            readerObservations: task.concurrentReaders ? 1 : 0,
            executableSha256:
              implementation === "subject" ? "a".repeat(64) : "b".repeat(64),
            rawSampleSha256: sha256(
              `${task.id}:${phase}:${block}:${pair}:${slot}:${seed}:${implementation}:${elapsed}`,
            ),
          });
        }
      }
    }
  }
  return rows;
}
