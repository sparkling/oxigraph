import assert from "node:assert/strict";
import test from "node:test";
import { doctorReport } from "../src/doctor.mjs";

test("doctor is explicit about the scaffold-only authority boundary", () => {
  const report = doctorReport();
  assert.equal(report.status, "scaffold-valid");
  assert.equal(report.localOnly, true);
  assert.equal(report.promotionAuthority, false);
  assert.equal(report.mcpRegistered, false);
  assert.equal(report.nativeWorkersImplemented, false);
  assert.equal(report.programmeRunnerImplemented, false);
  assert.equal(report.dependencies.length, 5);
});
