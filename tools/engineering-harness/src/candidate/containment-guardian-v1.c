/*
 * ADR-0038 S0 authority-null stable guardian/reaper.
 *
 * The executable implements only a bounded, non-delegating native protocol
 * fixture: exact normal/recovery startup FD validation, raw 32-byte epoch plus
 * EOF framing, a one-shot provisional child cleanup path, exclusive reaping,
 * bounded status/diagnostics, and terminal descriptor teardown.  It performs
 * no cgroup or filesystem mutation, accepts no pathname, and grants no runtime,
 * G1.7, qualification, readiness, promotion, or publication authority.
 */

#if !defined(__linux__) || !defined(__x86_64__)
#error "ADR-0038 S0 guardian requires Linux x86-64"
#endif

typedef unsigned char ox_u8;
typedef unsigned short ox_u16;
typedef unsigned int ox_u32;
typedef unsigned long ox_u64;
typedef signed long ox_i64;
typedef unsigned long ox_usize;

#define OX_EBADF 9L
#define OX_EINTR 4L
#define OX_SIGCHLD 17L
#define OX_SIGKILL 9L
#define OX_SIGPIPE 13L
#define OX_SIG_IGN 1UL
#define OX_F_GETFD 1L
#define OX_F_GETFL 3L
#define OX_LOCK_EX 2L
#define OX_LOCK_NB 4L
#define OX_O_ACCMODE 3L
#define OX_O_RDONLY 0L
#define OX_O_WRONLY 1L
#define OX_O_RDWR 2L
#define OX_O_LARGEFILE 0100000L
#define OX_O_DIRECTORY 00200000L
#define OX_O_PATH 010000000L
#define OX_S_IFMT 0170000U
#define OX_S_IFIFO 0010000U
#define OX_S_IFDIR 0040000U
#define OX_S_IFREG 0100000U
#define OX_S_IFSOCK 0140000U
#define OX_SOL_SOCKET 1L
#define OX_SO_TYPE 3L
#define OX_SO_PASSCRED 16L
#define OX_SO_DOMAIN 39L
#define OX_AF_UNIX 1
#define OX_SOCK_SEQPACKET 5
#define OX_SEEK_CUR 1L

struct ox_kernel_stat {
    ox_u64 device;
    ox_u64 inode;
    ox_u64 links;
    ox_u32 mode;
    ox_u32 owner_uid;
    ox_u32 owner_gid;
    ox_u32 padding0;
    ox_u64 special_device;
    ox_i64 size;
    ox_i64 block_size;
    ox_i64 blocks;
    ox_u64 accessed_seconds;
    ox_u64 accessed_nanoseconds;
    ox_u64 modified_seconds;
    ox_u64 modified_nanoseconds;
    ox_u64 changed_seconds;
    ox_u64 changed_nanoseconds;
    ox_i64 unused[3];
};

struct ox_kernel_sigaction {
    ox_u64 handler;
    ox_u64 flags;
    ox_u64 restorer;
    ox_u64 mask;
};

struct ox_socket_address {
    ox_u16 family;
    ox_u8 data[126];
};

__attribute__((
    section(".rodata.oxigraph_containment_guardian"),
    used,
    aligned(1)
))
const char oxigraph_containment_guardian_self_description[] =
    "{\"artifact\":\"candidate-containment-guardian-v1\",\"binding\":null,\"diagnosticMaximumBytes\":22,\"entry\":\"oxigraph_containment_guardian_entry\",\"epochBytes\":32,\"extraDescriptorScanEnd\":1023,\"g17Eligible\":false,\"normalDescriptorCount\":8,\"normalFdRoles\":[\"controller\",\"statusWrite\",\"diagnosticsWrite\",\"stateRoot\",\"delegatedRoot\",\"guardianLifetimeCgroup\",\"epochRead\",\"supervisorExecutable\"],\"productionReady\":false,\"provisionalChildFaultCleanupImplemented\":true,\"recoveryDescriptorCount\":7,\"recoveryFdRoles\":[\"recoveryRequestRead\",\"statusWrite\",\"diagnosticsWrite\",\"stateRoot\",\"delegatedRoot\",\"recoveryActorLifetimeCgroup\",\"epochRead\"],\"requirementsSha256\":\"94c6b1bbf7330fae09b73da5948aab02577aae42b7e5506577c11b270a556071\",\"runtimeRegistered\":false,\"schema\":\"oxigraph.candidate-containment-guardian-self-description/v1\",\"statusMaximumBytes\":67,\"target\":\"linux-x86_64-freestanding-static\",\"terminalReleaseTeardownImplemented\":true}\n";

