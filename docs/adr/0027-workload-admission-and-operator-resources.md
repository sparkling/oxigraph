# ADR-0027: Workload admission and operator resources

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-09
- Deciders: Oxigraph parity programme
- Implementation status: G4.2 active; native opt-in global/class admission,
  eligible FIFO, queue timeout/token cancellation, separate operator reserve
  and response-flush lifetime are implemented. Optional absolute request
  deadlines now cover native Simple/finite-RDF/finite-RDFS queries and transactional paths. Resource budgets,
  excluded deadline paths, queued disconnect, reload and full acceptance remain open
- Programme task: `task-1787728711461-3isex6`
- **Depends on**:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md)
- **Related**:
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md)

## Context

The CLI server currently caps a buffered HTTP body at 128 MiB, gives the HTTP
server a process-wide timeout, sets maximum concurrent connections from
available parallelism, and applies the configured evaluation timeout only to
SPARQL queries. These are useful safeguards, but they are not admission
control, fair scheduling, per-workload limits, update-wide deadlines, or
operator-visible resource accounting. A small number of expensive requests
can therefore occupy connections, memory, evaluator work, or the serialized
writer gate without a declared service policy.

Resource control must not change successful SPARQL or RDF semantics. It may
reject or cancel work at a documented boundary, and an owned write must still
publish all or nothing.

## Decision

Introduce a server orchestration contract consisting of `WorkloadPolicy`, a
bounded `AdmissionController`, an acquired `WorkloadLease`, and a shared
`ResourceBudget`. An authorized request is assigned an operator-defined class:
query, update, graph read, graph write, bulk/compatibility transaction, or
privileged operation. Anonymous deployments use a configured default class;
ADR-0026 principals may add global and per-principal fairness but cannot supply
their own priority or limits.

Admission occurs before body buffering and parsing. Queues have explicit
global and class capacities, maximum queue time, bounded priority levels,
deterministic FIFO order within a level, and reserved capacity for liveness and
authorized recovery operations. Queue cancellation releases its slot within a
bounded interval. Overload does not open a dataset transaction, allocate an
outbound connection, or enter the RocksDB writer queue.

The lease carries one cancellation token and absolute deadline through parse,
planning, local evaluation, ADR-0019 egress, transaction admission, mutation,
the final pre-commit checkpoint, result serialization, and connection loss.
It accounts for declared limits where the implementation can observe them:

- encoded request bytes, decoded RDF bytes, multipart parts, and parser terms;
- queued and active requests, transaction wait, outbound requests/bytes, and
  result bytes/rows;
- evaluator solutions, intermediate rows, operator buffers, and spill bytes
  for operators that opt into the budget contract; and
- elapsed queue, evaluation, external-I/O, and total request time.

Every supported operator must either charge its potentially unbounded
allocation/work counter or be rejected from a profile that promises that
bound. `ResourceLimitExceeded { resource, phase }`, `AdmissionTimedOut`, and
`Overloaded` remain typed internally. Owned updates roll back before returning
a limit or deadline failure. A streamed query that exhausts a budget after
headers were sent terminates as a failed stream and is never closed as a
well-formed truncated success.

HTTP mappings are stable: 413 for request representation limits, 429 with a
bounded `Retry-After` for class/principal admission, and 503 for global
unavailability or exhausted reserved capacity. Authentication and
authorization still run before admission so an attacker cannot use the queue
as a resource-existence oracle.

### Hard-limit boundary and operator controls

Cooperative counters cannot prove a hard process RSS, CPU, file-descriptor, or
disk ceiling in safe Rust across RocksDB and all allocators. Such limits remain
container/process/cgroup responsibilities and must be documented as external
deployment requirements. The server reports observed high-water values and
which limits are cooperative; it does not label them hard isolation.

Operator configuration is immutable per admitted request, versioned, size
bounded, and reloads atomically. Metrics expose class, resource, phase, and
disposition from fixed vocabularies, not query text, RDF terms, principal IDs,
transaction IDs, or endpoint IRIs. Runtime policy cannot weaken the semantic
rollback guarantees negotiated under ADR-0018.

### Compatibility and non-goals

The embedded library remains usable without a scheduler. Existing public
evaluation APIs keep their defaults; additive options attach a budget and
cancellation token. The CLI receives an explicit local profile whose limits
are documented rather than inferred from CPU count. This ADR does not provide
distributed quotas, billing, cross-process fairness, workload prediction,
automatic query rewriting, or a claim of hard memory isolation.

