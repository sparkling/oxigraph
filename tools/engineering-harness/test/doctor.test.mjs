import assert from "node:assert/strict";
import test from "node:test";
import { doctorReport } from "../src/doctor.mjs";

test("doctor is explicit about the native-host and authority boundary", async () => {
  const report = await doctorReport();
  assert.ok(["runner-implemented", "inconclusive"].includes(report.status));
  assert.equal(report.localOnly, true);
  assert.equal(report.promotionAuthority, false);
  assert.equal(report.mcpRegistered, false);
  assert.equal(report.nativeWorkerBoundaryImplemented, true);
  assert.equal(report.nativeWorkersImplemented, true);
  assert.equal(report.programmeRunnerImplemented, true);
  assert.equal(report.applicationReceiptReplayImplemented, true);
  assert.equal(report.atomicRouterHistoryAdmissionImplemented, true);
  assert.equal(report.realDualProviderProofRecorded, false);
  assert.equal(report.dependencies.length, 5);
  assert.deepEqual(
    report.nativeHosts.map(({ host }) => host),
    ["codex", "claude"],
  );
});
