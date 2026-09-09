# ADR-0027: Workload admission and operator resources

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-09
- Deciders: Oxigraph parity programme
- Implementation status: G4.2 active; native opt-in global/class admission,
  eligible FIFO, queue timeout/token cancellation, separate operator reserve
  and response-flush lifetime are implemented. Optional absolute request
  deadlines now cover native Simple/finite-RDF/finite-RDFS/bounded-OWL queries and
  transactional paths. Opt-in encoded/decoded request-body, generated/emitted
  result-byte, native inner-join build-row, ORDER BY buffer-row, hash DISTINCT
  retained-row and accumulator-group caps are implemented. Fixed-pool admission counts, occupancy and queue-wait metrics
  are exported through the existing operator listener. File-backed policy
  reload is atomic and operator-usable with immutable per-attempt snapshots and
  startup transport ceilings. Other operator budgets, excluded deadline paths,
  active-work disconnect and full acceptance
  remain open.
  Observed queued socket errors now release admission; FIN-only/silent loss uses timeouts
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
The subsequent queued-abort slice below propagates observed socket failures.
Resource accounting, differentiated priorities, per-principal fairness and
the remaining staged/operational evaluators remain outstanding. Later slices
below implement admission metrics and atomic workload reload. Configured
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

This is still a cooperative, opt-in slice. The subsequent materialization work
below admits finite profiles; the legacy nontransactional Graph Store bulk path
still returns unsupported (400) pending checkpoints. Individual parser, custom callback,
DNS and native storage calls are not preemptible. Active-work disconnect,
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
No profile, expected semantic result or protected receipt is changed.
Native regressions cover expiry before binding, mid-snapshot cancellation,
EOF cancellation, retained explicit tokens, materialization-budget lifetime,
typed metrics/HTTP status and unchanged FROM/empty-graph semantics. Loopback
CLI journeys exercise finite RDF and RDFS inference under actual workload deadlines
followed by write/rollback/restart persistence. These are native product checks,
not refreshed Datalog mutation-competence or RDFS/OWL qualification receipts.

### Bounded OWL and order-preserving copies (2026-09-09)

Deadline-enabled HTTP queries now admit `owl2-rl-rdf-bounded`. The runtime starts
its relative clock before preparation and checks both input copies, datatype
preflight, raw rule candidates before filtering, equality/list/key operations,
semantic witnesses, contradiction deduplication, output ordering and memory
estimation. Datalog retains its existing callback bridge. Checked stable-key
grouping preserves the former ordering and ties; no intermediate-row charges,
rule IDs, semantic expectations or memory-estimate formula are changed.

`Dataset::try_clone_with` copies retained interned mappings, their hash identity,
all six encoded indexes and the named-graph registry with fallible checkpoints.
Both OWL and RDFS use it. This corrects `d7b3a08e`'s RDFS decoded-quad rebuild:
RDF equality and topology survived, but randomized IDs could change iteration
order and first-match behavior. New native regressions check exact indexes,
retained/removed terms, numeric blank nodes, triple terms and cancellation at
every copy checkpoint, plus OWL phase/no-match and resource-result equivalence.

Native Store and loopback HTTP tests exercise OWL inverse-property inference,
FROM merging, empty graphs, read-only materialization, then persistent
write/rollback/restart. A single RDF term parse/format, collection operation or
native call remains non-preemptible. Transient copies/order grouping are not a
complete allocation/RSS budget. This closes the native OWL deadline slice, not
full G4.2 or a refreshed protected semantic/promotion receipt. The next queued
transport-error slice is described below; later sections close reload/metrics
while resource/fairness work remains.

### Observed queued transport failures (2026-09-09)

