# ADR-0022: Operational readiness, backup, and recovery

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: G2.5 native observation/contributor API and opt-in
  loopback observation endpoints, transaction terminal telemetry and Store-bound
  query/update evaluation, denied-attempt and SHACL commit-gate telemetry
  implemented. The bounded G2.5 observation surface is complete.
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
fresh-directory restore drill. At programme entry there was also no stable
readiness or bounded-label metrics surface; G2.5 now supplies that surface.

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
At this checkpoint, the broader P1.4a/G2.5 task remained open for operation
counters and latency/error histograms; the later slices below close that gap.
This native slice implements no automatic
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

### Transaction terminal telemetry slice (2026-09-08)

`Store::transaction_metrics()` is an additive process-local snapshot, shared by
clones of one open Store and reset by a new open, read-only open, or restart.
It records one terminal observation per admitted legacy, keyed, or governed
storage transaction. Autocommit and the storage transaction used by SPARQL
Update are included; nested public transaction wrappers do not double-count.
Admission failures/wait time, bulk loaders, governance maintenance, and external
persistence adapters are excluded, rather than presented as measured work.

Eight fixed result labels distinguish committed, rejected, conflicted,
cancelled, rolled back, rollback failed, indeterminate, and abandoned. These
are observed call results, not durable ledger truth. A typed governed rejection
is still rejected even when its internal pre-attempt rollback fails; a separate
rollback-failure counter retains that additional fact. An ambiguous commit
error is indeterminate, including when a later lookup proves success. Metrics
never initiate rollback, lookup or replay. Drop without a terminal call is
abandoned, without asserting durable rollback. Unwinding during a commit call
is conservatively indeterminate; during rollback it is rollback failed.

Durations cover successful admission through terminal return/drop. Seven fixed
inclusive buckets (100 microseconds through 60 seconds) plus positive infinity
are cumulative, with matching count and sum. These are measurement resolution,
not performance acceptance thresholds. Microsecond-resolution sums and counts
saturate at `u64::MAX`. A fixed-size metrics-only mutex produces internally
consistent snapshots and is never held across storage work. No database
encoding, transaction guarantee, persistence dependency, or minimal write trait
is changed; telemetry is not a transaction outcome oracle.

The CLI `/metrics` composes the unchanged at-most-21 readiness gauges with
three transaction families: `oxigraph_transactions_total` (counter),
`oxigraph_transaction_duration_seconds` (histogram), and
`oxigraph_transaction_rollback_failures_total` (counter). Their eight fixed
outcome labels and eight fixed bucket labels produce exactly 89 additional
samples. No labels or strings come from RDF, queries, keys, identities or errors.

Additive native tests cover memory/RocksDB, clones, concurrent snapshots,
reopen/reset, admission exclusions, histogram boundaries/saturation, and exact
commit/rollback failure observations. SHACL final-guard tests preserve the
rejection and rollback detail independently. The real CLI child test exercises
successful Update, failed whole-request rollback, an ASK verifying absence,
and bounded metric export. At this checkpoint query/update evaluation, lazy query
consumption, external-denial and validation-level observations remained in G2.5; this
slice does not close P1.4a or start G2.6/G2.7.

The telemetry slice passes the default native transaction/oracle lane (131
tests), SHACL/RDF-12/HTTP native lane (150), no-default SHACL/RDF-12 lane (80),
default CLI lane (153 unit/CLI plus five wire tests), and five no-default CLI
wire tests. These overlap and are not counts of newly delivered behavior.
Scoped library Clippy without HTTP and CLI-only Clippy pass with warnings
denied. HTTP-enabled library Clippy also reaches five pre-existing warnings in
`http.rs`, `io/loader.rs`, and `sparql/update.rs`; those files were unchanged
at the transaction-telemetry checkpoint.
No broader all-features lint or complete no-default CLI pass is claimed.

### Store-bound evaluation telemetry slice (2026-09-08)

`Store::evaluation_metrics()` records query/update observations separately from
physical transaction results. Only `on_store` and query
`on_store_with_entailment` bindings are attributed. Generic dataset bindings,
including those passed a Store, borrowed transactions, parse failures, and
standalone validation/materialization calls are excluded. This is not an HTTP
request or response counter. Clones share the per-open counters; reopen resets
them without changing stored data.

Duration begins before Store binding, covering snapshot/materialization,
admission, caller delay and lazy consumption. Boolean results finish at execute;
SELECT and graph results succeed only when the caller observes EOF. The first
returned error finishes the observation once, without fusing or draining the
iterator. Dropped bound operations and unfinished result streams are abandoned.
Existing cancellation checkpoints and iteration semantics are unchanged.

Updates record success only after acknowledged commit. Pre-commit failures
retain the existing transaction cleanup path; telemetry neither introduces an
explicit rollback nor relabels Drop as a proven rollback. Commit errors or
unwinding are indeterminate. Typed cancellation, remote timeout and policy denial
remain distinct from other evaluation failures. A swallowed `SILENT` denial
followed by success remains successful; this is not denial-attempt telemetry.
Classification examines at most 32 known wrapper levels without calling custom
error methods; unrecognized errors stay failed, not guessed from message text.

