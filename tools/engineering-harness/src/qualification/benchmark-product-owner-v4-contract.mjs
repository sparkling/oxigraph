import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "./benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY,
  G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES,
  G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS,
  verifyG17BenchmarkBuildOwnerV3Artifact,
} from "./benchmark-build-owner-v3-contract.mjs";

const STATUS = "PRODUCT_OWNER_V4_REPLAYED_AUTHORITY_NULL";
const READINESS = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const EXECUTION_PLAN = Object.freeze({
  schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
  environmentRecipe: Object.freeze({
    schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
    sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  }),
});

export const G17_BENCHMARK_PRODUCT_OWNER_V4_SCHEMA =
  "oxigraph.g1.7-benchmark-product-owner/v4";
export const G17_BENCHMARK_PRODUCT_OWNER_V4_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-product-owner-projection/v4";
export const G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME =
  "benchmark-product-owner-v4.json";
export const G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES = 4_194_304;
export const G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS = Object.freeze({
  artifactMaximumBytes: G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES,
  buildOwnerMaximumBytes: G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES,
  buildCount: G17_BENCHMARK_BUILD_PLAN.length,
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumArrayLength: 4_096,
  maximumPropertiesPerRecord: 4_097,
  aggregateStringUtf8MaximumBytes: 2_097_152,
  singleStringUtf8MaximumBytes: 1_048_576,
});
export const G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "BUILD_OWNER_INVALID",
  "IDENTITY_INVALID",
  "GENERATION_COLLISION",
  "SOURCE_BINDING_DRIFT",
  "AUTHORIZATION_BINDING_DRIFT",
  "EXECUTION_PLAN_BINDING_DRIFT",
  "PLATFORM_BINDING_DRIFT",
  "TOOLCHAIN_BINDING_DRIFT",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "AUTHORITY_OVERCLAIM",
  "EXPECTED_INPUT_MISMATCH",
]);
export const G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY = Object.freeze({
  buildExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.buildExecutionAuthority,
  launchExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.launchExecutionAuthority,
  helperExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.helperExecutionAuthority,
  cargoExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.cargoExecutionAuthority,
  containmentExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.containmentExecutionAuthority,
  nativeProcessExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.nativeProcessExecutionAuthority,
  nativeObservationAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.nativeObservationAuthority,
  physicalIssuanceAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.physicalIssuanceAuthority,
  cleanupAuthority: G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.cleanupAuthority,
  controlExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.controlExecutionAuthority,
  qualificationExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.qualificationExecutionAuthority,
  receiptAuthority: G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.receiptAuthority,
  promotionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.promotionAuthority,
  publicationAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.publicationAuthority,
  providerExecutionAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.providerExecutionAuthority,
  routerQualityAuthority:
    G17_BENCHMARK_BUILD_OWNER_V3_AUTHORITY.routerQualityAuthority,
});
export const G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS = Object.freeze({
  physicalOwnerIssued:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.physicalOwnerIssued,
  privatePhysicalIssuerImplemented:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.privatePhysicalIssuerImplemented,
  nativeHelperImplemented:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.nativeHelperImplemented,
  helperAttestationObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.helperAttestationObserved,
  helperInitialLaunchObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.helperInitialLaunchObserved,
  helperDescriptorMapObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.helperDescriptorMapObserved,
  helperCloexecTransitionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.helperCloexecTransitionObserved,
  helperStatusProtocolObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.helperStatusProtocolObserved,
  cargoExecveatObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.cargoExecveatObserved,
  cargoExecutionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.cargoExecutionObserved,
  rustcExecutionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.rustcExecutionObserved,
  containmentV2Implemented:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.containmentV2Implemented,
  nativeContainmentAdapterImplemented:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .nativeContainmentAdapterImplemented,
  containmentApplied:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.containmentApplied,
  clone3CgroupPlacementObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.clone3CgroupPlacementObserved,
  directChildPidfdWaitidAttested:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.directChildPidfdWaitidAttested,
  cgroupQuiescenceObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.cgroupQuiescenceObserved,
  serializedRequestProvesPhysicalLaunch:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedRequestProvesPhysicalLaunch,
  controlAuthorizationApproved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.controlAuthorizationApproved,
  callerSuppliedBytesProveNativeOrigin:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .callerSuppliedBytesProveNativeOrigin,
  sourceDigestProvesReviewedSemantics:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .sourceDigestProvesReviewedSemantics,
  compilerDigestProvesInvocation:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.compilerDigestProvesInvocation,
  compilerVersionReplayProvesObservedProcess:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .compilerVersionReplayProvesObservedProcess,
  compileStreamsProveCompilerRan:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.compileStreamsProveCompilerRan,
  executableDigestProvesCompilerOutput:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .executableDigestProvesCompilerOutput,
  metadataReplayProvesHeldDescriptor:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .metadataReplayProvesHeldDescriptor,
  elfReplayProvesSafeExecution:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.elfReplayProvesSafeExecution,
  attestationReplayBindsExecutionRequest:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .attestationReplayBindsExecutionRequest,
  requestPlaceholderIsExecutionBinding:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .requestPlaceholderIsExecutionBinding,
  helperRuntimeArgvBoundToExecutionRequest:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .helperRuntimeArgvBoundToExecutionRequest,
  helperRuntimeEnvironmentBoundToExecutionRequest:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .helperRuntimeEnvironmentBoundToExecutionRequest,
  helperValidatesExecutionRequestBinding:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .helperValidatesExecutionRequestBinding,
  helperExecutionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.helperExecutionObserved,
  privateCoLocatedIssuerImplemented:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.privateCoLocatedIssuerImplemented,
  physicalEligibility:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.physicalEligibility,
  serializedReplayProvesNativeOrigin:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedReplayProvesNativeOrigin,
  serializedReplayProvesObservationOrder:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedReplayProvesObservationOrder,
  serializedClone3ClaimProvesSyscall:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedClone3ClaimProvesSyscall,
  serializedClone3ClaimProvesInitialCgroupPlacement:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedClone3ClaimProvesInitialCgroupPlacement,
  serializedCloneArgsProveKernelInput:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedCloneArgsProveKernelInput,
  serializedPidfdClaimProvesKernelPidfd:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedPidfdClaimProvesKernelPidfd,
  serializedPidfdPollClaimProvesReadiness:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedPidfdPollClaimProvesReadiness,
  serializedWaitidClaimProvesDirectChildReap:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedWaitidClaimProvesDirectChildReap,
  serializedPidfdCloseClaimProvesClose:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedPidfdCloseClaimProvesClose,
  serializedQuiescenceBytesProveKernelOrigin:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedQuiescenceBytesProveKernelOrigin,
  serializedCgroupPathProvesHeldDirectory:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedCgroupPathProvesHeldDirectory,
  serializedDescriptorClaimProvesParentOnlyIsolation:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedDescriptorClaimProvesParentOnlyIsolation,
  serializedHelperImageReachedClaimProvesTransition:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedHelperImageReachedClaimProvesTransition,
  serializedRequestAndHelperFanInProvesCoLocatedIssuer:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedRequestAndHelperFanInProvesCoLocatedIssuer,
  replayProvesNoPostSpawnCgroupMove:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.replayProvesNoPostSpawnCgroupMove,
  replayProvesNoForkFallback:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.replayProvesNoForkFallback,
  replayProvesNoCloneFallback:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.replayProvesNoCloneFallback,
  replayProvesLifecycleOrder:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.replayProvesLifecycleOrder,
  replayProvesCleanupOrder:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.replayProvesCleanupOrder,
  cleanupExecuted: G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.cleanupExecuted,
  physicalOriginProven:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.physicalOriginProven,
  productionLifecycleEntrypointImplemented:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .productionLifecycleEntrypointImplemented,
  sourceWorkspaceBuildBegun:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.sourceWorkspaceBuildBegun,
  sourceWorkspaceTerminalRevalidationObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .sourceWorkspaceTerminalRevalidationObserved,
  exactExecutionRequestV2Constructed:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .exactExecutionRequestV2Constructed,
  heldDescriptorPreparationObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .heldDescriptorPreparationObserved,
  childDescriptorAliasExclusionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .childDescriptorAliasExclusionObserved,
  durableCommitObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.durableCommitObserved,
  qualifiedHelperImageExecutionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .qualifiedHelperImageExecutionObserved,
  statusTerminalSequenceObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.statusTerminalSequenceObserved,
  stdoutClosureAndEofObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.stdoutClosureAndEofObserved,
  stderrClosureAndEofObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.stderrClosureAndEofObserved,
  cargoJsonlValidityObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.cargoJsonlValidityObserved,
  cargoProcessOutcomeObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.cargoProcessOutcomeObserved,
  exclusiveDirectChildPidfdWaitObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .exclusiveDirectChildPidfdWaitObserved,
  completeCgroupQuiescenceObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.completeCgroupQuiescenceObserved,
  heldTargetAncestryObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.heldTargetAncestryObserved,
  heldTargetElfObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.heldTargetElfObserved,
  productionWorkspaceFinishObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .productionWorkspaceFinishObserved,
  privatePhysicalOriginCapabilityMinted:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .privatePhysicalOriginCapabilityMinted,
  buildOwnerV3Issued:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.buildOwnerV3Issued,
  productOwnerV4Issued:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.productOwnerV4Issued,
  phaseAApproved: G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.phaseAApproved,
  phaseBApproved: G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.phaseBApproved,
  liveG17ControlExecuted:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.liveG17ControlExecuted,
  liveG17SampleExecuted:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.liveG17SampleExecuted,
  benchmarkQualificationObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.benchmarkQualificationObserved,
  qualificationReceiptIssued:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.qualificationReceiptIssued,
  humanPromotionObserved:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.humanPromotionObserved,
  productionReady: G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.productionReady,
  currentHostSupported:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.currentHostSupported,
  g22CommitAuthorityInherited:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.g22CommitAuthorityInherited,
  applicationOutputReleased:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.applicationOutputReleased,
  applicationReceiptIssued:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.applicationReceiptIssued,
  legacyEvidenceReinterpreted:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS.legacyEvidenceReinterpreted,
  retryAfterDurableCommitPermitted:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .retryAfterDurableCommitPermitted,
  destructiveCleanupAfterAmbiguityPermitted:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .destructiveCleanupAfterAmbiguityPermitted,
  serializedReplayProvesPrivateCapabilityConsumption:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .serializedReplayProvesPrivateCapabilityConsumption,
  syntheticTestCapabilityProvesIssuerOrigin:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .syntheticTestCapabilityProvesIssuerOrigin,
  buildOwnerV3PhysicalOriginProven:
    G17_BENCHMARK_BUILD_OWNER_V3_NONCLAIMS
      .buildOwnerV3PhysicalOriginProven,
  serializedBuildOwnerSetProvesProductOrigin: false,
  productOwnerV4PhysicalOriginProven: false,
});

