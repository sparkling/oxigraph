# Cargo incremental maintenance

## Preventing new build bloat (October 1, 2026)

Ordinary workflows create separate retained candidate targets. Previously Cargo
defaults generated full Rust debug data and incremental caches in each one.
Workspace dev/test builds now use `debug = 1`, `incremental = false`; test
inherits dev. Bundled `oxrocksdb-sys` uses `debug = 0`, also making its build-script
`DEBUG=false` so cc does not generate C++ debug data. Rust limited debug retains
backtrace information, not full variable/type inspection. Assertions, overflow
checks, optimization and release/bench settings are unchanged. Frozen qualification
environment overrides and historical receipts remain untouched.

This reduces generation, not retention. Private targets remain necessary to avoid
concurrent crash tests reopening replaced executables. Existing sources, archives,
binaries and receipts are not deleted or silently retired. Existing timer still
reclaims only proven disposable caches/redundant objects. Distinct dependency
graphs still accumulate; no bounded-storage or measured savings claim follows.
Validate actual Cargo profile inheritance/build-script environment with the small
offline fixture in `tests/maintenance/test_cargo_storage_profile.py`; no RocksDB
rebuild or semantic benchmark is required for that configuration check.
Cargo authority: https://doc.rust-lang.org/cargo/reference/profiles.html .

September 29, 2026: automatic hourly pressure check, with a six-hour minimum
cache age. Start at 85% filesystem bytes used; remove coldest eligible incremental
caches until usage reaches 80%. These percentages use filesystem total/free bytes;
`df` includes reserved blocks differently. Active compilation is skipped without
waiting. Cache age controls reuse cost, not safety.
Six hours preserves caches across several-hour author/check/review cycles. After
the initial reclaim, a two-hour dry-run would additionally remove12.79GiB from
six recently used service/lifecycle allocations, still without reaching80%.
The policy retains six hours to limit recompilation; it does not lower retention
to make an alert green. September29 root check found75% used and123GiB free.

Only `debug/incremental` and `release/incremental` beneath these allocations qualify:

- `target/engineering-delivery/builds/*`
- `target/engineering-delivery/candidates/source-*/target/engineering-delivery/builds/*`
- `target` and `target/engineering-delivery/candidates/source-*/target`
- `target/wasm32-unknown-unknown` (the exact canonical cross-compile target)
- `target-lanes/*` (when operating on the Query runtime crate)

October 1 local audit found the old discovery returned early without an
engineering-delivery directory and missed canonical caches: Oxigraph 68.64 GiB,
Fabric 125.16 GiB, Query canonical/lanes 118.12 GiB eligible in dry runs.
Discovery now covers those fixed layouts with unchanged lock/age/mount checks.
Custom qualification targets and lane recovery artifacts stay excluded. Fabric
and Query now use matching dev/test generation defaults; each crate/workspace
owns its own profile, independent of dependency workspace profiles. Real offline
Cargo graphs verify limited debug, no incremental, unchanged assertions/overflow.
22 maintenance/profile tests pass; this is local source, not GCP adoption.

October 1 local recurring-job audit found another exact discovery gap:
`target/wasm32-unknown-unknown/debug/incremental` held 997,888,000 allocated bytes
eligible under the existing six-hour age and nonblocking Cargo-lock checks.
Discovery now includes that canonical target's debug/release profiles only.
Real offline cross-compilation proves Cargo holds the same retained profile lock;
fixtures preserve busy/missing-lock caches, binaries, receipts and memory sidecars.
All 26 maintenance/profile fixtures pass; two discovery controls fail before this fix.
The existing hourly timer remains the scheduler. Root installed script SHA256
`cd4fbfbcccfe1d8af90374f8fcb6720a5d5a80737ca1d3d415f41d6e5516f55a` locally;
October 1 08:22 UTC service completed successfully and removed that exact wasm
cache's children, leaving its root at 4096 allocated bytes and preserving Cargo
locks. This is allocated-cache removal, not an independent whole-filesystem savings
measure. Disk remains 89% used; no bounded-retention claim. Historical executables, pinned
snapshots and temporary trees without proved custody remain outside deletion.

The cleaner preserves profile directories and every Cargo lock inode. It takes
exclusive nonblocking `flock` on the existing `.cargo-lock` before rechecking age
and deleting compiler-cache children. Cargo 1.98.1 on the GCP host, commit
`797e8a9bca276c1c9f9f738d2a20f484fa4eea9d`, holds this lock during compilation;
newer shared-lock use also conflicts with this cleaner's exclusive lock.
New Cargo admission waits on that same retained inode. No separate ownership
registry or per-lane retirement action is needed.

Sources, logs, receipts, patches, `.fingerprint`, `deps`, executables and databases
remain untouched. Incremental mode preserves build-script outputs. Unknown cache file suffixes, symlinks,
mount crossings and missing/replaced lockfiles cause refusal. Only verified local
filesystem types are supported. Direct `rustc` use that bypasses Cargo locking,
manual replacement of profile/lock directories, or moving unrelated data into
`incremental` is outside this contract. Compiler caches can be rebuilt even for
pending lanes; compiled binaries remain available to active tests and reviewers.

