#ifndef OXIGRAPH_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_H
#define OXIGRAPH_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_H

#include <limits.h>
#include <stddef.h>
#include <stdint.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "the StateFS syscall ABI requires Linux x86-64"
#endif

#if !defined(__BYTE_ORDER__) || !defined(__ORDER_LITTLE_ENDIAN__) || \
    __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "the StateFS syscall ABI requires little-endian byte order"
#endif

_Static_assert(CHAR_BIT == 8, "StateFS requires eight-bit bytes");
_Static_assert(sizeof(void *) == 8, "StateFS requires 64-bit pointers");
_Static_assert(sizeof(uintptr_t) == 8, "StateFS requires 64-bit uintptr_t");
_Static_assert(sizeof(int32_t) == 4, "StateFS requires 32-bit int32_t");
_Static_assert(sizeof(uint32_t) == 4, "StateFS requires 32-bit uint32_t");
_Static_assert(sizeof(uint64_t) == 8, "StateFS requires 64-bit uint64_t");

enum oxigraph_containment_statefs_operation_v1 {
    OXIGRAPH_STATEFS_OPERATION_INVALID = 0,
    OXIGRAPH_STATEFS_OPERATION_LOCK_EX_NB = 1,
    OXIGRAPH_STATEFS_OPERATION_INVENTORY = 2,
    OXIGRAPH_STATEFS_OPERATION_PERSIST_NOREPLACE = 3,
    OXIGRAPH_STATEFS_OPERATION_MKDIR_SYNC = 4,
    OXIGRAPH_STATEFS_OPERATION_MOVE_NOREPLACE_SYNC = 5,
    OXIGRAPH_STATEFS_OPERATION_TEMP_CLEANUP = 6,
    OXIGRAPH_STATEFS_OPERATION_MOVE_SYNC_REOBSERVE = 7,
    OXIGRAPH_STATEFS_OPERATION_RELEASE_DIRECTORY = 8
};

enum oxigraph_containment_statefs_inventory_kind_v1 {
    OXIGRAPH_STATEFS_INVENTORY_NONE = 0,
    OXIGRAPH_STATEFS_INVENTORY_DIRECTORY = 1,
    OXIGRAPH_STATEFS_INVENTORY_REGULAR_FILE = 2
};

enum oxigraph_containment_statefs_directory_role_v1 {
    OXIGRAPH_STATEFS_ROLE_NONE = 0,
    OXIGRAPH_STATEFS_ROLE_STATE_ROOT = 1,
    OXIGRAPH_STATEFS_ROLE_LIFETIMES = 2,
    OXIGRAPH_STATEFS_ROLE_LIFETIME_SEGMENT = 3,
    OXIGRAPH_STATEFS_ROLE_STAGING = 4,
    OXIGRAPH_STATEFS_ROLE_ACTIVE = 5,
    OXIGRAPH_STATEFS_ROLE_CLOSED = 6,
    OXIGRAPH_STATEFS_ROLE_RECOVERED = 7,
    OXIGRAPH_STATEFS_ROLE_QUARANTINED = 8,
    OXIGRAPH_STATEFS_ROLE_GENERATION = 9,
    OXIGRAPH_STATEFS_ROLE_NORMAL_JOURNAL = 10,
    OXIGRAPH_STATEFS_ROLE_RECOVERY_JOURNAL = 11,
    OXIGRAPH_STATEFS_ROLE_RECOVERY_ATTEMPT = 12
};

enum oxigraph_containment_statefs_observation_kind_v1 {
    OXIGRAPH_STATEFS_OBSERVATION_ABSENT = 0,
    OXIGRAPH_STATEFS_OBSERVATION_REGULAR = 1,
    OXIGRAPH_STATEFS_OBSERVATION_DIRECTORY = 2,
    OXIGRAPH_STATEFS_OBSERVATION_SYMLINK = 3,
    OXIGRAPH_STATEFS_OBSERVATION_FIFO = 4,
    OXIGRAPH_STATEFS_OBSERVATION_BLOCK_DEVICE = 5,
    OXIGRAPH_STATEFS_OBSERVATION_CHARACTER_DEVICE = 6,
    OXIGRAPH_STATEFS_OBSERVATION_SOCKET = 7,
    OXIGRAPH_STATEFS_OBSERVATION_OTHER = 8
};