export class G17BenchmarkProductOwnerV4ContractError extends Error {
  constructor(code, phase, message, ...options) {
    if (!G17_BENCHMARK_PRODUCT_OWNER_V4_ERROR_CODES.includes(code)) {
      throw new TypeError("unknown product-owner-v4 code");
    }
    if (typeof phase !== "string" || typeof message !== "string") {
      throw new TypeError("invalid product-owner-v4 error fields");
    }
    super("G1.7 benchmark product owner v4 contract: [" + code + "] " + phase + ": " + message, options[0]);
    this.name = "G17BenchmarkProductOwnerV4ContractError";
    this.code = code;
    this.phase = phase;
  }
}

function fail(code, phase, message, cause) {
  throw new G17BenchmarkProductOwnerV4ContractError(
    code,
    phase,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value) + "\n", "utf8");
}

function ownerContentHash(value) {
  return canonicalSha256(value);
}

function validateInput(input, bytesExpected) {
  if (types.isProxy(input)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "input proxy");
  }
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "input shape drifted");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    (bytesExpected === false &&
      (Reflect.ownKeys(descriptors).length !== 1 ||
        Reflect.ownKeys(descriptors)[0] !== "builds")) ||
    (bytesExpected === true &&
      (Reflect.ownKeys(descriptors).length !== 2 ||
        Reflect.ownKeys(descriptors)[0] !== "bytes" ||
        Reflect.ownKeys(descriptors)[1] !== "builds"))
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "input fields drifted");
  }
  if (
    typeof descriptors.builds.writable !== "boolean" ||
    descriptors.builds.enumerable !== true ||
    (bytesExpected === true &&
      (typeof descriptors.bytes.writable !== "boolean" ||
        descriptors.bytes.enumerable !== true))
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "input descriptors drifted");
  }
}

