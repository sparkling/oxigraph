import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createCandidateContainmentGuardianNativeReceiptV1,
  replayCandidateContainmentGuardianNativeLifecycleV1,
  verifyCandidateContainmentGuardianNativeReceiptV1,
} from "../src/candidate/containment-guardian-native-adapter-v1.mjs";
import {
  observeCandidateContainmentGuardianNativeLaunchV1,
} from "./support/candidate-containment-guardian-native-s1-fixture.mjs";

const ZERO_SHA256 = "0".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("safe-local trusted-owner fixture enters the exact held S0 manager and ignores a replaced pathname", async () => {
  const evidence = await observeCandidateContainmentGuardianNativeLaunchV1(
    "manager",
    {pathnameSubstitution: true},
  );
  assert.equal(evidence.report.PATH_SUBSTITUTED, "1");
  assert.equal(evidence.report.TRACE_COUNT, "1");
  assert.equal(evidence.report.TRACE_SYSCALL, "322");
  assert.equal(evidence.report.POSITIVE_EXEC_STOP, "1");
  assert.equal(evidence.report.OUTCOME_EOF, "1");
  assert.equal(evidence.report.HELD_DEVICE, evidence.report.LIVE_DEVICE);
  assert.equal(evidence.report.HELD_INODE, evidence.report.LIVE_INODE);
  assert.equal(evidence.report.HELD_BYTES, evidence.report.LIVE_BYTES);
  assert.equal(evidence.report.INDEPENDENT_BYTES_EQUAL, "1");
  assert.equal(evidence.report.WAITID_IDTYPE, "P_PIDFD");
  assert.equal(evidence.report.WAITID_STATUS, "125");
  assert.equal(evidence.report.SECOND_WAIT_ECHILD, "1");
  assert.equal(evidence.stderr, "");
  const receipt = createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 0,
    predecessorSha256: ZERO_SHA256,
    launch: evidence.observation,
  });
  const report = verifyCandidateContainmentGuardianNativeReceiptV1(receipt.bytes);
  assert.equal(report.ownerRole, "trusted-service-manager");
  assert.equal(report.preReleaseModelSatisfied, true);
  assert.equal(report.releasePerformed, false);
});

test("safe-local synthetic manager role owns the exact held S0 guardian through exclusive pidfd wait", async () => {
  const managerEvidence = await observeCandidateContainmentGuardianNativeLaunchV1("manager");
  const guardianEvidence = await observeCandidateContainmentGuardianNativeLaunchV1("guardian");
  const manager = createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 0,
    predecessorSha256: ZERO_SHA256,
    launch: managerEvidence.observation,
  });
  const guardian = createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 1,
    predecessorSha256: sha256(manager.bytes),
    launch: guardianEvidence.observation,
  });
  const replay = replayCandidateContainmentGuardianNativeLifecycleV1({
    managerReceiptBytes: manager.bytes,
    guardianReceiptBytes: guardian.bytes,
  });
  assert.equal(guardianEvidence.report.PIDFD_READABLE, "1");
  assert.equal(guardianEvidence.report.PIDFD_HUP, "0");
  assert.equal(guardianEvidence.report.SECOND_WAIT_ECHILD, "1");
  assert.equal(replay.guardianOwner, "manager");
  assert.equal(replay.preReleaseModelComplete, true);
  assert.equal(replay.physicalFacts.pidfdReadability, null);
  assert.equal(replay.physicalFacts.pidfdHup, null);
  assert.equal(replay.physicalFacts.waitidReap, null);
  assert.equal(replay.releasePerformed, false);
});

test("local pidfd HUP absence stays explicit while the exact HUP requirement is synthetic-only", async () => {
  const evidence = await observeCandidateContainmentGuardianNativeLaunchV1("manager");
  assert.equal(evidence.report.PIDFD_READABLE, "1");
  assert.equal(evidence.report.PIDFD_HUP, "0");
  assert.equal(evidence.observation.supervision.pidfdHup, null);
  assert.equal(evidence.observation.supervision.syntheticPidfdHup, true);
  assert.equal(evidence.observation.placement.evidenceClass, "synthetic-replay");
  assert.equal(evidence.observation.supervision.evidenceClass, "safe-local-pidfd-open-not-clone3");
});
