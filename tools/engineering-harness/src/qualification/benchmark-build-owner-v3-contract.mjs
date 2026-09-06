import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { G17_BENCHMARK_BUILD_PLAN } from "./benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  verifyG17BenchmarkExecutionRequestV2Artifact,
} from "./benchmark-execution-request-v2-contract.mjs";
import {
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
} from "./benchmark-private-build-issuer-v1-contract.mjs";
import {
  createG17BenchmarkPrivateBuildIssuerV1ForTesting,
  isG17BenchmarkPrivateBuildIssuerV1Fault,
  isG17BenchmarkPrivateBuildIssuerV1TestTrace,
  runG17BenchmarkPrivateBuildIssuerV1,
} from "./benchmark-private-build-issuer-v1.mjs";
import { verifyG17CargoExecveatHelperAttestationArtifact } from "./cargo-execveat-helper-attestation-contract.mjs";
import { verifyG17CargoExecveatStatusProtocol } from "./cargo-execveat-status-protocol-contract.mjs";
import { parseG17Elf64 } from "./native-elf.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
  verifyG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "./non-tmpfs-build-isolation-v2-contract.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
  verifyG17NonTmpfsContainmentV2Artifact,
} from "./non-tmpfs-containment-v2-contract.mjs";

// Authority-null replay contract. Imported constants are deliberately not
// treated as capabilities; immutable local copies make that boundary explicit.

function deepFreezeJson(value) {
  return JSON.parse(canonicalJson(value), (_key, child) =>
    child !== null && typeof child === "object" ? Object.freeze(child) : child,
  );
}

function g17PrivateOwnerV3Clone(value) {
  return JSON.parse(canonicalJson(value));
}

function g17PrivateOwnerV3CanonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Reflect.ownKeys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function exactKeys(value, keys, label, fail) {
  if (!hasExactKeys(value, keys)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", `${label} fields drifted`);
  }
  return value;
}

function snapshot(value, label, fail, context = undefined, depth = 0) {
  const budget = context ?? {
    ancestors: new WeakSet(),
    nodes: 0,
    stringBytes: 0,
  };
  if (depth > LIMITS.maximumDepth) {
    fail("LIMIT_EXCEEDED", "input-snapshot", `${label} exceeds depth`);
  }
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} contains Proxy`);
  }
  if (Buffer.isBuffer(value)) {
    if (Object.getPrototypeOf(value) !== Buffer.prototype) {
      fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} Buffer drifted`);
    }
    return Buffer.from(value);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > LIMITS.singleStringUtf8MaximumBytes ||
      budget.stringBytes > LIMITS.aggregateStringUtf8MaximumBytes
    ) {
      fail("LIMIT_EXCEEDED", "input-snapshot", `${label} exceeds strings`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} number drifted`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} is non-JSON`);
  }
  if (budget.ancestors.has(value)) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} contains cycle`);
  }
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} prototype drifted`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (typeof key !== "string") {
      throw fail(
        "INPUT_SHAPE_INVALID",
        "input-snapshot",
        `${label} has symbol fields`,
      );
    }
  }
  if (
    keys.length > LIMITS.maximumPropertiesPerRecord ||
    (array && value.length > LIMITS.maximumArrayLength)
  ) {
    fail("LIMIT_EXCEEDED", "input-snapshot", `${label} shape exceeds bound`);
  }
  budget.nodes += 1;
  if (budget.nodes > LIMITS.maximumNodes) {
    fail("LIMIT_EXCEEDED", "input-snapshot", `${label} exceeds nodes`);
  }
  if (array) {
    const enumerableKeys = Object.keys(value);
    if (
      enumerableKeys.length !== value.length ||
      keys.length !== value.length + 1
    ) {
      fail("INPUT_SHAPE_INVALID", "input-snapshot", `${label} array is sparse`);
    }
    let index = 0;
    while (index < value.length) {
      if (!Object.hasOwn(value, `${index}`)) {
        fail(
          "INPUT_SHAPE_INVALID",
          "input-snapshot",
          `${label} array is sparse`,
        );
      }
      index += 1;
    }
  }
  budget.ancestors.add(value);
  try {
    const outputEntries = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (typeof key !== "string") {
        throw fail(
          "INPUT_SHAPE_INVALID",
          "input-snapshot",
          `${label} has non-string descriptor key`,
        );
      }
      if (key === "length" && array) continue;
      if (!("value" in descriptor) || descriptor.enumerable !== true) {
        throw fail(
          "INPUT_SHAPE_INVALID",
          "input-snapshot",
          `${label}.${key} is not own enumerable data`,
        );
      }
      budget.stringBytes += Buffer.byteLength(key, "utf8");
      if (budget.stringBytes > LIMITS.aggregateStringUtf8MaximumBytes) {
        throw fail(
          "LIMIT_EXCEEDED",
          "input-snapshot",
          `${label} exceeds aggregate property-name and value strings`,
        );
      }
      outputEntries.push(
        Object.freeze([
          key,
          snapshot(
            descriptor.value,
            `${label}.${key}`,
            fail,
            budget,
            depth + 1,
          ),
        ]),
      );
    }
    return array
      ? outputEntries.map((entry) => entry.at(1))
      : Object.fromEntries(outputEntries);
  } finally {
    budget.ancestors.delete(value);
  }
}

function cloneRequestVerification(value) {
  const view = { ...value, bytes: null };
  const copy = JSON.parse(canonicalJson(view));
  copy.bytes = Buffer.from(value.bytes);
  return copy;
}

function cloneHelperEvidence(value) {
  const view = {
    ...value,
    sourceBytes: null,
    compilerBytes: null,
    compilerVersionBytes: null,
    compilerVersionStderrBytes: null,
    compileStdoutBytes: null,
    compileStderrBytes: null,
    executableBytes: null,
  };
  const copy = JSON.parse(canonicalJson(view));
  copy.sourceBytes = Buffer.from(value.sourceBytes);
  copy.compilerBytes = Buffer.from(value.compilerBytes);
  copy.compilerVersionBytes = Buffer.from(value.compilerVersionBytes);
  copy.compilerVersionStderrBytes = Buffer.from(
    value.compilerVersionStderrBytes,
  );
  copy.compileStdoutBytes = Buffer.from(value.compileStdoutBytes);
  copy.compileStderrBytes = Buffer.from(value.compileStderrBytes);
  copy.executableBytes = Buffer.from(value.executableBytes);
  return copy;
}

function cloneHelperVerification(value) {
  const view = { ...value, bytes: null, evidence: null };
  const copy = JSON.parse(canonicalJson(view));
  copy.bytes = Buffer.from(value.bytes);
  copy.evidence = cloneHelperEvidence(value.evidence);
  return copy;
}

function cloneContainmentVerification(value) {
  const expectedView = {
    ...value.expected,
    executionRequestVerification: null,
    helperAttestationVerification: null,
    cgroupProcsBytes: null,
    cgroupEventsBytes: null,
    cgroupPidsCurrentBytes: null,
  };
  const view = { ...value, bytes: null, expected: expectedView };
  const copy = JSON.parse(canonicalJson(view));
  copy.bytes = Buffer.from(value.bytes);
  copy.expected.executionRequestVerification = cloneRequestVerification(
    value.expected.executionRequestVerification,
  );
  copy.expected.helperAttestationVerification = cloneHelperVerification(
    value.expected.helperAttestationVerification,
  );
  copy.expected.cgroupProcsBytes = Buffer.from(value.expected.cgroupProcsBytes);
  copy.expected.cgroupEventsBytes = Buffer.from(
    value.expected.cgroupEventsBytes,
  );
  copy.expected.cgroupPidsCurrentBytes = Buffer.from(
    value.expected.cgroupPidsCurrentBytes,
  );
  return copy;
}

function rejectDuplicateJsonMembers(source, label, fail) {
  let index = 0;
  let nodes = 0;
  const failJson = (reason) =>
    fail(
      "OBSERVATION_BINDING_DRIFT",
      "cargo-jsonl-validation",
      `${label} ${reason}`,
    );
  const whitespace = () => {
    while ([" ", "\t", "\r", "\n"].includes(source.at(index))) index += 1;
  };
  const stringToken = () => {
    if (source.at(index) !== '"') failJson("has a non-string object member");
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source.at(index);
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (error) {
          failJson(`has an invalid string token: ${error.message}`);
        }
      }
      if (character === "\\") {
        index += 1;
        const escape = source.at(index);
        if (escape === "u") {
          const digits = source.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) {
            failJson("has an invalid Unicode escape");
          }
          index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          failJson("has an invalid string escape");
        }
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        failJson("has an unescaped control character");
      }
      index += 1;
    }
    failJson("has an unterminated string");
  };
  const parseValue = (depth) => {
    if (depth > LIMITS.maximumDepth) failJson("exceeds the JSON depth limit");
    nodes += 1;
    if (nodes > LIMITS.maximumNodes) failJson("exceeds the JSON node limit");
    whitespace();
    if (source.at(index) === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (source.at(index) === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        const key = stringToken();
        if (keys.has(key)) failJson(`duplicates object member ${String(key)}`);
        keys.add(key);
        if (keys.size > LIMITS.maximumPropertiesPerRecord) {
          failJson("exceeds the object-member limit");
        }
        whitespace();
        if (source.at(index) !== ":")
          failJson("has an object member without ':'");
        index += 1;
        parseValue(depth + 1);
        whitespace();
        if (source.at(index) === "}") {
          index += 1;
          return;
        }
        if (source.at(index) !== ",") failJson("has an unterminated object");
        index += 1;
        whitespace();
      }
      failJson("has an unterminated object");
    }
    if (source.at(index) === "[") {
      index += 1;
      whitespace();
      if (source.at(index) === "]") {
        index += 1;
        return;
      }
      let length = 0;
      while (index < source.length) {
        length += 1;
        if (length > LIMITS.maximumArrayLength)
          failJson("exceeds the array limit");
        parseValue(depth + 1);
        whitespace();
        if (source.at(index) === "]") {
          index += 1;
          return;
        }
        if (source.at(index) !== ",") failJson("has an unterminated array");
        index += 1;
      }
      failJson("has an unterminated array");
    }
    if (source.at(index) === '"') {
      stringToken();
      return;
    }
    const start = index;
    while (
      index < source.length &&
      ![",", "]", "}", " ", "\t", "\r", "\n"].includes(source.at(index))
    ) {
      index += 1;
    }
    if (index === start) failJson("has an invalid JSON value");
    try {
      const primitive = JSON.parse(source.slice(start, index));
      if (primitive !== null && typeof primitive === "object") {
        failJson("has an invalid primitive value");
      }
    } catch (error) {
      failJson(`has an invalid primitive value: ${error.message}`);
    }
  };
  parseValue(0);
  whitespace();
  if (index !== source.length) failJson("has trailing JSON data");
}