function ownDataRecord(input, bytesExpected) {
  validateInput(input, bytesExpected);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const builds = descriptors.builds.value;
  const bytes = Object.hasOwn(descriptors, "bytes") ? descriptors.bytes.value : undefined;
  return Object.freeze({ builds, bytes });
}

function validateBuild(value, index) {
  if (types.isProxy(value)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "build proxy");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "build shape drifted");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== 2 ||
    Reflect.ownKeys(descriptors)[0] !== "bytes" ||
    Reflect.ownKeys(descriptors)[1] !== "fixture"
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "build fields drifted");
  }
  if (
    typeof descriptors.bytes.writable !== "boolean" ||
    descriptors.bytes.enumerable !== true ||
    typeof descriptors.fixture.writable !== "boolean" ||
    descriptors.fixture.enumerable !== true ||
    types.isProxy(descriptors.bytes.value) ||
    !Buffer.isBuffer(descriptors.bytes.value) ||
    Object.getPrototypeOf(descriptors.bytes.value) !== Buffer.prototype ||
    Object.hasOwn(descriptors.bytes.value, "byteLength") ||
    Buffer.byteLength(Object.getOwnPropertyDescriptors(value).bytes.value) >
      G17_BENCHMARK_BUILD_OWNER_V3_MAX_BYTES
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "build bytes drifted");
  }
  if (!Number.isSafeInteger(index)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "build index drifted");
  }
}

function snapshotBuild(descriptor, index) {
  const value = descriptor.value;
  validateBuild(value, index);
  const bytes = Buffer.from(value.bytes);
  const fixture = value.fixture;
  return Object.freeze({ bytes, fixture });
}

function snapshotBuilds(builds) {
  if (types.isProxy(builds)) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "builds proxy");
  }
  if (
    !Array.isArray(builds) ||
    Object.getPrototypeOf(builds) !== Array.prototype ||
    builds.length !== 4
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "builds shape drifted");
  }
  const descriptors = Object.getOwnPropertyDescriptors(builds);
  if (
    !isDeepStrictEqual(Reflect.ownKeys(descriptors), [
      "0",
      "1",
      "2",
      "3",
      "length",
    ])
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "builds fields drifted");
  }
  if (
    !Object.hasOwn(descriptors[0], "value") ||
    descriptors[0].enumerable !== true ||
    !Object.hasOwn(descriptors[1], "value") ||
    descriptors[1].enumerable !== true ||
    !Object.hasOwn(descriptors[2], "value") ||
    descriptors[2].enumerable !== true ||
    !Object.hasOwn(descriptors[3], "value") ||
    descriptors[3].enumerable !== true ||
    !Object.hasOwn(descriptors.length, "value") ||
    descriptors.length.value !== 4 ||
    descriptors.length.enumerable !== false
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      "input-shape",
      "builds descriptors drifted",
    );
  }
  return Object.freeze([
    snapshotBuild(descriptors[0], 0),
    snapshotBuild(descriptors[1], 1),
    snapshotBuild(descriptors[2], 2),
    snapshotBuild(descriptors[3], 3),
  ]);
}

function normalizeBuilds(builds) {
  return snapshotBuilds(builds).map(({ bytes, fixture }) => {
    let replay;
    try {
      replay = verifyG17BenchmarkBuildOwnerV3Artifact({ bytes, fixture });
    } catch (error) {
      fail(
        "BUILD_OWNER_INVALID",
        "build-owner-replay",
        "S6 build owner did not replay",
        error,
      );
    }
    return Object.freeze({ bytes, fixture, replay });
  });
}

