# MetaHarness/Darwin qualification

This adapter requests `@metaharness/darwin` from the `latest` dist-tag; the
committed lockfile currently resolves 0.9.3 with exact registry integrity.
Darwin is constrained to its seven pure policy files. Rust source, standards
manifests, expected results, semantic profiles, resource ceilings, and evidence
definitions are hash-protected inputs.

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

The engineering harness's G1.7 consumer copies the qualification and
independent-verification bytes into a sealed run and replays them through the
pure MetaHarness receipt contract. An explicit v2 projection schema is only a
structural version marker: the outer receipt reports it as unreplayed until the
copied pair passes that pure verifier. This consumer replay does not regenerate
current semantic evidence, prove owner-process provenance, or grant G1.7
qualification or promotion authority.

```bash
cd tools/metaharness
npm ci --ignore-scripts
npm test
npm run qualify:synthetic
# first run: node ../mutation/oxdatalog.mjs --jobs 2
npm run qualify
```

`npm ci --ignore-scripts` reproduces the committed exact resolution without
granting dependency lifecycle hooks host authority; the package-local `.npmrc`
enforces the same rule. A reviewed dependency refresh uses
`npm update @metaharness/darwin --package-lock-only --ignore-scripts` and must
rerun the tests and qualification gates before the new lockfile is accepted.

The adapter validates and hashes `.npmrc`. Its child processes inherit only a
reviewed safe-name allowlist; provider, API, proxy, credential, and
runtime-injection variables are removed. The shared dependency and
child-environment policy modules are protected inputs, so changing either
invalidates qualification identity.

Receipts are written to `target/metaharness/qualification.json`; variant
archives remain under `target/metaharness/`. `npm run qualify` also invokes an
independent verifier and writes `target/metaharness/verification.json`.
Qualification hashes the semantic library tree and oracles, the complete
Agentic-QE/MetaHarness/mutation/programme-evidence gate code, the CI workflow,
root `README.md`, the ADR/plan/research claim surfaces, the executing Node
binary, and the exact installed Darwin package before and after every run. The
JavaScript source tree is protected, while exactly the repository-relative
generated directory `js/pkg` is excluded; other `pkg` directories remain
protected and a symlink at `js/pkg` still fails closed.
Before the real gate, it validates the mutation receipt,
outcomes, and policy copy from one UUID-addressed immutable publication rather
than later-mutable native output paths. The real gate additionally requires and
hashes a fresh schema-v5 Agentic-QE semantic receipt created after that gate
began. It reopens the receipt's content-addressed output archive and
run-addressed immutable receipt/oracle pair rather than relying on
later-mutable shared target files.
No such current schema-v5 semantic receipt is claimed at this checkpoint; the
last schema-v4 persistence receipt is historical/invalid and cannot satisfy
this gate.
Any drift,
stale receipt, unverified qualification, or symlinked output path fails closed.
