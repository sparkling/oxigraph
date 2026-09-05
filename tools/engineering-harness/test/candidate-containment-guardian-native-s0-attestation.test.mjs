import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as manager from "../src/candidate/containment-guardian-manager-attestation-v1.mjs";
import * as guardian from "../src/candidate/containment-guardian-attestation-v1.mjs";
import * as trampoline from "../src/candidate/containment-guardian-trampoline-attestation-v1.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";
import {
  buildAndAttestNativeArtifactV1,
  repositoryRoot,
} from "./support/candidate-containment-guardian-native-v1-fixture.mjs";

const artifacts = Object.freeze([
  Object.freeze(["manager", manager]),
  Object.freeze(["guardian", guardian]),
  Object.freeze(["trampoline", trampoline]),
]);

test("ADR-0038 S0 native sources carry exact immutable self-descriptions", async () => {
  for (const [kind, attestation] of artifacts) {
    const source = await readFile(
      new URL(
        `../src/candidate/${attestation.SOURCE_LOGICAL_NAME_V1}`,
        import.meta.url,
      ),
    );
    assert.equal(
      attestation.sha256V1(source),
      attestation.SOURCE_SHA256_V1,
      `${kind} source pin`,
    );
    const selfDescription = Buffer.from(
      attestation.SELF_DESCRIPTION_JSONL_V1
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n"),
      "utf8",
    );
    const firstOccurrence = source.indexOf(selfDescription);
    assert.notEqual(firstOccurrence, -1, `${kind} self-description present`);
    assert.equal(
      firstOccurrence,
      source.lastIndexOf(selfDescription),
      `${kind} self-description occurrence`,
    );
    const parsed = JSON.parse(attestation.SELF_DESCRIPTION_JSONL_V1);
    assert.equal(parsed.schema, `oxigraph.candidate-containment-${kind}-self-description/v1`);
    assert.equal(parsed.binding, null);
    assert.equal(parsed.requirementsSha256, attestation.REQUIREMENTS_SHA256_V1);
    assert.equal(
      attestation.sha256V1(
        Buffer.from(attestation.REQUIREMENTS_CANONICAL_JSON_V1, "utf8"),
      ),
      attestation.REQUIREMENTS_SHA256_V1,
    );
    assert.equal(Object.isFrozen(attestation.REQUIREMENTS_V1), true);
    assert.equal(parsed.runtimeRegistered, false);
    assert.equal(parsed.productionReady, false);
    assert.equal(parsed.g17Eligible, false);
  }
});

test("ADR-0038 S0 exact recipes produce repeated byte-identical static ELF artifacts", async () => {
  for (const [kind, attestation] of artifacts) {
    const evidence = await buildAndAttestNativeArtifactV1(kind);
    assert.equal(evidence.report.schema, attestation.ATTESTATION_SCHEMA_V1);
    assert.deepEqual(evidence.report.compileArgv, attestation.COMPILE_ARGV_V1);
    assert.deepEqual(
      evidence.report.linkArgv,
      kind === "manager" ? attestation.LINK_ARGV_V1 : null,
    );
    assert.deepEqual(
      evidence.report.compilerEnvironment,
      attestation.COMPILER_ENVIRONMENT_V1,
    );
    assert.equal(evidence.firstSha256, attestation.ELF_SHA256_V1);
    assert.equal(evidence.secondSha256, attestation.ELF_SHA256_V1);
    assert.deepEqual(evidence.firstBytes, evidence.secondBytes);
    assert.equal(evidence.report.authority.processExecution, false);
    assert.equal(evidence.report.authority.runtimeRegistration, false);
    assert.equal(evidence.report.authority.qualification, false);
    assert.equal(evidence.report.authority.promotion, false);
    assert.equal(evidence.report.authority.publication, false);
    assert.equal(evidence.report.physicalFacts.delegatedCgroup, null);
    assert.equal(evidence.report.physicalFacts.productionUnit, null);
    assert.equal(evidence.inspection.staticElf, true);
    assert.equal(evidence.inspection.interpreter, null);
    assert.equal(evidence.inspection.dynamicSegment, false);
    assert.equal(evidence.inspection.writeExecutableLoad, false);
    assert.equal(evidence.inspection.gnuStackExecutable, false);
    assert.equal(evidence.inspection.selfDescriptionOccurrences, 1);
    assert.equal(
      evidence.report.inspection.selfDescriptionReadOnlyLoadOccurrences,
      1,
    );
  }
});

