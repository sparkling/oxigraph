# ADR-0031: Multi-repository lifecycle

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-29
- Deciders: Oxigraph parity programme
- Implementation status: bounded pure lifecycle model and opt-in Linux
  create/reconcile/open/quiesce catalog implemented below. Each current server process
  still owns one `Store`; no administrative lifecycle is activated
- Programme task: `task-1787728710646-enu8i1` (G4.6)
- **Depends on**:
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)
- **Related**:
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md),
  [ADR-0030 — Leased remote HTTP transactions](0030-leased-remote-http-transactions.md)

## Context

The CLI and server open one memory or RocksDB `Store`, then route `/query`,
`/update`, and Graph Store requests to it. Running several repositories today
means running several processes and managing their directories externally.
Jena and RDF4J expose multi-dataset/repository administration, but copying
their route shapes without a durable lifecycle would make path traversal,
partial creation, unsafe deletion, incompatible upgrades, and resource
exhaustion part of the product API.

Multi-repository hosting is a server and operations capability. It must not
change RDF dataset semantics, imply federation, or turn user-selected names
into filesystem paths. Repository creation and deletion also need stronger
failure and authorization evidence than ordinary RDF writes.

## Decision

Introduce an optional `RepositoryManager` for server deployments. The embedded
`Store` API and single-repository server mode remain supported and do not pay
for a catalog. The manager owns one configured root, a versioned catalog, an
operation journal, repository handles, and a reconciliation loop. A repository
has an external `RepositoryId`, an internal random UUID, a generation, a
storage/configuration profile, and one of these durable states:

`Provisioning`, `Closed`, `Opening`, `ReadyReadWrite`, `ReadyReadOnly`,
`Quiescing`, `Tombstoned`, `Deleting`, or `Failed`.

The Rust surface starts with typed operations equivalent to:

```text
RepositoryManager::open(root, options)
RepositoryManager::create(spec, expected_catalog_generation)
RepositoryManager::repository(id) -> RepositoryHandle
RepositoryManager::quiesce(id, expected_generation)
RepositoryManager::delete(id, expected_generation, retention_policy)
RepositoryManager::reconcile()
```

`RepositoryHandle` exposes the selected `Store`, effective runtime
capabilities, lifecycle generation, readiness, and cancellation context. It
does not expose the manager root or physical directory. Manager methods return
typed receipts identifying the operation and before/after generations; they
never return a successful state merely because a directory exists.

