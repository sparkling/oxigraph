# Oxigraph programme session handover — 2026-09-15

## Owner stop instruction takes precedence

The owner explicitly said **“stop building”**, then requested this handover.
This document does not authorize restarting implementation, tests, agents,
publication or the timer. Wait for explicit continuation authority from the
owner. Preserve all existing work. No product build or test was run to create
this handover.

The objective remains **complete the plan, programme and ADRs**, not merely the
current upgrade slice. The programme is not complete. Previous conversational
completion percentages were rough judgments, not measured acceptance evidence;
do not use them as task truth or as an ETA.

## Checkout and preserved work

- Canonical checkout: `/home/claude/src/hm/oxigraph`, branch `main`.
- Product HEAD at handover preparation:
  `9229d1f7d75315dcad92e00c7924619cc2d1aff0`
  (`feat(storage): inspect checksummed schema envelopes`).
- Main was 28 commits ahead of the locally recorded `origin/main`; no fetch
  was performed, so this is not a fresh remote-state assertion.
- `AGENTS.md` has a pre-existing owner edit, 14 added lines. Do not absorb it
  into another commit or overwrite it. The latest owner-supplied instructions
  supersede earlier instructions. The Semantic Product worktree exception does
  not apply to Oxigraph: Oxigraph stays main-only, with one source/Git writer.
- The following ten source files contain the applied, **uncommitted and
  unverified** schema-upgrade proposal. Preserve all of them, including the
  three untracked files:

```text
M  lib/oxigraph/src/store.rs
M  lib/oxigraph/src/store/upgrade.rs
M  lib/oxigraph/src/store/upgrade_transform.rs
M  lib/oxigraph/src/store/upgrade_receipt.rs
M  lib/oxigraph/src/store/schema_envelope.rs
M  lib/oxigraph/src/storage/mod.rs
M  lib/oxigraph/src/storage/rocksdb.rs
?? lib/oxigraph/src/store/schema_upgrade.rs
?? lib/oxigraph/src/store/schema_upgrade_tests.rs
?? lib/oxigraph/src/storage/rocksdb/schema_upgrade.rs
```

Do not reset, clean, delete target directories, or reconstruct these files from
HEAD. The handover commit, if present, contains only this document, not the draft.

## Immediate recovery point: real compiler failure, then host timeout

The resumed native Astra Low worker produced a ten-file proposal. Root applied
the exact proposed bytes and compared all ten files successfully. That is
application evidence, not correctness or completed delivery.

Fresh workflow:

- Spec: `target/engineering-delivery/schema-upgrade-astra-low-spec.json`.
- Directory: `target/engineering-delivery/workflow-U5PHgm/`.
- Run: `79677212-3f0c-46b8-a261-7eb04be680c0`.
- Native proposal request 3; root application request 5; completed MCP read 6.
- Former terminal session: `1763`, observed exit **2**.
- `failure.json`: `status=incomplete`,
  `error="Host action timed out after 30 minutes"`, `eventCount=6`.
- Request 7 was an unanswered `mcp-read`. There is no final independent review
  or successful workflow handoff. Do not resume this terminal process or reuse
  its responses as evidence for a new run.

The actual first check is in `target/engineering-delivery/run-CLFyWL/`:

```text
cargo check --locked -p oxigraph --tests -j12
started:  2026-09-12T07:49:23.248Z
finished: 2026-09-12T07:51:34.768Z
exit: 101
sourceStable: true
```

Compiler error **E0283** at
`lib/oxigraph/src/store/schema_upgrade_tests.rs:37`:

```rust
store.insert_named_graph(NamedNode::new_unchecked("urn:empty").into())?;
```

The compiler suggests removing `.into()` because `insert_named_graph` already
accepts `impl Into<NamedOrBlankNode>`. This correction has **not** been applied.
Other failures may appear after it. The six warnings in that check do not
replace the actual compile failure. No writer runtime test pass is established.

The live Ruflo control was inspected during handover preparation and is stale:
it still calls this workflow `native-proposal-running` at request 3. The local
terminal/failure/check records above contradict that status. Correct the live
record on authorized recovery; never interpret the stale row as a live process.

