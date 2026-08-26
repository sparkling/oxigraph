# ADR-0031: Multi-repository lifecycle

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; each current server process owns one
  `Store` and has no durable repository catalog or administrative lifecycle
- Programme task: `task-1787670632716-513bjt` (G4.6)
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
[`store.rs`](../../lib/oxigraph/src/store.rs). No repository manager,
catalog, lifecycle evaluator, or acceptance receipt exists yet; G4.6 owns the
staged product work.
