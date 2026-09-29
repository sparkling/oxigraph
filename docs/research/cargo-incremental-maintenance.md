# Cargo incremental maintenance

September 29, 2026: automatic hourly pressure check, with a six-hour minimum
cache age. Start at 85% filesystem bytes used; remove coldest eligible incremental
caches until usage reaches 80%. These percentages use filesystem total/free bytes;
`df` includes reserved blocks differently. Active compilation is skipped without
waiting. Cache age controls reuse cost, not safety.
Six hours preserves caches across several-hour author/check/review cycles. After
the initial reclaim, a two-hour dry-run would additionally remove12.79GiB from
six recently used service/lifecycle allocations, still without reaching80%.
The installed policy retains six hours to limit recompilation while about69GiB
of headroom is available; it does not lower retention to make an alert green.

Only `debug/incremental` and `release/incremental` beneath these allocations qualify:

- `target/engineering-delivery/builds/*`
- `target/engineering-delivery/candidates/source-*/target/engineering-delivery/builds/*`

The cleaner preserves profile directories and every Cargo lock inode. It takes
exclusive nonblocking `flock` on the existing `.cargo-lock` before rechecking age
and deleting compiler-cache children. Cargo 1.98.1 on the GCP host, commit
`797e8a9bca276c1c9f9f738d2a20f484fa4eea9d`, holds this lock during compilation;
newer shared-lock use also conflicts with this cleaner's exclusive lock.
New Cargo admission waits on that same retained inode. No separate ownership
registry or per-lane retirement action is needed.

Sources, logs, receipts, patches, `.fingerprint`, `deps`, build-script outputs,
executables and databases remain untouched. Unknown cache file suffixes, symlinks,
mount crossings and missing/replaced lockfiles cause refusal. Only verified local
filesystem types are supported. Direct `rustc` use that bypasses Cargo locking,
manual replacement of profile/lock directories, or moving unrelated data into
`incremental` is outside this contract. Compiler caches can be rebuilt even for
pending lanes; compiled binaries remain available to active tests and reviewers.

This is not a disk quota. If recent/locked caches or retained compiled outputs fill
the disk, the cleaner reports the remaining usage; it never broadens deletion.

## Operator commands

Dry-run (same eligibility and locks; no deletion):

```sh
python3 scripts/maintenance/clean-cargo-incremental.py --repository /srv/home/claude/src/hm/oxigraph
```

Installed admin copy lives outside the active checkout at
`/srv/home/claude/.local/lib/oxigraph-maintenance/clean-cargo-incremental.py`.
User units come from `config/systemd/oxigraph-incremental-cleanup.{service,timer}`.
User lingering keeps the timer available after logout.
Installed and enabled on GCP September29,2026. First run cleaned24 cold caches,
completed successfully, and increased observed free space by38,806,593,536 bytes
(36.14GiB) while builds continued. Available space became73,005,961,216 bytes
(67.99GiB); usage93.67% became86.48%. Remaining recent caches prevented80% target.
Sample lock inode10651224 survived unchanged. Initial per-cache byte sum43.17GB
double-counted hardlinks; accounting now counts each inode once within each cache.
Final deployed script SHA256:
`f0ff53778c368cd5346924e4efa81835d3a5661d3030894c466186af90640869`.

```sh
systemctl --user status oxigraph-incremental-cleanup.timer
journalctl --user -u oxigraph-incremental-cleanup.service
systemctl --user disable --now oxigraph-incremental-cleanup.timer
```

Validation: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/maintenance`.
Includes a real small offline Cargo compilation, shared/exclusive lock contention,
preserved lock identity and noncache artifacts, dry-run, cold age, path discovery,
symlink refusal, mount identity/bind-mount refusal, finite-age validation, hardlink
accounting and unknown database retention. Ten tests pass. Independent source
review cleared after mount-binding/nonfinite-age findings were fixed. Real GCP
dry-run also skipped an active SHACL build as busy. No product Rust code changes.

## Research and choice

- [Cargo clean documentation](https://doc.rust-lang.org/cargo/commands/cargo-clean.html):
  default deletes the whole target directory, which contains our evidence.
- [Cargo clean source](https://github.com/rust-lang/cargo/blob/797e8a9bca276c1c9f9f738d2a20f484fa4eea9d/src/cargo/ops/cargo_clean.rs):
  whole-directory/profile cleaning deliberately does not acquire a lock.
- [Cargo layout and locking](https://github.com/rust-lang/cargo/blob/797e8a9bca276c1c9f9f738d2a20f484fa4eea9d/src/cargo/core/compiler/layout.rs):
  documents incremental compiler caches and compatibility `.cargo-lock`.
- [cargo-sweep](https://github.com/holmgr/cargo-sweep): age/toolchain/size-based pruning;
  upstream README currently says unmaintained and recommends cargo-clean-all.
- [cargo-clean-all](https://github.com/dnlmlr/cargo-clean-all): age and size filters,
  but deletion covers whole detected target directories, unsuitable here.
- [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html):
  standard persistent calendar scheduling; no agent or bespoke scheduler needed.
