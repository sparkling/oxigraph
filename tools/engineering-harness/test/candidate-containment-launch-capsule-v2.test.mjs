import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_PROJECTION_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2,
  createCandidateContainmentLaunchArgvV2,
  createCandidateContainmentLaunchCapsuleV2,
  createCandidateContainmentLaunchEnvironmentV2,
  verifyCandidateContainmentLaunchArgvV2,
  verifyCandidateContainmentLaunchCapsuleV2,
  verifyCandidateContainmentLaunchEnvironmentV2,
  verifyCandidateContainmentLaunchPreallocationInventoryV2,
} from "../src/candidate/containment-launch-capsule-v2.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /candidate containment launch capsule/u;
const requestSha256 = "1".repeat(64);
const generationSha256 = "2".repeat(64);
const resultMaximumBytes = 256 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function argvArtifact() {
  return createCandidateContainmentLaunchArgvV2({
    argv: [
      "/usr/bin/bwrap",
      "--clearenv",
      "--ro-bind-fd",
      "3",
      "/runner/candidate/sandbox-session-worker-v2.mjs",
    ],
  });
}

function environmentArtifact() {
  return createCandidateContainmentLaunchEnvironmentV2({
    environment: {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
    },
  });
}

function bytesForRole(role, argv, environment) {
  if (role === "launchArgv") return argv.bytes;
  if (role === "launchEnvironment") return environment.bytes;
  if (role === "childResult") return Buffer.alloc(0);
  if (role === "childExecutable") {
    return Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x01, 0x01, 0x00]);
  }
  return Buffer.from(`exact-${role}-bytes\n`, "utf8");
}

function identity(index, bytes, permissions) {
  return {
    device: "2049",
    inode: String(10_000 + index),
    links: "1",
    type: "regular",
    permissions,
    owner: "1000",
    group: "1000",
    size: String(bytes.length),
    modifiedNs: String(1_700_000_000_000_000_000n + BigInt(index)),
    changedNs: String(1_700_000_000_100_000_000n + BigInt(index)),
  };
}

