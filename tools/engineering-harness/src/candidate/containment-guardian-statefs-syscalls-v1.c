#include "containment-guardian-statefs-syscalls-v1.h"

#define STATEFS_ALWAYS_INLINE static inline __attribute__((always_inline))

enum statefs_syscall_number_v1 {
    STATEFS_SYSCALL_read = 0,
    STATEFS_SYSCALL_write = 1,
    STATEFS_SYSCALL_close = 3,
    STATEFS_SYSCALL_fcntl = 72,
    STATEFS_SYSCALL_flock = 73,
    STATEFS_SYSCALL_fsync = 74,
    STATEFS_SYSCALL_fstatfs = 138,
    STATEFS_SYSCALL_getdents64 = 217,
    STATEFS_SYSCALL_openat = 257,
    STATEFS_SYSCALL_mkdirat = 258,
    STATEFS_SYSCALL_unlinkat = 263,
    STATEFS_SYSCALL_renameat2 = 316,
    STATEFS_SYSCALL_statx = 332
};

struct statefs_kernel_statx_timestamp_v1 {
    int64_t seconds;
    uint32_t nanoseconds;
    int32_t reserved;
};

struct statefs_kernel_statx_v1 {
    uint32_t mask;
    uint32_t block_size;
    uint64_t attributes;
    uint32_t link_count;
    uint32_t owner_uid;
    uint32_t owner_gid;
    uint16_t mode;
    uint16_t reserved_0;
    uint64_t inode;
    uint64_t byte_length;
    uint64_t blocks;
    uint64_t attributes_mask;
    struct statefs_kernel_statx_timestamp_v1 accessed;
    struct statefs_kernel_statx_timestamp_v1 created;
    struct statefs_kernel_statx_timestamp_v1 changed;
    struct statefs_kernel_statx_timestamp_v1 modified;
    uint32_t device_special_major;
    uint32_t device_special_minor;
    uint32_t device_major;
    uint32_t device_minor;
    uint64_t mount_id;
    uint32_t direct_io_memory_alignment;
    uint32_t direct_io_offset_alignment;
    uint64_t subvolume;
    uint32_t atomic_write_unit_minimum;
    uint32_t atomic_write_unit_maximum;
    uint32_t atomic_write_segments_maximum;
    uint32_t direct_io_read_offset_alignment;
    uint64_t reserved_1[9];
};

struct statefs_kernel_statfs_v1 {
    int64_t filesystem_magic;
    int64_t block_size;
    uint64_t blocks;
    uint64_t blocks_free;
    uint64_t blocks_available;
    uint64_t files;
    uint64_t files_free;
    int32_t filesystem_id_0;
    int32_t filesystem_id_1;
    int64_t name_length;
    int64_t fragment_size;
    int64_t mount_flags;
    int64_t reserved[4];
};

struct statefs_workspace_v1 {
    struct statefs_kernel_statx_v1 statx;
    struct statefs_kernel_statfs_v1 statfs;
    uint8_t name_a[256];
    uint8_t name_b[256];
    uint8_t one_byte;
};

_Static_assert(sizeof(struct statefs_kernel_statx_v1) == 256, "Linux statx size");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, link_count) == 16, "Linux statx nlink");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, owner_uid) == 20, "Linux statx uid");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, owner_gid) == 24, "Linux statx gid");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, mode) == 28, "Linux statx mode");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, inode) == 32, "Linux statx inode");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, byte_length) == 40, "Linux statx size field");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, device_major) == 136, "Linux statx dev major");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, device_minor) == 140, "Linux statx dev minor");
_Static_assert(offsetof(struct statefs_kernel_statx_v1, mount_id) == 144, "Linux statx mount id");
_Static_assert(sizeof(struct statefs_kernel_statfs_v1) == 120, "Linux statfs size");

static struct statefs_workspace_v1 statefs_workspace;

