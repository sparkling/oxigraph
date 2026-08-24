# ADR-0021: Transaction-time SHACL validation

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-24
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G2.4
- Depends on:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)
- Related:
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)

## Context

Oxigraph exposes bounded SHACL processing over stable read-only snapshots. It
does not make validation a transaction commit gate. Validating an earlier
snapshot or only the changed nodes can admit a pair of individually plausible
transactions whose combined committed state violates a shape.

Validation semantics belong to the semantic-validation context. Commit
governance may orchestrate that policy, but it must not duplicate or weaken
ADR-0008's dated, fail-closed SHACL profiles.

## Decision

Add a full staged-view SHACL participant before primary commit. Validation runs
under the same writer-isolation gate as the commit and evaluates the complete
resulting RDF dataset and graph topology. It is network-free, work-bounded,
cancellable before `CommitAttempted`, and fail-closed. A validation violation,
timeout, resource-limit failure, or processor error rejects the whole
transaction while non-commit is still provable.

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

G2.4 must demonstrate:

- insert, delete, clear, drop, empty-graph, namespace-adjacent, and rollback
  cases over the complete staged view;
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

## Alternatives rejected

- **Validate only after commit.** Invalid state becomes externally visible.
- **Validate only changed nodes first.** Complex paths and global constraints
  can be missed without a proven dependency analysis.
- **Allow remote shape or data loads during commit.** Network failure and
  nondeterminism enter the atomicity boundary.

## Evidence and task ownership

The existing snapshot adapter is
[`reasoning.rs`](../../lib/oxigraph/src/reasoning.rs), and the bounded
processor lives in [`lib/oxshacl`](../../lib/oxshacl). G2.4 owns delivery in
the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
