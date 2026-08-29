import { canonicalSha256 } from "../routing/features.mjs";
import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_ITEM_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_OUTPUT_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_PAYLOAD_MAX_AGGREGATE_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_RESULT_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_VECTOR_MAX_ITEMS_V2,
  createCandidateContainmentLaunchCapsuleV2,
  verifyCandidateContainmentLaunchCapsuleV2,
} from "./containment-launch-capsule-v2.mjs";
import {
  canonicalJsonLine,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";

// Additive native-launch successor. The already committed /v1 capsule and
// FD-map v2 remain byte-for-byte replayable. This successor changes only the
// execution plan: an O_CLOEXEC outcome pipe carries exact child-side remap or
// exec failure, while a PTRACE_EVENT_EXEC stop supplies positive, race-free
// kernel exec evidence before the new image can run or exit. EOF without that
// event is not exec proof. This module opens no descriptor and performs no
// syscall.

export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3 =
  "oxigraph.candidate-containment-launch-capsule/v2";
export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_PROJECTION_SCHEMA_V3 =
  "oxigraph.candidate-containment-launch-capsule-replay/v2";
export const CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-fd-map/v3";
export const CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SCHEMA_V3 =
  "oxigraph.candidate-containment-child-remap-plan/v2";
export const CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SCHEMA_V3 =
  "oxigraph.candidate-containment-launch-requirements/v2";
export const CANDIDATE_CONTAINMENT_EXEC_OUTCOME_SCHEMA_V3 =
  "oxigraph.candidate-containment-exec-outcome/v1";

function fail(message) {
  throw new Error(`candidate containment launch capsule v3: ${message}`);
}

export const CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V3 =
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_V2;
export const CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3 =
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2;

const execFailureRecord = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_EXEC_OUTCOME_SCHEMA_V3],
    ["encoding", "binary-little-endian"],
    ["bytes", 16],
    ["magicHex", "4f584558"],
    ["versionOffset", 4],
    ["version", 1],
    ["phaseOffset", 5],
    ["phaseBytes", 1],
    ["reservedOffset", 6],
    ["reservedBytes", 2],
    ["reservedHex", "0000"],
    ["errnoOffset", 8],
    ["errnoBytes", 4],
    ["errnoEncoding", "uint32-little-endian"],
    ["errnoMinimum", 1],
    ["errnoMaximum", 4095],
    ["trailerOffset", 12],
    ["trailerHex", "00000000"],
    [
      "phases",
      deepFreeze(
        nullRecord([
          ["childTraceRequest", 5],
          ["childStopRequest", 6],
          ["childRemap", 7],
          ["childClose", 8],
          ["execveat", 9],
        ]),
      ),
    ],
    ["writerOperation", "bounded-write-loop-exactly-16-bytes"],
    ["readerOperation", "read-to-eof"],
    ["acceptedStream", "exactly-one-16-byte-record-then-eof"],
    [
      "allOtherStreams",
      "exec-transition-unproved-and-whole-cgroup-cancel-required",
    ],
  ]),
);

const ptraceExecProof = deepFreeze(
  nullRecord([
    ["childTraceRequest", "PTRACE_TRACEME"],
    ["childStopBeforeRemap", "kill-getpid-SIGSTOP"],
    ["childSetupFailureChannel", "exact-exec-outcome-record"],
    ["parentInitialStopWait", "waitpid-child-__WALL-WUNTRACED"],
    [
      "parentOptions",
      Object.freeze(["PTRACE_O_TRACEEXEC", "PTRACE_O_EXITKILL"]),
    ],
    ["parentResume", "PTRACE_CONT-signal-0"],
    ["positiveEvent", "PTRACE_EVENT_EXEC"],
    ["eventStopSignal", "SIGTRAP"],
    ["childHeldStoppedUntilVerified", true],
    [
      "executedImageIdentity",
      "live-/proc/<pid>/exe-same-device-inode-as-held-childExecutable",
    ],
    ["pidfdMustIdentifySameDirectChild", true],
    ["outcomePipeMustBeEofWithoutRecord", true],
    ["parentDetach", "PTRACE_DETACH-signal-0"],
    [
      "parentTraceFailurePoints",
      Object.freeze([
        "initial-stop-wait",
        "set-options",
        "resume",
        "exec-event-wait",
        "image-identity-readback",
        "outcome-pipe-read",
        "detach",
      ]),
    ],
    [
      "parentTraceFailureAction",
      "cancel-whole-cgroup-reap-direct-child-and-report-launch-failed",
    ],
    ["missingDuplicateOrUnexpectedEventAction", "cancel-whole-cgroup"],
    ["ptraceAuthorityFromSerializedPlan", false],
  ]),
);