function snapshotJson(parsed, label, fail) {
  const pending = [Object.freeze({ value: parsed, depth: 0 })];
  let completed = 0;
  let nodes = 0;
  let stringBytes = 0;
  for (
    let cursor = 0;
    cursor < G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.artifactMaximumBytes &&
    cursor < pending.length;
    cursor += 1
  ) {
    const frame = pending[cursor];
    const value = frame.value;
    if (frame.depth > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumDepth) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds depth");
    }
    if (value === null || typeof value === "boolean") {
      completed += 1;
      continue;
    }
    if (typeof value === "string") {
      const bytes = Buffer.byteLength(value, "utf8");
      stringBytes += bytes;
      if (
        bytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.singleStringUtf8MaximumBytes ||
        stringBytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.aggregateStringUtf8MaximumBytes
      ) {
        fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds strings");
      }
      completed += 1;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " number drifted");
      }
      completed += 1;
      continue;
    }
    if (typeof value !== "object" || types.isProxy(value)) {
      fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " is non-JSON");
    }
    const array = Array.isArray(value);
    if (
      Object.getPrototypeOf(value) !==
      (array ? Array.prototype : Object.prototype)
    ) {
      fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " prototype drifted");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumPropertiesPerRecord ||
      (array && value.length > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumArrayLength)
    ) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " shape exceeds bound");
    }
    nodes += 1;
    if (nodes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.maximumNodes) {
      fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds nodes");
    }
    let arrayIndexes = 0;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") {
        fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " has a symbol key");
      }
      if (array && key === "length") continue;
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
        fail(
          "INPUT_SHAPE_INVALID",
          "artifact-snapshot",
          label + " contains non-enumerable data",
        );
      }
      if (array) {
        if (key !== String(arrayIndexes)) {
          fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " array is sparse");
        }
        arrayIndexes += 1;
      }
      const keyBytes = Buffer.byteLength(key, "utf8");
      stringBytes += keyBytes;
      if (
        keyBytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.singleStringUtf8MaximumBytes ||
        stringBytes > G17_BENCHMARK_PRODUCT_OWNER_V4_LIMITS.aggregateStringUtf8MaximumBytes
      ) {
        fail(
          "LIMIT_EXCEEDED",
          "artifact-snapshot",
          label + " exceeds property-name and value strings",
        );
      }
      pending.push(
        Object.freeze({
          value: descriptor.value,
          depth: frame.depth + 1,
        }),
      );
    }
    if (array && arrayIndexes !== value.length) {
      fail("INPUT_SHAPE_INVALID", "artifact-snapshot", label + " array is sparse");
    }
    Object.freeze(value);
    completed += 1;
  }
  if (completed !== pending.length) {
    fail("LIMIT_EXCEEDED", "artifact-snapshot", label + " exceeds work bound");
  }
  return parsed;
}

function decodeVerifiedOwnerBeforeBuildReplay(envelope) {
  const value = envelope.bytes;
  if (
    !Buffer.isBuffer(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Buffer.prototype
  ) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "product owner is not an exact Buffer");
  }
  const bytes = Buffer.from(value);
  if (bytes.length > G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES) {
    fail("LIMIT_EXCEEDED", "input-bounds", "product owner exceeds bound");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner is not UTF-8",
      error,
    );
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner framing drifted",
    );
  }
  let owner;
  try {
    owner = snapshotJson(JSON.parse(text), "product owner", fail);
  } catch (error) {
    if (error instanceof G17BenchmarkProductOwnerV4ContractError) throw error;
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner JSON drifted",
      error,
    );
  }
  const canonical = Buffer.from(canonicalJson(owner) + "\n", "utf8");
  if (!bytes.equals(canonical)) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner is not canonical JSON plus LF",
    );
  }
  if (
    owner === null ||
    typeof owner !== "object" ||
    Array.isArray(owner) ||
    Object.getPrototypeOf(owner) !== Object.prototype
  ) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      "canonical-decoding",
      "product owner root is not a plain record",
    );
  }
  const { contentHash, ...unsigned } = owner;
  if (
    typeof contentHash !== "string" ||
    contentHash !== canonicalSha256(unsigned)
  ) {
    fail(
      "CONTENT_HASH_MISMATCH",
      "content-hash-validation",
      "product owner contentHash does not verify",
    );
  }
  const rootKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(owner));
  if (
    rootKeys.length !== 11 ||
    rootKeys[0] !== "authority" ||
    rootKeys[1] !== "binding" ||
    rootKeys[2] !== "bindings" ||
    rootKeys[3] !== "builds" ||
    rootKeys[4] !== "contentHash" ||
    rootKeys[5] !== "controlRunId" ||
    rootKeys[6] !== "finalDecisionEligible" ||
    rootKeys[7] !== "nonclaims" ||
    rootKeys[8] !== "physicalOrigin" ||
    rootKeys[9] !== "schema" ||
    rootKeys[10] !== "status"
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "product owner fields drifted",
    );
  }
  if (
    owner.schema !== "oxigraph.g1.7-benchmark-product-owner/v4" ||
    owner.status !== "PRODUCT_OWNER_V4_REPLAYED_AUTHORITY_NULL" ||
    owner.bindings === null ||
    typeof owner.bindings !== "object" ||
    Array.isArray(owner.bindings) ||
    Object.getPrototypeOf(owner.bindings) !== Object.prototype ||
    !Array.isArray(owner.builds) ||
    owner.builds.length !== G17_BENCHMARK_BUILD_PLAN.length
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "product owner identity drifted",
    );
  }
  const bindingKeys = Reflect.ownKeys(
    Object.getOwnPropertyDescriptors(owner.bindings),
  );
  if (
    bindingKeys.length !== 4 ||
    bindingKeys[0] !== "authorization" ||
    bindingKeys[1] !== "executionPlan" ||
    bindingKeys[2] !== "platform" ||
    bindingKeys[3] !== "toolchain"
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "product owner bindings drifted",
    );
  }
  for (let index = 0; index < G17_BENCHMARK_BUILD_PLAN.length; index += 1) {
    const build = owner.builds[index];
    if (
      build === null ||
      typeof build !== "object" ||
      Array.isArray(build) ||
      Object.getPrototypeOf(build) !== Object.prototype ||
      build.generations === null ||
      typeof build.generations !== "object" ||
      Array.isArray(build.generations) ||
      Object.getPrototypeOf(build.generations) !== Object.prototype
    ) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "product owner build identity drifted",
      );
    }
    const buildKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(build));
    const generationKeys = Reflect.ownKeys(
      Object.getOwnPropertyDescriptors(build.generations),
    );
    if (
      buildKeys.length !== 8 ||
      buildKeys[0] !== "buildId" ||
      buildKeys[1] !== "executionRequestV2" ||
      buildKeys[2] !== "generations" ||
      buildKeys[3] !== "ordinal" ||
      buildKeys[4] !== "owner" ||
      buildKeys[5] !== "productRole" ||
      buildKeys[6] !== "sourceProjection" ||
      buildKeys[7] !== "target" ||
      generationKeys.length !== 6 ||
      generationKeys[0] !== "containment" ||
      generationKeys[1] !== "lifecycle" ||
      generationKeys[2] !== "owner" ||
      generationKeys[3] !== "process" ||
      generationKeys[4] !== "target" ||
      generationKeys[5] !== "workspace"
    ) {
      fail(
        "IDENTITY_INVALID",
        "identity-validation",
        "product owner build fields drifted",
      );
    }
  }
  return Object.freeze({ owner, bytes });
}

