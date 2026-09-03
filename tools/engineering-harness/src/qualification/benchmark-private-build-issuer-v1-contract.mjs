import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "./benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
} from "./benchmark-execution-request-v2-contract.mjs";
import {
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
  G17_CARGO_EXECVEAT_HELPER_POLICY_BINDINGS,
  G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256,
} from "./cargo-execveat-helper-attestation-contract.mjs";
import {
  G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
  G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
  G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
} from "./cargo-execveat-status-protocol-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "./non-tmpfs-build-isolation-v2-contract.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_V2_ARTIFACT_NAME,
  G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES,
  G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS,
  G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
} from "./non-tmpfs-containment-v2-contract.mjs";

// This module only serializes and verifies an authority-null requirements
// artifact. It performs no I/O, native action, launch, containment, or
// filesystem mutation and cannot issue a physical owner.

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA =
  "oxigraph.g1.7-benchmark-private-build-issuer-requirements/v1";
export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-private-build-issuer-requirements-projection/v1";
export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_ARTIFACT_NAME =
  "benchmark-private-build-issuer-v1-requirements.json";
export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES =
  2 * 1024 * 1024;

const STATUS = "DORMANT_REQUIREMENTS_ONLY";
const REQUIREMENT_MODE = "prescriptive-not-observed";
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;
const objectEntries = Object.entries;
const objectValues = Object.values;
const objectFreeze = Object.freeze;
const objectIsFrozen = Object.isFrozen;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferIsBuffer = Buffer.isBuffer.bind(Buffer);
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const typedArrayPrototype = objectGetPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "IDENTITY_INVALID",
  "DEPENDENCY_BINDING_DRIFT",
  "REQUIREMENTS_CONTRACT_DRIFT",
  "AUTHORITY_OVERCLAIM",
]);

const ERROR_CODE_SET = new Set(
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES,
);

export class G17BenchmarkPrivateBuildIssuerV1ContractError extends Error {
  constructor(code, phase, message, options = undefined) {
    if (!ERROR_CODE_SET.has(code)) {
      throw new TypeError(
        "unknown G1.7 benchmark private build issuer v1 contract error code",
      );
    }
    super(
      `G1.7 benchmark private build issuer v1 contract: [${code}] ${phase}: ${message}`,
      options,
    );
    this.name = "G17BenchmarkPrivateBuildIssuerV1ContractError";
    this.code = code;
    this.phase = phase;
  }
}

