#!/usr/bin/python3
"""Install the verifier's candidate syscall policy and exec one command."""

import ctypes
import errno
import os
import sys


SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000
SCMP_CMP_MASKED_EQ = 7
CLONE_NEWUSER = 0x10000000
PR_SET_NO_NEW_PRIVS = 38


class ScmpArgCmp(ctypes.Structure):
    _fields_ = [
        ("arg", ctypes.c_uint),
        ("op", ctypes.c_int),
        ("datum_a", ctypes.c_uint64),
        ("datum_b", ctypes.c_uint64),
    ]


def errno_action(number):
    return SCMP_ACT_ERRNO | (number & 0xFFFF)


def install_policy():
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [
        ctypes.c_int,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise RuntimeError("no-new-privileges setup failed")

    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.POINTER(ScmpArgCmp),
    ]
    seccomp.seccomp_rule_add_array.restype = ctypes.c_int
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_load.restype = ctypes.c_int

    context = seccomp.seccomp_init(SCMP_ACT_ALLOW)
    if not context:
        raise RuntimeError("seccomp context setup failed")
    try:
        def syscall_number(name):
            number = seccomp.seccomp_syscall_resolve_name(name.encode("ascii"))
            return None if number < 0 else number

        def deny(name, error_number=errno.EPERM):
            number = syscall_number(name)
            if number is None:
                return
            if (
                seccomp.seccomp_rule_add_array(
                    context, errno_action(error_number), number, 0, None
                )
                != 0
            ):
                raise RuntimeError("seccomp rule setup failed")

        for name in (
            "fsconfig",
            "fsmount",
            "fsopen",
            "fspick",
            "mount",
            "mount_setattr",
            "move_mount",
            "open_tree",
            "pivot_root",
            "setns",
            "umount",
            "umount2",
            "unshare",
        ):
            deny(name)
        deny("clone3", errno.ENOSYS)

        clone = syscall_number("clone")
        if clone is None:
            raise RuntimeError("clone syscall resolution failed")
        comparison = ScmpArgCmp(
            arg=0,
            op=SCMP_CMP_MASKED_EQ,
            datum_a=CLONE_NEWUSER,
            datum_b=CLONE_NEWUSER,
        )
        if (
            seccomp.seccomp_rule_add_array(
                context,
                errno_action(errno.EPERM),
                clone,
                1,
                ctypes.byref(comparison),
            )
            != 0
        ):
            raise RuntimeError("clone rule setup failed")
        if seccomp.seccomp_load(context) != 0:
            raise RuntimeError("seccomp policy load failed")
    finally:
        seccomp.seccomp_release(context)


def main():
    if len(sys.argv) < 2 or not os.path.isabs(sys.argv[1]):
        raise RuntimeError("an absolute candidate command is required")
    install_policy()
    os.execve(sys.argv[1], sys.argv[1:], os.environ)


try:
    main()
except BaseException:
    os.write(2, b"candidate syscall filter setup failed\n")
    raise SystemExit(125)
