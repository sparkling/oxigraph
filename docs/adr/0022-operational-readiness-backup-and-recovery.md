# ADR-0022: Operational readiness, backup, and recovery

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: G2.5 native observation/contributor API and opt-in
  loopback observation endpoints implemented; operation counters/histograms
  remain in G2.5.
  G2.6-G2.7 backup/restore receipt work remains unimplemented
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)
- **Related**:
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)

## Context

The store can create a backup, optimize RocksDB, and validate storage, but a
successful method return is not a recovery contract. There is no completed
backup receipt tying primary state to its authoritative outbox and declared
derived-state contributor positions, no
fresh-directory restore drill, and no stable readiness or bounded-label
metrics surface.

Operations must distinguish liveness from readiness and must not promote a
store that is open while its durable feed, required derived state, or recovery
evidence is outside policy. Development-mode validation remains proportional;
production attestation, publication, deployment, and recovery objectives are
required only when that operational boundary is explicitly requested.

## Decision

Deliver three separately testable operational slices:

1. G2.5 exposes bounded-cardinality metrics, liveness, readiness, cancellation
   health, authoritative-outbox lag, declared derived-state lag,
   commit-governance health, and circuit-breaker state. ADR-0027 later consumes
   these observations; once G4.2 exists,
   readiness observes its workload budgets rather than creating a second
   admission system. Default labels exclude query text, RDF payloads,
   credentials, IRIs, commit IDs, and user IDs.
2. G2.6 starts with checkpoint-plus-manifest backup creation. A completed
   receipt binds store UUID, schema version, source commit ID, RocksDB
   sequence, authoritative-outbox cursor, the canonical derived-state
   contributor inventory, file inventory and checksums, start/end observations,
   and a completion marker. Interrupted backups cannot acquire that marker.
3. G2.7 restores into a fresh directory, opens and validates it, and compares
   topology, namespaces, primary commit, authoritative-outbox position, every
   declared contributor, inventory, and checksums with the receipt. Drills
   record numeric RPO and RTO after a baseline is frozen.
   Before open, path containment, regular-file policy, manifest completeness,
   sizes, and hashes are verified; symlinks, traversal, missing files, and
   unexpected files fail closed.

G2.5-G2.7 share one engine-neutral, canonical zero-or-more derived-state
contributor contract. An empty inventory is valid. Each nonempty entry carries
a stable provider/schema identity, required/optional disposition, source and
applied cursors, bounded health, a checksummed backup-manifest contribution,
and restore reconciliation. A test-only fake contributor proves the nonempty
path. Unknown or duplicate entries, a missing required contributor, and a
cursor mismatch fail closed. G3.0 later implements the reusable derived-index
lifecycle and plugs into this hook; G2 does not depend on G3.0 and does not
pre-create text or spatial providers.

ADR-0027 is an operational and promotion relation, not a hard implementation
prerequisite for G2.5-G2.7. G2.5 first establishes the bounded metrics,
cancellation, and readiness observations that G4.2 later consumes. A
production readiness profile that promises workload budgets is promotable only
after G4.2 closes; this sequencing avoids a dependency cycle between the two
decisions.

ADR-0028 consumes these backup and restore receipts before a destructive or
irreversible schema migration is admitted. A backup receipt alone does not
authorize an upgrade, and an upgrade cannot mint recovery evidence for itself.

Readiness fails closed on storage corruption, incompatible schema, required
cursor loss, expired recovery evidence, or a lag policy violation. An optional
derived index may degrade according to its declared strict/eventual contract;
primary correctness may not be inferred from index health.

## Acceptance boundary

### Native G2.5 observation slice (2026-09-07)

`Store::operational_snapshot` now separates in-process liveness from
`Ready`, `Degraded`, and `NotReady`. It checks storage layout and a bounded
decoded primary prefix, existing governed-outbox health, cancellation/deadlines,
consumer lag, physical backpressure, operator-supplied circuit state, and an
optional recovery-freshness deadline. Non-closed/unknown circuits and failed
checks are not ready. It takes no writer permit and changes no stored state.

Primary and outbox coverage are explicit, not whole-store validation. Defaults
inspect at most 128 primary records plus one encoded lookahead, a 1 MiB logical
byte stopping threshold, and 256 outbox records. A decoded term can overshoot
the byte threshold; this is not a hard allocation bound. Partial primary
coverage is degraded; partial outbox coverage is not ready unless explicitly
allowed, then degraded. The five-second default deadline is cooperative and
cannot interrupt a blocking native I/O call or earlier caller-side observations.

The canonical registry admits zero through 128 providers. Profile-owned
declarations cannot be weakened by observations. Source checkpoints equal the
native governance snapshot's latest full v2 receipt; applied checkpoints must
match native receipt lookup or the exact retained anchor. Foreign, future,
forged, expired, unknown, duplicate, and missing-required observations reject.
Required contributors must be healthy and fully caught up, including those
normally processed eventually. Optional eventual lag may degrade within its
declared bound; optional missing/unhealthy providers require an explicitly
declared authoritative fallback. Empty inventory is ready, not degraded.

