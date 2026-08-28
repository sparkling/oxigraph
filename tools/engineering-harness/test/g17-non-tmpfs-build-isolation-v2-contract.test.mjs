import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
  G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
} from "../src/qualification/non-tmpfs-build-isolation-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGC_MAX,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGV_MAX_BYTES,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_AUTHORITY,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_NONCLAIMS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_MAX_BYTES,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_TIMEOUT_MS,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
  verifyG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import {
  G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
  G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
  G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
} from "../src/qualification/cargo-execveat-status-protocol-contract.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_ARGV_MAX_BYTES,
  G17_BENCHMARK_EXECUTION_REQUEST_SUCCESSOR_ISOLATION_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_TIMEOUT_MS,
} from "../src/qualification/benchmark-execution-request-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /G1\.7 non-tmpfs build isolation v2 contract/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function reseal(policy) {
  const { sha256: _oldSha256, ...unsigned } = policy;
  policy.sha256 = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(policy)}\n`, "utf8");
}

function mutatedBytes(mutate) {
  const policy = plainJson(
    createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy,
  );
  mutate(policy);
  return reseal(policy);
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertNullPrototypeRecords(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    assert.equal(Object.getPrototypeOf(value), null);
  }
  for (const child of Object.values(value)) {
    assertNullPrototypeRecords(child, seen);
  }
}

test("isolation policy v2 is a canonical dormant successor artifact", () => {
  const created = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
  const { policy, artifact } = created;

  assert.equal(
    G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
    "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2",
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_REQUEST_SUCCESSOR_ISOLATION_SCHEMA,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  );
  assert.equal(
    artifact.name,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME,
  );
  assert.equal(artifact.sha256, sha256(artifact.bytes));
  assert.equal(policy.status, "DORMANT_REQUIREMENTS_ONLY");
  assert.equal(policy.requirementMode, "prescriptive-not-observed");
  assert.equal(
    policy.environment.class,
    G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
  );
  assert.equal(policy.environment.tmpfsState, false);
  assert.equal(policy.environment.ramfsState, false);
  assert.equal(
    policy.sha256,
    canonicalSha256(
      Object.fromEntries(
        Object.entries(policy).filter(([key]) => key !== "sha256"),
      ),
    ),
  );
  assert.deepEqual(
    verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(artifact.bytes),
    policy,
  );
  assert.equal(Object.getPrototypeOf(created), null);
  assert.equal(Object.getPrototypeOf(artifact), null);
  assertDeepFrozen(policy);
  assertNullPrototypeRecords(policy);

  const first = artifact.bytes;
  first.fill(0);
  assert.notDeepEqual(
    first,
    artifact.bytes,
    "artifact bytes are defensive copies",
  );
});

test("v2 freezes the exact helper and Cargo descriptor images", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy;
  const descriptors = policy.fileDescriptors;

  assert.deepEqual(
    descriptors,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS,
  );
  assert.deepEqual(plainJson(descriptors.exactChildDescriptorRange), {
    first: 0,
    last: 8,
    descriptorsAtOrAbove: 9,
    dispositionAtHelperEntry: "close-range-fail-closed",
    closeRange: {
      syscall: "close_range",
      first: 9,
      last: "UINT_MAX",
      flags: 0,
      fallbackLoopForbidden: true,
      failureDisposition: "fail-before-ready",
    },
  });
  assert.deepEqual(
    descriptors.childFileDescriptors.map((entry) => [
      entry.childFd,
      entry.role,
      entry.kind,
      entry.descriptorAccess,
      entry.logicalPath,
      entry.presentInHelperImage,
      entry.presentInCargoImage,
      entry.cloexecAtHelperEntry,
      entry.cloexecImmediatelyBeforeCargoExecveat,
      entry.lifecycle,
    ]),
    [
      [
        0,
        "stdinNull",
        "character-device",
        "read-only",
        "/dev/null",
        true,
        true,
        false,
        false,
        "retained-through-cargo-image",
      ],
      [
        1,
        "cargoStdout",
        "pipe-writer",
        "write-only",
        null,
        true,
        true,
        false,
        false,
        "retained-through-cargo-image",
      ],
      [
        2,
        "cargoStderr",
        "pipe-writer",
        "write-only",
        null,
        true,
        true,
        false,
        false,
        "retained-through-cargo-image",
      ],
      [
        3,
        "workspaceRoot",
        "directory",
        "read-only",
        "/proc/self/fd/3",
        true,
        true,
        false,
        false,
        "retained-through-cargo-image",
      ],
      [
        4,
        "source",
        "directory",
        "read-only",
        "/proc/self/fd/4",
        true,
        true,
        false,
        false,
        "retained-through-cargo-image",
      ],
      [
        5,
        "target",
        "directory",
        "read-only",
        "/proc/self/fd/5",
        true,
        true,
        false,
        false,
        "retained-through-cargo-image",
      ],
      [
        6,
        "cargoExecutable",
        "regular-file",
        "read-only",
        "/proc/self/fd/6",
        true,
        false,
        false,
        true,
        "helper-private-close-on-cargo-image-transition",
      ],
      [
        7,
        "execStatusWriter",
        "pipe-writer",
        "write-only",
        null,
        true,
        false,
        false,
        true,
        "helper-private-close-on-cargo-image-transition",
      ],
      [
        8,
        "helperSelfExecutable",
        "regular-file",
        "read-only",
        "/proc/self/fd/8",
        true,
        false,
        false,
        true,
        "helper-private-close-on-cargo-image-transition",
      ],
    ],
  );
  assert.equal(
    descriptors.childFileDescriptors.find(({ childFd }) => childFd === 5)
      .descriptorAccess,
    "read-only",
  );
  assert.deepEqual(
    plainJson(
      policy.workspace.namespace.mounts.find(({ role }) => role === "target"),
    ).mountOptions,
    ["bind", "nodev", "nosuid", "rw"],
  );
  assert.equal(
    policy.workspace.namespace.mounts.find(({ role }) => role === "target")
      .readOnly,
    false,
  );
  assert.deepEqual(plainJson(descriptors.imageMaps), {
    standardFileDescriptors: [0, 1, 2],
    helperImageFileDescriptors: [3, 4, 5, 6, 7, 8],
    helperImageExactOpenFileDescriptors: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    cargoImageInheritedFileDescriptors: [3, 4, 5],
    cargoImageExactOpenFileDescriptors: [0, 1, 2, 3, 4, 5],
    launcherPrivateFileDescriptors: [6, 7, 8],
  });
  assert.deepEqual(plainJson(descriptors.parentOnlyFileDescriptors), [
    {
      role: "execStatusReader",
      kind: "pipe-reader",
      descriptorCapabilities: "read-only",
      fixedFd: null,
      entersHelperImage: false,
      entersCargoImage: false,
    },
    {
      role: "cgroupDirectory",
      kind: "directory",
      descriptorCapabilities: "held-directory-openat-read-write-children",
      fixedFd: null,
      entersHelperImage: false,
      entersCargoImage: false,
    },
    {
      role: "directChildPidfd",
      kind: "pidfd",
      descriptorCapabilities: "poll-signal-waitid",
      fixedFd: null,
      entersHelperImage: false,
      entersCargoImage: false,
    },
  ]);
  assert.equal(
    Object.values(descriptors.aliasing).every((requirement) => requirement),
    true,
  );
});

test("v2 makes the helper-private CLOEXEC transition exact and read back", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy;

  assert.deepEqual(plainJson(policy.descriptorTransition), {
    phase: "immediately-before-cargo-execveat",
    apply: {
      operation: "fcntl-f-setfd",
      setFdCloexec: [6, 7, 8],
      clearFdCloexec: [],
      retainedWithoutFdCloexec: [0, 1, 2, 3, 4, 5],
    },
    reread: {
      operation: "fcntl-f-getfd",
      exactDescriptors: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      expectedFdCloexecFalse: [0, 1, 2, 3, 4, 5],
      expectedFdCloexecTrue: [6, 7, 8],
      mismatchDisposition: "error-frame-or-eof-fail-closed",
    },
    exactTerminalOrder: [
      "close-range-from-9",
      "validate-descriptor-map-kind-access-alias-and-identity",
      "apply-fd-cloexec-to-6-7-8",
      "reread-fd-cloexec-on-0-8",
      "write-ready-frame-on-7",
      "execveat-6-empty-path-at-empty-path",
    ],
  });
  assert.equal(
    policy.fileDescriptors.childFileDescriptors
      .filter(({ childFd }) => childFd >= 6)
      .every(
        ({ cloexecImmediatelyBeforeCargoExecveat }) =>
          cloexecImmediatelyBeforeCargoExecveat,
      ),
    true,
  );
  assert.equal(
    policy.fileDescriptors.childFileDescriptors
      .filter(({ childFd }) => childFd <= 5)
      .every(
        ({ cloexecImmediatelyBeforeCargoExecveat }) =>
          !cloexecImmediatelyBeforeCargoExecveat,
      ),
    true,
  );
});

test("v2 requires an attested helper and READY to EOF Cargo transition", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy;

  assert.deepEqual(plainJson(policy.helper.initialLaunch), {
    mechanism: "separately-attested-held-helper-descriptor/v1",
    heldHelperDescriptor: 8,
    procFdExecvePermitted: true,
    ordinaryPathnameExecveForbidden: true,
    launchedImageMustMatchHeldDescriptor: true,
    parentAndHelperEntryIdentityAgreementRequired: true,
    physicalEvidenceRequiredBeforeAnyLaunchClaim: true,
    mayNotProveCargoTransition: true,
  });
  assert.equal(
    policy.helper.attestation.schema,
    "oxigraph.g1.7-cargo-execveat-helper-attestation/v1",
  );
  assert.equal(
    policy.helper.attestation.compiler.path,
    "/usr/bin/x86_64-linux-gnu-gcc-13",
  );
  assert.equal(policy.helper.attestation.compiler.major, "13");
  assert.deepEqual(plainJson(policy.helper.attestation.bindingRequirements), {
    fileDescriptorMapSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
    statusProtocolSchema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    statusProtocolRequirementsSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
    exactRequestBindingRequired: true,
    exactHelperSourceBindingRequired: true,
    exactHelperExecutableBindingRequired: true,
  });
  assert.deepEqual(plainJson(policy.helper.attestation.compileArgv), [
    "/usr/bin/x86_64-linux-gnu-gcc-13",
    "-std=c17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fstack-protector-strong",
    "-D_FORTIFY_SOURCE=2",
    "-Wl,-z,relro,-z,now",
    "cargo-execveat-helper.c",
    "-o",
    "g17-cargo-execveat-helper",
  ]);
  assert.equal(policy.helper.attestation.executableRequirements.descriptor, 8);
  assert.equal(
    Object.values(policy.helper.attestation.executableRequirements)
      .filter((value) => typeof value === "boolean")
      .every((requirement) => requirement),
    true,
  );

  assert.deepEqual(
    policy.statusProtocol,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
  );
  assert.equal(
    policy.statusProtocol.schema,
    G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  );
  assert.equal(policy.statusProtocol.writerFd, 7);
  assert.deepEqual(plainJson(policy.statusProtocol.readyFrame), {
    schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    type: "READY",
    stage: "execveat",
    errno: null,
    reservedExitCode: null,
  });
  assert.deepEqual(
    plainJson(policy.statusProtocol.errorFrames.preReadyStages),
    G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  );
  assert.deepEqual(
    plainJson(policy.statusProtocol.errorFrames.reservedExitCodes),
    plainJson(G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS),
  );
  assert.equal(policy.statusProtocol.errorFrames.errnoMinimum, 1);
  assert.equal(
    policy.statusProtocol.errorFrames.errnoMaximum,
    G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
  );
  assert.equal(
    policy.statusProtocol.errorFrames.processExitMustMatchReservedExitCode,
    true,
  );
  assert.deepEqual(plainJson(policy.statusProtocol.acceptedSequences), [
    "READY->EOF",
    "ERROR->EOF",
    "READY->ERROR(execveat)->EOF",
  ]);
  assert.equal(
    policy.statusProtocol.maximumBytes,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_MAX_BYTES,
  );
  assert.equal(
    policy.statusProtocol.maximumFrames,
    G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
  );
  assert.equal(
    policy.statusProtocol.timeoutMilliseconds,
    G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
  );
  assert.equal(policy.statusProtocol.writerFdCloexecCreatesSuccessEof, true);
  assert.equal(policy.statusProtocol.replayDoesNotProveExecveatSuccess, true);
  assert.equal(
    policy.statusProtocol.requirementsSha256,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  );
  assert.deepEqual(
    Object.keys(policy.helper.statusErrorStageMapping).filter(
      (key) => key !== "unmappedFailureForbidden",
    ),
    [
      "preflight",
      "cargo-fd",
      "status-fd",
      "status-cloexec",
      "ready-write",
      "execveat",
    ],
  );
  assert.equal(
    policy.helper.statusErrorStageMapping.unmappedFailureForbidden,
    true,
  );

  assert.deepEqual(plainJson(policy.cargoTransition), {
    mechanism: "execveat-held-fd-empty-path/v1",
    syscall: "syscall(SYS_execveat)",
    executableFd: 6,
    pathArgument: "",
    flags: ["AT_EMPTY_PATH"],
    argv0Required: true,
    exactArgvRequestBindingRequired: true,
    exactEnvironmentRequestBindingRequired: true,
    pathnameLaunchForbidden: true,
    procFdPathnameFallbackForbidden: true,
    execveFallbackForbidden: true,
    fexecveFallbackForbidden: true,
    syscallFailureRequiresErrorFrameAndNonzeroExit: true,
    successfulTransitionRequiresReadyThenEof: true,
  });
});

test("v2 retains the exact byte, argv, timeout, TERM, and reap ceilings", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy;

  assert.equal(G17_NON_TMPFS_BUILD_ISOLATION_V2_TIMEOUT_MS, 300_000);
  assert.equal(
    G17_NON_TMPFS_BUILD_ISOLATION_V2_TIMEOUT_MS,
    G17_BENCHMARK_EXECUTION_REQUEST_TIMEOUT_MS,
  );
  assert.equal(G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGV_MAX_BYTES, 1024 * 1024);
  assert.equal(G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGC_MAX, 4_096);
  assert.equal(
    G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGV_MAX_BYTES,
    G17_BENCHMARK_EXECUTION_REQUEST_ARGV_MAX_BYTES,
  );
  assert.equal(G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_MAX_BYTES, 4_096);
  assert.deepEqual(
    policy.supervision.limits,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS,
  );
  assert.deepEqual(plainJson(policy.supervision.limits), {
    timeoutMilliseconds: 300_000,
    combinedOutputMaximumBytes: 64 * 1024 * 1024,
    argcMaximum: 4_096,
    aggregateArgvUtf8MaximumBytes: 1024 * 1024,
    statusProtocolMaximumBytes: 4_096,
    statusProtocolMaximumFrames: 2,
    statusProtocolTimeoutMilliseconds: 2_000,
    termGraceMilliseconds: 250,
    closeReapTimeoutMilliseconds: 2_000,
  });
  assert.equal(
    policy.supervision.limits.combinedOutputMaximumBytes,
    G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  );
  assert.equal(
    policy.supervision.limits.termGraceMilliseconds,
    G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
  );
  assert.equal(
    policy.supervision.limits.closeReapTimeoutMilliseconds,
    G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  );
  assert.equal(policy.supervision.sharedOutputCeilingRequired, true);
  assert.equal(policy.supervision.truncationMayNotSatisfySuccess, true);
});

test("v2 requires PID-free clone3 cgroup placement and pidfd reap", () => {
  const containment =
    createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy.containment;

  assert.equal(
    containment.requiredSuccessorSchema,
    "oxigraph.g1.7-non-tmpfs-containment-evidence/v2",
  );
  assert.deepEqual(plainJson(containment.cgroupPathDerivation), {
    mechanism: "pid-free-request-and-generation-derived/v1",
    boundComponents: [
      "controlRunId",
      "buildId",
      "ownerGeneration",
      "processGeneration",
      "targetGeneration",
    ],
    processIdComponentForbidden: true,
    pathKnownBeforeSpawnRequired: true,
  });
  assert.deepEqual(plainJson(containment.initialPlacement), {
    syscall: "clone3",
    flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
    heldCgroupDescriptorRole: "cgroupDirectory",
    returnedPidfdRole: "directChildPidfd",
    workerPlacedBeforeUserCodeRunnableRequired: true,
    postSpawnCgroupProcsWriteForbidden: true,
    forkThenMoveFallbackForbidden: true,
    cloneWithoutIntoCgroupFallbackForbidden: true,
    failureDisposition: "fail-before-helper-image",
  });
  assert.deepEqual(plainJson(containment.directChildReap), {
    syscall: "waitid",
    idType: "P_PIDFD",
    pidfdRole: "directChildPidfd",
    exactTerminalStatusRequired: true,
    callerSuppliedReapProofForbidden: true,
  });
  assert.equal(containment.parentOnlyCgroupDescriptorRequired, true);
  assert.equal(containment.parentOnlyPidfdRequired, true);
  assert.equal(containment.nativeAdapterRequired, true);
});

test("v2 is exhaustively authority-free and makes no physical observation", () => {
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy;
  const authorityKeys = [
    "buildExecutionAuthority",
    "controlExecutionAuthority",
    "launchExecutionAuthority",
    "promotionAuthority",
    "providerExecutionAuthority",
    "publicationAuthority",
    "qualificationExecutionAuthority",
    "receiptAuthority",
    "routerQualityAuthority",
  ];
  const nonclaimKeys = [
    "cargoExecutionObserved",
    "cargoExecveatObserved",
    "cgroupPlacementObserved",
    "cgroupQuiescenceObserved",
    "clone3CgroupPlacementObserved",
    "containmentApplied",
    "containmentSuccessorImplemented",
    "crashDurability",
    "directChildPidfdWaitidAttested",
    "directChildReaped",
    "filesystemFlushDurability",
    "finalBindingMinted",
    "helperAttestationObserved",
    "helperCloexecTransitionObserved",
    "helperCompilationObserved",
    "helperDescriptorMapObserved",
    "helperInitialLaunchObserved",
    "helperSourceImplemented",
    "helperStatusProtocolObserved",
    "hostileSameUidResistance",
    "maliciousHostOrKernelResistance",
    "nativeContainmentAdapterImplemented",
    "physicalLaunchOccurred",
    "physicalOwnerIssued",
    "pidfdCreatedObserved",
    "policyApplicationObserved",
    "powerLossDurability",
    "privatePhysicalIssuerImplemented",
    "rustcExecutionObserved",
    "waitidPidfdObserved",
  ];

  assert.deepEqual(Object.keys(policy.authority).sort(), authorityKeys);
  assert.deepEqual(Object.keys(policy.nonclaims).sort(), nonclaimKeys);
  assert.deepEqual(
    policy.authority,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_AUTHORITY,
  );
  assert.deepEqual(
    policy.nonclaims,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_NONCLAIMS,
  );
  assert.equal(
    Object.values(policy.authority).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(policy.nonclaims).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(policy.implementation).every((value) => value === false),
    true,
  );
  assert.equal(policy.finalDecisionEligible, false);
  assert.equal(policy.binding, null);

  for (const key of authorityKeys) {
    assert.throws(
      () =>
        verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
          mutatedBytes((value) => {
            value.authority[key] = true;
          }),
        ),
      CONTRACT_ERROR,
      `authority ${key}`,
    );
  }
  for (const key of nonclaimKeys) {
    assert.throws(
      () =>
        verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
          mutatedBytes((value) => {
            value.nonclaims[key] = true;
          }),
        ),
      CONTRACT_ERROR,
      `nonclaim ${key}`,
    );
  }
});

test("v2 rejects resealed drift in every successor boundary", () => {
  const mutations = [
    [
      "schema",
      (value) => {
        value.schema = `${value.schema}-drift`;
      },
    ],
    [
      "status",
      (value) => {
        value.status = "IMPLEMENTED";
      },
    ],
    [
      "environment",
      (value) => {
        value.environment.tmpfsState = true;
      },
    ],
    [
      "source mount",
      (value) => {
        value.workspace.namespace.mounts[0].heldFd = 5;
      },
    ],
    [
      "target mount",
      (value) => {
        value.workspace.namespace.mounts[1].readOnly = true;
      },
    ],
    [
      "fd range",
      (value) => {
        value.fileDescriptors.exactChildDescriptorRange.last = 9;
      },
    ],
    [
      "close range",
      (value) => {
        value.fileDescriptors.exactChildDescriptorRange.closeRange.first = 10;
      },
    ],
    [
      "fd number",
      (value) => {
        value.fileDescriptors.childFileDescriptors[6].childFd = 9;
      },
    ],
    [
      "fd role",
      (value) => {
        value.fileDescriptors.childFileDescriptors[7].role = "other";
      },
    ],
    [
      "fd kind",
      (value) => {
        value.fileDescriptors.childFileDescriptors[8].kind = "directory";
      },
    ],
    [
      "fd access",
      (value) => {
        value.fileDescriptors.childFileDescriptors[6].descriptorAccess =
          "read-write";
      },
    ],
    [
      "helper map",
      (value) => {
        value.fileDescriptors.imageMaps.helperImageFileDescriptors.pop();
      },
    ],
    [
      "Cargo map",
      (value) => {
        value.fileDescriptors.imageMaps.cargoImageInheritedFileDescriptors.push(
          6,
        );
      },
    ],
    [
      "private map",
      (value) => {
        value.fileDescriptors.imageMaps.launcherPrivateFileDescriptors.reverse();
      },
    ],
    [
      "parent-only fixed fd",
      (value) => {
        value.fileDescriptors.parentOnlyFileDescriptors[0].fixedFd = 9;
      },
    ],
    [
      "alias",
      (value) => {
        value.fileDescriptors.aliasing.childOpenFileDescriptionsPairwiseDistinctRequired = false;
      },
    ],
    [
      "helper language",
      (value) => {
        value.helper.implementation = "javascript";
      },
    ],
    [
      "helper compiler",
      (value) => {
        value.helper.attestation.compiler.major = "14";
      },
    ],
    [
      "helper recipe",
      (value) => {
        value.helper.attestation.compileArgv[2] = "-O0";
      },
    ],
    [
      "helper descriptor",
      (value) => {
        value.helper.initialLaunch.heldHelperDescriptor = 6;
      },
    ],
    [
      "helper attestation",
      (value) => {
        value.helper.initialLaunch.physicalEvidenceRequiredBeforeAnyLaunchClaim = false;
      },
    ],
    [
      "helper status stage",
      (value) => {
        value.helper.statusErrorStageMapping.execveat = [];
      },
    ],
    [
      "CLOEXEC apply",
      (value) => {
        value.descriptorTransition.apply.setFdCloexec = [6, 7];
      },
    ],
    [
      "CLOEXEC readback",
      (value) => {
        value.descriptorTransition.reread.expectedFdCloexecTrue = [6, 8];
      },
    ],
    [
      "terminal order",
      (value) => {
        value.descriptorTransition.exactTerminalOrder.reverse();
      },
    ],
    [
      "status writer",
      (value) => {
        value.statusProtocol.writerFd = 6;
      },
    ],
    [
      "status ready",
      (value) => {
        value.statusProtocol.readyFrame.type = "ready";
      },
    ],
    [
      "status success",
      (value) => {
        value.statusProtocol.acceptedSequences.push("READY->EXIT");
      },
    ],
    [
      "status ceiling",
      (value) => {
        value.statusProtocol.maximumBytes += 1;
      },
    ],
    [
      "status hash",
      (value) => {
        value.statusProtocol.requirementsSha256 = "0".repeat(64);
      },
    ],
    [
      "Cargo fd",
      (value) => {
        value.cargoTransition.executableFd = 8;
      },
    ],
    [
      "Cargo path",
      (value) => {
        value.cargoTransition.pathArgument = "/proc/self/fd/6";
      },
    ],
    [
      "Cargo fallback",
      (value) => {
        value.cargoTransition.procFdPathnameFallbackForbidden = false;
      },
    ],
    [
      "output ceiling",
      (value) => {
        value.supervision.limits.combinedOutputMaximumBytes -= 1;
      },
    ],
    [
      "argv ceiling",
      (value) => {
        value.supervision.limits.aggregateArgvUtf8MaximumBytes -= 1;
      },
    ],
    [
      "timeout",
      (value) => {
        value.supervision.limits.timeoutMilliseconds += 1;
      },
    ],
    [
      "TERM grace",
      (value) => {
        value.supervision.termination.graceMilliseconds += 1;
      },
    ],
    [
      "reap",
      (value) => {
        value.supervision.closeAndReap.directChildWaitidReapRequired = false;
      },
    ],
    [
      "containment",
      (value) => {
        value.containment.initialPlacement.workerPlacedBeforeUserCodeRunnableRequired = false;
      },
    ],
    [
      "implementation",
      (value) => {
        value.implementation.nativeHelperImplemented = true;
      },
    ],
    [
      "decision",
      (value) => {
        value.finalDecisionEligible = true;
      },
    ],
    [
      "binding",
      (value) => {
        value.binding = {};
      },
    ],
    [
      "extra field",
      (value) => {
        value.unreviewed = true;
      },
    ],
  ];

  for (const [label, mutate] of mutations) {
    assert.throws(
      () =>
        verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(mutatedBytes(mutate)),
      CONTRACT_ERROR,
      label,
    );
  }
});

test("v2 verifier rejects ambiguous, noncanonical, and hostile byte inputs", () => {
  const created = createG17NonTmpfsBuildIsolationV2PolicyArtifact();
  const bytes = created.artifact.bytes;

  assert.throws(
    () => verifyG17NonTmpfsBuildIsolationV2PolicyArtifact("not bytes"),
    CONTRACT_ERROR,
  );
  assert.throws(
    () => verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(Buffer.alloc(0)),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
        Buffer.alloc(G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES + 1),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () => verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(new Proxy(bytes, {})),
    CONTRACT_ERROR,
  );

  const foreignPrototype = Buffer.from(bytes);
  Object.setPrototypeOf(foreignPrototype, Object.create(Buffer.prototype));
  assert.throws(
    () => verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(foreignPrototype),
    CONTRACT_ERROR,
  );

  const ownLength = Buffer.from(bytes);
  Object.defineProperty(ownLength, "length", {
    configurable: true,
    get() {
      throw new Error("must not run");
    },
  });
  assert.throws(
    () => verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(ownLength),
    CONTRACT_ERROR,
  );

  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(bytes.subarray(0, -1)),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
        Buffer.concat([bytes, Buffer.from("\n", "utf8")]),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
        Buffer.from(` ${bytes.toString("utf8")}`, "utf8"),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
        Buffer.from([0xff, 0x0a]),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
        Buffer.from(
          '{"schema":"oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2","schema":"oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2"}\n',
          "utf8",
        ),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(
        mutatedBytes((value) => {
          value.status = "PHYSICAL";
        }),
      ),
    CONTRACT_ERROR,
  );
});