const precloneRollback = deepFreeze([
  deepFreeze(
    nullRecord([
      ["completedThrough", "preallocation-inventory"],
      ["closeDescriptors", Object.freeze([])],
    ]),
  ),
  deepFreeze(
    nullRecord([
      ["completedThrough", "executable-scratch"],
      ["closeDescriptors", Object.freeze([18])],
    ]),
  ),
  deepFreeze(
    nullRecord([
      ["completedThrough", "stdout-pipe"],
      ["closeDescriptors", Object.freeze([18, 19, 20])],
    ]),
  ),
  deepFreeze(
    nullRecord([
      ["completedThrough", "stderr-pipe"],
      ["closeDescriptors", Object.freeze([18, 19, 20, 21, 22])],
    ]),
  ),
  deepFreeze(
    nullRecord([
      ["completedThrough", "exec-outcome-pipe"],
      ["closeDescriptors", Object.freeze([18, 19, 20, 21, 22, 23, 24])],
    ]),
  ),
]);

export const CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V3 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SCHEMA_V3],
    ["executable", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.executable],
    ["executableDuplicatedBeforeMappings", true],
    ["mappingOrder", "ascending-source-to-lower-target"],
    ["mappings", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.mappings],
    [
      "privateOutputPipes",
      CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.privateOutputPipes,
    ],
    [
      "execOutcomePipe",
      deepFreeze(
        nullRecord([
          ["operation", "pipe2-O_CLOEXEC"],
          ["readFd", 23],
          ["writeFd", 24],
          ["supervisorRetains", "read-end-only"],
          ["childRetainsBeforeExec", "write-end-only"],
          ["noFailureRecordObservation", "eof"],
          ["failureObservation", "exact-binary-record"],
          ["failureRecord", execFailureRecord],
          [
            "partialExtraOrMalformedAction",
            "cancel-whole-cgroup-and-report-exec-transition-unproved",
          ],
          ["readToEofRequired", true],
          ["eofWithoutRecordClassification", "unknown-without-ptrace-exec"],
          [
            "ambiguousObservationAction",
            "cancel-whole-cgroup-and-report-exec-transition-unproved",
          ],
        ]),
      ),
    ],
    [
      "dynamicAllocationOrder",
      Object.freeze([
        "executableScratch:18",
        "childStdout:19,20",
        "childStderr:21,22",
        "execOutcome:23,24",
        "clone3ChildPidfdInParent:25",
      ]),
    ],
    ["supervisorDynamicClosesAfterClone", Object.freeze([18, 20, 22, 24])],
    [
      "parentPidfd",
      deepFreeze(
        nullRecord([
          ["fd", 25],
          ["allocation", "clone3-CLONE_PIDFD"],
          ["childInherited", false],
          ["retainedUntil", "waitid-P_PIDFD-reaped"],
        ]),
      ),
    ],
    ["parentDynamicDescriptorsAfterClone", Object.freeze([19, 21, 23, 25])],
    ["parentPidfdClosesAfterDirectChildReap", Object.freeze([25])],
    ["parentExecOutcomeReadDescriptor", 23],
    [
      "parentExecOutcomeClosePaths",
      deepFreeze(
        nullRecord([
          ["execProved", "after-ptrace-event-image-match-and-zero-byte-eof"],
          ["execFailed", "after-one-exact-record-and-eof"],
          [
            "ambiguous",
            "after-whole-cgroup-cancel-direct-child-reap-and-read-to-eof",
          ],
        ]),
      ),
    ],
    ["childExecOutcomeWriteDescriptor", 24],
    ["childExecOutcomeWriteCloseOnExec", true],
    ["precloneFailureChannel", "supervisor-status"],
    ["precloneRollback", precloneRollback],
    [
      "clone3FailureRollback",
      deepFreeze(
        nullRecord([
          ["childCreated", false],
          ["closeDescriptors", Object.freeze([18, 19, 20, 21, 22, 23, 24])],
        ]),
      ),
    ],
    ["postcloneParentCloseDescriptors", Object.freeze([18, 20, 22, 24])],
    ["postcloneParentCloseFailureAction", "cancel-whole-cgroup"],
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
      Object.freeze([12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]),
    ],
    ["childExecveatDescriptor", 18],
    [
      "childDescriptorsImmediatelyBeforeExec",
      Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 24]),
    ],
    [
      "childDescriptorsAfterExec",
      Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ],
    ["controlDescriptorsInherited", false],
    ["unmappedDescriptorsClosedBeforeExec", true],
    ["firstUnmappedInheritedFd", 18],
    [
      "requiredOpenDescriptorsBeforeDynamicAllocation",
      CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V2.requiredOpenDescriptorsBeforeDynamicAllocation,
    ],
    ["rejectOpenDescriptorAtOrAbove", 18],
    ["rejectShiftedDynamicAllocation", true],
    ["dynamicDescriptorMinimum", 18],
    ["precloneDynamicDescriptorMaximum", 24],
    ["dynamicDescriptorMaximum", 25],
    ["dynamicDescriptorInventoryExact", true],
    ["execOutcomeEofAloneProvesExecTransition", false],
    ["execTransitionProof", ptraceExecProof],
    ["cloneFilesShared", false],
    [
      "cloneFlagsExcluded",
      Object.freeze(["CLONE_FILES", "CLONE_VM", "CLONE_VFORK"]),
    ],
  ]),
);