STATEFS_ALWAYS_INLINE long statefs_linux_read(long descriptor, long bytes, long length) {
    long value;
    __asm__ volatile("movl $0, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor), "S"(bytes), "d"(length)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_write(long descriptor, long bytes, long length) {
    long value;
    __asm__ volatile("movl $1, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor), "S"(bytes), "d"(length)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_close(long descriptor) {
    long value;
    __asm__ volatile("movl $3, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_fcntl(long descriptor, long command, long argument) {
    long value;
    __asm__ volatile("movl $72, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor), "S"(command), "d"(argument)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_flock(long descriptor, long operation) {
    long value;
    __asm__ volatile("movl $73, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor), "S"(operation)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_fsync(long descriptor) {
    long value;
    __asm__ volatile("movl $74, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_fstatfs(long descriptor, long output) {
    long value;
    __asm__ volatile("movl $138, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor), "S"(output)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_getdents64(long descriptor, long output, long length) {
    long value;
    __asm__ volatile("movl $217, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(descriptor), "S"(output), "d"(length)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_openat(long directory, long name, long flags, long mode) {
    long value;
    register long argument_4 __asm__("r10") = mode;
    __asm__ volatile("movl $257, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(directory), "S"(name), "d"(flags),
                       "r"(argument_4)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_mkdirat(long directory, long name, long mode) {
    long value;
    __asm__ volatile("movl $258, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(directory), "S"(name), "d"(mode)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_unlinkat(long directory, long name, long flags) {
    long value;
    __asm__ volatile("movl $263, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(directory), "S"(name), "d"(flags)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_renameat2(long old_directory, long old_name,
                                                    long new_directory, long new_name,
                                                    long flags) {
    long value;
    register long argument_4 __asm__("r10") = new_name;
    register long argument_5 __asm__("r8") = flags;
    __asm__ volatile("movl $316, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(old_directory), "S"(old_name),
                       "d"(new_directory), "r"(argument_4),
                       "r"(argument_5)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE long statefs_linux_statx(long directory, long name, long flags,
                                                long mask, long output) {
    long value;
    register long argument_4 __asm__("r10") = mask;
    register long argument_5 __asm__("r8") = output;
    __asm__ volatile("movl $332, %%eax\n\tsyscall"
                     : "=a"(value)
                     : "D"(directory), "S"(name), "d"(flags),
                       "r"(argument_4), "r"(argument_5)
                     : "rcx", "r11", "memory");
    return value;
}

STATEFS_ALWAYS_INLINE int statefs_raw_error(long value) {
    return value < 0L && value >= -4095L;
}

STATEFS_ALWAYS_INLINE void statefs_zero(uint8_t *bytes, uint64_t length) {
    uint64_t index;
    for (index = 0U; index < length; index += 1U) bytes[index] = 0U;
}

STATEFS_ALWAYS_INLINE int statefs_ranges_overlap(uint64_t left, uint64_t left_length,
                                                  uint64_t right, uint64_t right_length) {
    if (left_length == 0U || right_length == 0U) return 0;
    return left < right + right_length && right < left + left_length;
}

STATEFS_ALWAYS_INLINE int statefs_range_is_valid(uint64_t address, uint64_t length,
                                                  uint64_t alignment) {
    if (length == 0U) return address == 0U;
    if (address == 0U || address > (uint64_t)UINTPTR_MAX) return 0;
    if (length > (uint64_t)UINTPTR_MAX - address) return 0;
    return alignment == 1U || (address & (alignment - 1U)) == 0U;
}

STATEFS_ALWAYS_INLINE int statefs_name_is_valid(const uint8_t *name, uint32_t length) {
    uint32_t index;
    if (length == 0U || length > 255U) return 0;
    if (length == 1U && name[0] == (uint8_t)'.') return 0;
    if (length == 2U && name[0] == (uint8_t)'.' && name[1] == (uint8_t)'.') return 0;
    for (index = 0U; index < length; index += 1U) {
        if (name[index] == 0U || name[index] > 0x7fU || name[index] == (uint8_t)'/') return 0;
    }
    return 1;
}

STATEFS_ALWAYS_INLINE void statefs_copy_name(uint8_t *destination,
                                              const uint8_t *source,
                                              uint32_t length) {
    uint32_t index;
    for (index = 0U; index < length; index += 1U) destination[index] = source[index];
    destination[length] = 0U;
}

STATEFS_ALWAYS_INLINE uint32_t statefs_kind_from_mode(uint32_t mode) {
    switch (mode & (uint32_t)OXIGRAPH_STATEFS_S_IFMT) {
        case OXIGRAPH_STATEFS_S_IFREG: return OXIGRAPH_STATEFS_OBSERVATION_REGULAR;
        case OXIGRAPH_STATEFS_S_IFDIR: return OXIGRAPH_STATEFS_OBSERVATION_DIRECTORY;
        case OXIGRAPH_STATEFS_S_IFLNK: return OXIGRAPH_STATEFS_OBSERVATION_SYMLINK;
        case OXIGRAPH_STATEFS_S_IFIFO: return OXIGRAPH_STATEFS_OBSERVATION_FIFO;
        case OXIGRAPH_STATEFS_S_IFBLK: return OXIGRAPH_STATEFS_OBSERVATION_BLOCK_DEVICE;
        case OXIGRAPH_STATEFS_S_IFCHR: return OXIGRAPH_STATEFS_OBSERVATION_CHARACTER_DEVICE;
        case OXIGRAPH_STATEFS_S_IFSOCK: return OXIGRAPH_STATEFS_OBSERVATION_SOCKET;
        default: return OXIGRAPH_STATEFS_OBSERVATION_OTHER;
    }
}

STATEFS_ALWAYS_INLINE int statefs_observe_statx(
    struct oxigraph_containment_statefs_observation_v1 *observation,
    uint32_t role, const uint8_t *name, uint32_t name_length,
    uint64_t filesystem_magic, uint64_t content_length) {
    uint32_t index;
    if ((statefs_workspace.statx.mask &
         (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                    OXIGRAPH_STATEFS_STATX_MNT_ID)) !=
        (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                   OXIGRAPH_STATEFS_STATX_MNT_ID)) return 0;
    statefs_zero((uint8_t *)observation, 384U);
    observation->struct_size = 384U;
    observation->kind = statefs_kind_from_mode((uint32_t)statefs_workspace.statx.mode);
    observation->role = role;
    observation->name_length = name_length;
    observation->device_major = (uint64_t)statefs_workspace.statx.device_major;
    observation->device_minor = (uint64_t)statefs_workspace.statx.device_minor;
    observation->inode = statefs_workspace.statx.inode;
    observation->mount_id = statefs_workspace.statx.mount_id;
    observation->byte_length = statefs_workspace.statx.byte_length;
    observation->link_count = (uint64_t)statefs_workspace.statx.link_count;
    observation->mode = (uint32_t)statefs_workspace.statx.mode;
    observation->owner_uid = statefs_workspace.statx.owner_uid;
    observation->owner_gid = statefs_workspace.statx.owner_gid;
    observation->statx_mask = statefs_workspace.statx.mask;
    observation->filesystem_magic = filesystem_magic;
    observation->content_length = content_length;
    for (index = 0U; index < name_length; index += 1U) observation->name[index] = name[index];
    return 1;
}

STATEFS_ALWAYS_INLINE void statefs_observe_absent(
    struct oxigraph_containment_statefs_observation_v1 *observation,
    uint32_t role, const uint8_t *name, uint32_t name_length) {
    uint32_t index;
    statefs_zero((uint8_t *)observation, 384U);
    observation->struct_size = 384U;
    observation->kind = OXIGRAPH_STATEFS_OBSERVATION_ABSENT;
    observation->role = role;
    observation->name_length = name_length;
    for (index = 0U; index < name_length; index += 1U) observation->name[index] = name[index];
}

STATEFS_ALWAYS_INLINE int statefs_statx_is_directory(uint32_t uid, uint32_t gid,
                                                      uint64_t mount_id,
                                                      uint64_t device_major,
                                                      uint64_t device_minor,
                                                      uint64_t inode) {
    return (statefs_workspace.statx.mask &
            (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS | OXIGRAPH_STATEFS_STATX_MNT_ID)) ==
               (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS | OXIGRAPH_STATEFS_STATX_MNT_ID) &&
           ((uint32_t)statefs_workspace.statx.mode &
            (uint32_t)OXIGRAPH_STATEFS_S_IFMT) == (uint32_t)OXIGRAPH_STATEFS_S_IFDIR &&
           ((uint32_t)statefs_workspace.statx.mode & 07777U) == 0700U &&
           statefs_workspace.statx.owner_uid == uid &&
           statefs_workspace.statx.owner_gid == gid &&
           statefs_workspace.statx.link_count >= 2U &&
           statefs_workspace.statx.mount_id == mount_id &&
           (uint64_t)statefs_workspace.statx.device_major == device_major &&
           (uint64_t)statefs_workspace.statx.device_minor == device_minor &&
           statefs_workspace.statx.inode == inode;
}

STATEFS_ALWAYS_INLINE int statefs_statx_is_local_directory(uint32_t uid, uint32_t gid,
                                                            uint64_t mount_id,
                                                            uint64_t device_major,
                                                            uint64_t device_minor) {
    return (statefs_workspace.statx.mask &
            (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS | OXIGRAPH_STATEFS_STATX_MNT_ID)) ==
               (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS | OXIGRAPH_STATEFS_STATX_MNT_ID) &&
           ((uint32_t)statefs_workspace.statx.mode &
            (uint32_t)OXIGRAPH_STATEFS_S_IFMT) == (uint32_t)OXIGRAPH_STATEFS_S_IFDIR &&
           ((uint32_t)statefs_workspace.statx.mode & 07777U) == 0700U &&
           statefs_workspace.statx.owner_uid == uid &&
           statefs_workspace.statx.owner_gid == gid &&
           statefs_workspace.statx.link_count >= 2U &&
           statefs_workspace.statx.mount_id == mount_id &&
           (uint64_t)statefs_workspace.statx.device_major == device_major &&
           (uint64_t)statefs_workspace.statx.device_minor == device_minor &&
           statefs_workspace.statx.inode != 0U;
}

STATEFS_ALWAYS_INLINE int statefs_statx_is_regular(uint32_t uid, uint32_t gid,
                                                    uint64_t mount_id,
                                                    uint64_t device_major,
                                                    uint64_t device_minor) {
    return (statefs_workspace.statx.mask &
            (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS | OXIGRAPH_STATEFS_STATX_MNT_ID)) ==
               (uint32_t)(OXIGRAPH_STATEFS_STATX_BASIC_STATS | OXIGRAPH_STATEFS_STATX_MNT_ID) &&
           ((uint32_t)statefs_workspace.statx.mode &
            (uint32_t)OXIGRAPH_STATEFS_S_IFMT) == (uint32_t)OXIGRAPH_STATEFS_S_IFREG &&
           ((uint32_t)statefs_workspace.statx.mode & 07777U) == 0600U &&
           statefs_workspace.statx.owner_uid == uid &&
           statefs_workspace.statx.owner_gid == gid &&
           statefs_workspace.statx.link_count == 1U &&
           statefs_workspace.statx.mount_id == mount_id &&
           (uint64_t)statefs_workspace.statx.device_major == device_major &&
           (uint64_t)statefs_workspace.statx.device_minor == device_minor &&
           statefs_workspace.statx.inode != 0U;
}

STATEFS_ALWAYS_INLINE void statefs_complete_step(
    struct oxigraph_containment_statefs_result_v1 *result, uint32_t step) {
    result->last_completed_step = step;
    result->completed_step_count += 1U;
}

STATEFS_ALWAYS_INLINE void statefs_fail(
    struct oxigraph_containment_statefs_result_v1 *result, uint32_t status,
    uint32_t effect, uint32_t step, int32_t error) {
    result->status = status;
    result->effect_class = effect;
    result->failed_step = step;
    result->errno_value = error;
}

#ifdef OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS
STATEFS_ALWAYS_INLINE int statefs_fault_selector_is_valid(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    uint32_t step;
    uint32_t operation = request->operation;
    uint32_t inventory_kind = request->inventory_kind;
    uint32_t selector = request->test_fault_selector;
    if (selector == 0U) return 1;
    if (selector > 68U) return 0;
    step = (selector + 1U) / 2U;
    if (operation == OXIGRAPH_STATEFS_OPERATION_LOCK_EX_NB)
        return step == 1U || step == 2U || step == 4U ? 2 : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_INVENTORY &&
        inventory_kind == OXIGRAPH_STATEFS_INVENTORY_DIRECTORY) {
        if (request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT)
            return step == 1U || step == 2U || step == 5U || step == 6U ||
                           step == 24U
                       ? 2
                       : 0;
        return step == 1U || step == 2U || step == 5U || step == 6U ||
                       step == 32U
                   ? 2
                   : 0;
    }
    if (operation == OXIGRAPH_STATEFS_OPERATION_INVENTORY)
        return step == 1U || step == 2U || step == 5U || step == 7U ||
                       step == 24U
                   ? 2
                   : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_PERSIST_NOREPLACE)
        return step == 1U || step == 2U || step == 8U || step == 33U ||
               step == 9U || step == 25U || step == 10U || step == 26U ||
               step == 11U || step == 27U || step == 12U || step == 20U ||
                       step == 28U || step == 21U || step == 29U
                   ? 2
                   : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_MKDIR_SYNC)
        return step == 1U || step == 2U || step == 13U || step == 33U ||
                       step == 5U || step == 14U || step == 30U || step == 20U ||
                       step == 21U
                   ? 2
                   : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_MOVE_NOREPLACE_SYNC)
        return step == 1U || step == 2U || step == 3U || step == 15U ||
                       step == 16U || step == 17U || step == 18U || step == 22U ||
                       step == 21U
                   ? 2
                   : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_MOVE_SYNC_REOBSERVE)
        return step == 1U || step == 2U || step == 3U || step == 15U ||
                       step == 31U || step == 17U || step == 18U || step == 22U ||
                       step == 21U
                   ? 2
                   : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_TEMP_CLEANUP)
        return step == 1U || step == 2U || step == 15U || step == 19U ||
                       step == 20U || step == 23U
                   ? 2
                   : 0;
    if (operation == OXIGRAPH_STATEFS_OPERATION_RELEASE_DIRECTORY)
        return step == 1U || step == 2U || step == 34U ? 2 : 0;
    return 0;
}

STATEFS_ALWAYS_INLINE int statefs_fault_selector_is_pending(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return statefs_fault_selector_is_valid(request) == 2;
}

STATEFS_ALWAYS_INLINE int statefs_inject(
    const struct oxigraph_containment_statefs_request_v1 *request,
    struct oxigraph_containment_statefs_result_v1 *result,
    uint32_t step, uint32_t effect, uint32_t after) {
    uint32_t selector = after != 0U ? 2U * step : 2U * step - 1U;
    if (request->test_fault_selector != selector) return 0;
    result->status = OXIGRAPH_STATEFS_STATUS_FAULT_INJECTED;
    result->effect_class = effect;
    result->failed_step = after != 0U ? OXIGRAPH_STATEFS_STEP_NONE : step;
    result->errno_value = OXIGRAPH_STATEFS_EIO;
    return 1;
}
#else
#define statefs_inject(request, result, step, effect, after) 0
#define statefs_fault_selector_is_pending(request) 0
#endif

STATEFS_ALWAYS_INLINE int statefs_empty_fd_b(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return request->dirfd_b == 0 && request->dirfd_b_role == 0U &&
           request->expected_mount_id_b == 0U &&
           request->expected_device_major_b == 0U &&
           request->expected_device_minor_b == 0U &&
           request->expected_inode_b == 0U &&
           request->expected_filesystem_magic_b == 0U;
}

STATEFS_ALWAYS_INLINE int statefs_present_fd_a(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return request->dirfd_a >= 0 && request->dirfd_a_role >= 1U &&
           request->dirfd_a_role <= 12U && request->expected_mount_id_a != 0U &&
           request->expected_inode_a != 0U &&
           request->expected_filesystem_magic_a != 0U;
}

STATEFS_ALWAYS_INLINE int statefs_present_fd_b(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return request->dirfd_b >= 0 && request->dirfd_b_role >= 1U &&
           request->dirfd_b_role <= 12U && request->expected_mount_id_b != 0U &&
           request->expected_inode_b != 0U &&
           request->expected_filesystem_magic_b != 0U;
}

STATEFS_ALWAYS_INLINE int statefs_empty_name_a(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return request->name_a_length == 0U && request->name_a_address == 0U;
}

STATEFS_ALWAYS_INLINE int statefs_empty_name_b(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return request->name_b_length == 0U && request->name_b_address == 0U;
}

STATEFS_ALWAYS_INLINE int statefs_empty_input(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    return request->input_length == 0U && request->input_address == 0U;
}

STATEFS_ALWAYS_INLINE int statefs_request_shape_is_valid(
    const struct oxigraph_containment_statefs_request_v1 *request) {
    int common_a;
    if (request->abi_version != 1U || request->struct_size != 192U) return 0;
    if (request->operation < 1U || request->operation > 8U) return 0;
#ifndef OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS
    if (request->test_fault_selector != 0U) return 0;
#else
    if (!statefs_fault_selector_is_valid(request)) return 0;
#endif
    common_a = statefs_present_fd_a(request);
    if (!common_a) return 0;
    if (request->operation == OXIGRAPH_STATEFS_OPERATION_LOCK_EX_NB) {
        return request->dirfd_a_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
               statefs_empty_fd_b(request) &&
               request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_NONE &&
               request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
               statefs_empty_name_a(request) && statefs_empty_name_b(request) &&
               statefs_empty_input(request) && request->observation_capacity == 1U &&
               request->output_capacity == 0U;
    }
    if (request->operation == OXIGRAPH_STATEFS_OPERATION_INVENTORY) {
        if (!statefs_empty_fd_b(request) || !statefs_empty_name_b(request) ||
            !statefs_empty_input(request)) return 0;
        if (request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_DIRECTORY) {
            if (request->observation_capacity != 257U ||
                request->output_capacity != 32768U ||
                request->inventory_directory_role < 1U ||
                request->inventory_directory_role > 12U) return 0;
            if (request->dirfd_a_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
                request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT)
                return statefs_empty_name_a(request);
            return request->inventory_directory_role != OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
                   !statefs_empty_name_a(request);
        }
        return request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_REGULAR_FILE &&
               request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
               !statefs_empty_name_a(request) &&
               request->observation_capacity == 1U &&
               request->output_capacity == 98304U;
    }
    if (request->operation == OXIGRAPH_STATEFS_OPERATION_PERSIST_NOREPLACE) {
        return statefs_empty_fd_b(request) &&
               request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_NONE &&
               request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
               !statefs_empty_name_a(request) && !statefs_empty_name_b(request) &&
               request->input_length >= 1U && request->input_length <= 98304U &&
               request->observation_capacity == 1U &&
               request->output_capacity == 98304U;
    }
    if (request->operation == OXIGRAPH_STATEFS_OPERATION_MKDIR_SYNC) {
        return statefs_empty_fd_b(request) &&
               request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_NONE &&
               request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
               !statefs_empty_name_a(request) && statefs_empty_name_b(request) &&
               statefs_empty_input(request) && request->observation_capacity == 1U &&
               request->output_capacity == 0U;
    }
    if (request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_NOREPLACE_SYNC ||
        request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_SYNC_REOBSERVE) {
        return statefs_present_fd_b(request) && request->dirfd_a != request->dirfd_b &&
               request->dirfd_a_role != request->dirfd_b_role &&
               request->expected_mount_id_a == request->expected_mount_id_b &&
               request->expected_device_major_a == request->expected_device_major_b &&
               request->expected_device_minor_a == request->expected_device_minor_b &&
               request->expected_filesystem_magic_a == request->expected_filesystem_magic_b &&
               request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_NONE &&
               request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
               !statefs_empty_name_a(request) && !statefs_empty_name_b(request) &&
               statefs_empty_input(request) && request->observation_capacity == 2U &&
               request->output_capacity == 0U;
    }
    if (request->operation == OXIGRAPH_STATEFS_OPERATION_TEMP_CLEANUP) {
        return statefs_empty_fd_b(request) &&
               request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_NONE &&
               request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
               !statefs_empty_name_a(request) && statefs_empty_name_b(request) &&
               statefs_empty_input(request) && request->observation_capacity == 1U &&
               request->output_capacity == 0U;
    }
    return request->operation == OXIGRAPH_STATEFS_OPERATION_RELEASE_DIRECTORY &&
           request->dirfd_a_role != OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
           statefs_empty_fd_b(request) &&
           request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_NONE &&
           request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_NONE &&
           statefs_empty_name_a(request) && statefs_empty_name_b(request) &&
           statefs_empty_input(request) && request->observation_capacity == 0U &&
           request->output_capacity == 0U;
}

STATEFS_ALWAYS_INLINE int statefs_buffers_are_valid(
    const struct oxigraph_containment_statefs_request_v1 *request,
    const struct oxigraph_containment_statefs_result_v1 *result) {
    uint64_t request_address = (uint64_t)(uintptr_t)request;
    uint64_t result_address = (uint64_t)(uintptr_t)result;
    uint64_t observation_length = (uint64_t)request->observation_capacity * 384U;
    uint64_t name_a_length = (uint64_t)request->name_a_length;
    uint64_t name_b_length = (uint64_t)request->name_b_length;
    uint64_t output_length = (uint64_t)request->output_capacity;
    if (!statefs_range_is_valid(request->name_a_address, name_a_length, 1U) ||
        !statefs_range_is_valid(request->name_b_address, name_b_length, 1U) ||
        !statefs_range_is_valid(request->input_address, request->input_length, 1U) ||
        !statefs_range_is_valid(request->observations_address, observation_length, 8U) ||
        !statefs_range_is_valid(request->output_address, output_length, 1U)) return 0;
#define STATEFS_OVERLAP(left_address, left_length, right_address, right_length) \
    if (statefs_ranges_overlap((left_address), (left_length),                 \
                               (right_address), (right_length))) return 0
    STATEFS_OVERLAP(request_address, 192U, result_address, 64U);
    STATEFS_OVERLAP(request_address, 192U, request->name_a_address, name_a_length);
    STATEFS_OVERLAP(request_address, 192U, request->name_b_address, name_b_length);
    STATEFS_OVERLAP(request_address, 192U, request->input_address, request->input_length);
    STATEFS_OVERLAP(request_address, 192U, request->observations_address, observation_length);
    STATEFS_OVERLAP(request_address, 192U, request->output_address, output_length);
    STATEFS_OVERLAP(result_address, 64U, request->name_a_address, name_a_length);
    STATEFS_OVERLAP(result_address, 64U, request->name_b_address, name_b_length);
    STATEFS_OVERLAP(result_address, 64U, request->input_address, request->input_length);
    STATEFS_OVERLAP(result_address, 64U, request->observations_address, observation_length);
    STATEFS_OVERLAP(result_address, 64U, request->output_address, output_length);
    STATEFS_OVERLAP(request->name_a_address, name_a_length,
                    request->name_b_address, name_b_length);
    STATEFS_OVERLAP(request->name_a_address, name_a_length,
                    request->input_address, request->input_length);
    STATEFS_OVERLAP(request->name_a_address, name_a_length,
                    request->observations_address, observation_length);
    STATEFS_OVERLAP(request->name_a_address, name_a_length,
                    request->output_address, output_length);
    STATEFS_OVERLAP(request->name_b_address, name_b_length,
                    request->input_address, request->input_length);
    STATEFS_OVERLAP(request->name_b_address, name_b_length,
                    request->observations_address, observation_length);
    STATEFS_OVERLAP(request->name_b_address, name_b_length,
                    request->output_address, output_length);
    STATEFS_OVERLAP(request->input_address, request->input_length,
                    request->observations_address, observation_length);
    STATEFS_OVERLAP(request->input_address, request->input_length,
                    request->output_address, output_length);
    STATEFS_OVERLAP(request->observations_address, observation_length,
                    request->output_address, output_length);
#undef STATEFS_OVERLAP
    return 1;
}

STATEFS_ALWAYS_INLINE uint32_t statefs_created_directory_role(
    uint32_t parent_role, const uint8_t *name, uint32_t name_length) {
    if (parent_role == OXIGRAPH_STATEFS_ROLE_LIFETIMES)
        return OXIGRAPH_STATEFS_ROLE_LIFETIME_SEGMENT;
    if (parent_role == OXIGRAPH_STATEFS_ROLE_STAGING ||
        parent_role == OXIGRAPH_STATEFS_ROLE_ACTIVE ||
        parent_role == OXIGRAPH_STATEFS_ROLE_CLOSED ||
        parent_role == OXIGRAPH_STATEFS_ROLE_RECOVERED ||
        parent_role == OXIGRAPH_STATEFS_ROLE_QUARANTINED)
        return OXIGRAPH_STATEFS_ROLE_GENERATION;
    if (parent_role == OXIGRAPH_STATEFS_ROLE_GENERATION) {
        if (name_length == 6U && name[0] == (uint8_t)'n' &&
            name[1] == (uint8_t)'o' && name[2] == (uint8_t)'r' &&
            name[3] == (uint8_t)'m' && name[4] == (uint8_t)'a' &&
            name[5] == (uint8_t)'l')
            return OXIGRAPH_STATEFS_ROLE_NORMAL_JOURNAL;
        if (name_length == 8U && name[0] == (uint8_t)'r' &&
            name[1] == (uint8_t)'e' && name[2] == (uint8_t)'c' &&
            name[3] == (uint8_t)'o' && name[4] == (uint8_t)'v' &&
            name[5] == (uint8_t)'e' && name[6] == (uint8_t)'r' &&
            name[7] == (uint8_t)'y')
            return OXIGRAPH_STATEFS_ROLE_RECOVERY_JOURNAL;
    }
    if (parent_role == OXIGRAPH_STATEFS_ROLE_RECOVERY_JOURNAL)
        return OXIGRAPH_STATEFS_ROLE_RECOVERY_ATTEMPT;
    return OXIGRAPH_STATEFS_ROLE_NONE;
}

STATEFS_ALWAYS_INLINE int statefs_observation_matches_statx(
    const struct oxigraph_containment_statefs_observation_v1 *observation) {
    return observation->device_major == (uint64_t)statefs_workspace.statx.device_major &&
           observation->device_minor == (uint64_t)statefs_workspace.statx.device_minor &&
           observation->inode == statefs_workspace.statx.inode &&
           observation->mount_id == statefs_workspace.statx.mount_id &&
           observation->byte_length == statefs_workspace.statx.byte_length &&
           observation->link_count == (uint64_t)statefs_workspace.statx.link_count &&
           observation->mode == (uint32_t)statefs_workspace.statx.mode &&
           observation->owner_uid == statefs_workspace.statx.owner_uid &&
           observation->owner_gid == statefs_workspace.statx.owner_gid;
}

enum statefs_phase_v1 {
    STATEFS_PHASE_FD_A_GETFL = 1,
    STATEFS_PHASE_FD_A_GETFL_RESULT,
    STATEFS_PHASE_FD_A_GETFD_RESULT,
    STATEFS_PHASE_FD_A_STATX_RESULT,
    STATEFS_PHASE_FD_A_FSTATFS_RESULT,
    STATEFS_PHASE_FD_B_GETFL,
    STATEFS_PHASE_FD_B_GETFL_RESULT,
    STATEFS_PHASE_FD_B_GETFD_RESULT,
    STATEFS_PHASE_FD_B_STATX_RESULT,
    STATEFS_PHASE_FD_B_FSTATFS_RESULT,
    STATEFS_PHASE_OPERATION,
    STATEFS_PHASE_LOCK_RESULT,
    STATEFS_PHASE_DIRECTORY_OPEN_RESULT,
    STATEFS_PHASE_DIRECTORY_STATX_RESULT,
    STATEFS_PHASE_DIRECTORY_FSTATFS_RESULT,
    STATEFS_PHASE_DIRECTORY_ENUM_RESULT,
    STATEFS_PHASE_DIRECTORY_PARSE,
    STATEFS_PHASE_DIRECTORY_ENTRY_STATX_RESULT,
    STATEFS_PHASE_DIRECTORY_CLOSE_RESULT,
    STATEFS_PHASE_REGULAR_INITIAL_STATX_RESULT,
    STATEFS_PHASE_REGULAR_OPEN_RESULT,
    STATEFS_PHASE_REGULAR_STATX_RESULT,
    STATEFS_PHASE_REGULAR_FSTATFS_RESULT,
    STATEFS_PHASE_REGULAR_READ_RESULT,
    STATEFS_PHASE_REGULAR_EXTRA_READ_RESULT,
    STATEFS_PHASE_REGULAR_CLOSE_RESULT,
    STATEFS_PHASE_PERSIST_CREATE_RESULT,
    STATEFS_PHASE_PERSIST_CREATED_STATX_RESULT,
    STATEFS_PHASE_PERSIST_CREATED_FSTATFS_RESULT,
    STATEFS_PHASE_PERSIST_WRITE_RESULT,
    STATEFS_PHASE_PERSIST_READER_OPEN_RESULT,
    STATEFS_PHASE_PERSIST_READER_READ_RESULT,
    STATEFS_PHASE_PERSIST_READER_EXTRA_RESULT,
    STATEFS_PHASE_PERSIST_READER_CLOSE_RESULT,
    STATEFS_PHASE_PERSIST_WRITER_SYNC_RESULT,
    STATEFS_PHASE_PERSIST_WRITER_CLOSE_RESULT,
    STATEFS_PHASE_PERSIST_RENAME_RESULT,
    STATEFS_PHASE_PERSIST_PARENT_SYNC_RESULT,
    STATEFS_PHASE_PERSIST_FINAL_OPEN_RESULT,
    STATEFS_PHASE_PERSIST_FINAL_STATX_RESULT,
    STATEFS_PHASE_PERSIST_FINAL_FSTATFS_RESULT,
    STATEFS_PHASE_PERSIST_FINAL_READ_RESULT,
    STATEFS_PHASE_PERSIST_FINAL_EXTRA_RESULT,
    STATEFS_PHASE_PERSIST_FINAL_CLOSE_RESULT,
    STATEFS_PHASE_MKDIR_CREATE_RESULT,
    STATEFS_PHASE_MKDIR_STATX_RESULT,
    STATEFS_PHASE_MKDIR_OPEN_RESULT,
    STATEFS_PHASE_MKDIR_OPEN_STATX_RESULT,
    STATEFS_PHASE_MKDIR_OPEN_FSTATFS_RESULT,
    STATEFS_PHASE_MKDIR_SYNC_RESULT,
    STATEFS_PHASE_MKDIR_CLOSE_RESULT,
    STATEFS_PHASE_MKDIR_PARENT_SYNC_RESULT,
    STATEFS_PHASE_MKDIR_REOBSERVE_RESULT,
    STATEFS_PHASE_MOVE_SOURCE_RESULT,
    STATEFS_PHASE_MOVE_DESTINATION_ABSENCE_RESULT,
    STATEFS_PHASE_MOVE_RENAME_RESULT,
    STATEFS_PHASE_MOVE_SOURCE_SYNC_RESULT,
    STATEFS_PHASE_MOVE_DESTINATION_SYNC_RESULT,
    STATEFS_PHASE_MOVE_SOURCE_ABSENCE_RESULT,
    STATEFS_PHASE_MOVE_DESTINATION_RESULT,
    STATEFS_PHASE_SYNC_SOURCE_INITIAL_RESULT,
    STATEFS_PHASE_SYNC_DESTINATION_INITIAL_RESULT,
    STATEFS_PHASE_SYNC_SOURCE_SYNC_RESULT,
    STATEFS_PHASE_SYNC_DESTINATION_SYNC_RESULT,
    STATEFS_PHASE_SYNC_SOURCE_ABSENCE_RESULT,
    STATEFS_PHASE_SYNC_DESTINATION_RESULT,
    STATEFS_PHASE_CLEANUP_SOURCE_RESULT,
    STATEFS_PHASE_CLEANUP_UNLINK_RESULT,
    STATEFS_PHASE_CLEANUP_PARENT_SYNC_RESULT,
    STATEFS_PHASE_CLEANUP_ABSENCE_RESULT,
    STATEFS_PHASE_RELEASE_RESULT,
    STATEFS_PHASE_FAILURE_CLOSE_RESULT
};

__attribute__((optimize("no-omit-frame-pointer", "no-jump-tables",
                        "no-reorder-blocks-and-partition", "align-jumps=1",
                        "align-labels=1", "align-loops=1", "align-functions=1")))
int32_t oxigraph_containment_statefs_execute_v1(
    const struct oxigraph_containment_statefs_request_v1 *request,
    struct oxigraph_containment_statefs_result_v1 *result) {
    struct oxigraph_containment_statefs_observation_v1 *observations;
    uint8_t *output;
    const uint8_t *input;
    uint64_t request_address;
    uint64_t result_address;
    uint64_t offset = 0U;
    uint64_t expected_length = 0U;
    uint64_t saved_inode = 0U;
    uint64_t saved_byte_length = 0U;
    uint64_t saved_link_count = 0U;
    uint32_t saved_mode = 0U;
    uint32_t saved_uid = 0U;
    uint32_t saved_gid = 0U;
    uint32_t phase;
    uint32_t syscall_number = 0U;
    uint32_t operation_effect;
    uint32_t observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
    uint32_t observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
    uint32_t observation_failure_step = OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED;
    uint32_t directory_count = 0U;
    uint32_t directory_offset = 0U;
    uint32_t directory_bytes = 0U;
    uint32_t current_name_length = 0U;
    uint32_t current_observation = 0U;
    uint32_t retry_count = 0U;
    uint32_t created_role = 0U;
    uint32_t failure_close_slot = 0U;
    int32_t internal_fd_0 = -1;
    int32_t internal_fd_1 = -1;
    int32_t internal_fd_2 = -1;
    int32_t directory_fd = -1;
    long argument_1 = 0L;
    long argument_2 = 0L;
    long argument_3 = 0L;
    long argument_4 = 0L;
    long argument_5 = 0L;
    long syscall_result = 0L;

    if (request == NULL || result == NULL) return -1;
    request_address = (uint64_t)(uintptr_t)request;
    result_address = (uint64_t)(uintptr_t)result;
    if ((request_address & 7U) != 0U || (result_address & 7U) != 0U ||
        request_address > (uint64_t)UINTPTR_MAX - 192U ||
        result_address > (uint64_t)UINTPTR_MAX - 64U ||
        statefs_ranges_overlap(request_address, 192U, result_address, 64U)) return -1;

    statefs_zero((uint8_t *)result, 64U);
    result->abi_version = 1U;
    result->struct_size = 64U;
    result->operation = request->operation;
    result->status = OXIGRAPH_STATEFS_STATUS_REJECTED;
    result->effect_class = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
    result->returned_directory_fd = -1;

    operation_effect = request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_SYNC_REOBSERVE
                           ? OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN
                           : OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT;
    if (!statefs_request_shape_is_valid(request) ||
        !statefs_buffers_are_valid(request, result)) {
        result->failed_step = OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED;
        return 0;
    }
    if (request->name_a_length != 0U &&
        !statefs_name_is_valid((const uint8_t *)(uintptr_t)request->name_a_address,
                               request->name_a_length)) {
        result->failed_step = OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED;
        return 0;
    }
    if (request->name_b_length != 0U &&
        !statefs_name_is_valid((const uint8_t *)(uintptr_t)request->name_b_address,
                               request->name_b_length)) {
        result->failed_step = OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED;
        return 0;
    }
    observations = (struct oxigraph_containment_statefs_observation_v1 *)(uintptr_t)
        request->observations_address;
    output = (uint8_t *)(uintptr_t)request->output_address;
    input = (const uint8_t *)(uintptr_t)request->input_address;
    if (request->name_a_length != 0U)
        statefs_copy_name(statefs_workspace.name_a,
                          (const uint8_t *)(uintptr_t)request->name_a_address,
                          request->name_a_length);
    else
        statefs_workspace.name_a[0] = 0U;
    if (request->name_b_length != 0U)
        statefs_copy_name(statefs_workspace.name_b,
                          (const uint8_t *)(uintptr_t)request->name_b_address,
                          request->name_b_length);
    else
        statefs_workspace.name_b[0] = 0U;
    statefs_zero((uint8_t *)observations,
                 (uint64_t)request->observation_capacity * 384U);
    if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED,
                       operation_effect, 0U)) goto statefs_cleanup_begin;
    statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED);
    if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED,
                       operation_effect, 1U)) goto statefs_cleanup_begin;

    if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED,
                       operation_effect, 0U)) goto statefs_cleanup_begin;
    phase = STATEFS_PHASE_FD_A_GETFL;

statefs_loop:
    switch (phase) {
        case STATEFS_PHASE_FD_A_GETFL:
            syscall_number = STATEFS_SYSCALL_fcntl;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)OXIGRAPH_STATEFS_F_GETFL;
            argument_3 = 0L;
            phase = STATEFS_PHASE_FD_A_GETFL_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_A_GETFL_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_O_ACCMODE) !=
                 (uint32_t)OXIGRAPH_STATEFS_O_RDONLY) ||
                (((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_O_PATH) != 0U)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            syscall_number = STATEFS_SYSCALL_fcntl;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)OXIGRAPH_STATEFS_F_GETFD;
            argument_3 = 0L;
            phase = STATEFS_PHASE_FD_A_GETFD_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_A_GETFD_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((request->dirfd_a_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
                 (((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_FD_CLOEXEC) != 0U)) ||
                (request->dirfd_a_role != OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
                 (((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_FD_CLOEXEC) == 0U))) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_FD_A_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_A_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_directory(request->expected_owner_uid,
                                             request->expected_owner_gid,
                                             request->expected_mount_id_a,
                                             request->expected_device_major_a,
                                             request->expected_device_minor_a,
                                             request->expected_inode_a)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            if (request->observation_capacity != 0U) {
                observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
                observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
                observation_failure_step = OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED;
                if (!statefs_observe_statx(&observations[0], request->dirfd_a_role,
                                           NULL, 0U,
                                           request->expected_filesystem_magic_a, 0U))
                    goto statefs_observation_failure;
            }
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_FD_A_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_A_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                request->expected_filesystem_magic_a) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED);
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_LOCK_EX_NB)
                result->observation_count = 1U;
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED,
                               operation_effect, 1U)) goto statefs_cleanup_begin;
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_NOREPLACE_SYNC ||
                request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_SYNC_REOBSERVE) {
                if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED,
                                   operation_effect, 0U)) goto statefs_cleanup_begin;
                phase = STATEFS_PHASE_FD_B_GETFL;
            } else {
                phase = STATEFS_PHASE_OPERATION;
            }
            goto statefs_loop;

        case STATEFS_PHASE_FD_B_GETFL:
            syscall_number = STATEFS_SYSCALL_fcntl;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)OXIGRAPH_STATEFS_F_GETFL;
            argument_3 = 0L;
            phase = STATEFS_PHASE_FD_B_GETFL_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_B_GETFL_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_O_ACCMODE) !=
                 (uint32_t)OXIGRAPH_STATEFS_O_RDONLY) ||
                (((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_O_PATH) != 0U)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            syscall_number = STATEFS_SYSCALL_fcntl;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)OXIGRAPH_STATEFS_F_GETFD;
            argument_3 = 0L;
            phase = STATEFS_PHASE_FD_B_GETFD_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_B_GETFD_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (((uint32_t)syscall_result & (uint32_t)OXIGRAPH_STATEFS_FD_CLOEXEC) == 0U) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_FD_B_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_B_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_directory(request->expected_owner_uid,
                                             request->expected_owner_gid,
                                             request->expected_mount_id_b,
                                             request->expected_device_major_b,
                                             request->expected_device_minor_b,
                                             request->expected_inode_b)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED;
            if (!statefs_observe_statx(&observations[1], request->dirfd_b_role,
                                       NULL, 0U,
                                       request->expected_filesystem_magic_b, 0U))
                goto statefs_observation_failure;
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_FD_B_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_FD_B_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             operation_effect, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                    request->expected_filesystem_magic_b ||
                (request->expected_mount_id_a == request->expected_mount_id_b &&
                 request->expected_device_major_a == request->expected_device_major_b &&
                 request->expected_device_minor_a == request->expected_device_minor_b &&
                 request->expected_inode_a == request->expected_inode_b)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED,
                               operation_effect, 1U)) goto statefs_cleanup_begin;
            phase = STATEFS_PHASE_OPERATION;
            goto statefs_loop;

        case STATEFS_PHASE_OPERATION:
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_LOCK_EX_NB) {
                if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_LOCK_ACQUIRED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                syscall_number = STATEFS_SYSCALL_flock;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(OXIGRAPH_STATEFS_LOCK_EX | OXIGRAPH_STATEFS_LOCK_NB);
                phase = STATEFS_PHASE_LOCK_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_INVENTORY &&
                request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_DIRECTORY) {
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                if (request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT) {
                    statefs_workspace.name_b[0] = (uint8_t)'.';
                    statefs_workspace.name_b[1] = 0U;
                    argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
                } else {
                    argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                }
                syscall_number = STATEFS_SYSCALL_openat;
                argument_1 = (long)request->dirfd_a;
                argument_3 = (long)(OXIGRAPH_STATEFS_O_RDONLY |
                                    OXIGRAPH_STATEFS_O_DIRECTORY |
                                    OXIGRAPH_STATEFS_O_CLOEXEC |
                                    OXIGRAPH_STATEFS_O_NOFOLLOW);
                argument_4 = 0L;
                phase = STATEFS_PHASE_DIRECTORY_OPEN_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_INVENTORY &&
                request->inventory_kind == OXIGRAPH_STATEFS_INVENTORY_REGULAR_FILE) {
                statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
                syscall_number = STATEFS_SYSCALL_statx;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
                argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                    OXIGRAPH_STATEFS_STATX_MNT_ID);
                argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
                phase = STATEFS_PHASE_REGULAR_INITIAL_STATX_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_PERSIST_NOREPLACE) {
                if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_TEMP_CREATED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                syscall_number = STATEFS_SYSCALL_openat;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                argument_3 = (long)(OXIGRAPH_STATEFS_O_WRONLY |
                                    OXIGRAPH_STATEFS_O_CREAT |
                                    OXIGRAPH_STATEFS_O_EXCL |
                                    OXIGRAPH_STATEFS_O_CLOEXEC |
                                    OXIGRAPH_STATEFS_O_NOFOLLOW);
                argument_4 = 0600L;
                phase = STATEFS_PHASE_PERSIST_CREATE_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_MKDIR_SYNC) {
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_CREATED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                syscall_number = STATEFS_SYSCALL_mkdirat;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                argument_3 = 0700L;
                phase = STATEFS_PHASE_MKDIR_CREATE_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_NOREPLACE_SYNC) {
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
                syscall_number = STATEFS_SYSCALL_statx;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
                argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                    OXIGRAPH_STATEFS_STATX_MNT_ID);
                argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
                phase = STATEFS_PHASE_MOVE_SOURCE_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_MOVE_SYNC_REOBSERVE) {
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                                   OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                   0U)) goto statefs_cleanup_begin;
                statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
                syscall_number = STATEFS_SYSCALL_statx;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
                argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                    OXIGRAPH_STATEFS_STATX_MNT_ID);
                argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
                phase = STATEFS_PHASE_SYNC_SOURCE_INITIAL_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_TEMP_CLEANUP) {
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
                syscall_number = STATEFS_SYSCALL_statx;
                argument_1 = (long)request->dirfd_a;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
                argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
                argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                    OXIGRAPH_STATEFS_STATX_MNT_ID);
                argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
                phase = STATEFS_PHASE_CLEANUP_SOURCE_RESULT;
                goto statefs_issue_syscall;
            }
            if (request->operation == OXIGRAPH_STATEFS_OPERATION_RELEASE_DIRECTORY) {
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_DIRECTORY_RELEASED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                syscall_number = STATEFS_SYSCALL_close;
                argument_1 = (long)request->dirfd_a;
                phase = STATEFS_PHASE_RELEASE_RESULT;
                goto statefs_issue_syscall;
            }
            break;

        case STATEFS_PHASE_LOCK_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_LOCK_ACQUIRED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_LOCK_ACQUIRED);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_LOCK_ACQUIRED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_DIRECTORY_OPEN_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            internal_fd_0 = (int32_t)syscall_result;
            directory_fd = internal_fd_0;
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)directory_fd;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_DIRECTORY_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_DIRECTORY_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED;
            if (!statefs_observe_statx(&observations[0], request->inventory_directory_role,
                                       NULL, 0U,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            result->observation_count = 1U;
            if ((request->inventory_directory_role == OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
                 !statefs_statx_is_directory(request->expected_owner_uid,
                                             request->expected_owner_gid,
                                             request->expected_mount_id_a,
                                             request->expected_device_major_a,
                                             request->expected_device_minor_a,
                                             request->expected_inode_a)) ||
                (request->inventory_directory_role != OXIGRAPH_STATEFS_ROLE_STATE_ROOT &&
                 !statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_a,
                                                   request->expected_device_major_a,
                                                   request->expected_device_minor_a))) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)directory_fd;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_DIRECTORY_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_DIRECTORY_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            observations[0].filesystem_magic =
                (uint64_t)statefs_workspace.statfs.filesystem_magic;
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                request->expected_filesystem_magic_a) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               0U)) goto statefs_cleanup_begin;
            directory_count = 1U;
            directory_bytes = 0U;
            directory_offset = 0U;
            syscall_number = STATEFS_SYSCALL_getdents64;
            argument_1 = (long)directory_fd;
            argument_2 = (long)(uintptr_t)output;
            argument_3 = 32768L;
            phase = STATEFS_PHASE_DIRECTORY_ENUM_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_DIRECTORY_ENUM_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (syscall_result == 0L) {
                result->observation_count = directory_count;
                statefs_complete_step(result,
                                      OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED);
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   1U)) goto statefs_cleanup_begin;
                if (request->inventory_directory_role ==
                    OXIGRAPH_STATEFS_ROLE_STATE_ROOT) {
                    if (statefs_inject(request, result,
                                       OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED,
                                       OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                       0U)) goto statefs_cleanup_begin;
                    syscall_number = STATEFS_SYSCALL_close;
                    argument_1 = (long)directory_fd;
                    phase = STATEFS_PHASE_DIRECTORY_CLOSE_RESULT;
                    goto statefs_issue_syscall;
                }
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_DIRECTORY_HANDLE_TRANSFERRED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   0U)) goto statefs_cleanup_begin;
                result->returned_directory_fd = directory_fd;
                internal_fd_0 = -1;
                statefs_complete_step(result,
                                      OXIGRAPH_STATEFS_STEP_DIRECTORY_HANDLE_TRANSFERRED);
                if (statefs_inject(request, result,
                                   OXIGRAPH_STATEFS_STEP_DIRECTORY_HANDLE_TRANSFERRED,
                                   OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                   1U)) goto statefs_cleanup_begin;
                goto statefs_complete;
            }
            if (syscall_result > 32768L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED, 0);
                goto statefs_cleanup_begin;
            }
            directory_bytes = (uint32_t)syscall_result;
            directory_offset = 0U;
            phase = STATEFS_PHASE_DIRECTORY_PARSE;
            goto statefs_loop;

        case STATEFS_PHASE_DIRECTORY_PARSE:
            if (directory_offset >= directory_bytes) {
                syscall_number = STATEFS_SYSCALL_getdents64;
                argument_1 = (long)directory_fd;
                argument_2 = (long)(uintptr_t)output;
                argument_3 = 32768L;
                phase = STATEFS_PHASE_DIRECTORY_ENUM_RESULT;
                goto statefs_issue_syscall;
            } else {
                uint32_t remaining = directory_bytes - directory_offset;
                uint32_t record_length;
                uint32_t name_index;
                uint8_t *record = &output[directory_offset];
                if (remaining < 19U) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                                 OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                                 OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED, 0);
                    goto statefs_cleanup_begin;
                }
                record_length = (uint32_t)record[16] |
                                ((uint32_t)record[17] << 8U);
                if (record_length < 20U || record_length > remaining) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                                 OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                                 OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED, 0);
                    goto statefs_cleanup_begin;
                }
                current_name_length = 0U;
                for (name_index = 19U; name_index < record_length; name_index += 1U) {
                    if (record[name_index] == 0U) break;
                    if (current_name_length >= 255U || record[name_index] > 0x7fU ||
                        record[name_index] == (uint8_t)'/') {
                        statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                                     OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                                     OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED, 0);
                        goto statefs_cleanup_begin;
                    }
                    statefs_workspace.name_b[current_name_length] = record[name_index];
                    current_name_length += 1U;
                }
                if (name_index == record_length || current_name_length == 0U) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                                 OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                                 OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED, 0);
                    goto statefs_cleanup_begin;
                }
                statefs_workspace.name_b[current_name_length] = 0U;
                directory_offset += record_length;
                if ((current_name_length == 1U &&
                     statefs_workspace.name_b[0] == (uint8_t)'.') ||
                    (current_name_length == 2U &&
                     statefs_workspace.name_b[0] == (uint8_t)'.' &&
                     statefs_workspace.name_b[1] == (uint8_t)'.')) {
                    goto statefs_loop;
                }
                if (directory_count >= 257U) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_LIMIT_EXCEEDED,
                                 OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                 OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED, 0);
                    goto statefs_cleanup_begin;
                }
                current_observation = directory_count;
                statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
                syscall_number = STATEFS_SYSCALL_statx;
                argument_1 = (long)directory_fd;
                argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
                argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
                argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                    OXIGRAPH_STATEFS_STATX_MNT_ID);
                argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
                phase = STATEFS_PHASE_DIRECTORY_ENTRY_STATX_RESULT;
                goto statefs_issue_syscall;
            }

        case STATEFS_PHASE_DIRECTORY_ENTRY_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED;
            if (!statefs_observe_statx(&observations[current_observation],
                                       OXIGRAPH_STATEFS_ROLE_NONE,
                                       statefs_workspace.name_b,
                                       current_name_length,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            directory_count += 1U;
            phase = STATEFS_PHASE_DIRECTORY_PARSE;
            goto statefs_loop;

        case STATEFS_PHASE_DIRECTORY_CLOSE_RESULT:
            internal_fd_0 = -1;
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_REGULAR_INITIAL_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_ENOENT) {
                    if (statefs_inject(request, result,
                                       OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                                       OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                       0U)) goto statefs_cleanup_begin;
                    statefs_observe_absent(&observations[0], request->dirfd_a_role,
                                           statefs_workspace.name_a,
                                           request->name_a_length);
                    result->observation_count = 1U;
                    statefs_complete_step(result,
                                          OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED);
                    if (statefs_inject(request, result,
                                       OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                                       OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                       1U)) goto statefs_cleanup_begin;
                    goto statefs_complete;
                }
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED;
            if (!statefs_observe_statx(&observations[0], request->dirfd_a_role,
                                       statefs_workspace.name_a,
                                       request->name_a_length,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            if (!statefs_statx_is_regular(request->expected_owner_uid,
                                           request->expected_owner_gid,
                                           request->expected_mount_id_a,
                                           request->expected_device_major_a,
                                           request->expected_device_minor_a)) {
                result->observation_count = 1U;
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED, 0);
                goto statefs_cleanup_begin;
            }
            saved_inode = statefs_workspace.statx.inode;
            saved_byte_length = statefs_workspace.statx.byte_length;
            saved_link_count = (uint64_t)statefs_workspace.statx.link_count;
            saved_mode = (uint32_t)statefs_workspace.statx.mode;
            saved_uid = statefs_workspace.statx.owner_uid;
            saved_gid = statefs_workspace.statx.owner_gid;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_openat;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)(OXIGRAPH_STATEFS_O_RDONLY |
                                OXIGRAPH_STATEFS_O_CLOEXEC |
                                OXIGRAPH_STATEFS_O_NOFOLLOW |
                                OXIGRAPH_STATEFS_O_NONBLOCK);
            argument_4 = 0L;
            phase = STATEFS_PHASE_REGULAR_OPEN_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_REGULAR_OPEN_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            internal_fd_0 = (int32_t)syscall_result;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               0U)) goto statefs_cleanup_begin;
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_REGULAR_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_REGULAR_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                result->observation_count = 1U;
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED;
            if (!statefs_observe_statx(&observations[0], request->dirfd_a_role,
                                       statefs_workspace.name_a,
                                       request->name_a_length,
                                       request->expected_filesystem_magic_a,
                                       0U))
                goto statefs_observation_failure;
            if (!statefs_statx_is_regular(request->expected_owner_uid,
                                           request->expected_owner_gid,
                                           request->expected_mount_id_a,
                                           request->expected_device_major_a,
                                           request->expected_device_minor_a) ||
                statefs_workspace.statx.inode != saved_inode ||
                statefs_workspace.statx.byte_length != saved_byte_length ||
                (uint64_t)statefs_workspace.statx.link_count != saved_link_count ||
                (uint32_t)statefs_workspace.statx.mode != saved_mode ||
                statefs_workspace.statx.owner_uid != saved_uid ||
                statefs_workspace.statx.owner_gid != saved_gid) {
                result->observation_count = 1U;
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            expected_length = statefs_workspace.statx.byte_length;
            result->observation_count = 1U;
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_REGULAR_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_REGULAR_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            observations[0].filesystem_magic =
                (uint64_t)statefs_workspace.statfs.filesystem_magic;
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                request->expected_filesystem_magic_a) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            if (expected_length > 98304U) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_LIMIT_EXCEEDED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            offset = 0U;
            retry_count = 0U;
            if (expected_length == 0U) {
                syscall_number = STATEFS_SYSCALL_read;
                argument_1 = (long)internal_fd_0;
                argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
                argument_3 = 1L;
                phase = STATEFS_PHASE_REGULAR_EXTRA_READ_RESULT;
            } else {
                syscall_number = STATEFS_SYSCALL_read;
                argument_1 = (long)internal_fd_0;
                argument_2 = (long)(uintptr_t)output;
                argument_3 = (long)expected_length;
                phase = STATEFS_PHASE_REGULAR_READ_RESULT;
            }
            goto statefs_issue_syscall;

        case STATEFS_PHASE_REGULAR_READ_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                 OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                                 (int32_t)-syscall_result);
                    goto statefs_cleanup_begin;
                }
            } else if (syscall_result == 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            } else {
                uint64_t transferred = (uint64_t)syscall_result;
                if (transferred > expected_length - offset) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                                 OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED, 0);
                    goto statefs_cleanup_begin;
                }
                offset += transferred;
                result->bytes_consumed = offset;
                result->output_length = (uint32_t)offset;
                observations[0].content_length = offset;
                retry_count = 0U;
            }
            if (offset < expected_length) {
                syscall_number = STATEFS_SYSCALL_read;
                argument_1 = (long)internal_fd_0;
                argument_2 = (long)(uintptr_t)&output[offset];
                argument_3 = (long)(expected_length - offset);
                phase = STATEFS_PHASE_REGULAR_READ_RESULT;
            } else {
                syscall_number = STATEFS_SYSCALL_read;
                argument_1 = (long)internal_fd_0;
                argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
                argument_3 = 1L;
                phase = STATEFS_PHASE_REGULAR_EXTRA_READ_RESULT;
            }
            goto statefs_issue_syscall;

        case STATEFS_PHASE_REGULAR_EXTRA_READ_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                    syscall_number = STATEFS_SYSCALL_read;
                    argument_1 = (long)internal_fd_0;
                    argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
                    argument_3 = 1L;
                    phase = STATEFS_PHASE_REGULAR_EXTRA_READ_RESULT;
                    goto statefs_issue_syscall;
                }
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (syscall_result != 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_close;
            argument_1 = (long)internal_fd_0;
            phase = STATEFS_PHASE_REGULAR_CLOSE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_REGULAR_CLOSE_RESULT:
            internal_fd_0 = -1;
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_PERSIST_CREATE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_TEMP_CREATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            internal_fd_0 = (int32_t)syscall_result;
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_TEMP_CREATED);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_TEMP_CREATED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_PERSIST_CREATED_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_CREATED_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_regular(request->expected_owner_uid,
                                           request->expected_owner_gid,
                                           request->expected_mount_id_a,
                                           request->expected_device_major_a,
                                           request->expected_device_minor_a) ||
                statefs_workspace.statx.byte_length != 0U) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED;
            observation_failure_effect =
                OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED;
            if (!statefs_observe_statx(&observations[0], request->dirfd_a_role,
                                       statefs_workspace.name_a,
                                       request->name_a_length,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_PERSIST_CREATED_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_CREATED_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                request->expected_filesystem_magic_a) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            offset = 0U;
            retry_count = 0U;
            syscall_number = STATEFS_SYSCALL_write;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)input;
            argument_3 = (long)request->input_length;
            phase = STATEFS_PHASE_PERSIST_WRITE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_WRITE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                                 OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN,
                                 (int32_t)-syscall_result);
                    goto statefs_cleanup_begin;
                }
            } else if (syscall_result == 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN, 0);
                goto statefs_cleanup_begin;
            } else {
                uint64_t transferred = (uint64_t)syscall_result;
                if (transferred > request->input_length - offset) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                                 OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN, 0);
                    goto statefs_cleanup_begin;
                }
                offset += transferred;
                result->bytes_consumed = offset;
                retry_count = 0U;
            }
            if (offset < request->input_length) {
                syscall_number = STATEFS_SYSCALL_write;
                argument_1 = (long)internal_fd_0;
                argument_2 = (long)(uintptr_t)&input[offset];
                argument_3 = (long)(request->input_length - offset);
                phase = STATEFS_PHASE_PERSIST_WRITE_RESULT;
                goto statefs_issue_syscall;
            }
            observations[0].byte_length = request->input_length;
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_openat;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)(OXIGRAPH_STATEFS_O_RDONLY |
                                OXIGRAPH_STATEFS_O_CLOEXEC |
                                OXIGRAPH_STATEFS_O_NOFOLLOW |
                                OXIGRAPH_STATEFS_O_NONBLOCK);
            argument_4 = 0L;
            phase = STATEFS_PHASE_PERSIST_READER_OPEN_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_READER_OPEN_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            internal_fd_1 = (int32_t)syscall_result;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_OPENED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            offset = 0U;
            retry_count = 0U;
            syscall_number = STATEFS_SYSCALL_read;
            argument_1 = (long)internal_fd_1;
            argument_2 = (long)(uintptr_t)output;
            argument_3 = (long)request->input_length;
            phase = STATEFS_PHASE_PERSIST_READER_READ_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_READER_READ_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                                 OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK,
                                 (int32_t)-syscall_result);
                    goto statefs_cleanup_begin;
                }
            } else if (syscall_result == 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK, 0);
                goto statefs_cleanup_begin;
            } else {
                uint64_t transferred = (uint64_t)syscall_result;
                if (transferred > request->input_length - offset) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                                 OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK, 0);
                    goto statefs_cleanup_begin;
                }
                offset += transferred;
                retry_count = 0U;
            }
            if (offset < request->input_length) {
                syscall_number = STATEFS_SYSCALL_read;
                argument_1 = (long)internal_fd_1;
                argument_2 = (long)(uintptr_t)&output[offset];
                argument_3 = (long)(request->input_length - offset);
                phase = STATEFS_PHASE_PERSIST_READER_READ_RESULT;
                goto statefs_issue_syscall;
            }
            syscall_number = STATEFS_SYSCALL_read;
            argument_1 = (long)internal_fd_1;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = 1L;
            phase = STATEFS_PHASE_PERSIST_READER_EXTRA_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_READER_EXTRA_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                    syscall_number = STATEFS_SYSCALL_read;
                    argument_1 = (long)internal_fd_1;
                    argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
                    argument_3 = 1L;
                    phase = STATEFS_PHASE_PERSIST_READER_EXTRA_RESULT;
                    goto statefs_issue_syscall;
                }
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (syscall_result != 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK, 0);
                goto statefs_cleanup_begin;
            }
            for (offset = 0U; offset < request->input_length; offset += 1U) {
                if (output[offset] != input[offset]) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                                 OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK, 0);
                    goto statefs_cleanup_begin;
                }
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_close;
            argument_1 = (long)internal_fd_1;
            phase = STATEFS_PHASE_PERSIST_READER_CLOSE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_READER_CLOSE_RESULT:
            internal_fd_1 = -1;
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_CLOSED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_CLOSED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_FILE_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)internal_fd_0;
            phase = STATEFS_PHASE_PERSIST_WRITER_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_WRITER_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_TEMP_FILE_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_TEMP_FILE_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_FILE_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_WRITE_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_close;
            argument_1 = (long)internal_fd_0;
            phase = STATEFS_PHASE_PERSIST_WRITER_CLOSE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_WRITER_CLOSE_RESULT:
            internal_fd_0 = -1;
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_TEMP_WRITE_DESCRIPTOR_CLOSED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_TEMP_WRITE_DESCRIPTOR_CLOSED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_WRITE_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_FINAL_INSTALLED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_renameat2;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)request->dirfd_a;
            argument_4 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_5 = (long)OXIGRAPH_STATEFS_RENAME_NOREPLACE;
            phase = STATEFS_PHASE_PERSIST_RENAME_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_RENAME_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_FINAL_INSTALLED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_FINAL_INSTALLED);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_FINAL_INSTALLED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_a;
            phase = STATEFS_PHASE_PERSIST_PARENT_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_PARENT_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_PARENT_SYNCED);
            if (statefs_inject(request, result, OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_openat;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_3 = (long)(OXIGRAPH_STATEFS_O_RDONLY |
                                OXIGRAPH_STATEFS_O_CLOEXEC |
                                OXIGRAPH_STATEFS_O_NOFOLLOW |
                                OXIGRAPH_STATEFS_O_NONBLOCK);
            argument_4 = 0L;
            phase = STATEFS_PHASE_PERSIST_FINAL_OPEN_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_FINAL_OPEN_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            internal_fd_2 = (int32_t)syscall_result;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_OPENED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)internal_fd_2;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_PERSIST_FINAL_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_FINAL_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_regular(request->expected_owner_uid,
                                           request->expected_owner_gid,
                                           request->expected_mount_id_a,
                                           request->expected_device_major_a,
                                           request->expected_device_minor_a) ||
                statefs_workspace.statx.byte_length != request->input_length ||
                !statefs_observation_matches_statx(&observations[0])) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED;
            if (!statefs_observe_statx(&observations[0], request->dirfd_a_role,
                                       statefs_workspace.name_b,
                                       request->name_b_length,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)internal_fd_2;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_PERSIST_FINAL_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_FINAL_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                request->expected_filesystem_magic_a) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            offset = 0U;
            retry_count = 0U;
            syscall_number = STATEFS_SYSCALL_read;
            argument_1 = (long)internal_fd_2;
            argument_2 = (long)(uintptr_t)output;
            argument_3 = (long)request->input_length;
            phase = STATEFS_PHASE_PERSIST_FINAL_READ_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_FINAL_READ_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                                 (int32_t)-syscall_result);
                    goto statefs_cleanup_begin;
                }
            } else if (syscall_result == 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            } else {
                uint64_t transferred = (uint64_t)syscall_result;
                if (transferred > request->input_length - offset) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                    goto statefs_cleanup_begin;
                }
                offset += transferred;
                retry_count = 0U;
            }
            if (offset < request->input_length) {
                syscall_number = STATEFS_SYSCALL_read;
                argument_1 = (long)internal_fd_2;
                argument_2 = (long)(uintptr_t)&output[offset];
                argument_3 = (long)(request->input_length - offset);
                phase = STATEFS_PHASE_PERSIST_FINAL_READ_RESULT;
                goto statefs_issue_syscall;
            }
            syscall_number = STATEFS_SYSCALL_read;
            argument_1 = (long)internal_fd_2;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = 1L;
            phase = STATEFS_PHASE_PERSIST_FINAL_EXTRA_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_FINAL_EXTRA_RESULT:
            if (statefs_raw_error(syscall_result)) {
                if (-syscall_result == OXIGRAPH_STATEFS_EINTR && retry_count < 8U) {
                    retry_count += 1U;
                    syscall_number = STATEFS_SYSCALL_read;
                    argument_1 = (long)internal_fd_2;
                    argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
                    argument_3 = 1L;
                    phase = STATEFS_PHASE_PERSIST_FINAL_EXTRA_RESULT;
                    goto statefs_issue_syscall;
                }
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (syscall_result != 0L) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            for (offset = 0U; offset < request->input_length; offset += 1U) {
                if (output[offset] != input[offset]) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                    goto statefs_cleanup_begin;
                }
            }
            result->observation_count = 1U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_close;
            argument_1 = (long)internal_fd_2;
            phase = STATEFS_PHASE_PERSIST_FINAL_CLOSE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_PERSIST_FINAL_CLOSE_RESULT:
            internal_fd_2 = -1;
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_CLOSED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_CLOSED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_MKDIR_CREATE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_CREATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_CREATED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_CREATED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_MKDIR_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            created_role = statefs_created_directory_role(
                request->dirfd_a_role, statefs_workspace.name_a,
                request->name_a_length);
            if (created_role == OXIGRAPH_STATEFS_ROLE_NONE ||
                !statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_a,
                                                   request->expected_device_major_a,
                                                   request->expected_device_minor_a)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED;
            observation_failure_effect =
                OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED;
            if (!statefs_observe_statx(&observations[0], created_role,
                                       statefs_workspace.name_a,
                                       request->name_a_length,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_openat;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)(OXIGRAPH_STATEFS_O_RDONLY |
                                OXIGRAPH_STATEFS_O_DIRECTORY |
                                OXIGRAPH_STATEFS_O_CLOEXEC |
                                OXIGRAPH_STATEFS_O_NOFOLLOW);
            argument_4 = 0L;
            phase = STATEFS_PHASE_MKDIR_OPEN_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_OPEN_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            internal_fd_0 = (int32_t)syscall_result;
            statefs_workspace.one_byte = 0U;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)&statefs_workspace.one_byte;
            argument_3 = (long)(OXIGRAPH_STATEFS_AT_EMPTY_PATH |
                                OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW);
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_MKDIR_OPEN_STATX_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_OPEN_STATX_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_a,
                                                   request->expected_device_major_a,
                                                   request->expected_device_minor_a) ||
                !statefs_observation_matches_statx(&observations[0])) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_zero((uint8_t *)&statefs_workspace.statfs, 120U);
            syscall_number = STATEFS_SYSCALL_fstatfs;
            argument_1 = (long)internal_fd_0;
            argument_2 = (long)(uintptr_t)&statefs_workspace.statfs;
            phase = STATEFS_PHASE_MKDIR_OPEN_FSTATFS_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_OPEN_FSTATFS_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if ((uint64_t)statefs_workspace.statfs.filesystem_magic !=
                request->expected_filesystem_magic_a) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)internal_fd_0;
            phase = STATEFS_PHASE_MKDIR_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CHILD_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_close;
            argument_1 = (long)internal_fd_0;
            phase = STATEFS_PHASE_MKDIR_CLOSE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_CLOSE_RESULT:
            internal_fd_0 = -1;
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_CHILD_DESCRIPTOR_CLOSED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_CHILD_DESCRIPTOR_CLOSED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_CHILD_DESCRIPTOR_CLOSED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_a;
            phase = STATEFS_PHASE_MKDIR_PARENT_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_PARENT_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_PARENT_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_MKDIR_REOBSERVE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MKDIR_REOBSERVE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_a,
                                                   request->expected_device_major_a,
                                                   request->expected_device_minor_a) ||
                !statefs_observation_matches_statx(&observations[0])) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            result->observation_count = 1U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_MOVE_SOURCE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_a,
                                                   request->expected_device_major_a,
                                                   request->expected_device_minor_a)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_REJECTED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED;
            if (!statefs_observe_statx(&observations[1], request->dirfd_a_role,
                                       statefs_workspace.name_a,
                                       request->name_a_length,
                                       request->expected_filesystem_magic_a, 0U))
                goto statefs_observation_failure;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_MOVE_DESTINATION_ABSENCE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MOVE_DESTINATION_ABSENCE_RESULT:
            if (statefs_raw_error(syscall_result) &&
                syscall_result != -(long)OXIGRAPH_STATEFS_ENOENT) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_GENERATION_MOVED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_renameat2;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)request->dirfd_b;
            argument_4 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_5 = (long)OXIGRAPH_STATEFS_RENAME_NOREPLACE;
            phase = STATEFS_PHASE_MOVE_RENAME_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MOVE_RENAME_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_GENERATION_MOVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_GENERATION_MOVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_GENERATION_MOVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_a;
            phase = STATEFS_PHASE_MOVE_SOURCE_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MOVE_SOURCE_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_b;
            phase = STATEFS_PHASE_MOVE_DESTINATION_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MOVE_DESTINATION_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_MOVE_SOURCE_ABSENCE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MOVE_SOURCE_ABSENCE_RESULT:
            if (syscall_result != -(long)OXIGRAPH_STATEFS_ENOENT) {
                if (statefs_raw_error(syscall_result)) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED,
                                 (int32_t)-syscall_result);
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED, 0);
                }
                goto statefs_cleanup_begin;
            }
            statefs_observe_absent(&observations[0], request->dirfd_a_role,
                                   statefs_workspace.name_a,
                                   request->name_a_length);
            result->observation_count = 1U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_MOVE_DESTINATION_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_MOVE_DESTINATION_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_b,
                                                   request->expected_device_major_b,
                                                   request->expected_device_minor_b) ||
                !statefs_observation_matches_statx(&observations[1])) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED;
            if (!statefs_observe_statx(&observations[1], request->dirfd_b_role,
                                       statefs_workspace.name_b,
                                       request->name_b_length,
                                       request->expected_filesystem_magic_b, 0U))
                goto statefs_observation_failure;
            result->observation_count = 2U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_SYNC_SOURCE_INITIAL_RESULT:
            if (syscall_result != -(long)OXIGRAPH_STATEFS_ENOENT) {
                if (statefs_raw_error(syscall_result)) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                                 (int32_t)-syscall_result);
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED, 0);
                }
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_SYNC_DESTINATION_INITIAL_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_SYNC_DESTINATION_INITIAL_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_b,
                                                   request->expected_device_major_b,
                                                   request->expected_device_minor_b)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN;
            observation_failure_step =
                OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED;
            if (!statefs_observe_statx(&observations[1], request->dirfd_b_role,
                                       statefs_workspace.name_b,
                                       request->name_b_length,
                                       request->expected_filesystem_magic_b, 0U))
                goto statefs_observation_failure;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_a;
            phase = STATEFS_PHASE_SYNC_SOURCE_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_SYNC_SOURCE_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_b;
            phase = STATEFS_PHASE_SYNC_DESTINATION_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_SYNC_DESTINATION_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_SYNC_SOURCE_ABSENCE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_SYNC_SOURCE_ABSENCE_RESULT:
            if (syscall_result != -(long)OXIGRAPH_STATEFS_ENOENT) {
                if (statefs_raw_error(syscall_result)) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED,
                                 (int32_t)-syscall_result);
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED, 0);
                }
                goto statefs_cleanup_begin;
            }
            statefs_observe_absent(&observations[0], request->dirfd_a_role,
                                   statefs_workspace.name_a,
                                   request->name_a_length);
            result->observation_count = 1U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_b;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_b;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_SYNC_DESTINATION_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_SYNC_DESTINATION_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_local_directory(request->expected_owner_uid,
                                                   request->expected_owner_gid,
                                                   request->expected_mount_id_b,
                                                   request->expected_device_major_b,
                                                   request->expected_device_minor_b) ||
                !statefs_observation_matches_statx(&observations[1])) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            observation_failure_status = OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED;
            observation_failure_effect = OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN;
            observation_failure_step = OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED;
            if (!statefs_observe_statx(&observations[1], request->dirfd_b_role,
                                       statefs_workspace.name_b,
                                       request->name_b_length,
                                       request->expected_filesystem_magic_b, 0U))
                goto statefs_observation_failure;
            result->observation_count = 2U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_CLEANUP_SOURCE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            if (!statefs_statx_is_regular(request->expected_owner_uid,
                                           request->expected_owner_gid,
                                           request->expected_mount_id_a,
                                           request->expected_device_major_a,
                                           request->expected_device_minor_a)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                             OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED, 0);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_UNLINKED,
                               OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_unlinkat;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = 0L;
            phase = STATEFS_PHASE_CLEANUP_UNLINK_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_CLEANUP_UNLINK_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT,
                             OXIGRAPH_STATEFS_STEP_TEMP_UNLINKED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_TEMP_UNLINKED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_UNLINKED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            syscall_number = STATEFS_SYSCALL_fsync;
            argument_1 = (long)request->dirfd_a;
            phase = STATEFS_PHASE_CLEANUP_PARENT_SYNC_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_CLEANUP_PARENT_SYNC_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result, OXIGRAPH_STATEFS_STEP_PARENT_SYNCED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_PARENT_SYNCED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               1U)) goto statefs_cleanup_begin;
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_ABSENCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED,
                               0U)) goto statefs_cleanup_begin;
            statefs_zero((uint8_t *)&statefs_workspace.statx, 256U);
            syscall_number = STATEFS_SYSCALL_statx;
            argument_1 = (long)request->dirfd_a;
            argument_2 = (long)(uintptr_t)statefs_workspace.name_a;
            argument_3 = (long)OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW;
            argument_4 = (long)(OXIGRAPH_STATEFS_STATX_BASIC_STATS |
                                OXIGRAPH_STATEFS_STATX_MNT_ID);
            argument_5 = (long)(uintptr_t)&statefs_workspace.statx;
            phase = STATEFS_PHASE_CLEANUP_ABSENCE_RESULT;
            goto statefs_issue_syscall;

        case STATEFS_PHASE_CLEANUP_ABSENCE_RESULT:
            if (syscall_result != -(long)OXIGRAPH_STATEFS_ENOENT) {
                if (statefs_raw_error(syscall_result)) {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_TEMP_ABSENCE_REOBSERVED,
                                 (int32_t)-syscall_result);
                } else {
                    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED,
                                 OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                                 OXIGRAPH_STATEFS_STEP_TEMP_ABSENCE_REOBSERVED, 0);
                }
                goto statefs_cleanup_begin;
            }
            statefs_observe_absent(&observations[0], request->dirfd_a_role,
                                   statefs_workspace.name_a,
                                   request->name_a_length);
            result->observation_count = 1U;
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_TEMP_ABSENCE_REOBSERVED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_TEMP_ABSENCE_REOBSERVED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_RELEASE_RESULT:
            if (statefs_raw_error(syscall_result)) {
                statefs_fail(result, OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED,
                             OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                             OXIGRAPH_STATEFS_STEP_DIRECTORY_RELEASED,
                             (int32_t)-syscall_result);
                goto statefs_cleanup_begin;
            }
            statefs_complete_step(result,
                                  OXIGRAPH_STATEFS_STEP_DIRECTORY_RELEASED);
            if (statefs_inject(request, result,
                               OXIGRAPH_STATEFS_STEP_DIRECTORY_RELEASED,
                               OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN,
                               1U)) goto statefs_cleanup_begin;
            goto statefs_complete;

        case STATEFS_PHASE_FAILURE_CLOSE_RESULT:
            if (failure_close_slot == 2U)
                internal_fd_2 = -1;
            else if (failure_close_slot == 1U)
                internal_fd_1 = -1;
            else
                internal_fd_0 = -1;
            if (statefs_raw_error(syscall_result) &&
                (result->effect_class == OXIGRAPH_STATEFS_EFFECT_NO_EFFECT ||
                 result->effect_class == OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT ||
                 result->effect_class ==
                     OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED))
                result->effect_class = OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN;
            goto statefs_cleanup_next;

        default:
            statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                         OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                         OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED, 0);
            goto statefs_cleanup_begin;
    }

    statefs_fail(result, OXIGRAPH_STATEFS_STATUS_REJECTED,
                 OXIGRAPH_STATEFS_EFFECT_NO_EFFECT,
                 OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED, 0);
    goto statefs_cleanup_begin;