function validateVerifiedOwnerBeforeBuildReplay(envelope) {
  const verified = decodeVerifiedOwnerBeforeBuildReplay(envelope);
  return verified;
}

function copyArtifactIdentity(value) {
  return Object.freeze({
    schema: value.schema,
    rawSha256: value.rawSha256,
    contentHash: value.contentHash,
  });
}

function copySourceProjection(value) {
  return Object.freeze({
    schema: value.schema,
    rawSha256: value.rawSha256,
    contentHash: value.contentHash,
    controlRunId: value.controlRunId,
    buildId: value.buildId,
    productRole: value.productRole,
    workspaceGeneration: value.workspaceGeneration,
    targetGeneration: value.targetGeneration,
  });
}

function copyAuthorization(value) {
  return Object.freeze({
    schema: value.schema,
    rawSha256: value.rawSha256,
    contentHash: value.contentHash,
  });
}

function copyFileIdentity(value) {
  return Object.freeze({
    device: value.device,
    inode: value.inode,
    uid: value.uid,
    gid: value.gid,
    mode: value.mode,
    nlink: value.nlink,
    size: value.size,
  });
}

function copyTool(value) {
  return Object.freeze({
    logicalPath: value.logicalPath,
    sha256: value.sha256,
    identity: copyFileIdentity(value.identity),
  });
}

function sameAuthorization(left, right) {
  return (
    left.schema === right.schema &&
    left.rawSha256 === right.rawSha256 &&
    left.contentHash === right.contentHash
  );
}

function sameArtifactIdentity(left, right) {
  return (
    left.schema === right.schema &&
    left.rawSha256 === right.rawSha256 &&
    left.contentHash === right.contentHash
  );
}

function sameSourceProjection(left, right) {
  return (
    left.schema === right.schema &&
    left.rawSha256 === right.rawSha256 &&
    left.contentHash === right.contentHash &&
    left.controlRunId === right.controlRunId &&
    left.buildId === right.buildId &&
    left.productRole === right.productRole &&
    left.workspaceGeneration === right.workspaceGeneration &&
    left.targetGeneration === right.targetGeneration
  );
}

function samePlatform(left, right) {
  return left.platformRootSha256 === right.platformRootSha256;
}

function sameFileIdentity(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size
  );
}

function sameTool(left, right) {
  return (
    left.logicalPath === right.logicalPath &&
    left.sha256 === right.sha256 &&
    sameFileIdentity(left.identity, right.identity)
  );
}

function sameToolchain(left, right) {
  return (
    left.toolchainRootSha256 === right.toolchainRootSha256 &&
    sameTool(left.cargo, right.cargo) &&
    sameTool(left.rustc, right.rustc)
  );
}

function localGenerationsCollide(
  ownerGeneration,
  workspaceGeneration,
  targetGeneration,
  processGeneration,
  containmentGeneration,
  lifecycleGeneration,
) {
  return (
    ownerGeneration === workspaceGeneration ||
    ownerGeneration === targetGeneration ||
    ownerGeneration === processGeneration ||
    ownerGeneration === containmentGeneration ||
    ownerGeneration === lifecycleGeneration ||
    workspaceGeneration === targetGeneration ||
    workspaceGeneration === processGeneration ||
    workspaceGeneration === containmentGeneration ||
    workspaceGeneration === lifecycleGeneration ||
    targetGeneration === processGeneration ||
    targetGeneration === containmentGeneration ||
    targetGeneration === lifecycleGeneration ||
    processGeneration === containmentGeneration ||
    processGeneration === lifecycleGeneration ||
    containmentGeneration === lifecycleGeneration
  );
}

function generationsOverlap(
  leftOwner,
  leftWorkspace,
  leftTarget,
  leftProcess,
  leftContainment,
  leftLifecycle,
  rightOwner,
  rightWorkspace,
  rightTarget,
  rightProcess,
  rightContainment,
  rightLifecycle,
) {
  return (
    leftOwner === rightOwner ||
    leftOwner === rightWorkspace ||
    leftOwner === rightTarget ||
    leftOwner === rightProcess ||
    leftOwner === rightContainment ||
    leftOwner === rightLifecycle ||
    leftWorkspace === rightOwner ||
    leftWorkspace === rightWorkspace ||
    leftWorkspace === rightTarget ||
    leftWorkspace === rightProcess ||
    leftWorkspace === rightContainment ||
    leftWorkspace === rightLifecycle ||
    leftTarget === rightOwner ||
    leftTarget === rightWorkspace ||
    leftTarget === rightTarget ||
    leftTarget === rightProcess ||
    leftTarget === rightContainment ||
    leftTarget === rightLifecycle ||
    leftProcess === rightOwner ||
    leftProcess === rightWorkspace ||
    leftProcess === rightTarget ||
    leftProcess === rightProcess ||
    leftProcess === rightContainment ||
    leftProcess === rightLifecycle ||
    leftContainment === rightOwner ||
    leftContainment === rightWorkspace ||
    leftContainment === rightTarget ||
    leftContainment === rightProcess ||
    leftContainment === rightContainment ||
    leftContainment === rightLifecycle ||
    leftLifecycle === rightOwner ||
    leftLifecycle === rightWorkspace ||
    leftLifecycle === rightTarget ||
    leftLifecycle === rightProcess ||
    leftLifecycle === rightContainment ||
    leftLifecycle === rightLifecycle
  );
}