OxHTTP inserts an additive `AdmissionAbort` handle in each immutable admission
head. A mutex serializes non-blocking `TcpStream::take_error` calls and latches
their result, since reading `SO_ERROR` clears it. Inspection failure also fails
closed, without claiming that the peer necessarily disconnected. The final
transport check atomically polls and disarms the probe before `100 Continue`,
body decoding or application dispatch, including when the hook returns success
despite a failure. Unwind also disarms all clones. An escaped handle cannot
retain a descriptor or consume an error belonging to active/keep-alive work.

Both data and operator listeners call the additive `admit_request` API after
authentication. It checks the probe during existing 10 ms scheduled queue polls
and before activation, cancelling the lease's native token. The old embedded
`acquire`/`admit` APIs remain available. No new thread, socket-mode mutation,
body parsing or dependency is required. Active leases are never released merely
because cancellation was requested.

This closes **observed queued transport errors**, not all connection loss.
TCP FIN can be a legitimate write-half-close; the peer may still read the
response ([RFC 9293 §3.6.1](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.6.1)).
FIN-only closure, silent loss and resets after the final check require existing
timeouts or subsequent I/O checks. Active-work cancellation propagation remains
open. No hard real-time or universal peer-liveness guarantee is made.

Native tests cover latched errors/clones, final-check rejection, unwind and
keep-alive isolation, plus complete GET, fixed-length and chunked half-closes.
Linux real-reset fixtures verify exact data/operator queue counters return to
zero before their 30-second expiry while active capacity stays owned. The CLI
wire journey fills a queue, aborts its writer, admits a half-closed successor,
and verifies absent abandoned data and persistent successful data after restart,
followed by the write/rollback/restart positive control. The reset fixture uses
Linux's unread-response close behavior; it is not cross-platform reset evidence.

The next implemented request-body slice is below. Later sections close result
bytes, reload and exported admission metrics; broader resource/fairness and the
remaining staged acceptance gates remain open. ADR status is unchanged.

### Native request-body byte limits (2026-09-09)

Optional `request_body_limits` in `oxigraph-admission-v1` supplies required
`max_encoded_bytes` and `max_decoded_bytes` unsigned caps, immutable per lease.
Zero allows no bytes at the respective stage. OxHTTP receives the trusted
`RequestBodyLimits` extension after authorization/admission on both listeners.
Without it, the existing decoder remains in use. An excessive declared length
is rejected before `100 Continue`; complete transfer-framed input is otherwise
collected within its cap, then content-decoded within its cap before dispatch.
Chunk trailers are retained. No rejected body reaches a handler, parser, RDF
transaction or the legacy nontransactional bulk path. This does not change the
atomicity of an accepted bulk operation.

Encoded means transfer-decoded entity bytes, excluding headers, chunk framing
and buffered socket read-ahead. Decoded means all content-decoded bytes, not RDF
term count. A typed `RequestBodyLimitExceeded { resource, phase, limit }` maps
to 413; malformed/truncated input maps to 400, unsupported coding to 415.
Rejection closes without draining. Bounded HEAD responses suppress the body
while retaining known representation length instead of inventing zero.

Gzip/x-gzip validates all members, trailers and checksums under one decoded cap.
HTTP deflate accepts zlib wrapping and unambiguous legacy raw streams: a
zlib-looking prefix selects zlib exclusively, with no retry after error.
Some legal raw streams share that prefix and are explicitly unsupported by
this opt-in profile. Both deflate forms require complete stream termination
and no trailing bytes. Encoding lists/other codings return unsupported; without
OxHTTP's existing `flate2` feature only identity is supported. No package or
lockfile changes are required. Absolute deadline checkpoints cover transfer,
decompressed output and compressed input including zero-output gzip members.

Native tests cover exact/+1 boundaries, empty bodies, incomplete framing,
gzip expansion/multiple members/CRC/truncation, zlib/raw termination and prefix
collision, Expect ordering, lease release, deadline expiry, HEAD metadata and
sequential keep-alive with preserved chunk trailers. CLI wire tests verify
401-before-body-limits, 413-before-measured-RDF-work across fixed/chunked,
compressed and Graph Store paths, the operator listener and read-only mode,
then successful writes, queries, rollback and persistent restart.

