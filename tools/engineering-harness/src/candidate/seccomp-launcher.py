#!/usr/bin/python3
"""Install the verifier's candidate syscall policy and exec one command."""

import ctypes
import base64
import errno
import hashlib
import json
import os
import re
import sys


SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000
SCMP_CMP_MASKED_EQ = 7
CLONE_NEWUSER = 0x10000000
PR_SET_NO_NEW_PRIVS = 38
PR_GET_PDEATHSIG = 2
PR_SET_PDEATHSIG = 1
ATTESTATION_SCHEMA = "oxigraph.g1.7-native-command-launch-attestation/v2"
DENIED_SYSCALLS = (
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
    "umount2",
    "unshare",
)


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

        syscall_numbers = {}
        for name in DENIED_SYSCALLS:
            syscall_numbers[name] = syscall_number(name)
            deny(name)
        syscall_numbers["clone3"] = syscall_number("clone3")
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
        prctl = syscall_number("prctl")
        if prctl is None:
            raise RuntimeError("prctl syscall resolution failed")
        comparison = ScmpArgCmp(
            arg=0,
            op=SCMP_CMP_MASKED_EQ,
            datum_a=0xFFFFFFFFFFFFFFFF,
            datum_b=PR_SET_PDEATHSIG,
        )
        if (
            seccomp.seccomp_rule_add_array(
                context,
                errno_action(errno.EPERM),
                prctl,
                1,
                ctypes.byref(comparison),
            )
            != 0
        ):
            raise RuntimeError("parent-death-signal rule setup failed")
        if seccomp.seccomp_load(context) != 0:
            raise RuntimeError("seccomp policy load failed")
        syscall_numbers["clone-newuser"] = clone
        syscall_numbers["prctl-clear-pdeathsig"] = prctl
        return syscall_numbers
    finally:
        seccomp.seccomp_release(context)


def negative_syscall_probes(syscall_numbers):
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    results = []
    recipes = [("clone-newuser", errno.EPERM), ("clone3", errno.ENOSYS)]
    recipes.extend((name, errno.EPERM) for name in DENIED_SYSCALLS)
    recipes.append(("prctl-clear-pdeathsig", errno.EPERM))
    for name, expected_errno in recipes:
        number = syscall_numbers.get(name)
        if number is None or number < 0:
            raise RuntimeError("denied syscall cannot be resolved")
        ctypes.set_errno(0)
        if name == "clone-newuser":
            observed = libc.syscall(
                number,
                ctypes.c_ulonglong(CLONE_NEWUSER | (1 << 63)),
                0,
                0,
                0,
                0,
            )
        elif name == "prctl-clear-pdeathsig":
            observed = libc.syscall(
                number,
                ctypes.c_ulonglong(PR_SET_PDEATHSIG),
                0,
                0,
                0,
                0,
                0,
            )
        else:
            observed = libc.syscall(number, 0, 0, 0, 0, 0, 0)
        observed_errno = ctypes.get_errno()
        if observed != -1 or observed_errno != expected_errno:
            raise RuntimeError("denied syscall negative probe failed")
        results.append({
            "name": name,
            "syscallNumber": number,
            "observedReturn": observed,
            "errno": observed_errno,
        })
    return results


def raw_bytes(path, ceiling):
    with open(path, "rb", buffering=0) as handle:
        value = handle.read(ceiling + 1)
    if len(value) < 1 or len(value) > ceiling:
        raise RuntimeError("command attestation input exceeded its byte ceiling")
    return {
        "bytes": len(value),
        "sha256": hashlib.sha256(value).hexdigest(),
        "base64": base64.b64encode(value).decode("ascii"),
    }


def cgroup_identity():
    with open("/proc/self/cgroup", "rb", buffering=0) as handle:
        value = handle.read(4 * 1024 + 1)
    try:
        text = value.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise RuntimeError("command cgroup membership is not UTF-8") from error
    if (
        len(value) < 5
        or len(value) > 4 * 1024
        or text.count("\n") != 1
        or not text.endswith("\n")
        or re.fullmatch(r"0::/[A-Za-z0-9_.@:/-]*\n", text) is None
    ):
        raise RuntimeError("command is not in one cgroup-v2 hierarchy")
    relative = text[3:-1]
    if "//" in relative or any(part in (".", "..") for part in relative.split("/")):
        raise RuntimeError("command cgroup membership is unsafe")
    return {
        "hierarchy": "v2",
        "membershipSha256": hashlib.sha256(value).hexdigest(),
    }


def namespace_set():
    return {
        "ipc": os.readlink("/proc/self/ns/ipc"),
        "mount": os.readlink("/proc/self/ns/mnt"),
        "network": os.readlink("/proc/self/ns/net"),
        "pid": os.readlink("/proc/self/ns/pid"),
        "user": os.readlink("/proc/self/ns/user"),
        "uts": os.readlink("/proc/self/ns/uts"),
    }


def write_attestation(fd, name, syscall_numbers):
    parent_death_signal = ctypes.c_int(0)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_GET_PDEATHSIG, ctypes.byref(parent_death_signal), 0, 0, 0) != 0:
        raise RuntimeError("parent-death signal observation failed")
    value = {
        "schema": ATTESTATION_SCHEMA,
        "name": name,
        "status": raw_bytes("/proc/self/status", 16 * 1024),
        "limits": raw_bytes("/proc/self/limits", 16 * 1024),
        "cgroup": cgroup_identity(),
        "cmdline": raw_bytes("/proc/self/cmdline", 64 * 1024),
        "environ": raw_bytes("/proc/self/environ", 64 * 1024),
        "namespaces": namespace_set(),
        "process": {
            "pid": str(os.getpid()),
            "parentPid": str(os.getppid()),
            "processGroup": str(os.getpgid(0)),
            "session": str(os.getsid(0)),
        },
        "parentDeathSignal": parent_death_signal.value,
        "negativeProbes": negative_syscall_probes(syscall_numbers),
    }
    serialized = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(serialized) > 128 * 1024:
        raise RuntimeError("command attestation exceeded its byte ceiling")
    offset = 0
    while offset < len(serialized):
        offset += os.write(fd, serialized[offset:])
    os.close(fd)


def main():
    attestation = None
    command_index = 1
    if len(sys.argv) >= 7 and sys.argv[1:3] == ["--attest-fd", "3"]:
        if (
            sys.argv[3] != "--attest-name"
            or not sys.argv[4]
            or sys.argv[5] != "--"
        ):
            raise RuntimeError("invalid command-attestation arguments")
        attestation = (3, sys.argv[4])
        command_index = 6
    if len(sys.argv) <= command_index or not os.path.isabs(sys.argv[command_index]):
        raise RuntimeError("an absolute candidate command is required")
    syscall_numbers = install_policy()
    if attestation is not None:
        write_attestation(*attestation, syscall_numbers)
    os.execve(sys.argv[command_index], sys.argv[command_index:], os.environ)


try:
    main()
except BaseException:
    os.write(2, b"candidate syscall filter setup failed\n")
    raise SystemExit(125)
