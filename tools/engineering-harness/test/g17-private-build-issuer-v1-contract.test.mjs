import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as issuerContract from "../src/qualification/benchmark-private-build-issuer-v1-contract.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "../src/qualification/benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
} from "../src/qualification/benchmark-execution-request-v2-contract.mjs";
import {
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES,
  G17_CARGO_EXECVEAT_HELPER_POLICY_BINDINGS,
  G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256,
} from "../src/qualification/cargo-execveat-helper-attestation-contract.mjs";
import {
  G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
  G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
  G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
} from "../src/qualification/cargo-execveat-status-protocol-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_ARTIFACT_NAME,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_MAX_BYTES,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_V2_ARTIFACT_NAME,
  G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS,
  G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES,
  G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
} from "../src/qualification/non-tmpfs-containment-v2-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const {
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_ARTIFACT_NAME,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_PROJECTION_SCHEMA,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA,
  G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
  G17BenchmarkPrivateBuildIssuerV1ContractError,
  createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact,
  verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact,
} = issuerContract;

const EXPECTED_SCHEMA =
  "oxigraph.g1.7-benchmark-private-build-issuer-requirements/v1";
const EXPECTED_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-private-build-issuer-requirements-projection/v1";
const EXPECTED_ARTIFACT_NAME =
  "benchmark-private-build-issuer-v1-requirements.json";
const EXPECTED_MAX_BYTES = 2 * 1024 * 1024;
const EXPECTED_STATUS = "DORMANT_REQUIREMENTS_ONLY";
const EXPECTED_REQUIREMENT_MODE = "prescriptive-not-observed";

const EXPECTED_EXPORTS = [
  "G17BenchmarkPrivateBuildIssuerV1ContractError",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_ARTIFACT_NAME",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_PROJECTION_SCHEMA",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA",
  "G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256",
  "createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact",
  "verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact",
].sort();

const EXPECTED_ERROR_CODES = [
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "IDENTITY_INVALID",
  "DEPENDENCY_BINDING_DRIFT",
  "REQUIREMENTS_CONTRACT_DRIFT",
  "AUTHORITY_OVERCLAIM",
];

const EXPECTED_LIMITS = {
  artifactMaximumBytes: EXPECTED_MAX_BYTES,
  maximumDepth: 64,
  maximumNodes: 32_768,
  maximumArrayLength: 4_096,
  maximumPropertiesPerRecord: 4_097,
  aggregateStringUtf8MaximumBytes: EXPECTED_MAX_BYTES,
  singleStringUtf8MaximumBytes: 1024 * 1024,
  envelopeRootDepth: 0,
  artifactBufferExcludedFromStructuredNodeBudget: true,
  propertyNamesCountTowardAggregateStringBudget: true,
  artifactBufferExcludedFromStringBudget: true,
};

