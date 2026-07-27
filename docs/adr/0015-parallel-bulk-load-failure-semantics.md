# ADR-0015: Parallel bulk-load failure semantics

- Status: Accepted
- Date: 2026-07-27
- Deciders: Oxigraph parity programme
- Implementation status: implemented and regression-tested
- Related:
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md),
  [ADR-0014 — RDF dataset graph topology](0014-rdf-dataset-graph-topology.md)

## Context

The CLI loads multiple files concurrently so that parsing and Store writes can
use the available cores. The previous worker closure printed file-open,
parse/load, and commit errors and then returned locally. After every worker
finished, the command returned success even if one or more files had failed.
Automation could therefore observe exit status zero for an incomplete import.

A multi-file load also needs an explicit transaction boundary. Treating the
whole argument list as globally atomic would serialize or stage an arbitrarily
large import and is not the behavior of the existing per-file bulk-loader
transactions.

## Decision

Keep file-level parallelism and define each input file as one independent work
unit:

1. Every scheduled file is attempted even if another file fails.
2. A worker returns a structured failure classified as `open`, `load`, or
   `commit`; it does not print-and-discard the error.
3. The coordinator collects all worker failures and sorts them by original
   argument position, stage, and path so diagnostics are deterministic.
4. If any worker fails, the CLI returns one aggregate error and therefore a
   nonzero process status.
5. Successful files remain committed. The command does not claim
   transactionality across files.
6. In the default mode, each failed file remains uncommitted because its
   `BulkLoader` is file-atomic. With `--non-atomic`, a failed file may also
   leave partial data; the aggregate diagnostic states this explicitly.

The stdin path remains a single synchronous work unit and propagates its
open/read, load, and commit failures directly.

## Evidence

- [CLI implementation](../../cli/src/main.rs)
- `parallel_load_reports_all_open_failures_and_keeps_successful_files`
- `parallel_load_parse_failure_is_file_atomic`
- `parallel_load_collects_commit_failures_in_input_order`

The tests cover multiple simultaneous open failures, a parse failure beside a
successful file, the default per-file atomic boundary, deterministic input
ordering, successful-file persistence, commit failures, and nonzero command
status.

## Consequences

- Shells, CI jobs, and orchestration can trust the exit status.
- Operators receive every failure from the attempted batch rather than only
  the first one.
- Retrying the failed subset is possible because diagnostics preserve input
  identity and stage.
- A successful file is durable even when another file fails; callers requiring
  global all-or-nothing behavior must stage data separately and perform an
  application-owned swap.
- `--non-atomic` remains an explicit throughput/recovery trade-off and cannot
  be described as rollback-safe.

## Alternatives rejected

- Print worker errors and return success: makes incomplete imports invisible to
  automation.
- Fail fast on the first worker: loses independent failures already in flight
  and makes diagnostics scheduling-dependent.
- Wrap all files in one transaction: changes the established scalability and
  durability boundary and can require unbounded staging.
- Treat `--non-atomic` as file-atomic: contradicts the loader contract and can
  lead callers to assume rollback that is not provided.

## Acceptance boundary

This decision establishes deterministic failure aggregation and truthful
process status for one CLI invocation. It does not provide distributed
transactions, global cross-file rollback, automatic retry, or idempotent
application-level import semantics.