enum oxigraph_containment_statefs_result_status_v1 {
    OXIGRAPH_STATEFS_STATUS_COMPLETE = 0,
    OXIGRAPH_STATEFS_STATUS_REJECTED = 1,
    OXIGRAPH_STATEFS_STATUS_SYSCALL_FAILED = 2,
    OXIGRAPH_STATEFS_STATUS_LIMIT_EXCEEDED = 3,
    OXIGRAPH_STATEFS_STATUS_FAULT_INJECTED = 4,
    OXIGRAPH_STATEFS_STATUS_VERIFICATION_FAILED = 5
};

enum oxigraph_containment_statefs_effect_class_v1 {
    OXIGRAPH_STATEFS_EFFECT_NO_EFFECT = 0,
    OXIGRAPH_STATEFS_EFFECT_DEFINITE_NO_EFFECT = 1,
    OXIGRAPH_STATEFS_EFFECT_COMPLETE = 2,
    OXIGRAPH_STATEFS_EFFECT_MUTATION_OBSERVED_NOT_FULLY_SYNCED = 3,
    OXIGRAPH_STATEFS_EFFECT_EFFECT_UNCERTAIN = 4
};

enum oxigraph_containment_statefs_step_v1 {
    OXIGRAPH_STATEFS_STEP_NONE = 0,
    OXIGRAPH_STATEFS_STEP_REQUEST_VALIDATED = 1,
    OXIGRAPH_STATEFS_STEP_FD_A_VALIDATED = 2,
    OXIGRAPH_STATEFS_STEP_FD_B_VALIDATED = 3,
    OXIGRAPH_STATEFS_STEP_LOCK_ACQUIRED = 4,
    OXIGRAPH_STATEFS_STEP_INTERNAL_DESCRIPTOR_OPENED = 5,
    OXIGRAPH_STATEFS_STEP_DIRECTORY_ENUMERATED = 6,
    OXIGRAPH_STATEFS_STEP_ENTRY_REOBSERVED = 7,
    OXIGRAPH_STATEFS_STEP_TEMP_CREATED = 8,
    OXIGRAPH_STATEFS_STEP_TEMP_WRITTEN = 9,
    OXIGRAPH_STATEFS_STEP_TEMP_READ_BACK = 10,
    OXIGRAPH_STATEFS_STEP_TEMP_FILE_SYNCED = 11,
    OXIGRAPH_STATEFS_STEP_FINAL_INSTALLED = 12,
    OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_CREATED = 13,
    OXIGRAPH_STATEFS_STEP_CHILD_DIRECTORY_SYNCED = 14,
    OXIGRAPH_STATEFS_STEP_SOURCE_REOBSERVED = 15,
    OXIGRAPH_STATEFS_STEP_GENERATION_MOVED = 16,
    OXIGRAPH_STATEFS_STEP_SOURCE_PARENT_SYNCED = 17,
    OXIGRAPH_STATEFS_STEP_DESTINATION_PARENT_SYNCED = 18,
    OXIGRAPH_STATEFS_STEP_TEMP_UNLINKED = 19,
    OXIGRAPH_STATEFS_STEP_PARENT_SYNCED = 20,
    OXIGRAPH_STATEFS_STEP_DESTINATION_REOBSERVED = 21,
    OXIGRAPH_STATEFS_STEP_SOURCE_ABSENCE_REOBSERVED = 22,
    OXIGRAPH_STATEFS_STEP_TEMP_ABSENCE_REOBSERVED = 23,
    OXIGRAPH_STATEFS_STEP_INVENTORY_DESCRIPTOR_CLOSED = 24,
    OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_OPENED = 25,
    OXIGRAPH_STATEFS_STEP_TEMP_READ_DESCRIPTOR_CLOSED = 26,
    OXIGRAPH_STATEFS_STEP_TEMP_WRITE_DESCRIPTOR_CLOSED = 27,
    OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_OPENED = 28,
    OXIGRAPH_STATEFS_STEP_FINAL_READ_DESCRIPTOR_CLOSED = 29,
    OXIGRAPH_STATEFS_STEP_CHILD_DESCRIPTOR_CLOSED = 30,
    OXIGRAPH_STATEFS_STEP_PRE_SYNC_DESTINATION_REOBSERVED = 31,
    OXIGRAPH_STATEFS_STEP_DIRECTORY_HANDLE_TRANSFERRED = 32,
    OXIGRAPH_STATEFS_STEP_CREATED_METADATA_VALIDATED = 33,
    OXIGRAPH_STATEFS_STEP_DIRECTORY_RELEASED = 34
};

