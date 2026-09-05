import {
  NATIVE_COMPILER_ENVIRONMENT_V1,
  NATIVE_COMPILER_PATH_V1,
  createNativeAttestationV1,
  deepFreezeV1,
  semanticSha256V1,
  sha256V1,
} from "./containment-guardian-native-attestation-common-v1.mjs";

export { sha256V1 };
export const SOURCE_LOGICAL_NAME_V1 = "containment-guardian-v1.c";
export const SOURCE_BYTES_V1 = 18_627;
export const SOURCE_SHA256_V1 = "93e87316a10d289ac537350bd2af314370f0324e3d5b130cfe9ba4f1760f8039";
export const SELF_DESCRIPTION_JSONL_V1 =
  '{"artifact":"candidate-containment-guardian-v1","binding":null,"diagnosticMaximumBytes":22,"entry":"oxigraph_containment_guardian_entry","epochBytes":32,"extraDescriptorScanEnd":1023,"g17Eligible":false,"normalDescriptorCount":8,"normalFdRoles":["controller","statusWrite","diagnosticsWrite","stateRoot","delegatedRoot","guardianLifetimeCgroup","epochRead","supervisorExecutable"],"productionReady":false,"provisionalChildFaultCleanupImplemented":true,"recoveryDescriptorCount":7,"recoveryFdRoles":["recoveryRequestRead","statusWrite","diagnosticsWrite","stateRoot","delegatedRoot","recoveryActorLifetimeCgroup","epochRead"],"requirementsSha256":"94c6b1bbf7330fae09b73da5948aab02577aae42b7e5506577c11b270a556071","runtimeRegistered":false,"schema":"oxigraph.candidate-containment-guardian-self-description/v1","statusMaximumBytes":67,"target":"linux-x86_64-freestanding-static","terminalReleaseTeardownImplemented":true}\n';
export const ATTESTATION_SCHEMA_V1 = "oxigraph.candidate-containment-guardian-attestation/v1";
export const REQUIREMENTS_CANONICAL_JSON_V1 =
  '{"allowedSyscallNumbers":[0,1,3,5,8,13,34,52,55,56,61,62,72,73,231,436],"authority":{"cgroupMutation":false,"g17Execution":false,"productionReadiness":false,"promotion":false,"publication":false,"qualification":false,"runtimeRegistration":false},"controller":{"connected":true,"domain":"AF_UNIX","oneByteEof":true,"passCredentials":true,"type":"SOCK_SEQPACKET"},"entry":"oxigraph_containment_guardian_entry","epoch":{"bytes":32,"eofRequired":true},"limits":{"diagnosticBytes":22,"extraDescriptorScanEnd":1023,"statusBytes":67},"mechanics":{"cgroupMutation":false,"descriptorIdentitiesDistinct":true,"exclusiveReaper":true,"provisionalChildFaultCleanup":true,"terminalReleaseTeardown":true},"normalFds":["controller","statusWrite","diagnosticsWrite","stateRoot","delegatedRoot","guardianLifetimeCgroup","epochRead","supervisorExecutable"],"readiness":{"reason":"native-adapter-unavailable","status":"unavailable"},"recoveryFds":["recoveryRequestRead","statusWrite","diagnosticsWrite","stateRoot","delegatedRoot","recoveryActorLifetimeCgroup","epochRead"],"schema":"oxigraph.candidate-containment-guardian-requirements/v1","statusFlags":{"directory":"O_LARGEFILE|O_DIRECTORY","pipe":"NONE","regular":"O_LARGEFILE","socket":"NONE"},"target":"linux-x86_64-freestanding-static","version":1}';
export const REQUIREMENTS_V1 = deepFreezeV1(JSON.parse(REQUIREMENTS_CANONICAL_JSON_V1));
export const REQUIREMENTS_SHA256_V1 = "94c6b1bbf7330fae09b73da5948aab02577aae42b7e5506577c11b270a556071";
if (semanticSha256V1(REQUIREMENTS_V1) !== REQUIREMENTS_SHA256_V1) throw new Error("ADR38_NATIVE_ATTEST_REQUIREMENTS");
export const COMPILER_PATH_V1 = NATIVE_COMPILER_PATH_V1;
export const COMPILER_ENVIRONMENT_V1 = NATIVE_COMPILER_ENVIRONMENT_V1;
export const COMPILE_ARGV_V1 = Object.freeze([
  COMPILER_PATH_V1,
  "-std=c17", "-O2", "-Wall", "-Wextra", "-Werror", "-Wconversion",
  "-Wsign-conversion", "-Wshadow", "-Wformat=2", "-Wundef", "-Wvla",
  "-ffreestanding", "-fno-builtin", "-fno-pie", "-no-pie",
  "-fno-stack-protector", "-fno-asynchronous-unwind-tables",
  "-fno-unwind-tables", "-fno-ident", "-fvisibility=hidden", "-nostdlib",
  "-nostartfiles", "-nodefaultlibs", "-static", "-Wl,--build-id=none",
  "-Wl,--fatal-warnings", "-Wl,-z,noexecstack,-z,separate-code,-z,relro,-z,now",
  "-Wl,-e,oxigraph_containment_guardian_entry", "SOURCE", "-o", "OUTPUT_ELF",
]);
export const ELF_BYTES_V1 = 10_872;
export const ELF_SHA256_V1 = "b42663bd425f22e34998dd9d674849fd35673d7f3ad9e33d03d3cf09c12c4867";

export const attestV1 = createNativeAttestationV1({
  kind: "guardian",
  manager: false,
  attestationSchema: ATTESTATION_SCHEMA_V1,
  sourceBytes: SOURCE_BYTES_V1,
  sourceSha256: SOURCE_SHA256_V1,
  selfDescription: SELF_DESCRIPTION_JSONL_V1,
  requirements: REQUIREMENTS_V1,
  requirementsSha256: REQUIREMENTS_SHA256_V1,
  compileArgv: COMPILE_ARGV_V1,
  linkArgv: null,
  elfBytes: ELF_BYTES_V1,
  elfSha256: ELF_SHA256_V1,
});
