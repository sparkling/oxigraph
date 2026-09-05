import { canonicalSha256 } from "../routing/features.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256,
  assertCandidateContainmentGuardianManagerProtocolTransitionV1,
} from "./containment-guardian-manager-protocol-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 } from "./containment-guardian-native-adapter-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1 } from "./containment-guardian-recovery-executor-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
  assertCandidateContainmentGuardianStatefsRequestV1,
  verifyCandidateContainmentGuardianStatefsResultV1,
} from "./containment-guardian-statefs-v1.mjs";
import { deepFreeze, nullRecord } from "./containment-exact-v2.mjs";

const AUTHORITY = deepFreeze(
  nullRecord([
    ["filesystemExecution", false],
    ["processExecution", false],
    ["cgroupMutation", false],
    ["descriptorMutation", false],
    ["runtimeRegistration", false],
    ["g17Execution", false],
    ["g22Execution", false],
    ["qualification", false],
    ["readiness", false],
    ["promotion", false],
    ["publication", false],
    ["deployment", false],
    ["productionContainment", false],
  ]),
);

const PHYSICAL_FACTS = deepFreeze(
  nullRecord([
    ["managerTransitionConsumed", null],
    ["statefsRequestDispatched", null],
    ["statefsEffect", null],
    ["descriptorValidated", null],
    ["descriptorMutation", null],
    ["filesystemDurability", null],
  ]),
);

const NONCLAIMS = deepFreeze([
  "manager-process-identity",
  "statefs-c-execution",
  "descriptor-validity",
  "filesystem-effect",
  "filesystem-durability",
  "runtime-registration",
  "G1.7",
  "G2.2",
  "qualification",
  "production-readiness",
  "promotion",
  "publication",
  "deployment",
]);

export const CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS =
  deepFreeze(
    nullRecord([
      [
        "schema",
        "oxigraph.candidate-containment-guardian-manager-transition-consumer-requirements/v1",
      ],
      ["version", 1],
      [
        "predecessors",
        deepFreeze(
          nullRecord([
            [
              "managerProtocolRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256,
            ],
            [
              "statefsRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
            ],
            [
              "nativeAdapterRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1,
            ],
            [
              "recoveryExecutorRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1,
            ],
          ]),
        ),
      ],
      [
        "entrypoint",
        "consumeCandidateContainmentGuardianManagerProtocolTransitionV1",
      ],
      ["entrypointArity", 2],
      [
        "ordering",
        deepFreeze([
          "manager-transition-assertion-before-transition-property-access",
          "exact-transition-statefs-request-identity",
          "adapter-validation-before-statefs-request-assertion",
          "statefs-request-assertion-exactly-once",
          "immediate-evaluator-bound-statefs-dispatch",
          "exact-executor-result-verification",
          "exact-branded-statefs-receipt-return",
          "manager-receipt-input-and-reduction-ownership",
          "post-consumption-failure-is-terminal",
        ]),
      ],
      ["evaluatorBoundary", "exact-adr0037-lock-executor-result/v1"],
      ["errors", deepFreeze(["S3A_BOUNDARY"])],
      ["binding", null],
      [
        "readiness",
        deepFreeze(
          nullRecord([
            ["status", "unavailable"],
            ["reason", "native-adapter-unavailable"],
          ]),
        ),
      ],
      ["authority", AUTHORITY],
      ["physicalFacts", PHYSICAL_FACTS],
      ["nonclaims", NONCLAIMS],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256 =
  canonicalSha256(
    CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS,
  );

export function consumeCandidateContainmentGuardianManagerProtocolTransitionV1(
  transition,
  dispatch,
) {
  assertCandidateContainmentGuardianManagerProtocolTransitionV1(transition);
  const request = transition.statefsRequest;
  if (typeof dispatch !== "function" || request === null) {
    throw new Error("S3A_BOUNDARY");
  }
  assertCandidateContainmentGuardianStatefsRequestV1(request);
  const executorResult = dispatch(request);
  return verifyCandidateContainmentGuardianStatefsResultV1({
    request,
    executorResult,
  });
}