enum oxigraph_containment_statefs_linux_uapi_v1 {
    OXIGRAPH_STATEFS_O_RDONLY = 0x00000000,
    OXIGRAPH_STATEFS_O_WRONLY = 0x00000001,
    OXIGRAPH_STATEFS_O_CREAT = 0x00000040,
    OXIGRAPH_STATEFS_O_EXCL = 0x00000080,
    OXIGRAPH_STATEFS_O_ACCMODE = 0x00000003,
    OXIGRAPH_STATEFS_O_NONBLOCK = 0x00000800,
    OXIGRAPH_STATEFS_O_LARGEFILE = 0x00008000,
    OXIGRAPH_STATEFS_O_DIRECTORY = 0x00010000,
    OXIGRAPH_STATEFS_O_NOFOLLOW = 0x00020000,
    OXIGRAPH_STATEFS_O_CLOEXEC = 0x00080000,
    OXIGRAPH_STATEFS_O_PATH = 0x00200000,
    OXIGRAPH_STATEFS_F_GETFL = 3,
    OXIGRAPH_STATEFS_F_GETFD = 1,
    OXIGRAPH_STATEFS_FD_CLOEXEC = 1,
    OXIGRAPH_STATEFS_LOCK_EX = 2,
    OXIGRAPH_STATEFS_LOCK_NB = 4,
    OXIGRAPH_STATEFS_AT_FDCWD = -100,
    OXIGRAPH_STATEFS_AT_SYMLINK_NOFOLLOW = 0x00000100,
    OXIGRAPH_STATEFS_AT_EMPTY_PATH = 0x00001000,
    OXIGRAPH_STATEFS_STATX_BASIC_STATS = 0x000007ff,
    OXIGRAPH_STATEFS_STATX_MNT_ID = 0x00001000,
    OXIGRAPH_STATEFS_S_IFMT = 0170000,
    OXIGRAPH_STATEFS_S_IFREG = 0100000,
    OXIGRAPH_STATEFS_S_IFDIR = 0040000,
    OXIGRAPH_STATEFS_S_IFLNK = 0120000,
    OXIGRAPH_STATEFS_S_IFIFO = 0010000,
    OXIGRAPH_STATEFS_S_IFBLK = 0060000,
    OXIGRAPH_STATEFS_S_IFCHR = 0020000,
    OXIGRAPH_STATEFS_S_IFSOCK = 0140000,
    OXIGRAPH_STATEFS_S_ISUID = 0004000,
    OXIGRAPH_STATEFS_S_ISGID = 0002000,
    OXIGRAPH_STATEFS_S_ISVTX = 0001000,
    OXIGRAPH_STATEFS_RENAME_NOREPLACE = 1
};

