import { types as utilTypes } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  boundedInteger,
  canonicalJsonLine,
  copyBoundedBuffer,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactBoolean,
  exactDecimal,
  exactDenseArray,
  exactDigest,
  exactRecord,
  exactUnicodeString,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";

// This module freezes an additive launch contract only. It opens no file,
// inspects no descriptor, starts no process, and cannot mint containment or
// sandbox authority.

export const CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-argv/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_ARGV_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-argv-replay/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-environment/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-environment-replay/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-capsule/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-capsule-replay/v1";
export const CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-fd-map/v2";
export const CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SCHEMA_V2 =
  "oxigraph.candidate-containment-child-remap-plan/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_PREALLOCATION_INVENTORY_SCHEMA_V2 =
  "oxigraph.candidate-containment-preallocation-inventory-replay/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SCHEMA_V2 =
  "oxigraph.candidate-containment-launch-requirements/v1";
export const CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2 = 1024 * 1024;
export const CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_ITEMS_V2 = 4_096;
export const CANDIDATE_CONTAINMENT_LAUNCH_ITEM_MAX_BYTES_V2 = 4_096;
export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2 = 64 * 1024;
export const CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2 =
  16 * 1024 * 1024;
export const CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_AGGREGATE_BYTES_V2 =
  64 * 1024 * 1024;
export const CANDIDATE_CONTAINMENT_LAUNCH_RESULT_MAX_BYTES_V2 =
  256 * 1024 * 1024;
export const CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2 =
  64 * 1024 * 1024;

const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/u;
const payloadRoles = new Set([
  "payloadSandboxWorker",
  "payloadProcess",
  "payloadBuildCommand",
  "payloadEvidenceLimits",
  "payloadSessionLimits",
  "payloadTaskFailures",
  "payloadRoutingFeatures",
  "payloadSeccompLauncher",
]);
const requiredOpenDescriptorsBeforeDynamicAllocation = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
]);

function fail(message) {
  throw new Error(`candidate containment launch capsule: ${message}`);
}

export const CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2 = deepFreeze(
  nullRecord([
    ["commandRead", 0],
    ["statusWrite", 1],
    ["diagnosticsWrite", 2],
    ["sessionCgroup", 3],
    ["childExecutable", 4],
    ["childStdin", 5],
    ["supervisorSelf", 6],
    ["payloadSandboxWorker", 7],
    ["payloadProcess", 8],
    ["payloadBuildCommand", 9],
    ["payloadEvidenceLimits", 10],
    ["payloadSessionLimits", 11],
    ["payloadTaskFailures", 12],
    ["payloadRoutingFeatures", 13],
    ["payloadSeccompLauncher", 14],
    ["launchArgv", 15],
    ["launchEnvironment", 16],
    ["childResult", 17],
  ]),
);

export const CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2);

const remapMappings = deepFreeze([
  nullRecord([
    ["role", "childStdin"],
    ["sourceFd", 5],
    ["targetFd", 0],
    ["operation", "dup3-clear-cloexec"],
  ]),
  ...[
    ["payloadSandboxWorker", 7, 3],
    ["payloadProcess", 8, 4],
    ["payloadBuildCommand", 9, 5],
    ["payloadEvidenceLimits", 10, 6],
    ["payloadSessionLimits", 11, 7],
    ["payloadTaskFailures", 12, 8],
    ["payloadRoutingFeatures", 13, 9],
    ["payloadSeccompLauncher", 14, 10],
    ["childResult", 17, 11],
  ].map(([role, sourceFd, targetFd]) =>
    nullRecord([
      ["role", role],
      ["sourceFd", sourceFd],
      ["targetFd", targetFd],
      ["operation", "dup3-clear-cloexec"],
    ]),
  ),
  nullRecord([
    ["role", "childStdout"],
    ["sourceFd", 20],
    ["targetFd", 1],
    ["operation", "dup3-clear-cloexec"],
  ]),
  nullRecord([
    ["role", "childStderr"],
    ["sourceFd", 22],
    ["targetFd", 2],
    ["operation", "dup3-clear-cloexec"],
  ]),
]);