This closes the native request-body byte slice, not full G4.2. Buffer capacity,
encoded/decoded coexistence and handler copies are not an RSS ceiling. Parser
terms, multipart parts, evaluator work and admission telemetry
remain separate work. Existing pipelined read-ahead limitations are not fixed
by sequential keep-alive coverage. The result-byte slice below now implements
failed-stream rather than well-formed truncated-success behavior. No qualification evidence,
production defaults or promotion claims are changed.

### Native result-byte limits (2026-09-09)

Optional unsigned `max_result_bytes` in the startup profile is immutable per
lease. Zero permits empty bodies; omission adds no byte cap. CLI serializers
use one cumulative `ResultBodyWriter`, including construction and finalization
across streaming buffer resets. This covers buffered/streamed SPARQL results,
Graph Store, service descriptions and generated operator output. OxHTTP
independently caps emitted entity bytes via trusted `ResponseBodyLimit`, captured
before handler dispatch so clearing extensions cannot remove it. These are two
checks against the same cap, not double charging. Headers, framing and trailers
are excluded; static and diagnostic bodies receive the transport check.

Typed `ResponseBodyLimitExceeded { limit, phase }` distinguishes serialization
from transmission. Pre-header overflow of a success returns empty noncacheable
503, without retry advice. Established errors retain their status with an
oversized diagnostic body suppressed, preserving request 400/413/415 mappings.
After headers, exhaustion propagates as a latched I/O error. `ReadForWrite`
also stops converting other serializer/evaluator errors into text plus clean
EOF, with or without the optional cap. Failed streams have no terminating chunk
or trailers. Empty reads do not advance evaluation, and exact-cap reads must
still verify EOF rather than silently truncate a longer representation.

HEAD and status-defined bodyless responses emit no entity; known HEAD length
is retained, while 304 omits a length inferred from its empty body. An endpoint
that generates a HEAD representation still charges generation. Native tests
cover exact/+1/zero, buffered and streamed results, persistent mutation/rollback,
restart, conditional GET, operator/read-only routes, trailer and sequential
keep-alive preservation, typed failures and lease release. Successful semantic
fixtures are unchanged; two ordinary native tests now assert failed I/O instead
of the explicitly obsolete diagnostic-plus-EOF behavior.

This is not a cap on query state, rows, serializer-private term buffers, Graph
Store snapshot/ETag preparation, heap capacity or RSS. Accepted empty mutation
and access-policy-reload acknowledgments can succeed at zero. A response failure
after commit cannot prove rollback. No source dependency, protected evidence,
qualification or production default changes. Full G4.2 remains open.

### Native inner-join build-row limit (2026-09-09)

`spareval::InnerJoinBuildBudget` is an explicit shared cumulative handle, attached
through `QueryEvaluator` or `SparqlEvaluator`. Evaluator/prepared clones and all
native DELETE/INSERT operations retain the same counter. CLI startup option
`max_inner_join_build_rows` creates a fresh handle once per admitted lease.
Omission preserves the uninstrumented path. Zero permits no destination rows;
exactly-at-cap succeeds; only a denied next charge latches failure. Charges
occur before Cartesian/hash inner-join insertion, including duplicate rows and
repeated/nested builds, without reserving from the source iterator's size hint.

`ResourceLimitExceeded { resource: InnerJoinBuildRows, phase: JoinBuild, limit }`
is typed in query and update errors. Iterator pre/post/EOF checkpoints, ASK's
terminal check and SERVICE dispatch/iteration checks preserve the shared sticky
failure even under EXISTS, UNION, aggregates, empty probes or SILENT. Owned
updates check admission, operations, mutation application and final precommit;
borrowed transactions retain the existing caller-discard requirement. There is
no new post-commit rollback claim. Before headers exhaustion maps to empty
noncacheable 503; late failure remains failed I/O, not well-formed truncation.
Existing fixed-label evaluation metrics classify exhaustion as Failed.