function capsuleInput() {
  const argv = argvArtifact();
  const environment = environmentArtifact();
  const files = CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2.map(
    (spec, index) => {
      const bytes = bytesForRole(spec.role, argv, environment);
      return {
        role: spec.role,
        supervisorFd: spec.supervisorFd,
        childFd: spec.childFd,
        destination: spec.destination,
        accessMode: spec.accessMode,
        permissions: spec.permissions,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        initialOffset: 0,
        closeOnExec: true,
        contentBytes: bytes,
        identity: identity(index, bytes, spec.permissions),
      };
    },
  );
  return {
    requestSha256,
    generationSha256,
    argvBytes: argv.bytes,
    environmentBytes: environment.bytes,
    files,
    resultMaximumBytes,
  };
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

test("launch argv and environment documents are canonical, copy-on-read, and independently replayed", () => {
  const argv = argvArtifact();
  const expectedArgv = Buffer.from(
    `${canonicalJson({
      schema: CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2,
      argv: [
        "/usr/bin/bwrap",
        "--clearenv",
        "--ro-bind-fd",
        "3",
        "/runner/candidate/sandbox-session-worker-v2.mjs",
      ],
    })}\n`,
    "utf8",
  );
  assert.deepEqual(argv.bytes, expectedArgv);
  assert.equal(argv.artifact.sha256, sha256(expectedArgv));
  const argvCopy = argv.bytes;
  argvCopy.fill(0);
  assert.deepEqual(argv.bytes, expectedArgv);
  const argvProjection = verifyCandidateContainmentLaunchArgvV2(argv.bytes);
  assert.equal(argvProjection.count, 5);
  assert.deepEqual(argvProjection.argv, JSON.parse(expectedArgv).argv);
  assert.equal(argvProjection.rawSha256, sha256(expectedArgv));

  const environment = environmentArtifact();
  const parsedEnvironment = JSON.parse(environment.bytes);
  assert.equal(
    parsedEnvironment.schema,
    CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2,
  );
  assert.deepEqual(parsedEnvironment.entries, [
    { name: "LANG", value: "C.UTF-8" },
    { name: "LC_ALL", value: "C.UTF-8" },
    { name: "PATH", value: "/usr/bin:/bin" },
  ]);
  const environmentProjection = verifyCandidateContainmentLaunchEnvironmentV2(
    environment.bytes,
  );
  assert.equal(environmentProjection.count, 3);
  assert.equal(environmentProjection.rawSha256, sha256(environment.bytes));
  assertDeepFrozen(argvProjection);
  assertDeepFrozen(environmentProjection);
  assertNullPrototypeRecords(argvProjection);
  assertNullPrototypeRecords(environmentProjection);
});

test("interactive FD map and collision-safe child remap are exact additive successors", () => {
  assert.deepEqual(
    { ...CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2 },
    {
      commandRead: 0,
      statusWrite: 1,
      diagnosticsWrite: 2,
      sessionCgroup: 3,
      childExecutable: 4,
      childStdin: 5,
      supervisorSelf: 6,
      payloadSandboxWorker: 7,
      payloadProcess: 8,
      payloadBuildCommand: 9,
      payloadEvidenceLimits: 10,
      payloadSessionLimits: 11,
      payloadTaskFailures: 12,
      payloadRoutingFeatures: 13,
      payloadSeccompLauncher: 14,
      launchArgv: 15,
      launchEnvironment: 16,
      childResult: 17,
    },
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
    canonicalSha256(CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2),
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
    canonicalSha256(CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2),
  );
  assert.deepEqual(
    { ...CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.executable },
    {
      sourceFd: 4,
      scratchMinimumFd: 18,
      scratchExactFd: 18,
      duplicateOperation: "F_DUPFD_CLOEXEC",
      duplicatePhase: "before-private-output-pipes",
      executeOperation: "execveat-AT_EMPTY_PATH",
    },
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.mappings.map(
      ({ role, sourceFd, targetFd }) => ({ role, sourceFd, targetFd }),
    ),
    [
      { role: "childStdin", sourceFd: 5, targetFd: 0 },
      { role: "payloadSandboxWorker", sourceFd: 7, targetFd: 3 },
      { role: "payloadProcess", sourceFd: 8, targetFd: 4 },
      { role: "payloadBuildCommand", sourceFd: 9, targetFd: 5 },
      { role: "payloadEvidenceLimits", sourceFd: 10, targetFd: 6 },
      { role: "payloadSessionLimits", sourceFd: 11, targetFd: 7 },
      { role: "payloadTaskFailures", sourceFd: 12, targetFd: 8 },
      { role: "payloadRoutingFeatures", sourceFd: 13, targetFd: 9 },
      { role: "payloadSeccompLauncher", sourceFd: 14, targetFd: 10 },
      { role: "childResult", sourceFd: 17, targetFd: 11 },
      { role: "childStdout", sourceFd: 20, targetFd: 1 },
      { role: "childStderr", sourceFd: 22, targetFd: 2 },
    ],
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.privateOutputPipes.map(
      ({ role, operation, readFd, writeFd }) => ({
        role,
        operation,
        readFd,
        writeFd,
      }),
    ),
    [
      {
        role: "childStdout",
        operation: "pipe2-O_CLOEXEC",
        readFd: 19,
        writeFd: 20,
      },
      {
        role: "childStderr",
        operation: "pipe2-O_CLOEXEC",
        readFd: 21,
        writeFd: 22,
      },
    ],
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.dynamicAllocationOrder,
    [
      "executableScratch:18",
      "childStdout:19,20",
      "childStderr:21,22",
      "clone3ChildPidfdInParent:23",
    ],
  );
  assert.deepEqual(
    { ...CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentPidfd },
    {
      fd: 23,
      allocation: "clone3-CLONE_PIDFD",
      childInherited: false,
      retainedUntil: "waitid-P_PIDFD-reaped",
    },
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentPidfdClosesAfterDirectChildReap,
    [23],
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentOutputCloseOnDirectChildReap,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentOutputPerStreamCaptureMaximumBytes,
    CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentOutputAggregateCaptureMaximumBytes,
    CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentOutputOverflowAction,
    "cancel-whole-cgroup-continue-hash-and-drain-to-eof",
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.parentOutputEvidenceRequired,
    ["observedBytes", "sha256", "eof", "truncated"],
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.childClosesBeforeExec,
    [12, 13, 14, 15, 16, 17, 19, 20, 21, 22],
  );
  assert.deepEqual(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.childDescriptorsAfterExec,
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.rejectOpenDescriptorAtOrAbove,
    18,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.rejectShiftedDynamicAllocation,
    true,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2[0].permissions,
    "0500",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2.childExecutableMagicPrefix,
    "7f454c46",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2.childExecutableKernelEligibilityRequiredFromNativeAdapter,
    true,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2.supervisorSelfPurpose,
    "retained-byte-copy-only",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2.supervisorSelfBindsExecutedSupervisor,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2.manifestProvesKernelExecutableEligibility,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2.manifestProvesExecutedSupervisorIdentity,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2.manifestProvesOutputCapture,
    false,
  );
  const inventory = verifyCandidateContainmentLaunchPreallocationInventoryV2({
    openDescriptors: Array.from({ length: 18 }, (_, index) => index),
  });
  assert.equal(inventory.reportedExactInventory, true);
  assert.equal(inventory.physicalEligibility, false);
  assert.throws(
    () =>
      verifyCandidateContainmentLaunchPreallocationInventoryV2({
        openDescriptors: Array.from({ length: 19 }, (_, index) => index),
      }),
    CONTRACT_ERROR,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.executableDuplicatedBeforeMappings,
    true,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.controlDescriptorsInherited,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.unmappedDescriptorsClosedBeforeExec,
    true,
  );
});

test("launch capsule binds every exact retained file, argv, environment, result, identity, and remap requirement", () => {
  const input = capsuleInput();
  const created = createCandidateContainmentLaunchCapsuleV2(input);
  const projection = verifyCandidateContainmentLaunchCapsuleV2(created.bytes);

  assert.equal(
    projection.schema,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_PROJECTION_SCHEMA_V2,
  );
  assert.equal(
    projection.protocolSchema,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
  );
  assert.equal(projection.requestSha256, requestSha256);
  assert.equal(projection.generationSha256, generationSha256);
  assert.equal(projection.files.length, 14);
  assert.equal(projection.files[0].role, "childExecutable");
  assert.equal(projection.files.at(-1).role, "childResult");
  assert.equal(projection.files.at(-1).byteLength, 0);
  assert.equal(projection.files.at(-1).sha256, sha256(Buffer.alloc(0)));
  assert.equal(projection.resultMaximumBytes, resultMaximumBytes);
  assert.equal(
    projection.fileDescriptorMapSha256,
    CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
  );
  assert.equal(
    projection.remapPlanSha256,
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
  );
  assert.equal(projection.argv.rawSha256, sha256(input.argvBytes));
  assert.equal(
    projection.environment.rawSha256,
    sha256(input.environmentBytes),
  );
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assert.equal(projection.runtimeClosureEligibility, false);
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V2).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    projection.projectionSha256,
    canonicalSha256(
      Object.fromEntries(
        Object.entries(projection).filter(
          ([key]) => key !== "projectionSha256",
        ),
      ),
    ),
  );
  assert.equal(
    created.bytes.length <= CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    true,
  );
  const callerCopy = created.bytes;
  callerCopy.fill(0);
  assert.equal(created.artifact.sha256, sha256(created.bytes));
  assertDeepFrozen(projection);
  assertNullPrototypeRecords(projection);
});