statefs_observation_failure:
    statefs_fail(result, observation_failure_status,
                 observation_failure_effect, observation_failure_step, 0);
    goto statefs_cleanup_begin;

statefs_complete:
    if (statefs_fault_selector_is_pending(request)) {
        result->status = OXIGRAPH_STATEFS_STATUS_REJECTED;
        result->effect_class = OXIGRAPH_STATEFS_EFFECT_NO_EFFECT;
        result->last_completed_step = OXIGRAPH_STATEFS_STEP_NONE;
        result->failed_step = OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED;
        result->errno_value = 0;
        result->observation_count = 0U;
        result->output_length = 0U;
        result->completed_step_count = 0U;
        result->returned_directory_fd = -1;
        result->bytes_consumed = 0U;
        statefs_zero((uint8_t *)observations,
                     (uint64_t)request->observation_capacity * 384U);
        return 0;
    }
    result->status = OXIGRAPH_STATEFS_STATUS_COMPLETE;
    result->effect_class = OXIGRAPH_STATEFS_EFFECT_COMPLETE;
    result->failed_step = OXIGRAPH_STATEFS_STEP_NONE;
    result->errno_value = 0;
    if (result->observation_count < request->observation_capacity)
        statefs_zero((uint8_t *)&observations[result->observation_count],
                     (uint64_t)(request->observation_capacity -
                                result->observation_count) * 384U);
    return 0;

