import {
  NATIVE_COMPILER_ENVIRONMENT_V1,
  NATIVE_COMPILER_PATH_V1,
  createNativeAttestationV1,
  deepFreezeV1,
  semanticSha256V1,
  sha256V1,
} from "./containment-guardian-native-attestation-common-v1.mjs";

export { sha256V1 };
export const SOURCE_LOGICAL_NAME_V1 = "containment-guardian-manager-v1.c";
export const SOURCE_BYTES_V1 = 2_840;
export const SOURCE_SHA256_V1 = "4dba252351003b14202f20490b17b55ac5abf011ab60bdd87024a3d207585137";
export const SELF_DESCRIPTION_JSONL_V1 =
  '{"artifact":"candidate-containment-guardian-manager-v1","binding":null,"entry":"oxigraph_containment_guardian_manager_entry","g17Eligible":false,"guardianLaunchImplemented":false,"linkedStatefsEntrypoint":"oxigraph_containment_statefs_execute_v1","linkedStatefsObjectSha256":"73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043","managerProtocolBridgeImplemented":false,"productionReady":false,"requirementsSha256":"ec91cb4740266fdf4dac278af25cc3713d8f6b657ffc32e826933b4c8637f31f","runtimeRegistered":false,"schema":"oxigraph.candidate-containment-manager-self-description/v1","statefsInvoked":false,"target":"linux-x86_64-freestanding-static"}\n';
export const ATTESTATION_SCHEMA_V1 = "oxigraph.candidate-containment-manager-attestation/v1";
export const REQUIREMENTS_CANONICAL_JSON_V1 =
  '{"authority":{"cgroupMutation":false,"g17Execution":false,"productionReadiness":false,"promotion":false,"publication":false,"qualification":false,"runtimeRegistration":false},"entry":"oxigraph_containment_guardian_manager_entry","lifecycle":{"cgroupMechanics":false,"guardianLaunch":false,"managerProtocolBridge":false},"mode":"DORMANT_LINK_ONLY","readiness":{"reason":"native-adapter-unavailable","status":"unavailable"},"schema":"oxigraph.candidate-containment-manager-requirements/v1","statefs":{"entrypoint":"oxigraph_containment_statefs_execute_v1","headerSha256":"358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28","invoked":false,"objectSha256":"73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043","sourceSha256":"f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138"},"target":"linux-x86_64-freestanding-static","version":1}';
export const REQUIREMENTS_V1 = deepFreezeV1(JSON.parse(REQUIREMENTS_CANONICAL_JSON_V1));
export const REQUIREMENTS_SHA256_V1 = "ec91cb4740266fdf4dac278af25cc3713d8f6b657ffc32e826933b4c8637f31f";
if (semanticSha256V1(REQUIREMENTS_V1) !== REQUIREMENTS_SHA256_V1) throw new Error("ADR38_NATIVE_ATTEST_REQUIREMENTS");
export const COMPILER_PATH_V1 = NATIVE_COMPILER_PATH_V1;
export const COMPILER_ENVIRONMENT_V1 = NATIVE_COMPILER_ENVIRONMENT_V1;
export const COMPILE_ARGV_V1 = Object.freeze([
  COMPILER_PATH_V1,
  "-std=c17", "-O2", "-Wall", "-Wextra", "-Werror", "-Wconversion",
  "-Wsign-conversion", "-Wshadow", "-Wformat=2", "-Wundef", "-Wvla",
  "-ffreestanding", "-fno-builtin", "-fno-pie", "-no-pie",
  "-fno-stack-protector", "-fno-asynchronous-unwind-tables",
  "-fno-unwind-tables", "-fno-ident", "-fvisibility=hidden", "-I", "CANDIDATE_DIR",
  "-c", "SOURCE", "-o", "OUTPUT_OBJECT",
]);
export const LINK_ARGV_V1 = Object.freeze([
  COMPILER_PATH_V1, "-nostdlib", "-nostartfiles", "-nodefaultlibs", "-static",
  "-no-pie", "-Wl,--build-id=none", "-Wl,--fatal-warnings",
  "-Wl,-z,noexecstack,-z,separate-code,-z,relro,-z,now",
  "-Wl,-e,oxigraph_containment_guardian_manager_entry",
  "MANAGER_OBJECT", "STATEFS_OBJECT", "-o", "OUTPUT_ELF",
]);
export const STATEFS_HEADER_SHA256_V1 = "358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28";
export const STATEFS_SOURCE_SHA256_V1 = "f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138";
export const STATEFS_OBJECT_SHA256_V1 = "73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043";
export const STATEFS_BUILD_REQUIREMENTS_SHA256_V1 = "fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70";
export const ELF_BYTES_V1 = 30_880;
export const ELF_SHA256_V1 = "b297d888bce75128fc3f18c2454c753a159df97ab7fba8ce790af27540003e99";

export const attestV1 = createNativeAttestationV1({
  kind: "manager",
  manager: true,
  attestationSchema: ATTESTATION_SCHEMA_V1,
  sourceBytes: SOURCE_BYTES_V1,
  sourceSha256: SOURCE_SHA256_V1,
  selfDescription: SELF_DESCRIPTION_JSONL_V1,
  requirements: REQUIREMENTS_V1,
  requirementsSha256: REQUIREMENTS_SHA256_V1,
  compileArgv: COMPILE_ARGV_V1,
  linkArgv: LINK_ARGV_V1,
  elfBytes: ELF_BYTES_V1,
  elfSha256: ELF_SHA256_V1,
  statefsHeaderSha256: STATEFS_HEADER_SHA256_V1,
  statefsSourceSha256: STATEFS_SOURCE_SHA256_V1,
  statefsObjectBytes: 33_048,
  statefsObjectSha256: STATEFS_OBJECT_SHA256_V1,
  statefsBuildRequirementsSha256: STATEFS_BUILD_REQUIREMENTS_SHA256_V1,
});
