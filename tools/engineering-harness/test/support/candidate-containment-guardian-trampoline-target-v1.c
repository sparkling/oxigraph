#if !defined(__linux__) || !defined(__x86_64__)
#error "ADR-0038 S0 trampoline target fixture requires Linux x86-64"
#endif

typedef unsigned long ox_u64;

static const char message[] = "TRAMPOLINE_TARGET_EXECUTED\n";

static inline long ox_write(int descriptor, const void *bytes, unsigned long length) {
    long result;
    __asm__ volatile(
        "movl $1, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"((long)(ox_u64)bytes), "d"((long)length)
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

__attribute__((noreturn, used, visibility("hidden")))
void oxigraph_containment_trampoline_target_entry(void) {
    long written = ox_write(1, message, sizeof(message) - 1UL);
    ox_exit(written == (long)(sizeof(message) - 1UL) ? 0L : 125L);
}
