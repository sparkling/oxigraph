# MetaHarness/Darwin qualification

This adapter pins `@metaharness/darwin` 0.8.0 and constrains Darwin to its seven
pure policy files. Rust source, standards manifests, expected results, semantic
profiles, resource ceilings, and evidence definitions are hash-protected inputs.

The qualification has two independent parts:

1. two seeded synthetic Tier-1 evolutions prove policy-surface execution,
   safety rejection, bounded cost, and stable replay; and
2. one generated baseline harness runs the immutable
   `metaharness-semantic-gate` Agentic-QE profile through Darwin's shell-free
   real sandbox. Full qualification also requires a green, source-current
   schema-v3 `cargo-mutants` publication with zero survivors and zero timeouts.

Darwin intentionally strips `JAVA_HOME`. Each Java-backed Datalog/RDFS
differential therefore re-enters the shared checked-in Jena mise toolchain and
attests Java 21.0.11, Maven 3.9.11, and Rust 1.96.0 before execution. The
semantic receipt must contain the exact ordered 41-command inventory; partial,
reordered, or concurrent Agentic profiles fail closed.

The synthetic score is evidence about the harness only. The native Cargo,
W3C, Jena, and Soufflé commands coordinated by Agentic-QE remain the semantic
oracles.

```bash
cd tools/metaharness
npm ci
npm test
npm run qualify:synthetic
# first run: node ../mutation/oxdatalog.mjs --jobs 2
npm run qualify
```

Receipts are written to `target/metaharness/qualification.json`; variant
archives remain under `target/metaharness/`. `npm run qualify` also invokes an
independent verifier and writes `target/metaharness/verification.json`.
Qualification hashes the semantic library tree and oracles, the complete
Agentic-QE/MetaHarness/mutation/programme-evidence gate code, the CI workflow,
the executing Node binary, and the exact installed Darwin package before and
after every run. The JavaScript source tree is protected, while exactly the
repository-relative generated directory `js/pkg` is excluded; other `pkg`
directories remain protected and a symlink at `js/pkg` still fails closed.
Before the real gate, it validates the mutation receipt,
outcomes, and policy copy from one UUID-addressed immutable publication rather
than later-mutable native output paths. The real gate additionally requires and
hashes a fresh schema-v4 Agentic-QE semantic receipt created after that gate
began. It reopens the receipt's content-addressed output archive and
run-addressed immutable receipt/oracle pair rather than relying on
later-mutable shared target files.
Any drift,
stale receipt, unverified qualification, or symlinked output path fails closed.
