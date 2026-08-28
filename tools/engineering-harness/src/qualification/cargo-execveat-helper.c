#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/kcmp.h>
#include <linux/openat2.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define CARGO_FD 6
#define STATUS_FD 7
#define HELPER_SELF_FD 8
#define FIRST_UNEXPECTED_FD 9U
#define MAX_ARGC 4096
#define MAX_ARGV_BYTES (1024U * 1024U)
#define MAX_STATUS_BYTES 4096U

#define EXIT_PREFLIGHT 240
#define EXIT_CARGO_FD 241
#define EXIT_STATUS_FD 242
#define EXIT_STATUS_CLOEXEC 243
#define EXIT_READY_WRITE 244
#define EXIT_EXECVEAT 245

#define STATUS_SCHEMA "oxigraph.g1.7-cargo-execveat-status/v1"
#define READY_FRAME                                                          \
    "{\"errno\":null,\"reservedExitCode\":null,\"schema\":\"oxigraph.g1.7-cargo-execveat-status/v1\",\"stage\":\"execveat\",\"type\":\"READY\"}\n"

extern char **environ;

enum descriptor_kind {
    DESCRIPTOR_CHARACTER,
    DESCRIPTOR_DIRECTORY,
    DESCRIPTOR_PIPE,
    DESCRIPTOR_REGULAR,
};

static bool status_fd_valid = false;

