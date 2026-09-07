# ADR-0021: Transaction-time SHACL validation

- **Status**: Implemented
- **Date**: 2026-08-24
- Updated: 2026-09-07
- Deciders: Oxigraph parity programme
- Implementation status: G2.4a full staged-view gate and G2.4b native bounded
  policy receipts/failure closure implemented; opt-in Rust API only
- **Depends on**:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)
- **Related**:
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md)

## Context

Oxigraph exposes bounded SHACL processing over stable read-only snapshots. It
previously did not make validation a transaction commit gate. Validating an earlier
snapshot or only the changed nodes can admit a pair of individually plausible
transactions whose combined committed state violates a shape.

Validation semantics belong to the semantic-validation context. Commit
governance may orchestrate that policy, but it must not duplicate or weaken
ADR-0008's dated, fail-closed SHACL profiles.

## Decision

Add a full staged-view SHACL participant before primary commit. Validation runs
under the same writer-isolation gate as the commit and evaluates the complete
resulting contents and topology of every graph in the transaction's explicitly
selected data/shapes scope. It does not silently substitute a union graph or
omit empty-graph topology. It is network-free, work-bounded, cancellable before
`CommitAttempted`, and fail-closed. A validation violation, timeout,
resource-limit failure, or processor error rejects the whole transaction while
non-commit is still provable.

Transaction begin pins the data/shapes graph scope, dated SHACL profile,
severity policy, inference policy, limits, deadline, and shapes identity.
Imports must be absent or supplied as an immutable, content-addressed closure
before begin. No implicit union graph, remote import, or `SERVICE` call is
introduced by validation.

External policy shapes are version-pinned when the transaction begins. If the
transaction may mutate its shapes graph, validation uses the resulting staged
shapes and forces a full evaluation. Incremental affected-node validation is
only a later optimization and must continuously differential-test against the
full staged-view oracle.

The validation report is diagnostic evidence, not primary RDF state unless a
separate product decision explicitly stores it. Default telemetry records
bounded outcome metadata and never shape/data payloads or user identifiers.
Rule-derived or inferred validation views are likewise ephemeral unless a
separate transaction explicitly materializes them.

## Acceptance boundary

G2.4a-G2.4b must demonstrate:

- insert, delete, clear, drop, empty-graph, namespace-adjacent, and rollback
  cases over the complete staged selected-graph contents and topology;
- concurrent transactions that would jointly violate a constraint cannot both
  commit under the advertised isolation contract;
- mutable-shapes transactions validate against resulting staged shapes;
- cancellation, timeout, validation error, and budget exhaustion publish no
  primary, receipt, or outbox state; and
- supported SHACL profile, shape version, limits, and disposition are bound to
  an executable receipt without copying RDF payloads.

## Consequences

- A store can enforce semantic policy atomically at transaction time.
- Full validation provides a strong oracle but may extend the writer critical
  section and reduce throughput.
- Shapes-version management becomes part of transaction configuration.
- Incremental validation cannot be promoted on performance evidence alone.

## Native G2.4a implementation boundary (2026-09-07)

The existing `shacl` feature exposes `Store::start_shacl_transaction` and an
owned `ShaclCommitPolicy`. Its private governed transaction retains the native
serialized writer permit throughout snapshot capture, validation, and commit.
Both the minimal write trait and outcome-aware commit path invoke this same
gate; there is no mutable unwrap. This is opt-in per transaction: ordinary
Store writes are not silently subjected to a global policy.

Data scopes are explicit, unique graph names. `required` means present in the
**resulting** staged topology, so creating a required graph in the transaction
is valid. Optional absent graphs are evaluated as empty, not skipped, and
diagnostics distinguish absent from present-empty. Each graph is evaluated
separately; no union or changed-node approximation is used. Shapes come from an
owned external RDF graph or one required stored graph. Immutable stored shapes
must match their begin identity; mutable shapes are fully recompiled from the
resulting staged graph. Exact identities hash the versioned logical RDF-term
encoding, graph name/presence, and sorted quad digests. They preserve blank-node
labels and RDF 1.2 term identity, not graph-isomorphism equivalence.

Begin owns the dated profile set, severity/processor options, no-materialization
policy, explicit scope, limits, and monotonic deadline. The gate requires a
finite timeout including admission and caller staging. Remaining time is
propagated to compiler phases and each graph validation, with checks during
snapshot reads and before commit. Cancellation covers native writer admission
and processor evaluation through `policy.control()`. These are cooperative
checks, not hard real-time process termination. Unresolved imports fail closed;
there is no resolver callback or remote data access introduced by the gate.

Selected graph count, total data quads, total retained results, and logical
snapshot bytes are bounded. The byte counter includes pinned external shapes,
compiled-source and retained report-shapes copies, but is not a bound on all
processor allocations or RSS; the existing
processor additionally applies its per-operation shape/constraint/focus/path/
query/estimated-memory ceilings. Reports are diagnostic values that can contain
RDF payloads, never automatic primary RDF or telemetry writes.

Every gate error consumes the transaction through explicit rollback and retains
any rollback failure beside the original error. Once governed commit is called,
its exact outcome (including an indeterminate key) is preserved without a
rollback attempt. Accepted primary changes, receipt, and outbox remain one
native commit. G2.4b extends this boundary with the executable, durable policy
receipt and injected-failure checks described below.