enum oxigraph_containment_statefs_linux_errno_v1 {
    OXIGRAPH_STATEFS_EPERM = 1,
    OXIGRAPH_STATEFS_ENOENT = 2,
    OXIGRAPH_STATEFS_EINTR = 4,
    OXIGRAPH_STATEFS_EIO = 5,
    OXIGRAPH_STATEFS_EBADF = 9,
    OXIGRAPH_STATEFS_EAGAIN = 11,
    OXIGRAPH_STATEFS_EWOULDBLOCK = 11,
    OXIGRAPH_STATEFS_EACCES = 13,
    OXIGRAPH_STATEFS_EFAULT = 14,
    OXIGRAPH_STATEFS_EEXIST = 17,
    OXIGRAPH_STATEFS_ENOTDIR = 20,
    OXIGRAPH_STATEFS_EISDIR = 21,
    OXIGRAPH_STATEFS_EINVAL = 22,
    OXIGRAPH_STATEFS_EFBIG = 27,
    OXIGRAPH_STATEFS_ENOSPC = 28,
    OXIGRAPH_STATEFS_EROFS = 30,
    OXIGRAPH_STATEFS_EMLINK = 31,
    OXIGRAPH_STATEFS_ENAMETOOLONG = 36,
    OXIGRAPH_STATEFS_ENOSYS = 38,
    OXIGRAPH_STATEFS_ENOTEMPTY = 39,
    OXIGRAPH_STATEFS_ELOOP = 40,
    OXIGRAPH_STATEFS_EOVERFLOW = 75,
    OXIGRAPH_STATEFS_EOPNOTSUPP = 95,
    OXIGRAPH_STATEFS_ESTALE = 116
};

struct oxigraph_containment_statefs_request_v1 {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t operation;
    uint32_t inventory_kind;
    int32_t dirfd_a;
    int32_t dirfd_b;
    uint32_t dirfd_a_role;
    uint32_t dirfd_b_role;
    uint32_t name_a_length;
    uint32_t name_b_length;
    uint64_t input_length;
    uint64_t name_a_address;
    uint64_t name_b_address;
    uint64_t input_address;
    uint64_t observations_address;
    uint32_t observation_capacity;
    uint32_t output_capacity;
    uint64_t output_address;
    uint32_t test_fault_selector;
    uint32_t expected_owner_uid;
    uint32_t expected_owner_gid;
    uint32_t inventory_directory_role;
    uint64_t expected_mount_id_a;
    uint64_t expected_mount_id_b;
    uint64_t expected_device_major_a;
    uint64_t expected_device_minor_a;
    uint64_t expected_inode_a;
    uint64_t expected_filesystem_magic_a;
    uint64_t expected_device_major_b;
    uint64_t expected_device_minor_b;
    uint64_t expected_inode_b;
    uint64_t expected_filesystem_magic_b;
};

struct oxigraph_containment_statefs_observation_v1 {
    uint32_t struct_size;
    uint32_t kind;
    uint32_t role;
    uint32_t name_length;
    uint64_t device_major;
    uint64_t device_minor;
    uint64_t inode;
    uint64_t mount_id;
    uint64_t byte_length;
    uint64_t link_count;
    uint32_t mode;
    uint32_t owner_uid;
    uint32_t owner_gid;
    uint32_t statx_mask;
    uint64_t filesystem_magic;
    uint64_t content_offset;
    uint64_t content_length;
    uint8_t name[256];
    uint64_t reserved_0;
    uint64_t reserved_1;
    uint64_t reserved_2;
};

struct oxigraph_containment_statefs_result_v1 {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t operation;
    uint32_t status;
    uint32_t effect_class;
    uint32_t last_completed_step;
    uint32_t failed_step;
    int32_t errno_value;
    uint32_t observation_count;
    uint32_t output_length;
    uint32_t completed_step_count;
    int32_t returned_directory_fd;
    uint64_t bytes_consumed;
    uint64_t reserved_u64;
};

