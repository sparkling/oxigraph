import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  verifyG17BenchmarkExecutionRequestV2Artifact,
} from "../src/qualification/benchmark-execution-request-v2-contract.mjs";
import {
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
  G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  verifyG17CargoExecveatHelperAttestationArtifact,
} from "../src/qualification/cargo-execveat-helper-attestation-contract.mjs";
import { G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS } from "../src/qualification/non-tmpfs-build-isolation-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_V2_AUTHORITY,
  G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION,
  G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CODES,
  G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES,
  G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS,
  G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS,
  G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
  G17NonTmpfsContainmentV2ContractError,
  createG17NonTmpfsContainmentV2Artifact,
  deriveG17NonTmpfsContainmentV2CgroupPath,
  verifyG17NonTmpfsContainmentV2Artifact,
} from "../src/qualification/non-tmpfs-containment-v2-contract.mjs";
import {
  cleanupG17SuccessorArtifactFixtures,
  createG17HelperAttestationVerification,
  createG17RequestV2Verification,
} from "./support/g17-successor-artifact-fixtures.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const v1ContractUrl = new URL(
  "../src/qualification/non-tmpfs-containment-contract.mjs",
  import.meta.url,
);
const v2ContractUrl = new URL(
  "../src/qualification/non-tmpfs-containment-v2-contract.mjs",
  import.meta.url,
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function falseSuperset(...values) {
  return Object.assign({}, ...values);
}

function cgroupDirectory() {
  return {
    role: "cgroupDirectory",
    kind: "directory",
    descriptorCapabilities: "held-directory-openat-read-write-children",
    fixedFd: null,
    parentOnly: true,
    entersHelperImage: false,
    entersCargoImage: false,
    identity: {
      device: "52",
      inode: "7001",
      mode: String(0o40700),
      links: "2",
      mountId: "49",
      filesystemType: String(0x63677270),
      ownerUid: "1000",
      ownerGid: "1000",
    },
  };
}

function placement() {
  return {
    claimSource: "CALLER_SUPPLIED_SERIALIZED_NONAUTHORITATIVE",
    syscall: "clone3",
    cloneArgsSizeBytes: 88,
    cloneArgs: {
      flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
      pidfdOutput: {
        role: "directChildPidfd",
        ownership: "parent",
        storage: "caller-provided-output-pointer",
      },
      childTidPointer: 0,
      parentTidPointer: 0,
      exitSignal: "SIGCHLD",
      stackPointer: 0,
      stackSizeBytes: 0,
      tlsPointer: 0,
      setTidPointer: 0,
      setTidSize: 0,
      setTidEntries: [],
      cgroupDescriptorRole: "cgroupDirectory",
    },
    result: "SUCCESS",
    errno: null,
    workerPlacedBeforeUserCodeRunnable: true,
    postSpawnCgroupProcsWritten: false,
    forkThenMoveFallbackUsed: false,
    cloneWithoutIntoCgroupFallbackUsed: false,
    serializedHelperImageReachedClaim: true,
    pidfd: {
      role: "directChildPidfd",
      kind: "pidfd",
      descriptorCapabilities: "poll-signal-waitid",
      fixedFd: null,
      parentOnly: true,
      entersHelperImage: false,
      entersCargoImage: false,
      fdCloexec: true,
    },
  };
}

function supervision() {
  return {
    claimSource: "CALLER_SUPPLIED_SERIALIZED_NONAUTHORITATIVE",
    pidfdRole: "directChildPidfd",
    boundedWait: {
      mechanism: "pidfd-poll-before-waitid",
      timeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
      timeoutDisposition: "INCONCLUSIVE_RETAIN_HANDLES_NO_CLEANUP",
    },
    poll: {
      syscall: "poll",
      descriptorRole: "directChildPidfd",
      events: ["POLLIN"],
      timeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
      result: "READY",
      revents: ["POLLIN"],
      errno: null,
    },
    waitid: {
      syscall: "waitid",
      idType: "P_PIDFD",
      pidfdRole: "directChildPidfd",
      options: ["WEXITED"],
      result: "REAPED",
      siCode: "CLD_EXITED",
      exitCode: 0,
      signal: null,
      coreDumped: false,
      callerSuppliedReapProofAccepted: false,
    },
    close: {
      syscall: "close",
      descriptorRole: "directChildPidfd",
      result: "CLOSED",
      errno: null,
      afterWaitid: true,
    },
  };
}

async function fixtureBundle(options = {}) {
  const request = createG17RequestV2Verification(options.request);
  const helper = await createG17HelperAttestationVerification(options.helper);
  return {
    request,
    helper,
    input: {
      executionRequestVerification: request.verification,
      helperAttestationVerification: helper.verification,
      cgroupDirectory: cgroupDirectory(),
      placement: placement(),
      supervision: supervision(),
      cgroupProcsBytes: Buffer.alloc(0),
      cgroupEventsBytes: Buffer.from("populated 0\nfrozen 0\n", "utf8"),
      cgroupPidsCurrentBytes: Buffer.from("0\n", "utf8"),
    },
  };
}

function resealDocument(value) {
  const { contentHash: _oldContentHash, ...unsigned } = value;
  value.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function mutateArtifact(created, mutate, { reseal = true } = {}) {
  const value = JSON.parse(created.artifact.bytes.toString("utf8"));
  mutate(value);
  return reseal
    ? resealDocument(value)
    : Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function mutateRequestArtifact(created, mutate) {
  const value = JSON.parse(created.artifact.bytes.toString("utf8"));
  mutate(value);
  return resealDocument(value);
}

function throwsCode(block, code) {
  assert.throws(block, (error) => {
    assert.ok(error instanceof G17NonTmpfsContainmentV2ContractError);
    assert.equal(error.code, code);
    assert.equal(typeof error.phase, "string");
    assert.match(error.message, /^G1\.7 non-tmpfs containment v2 contract:/u);
    return true;
  });
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test.after(cleanupG17SuccessorArtifactFixtures);

test("v2 freezes every policy containment requirement and exact bounds", () => {
  const policyBundle = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
  const containment = policyBundle.policy.containment;

  assert.equal(
    G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA,
    "oxigraph.g1.7-non-tmpfs-containment-evidence/v2",
  );
  assert.equal(
    G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA,
    "oxigraph.g1.7-non-tmpfs-containment-replay/v2",
  );
  assert.equal(G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES, 2 * 1024 * 1024);
  assert.deepEqual(plainJson(G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS), {
    policy: {
      schema: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
      rawSha256: policyBundle.artifact.sha256,
      contentHash: policyBundle.policy.sha256,
    },
    requiredSuccessorSchema: containment.requiredSuccessorSchema,
    perBuildCgroupV2SubtreeRequired: true,
    cgroupPathDerivation: plainJson(containment.cgroupPathDerivation),
    initialPlacement: plainJson(containment.initialPlacement),
    directChildReap: plainJson(containment.directChildReap),
    parentOnlyCgroupDescriptorRequired: true,
    parentOnlyPidfdRequired: true,
    quiescenceAfterDirectChildReapRequired: true,
    quiescenceObservations: plainJson(containment.quiescenceObservations),
    cleanupBeforeQuiescenceForbidden: true,
    nativeAdapterRequired: true,
    closeReapTimeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
    cloneArgsSizeBytes: 88,
    artifactMaximumBytes: 2 * 1024 * 1024,
    cgroupFileMaximumBytes: 64 * 1024,
    cgroupPathMaximumBytes: 4_096,
  });
  assert.equal(
    G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
    canonicalSha256(G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS),
  );
  assertDeepFrozen(G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS);
});

test("real request and helper verifier artifacts compose only as policy fan-in", async () => {
  const { input, request, helper } = await fixtureBundle();
  const requestReplay = verifyG17BenchmarkExecutionRequestV2Artifact(
    input.executionRequestVerification,
  );
  const helperReplay = verifyG17CargoExecveatHelperAttestationArtifact(
    input.helperAttestationVerification,
  );
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  const verified = verifyG17NonTmpfsContainmentV2Artifact({
    bytes: created.artifact.bytes,
    expected: input,
  });

  assert.equal(created.evidence.status, "PRIVATE_COLOCATED_ISSUER_REQUIRED");
  assert.deepEqual(plainJson(created.evidence.identity), {
    controlRunId: requestReplay.request.controlRunId,
    buildId: requestReplay.request.buildId,
    ownerGeneration: requestReplay.request.ownership.ownerGeneration,
    processGeneration: requestReplay.request.ownership.processGeneration,
    workspaceGeneration: requestReplay.request.source.workspaceGeneration,
    targetGeneration: requestReplay.request.source.targetGeneration,
  });
  assert.deepEqual(
    plainJson(created.evidence.dependencyDag.nodes.executionRequest),
    plainJson(requestReplay.identity),
  );
  assert.deepEqual(
    plainJson(created.evidence.dependencyDag.nodes.helperAttestation),
    plainJson(helperReplay.identity),
  );
  assert.deepEqual(
    plainJson(created.evidence.dependencyDag.nodes.isolationPolicy),
    plainJson(G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING),
  );
  assert.deepEqual(plainJson(created.evidence.dependencyDag.edges), [
    {
      from: "isolationPolicy",
      to: "executionRequest",
      relation: "VERIFIED_POLICY_DEPENDENCY",
    },
    {
      from: "isolationPolicy",
      to: "helperAttestation",
      relation: "VERIFIED_POLICY_DEPENDENCY",
    },
    {
      from: "executionRequest",
      to: "helperAttestation",
      relation: "ABSENT_PRIVATE_COLOCATED_ISSUER_REQUIRED",
    },
  ]);
  assert.equal(created.evidence.dependencyDag.mode, "POLICY_DEPENDENCY_FAN_IN");
  assert.equal(
    created.evidence.dependencyDag.status,
    "PRIVATE_COLOCATED_ISSUER_REQUIRED",
  );
  assert.deepEqual(
    created.evidence.dependencyDag.requestHelperBinding.placeholder,
    G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  );
  assert.equal(
    created.evidence.dependencyDag.requestHelperBinding.present,
    false,
  );
  assert.equal(created.evidence.binding, null);
  assert.equal(created.evidence.finalDecisionEligible, false);
  assert.equal(verified.status, "DORMANT_CONTAINMENT_V2_REPLAYED");
  assert.deepEqual(verified.identity, created.identity);
  assert.equal(
    request.created.artifact.rawSha256,
    requestReplay.identity.rawSha256,
  );
  assert.equal(
    helper.created.artifact.rawSha256,
    helperReplay.identity.rawSha256,
  );
  assertDeepFrozen(created);
  assertDeepFrozen(verified);
});

test("PID-free reserved-name-safe path binds all verified identities and generations", async () => {
  const baseline = await fixtureBundle();
  const baselinePath = deriveG17NonTmpfsContainmentV2CgroupPath({
    executionRequestVerification: baseline.input.executionRequestVerification,
    helperAttestationVerification: baseline.input.helperAttestationVerification,
  });
  assert.match(
    baselinePath,
    /^\/engineering-harness-g1\.7\/run-[a-z0-9.-]+\/build-[a-z0-9.-]+-[0-9a-f]{64}$/u,
  );
  assert.doesNotMatch(baselinePath, /(?:^|\/)(?:cgroup\.|tasks$)/u);
  assert.doesNotMatch(baselinePath, /(?:pid|process-id)-?[0-9]+/iu);
  assert.ok(Buffer.byteLength(baselinePath, "utf8") <= 4_096);

  const variations = [
    await fixtureBundle({
      request: {
        mutateExpected(value) {
          value.controlRunId = "alternate-control";
          value.source.controlRunId = "alternate-control";
        },
      },
    }),
    await fixtureBundle({ request: { buildIndex: 1 } }),
    await fixtureBundle({
      request: {
        mutateExpected(value) {
          value.ownership.ownerGeneration = `g17-owner-${"c".repeat(64)}`;
        },
      },
    }),
    await fixtureBundle({
      request: {
        mutateExpected(value) {
          value.ownership.processGeneration = `g17-process-${"d".repeat(64)}`;
        },
      },
    }),
    await fixtureBundle({
      request: {
        mutateExpected(value) {
          value.source.workspaceGeneration = `g17-workspace-${"f".repeat(64)}`;
        },
      },
    }),
    await fixtureBundle({
      request: {
        mutateExpected(value) {
          value.source.targetGeneration = `g17-target-${"e".repeat(64)}`;
        },
      },
    }),
    await fixtureBundle({
      helper: {
        mutateEvidence(value) {
          value.executableIdentity.inode = (
            BigInt(value.executableIdentity.inode) + 1n
          ).toString();
        },
      },
    }),
  ];
  for (const variation of variations) {
    const path = deriveG17NonTmpfsContainmentV2CgroupPath({
      executionRequestVerification:
        variation.input.executionRequestVerification,
      helperAttestationVerification:
        variation.input.helperAttestationVerification,
    });
    assert.notEqual(path, baselinePath);
  }
});

test("clone3, pidfd poll, waitid, close, quiescence, and cleanup order is exact", async () => {
  const { input } = await fixtureBundle();
  const { evidence } = createG17NonTmpfsContainmentV2Artifact(input);

  assert.deepEqual(evidence.lifecycle.declaredSequence, [
    "clone3-initial-cgroup-placement",
    "serialized-helper-image-reached-claim",
    "bounded-pidfd-poll",
    "waitid-pidfd-direct-child-reap",
    "direct-child-pidfd-close",
    "cgroup-v2-quiescence",
    "cleanup-eligible-only-after-physical-quiescence-proof",
  ]);
  assert.deepEqual(plainJson(evidence.lifecycle.placement), input.placement);
  assert.deepEqual(
    plainJson(evidence.lifecycle.supervision),
    input.supervision,
  );
  assert.equal(evidence.lifecycle.placement.cloneArgsSizeBytes, 88);
  assert.deepEqual(evidence.lifecycle.placement.cloneArgs.flags, [
    "CLONE_INTO_CGROUP",
    "CLONE_PIDFD",
  ]);
  assert.deepEqual(
    plainJson(evidence.lifecycle.placement.cloneArgs.pidfdOutput),
    {
      role: "directChildPidfd",
      ownership: "parent",
      storage: "caller-provided-output-pointer",
    },
  );
  for (const key of [
    "childTidPointer",
    "parentTidPointer",
    "stackPointer",
    "stackSizeBytes",
    "tlsPointer",
    "setTidPointer",
    "setTidSize",
  ]) {
    assert.equal(evidence.lifecycle.placement.cloneArgs[key], 0, key);
  }
  assert.deepEqual(evidence.lifecycle.placement.cloneArgs.setTidEntries, []);
  assert.equal(evidence.lifecycle.placement.cloneArgs.exitSignal, "SIGCHLD");
  assert.equal(
    evidence.lifecycle.placement.serializedHelperImageReachedClaim,
    true,
  );
  assert.equal(
    evidence.nonclaims.serializedHelperImageReachedClaimProvesTransition,
    false,
  );
  assert.equal("helperImageReached" in evidence.nonclaims, false);
  assert.equal(
    evidence.lifecycle.supervision.boundedWait.timeoutMilliseconds,
    G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  );
  assert.equal(
    evidence.lifecycle.supervision.boundedWait.timeoutDisposition,
    "INCONCLUSIVE_RETAIN_HANDLES_NO_CLEANUP",
  );
  assert.equal(evidence.lifecycle.supervision.waitid.idType, "P_PIDFD");
  assert.deepEqual(evidence.lifecycle.supervision.waitid.options, ["WEXITED"]);
  assert.equal(evidence.lifecycle.supervision.waitid.exitCode, 0);
  assert.equal(evidence.lifecycle.supervision.close.afterWaitid, true);
  assert.equal(evidence.quiescence.processesRemaining, 0);
  assert.equal(evidence.cleanup.status, "NOT_EXECUTED_BY_REPLAY_CONTRACT");
  assert.equal(evidence.cleanup.physicalEligibility, false);
});

test("authority and nonclaims are exact upstream supersets and immutable false", async () => {
  const expectedAuthority = falseSuperset(
    G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
    {
      nativeContainmentAdapterAuthority: false,
      cleanupExecutionAuthority: false,
    },
  );
  const expectedNonclaims = falseSuperset(
    G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
    {
      serializedReplayProvesNativeOrigin: false,
      serializedReplayProvesObservationOrder: false,
      serializedClone3ClaimProvesSyscall: false,
      serializedClone3ClaimProvesInitialCgroupPlacement: false,
      serializedCloneArgsProveKernelInput: false,
      serializedPidfdClaimProvesKernelPidfd: false,
      serializedPidfdPollClaimProvesReadiness: false,
      serializedWaitidClaimProvesDirectChildReap: false,
      serializedPidfdCloseClaimProvesClose: false,
      serializedQuiescenceBytesProveKernelOrigin: false,
      serializedCgroupPathProvesHeldDirectory: false,
      serializedDescriptorClaimProvesParentOnlyIsolation: false,
      serializedHelperImageReachedClaimProvesTransition: false,
      serializedRequestAndHelperFanInProvesCoLocatedIssuer: false,
      replayProvesNoPostSpawnCgroupMove: false,
      replayProvesNoForkFallback: false,
      replayProvesNoCloneFallback: false,
      replayProvesLifecycleOrder: false,
      replayProvesCleanupOrder: false,
      cleanupExecuted: false,
      physicalOriginProven: false,
      physicalEligibility: false,
    },
  );
  assert.deepEqual(
    plainJson(G17_NON_TMPFS_CONTAINMENT_V2_AUTHORITY),
    expectedAuthority,
  );
  assert.deepEqual(
    plainJson(G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS),
    expectedNonclaims,
  );
  assert.equal(
    Object.values(expectedAuthority).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(expectedNonclaims).every((value) => value === false),
    true,
  );

  const { input } = await fixtureBundle();
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  for (const key of Object.keys(expectedAuthority)) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: mutateArtifact(created, (value) => {
            value.authority[key] = true;
          }),
          expected: input,
        }),
      "AUTHORITY_OVERCLAIM",
    );
  }
  for (const key of Object.keys(expectedNonclaims)) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: mutateArtifact(created, (value) => {
            value.nonclaims[key] = true;
          }),
          expected: input,
        }),
      "AUTHORITY_OVERCLAIM",
    );
  }
});