function fail(code, phase, message, cause = undefined) {
  throw new G17BenchmarkPrivateBuildIssuerV1ContractError(
    code,
    phase,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((child) => cloneValue(child));
  if (value !== null && typeof value === "object") {
    return nullRecord(
      objectEntries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !objectIsFrozen(value)
  ) {
    objectFreeze(value);
    for (const child of objectValues(value)) deepFreeze(child);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function intrinsicBufferCopy(value) {
  const length = typedArrayLengthGetter.call(value);
  const copied = bufferAllocUnsafe(length);
  typedArraySet.call(copied, value);
  return copied;
}

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS =
  deepFreeze(
    cloneValue({
      artifactMaximumBytes:
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES,
      maximumDepth: 64,
      maximumNodes: 32_768,
      maximumArrayLength: 4_096,
      maximumPropertiesPerRecord: 4_097,
      aggregateStringUtf8MaximumBytes:
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES,
      singleStringUtf8MaximumBytes: 1024 * 1024,
      envelopeRootDepth: 0,
      artifactBufferExcludedFromStructuredNodeBudget: true,
      propertyNamesCountTowardAggregateStringBudget: true,
      artifactBufferExcludedFromStringBudget: true,
    }),
  );

const AUTHORITY_KEYS = [
  "buildExecutionAuthority",
  "launchExecutionAuthority",
  "helperExecutionAuthority",
  "cargoExecutionAuthority",
  "containmentExecutionAuthority",
  "nativeProcessExecutionAuthority",
  "nativeObservationAuthority",
  "physicalIssuanceAuthority",
  "cleanupAuthority",
  "controlExecutionAuthority",
  "qualificationExecutionAuthority",
  "receiptAuthority",
  "promotionAuthority",
  "publicationAuthority",
  "providerExecutionAuthority",
  "routerQualityAuthority",
];

const ADDITIVE_NONCLAIM_KEYS = [
  "productionLifecycleEntrypointImplemented",
  "sourceWorkspaceBuildBegun",
  "sourceWorkspaceTerminalRevalidationObserved",
  "exactExecutionRequestV2Constructed",
  "heldDescriptorPreparationObserved",
  "childDescriptorAliasExclusionObserved",
  "durableCommitObserved",
  "qualifiedHelperImageExecutionObserved",
  "statusTerminalSequenceObserved",
  "stdoutClosureAndEofObserved",
  "stderrClosureAndEofObserved",
  "cargoJsonlValidityObserved",
  "cargoProcessOutcomeObserved",
  "exclusiveDirectChildPidfdWaitObserved",
  "completeCgroupQuiescenceObserved",
  "heldTargetAncestryObserved",
  "heldTargetElfObserved",
  "productionWorkspaceFinishObserved",
  "privatePhysicalOriginCapabilityMinted",
  "buildOwnerV3Issued",
  "productOwnerV4Issued",
  "phaseAApproved",
  "phaseBApproved",
  "liveG17ControlExecuted",
  "liveG17SampleExecuted",
  "benchmarkQualificationObserved",
  "qualificationReceiptIssued",
  "humanPromotionObserved",
  "productionReady",
  "currentHostSupported",
  "g22CommitAuthorityInherited",
  "applicationOutputReleased",
  "applicationReceiptIssued",
  "legacyEvidenceReinterpreted",
  "retryAfterDurableCommitPermitted",
  "destructiveCleanupAfterAmbiguityPermitted",
];

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY = deepFreeze(
  nullRecord(AUTHORITY_KEYS.map((key) => [key, false])),
);

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS = deepFreeze(
  nullRecord([
    ...objectEntries(G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS).map(([key]) => [
      key,
      false,
    ]),
    ...ADDITIVE_NONCLAIM_KEYS.map((key) => [key, false]),
  ]),
);

const PROTECTED_PREDECESSOR_SCHEMAS = [
  "oxigraph.g1.7-benchmark-execution-request/v2",
  "oxigraph.g1.7-cargo-execveat-status/v1",
  "oxigraph.g1.7-cargo-execveat-helper-attestation/v1",
  "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2",
  "oxigraph.g1.7-non-tmpfs-containment-evidence/v2",
  "oxigraph.g1.7-benchmark-build-owner/v2",
  "oxigraph.g1.7-benchmark-build-process-evidence/v3",
  "oxigraph.g1.7-benchmark-product-owner/v3",
  "oxigraph.g1.7-qualification-contract/v7",
  "oxigraph.g1.7-control-authorization/v3",
  "oxigraph.g1.7-final-decision-set/v3",
];

const PROTECTED_PREDECESSOR_IDENTITIES = [
  {
    ordinal: 1,
    role: "benchmark-build-owner-v2",
    source: {
      path: "src/qualification/benchmark-owner-contract.mjs",
      sha256:
        "17d62c2984261e0e2d05dcffa1071e24ccafb0a1072805fe92ae002b8fe2b061",
    },
    artifact: {
      schema: "oxigraph.g1.7-benchmark-build-owner/v2",
      projectionSchema: null,
      artifactName: null,
      rawSha256: null,
      contentHash: null,
      identityMode: "input-bound-replay-no-canonical-instance",
    },
    canonicalRequirements: {
      available: false,
      rawSha256: null,
      contentHash: null,
      reason: "no-standalone-canonical-requirements-artifact",
    },
    status: "SUPERVISION_OBSERVATIONS_REPLAYED",
    binding: null,
    finalDecisionEligible: false,
    reinterpretationForbidden: true,
  },
  {
    ordinal: 2,
    role: "benchmark-build-process-evidence-v3",
    source: {
      path: "src/qualification/benchmark-build-process-evidence-v3-contract.mjs",
      sha256:
        "2e06f0553f863e9d93f3049c8818d6895e9a97313198d23e65a79350c8ccf60b",
    },
    artifact: {
      schema: "oxigraph.g1.7-benchmark-build-process-evidence/v3",
      projectionSchema: "oxigraph.g1.7-benchmark-build-process-projection/v3",
      artifactName: null,
      rawSha256: null,
      contentHash: null,
      identityMode: "input-bound-replay-no-canonical-instance",
    },
    canonicalRequirements: {
      available: false,
      rawSha256: null,
      contentHash: null,
      reason: "no-standalone-canonical-requirements-artifact",
    },
    status: "SUCCESSOR_PRIVATE_ISSUER_REQUIRED",
    binding: null,
    finalDecisionEligible: false,
    reinterpretationForbidden: true,
  },
  {
    ordinal: 3,
    role: "benchmark-product-owner-v3",
    source: {
      path: "src/qualification/benchmark-product-owner-contract.mjs",
      sha256:
        "889eb6a7e5817d709f61e485107dbb234974d0d9784ec3709ce1680fde965b64",
    },
    artifact: {
      schema: "oxigraph.g1.7-benchmark-product-owner/v3",
      projectionSchema: "oxigraph.g1.7-benchmark-product-owner-projection/v3",
      artifactName: null,
      rawSha256: null,
      contentHash: null,
      identityMode: "input-bound-replay-no-canonical-instance",
    },
    canonicalRequirements: {
      available: false,
      rawSha256: null,
      contentHash: null,
      reason: "no-standalone-canonical-requirements-artifact",
    },
    status: "BUILD_EVIDENCE_AND_CAPTURE_CLAIMS_REPLAYED",
    binding: null,
    finalDecisionEligible: false,
    reinterpretationForbidden: true,
  },
  {
    ordinal: 4,
    role: "qualification-contract-v7",
    sources: [
      {
        path: "src/qualification/contract-identity.mjs",
        sha256:
          "aaedb76840299b34b217dcdc7a25eec3d15b5a86c8568474c3eabb92e0414704",
      },
      {
        path: "src/qualification/contract.mjs",
        sha256:
          "5f22b1e871f88c316fc0207ff2dfd3bd02fa5aebdba3428ae13f364f60c6e55a",
      },
    ],
    artifact: {
      schema: "oxigraph.g1.7-qualification-contract/v7",
      id: "g1.7-compatibility-performance-qualification",
      path: "qualification/g1.7/contract.json",
      bytes: 19_563,
      rawSha256:
        "42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80",
      contentHash: null,
    },
    canonicalRequirements: {
      available: true,
      rawSha256:
        "42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80",
      contentHash: null,
      reason: null,
    },
    generation: "CURRENT_V7",
    binding: null,
    finalDecisionEligible: false,
    reinterpretationForbidden: true,
  },
  {
    ordinal: 5,
    role: "phase-a-control-authorization",
    sources: [
      {
        path: "src/qualification/control-protocol.mjs",
        sha256:
          "0437c6d564ea93e17acac5066c287b7e8de5c687736503721b72d99910bf0d12",
      },
      {
        path: "src/qualification/control-authorization-gate.mjs",
        sha256:
          "28b2b2bacd82f2fa4730a7cde91de7330c84a6c04004928536df59d9c9b78f3b",
      },
    ],
    artifact: {
      schema: "oxigraph.g1.7-control-authorization/v3",
      id: "control-authorization",
      path: "qualification/g1.7/decisions/control-authorization.json",
      bytes: 11_426,
      rawSha256:
        "31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767",
      contentHash:
        "d61434741577787729dde9c23725523b855fca208e5b891de2a73e8abe0c0bb2",
      protocolSha256:
        "4f5978b873873094196d5d5998565b0acb0bf883beac1466b2fa91343b96c0f2",
      status: "CONTROL_AUTH_PROPOSED",
      approvalStatus: "UNAPPROVED",
    },
    canonicalRequirements: {
      available: true,
      rawSha256:
        "31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767",
      contentHash:
        "d61434741577787729dde9c23725523b855fca208e5b891de2a73e8abe0c0bb2",
      reason: null,
    },
    executionAuthorized: false,
    reinterpretationForbidden: true,
  },
  {
    ordinal: 6,
    role: "phase-b-final-decision",
    source: {
      path: "src/qualification/control-protocol.mjs",
      sha256:
        "0437c6d564ea93e17acac5066c287b7e8de5c687736503721b72d99910bf0d12",
    },
    artifact: {
      schema: "oxigraph.g1.7-final-decision-set/v3",
      id: "final-decision-set",
      path: "qualification/g1.7/decisions/final-decision-set.json",
      bytes: 5_944,
      rawSha256:
        "b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5",
      contentHash:
        "bb4d92160e4d71089ec9d29dc0861ffccf0dbcaa46e87c53d4a49f996fe9ac72",
      status: "PROPOSED",
      approvalStatus: "UNAPPROVED",
      controlReceipt: null,
      negativeControlSignature: null,
      g14bPrerequisite: null,
      controlAuthorization: {
        schema: "oxigraph.g1.7-control-authorization/v3",
        rawSha256:
          "31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767",
        contentHash:
          "d61434741577787729dde9c23725523b855fca208e5b891de2a73e8abe0c0bb2",
      },
    },
    canonicalRequirements: {
      available: true,
      rawSha256:
        "b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5",
      contentHash:
        "bb4d92160e4d71089ec9d29dc0861ffccf0dbcaa46e87c53d4a49f996fe9ac72",
      reason: null,
    },
    executionAuthorized: false,
    finalDecisionEligible: false,
    reinterpretationForbidden: true,
  },
];

const LIFECYCLE = [
  {
    ordinal: 1,
    phase: "authorization-readiness-and-exact-dependency-attestations",
  },
  { ordinal: 2, phase: "source-workspace-revalidation" },
  { ordinal: 3, phase: "execution-request-v2-construction" },
  {
    ordinal: 4,
    phase: "held-fd-type-access-alias-and-image-map-validation",
  },
  {
    ordinal: 5,
    phase: "durable-commit-and-positive-helper-exec-image-proof",
  },
  {
    ordinal: 6,
    phase: "status-terminal-state-and-reserved-exit-agreement",
  },
  {
    ordinal: 7,
    phase: "cargo-exit-stream-closure-eof-bounds-and-jsonl-validity",
  },
  {
    ordinal: 8,
    phase: "exclusive-pidfd-wait-and-direct-child-reap",
  },
  { ordinal: 9, phase: "complete-cgroup-quiescence" },
  {
    ordinal: 10,
    phase: "held-target-ancestry-and-elf-validation",
  },
  { ordinal: 11, phase: "production-workspace-finish" },
  { ordinal: 12, phase: "canonical-build-owner-v3-issuance" },
];

const policyBundle = createG17NonTmpfsBuildIsolationV2PolicyArtifact();

const REQUIREMENTS_BASE = cloneValue({
  schema: G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA,
  status: STATUS,
  requirementMode: REQUIREMENT_MODE,
  productionReadiness: {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  },
  limits: G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS,
  protectedPredecessorSchemas: PROTECTED_PREDECESSOR_SCHEMAS,
  protectedPredecessorIdentities: PROTECTED_PREDECESSOR_IDENTITIES,
  predecessors: {
    executionPlan: {
      schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
      sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipe: {
        schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
        sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      },
    },
    executionRequestV2: {
      schema: G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
      projectionSchema: G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA,
      artifactName: G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME,
      artifactMaximumBytes: G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES,
      limits: G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS,
      policyBinding: G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
      launchCompatibility:
        G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
    },
    helperAttestationV1: {
      schema: G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA,
      projectionSchema: G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
      artifactName: G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME,
      artifactMaximumBytes: G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES,
      sourceLogicalName: G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
      sourceBytes: G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES,
      sourceSha256: G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256,
      compilerPath: G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
      policyBindings: G17_CARGO_EXECVEAT_HELPER_POLICY_BINDINGS,
      requestBindingPlaceholder:
        G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
    },
    statusProtocolV1: {
      schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
      projectionSchema: G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA,
      maximumBytes: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
      maximumFrames: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
      timeoutMilliseconds: G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
      errnoMaximum: G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
      preReadyErrorStages: G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
      reservedExits: G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
      requirementsSha256:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
    },
    isolationPolicyV2: {
      schema: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
      artifactName: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME,
      artifactMaximumBytes: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
      rawSha256: policyBundle.artifact.sha256,
      contentHash: policyBundle.policy.sha256,
      fileDescriptorsSha256:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
      statusProtocolRequirementsSha256:
        G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
    },
    containmentV2: {
      schema: G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA,
      projectionSchema: G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA,
      artifactName: G17_NON_TMPFS_CONTAINMENT_V2_ARTIFACT_NAME,
      artifactMaximumBytes: G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES,
      requirementsSha256: G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
    },
    activationDependencies: [
      {
        adr: "ADR-0037",
        role: "sole-statefs-policy-and-syscall-object",
        exactInterface: null,
        available: false,
        requiredBeforePhysicalEvaluatorDesign: true,
        requiredBeforePhysicalExecution: true,
      },
      {
        adr: "ADR-0038",
        role: "single-qualified-native-adapter",
        exactInterface: null,
        available: false,
        requiredBeforePhysicalEvaluatorDesign: true,
        requiredBeforePhysicalExecution: true,
      },
      {
        adr: "ADR-0039",
        role: "same-host-same-boot-readiness-prerequisite",
        exactReceipt: null,
        available: false,
        sufficientForPositiveExecution: false,
        requiredBeforePhysicalExecution: true,
      },
      {
        adr: "ADR-0040",
        role: "qualified-durable-commit-and-output-primitive",
        exactInterface: null,
        exactActivationReceipt: null,
        available: false,
        requiredBeforePhysicalExecution: true,
        requiredBeforeOutputRelease: true,
      },
    ],
  },
  sourceWorkspace: {
    projectionSchema: "oxigraph.g1.7-product-source-projection/v1",
    privateLiveCapabilityRequired: true,
    sameIssuerInstanceRequired: true,
    singleUseRequired: true,
    nonSerializableRequired: true,
    sameProductionLifecycleRequired: true,
    productionEntrypointAvailable: false,
    callerInjectionForbidden: [
      "process-mechanics",
      "spawn-function",
      "filesystem-callback",
      "cgroup-callback",
      "fd-map",
      "capture-mode",
      "status-observation",
      "reap-claim",
      "serialized-qualified-adapter-substitute",
    ],
  },
  descriptorBoundary: {
    fileDescriptorsSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
    exactChildDescriptorRange:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.exactChildDescriptorRange,
    childFileDescriptors:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.childFileDescriptors,
    imageMaps: G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.imageMaps,
    parentOnlyFileDescriptors:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.parentOnlyFileDescriptors,
    aliasing: G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.aliasing,
    cloexecImmediatelyBeforeCargoExecveat: [6, 7, 8],
  },
  cargoInvocation: {
    program: G17_BENCHMARK_BUILD_PROGRAM,
    argv0: G17_BENCHMARK_BUILD_PROGRAM,
    argv: G17_BENCHMARK_BUILD_ARGV,
    environment: G17_BENCHMARK_BUILD_ENVIRONMENT,
    environmentSha256: G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
    cwd: G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND.cwd,
    targetDirectory: G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND.targetDirectory,
    argc: G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND.argc,
    aggregateArgvUtf8Bytes:
      G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND.aggregateArgvUtf8Bytes,
    exactRequestBindingRequired: true,
    exactHelperAttestationBindingRequired: true,
    exactHeldHelperFd8IdentityBindingRequired: true,
    exactArgvIncludingArgv0Required: true,
    exactEnvironmentRequired: true,
    pathnameLaunchForbidden: true,
    procFdPathnameFallbackForbidden: true,
    execveFallbackForbidden: true,
    fexecveFallbackForbidden: true,
  },
  statusAndObservationBoundary: {
    requirements: G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
    stdoutAndStderrDistinctRequired: true,
    boundedStreamsRequired: true,
    streamCloseAndEofSeparatelyObserved: true,
    cargoJsonlValidityRequired: true,
    processExitSeparatelyObserved: true,
    pidfdReadabilitySeparatelyObserved: true,
    exclusiveWaitidPidfdRequired: true,
    directChildReapRequired: true,
    cgroupProcsEmptyRequired: true,
    cgroupEventsPopulatedZeroRequired: true,
    pidsCurrentZeroRequired: true,
    heldTargetAncestryRequired: true,
    heldTargetMetadataRequired: true,
    heldTargetElfRequired: true,
  },
  lifecycle: LIFECYCLE,
  failureModel: {
    outcomes: ["SUCCESS", "FAIL", "INCONCLUSIVE_RETAINED"],
    success: {
      outcome: "SUCCESS",
      allLifecycleStagesRequired: true,
      targetReleaseAllowed: true,
      buildOwnerV3IssuanceRequired: true,
    },
    definiteNoChildFailure: {
      outcome: "FAIL",
      childMayExist: false,
      retryAllowed: false,
    },
    reapedTerminalFailure: {
      outcome: "FAIL",
      directChildReapRequired: true,
      completeCgroupQuiescenceRequired: true,
      retryAllowed: false,
    },
    ambiguity: {
      outcome: "INCONCLUSIVE_RETAINED",
      condition:
        "child-may-exist-and-direct-reap-or-complete-quiescence-is-unproved",
      dominatesCleanup: true,
      dominatesSuccess: true,
      retainWorkspace: true,
      retainCgroup: true,
      retainDescriptors: true,
      retainHandles: true,
      retainEvidence: true,
      targetReleaseAllowed: false,
      ownerIssuanceAllowed: false,
      retryAllowed: false,
      destructiveCleanupAllowed: false,
    },
    afterDurableCommit: {
      retryAllowed: false,
      relaunchAllowed: false,
      appliesToEveryOutcome: true,
    },
  },
  physicalOrigin: false,
  binding: null,
  finalDecisionEligible: false,
  authority: G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
  nonclaims: G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
});

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS = deepFreeze(
  nullRecord([
    ...objectEntries(REQUIREMENTS_BASE),
    ["contentHash", canonicalSha256(REQUIREMENTS_BASE)],
  ]),
);

export const G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256 =
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.contentHash;

function canonicalRequirementsBytes(requirements) {
  let bytes;
  try {
    bytes = bufferFrom(`${canonicalJson(requirements)}\n`, "utf8");
  } catch (error) {
    fail(
      "REQUIREMENTS_CONTRACT_DRIFT",
      "canonical-encoding",
      "requirements cannot be encoded canonically",
      error,
    );
  }
  if (
    bytes.length < 2 ||
    bytes.length > G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "canonical-encoding",
      "requirements artifact exceeds its byte ceiling",
    );
  }
  return bytes;
}

const CANONICAL_REQUIREMENTS_BYTES = canonicalRequirementsBytes(
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
);

function artifactEnvelope(bytes) {
  const stored = intrinsicBufferCopy(bytes);
  const artifact = Object.create(null);
  Object.defineProperties(artifact, {
    name: {
      value: G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_ARTIFACT_NAME,
      enumerable: true,
    },
    rawSha256: { value: sha256(stored), enumerable: true },
    bytes: {
      get() {
        return intrinsicBufferCopy(stored);
      },
      enumerable: true,
    },
  });
  return objectFreeze(artifact);
}

function identityFor(requirements, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA],
      ["rawSha256", sha256(bytes)],
      ["contentHash", requirements.contentHash],
    ]),
  );
}

