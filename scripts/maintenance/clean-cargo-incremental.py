#!/usr/bin/env python3
"""Pressure-triggered incremental-cache or archived RocksDB object cleanup; never removes Cargo lockfiles."""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time

# Only the inspected oxrocksdb-sys cc producer; other build scripts own unknown OUT_DIR contracts.
ROCKSDB_OUT = re.compile(r"oxrocksdb-sys-[0-9a-f]{16}")
ROCKSDB_ARCHIVES = ("liblz4.a", "liboxrocksdb_api.a", "librocksdb.a")
ROCKSDB_KEPT = {"bindings.rs", "flag_check", "flag_check.cpp", *ROCKSDB_ARCHIVES}


def mount_table():
    mounts = {}
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = line.split()
        path = re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), fields[4])
        mounts[path] = fields[0]
    return mounts


def mount_id(path, mounts):
    path = str(path)
    matches = [root for root in mounts if root == "/" or path == root or path.startswith(root + "/")]
    return mounts[max(matches, key=len)]


def regular_path(path, directory=True):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError(f"Noncanonical path: {path}")
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ValueError(f"Unexpected path type: {path}")
    return info


def inventory(path):
    """Reject links/mount crossings; count allocated bytes and most recent write."""
    root = regular_path(path)
    mounts = mount_table()
    newest, size = root.st_mtime, root.st_blocks * 512
    seen = {(root.st_dev, root.st_ino)}
    for base, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            entry = Path(base) / name
            info = entry.lstat()
            if str(entry) in mounts:
                raise ValueError(f"Mounted cache entry: {entry}")
            if info.st_dev != root.st_dev or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise ValueError(f"Unsafe cache entry: {entry}")
            if stat.S_ISREG(info.st_mode) and entry.suffix not in {".bin", ".o", ".bc", ".rmeta", ".lock"}:
                raise ValueError(f"Unknown compiler-cache file: {entry}")
            newest = max(newest, info.st_mtime)
            identity = (info.st_dev, info.st_ino)
            if identity not in seen:
                size += info.st_blocks * 512
                seen.add(identity)
    return size, newest


def discover(repository, objects=False):
    regular_path(repository)
    delivery = repository / "target/engineering-delivery"
    if not delivery.exists():
        return []
    regular_path(delivery)
    # Finite known allocation levels; no traversal of source, evidence or databases.
    roots = [delivery / "builds"]
    candidates = delivery / "candidates"
    if candidates.exists():
        regular_path(candidates)
        for candidate in sorted(candidates.glob("source-*")):
            regular_path(candidate)
            roots.append(candidate / "target/engineering-delivery/builds")
    found = []
    for root in roots:
        if not root.exists():
            continue
        regular_path(root)
        for allocation in sorted(root.iterdir()):
            regular_path(allocation)
            for profile in ("debug", "release"):
                cache = allocation / profile / "incremental"
                if objects and (cache.parent / "build").exists():
                    regular_path(cache.parent)
                    found.append(cache)
                elif not objects and cache.exists():
                    regular_path(cache.parent)
                    regular_path(cache)
                    found.append(cache)
    return found


def archive_listing(archive):
    """Member names from GNU ar; thin, unreadable or duplicate-member archives refuse."""
    with open(archive, "rb") as handle:
        if handle.read(8) != b"!<arch>\n":
            raise ValueError(f"Not a regular ar archive: {archive}")
    try:
        names = subprocess.run(["ar", "t", str(archive)], check=True, capture_output=True,
                               text=True, timeout=600).stdout.splitlines()
    except subprocess.SubprocessError as error:
        raise ValueError(f"Unreadable archive: {archive}") from error
    if len(set(names)) != len(names):
        raise ValueError(f"Duplicate archive members: {archive}")
    return names