An earlier attempt, `workflow-y9jGc5`, run
`2471ff03-f868-4715-9761-b0fff97ecc96`, session 25384, also terminated with
exit 2 after a host timeout. Its Astra worker encountered a native Codex usage
limit. After the owner reset, the same `gpt-6-astra` Low worker successfully
executed and produced the current draft. Do not assume that historical quota
error proves current unavailability; do not claim availability without a new
actual execution when continuation is authorized.

## Current feature contract

Read [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md),
[ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md) and
[ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md)
before changing this persistence code.

The pending slice implements an explicit **inactive v2-to-v3 shadow upgrade**:

- Mandatory operator-selected RDF write ceiling; no inferred/default ceiling.
- Verify a completed current `BackupReceipt`, exact source checkpoint and all
  twelve column-family key/value contents, excluding only `default/oxversion`.
- Retain the existing source native lease. Never create a `LOCK` in an immutable
  backup package, which may legitimately lack one. Keep paths disjoint and
  offline under exclusive operator ownership; reverify input bytes at sealing.
- Persist one schema UUID and build/profile binding before copying; retries
  retain that UUID and use fresh numbered guarded attempts.
- Preserve namespaces, empty graphs, transaction outcomes, receipts, governance
  and retained outbox records. Reject unknown metadata and incompatible live or
  retained RDF 1.2 requirements. Use existing decoders, not competing codecs.
- Independently reopen and compare output; use a distinct journal and sealed
  receipt. Keep failed attempts and reject torn/tampered completed evidence.
- Contributor bytes are preserved and bound, not semantically reconciled or
  activated by this slice.
- Keep `LATEST_STORAGE_VERSION=2`, ordinary version-3 admission disabled, and
  historical receipts/validators unchanged. No new activation API in this slice.

The old legacy upgrader explicitly excludes governance/outbox/receipts from its
output scope. Do not widen its old receipt contract to accommodate current data.
The new code is a draft of this contract, not proof that every bullet is met.

## Harness and model protocol for authorized continuation

Read [the ordinary harness README](../../tools/engineering-harness/README.md)
and [ADR-0043](../adr/0043-delivery-recovery-and-proportional-release-boundary.md).

1. Recheck physical checkout, main, owner instructions, live task/control and
   exact current diff. Preserve the draft and owner changes.
2. Recover the failed check above; make a fresh repair workflow with current
   source identity, explicit scope and the actual failure as feedback. Do not
   fabricate a no-op proposal or replay an old request identity.
3. Use the integrated `workflow --spec FILE.json` host protocol. Root applies
   exact native proposals. Service its real MCP requests promptly; the CLI does
   not itself provide MCP transport or durable crash-resume.
4. Every product build/test, including diagnostics, uses the `run` subcommand:

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run \
  --task task-1787670632284-k0cti5 \
  --check "Schema upgrade tests compile" -- \
  cargo check --locked -p oxigraph --tests -j12
