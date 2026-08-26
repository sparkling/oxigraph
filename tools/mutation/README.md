# Datalog mutation qualification

This lane acquires the latest `cargo-mutants` registry release without a
top-level version constraint and reviews the complete configured `oxdatalog`
D0–D2 mutation inventory. `--locked` preserves the selected release's
published dependency resolution; the receipt freezes the observed release and
executable rather than making acquisition itself a repository version pin.

```bash
# Run from a clean, single-use disposable worktree.
cargo install --locked cargo-mutants
node --test tools/mutation/*.test.mjs
node tools/mutation/oxdatalog.mjs --list
node tools/mutation/oxdatalog.mjs --jobs 2
```

The exact default command has a 5,400-second process-tree ceiling. That
90-minute bound covers the observed 65–75-minute full-run envelope with bounded
headroom; it is not inferred from the historical mutant count. Operators may
use `--outer-timeout-seconds` only within the reviewed 30–7,200-second range.
The runner creates a UUID-scoped `TMPDIR`, `TMP`, and `TEMP` below
`target/cargo-mutants-tmp/`, so no ambient or sandbox `/tmp` is part of the
execution precondition.

The Git preflight rejects ordinary dirt, ignored untracked paths, and tracked
entries carrying `skip-worktree` or `assume-unchanged`; it never removes those
paths. Use a new disposable checkout instead of deleting repository-local
runtime state to make a shared checkout look clean. The UUID temporary
directory is atomically moved to a same-parent quarantine name and removed on
handled success or failure. An uncatchable host or process termination may
leave that UUID directory as diagnostic debris, in which case use another
disposable checkout.

The runner rejects symlinked or escaping output paths, enforces a bounded
process-tree timeout, and snapshots the workspace libraries, manifests,
toolchain configuration, runner, and mutation policy before and after native
execution. A passing receipt requires exactly one successful baseline, exact
agreement between the receipt-recorded, runtime, and native outcome
`cargo-mutants` versions, one unique native record per generated mutant,
consistent aggregate counts, no input drift, no survivors, and no timeouts.
The receipt hashes the native outcome and policy files, records canonical
paths, versions, and SHA-256 hashes for Cargo, Cargo Mutants, Rustc, and the
selected Rustup toolchain binaries, and derives a timestamp-independent
`contentHash` over the complete gate verdict. Wrapper wall-clock timestamps
and a monotonic duration must agree within two seconds, enclose the canonical
native timestamps, and remain inside the configured outer timeout.

Schema-v3 receipts also carry a UUIDv4 `runId`, a run-specific `executionHash`,
and an immutable evidence manifest. Each command first writes native output to
its own `target/mutation/oxdatalog/native/<UUID>/mutants.out/`, so concurrent
runs cannot rotate one another's evidence. The runner publishes the receipt,
native `outcomes.json`, native `mutants.json`, and exact `oxdatalog.toml` bytes
exclusively below `target/mutation/oxdatalog/runs/<UUID>/`. Publication and
latest-alias writes bind directory identities, reject parent and final
symlinks and hard links, fsync files and directories, and use stable no-follow
reads.

Consumers should call `validateMutationPublication` from `evidence.mjs` with
the repository root and current protected-input content hash. The API reopens
the immutable receipt, outcomes, inventory, and configuration; requires both
recorded full snapshots to equal an independently recomputed current snapshot;
recomputes executable provenance; requires the current Cargo Mutants binary,
hash, path, and observed version to equal the receipt; and runs the exact
bounded `cargo mutants --list --json` invocation against the current source.
The sorted current inventory must equal immutable `mutants.json`, while every
inventory Mutant must have one strict, phase-consistent native outcome.

After publishing and writing the mutable latest pointer, the runner launches
`verify-current.mjs` in a new Node process. That process calls
`currentMutationQualification`, reopens the exact immutable run, recomputes the
current source inventory and executable provenance, and requires the result to
identify the just-published UUID. The command reports
`currentQualification=<immutable receipt path>` only after this independent
reopen succeeds. The qualification loader also performs a final stable reopen
of the mutable pointer, all immutable publication bytes, and the protected
source snapshot after regenerating the current mutation inventory; a concurrent
rewrite is therefore fail-closed.