function buildsOverlap(left, right) {
  return generationsOverlap(
    left.ownerGeneration,
    left.workspaceGeneration,
    left.targetGeneration,
    left.processGeneration,
    left.containmentGeneration,
    left.lifecycleGeneration,
    right.ownerGeneration,
    right.workspaceGeneration,
    right.targetGeneration,
    right.processGeneration,
    right.containmentGeneration,
    right.lifecycleGeneration,
  );
}

function projectBuild(entry, plan, ordinal) {
  const replay = entry.replay;
  const owner = replay.owner;
  const identity = owner.identity;
  const source = owner.bindings.sourceProjection;
  const requestIdentity = owner.bindings.executionRequestV2;
  const request = entry.fixture.executionRequestV2Verification.expected;
  const requestSource = request.source;
  const authorizationValue = request.authorization;
  const platformValue = request.platform;
  const cargoValue = platformValue.cargo;
  const rustcValue = platformValue.rustc;
  const observedTarget = owner.observations.target;
  const executableValue = observedTarget.executable;
  if (
    identity.ordinal !== ordinal ||
    identity.buildId !== plan.buildId ||
    identity.productRole !== plan.productRole
  ) {
    fail(
      "IDENTITY_INVALID",
      "build-order-validation",
      "product build order drifted",
    );
  }
  if (
    requestSource.rawSha256 !== source.rawSha256 ||
    requestSource.contentHash !== source.contentHash ||
    requestSource.controlRunId !== source.controlRunId ||
    requestSource.buildId !== source.buildId ||
    requestSource.productRole !== source.productRole ||
    requestSource.workspaceGeneration !== source.workspaceGeneration ||
    requestSource.targetGeneration !== source.targetGeneration ||
    request.controlRunId !== identity.controlRunId ||
    request.buildId !== identity.buildId ||
    request.productRole !== identity.productRole
  ) {
    fail(
      "SOURCE_BINDING_DRIFT",
      "source-binding",
      "product source binding drifted",
    );
  }
  if (
    request.ownership.ordinal !== identity.ordinal ||
    request.ownership.ownerGeneration !== identity.ownerGeneration ||
    request.ownership.processGeneration !== identity.processGeneration ||
    requestIdentity.schema !== "oxigraph.g1.7-benchmark-execution-request/v2"
  ) {
    fail(
      "SOURCE_BINDING_DRIFT",
      "request-binding",
      "product request binding drifted",
    );
  }
  if (authorizationValue.schema !== "oxigraph.g1.7-control-authorization/v3") {
    fail(
      "AUTHORIZATION_BINDING_DRIFT",
      "authorization-binding",
      "product authorization binding drifted",
    );
  }
  if (
    cargoValue.logicalPath === rustcValue.logicalPath ||
    cargoValue.sha256 === rustcValue.sha256 ||
    sameFileIdentity(cargoValue.identity, rustcValue.identity)
  ) {
    fail(
      "TOOLCHAIN_BINDING_DRIFT",
      "toolchain-binding",
      "product toolchain aliases",
    );
  }
  if (observedTarget.generation !== identity.targetGeneration) {
    fail(
      "EXPECTED_INPUT_MISMATCH",
      "expected-input-validation",
      "product target generation drifted",
    );
  }
  const authorization = copyAuthorization(authorizationValue);
  const platform = Object.freeze({
    platformRootSha256: platformValue.platformRootSha256,
  });
  const toolchain = Object.freeze({
    toolchainRootSha256: platformValue.toolchainRootSha256,
    cargo: copyTool(cargoValue),
    rustc: copyTool(rustcValue),
  });
  if (
    localGenerationsCollide(
      identity.ownerGeneration,
      identity.workspaceGeneration,
      identity.targetGeneration,
      identity.processGeneration,
      identity.containmentGeneration,
      identity.lifecycleGeneration,
    )
  ) {
    fail(
      "GENERATION_COLLISION",
      "generation-validation",
      "product build generations collide",
    );
  }
  const ownerIdentity = copyArtifactIdentity(replay.identity);
  const sourceProjection = copySourceProjection(source);
  const executionRequestV2 = copyArtifactIdentity(requestIdentity);
  const target = Object.freeze({
    executable: Object.freeze({
      bytes: executableValue.bytes,
      logicalPath: executableValue.logicalPath,
      sha256: executableValue.sha256,
    }),
    generation: observedTarget.generation,
  });
  return Object.freeze({
    authorization,
    platform,
    toolchain,
    buildId: identity.buildId,
    executionRequestV2,
    containmentGeneration: identity.containmentGeneration,
    lifecycleGeneration: identity.lifecycleGeneration,
    ordinal: identity.ordinal,
    owner: ownerIdentity,
    ownerGeneration: identity.ownerGeneration,
    processGeneration: identity.processGeneration,
    productRole: identity.productRole,
    sourceProjection,
    target,
    targetGeneration: identity.targetGeneration,
    workspaceGeneration: identity.workspaceGeneration,
  });
}

function artifactFor(bytes) {
  const stored = Buffer.from(bytes);
  return Object.freeze({ name: G17_BENCHMARK_PRODUCT_OWNER_V4_ARTIFACT_NAME, rawSha256: createHash("sha256").update(stored).digest("hex"), get bytes() { return Buffer.from(stored); } });
}