const privateOutputPipes = deepFreeze([
  nullRecord([
    ["role", "childStdout"],
    ["operation", "pipe2-O_CLOEXEC"],
    ["readFd", 19],
    ["writeFd", 20],
    ["supervisorRetains", "read-end-only"],
    ["childRetainsAfterExec", "target-fd-1-only"],
  ]),
  nullRecord([
    ["role", "childStderr"],
    ["operation", "pipe2-O_CLOEXEC"],
    ["readFd", 21],
    ["writeFd", 22],
    ["supervisorRetains", "read-end-only"],
    ["childRetainsAfterExec", "target-fd-2-only"],
  ]),
]);

export const CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SCHEMA_V2],
    [
      "executable",
      nullRecord([
        ["sourceFd", 4],
        ["scratchMinimumFd", 18],
        ["scratchExactFd", 18],
        ["duplicateOperation", "F_DUPFD_CLOEXEC"],
        ["duplicatePhase", "before-private-output-pipes"],
        ["executeOperation", "execveat-AT_EMPTY_PATH"],
      ]),
    ],
    ["executableDuplicatedBeforeMappings", true],
    ["mappingOrder", "ascending-source-to-lower-target"],
    ["mappings", remapMappings],
    ["privateOutputPipes", privateOutputPipes],
    [
      "dynamicAllocationOrder",
      Object.freeze([
        "executableScratch:18",
        "childStdout:19,20",
        "childStderr:21,22",
        "clone3ChildPidfdInParent:23",
      ]),
    ],
    ["supervisorDynamicClosesAfterClone", Object.freeze([18, 20, 22])],
    [
      "parentPidfd",
      nullRecord([
        ["fd", 23],
        ["allocation", "clone3-CLONE_PIDFD"],
        ["childInherited", false],
        ["retainedUntil", "waitid-P_PIDFD-reaped"],
      ]),
    ],
    ["parentDynamicDescriptorsAfterClone", Object.freeze([19, 21, 23])],
    ["parentPidfdClosesAfterDirectChildReap", Object.freeze([23])],
    ["parentOutputReadDescriptors", Object.freeze([19, 21])],
    ["parentOutputDrainPhase", "concurrent-from-clone-until-eof"],
    [
      "parentOutputPerStreamCaptureMaximumBytes",
      CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2,
    ],
    [
      "parentOutputAggregateCaptureMaximumBytes",
      CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2,
    ],
    [
      "parentOutputOverflowAction",
      "cancel-whole-cgroup-continue-hash-and-drain-to-eof",
    ],
    [
      "parentOutputEvidenceRequired",
      Object.freeze(["observedBytes", "sha256", "eof", "truncated"]),
    ],
    [
      "parentOutputCloseCondition",
      "bounded-drain-complete-and-terminal-cgroup-quiescence-or-fail-closed-cancel",
    ],
    ["parentOutputCloseOnDirectChildReap", false],
    [
      "childClosesBeforeExec",
      Object.freeze([12, 13, 14, 15, 16, 17, 19, 20, 21, 22]),
    ],
    ["childExecveatDescriptor", 18],
    [
      "childDescriptorsAfterExec",
      Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ],
    ["controlDescriptorsInherited", false],
    ["unmappedDescriptorsClosedBeforeExec", true],
    ["firstUnmappedInheritedFd", 18],
    [
      "requiredOpenDescriptorsBeforeDynamicAllocation",
      requiredOpenDescriptorsBeforeDynamicAllocation,
    ],
    ["rejectOpenDescriptorAtOrAbove", 18],
    ["rejectShiftedDynamicAllocation", true],
    ["dynamicDescriptorMinimum", 18],
    ["precloneDynamicDescriptorMaximum", 22],
    ["dynamicDescriptorMaximum", 23],
    ["dynamicDescriptorInventoryExact", true],
  ]),
);

export const CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2);

function fileSpec(
  role,
  supervisorFd,
  childFd,
  destination,
  accessMode,
  permissions,
  minimumBytes,
  maximumBytes,
) {
  return deepFreeze(
    nullRecord([
      ["role", role],
      ["supervisorFd", supervisorFd],
      ["childFd", childFd],
      ["destination", destination],
      ["accessMode", accessMode],
      ["permissions", permissions],
      ["minimumBytes", minimumBytes],
      ["maximumBytes", maximumBytes],
    ]),
  );
}