test("every physical sequence mutation fails as mechanics drift", async () => {
  const { input } = await fixtureBundle();
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  const mutations = [
    (value) => {
      value.lifecycle.placement.cloneArgsSizeBytes = 80;
    },
    (value) => {
      value.lifecycle.placement.cloneArgs.flags.reverse();
    },
    (value) => {
      value.lifecycle.placement.cloneArgs.childTidPointer = 1;
    },
    (value) => {
      value.lifecycle.placement.cloneArgs.exitSignal = "SIGCHLD|1";
    },
    (value) => {
      value.lifecycle.placement.cloneArgs.setTidEntries.push(1);
    },
    (value) => {
      value.lifecycle.placement.postSpawnCgroupProcsWritten = true;
    },
    (value) => {
      value.lifecycle.placement.forkThenMoveFallbackUsed = true;
    },
    (value) => {
      value.lifecycle.placement.cloneWithoutIntoCgroupFallbackUsed = true;
    },
    (value) => {
      value.lifecycle.placement.workerPlacedBeforeUserCodeRunnable = false;
    },
    (value) => {
      value.lifecycle.placement.serializedHelperImageReachedClaim = false;
    },
    (value) => {
      value.lifecycle.supervision.boundedWait.timeoutMilliseconds += 1;
    },
    (value) => {
      value.lifecycle.supervision.poll.events = ["POLLOUT"];
    },
    (value) => {
      value.lifecycle.supervision.poll.result = "TIMEOUT";
    },
    (value) => {
      value.lifecycle.supervision.waitid.idType = "P_PID";
    },
    (value) => {
      value.lifecycle.supervision.waitid.exitCode = 1;
    },
    (value) => {
      value.lifecycle.supervision.close.result = "OPEN";
    },
    (value) => {
      value.lifecycle.supervision.close.afterWaitid = false;
    },
    (value) => {
      value.lifecycle.declaredSequence.reverse();
    },
    (value) => {
      value.quiescence.processesRemaining = 1;
    },
    (value) => {
      value.quiescence.events.populated = "1";
    },
    (value) => {
      value.cleanup.status = "COMPLETE";
    },
    (value) => {
      value.cleanup.physicalEligibility = true;
    },
  ];

  for (const mutate of mutations) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: mutateArtifact(created, mutate),
          expected: input,
        }),
      "MECHANICS_CONTRACT_DRIFT",
    );
  }
});