## Staged implementation and evaluator gates

### Native admission slice (2026-09-09)

`cli/src/workload.rs` implements an explicit `oxigraph-admission-v1` startup
profile and shared `AdmissionController`/`WorkloadLease`; it does not yet expose
a `ResourceBudget`. Both CLI serve modes validate the bounded profile and all
access-policy classes before store open. Identity/authorization precedes
queue admission. Separate data/operator pools and per-data-class caps use one
mutex, checked ticket identities and eligible FIFO at a single priority.
Queue timeout is absolute from the acquisition attempt; the public token is
observed by a 10 ms cooperative wait. Global/operator overload and expiry map
to 503; class overload maps to 429 with bounded Retry-After. No body or store
handle enters the controller. An unknown class never falls back.

OxHTTP now retains only an explicit shared `RequestLifetime` guard through
response encoding and `BufWriter` flushing. Other extension values are moved
unchanged. A handler cannot release the lease by clearing request extensions;
application-held clones may extend its lifetime. Cancelled running work keeps
its capacity until ownership ends. Separate transport limits also bound idle
or pre-header connections; the operator listener must be enabled to expose
its reserve.

Native controller tests cover FIFO, class/global/operator bounds, virtual-clock
expiry, real token cancellation/timeout, shared ownership and unwind. Transport
tests cover streaming after request clear, actual flush ordering, non-cloning
of arbitrary extensions, decoder/drain/encoder failures and unwind. CLI wire
tests prove auth-before-overload, rejection-before-Expect/body, no measured RDF
work under saturation, live operator access, release after observed disconnect,
successful subsequent write/query and rollback/restart with admission enabled.

This closes a native product slice, **not** the full admission or G4.2 gate.
Queued sockets do not yet propagate disconnect into their cancellation token.
Resource accounting, differentiated priorities,
per-principal fairness, atomic workload reload, exported admission metrics and
the remaining staged/operational evaluators remain outstanding. Configured
example capacities are illustrative, not baselined production defaults.

### Native deadline slice (2026-09-09)

An optional positive `request_timeout_ms` binds the lease token to an absolute
monotonic deadline before queue acquisition; earlier caller deadlines cannot
be extended. Queue residence consumes that same deadline. The public token
and query/update errors distinguish `TimedOut` from explicit `Cancelled`;
metrics retain that distinction. SERVICE checks both sides of handler and
iterator calls, including EOF. A whole-request timeout is never SILENT-able;
an ordinary remote-policy timeout keeps its existing SILENT semantics.

OxHTTP's per-admitted-request watcher shuts down socket I/O at expiry and is
stopped/joined before keep-alive reuse. It cannot preempt application work or
release a still-owned lease. Native query/result iteration, transactional
Graph Store parsing/topology/representation loops, writer admission and the
final pre-commit boundary observe the shared token. Readiness uses the earlier
request/probe bound. Expiry after CommitAttempted never proves rollback.
The old query-only sleeping timeout thread is replaced with a token deadline.

Native tests cover stalled Expect bodies, failed partial streams, timer reuse,
typed queue/writer expiry, owned-update and final-checkpoint rollback including
empty topology, custom/lazy SERVICE SILENT and LOAD SILENT timeout distinctions,
Graph Store parser topology/blank-node scope and persistent wire journeys.
These tests are additive product regressions, not rewritten qualification evidence.

This is still a cooperative, opt-in slice: deadline-bound OWL materialization
and the legacy nontransactional Graph Store bulk path return unsupported (400)
until they gain the necessary checkpoints. Individual parser, custom callback,
DNS and native storage calls are not preemptible. Queued socket disconnect,
resource accounting, exported admission metrics and full acceptance remain open.

### Finite RDF and shared materialization controls (2026-09-09)

Finite RDF is now admitted under request-deadline profiles. One control begins
before the repeatable-read snapshot, observes both evaluator and materialization
option tokens, and checks snapshot decoding, effective FROM/RDF merges, finite
RDF inference, visible-result projection and owned query scans. Graph-prefix
copies, empty named graphs, graph-local inference and blank-node scope are
preserved. No transaction or store write is introduced by query materialization.
No-match scans check before filtering; failure cannot return a partial dataset.