test("launch argv and environment reject ambiguous text, shapes, order, duplicates, and noncanonical bytes", () => {
  for (const value of [
    null,
    [],
    { argv: [] },
    { argv: [""] },
    { argv: ["cargo\0test"] },
    { argv: ["unpaired-\ud800"] },
    { argv: ["cargo"], authority: true },
    { argv: new Proxy(["cargo"], {}) },
    new Proxy({ argv: ["cargo"] }, {}),
  ]) {
    assert.throws(
      () => createCandidateContainmentLaunchArgvV2(value),
      CONTRACT_ERROR,
    );
  }
  for (const value of [
    null,
    [],
    { environment: { "BAD=NAME": "value" } },
    { environment: { "1BAD": "value" } },
    { environment: { GOOD: "nul\0value" } },
    { environment: { GOOD: "unpaired-\udfff" } },
    { environment: { GOOD: 1 } },
    { environment: { GOOD: "value" }, authority: true },
    { environment: new Proxy({ GOOD: "value" }, {}) },
  ]) {
    assert.throws(
      () => createCandidateContainmentLaunchEnvironmentV2(value),
      CONTRACT_ERROR,
    );
  }

  const argv = argvArtifact().bytes;
  const environment = environmentArtifact().bytes;
  const rejected = [
    Buffer.alloc(0),
    argv.subarray(0, argv.length - 1),
    Buffer.from(argv.toString("utf8").replace("\n", "\r\n"), "utf8"),
    Buffer.concat([argv, Buffer.from("\0")]),
    Buffer.concat([argv, argv]),
    Buffer.from(
      `${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(argv)).reverse()))}\n`,
      "utf8",
    ),
  ];
  for (const bytes of rejected) {
    assert.throws(
      () => verifyCandidateContainmentLaunchArgvV2(bytes),
      CONTRACT_ERROR,
    );
  }
  const sharedBacking = new SharedArrayBuffer(argv.length);
  const sharedBytes = Buffer.from(sharedBacking);
  argv.copy(sharedBytes);
  Object.setPrototypeOf(sharedBacking, null);
  assert.throws(
    () => verifyCandidateContainmentLaunchArgvV2(sharedBytes),
    CONTRACT_ERROR,
  );
  const environmentBody = JSON.parse(environment);
  environmentBody.entries.reverse();
  assert.throws(
    () =>
      verifyCandidateContainmentLaunchEnvironmentV2(
        Buffer.from(`${canonicalJson(environmentBody)}\n`, "utf8"),
      ),
    CONTRACT_ERROR,
  );
});

