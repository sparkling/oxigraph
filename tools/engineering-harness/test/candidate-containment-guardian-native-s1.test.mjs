import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_ADAPTER_SCHEMA_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_V1,
  createCandidateContainmentGuardianNativeReceiptV1,
  replayCandidateContainmentGuardianNativeLifecycleV1,
  verifyCandidateContainmentGuardianNativeReceiptV1,
} from "../src/candidate/containment-guardian-native-adapter-v1.mjs";
import * as guardianAttestation from "../src/candidate/containment-guardian-attestation-v1.mjs";
import * as managerAttestation from "../src/candidate/containment-guardian-manager-attestation-v1.mjs";
import * as trampolineAttestation from "../src/candidate/containment-guardian-trampoline-attestation-v1.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";
import {
  syntheticCandidateContainmentGuardianNativeLaunchV1,
  unresolvedCandidateContainmentGuardianNativeLaunchV1,
} from "./support/candidate-containment-guardian-native-s1-fixture.mjs";

const ZERO_SHA256 = "0".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function managerReceipt(launch = syntheticCandidateContainmentGuardianNativeLaunchV1("manager")) {
  return createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 0,
    predecessorSha256: ZERO_SHA256,
    launch,
  });
}

function guardianReceipt(predecessor, launch = syntheticCandidateContainmentGuardianNativeLaunchV1("guardian")) {
  return createCandidateContainmentGuardianNativeReceiptV1({
    sequence: 1,
    predecessorSha256: sha256(predecessor.bytes),
    launch,
  });
}

test("ADR-0038 S1 freezes the authority-null adapter receipt boundary and exact predecessor bindings", () => {
  assert.equal(
    CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_ADAPTER_SCHEMA_V1,
    "oxigraph.candidate-containment-guardian-native-adapter/v1",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1,
    "be25697d389f5b6023faebaf851095ed18d0d61501a755590f8c432bac809bba",
  );
  assert.equal(Object.isFrozen(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_V1), true);
  assert.deepEqual({...CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.manager}, {
    sourceBytes: 2_840,
    sourceSha256: "4dba252351003b14202f20490b17b55ac5abf011ab60bdd87024a3d207585137",
    requirementsSha256: "ec91cb4740266fdf4dac278af25cc3713d8f6b657ffc32e826933b4c8637f31f",
    elfBytes: 30_880,
    elfSha256: "b297d888bce75128fc3f18c2454c753a159df97ab7fba8ce790af27540003e99",
  });
  assert.deepEqual({...CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.guardian}, {
    sourceBytes: 18_627,
    sourceSha256: "93e87316a10d289ac537350bd2af314370f0324e3d5b130cfe9ba4f1760f8039",
    requirementsSha256: "94c6b1bbf7330fae09b73da5948aab02577aae42b7e5506577c11b270a556071",
    elfBytes: 10_872,
    elfSha256: "b42663bd425f22e34998dd9d674849fd35673d7f3ad9e33d03d3cf09c12c4867",
  });
  assert.equal(
    CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.trampoline.elfSha256,
    "2a19da84b079337d19b13b86d3dd6395e7517f038735c657b2956308dea87abc",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.statefs.objectSha256,
    "73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043",
  );
});

test("adapter bindings equal the unchanged S0 attestations and exact ADR-0037 StateFS identities", async () => {
  for (const [role, attestation] of [
    ["manager", managerAttestation],
    ["guardian", guardianAttestation],
    ["trampoline", trampolineAttestation],
  ]) {
    const binding = CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1[role];
    const source = await readFile(
      new URL(`../src/candidate/${attestation.SOURCE_LOGICAL_NAME_V1}`, import.meta.url),
    );
    assert.equal(source.length, binding.sourceBytes);
    assert.equal(sha256(source), binding.sourceSha256);
    assert.equal(attestation.SOURCE_SHA256_V1, binding.sourceSha256);
    assert.equal(attestation.REQUIREMENTS_SHA256_V1, binding.requirementsSha256);
    assert.equal(attestation.ELF_BYTES_V1, binding.elfBytes);
    assert.equal(attestation.ELF_SHA256_V1, binding.elfSha256);
  }
  const statefs = CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.statefs;
  assert.equal(managerAttestation.STATEFS_HEADER_SHA256_V1, statefs.headerSha256);
  assert.equal(managerAttestation.STATEFS_SOURCE_SHA256_V1, statefs.sourceSha256);
  assert.equal(managerAttestation.STATEFS_OBJECT_SHA256_V1, statefs.objectSha256);
  assert.equal(
    managerAttestation.STATEFS_BUILD_REQUIREMENTS_SHA256_V1,
    statefs.buildRequirementsSha256,
  );
});