const OWNER_SCHEMA = "oxigraph.g1.7-benchmark-build-owner/v3";
const PROJECTION_SCHEMA = "oxigraph.g1.7-benchmark-build-owner-projection/v3";
const ARTIFACT_NAME = "benchmark-build-owner-v3.json";
const STATUS = "BUILD_OWNER_V3_REPLAYED_AUTHORITY_NULL";
const READINESS = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const MAX_BYTES = 4 * 1024 * 1024;
const LIMITS = Object.freeze({
  artifactMaximumBytes: MAX_BYTES,
  sourceProjectionMaximumBytes: 16 * 1024 * 1024,
  executionRequestV2MaximumBytes: 2 * 1024 * 1024,
  helperAttestationV1MaximumBytes: 4 * 1024 * 1024,
  statusTranscriptV1MaximumBytes: 4_096,
  isolationPolicyV2MaximumBytes: 1024 * 1024,
  containmentV2MaximumBytes: 2 * 1024 * 1024,
  combinedOutputMaximumBytes: 64 * 1024 * 1024,
  executableMaximumBytes: 64 * 1024 * 1024,
  cgroupFileMaximumBytes: 64 * 1024,
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumArrayLength: 4_096,
  maximumPropertiesPerRecord: 4_097,
  aggregateStringUtf8MaximumBytes: 16 * 1024 * 1024,
  singleStringUtf8MaximumBytes: 1024 * 1024,
  propertyNamesCountTowardAggregateStringBudget: true,
  buffersExcludedFromStructuredNodeAndStringBudgets: true,
});
const ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "PRIVATE_CAPABILITY_INVALID",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "IDENTITY_INVALID",
  "PREDECESSOR_BINDING_DRIFT",
  "OBSERVATION_BINDING_DRIFT",
  "LIFECYCLE_CONTRADICTION",
  "AUTHORITY_OVERCLAIM",
  "EXPECTED_INPUT_MISMATCH",
]);
const AUTHORITY = Object.freeze(
  JSON.parse(
    '{"buildExecutionAuthority":false,"launchExecutionAuthority":false,"helperExecutionAuthority":false,"cargoExecutionAuthority":false,"containmentExecutionAuthority":false,"nativeProcessExecutionAuthority":false,"nativeObservationAuthority":false,"physicalIssuanceAuthority":false,"cleanupAuthority":false,"controlExecutionAuthority":false,"qualificationExecutionAuthority":false,"receiptAuthority":false,"promotionAuthority":false,"publicationAuthority":false,"providerExecutionAuthority":false,"routerQualityAuthority":false}',
  ),
);
const NONCLAIMS = Object.freeze(
  JSON.parse(
    '{"physicalOwnerIssued":false,"privatePhysicalIssuerImplemented":false,"nativeHelperImplemented":false,"helperAttestationObserved":false,"helperInitialLaunchObserved":false,"helperDescriptorMapObserved":false,"helperCloexecTransitionObserved":false,"helperStatusProtocolObserved":false,"cargoExecveatObserved":false,"cargoExecutionObserved":false,"rustcExecutionObserved":false,"containmentV2Implemented":false,"nativeContainmentAdapterImplemented":false,"containmentApplied":false,"clone3CgroupPlacementObserved":false,"directChildPidfdWaitidAttested":false,"cgroupQuiescenceObserved":false,"serializedRequestProvesPhysicalLaunch":false,"controlAuthorizationApproved":false,"callerSuppliedBytesProveNativeOrigin":false,"sourceDigestProvesReviewedSemantics":false,"compilerDigestProvesInvocation":false,"compilerVersionReplayProvesObservedProcess":false,"compileStreamsProveCompilerRan":false,"executableDigestProvesCompilerOutput":false,"metadataReplayProvesHeldDescriptor":false,"elfReplayProvesSafeExecution":false,"attestationReplayBindsExecutionRequest":false,"requestPlaceholderIsExecutionBinding":false,"helperRuntimeArgvBoundToExecutionRequest":false,"helperRuntimeEnvironmentBoundToExecutionRequest":false,"helperValidatesExecutionRequestBinding":false,"helperExecutionObserved":false,"privateCoLocatedIssuerImplemented":false,"physicalEligibility":false,"serializedReplayProvesNativeOrigin":false,"serializedReplayProvesObservationOrder":false,"serializedClone3ClaimProvesSyscall":false,"serializedClone3ClaimProvesInitialCgroupPlacement":false,"serializedCloneArgsProveKernelInput":false,"serializedPidfdClaimProvesKernelPidfd":false,"serializedPidfdPollClaimProvesReadiness":false,"serializedWaitidClaimProvesDirectChildReap":false,"serializedPidfdCloseClaimProvesClose":false,"serializedQuiescenceBytesProveKernelOrigin":false,"serializedCgroupPathProvesHeldDirectory":false,"serializedDescriptorClaimProvesParentOnlyIsolation":false,"serializedHelperImageReachedClaimProvesTransition":false,"serializedRequestAndHelperFanInProvesCoLocatedIssuer":false,"replayProvesNoPostSpawnCgroupMove":false,"replayProvesNoForkFallback":false,"replayProvesNoCloneFallback":false,"replayProvesLifecycleOrder":false,"replayProvesCleanupOrder":false,"cleanupExecuted":false,"physicalOriginProven":false,"productionLifecycleEntrypointImplemented":false,"sourceWorkspaceBuildBegun":false,"sourceWorkspaceTerminalRevalidationObserved":false,"exactExecutionRequestV2Constructed":false,"heldDescriptorPreparationObserved":false,"childDescriptorAliasExclusionObserved":false,"durableCommitObserved":false,"qualifiedHelperImageExecutionObserved":false,"statusTerminalSequenceObserved":false,"stdoutClosureAndEofObserved":false,"stderrClosureAndEofObserved":false,"cargoJsonlValidityObserved":false,"cargoProcessOutcomeObserved":false,"exclusiveDirectChildPidfdWaitObserved":false,"completeCgroupQuiescenceObserved":false,"heldTargetAncestryObserved":false,"heldTargetElfObserved":false,"productionWorkspaceFinishObserved":false,"privatePhysicalOriginCapabilityMinted":false,"buildOwnerV3Issued":false,"productOwnerV4Issued":false,"phaseAApproved":false,"phaseBApproved":false,"liveG17ControlExecuted":false,"liveG17SampleExecuted":false,"benchmarkQualificationObserved":false,"qualificationReceiptIssued":false,"humanPromotionObserved":false,"productionReady":false,"currentHostSupported":false,"g22CommitAuthorityInherited":false,"applicationOutputReleased":false,"applicationReceiptIssued":false,"legacyEvidenceReinterpreted":false,"retryAfterDurableCommitPermitted":false,"destructiveCleanupAfterAmbiguityPermitted":false,"serializedReplayProvesPrivateCapabilityConsumption":false,"syntheticTestCapabilityProvesIssuerOrigin":false,"buildOwnerV3PhysicalOriginProven":false}',
  ),
);
const POLICY_BINDING = deepFreezeJson(
  JSON.parse(
    '{"schema":"oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2","rawSha256":"3a61f4ae75c935225bfbd6fd150ba0ad40b2001619905517f3420168651e9821","contentHash":"09a153292f3dca88807cda2907a527a07914909c728ba319506c1d26b5058022","status":"DORMANT_REQUIREMENTS_ONLY","requirementMode":"prescriptive-not-observed","fileDescriptorsSha256":"632934198725f4b8919865da7c74bd0eddd0b70457aa21b44d373ce905d7625e","statusProtocol":{"schema":"oxigraph.g1.7-cargo-execveat-status/v1","requirementsSha256":"17ed08ca3e507fa55cb2477bdf6c37aef66c6300f64acc112e953f0e7997eb4d"},"requiredContainmentSchema":"oxigraph.g1.7-non-tmpfs-containment-evidence/v2"}',
  ),
);
const DESCRIPTOR_BOUNDARY = JSON.parse(
  '{"fileDescriptorsSha256":"632934198725f4b8919865da7c74bd0eddd0b70457aa21b44d373ce905d7625e","exactChildDescriptorRange":{"first":0,"last":8,"descriptorsAtOrAbove":9,"dispositionAtHelperEntry":"close-range-fail-closed","closeRange":{"syscall":"close_range","first":9,"last":"UINT_MAX","flags":0,"fallbackLoopForbidden":true,"failureDisposition":"fail-before-ready"}},"childFileDescriptors":[{"childFd":0,"role":"stdinNull","kind":"character-device","descriptorAccess":"read-only","logicalPath":"/dev/null","presentInHelperImage":true,"presentInCargoImage":true,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":false,"lifecycle":"retained-through-cargo-image"},{"childFd":1,"role":"cargoStdout","kind":"pipe-writer","descriptorAccess":"write-only","logicalPath":null,"presentInHelperImage":true,"presentInCargoImage":true,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":false,"lifecycle":"retained-through-cargo-image"},{"childFd":2,"role":"cargoStderr","kind":"pipe-writer","descriptorAccess":"write-only","logicalPath":null,"presentInHelperImage":true,"presentInCargoImage":true,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":false,"lifecycle":"retained-through-cargo-image"},{"childFd":3,"role":"workspaceRoot","kind":"directory","descriptorAccess":"read-only","logicalPath":"/proc/self/fd/3","presentInHelperImage":true,"presentInCargoImage":true,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":false,"lifecycle":"retained-through-cargo-image"},{"childFd":4,"role":"source","kind":"directory","descriptorAccess":"read-only","logicalPath":"/proc/self/fd/4","presentInHelperImage":true,"presentInCargoImage":true,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":false,"lifecycle":"retained-through-cargo-image"},{"childFd":5,"role":"target","kind":"directory","descriptorAccess":"read-only","logicalPath":"/proc/self/fd/5","presentInHelperImage":true,"presentInCargoImage":true,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":false,"lifecycle":"retained-through-cargo-image"},{"childFd":6,"role":"cargoExecutable","kind":"regular-file","descriptorAccess":"read-only","logicalPath":"/proc/self/fd/6","presentInHelperImage":true,"presentInCargoImage":false,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":true,"lifecycle":"helper-private-close-on-cargo-image-transition"},{"childFd":7,"role":"execStatusWriter","kind":"pipe-writer","descriptorAccess":"write-only","logicalPath":null,"presentInHelperImage":true,"presentInCargoImage":false,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":true,"lifecycle":"helper-private-close-on-cargo-image-transition"},{"childFd":8,"role":"helperSelfExecutable","kind":"regular-file","descriptorAccess":"read-only","logicalPath":"/proc/self/fd/8","presentInHelperImage":true,"presentInCargoImage":false,"cloexecAtHelperEntry":false,"cloexecImmediatelyBeforeCargoExecveat":true,"lifecycle":"helper-private-close-on-cargo-image-transition"}],"imageMaps":{"standardFileDescriptors":[0,1,2],"helperImageFileDescriptors":[3,4,5,6,7,8],"helperImageExactOpenFileDescriptors":[0,1,2,3,4,5,6,7,8],"cargoImageInheritedFileDescriptors":[3,4,5],"cargoImageExactOpenFileDescriptors":[0,1,2,3,4,5],"launcherPrivateFileDescriptors":[6,7,8]},"parentOnlyFileDescriptors":[{"role":"execStatusReader","kind":"pipe-reader","descriptorCapabilities":"read-only","fixedFd":null,"entersHelperImage":false,"entersCargoImage":false},{"role":"cgroupDirectory","kind":"directory","descriptorCapabilities":"held-directory-openat-read-write-children","fixedFd":null,"entersHelperImage":false,"entersCargoImage":false},{"role":"directChildPidfd","kind":"pidfd","descriptorCapabilities":"poll-signal-waitid","fixedFd":null,"entersHelperImage":false,"entersCargoImage":false}],"aliasing":{"childNumbersUniqueRequired":true,"childOpenFileDescriptionsPairwiseDistinctRequired":true,"duplicatedChildDescriptorsForbidden":true,"parentOnlyDescriptorsMayNotDuplicateChildDescriptors":true,"parentOnlyFixedNumbersForbidden":true,"workspaceSourceTargetCargoHelperObjectsPairwiseDistinctRequired":true,"sourceAndTargetMustRemainBeneathWorkspaceRoot":true,"statusReaderWriterPipeRelationshipRequired":true,"statusReaderWriterOpenFileDescriptionAliasForbidden":true,"stdoutAndStderrPipeObjectsDistinctRequired":true},"cloexecImmediatelyBeforeCargoExecveat":[6,7,8]}',
);
const CONTAINMENT_REQUIREMENTS_SHA256 =
  "cbac5510abb656932738bdc3231fc9461194a8fd173c15fd144388cc86b3df47";
