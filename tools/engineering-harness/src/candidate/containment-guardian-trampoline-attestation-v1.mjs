import {
  NATIVE_COMPILER_ENVIRONMENT_V1,
  NATIVE_COMPILER_PATH_V1,
  createNativeAttestationV1,
  deepFreezeV1,
  semanticSha256V1,
  sha256V1,
} from "./containment-guardian-native-attestation-common-v1.mjs";

export { sha256V1 };
export const SOURCE_LOGICAL_NAME_V1 = "containment-guardian-trampoline-v1.c";
export const SOURCE_BYTES_V1 = 5_828;
export const SOURCE_SHA256_V1 = "2e4e39718673030ee26f9870eab03d0adda33d656d807c01226420b776dc955b";
export const SELF_DESCRIPTION_JSONL_V1 =
  '{"artifact":"candidate-containment-guardian-trampoline-v1","binding":null,"entry":"oxigraph_containment_guardian_trampoline_entry","executableFd":18,"g17Eligible":false,"incomingFdEnd":49,"incomingFdStart":32,"pathnameExecution":false,"productionReady":false,"remapTargetEnd":17,"remapTargetStart":0,"requirementsSha256":"7efd0ec2b8728304dcf320e8fc22113047d4702002a76f849f3f39528e73bd6a","runtimeRegistered":false,"schema":"oxigraph.candidate-containment-trampoline-self-description/v1","target":"linux-x86_64-freestanding-static","testFaultSelectorCompiled":false}\n';
export const ATTESTATION_SCHEMA_V1 = "oxigraph.candidate-containment-trampoline-attestation/v1";
export const REQUIREMENTS_CANONICAL_JSON_V1 =
  '{"allowedSyscallNumbers":[3,72,231,292,322,436],"authority":{"cgroupMutation":false,"g17Execution":false,"productionReadiness":false,"promotion":false,"publication":false,"qualification":false,"runtimeRegistration":false},"closeRange":[19,4294967295],"entry":"oxigraph_containment_guardian_trampoline_entry","executableFd":18,"execveat":{"flags":["AT_EMPTY_PATH"],"pathname":""},"forbidden":["filesystem","cgroup","signal","clone","fork","thread","network","pathname-exec"],"readiness":{"reason":"native-adapter-unavailable","status":"unavailable"},"remaps":[[32,0],[33,1],[34,2],[35,3],[36,4],[37,5],[38,6],[39,7],[40,8],[41,9],[42,10],[43,11],[44,12],[45,13],[46,14],[47,15],[48,16],[49,17]],"schema":"oxigraph.candidate-containment-trampoline-requirements/v1","target":"linux-x86_64-freestanding-static","version":1}';
export const REQUIREMENTS_V1 = deepFreezeV1(JSON.parse(REQUIREMENTS_CANONICAL_JSON_V1));
export const REQUIREMENTS_SHA256_V1 = "7efd0ec2b8728304dcf320e8fc22113047d4702002a76f849f3f39528e73bd6a";
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
  "-Wl,-e,oxigraph_containment_guardian_trampoline_entry", "SOURCE", "-o", "OUTPUT_ELF",
]);
export const ELF_BYTES_V1 = 9_848;
export const ELF_SHA256_V1 = "2a19da84b079337d19b13b86d3dd6395e7517f038735c657b2956308dea87abc";

export const attestV1 = createNativeAttestationV1({
  kind: "trampoline",
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
