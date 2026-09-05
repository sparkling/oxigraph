/*
 * ADR-0038 S0 authority-null fixed launch trampoline.
 *
 * Incoming descriptors 32..49 are remapped to supervisor descriptors 0..17.
 * Held executable FD 18 is marked close-on-exec, all descriptors from 19 up
 * are closed, and the held file is entered with execveat(AT_EMPTY_PATH).
 * There is no parser, pathname, allocator, filesystem/cgroup mutation,
 * networking, signal, clone, fork, thread, or runtime-registration surface.
 */

#if !defined(__linux__) || !defined(__x86_64__)
#error "ADR-0038 S0 trampoline requires Linux x86-64"
#endif

typedef unsigned int ox_u32;
typedef unsigned long ox_u64;

#define OX_F_SETFD 2L
#define OX_FD_CLOEXEC 1L
#define OX_AT_EMPTY_PATH 0x1000L
#define OX_O_CLOEXEC 02000000L

#ifndef OXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP
#define OXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP 0
#endif

__attribute__((
    section(".rodata.oxigraph_containment_guardian_trampoline"),
    used,
    aligned(1)
))
const char oxigraph_containment_guardian_trampoline_self_description[] =
#if OXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP == 0
    "{\"artifact\":\"candidate-containment-guardian-trampoline-v1\",\"binding\":null,\"entry\":\"oxigraph_containment_guardian_trampoline_entry\",\"executableFd\":18,\"g17Eligible\":false,\"incomingFdEnd\":49,\"incomingFdStart\":32,\"pathnameExecution\":false,\"productionReady\":false,\"remapTargetEnd\":17,\"remapTargetStart\":0,\"requirementsSha256\":\"7efd0ec2b8728304dcf320e8fc22113047d4702002a76f849f3f39528e73bd6a\",\"runtimeRegistered\":false,\"schema\":\"oxigraph.candidate-containment-trampoline-self-description/v1\",\"target\":\"linux-x86_64-freestanding-static\",\"testFaultSelectorCompiled\":false}\n";
#else
    "{\"artifact\":\"candidate-containment-guardian-trampoline-v1\",\"binding\":null,\"entry\":\"oxigraph_containment_guardian_trampoline_entry\",\"executableFd\":18,\"g17Eligible\":false,\"incomingFdEnd\":49,\"incomingFdStart\":32,\"pathnameExecution\":false,\"productionReady\":false,\"remapTargetEnd\":17,\"remapTargetStart\":0,\"requirementsSha256\":\"7efd0ec2b8728304dcf320e8fc22113047d4702002a76f849f3f39528e73bd6a\",\"runtimeRegistered\":false,\"schema\":\"oxigraph.candidate-containment-trampoline-self-description/v1\",\"target\":\"linux-x86_64-freestanding-static\",\"testFaultSelectorCompiled\":true}\n";
#endif

static inline long ox_close(int descriptor) {
    long result;
    __asm__ volatile(
        "movl $3, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_fcntl(int descriptor, long command, long argument) {
    long result;
    __asm__ volatile(
        "movl $72, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"(command), "d"(argument)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_dup3(int source, int target) {
    long result;
    __asm__ volatile(
        "movl $292, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)source), "S"((long)target), "d"(0L)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_execveat(
    int descriptor,
    const char *pathname,
    const char *const *argv,
    const char *const *environment,
    long flags
) {
    register long fourth __asm__("r10") = (long)(ox_u64)environment;
    register long fifth __asm__("r8") = flags;
    long result;
    __asm__ volatile(
        "movl $322, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"((long)(ox_u64)pathname),
          "d"((long)(ox_u64)argv), "r"(fourth), "r"(fifth)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_close_range(unsigned int first, unsigned int last) {
    long result;
    __asm__ volatile(
        "movl $436, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)first), "S"((long)last), "d"(0L)
        : "rcx", "r11", "memory"
    );
    return result;
}

static __attribute__((noreturn)) void ox_exit(long status) {
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

static __attribute__((noreturn)) void ox_fail(void) {
    (void)ox_close_range(0U, ~0U);
    ox_exit(125L);
}

__asm__(
    ".global oxigraph_containment_guardian_trampoline_entry\n"
    ".type oxigraph_containment_guardian_trampoline_entry,@function\n"
    "oxigraph_containment_guardian_trampoline_entry:\n"
    "andq $-16,%rsp\n"
    "call oxigraph_containment_guardian_trampoline_main\n"
    "ud2\n"
    ".size oxigraph_containment_guardian_trampoline_entry,"
    ".-oxigraph_containment_guardian_trampoline_entry\n"
);

__attribute__((noreturn, used, noinline, visibility("hidden")))
void oxigraph_containment_guardian_trampoline_main(void) {
    static const char empty[] = "";
    static const char argument_zero[] = "candidate-containment-supervisor";
    const char *const argv[] = {argument_zero, (const char *)0};
    const char *const environment[] = {(const char *)0};
    int index;

    for (index = 0; index < 18; index += 1) {
        if (OXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP == index + 1) {
            ox_fail();
        }
        if (ox_dup3(index + 32, index) != index) ox_fail();
    }
    if (OXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP == 19) ox_fail();
    if (ox_fcntl(18, OX_F_SETFD, OX_FD_CLOEXEC) != 0L) ox_fail();
    if (OXIGRAPH_CONTAINMENT_TRAMPOLINE_TEST_FAIL_STEP == 20) ox_fail();
    if (ox_close_range(19U, ~0U) != 0L) ox_fail();
    if (ox_execveat(18, empty, argv, environment, OX_AT_EMPTY_PATH) < 0L) {
        (void)ox_close(18);
        ox_fail();
    }
    ox_fail();
}