const EXPECTED_AUTHORITY_KEYS = [
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

const EXPECTED_NONCLAIM_KEYS = [
  ...Object.keys(G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS),
  ...ADDITIVE_NONCLAIM_KEYS,
];

const EXPECTED_AUTHORITY = Object.fromEntries(
  EXPECTED_AUTHORITY_KEYS.map((key) => [key, false]),
);
const EXPECTED_NONCLAIMS = Object.fromEntries(
  EXPECTED_NONCLAIM_KEYS.map((key) => [key, false]),
);

const EXPECTED_SOURCE_PINS = Object.freeze({
  "../src/qualification/benchmark-execution-plan.mjs":
    "99b70fc6820fe3b5743bccac349cd7936aa3a04abc0e13f254f1ffee86f0e478",
  "../src/qualification/benchmark-execution-request-v2-contract.mjs":
    "b708df2f3dfa44502e8c66afb9deaa5bac87e0dc2cb714929dd8b53623167edb",
  "../src/qualification/benchmark-owner-contract.mjs":
    "17d62c2984261e0e2d05dcffa1071e24ccafb0a1072805fe92ae002b8fe2b061",
  "../src/qualification/benchmark-build-process-evidence-v3-contract.mjs":
    "2e06f0553f863e9d93f3049c8818d6895e9a97313198d23e65a79350c8ccf60b",
  "../src/qualification/benchmark-product-owner-contract.mjs":
    "889eb6a7e5817d709f61e485107dbb234974d0d9784ec3709ce1680fde965b64",
  "../src/qualification/cargo-execveat-helper-attestation-contract.mjs":
    "f7dfcd24c27d8a1405c147f3de948c4ec07859ea117618e8badc1cb922748f1b",
  "../src/qualification/cargo-execveat-status-protocol-contract.mjs":
    "17f6355bf8706516ba4aab94c2a88131f0a1e8dc4eace8bb02664558b94e200d",
  "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs":
    "4207ff86faa52119d375299afa26237c1511890ef5e943ddd91e4183fa9ffded",
  "../src/qualification/non-tmpfs-containment-v2-contract.mjs":
    "22996e2ad91e85fe2e1304fb74ac8a0b055386e31c49e6fb8b5804b153dddf9b",
  "../src/qualification/product-source-workspace.mjs":
    "0574d599f50764540e3dbdb167ff5b7dbbceb8881ca16bbc51c137e7d7fe84f3",
  "../src/qualification/contract-identity.mjs":
    "aaedb76840299b34b217dcdc7a25eec3d15b5a86c8568474c3eabb92e0414704",
  "../src/qualification/contract.mjs":
    "5f22b1e871f88c316fc0207ff2dfd3bd02fa5aebdba3428ae13f364f60c6e55a",
  "../src/qualification/control-protocol.mjs":
    "0437c6d564ea93e17acac5066c287b7e8de5c687736503721b72d99910bf0d12",
  "../src/qualification/control-authorization-gate.mjs":
    "28b2b2bacd82f2fa4730a7cde91de7330c84a6c04004928536df59d9c9b78f3b",
  "../qualification/g1.7/contract.json":
    "42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80",
  "../qualification/g1.7/decisions/control-authorization.json":
    "31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767",
  "../qualification/g1.7/decisions/final-decision-set.json":
    "b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5",
  "../src/routing/features.mjs":
    "0a1f13a2c85ec0b40f967192dd23d8fda967b9f4eef1825a50a74e995aba5f2d",
  "../package.json":
    "6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8",
  "../package-lock.json":
    "5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d",
});

const EXPECTED_PROTECTED_PREDECESSOR_SCHEMAS = Object.freeze([
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
]);

const EXPECTED_PROTECTED_PREDECESSOR_IDENTITIES = Object.freeze([
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
]);

const EXPECTED_LIFECYCLE = Object.freeze([
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
]);

const policyBundle = createG17NonTmpfsBuildIsolationV2PolicyArtifact();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const EXPECTED_REQUIREMENTS_BASE = {
  schema: EXPECTED_SCHEMA,
  status: EXPECTED_STATUS,
  requirementMode: EXPECTED_REQUIREMENT_MODE,
  productionReadiness: {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  },
  limits: EXPECTED_LIMITS,
  protectedPredecessorSchemas: plain(EXPECTED_PROTECTED_PREDECESSOR_SCHEMAS),
  protectedPredecessorIdentities: plain(
    EXPECTED_PROTECTED_PREDECESSOR_IDENTITIES,
  ),
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
      limits: plain(G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS),
      policyBinding: plain(G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING),
      launchCompatibility: plain(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
      ),
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
      policyBindings: plain(G17_CARGO_EXECVEAT_HELPER_POLICY_BINDINGS),
      requestBindingPlaceholder: plain(
        G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
      ),
    },
    statusProtocolV1: {
      schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
      projectionSchema: G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA,
      maximumBytes: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
      maximumFrames: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
      timeoutMilliseconds: G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
      errnoMaximum: G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
      preReadyErrorStages: plain(
        G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
      ),
      reservedExits: plain(G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS),
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
    exactChildDescriptorRange: plain(
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.exactChildDescriptorRange,
    ),
    childFileDescriptors: plain(
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.childFileDescriptors,
    ),
    imageMaps: plain(
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.imageMaps,
    ),
    parentOnlyFileDescriptors: plain(
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.parentOnlyFileDescriptors,
    ),
    aliasing: plain(G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS.aliasing),
    cloexecImmediatelyBeforeCargoExecveat: [6, 7, 8],
  },
  cargoInvocation: {
    program: G17_BENCHMARK_BUILD_PROGRAM,
    argv0: G17_BENCHMARK_BUILD_PROGRAM,
    argv: plain(G17_BENCHMARK_BUILD_ARGV),
    environment: plain(G17_BENCHMARK_BUILD_ENVIRONMENT),
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
    requirements: plain(
      G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS,
    ),
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
  lifecycle: plain(EXPECTED_LIFECYCLE),
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
  authority: EXPECTED_AUTHORITY,
  nonclaims: EXPECTED_NONCLAIMS,
};

const EXPECTED_REQUIREMENTS = {
  ...EXPECTED_REQUIREMENTS_BASE,
  contentHash: canonicalSha256(EXPECTED_REQUIREMENTS_BASE),
};
const EXPECTED_BYTES = Buffer.from(
  `${canonicalJson(EXPECTED_REQUIREMENTS)}\n`,
  "utf8",
);
const EXPECTED_RAW_SHA256 = createHash("sha256")
  .update(EXPECTED_BYTES)
  .digest("hex");
const PINNED_EXPECTED_CONTENT_HASH =
  "d791698d9119ad2e49c001354df13e4122cdf39552385c87c2e85625ae6e0534";
const PINNED_EXPECTED_RAW_SHA256 =
  "9d08f2c7edc43c5151b40c335d0309c743c22515bb16d4473535724940cbf9fa";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function reseal(document) {
  const { contentHash: _oldContentHash, ...unsigned } = document;
  document.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(document)}\n`, "utf8");
}

function mutatedBytes(created, mutate, { resealContent = true } = {}) {
  const document = JSON.parse(created.artifact.bytes.toString("utf8"));
  mutate(document);
  return resealContent
    ? reseal(document)
    : Buffer.from(`${canonicalJson(document)}\n`, "utf8");
}

function leafPaths(value, path = []) {
  if (value === null || typeof value !== "object") return [path];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, [...path, key]),
  );
}

function recordPaths(value, path = []) {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      recordPaths(child, [...path, String(index)]),
    );
  }
  return [
    path,
    ...Object.entries(value).flatMap(([key, child]) =>
      recordPaths(child, [...path, key]),
    ),
  ];
}

function arrayPaths(value, path = []) {
  if (value === null || typeof value !== "object") return [];
  return [
    ...(Array.isArray(value) ? [path] : []),
    ...Object.entries(value).flatMap(([key, child]) =>
      arrayPaths(child, [...path, key]),
    ),
  ];
}

function valueAt(root, path) {
  return path.reduce((value, key) => value[key], root);
}

function replaceLeaf(root, path) {
  const parent = valueAt(root, path.slice(0, -1));
  const key = path.at(-1);
  const value = parent[key];
  parent[key] =
    value === null
      ? "substituted-null"
      : typeof value === "boolean"
        ? !value
        : typeof value === "number"
          ? value + 1
          : `${value}-substituted`;
}

function assertCode(block, code) {
  assert.throws(block, (error) => {
    assert.ok(error instanceof G17BenchmarkPrivateBuildIssuerV1ContractError);
    assert.equal(error.code, code);
    assert.equal(typeof error.phase, "string");
    assert.match(
      error.message,
      /^G1\.7 benchmark private build issuer v1 contract:/u,
    );
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

function assertNullPrototypeRecords(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  if (!Array.isArray(value)) assert.equal(Object.getPrototypeOf(value), null);
  for (const child of Object.values(value)) {
    assertNullPrototypeRecords(child, seen);
  }
}

function assertCanonicalKeyOrder(value) {
  if (value === null || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    assert.deepEqual(Object.keys(value), Object.keys(value).toSorted());
  }
  for (const child of Object.values(value)) assertCanonicalKeyOrder(child);
}

function verify(bytes) {
  return verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact({ bytes });
}

function envelopeAtDepth(bytes, depth) {
  const envelope = { bytes };
  let cursor = envelope;
  for (let index = 0; index < depth; index += 1) {
    cursor = cursor.next = {};
  }
  return envelope;
}

function envelopeWithProperties(bytes, totalProperties) {
  const envelope = { bytes };
  for (let index = 0; index < totalProperties - 1; index += 1) {
    envelope[`x${index}`] = null;
  }
  return envelope;
}

function structuredNodeTree(nodes) {
  assert.ok(Number.isSafeInteger(nodes) && nodes >= 1);
  if (nodes === 1) return null;
  const childCount = Math.min(EXPECTED_LIMITS.maximumArrayLength, nodes - 1);
  const base = Math.floor((nodes - 1) / childCount);
  const extra = (nodes - 1) % childCount;
  return Array.from({ length: childCount }, (_, index) =>
    structuredNodeTree(base + (index < extra ? 1 : 0)),
  );
}

function countStructuredNodes(value) {
  if (ArrayBuffer.isView(value)) return 0;
  if (value === null || typeof value !== "object") return 1;
  return (
    1 +
    Object.values(value).reduce(
      (count, child) => count + countStructuredNodes(child),
      0,
    )
  );
}

function assertEnvelopeLimitDifferential(withinLimit, overLimit, withinCode) {
  assertCode(
    () =>
      verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(withinLimit),
    withinCode,
  );
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(overLimit),
    "LIMIT_EXCEEDED",
  );
}

test("requirements v1 freezes the exact public contract surface and typed error precedence", () => {
  assert.deepEqual(Object.keys(issuerContract), EXPECTED_EXPORTS);
  assert.equal(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SCHEMA,
    EXPECTED_SCHEMA,
  );
  assert.equal(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_PROJECTION_SCHEMA,
    EXPECTED_PROJECTION_SCHEMA,
  );
  assert.equal(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_ARTIFACT_NAME,
    EXPECTED_ARTIFACT_NAME,
  );
  assert.equal(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_MAX_BYTES,
    EXPECTED_MAX_BYTES,
  );
  assert.deepEqual(
    plain(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS),
    EXPECTED_LIMITS,
  );
  assertDeepFrozen(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS);
  assert.deepEqual(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES,
    EXPECTED_ERROR_CODES,
  );
  assert.equal(
    Object.isFrozen(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES),
    true,
  );
  assert.equal(
    new Set(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_ERROR_CODES).size,
    EXPECTED_ERROR_CODES.length,
  );
  assert.equal(
    typeof createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact,
    "function",
  );
  assert.equal(
    createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact.length,
    0,
  );
  assert.equal(
    typeof verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact,
    "function",
  );
  assert.equal(
    verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact.length,
    1,
  );
  assert.throws(
    () =>
      new G17BenchmarkPrivateBuildIssuerV1ContractError(
        "UNKNOWN",
        "test",
        "must fail",
      ),
    TypeError,
  );
});

test("requirements v1 freezes every finite artifact and hostile-envelope bound", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  assert.deepEqual(plain(created.requirements.limits), EXPECTED_LIMITS);
  assert.deepEqual(
    Object.keys(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_LIMITS),
    Object.keys(EXPECTED_LIMITS),
  );
  for (const key of Object.keys(EXPECTED_LIMITS)) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.limits[key] += 1;
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
});

test("requirements v1 emits one exact canonical authority-null artifact and detached projection", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  const second = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  assert.deepEqual(Object.keys(created), [
    "requirements",
    "identity",
    "projection",
    "artifact",
  ]);
  assert.deepEqual(plain(created.requirements), EXPECTED_REQUIREMENTS);
  assert.deepEqual(created.artifact.bytes, EXPECTED_BYTES);
  assert.equal(EXPECTED_REQUIREMENTS.contentHash, PINNED_EXPECTED_CONTENT_HASH);
  assert.equal(EXPECTED_RAW_SHA256, PINNED_EXPECTED_RAW_SHA256);
  assert.equal(created.artifact.name, EXPECTED_ARTIFACT_NAME);
  assert.equal(created.artifact.rawSha256, EXPECTED_RAW_SHA256);
  assert.equal(sha256(created.artifact.bytes), EXPECTED_RAW_SHA256);
  assert.deepEqual(plain(created.identity), {
    schema: EXPECTED_SCHEMA,
    rawSha256: EXPECTED_RAW_SHA256,
    contentHash: EXPECTED_REQUIREMENTS.contentHash,
  });
  assert.deepEqual(plain(created.projection), {
    schema: EXPECTED_PROJECTION_SCHEMA,
    requirements: plain(created.identity),
    status: EXPECTED_STATUS,
    productionReadiness: {
      status: "unavailable",
      reason: "native-adapter-unavailable",
    },
    physicalOrigin: false,
    binding: null,
    finalDecisionEligible: false,
    authority: EXPECTED_AUTHORITY,
    nonclaims: EXPECTED_NONCLAIMS,
  });
  assert.equal(
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS_SHA256,
    EXPECTED_REQUIREMENTS.contentHash,
  );
  assert.deepEqual(
    plain(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS),
    EXPECTED_REQUIREMENTS,
  );
  assert.notStrictEqual(
    created.requirements,
    G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS,
  );
  assert.notStrictEqual(created.requirements, second.requirements);
  assert.notStrictEqual(created.identity, second.identity);
  assert.notStrictEqual(created.projection, second.projection);
  assert.notStrictEqual(created.artifact, second.artifact);

  const verified = verify(created.artifact.bytes);
  assert.deepEqual(plain(verified), {
    requirements: EXPECTED_REQUIREMENTS,
    identity: plain(created.identity),
    projection: plain(created.projection),
  });
  assert.notStrictEqual(verified.requirements, created.requirements);
  assert.notStrictEqual(verified.identity, created.identity);
  assert.notStrictEqual(verified.projection, created.projection);
  assert.notStrictEqual(
    verified.requirements.lifecycle,
    created.requirements.lifecycle,
  );
  assert.notStrictEqual(
    verified.requirements.protectedPredecessorIdentities[0].source,
    created.requirements.protectedPredecessorIdentities[0].source,
  );
  const secondVerified = verify(created.artifact.bytes);
  assert.notStrictEqual(secondVerified, verified);
  assert.notStrictEqual(secondVerified.requirements, verified.requirements);
  assert.notStrictEqual(secondVerified.identity, verified.identity);
  assert.notStrictEqual(secondVerified.projection, verified.projection);
  assert.notStrictEqual(
    secondVerified.requirements.lifecycle,
    verified.requirements.lifecycle,
  );
  assert.notStrictEqual(
    secondVerified.requirements.protectedPredecessorIdentities[0].source,
    verified.requirements.protectedPredecessorIdentities[0].source,
  );
  assertNullPrototypeRecords(verified);
  assertDeepFrozen(verified);
  assert.throws(() => verified.requirements.lifecycle.pop(), TypeError);
  assert.throws(() => {
    verified.projection.authority.buildExecutionAuthority = true;
  }, TypeError);
  assertNullPrototypeRecords(created);
  assertNullPrototypeRecords(created.requirements);
  assertNullPrototypeRecords(created.identity);
  assertNullPrototypeRecords(created.projection);
  assertDeepFrozen(created.requirements);
  assertDeepFrozen(created.identity);
  assertDeepFrozen(created.projection);
  assertDeepFrozen(created.artifact);
  assertDeepFrozen(created);
  assertDeepFrozen(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_REQUIREMENTS);
  assert.throws(
    () => created.requirements.lifecycle.push({ ordinal: 13, phase: "drift" }),
    TypeError,
  );
  assert.throws(() => {
    created.requirements.descriptorBoundary.childFileDescriptors[0].role =
      "drift";
  }, TypeError);

  const parsed = JSON.parse(created.artifact.bytes.toString("utf8"));
  assertCanonicalKeyOrder(parsed);
  assert.equal(created.artifact.bytes.at(-1), 0x0a);
  assert.equal(created.artifact.bytes.includes(0x0d), false);
  assert.equal(created.artifact.bytes.includes(0x00), false);

  const first = created.artifact.bytes;
  first.fill(0);
  assert.notDeepEqual(first, created.artifact.bytes);
  assert.notStrictEqual(created.artifact.bytes, created.artifact.bytes);
});

test("requirements v1 cross-binds exact immutable predecessor identities without inventing physical interfaces", () => {
  const requirements =
    createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact().requirements;

  assert.deepEqual(
    plain(requirements.predecessors),
    EXPECTED_REQUIREMENTS.predecessors,
  );
  assert.deepEqual(
    plain(requirements.predecessors.executionRequestV2.policyBinding),
    plain(G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING),
  );
  assert.deepEqual(
    plain(requirements.predecessors.executionRequestV2.launchCompatibility),
    plain(G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY),
  );
  assert.equal(
    requirements.predecessors.helperAttestationV1.policyBindings
      .fileDescriptorMapSha256,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  );
  assert.equal(
    requirements.predecessors.helperAttestationV1.policyBindings
      .statusProtocolRequirementsSha256,
    G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  );
  assert.equal(
    requirements.predecessors.containmentV2.requirementsSha256,
    G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256,
  );

  assert.deepEqual(
    plain(requirements.predecessors.activationDependencies),
    EXPECTED_REQUIREMENTS.predecessors.activationDependencies,
  );
  for (const dependency of requirements.predecessors.activationDependencies) {
    assert.equal(dependency.available, false);
    if (Object.hasOwn(dependency, "exactInterface")) {
      assert.equal(dependency.exactInterface, null);
    }
    if (Object.hasOwn(dependency, "exactReceipt")) {
      assert.equal(dependency.exactReceipt, null);
    }
    if (Object.hasOwn(dependency, "exactActivationReceipt")) {
      assert.equal(dependency.exactActivationReceipt, null);
    }
  }
});

test("requirements v1 preserves every ordered replay, qualification, and Phase A/B predecessor byte identity", () => {
  const requirements =
    createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact().requirements;
  assert.deepEqual(
    plain(requirements.protectedPredecessorSchemas),
    plain(EXPECTED_PROTECTED_PREDECESSOR_SCHEMAS),
  );
  assert.deepEqual(
    plain(requirements.protectedPredecessorIdentities),
    plain(EXPECTED_PROTECTED_PREDECESSOR_IDENTITIES),
  );
  assert.deepEqual(
    requirements.protectedPredecessorIdentities.map(({ ordinal, role }) => [
      ordinal,
      role,
    ]),
    [
      [1, "benchmark-build-owner-v2"],
      [2, "benchmark-build-process-evidence-v3"],
      [3, "benchmark-product-owner-v3"],
      [4, "qualification-contract-v7"],
      [5, "phase-a-control-authorization"],
      [6, "phase-b-final-decision"],
    ],
  );
  const [
    buildOwner,
    processEvidence,
    productOwner,
    qualification,
    phaseA,
    phaseB,
  ] = requirements.protectedPredecessorIdentities;
  for (const replay of [buildOwner, processEvidence, productOwner]) {
    assert.equal(
      replay.artifact.identityMode,
      "input-bound-replay-no-canonical-instance",
    );
    assert.equal(replay.artifact.artifactName, null);
    assert.equal(replay.artifact.rawSha256, null);
    assert.equal(replay.artifact.contentHash, null);
    assert.deepEqual(plain(replay.canonicalRequirements), {
      available: false,
      rawSha256: null,
      contentHash: null,
      reason: "no-standalone-canonical-requirements-artifact",
    });
    assert.equal(replay.binding, null);
    assert.equal(replay.finalDecisionEligible, false);
  }
  assert.equal(
    qualification.artifact.rawSha256,
    "42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80",
  );
  assert.equal(qualification.generation, "CURRENT_V7");
  assert.equal(Object.hasOwn(qualification, "status"), false);
  assert.equal(Object.hasOwn(qualification, "compatibilityStatus"), false);
  assert.equal(Object.hasOwn(qualification, "compatibilitySchemaState"), false);
  assert.equal(qualification.canonicalRequirements.available, true);
  assert.equal(phaseA.canonicalRequirements.available, true);
  assert.equal(phaseB.canonicalRequirements.available, true);
  assert.equal(phaseA.artifact.status, "CONTROL_AUTH_PROPOSED");
  assert.equal(phaseA.artifact.approvalStatus, "UNAPPROVED");
  assert.equal(phaseA.executionAuthorized, false);
  assert.equal(phaseB.artifact.status, "PROPOSED");
  assert.equal(phaseB.artifact.approvalStatus, "UNAPPROVED");
  assert.equal(phaseB.artifact.controlReceipt, null);
  assert.equal(phaseB.artifact.negativeControlSignature, null);
  assert.equal(phaseB.artifact.g14bPrerequisite, null);
  assert.equal(phaseB.executionAuthorized, false);
  assert.equal(phaseB.finalDecisionEligible, false);
});

test("verifier kills every protected predecessor leaf, schema order, identity order, deletion, and extension", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  for (
    let index = 0;
    index < EXPECTED_PROTECTED_PREDECESSOR_SCHEMAS.length;
    index += 1
  ) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.protectedPredecessorSchemas[index] += "-substituted";
          }),
        ),
      "DEPENDENCY_BINDING_DRIFT",
    );
  }
  for (const mutate of [
    (values) => values.pop(),
    (values) => values.push("oxigraph.g1.7-invented/v1"),
    (values) => values.reverse(),
    (values) => values.splice(1, 0, values[0]),
  ]) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) =>
            mutate(document.protectedPredecessorSchemas),
          ),
        ),
      "DEPENDENCY_BINDING_DRIFT",
    );
  }

  for (const path of leafPaths(EXPECTED_PROTECTED_PREDECESSOR_IDENTITIES)) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            replaceLeaf(document.protectedPredecessorIdentities, path);
          }),
        ),
      "DEPENDENCY_BINDING_DRIFT",
    );
  }
  for (const path of recordPaths(EXPECTED_PROTECTED_PREDECESSOR_IDENTITIES)) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            valueAt(document.protectedPredecessorIdentities, path).unexpected =
              false;
          }),
        ),
      "DEPENDENCY_BINDING_DRIFT",
    );
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            const record = valueAt(
              document.protectedPredecessorIdentities,
              path,
            );
            delete record[Object.keys(record)[0]];
          }),
        ),
      "DEPENDENCY_BINDING_DRIFT",
    );
  }
  for (const path of arrayPaths(EXPECTED_PROTECTED_PREDECESSOR_IDENTITIES)) {
    for (const mutate of [
      (values) => values.pop(),
      (values) => values.push(structuredClone(values.at(-1))),
      (values) => values.reverse(),
      (values) => values.splice(1, 0, structuredClone(values[0])),
    ]) {
      assertCode(
        () =>
          verify(
            mutatedBytes(created, (document) =>
              mutate(valueAt(document.protectedPredecessorIdentities, path)),
            ),
          ),
        "DEPENDENCY_BINDING_DRIFT",
      );
    }
  }
});

test("requirements v1 freezes helper FD 0..8, Cargo FD 0..5, parent-only roles, CLOEXEC, and close_range", () => {
  const boundary =
    createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact().requirements
      .descriptorBoundary;

  assert.deepEqual(plain(boundary), EXPECTED_REQUIREMENTS.descriptorBoundary);
  assert.deepEqual(
    boundary.childFileDescriptors.map(({ childFd }) => childFd),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    boundary.imageMaps.helperImageExactOpenFileDescriptors,
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(
    boundary.imageMaps.cargoImageExactOpenFileDescriptors,
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(boundary.cloexecImmediatelyBeforeCargoExecveat, [6, 7, 8]);
  assert.deepEqual(
    boundary.parentOnlyFileDescriptors.map(({ role, fixedFd }) => [
      role,
      fixedFd,
    ]),
    [
      ["execStatusReader", null],
      ["cgroupDirectory", null],
      ["directChildPidfd", null],
    ],
  );
  assert.deepEqual(plain(boundary.exactChildDescriptorRange.closeRange), {
    syscall: "close_range",
    first: 9,
    last: "UINT_MAX",
    flags: 0,
    fallbackLoopForbidden: true,
    failureDisposition: "fail-before-ready",
  });
});

test("verifier kills every child/parent descriptor, image, alias, CLOEXEC, and close-range mutation", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  for (let index = 0; index < 3; index += 1) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.descriptorBoundary.cloexecImmediatelyBeforeCargoExecveat[
              index
            ] += 10;
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const mutate of [
    (values) => values.pop(),
    (values) => values.push(9),
    (values) => values.reverse(),
    (values) => values.splice(1, 0, values[0]),
  ]) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) =>
            mutate(
              document.descriptorBoundary.cloexecImmediatelyBeforeCargoExecveat,
            ),
          ),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  const childKeys = [
    "childFd",
    "role",
    "kind",
    "descriptorAccess",
    "logicalPath",
    "presentInHelperImage",
    "presentInCargoImage",
    "cloexecAtHelperEntry",
    "cloexecImmediatelyBeforeCargoExecveat",
    "lifecycle",
  ];
  for (let index = 0; index < 9; index += 1) {
    for (const key of childKeys) {
      assertCode(
        () =>
          verify(
            mutatedBytes(created, (document) => {
              const entry =
                document.descriptorBoundary.childFileDescriptors[index];
              const value = entry[key];
              entry[key] =
                typeof value === "boolean"
                  ? !value
                  : typeof value === "number"
                    ? value + 20
                    : value === null
                      ? "substituted"
                      : `${value}-substituted`;
            }),
          ),
        "REQUIREMENTS_CONTRACT_DRIFT",
      );
    }
  }

  for (let index = 0; index < 3; index += 1) {
    for (const key of [
      "role",
      "kind",
      "descriptorCapabilities",
      "fixedFd",
      "entersHelperImage",
      "entersCargoImage",
    ]) {
      assertCode(
        () =>
          verify(
            mutatedBytes(created, (document) => {
              const entry =
                document.descriptorBoundary.parentOnlyFileDescriptors[index];
              const value = entry[key];
              entry[key] =
                typeof value === "boolean"
                  ? !value
                  : value === null
                    ? index
                    : `${value}-substituted`;
            }),
          ),
        "REQUIREMENTS_CONTRACT_DRIFT",
      );
    }
  }

  for (const key of Object.keys(
    EXPECTED_REQUIREMENTS.descriptorBoundary.aliasing,
  )) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.descriptorBoundary.aliasing[key] = false;
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }

  for (const key of Object.keys(
    EXPECTED_REQUIREMENTS.descriptorBoundary.imageMaps,
  )) {
    for (const mutation of [
      (values) => values.pop(),
      (values) => values.push(99),
      (values) => values.reverse(),
    ]) {
      assertCode(
        () =>
          verify(
            mutatedBytes(created, (document) => {
              mutation(document.descriptorBoundary.imageMaps[key]);
            }),
          ),
        "REQUIREMENTS_CONTRACT_DRIFT",
      );
    }
  }

  for (const [key, replacement] of [
    ["first", 1],
    ["last", 7],
    ["descriptorsAtOrAbove", 10],
    ["dispositionAtHelperEntry", "loop-close"],
  ]) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.descriptorBoundary.exactChildDescriptorRange[key] =
              replacement;
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const [key, replacement] of [
    ["syscall", "close"],
    ["first", 8],
    ["last", 1024],
    ["flags", 1],
    ["fallbackLoopForbidden", false],
    ["failureDisposition", "continue"],
  ]) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.descriptorBoundary.exactChildDescriptorRange.closeRange[
              key
            ] = replacement;
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
});

test("requirements v1 freezes exact Cargo argv0, argv, environment, request, helper, status, and isolation bindings", () => {
  const requirements =
    createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact().requirements;
  assert.deepEqual(
    plain(requirements.cargoInvocation),
    EXPECTED_REQUIREMENTS.cargoInvocation,
  );
  assert.equal(requirements.cargoInvocation.argv0, "/toolchain/bin/cargo");
  assert.deepEqual(requirements.cargoInvocation.argv, [
    "bench",
    "--locked",
    "--offline",
    "-p",
    "oxigraph",
    "--bench",
    "transactional_write",
    "--no-run",
    "--message-format",
    "json-render-diagnostics",
    "--target-dir",
    "/state/target",
  ]);
  assert.equal(
    canonicalSha256(requirements.cargoInvocation.environment),
    requirements.cargoInvocation.environmentSha256,
  );
  assert.equal(
    requirements.predecessors.executionRequestV2.policyBinding
      .fileDescriptorsSha256,
    requirements.descriptorBoundary.fileDescriptorsSha256,
  );
  assert.equal(
    requirements.predecessors.statusProtocolV1.requirementsSha256,
    requirements.statusAndObservationBoundary.requirements.requirementsSha256,
  );
});

test("verifier kills every Cargo argv/environment and predecessor identity mutation", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  for (let index = 0; index < G17_BENCHMARK_BUILD_ARGV.length; index += 1) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.cargoInvocation.argv[index] += "-substituted";
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const mutate of [
    (argv) => argv.pop(),
    (argv) => argv.unshift("injected"),
    (argv) => argv.reverse(),
  ]) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) =>
            mutate(document.cargoInvocation.argv),
          ),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const key of Object.keys(G17_BENCHMARK_BUILD_ENVIRONMENT)) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.cargoInvocation.environment[key] += "-substituted";
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const mutate of [
    (document) => {
      document.cargoInvocation.program = "/tmp/cargo";
    },
    (document) => {
      document.cargoInvocation.argv0 = "cargo";
    },
    (document) => {
      document.cargoInvocation.environment.INJECTED = "1";
    },
    (document) => {
      delete document.cargoInvocation.environment.PATH;
    },
    (document) => {
      document.cargoInvocation.environmentSha256 = "0".repeat(64);
    },
  ]) {
    assertCode(
      () => verify(mutatedBytes(created, mutate)),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }

  const dependencyMutations = [
    (document) => {
      document.predecessors.executionPlan.sha256 = "0".repeat(64);
    },
    (document) => {
      document.predecessors.executionRequestV2.schema += "-substituted";
    },
    (document) => {
      document.predecessors.executionRequestV2.policyBinding.rawSha256 =
        "0".repeat(64);
    },
    (document) => {
      document.predecessors.helperAttestationV1.sourceSha256 = "0".repeat(64);
    },
    (document) => {
      document.predecessors.helperAttestationV1.policyBindings.fileDescriptorMapSha256 =
        "0".repeat(64);
    },
    (document) => {
      document.predecessors.statusProtocolV1.requirementsSha256 = "0".repeat(
        64,
      );
    },
    (document) => {
      document.predecessors.isolationPolicyV2.contentHash = "0".repeat(64);
    },
    (document) => {
      document.predecessors.containmentV2.requirementsSha256 = "0".repeat(64);
    },
  ];
  for (const mutate of dependencyMutations) {
    assertCode(
      () => verify(mutatedBytes(created, mutate)),
      "DEPENDENCY_BINDING_DRIFT",
    );
  }
});

test("requirements v1 freezes the twelve-stage lifecycle and fail-closed retention precedence", () => {
  const requirements =
    createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact().requirements;
  assert.deepEqual(plain(requirements.lifecycle), plain(EXPECTED_LIFECYCLE));
  assert.deepEqual(
    plain(requirements.failureModel),
    EXPECTED_REQUIREMENTS.failureModel,
  );
  assert.deepEqual(
    requirements.lifecycle.map(({ ordinal }) => ordinal),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(
    requirements.failureModel.ambiguity.outcome,
    "INCONCLUSIVE_RETAINED",
  );
  assert.equal(requirements.failureModel.ambiguity.dominatesCleanup, true);
  assert.equal(requirements.failureModel.ambiguity.dominatesSuccess, true);
  assert.equal(
    requirements.failureModel.afterDurableCommit.retryAllowed,
    false,
  );
  assert.equal(
    requirements.failureModel.afterDurableCommit.relaunchAllowed,
    false,
  );
});

test("verifier kills every lifecycle reorder/drop/duplicate and failure-precedence mutation", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  for (let index = 0; index < EXPECTED_LIFECYCLE.length; index += 1) {
    for (const mutate of [
      (lifecycle) => lifecycle.splice(index, 1),
      (lifecycle) => lifecycle.splice(index, 0, { ...lifecycle[index] }),
      (lifecycle) => {
        lifecycle[index].ordinal += 100;
      },
      (lifecycle) => {
        lifecycle[index].phase += "-substituted";
      },
    ]) {
      assertCode(
        () =>
          verify(
            mutatedBytes(created, (document) => mutate(document.lifecycle)),
          ),
        "REQUIREMENTS_CONTRACT_DRIFT",
      );
    }
  }
  assertCode(
    () =>
      verify(
        mutatedBytes(created, (document) => {
          [document.lifecycle[4], document.lifecycle[5]] = [
            document.lifecycle[5],
            document.lifecycle[4],
          ];
        }),
      ),
    "REQUIREMENTS_CONTRACT_DRIFT",
  );

  for (const path of leafPaths(EXPECTED_REQUIREMENTS.failureModel)) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            replaceLeaf(document.failureModel, path);
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const path of recordPaths(EXPECTED_REQUIREMENTS.failureModel)) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            valueAt(document.failureModel, path).unexpected = false;
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            const record = valueAt(document.failureModel, path);
            delete record[Object.keys(record)[0]];
          }),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
  for (const mutate of [
    (values) => values.pop(),
    (values) => values.push("UNKNOWN"),
    (values) => values.reverse(),
    (values) => values.splice(1, 0, values[0]),
  ]) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) =>
            mutate(document.failureModel.outcomes),
          ),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }

  const failureMutations = [
    (model) => model.outcomes.push("UNKNOWN"),
    (model) => {
      model.success.targetReleaseAllowed = false;
    },
    (model) => {
      model.definiteNoChildFailure.outcome = "INCONCLUSIVE_RETAINED";
    },
    (model) => {
      model.reapedTerminalFailure.retryAllowed = true;
    },
    (model) => {
      model.ambiguity.dominatesCleanup = false;
    },
    (model) => {
      model.ambiguity.dominatesSuccess = false;
    },
    (model) => {
      model.ambiguity.retainWorkspace = false;
    },
    (model) => {
      model.ambiguity.targetReleaseAllowed = true;
    },
    (model) => {
      model.ambiguity.ownerIssuanceAllowed = true;
    },
    (model) => {
      model.ambiguity.destructiveCleanupAllowed = true;
    },
    (model) => {
      model.afterDurableCommit.retryAllowed = true;
    },
    (model) => {
      model.afterDurableCommit.relaunchAllowed = true;
    },
  ];
  for (const mutate of failureMutations) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => mutate(document.failureModel)),
        ),
      "REQUIREMENTS_CONTRACT_DRIFT",
    );
  }
});

test("requirements v1 exposes the complete false authority and nonclaim vocabulary", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  assert.deepEqual(
    Object.keys(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
    EXPECTED_AUTHORITY_KEYS,
  );
  assert.deepEqual(
    Object.keys(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
    EXPECTED_NONCLAIM_KEYS,
  );
  assert.deepEqual(
    plain(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY),
    EXPECTED_AUTHORITY,
  );
  assert.deepEqual(
    plain(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS),
    EXPECTED_NONCLAIMS,
  );
  assert.deepEqual(plain(created.requirements.authority), EXPECTED_AUTHORITY);
  assert.deepEqual(plain(created.requirements.nonclaims), EXPECTED_NONCLAIMS);
  assert.equal(created.requirements.physicalOrigin, false);
  assert.equal(created.requirements.binding, null);
  assert.equal(created.requirements.finalDecisionEligible, false);
  assert.deepEqual(plain(created.requirements.productionReadiness), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assertDeepFrozen(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_AUTHORITY);
  assertDeepFrozen(G17_BENCHMARK_PRIVATE_BUILD_ISSUER_V1_NONCLAIMS);
});

test("verifier rejects every false-to-true authority/nonclaim and eligibility mutation", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  for (const key of EXPECTED_AUTHORITY_KEYS) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.authority[key] = true;
          }),
        ),
      "AUTHORITY_OVERCLAIM",
    );
  }
  for (const key of EXPECTED_NONCLAIM_KEYS) {
    assertCode(
      () =>
        verify(
          mutatedBytes(created, (document) => {
            document.nonclaims[key] = true;
          }),
        ),
      "AUTHORITY_OVERCLAIM",
    );
  }
  for (const mutate of [
    (document) => {
      document.physicalOrigin = true;
    },
    (document) => {
      document.binding = { kind: "invented" };
    },
    (document) => {
      document.finalDecisionEligible = true;
    },
    (document) => {
      document.productionReadiness.status = "available";
    },
    (document) => {
      document.productionReadiness.reason = null;
    },
    (document) => {
      document.predecessors.activationDependencies[0].available = true;
    },
    (document) => {
      document.predecessors.activationDependencies[1].exactInterface = {
        schema: "invented",
      };
    },
    (document) => {
      document.sourceWorkspace.productionEntrypointAvailable = true;
    },
  ]) {
    assertCode(
      () => verify(mutatedBytes(created, mutate)),
      "AUTHORITY_OVERCLAIM",
    );
  }
});

test("verifier rejects hostile envelopes, non-Buffers, cycles, sparse/deep/wide data, and oversized bytes", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(null),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(
        new Proxy({ bytes: created.artifact.bytes }, {}),
      ),
    "INPUT_SHAPE_INVALID",
  );
  const accessor = {};
  Object.defineProperty(accessor, "bytes", {
    enumerable: true,
    get() {
      throw new Error("must not run");
    },
  });
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(accessor),
    "INPUT_SHAPE_INVALID",
  );
  const symbol = { bytes: created.artifact.bytes };
  symbol[Symbol("hidden")] = true;
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(symbol),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(
        Object.assign(Object.create({ inherited: true }), {
          bytes: created.artifact.bytes,
        }),
      ),
    "INPUT_SHAPE_INVALID",
  );
  const cycle = { bytes: created.artifact.bytes };
  cycle.loop = cycle;
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(cycle),
    "INPUT_SHAPE_INVALID",
  );
  const sparse = [];
  sparse.length = 2;
  sparse[1] = created.artifact.bytes;
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(sparse),
    "INPUT_SHAPE_INVALID",
  );
  assertEnvelopeLimitDifferential(
    envelopeAtDepth(created.artifact.bytes, EXPECTED_LIMITS.maximumDepth),
    envelopeAtDepth(created.artifact.bytes, EXPECTED_LIMITS.maximumDepth + 1),
    "INPUT_SHAPE_INVALID",
  );
  const maximumPropertyEnvelope = envelopeWithProperties(
    created.artifact.bytes,
    EXPECTED_LIMITS.maximumPropertiesPerRecord,
  );
  const overPropertyEnvelope = envelopeWithProperties(
    created.artifact.bytes,
    EXPECTED_LIMITS.maximumPropertiesPerRecord + 1,
  );
  assert.equal(
    Reflect.ownKeys(maximumPropertyEnvelope).length,
    EXPECTED_LIMITS.maximumPropertiesPerRecord,
  );
  assert.equal(
    Reflect.ownKeys(overPropertyEnvelope).length,
    EXPECTED_LIMITS.maximumPropertiesPerRecord + 1,
  );
  assertEnvelopeLimitDifferential(
    maximumPropertyEnvelope,
    overPropertyEnvelope,
    "INPUT_SHAPE_INVALID",
  );
  const maximumArrayEnvelope = {
    bytes: created.artifact.bytes,
    extra: Array.from(
      { length: EXPECTED_LIMITS.maximumArrayLength },
      () => null,
    ),
  };
  const overArrayEnvelope = {
    bytes: created.artifact.bytes,
    extra: Array.from(
      { length: EXPECTED_LIMITS.maximumArrayLength + 1 },
      () => null,
    ),
  };
  assertEnvelopeLimitDifferential(
    maximumArrayEnvelope,
    overArrayEnvelope,
    "INPUT_SHAPE_INVALID",
  );
  const maximumNodeEnvelope = {
    bytes: created.artifact.bytes,
    extra: structuredNodeTree(EXPECTED_LIMITS.maximumNodes - 1),
  };
  const overNodeEnvelope = {
    bytes: created.artifact.bytes,
    extra: structuredNodeTree(EXPECTED_LIMITS.maximumNodes),
  };
  assert.equal(
    countStructuredNodes(maximumNodeEnvelope),
    EXPECTED_LIMITS.maximumNodes,
  );
  assert.equal(
    countStructuredNodes(overNodeEnvelope),
    EXPECTED_LIMITS.maximumNodes + 1,
  );
  assertEnvelopeLimitDifferential(
    maximumNodeEnvelope,
    overNodeEnvelope,
    "INPUT_SHAPE_INVALID",
  );
  assertEnvelopeLimitDifferential(
    {
      bytes: created.artifact.bytes,
      extra: "x".repeat(EXPECTED_LIMITS.singleStringUtf8MaximumBytes),
    },
    {
      bytes: created.artifact.bytes,
      extra: "x".repeat(EXPECTED_LIMITS.singleStringUtf8MaximumBytes + 1),
    },
    "INPUT_SHAPE_INVALID",
  );
  const aggregatePropertyNameUtf8Bytes = Buffer.byteLength(
    "bytesextra012length",
    "utf8",
  );
  assert.equal(aggregatePropertyNameUtf8Bytes, 19);
  const aggregateExactLengths = [
    1_000_000,
    1_000_000,
    EXPECTED_LIMITS.aggregateStringUtf8MaximumBytes -
      2_000_000 -
      aggregatePropertyNameUtf8Bytes,
  ];
  assert.equal(
    aggregateExactLengths.reduce((total, length) => total + length, 0) +
      aggregatePropertyNameUtf8Bytes,
    EXPECTED_LIMITS.aggregateStringUtf8MaximumBytes,
  );
  const maximumAggregateStringEnvelope = {
    bytes: created.artifact.bytes,
    extra: aggregateExactLengths.map((length) => "x".repeat(length)),
  };
  const overAggregateStringEnvelope = {
    bytes: created.artifact.bytes,
    extra: aggregateExactLengths.map((length, index) =>
      "x".repeat(length + (index === aggregateExactLengths.length - 1 ? 1 : 0)),
    ),
  };
  assertEnvelopeLimitDifferential(
    maximumAggregateStringEnvelope,
    overAggregateStringEnvelope,
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact({}),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact({
        bytes: new Uint8Array(created.artifact.bytes),
      }),
    "INPUT_SHAPE_INVALID",
  );
  assertCode(
    () =>
      verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact({
        bytes: new Proxy(created.artifact.bytes, {}),
      }),
    "INPUT_SHAPE_INVALID",
  );
  const withOwnLength = created.artifact.bytes;
  Object.defineProperty(withOwnLength, "length", {
    value: withOwnLength.length,
  });
  assertCode(
    () =>
      verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact({
        bytes: withOwnLength,
      }),
    "INPUT_SHAPE_INVALID",
  );
  assertEnvelopeLimitDifferential(
    { bytes: Buffer.alloc(EXPECTED_MAX_BYTES) },
    { bytes: Buffer.alloc(EXPECTED_MAX_BYTES + 1) },
    "CANONICAL_ARTIFACT_INVALID",
  );
});

test("verifier rejects invalid UTF-8, CR/NUL, partial, duplicate, unknown, reordered, and trailing bytes", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  const document = JSON.parse(created.artifact.bytes.toString("utf8"));
  const canonical = canonicalJson(document);
  const malformed = [
    Buffer.from([0xff, 0x0a]),
    Buffer.from(canonical, "utf8"),
    Buffer.from(`${canonical}\r\n`, "utf8"),
    Buffer.from(`${canonical}\u0000\n`, "utf8"),
    Buffer.from(`${canonical}\n\n`, "utf8"),
    Buffer.from(`${canonical} true\n`, "utf8"),
    Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8"),
    Buffer.from('{"schema":\n', "utf8"),
    Buffer.from(
      `{"schema":${JSON.stringify(document.schema)},${canonical.slice(1)}\n`,
      "utf8",
    ),
    Buffer.from(
      `${JSON.stringify(Object.fromEntries(Object.entries(document).reverse()))}\n`,
      "utf8",
    ),
  ];
  for (const bytes of malformed) {
    assertCode(() => verify(bytes), "CANONICAL_ARTIFACT_INVALID");
  }

  assertCode(
    () =>
      verify(
        mutatedBytes(created, (value) => {
          value.unknown = false;
        }),
      ),
    "REQUIREMENTS_CONTRACT_DRIFT",
  );
  assertCode(
    () =>
      verify(
        mutatedBytes(created, (value) => {
          delete value.failureModel;
        }),
      ),
    "REQUIREMENTS_CONTRACT_DRIFT",
  );
  assertCode(
    () =>
      verify(
        mutatedBytes(
          created,
          (value) => {
            value.contentHash = "0".repeat(64);
          },
          { resealContent: false },
        ),
      ),
    "CONTENT_HASH_MISMATCH",
  );
});

test("typed error codes are each reachable and semantic precedence is fail-closed", () => {
  const created = createG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact();
  const reachable = new Map([
    ["INPUT_SHAPE_INVALID", () => null],
    ["LIMIT_EXCEEDED", () => ({ bytes: Buffer.alloc(EXPECTED_MAX_BYTES + 1) })],
    [
      "CANONICAL_ARTIFACT_INVALID",
      () => ({ bytes: Buffer.from("{}", "utf8") }),
    ],
    [
      "CONTENT_HASH_MISMATCH",
      () => ({
        bytes: mutatedBytes(
          created,
          (document) => {
            document.contentHash = "0".repeat(64);
          },
          { resealContent: false },
        ),
      }),
    ],
    [
      "IDENTITY_INVALID",
      () => ({
        bytes: mutatedBytes(created, (document) => {
          document.schema += "-substituted";
        }),
      }),
    ],
    [
      "DEPENDENCY_BINDING_DRIFT",
      () => ({
        bytes: mutatedBytes(created, (document) => {
          document.predecessors.executionPlan.sha256 = "0".repeat(64);
        }),
      }),
    ],
    [
      "REQUIREMENTS_CONTRACT_DRIFT",
      () => ({
        bytes: mutatedBytes(created, (document) => {
          document.descriptorBoundary.imageMaps.cargoImageExactOpenFileDescriptors.pop();
        }),
      }),
    ],
    [
      "AUTHORITY_OVERCLAIM",
      () => ({
        bytes: mutatedBytes(created, (document) => {
          document.authority.buildExecutionAuthority = true;
        }),
      }),
    ],
  ]);
  assert.deepEqual([...reachable.keys()], EXPECTED_ERROR_CODES);
  for (const [code, input] of reachable) {
    assertCode(
      () => verifyG17BenchmarkPrivateBuildIssuerV1RequirementsArtifact(input()),
      code,
    );
  }

  assertCode(
    () =>
      verify(
        mutatedBytes(created, (document) => {
          document.schema += "-substituted";
          document.predecessors.executionPlan.sha256 = "0".repeat(64);
          document.authority.buildExecutionAuthority = true;
        }),
      ),
    "IDENTITY_INVALID",
  );
  assertCode(
    () =>
      verify(
        mutatedBytes(created, (document) => {
          document.predecessors.executionPlan.sha256 = "0".repeat(64);
          document.lifecycle.pop();
          document.authority.buildExecutionAuthority = true;
        }),
      ),
    "DEPENDENCY_BINDING_DRIFT",
  );
  assertCode(
    () =>
      verify(
        mutatedBytes(created, (document) => {
          document.lifecycle.pop();
          document.authority.buildExecutionAuthority = true;
        }),
      ),
    "REQUIREMENTS_CONTRACT_DRIFT",
  );
});

test("requirements source remains a pure serializer over exact pinned predecessor bytes", async () => {
  for (const [relativePath, expected] of Object.entries(EXPECTED_SOURCE_PINS)) {
    assert.equal(
      sha256(await readFile(new URL(relativePath, import.meta.url))),
      expected,
    );
  }

  const sourceUrl = new URL(
    "../src/qualification/benchmark-private-build-issuer-v1-contract.mjs",
    import.meta.url,
  );
  const source = await readFile(sourceUrl, "utf8");
  const importSpecifiers = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gmu),
  ].map((match) => match[1]);
  assert.deepEqual([...new Set(importSpecifiers)].sort(), [
    "../routing/features.mjs",
    "./benchmark-execution-plan.mjs",
    "./benchmark-execution-request-v2-contract.mjs",
    "./cargo-execveat-helper-attestation-contract.mjs",
    "./cargo-execveat-status-protocol-contract.mjs",
    "./non-tmpfs-build-isolation-v2-contract.mjs",
    "./non-tmpfs-containment-v2-contract.mjs",
    "node:crypto",
    "node:util",
  ]);
  for (const forbidden of [
    /node:(?:fs|child_process|os|net|http|https|dgram|cluster|worker_threads)/u,
    /product-source-workspace/u,
    /qualification-runner/u,
    /metaharness|darwin|gepa|\bavo\b/iu,
    /openrouter/iu,
    /\bprocess(?:\.|\[)/u,
    /\bimport\s*\(/u,
    /\b(?:eval|Function)\s*\(/u,
    /\b(?:fetch|setTimeout|setInterval|queueMicrotask)\s*\(/u,
    /\b(?:spawn|spawnSync|exec|execFile|fork)\s*\(/u,
    /\b(?:callback|hook|operation)\s*\(/u,
    /\b(?:readFile|writeFile|open|mkdir|rm|rename|unlink|stat|lstat|readdir)\s*\(/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
