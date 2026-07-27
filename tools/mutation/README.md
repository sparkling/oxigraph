# Datalog mutation qualification

This lane pins `cargo-mutants` 27.1.0 and reviews the complete configured
`oxdatalog` D0–D2 mutation inventory.

```bash
node --test tools/mutation/*.test.mjs
node tools/mutation/oxdatalog.mjs --list
node tools/mutation/oxdatalog.mjs --jobs 2
```

The runner rejects symlinked or escaping output paths, enforces a bounded
process-tree timeout, and snapshots the workspace libraries, manifests,
toolchain configuration, runner, and mutation policy before and after native
execution. A passing receipt requires exactly one successful baseline, the
pinned native outcome version, one unique native record per generated mutant,
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
recomputes executable provenance; and runs the exact pinned bounded
`cargo mutants --list --json` invocation against the current source. The
sorted current inventory must equal immutable `mutants.json`, while every
inventory Mutant must have one strict, phase-consistent native outcome.
