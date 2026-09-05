#define _GNU_SOURCE 1

#include <errno.h>
#include <fcntl.h>
#include <linux/limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef P_PIDFD
#define P_PIDFD 3
#endif

#define MAX_IMAGE_BYTES (8U * 1024U * 1024U)

static void fail(const char *stage) {
    dprintf(STDERR_FILENO, "S1_DRIVER_FAIL %s %d\n", stage, errno);
    _exit(2);
}

static unsigned char *read_exact_image(int fd, size_t size) {
    unsigned char *bytes;
    size_t offset = 0U;
    if (size == 0U || size > MAX_IMAGE_BYTES) {
        errno = EFBIG;
        fail("image-size");
    }
    bytes = malloc(size);
    if (bytes == NULL) fail("malloc");
    while (offset < size) {
        ssize_t count = pread(fd, bytes + offset, size - offset, (off_t)offset);
        if (count <= 0) fail("pread-image");
        offset += (size_t)count;
    }
    return bytes;
}

static void child_exec(int held_fd, int outcome_write) {
    static char *const child_argv[] = {(char *)"s1-held-image", NULL};
    static char *const child_env[] = {(char *)"LANG=C.UTF-8", (char *)"LC_ALL=C.UTF-8", NULL};
    uint32_t error_record[4];
    pid_t parent = getppid();
    if (parent <= 1) _exit(118);
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0) _exit(119);
    if (getppid() != parent) _exit(118);
    if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) != 0) _exit(120);
    if (kill(getpid(), SIGSTOP) != 0) _exit(121);
    (void)syscall(SYS_execveat, held_fd, "", child_argv, child_env, AT_EMPTY_PATH);
    error_record[0] = 0x5845584fU;
    error_record[1] = (uint32_t)errno;
    error_record[2] = 9U;
    error_record[3] = 0U;
    if (write(outcome_write, error_record, sizeof(error_record)) < 0) _exit(122);
    _exit(127);
}

