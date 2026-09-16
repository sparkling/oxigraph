# Current Oxigraph delivery gates

- Reviewed: 2026-09-11; latest source identity is recorded in the bounded
  inspection evidence below.
- Active product task: `task-1787670632284-k0cti5` (G4.3).
- Scope: current execution/acceptance projection, not a replacement for the two
  [parity](persistence-write-and-linked-data-parity-plan.md) and
  [evolution](linked-data-store-evolution-harness-plan.md) scope catalogues.
- Evidence below identifies existing code, tests and recorded runs. This
  checklist update does not itself close a product gate.

## How completion is recorded

Use a requirement, observable completion check, evidence identity and remaining
blocker for each gate. A task row, a percentage, another passing repeat, or a
documentation update is not a completed feature. Record new behavior, newly
closed acceptance gates and supporting process work separately.

The live Ruflo control is a small current-state record. Retrieve its `history`
reference only for a historical question; preserve archived values and old
workflow records. Keep detailed command output in the referenced local run.
Update this checklist and the owning ADR contract when reality changes; both
programme plans link here instead of copying another status narrative.

## G4.3 — safe storage upgrades

[ADR-0028](../adr/0028-safe-storage-schema-upgrades.md) remains **Proposed**
(ADR itself updated 2026-09-16; this checklist re-audited the same date --
see the "Corrected 2026-09-16" notes below for what changed). The following
rows preserve its four staged gates and separate promotion/handoff
requirements. None is claimed fully closed.