```

5. After compilation, run the spec's default/RDF-1.2 `schema_upgrade` tests,
   formatting, backup/restore receipt tests and legacy upgrade receipt tests.
   Inspect real results. Use failure feedback for repairs, then independent
   review. Add proportional checks for actual risks found; do not restart an
   unrelated harness-evolution programme.
6. Update ADR/README/current gates only to the verified scope, update live task
   evidence with exact readback, and commit the coherent verified source slice
   on main. No push without current explicit authority.

Implementation: owner-selected native Codex **`gpt-6-astra`, effort `low`**,
replacing Sol High. Independent review: **`gpt-5.6-sol`, effort `medium`**.
Native agents execute; Ruflo tracks them. Historical native IDs were
`/root/schema_envelope_astra` and `/root/schema_envelope_review`; these are not
portable execution handles for a new session. Register actual new IDs if needed.
Use subscription authentication only. If unavailable, report exact client,
model and error and pause; no API keys, OpenRouter or silent substitution.

Do not rely on previous session V8 stores such as `schema-originals` or the
serialized pump function. Recover source from disk and proposals through MCP.
The real `relayWorkflowHost` implementation is in
`tools/engineering-harness/src/workflow-host.mjs`.

## Ruflo records to retrieve through live MCP

| Namespace | Key / identity | Purpose |
| --- | --- | --- |
| programme-controls | oxigraph-six-hour-delivery-course-correction-v1 | Current task/control; executor status is stale as noted above |
| task API | task-1787670632284-k0cti5 | G4.3 safe upgrades; still in progress |
| programme-native-proposals | g43-schema-upgrade-astra-low-v2 | Applied writer proposal; contains `requestIdentity` plus `result.changes` full files |
| programme-reviews | oxigraph-schema-upgrade-native-unavailable-2026-09-12-v1 | Preserved first quota/timeout failure |
| programme-reviews | oxigraph-g43-schema-envelope-read-delivery-2026-09-12-v1 | Last committed reader slice evidence |
| programme-native-reviews | g43-schema-envelope-sol-v1 | Acceptance of the earlier reader, **not the writer** |
| programme-reviews | oxigraph-adversarial-delivery-review-2026-09-07-v1 | Earlier course-correction analysis |

Tracked swarm: `swarm-1789138816909-r3keoi`. Agent records:
`g43-schema-envelope-astra-low-20260911` and
`g43-schema-envelope-review-sol-20260911`. Revalidate, do not infer running work
from a tracking row. Cross-project user-memory targeting is unavailable through
the inspected MCP schema; the repository `user-patterns` search returned no
documentation-handover matches. Neither result means the user database is empty.

## Last verified product slice and programme remainder

HEAD `9229d1f7` implements schema-envelope decoding and offline API/CLI reporting.
Default/RDF-1.2 envelope checks each passed four tests; legacy inspection seven;
safe opens seventeen top-level tests plus five child observations; literal CLI
mapping two; existing CLI inspection nine. Formatting and CLI compilation also
passed. These counts overlap across configurations and do not validate the draft.

Historical reader build `run-gwWSRy` identified `target/debug/oxigraph`,
642,456,072 bytes, SHA-256
`95a66d763ecd5120096270c187026ebaa827d95cff0a2e7d2a3b720232e4d4c6`.
Do not assume that mutable path still contains those bytes. This was a local
development artifact, not a published release or exact-executable journey.

Authoritative scope and current acceptance lists:

- [Persistence writes and parity plan](../plans/persistence-write-and-linked-data-parity-plan.md).
- [Linked-data evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
- [Current delivery gates](../plans/oxigraph-delivery-gates.md).

Implemented native work includes backend-neutral writes (do not rebuild the
August 24 interface), transaction outcome mechanics, egress/cancellation/service
claims, namespaces, change capture, receipts/outbox/retention, transaction-time
SHACL, operational observations, backups/restores, derived-index lifecycle,
text/spatial query integration, statistics/bounded planning and service identity.
R1 source handoff `aa7128bb` and receipts/outbox publication `58d3253c` are
historical delivered milestones, not evidence that every later feature shipped.

Outstanding: complete G4.3 upgrades/profile admission/compatibility and rollback;
remaining G4.2 operator budgets/deadline/fairness acceptance; performance/promotion
gates for planning/indexes and separate authorization acceptance; explicit
federation planning (ADR-0025); RDF4J REST (0029); leased HTTP transactions (0030);
multi-repository lifecycle (0031); incremental entailment (0032). Analytical/WCOJ
(0033), G1.7, containment ADRs 0034–0041, Dream Machine and harness evolution are
deferred, not ordinary product-build prerequisites. TurboKV is excluded;
ADR-0042 retains RocksDB and the historical research.

Recorded system-RocksDB validation was unavailable because `rocksdb.pc >=9.10.0`
was missing. Vendored success is not system qualification. Do not alter frozen
fixtures, expected results, receipts or baselines to pass a gate. No G1.7,
provider qualification, protected runtime mutation or publication is authorized
by this handover.

## Timer and safe session transfer

The six-hour timer was cancelled by the owner. During handover preparation,
`systemctl --user is-enabled oxigraph-programme-review.timer` returned
`disabled`, and `is-active` returned `inactive`. Keep it that way.

Both named schema-writer workflows are terminal failures; there is no accepted
writer result. No new worker or build was started for this handover. Before a
future continuation, check actual live processes/agents rather than assuming
old handles remain live. Preserve ignored workflow/check directories: they hold
the exact failure and proposal evidence. The next useful product action, once
authorized, is the compiler repair above—not another status or planning cycle.