static ssize_t write_all(int descriptor, const char *bytes, size_t length) {
    size_t offset = 0U;
    while (offset < length) {
        ssize_t written = write(descriptor, bytes + offset, length - offset);
        if (written < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (written == 0) {
            errno = EIO;
            return -1;
        }
        offset += (size_t)written;
    }
    return (ssize_t)offset;
}

static ssize_t write_status_safely(const char *bytes, size_t length) {
    sigset_t pipe_signal;
    sigset_t previous_mask;
    sigset_t pending;
    struct sigaction disposition;
    struct timespec no_wait = {.tv_sec = 0, .tv_nsec = 0};

    if (sigemptyset(&pipe_signal) != 0 ||
        sigaddset(&pipe_signal, SIGPIPE) != 0 ||
        sigaction(SIGPIPE, NULL, &disposition) != 0 ||
        disposition.sa_handler != SIG_DFL ||
        sigprocmask(SIG_BLOCK, &pipe_signal, &previous_mask) != 0) {
        return -1;
    }
    if (sigismember(&previous_mask, SIGPIPE) != 0) {
        errno = EPROTO;
        return -1;
    }

    ssize_t result = write_all(STATUS_FD, bytes, length);
    int observed_errno = result < 0 ? errno : 0;
    if (sigpending(&pending) != 0) {
        return -1;
    }
    if (sigismember(&pending, SIGPIPE) == 1) {
        int consumed;
        do {
            consumed = sigtimedwait(&pipe_signal, NULL, &no_wait);
        } while (consumed < 0 && errno == EINTR);
        if (consumed != SIGPIPE) {
            errno = EIO;
            return -1;
        }
    }
    if (sigprocmask(SIG_SETMASK, &previous_mask, NULL) != 0) {
        return -1;
    }
    errno = observed_errno;
    return result;
}

static void write_error_frame(
    const char *stage,
    int observed_errno,
    int reserved_exit
) {
    char frame[512];
    int length = snprintf(
        frame,
        sizeof(frame),
        "{\"errno\":%d,\"reservedExitCode\":%d,\"schema\":\"%s\","
        "\"stage\":\"%s\",\"type\":\"ERROR\"}\n",
        observed_errno,
        reserved_exit,
        STATUS_SCHEMA,
        stage
    );
    if (length < 1 || (size_t)length >= sizeof(frame) ||
        (size_t)length > MAX_STATUS_BYTES) {
        return;
    }
    (void)write_status_safely(frame, (size_t)length);
}

static _Noreturn void fail_stage(
    const char *stage,
    int reserved_exit,
    int observed_errno
) {
    int safe_errno = observed_errno;
    if (safe_errno < 1 || safe_errno > 4095) safe_errno = EINVAL;
    if (status_fd_valid) {
        write_error_frame(stage, safe_errno, reserved_exit);
    }
    _exit(reserved_exit);
}

static bool kind_matches(mode_t mode, enum descriptor_kind expected) {
    switch (expected) {
        case DESCRIPTOR_CHARACTER:
            return S_ISCHR(mode);
        case DESCRIPTOR_DIRECTORY:
            return S_ISDIR(mode);
        case DESCRIPTOR_PIPE:
            return S_ISFIFO(mode);
        case DESCRIPTOR_REGULAR:
            return S_ISREG(mode);
    }
    return false;
}

static void inspect_descriptor(
    int descriptor,
    enum descriptor_kind expected_kind,
    int expected_access,
    const char *stage,
    int reserved_exit,
    struct stat *status
) {
    int descriptor_flags = fcntl(descriptor, F_GETFD);
    if (descriptor_flags < 0) {
        fail_stage(stage, reserved_exit, errno);
    }
    if ((descriptor_flags & FD_CLOEXEC) != 0) {
        fail_stage(stage, reserved_exit, EINVAL);
    }
    int open_flags = fcntl(descriptor, F_GETFL);
    if (open_flags < 0) {
        fail_stage(stage, reserved_exit, errno);
    }
    if ((open_flags & O_PATH) != 0 ||
        (open_flags & O_ACCMODE) != expected_access) {
        fail_stage(stage, reserved_exit, EACCES);
    }
    if (fstat(descriptor, status) != 0) {
        fail_stage(stage, reserved_exit, errno);
    }
    if (!kind_matches(status->st_mode, expected_kind)) {
        fail_stage(stage, reserved_exit, EBADF);
    }
}

static bool same_object(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev &&
           left->st_ino == right->st_ino &&
           (left->st_mode & S_IFMT) == (right->st_mode & S_IFMT);
}

static int normalize_sigpipe_for_cargo(void) {
    sigset_t pipe_signal;
    sigset_t inherited_mask;
    sigset_t normalized_mask;
    sigset_t observed_mask;
    struct sigaction ignored;
    struct sigaction defaulted;
    struct sigaction observed;

    memset(&ignored, 0, sizeof(ignored));
    memset(&defaulted, 0, sizeof(defaulted));
    ignored.sa_handler = SIG_IGN;
    defaulted.sa_handler = SIG_DFL;
    if (sigemptyset(&ignored.sa_mask) != 0 ||
        sigemptyset(&defaulted.sa_mask) != 0 ||
        sigemptyset(&pipe_signal) != 0 ||
        sigaddset(&pipe_signal, SIGPIPE) != 0 ||
        sigprocmask(SIG_BLOCK, &pipe_signal, &inherited_mask) != 0 ||
        sigaction(SIGPIPE, &ignored, NULL) != 0 ||
        sigaction(SIGPIPE, &defaulted, NULL) != 0) {
        return -1;
    }
    normalized_mask = inherited_mask;
    if (sigdelset(&normalized_mask, SIGPIPE) != 0 ||
        sigprocmask(SIG_SETMASK, &normalized_mask, NULL) != 0 ||
        sigaction(SIGPIPE, NULL, &observed) != 0 ||
        sigprocmask(SIG_SETMASK, NULL, &observed_mask) != 0 ||
        observed.sa_handler != SIG_DFL ||
        sigismember(&observed_mask, SIGPIPE) != 0) {
        return -1;
    }
    return 0;
}

static void validate_child_beneath_workspace(
    int workspace_descriptor,
    const char *leaf,
    const struct stat *held
) {
    struct open_how how = {
        .flags = O_RDONLY | O_DIRECTORY | O_CLOEXEC,
        .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS,
    };
    int child = (int)syscall(
        SYS_openat2,
        workspace_descriptor,
        leaf,
        &how,
        sizeof(how)
    );
    if (child < 0) {
        fail_stage("preflight", EXIT_PREFLIGHT, errno);
    }
    struct stat resolved;
    if (fstat(child, &resolved) != 0) {
        int observed_errno = errno;
        (void)close(child);
        fail_stage("preflight", EXIT_PREFLIGHT, observed_errno);
    }
    if (close(child) != 0) {
        fail_stage("preflight", EXIT_PREFLIGHT, errno);
    }
    if (!same_object(held, &resolved)) {
        fail_stage("preflight", EXIT_PREFLIGHT, ESTALE);
    }
}

static void validate_arguments(int argc, char **argv) {
    if (argc < 1 || argc > MAX_ARGC || argv == NULL || argv[0] == NULL ||
        argv[0][0] == '\0') {
        fail_stage("preflight", EXIT_PREFLIGHT, E2BIG);
    }
    size_t total = 0U;
    for (int index = 0; index < argc; index += 1) {
        if (argv[index] == NULL) {
            fail_stage("preflight", EXIT_PREFLIGHT, EINVAL);
        }
        size_t remaining = MAX_ARGV_BYTES - total;
        size_t length = strnlen(argv[index], remaining + 1U);
        if (length > remaining) {
            fail_stage("preflight", EXIT_PREFLIGHT, E2BIG);
        }
        total += length;
    }
    if (argv[argc] != NULL) {
        fail_stage("preflight", EXIT_PREFLIGHT, EINVAL);
    }
}

static void validate_mapped_directory(
    const char *path,
    const struct stat *held
) {
    struct stat mapped;
    if (stat(path, &mapped) != 0 || !same_object(held, &mapped)) {
        fail_stage("preflight", EXIT_PREFLIGHT, ESTALE);
    }
}

static void validate_open_file_descriptions(void) {
    pid_t process = getpid();
    for (int left = 0; left <= HELPER_SELF_FD; left += 1) {
        for (int right = left + 1; right <= HELPER_SELF_FD; right += 1) {
            long comparison = syscall(
                SYS_kcmp,
                process,
                process,
                KCMP_FILE,
                (unsigned long)left,
                (unsigned long)right
            );
            if (comparison < 0) {
                fail_stage("preflight", EXIT_PREFLIGHT, errno);
            }
            if (comparison == 0) {
                fail_stage("preflight", EXIT_PREFLIGHT, ELOOP);
            }
        }
    }
}

static void validate_descriptor_objects(const struct stat observations[9]) {
    const int distinct_object_fds[] = {
        3, 4, 5, CARGO_FD, HELPER_SELF_FD,
    };
    const size_t distinct_count =
        sizeof(distinct_object_fds) / sizeof(distinct_object_fds[0]);
    for (size_t left = 0U; left < distinct_count; left += 1U) {
        for (size_t right = left + 1U; right < distinct_count; right += 1U) {
            if (same_object(
                    &observations[distinct_object_fds[left]],
                    &observations[distinct_object_fds[right]]
                )) {
                fail_stage("preflight", EXIT_PREFLIGHT, ELOOP);
            }
        }
    }

    const int distinct_pipe_object_fds[] = {1, 2, STATUS_FD,};
    const size_t distinct_pipe_count =
        sizeof(distinct_pipe_object_fds) /
        sizeof(distinct_pipe_object_fds[0]);
    for (size_t left = 0U; left < distinct_pipe_count; left += 1U) {
        for (size_t right = left + 1U; right < distinct_pipe_count;
             right += 1U) {
            if (same_object(
                    &observations[distinct_pipe_object_fds[left]],
                    &observations[distinct_pipe_object_fds[right]]
                )) {
                fail_stage("preflight", EXIT_PREFLIGHT, ELOOP);
            }
        }
    }

    struct stat null_device;
    if (stat("/dev/null", &null_device) != 0 ||
        !same_object(&observations[0], &null_device) ||
        observations[0].st_rdev != null_device.st_rdev) {
        fail_stage("preflight", EXIT_PREFLIGHT, ENODEV);
    }

    if ((observations[CARGO_FD].st_mode & 0111) == 0 ||
        observations[CARGO_FD].st_nlink != 1) {
        fail_stage("cargo-fd", EXIT_CARGO_FD, EACCES);
    }
    if ((observations[HELPER_SELF_FD].st_mode & 0777) != 0500 ||
        observations[HELPER_SELF_FD].st_nlink != 1) {
        fail_stage("preflight", EXIT_PREFLIGHT, EACCES);
    }

    struct stat executed_helper;
    if (stat("/proc/self/exe", &executed_helper) != 0 ||
        !same_object(&observations[HELPER_SELF_FD], &executed_helper)) {
        fail_stage("preflight", EXIT_PREFLIGHT, ESTALE);
    }
    validate_mapped_directory("/workspace/source", &observations[4]);
    validate_mapped_directory("/state/target", &observations[5]);
    validate_child_beneath_workspace(3, "source", &observations[4]);
    validate_child_beneath_workspace(3, "target", &observations[5]);
}

static void validate_descriptors(void) {
    struct stat observations[9];
    inspect_descriptor(
        STATUS_FD,
        DESCRIPTOR_PIPE,
        O_WRONLY,
        "status-fd",
        EXIT_STATUS_FD,
        &observations[STATUS_FD]
    );
    status_fd_valid = true;

    inspect_descriptor(
        0,
        DESCRIPTOR_CHARACTER,
        O_RDONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[0]
    );
    inspect_descriptor(
        1,
        DESCRIPTOR_PIPE,
        O_WRONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[1]
    );
    inspect_descriptor(
        2,
        DESCRIPTOR_PIPE,
        O_WRONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[2]
    );
    inspect_descriptor(
        3,
        DESCRIPTOR_DIRECTORY,
        O_RDONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[3]
    );
    inspect_descriptor(
        4,
        DESCRIPTOR_DIRECTORY,
        O_RDONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[4]
    );
    inspect_descriptor(
        5,
        DESCRIPTOR_DIRECTORY,
        O_RDONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[5]
    );
    inspect_descriptor(
        CARGO_FD,
        DESCRIPTOR_REGULAR,
        O_RDONLY,
        "cargo-fd",
        EXIT_CARGO_FD,
        &observations[CARGO_FD]
    );
    inspect_descriptor(
        HELPER_SELF_FD,
        DESCRIPTOR_REGULAR,
        O_RDONLY,
        "preflight",
        EXIT_PREFLIGHT,
        &observations[HELPER_SELF_FD]
    );

    validate_open_file_descriptions();
    validate_descriptor_objects(observations);
}

static void apply_and_verify_cloexec(void) {
    for (int descriptor = CARGO_FD; descriptor <= HELPER_SELF_FD;
         descriptor += 1) {
        int flags = fcntl(descriptor, F_GETFD);
        if (flags < 0 || fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC) != 0) {
            fail_stage("status-cloexec", EXIT_STATUS_CLOEXEC, errno);
        }
    }
    for (int descriptor = 0; descriptor <= HELPER_SELF_FD; descriptor += 1) {
        int flags = fcntl(descriptor, F_GETFD);
        bool expected = descriptor >= CARGO_FD;
        if (flags < 0 || ((flags & FD_CLOEXEC) != 0) != expected) {
            fail_stage("status-cloexec", EXIT_STATUS_CLOEXEC, EINVAL);
        }
    }
}

int main(int argc, char **argv) {
    if (syscall(SYS_close_range, FIRST_UNEXPECTED_FD, UINT_MAX, 0U) != 0) {
        _exit(EXIT_PREFLIGHT);
    }
    if (normalize_sigpipe_for_cargo() != 0) {
        _exit(EXIT_PREFLIGHT);
    }
    validate_arguments(argc, argv);
    validate_descriptors();
    apply_and_verify_cloexec();

    const char ready[] = READY_FRAME;
    if (write_status_safely(ready, sizeof(ready) - 1U) < 0) {
        int observed_errno = errno;
        write_error_frame("ready-write", observed_errno, EXIT_READY_WRITE);
        _exit(EXIT_READY_WRITE);
    }

    (void)syscall(SYS_execveat, CARGO_FD, "", argv, environ, AT_EMPTY_PATH);
    int observed_errno = errno;
    write_error_frame("execveat", observed_errno, EXIT_EXECVEAT);
    _exit(EXIT_EXECVEAT);
}