test("launch capsule rejects missing, extra, reordered, aliased, drifted, and forged descriptors", () => {
  const mutations = [
    (value) => value.files.pop(),
    (value) => value.files.push(structuredClone(value.files[0])),
    (value) => value.files.reverse(),
    (value) => {
      value.files[1].supervisorFd = value.files[0].supervisorFd;
    },
    (value) => {
      value.files[1].identity.inode = value.files[0].identity.inode;
    },
    (value) => {
      value.files[0].sha256 = "f".repeat(64);
    },
    (value) => {
      const bytes = Buffer.from("not-an-elf\n", "utf8");
      value.files[0].byteLength = bytes.length;
      value.files[0].sha256 = sha256(bytes);
      value.files[0].contentBytes = bytes;
      value.files[0].identity.size = String(bytes.length);
    },
    (value) => {
      value.files[0].identity.size = String(value.files[0].byteLength + 1);
    },
    (value) => {
      value.files[0].permissions = "0600";
    },
    (value) => {
      value.files[0].closeOnExec = false;
    },
    (value) => {
      value.files[0].initialOffset = 1;
    },
    (value) => {
      value.files.at(-1).byteLength = 1;
    },
    (value) => {
      value.argvBytes = Buffer.from("{}\n", "utf8");
    },
    (value) => {
      value.environmentBytes = Buffer.from("{}\n", "utf8");
    },
    (value) => {
      value.resultMaximumBytes = resultMaximumBytes + 1;
    },
  ];
  for (const mutate of mutations) {
    const value = capsuleInput();
    mutate(value);
    assert.throws(
      () => createCandidateContainmentLaunchCapsuleV2(value),
      CONTRACT_ERROR,
    );
  }

  const created = createCandidateContainmentLaunchCapsuleV2(capsuleInput());
  const parsed = JSON.parse(created.bytes);
  parsed.files.find(({ role }) => role === "launchArgv").sha256 = "f".repeat(
    64,
  );
  const tampered = Buffer.from(`${canonicalJson(parsed)}\n`, "utf8");
  assert.throws(
    () => verifyCandidateContainmentLaunchCapsuleV2(tampered),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      createCandidateContainmentLaunchCapsuleV2({
        ...capsuleInput(),
        authority: true,
      }),
    CONTRACT_ERROR,
  );
});