test("manager consumes the exact unchanged ADR-0037 production object", async () => {
  const evidence = await buildAndAttestNativeArtifactV1("manager");
  assert.equal(
    evidence.statefsObjectSha256,
    manager.STATEFS_OBJECT_SHA256_V1,
  );
  assert.equal(evidence.statefsObjectByteLength, 33_048);
  assert.equal(evidence.statefsEntrypointCount, 1);
  assert.equal(evidence.alternateStatefsEntrypointCount, 0);
  assert.equal(evidence.report.statefs.objectSha256, manager.STATEFS_OBJECT_SHA256_V1);
  assert.equal(evidence.report.statefs.sourceSha256, manager.STATEFS_SOURCE_SHA256_V1);
  assert.equal(evidence.report.statefs.headerSha256, manager.STATEFS_HEADER_SHA256_V1);
  assert.equal(
    evidence.report.statefs.buildRequirementsSha256,
    manager.STATEFS_BUILD_REQUIREMENTS_SHA256_V1,
  );
});

test("attestations reject source, ELF, compiler, and linked-StateFS substitution", async () => {
  for (const [kind, attestation] of artifacts) {
    const evidence = await buildAndAttestNativeArtifactV1(kind);
    for (const field of ["sourceBytes", "compilerBytes", "firstExecutableBytes", "secondExecutableBytes"]) {
      const changed = { ...evidence.attestationInput };
      changed[field] = Buffer.from(changed[field]);
      changed[field][0] ^= 0xff;
      assert.throws(
        () => attestation.attestV1(changed),
        /ADR38_NATIVE_ATTEST_/u,
        `${kind} rejects ${field}`,
      );
    }
    if (kind === "manager") {
      const changed = { ...evidence.attestationInput };
      changed.statefsObjectBytes = Buffer.from(changed.statefsObjectBytes);
      changed.statefsObjectBytes[0] ^= 0xff;
      assert.throws(
        () => attestation.attestV1(changed),
        /ADR38_NATIVE_ATTEST_/u,
      );
    }
  }
});

test("attestation inputs reject proxies, accessors, and shadowed Buffer length without invoking them", async () => {
  const evidence = await buildAndAttestNativeArtifactV1("guardian");
  assert.throws(
    () => guardian.attestV1(new Proxy(evidence.attestationInput, {})),
    /ADR38_NATIVE_ATTEST_INPUT/u,
  );

  let getterCalls = 0;
  const accessor = { ...evidence.attestationInput };
  Object.defineProperty(accessor, "sourceBytes", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return evidence.attestationInput.sourceBytes;
    },
  });
  assert.throws(
    () => guardian.attestV1(accessor),
    /ADR38_NATIVE_ATTEST_INPUT/u,
  );
  assert.equal(getterCalls, 0);

  const shadowed = { ...evidence.attestationInput };
  shadowed.sourceBytes = Buffer.from(shadowed.sourceBytes);
  Object.defineProperty(shadowed.sourceBytes, "length", {
    configurable: true,
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  assert.throws(
    () => guardian.attestV1(shadowed),
    /ADR38_NATIVE_ATTEST_SOURCE/u,
  );
  assert.equal(getterCalls, 0);
});

test("attestation replay does not trust a replaced Buffer equality method", async () => {
  const evidence = await buildAndAttestNativeArtifactV1("guardian");
  const changed = { ...evidence.attestationInput };
  changed.secondExecutableBytes = Buffer.from(changed.secondExecutableBytes);
  changed.secondExecutableBytes[0] ^= 0xff;
  const original = Object.getOwnPropertyDescriptor(Buffer.prototype, "equals");
  try {
    Object.defineProperty(Buffer.prototype, "equals", {
      ...original,
      value: () => true,
    });
    assert.throws(
      () => guardian.attestV1(changed),
      /ADR38_NATIVE_ATTEST_ELF_IDENTITY/u,
    );
  } finally {
    Object.defineProperty(Buffer.prototype, "equals", original);
  }
});

test("S0 remains absent from registries and leaves production readiness unavailable", () => {
  const registeredText = [...commandIds(), ...engineeringTaskIds].join("\n");
  assert.doesNotMatch(registeredText, /containment-guardian-(?:manager|native|trampoline)/u);
  assert.deepEqual(candidateContainmentOwnerV2Readiness(), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
});