_Static_assert(_Alignof(struct oxigraph_containment_statefs_request_v1) == 8, "request alignment");
_Static_assert(sizeof(struct oxigraph_containment_statefs_request_v1) == 192, "request size");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, abi_version) == 0, "request.abi_version");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, struct_size) == 4, "request.struct_size");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, operation) == 8, "request.operation");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, inventory_kind) == 12, "request.inventory_kind");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, dirfd_a) == 16, "request.dirfd_a");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, dirfd_b) == 20, "request.dirfd_b");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, dirfd_a_role) == 24, "request.dirfd_a_role");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, dirfd_b_role) == 28, "request.dirfd_b_role");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, name_a_length) == 32, "request.name_a_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, name_b_length) == 36, "request.name_b_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, input_length) == 40, "request.input_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, name_a_address) == 48, "request.name_a_address");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, name_b_address) == 56, "request.name_b_address");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, input_address) == 64, "request.input_address");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, observations_address) == 72, "request.observations_address");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, observation_capacity) == 80, "request.observation_capacity");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, output_capacity) == 84, "request.output_capacity");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, output_address) == 88, "request.output_address");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, test_fault_selector) == 96, "request.test_fault_selector");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_owner_uid) == 100, "request.expected_owner_uid");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_owner_gid) == 104, "request.expected_owner_gid");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, inventory_directory_role) == 108, "request.inventory_directory_role");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_mount_id_a) == 112, "request.expected_mount_id_a");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_mount_id_b) == 120, "request.expected_mount_id_b");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_device_major_a) == 128, "request.expected_device_major_a");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_device_minor_a) == 136, "request.expected_device_minor_a");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_inode_a) == 144, "request.expected_inode_a");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_filesystem_magic_a) == 152, "request.expected_filesystem_magic_a");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_device_major_b) == 160, "request.expected_device_major_b");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_device_minor_b) == 168, "request.expected_device_minor_b");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_inode_b) == 176, "request.expected_inode_b");
_Static_assert(offsetof(struct oxigraph_containment_statefs_request_v1, expected_filesystem_magic_b) == 184, "request.expected_filesystem_magic_b");

_Static_assert(_Alignof(struct oxigraph_containment_statefs_observation_v1) == 8, "observation alignment");
_Static_assert(sizeof(struct oxigraph_containment_statefs_observation_v1) == 384, "observation size");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, struct_size) == 0, "observation.struct_size");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, kind) == 4, "observation.kind");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, role) == 8, "observation.role");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, name_length) == 12, "observation.name_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, device_major) == 16, "observation.device_major");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, device_minor) == 24, "observation.device_minor");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, inode) == 32, "observation.inode");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, mount_id) == 40, "observation.mount_id");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, byte_length) == 48, "observation.byte_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, link_count) == 56, "observation.link_count");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, mode) == 64, "observation.mode");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, owner_uid) == 68, "observation.owner_uid");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, owner_gid) == 72, "observation.owner_gid");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, statx_mask) == 76, "observation.statx_mask");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, filesystem_magic) == 80, "observation.filesystem_magic");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, content_offset) == 88, "observation.content_offset");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, content_length) == 96, "observation.content_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, name) == 104, "observation.name");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, reserved_0) == 360, "observation.reserved_0");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, reserved_1) == 368, "observation.reserved_1");
_Static_assert(offsetof(struct oxigraph_containment_statefs_observation_v1, reserved_2) == 376, "observation.reserved_2");

_Static_assert(_Alignof(struct oxigraph_containment_statefs_result_v1) == 8, "result alignment");
_Static_assert(sizeof(struct oxigraph_containment_statefs_result_v1) == 64, "result size");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, abi_version) == 0, "result.abi_version");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, struct_size) == 4, "result.struct_size");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, operation) == 8, "result.operation");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, status) == 12, "result.status");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, effect_class) == 16, "result.effect_class");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, last_completed_step) == 20, "result.last_completed_step");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, failed_step) == 24, "result.failed_step");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, errno_value) == 28, "result.errno_value");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, observation_count) == 32, "result.observation_count");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, output_length) == 36, "result.output_length");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, completed_step_count) == 40, "result.completed_step_count");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, returned_directory_fd) == 44, "result.returned_directory_fd");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, bytes_consumed) == 48, "result.bytes_consumed");
_Static_assert(offsetof(struct oxigraph_containment_statefs_result_v1, reserved_u64) == 56, "result.reserved_u64");

int32_t oxigraph_containment_statefs_execute_v1(
    const struct oxigraph_containment_statefs_request_v1 *request,
    struct oxigraph_containment_statefs_result_v1 *result);

#endif