This counter promises only native inner-join destination rows. Streaming lateral
joins, probes/scans, row width, other operator buffers, planning, inference,
foreign SERVICE work and RSS/CPU are excluded. Physical plans are unchanged;
there is no broad query whitelist and no claim to bound all evaluator work.
Custom handlers may explicitly share the handle, but opaque remote work is not
accounted. Capacity growth is allocator behavior, not charged row count.

Native tests cover 64-row builds with empty probes (cap 8 fails on the ninth
consumed row; cap 64 succeeds), keyed/Cartesian joins, duplicates/nesting,
masking, exactly-at-cap and zero, multi-operation atomicity through every owned
binding, and CLI buffered/streamed failures with slot release and restart.
These supplement rather than refresh pinned qualification evidence. Other
operator counters, active disconnect, resource telemetry and complete G4.2
acceptance remain outstanding; later sections close admission telemetry and
workload reload.

Validation also found a separate **unbudgeted** query-fuzzer OOM:
`oom-1007e2363b10d32274268b884b4bc2ef68bd4a7a` (raw SHA256
`8e7514804b9502d275ba630ed762e9c6428c0f235fbe9de6acc20e0ef8b78231`).
It originally reproduced libFuzzer exit 71 above its unchanged 2048 MiB cap.
Stage isolation located the failure in optimized evaluation: greedy joins
materialized accumulated path fan-out as their hash-build input. The separate
[ADR-0023 planner correction](0023-statistics-and-bounded-join-planning.md#greedy-hash-build-orientation-correction-2026-09-09)
now builds the smaller estimated side while retaining nullable-path and SERVICE
semantics. The original input completes in 166.361 seconds with no cap or oracle
change, and fresh query/update fuzz runs pass. This is not a repair supplied by
the optional build-row budget, nor a general CPU/RSS guarantee: the streamed
fan-out remains expensive. The raw input is preserved unchanged.

### Native ORDER BY buffer-row limit (2026-09-09)

`SortBufferBudget` adds an independent cumulative row counter through
`QueryEvaluator`, `SparqlEvaluator` and CLI `max_sort_buffer_rows`. Each admission
creates a fresh handle; evaluator/prepared clones, nested/repeated sorts and
all operations of an owned update share it. Every successful child tuple,
including duplicates, is charged before decoded sort-key construction and
destination insertion. The bounded path ignores the child's size hint.
Zero permits empty sorts and unsorted work; exactly-at-cap succeeds, and the
next attempted admission permanently exhausts the budget. Omission preserves
the prior collection path, ordering and duplicate results.

The typed error identifies `SortBufferRows` / `SortBuffer`. Existing shared
iterator, ASK, SERVICE and precommit checkpoints now observe both row budgets,
with inner-join failure checked first. Neither EXISTS, aggregate/UNION masking,
SILENT nor buffered-result EOF can erase an exhausted shared handle. All owned
native update bindings roll back on observed failure before commit; borrowed
transactions retain caller-discard responsibility. CLI maps observed pre-header
failure to empty noncacheable 503 and late failure to a failed stream. Finite
entailment queries retain the same evaluator handles after preparation.

Native tests cover zero/exact/+1, duplicate ordering, repeated/prepared/nested
execution, independent counters, inflated source size hints, denied-row key
construction, masking, all owned update bindings and persistent HTTP rollback,
lease release and restart. Earlier ORDER BY expressions may execute in an
upstream Extend operator; their work/allocations, row width, comparator CPU,
other buffers, inference and RSS remain outside this counter. This closes the
native sort-buffer slice, not full G4.2 or a promotion gate. No dependency,
numeric default, semantic fixture or protected evidence is changed.

### Native admission telemetry (2026-09-09)

`AdmissionController::metrics()` adds a fixed-size process-local observation
without changing the original four-field `AdmissionSnapshot`. Clones share
counters; a new controller starts at zero. One returned acquisition result is
counted once, independently of queue purge/ticket cleanup, lease cloning, drop,
unwind of admitted work and later cancellation. Admission means a lease was
returned, not execution success, commit or proven rollback. Attempts rejected
before acquisition (missing trusted context or access denial), idle connections,
startup validation and denial rendering are excluded.

The fixed pools are `data` and `operator`. Nine dispositions distinguish
admitted, global/class/operator refusal, unknown class, cancellation, request
timeout, queue timeout and unavailable. Queued outcomes form a separate subset;
only those attempts enter the pool's cumulative wait histogram. Wait runs from
locked enqueue to the waiter's terminal scheduling observation, or observation
of an unavailable lock. It may include time after another thread purges the
entry; it is neither evaluation latency nor purely physical queue residence.
Seven inclusive bounds from 100 microseconds through 60 seconds plus infinity
reuse G2.5's measurement resolution, not performance thresholds. Counts and
microsecond sums saturate; exact counter differences are meaningful only before
saturation.

Snapshots copy fixed counters and occupancy consistently, without purging,
dequeueing, releasing leases or performing storage work. A separate metrics-only
mutex uses state-before-metrics lock ordering. Serialization runs after locks
are released. No arbitrary strings, class/policy names, request data, identities
or endpoint labels enter the exported values. Poisoned snapshots fail closed.

With a workload policy, authorized operator `/metrics` appends five families:
`oxigraph_admission_active`, `oxigraph_admission_queued`,
`oxigraph_admissions_total`, `oxigraph_admissions_queued_total`, and
`oxigraph_admission_queue_wait_seconds`. They produce exactly 60 samples, for
at most 467 with existing Store observations. Without a policy they are absent.
A served scrape counts itself as admitted/active in the operator pool. Admission
observation failure returns bounded 503 before storage probing; generated and
emitted result-byte limits remain enforced. Readiness decisions are unchanged.

Native tests cover immediate/queued dispositions, purge-before-observation,
operator reserve, cancellation, clone/drop/unwind ownership, concurrent views,
poisoned queued cleanup, histogram boundaries/saturation, bounded formatting and
privacy. Default/no-default HTTP fixtures verify authorized scrapes, excluded
access denials, overload and HEAD behavior; persistent write/rollback/restart
journeys remain passing. This closes the native admission-observation slice,
not resource-use telemetry, full G4.2 acceptance or production promotion.

### Native DISTINCT retained-row limit (2026-09-09)

`DistinctBufferBudget` adds a third independent cumulative row counter through
`QueryEvaluator`, `SparqlEvaluator` and CLI `max_distinct_buffer_rows`. One fresh
handle belongs to each admission; evaluator/prepared clones, nested/repeated
physical operators and every operation of an owned update share it. Each tuple
newly retained in an operator's hash set is charged before cloning/insertion,
without reserving from the source size hint. Duplicates in that set do not
recharge, but another set retaining the same tuple does. Omission keeps the
existing uninstrumented path and successful first-occurrence sequence.

Zero permits no retained tuples. Exactly-at-cap remains usable until the next
unique tuple is attempted, which latches `DistinctBufferRows` / `DistinctBuffer`
failure. Early consumers such as ASK, EXISTS and LIMIT can stop before that
attempt; their successful completion is not masking an exhausted budget.
Shared iterator/terminal, SERVICE and owned precommit checks preserve observed
failure, after the existing join-then-sort precedence. Owned updates roll back
the whole request before commit; borrowed transactions remain caller-discard.
CLI pre-header failure is empty noncacheable 503, and late failure cannot close
as a successful truncated stream. Finite entailment retains the same handle.

This counts physical hash DISTINCT, including the existing planner's lowering
of REDUCED in both optimization modes. An eliminated operator charges nothing.
Aggregate DISTINCT accumulators, consecutive deduplication, group/path/dataset
buffers, child row creation, row width, hashing/comparison CPU, allocation
capacity, inference, opaque remote work and RSS are not bounded by this counter.
No optimizer change, broad query whitelist or production numeric default is
introduced.

Native tests cover zero/exact/+1, duplicate-heavy and bound/unbound mappings,
first-occurrence order, repeated/nested/prepared sharing, independent counters,
inflated source hints, denied-row clone/read behavior, terminal/masking paths,
every owned update binding and persistent HTTP rollback/release/restart.
Default/no-default/all-feature evaluator tests and both one-minute evaluator
fuzz targets pass. These verify this native product slice, not full G4.2,
resource-use telemetry, production promotion or refreshed semantic evidence.

### Native accumulator-group budget slice (2026-09-09)

`GroupBufferBudget` adds an independent shared counter through `QueryEvaluator`,
`SparqlEvaluator` and CLI `max_group_buffer_rows`. One unit is charged for each
new native group-map entry, before constructing its accumulators or obtaining
the map entry. Repeated keys within a map do not recharge; nested maps, cloned
evaluators, prepared re-executions and all operations of an owned update share
the cumulative handle. Each CLI admission gets a fresh handle. Omission keeps
the original grouping path and result semantics unchanged.

Zero permits no constructed groups. A physical global aggregate creates one
empty-key group even on runtime-empty input, and charges before touching its
child. Empty keyed input creates no groups. Exactly-at-cap remains valid until
another group is attempted, which latches `GroupBufferRows` / `GroupBuffer`.
Optimizer-eliminated groups charge nothing; existing optimization is unchanged.
Group accumulation is eager, so an outer ASK, EXISTS or LIMIT cannot conceal
an already exceeded cap. Iterator, SERVICE, terminal and owned precommit checks
include this handle after existing join, sort and distinct failure precedence.
Owned updates roll back the entire request; borrowed transactions are caller-
discard. HTTP pre-header refusal and failed-stream behavior remain unchanged.

The limit counts group-map entries, not their contents or child rows. Temporary
keys/row width, aggregate DISTINCT sets, GROUP_CONCAT growth, hashing/comparison
or accumulator CPU, allocation capacity, other operators, inference, opaque
remote work and RSS remain excluded. No dependency, optimizer change, numeric
production default or general memory-bound claim is introduced.

Native tests check zero/exact/+1, repeated and bound/unbound keys, COUNT/SUM and
HAVING results, runtime-empty global groups, eliminated groups, cumulative
nested/prepared sharing and independent counters. An instrumented custom
aggregate proves denied groups construct no accumulator and stop child reads.
All six owned update bindings, an independent commit/rollback probe, HTTP
refusal/stream failure, finite RDF and fresh-admission/restart journeys are
covered. This is a native product slice, not full G4.2 acceptance or promotion.

The subsequent query fuzz run found a separate unbudgeted property-path/DISTINCT
OOM (`oom-428a86b5479b5a512f12339afbe6dedb33d73113`, SHA-256
`b2827c45e0f23e6112be571129de320979abc3b040c2f3bc37da6dda6c9d8850`).
It contains no grouping operator and originally reached 2,284 MiB against the
unchanged 2048 MiB fuzz cap. The input is preserved unchanged. Passing group
tests and the separate update fuzz run did not close that gate, and the optional
group cap is not its repair.

The gate is now closed by the separate
[ADR-0023 empty-probe short-circuit](0023-statistics-and-bounded-join-planning.md#empty-probe-short-circuit-for-cartesian-joins-2026-09-09):
optimization-disabled evaluation materialized a whole left-deep Cartesian build
before observing an absent right-hand quad predicate. The exact original input
now replays in 1.544 seconds with exit status zero under the same 2048 MiB cap
and unchanged oracle, and fresh 60-second runs complete 35,338 query and 23,091
update executions, each with exit status zero. This closes the reproduced
query-fuzz gate for that preserved input. It supplies no general evaluator
memory bound, and broader resource accounting and fairness plus
full G4.2 acceptance remain open.

### Native atomic workload-policy reload (2026-09-09)

File-backed `AdmissionController`s now retain their configured regular-file
startup source and expose `reload(&AccessController)` as a convenience for an
already-authorized local/operator caller. The controller itself performs no
authentication. The cancellation-aware form used by HTTP checks the admitted
token before file access and again at the final locked swap checkpoint. It reads
and validates at most 64 KiB before taking the scheduling mutex. This synchronous
bound is not hard filesystem-I/O preemption or protection against hostile local
filesystem races. With access-before-workload
lock ordering, the atomic swap holds one coherent access-policy read guard and
requires the same workload `policy_id`, a strictly increasing version, all
currently declared access classes, and data/operator active-plus-queued totals
no larger than the original listener transport envelopes. In-memory-only and
missing-file controllers fail closed. Invalid, oversized, equal/stale,
wrong-ID, class-incomplete and either-envelope-growing candidates preserve the
last good in-memory snapshot; rejection does not repair the configured disk file.

Every admission attempt clones exactly one `Arc<WorkloadPolicy>` while holding
the scheduler state lock. Queue entries and leases/clones retain it. That one
snapshot supplies queue and request deadlines, request/result byte caps, all
four implemented row budgets, retry advice and policy identity/version. Reload
does not reorder or evict queued entries, reset occupancy/metrics, enlarge an
existing budget, release live capacity, or change response-lifetime ownership.
Already active/queued requests drain under their old snapshots. New attempts
use the replacement limits against all outstanding shared counts; reduced caps
are prospective rather than an instantaneous global shrink. Removed classes
continue only for old queued/active snapshots, and zero-count obsolete class
entries are deleted so repeated class changes remain bounded.
HTTP admission failures retain their attempt-specific snapshot for retry advice;
standalone `denial(error)` rendering uses the current policy because there is no
attempt snapshot.

The trusted-proxy access profile adds a distinct serialized
`workload-policy` endpoint requiring `OperationKind::Operator`. Empty
`POST /workload/policy/reload` is handled only on the loopback operator listener
with explicit `Content-Length: 0`, no transfer encoding and no query. It rereads
the startup file and returns 204 or the existing bounded generic reload-rejection
400; cancellation/deadline failure returns empty noncacheable 408. It accepts no
caller path or JSON. Existing access-policy, metrics, audit, general operator,
reader and anonymous grants receive no privilege; data-plane/non-POST/query/body
attempts fail. Authorization and admission remain before body or RDF access,
and lease/deadline/result guards remain attached. Missing workload setup fails
closed. No route is advertised and defaults are unchanged.

The minimal additional rule is
`{"subject":"operator","endpoint":"workload-policy","methods":["POST"],"operations":["operator"],"workload_class":"default"}`.
It grants only this route and does not broaden an existing operator rule.

Access-policy reload remains independent: it may introduce a class absent from
the current workload policy. Subsequent requests assigned to that class are
denied closed and never consume default capacity. A later workload reload must
cover the coherent current access class set, but the two policies do not form a
new joint transaction.

Native controller tests cover candidate/schema/regular-source/version/identity/
class and both transport-envelope failures, prepared-candidate cancellation at
the final swap, concurrent old/new coherent snapshots, exact old active/queued
budgets and deadlines through reload, clone release, prospective lower caps,
removed-class drain, bounded accounting and preserved telemetry. Default and
no-default loopback tests cover the distinct grant and pre-body denial matrix,
body/query/data-port rejection, serve and serve-read-only request/result-limit
replacement with an already admitted v1 request, writable rollback/restart, and
the independent access-reload unknown-class window. These are source-level
native product checks, not G4.2 production qualification or promotion.

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
