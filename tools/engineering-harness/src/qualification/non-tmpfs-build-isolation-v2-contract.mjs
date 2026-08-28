import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
  G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
  G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
} from "./cargo-execveat-status-protocol-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
  G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
} from "./non-tmpfs-build-isolation-contract.mjs";

// Pure policy replay for the successor G1.7 physical build boundary. This
// module performs no I/O, compiles no helper, opens no descriptor, and launches
// no process. Its true fields are requirements for a future private issuer;
// they are not observations that those mechanics exist or were applied.

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2";
export const G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME =
  "non-tmpfs-build-isolation-policy-v2.json";
export const G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES = 1024 * 1024;
export const G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGV_MAX_BYTES = 1024 * 1024;
export const G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGC_MAX = 4_096;
export const G17_NON_TMPFS_BUILD_ISOLATION_V2_TIMEOUT_MS = 300_000;
export const G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_MAX_BYTES =
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES;

const MAX_DEPTH = 64;
const MAX_NODES = 32_768;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_PROPERTIES = 4_097;
const MAX_STRING_BYTES = G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`G1.7 non-tmpfs build isolation v2 contract: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function snapshotOwnData(
  value,
  label,
  ancestors = new WeakSet(),
  depth = 0,
  budget = { nodes: 0, strings: 0 },
) {
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail(`${label} contains a Proxy`);
  }
  if (depth > MAX_DEPTH) fail(`${label} exceeds the depth limit`);
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) fail(`${label} exceeds the node limit`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = bufferByteLength(value, "utf8");
    budget.strings += bytes;
    if (bytes > MAX_SINGLE_STRING_BYTES || budget.strings > MAX_STRING_BYTES) {
      fail(`${label} exceeds the string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} is not finite`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    ArrayBuffer.isView(value)
  ) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    fail(`${label} prototype cannot be inspected: ${error.message}`);
  }
  const array = Array.isArray(value);
  if (
    prototype !== (array ? arrayPrototype : objectPrototype) &&
    !(prototype === null && !array)
  ) {
    fail(`${label} contains a foreign prototype`);
  }
  ancestors.add(value);
  try {
    let descriptors;
    try {
      descriptors = objectGetOwnPropertyDescriptors(value);
    } catch (error) {
      fail(`${label} properties cannot be inspected: ${error.message}`);
    }
    const keys = reflectOwnKeys(descriptors);
    if (
      keys.length > MAX_PROPERTIES ||
      keys.some((key) => typeof key !== "string")
    ) {
      fail(`${label} exceeds its property budget or contains symbols`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      budget.strings += bufferByteLength(key, "utf8");
      if (budget.strings > MAX_STRING_BYTES) {
        fail(`${label} exceeds the key budget`);
      }
      if (!("value" in descriptor)) {
        fail(`${label}.${key} is not an own data property`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fail(`${label} is not a bounded dense array`);
      }
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
        fail(`${label} is not a field-free dense array`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotOwnData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
          depth + 1,
          budget,
        ),
      );
    }
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      output[key] = snapshotOwnData(
        descriptor.value,
        `${label}.${key}`,
        ancestors,
        depth + 1,
        budget,
      );
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

const CHILD_FILE_DESCRIPTORS = [
  {
    childFd: 0,
    role: "stdinNull",
    kind: "character-device",
    descriptorAccess: "read-only",
    logicalPath: "/dev/null",
    presentInHelperImage: true,
    presentInCargoImage: true,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: false,
    lifecycle: "retained-through-cargo-image",
  },
  {
    childFd: 1,
    role: "cargoStdout",
    kind: "pipe-writer",
    descriptorAccess: "write-only",
    logicalPath: null,
    presentInHelperImage: true,
    presentInCargoImage: true,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: false,
    lifecycle: "retained-through-cargo-image",
  },
  {
    childFd: 2,
    role: "cargoStderr",
    kind: "pipe-writer",
    descriptorAccess: "write-only",
    logicalPath: null,
    presentInHelperImage: true,
    presentInCargoImage: true,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: false,
    lifecycle: "retained-through-cargo-image",
  },
  {
    childFd: 3,
    role: "workspaceRoot",
    kind: "directory",
    descriptorAccess: "read-only",
    logicalPath: "/proc/self/fd/3",
    presentInHelperImage: true,
    presentInCargoImage: true,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: false,
    lifecycle: "retained-through-cargo-image",
  },
  {
    childFd: 4,
    role: "source",
    kind: "directory",
    descriptorAccess: "read-only",
    logicalPath: "/proc/self/fd/4",
    presentInHelperImage: true,
    presentInCargoImage: true,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: false,
    lifecycle: "retained-through-cargo-image",
  },
  {
    childFd: 5,
    role: "target",
    kind: "directory",
    // Linux directory file descriptions are held read-only. Target mutation is
    // governed independently by the writable bind mount frozen below.
    descriptorAccess: "read-only",
    logicalPath: "/proc/self/fd/5",
    presentInHelperImage: true,
    presentInCargoImage: true,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: false,
    lifecycle: "retained-through-cargo-image",
  },
  {
    childFd: 6,
    role: "cargoExecutable",
    kind: "regular-file",
    descriptorAccess: "read-only",
    logicalPath: "/proc/self/fd/6",
    presentInHelperImage: true,
    presentInCargoImage: false,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: true,
    lifecycle: "helper-private-close-on-cargo-image-transition",
  },
  {
    childFd: 7,
    role: "execStatusWriter",
    kind: "pipe-writer",
    descriptorAccess: "write-only",
    logicalPath: null,
    presentInHelperImage: true,
    presentInCargoImage: false,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: true,
    lifecycle: "helper-private-close-on-cargo-image-transition",
  },
  {
    childFd: 8,
    role: "helperSelfExecutable",
    kind: "regular-file",
    descriptorAccess: "read-only",
    logicalPath: "/proc/self/fd/8",
    presentInHelperImage: true,
    presentInCargoImage: false,
    cloexecAtHelperEntry: false,
    cloexecImmediatelyBeforeCargoExecveat: true,
    lifecycle: "helper-private-close-on-cargo-image-transition",
  },
];

const PARENT_ONLY_FILE_DESCRIPTORS = [
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
    // The directory reference itself is not O_RDWR. The containment owner
    // opens the governed cgroup control files relative to this held directory.
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
];

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_AUTHORITY = deepFreeze(
  snapshotOwnData(
    {
      buildExecutionAuthority: false,
      launchExecutionAuthority: false,
      controlExecutionAuthority: false,
      qualificationExecutionAuthority: false,
      receiptAuthority: false,
      promotionAuthority: false,
      publicationAuthority: false,
      routerQualityAuthority: false,
      providerExecutionAuthority: false,
    },
    "frozen v2 authority",
  ),
);

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_NONCLAIMS = deepFreeze(
  snapshotOwnData(
    {
      policyApplicationObserved: false,
      nativeContainmentAdapterImplemented: false,
      containmentSuccessorImplemented: false,
      privatePhysicalIssuerImplemented: false,
      helperSourceImplemented: false,
      helperCompilationObserved: false,
      helperAttestationObserved: false,
      helperInitialLaunchObserved: false,
      helperDescriptorMapObserved: false,
      helperCloexecTransitionObserved: false,
      helperStatusProtocolObserved: false,
      cargoExecveatObserved: false,
      cargoExecutionObserved: false,
      rustcExecutionObserved: false,
      physicalLaunchOccurred: false,
      physicalOwnerIssued: false,
      containmentApplied: false,
      cgroupPlacementObserved: false,
      clone3CgroupPlacementObserved: false,
      pidfdCreatedObserved: false,
      directChildPidfdWaitidAttested: false,
      waitidPidfdObserved: false,
      directChildReaped: false,
      cgroupQuiescenceObserved: false,
      hostileSameUidResistance: false,
      maliciousHostOrKernelResistance: false,
      crashDurability: false,
      powerLossDurability: false,
      filesystemFlushDurability: false,
      finalBindingMinted: false,
    },
    "frozen v2 nonclaims",
  ),
);

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS = deepFreeze(
  snapshotOwnData(
    {
      timeoutMilliseconds: G17_NON_TMPFS_BUILD_ISOLATION_V2_TIMEOUT_MS,
      combinedOutputMaximumBytes: G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
      argcMaximum: G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGC_MAX,
      aggregateArgvUtf8MaximumBytes:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_ARGV_MAX_BYTES,
      statusProtocolMaximumBytes:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_MAX_BYTES,
      statusProtocolMaximumFrames:
        G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
      statusProtocolTimeoutMilliseconds: G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
      termGraceMilliseconds: G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
      closeReapTimeoutMilliseconds: G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
    },
    "frozen v2 limits",
  ),
);

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS = deepFreeze(
  snapshotOwnData(
    {
      exactChildDescriptorRange: {
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
      },
      childFileDescriptors: CHILD_FILE_DESCRIPTORS,
      imageMaps: {
        standardFileDescriptors: [0, 1, 2],
        helperImageFileDescriptors: [3, 4, 5, 6, 7, 8],
        helperImageExactOpenFileDescriptors: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        cargoImageInheritedFileDescriptors: [3, 4, 5],
        cargoImageExactOpenFileDescriptors: [0, 1, 2, 3, 4, 5],
        launcherPrivateFileDescriptors: [6, 7, 8],
      },
      parentOnlyFileDescriptors: PARENT_ONLY_FILE_DESCRIPTORS,
      aliasing: {
        childNumbersUniqueRequired: true,
        childOpenFileDescriptionsPairwiseDistinctRequired: true,
        duplicatedChildDescriptorsForbidden: true,
        parentOnlyDescriptorsMayNotDuplicateChildDescriptors: true,
        parentOnlyFixedNumbersForbidden: true,
        workspaceSourceTargetCargoHelperObjectsPairwiseDistinctRequired: true,
        sourceAndTargetMustRemainBeneathWorkspaceRoot: true,
        statusReaderWriterPipeRelationshipRequired: true,
        statusReaderWriterOpenFileDescriptionAliasForbidden: true,
        stdoutAndStderrPipeObjectsDistinctRequired: true,
      },
    },
    "frozen v2 file descriptors",
  ),
);

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256 =
  canonicalSha256(G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS);

const STATUS_PROTOCOL_REQUIREMENTS_BASE = deepFreeze(
  snapshotOwnData(
    {
      schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
      writerFd: 7,
      readerRole: "execStatusReader",
      framing: "canonical-json-one-object-per-lf-frame",
      frameFields: ["schema", "type", "stage", "errno", "reservedExitCode"],
      maximumBytes: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
      maximumFrames: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
      timeoutMilliseconds: G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
      readyFrame: {
        schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
        type: "READY",
        stage: "execveat",
        errno: null,
        reservedExitCode: null,
      },
      errorFrames: {
        type: "ERROR",
        preReadyStages: G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
        postReadyStage: "execveat",
        errnoMinimum: 1,
        errnoMaximum: G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
        reservedExitCodes: G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
        processExitMustMatchReservedExitCode: true,
        processExitSignalMustBeNull: true,
      },
      acceptedSequences: [
        "READY->EOF",
        "ERROR->EOF",
        "READY->ERROR(execveat)->EOF",
      ],
      exactlyOneWriterAtLaunchRequired: true,
      writerDuplicationForbidden: true,
      exactlyOneEofAfterFinalFrameRequired: true,
      partialFrameAtEofFailsClosed: true,
      noncanonicalFrameFailsClosed: true,
      timeoutFailsClosed: true,
      overflowFailsClosed: true,
      writerFdCloexecCreatesSuccessEof: true,
      replayDoesNotProveExecveatSuccess: true,
    },
    "frozen v2 status protocol requirements",
  ),
);

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS =
  deepFreeze(
    nullRecord([
      ...Object.entries(STATUS_PROTOCOL_REQUIREMENTS_BASE),
      [
        "requirementsSha256",
        canonicalSha256(STATUS_PROTOCOL_REQUIREMENTS_BASE),
      ],
    ]),
  );

export const G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256 =
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS.requirementsSha256;

const POLICY_BASE = deepFreeze(
  snapshotOwnData(
    {
      schema: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
      status: "DORMANT_REQUIREMENTS_ONLY",
      requirementMode: "prescriptive-not-observed",
      environment: {
        class: G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
        operatingSystem: "linux",
        architecture: "x86_64",
        cgroupVersion: 2,
        stateStorage: "held-non-tmpfs-filesystem",
        tmpfsState: false,
        ramfsState: false,
        serialization: {
          mode: "global-exclusive-build-lease",
          maximumConcurrentBuilds: 1,
          leaseHeldUntilTerminalReapOrRetention: true,
        },
      },
      workspace: {
        identityObservation: "openat2-held-fd-fstat-fstatfs-statx-mnt-id/v1",
        ancestryResolution: "openat2-resolve-beneath-no-symlinks/v1",
        descriptorsHeldUntilTerminalReapOrRetention: true,
        namespace: {
          mechanism: "bind-mount-from-held-descriptor/v1",
          heldParentFd: 3,
          mounts: [
            {
              role: "source",
              heldFd: 4,
              parentFd: 3,
              parentLeafName: "source",
              destination: "/workspace/source",
              mountOptions: ["bind", "nodev", "noexec", "nosuid", "ro"],
              sameObjectAsHeldDescriptorRequired: true,
              beneathHeldParentRequired: true,
              readOnly: true,
            },
            {
              role: "target",
              heldFd: 5,
              parentFd: 3,
              parentLeafName: "target",
              destination: "/state/target",
              mountOptions: ["bind", "nodev", "nosuid", "rw"],
              sameObjectAsHeldDescriptorRequired: true,
              beneathHeldParentRequired: true,
              readOnly: false,
            },
          ],
          exactMountOrderRequired: true,
          alternateSourceOrTargetMappingsForbidden: true,
        },
      },
      fileDescriptors: G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS,
      helper: {
        implementation: "reviewed-c17-native-execveat-helper",
        sourceLogicalName: "cargo-execveat-helper.c",
        executableLogicalName: "g17-cargo-execveat-helper",
        attestation: {
          schema: "oxigraph.g1.7-cargo-execveat-helper-attestation/v1",
          requiredBeforeInitialLaunch: true,
          requiredFields: [
            "source-bytes-and-sha256",
            "compiler-held-executable-sha256-and-raw-version",
            "exact-compile-argv-and-raw-streams",
            "helper-bytes-sha256-and-held-file-identity",
            "exact-file-descriptor-map-sha256",
            "status-protocol-schema-and-requirements-sha256",
            "canonical-attestation-sha256",
          ],
          bindingRequirements: {
            fileDescriptorMapSha256:
              G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
            statusProtocolSchema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
            statusProtocolRequirementsSha256:
              G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
            exactRequestBindingRequired: true,
            exactHelperSourceBindingRequired: true,
            exactHelperExecutableBindingRequired: true,
          },
          compiler: {
            path: "/usr/bin/x86_64-linux-gnu-gcc-13",
            major: "13",
            heldExecutableDigestRequired: true,
            rawVersionBytesRequired: true,
          },
          compileArgv: [
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
          ],
          executableRequirements: {
            descriptor: 8,
            kind: "regular-file",
            access: "read-only",
            ownerIdentityRequired: true,
            filesystemIdentityRequired: true,
            deviceAndInodeIdentityRequired: true,
            modeLinksSizeAndTimestampsRequired: true,
            singleLinkRequired: true,
            ownerWritableForbidden: true,
            groupWritableForbidden: true,
            otherWritableForbidden: true,
            digestMustMatchHeldBytes: true,
          },
        },
        initialLaunch: {
          mechanism: "separately-attested-held-helper-descriptor/v1",
          heldHelperDescriptor: 8,
          procFdExecvePermitted: true,
          ordinaryPathnameExecveForbidden: true,
          launchedImageMustMatchHeldDescriptor: true,
          parentAndHelperEntryIdentityAgreementRequired: true,
          physicalEvidenceRequiredBeforeAnyLaunchClaim: true,
          mayNotProveCargoTransition: true,
        },
        entryValidation: {
          exactDescriptorMapRequired: true,
          descriptorKindsAndOpenDescriptionAccessRequired: true,
          descriptorAliasRulesRequired: true,
          helperDescriptorAttestationMatchRequired: true,
          cargoDescriptorRequestBindingMatchRequired: true,
          unexpectedDescriptorCloseRangeRequired: true,
          validationFailureDisposition: "error-frame-or-eof-fail-closed",
        },
        statusErrorStageMapping: {
          preflight: [
            "helper-identity",
            "descriptor-inventory",
            "descriptor-kind-access-and-alias",
            "request-and-attestation-bindings",
            "close-range-from-9",
          ],
          "cargo-fd": ["cargo-fd-6-kind-access-identity"],
          "status-fd": ["status-fd-7-kind-access-and-sole-writer"],
          "status-cloexec": ["cloexec-apply-and-readback-0-through-8"],
          "ready-write": ["canonical-ready-frame-write"],
          execveat: ["syscall-execveat-fd-6-empty-path-at-empty-path"],
          unmappedFailureForbidden: true,
        },
      },
      descriptorTransition: {
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
      },
      statusProtocol:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
      cargoTransition: {
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
      },
      supervision: {
        shellForbidden: true,
        detachedProcessGroupRequired: true,
        stdout: {
          childFd: 1,
          representation: "raw-bytes",
          decodeBeforeDigestForbidden: true,
        },
        stderr: {
          childFd: 2,
          representation: "raw-bytes",
          decodeBeforeDigestForbidden: true,
        },
        limits: G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS,
        sharedOutputCeilingRequired: true,
        overflowDisposition: "terminate-fail-no-success-artifact",
        truncationMayNotSatisfySuccess: true,
        termination: {
          target: "detached-process-group-and-per-build-cgroup-v2-subtree",
          firstSignal: "SIGTERM",
          graceMilliseconds: G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
          finalSignal: "SIGKILL",
          cgroupKillRequiredAfterGrace: true,
          closeReapTimeoutMilliseconds:
            G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
          terminationErrorsFailClosed: true,
        },
        closeAndReap: {
          statusPipeTerminalRequired: true,
          exitOrErrorBeforeCloseRequired: true,
          stdoutEofBeforeCloseRequired: true,
          stderrEofBeforeCloseRequired: true,
          exitAndCloseStatusAgreementRequired: true,
          directChildPidfdRequired: true,
          directChildCloseRequired: true,
          directChildWaitidReapRequired: true,
          callerSuppliedReapProofAccepted: false,
          successExitCode: 0,
          successSignal: null,
          unreapedDisposition: "inconclusive-retain-handles-no-cleanup",
        },
      },
      containment: {
        requiredSuccessorSchema:
          "oxigraph.g1.7-non-tmpfs-containment-evidence/v2",
        perBuildCgroupV2SubtreeRequired: true,
        cgroupPathDerivation: {
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
        },
        initialPlacement: {
          syscall: "clone3",
          flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
          heldCgroupDescriptorRole: "cgroupDirectory",
          returnedPidfdRole: "directChildPidfd",
          workerPlacedBeforeUserCodeRunnableRequired: true,
          postSpawnCgroupProcsWriteForbidden: true,
          forkThenMoveFallbackForbidden: true,
          cloneWithoutIntoCgroupFallbackForbidden: true,
          failureDisposition: "fail-before-helper-image",
        },
        directChildReap: {
          syscall: "waitid",
          idType: "P_PIDFD",
          pidfdRole: "directChildPidfd",
          exactTerminalStatusRequired: true,
          callerSuppliedReapProofForbidden: true,
        },
        parentOnlyCgroupDescriptorRequired: true,
        parentOnlyPidfdRequired: true,
        quiescenceAfterDirectChildReapRequired: true,
        quiescenceObservations: {
          cgroupEventsPopulated: "0",
          pidsCurrent: "0",
          cgroupProcs: "empty",
          processesRemaining: 0,
        },
        cleanupBeforeQuiescenceForbidden: true,
        nativeAdapterRequired: true,
      },
      implementation: {
        nativeHelperImplemented: false,
        containmentSuccessorImplemented: false,
        nativeContainmentAdapterImplemented: false,
        privatePhysicalIssuerImplemented: false,
        physicalLaunchEligible: false,
        policyApplicationObserved: false,
      },
      finalDecisionEligible: false,
      binding: null,
      nonclaims: G17_NON_TMPFS_BUILD_ISOLATION_V2_NONCLAIMS,
      authority: G17_NON_TMPFS_BUILD_ISOLATION_V2_AUTHORITY,
    },
    "frozen v2 policy base",
  ),
);

function expectedPolicy() {
  return deepFreeze(
    nullRecord([
      ...Object.entries(POLICY_BASE),
      ["sha256", canonicalSha256(POLICY_BASE)],
    ]),
  );
}

function canonicalPolicyBytes(policy) {
  const bytes = Buffer.from(`${canonicalJson(policy)}\n`, "utf8");
  if (
    bytes.length < 2 ||
    bytes.length > G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES
  ) {
    fail("policy artifact exceeds its byte ceiling");
  }
  return bytes;
}

function copyBoundedBuffer(value) {
  if (
    !Buffer.isBuffer(value) ||
    types.isProxy(value) ||
    objectGetPrototypeOf(value) !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail("policy artifact must be an exact non-Proxy Buffer");
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(
      `policy artifact length cannot be read intrinsically: ${error.message}`,
    );
  }
  if (
    !Number.isSafeInteger(length) ||
    length < 2 ||
    length > G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES
  ) {
    fail("policy artifact is outside its byte bound");
  }
  try {
    const copied = bufferAllocUnsafe(length);
    typedArraySet.call(copied, value);
    return copied;
  } catch (error) {
    fail(`policy artifact cannot be copied intrinsically: ${error.message}`);
  }
}

function decodeCanonicalPolicy(input) {
  const bytes = copyBoundedBuffer(input);
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`policy artifact is not UTF-8: ${error.message}`);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("policy artifact must be one LF-terminated JSON value");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`policy artifact is invalid JSON: ${error.message}`);
  }
  const policy = snapshotOwnData(parsed, "policy document");
  if (!bufferEquals.call(bytes, canonicalPolicyBytes(policy))) {
    fail("policy artifact is not canonical JSON plus one LF");
  }
  return policy;
}

function artifactEnvelope(bytes) {
  const stored = Buffer.from(bytes);
  const artifact = Object.create(null);
  Object.defineProperties(artifact, {
    name: {
      value: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME,
      enumerable: true,
    },
    sha256: { value: sha256(stored), enumerable: true },
    bytes: {
      get() {
        return Buffer.from(stored);
      },
      enumerable: true,
    },
  });
  return Object.freeze(artifact);
}

export function createG17NonTmpfsBuildIsolationV2PolicyArtifact() {
  const policy = expectedPolicy();
  const artifact = artifactEnvelope(canonicalPolicyBytes(policy));
  return Object.freeze(
    nullRecord([
      ["policy", policy],
      ["artifact", artifact],
    ]),
  );
}

export function verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(bytes) {
  try {
    const policy = decodeCanonicalPolicy(bytes);
    if (!isDeepStrictEqual(policy, expectedPolicy())) {
      fail("policy differs from the frozen non-tmpfs build policy v2");
    }
    return deepFreeze(policy);
  } catch (error) {
    if (
      error?.message?.startsWith("G1.7 non-tmpfs build isolation v2 contract:")
    ) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}