function projectionFor(identity) {
  return deepFreeze(
    nullRecord([
      [
        "schema",
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_PROJECTION_SCHEMA,
      ],
      ["requirements", cloneValue(identity)],
      ["status", STATUS],
      [
        "productionReadiness",
        cloneValue(
          G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.productionReadiness,
        ),
      ],
      ["physicalOrigin", false],
      ["binding", null],
      ["finalDecisionEligible", false],
      [
        "authority",
        cloneValue(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
      ],
      [
        "nonclaims",
        cloneValue(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
      ],
    ]),
  );
}

export function createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact() {
  const requirements = deepFreeze(
    cloneValue(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS),
  );
  const bytes = intrinsicBufferCopy(CANONICAL_REQUIREMENTS_BYTES);
  const identity = identityFor(requirements, bytes);
  const projection = projectionFor(identity);
  return objectFreeze(
    nullRecord([
      ["requirements", requirements],
      ["identity", identity],
      ["projection", projection],
      ["artifact", artifactEnvelope(bytes)],
    ]),
  );
}

function copyArtifactBuffer(value, label) {
  const phase = "verification-envelope";
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} prototype cannot be inspected`,
      error,
    );
  }
  if (
    !bufferIsBuffer(value) ||
    types.isProxy(value) ||
    prototype !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} must be an exact non-Proxy Buffer`,
    );
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} length cannot be read intrinsically`,
      error,
    );
  }
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length >
      G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.artifactMaximumBytes
  ) {
    fail("LIMIT_EXCEEDED", phase, `${label} exceeds the artifact byte limit`);
  }
  try {
    return intrinsicBufferCopy(value);
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} cannot be copied intrinsically`,
      error,
    );
  }
}