int main(int argc, char **argv) {
    int held_fd;
    int outcome[2];
    int pidfd;
    pid_t child;
    int status;
    int trace_count = 0;
    int positive_exec = 0;
    int outcome_eof = 0;
    int pidfd_readable = 0;
    int pidfd_hup = 0;
    int second_wait_echild = 0;
    int path_substituted = 0;
    struct user_regs_struct registers;
    struct stat held_stat;
    struct stat live_stat;
    char proc_path[64];
    int proc_fd;
    unsigned char *held_bytes;
    unsigned char *live_bytes;
    struct pollfd descriptor;
    siginfo_t info;
    siginfo_t second;
    char outcome_byte;

    if (argc != 2 && argc != 3) {
        errno = EINVAL;
        fail("argv");
    }
    held_fd = open(argv[1], O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (held_fd < 0) fail("open-held");
    if (fstat(held_fd, &held_stat) != 0 || !S_ISREG(held_stat.st_mode)) fail("fstat-held");
    if (argc == 3) {
        if (rename(argv[2], argv[1]) != 0) fail("replace-pathname");
        path_substituted = 1;
    }
    if (pipe2(outcome, O_CLOEXEC) != 0) fail("pipe2");
    child = fork();
    if (child < 0) fail("fork");
    if (child == 0) {
        close(outcome[0]);
        child_exec(held_fd, outcome[1]);
    }
    close(outcome[1]);
    pidfd = (int)syscall(SYS_pidfd_open, child, 0U);
    if (pidfd < 0) fail("pidfd-open");
    if (waitpid(child, &status, WUNTRACED) != child || !WIFSTOPPED(status) || WSTOPSIG(status) != SIGSTOP) {
        errno = EPROTO;
        fail("initial-stop");
    }
    if (ptrace(PTRACE_SETOPTIONS, child, NULL,
               (void *)(uintptr_t)(PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL | PTRACE_O_TRACESYSGOOD)) != 0) {
        fail("ptrace-options");
    }
    if (ptrace(PTRACE_SYSCALL, child, NULL, NULL) != 0) fail("ptrace-syscall-entry");
    if (waitpid(child, &status, __WALL) != child || !WIFSTOPPED(status) ||
        WSTOPSIG(status) != (SIGTRAP | 0x80)) {
        errno = EPROTO;
        fail("syscall-entry-stop");
    }
    if (ptrace(PTRACE_GETREGS, child, NULL, &registers) != 0) fail("getregs");
    if ((long)registers.orig_rax != SYS_execveat) {
        errno = EPROTO;
        fail("unexpected-pre-exec-syscall");
    }
    trace_count = 1;
    if (ptrace(PTRACE_SYSCALL, child, NULL, NULL) != 0) fail("ptrace-exec-event");
    for (int attempts = 0; attempts < 3 && !positive_exec; attempts += 1) {
        unsigned int event;
        if (waitpid(child, &status, __WALL) != child || !WIFSTOPPED(status)) {
            errno = EPROTO;
            fail("exec-event-stop");
        }
        event = (unsigned int)status >> 16;
        if (WSTOPSIG(status) == SIGTRAP && event == PTRACE_EVENT_EXEC) {
            positive_exec = 1;
            break;
        }
        if (WSTOPSIG(status) != (SIGTRAP | 0x80) ||
            ptrace(PTRACE_SYSCALL, child, NULL, NULL) != 0) {
            errno = EPROTO;
            fail("unexpected-trace-event");
        }
    }
    if (!positive_exec) {
        errno = EPROTO;
        fail("missing-exec-event");
    }
    if (snprintf(proc_path, sizeof(proc_path), "/proc/%ld/exe", (long)child) <= 0) fail("proc-path");
    if (stat(proc_path, &live_stat) != 0) fail("stat-live-image");
    proc_fd = open(proc_path, O_RDONLY | O_CLOEXEC);
    if (proc_fd < 0) fail("open-live-image");
    if (held_stat.st_dev != live_stat.st_dev || held_stat.st_ino != live_stat.st_ino ||
        held_stat.st_size != live_stat.st_size) {
        errno = ESTALE;
        fail("live-identity-mismatch");
    }
    held_bytes = read_exact_image(held_fd, (size_t)held_stat.st_size);
    live_bytes = read_exact_image(proc_fd, (size_t)live_stat.st_size);
    if (memcmp(held_bytes, live_bytes, (size_t)held_stat.st_size) != 0) {
        errno = ESTALE;
        fail("live-byte-mismatch");
    }
    free(held_bytes);
    free(live_bytes);
    close(proc_fd);
    if (read(outcome[0], &outcome_byte, 1U) == 0) outcome_eof = 1;
    if (!outcome_eof) {
        errno = EPROTO;
        fail("outcome-not-eof");
    }
    if (ptrace(PTRACE_DETACH, child, NULL, NULL) != 0) fail("ptrace-detach");

    memset(&descriptor, 0, sizeof(descriptor));
    descriptor.fd = pidfd;
    descriptor.events = POLLIN | POLLHUP;
    if (poll(&descriptor, 1U, 5000) != 1) fail("pidfd-poll-readable");
    pidfd_readable = (descriptor.revents & POLLIN) != 0;
    memset(&info, 0, sizeof(info));
    if (waitid((idtype_t)P_PIDFD, (id_t)pidfd, &info, WEXITED) != 0) fail("waitid-pidfd");
    descriptor.events = POLLHUP;
    descriptor.revents = 0;
    if (poll(&descriptor, 1U, 1000) == 1) pidfd_hup = (descriptor.revents & POLLHUP) != 0;
    memset(&second, 0, sizeof(second));
    errno = 0;
    if (waitid((idtype_t)P_PIDFD, (id_t)pidfd, &second, WEXITED | WNOHANG) < 0 && errno == ECHILD) {
        second_wait_echild = 1;
    }

    dprintf(STDOUT_FILENO, "SCHEMA oxigraph.adr38-s1-safe-local-launch/v1\n");
    dprintf(STDOUT_FILENO, "PATH_SUBSTITUTED %d\n", path_substituted);
    dprintf(STDOUT_FILENO, "TRACE_COUNT %d\n", trace_count);
    dprintf(STDOUT_FILENO, "TRACE_SYSCALL %ld\n", (long)SYS_execveat);
    dprintf(STDOUT_FILENO, "POSITIVE_EXEC_STOP %d\n", positive_exec);
    dprintf(STDOUT_FILENO, "OUTCOME_EOF %d\n", outcome_eof);
    dprintf(STDOUT_FILENO, "HELD_DEVICE %llu\n", (unsigned long long)held_stat.st_dev);
    dprintf(STDOUT_FILENO, "HELD_INODE %llu\n", (unsigned long long)held_stat.st_ino);
    dprintf(STDOUT_FILENO, "HELD_BYTES %llu\n", (unsigned long long)held_stat.st_size);
    dprintf(STDOUT_FILENO, "LIVE_DEVICE %llu\n", (unsigned long long)live_stat.st_dev);
    dprintf(STDOUT_FILENO, "LIVE_INODE %llu\n", (unsigned long long)live_stat.st_ino);
    dprintf(STDOUT_FILENO, "LIVE_BYTES %llu\n", (unsigned long long)live_stat.st_size);
    dprintf(STDOUT_FILENO, "INDEPENDENT_BYTES_EQUAL 1\n");
    dprintf(STDOUT_FILENO, "PIDFD_ORIGIN pidfd_open-safe-local-not-clone3\n");
    dprintf(STDOUT_FILENO, "PIDFD_READABLE %d\n", pidfd_readable);
    dprintf(STDOUT_FILENO, "PIDFD_HUP %d\n", pidfd_hup);
    dprintf(STDOUT_FILENO, "WAITID_IDTYPE P_PIDFD\n");
    dprintf(STDOUT_FILENO, "WAITID_CODE %d\n", info.si_code);
    dprintf(STDOUT_FILENO, "WAITID_STATUS %d\n", info.si_status);
    dprintf(STDOUT_FILENO, "SECOND_WAIT_ECHILD %d\n", second_wait_echild);

    close(outcome[0]);
    close(pidfd);
    close(held_fd);
    if (!pidfd_readable || !second_wait_echild) return 3;
    return 0;
}