`RepositoryId` is case-sensitive and matches
`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. A route segment is percent-decoded exactly
once, validated, and looked up in the catalog. Physical directories are named
only by the manager-generated UUID. Remote specifications select an
operator-registered storage and policy profile; they cannot provide an
absolute path, arbitrary RocksDB options, Cargo features, egress policy, or
host command.

Creation is a recoverable state machine:

1. reserve the ID and UUID in the catalog as `Provisioning`;
2. create a manager-owned temporary directory with restrictive permissions;
3. initialize and validate the requested store/schema profile;
4. fsync the store, journal, directory, and catalog boundary;
5. atomically move the directory into its UUID location; and
6. publish `Closed` or the requested ready state with a completion receipt.

On restart, reconciliation completes or rolls back each journaled phase. An
unrecorded directory never becomes a repository, and a catalog entry never
becomes ready until its storage identity and schema agree.

Deletion is deliberately recoverable. A generation-checked request first
marks `Quiescing`, rejects new work, cancels or drains bounded active queries
and ADR-0030 leases, creates the configured ADR-0022 recovery receipt, and
atomically moves the UUID directory into manager-owned trash. It then records
`Tombstoned` with a retention deadline. Irreversible purge is a separate
privileged operation after retention and is never implied by HTTP `DELETE`.
Rename, clone, and hot relocation are excluded from the first profile.

Native data-plane routes are scoped as
`/repositories/{id}/query`, `/update`, `/store`, and `/transactions`; native
administration is under `/admin/repositories`. Root-level single-repository
routes remain a separately configured compatibility profile and never select
a default repository based on untrusted headers. ADR-0029 may translate its
RDF4J route set to the same manager, but does not own storage or deletion
semantics.

Each repository has its own store UUID, schema version, writer gate,
namespaces, commit/outbox sequence, derived-state cursors, backup receipts,
readiness, and configuration generation. The manager applies ADR-0027 global,
tenant, and per-repository budgets before opening files or admitting work.
Repository-level readiness is distinct from manager readiness; one failed
optional repository may be isolated while catalog corruption or unenforceable
global limits fail the manager closed.

## Security and operational behavior

- ADR-0026 defines separate data-plane read/write, repository create,
  configure, quiesce, delete, restore, and purge permissions. Listing is a
  privilege; IDs are identifiers, not secrets.
- All root containment, ownership, regular-file, symlink, and mount checks run
  before open, recovery, move, or purge. User-controlled strings never join a
  filesystem path.
- Catalog and operation records exclude RDF, queries, credentials, and remote
  IRIs. Audit binds principal, repository UUID, operation, generation,
  disposition, and receipt reference according to the identity policy.
- Metrics aggregate by state and bounded policy class by default. External
  repository IDs are not default labels; operator diagnostics may expose them
  only through a privileged bounded view.
- File-descriptor, memory, disk, query, writer, backup, outbox, and derived
  index budgets are reserved before a transition becomes ready. Reservation
  failure leaves a recoverable non-ready state.
- Storage upgrades follow ADR-0028 per repository. The manager never opens all
  repositories merely to migrate them, and a mixed-version catalog reports
  exact compatibility rather than advertising blanket readiness.
- Effective service descriptions are generated per repository under ADR-0019
  and do not infer capabilities from manager configuration alone.

## Explicit non-goals

- Cross-repository queries, implicit federation, joins, updates, or atomic
  commits. Explicit remote federation remains ADR-0025.
- Clustering, replication, automatic failover, or a shared distributed
  repository catalog.
- Sharing one RocksDB column-family set or writer gate across repositories.
- User-selected physical paths, arbitrary plugins, or executable repository
  configuration.
- Immediate irreversible deletion, hot rename, clone, snapshot export, or
  live relocation in the first profile.
- Making embedded `Store` callers depend on server administration types.

## Staged evidence gates

1. **Lifecycle model.** A frozen deterministic state-machine evaluator covers
   create/open/close/quiesce/tombstone/restore/purge and every invalid
   transition, using generation compare-and-swap and replayable traces.
2. **Filesystem failure evaluator.** Fault injection surrounds catalog write,
   fsync, store creation, validation, rename, checkpoint, trash move, and
   purge. Restart reconciliation yields one documented state with no escaped
   paths, orphan readiness, or accidental deletion.
3. **Isolation and protocol evaluator.** Controlled repositories with
   identical RDF prove route isolation, authorization, per-repository service
   descriptions, independent writer gates, lease cleanup, and absence of
   cross-repository graph or namespace leakage.
4. **Upgrade/recovery evaluator.** Mixed schema versions, incompatible stores,
   incomplete backups, restore under a new UUID, catalog recovery, and
   tombstone retention compose with ADR-0022 and ADR-0028.
5. **Resource benchmark.** Pinned 1/16/64-repository profiles measure startup,
   lazy open, file descriptors, resident memory, disk reservation, request
   latency, quiesce time, and noisy-neighbor behavior. Numeric limits and
   supported repository counts are frozen only from measured parent-first
   baselines.

The administration routes remain disabled until the authorization, failure,
upgrade, and destructive-operation gates all pass. RDF4J route conformance
cannot promote the manager by itself.

## Consequences

- One process can host independently governed repositories without confusing
  repository selection with federation.
- Creation and deletion become auditable, recoverable state transitions.
- The catalog, reconciliation loop, quotas, and per-repository readiness add a
  substantial operational subsystem to an otherwise embeddable store.
- Internal UUID directories and recoverable deletion reduce path and operator
  risk but make manual directory manipulation unsupported.
- Resource overhead establishes an evidence-based upper bound; this ADR does
  not promise arbitrary repository counts.

## Alternatives rejected

- **Use the repository ID as a directory name.** Encoding and traversal bugs
  would become storage authority.
- **Scan a root directory at startup and treat every child as ready.** Presence
  is not a completed create, compatible schema, or authorized catalog entry.
- **Delete a repository directory directly.** Partial failure and mistaken
  targets would be difficult or impossible to recover.
- **Run all repositories through one shared store.** Graph naming does not
  provide independent transaction, backup, authorization, or lifecycle
  boundaries.
- **Make RDF4J compatibility the internal manager.** A compatibility route is
  an adapter, not the authoritative lifecycle or failure model.

## Evidence and task ownership

The current singleton server setup is visible in
[`main.rs`](../../cli/src/main.rs): `serve` receives
one `Store`, and the request router forwards every data route to it. Current
store backup, validation, and open boundaries are in
[`store.rs`](../../lib/oxigraph/src/store.rs). The separate opt-in embedded
catalog below does not activate server routing or establish a frozen lifecycle
qualification receipt; G4.6 owns the remaining staged product work.

## Deterministic lifecycle model (2026-09-29)

`cli/src/repository.rs` implements the nine-state, single-repository pure model
with exact case-sensitive ID grammar, injected logical time, generation CAS,
checked exhaustion/retention arithmetic and atomic rejection. Private instance
identity and generation bind non-cloneable transition handles; rejected calls
leave them usable, successful completion prevents replay. Creation/opening
require explicit validation, quiescing rejects new work, and closing/tombstoning
require explicit work/lease drain assertions. Restore/purge prerequisites are
typed caller assertions, not authenticated backup or deletion evidence.

The public trace consumer covers 256 deterministic seeds, bounded shrinking,
independent transition/oracle arithmetic, all state/operation rejection pairs,
identity/replay boundaries and injected-fault negative controls. No filesystem
manager, journal, catalog, HTTP route or storage operation is introduced.

Original ordinary workflow `3153eaf5-32f6-41b8-96ff-6669eb9f1311` expired
with `Host action timed out after 30 minutes`; its compiler failure and timeout
remain negative evidence. Original Opus repair
`8870fde0-c2d7-41bb-a500-2f0a83f192da` completed later. Root validated exact
request/response/read hashes before applying it only to `source-95A4DO`, then
removed a test-only unused-result warning. No failed workflow acceptance was
inherited and no watchdog changed.

Fresh Sonnet 5.5/high review `a2752bfe-ac08-499b-b54b-9f687feb2cb7`, reviewer
`4a35ffe5-9c1d-4de5-a3dc-db2a25235ee2`, accepted exact repaired source.
Response SHA256:
`20c292bbee031fa4f2de6dbe55ab12758a1b22555f3817809042b106fe6cfe1f`.
Candidate default/no-default checks each pass 31. Their direct logs are
`target/engineering-delivery/lifecycle-final-default.log` and
`target/engineering-delivery/lifecycle-final-no-default.log`; these are
coordinator-observed checks, not manufactured runner receipts. Formatter passes.

Owner revalidated 15,223 unchanged included source inputs, nine submodule pins,
14 supplemental reads and exact reviewed file hashes against accepted main
`3ab852fd7`. The intervening F0 changes are disjoint from this packet's reads
and mutations. Retained sibling custody passed owner independence checks before
serial integration. Canonical checks bind stable source before this append:

- `run-tT6041`: no-default lifecycle 31 plus existing lease model 37 passed.
- `run-8jGZoF`: default lifecycle 31, lease model 37 and CLI library 77 passed.

Exact source SHA256:

- `cli/src/lib.rs`: `40dbee293df3dc41475602de59375a9e0337066634c9d31630c4a17d2784bc05`.
- `cli/src/repository.rs`: `5ed0d962b73fccdf4d02c022863ca779339addc31b991d05766604e440c78c05`.
- `cli/tests/repository_lifecycle.rs`: `cd0008de8f9716a6c1f4576a23dc80cf69e32e62897b9942da28445af5207a25`.

Migration registry alias `task-1790681494161-as3snp` retains original G4.6
outcome identity. Only this ordinary model slice is accepted, not frozen
qualification gate 1 or the full manager. Filesystem recovery, isolation,
protocol, upgrade and resource gates remain open. ADR stays Proposed; no
server activation, protected-data change, qualification or publication.

## Bounded Linux create/reconcile/open catalog (2026-09-29)

`cli/src/catalog.rs`, `catalog/fs.rs` and `catalog/codec.rs` implement the
opt-in embedded manager, consumed by `cli/tests/repository_catalog.rs` with real
RocksDB stores. The only dependency change connects existing workspace `libc`;
no package or version is added. The server still uses its singleton Store.

One private, canonical, same-device root has an exclusive lifetime `flock`.
External IDs never become paths; internal UUIDv4 directories hold stores.
Bounded checksummed canonical JSON records catalog generations and per-entry
`Reserved`, `Validated`, `Closed` or `Failed` phases as the outstanding-operation
journal. Creation reserves identity, initializes and flushes staging, verifies
read-only materialization, persists validation, publishes the directory and
records Closed with directory/catalog sync boundaries. Restart never initializes
missing stores or adopts orphans. Handle lifetime retains the manager lock and
counted slot; no cloneable raw Store escapes. Runtime readiness is not persisted.

Directory device/inode plus an explicit versioned format fingerprint bind manager
materialization, not a governed StoreIdentity, physical DB UUID, backup or restore
receipt. The format fingerprint uses stable accessors and length-prefixed bytes,
with a golden vector, not Rust Debug formatting. Catalog generations are distinct
from process-local lifecycle-model generations. The root trusts its OS owner;
arbitrary concurrent same-uid filesystem mutation is outside this profile.

Explicit positive limits bound repositories, catalog bytes, root scans, open
handles, store-file verification scans and model retention/generation. Staging
and pending-catalog capacity are reserved before mutation. Transient I/O and
resource/compatibility refusals do not turn Closed into durable Failed; uncertain
post-mutation errors poison the manager until reopen. Definite identity or
corruption failures remain nonready with bytes preserved. Initial-write pending
debris is distinguishable from unknown catalog history and retained in inventory.

Actual repeated-open testing reached 131 native files against the test's explicit
128-file ceiling at cycle 29. The ceiling was not increased and no logs deleted.
`store_files` is an admission scan bound, not a physical disk-growth reservation:
writes/compaction/native metadata may grow the directory. Post-open admission
checks the bound again before returning a ready handle. Subsequent Limit refusals
retain Closed and bytes. Limits must match the persisted catalog; no automatic
reconfiguration or maintenance is provided. Retained crash debris can also exhaust
scan capacity and require separate operator intervention. Full Store validation
on open is proportional to dataset size and has no cancellation seam. Device/inode
changes on copying or restoring a root fail identity checks. These are explicit
limitations of this slice, not production resource or recovery qualification.

Fresh Sonnet 5.5/high review `a64fa774-a165-4b01-aeb2-6032673bbf19`, worker
`c71b5142-028d-4a6d-977a-972a56a03cc4`, accepted exact repaired source.
Response SHA256:
`63de3bcd20ece871e853451b7f631eecc9b4e229781624cb1a1e9a285b82d550`.
Owner verified 15,231 unchanged source inputs, 27 supplemental reads, exact
candidate/check hashes and stopped external actions before serial integration.

Canonical ordinary receipts bind stable source before this evidence append:

- `run-w2ZxH9`: 163 no-default library/catalog/lifecycle/lease-model tests.
- `run-0Mkx0e`: 211 default tests, additionally including lease registry.
- `run-U3Gg1r`: affected `oxigraph` CLI binary build.

Candidate matrices pass the same counts. Scoped formatter passes; Clippy exits
0 with warnings, not clean lint. Sixteen public catalog tests cover exact
process-exit phase outcomes, explicit in-process poisoning, real RDF isolation,
kill/reap lock release, root/path/catalog corruption, missing materialization,
truncated SST refusal, initial-write recovery, transient/resource attribution,
capacity reservation and repeated open/flush/restart. Process-spawn fixtures
exclude other manager lifetimes to avoid inherited flock descriptors before exec;
ordinary tests may run concurrently. Crash-phase exits are not all SIGKILL tests.

Original native author stall, rejected reviews `8159887c`/`ec41b38a`, failed
compiles/tests and prior ACCEPT `562a5a57` remain historical evidence, not inherited
acceptance. Canonical `run-58GxaL` rejected that earlier candidate: syscall tracing
reproduced post-open `openat` ENOENT for an SST removed during live compaction.
The scoped repair tolerates disappeared/unlinked entries only in the live scan,
counts every enumerated entry and retains other guards; offline verification
remains strict. Evidence resides under `target/engineering-delivery/`, including
`catalog-reopen-syscall-6.log`, `catalog-review-repair-*-7.log` and
`catalog-integration-a64fa774-a165-4b01-aeb2-6032673bbf19.json`.

Original G4.6 outcome remains `task-1787728710646-enu8i1`, registry migration alias
`task-1790681494161-as3snp`. No HTTP/admin/delete/restore/purge profile, frozen
evaluator, benchmark, service claim, qualification or publication is accepted.
Full lifecycle, authorization/isolation, upgrades and resource gates remain open;
ADR remains Proposed.

## Manager-owned quiesce and drain (2026-09-29)

The opt-in catalog now fences counted handles before Store access, persists
`Quiescing`, and permits completion only after actual handle drop. Receipts bind
repository ID, internal UUID and entry generation; Debug omits the UUID.
Restart retains non-ready Quiescing on transient/resource refusal, isolating
other repositories. Definite identity mismatch becomes Failed. Completion
re-verifies materialization before Closed. No caller drain assertion, deletion,
lease cancellation, HTTP route or server activation is introduced.

Ordinary workflow `300f80f6-ce9e-44f7-8e83-f045695917a2` used Sonnet 5.5/high
ordinary roles and Opus/high repairs. Fresh reviewer
`8cf4d446-a220-4684-9d00-d0add141bf4b` accepted exact candidate; response SHA256
`31c5c6fb00a1b5878d56ce2a21cd989304ff37612a14fd243e2be79ce04d5128`.
Candidate default/no-default matrices each pass 69. Lane SHA256
`cbf76cdd8ad39c83dbae93f42b83a401b48cc0072dde13a47dabeea768655219`
and 40 existing referenced files verified; structured MCP readback and native
learning retained. Earlier catalog-generation, cross-root receipt, child-custody,
restart-isolation and Debug reviews remain negative evidence.

Before integration, owner verified 15,238 unchanged source inputs, 32 read
dependencies, exact reviewer/source identities and stopped lane actions. Existing
coordinator custody checks admitted integration while unrelated snapshot-bound
lanes continued. Canonical formatting changed whitespace only, verified against
the reviewed candidate; original check receipts remain preserved. Final formatted
source passes 186 no-default tests (`run-Ko2I2l`), 234 default tests
(`run-MOR8ZN`) and the CLI binary build (`run-XIQq8c`). These include CLI library,
catalog, quiesce, lifecycle and lease model checks, plus default lease registry.
Source/sourceAfter bindings match before this evidence append. Scoped formatter
and diff checks pass; no warning-free lint claim.

Exact source SHA256:

- `cli/src/catalog.rs`: `66b352fcbfdd1f4e2a46ede396098b5a8ab0120b352123453f9560d2bc6de82e`.
- `cli/src/catalog/codec.rs`: `fbe3eed1bdfa3b7fdb80eb26714ee06f53f782ff2a4a6581528708e121adbeb8`.
- `cli/tests/repository_catalog_quiesce.rs`: `f895176b1b3a1bb0dd9ce6cc56a621f9152314dc5eb888811e7f3e7b1707204d`.

Original G4.6 and migration alias remain open for recovery-backed tombstone,
restore/purge, protocol/isolation and resource gates. This accepts bounded
ordinary quiesce only, not qualification or production readiness. ADR remains
Proposed; no protected-data change, promotion or publication follows.