Four fixed families export exactly 154 samples: query/update counters and
cumulative duration histograms, each with seven fixed outcomes. The transaction
histogram bucket/saturation rules are reused without changing its existing 89
samples. Together with readiness's at-most-21 gauges, the CLI exports at most
264 samples at this checkpoint, before the policy families below. No user-derived
labels or raw errors are retained. Each metrics
snapshot is internally consistent, not an atomic snapshot across all three
operational APIs. Counters do not affect readiness decisions.

Additive native tests exercise Boolean, SELECT and graph consumption, first
error, cancellation, abandonment, substitutions/explanation, explicit entailment,
unattributed bindings, memory/RocksDB updates, whole-request cleanup, reopen,
read-only admission, bounded histograms, denied operations and `SILENT`, and
remote deadlines. Isolated guards test ambiguous commit/unwind without adding a
public fault API. CLI subprocess checks verify successful/failed updates, ASK
absence, both transaction and evaluation observations, and fixed sample counts.
At this checkpoint denial-attempt and validation telemetry remained in G2.5;
the following slice closes them. G2.6/G2.7 are not closed.

The evaluation slice passes 90 unit tests plus 13 focused evaluation tests with
SHACL/RDF-12/HTTP, and the no-default SHACL/RDF-12 unit/evaluation/transaction/
cancellation/negotiation/capability lane passes 62. Default CLI validation passes
153 unit/CLI tests plus five wire tests; the five no-default wire tests also
pass. These are overlapping regression lanes, not new-feature counts. Scoped
library Clippy without HTTP and CLI-only Clippy pass with warnings denied.
The previously noted broader lint/no-default CLI limitations remain explicit.

### Policy observation and G2.5 closure (2026-09-08)

`Store::policy_metrics()` adds three fixed denied-retrieval purposes and ten
fixed SHACL dispositions to the same per-open, clone-shared observation model.
The four families add exactly 143 samples; CLI composition is now at most 407
samples. Counts and microsecond sums saturate; cumulative duration bounds match
the earlier transaction/evaluation histograms. No identities, destinations,
shape/data contents, or errors are labels or retained values.

Built-in `SERVICE`, `LOAD`, and nested document denial decisions are counted at
typed error creation, before `SILENT` handling. Copying/taking an existing error
does not count it again; a nested document failure is not recounted as a LOAD
denial. Durations start at request or target-preflight entry. A remote attempt
can occur during `execute()` before lazy result consumption, so denial and
evaluation counters deliberately have different observation boundaries.
Prepared clones retain the exact built-in client template and attach a
Store-local observer only on the consumed Store binding. Existing cancellation,
timeout/TLS configuration, connection-budget sharing, custom-handler precedence,
and service-description claims are unchanged. Generic/borrowed bindings,
custom handlers, and standalone loaders are not attributed.

The native SHACL inherent commit is the sole observation wrapper, including
calls through both write traits. The final returned validation disposition is
recorded after final-guard handling, cleanup and native commit. Its duration is
commit-gate elapsed time, not validator CPU time or time holding an entire
transaction open. Accepted validation remains accepted when commit is
indeterminate; rollback failure never overwrites the validation disposition.
Start/preparation failure, explicit rollback, Drop before commit, unwinding,
and standalone validation are outside this returned-gate boundary. Receipt
lookup neither recounts nor rewrites observations. No receipt encoding changes.

Additive native fixtures cover swallowed and multiple denials, nested documents,
prepared clones bound to different Stores, custom/generic/borrowed exclusions,
all three SHACL commit entry points, validation rejection/cancellation, rollback
and drop exclusions, reopen/reset, and accepted validation with before/after
commit ambiguity. Existing gate/final-guard, operational, cancellation, LOAD and
SERVICE regression lanes remain passing. A CLI subprocess fixture proves denied
attempts remain visible while `SILENT` operations report success.

Validation passes 91 native unit tests and seven policy tests with
SHACL/RDF-12/HTTP, the 70-test operational/SHACL/remote regression lane, and
the 74-test no-default SHACL/RDF-12 lane. The no-feature evaluation/policy lane
passes ten tests. CLI validation passes 153 unit tests, six default-feature
wire tests, and five no-default wire tests in separate commands. These lanes
overlap; nine added test functions are not nine separate product capabilities.
Scoped no-HTTP library and CLI Clippy pass with warnings denied. HTTP library
Clippy retains the five unchanged warnings recorded above, with no new warning.

Run CLI unit and wire lanes separately: some unit helpers invoke Cargo with
`--no-default-features` and overwrite the shared server binary. The combined
command passed all unit tests but then failed the new HTTP-denial fixture
against that no-HTTP binary. A subsequent integration-only default-feature
command rebuilds the intended binary and passes all six wire tests. This is a
test-artifact collision, not a change to denial semantics or a passing combined
lane; no expected result was weakened.

This closes G2.5/P1.4a's bounded native metrics, readiness, contributor and
loopback observation contract. Zero counters do not claim a capability is
enabled; the current CLI has no SHACL policy configuration. Circuit state is
observed, not automatically tripped, and required/eventual contributor policy is
unchanged. Automatic workload admission belongs to G4.2. G2.6 backup receipts
and G2.7 fresh-directory restore remain required; this ADR stays Proposed until
its complete boundary below is satisfied.

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