test("policy drift is reachable and nested verifier failures stay classified", async () => {
  const { input, request } = await fixtureBundle();
  const policyDrift = {
    ...input,
    executionRequestVerification: {
      ...input.executionRequestVerification,
      bytes: mutateRequestArtifact(request.created, (value) => {
        value.isolationPolicy.rawSha256 = sha256(Buffer.from("other policy"));
      }),
    },
  };
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(policyDrift),
    "POLICY_BINDING_DRIFT",
  );

  const malformedRequest = {
    ...input,
    executionRequestVerification: {
      ...input.executionRequestVerification,
      bytes: Buffer.from("{}\n"),
    },
  };
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(malformedRequest),
    "REQUEST_BINDING_DRIFT",
  );

  const malformedHelper = {
    ...input,
    helperAttestationVerification: {
      ...input.helperAttestationVerification,
      bytes: Buffer.from("{}\n"),
    },
  };
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(malformedHelper),
    "HELPER_ATTESTATION_BINDING_DRIFT",
  );

  const extraNestedField = {
    ...input,
    executionRequestVerification: {
      ...input.executionRequestVerification,
      untrusted: true,
    },
  };
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(extraNestedField),
    "INPUT_SHAPE_INVALID",
  );
});

test("dependency, path, lifecycle, and cleanup drift reject resealed artifacts", async () => {
  const { input } = await fixtureBundle();
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  const expectedDrift = [
    (value) => {
      value.dependencyDag.nodes.executionRequest.rawSha256 = sha256(
        Buffer.from("other request"),
      );
    },
    (value) => {
      value.dependencyDag.nodes.helperAttestation.rawSha256 = sha256(
        Buffer.from("other helper"),
      );
    },
    (value) => {
      value.cgroup.path = "/engineering-harness-g1.7/run-caller/build-chosen";
    },
  ];
  for (const mutate of expectedDrift) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: mutateArtifact(created, mutate),
          expected: input,
        }),
      "EXPECTED_INPUT_MISMATCH",
    );
  }
  for (const mutate of [
    (value) => {
      value.dependencyDag.requestHelperBinding.present = true;
    },
    (value) => {
      value.dependencyDag.status = "BOUND";
    },
  ]) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: mutateArtifact(created, mutate),
          expected: input,
        }),
      "AUTHORITY_OVERCLAIM",
    );
  }
});