function snapshotEnvelopeValue(
  value,
  label,
  ancestors = new WeakSet(),
  depth = 0,
  budget = { nodes: 0, strings: 0 },
) {
  const phase = "verification-envelope";
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail("INPUT_SHAPE_INVALID", phase, `${label} contains a Proxy`);
  }
  if (bufferIsBuffer(value)) {
    return copyArtifactBuffer(value, label);
  }
  if (
    depth >
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.maximumDepth
  ) {
    fail("LIMIT_EXCEEDED", phase, `${label} exceeds the depth limit`);
  }
  budget.nodes += 1;
  if (
    budget.nodes >
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.maximumNodes
  ) {
    fail("LIMIT_EXCEEDED", phase, `${label} exceeds the node limit`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = bufferByteLength(value, "utf8");
    budget.strings += bytes;
    if (
      bytes >
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.singleStringUtf8MaximumBytes ||
      budget.strings >
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.aggregateStringUtf8MaximumBytes
    ) {
      fail("LIMIT_EXCEEDED", phase, `${label} exceeds the string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("INPUT_SHAPE_INVALID", phase, `${label} is not finite`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    ArrayBuffer.isView(value)
  ) {
    fail("INPUT_SHAPE_INVALID", phase, `${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) {
    fail("INPUT_SHAPE_INVALID", phase, `${label} contains a cycle`);
  }
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} prototype cannot be inspected`,
      error,
    );
  }
  const array = Array.isArray(value);
  if (
    prototype !== (array ? arrayPrototype : objectPrototype) &&
    !(prototype === null && !array)
  ) {
    fail("INPUT_SHAPE_INVALID", phase, `${label} has a foreign prototype`);
  }
  ancestors.add(value);
  try {
    let descriptors;
    try {
      descriptors = objectGetOwnPropertyDescriptors(value);
    } catch (error) {
      fail(
        "INPUT_SHAPE_INVALID",
        phase,
        `${label} properties cannot be inspected`,
        error,
      );
    }
    const keys = reflectOwnKeys(descriptors);
    if (
      keys.length >
      G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.maximumPropertiesPerRecord
    ) {
      fail("LIMIT_EXCEEDED", phase, `${label} exceeds its property limit`);
    }
    if (keys.some((key) => typeof key !== "string")) {
      fail("INPUT_SHAPE_INVALID", phase, `${label} contains symbol fields`);
    }
    for (const key of keys) {
      budget.strings += bufferByteLength(key, "utf8");
      if (
        budget.strings >
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.aggregateStringUtf8MaximumBytes
      ) {
        fail("LIMIT_EXCEEDED", phase, `${label} exceeds the key budget`);
      }
      if (!("value" in descriptors[key])) {
        fail("INPUT_SHAPE_INVALID", phase, `${label}.${key} is not own data`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        fail("INPUT_SHAPE_INVALID", phase, `${label} is not a dense array`);
      }
      if (
        length >
        G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS.maximumArrayLength
      ) {
        fail("LIMIT_EXCEEDED", phase, `${label} exceeds the array limit`);
      }
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
        fail(
          "INPUT_SHAPE_INVALID",
          phase,
          `${label} is not a field-free dense array`,
        );
      }
      return Array.from({ length }, (_, index) =>
        snapshotEnvelopeValue(
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
      if (!descriptor.enumerable) {
        fail("INPUT_SHAPE_INVALID", phase, `${label}.${key} is not enumerable`);
      }
      output[key] = snapshotEnvelopeValue(
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

function verificationBytes(input) {
  const envelope = snapshotEnvelopeValue(input, "verification input");
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    !isDeepStrictEqual(objectKeys(envelope), ["bytes"]) ||
    !bufferIsBuffer(envelope.bytes)
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      "verification-envelope",
      "verification input must contain only exact artifact bytes",
    );
  }
  return envelope.bytes;
}

function decodeCanonicalRequirements(bytes) {
  const phase = "canonical-decoding";
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "requirements artifact is not UTF-8",
      error,
    );
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "requirements artifact must be one LF-terminated JSON value",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "requirements artifact is invalid JSON",
      error,
    );
  }
  let requirements;
  try {
    requirements = snapshotEnvelopeValue(
      parsed,
      "requirements artifact document",
    );
  } catch (error) {
    if (
      error instanceof G17BenchmarkPrivateBuildIssuerV1ContractError &&
      error.code === "INPUT_SHAPE_INVALID"
    ) {
      fail(
        "CANONICAL_ARTIFACT_INVALID",
        phase,
        "requirements artifact contains noncanonical data",
        error,
      );
    }
    throw error;
  }
  let expectedBytes;
  try {
    expectedBytes = bufferFrom(`${canonicalJson(requirements)}\n`, "utf8");
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "requirements artifact cannot be canonically encoded",
      error,
    );
  }
  if (!bufferEquals.call(bytes, expectedBytes)) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "requirements artifact is not canonical JSON plus one LF",
    );
  }
  return requirements;
}

function validateContentHash(requirements) {
  if (
    requirements === null ||
    typeof requirements !== "object" ||
    Array.isArray(requirements)
  ) {
    fail(
      "CONTENT_HASH_MISMATCH",
      "content-hash-validation",
      "requirements contentHash does not verify",
    );
  }
  const contentHash = requirements?.contentHash;
  const unsigned = nullRecord(
    objectEntries(requirements).filter(([key]) => key !== "contentHash"),
  );
  if (
    typeof contentHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(contentHash) ||
    contentHash !== canonicalSha256(unsigned)
  ) {
    fail(
      "CONTENT_HASH_MISMATCH",
      "content-hash-validation",
      "requirements contentHash does not verify",
    );
  }
}

function validateIdentity(requirements) {
  if (
    requirements?.schema !==
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "requirements schema drifted",
    );
  }
}

function validateDependencyBindings(requirements) {
  const expected = G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS;
  if (
    !isDeepStrictEqual(
      requirements?.protectedPredecessorSchemas,
      expected.protectedPredecessorSchemas,
    ) ||
    !isDeepStrictEqual(
      requirements?.protectedPredecessorIdentities,
      expected.protectedPredecessorIdentities,
    )
  ) {
    fail(
      "DEPENDENCY_BINDING_DRIFT",
      "dependency-binding-validation",
      "protected predecessor identity drifted",
    );
  }
  const predecessors = requirements?.predecessors;
  if (
    predecessors === null ||
    typeof predecessors !== "object" ||
    Array.isArray(predecessors) ||
    !isDeepStrictEqual(
      objectKeys(predecessors).sort(),
      objectKeys(expected.predecessors).sort(),
    )
  ) {
    fail(
      "DEPENDENCY_BINDING_DRIFT",
      "dependency-binding-validation",
      "predecessor fields drifted",
    );
  }
  for (const key of objectKeys(expected.predecessors)) {
    if (
      key !== "activationDependencies" &&
      !isDeepStrictEqual(predecessors[key], expected.predecessors[key])
    ) {
      fail(
        "DEPENDENCY_BINDING_DRIFT",
        "dependency-binding-validation",
        `${key} predecessor binding drifted`,
      );
    }
  }
}

function contractComparable(requirements) {
  const comparable = cloneValue(requirements);
  if (
    comparable === null ||
    typeof comparable !== "object" ||
    Array.isArray(comparable)
  ) {
    return comparable;
  }
  delete comparable.contentHash;
  comparable.schema = G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.schema;
  comparable.protectedPredecessorSchemas = cloneValue(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.protectedPredecessorSchemas,
  );
  comparable.protectedPredecessorIdentities = cloneValue(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.protectedPredecessorIdentities,
  );
  comparable.predecessors = cloneValue(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.predecessors,
  );
  comparable.productionReadiness = cloneValue(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.productionReadiness,
  );
  comparable.authority = cloneValue(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.authority,
  );
  comparable.nonclaims = cloneValue(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS.nonclaims,
  );
  comparable.physicalOrigin = false;
  comparable.binding = null;
  comparable.finalDecisionEligible = false;
  if (
    comparable.sourceWorkspace !== null &&
    typeof comparable.sourceWorkspace === "object" &&
    !Array.isArray(comparable.sourceWorkspace)
  ) {
    comparable.sourceWorkspace.productionEntrypointAvailable = false;
  }
  return comparable;
}

function validateRequirementsContract(requirements) {
  if (
    !isDeepStrictEqual(
      contractComparable(requirements),
      contractComparable(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS),
    )
  ) {
    fail(
      "REQUIREMENTS_CONTRACT_DRIFT",
      "requirements-contract-validation",
      "requirements differ from the frozen contract",
    );
  }
}

function validateAuthorityNull(requirements) {
  const expected = G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS;
  if (
    !isDeepStrictEqual(requirements?.authority, expected.authority) ||
    !isDeepStrictEqual(requirements?.nonclaims, expected.nonclaims) ||
    !isDeepStrictEqual(
      requirements?.productionReadiness,
      expected.productionReadiness,
    ) ||
    requirements?.physicalOrigin !== false ||
    requirements?.binding !== null ||
    requirements?.finalDecisionEligible !== false ||
    requirements?.sourceWorkspace?.productionEntrypointAvailable !== false ||
    !isDeepStrictEqual(
      requirements?.predecessors?.activationDependencies,
      expected.predecessors.activationDependencies,
    )
  ) {
    fail(
      "AUTHORITY_OVERCLAIM",
      "authority-validation",
      "requirements claim unavailable authority, evidence, or eligibility",
    );
  }
}

function validateRequirements(requirements) {
  validateContentHash(requirements);
  validateIdentity(requirements);
  validateDependencyBindings(requirements);
  validateRequirementsContract(requirements);
  validateAuthorityNull(requirements);
}

export function verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(
  input,
) {
  const bytes = verificationBytes(input);
  const requirements = decodeCanonicalRequirements(bytes);
  validateRequirements(requirements);
  deepFreeze(requirements);
  const identity = identityFor(requirements, bytes);
  const projection = projectionFor(identity);
  return objectFreeze(
    nullRecord([
      ["requirements", requirements],
      ["identity", identity],
      ["projection", projection],
    ]),
  );
}
