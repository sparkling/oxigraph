#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define TEST_O_LARGEFILE 0100000

static void die(const char *message) {
    (void)fprintf(stderr, "native fixture: %s\n", message);
    exit(127);
}

static void exact_write(int descriptor, const void *bytes, size_t length) {
    const unsigned char *cursor = bytes;
    while (length > 0U) {
        ssize_t written = write(descriptor, cursor, length);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) die("write failed");
        cursor += (size_t)written;
        length -= (size_t)written;
    }
}

static void copy_to(int source, int target) {
    if (dup2(source, target) != target) die("dup2 failed");
}

static int high_copy(int descriptor) {
    int copied = fcntl(descriptor, F_DUPFD_CLOEXEC, 64);
    if (copied < 0) die("high descriptor copy failed");
    return copied;
}

static void stream_copy(int source, int target) {
    unsigned char bytes[4096];
    size_t total = 0U;
    for (;;) {
        ssize_t count = read(source, bytes, sizeof(bytes));
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) die("readback failed");
        if (count == 0) return;
        total += (size_t)count;
        if (total > 16384U) die("bounded readback exceeded");
        exact_write(target, bytes, (size_t)count);
    }
}

int main(int argc, char **argv) {
    int controller[2] = {-1, -1};
    int wrong_controller[2] = {-1, -1};
    int unconnected_controller = -1;
    int status_pipe[2] = {-1, -1};
    int diagnostic_pipe[2] = {-1, -1};
    int epoch_pipe[2] = {-1, -1};
    int recovery_pipe[2] = {-1, -1};
    int roots[3] = {-1, -1, -1};
    int supervisor = -1;
    int guardian = -1;
    int extra = -1;
    pid_t child;
    int child_status = 0;
    int recovery;
    int short_epoch;
    int extra_fd;
    int wrong_kind;
    int trailing_request;
    int closed_diagnostics;
    int alias_identity;
    int trailing_command;
    int wrong_flags;
    int unconnected;
    int pass_credentials = 1;
    const unsigned char epoch[32] = {
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
        0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
    };

    if (argc != 3) die("expected guardian path and scenario");
    recovery = strcmp(argv[2], "recovery-terminal") == 0 ||
               strcmp(argv[2], "recovery-trailing-request") == 0;
    short_epoch = strcmp(argv[2], "normal-short-epoch") == 0 ||
                  strcmp(argv[2], "normal-closed-diagnostics") == 0;
    extra_fd = strcmp(argv[2], "normal-extra-fd") == 0;
    wrong_kind = strcmp(argv[2], "normal-wrong-controller-kind") == 0;
    trailing_request = strcmp(argv[2], "recovery-trailing-request") == 0;
    closed_diagnostics = strcmp(argv[2], "normal-closed-diagnostics") == 0;
    alias_identity = strcmp(argv[2], "normal-aliased-descriptors") == 0;
    trailing_command = strcmp(argv[2], "normal-trailing-command") == 0;
    wrong_flags = strcmp(argv[2], "normal-wrong-status-flags") == 0;
    unconnected = strcmp(argv[2], "normal-unconnected-controller") == 0;

    if (
        strcmp(argv[2], "normal-provisional-failure") != 0 && !recovery &&
        !short_epoch && !extra_fd && !wrong_kind && !closed_diagnostics &&
        !alias_identity && !trailing_command && !wrong_flags && !unconnected
    ) {
        die("unknown scenario");
    }

    if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, controller) != 0) {
        die("socketpair failed");
    }
    if (
        setsockopt(
            controller[1],
            SOL_SOCKET,
            SO_PASSCRED,
            &pass_credentials,
            sizeof(pass_credentials)
        ) != 0
    ) {
        die("SO_PASSCRED failed");
    }
    unconnected_controller = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
    if (unconnected_controller < 0 ||
        setsockopt(
            unconnected_controller,
            SOL_SOCKET,
            SO_PASSCRED,
            &pass_credentials,
            sizeof(pass_credentials)
        ) != 0) {
        die("unconnected controller setup failed");
    }
    if (
        pipe2(wrong_controller, O_CLOEXEC) != 0 ||
        pipe2(status_pipe, O_CLOEXEC) != 0 ||
        pipe2(diagnostic_pipe, O_CLOEXEC) != 0 ||
        pipe2(epoch_pipe, O_CLOEXEC) != 0 ||
        pipe2(recovery_pipe, O_CLOEXEC) != 0
    ) {
        die("pipe2 failed");
    }
    if (
        mkdir("state-root", 0700) != 0 ||
        mkdir("delegated-root", 0700) != 0 ||
        mkdir("lifetime-root", 0700) != 0
    ) {
        die("fixture root creation failed");
    }
    roots[0] = open(
        "state-root", O_RDONLY | O_CLOEXEC | O_DIRECTORY | TEST_O_LARGEFILE
    );
    roots[1] = open(
        "delegated-root",
        O_RDONLY | O_CLOEXEC |
        (wrong_flags ? 0 : O_DIRECTORY | TEST_O_LARGEFILE)
    );
    roots[2] = open(
        "lifetime-root", O_RDONLY | O_CLOEXEC | O_DIRECTORY | TEST_O_LARGEFILE
    );
    if (roots[0] < 0 || roots[1] < 0 || roots[2] < 0) die("root open failed");
    if (flock(roots[0], LOCK_EX | LOCK_NB) != 0) die("root lock failed");
    supervisor = open("/bin/true", O_RDONLY | O_CLOEXEC | TEST_O_LARGEFILE);
    guardian = open(argv[1], O_RDONLY | O_CLOEXEC);
    if (supervisor < 0 || guardian < 0) die("executable open failed");
    if (extra_fd) {
        extra = open("/dev/null", O_RDONLY | O_CLOEXEC);
        if (extra < 0) die("extra descriptor open failed");
    }

    if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0) {
        die("subreaper setup failed");
    }
    child = fork();
    if (child < 0) die("fork failed");
    if (child == 0) {
        int source[8];
        int high[8];
        int guardian_high;
        int index;
        source[0] = recovery ? recovery_pipe[0] :
                    (wrong_kind ? wrong_controller[0] :
                    (unconnected ? unconnected_controller : controller[1]));
        source[1] = status_pipe[1];
        source[2] = diagnostic_pipe[1];
        source[3] = roots[0];
        if (setpgid(0, 0) != 0) _exit(127);
        source[4] = alias_identity ? roots[0] : roots[1];
        source[5] = roots[2];
        source[6] = epoch_pipe[0];
        source[7] = supervisor;
        for (index = 0; index < (recovery ? 7 : 8); index += 1) {
            high[index] = high_copy(source[index]);
        }
        guardian_high = high_copy(guardian);
        for (index = 0; index < (recovery ? 7 : 8); index += 1) {
            copy_to(high[index], index);
        }
        if (extra_fd) copy_to(extra, 8);
        syscall(SYS_execveat, guardian_high, "", (char *const[]){argv[1], NULL},
                (char *const[]){NULL}, AT_EMPTY_PATH);
        _exit(127);
    }

    (void)close(controller[1]);
    (void)close(unconnected_controller);
    (void)close(wrong_controller[0]);
    (void)close(status_pipe[1]);
    (void)close(diagnostic_pipe[1]);
    (void)close(epoch_pipe[0]);
    (void)close(recovery_pipe[0]);
    if (closed_diagnostics) {
        (void)close(diagnostic_pipe[0]);
        diagnostic_pipe[0] = -1;
    }

    exact_write(epoch_pipe[1], epoch, short_epoch ? 31U : sizeof(epoch));
    (void)close(epoch_pipe[1]);
    if (recovery) {
        static const char request[] = "RECOVERY\n";
        exact_write(recovery_pipe[1], request, sizeof(request) - 1U);
        if (trailing_request) exact_write(recovery_pipe[1], "X", 1U);
        (void)close(recovery_pipe[1]);
    } else if (wrong_kind) {
        (void)close(wrong_controller[1]);
    } else if (short_epoch || unconnected) {
        if (unconnected) (void)close(controller[0]);
        else (void)shutdown(controller[0], SHUT_WR);
    } else {
        exact_write(controller[0], trailing_command ? "FX" : "F",
                    trailing_command ? 2U : 1U);
        if (shutdown(controller[0], SHUT_WR) != 0) die("controller shutdown failed");
    }

    stream_copy(status_pipe[0], STDOUT_FILENO);
    if (diagnostic_pipe[0] >= 0) stream_copy(diagnostic_pipe[0], STDERR_FILENO);
    if (waitpid(child, &child_status, 0) != child) die("guardian wait failed");
    errno = 0;
    if (kill(-child, 0) == 0 || errno == EPERM) {
        int descendant_status;
        (void)kill(-child, SIGKILL);
        while (waitpid(-1, &descendant_status, 0) < 0 && errno == EINTR) {}
        return 124;
    }
    if (errno != ESRCH) die("process-group audit failed");
    if (WIFEXITED(child_status)) return WEXITSTATUS(child_status);
    if (WIFSIGNALED(child_status)) return 128 + WTERMSIG(child_status);
    return 127;
}