test("raw cgroup terminal files are exact, bounded, and self-identifying", async () => {
  const { input } = await fixtureBundle();
  for (const [field, bytes] of [
    ["cgroupProcsBytes", Buffer.from("4242\n")],
    ["cgroupEventsBytes", Buffer.from("populated 1\n")],
    ["cgroupEventsBytes", Buffer.from("populated 0\npopulated 0\n")],
    ["cgroupEventsBytes", Buffer.from("populated 0")],
    ["cgroupPidsCurrentBytes", Buffer.from("1\n")],
  ]) {
    throwsCode(
      () =>
        createG17NonTmpfsContainmentV2Artifact({
          ...input,
          [field]: bytes,
        }),
      "LIFECYCLE_CONTRADICTION",
    );
  }
  throwsCode(
    () =>
      createG17NonTmpfsContainmentV2Artifact({
        ...input,
        cgroupEventsBytes: Buffer.alloc(64 * 1024 + 1),
      }),
    "LIMIT_EXCEEDED",
  );

  const created = createG17NonTmpfsContainmentV2Artifact(input);
  assert.equal(created.evidence.quiescence.procs.raw.base64, "");
  assert.equal(
    created.evidence.quiescence.events.raw.sha256,
    sha256(input.cgroupEventsBytes),
  );
  assert.equal(
    created.evidence.quiescence.pidsCurrent.raw.sha256,
    sha256(input.cgroupPidsCurrentBytes),
  );
});

