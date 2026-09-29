#!/usr/bin/env python3
"""Pressure-triggered incremental-cache cleanup; never removes Cargo lockfiles."""
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


def discover(repository):
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
                if cache.exists():
                    regular_path(cache.parent)
                    regular_path(cache)
                    found.append(cache)
    return found


def clean_one(cache, minimum_age, apply=False, now=None, expected_mount=None):
    cache = Path(cache)
    if not math.isfinite(minimum_age) or minimum_age < 3600:
        raise ValueError("Minimum age must be finite and at least one hour")
    regular_path(cache)
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
    for cache in discover(args.repository):
        try:
            if mount_id(cache, mount_table()) != pressure_mount:
                raise ValueError("Cache differs from pressure filesystem mount")
            _, newest = inventory(cache)
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
            result = clean_one(cache, args.minimum_age_hours * 3600, args.apply, expected_mount=pressure_mount)
        except (OSError, ValueError) as error:
            result = {"path": cache, "status": "skipped", "error": str(error), "bytes": 0}
        reclaimed += result["bytes"]
        print(json.dumps(result), flush=True)
    print(json.dumps({"status": "finished", "apply": args.apply,
                      "eligibleOrRemovedBytes": reclaimed, "beforeUsedPercent": before,
                      "afterUsedPercent": used_percent(args.repository)}))


if __name__ == "__main__":
    main()
