# Current Oxigraph delivery gates

- Reviewed: 2026-09-11, source `991c480a`.
- Active product task: `task-1787670632284-k0cti5` (G4.3).
- Scope: current execution/acceptance projection, not a replacement for the two
  [parity](persistence-write-and-linked-data-parity-plan.md) and
  [evolution](linked-data-store-evolution-harness-plan.md) scope catalogues.
- Evidence below identifies existing code, tests and recorded runs. This
  documentation review did not rerun product tests or close a product gate.

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
(updated 2026-09-11). The following rows preserve its four staged gates and
separate promotion/handoff requirements. None is claimed fully closed.

| Gate | Proven native boundary | Still required to close the gate |
| --- | --- | --- |
| 1. Inventory and inspection | Offline marker/column-family inspection; typed unknown/newer/legacy refusal; bounded live RDF-feature refusal and retained-outbox consumption errors. [Inspection](../../lib/oxigraph/src/storage/rocksdb/format_inspection_tests.rs), [ordinary-open refusal](../../lib/oxigraph/src/storage/rocksdb/safe_open_tests.rs), [live features](../../lib/oxigraph/src/storage/rocksdb/feature_compatibility_tests.rs), [codec classification](../../lib/oxigraph/src/store/change_codec_feature_tests.rs), [outbox envelope priority](../../lib/oxigraph/src/store/outbox.rs), [CLI](../../cli/tests/store_inspection.rs). | Required-feature, store-UUID and interrupted-upgrade inspection; the checksummed schema/feature/subsystem envelope; full history/derived-state admission. Hash-pin v0, v1, current, missing, corrupt, too-new, RDF-feature-mismatch and interrupted fixtures, and prove inspect/open/read-only source-byte preservation under their literal contracts. Inspection still reports RDF compatibility unknown. |
| 2. Shadow transformation | Source-preserving legacy backup, ancestry, inactive preparation and explicit v0/v1 transformation; native quad/topology/namespace and failure checks. [Backups](../../lib/oxigraph/tests/legacy_backups.rs), [preparation](../../lib/oxigraph/tests/upgrade_preparation.rs), [transformation](../../lib/oxigraph/tests/upgrade_transformation.rs). | Full required logical/subsystem comparison, including metadata/receipt/outbox/index state where applicable; rebuild and validate required derived indexes. Inject failure/cancellation at every journal/fsync boundary, preserving the source and rejecting unsealed output; retain disk-exhaustion coverage. Existing native tests are not the complete frozen matrix. |
| 3. Receipt and recovery | Verified completed-edge restart and build-bound inactive receipts on the bounded Linux/static Oxigraph/vendored-RocksDB profile. [Recovery](../../lib/oxigraph/tests/upgrade_recovery.rs), [receipts](../../lib/oxigraph/tests/upgrade_receipts.rs). | Complete feature/subsystem/cursor identities and exact-receipt independent qualification, including fresh-process open/validate, tampering, crash/power-loss, path substitution and insufficient-disk checks. Old preparation/transformation workspaces are not made resumable. |
| 4. Operational compatibility | Fresh, disjoint target activation is implemented; source, backup and sealed workspace remain preserved. [API](../../lib/oxigraph/tests/upgrade_activation.rs), [CLI](../../cli/tests/upgrade_activation.rs). | Complete backup → upgrade → explicit cutover → older-binary rollback to preserved source → restore drills; frozen size classes and supported-version windows; duration, peak disk, peak memory, read amplification and write amplification. Native activation is not service routing, automatic cutover or rollback qualification. |
| Promotion | The native profile and its limitations are documented; no aggregate qualification is claimed. | ADR-0028's evaluator-only commit, pre-existing frozen fixtures, independent logical export comparison, default/RDF-1.2 and vendored/system-RocksDB matrix, exact receipts and predecessor upgrade/failure path. The recorded system lane lacks `rocksdb.pc >= 9.10.0`; do not count a vendored helper test as system qualification. |
| Obtainable handoff | Latest local product commit `991c480a`; the recorded development CLI has SHA-256 `daae9e41c81370c330d8671981beeb7c09c8c0688c021e0f07881ba257173151`. | Reproducible source/dependencies, an identified usable artifact for the declared milestone, all applicable gates, and exact publication authority. This local development binary is not a newly published release. |

Latest bounded implementation evidence:
`programme-reviews/oxigraph-g43-outbox-feature-errors-delivery-2026-09-11-v1`.
Its ten checks and independent review establish the retained-outbox error fix,
not full G4.3. Counts across feature configurations overlap.

Next product step: explicit read-only required-feature reporting/inspection.
Report the content actually inspected, retain unknown for unexamined history,
and preserve the bounded ordinary-open path. This is a step toward the full
envelope/compatibility contract above, not a substitute for it.

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