function created(owner, bytes, includeArtifact) {
  const identity = Object.freeze({
    schema: G17_BENCHMARK_PRODUCT_OWNER_V4_SCHEMA,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    contentHash: owner.contentHash,
  });
  const projection = Object.freeze({
    authority: owner.authority,
    binding: null,
    bindings: owner.bindings,
    builds: owner.builds,
    controlRunId: owner.controlRunId,
    finalDecisionEligible: false,
    nonclaims: owner.nonclaims,
    physicalOrigin: false,
    productOwner: identity,
    schema: G17_BENCHMARK_PRODUCT_OWNER_V4_PROJECTION_SCHEMA,
    status: STATUS,
  });
  if (includeArtifact) {
    return Object.freeze({
      owner,
      identity,
      projection,
      artifact: artifactFor(bytes),
    });
  }
  return Object.freeze({ owner, identity, projection });
}

function expectedOwner(verified, envelope, builds) {
  if (verified === undefined && envelope.bytes !== undefined) {
    fail("INPUT_SHAPE_INVALID", "input-shape", "creation input fields drifted");
  }
  if (
    verified !== undefined &&
    (verified.owner.physicalOrigin !== false ||
      verified.owner.binding !== null ||
      verified.owner.finalDecisionEligible !== false ||
      !isDeepStrictEqual(
        verified.owner.authority,
        G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY,
      ) ||
      !isDeepStrictEqual(
        verified.owner.nonclaims,
        G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS,
      ))
  ) {
    fail(
      "AUTHORITY_OVERCLAIM",
      "authority-validation",
      "product owner overclaims origin, authority, or eligibility",
    );
  }
  const first = projectBuild(builds[0], G17_BENCHMARK_BUILD_PLAN[0], 1);
  const second = projectBuild(builds[1], G17_BENCHMARK_BUILD_PLAN[1], 2);
  const third = projectBuild(builds[2], G17_BENCHMARK_BUILD_PLAN[2], 3);
  const fourth = projectBuild(builds[3], G17_BENCHMARK_BUILD_PLAN[3], 4);
  const controlRunId = first.sourceProjection.controlRunId;
  if (
    second.sourceProjection.controlRunId !== controlRunId ||
    third.sourceProjection.controlRunId !== controlRunId ||
    fourth.sourceProjection.controlRunId !== controlRunId
  ) {
    fail(
      "IDENTITY_INVALID",
      "control-run-validation",
      "product builds do not share one control run",
    );
  }
  if (
    first.owner.rawSha256 === second.owner.rawSha256 ||
    first.owner.rawSha256 === third.owner.rawSha256 ||
    first.owner.rawSha256 === fourth.owner.rawSha256 ||
    second.owner.rawSha256 === third.owner.rawSha256 ||
    second.owner.rawSha256 === fourth.owner.rawSha256 ||
    third.owner.rawSha256 === fourth.owner.rawSha256
  ) {
    fail(
      "GENERATION_COLLISION",
      "owner-identity-validation",
      "product build-owner identities are not distinct",
    );
  }
  if (
    buildsOverlap(first, second) ||
    buildsOverlap(first, third) ||
    buildsOverlap(first, fourth) ||
    buildsOverlap(second, third) ||
    buildsOverlap(second, fourth) ||
    buildsOverlap(third, fourth)
  ) {
    fail(
      "GENERATION_COLLISION",
      "generation-validation",
      "product generations are not globally distinct",
    );
  }
  if (
    !sameAuthorization(first.authorization, second.authorization) ||
    !sameAuthorization(first.authorization, third.authorization) ||
    !sameAuthorization(first.authorization, fourth.authorization)
  ) {
    fail(
      "AUTHORIZATION_BINDING_DRIFT",
      "authorization-binding",
      "product builds do not share authorization",
    );
  }
  if (
    first.platform.platformRootSha256 !== second.platform.platformRootSha256 ||
    first.platform.platformRootSha256 !== third.platform.platformRootSha256 ||
    first.platform.platformRootSha256 !== fourth.platform.platformRootSha256
  ) {
    fail(
      "PLATFORM_BINDING_DRIFT",
      "platform-binding",
      "product builds do not share platform identity",
    );
  }
  if (
    !sameToolchain(first.toolchain, second.toolchain) ||
    !sameToolchain(first.toolchain, third.toolchain) ||
    !sameToolchain(first.toolchain, fourth.toolchain)
  ) {
    fail(
      "TOOLCHAIN_BINDING_DRIFT",
      "toolchain-binding",
      "product builds do not share toolchain identity",
    );
  }
  const firstValue = Object.freeze({
    buildId: first.buildId,
    executionRequestV2: first.executionRequestV2,
    generations: Object.freeze({
      containment: first.containmentGeneration,
      lifecycle: first.lifecycleGeneration,
      owner: first.ownerGeneration,
      "process": first.processGeneration,
      target: first.targetGeneration,
      workspace: first.workspaceGeneration,
    }),
    ordinal: first.ordinal,
    owner: first.owner,
    productRole: first.productRole,
    sourceProjection: first.sourceProjection,
    target: first.target,
  });
  const secondValue = Object.freeze({
    buildId: second.buildId,
    executionRequestV2: second.executionRequestV2,
    generations: Object.freeze({
      containment: second.containmentGeneration,
      lifecycle: second.lifecycleGeneration,
      owner: second.ownerGeneration,
      "process": second.processGeneration,
      target: second.targetGeneration,
      workspace: second.workspaceGeneration,
    }),
    ordinal: second.ordinal,
    owner: second.owner,
    productRole: second.productRole,
    sourceProjection: second.sourceProjection,
    target: second.target,
  });
  const thirdValue = Object.freeze({
    buildId: third.buildId,
    executionRequestV2: third.executionRequestV2,
    generations: Object.freeze({
      containment: third.containmentGeneration,
      lifecycle: third.lifecycleGeneration,
      owner: third.ownerGeneration,
      "process": third.processGeneration,
      target: third.targetGeneration,
      workspace: third.workspaceGeneration,
    }),
    ordinal: third.ordinal,
    owner: third.owner,
    productRole: third.productRole,
    sourceProjection: third.sourceProjection,
    target: third.target,
  });
  const fourthValue = Object.freeze({
    buildId: fourth.buildId,
    executionRequestV2: fourth.executionRequestV2,
    generations: Object.freeze({
      containment: fourth.containmentGeneration,
      lifecycle: fourth.lifecycleGeneration,
      owner: fourth.ownerGeneration,
      "process": fourth.processGeneration,
      target: fourth.targetGeneration,
      workspace: fourth.workspaceGeneration,
    }),
    ordinal: fourth.ordinal,
    owner: fourth.owner,
    productRole: fourth.productRole,
    sourceProjection: fourth.sourceProjection,
    target: fourth.target,
  });
  const bindings = Object.freeze({
    authorization: first.authorization,
    executionPlan: EXECUTION_PLAN,
    platform: first.platform,
    toolchain: first.toolchain,
  });
  const productBuilds = Object.freeze([
    firstValue,
    secondValue,
    thirdValue,
    fourthValue,
  ]);
  const unsigned = Object.freeze({
    authority: G17_BENCHMARK_PRODUCT_OWNER_V4_AUTHORITY,
    binding: null,
    bindings,
    builds: productBuilds,
    controlRunId,
    finalDecisionEligible: false,
    nonclaims: G17_BENCHMARK_PRODUCT_OWNER_V4_NONCLAIMS,
    physicalOrigin: false,
    schema: G17_BENCHMARK_PRODUCT_OWNER_V4_SCHEMA,
    status: STATUS,
  });
  const owner = Object.freeze({
    authority: unsigned.authority,
    binding: unsigned.binding,
    bindings: unsigned.bindings,
    builds: unsigned.builds,
    contentHash: ownerContentHash(unsigned),
    controlRunId: unsigned.controlRunId,
    finalDecisionEligible: unsigned.finalDecisionEligible,
    nonclaims: unsigned.nonclaims,
    physicalOrigin: unsigned.physicalOrigin,
    schema: unsigned.schema,
    status: unsigned.status,
  });
  const bytes = canonicalBytes(owner);
  if (bytes.length > G17_BENCHMARK_PRODUCT_OWNER_V4_MAX_BYTES) {
    fail("LIMIT_EXCEEDED", "canonical-encoding", "product owner exceeds bound");
  }
  if (
    verified !== undefined &&
    (!sameSourceProjection(
      verified.owner.builds[0].sourceProjection,
      firstValue.sourceProjection,
    ) ||
      !sameArtifactIdentity(
        verified.owner.builds[0].executionRequestV2,
        firstValue.executionRequestV2,
      ) ||
      !sameSourceProjection(
        verified.owner.builds[1].sourceProjection,
        secondValue.sourceProjection,
      ) ||
      !sameArtifactIdentity(
        verified.owner.builds[1].executionRequestV2,
        secondValue.executionRequestV2,
      ) ||
      !sameSourceProjection(
        verified.owner.builds[2].sourceProjection,
        thirdValue.sourceProjection,
      ) ||
      !sameArtifactIdentity(
        verified.owner.builds[2].executionRequestV2,
        thirdValue.executionRequestV2,
      ) ||
      !sameSourceProjection(
        verified.owner.builds[3].sourceProjection,
        fourthValue.sourceProjection,
      ) ||
      !sameArtifactIdentity(
        verified.owner.builds[3].executionRequestV2,
        fourthValue.executionRequestV2,
      ))
  ) {
    fail(
      "SOURCE_BINDING_DRIFT",
      "source-binding",
      "product serialized source or request binding drifted",
    );
  }
  if (
    verified !== undefined &&
    !sameAuthorization(verified.owner.bindings.authorization, first.authorization)
  ) {
    fail(
      "AUTHORIZATION_BINDING_DRIFT",
      "authorization-binding",
      "product authorization binding drifted",
    );
  }
  if (
    verified !== undefined &&
    !isDeepStrictEqual(verified.owner.bindings.executionPlan, EXECUTION_PLAN)
  ) {
    fail(
      "EXECUTION_PLAN_BINDING_DRIFT",
      "execution-plan-binding",
      "product execution-plan binding drifted",
    );
  }
  if (
    verified !== undefined &&
    !samePlatform(verified.owner.bindings.platform, first.platform)
  ) {
    fail(
      "PLATFORM_BINDING_DRIFT",
      "platform-binding",
      "product platform binding drifted",
    );
  }
  if (
    verified !== undefined &&
    !sameToolchain(verified.owner.bindings.toolchain, first.toolchain)
  ) {
    fail(
      "TOOLCHAIN_BINDING_DRIFT",
      "toolchain-binding",
      "product toolchain binding drifted",
    );
  }
  if (
    verified !== undefined &&
    verified.owner.contentHash !== owner.contentHash
  ) {
    fail(
      "EXPECTED_INPUT_MISMATCH",
      "expected-input-validation",
      "product owner differs from expected build inputs",
    );
  }
  return created(owner, bytes, verified === undefined);
}

export function g17BenchmarkProductOwnerV4Readiness() {
  return READINESS;
}

export function createG17BenchmarkProductOwnerV4Artifact(input) {
  const envelope = ownDataRecord(input, false);
  return expectedOwner(undefined, envelope, normalizeBuilds(envelope.builds));
}

export function verifyG17BenchmarkProductOwnerV4Artifact(input) {
  const envelope = ownDataRecord(input, true);
  const verified = validateVerifiedOwnerBeforeBuildReplay(envelope);
  return expectedOwner(verified, envelope, normalizeBuilds(envelope.builds));
}