Native tests and a runnable consumer example:

```sh
cargo test --locked -p oxigraph --features shacl --test shacl_commit_gate
cargo test --locked -p oxigraph --no-default-features --features shacl,rdf-12 --test shacl_commit_gate
cargo run --locked -p oxigraph --features shacl --example shacl_commit_gate
```

The test covers valid/rejected writes and deletes, replacement, independent
graphs, clear/drop/empty/absent topology, namespace rollback, concurrent writers,
mutable shapes, cancellation, deadlines, cumulative limits, both commit traits,
explicit/drop rollback, imports, exact identities, and RocksDB reopen.
No specification pins, expected semantic results, or qualification receipts
were changed. These native tests do not claim full SHACL conformance, HTTP or
binding parity, or production qualification.

## Native G2.4b policy receipt and failure closure (2026-09-07)

`ShaclCommitPolicy::descriptor()` produces the exact canonical policy identity:
dated profile IDs; ordered, unique graph-selector hashes and required flags;
external/immutable-stored/mutable-stored shapes source; shapes-graph selector;
sorted unique severity-IRI hashes; both processor flags; all fourteen processor
ceilings plus the two snapshot ceilings; and exact timeout seconds/nanoseconds.
Policy v1 fixes independent graph evaluation, `ImplementedFeatureSet`, no
inference/materialization, no imports, and no network. Cancellation state and
the process-local absolute clock are not policy identity. The descriptor does
not include shapes contents: compare it together with the separate begin/commit
shapes hashes. Graph selectors, severity IRIs, and RDF payloads are not copied
into receipts. Hashes are not confidentiality protection for guessable terms.

`ShaclValidationEvidence` adds begin/observed-commit shapes identities, per-scope
unobserved/absent/present topology, completed graph count, and disposition. Its
versioned, checksummed encoding is at most 8 KiB, with at most 128 graph scopes
and 32 input severity entries. Decoding checks bounds before allocation,
canonical fields, profile/version tags, complete accepted topology, and equal
begin/commit shapes for accepted external or immutable-stored policy. Mutable
shapes may differ. Rejected evidence records only observations actually made.

Successful validation is embedded in governed outcome `[2,5]` with the unchanged
153-byte v2 primary receipt and a checksum binding the complete envelope.
RocksDB publishes this single outcome value, RDF/namespaces, outbox, and high
water in one batch. Memory uses an explicit plain/validated receipt enum under
the same publication locks. `Store::lookup_shacl_receipt` reads one snapshot;
both ordinary receipt lookup and outbox/retention validation reject malformed
validated outcomes. No side record can outlive or become detached from its
receipt. Existing `[2,4]` expiry replaces the entire envelope and preserves
committed-expired identity; it does not retain validation evidence. Plain and
expired results are `Unavailable(primary_outcome)`, not assertions that
validation never occurred. DTO lookup and portable codecs need no SHACL feature.

The final cooperative cancellation/deadline check runs after outbox/receipt
preparation but before `CommitAttempted`. Failure explicitly rolls back, keeps
the original validation disposition and any rollback failure, and publishes no
primary, receipt, or outbox. After `CommitAttempted`, the native outcome/key is
preserved without rollback or replay. An indeterminate commit can therefore
carry an `Accepted` validation observation; only native receipt lookup resolves
whether it committed. Checksums detect corruption, not forgery or independent
semantic truth. Diagnostic failure evidence is returned, not persisted as a
successful receipt or sent to telemetry.

Tests cover all eight native staging/attempt/final-batch/rollback fault seams,
last-check cancellation with successful and failed rollback, policy field
identity, malformed mutable shapes, topology, time/size/processor failures,
every-byte corruption/truncation, impossible rechecksummed evidence, atomic
expiry, backup, compaction, and read-only reopen. The native scope is complete;
HTTP/binding policy configuration, global enforcement, incremental validation,
remote imports, and production/power-loss qualification are not claimed.

This additive outcome tag is a storage compatibility boundary: older binaries
reject `[2,5]` on governed lookup/outbox access. No global schema migration,
automatic evidence rewrite, mixed-version writer safety, or downgrade support
is implied. Existing v1/v2 plain receipts and retention anchors are unchanged.

## Alternatives rejected

- **Validate only after commit.** Invalid state becomes externally visible.
- **Validate only changed nodes first.** Complex paths and global constraints
  can be missed without a proven dependency analysis.
- **Allow remote shape or data loads during commit.** Network failure and
  nondeterminism enter the atomicity boundary.

## Evidence and task ownership

The existing snapshot adapter is
[`reasoning.rs`](../../lib/oxigraph/src/reasoning.rs), and the bounded
processor lives in [`lib/oxshacl`](../../lib/oxshacl). The native gate is
[`shacl_gate.rs`](../../lib/oxigraph/src/store/shacl_gate.rs), with
[feature-independent receipt codec](../../lib/oxigraph/src/store/shacl_receipt.rs),
[integration tests](../../lib/oxigraph/tests/shacl_commit_gate.rs) and a
[runnable example](../../lib/oxigraph/examples/shacl_commit_gate.rs).
G2.4a-G2.4b own delivery in
the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