const G17_PRIVATE_OWNER_V3_TEST_FIXTURE_SCHEMA =
  "oxigraph.g1.7-private-owner-v3-test-fixture/v1";
const ROOT_KEYS = Object.freeze([
  "schema",
  "status",
  "identity",
  "bindings",
  "observations",
  "physicalOrigin",
  "binding",
  "finalDecisionEligible",
  "authority",
  "nonclaims",
  "contentHash",
]);
const IDENTITY_KEYS = Object.freeze([
  "controlRunId",
  "buildId",
  "productRole",
  "ordinal",
  "ownerGeneration",
  "workspaceGeneration",
  "targetGeneration",
  "processGeneration",
  "containmentGeneration",
  "lifecycleGeneration",
]);
const BINDING_KEYS = Object.freeze([
  "issuerRequirements",
  "sourceProjection",
  "executionRequestV2",
  "helperAttestationV1",
  "statusTranscriptV1",
  "isolationPolicyV2",
  "containmentV2",
  "qualifiedNativeAdapter",
  "qualifiedDurableEffect",
]);
const OBSERVATION_KEYS = Object.freeze([
  "helperImage",
  "status",
  "process",
  "streams",
  "cargo",
  "directReap",
  "cgroupQuiescence",
  "target",
  "workspaceFinish",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const ISSUER_REQUIREMENTS_RAW_SHA256 =
  "9d08f2c7edc43c5151b40c335d0309c743c22515bb16d4473535724940cbf9fa";
const HELPER_SOURCE_SHA256 =
  "88353dcc4d4327bbb498fff00e2f228a53011dad57b418dbbea46e40eee0ebd9";
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const CARGO_EXECUTABLE_PATH =
  /^\/state\/target\/release\/deps\/transactional_write-[0-9a-f]{16}$/u;
const GENERATIONS = Object.freeze({
  ownerGeneration: /^g17-owner-[0-9a-f]{64}$/u,
  workspaceGeneration: /^g17-workspace-[0-9a-f]{64}$/u,
  targetGeneration: /^g17-target-[0-9a-f]{64}$/u,
  processGeneration: /^g17-process-[0-9a-f]{64}$/u,
  containmentGeneration: /^g17-containment-[0-9a-f]{64}$/u,
  lifecycleGeneration: /^g17-lifecycle-[0-9a-f]{64}$/u,
});
const SOURCE_AUTHORIZATION = Object.freeze({
  contentHash:
    "964563a364844933066b654dd330841039a140eecbb4aed3d1fe0ae205fb5843",
  rawSha256: "8ae3992245f4075047b284688fdeed8fb4b252eac235e1ee0aa4ecfe5bc8107b",
});
const SOURCE_IDENTITIES = Object.freeze({
  negativeControl: Object.freeze({
    cargoLockBytes: 80_849,
    effectiveTree: "4949301d1b66d7a104692d12230023757bdf1ca0",
    entryCount: 3_643,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "d7f48ddec5de69278331cda275d26409ae0d71dda7b9c0938aa4e017bb525f0b",
    objectClosureSha256:
      "c696f36ad9b3685e74b7ccea467b24311a73a95472ffccb7791670f1fafde946",
    totalBytes: 55_442_023,
  }),
  performanceReference: Object.freeze({
    cargoLockBytes: 80_849,
    effectiveTree: "2f800745c958c8d749af40ae66324c41f6fe409b",
    entryCount: 3_741,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "c7561984854820bd7334b37ea10bfc42b86cc70cb436f4f7068cdee220604840",
    objectClosureSha256:
      "15c3383bbc2a86e8fca7bcd1485bcf3ae142658b226a87d77ce853c9dfa75eda",
    totalBytes: 56_312_782,
  }),
  noiseControlA: Object.freeze({
    cargoLockBytes: 80_849,
    effectiveTree: "a8b0310482b88a813aa602ebb7264b259e066586",
    entryCount: 3_774,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "4a3b41efe8883ec3c77a5ec752c34b20d56c3080bd9c1df05fcffb91b9300473",
    objectClosureSha256:
      "305374693bba169a812f62b2eac4208f3355a5582401e12421b9194aa7b86b75",
    totalBytes: 56_959_926,
  }),
  noiseControlB: Object.freeze({
    cargoLockBytes: 80_849,
    effectiveTree: "a8b0310482b88a813aa602ebb7264b259e066586",
    entryCount: 3_774,
    evaluatorPatchBytes: 12_434,
    manifestSha256:
      "4a3b41efe8883ec3c77a5ec752c34b20d56c3080bd9c1df05fcffb91b9300473",
    objectClosureSha256:
      "305374693bba169a812f62b2eac4208f3355a5582401e12421b9194aa7b86b75",
    totalBytes: 56_959_926,
  }),
});

const FIXTURE_KEYS = Object.freeze([
  "schema",
  "identity",
  "issuerRequirements",
  "sourceProjectionBytes",
  "executionRequestV2Verification",
  "helperAttestationV1Verification",
  "statusTranscriptV1Verification",
  "isolationPolicyV2Bytes",
  "containmentV2Verification",
  "stdoutBytes",
  "stderrBytes",
  "cgroupProcsBytes",
  "cgroupEventsBytes",
  "cgroupPidsCurrentBytes",
  "executableBytes",
  "observations",
  "qualifiedNativeAdapter",
  "qualifiedDurableEffect",
]);

function expectedPrivateIssuerTrace() {
  return {
    schema: "oxigraph.g1.7-benchmark-private-build-issuer-test-trace/v1",
    phase: "canonical-build-owner-v3-issuance",
    outcome: "FAIL",
    retained: {
      workspace: false,
      cgroup: false,
      descriptors: false,
      handles: false,
      evidence: false,
    },
    retryAllowed: false,
    relaunchAllowed: false,
    targetReleaseAllowed: false,
    ownerIssuanceAllowed: false,
    durableCommitObserved: true,
    adapterCalls: 1,
    physicalOrigin: false,
    binding: null,
    finalDecisionEligible: false,
    authority: g17PrivateOwnerV3Clone(AUTHORITY),
    nonclaims: g17PrivateOwnerV3Clone(
      JSON.parse(
        '{"physicalOwnerIssued":false,"privatePhysicalIssuerImplemented":false,"nativeHelperImplemented":false,"helperAttestationObserved":false,"helperInitialLaunchObserved":false,"helperDescriptorMapObserved":false,"helperCloexecTransitionObserved":false,"helperStatusProtocolObserved":false,"cargoExecveatObserved":false,"cargoExecutionObserved":false,"rustcExecutionObserved":false,"containmentV2Implemented":false,"nativeContainmentAdapterImplemented":false,"containmentApplied":false,"clone3CgroupPlacementObserved":false,"directChildPidfdWaitidAttested":false,"cgroupQuiescenceObserved":false,"serializedRequestProvesPhysicalLaunch":false,"controlAuthorizationApproved":false,"callerSuppliedBytesProveNativeOrigin":false,"sourceDigestProvesReviewedSemantics":false,"compilerDigestProvesInvocation":false,"compilerVersionReplayProvesObservedProcess":false,"compileStreamsProveCompilerRan":false,"executableDigestProvesCompilerOutput":false,"metadataReplayProvesHeldDescriptor":false,"elfReplayProvesSafeExecution":false,"attestationReplayBindsExecutionRequest":false,"requestPlaceholderIsExecutionBinding":false,"helperRuntimeArgvBoundToExecutionRequest":false,"helperRuntimeEnvironmentBoundToExecutionRequest":false,"helperValidatesExecutionRequestBinding":false,"helperExecutionObserved":false,"privateCoLocatedIssuerImplemented":false,"physicalEligibility":false,"serializedReplayProvesNativeOrigin":false,"serializedReplayProvesObservationOrder":false,"serializedClone3ClaimProvesSyscall":false,"serializedClone3ClaimProvesInitialCgroupPlacement":false,"serializedCloneArgsProveKernelInput":false,"serializedPidfdClaimProvesKernelPidfd":false,"serializedPidfdPollClaimProvesReadiness":false,"serializedWaitidClaimProvesDirectChildReap":false,"serializedPidfdCloseClaimProvesClose":false,"serializedQuiescenceBytesProveKernelOrigin":false,"serializedCgroupPathProvesHeldDirectory":false,"serializedDescriptorClaimProvesParentOnlyIsolation":false,"serializedHelperImageReachedClaimProvesTransition":false,"serializedRequestAndHelperFanInProvesCoLocatedIssuer":false,"replayProvesNoPostSpawnCgroupMove":false,"replayProvesNoForkFallback":false,"replayProvesNoCloneFallback":false,"replayProvesLifecycleOrder":false,"replayProvesCleanupOrder":false,"cleanupExecuted":false,"physicalOriginProven":false,"productionLifecycleEntrypointImplemented":false,"sourceWorkspaceBuildBegun":false,"sourceWorkspaceTerminalRevalidationObserved":false,"exactExecutionRequestV2Constructed":false,"heldDescriptorPreparationObserved":false,"childDescriptorAliasExclusionObserved":false,"durableCommitObserved":false,"qualifiedHelperImageExecutionObserved":false,"statusTerminalSequenceObserved":false,"stdoutClosureAndEofObserved":false,"stderrClosureAndEofObserved":false,"cargoJsonlValidityObserved":false,"cargoProcessOutcomeObserved":false,"exclusiveDirectChildPidfdWaitObserved":false,"completeCgroupQuiescenceObserved":false,"heldTargetAncestryObserved":false,"heldTargetElfObserved":false,"productionWorkspaceFinishObserved":false,"privatePhysicalOriginCapabilityMinted":false,"buildOwnerV3Issued":false,"productOwnerV4Issued":false,"phaseAApproved":false,"phaseBApproved":false,"liveG17ControlExecuted":false,"liveG17SampleExecuted":false,"benchmarkQualificationObserved":false,"qualificationReceiptIssued":false,"humanPromotionObserved":false,"productionReady":false,"currentHostSupported":false,"g22CommitAuthorityInherited":false,"applicationOutputReleased":false,"applicationReceiptIssued":false,"legacyEvidenceReinterpreted":false,"retryAfterDurableCommitPermitted":false,"destructiveCleanupAfterAmbiguityPermitted":false}',
      ),
    ),
  };
}

function createContract() {
  const liveCapabilities = new WeakMap();
  const codes = new Set(ERROR_CODES);

  class G17BenchmarkBuildOwnerV3ContractError extends Error {
    constructor(code, phase, message, options = undefined) {
      if (!codes.has(code)) throw new TypeError("unknown build-owner-v3 code");
      super(
        `G1.7 benchmark build owner v3 contract: [${code}] ${phase}: ${message}`,
        options,
      );
      this.name = "G17BenchmarkBuildOwnerV3ContractError";
      this.code = code;
      this.phase = phase;
    }
  }

  function fail(code, phase, message, cause = undefined) {
    throw new G17BenchmarkBuildOwnerV3ContractError(
      code,
      phase,
      message,
      cause === undefined ? undefined : { cause },
    );
  }

  function bounded(bytes, maximum, label) {
    if (!Buffer.isBuffer(bytes) || types.isProxy(bytes)) {
      fail(
        "INPUT_SHAPE_INVALID",
        "buffer-validation",
        `${label} is not Buffer`,
      );
    }
    const copied = Buffer.from(bytes);
    if (copied.length > maximum) {
      fail("LIMIT_EXCEEDED", "buffer-validation", `${label} exceeds bound`);
    }
    return copied;
  }

  function digest(value, label) {
    if (typeof value !== "string" || !DIGEST.test(value)) {
      fail("IDENTITY_INVALID", "identity-validation", `${label} drifted`);
    }
    return value;
  }

  function decodeSealed(bytes, maximum, label) {
    const captured = bounded(bytes, maximum, label);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(captured);
    } catch (error) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} is not UTF-8`,
        error,
      );
    }
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} framing drifted`,
      );
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} JSON drifted`,
        error,
      );
    }
    value = snapshot(value, label, fail);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} is not a record`,
      );
    }
    if (!captured.equals(g17PrivateOwnerV3CanonicalBytes(value))) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-decoding",
        `${label} is not canonical`,
      );
    }
    const { contentHash, ...unsigned } = value;
    if (
      typeof contentHash !== "string" ||
      contentHash !== canonicalSha256(unsigned)
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-self-hash",
        `${label} contentHash drifted`,
      );
    }
    return {
      value,
      bytes: captured,
      identity: {
        schema: value.schema,
        rawSha256: sha256(captured),
        contentHash,
      },
    };
  }

  function exactIdentity(value, label) {
    exactKeys(value, ["schema", "rawSha256", "contentHash"], label, fail);
    digest(value.rawSha256, `${label}.rawSha256`);
    digest(value.contentHash, `${label}.contentHash`);
    return value;
  }

  function replayDependency(
    label,
    operation,
    code = "PREDECESSOR_BINDING_DRIFT",
  ) {
    try {
      return operation();
    } catch (error) {
      fail(
        code,
        "predecessor-verification",
        `${label} did not pass its native verifier`,
        error,
      );
    }
  }

  function validateSourceProjection(bytes, expected) {
    const source = decodeSealed(
      bytes,
      LIMITS.sourceProjectionMaximumBytes,
      "source projection",
    );
    const value = source.value;
    exactKeys(
      value,
      [
        "authority",
        "authorization",
        "buildId",
        "contentHash",
        "controlRunId",
        "evaluator",
        "product",
        "productRole",
        "schema",
        "source",
        "workspace",
      ],
      "source projection",
      fail,
    );
    exactKeys(
      value.authority,
      [
        "build",
        "control",
        "launch",
        "promotion",
        "provider",
        "publication",
        "qualification",
        "routerQuality",
      ],
      "source authority",
      fail,
    );
    exactKeys(
      value.authorization,
      ["contentHash", "rawSha256"],
      "source authorization",
      fail,
    );
    exactKeys(
      value.product,
      ["cargoLockBlob", "cargoLockSha256", "commit", "tree"],
      "source product",
      fail,
    );
    exactKeys(
      value.evaluator,
      ["commit", "composition", "parent", "patchSha256", "paths", "tree"],
      "source evaluator",
      fail,
    );
    exactKeys(
      value.evaluator.composition,
      [
        "baseManifestBlob",
        "effectiveManifestBlob",
        "effectiveManifestSha256",
        "effectiveTree",
        "mode",
      ],
      "source evaluator composition",
      fail,
    );
    if (
      !Array.isArray(value.evaluator.paths) ||
      value.evaluator.paths.length < 1
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-verification",
        "source evaluator paths drifted",
      );
    }
    for (const [index, path] of value.evaluator.paths.entries()) {
      exactKeys(
        path,
        ["blob", "changeStatus", "contentSha256", "path"],
        `source evaluator path ${index}`,
        fail,
      );
    }
    exactKeys(
      value.workspace,
      [
        "generation",
        "isolated",
        "parentRoot",
        "sourceChild",
        "sourceReadOnlyAtBuildStart",
        "targetChild",
        "targetEmptyAtBuildStart",
        "targetGeneration",
        "targetIsolated",
      ],
      "source workspace",
      fail,
    );
    exactKeys(
      value.workspace.parentRoot,
      ["device", "filesystemType", "gid", "inode", "uid"],
      "source workspace parent",
      fail,
    );
    for (const [childName, child] of [
      ["sourceChild", value.workspace.sourceChild],
      ["targetChild", value.workspace.targetChild],
    ]) {
      exactKeys(
        child,
        [
          "device",
          "filesystemType",
          "gid",
          "inode",
          "leafName",
          "parentDevice",
          "parentInode",
          "uid",
        ],
        `source workspace ${childName}`,
        fail,
      );
    }
    exactKeys(
      value.source,
      [
        "cargoLock",
        "effectiveTree",
        "entryCount",
        "evaluatorPatch",
        "excludedGitlinks",
        "manifestSha256",
        "objectClosureSha256",
        "productCommit",
        "productTree",
        "requiredGitlinks",
        "symlinks",
        "totalBytes",
      ],
      "source materialization",
      fail,
    );
    exactKeys(
      value.source.cargoLock,
      ["blob", "bytes", "sha256"],
      "source Cargo lock",
      fail,
    );
    exactKeys(
      value.source.evaluatorPatch,
      ["bytes", "sha256"],
      "source evaluator patch",
      fail,
    );
    for (const [name, entries, keys] of [
      ["excludedGitlinks", value.source.excludedGitlinks, ["commit", "path"]],
      [
        "requiredGitlinks",
        value.source.requiredGitlinks,
        ["commit", "entryCount", "manifestSha256", "path", "tree"],
      ],
      ["symlinks", value.source.symlinks, ["gitBlob", "path", "target"]],
    ]) {
      if (!Array.isArray(entries)) {
        fail(
          "PREDECESSOR_BINDING_DRIFT",
          "predecessor-verification",
          `source ${name} is not an array`,
        );
      }
      for (const [index, entry] of entries.entries()) {
        exactKeys(entry, keys, `source ${name} ${index}`, fail);
      }
    }
    const sourceIdentity =
      expected.identity.buildId === "negative-control"
        ? SOURCE_IDENTITIES.negativeControl
        : expected.identity.buildId === "performance-reference"
          ? SOURCE_IDENTITIES.performanceReference
          : expected.identity.buildId === "noise-control-a"
            ? SOURCE_IDENTITIES.noiseControlA
            : expected.identity.buildId === "noise-control-b"
              ? SOURCE_IDENTITIES.noiseControlB
              : undefined;
    const sourcePaths = [
      ...value.evaluator.paths.map(({ path }) => path),
      ...value.source.requiredGitlinks.map(({ path }) => path),
      ...value.source.excludedGitlinks.map(({ path }) => path),
      ...value.source.symlinks.map(({ path }) => path),
    ];
    const gitObjects = [
      value.product.cargoLockBlob,
      value.product.commit,
      value.product.tree,
      value.evaluator.commit,
      value.evaluator.parent,
      value.evaluator.tree,
      value.evaluator.composition.baseManifestBlob,
      value.evaluator.composition.effectiveManifestBlob,
      value.evaluator.composition.effectiveTree,
      ...value.evaluator.paths.map(({ blob }) => blob),
      ...value.source.requiredGitlinks.flatMap(({ commit, tree }) => [
        commit,
        tree,
      ]),
      ...value.source.excludedGitlinks.map(({ commit }) => commit),
      ...value.source.symlinks.map(({ gitBlob }) => gitBlob),
    ];
    const sourceObjectClosureSha256 = canonicalSha256({
      schema: "oxigraph.g1.7-product-source-object-closure/v1",
      product: value.product,
      evaluator: value.evaluator,
      effectiveTree: value.source.effectiveTree,
      requiredGitlinks: value.source.requiredGitlinks,
      excludedGitlinks: value.source.excludedGitlinks,
      symlinks: value.source.symlinks,
    });
    const generationCoordinate = {
      schema: "oxigraph.g1.7-product-source-generation-coordinate/v1",
      controlRunId: value.controlRunId,
      buildId: value.buildId,
      productRole: value.productRole,
      authorization: value.authorization,
      parentRoot: value.workspace.parentRoot,
      sourceChild: value.workspace.sourceChild,
      targetChild: value.workspace.targetChild,
    };
    const workspaceGeneration = `g17-workspace-${canonicalSha256({
      ...generationCoordinate,
      kind: "workspace",
    })}`;
    const targetGeneration = `g17-target-${canonicalSha256({
      ...generationCoordinate,
      kind: "target",
    })}`;
    if (
      value.schema !== "oxigraph.g1.7-product-source-projection/v1" ||
      value.controlRunId !== expected.identity.controlRunId ||
      value.buildId !== expected.identity.buildId ||
      value.productRole !== expected.identity.productRole ||
      sourceIdentity === undefined ||
      !isDeepStrictEqual(value.authorization, SOURCE_AUTHORIZATION) ||
      value.workspace.generation !== workspaceGeneration ||
      value.workspace.targetGeneration !== targetGeneration ||
      value.workspace.generation !== expected.identity.workspaceGeneration ||
      value.workspace.targetGeneration !== expected.identity.targetGeneration ||
      value.workspace.isolated !== true ||
      value.workspace.targetIsolated !== true ||
      value.workspace.sourceReadOnlyAtBuildStart !== true ||
      value.workspace.targetEmptyAtBuildStart !== true ||
      value.workspace.sourceChild.leafName !== "source" ||
      value.workspace.targetChild.leafName !== "target" ||
      value.workspace.sourceChild.parentDevice !==
        value.workspace.parentRoot.device ||
      value.workspace.sourceChild.parentInode !==
        value.workspace.parentRoot.inode ||
      value.workspace.targetChild.parentDevice !==
        value.workspace.parentRoot.device ||
      value.workspace.targetChild.parentInode !==
        value.workspace.parentRoot.inode ||
      value.source.productCommit !== value.product.commit ||
      value.source.productTree !== value.product.tree ||
      value.source.cargoLock.blob !== value.product.cargoLockBlob ||
      value.source.cargoLock.sha256 !== value.product.cargoLockSha256 ||
      value.source.evaluatorPatch.sha256 !== value.evaluator.patchSha256 ||
      value.source.effectiveTree !==
        value.evaluator.composition.effectiveTree ||
      value.source.objectClosureSha256 !== sourceObjectClosureSha256 ||
      value.source.effectiveTree !== sourceIdentity.effectiveTree ||
      value.source.entryCount !== sourceIdentity.entryCount ||
      value.source.manifestSha256 !== sourceIdentity.manifestSha256 ||
      value.source.objectClosureSha256 !== sourceIdentity.objectClosureSha256 ||
      value.source.totalBytes !== sourceIdentity.totalBytes ||
      value.source.cargoLock.bytes !== sourceIdentity.cargoLockBytes ||
      value.source.evaluatorPatch.bytes !==
        sourceIdentity.evaluatorPatchBytes ||
      !Number.isSafeInteger(value.source.entryCount) ||
      value.source.entryCount < 1 ||
      !Number.isSafeInteger(value.source.totalBytes) ||
      value.source.totalBytes < 1 ||
      gitObjects.some((object) => !GIT_OBJECT.test(object ?? "")) ||
      sourcePaths.some(
        (path) =>
          typeof path !== "string" ||
          path.length === 0 ||
          path.startsWith("/") ||
          path.split("/").some((part) => part === "" || part === ".."),
      ) ||
      new Set(sourcePaths).size !== sourcePaths.length ||
      value.authority.build !== false ||
      value.authority.control !== false ||
      value.authority.launch !== false ||
      value.authority.promotion !== false ||
      value.authority.provider !== false ||
      value.authority.publication !== false ||
      value.authority.qualification !== false ||
      value.authority.routerQuality !== false
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-verification",
        "source projection structure drifted",
      );
    }
    for (const digestValue of [
      value.authorization.rawSha256,
      value.authorization.contentHash,
      value.product.cargoLockSha256,
      value.evaluator.patchSha256,
      value.evaluator.composition.effectiveManifestSha256,
      ...value.evaluator.paths.map(({ contentSha256 }) => contentSha256),
      value.source.cargoLock.sha256,
      value.source.evaluatorPatch.sha256,
      value.source.manifestSha256,
      value.source.objectClosureSha256,
      ...value.source.requiredGitlinks.map(
        ({ manifestSha256 }) => manifestSha256,
      ),
    ]) {
      digest(digestValue, "source projection digest");
    }
    for (const entry of value.source.requiredGitlinks) {
      if (!Number.isSafeInteger(entry.entryCount) || entry.entryCount < 1) {
        fail(
          "PREDECESSOR_BINDING_DRIFT",
          "predecessor-verification",
          "source required Gitlink entry count drifted",
        );
      }
    }
    return source;
  }

  function validateFixture(raw) {
    const fixture = snapshot(raw, "test fixture", fail);
    exactKeys(fixture, FIXTURE_KEYS, "test fixture", fail);
    if (fixture.schema !== G17_PRIVATE_OWNER_V3_TEST_FIXTURE_SCHEMA) {
      fail("IDENTITY_INVALID", "identity-validation", "fixture schema drifted");
    }
    exactKeys(fixture.identity, IDENTITY_KEYS, "fixture identity", fail);
    if (
      !Number.isSafeInteger(fixture.identity.ordinal) ||
      fixture.identity.ordinal < 1 ||
      fixture.identity.ordinal > G17_BENCHMARK_BUILD_PLAN.length
    ) {
      fail("IDENTITY_INVALID", "identity-validation", "build order drifted");
    }
    const plan = G17_BENCHMARK_BUILD_PLAN.at(fixture.identity.ordinal - 1);
    if (
      fixture.identity.buildId !== plan.buildId ||
      fixture.identity.productRole !== plan.productRole ||
      typeof fixture.identity.controlRunId !== "string"
    ) {
      fail("IDENTITY_INVALID", "identity-validation", "build order drifted");
    }
    const generationValues = [];
    for (const [field, pattern, generationValue] of [
      [
        "ownerGeneration",
        GENERATIONS.ownerGeneration,
        fixture.identity.ownerGeneration,
      ],
      [
        "workspaceGeneration",
        GENERATIONS.workspaceGeneration,
        fixture.identity.workspaceGeneration,
      ],
      [
        "targetGeneration",
        GENERATIONS.targetGeneration,
        fixture.identity.targetGeneration,
      ],
      [
        "processGeneration",
        GENERATIONS.processGeneration,
        fixture.identity.processGeneration,
      ],
      [
        "containmentGeneration",
        GENERATIONS.containmentGeneration,
        fixture.identity.containmentGeneration,
      ],
      [
        "lifecycleGeneration",
        GENERATIONS.lifecycleGeneration,
        fixture.identity.lifecycleGeneration,
      ],
    ]) {
      if (!pattern.test(generationValue ?? "")) {
        fail("IDENTITY_INVALID", "identity-validation", `${field} drifted`);
      }
      generationValues.push(generationValue);
    }
    if (new Set(generationValues).size !== generationValues.length) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "generation identities are not distinct",
      );
    }
    const issuerRequirements = exactIdentity(
      fixture.issuerRequirements,
      "issuer requirements",
    );
    if (
      issuerRequirements.schema !==
        "oxigraph.g1.7-benchmark-private-build-issuer-requirements/v1" ||
      issuerRequirements.rawSha256 !== ISSUER_REQUIREMENTS_RAW_SHA256 ||
      issuerRequirements.contentHash !==
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-binding",
        "issuer requirements schema drifted",
      );
    }
    const source = validateSourceProjection(fixture.sourceProjectionBytes, {
      identity: fixture.identity,
    });
    exactKeys(
      fixture.executionRequestV2Verification,
      ["bytes", "expected"],
      "execution request v2 verification",
      fail,
    );
    const requestVerification = {
      bytes: bounded(
        fixture.executionRequestV2Verification.bytes,
        LIMITS.executionRequestV2MaximumBytes,
        "execution request v2",
      ),
      expected: fixture.executionRequestV2Verification.expected,
    };
    const request = replayDependency("execution request v2", () =>
      verifyG17BenchmarkExecutionRequestV2Artifact(requestVerification),
    );
    exactKeys(
      fixture.helperAttestationV1Verification,
      ["bytes", "evidence"],
      "helper attestation v1 verification",
      fail,
    );
    const helperVerification = {
      bytes: bounded(
        fixture.helperAttestationV1Verification.bytes,
        LIMITS.helperAttestationV1MaximumBytes,
        "helper attestation v1",
      ),
      evidence: fixture.helperAttestationV1Verification.evidence,
    };
    const helper = replayDependency("helper attestation v1", () =>
      verifyG17CargoExecveatHelperAttestationArtifact(helperVerification),
    );
    const helperDocument = decodeSealed(
      helperVerification.bytes,
      LIMITS.helperAttestationV1MaximumBytes,
      "helper attestation v1",
    );
    const policyBytes = bounded(
      fixture.isolationPolicyV2Bytes,
      LIMITS.isolationPolicyV2MaximumBytes,
      "isolation policy v2",
    );
    const policy = replayDependency("isolation policy v2", () =>
      verifyG17NonTmpfsBuildIsolationV2PolicyArtifact(policyBytes),
    );
    exactKeys(
      fixture.containmentV2Verification,
      ["bytes", "expected"],
      "containment v2 verification",
      fail,
    );
    const containmentVerification = {
      bytes: bounded(
        fixture.containmentV2Verification.bytes,
        LIMITS.containmentV2MaximumBytes,
        "containment v2",
      ),
      expected: fixture.containmentV2Verification.expected,
    };
    const containment = replayDependency("containment v2", () =>
      verifyG17NonTmpfsContainmentV2Artifact(containmentVerification),
    );
    const containmentDocument = decodeSealed(
      containmentVerification.bytes,
      LIMITS.containmentV2MaximumBytes,
      "containment v2",
    );
    exactKeys(
      fixture.statusTranscriptV1Verification,
      ["bytes", "observation"],
      "status transcript v1 verification",
      fail,
    );
    const statusBytes = bounded(
      fixture.statusTranscriptV1Verification.bytes,
      LIMITS.statusTranscriptV1MaximumBytes,
      "status transcript",
    );
    const status = replayDependency(
      "status protocol v1",
      () =>
        verifyG17CargoExecveatStatusProtocol({
          bytes: statusBytes,
          observation: fixture.statusTranscriptV1Verification.observation,
        }),
      "OBSERVATION_BINDING_DRIFT",
    );
    const id = fixture.identity;
    const policyBinding = request.request.isolationPolicy;
    const containmentNodes = containment.dependencyDag.nodes;
    if (
      source.value.controlRunId !== id.controlRunId ||
      source.value.buildId !== id.buildId ||
      source.value.productRole !== id.productRole ||
      source.value.workspace.generation !== id.workspaceGeneration ||
      source.value.workspace.targetGeneration !== id.targetGeneration ||
      request.request.controlRunId !== id.controlRunId ||
      request.request.buildId !== id.buildId ||
      request.request.productRole !== id.productRole ||
      request.request.source.rawSha256 !== source.identity.rawSha256 ||
      request.request.source.contentHash !== source.identity.contentHash ||
      request.request.source.workspaceGeneration !== id.workspaceGeneration ||
      request.request.source.targetGeneration !== id.targetGeneration ||
      request.request.ownership.ownerGeneration !== id.ownerGeneration ||
      request.request.ownership.processGeneration !== id.processGeneration ||
      request.request.ownership.ordinal !== id.ordinal ||
      !isDeepStrictEqual(request.request.isolationPolicy, policyBinding) ||
      policyBinding.rawSha256 !== sha256(policyBytes) ||
      policyBinding.contentHash !== policy.sha256 ||
      helper.status !== "DORMANT_HELPER_ATTESTATION_REPLAYED" ||
      helperDocument.value.source.logicalName !== "cargo-execveat-helper.c" ||
      helperDocument.value.source.sha256 !== HELPER_SOURCE_SHA256 ||
      helper.physicalLaunchEligible !== false ||
      helper.binding !== null ||
      helper.finalDecisionEligible !== false ||
      containment.runIdentity.controlRunId !== id.controlRunId ||
      containment.runIdentity.buildId !== id.buildId ||
      containment.runIdentity.ownerGeneration !== id.ownerGeneration ||
      containment.runIdentity.processGeneration !== id.processGeneration ||
      containment.runIdentity.workspaceGeneration !== id.workspaceGeneration ||
      containment.runIdentity.targetGeneration !== id.targetGeneration ||
      id.containmentGeneration !==
        `g17-containment-${containment.identity.rawSha256}` ||
      containmentNodes.containmentRequirements.sha256 !==
        CONTAINMENT_REQUIREMENTS_SHA256 ||
      containment.physicalOriginProven !== false ||
      containment.binding !== null ||
      containment.finalDecisionEligible !== false ||
      !isDeepStrictEqual(containmentNodes.executionRequest, request.identity) ||
      !isDeepStrictEqual(containmentNodes.helperAttestation, helper.identity) ||
      !isDeepStrictEqual(containmentNodes.isolationPolicy, policyBinding) ||
      fixture.qualifiedNativeAdapter !== null ||
      fixture.qualifiedDurableEffect !== null
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-binding",
        "predecessor identity DAG drifted",
      );
    }

    if (
      status.status !== "READY_EOF_REPLAYED" ||
      status.sequence !== "READY->EOF" ||
      status.outcome !== "READY" ||
      status.frameCount !== 1 ||
      status.byteLength !== statusBytes.length ||
      status.physicalLaunchEligible !== false ||
      status.binding !== null ||
      status.finalDecisionEligible !== false
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "status-validation",
        "status transcript is not exact READY then EOF",
      );
    }

    const stdoutBytes = bounded(
      fixture.stdoutBytes,
      LIMITS.combinedOutputMaximumBytes,
      "stdout",
    );
    const stderrBytes = bounded(
      fixture.stderrBytes,
      LIMITS.combinedOutputMaximumBytes,
      "stderr",
    );
    if (
      stdoutBytes.length + stderrBytes.length >
      LIMITS.combinedOutputMaximumBytes
    ) {
      fail("LIMIT_EXCEEDED", "stream-validation", "streams exceed bound");
    }
    const executableBytes = bounded(
      fixture.executableBytes,
      LIMITS.executableMaximumBytes,
      "executable",
    );
    const cgroupProcsBytes = bounded(
      fixture.cgroupProcsBytes,
      LIMITS.cgroupFileMaximumBytes,
      "cgroup.procs",
    );
    const cgroupEventsBytes = bounded(
      fixture.cgroupEventsBytes,
      LIMITS.cgroupFileMaximumBytes,
      "cgroup.events",
    );
    const cgroupPidsCurrentBytes = bounded(
      fixture.cgroupPidsCurrentBytes,
      LIMITS.cgroupFileMaximumBytes,
      "pids.current",
    );
    exactKeys(fixture.observations, OBSERVATION_KEYS, "observations", fail);
    const observations = fixture.observations;
    for (const [value, keys, label] of [
      [
        observations.helperImage,
        [
          "heldFd",
          "sourceLogicalName",
          "sourceSha256",
          "executableSha256",
          "observed",
        ],
        "helper image observation",
      ],
      [
        observations.status,
        [
          "sequence",
          "outcome",
          "byteLength",
          "frameCount",
          "eofObserved",
          "reservedExitCode",
        ],
        "status observation",
      ],
      [
        observations.process,
        [
          "disposition",
          "spawned",
          "exitCode",
          "signal",
          "statusAgreement",
          "captureComplete",
          "outputTruncated",
        ],
        "process observation",
      ],
      [
        observations.streams,
        ["stdout", "stderr", "combinedBytes"],
        "streams observation",
      ],
      [
        observations.streams.stdout,
        ["bytes", "sha256", "closed", "eof"],
        "stdout observation",
      ],
      [
        observations.streams.stderr,
        ["bytes", "sha256", "closed", "eof"],
        "stderr observation",
      ],
      [
        observations.cargo,
        [
          "lineCount",
          "compilerArtifactLine",
          "buildFinishedLine",
          "buildFinishedSuccess",
          "executableLogicalPath",
          "executableSha256",
        ],
        "Cargo observation",
      ],
      [
        observations.directReap,
        [
          "pidfdReadable",
          "waitMechanism",
          "exclusive",
          "directChild",
          "reaped",
          "exitCode",
          "signal",
          "pidfdClosed",
        ],
        "direct reap observation",
      ],
      [
        observations.cgroupQuiescence,
        [
          "path",
          "procsSha256",
          "eventsSha256",
          "pidsCurrentSha256",
          "processCount",
          "populated",
          "pidsCurrent",
        ],
        "cgroup quiescence observation",
      ],
      [
        observations.target,
        ["generation", "root", "ancestors", "executable"],
        "target observation",
      ],
      [
        observations.workspaceFinish,
        [
          "observed",
          "lifecycleGeneration",
          "sourceProjectionRawSha256",
          "workspaceGeneration",
          "targetGeneration",
        ],
        "workspace finish observation",
      ],
    ]) {
      exactKeys(value, keys, label, fail);
    }
    let stdoutText;
    try {
      stdoutText = new TextDecoder("utf-8", { fatal: true }).decode(
        stdoutBytes,
      );
    } catch (error) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL is not UTF-8",
        error,
      );
    }
    if (
      !stdoutText.endsWith("\n") ||
      stdoutText.includes("\r") ||
      stdoutText.includes("\0")
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL framing drifted",
      );
    }
    const lines = stdoutText.slice(0, -1).split("\n");
    if (
      lines.length < 2 ||
      lines.length > LIMITS.maximumArrayLength ||
      lines.some(
        (line) =>
          line.length === 0 ||
          Buffer.byteLength(line, "utf8") > LIMITS.singleStringUtf8MaximumBytes,
      )
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL line inventory drifted",
      );
    }
    let cargoLines;
    try {
      cargoLines = lines.map((line, index) => {
        rejectDuplicateJsonMembers(line, `Cargo JSONL line ${index + 1}`, fail);
        const record = JSON.parse(line);
        if (
          record === null ||
          typeof record !== "object" ||
          Array.isArray(record) ||
          typeof record.reason !== "string"
        ) {
          fail(
            "OBSERVATION_BINDING_DRIFT",
            "cargo-jsonl-validation",
            `Cargo JSONL line ${index + 1} is not a reasoned record`,
          );
        }
        return record;
      });
      cargoLines = snapshot(cargoLines, "Cargo JSONL", fail);
    } catch (error) {
      if (error instanceof G17BenchmarkBuildOwnerV3ContractError) throw error;
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "cargo-jsonl-validation",
        "Cargo JSONL drifted",
        error,
      );
    }
    const matchingArtifacts = cargoLines
      .map((record, index) => ({ record, index }))
      .filter(
        ({ record }) =>
          record.reason === "compiler-artifact" &&
          record.package_id ===
            "path+file:///workspace/source/lib/oxigraph#0.6.0-dev" &&
          record.manifest_path ===
            "/workspace/source/lib/oxigraph/Cargo.toml" &&
          record.target?.name === "transactional_write",
      );
    const selectedPathClaims = cargoLines
      .map((record, index) => ({ record, index }))
      .filter(
        ({ record }) =>
          record.reason === "compiler-artifact" &&
          (record.executable === observations.cargo.executableLogicalPath ||
            (Array.isArray(record.filenames) &&
              record.filenames.includes(
                observations.cargo.executableLogicalPath,
              ))),
      );
    const finished = cargoLines
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.reason === "build-finished");
    const artifact = matchingArtifacts.at(0)?.record;
    const artifactTarget = artifact?.target;
    const artifactProfile = artifact?.profile;
    const { "required-features": artifactRequiredFeatures } =
      artifactTarget ?? {};
    const { test: artifactTargetTest } = artifactTarget ?? {};
    const { test: artifactProfileTest } = artifactProfile ?? {};
    const cargoRecordShapeValid =
      artifact !== undefined &&
      hasExactKeys(artifact, [
        "executable",
        "features",
        "filenames",
        "fresh",
        "manifest_path",
        "package_id",
        "profile",
        "reason",
        "target",
      ]) &&
      hasExactKeys(artifactTarget, [
        "crate_types",
        "doc",
        "doctest",
        "edition",
        "kind",
        "name",
        "required-features",
        "src_path",
        "test",
      ]) &&
      hasExactKeys(artifactProfile, [
        "debug_assertions",
        "debuginfo",
        "opt_level",
        "overflow_checks",
        "test",
      ]);
    if (
      observations.status.sequence !== status.sequence ||
      observations.status.outcome !== status.outcome ||
      observations.status.byteLength !== status.byteLength ||
      observations.status.frameCount !== status.frameCount ||
      observations.status.eofObserved !== status.observation.eofObserved ||
      observations.status.reservedExitCode !== status.reservedExitCode ||
      observations.helperImage.heldFd !== 8 ||
      observations.helperImage.observed !== true ||
      observations.helperImage.sourceLogicalName !==
        helperDocument.value.source.logicalName ||
      observations.helperImage.sourceSha256 !==
        helperDocument.value.source.sha256 ||
      observations.helperImage.executableSha256 !==
        helperDocument.value.executable.sha256 ||
      observations.streams.stdout.bytes !== stdoutBytes.length ||
      observations.streams.stdout.sha256 !== sha256(stdoutBytes) ||
      observations.streams.stderr.bytes !== stderrBytes.length ||
      observations.streams.stderr.sha256 !== sha256(stderrBytes) ||
      observations.streams.combinedBytes !==
        stdoutBytes.length + stderrBytes.length ||
      matchingArtifacts.length !== 1 ||
      selectedPathClaims.length !== 1 ||
      selectedPathClaims.at(0)?.index !== matchingArtifacts.at(0)?.index ||
      cargoRecordShapeValid !== true ||
      !isDeepStrictEqual(artifactTarget.kind, ["bench"]) ||
      !isDeepStrictEqual(artifactTarget.crate_types, ["bin"]) ||
      artifactTarget.src_path !==
        "/workspace/source/lib/oxigraph/benches/transactional_write.rs" ||
      artifactTarget.edition !== "2024" ||
      artifactTarget.doc !== false ||
      artifactTarget.doctest !== false ||
      artifactTargetTest !== false ||
      !isDeepStrictEqual(artifactRequiredFeatures, ["rocksdb"]) ||
      artifactProfile.opt_level !== "3" ||
      artifactProfile.debuginfo !== 0 ||
      artifactProfile.debug_assertions !== false ||
      artifactProfile.overflow_checks !== false ||
      artifactProfileTest !== true ||
      !isDeepStrictEqual(artifact.features, [
        "default",
        "oxrocksdb-sys",
        "rocksdb",
      ]) ||
      !CARGO_EXECUTABLE_PATH.test(
        observations.cargo.executableLogicalPath ?? "",
      ) ||
      !isDeepStrictEqual(artifact.filenames, [
        observations.cargo.executableLogicalPath,
      ]) ||
      artifact.executable !== observations.cargo.executableLogicalPath ||
      artifact.fresh !== false ||
      finished.length !== 1 ||
      finished.at(0)?.index !== cargoLines.length - 1 ||
      !hasExactKeys(finished.at(0)?.record, ["reason", "success"]) ||
      finished.at(0)?.record.success !== true ||
      observations.cargo.lineCount !== cargoLines.length ||
      observations.cargo.compilerArtifactLine !==
        matchingArtifacts.at(0)?.index + 1 ||
      observations.cargo.buildFinishedLine !== finished.at(0)?.index + 1 ||
      observations.cargo.buildFinishedSuccess !== true
    ) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "observation-binding",
        "status, helper, stream, or Cargo observation drifted",
      );
    }
    if (
      observations.process.disposition !== "completed" ||
      observations.process.spawned !== true ||
      observations.process.exitCode !== 0 ||
      observations.process.signal !== null ||
      observations.process.statusAgreement !== true ||
      observations.process.captureComplete !== true ||
      observations.process.outputTruncated !== false ||
      observations.streams.stdout.closed !== true ||
      observations.streams.stdout.eof !== true ||
      observations.streams.stderr.closed !== true ||
      observations.streams.stderr.eof !== true ||
      observations.directReap.pidfdReadable !== true ||
      observations.directReap.waitMechanism !== "waitid-P_PIDFD-WEXITED" ||
      observations.directReap.exclusive !== true ||
      observations.directReap.directChild !== true ||
      observations.directReap.reaped !== true ||
      observations.directReap.exitCode !== 0 ||
      observations.directReap.signal !== null ||
      observations.directReap.pidfdClosed !== true
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "process-and-reap-validation",
        "successful process or exclusive reap is unproved",
      );
    }
    if (
      cgroupProcsBytes.length !== 0 ||
      cgroupEventsBytes.toString("utf8") !== "populated 0\nfrozen 0\n" ||
      cgroupPidsCurrentBytes.toString("utf8") !== "0\n" ||
      observations.cgroupQuiescence.path !== containment.cgroupPath ||
      observations.cgroupQuiescence.procsSha256 !== sha256(cgroupProcsBytes) ||
      observations.cgroupQuiescence.eventsSha256 !==
        sha256(cgroupEventsBytes) ||
      observations.cgroupQuiescence.pidsCurrentSha256 !==
        sha256(cgroupPidsCurrentBytes) ||
      observations.cgroupQuiescence.processCount !== 0 ||
      observations.cgroupQuiescence.populated !== false ||
      observations.cgroupQuiescence.pidsCurrent !== 0
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "quiescence-validation",
        "complete cgroup quiescence is unproved",
      );
    }
    const executable = observations.target.executable;
    if (
      !Array.isArray(observations.target.ancestors) ||
      observations.target.ancestors.length !== 2
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "target-validation",
        "held target ancestry is not exact",
      );
    }
    const [release, deps] = observations.target.ancestors;
    const directoryKeys = [
      "logicalPath",
      "leafName",
      "heldFd",
      "device",
      "inode",
      "uid",
      "gid",
      "mode",
      "filesystemType",
    ];
    exactKeys(observations.target.root, directoryKeys, "target root", fail);
    for (const [index, ancestor] of observations.target.ancestors.entries()) {
      exactKeys(
        ancestor,
        [...directoryKeys, "parentDevice", "parentInode"],
        `target ancestor ${index}`,
        fail,
      );
    }
    exactKeys(
      executable,
      [
        "logicalPath",
        "leafName",
        "heldFd",
        "device",
        "inode",
        "uid",
        "gid",
        "mode",
        "parentDevice",
        "parentInode",
        "bytes",
        "sha256",
        "elf",
      ],
      "target executable",
      fail,
    );
    exactKeys(
      executable.elf,
      [
        "elfClass",
        "elfData",
        "elfMachine",
        "interpreter",
        "soname",
        "needed",
        "rpath",
        "runpath",
        "sha256",
      ],
      "target ELF",
      fail,
    );
    let elf;
    try {
      elf = parseG17Elf64(executableBytes);
    } catch (error) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "target-validation",
        "held target ELF is invalid",
        error,
      );
    }
    if (
      elf === null ||
      executable.bytes !== executableBytes.length ||
      executable.sha256 !== sha256(executableBytes) ||
      executable.elf.sha256 !== executable.sha256 ||
      executable.elf.elfClass !== elf.elfClass ||
      executable.elf.elfData !== elf.elfData ||
      executable.elf.elfMachine !== elf.elfMachine ||
      executable.elf.interpreter !== elf.interpreter ||
      executable.elf.soname !== elf.soname ||
      !isDeepStrictEqual(executable.elf.needed, elf.needed) ||
      !isDeepStrictEqual(executable.elf.rpath, elf.rpath) ||
      !isDeepStrictEqual(executable.elf.runpath, elf.runpath) ||
      observations.target.generation !== id.targetGeneration ||
      observations.target.root.logicalPath !== "/state/target" ||
      observations.target.root.leafName !== "target" ||
      observations.target.root.heldFd !== true ||
      observations.target.root.device !==
        source.value.workspace.targetChild.device ||
      observations.target.root.inode !==
        source.value.workspace.targetChild.inode ||
      observations.target.root.uid !== source.value.workspace.targetChild.uid ||
      observations.target.root.gid !== source.value.workspace.targetChild.gid ||
      observations.target.root.filesystemType !==
        source.value.workspace.targetChild.filesystemType ||
      observations.target.root.leafName !==
        source.value.workspace.targetChild.leafName ||
      release?.logicalPath !== "/state/target/release" ||
      release?.leafName !== "release" ||
      release?.heldFd !== true ||
      deps?.logicalPath !== "/state/target/release/deps" ||
      deps?.leafName !== "deps" ||
      deps?.heldFd !== true ||
      executable.heldFd !== true ||
      !CARGO_EXECUTABLE_PATH.test(executable.logicalPath ?? "") ||
      executable.logicalPath !== `${deps.logicalPath}/${executable.leafName}` ||
      release.parentDevice !== observations.target.root.device ||
      release.parentInode !== observations.target.root.inode ||
      deps.parentDevice !== release.device ||
      deps.parentInode !== release.inode ||
      executable.parentDevice !== deps.device ||
      executable.parentInode !== deps.inode ||
      [observations.target.root, release, deps].some(
        (directory) =>
          directory.mode !== 0o040755 ||
          directory.device !== observations.target.root.device ||
          directory.uid !== observations.target.root.uid ||
          directory.gid !== observations.target.root.gid ||
          directory.filesystemType !== observations.target.root.filesystemType,
      ) ||
      executable.mode !== 0o100555 ||
      executable.device !== observations.target.root.device ||
      executable.uid !== observations.target.root.uid ||
      executable.gid !== observations.target.root.gid ||
      observations.cargo.executableLogicalPath !== executable.logicalPath ||
      observations.cargo.executableSha256 !== executable.sha256
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "target-validation",
        "held target ancestry, metadata, or ELF drifted",
      );
    }
    if (
      observations.workspaceFinish.observed !== true ||
      observations.workspaceFinish.lifecycleGeneration !==
        id.lifecycleGeneration ||
      observations.workspaceFinish.sourceProjectionRawSha256 !==
        source.identity.rawSha256 ||
      observations.workspaceFinish.workspaceGeneration !==
        id.workspaceGeneration ||
      observations.workspaceFinish.targetGeneration !== id.targetGeneration
    ) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "workspace-finish-validation",
        "workspace finish drifted",
      );
    }
    return Object.freeze({
      fixture,
      issuerRequirements,
      source,
      request,
      helper,
      helperDocument,
      policyBinding,
      containment,
      containmentDocument,
      status,
      statusBytes,
      observations: g17PrivateOwnerV3Clone(observations),
    });
  }

  function buildOwner(normalized) {
    const sourceProjection = Object.freeze({
      schema: normalized.source.identity.schema,
      rawSha256: normalized.source.identity.rawSha256,
      contentHash: normalized.source.identity.contentHash,
      controlRunId: normalized.fixture.identity.controlRunId,
      buildId: normalized.fixture.identity.buildId,
      productRole: normalized.fixture.identity.productRole,
      workspaceGeneration: normalized.fixture.identity.workspaceGeneration,
      targetGeneration: normalized.fixture.identity.targetGeneration,
    });
    const helperAttestation = Object.freeze({
      schema: normalized.helper.identity.schema,
      rawSha256: normalized.helper.identity.rawSha256,
      contentHash: normalized.helper.identity.contentHash,
      requestRawSha256: normalized.request.identity.rawSha256,
      requestContentHash: normalized.request.identity.contentHash,
    });
    const statusTranscript = Object.freeze({
      schema: "oxigraph.g1.7-cargo-execveat-status/v1",
      rawSha256: sha256(normalized.statusBytes),
      bytes: normalized.statusBytes.length,
    });
    const containment = Object.freeze({
      schema: normalized.containment.identity.schema,
      rawSha256: normalized.containment.identity.rawSha256,
      contentHash: normalized.containment.identity.contentHash,
      requirementsSha256: CONTAINMENT_REQUIREMENTS_SHA256,
      executionRequestRawSha256: normalized.request.identity.rawSha256,
      helperAttestationRawSha256: normalized.helper.identity.rawSha256,
    });
    const bindings = Object.freeze({
      issuerRequirements: deepFreezeJson(normalized.issuerRequirements),
      sourceProjection,
      executionRequestV2: deepFreezeJson(normalized.request.identity),
      helperAttestationV1: helperAttestation,
      statusTranscriptV1: statusTranscript,
      isolationPolicyV2: deepFreezeJson(normalized.policyBinding),
      containmentV2: containment,
      qualifiedNativeAdapter: null,
      qualifiedDurableEffect: null,
    });
    const unsigned = {
      schema: OWNER_SCHEMA,
      status: STATUS,
      identity: deepFreezeJson(normalized.fixture.identity),
      bindings,
      observations: deepFreezeJson(normalized.observations),
      physicalOrigin: false,
      binding: null,
      finalDecisionEligible: false,
      authority: AUTHORITY,
      nonclaims: NONCLAIMS,
    };
    return Object.freeze({
      ...unsigned,
      contentHash: canonicalSha256(unsigned),
    });
  }

  function identityFor(owner, bytes) {
    return Object.freeze({
      schema: OWNER_SCHEMA,
      rawSha256: sha256(bytes),
      contentHash: owner.contentHash,
    });
  }

  function projectionFor(owner, identity) {
    return Object.freeze({
      schema: PROJECTION_SCHEMA,
      status: STATUS,
      owner: identity,
      identity: owner.identity,
      bindings: owner.bindings,
      observations: owner.observations,
      physicalOrigin: false,
      binding: null,
      finalDecisionEligible: false,
      authority: AUTHORITY,
      nonclaims: NONCLAIMS,
    });
  }

  function artifactEnvelope(bytes) {
    const stored = Buffer.from(bytes);
    return Object.freeze({
      name: ARTIFACT_NAME,
      rawSha256: sha256(stored),
      get bytes() {
        return Buffer.from(stored);
      },
    });
  }

  function created(owner, bytes, includeArtifact) {
    const identity = identityFor(owner, bytes);
    const entries = {
      owner,
      identity,
      projection: projectionFor(owner, identity),
    };
    if (includeArtifact) entries.artifact = artifactEnvelope(bytes);
    return Object.freeze(entries);
  }

  function createCapability(input) {
    const envelope = snapshot(input, "test capability input", fail);
    exactKeys(envelope, ["fixture"], "test capability input", fail);
    const normalized = validateFixture(envelope.fixture);
    const scenario = {
      predecessorAttestationsExact: true,
      sourceWorkspaceRevalidated: true,
      requestV2: g17PrivateOwnerV3Clone(normalized.request.identity),
      helperAttestation: {
        ...g17PrivateOwnerV3Clone(normalized.helper.identity),
        requestRawSha256: normalized.request.identity.rawSha256,
        requestContentHash: normalized.request.identity.contentHash,
        sourceLogicalName: normalized.helperDocument.value.source.logicalName,
        sourceSha256: normalized.helperDocument.value.source.sha256,
        executableSha256: normalized.helperDocument.value.executable.sha256,
      },
      heldHelperFd8: {
        fd: 8,
        role: "helperSelfExecutable",
        kind: "regular-file",
        descriptorAccess: "read-only",
        cloexecImmediatelyBeforeCargoExecveat: true,
        sourceLogicalName: normalized.helperDocument.value.source.logicalName,
        sourceSha256: normalized.helperDocument.value.source.sha256,
        executableSha256: normalized.helperDocument.value.executable.sha256,
      },
      descriptorBoundary: g17PrivateOwnerV3Clone(DESCRIPTOR_BOUNDARY),
    };
    const adapter = async (observedScenario) => {
      if (!isDeepStrictEqual(observedScenario, scenario)) {
        throw new TypeError("issuer scenario differs from verified fixture");
      }
      return Object.fromEntries(
        [
          "buildOwnerV3Issued",
          "cargoExitObserved",
          "cargoJsonlValid",
          "cgroupEventsPopulatedZeroObserved",
          "cgroupProcsEmptyObserved",
          "childMayExist",
          "cleanupOutcomeCertain",
          "directChildReapObserved",
          "durableCommitObserved",
          "exclusiveWaitidPidfdObserved",
          "heldTargetAncestryObserved",
          "heldTargetElfObserved",
          "heldTargetMetadataObserved",
          "helperExecImageProven",
          "pidfdReadableObserved",
          "pidsCurrentZeroObserved",
          "productionWorkspaceFinishObserved",
          "reservedExitAgreementObserved",
          "statusEofObserved",
          "statusTerminalSequenceObserved",
          "statusWithinByteLimit",
          "statusWithinFrameLimit",
          "statusWithinTimeout",
          "stderrClosedObserved",
          "stderrEofObserved",
          "stderrWithinBound",
          "stdoutClosedObserved",
          "stdoutEofObserved",
          "stdoutWithinBound",
        ].map((key) => [key, true]),
      );
    };
    const capability = createG17BenchmarkPrivateBuildIssuerV1ForTesting({
      adapter,
      scenario,
    });
    liveCapabilities.set(capability, { normalized });
    return capability;
  }

  async function createArtifact(capability) {
    const state =
      capability !== null &&
      (typeof capability === "object" || typeof capability === "function")
        ? liveCapabilities.get(capability)
        : undefined;
    if (state === undefined) {
      fail(
        "PRIVATE_CAPABILITY_INVALID",
        "capability-consumption",
        "private test capability is not live for this module instance",
      );
    }
    liveCapabilities.delete(capability);
    let trace;
    try {
      trace = await runG17BenchmarkPrivateBuildIssuerV1(capability);
    } catch (error) {
      if (isG17BenchmarkPrivateBuildIssuerV1Fault(error)) {
        fail(
          "PRIVATE_CAPABILITY_INVALID",
          "capability-consumption",
          "private issuer capability is no longer live",
          error,
        );
      }
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "issuer-execution",
        "private issuer dependency failed unexpectedly",
        error,
      );
    }
    const expectedTrace = expectedPrivateIssuerTrace();
    if (
      !isG17BenchmarkPrivateBuildIssuerV1TestTrace(trace) ||
      !isDeepStrictEqual(trace, expectedTrace)
    ) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "issuer-trace-validation",
        "private issuer terminal trace drifted",
      );
    }
    const owner = buildOwner(state.normalized);
    const bytes = g17PrivateOwnerV3CanonicalBytes(owner);
    if (bytes.length > MAX_BYTES) {
      fail("LIMIT_EXCEEDED", "canonical-encoding", "owner exceeds bound");
    }
    return created(owner, bytes, true);
  }

  function decodeOwner(bytes) {
    const captured = bounded(bytes, MAX_BYTES, "owner artifact");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(captured);
    } catch (error) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner is not UTF-8",
        error,
      );
    }
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner framing drifted",
      );
    }
    let owner;
    try {
      owner = JSON.parse(text);
      owner = snapshot(owner, "owner document", fail);
    } catch (error) {
      if (error instanceof G17BenchmarkBuildOwnerV3ContractError) throw error;
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner JSON drifted",
        error,
      );
    }
    if (owner === null || typeof owner !== "object" || Array.isArray(owner)) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner JSON is not a record",
      );
    }
    if (!captured.equals(g17PrivateOwnerV3CanonicalBytes(owner))) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        "canonical-decoding",
        "owner is not canonical JSON plus LF",
      );
    }
    return { owner, bytes: captured };
  }

  function verifyArtifact(input) {
    const envelope = snapshot(input, "verification input", fail);
    exactKeys(envelope, ["bytes", "fixture"], "verification input", fail);
    const decoded = decodeOwner(envelope.bytes);
    const { contentHash, ...unsigned } = decoded.owner;
    if (
      typeof contentHash !== "string" ||
      !DIGEST.test(contentHash) ||
      contentHash !== canonicalSha256(unsigned)
    ) {
      fail(
        "CONTENT_HASH_MISMATCH",
        "content-hash-validation",
        "owner contentHash does not verify",
      );
    }
    exactKeys(decoded.owner, ROOT_KEYS, "owner", fail);
    exactKeys(decoded.owner.identity, IDENTITY_KEYS, "owner identity", fail);
    if (
      decoded.owner.schema !== OWNER_SCHEMA ||
      decoded.owner.status !== STATUS
    ) {
      fail("IDENTITY_INVALID", "identity-validation", "owner identity drifted");
    }
    const normalized = validateFixture(envelope.fixture);
    const expected = buildOwner(normalized);
    if (!isDeepStrictEqual(decoded.owner.identity, expected.identity)) {
      fail(
        "EXPECTED_INPUT_MISMATCH",
        "expected-identity-validation",
        "owner identity differs from expected fixture",
      );
    }
    exactKeys(decoded.owner.bindings, BINDING_KEYS, "owner bindings", fail);
    if (!isDeepStrictEqual(decoded.owner.bindings, expected.bindings)) {
      fail(
        "PREDECESSOR_BINDING_DRIFT",
        "predecessor-binding",
        "owner predecessor bindings drifted",
      );
    }
    exactKeys(
      decoded.owner.observations,
      OBSERVATION_KEYS,
      "owner observations",
      fail,
    );
    if (!isDeepStrictEqual(decoded.owner.observations, expected.observations)) {
      fail(
        "OBSERVATION_BINDING_DRIFT",
        "observation-binding",
        "owner observations drifted",
      );
    }
    if (
      decoded.owner.physicalOrigin !== false ||
      decoded.owner.binding !== null ||
      decoded.owner.finalDecisionEligible !== false ||
      !isDeepStrictEqual(decoded.owner.authority, AUTHORITY) ||
      !isDeepStrictEqual(decoded.owner.nonclaims, NONCLAIMS) ||
      decoded.owner.bindings.qualifiedNativeAdapter !== null ||
      decoded.owner.bindings.qualifiedDurableEffect !== null
    ) {
      fail(
        "AUTHORITY_OVERCLAIM",
        "authority-validation",
        "owner overclaims origin, authority, or eligibility",
      );
    }
    return created(deepFreezeJson(decoded.owner), decoded.bytes, false);
  }

  return Object.freeze({
    G17_BENCHMARK_BUILD_OWNER_V3_SCHEMA: OWNER_SCHEMA,
    G17_BENCHMARK_BUILD_OWNER_V3_PROJECTION_SCHEMA: PROJECTION_SCHEMA,
    G17_BENCHMARK_BUILD_OWNER_V3_ARTIFACT_NAME: ARTIFACT_NAME,
    G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES: MAX_BYTES,
    G17_BENCHMARK_BUILD_OWNER_V3_LIMITS: LIMITS,
    G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES: ERROR_CODES,
    G17BenchmarkBuildOwnerV3ContractError,
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY: AUTHORITY,
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS: NONCLAIMS,
    g17BenchmarkBuildOwnerV3Readiness() {
      return READINESS;
    },
    createG17BenchmarkBuildOwnerV3CapabilityForTesting: createCapability,
    createG17BenchmarkBuildOwnerV3Artifact: createArtifact,
    verifyG17BenchmarkBuildOwnerV3Artifact: verifyArtifact,
  });
}
const CONTRACT = createContract();