statefs_cleanup_begin:
    if (result->observation_count < request->observation_capacity)
        statefs_zero((uint8_t *)&observations[result->observation_count],
                     (uint64_t)(request->observation_capacity -
                                result->observation_count) * 384U);
    failure_close_slot = 3U;
statefs_cleanup_next:
    while (failure_close_slot > 0U) {
        failure_close_slot -= 1U;
        if ((failure_close_slot == 2U && internal_fd_2 >= 0) ||
            (failure_close_slot == 1U && internal_fd_1 >= 0) ||
            (failure_close_slot == 0U && internal_fd_0 >= 0)) {
            directory_fd = failure_close_slot == 2U
                               ? internal_fd_2
                               : failure_close_slot == 1U ? internal_fd_1 : internal_fd_0;
            syscall_number = STATEFS_SYSCALL_close;
            argument_1 = (long)directory_fd;
            phase = STATEFS_PHASE_FAILURE_CLOSE_RESULT;
            goto statefs_issue_syscall;
        }
    }
    return 0;

statefs_issue_syscall:
    switch (syscall_number) {
        case STATEFS_SYSCALL_read:
            syscall_result = statefs_linux_read(argument_1, argument_2, argument_3);
            break;
        case STATEFS_SYSCALL_write:
            syscall_result = statefs_linux_write(argument_1, argument_2, argument_3);
            break;
        case STATEFS_SYSCALL_close:
            syscall_result = statefs_linux_close(argument_1);
            break;
        case STATEFS_SYSCALL_fcntl:
            syscall_result = statefs_linux_fcntl(argument_1, argument_2, argument_3);
            break;
        case STATEFS_SYSCALL_flock:
            syscall_result = statefs_linux_flock(argument_1, argument_2);
            break;
        case STATEFS_SYSCALL_fsync:
            syscall_result = statefs_linux_fsync(argument_1);
            break;
        case STATEFS_SYSCALL_fstatfs:
            syscall_result = statefs_linux_fstatfs(argument_1, argument_2);
            break;
        case STATEFS_SYSCALL_getdents64:
            syscall_result = statefs_linux_getdents64(argument_1, argument_2, argument_3);
            break;
        case STATEFS_SYSCALL_openat:
            syscall_result = statefs_linux_openat(argument_1, argument_2, argument_3,
                                                   argument_4);
            break;
        case STATEFS_SYSCALL_mkdirat:
            syscall_result = statefs_linux_mkdirat(argument_1, argument_2, argument_3);
            break;
        case STATEFS_SYSCALL_unlinkat:
            syscall_result = statefs_linux_unlinkat(argument_1, argument_2, argument_3);
            break;
        case STATEFS_SYSCALL_renameat2:
            syscall_result = statefs_linux_renameat2(argument_1, argument_2, argument_3,
                                                      argument_4, argument_5);
            break;
        case STATEFS_SYSCALL_statx:
            syscall_result = statefs_linux_statx(argument_1, argument_2, argument_3,
                                                  argument_4, argument_5);
            break;
        default:
            syscall_result = -OXIGRAPH_STATEFS_ENOSYS;
            break;
    }
    goto statefs_loop;
}