This is not a disk quota. If recent/locked caches or retained compiled outputs fill
the disk, the cleaner reports the remaining usage; it never broadens deletion.

## Archived build-script objects

Root-reviewed and deployed September29 at20:22UTC;18 tests and systemd verification pass.
Installed script SHA256 `ebe34e64526dbd9d2969bb63fc45635036d37506b86982de4697bf3b955b3f20`;
service SHA256 `106684d74cb78db6b1b9804cad53141092951b8c57f2d726bebebaceb8de5cb6`.
Timer active; explicit service run succeeded, both passes below-pressure no-ops.
Previous installed files retained in `/tmp/oxigraph-maintenance-rollout-GMkX9a`.
512GiB disk retained;123GiB free, no expansion or further deletion at rollout.
The same hourly oneshot runs incremental cleanup first, then `--archived-build-objects`
only if pressure still exceeds85%. Both use the six-hour floor and80% stop threshold.
The second invocation selects a category under the same allocation roots and profile
`.cargo-lock`: top-level `*.o` in `<profile>/build/oxrocksdb-sys-<hash>/out/` only.
Other build scripts, including `ring`, `psm`, `codspeed` and `heapless`, report
`unsupported-producer` via tests and are never globbed. The inspected contract must
hold exactly: `root-output` names that `out`; `output` links static `rocksdb`,
`oxrocksdb_api` and `lz4` with no `.o` or `rustc-link-arg`; `out` holds only objects,
those three archives, `bindings.rs` and `flag_check{,.cpp}`. All 60 GCP outputs matched.

GNU `ar t` lists members; a non-`!<arch>` magic (thin archive), unreadable/truncated
listing, duplicate member or member in two archives refuses. Archive members and
objects must be the same set. Each object is then streamed against `ar p` in 1MiB
chunks; any byte difference, short stream or `ar` failure retains the whole output.
Inode, size and nanosecond mtime are rechecked before each unlink. Links, mount
crossings, recent writes and busy locks refuse as before. Archives, lock inode,
`output`, `.fingerprint`, `deps` and executables stay.
An active Cargo profile is skipped; new Cargo admission can wait for a maintenance
lock already held. Byte comparison is I/O work, not free: paused-host dry-run of
694 remaining objects took30s across the scan. Nice19/idle I/O remain configured.
No claim of zero scheduling delay or unlimited disk capacity.

Rustc links the `cargo:rustc-link-lib=static=...` archives, not the objects.
Cargo neither cleans nor fingerprints `OUT_DIR` contents, so removal triggers no
rebuild. If the build script reruns, cc 1.2.66 `compile_objects` recompiles every
object and `assemble` recreates the archive; the objects give no reuse. Oxigraph's
vendored RocksDB duplicates about 0.9GiB per build-script output this way.
Its fingerprint reruns only on `api/` or listed environment changes, not `OUT_DIR`.

September29,2026 under the application pause (no Cargo/rustc processes), one-hour
floor: incremental mode cleaned30 caches, free space +18,665,984,000 bytes. An
earlier unreviewed object variant then ran before root review, matching only
name, size and archive mtime across all build scripts. It removed 21,551 objects
from 39 profiles (55,994,511,360 bytes; oxrocksdb-sys20,126, ring1,320, psm61,
codspeed44); usage86.03% became75.66%. Afterward all374 retained archives listed
and streamed through `ar` without error, with no duplicate members; every logged
object is a member of a retained archive. Original object bytes were not compared
and cannot now be; byte identity of removed objects is unproved. A retained
`liblz4.a` linked, and an existing test binary listed324 tests. Reviewed-candidate
dry-run found 694 remaining RocksDB objects (1,918,574,592 bytes) byte-identical.

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
Initial incremental-only deployed script SHA256 (historical, superseded on rollout):
`f0ff53778c368cd5346924e4efa81835d3a5661d3030894c466186af90640869`.

```sh
systemctl --user status oxigraph-incremental-cleanup.timer
journalctl --user -u oxigraph-incremental-cleanup.service
systemctl --user disable --now oxigraph-incremental-cleanup.timer
```

Validation: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/maintenance`.
Object-mode tests add same-size different bytes, truncated/thin/duplicate/ambiguous
archives, unsupported producer/contract, unarchived/incomplete/busy/recent retention,
link and mount refusal, age floor and preserved archive/lock inodes; eighteen pass.
Includes a real small offline Cargo compilation, shared/exclusive lock contention,
preserved lock identity and noncache artifacts, dry-run, cold age, path discovery,
symlink refusal, mount identity/bind-mount refusal, finite-age validation, hardlink
accounting and unknown database retention (ten incremental tests). Independent source
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
- [Cargo build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html):
  `OUT_DIR` is not cleaned or reset by Cargo; build scripts own its contents.
- [Cargo build cache](https://doc.rust-lang.org/cargo/reference/build-cache.html):
  build-dir layout, including `build/` and `incremental/`, is internal to Cargo.
- [cc 1.2.66](https://github.com/rust-lang/cc-rs/blob/cc-v1.2.66/src/lib.rs):
  `compile_objects` and `assemble` rebuild all objects and the archive each run.
- [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html):
  standard persistent calendar scheduling; no agent or bespoke scheduler needed.