Sorted inventory bytes and their domain-separated checksum provide a reusable
content identity, not a backup manifest or restore proof. The fixed native
metric vocabulary has no labels and at most 21 gauge series. It contains no
RDF values, provider IDs, request keys, or raw errors; unavailable gauge values
are omitted with explicit observation flags. Units are boolean, records,
logical bytes, leases, and contributors.

`lib/oxigraph/tests/operational_readiness.rs` exercises memory and RocksDB,
empty/nonempty inventory, required/optional policy, cursor identity/expiry,
capacity/privacy, bounded coverage, cancellation/deadline/circuit/recovery
failure, leases/backpressure, reopen and read-only observation. Native unit
fixtures additionally inject malformed layout, primary keys, and governance
state in isolated test stores. No pinned evidence or operator runtime is changed.

Run the usable native artifact with
`cargo run --locked -p oxigraph --example operational_readiness`.
The broader P1.4a/G2.5 task remains open for operation counters and latency/error
histograms and their consumer tests. This native slice implements no automatic
circuit breaker, workload admission engine, full-store certificate, backup
receipt, or production claim.

### Loopback CLI observation slice (2026-09-08)

The optional `--admin-bind` listener for both serving modes admits only a numeric
loopback address and nonzero port, checked before opening storage. It exposes
only GET/HEAD `/health`, `/ready`, and `/metrics`; it does not expose RDF,
SPARQL, maintenance, authentication, CORS, or arbitrary diagnostic data. Default
CLI operation is unchanged when the listener is omitted. Public application
routes remain separate. No new dependency is introduced.

Liveness is static HTTP 200. Ready/degraded observations map to 200; not-ready
maps to 503. Fixed reason tokens and coverage are JSON, and bounded gauges use
Prometheus text format. Metrics still report not-ready gauges with HTTP 200;
unavailable wall-clock conversion fails closed with 503. No raw error or
inventory/receipt payload is serialized. HEAD performs the GET-equivalent
observation while retaining Content-Length and suppressing the body. Responses
are noncacheable; query strings reject without echo, unsupported methods use
405 with `Allow: GET, HEAD`, and other paths use 404.

An independent two-connection listener and two-second transport timeout keep
the observation surface separate from application connection slots. Native
probes use a 250 ms cooperative deadline and the conservative default prefix
bounds, not a hard I/O/allocation limit. CLI provider inventory is empty until
providers are actually integrated; no required provider is silently removed.

The existing HTTP library exposes no shutdown/prebound-listener API. This
private CLI integration therefore has process lifetime, not graceful in-process
shutdown. A shared startup gate prevents any application handler call or ready
report until both binds and systemd notification succeed. Startup/join errors
reach `main` and terminate the process, releasing listeners. A deterministic
gate test covers zero application calls during partial startup; real CLI
subprocess fixtures cover bind rejection/conflict, route separation, GET/HEAD,
backpressure after reopen in both serving modes, metric privacy, and kill/wait
port release. This is not G4.2 admission or production availability qualification.

Native CLI validation: the default-feature suite passes 153 unit/CLI entries
and four new subprocess wire tests. With no default features, the four wire
tests and focused startup-gate test pass. The broader no-default suite reports
131 passed, two failed, and one previously ignored: unchanged SERVICE/LOAD
tests expect policy-denial text, while the unchanged no-HTTP implementation
reports unavailable service/client support. This is not a fully green
no-default suite; neither those expectations nor protected service-description
fixtures were altered. CLI-only Clippy (`--no-deps`, warnings denied) passes;
the broader dependency lint reports the pre-existing `manual_is_variant_and`
warning in `oxrdfs/src/rdfs12/datatypes.rs`. These known broader validation
limitations are separate from the passing operational endpoint checks.

### Complete ADR boundary

This ADR may move to Implemented only when:

- metric names, units, label bounds, and privacy tests are stable;
- liveness and readiness failure fixtures cover storage, feed, cancellation,
  the empty contributor inventory, and a test-only nonempty contributor;
- incomplete, missing, modified, or checksum-invalid backups fail closed;
- backup and compaction interaction has no unrecorded consistency gap;
- automated fresh-directory restores pass the storage validator and compare
  every receipt-bound cursor, contributor, and topology field; unknown,
  duplicate, missing-required, and cursor-mismatched contributors reject;
- a completed backup remains independently usable after removal of its source
  store; and
- RPO/RTO thresholds are baselined and frozen before a production promotion,
  rather than invented by this ADR.

## Consequences

- Operators gain evidence that a backup is restorable, not merely copyable.
- Readiness becomes a typed policy decision rather than process-up status.
- Receipts and drills add storage, time, and retention costs.
- Optional indexes can be rebuilt without making primary state unrecoverable.

## Alternatives rejected

- **Treat `Store::backup` success as recovery proof.** It does not exercise
  reopen, validation, or cursor correspondence.
- **Expose raw RocksDB statistics as the public contract.** Backend-specific
  and unbounded metrics would leak implementation and operational detail.
- **Set production RPO/RTO without a baseline.** Unmeasured thresholds are
  documentation, not an executable guarantee.

## Evidence and task ownership

Current backup, optimize, and validate entry points are in
[`store.rs`](../../lib/oxigraph/src/store.rs) and
[`storage/rocksdb.rs`](../../lib/oxigraph/src/storage/rocksdb.rs). G2.5-G2.7
own delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