export const CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3 =
  canonicalSha256(CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V3);

export const CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SCHEMA_V3],
    ["argvSchema", CANDIDATE_CONTAINMENT_LAUNCH_ARGV_SCHEMA_V2],
    ["environmentSchema", CANDIDATE_CONTAINMENT_LAUNCH_ENVIRONMENT_SCHEMA_V2],
    ["capsuleSchema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3],
    [
      "fileDescriptorMapSchema",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V3,
    ],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
    ],
    ["remapPlanSchema", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SCHEMA_V3],
    ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3],
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
    ["execOutcomePipeRequired", true],
    ["execOutcomeEofAloneProvesExecTransition", false],
    ["execTransitionProofRequiresPtraceEventExec", true],
    ["execTransitionProofRequiresExecutedImageInodeMatch", true],
    ["cloneFilesShared", false],
    ["mechanicsImplemented", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3 =
  canonicalSha256(CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3);

export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V3 = deepFreeze(
  nullRecord(Object.entries(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V2)),
);

export const CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3 = deepFreeze(
  nullRecord([
    ...Object.entries(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V2),
    ["manifestProvesExecOutcomePipe", false],
    ["manifestProvesExecTransition", false],
    ["manifestProvesChildStillLiveAtExecEof", false],
  ]),
);

function successorBody(base) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3],
    ["requestSha256", base.requestSha256],
    ["generationSha256", base.generationSha256],
    ["requirementsSha256", CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
    ],
    ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3],
    ["argv", base.argv],
    ["environment", base.environment],
    ["files", base.files],
    ["resultMaximumBytes", base.resultMaximumBytes],
  ]);
}

function legacyBody(body) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2],
    ["requestSha256", body.requestSha256],
    ["generationSha256", body.generationSha256],
    ["requirementsSha256", CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
    ],
    ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2],
    ["argv", body.argv],
    ["environment", body.environment],
    ["files", body.files],
    ["resultMaximumBytes", body.resultMaximumBytes],
  ]);
}

function successorProjection(body, bytes) {
  const unsigned = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_PROJECTION_SCHEMA_V3],
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
    ["authority", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V3],
    ["nonclaims", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}

function artifact(bytes) {
  return deepFreeze(
    nullRecord([
      ["name", "candidate-containment-launch-capsule-v2.json"],
      ["bytes", bytes.length],
      ["sha256", sha256(bytes)],
    ]),
  );
}

export function createCandidateContainmentLaunchCapsuleV3(value) {
  const legacy = createCandidateContainmentLaunchCapsuleV2(value);
  const base = verifyCandidateContainmentLaunchCapsuleV2(legacy.bytes);
  const bytes = canonicalJsonLine(successorBody(base));
  if (bytes.length > CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2) {
    fail("capsule exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [["artifact", artifact(bytes)]]);
}

export function verifyCandidateContainmentLaunchCapsuleV3(bytesValue) {
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
    body.schema !== CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3 ||
    body.requirementsSha256 !==
      CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3 ||
    body.fileDescriptorMapSha256 !==
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3 ||
    body.remapPlanSha256 !== CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3
  ) {
    fail("capsule schema or successor bindings changed");
  }
  const base = verifyCandidateContainmentLaunchCapsuleV2(
    canonicalJsonLine(legacyBody(body)),
  );
  const normalized = successorBody(base);
  return successorProjection(normalized, decoded.bytes);
}