The existing relative `QueryEntailmentOptions::with_timeout` remains a
materialization-only budget, now including preparation rather than restarting
at inference entry. It is cleared after success. Explicit token deadlines and
cancellation remain active for subsequent dataset reads. The dataset's
`QueryableDataset::Error` is now `QueryEntailmentError`, not `Infallible`;
consumers with that associated type pinned must handle the typed error.
Native materialization uses the monotonic standard clock; WASM uses the
workspace's existing `web-time` package through a target-specific dependency.
No new package or native runtime is introduced.
HTTP and Store observations preserve `TimedOut` versus `Cancelled` instead
of classifying either as semantic inconsistency.

The Datalog callback bridge also reaches RDFS/OWL engine checkpoints. RDFS now
checks preflight, both input copies, graph/container discovery, all raw binary
candidates (including cross-graph no-matches), consistency scans and ordering,
inference assembly and memory estimation. Its relative clock starts before
preflight. Checked stable key grouping retains the former inconsistency ordering
and adjacent deduplication; successful resource accounting and graph topology
are unchanged. Request-deadline profiles now admit finite RDFS.
Individual RDF term parsing/formatting and bounded collection operations remain
cooperative boundaries, not hard real-time preemption. The existing memory
estimate is unchanged and is not a complete allocation/RSS budget.
OWL internal copies, sparse scans, output and accounting remain the next G4.2
step, followed by queued disconnect and resource accounting. No profile, expected
semantic result or protected receipt is changed.
Native regressions cover expiry before binding, mid-snapshot cancellation,
EOF cancellation, retained explicit tokens, materialization-budget lifetime,
typed metrics/HTTP status and unchanged FROM/empty-graph semantics. A loopback
CLI journeys exercise finite RDF and RDFS inference under actual workload deadlines
followed by write/rollback/restart persistence. These are native product checks,
not refreshed Datalog mutation-competence or RDFS/OWL qualification receipts.

### Remaining staged acceptance

1. **Admission:** deterministic-clock tests prove FIFO/fairness, queue bounds,
   cancellation, timeout, slot release on panic/drop, global versus class
   rejection, and reserved health/recovery capacity under saturation.
2. **Request and transaction budgets:** wire fixtures cover fixed/chunked
   bodies, decompression expansion, multipart limits, parser failure, writer
   queue cancellation, and disconnect. Denied work has zero transaction opens
   and updates remain atomic.
3. **Evaluator resources:** adversarial joins, paths, sort/group/distinct,
   aggregates, construct, update, `SERVICE`, and `LOAD` prove charged counters,
   bounded cancellation latency, no successful truncation, and an explicit
   unsupported result for any uninstrumented promised bound.
4. **Operational qualification:** 1/4/16 and saturation/slow-client workloads
   freeze throughput, p95 queue/cancellation latency, peak observed memory,
   fairness, writer progress, and readiness behavior. Default, RDF-1.2,
   read-only, egress, transaction, and compatibility suites remain green.

Promotion requires a frozen public evaluator plus an independent resource
probe that cannot inspect implementation counters directly. Numeric defaults
and regression ceilings are frozen only after parent-first baselining; this
ADR does not invent production capacity values.

## Consequences

- Overload becomes a bounded, typed, observable state instead of accidental
  thread, connection, or writer starvation.
- One token and deadline connect HTTP admission to the transaction and egress
  guarantees already being built.
- Instrumented operators acquire accounting overhead and configuration
  complexity.
- Hard host isolation still requires deployment controls outside Oxigraph.

## Alternatives rejected

- **Rely only on connection count and a global timeout.** Admitted requests can
  differ by orders of magnitude in body, evaluator, writer, and result cost.
- **Estimate cost from query text and reject heuristically.** Estimates can
  guide a class later but cannot replace runtime bounds or correctness.
- **Claim allocator or CPU hard limits from cooperative cancellation.** Work
  may allocate or block between checkpoints.
- **Use an unbounded priority queue.** It moves overload into memory and allows
  starvation.

## Evidence and task ownership

Current body, timeout, and connection constants are in
[`main.rs`](../../cli/src/main.rs). Transaction admission is implemented in
[`store.rs`](../../lib/oxigraph/src/store.rs), and evaluator operators live in
[`spareval`](../../lib/spareval). ADR-0022 owns metrics/readiness and ADR-0026
owns principal-derived class selection. ADR-0022 is a related operational and
promotion consumer, not a G4.2 implementation prerequisite: G4.2 consumes its
bounded observations and must close before a readiness profile advertises
these workload guarantees. This ADR remains Proposed until G4.2's staged
evaluators and numeric baseline exist.