test("manager then guardian receipts form the exact durable pre-release model without performing release", () => {
  const manager = managerReceipt();
  const guardian = guardianReceipt(manager);
  const replay = replayCandidateContainmentGuardianNativeLifecycleV1({
    managerReceiptBytes: manager.bytes,
    guardianReceiptBytes: guardian.bytes,
  });
  assert.equal(manager.artifact.bytes, 4_074);
  assert.equal(manager.artifact.sha256, "3d0e831aca589feb96d4b807ff12fa8562ab9d630f55dd3e5ed8d1780435f9ff");
  assert.equal(guardian.artifact.bytes, 4_050);
  assert.equal(guardian.artifact.sha256, "90d960dba1c57ef3676e199aa0385dfb91a3df5acb8ad01a7440149cfe5a2fa5");
  assert.equal(replay.managerOwner, "trusted-service-manager");
  assert.equal(replay.guardianOwner, "manager");
  assert.equal(replay.managerParentage, "direct-parent");
  assert.equal(replay.guardianParentage, "direct-parent");
  assert.equal(replay.preReleaseModelComplete, true);
  assert.equal(replay.releasePerformed, false);
  assert.equal(replay.binding, null);
  const verified = verifyCandidateContainmentGuardianNativeReceiptV1(guardian.bytes);
  assert.equal(verified.preReleaseModelSatisfied, true);
  assert.equal(verified.releasePerformed, false);
  assert.equal(verified.physicalFacts.powerLossDurability, null);
});

test("receipts are canonical copy-on-read values and reject an unchained guardian", () => {
  const manager = managerReceipt();
  const guardian = guardianReceipt(manager);
  const first = guardian.bytes;
  first[0] ^= 0xff;
  assert.notDeepEqual(first, guardian.bytes);
  assert.equal(guardian.bytes.at(-1), 0x0a);
  assert.equal(sha256(guardian.bytes), guardian.artifact.sha256);
  const unrelatedLaunch = syntheticCandidateContainmentGuardianNativeLaunchV1("manager");
  unrelatedLaunch.heldExecutable.inode = "38003";
  unrelatedLaunch.execution.liveImage.inode = "38003";
  const unrelated = managerReceipt(unrelatedLaunch);
  assert.throws(
    () => replayCandidateContainmentGuardianNativeLifecycleV1({
      managerReceiptBytes: unrelated.bytes,
      guardianReceiptBytes: guardian.bytes,
    }),
    /manager-to-guardian receipt chain changed/u,
  );
});

test("parentage-lost and parentage-ambiguous remain valid unresolved semantics and never prove reap", () => {
  for (const parentage of ["parentage-lost", "parentage-ambiguous"]) {
    const managerLaunch = unresolvedCandidateContainmentGuardianNativeLaunchV1(
      syntheticCandidateContainmentGuardianNativeLaunchV1("manager"),
      parentage,
    );
    const manager = managerReceipt(managerLaunch);
    const guardianLaunch = unresolvedCandidateContainmentGuardianNativeLaunchV1(
      syntheticCandidateContainmentGuardianNativeLaunchV1("guardian"),
      parentage,
    );
    const guardian = guardianReceipt(manager, guardianLaunch);
    const managerReport = verifyCandidateContainmentGuardianNativeReceiptV1(manager.bytes);
    const guardianReport = verifyCandidateContainmentGuardianNativeReceiptV1(guardian.bytes);
    assert.equal(managerReport.parentage, parentage);
    assert.equal(guardianReport.parentage, parentage);
    assert.equal(managerReport.preReleaseModelSatisfied, false);
    assert.equal(guardianReport.preReleaseModelSatisfied, false);
    const replay = replayCandidateContainmentGuardianNativeLifecycleV1({
      managerReceiptBytes: manager.bytes,
      guardianReceiptBytes: guardian.bytes,
    });
    assert.equal(replay.preReleaseModelComplete, false);
    assert.equal(replay.physicalFacts.waitidReap, null);
  }
});

test("every report preserves false authority, null physical facts, binding-null, and unavailable readiness", () => {
  const manager = managerReceipt();
  const report = verifyCandidateContainmentGuardianNativeReceiptV1(manager.bytes);
  assert.ok(Object.values(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1).every((value) => value === false));
  assert.ok(Object.values(report.authority).every((value) => value === false));
  assert.ok(Object.values(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1).every((value) => value === null));
  assert.ok(Object.values(report.physicalFacts).every((value) => value === null));
  assert.equal(report.binding, null);
  assert.deepEqual({...report.readiness}, {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.deepEqual(report.readiness, CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1);
  for (const claim of [
    "source-or-compiler-causality",
    "synthetic-clone3-proves-kernel-placement",
    "safe-local-pidfd-open-proves-clone-pidfd",
    "durable-model-proves-filesystem-or-power-loss-durability",
    "parentage-lost-or-ambiguous-proves-reap",
    "production-readiness",
  ]) assert.ok(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1.includes(claim));
});

test("S1 is pure, unregistered, binding-null, and leaves product readiness unavailable", async () => {
  const source = await readFile(
    new URL("../src/candidate/containment-guardian-native-adapter-v1.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /node:(?:child_process|fs|net|worker_threads)|\b(?:open|spawn|fork|clone3|execveat|ptrace|waitid|poll)\s*\(/u,
  );
  const registered = [...commandIds(), ...engineeringTaskIds].join("\n");
  assert.doesNotMatch(registered, /containment-guardian-native-adapter/u);
  assert.deepEqual(candidateContainmentOwnerV2Readiness(), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
});