export const CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2 = deepFreeze([
  fileSpec(
    "childExecutable",
    4,
    null,
    null,
    "O_RDONLY|O_CLOEXEC",
    "0500",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "childStdin",
    5,
    0,
    null,
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    4 * 1024 * 1024,
  ),
  fileSpec(
    "supervisorSelf",
    6,
    null,
    null,
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadSandboxWorker",
    7,
    3,
    "/runner/candidate/sandbox-session-worker-v2.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadProcess",
    8,
    4,
    "/runner/native/process.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadBuildCommand",
    9,
    5,
    "/runner/policy/build-command-v2.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadEvidenceLimits",
    10,
    6,
    "/runner/policy/evidence-limits.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadSessionLimits",
    11,
    7,
    "/runner/policy/session-v2-limits.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadTaskFailures",
    12,
    8,
    "/runner/policy/task-v2-failures.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadRoutingFeatures",
    13,
    9,
    "/runner/routing/features.mjs",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "payloadSeccompLauncher",
    14,
    10,
    "/runner/seccomp-launcher.py",
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_FILE_BYTES_V2,
  ),
  fileSpec(
    "launchArgv",
    15,
    null,
    null,
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
  ),
  fileSpec(
    "launchEnvironment",
    16,
    null,
    null,
    "O_RDONLY|O_CLOEXEC",
    "0400",
    1,
    CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
  ),
  fileSpec(
    "childResult",
    17,
    11,
    "/result/session.json",
    "O_RDWR|O_CLOEXEC",
    "0600",
    0,
    0,
  ),
]);

export const CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SCHEMA_V2],
    ["argvSchema", CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2],
    ["environmentSchema", CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2],
    ["capsuleSchema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2],
    [
      "fileDescriptorMapSchema",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V2,
    ],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
    ],
    ["remapPlanSchema", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SCHEMA_V2],
    ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2],
    ["fileSpecs", CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2],
    ["vectorMaximumItems", CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_ITEMS_V2],
    ["vectorMaximumBytes", CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2],
    ["itemMaximumBytes", CANDIDATE_CONTAINMENT_LAUNCH_ITEM_MAX_BYTES_V2],
    ["capsuleMaximumBytes", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2],
    [
      "payloadMaximumAggregateBytes",
      CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_AGGREGATE_BYTES_V2,
    ],
    ["resultMaximumBytes", CANDIDATE_CONTAINMENT_LAUNCH_RESULT_MAX_BYTES_V2],
    ["descriptorIdentityRequired", true],
    ["descriptorNonAliasRequired", true],
    ["childExecutableMagicPrefix", "7f454c46"],
    ["childExecutableKernelEligibilityRequiredFromNativeAdapter", true],
    ["childExecutablePermission", "0500"],
    ["supervisorSelfPurpose", "retained-byte-copy-only"],
    ["supervisorSelfBindsExecutedSupervisor", false],
    ["preallocationDescriptorInventoryRequired", true],
    ["mechanicsImplemented", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V2);

