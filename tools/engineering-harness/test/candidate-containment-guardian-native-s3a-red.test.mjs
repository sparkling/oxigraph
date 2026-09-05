import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as managerAttestation from "../src/candidate/containment-guardian-manager-attestation-v1.mjs";
import { assertCandidateContainmentGuardianManagerProtocolTransitionV1 } from "../src/candidate/containment-guardian-manager-protocol-v1.mjs";
import {
  assertCandidateContainmentGuardianStatefsRequestV1,
  verifyCandidateContainmentGuardianStatefsResultV1,
} from "../src/candidate/containment-guardian-statefs-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS,
  CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256,
  assertCandidateManagerTransitionConsumerContractV1,
  loadCandidateManagerTransitionConsumerV1,
} from "./support/candidate-containment-guardian-native-s3a-fixture.mjs";
import { buildAndAttestNativeArtifactV1 } from "./support/candidate-containment-guardian-native-v1-fixture.mjs";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);

const EXACT_PREDECESSOR_INPUTS = Object.freeze([
  [
    "tools/engineering-harness/src/candidate/containment-guardian-manager-protocol-v1.mjs",
    "79c6dec19e6f7e1c68090dae36eab72b6c0f956f07b52ff0fa2d84b4f187b158",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-v1.mjs",
    "5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs",
    "09f016c0686289bb39cb52af52b120a94e3de4c338cf8f1b72e834a3ab56a779",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.h",
    "358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c",
    "f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-manager-v1.c",
    "4dba252351003b14202f20490b17b55ac5abf011ab60bdd87024a3d207585137",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-v1.c",
    "93e87316a10d289ac537350bd2af314370f0324e3d5b130cfe9ba4f1760f8039",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-trampoline-v1.c",
    "2e4e39718673030ee26f9870eab03d0adda33d656d807c01226420b776dc955b",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-native-attestation-common-v1.mjs",
    "7d507525867d158d973adba5b6074ae1ed87d0674625ba570a8ed12a97e136ee",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-manager-attestation-v1.mjs",
    "5961d34b4614e3242cc4b986bd4bbf453e600929e1c5480565c360ccb302e653",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-attestation-v1.mjs",
    "ed11c028cde8d4b56f1c371e7152c47cc0f40c97b0530eedcefe6e33e0e3a960",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-trampoline-attestation-v1.mjs",
    "a49094dc77dad92f8960e2c452dd48169432d8f1403de358a9d18d0db8d06f2d",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-native-adapter-v1.mjs",
    "d8bc60a333608d7b94bce870c13facfe1e75fce878c46aca2b97b8dd78a4225a",
  ],
  [
    "tools/engineering-harness/src/candidate/containment-guardian-recovery-executor-v1.mjs",
    "e1ccb7a436db91fb6589b6126b5279148c04d8bf435fa44d8ed73061c4149f2a",
  ],
  [
    "tools/engineering-harness/test/support/candidate-containment-guardian-native-v1-fixture.mjs",
    "1e36105122bc73dca4749cb45e1da8514f0e2ca55adcbdfda2690630e1975e28",
  ],
  [
    "tools/engineering-harness/test/support/candidate-containment-guardian-native-v1-driver.c",
    "71b03d6804392749ac8e494ce4f76ad803f247bb5558e83a4f0515fef40d54a3",
  ],
  [
    "tools/engineering-harness/test/support/candidate-containment-guardian-trampoline-target-v1.c",
    "48c3da2bf8939e2527d6418ea2893d6ce98530ac8a1f3d2f6f1aab55904666f3",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s0-attestation.test.mjs",
    "66650c466d2c394f705d20d37aeb5d482f47febbe1beee0a459a29e4bd722822",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s0-faults.test.mjs",
    "44a960688d7fff199b29c36ecd7e9864b62c0155c1f2a0a5bd0ecb176f6ea3e8",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s0.test.mjs",
    "4b91152759450e1e85ef1431a4be9c3238d48e935ea4fb61567f68e39b8b8b39",
  ],
  [
    "tools/engineering-harness/test/support/candidate-containment-guardian-native-s1-driver.c",
    "b94ad49bd224e892f7da0581889ffd29fee1c50d129bac5e435ebb2409159cf0",
  ],
  [
    "tools/engineering-harness/test/support/candidate-containment-guardian-native-s1-fixture.mjs",
    "f8a7332e17dcd20a3328b85888477a3a5c7be9bd2a261f19cd441187c9518c12",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s1.test.mjs",
    "0d2cd4f7a5c7b64e51e36e00e8bec6e4432e18b6eb251fdd26d4e40ecae5b4ef",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s1-faults.test.mjs",
    "4bdff1fbf388cedf0558a7ca70c2e06334af2b19a982bcdb4e9775b25846cae6",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-native-s1-native.test.mjs",
    "103207db857dd80b2f191554a10b5f425b08ee60ae33137d6268f19c2d850cdf",
  ],
  [
    "tools/engineering-harness/test/support/candidate-containment-guardian-recovery-executor-s2-fixture.mjs",
    "db0f949bb8ea6654cc8f9dd2f77f5914ca148fb8fdbb5fffea13341806f1b4ae",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-recovery-executor-s2.test.mjs",
    "40a65f7f8490b3375e58d81bce8b5ca5a08321b39e076b4bc3d169a256660f02",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-recovery-executor-s2-faults.test.mjs",
    "97f5ae868b5a423497e9c9f632b477d011af306bf429c51965b87a1c2b1ae2d5",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-manager-protocol-v1.test.mjs",
    "8f5bc805582e7508e31d3d211759f7fcb45f518f674b5ea293ece5cc8664edb6",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-statefs-v1.test.mjs",
    "1a9e3e102139a1462454146d57de57439fa845b360790c5dfaf945fd717f5d1b",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-statefs-v1-faults.test.mjs",
    "4685e0aef689ffea73157aedcf52eb80aa28560a4a4b553ca872a4aa110ec181",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-statefs-syscalls-v1.test.mjs",
    "c2cde3ddee41e99f0103d0f23960f384c845fd7fcfc0f24e80aca12e7729f02c",
  ],
  [
    "tools/engineering-harness/test/candidate-containment-guardian-statefs-syscalls-v1-faults.test.mjs",
    "494dd274ee477549cb1923759f88344215df09bd87cd513258de3c4e9b4df191",
  ],
  [
    "tools/engineering-harness/package.json",
    "6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8",
  ],
  [
    "tools/engineering-harness/package-lock.json",
    "5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d",
  ],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("ADR-0038 S3A pins every accepted S0-S2 and ADR-0037 bridge input", async () => {
  for (const [path, expectedSha256] of EXACT_PREDECESSOR_INPUTS) {
    const bytes = await readFile(new URL(path, REPOSITORY_ROOT));
    assert.equal(sha256(bytes), expectedSha256, path);
  }
});

test("ADR-0038 S3A locally rebuilds and attests the exact link-only manager boundary", async () => {
  const evidence = await buildAndAttestNativeArtifactV1("manager");
  assert.equal(evidence.firstSha256, managerAttestation.ELF_SHA256_V1);
  assert.equal(evidence.secondSha256, managerAttestation.ELF_SHA256_V1);
  assert.deepEqual(evidence.firstBytes, evidence.secondBytes);
  assert.equal(
    evidence.statefsObjectSha256,
    managerAttestation.STATEFS_OBJECT_SHA256_V1,
  );
  assert.equal(evidence.statefsObjectByteLength, 33_048);
  assert.equal(evidence.statefsEntrypointCount, 1);
  assert.equal(evidence.alternateStatefsEntrypointCount, 0);
  assert.equal(
    evidence.report.statefs.headerSha256,
    managerAttestation.STATEFS_HEADER_SHA256_V1,
  );
  assert.equal(
    evidence.report.statefs.sourceSha256,
    managerAttestation.STATEFS_SOURCE_SHA256_V1,
  );
  assert.equal(
    evidence.report.statefs.objectSha256,
    managerAttestation.STATEFS_OBJECT_SHA256_V1,
  );
  assert.equal(
    evidence.report.statefs.buildRequirementsSha256,
    managerAttestation.STATEFS_BUILD_REQUIREMENTS_SHA256_V1,
  );
  assert.equal(evidence.report.authority.processExecution, false);
  assert.equal(evidence.report.authority.runtimeRegistration, false);
  assert.equal(evidence.report.authority.qualification, false);
  assert.equal(evidence.report.physicalFacts.delegatedCgroup, null);
  assert.equal(evidence.report.physicalFacts.productionUnit, null);
  assert.equal(evidence.inspection.staticElf, true);
  assert.equal(evidence.inspection.interpreter, null);
  assert.equal(evidence.inspection.dynamicSegment, false);
  assert.equal(evidence.inspection.writeExecutableLoad, false);
  assert.equal(evidence.inspection.gnuStackExecutable, false);
});

test("ADR-0038 S3A evaluator reference exercises the full one-use result and receipt contract", () => {
  function consumeCandidateContainmentGuardianManagerProtocolTransitionV1(
    transition,
    dispatch,
  ) {
    assertCandidateContainmentGuardianManagerProtocolTransitionV1(transition);
    const request = transition.statefsRequest;
    if (typeof dispatch !== "function" || request === null) {
      throw new Error("S3A_BOUNDARY");
    }
    assertCandidateContainmentGuardianStatefsRequestV1(request);
    const executorResult = dispatch(request);
    return verifyCandidateContainmentGuardianStatefsResultV1({
      request,
      executorResult,
    });
  }

  assertCandidateManagerTransitionConsumerContractV1({
    CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS,
    CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256,
    consumeCandidateContainmentGuardianManagerProtocolTransitionV1,
  });
});

test("ADR-0038 S3A RED: exact one-use manager transition to StateFS bridge exists", async () => {
  const candidate = await loadCandidateManagerTransitionConsumerV1();
  assertCandidateManagerTransitionConsumerContractV1(candidate);
});