def same_member(archive, name, path):
    """Stream `ar p` against the object in 1MiB chunks; truncation or any byte difference fails."""
    with open(path, "rb") as handle, subprocess.Popen(
            ["ar", "p", str(archive), name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        while (expected := handle.read(1 << 20)) == process.stdout.read(len(expected) or 1):
            if not expected:
                break
        else:
            process.kill()
            return False
    return process.returncode == 0


def archived_objects(out, minimum_age, now, expected_mount):
    """oxrocksdb-sys cc objects byte-identical to their unique member of that build's static archives."""
    regular_path(out)
    script = out.parent
    if not ROCKSDB_OUT.fullmatch(script.name):
        return None, "unsupported-producer"
    output, root = script / "output", script / "root-output"
    if not (output.is_file() and root.is_file()):
        return None, "incomplete-build-script"
    directives = output.read_text(errors="replace")
    # The inspected build script links exactly these archives and never an object directly.
    static = set(re.findall(r"^cargo:rustc-link-lib=static=(\S+)$", directives, re.M))
    if (root.read_text() != str(out) or static != {"lz4", "oxrocksdb_api", "rocksdb"}
            or re.search(r"\.o\b|^cargo:rustc-link-arg", directives, re.M)):
        return None, "unsupported-contract"
    entries = {path.name: path for path in out.iterdir()}
    objects = sorted(path for name, path in entries.items() if name.endswith(".o"))
    if not objects:
        return [], "no-objects"
    if set(entries) - {path.name for path in objects} != ROCKSDB_KEPT:
        return None, "unsupported-contract"
    mounts, device = mount_table(), out.lstat().st_dev
    infos = {path: regular_path(path, directory=False) for path in entries.values()}
    for path, info in infos.items():
        if (info.st_nlink != 1 or info.st_dev != device or str(path) in mounts
                or mount_id(path, mounts) != expected_mount):
            raise ValueError(f"Linked or mounted build output: {path}")
    # Any recent write in the build-script directory means possible current use.
    if now - max(path.lstat().st_mtime for path in [out, *entries.values(), *script.iterdir()]) < minimum_age:
        return None, "recent"
    owner = {}
    for archive in ROCKSDB_ARCHIVES:
        for name in archive_listing(entries[archive]):
            if name in owner:
                raise ValueError(f"Ambiguous archive member {name}: {out}")
            owner[name] = entries[archive]
    # Every archive member must have its object and vice versa; partial states stay untouched.
    if set(owner) != {path.name for path in objects}:
        return None, "unarchived"
    if not all(same_member(owner[path.name], path.name, path) for path in objects):
        return None, "content-differs"
    return [(path, infos[path]) for path in objects], "eligible"


def clean_one(cache, minimum_age, apply=False, now=None, expected_mount=None, objects=False):
    cache = Path(cache)
    if not math.isfinite(minimum_age) or minimum_age < 3600:
        raise ValueError("Minimum age must be finite and at least one hour")
    regular_path(cache.parent if objects else cache)
    lock = cache.parent / ".cargo-lock"
    mounts = mount_table()
    expected_mount = expected_mount or mount_id(cache, mounts)
    if any(mount_id(path, mounts) != expected_mount for path in (cache, cache.parent, lock)):
        raise ValueError("Cache/profile/lock differs from pressure filesystem mount")
    info = regular_path(lock, directory=False)
    # Cargo 1.98.1 Layout holds this flock during compilation (shared on newer
    # Cargo, exclusive on older Cargo). Keep its inode and profile directory.
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("Cargo lock changed while opening")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"path": str(cache), "status": "busy", "bytes": 0}
        current = lock.lstat()
        if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("Cargo lock replaced")
        if objects:
            return remove_archived_objects(cache.parent, minimum_age, apply,
                                           time.time() if now is None else now, expected_mount)
        size, newest = inventory(cache)
        if (time.time() if now is None else now) - newest < minimum_age:
            return {"path": str(cache), "status": "recent", "bytes": 0}
        entries = list(cache.iterdir())
        if apply:
            # Keep incremental itself too; Cargo creates new sessions on next use.
            # Only compiler cache children are removed. No executable/profile cleanup.
            for entry in entries:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
        return {"path": str(cache), "status": "cleaned" if apply else "eligible", "bytes": size}
    finally:
        os.close(fd)


def remove_archived_objects(profile, minimum_age, apply, now, expected_mount):
    build = profile / "build"
    results = {"path": str(profile), "status": "cleaned" if apply else "eligible", "bytes": 0, "objects": 0}
    if not build.exists():
        return {**results, "status": "no-build-outputs"}
    regular_path(build)
    for out in sorted(build.glob("oxrocksdb-sys-*/out")):
        if mount_id(out, mount_table()) != expected_mount:
            raise ValueError(f"Build output differs from pressure filesystem mount: {out}")
        objects, status = archived_objects(out, minimum_age, now, expected_mount)
        if objects is None:
            print(json.dumps({"path": str(out), "status": status, "bytes": 0}), flush=True)
            continue
        for path, verified in objects:
            current = path.lstat()
            if (current.st_ino, current.st_size, current.st_mtime_ns) != (
                    verified.st_ino, verified.st_size, verified.st_mtime_ns):
                raise ValueError(f"Object changed after comparison: {path}")
            results["bytes"] += current.st_blocks * 512
            results["objects"] += 1
            if apply:
                path.unlink()
    return results

def used_percent(path):
    usage = shutil.disk_usage(path)
    return 100 * (usage.total - usage.free) / usage.total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--minimum-age-hours", type=float, default=6)
    parser.add_argument("--trigger-percent", type=float, default=85)
    parser.add_argument("--stop-percent", type=float, default=80)
    parser.add_argument("--archived-build-objects", action="store_true",
                        help="Instead remove oxrocksdb-sys cc *.o byte-identical to its static archive member")
    args = parser.parse_args()
    if not (0 < args.stop_percent < args.trigger_percent < 100) or not math.isfinite(args.minimum_age_hours) or args.minimum_age_hours < 1:
        parser.error("Require 0 < stop < trigger < 100 and minimum age >= 1 hour")
    regular_path(args.repository)
    pressure_mount = mount_id(args.repository, mount_table())
    filesystem = subprocess.check_output(
        ["findmnt", "-n", "-o", "FSTYPE", "--target", str(args.repository)], text=True).strip()
    if filesystem not in {"ext4", "xfs", "btrfs", "tmpfs", "overlay"}:
        parser.error(f"Unverified filesystem locking: {filesystem}")
    before = used_percent(args.repository)
    if before < args.trigger_percent:
        print(json.dumps({"status": "below-pressure-trigger", "usedPercent": before}))
        return
    eligible = []
    skipped = []
    for cache in discover(args.repository, args.archived_build_objects):
        try:
            if mount_id(cache, mount_table()) != pressure_mount:
                raise ValueError("Cache differs from pressure filesystem mount")
            newest = cache.parent.stat().st_mtime if args.archived_build_objects else inventory(cache)[1]
            eligible.append((newest, str(cache)))
        except (OSError, ValueError) as error:
            skipped.append({"path": str(cache), "status": "unsafe", "error": str(error)})
    for result in skipped:
        print(json.dumps(result), flush=True)
    reclaimed = 0
    for _, cache in sorted(eligible):
        if args.apply and used_percent(args.repository) <= args.stop_percent:
            break
        try:
            result = clean_one(cache, args.minimum_age_hours * 3600, args.apply, expected_mount=pressure_mount,
                               objects=args.archived_build_objects)
        except (OSError, ValueError) as error:
            result = {"path": cache, "status": "skipped", "error": str(error), "bytes": 0}
        reclaimed += result["bytes"]
        print(json.dumps(result), flush=True)
    print(json.dumps({"status": "finished", "apply": args.apply,
                      "eligibleOrRemovedBytes": reclaimed, "beforeUsedPercent": before,
                      "afterUsedPercent": used_percent(args.repository)}))


if __name__ == "__main__":
    main()