export const G17_BENCHMARK_BUILD_OWNER_V3_SCHEMA =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_SCHEMA;
export const G17_BENCHMARK_BUILD_OWNER_V3_PROJECTION_SCHEMA =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_PROJECTION_SCHEMA;
export const G17_BENCHMARK_BUILD_OWNER_V3_ARTIFACT_NAME =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_ARTIFACT_NAME;
export const G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES;
export const G17_BENCHMARK_BUILD_OWNER_V3_LIMITS =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_LIMITS;
export const G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_ERROR_CODES;
export const G17BenchmarkBuildOwnerV3ContractError =
  CONTRACT.G17BenchmarkBuildOwnerV3ContractError;
export const G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY;
export const G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS =
  CONTRACT.G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS;
export const g17BenchmarkBuildOwnerV3Readiness =
  CONTRACT.g17BenchmarkBuildOwnerV3Readiness;
export const createG17BenchmarkBuildOwnerV3CapabilityForTesting =
  CONTRACT.createG17BenchmarkBuildOwnerV3CapabilityForTesting;
export const createG17BenchmarkBuildOwnerV3Artifact =
  CONTRACT.createG17BenchmarkBuildOwnerV3Artifact;
export const verifyG17BenchmarkBuildOwnerV3Artifact =
  CONTRACT.verifyG17BenchmarkBuildOwnerV3Artifact;