test("exact own-data envelopes and intrinsic Buffers reject hostile inputs", async () => {
  const { input } = await fixtureBundle();
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(new Proxy(input, {})),
    "INPUT_SHAPE_INVALID",
  );
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact({ ...input, extra: true }),
    "INPUT_SHAPE_INVALID",
  );
  const symbolic = { ...input };
  symbolic[Symbol("authority")] = true;
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(symbolic),
    "INPUT_SHAPE_INVALID",
  );

  const accessor = { ...input };
  let accessed = false;
  Object.defineProperty(accessor, "placement", {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error("must not run");
    },
  });
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(accessor),
    "INPUT_SHAPE_INVALID",
  );
  assert.equal(accessed, false);

  const proxiedBuffer = {
    ...input,
    cgroupEventsBytes: new Proxy(input.cgroupEventsBytes, {}),
  };
  throwsCode(
    () => createG17NonTmpfsContainmentV2Artifact(proxiedBuffer),
    "INPUT_SHAPE_INVALID",
  );
});

test("canonical verifier rejects malformed outer artifacts independently", async () => {
  const { input } = await fixtureBundle();
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  const bytes = created.artifact.bytes;
  const rejected = [
    Buffer.alloc(0),
    Buffer.alloc(G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES + 1),
    Buffer.from([0xff, 0x0a]),
    bytes.subarray(0, -1),
    Buffer.concat([bytes, Buffer.from("\n")]),
    Buffer.from(` ${bytes.toString("utf8")}`, "utf8"),
  ];
  for (const value of rejected) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: value,
          expected: input,
        }),
      "CANONICAL_ARTIFACT_INVALID",
    );
  }
});