| Gate | Proven native boundary | Still required to close the gate |
| --- | --- | --- |
| 1. Inventory and inspection | Offline marker/column-family inspection; typed unknown/newer/legacy refusal; bounded live RDF-feature refusal and retained-outbox consumption errors; explicit feature-independent reporting of live and retained-outbox RDF requirements; explicit existing governed-lineage identity and upgrade-guard observation; verified incomplete/pending/sealed outer upgrade-workspace inspection on the admitted build-bound profile; canonical checksummed envelope decoding with distinct schema UUID and declared RDF/codec metadata. The two real checked-in version-0/1 fixtures are hash-pinned against a recorded constant; `inspect`/`open`/`open_read_only` are proven, with real byte-preservation checks, to refuse current/missing/too-new/corrupt (MANIFEST, WAL-is-not-corruption, and SST footer) layouts and to report an RDF-feature-mismatch store as unsupported, the last of those now exercised in ordinary CI against a separately-built no-default-features CLI. [Inspection](../../lib/oxigraph/src/storage/rocksdb/format_inspection_tests.rs), [ordinary-open refusal](../../lib/oxigraph/src/storage/rocksdb/safe_open_tests.rs), [live features](../../lib/oxigraph/src/storage/rocksdb/feature_compatibility_tests.rs), [codec classification](../../lib/oxigraph/src/store/change_codec_feature_tests.rs), [outbox validation](../../lib/oxigraph/src/store/outbox.rs), [state CLI](../../cli/tests/store_inspection.rs), [upgrade inspection](../../lib/oxigraph/src/store/upgrade_inspection_tests.rs), [hash-pin and corruption coverage](../adr/0028-safe-storage-schema-upgrades.md#hash-pinning-the-real-legacy-fixtures-with-a-collision-resistance-correction-2026-09-16). | Corrected 2026-09-16: envelope writing and the explicit marker-only v2-to-v3 shadow construction/resume/activation API and CLI (`lib/oxigraph/src/store/schema_upgrade.rs`, `cli/src/schema_upgrade.rs`) are implemented, with real OS-level process-kill coverage on all three entry points added earlier this session -- this is not still required, contrary to this row's own prior text. Full history/derived-state admission and frozen cross-profile interrupted-fixture inspection remain open, tracked under the frozen qualification/promotion matrix below, not ordinary delivery. Default metadata-only inspection still reports RDF compatibility unknown; explicit feature inspection certifies only its declared scopes. Making version 3 this binary's own current schema on ordinary `Store::open`/`open_read_only` ("profile admission") is the one genuinely open item here, and it is a deliberate product decision, not a pending gate-1 requirement -- `schema_upgrade.rs`'s own doc comment states plainly that ordinary open never starts, resumes or adopts this path. |
| 2. Shadow transformation | Source-preserving legacy backup, ancestry, inactive preparation and explicit v0/v1 transformation; native quad/topology/namespace and failure checks; both offline shadow-copy preparation (`prepare_upgrade`) and explicit v0/v1 transformation (`transform_inner`) now have real OS-level process-kill coverage across their own PENDING-to-COMPLETE completion boundary, alongside their existing exhaustive synthetic fault-injection coverage of every phase. [Backups](../../lib/oxigraph/tests/legacy_backups.rs), [preparation](../../lib/oxigraph/tests/upgrade_preparation.rs), [transformation](../../lib/oxigraph/tests/upgrade_transformation.rs), [prepare real-process-kill coverage](../adr/0028-safe-storage-schema-upgrades.md#real-os-level-process-kill-coverage-for-legacy-offline-preparation-2026-09-16), [transform real-process-kill coverage](../adr/0028-safe-storage-schema-upgrades.md#real-os-level-process-kill-coverage-for-legacy-transformation-closing-the-pair-2026-09-16). | Full required logical/subsystem comparison, including metadata/receipt/outbox/index state where applicable; rebuild and validate required derived indexes. Inject failure/cancellation at every journal/fsync boundary, preserving the source and rejecting unsealed output; retain disk-exhaustion coverage. Real-process-kill coverage above is for one boundary per function, not every fault phase; the frozen qualification/crash matrix beyond it is a separate track. Existing native tests are not the complete frozen matrix. |
| 3. Receipt and recovery | Verified completed-edge restart and build-bound inactive receipts on the bounded Linux/static Oxigraph/vendored-RocksDB profile. Re-audited 2026-09-16: fresh-process open/validate (`fresh_process_verifies_same_executable_and_rejects_appended_copy`), tampering (multiple receipt/journal/manifest/extra-file cases, including an internal symlink), crash/power-loss (extensive real-process-kill coverage across start/resume phases, edges and occurrences in the recovery workflow, plus the legacy path's own start/resume/activation/prepare/transform crash tests; the v2-to-v3 draft's own `resume_inner` now also has real-process-kill coverage across its completion-rename boundary, closing the last of its three entry points to get one), and path substitution (production code explicitly rejects a symlinked destination-parent ancestor in `activate_upgrade`, tested) each have concrete existing coverage; none of the four is a fully exhaustive per-entry-point matrix. [Recovery](../../lib/oxigraph/tests/upgrade_recovery.rs), [receipts](../../lib/oxigraph/tests/upgrade_receipts.rs), [activation symlink coverage](../../lib/oxigraph/tests/upgrade_activation.rs), [resume_inner real-process-kill coverage](../adr/0028-safe-storage-schema-upgrades.md#correcting-a-stale-next-product-step-claim-and-closing-the-largest-remaining-crash-matrix-gap-2026-09-16). | Complete feature/subsystem/cursor identities and exact-receipt independent qualification remain a separate evaluator-authority requirement (an independent re-implementation comparison), not closeable by an ordinary-delivery test. Corrected 2026-09-16: insufficient-disk checks previously had zero test coverage; that is no longer true for one entry point. An unprivileged size-limited tmpfs remains confirmed infrastructure-blocked (`unshare --user --mount` fails with "Operation not permitted"), but a `/proc/self/fd` path-scoped `LD_PRELOAD` write-interception shim was built, debugged (two real bugs found and fixed while validating it, plus a missing `#include <stdio.h>` found while first building the real test), and a real, two-round-reviewed (`xhigh`, ACCEPT) Rust integration test now exists for `Store::backup_legacy`, injecting a genuine OS `ENOSPC` on the first byte written into the destination and asserting the production `BackupError::Io` preserves `io::ErrorKind::StorageFull` -- see [the test's own record](../adr/0028-safe-storage-schema-upgrades.md#the-first-real-disk-exhaustion-test-closing-gate-3s-zero-coverage-gap-2026-09-16). This is one entry point, not the crash/fault matrix: `prepare_inner`, `transform_inner`, the v2-to-v3 draft's construction/resume/activation and `activate_upgrade` remain covered only by their existing synthetic phase-callback and real-process-kill tests, not by this disk-exhaustion technique. Old preparation/transformation workspaces are not made resumable. |
| 4. Operational compatibility | Fresh, disjoint target activation is implemented; source, backup and sealed workspace remain preserved. A first operational-gate drill runs the full backup → upgrade → explicit cutover → older-binary rollback to preserved source → restore journey for both legacy fixture versions, measuring per-stage duration, peak disk, peak memory, write amplification and (2026-09-16) two complementary read-side ratios (physical block-device reads and cache-inclusive logical reads, since the drill's own recently-written working set stays page-cache-resident and a physical-only figure would misreport near zero regardless of actual read volume). [API](../../lib/oxigraph/tests/upgrade_activation.rs), [CLI](../../cli/tests/upgrade_activation.rs), [operational drill](../../lib/oxigraph/tests/upgrade_operational_drill.rs), [read-ratio instrumentation](../adr/0028-safe-storage-schema-upgrades.md#read-ratio-instrumentation-for-the-operational-drill-with-two-review-rounds-catching-a-measurement-flaw-and-a-codecomment-mismatch-2026-09-16). | Frozen size classes and supported-version windows remain a separate evaluator-authority requirement, not an ordinary-delivery test; the drill's own single synthetic size class and two legacy fixture versions are not a frozen matrix. Corrected 2026-09-16: the ~8.6x disagreement between the two legacy fixtures' own logical-read-ratio figures is decomposed (narrowed to the upgrade/cutover legs, not backup_legacy) and its underlying cause is now explained by direct code reading, not left open -- both legs independently perform substantial synchronous file-copy-and-rehash work over comparable data, which alone explains the correlated duration and read volume; see [the resolution](../adr/0028-safe-storage-schema-upgrades.md#resolving-the-operational-drills-upgradecutover-correlation-with-direct-evidence-2026-09-16). Native activation is not service routing, automatic cutover or rollback qualification. |
| Promotion | The native profile and its limitations are documented; no aggregate qualification is claimed. | ADR-0028's evaluator-only commit, pre-existing frozen fixtures, independent logical export comparison, default/RDF-1.2 and vendored/system-RocksDB matrix, exact receipts and predecessor upgrade/failure path. The recorded system lane lacks `rocksdb.pc >= 9.10.0`; do not count a vendored helper test as system qualification. |
| Obtainable handoff | Envelope reader build `run-gwWSRy` identifies the local CLI artifact; native API, literal CLI mapping and existing CLI inspection tests pass. Exact bytes/hash and scope are in [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md#schema-envelope-read-side-2026-09-12). | Full milestone gates, reproducible source/dependencies and exact publication authority. This post-test development build is not an exact-executable journey or a published release. The previous upgrade-inspection artifact mismatch remains recorded separately. |

Latest bounded implementation: checksummed schema-envelope read side,
`programme-native-reviews/g43-schema-envelope-sol-v1`, workflow
`8f252fa7-1855-46b2-ac47-c85ad19ec5fb`. Astra Low implemented it; Sol Medium
independently accepted exact source/check identities. Formatting, envelope
default/RDF-1.2 (4/4), legacy inspection (7), safe opens (17 top-level plus five
child observations), CLI compilation, literal CLI mapping (2), and existing CLI
inspection (9) pass. No envelope writer or version-3 admission was
implemented as of this specific 2026-09-12 workflow; the envelope writer
and explicit v2-to-v3 construction/activation were implemented in
subsequent work (`lib/oxigraph/src/store/schema_upgrade.rs`, see the
corrected "Next product step" text above) -- version-3 admission on
ordinary open remains a deliberate non-goal, not an open step.
See [the exact read-side boundary](../adr/0028-safe-storage-schema-upgrades.md#schema-envelope-read-side-2026-09-12).

Earlier bounded inspection evidence:
`programme-native-reviews/g43-upgrade-inspection-sol-v1`.
Workflow `4e7df9b6-bd69-4f89-a223-1d02ec4306c5` completed its six declared
checks, native independent review and exact MCP handoff. Formatting and
default/RDF-1.2 inspection (3/4), API receipt/recovery (9+3), default CLI (3+5),
and no-default CLI (2) passed. Supplemental CLI inspection passed three tests;
its post-test artifact mismatch is recorded above. This supports bounded outer
workspace inspection, not full G4.3. Counts across configurations overlap;
child-process observations are not additional unique library tests. Clippy
emits warnings. The earlier feature-inspection workflow timed out; recovered
`run` checks and independent native review do not relabel it successful.

The subsequent formatting-only repair completed workflow
`dfa93bfc-63df-4d6e-89aa-90482b8cbe27`: `run-FC1CD5` passes
`cargo fmt -p oxigraph -- --check`; default/RDF-1.2 inspection checks each pass
seven tests and the default store integration check passes 29. Independent
review is `programme-native-reviews/g43-formatting-sol-v1`. This resolves the
recorded crate formatting failure, not a whole-programme gate; the prior failed
record remains intact. No new CLI artifact was built for formatting-only edits.

Corrected 2026-09-16: this paragraph previously described implementing the
envelope writer and explicit v2-to-v3 shadow upgrade as the next product
step. That work is done -- `Store::start_schema_upgrade`,
`resume_schema_upgrade` and `activate_schema_upgrade`
(`lib/oxigraph/src/store/schema_upgrade.rs`) construct, resume and activate
an inactive marker-only v2-to-v3 shadow copy with a distinct schema UUID
retained across retries, an explicit caller-chosen RDF write ceiling
(`SchemaUpgradeOptions::new` takes no default; the operator must choose),
a bound receipt format (`SchemaUpgradeReceipt::verify`), CLI exposure for
all four operations, and real OS-level process-kill coverage on all three
entry points. See [ADR-0028's implementation status](../adr/0028-safe-storage-schema-upgrades.md)
for the exact current bullet list. This checklist's own prior text was
stale; nothing here should be read as implementation guidance without
checking the ADR's status block first.

What remains open for this stream is not a single next feature to build:
(1) envelope admission on ordinary `Store::open`/`open_read_only` -- making
version 3 this binary's own current schema -- is a deliberate, explicit
product non-goal for this ADR, not a pending step, per `schema_upgrade.rs`'s
own doc comment; (2) crash-matrix breadth beyond the boundaries already
covered (start/resume/activation on both the legacy and v2-to-v3 paths,
plus legacy prepare/transform) remains open the same way it does for gates
2 and 3 -- individually tractable, low-risk increments, not a single step;
(3) the frozen qualification/promotion matrix is a separate evaluator-
authority track, not ordinary delivery.

## Programme boundaries beyond G4.3

| Stream | Current boundary | Remaining programme work |
| --- | --- | --- |
| R1 / writes / audited upstream | Source handoff `aa7128bb` delivered; do not rebuild the August 24 write interface. [ADR-0043](../adr/0043-delivery-recovery-and-proportional-release-boundary.md). | Keep later milestone validation and publication distinct from that historical handoff. |
| G2 metadata, receipts/outbox, SHACL and recovery | Native slices recorded in the programme plans; G2.2/G2.3a-b source publication is separately identified. | Do not infer broader production or semantic qualification from native implementation. Preserve each owning ADR's acceptance requirements. |
| G3 planning, text and spatial indexes | Native/opt-in product paths exist. | G3.2 performance/default promotion, G3.4 frozen performance/promotion and explicit federation breadth remain separately tracked in the scope catalogues. |
| G4.1 service identity / G4.2 workload governance | Native G4.1 closed; G4.2 has implemented limits, cancellation, telemetry and fairness slices. | Full G4.2 resource/fairness acceptance and separate promotion requirements. |
| G4.4–G4.7 linked-data breadth | No completion inferred from dependencies or research. | Versioned RDF4J REST, leased HTTP transactions, multi-repository lifecycle and incremental entailment; retain the dependencies and exit checks in the evolution plan. |
| G4.8 / containment / harness evolution | Research or separately activated work, not an ordinary product prerequisite. | Preserve history and authority requirements. Do not silently mark these designs implemented or restart them to complete an unrelated product slice. |

No whole-programme calendar ETA or completion percentage is supported by this
checklist. Forecasts require a finite selected milestone, identified open
checks and available prerequisites; commit counts do not measure effort.