export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V2 = deepFreeze(
  nullRecord([
    ["descriptorObservationAuthority", false],
    ["descriptorOwnershipAuthority", false],
    ["processExecutionAuthority", false],
    ["containmentExecutionAuthority", false],
    ["sandboxReportAuthority", false],
    ["applicationReceiptAuthority", false],
    ["qualificationAuthority", false],
    ["finalDecisionAuthority", false],
    ["promotionAuthority", false],
    ["publicationAuthority", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2 = deepFreeze(
  nullRecord([
    ["serializedManifestProvesOpenDescriptors", false],
    ["serializedIdentityProvesCurrentIdentity", false],
    ["serializedDigestProvesCurrentBytes", false],
    ["manifestProvesNonAliasAtExecution", false],
    ["manifestProvesRewindAtExecution", false],
    ["manifestProvesCollisionSafeRemap", false],
    ["manifestProvesPreallocationDescriptorInventory", false],
    ["manifestProvesExecveat", false],
    ["manifestProvesKernelExecutableEligibility", false],
    ["manifestProvesExecutedSupervisorIdentity", false],
    ["manifestProvesOutputCapture", false],
    ["manifestProvesResultOwnership", false],
    ["manifestProvesRuntimeExecutableClosure", false],
    ["manifestProvesSameUidTamperResistance", false],
    ["manifestProvesPhysicalContainment", false],
  ]),
);

export function verifyCandidateContainmentLaunchPreallocationInventoryV2(
  value,
) {
  const input = exactRecord(
    value,
    ["openDescriptors"],
    "preallocation descriptor inventory input",
    fail,
  );
  const openDescriptors = exactDenseArray(
    input.openDescriptors,
    "preallocation open descriptors",
    1_024,
    fail,
  );
  if (
    openDescriptors.length !==
      requiredOpenDescriptorsBeforeDynamicAllocation.length ||
    openDescriptors.some(
      (descriptor, index) =>
        boundedInteger(
          descriptor,
          `preallocation descriptor ${index}`,
          0,
          1_048_576,
          fail,
        ) !== requiredOpenDescriptorsBeforeDynamicAllocation[index],
    )
  ) {
    fail("preallocation descriptor inventory changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_LAUNCH_PREALLOCATION_INVENTORY_SCHEMA_V2,
      ],
      ["reportedOpenDescriptors", openDescriptors],
      ["reportedExactInventory", true],
      ["physicalEligibility", false],
    ]),
  );
}

function artifact(name, bytes) {
  return deepFreeze(
    nullRecord([
      ["name", name],
      ["bytes", bytes.length],
      ["sha256", sha256(bytes)],
    ]),
  );
}

function snapshotArgv(value) {
  const input = exactRecord(value, ["argv"], "argv input", fail);
  const values = exactDenseArray(
    input.argv,
    "argv",
    CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_ITEMS_V2,
    fail,
  );
  if (values.length < 1) fail("argv is empty");
  return Object.freeze(
    values.map((value, index) =>
      exactUnicodeString(
        value,
        `argv[${index}]`,
        {
          minimumBytes: 1,
          maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_ITEM_MAX_BYTES_V2,
        },
        fail,
      ),
    ),
  );
}

function argvBody(argv) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2],
    ["argv", argv],
  ]);
}

function argvProjection(argv, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_LAUNCH_ARGV_PROJECTION_SCHEMA_V2],
      ["protocolSchema", CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2],
      ["count", argv.length],
      ["byteLength", bytes.length],
      ["rawSha256", sha256(bytes)],
      ["argv", argv],
    ]),
  );
}

export function createCandidateContainmentLaunchArgvV2(value) {
  const argv = snapshotArgv(value);
  const bytes = canonicalJsonLine(argvBody(argv));
  if (bytes.length > CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2) {
    fail("argv document exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    ["artifact", artifact("candidate-containment-launch-argv-v1.json", bytes)],
  ]);
}

export function verifyCandidateContainmentLaunchArgvV2(bytesValue) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "argv bytes",
    CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    ["schema", "argv"],
    "argv body",
    fail,
  );
  if (body.schema !== CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2) {
    fail("argv schema changed");
  }
  const argv = snapshotArgv({ argv: body.argv });
  return argvProjection(argv, decoded.bytes);
}

function snapshotEnvironmentRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    fail(`${label} must be a plain own-data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} has a foreign prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length > CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_ITEMS_V2 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !environmentNamePattern.test(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true ||
        descriptors[key].get !== undefined ||
        descriptors[key].set !== undefined,
    )
  ) {
    fail(`${label} fields are not exact environment data`);
  }
  return Object.freeze(
    [...keys].sort().map((name) =>
      deepFreeze(
        nullRecord([
          ["name", name],
          [
            "value",
            exactUnicodeString(
              descriptors[name].value,
              `${label}.${name}`,
              {
                minimumBytes: 0,
                maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_ITEM_MAX_BYTES_V2,
              },
              fail,
            ),
          ],
        ]),
      ),
    ),
  );
}

function environmentBody(entries) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2],
    ["entries", entries],
  ]);
}

function environmentProjection(entries, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_PROJECTION_SCHEMA_V2],
      ["protocolSchema", CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2],
      ["count", entries.length],
      ["byteLength", bytes.length],
      ["rawSha256", sha256(bytes)],
      ["entries", entries],
    ]),
  );
}

export function createCandidateContainmentLaunchEnvironmentV2(value) {
  const input = exactRecord(value, ["environment"], "environment input", fail);
  const entries = snapshotEnvironmentRecord(input.environment, "environment");
  const bytes = canonicalJsonLine(environmentBody(entries));
  if (bytes.length > CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2) {
    fail("environment document exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact("candidate-containment-launch-environment-v1.json", bytes),
    ],
  ]);
}

export function verifyCandidateContainmentLaunchEnvironmentV2(bytesValue) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "environment bytes",
    CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    ["schema", "entries"],
    "environment body",
    fail,
  );
  if (body.schema !== CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2) {
    fail("environment schema changed");
  }
  const rawEntries = exactDenseArray(
    body.entries,
    "environment entries",
    CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_ITEMS_V2,
    fail,
  );
  const object = Object.create(null);
  let previous;
  for (const [index, value] of rawEntries.entries()) {
    const entry = exactRecord(
      value,
      ["name", "value"],
      `environment entry ${index}`,
      fail,
    );
    if (
      typeof entry.name !== "string" ||
      !environmentNamePattern.test(entry.name) ||
      (previous !== undefined && entry.name <= previous)
    ) {
      fail(`environment entry ${index} name or order changed`);
    }
    previous = entry.name;
    object[entry.name] = exactUnicodeString(
      entry.value,
      `environment entry ${index} value`,
      {
        minimumBytes: 0,
        maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_ITEM_MAX_BYTES_V2,
      },
      fail,
    );
  }
  const entries = snapshotEnvironmentRecord(object, "environment replay");
  return environmentProjection(entries, decoded.bytes);
}

function snapshotIdentity(value, spec, byteLength, index) {
  const identity = exactRecord(
    value,
    [
      "device",
      "inode",
      "links",
      "type",
      "permissions",
      "owner",
      "group",
      "size",
      "modifiedNs",
      "changedNs",
    ],
    `file ${index} identity`,
    fail,
  );
  exactDecimal(identity.device, `file ${index} device`, {}, fail);
  exactDecimal(identity.inode, `file ${index} inode`, { minimum: 1n }, fail);
  exactDecimal(identity.owner, `file ${index} owner`, {}, fail);
  exactDecimal(identity.group, `file ${index} group`, {}, fail);
  exactDecimal(identity.modifiedNs, `file ${index} modifiedNs`, {}, fail);
  exactDecimal(identity.changedNs, `file ${index} changedNs`, {}, fail);
  if (
    identity.links !== "1" ||
    identity.type !== "regular" ||
    identity.permissions !== spec.permissions ||
    identity.size !== String(byteLength)
  ) {
    fail(`file ${index} identity changed`);
  }
  return deepFreeze(
    nullRecord([
      ["device", identity.device],
      ["inode", identity.inode],
      ["links", "1"],
      ["type", "regular"],
      ["permissions", spec.permissions],
      ["owner", identity.owner],
      ["group", identity.group],
      ["size", identity.size],
      ["modifiedNs", identity.modifiedNs],
      ["changedNs", identity.changedNs],
    ]),
  );
}

function snapshotFile(value, spec, index, contentRequired) {
  const record = exactRecord(
    value,
    [
      "role",
      "supervisorFd",
      "childFd",
      "destination",
      "accessMode",
      "permissions",
      "byteLength",
      "sha256",
      "initialOffset",
      "closeOnExec",
      "identity",
      ...(contentRequired ? ["contentBytes"] : []),
    ],
    `file ${index}`,
    fail,
  );
  if (
    record.role !== spec.role ||
    record.supervisorFd !== spec.supervisorFd ||
    record.childFd !== spec.childFd ||
    record.destination !== spec.destination ||
    record.accessMode !== spec.accessMode ||
    record.permissions !== spec.permissions
  ) {
    fail(`file ${index} role or descriptor policy changed`);
  }
  const byteLength = boundedInteger(
    record.byteLength,
    `file ${index} byteLength`,
    spec.minimumBytes,
    spec.maximumBytes,
    fail,
  );
  const digest = exactDigest(record.sha256, `file ${index} digest`, fail);
  if (contentRequired) {
    const content = copyBoundedBuffer(
      record.contentBytes,
      `file ${index} content bytes`,
      {
        minimumBytes: spec.minimumBytes,
        maximumBytes: spec.maximumBytes,
      },
      fail,
    );
    if (content.length !== byteLength || sha256(content) !== digest) {
      fail(`file ${index} content binding changed`);
    }
    if (
      spec.role === "childExecutable" &&
      !(
        content.length >= 4 &&
        content[0] === 0x7f &&
        content[1] === 0x45 &&
        content[2] === 0x4c &&
        content[3] === 0x46
      )
    ) {
      fail(`file ${index} child executable is not ELF`);
    }
  }
  if (record.initialOffset !== 0) fail(`file ${index} initial offset changed`);
  exactBoolean(record.closeOnExec, true, `file ${index} close-on-exec`, fail);
  const identity = snapshotIdentity(record.identity, spec, byteLength, index);
  return deepFreeze(
    nullRecord([
      ["role", spec.role],
      ["supervisorFd", spec.supervisorFd],
      ["childFd", spec.childFd],
      ["destination", spec.destination],
      ["accessMode", spec.accessMode],
      ["permissions", spec.permissions],
      ["byteLength", byteLength],
      ["sha256", digest],
      ["initialOffset", 0],
      ["closeOnExec", true],
      ["identity", identity],
    ]),
  );
}

function snapshotFiles(value, contentRequired) {
  const raw = exactDenseArray(
    value,
    "launch files",
    CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2.length,
    fail,
  );
  if (raw.length !== CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2.length) {
    fail("launch file inventory changed");
  }
  const files = raw.map((record, index) =>
    snapshotFile(
      record,
      CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2[index],
      index,
      contentRequired,
    ),
  );
  const supervisorFds = new Set();
  const childFds = new Set();
  const identities = new Set();
  let payloadBytes = 0;
  for (const [index, file] of files.entries()) {
    if (supervisorFds.has(file.supervisorFd)) {
      fail(`file ${index} aliases a supervisor descriptor`);
    }
    supervisorFds.add(file.supervisorFd);
    if (file.childFd !== null) {
      if (childFds.has(file.childFd)) {
        fail(`file ${index} aliases a child descriptor`);
      }
      childFds.add(file.childFd);
    }
    const identity = `${file.identity.device}:${file.identity.inode}`;
    if (identities.has(identity)) fail(`file ${index} aliases an inode`);
    identities.add(identity);
    if (payloadRoles.has(file.role)) payloadBytes += file.byteLength;
  }
  if (
    payloadBytes > CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_AGGREGATE_BYTES_V2
  ) {
    fail("launch payload closure exceeds its aggregate bound");
  }
  return Object.freeze(files);
}

function vectorSummary(projection, childKey) {
  return deepFreeze(
    nullRecord([
      ["schema", projection.protocolSchema],
      ["count", projection.count],
      ["byteLength", projection.byteLength],
      ["rawSha256", projection.rawSha256],
      [childKey, projection[childKey]],
    ]),
  );
}

function snapshotCapsuleInput(value, { contentRequired = true } = {}) {
  const input = exactRecord(
    value,
    [
      "requestSha256",
      "generationSha256",
      "argvBytes",
      "environmentBytes",
      "files",
      "resultMaximumBytes",
    ],
    "capsule input",
    fail,
  );
  const request = exactDigest(input.requestSha256, "request digest", fail);
  const generation = exactDigest(
    input.generationSha256,
    "generation digest",
    fail,
  );
  const argvBytes = copyBoundedBuffer(
    input.argvBytes,
    "argv bytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
    },
    fail,
  );
  const environmentBytes = copyBoundedBuffer(
    input.environmentBytes,
    "environment bytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
    },
    fail,
  );
  const argv = verifyCandidateContainmentLaunchArgvV2(argvBytes);
  const environment =
    verifyCandidateContainmentLaunchEnvironmentV2(environmentBytes);
  const files = snapshotFiles(input.files, contentRequired);
  const argvFile = files.find(({ role }) => role === "launchArgv");
  const environmentFile = files.find(
    ({ role }) => role === "launchEnvironment",
  );
  const resultFile = files.find(({ role }) => role === "childResult");
  if (
    argvFile.byteLength !== argv.byteLength ||
    argvFile.sha256 !== argv.rawSha256 ||
    environmentFile.byteLength !== environment.byteLength ||
    environmentFile.sha256 !== environment.rawSha256 ||
    resultFile.byteLength !== 0 ||
    resultFile.sha256 !== sha256(Buffer.alloc(0))
  ) {
    fail("launch vector or initial result file binding changed");
  }
  const maximum = boundedInteger(
    input.resultMaximumBytes,
    "result maximum bytes",
    CANDIDATE_CONTAINMENT_LAUNCH_RESULT_MAX_BYTES_V2,
    CANDIDATE_CONTAINMENT_LAUNCH_RESULT_MAX_BYTES_V2,
    fail,
  );
  return deepFreeze(
    nullRecord([
      ["requestSha256", request],
      ["generationSha256", generation],
      ["argv", vectorSummary(argv, "argv")],
      ["environment", vectorSummary(environment, "entries")],
      ["files", files],
      ["resultMaximumBytes", maximum],
    ]),
  );
}

function capsuleBody(input) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2],
    ["requestSha256", input.requestSha256],
    ["generationSha256", input.generationSha256],
    ["requirementsSha256", CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
    ],
    ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2],
    ["argv", input.argv],
    ["environment", input.environment],
    ["files", input.files],
    ["resultMaximumBytes", input.resultMaximumBytes],
  ]);
}

function capsuleProjection(body, bytes) {
  const unsigned = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_PROJECTION_SCHEMA_V2],
    ["protocolSchema", body.schema],
    ["byteLength", bytes.length],
    ["rawSha256", sha256(bytes)],
    ["requestSha256", body.requestSha256],
    ["generationSha256", body.generationSha256],
    ["requirementsSha256", body.requirementsSha256],
    ["fileDescriptorMapSha256", body.fileDescriptorMapSha256],
    ["remapPlanSha256", body.remapPlanSha256],
    ["argv", body.argv],
    ["environment", body.environment],
    ["files", body.files],
    ["resultMaximumBytes", body.resultMaximumBytes],
    ["binding", null],
    ["physicalEligibility", false],
    ["runtimeClosureEligibility", false],
    ["authority", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V2],
    ["nonclaims", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}

export function createCandidateContainmentLaunchCapsuleV2(value) {
  const input = snapshotCapsuleInput(value);
  const body = capsuleBody(input);
  const bytes = canonicalJsonLine(body);
  if (bytes.length > CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2) {
    fail("launch capsule exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact("candidate-containment-launch-capsule-v1.json", bytes),
    ],
  ]);
}

function vectorBytesFromCapsule(value, kind) {
  const childKey = kind === "argv" ? "argv" : "entries";
  const expectedSchema =
    kind === "argv"
      ? CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2
      : CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2;
  const summary = exactRecord(
    value,
    ["schema", "count", "byteLength", "rawSha256", childKey],
    `${kind} summary`,
    fail,
  );
  if (summary.schema !== expectedSchema) fail(`${kind} summary schema changed`);
  const body = nullRecord([
    ["schema", expectedSchema],
    [childKey, summary[childKey]],
  ]);
  const bytes = canonicalJsonLine(body);
  if (
    summary.count !== summary[childKey]?.length ||
    summary.byteLength !== bytes.length ||
    summary.rawSha256 !== sha256(bytes)
  ) {
    fail(`${kind} summary binding changed`);
  }
  if (kind === "argv") verifyCandidateContainmentLaunchArgvV2(bytes);
  else verifyCandidateContainmentLaunchEnvironmentV2(bytes);
  return bytes;
}

export function verifyCandidateContainmentLaunchCapsuleV2(bytesValue) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "capsule bytes",
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "requestSha256",
      "generationSha256",
      "requirementsSha256",
      "fileDescriptorMapSha256",
      "remapPlanSha256",
      "argv",
      "environment",
      "files",
      "resultMaximumBytes",
    ],
    "capsule body",
    fail,
  );
  if (
    body.schema !== CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2 ||
    body.requirementsSha256 !==
      CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2 ||
    body.fileDescriptorMapSha256 !==
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2 ||
    body.remapPlanSha256 !== CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2
  ) {
    fail("capsule schema or requirements changed");
  }
  const argvBytes = vectorBytesFromCapsule(body.argv, "argv");
  const environmentBytes = vectorBytesFromCapsule(
    body.environment,
    "environment",
  );
  const normalized = snapshotCapsuleInput(
    {
      requestSha256: body.requestSha256,
      generationSha256: body.generationSha256,
      argvBytes,
      environmentBytes,
      files: body.files,
      resultMaximumBytes: body.resultMaximumBytes,
    },
    { contentRequired: false },
  );
  const expected = capsuleBody(normalized);
  if (canonicalJson(body) !== canonicalJson(expected)) {
    fail("capsule replay drifted");
  }
  return capsuleProjection(expected, decoded.bytes);
}