static inline long ox_read(int descriptor, void *bytes, ox_usize length) {
    long result;
    __asm__ volatile(
        "movl $0, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"((long)(ox_u64)bytes), "d"((long)length)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_write(int descriptor, const void *bytes, ox_usize length) {
    long result;
    __asm__ volatile(
        "movl $1, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"((long)(ox_u64)bytes), "d"((long)length)
        : "rcx", "r11", "memory"
    );
    return result;
}

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

static inline long ox_fstat(int descriptor, struct ox_kernel_stat *status) {
    long result;
    __asm__ volatile(
        "movl $5, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"((long)(ox_u64)status)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_lseek(int descriptor, long offset, long whence) {
    long result;
    __asm__ volatile(
        "movl $8, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"(offset), "d"(whence)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_rt_sigaction(
    long signal,
    const struct ox_kernel_sigaction *action
) {
    register long fourth __asm__("r10") = 8L;
    long result;
    __asm__ volatile(
        "movl $13, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"(signal), "S"((long)(ox_u64)action), "d"(0L), "r"(fourth)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_pause(void) {
    long result;
    __asm__ volatile(
        "movl $34, %%eax\n\tsyscall"
        : "=a"(result)
        :
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_getsockopt(
    int descriptor,
    long level,
    long option,
    int *value,
    ox_u32 *length
) {
    register long fifth __asm__("r8") = (long)(ox_u64)length;
    register long fourth __asm__("r10") = (long)(ox_u64)value;
    long result;
    __asm__ volatile(
        "movl $55, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"(level), "d"(option), "r"(fourth),
          "r"(fifth)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_getpeername(
    int descriptor,
    struct ox_socket_address *address,
    ox_u32 *length
) {
    long result;
    __asm__ volatile(
        "movl $52, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"((long)(ox_u64)address),
          "d"((long)(ox_u64)length)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_clone_child(void) {
    register long fourth __asm__("r10") = 0L;
    register long fifth __asm__("r8") = 0L;
    long result;
    __asm__ volatile(
        "movl $56, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"(OX_SIGCHLD), "S"(0L), "d"(0L), "r"(fourth), "r"(fifth)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_wait4(long child, int *status) {
    register long fourth __asm__("r10") = 0L;
    long result;
    __asm__ volatile(
        "movl $61, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"(child), "S"((long)(ox_u64)status), "d"(0L), "r"(fourth)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_kill(long child, long signal) {
    long result;
    __asm__ volatile(
        "movl $62, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"(child), "S"(signal)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_fcntl(int descriptor, long command) {
    long result;
    __asm__ volatile(
        "movl $72, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"(command), "d"(0L)
        : "rcx", "r11", "memory"
    );
    return result;
}

static inline long ox_flock(int descriptor) {
    long result;
    __asm__ volatile(
        "movl $73, %%eax\n\tsyscall"
        : "=a"(result)
        : "D"((long)descriptor), "S"(OX_LOCK_EX | OX_LOCK_NB)
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

static int ox_ignore_sigpipe(void) {
    struct ox_kernel_sigaction action;
    action.handler = OX_SIG_IGN;
    action.flags = 0UL;
    action.restorer = 0UL;
    action.mask = 0UL;
    return ox_rt_sigaction(OX_SIGPIPE, &action) == 0L;
}

static int ox_write_all(int descriptor, const ox_u8 *bytes, ox_usize length) {
    ox_usize offset = 0UL;
    unsigned int retries = 0U;
    while (offset < length) {
        long result = ox_write(descriptor, bytes + offset, length - offset);
        if (result == -OX_EINTR && retries < 8U) {
            retries += 1U;
            continue;
        }
        if (result <= 0L || (ox_u64)result > length - offset) return 0;
        offset += (ox_usize)result;
        retries = 0U;
    }
    return 1;
}

static int ox_read_exact_eof(int descriptor, ox_u8 *bytes, ox_usize length) {
    ox_usize offset = 0UL;
    ox_u8 trailing = 0U;
    unsigned int retries = 0U;
    while (offset < length) {
        long result = ox_read(descriptor, bytes + offset, length - offset);
        if (result == -OX_EINTR && retries < 8U) {
            retries += 1U;
            continue;
        }
        if (result <= 0L || (ox_u64)result > length - offset) return 0;
        offset += (ox_usize)result;
        retries = 0U;
    }
    retries = 0U;
    for (;;) {
        long result = ox_read(descriptor, &trailing, 1UL);
        if (result == -OX_EINTR && retries < 8U) {
            retries += 1U;
            continue;
        }
        return result == 0L;
    }
}

static int ox_read_single_byte_eof(int descriptor, ox_u8 *byte) {
    ox_u8 framed[2];
    ox_u8 trailing = 0U;
    unsigned int retries = 0U;
    long result;
    for (;;) {
        result = ox_read(descriptor, framed, sizeof(framed));
        if (result == -OX_EINTR && retries < 8U) {
            retries += 1U;
            continue;
        }
        break;
    }
    if (result != 1L) return 0;
    *byte = framed[0];
    retries = 0U;
    for (;;) {
        result = ox_read(descriptor, &trailing, 1UL);
        if (result == -OX_EINTR && retries < 8U) {
            retries += 1U;
            continue;
        }
        return result == 0L;
    }
}

static int ox_fd_flags(int descriptor, long access, long status_remainder) {
    long descriptor_flags = ox_fcntl(descriptor, OX_F_GETFD);
    long status_flags = ox_fcntl(descriptor, OX_F_GETFL);
    return descriptor_flags == 0L && status_flags >= 0L &&
           (status_flags & OX_O_ACCMODE) == access &&
           (status_flags & OX_O_PATH) == 0L &&
           (status_flags & ~OX_O_ACCMODE) == status_remainder;
}

static int ox_fd_kind(
    int descriptor,
    ox_u32 kind,
    long access,
    long status_remainder
) {
    struct ox_kernel_stat status;
    if (!ox_fd_flags(descriptor, access, status_remainder)) return 0;
    if (ox_fstat(descriptor, &status) != 0L) return 0;
    return (status.mode & OX_S_IFMT) == kind;
}

static int ox_normal_controller(void) {
    struct ox_kernel_stat status;
    struct ox_socket_address peer;
    int socket_type = 0;
    int socket_domain = 0;
    int pass_credentials = 0;
    ox_u32 length = (ox_u32)sizeof(int);
    if (!ox_fd_flags(0, OX_O_RDWR, 0L) || ox_fstat(0, &status) != 0L ||
        (status.mode & OX_S_IFMT) != OX_S_IFSOCK) {
        return 0;
    }
    if (ox_getsockopt(0, OX_SOL_SOCKET, OX_SO_TYPE, &socket_type, &length) != 0L ||
        length != (ox_u32)sizeof(int) || socket_type != OX_SOCK_SEQPACKET) {
        return 0;
    }
    length = (ox_u32)sizeof(int);
    if (ox_getsockopt(0, OX_SOL_SOCKET, OX_SO_DOMAIN, &socket_domain, &length) != 0L ||
        length != (ox_u32)sizeof(int) || socket_domain != OX_AF_UNIX) {
        return 0;
    }
    length = (ox_u32)sizeof(int);
    if (ox_getsockopt(0, OX_SOL_SOCKET, OX_SO_PASSCRED, &pass_credentials, &length) != 0L ||
        length != (ox_u32)sizeof(int) || pass_credentials != 1) {
        return 0;
    }
    length = (ox_u32)sizeof(peer);
    if (ox_getpeername(0, &peer, &length) != 0L ||
        length < (ox_u32)sizeof(peer.family) ||
        length > (ox_u32)sizeof(peer) || peer.family != (ox_u16)OX_AF_UNIX) {
        return 0;
    }
    return 1;
}

static int ox_no_extra_descriptors(int first) {
    int descriptor;
    for (descriptor = first; descriptor <= 1023; descriptor += 1) {
        if (ox_fcntl(descriptor, OX_F_GETFD) != -OX_EBADF) return 0;
    }
    return 1;
}

static int ox_distinct_descriptor_identities(int count) {
    struct ox_kernel_stat left_status;
    struct ox_kernel_stat right_status;
    int left;
    int right;
    for (left = 0; left < count; left += 1) {
        if (ox_fstat(left, &left_status) != 0L) return 0;
        for (right = left + 1; right < count; right += 1) {
            if (ox_fstat(right, &right_status) != 0L) return 0;
            if (
                left_status.device == right_status.device &&
                left_status.inode == right_status.inode
            ) {
                return 0;
            }
        }
    }
    return 1;
}

static int ox_common_descriptors(void) {
    return ox_fd_kind(1, OX_S_IFIFO, OX_O_WRONLY, 0L) &&
           ox_fd_kind(2, OX_S_IFIFO, OX_O_WRONLY, 0L) &&
           ox_fd_kind(
               3, OX_S_IFDIR, OX_O_RDONLY, OX_O_LARGEFILE | OX_O_DIRECTORY
           ) &&
           ox_flock(3) == 0L &&
           ox_fd_kind(
               4, OX_S_IFDIR, OX_O_RDONLY, OX_O_LARGEFILE | OX_O_DIRECTORY
           ) &&
           ox_fd_kind(
               5, OX_S_IFDIR, OX_O_RDONLY, OX_O_LARGEFILE | OX_O_DIRECTORY
           ) &&
           ox_fd_kind(6, OX_S_IFIFO, OX_O_RDONLY, 0L);
}

static int ox_normal_descriptors(void) {
    struct ox_kernel_stat status;
    if (!ox_normal_controller() || !ox_common_descriptors() ||
        !ox_fd_kind(7, OX_S_IFREG, OX_O_RDONLY, OX_O_LARGEFILE) ||
        ox_fstat(7, &status) != 0L || status.links != 1UL ||
        ox_lseek(7, 0L, OX_SEEK_CUR) != 0L ||
        !ox_distinct_descriptor_identities(8) ||
        !ox_no_extra_descriptors(8)) {
        return 0;
    }
    return 1;
}

static int ox_recovery_descriptors(void) {
    return ox_fd_kind(0, OX_S_IFIFO, OX_O_RDONLY, 0L) &&
           ox_common_descriptors() &&
           ox_distinct_descriptor_identities(7) &&
           ox_no_extra_descriptors(7);
}

static int ox_reap_provisional_child(void) {
    int status = 0;
    unsigned int retries = 0U;
    long child = ox_clone_child();
    if (child < 0L) return 0;
    if (child == 0L) {
        (void)ox_close_range(0U, ~0U);
        for (;;) (void)ox_pause();
    }
    if (ox_kill(child, OX_SIGKILL) != 0L) return 0;
    for (;;) {
        long waited = ox_wait4(child, &status);
        if (waited == -OX_EINTR && retries < 8U) {
            retries += 1U;
            continue;
        }
        if (waited != child) return 0;
        break;
    }
    return (status & 0x7f) == (int)OX_SIGKILL;
}

static __attribute__((noreturn)) void ox_fail_initialization(int diagnostics_ok) {
    static const ox_u8 message[] = "GUARDIAN_INIT_FAIL\n";
    if (diagnostics_ok) {
        (void)ox_write_all(2, message, sizeof(message) - 1UL);
    }
    (void)ox_close_range(0U, ~0U);
    ox_exit(125L);
}

static __attribute__((noreturn)) void ox_fail_runtime(void) {
    static const ox_u8 message[] = "GUARDIAN_RUNTIME_FAIL\n";
    (void)ox_write_all(2, message, sizeof(message) - 1UL);
    (void)ox_close_range(0U, ~0U);
    ox_exit(126L);
}

static __attribute__((noreturn)) void ox_terminal_release(int normal) {
    static const ox_u8 terminal[] = "TERMINAL_RELEASED\n";
    (void)ox_close(0);
    (void)ox_close(3);
    (void)ox_close(4);
    (void)ox_close(5);
    if (normal) (void)ox_close(7);
    if (!ox_write_all(1, terminal, sizeof(terminal) - 1UL)) ox_fail_runtime();
    if (ox_close(1) != 0L) ox_fail_runtime();
    (void)ox_close(2);
    ox_exit(0L);
}

__asm__(
    ".global oxigraph_containment_guardian_entry\n"
    ".type oxigraph_containment_guardian_entry,@function\n"
    "oxigraph_containment_guardian_entry:\n"
    "andq $-16,%rsp\n"
    "call oxigraph_containment_guardian_main\n"
    "ud2\n"
    ".size oxigraph_containment_guardian_entry,"
    ".-oxigraph_containment_guardian_entry\n"
);

__attribute__((noreturn, used, noinline, visibility("hidden")))
void oxigraph_containment_guardian_main(void) {
    static const ox_u8 normal_initialized[] = "INITIALIZED NORMAL\n";
    static const ox_u8 recovery_initialized[] = "INITIALIZED RECOVERY_ONLY\n";
    static const ox_u8 provisional_cleaned[] = "PROVISIONAL_CHILD_CLEANED\n";
    static const ox_u8 recovery_request[] = "RECOVERY\n";
    ox_u8 epoch[32];
    ox_u8 request[sizeof(recovery_request) - 1UL];
    ox_u8 command = 0U;
    int diagnostics_ok;
    int normal;

    if (!ox_ignore_sigpipe()) ox_exit(125L);
    diagnostics_ok = ox_fd_kind(2, OX_S_IFIFO, OX_O_WRONLY, 0L);
    normal = ox_fcntl(7, OX_F_GETFD) != -OX_EBADF;
    if (normal) {
        if (!diagnostics_ok || !ox_normal_descriptors() ||
            !ox_read_exact_eof(6, epoch, sizeof(epoch)) || ox_close(6) != 0L) {
            ox_fail_initialization(diagnostics_ok);
        }
        if (!ox_write_all(1, normal_initialized, sizeof(normal_initialized) - 1UL)) {
            ox_fail_runtime();
        }
        if (!ox_read_single_byte_eof(0, &command) ||
            (command != (ox_u8)'F' && command != (ox_u8)'T')) {
            ox_fail_runtime();
        }
        if (command == (ox_u8)'F') {
            if (!ox_reap_provisional_child() ||
                !ox_write_all(1, provisional_cleaned, sizeof(provisional_cleaned) - 1UL)) {
                ox_fail_runtime();
            }
        }
        ox_terminal_release(1);
    }

    if (!diagnostics_ok || !ox_recovery_descriptors() ||
        !ox_read_exact_eof(6, epoch, sizeof(epoch)) || ox_close(6) != 0L ||
        !ox_read_exact_eof(0, request, sizeof(request))) {
        ox_fail_initialization(diagnostics_ok);
    }
    {
        ox_usize index;
        for (index = 0UL; index < sizeof(request); index += 1UL) {
            if (request[index] != recovery_request[index]) {
                ox_fail_initialization(diagnostics_ok);
            }
        }
    }
    if (!ox_write_all(1, recovery_initialized, sizeof(recovery_initialized) - 1UL)) {
        ox_fail_runtime();
    }
    ox_terminal_release(0);
}
