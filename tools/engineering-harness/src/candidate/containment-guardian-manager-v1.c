/*
 * ADR-0038 S0 authority-null native service-manager child.
 *
 * This freestanding executable deliberately owns no service-manager, cgroup,
 * filesystem, guardian-launch, qualification, or production authority.  S0
 * binds the exact ADR-0037 StateFS object into the manager ELF without
 * modifying or invoking it.  A later reviewed slice must supply the branded
 * StateFS request bridge and physical manager protocol before this entry may
 * do anything except fail closed.
 */

#include "containment-guardian-statefs-syscalls-v1.h"

#if !defined(__linux__) || !defined(__x86_64__)
#error "ADR-0038 S0 manager requires Linux x86-64"
#endif

__attribute__((
    section(".rodata.oxigraph_containment_guardian_manager"),
    used,
    aligned(1)
))
const char oxigraph_containment_guardian_manager_self_description[] =
    "{\"artifact\":\"candidate-containment-guardian-manager-v1\",\"binding\":null,\"entry\":\"oxigraph_containment_guardian_manager_entry\",\"g17Eligible\":false,\"guardianLaunchImplemented\":false,\"linkedStatefsEntrypoint\":\"oxigraph_containment_statefs_execute_v1\",\"linkedStatefsObjectSha256\":\"73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043\",\"managerProtocolBridgeImplemented\":false,\"productionReady\":false,\"requirementsSha256\":\"ec91cb4740266fdf4dac278af25cc3713d8f6b657ffc32e826933b4c8637f31f\",\"runtimeRegistered\":false,\"schema\":\"oxigraph.candidate-containment-manager-self-description/v1\",\"statefsInvoked\":false,\"target\":\"linux-x86_64-freestanding-static\"}\n";

/*
 * A typed relocation keeps the exact separately compiled ADR-0037 entrypoint
 * in the final ELF.  It is data, not a second implementation or an invocation.
 */
__attribute__((used, visibility("hidden")))
int32_t (*const oxigraph_containment_guardian_manager_statefs_entry)(
    const struct oxigraph_containment_statefs_request_v1 *,
    struct oxigraph_containment_statefs_result_v1 *
) = oxigraph_containment_statefs_execute_v1;

static __attribute__((noreturn)) void ox_manager_exit(long status) {
    register long number __asm__("rax") = 231L;
    register long first __asm__("rdi") = status;
    __asm__ volatile(
        "syscall"
        :
        : "a"(number), "D"(first)
        : "rcx", "r11", "memory"
    );
    __builtin_unreachable();
}

__asm__(
    ".global oxigraph_containment_guardian_manager_entry\n"
    ".type oxigraph_containment_guardian_manager_entry,@function\n"
    "oxigraph_containment_guardian_manager_entry:\n"
    "andq $-16,%rsp\n"
    "call oxigraph_containment_guardian_manager_main\n"
    "ud2\n"
    ".size oxigraph_containment_guardian_manager_entry,"
    ".-oxigraph_containment_guardian_manager_entry\n"
);

__attribute__((noreturn, used, noinline, visibility("hidden")))
void oxigraph_containment_guardian_manager_main(void) {
    ox_manager_exit(125L);
}