test("malformed nested sealed envelopes fail before any dereference", async () => {
  const { input } = await fixtureBundle();
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  const mutations = [
    (value) => {
      value.dependencyDag = null;
    },
    (value) => {
      value.dependencyDag = [];
    },
    (value) => {
      delete value.dependencyDag.requestHelperBinding;
    },
    (value) => {
      value.dependencyDag.requestHelperBinding = null;
    },
    (value) => {
      value.dependencyDag.requestHelperBinding = [];
    },
    (value) => {
      delete value.dependencyDag.requestHelperBinding.present;
    },
    (value) => {
      value.cgroup = null;
    },
    (value) => {
      value.cgroup = [];
    },
    (value) => {
      delete value.cgroup.path;
    },
  ];

  for (const mutate of mutations) {
    throwsCode(
      () =>
        verifyG17NonTmpfsContainmentV2Artifact({
          bytes: mutateArtifact(created, mutate),
          expected: input,
        }),
      "CANONICAL_ARTIFACT_INVALID",
    );
  }
});

test("ADR-160 codes have finite no-retry classification and reachable policy drift", async () => {
  assert.deepEqual(G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CODES, [
    "INPUT_SHAPE_INVALID",
    "LIMIT_EXCEEDED",
    "IDENTITY_INVALID",
    "POLICY_BINDING_DRIFT",
    "REQUEST_BINDING_DRIFT",
    "HELPER_ATTESTATION_BINDING_DRIFT",
    "MECHANICS_CONTRACT_DRIFT",
    "LIFECYCLE_CONTRADICTION",
    "CANONICAL_ARTIFACT_INVALID",
    "CONTENT_HASH_MISMATCH",
    "AUTHORITY_OVERCLAIM",
    "EXPECTED_INPUT_MISMATCH",
    "DEPENDENCY_UNCERTAIN",
  ]);
  assert.deepEqual(
    Object.keys(G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION),
    G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CODES,
  );
  for (const classification of Object.values(
    G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION,
  )) {
    assert.equal(classification.terminal, true);
    assert.equal(classification.retryAllowed, false);
    assert.equal(typeof classification.origin, "string");
  }
  assert.equal(
    G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION.POLICY_BINDING_DRIFT
      .origin,
    "verified-request-policy",
  );
  assert.equal(
    G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION.DEPENDENCY_UNCERTAIN
      .origin,
    "internal-dependency",
  );
  assert.equal(Object.isFrozen(G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CODES), true);
  assertDeepFrozen(G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION);

  const { input } = await fixtureBundle();
  const created = createG17NonTmpfsContainmentV2Artifact(input);
  throwsCode(
    () =>
      verifyG17NonTmpfsContainmentV2Artifact({
        bytes: mutateArtifact(
          created,
          (value) => {
            value.authority.buildExecutionAuthority = true;
          },
          { reseal: false },
        ),
        expected: input,
      }),
    "CONTENT_HASH_MISMATCH",
  );
  assert.throws(
    () =>
      new G17NonTmpfsContainmentV2ContractError(
        "NOT_FINITE",
        "test",
        "invalid",
      ),
    TypeError,
  );
});

test("v2 remains pure and v1 source remains byte-compatible", async () => {
  const [v1Source, v2Source] = await Promise.all([
    readFile(v1ContractUrl),
    readFile(v2ContractUrl, "utf8"),
  ]);
  assert.equal(
    sha256(v1Source),
    "d0c100df513853c991bb5536791c6e71a1f86a82439dcd5519c9ef23d48f5310",
  );
  assert.doesNotMatch(
    v2Source,
    /node:(?:child_process|fs|fs\/promises|worker_threads|cluster|net)|\b(?:spawn|execFile|fork|execveat|clone3|waitid|poll)\s*\(/u,
  );
});
