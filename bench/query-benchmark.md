# Native query comparison

The [`query_benchmark` example](../lib/oxigraph/examples/query_benchmark.rs)
compares ordinary greedy and opt-in bounded planning, each without statistics,
with strict per-query statistics verification, and with an explicitly shared
verified `StatisticsSnapshot`. Reuse requires a private live-store identity
match as well as the full checkpoint, so copied or reopened databases cannot
inherit an old handle. It adds no package or application dependency.
Two additional modes select conditional cost model v2, without statistics and
with shared verified statistics. The original six modes retain v1/greedy
behavior. Per-record `cost_model` identifies the effective profile; `input`
lists both supported cost identities. With two queries and five repetitions,
the current eight-mode runner emits 112 observations (96 samples including
warm-ups and 16 separate feedback executions).
This is a local diagnostic, **not frozen-corpus acceptance, qualification, or
default-planner promotion**. The legacy HTTP BSBM script cannot select these APIs.

## Reproduce the small BSBM pilot

Run from the repository root. Java is needed only for the existing generator;
it is not an Oxigraph runtime dependency. The generator and upstream templates
remain in `bench/bsbm-tools`, pinned to
`59d0a8a605b26f21506789fa1a713beb5abf1cab`. Their original source and licensing
are not replaced by the Rust example or the parameter-instantiation script.

```sh
pilot_dir=$(mktemp -d /tmp/oxigraph-query-pilot-XXXXXX)
(
  cd bench/bsbm-tools
  ./generate -fc -pc 100 -s nt -fn "$pilot_dir/dataset" -dir "$pilot_dir/td_data"
)
sh bench/bsbm-100-queries.sh "$pilot_dir/queries"
sha256sum "$pilot_dir/dataset.nt" "$pilot_dir/queries/q1.rq" "$pilot_dir/queries/q2.rq"
cargo build --release --locked -p oxigraph --features statistics --example query_benchmark
/usr/bin/time -v -o "$pilot_dir/run.time" target/release/examples/query_benchmark \
  "$pilot_dir/dataset.nt" 5 --ordered "$pilot_dir/queries/q1.rq" \
  --bag "$pilot_dir/queries/q2.rq" > "$pilot_dir/run.jsonl"
```

No server, provider, G1.7 command, cleanup, or upload is performed. The query
script refuses an existing output directory. Keep the generated input/results
until their use is finished; nothing writes into an existing store.

The generator uses its fixed seed `53223436`, forward chaining, 100 products,
and no update dataset. The pilot contains 40,377 triples. Q1 substitutes
ProductType1, ProductFeature416, ProductFeature418 and `x=0`; Q2 uses
dataFromProducer1/Product1. These are explicitly selected parameters, **not**
the official random parameter-pool mix. Input identities observed on Linux:

| Input | SHA-256 |
| --- | --- |
| Dataset | `27bbf8a2758b80ac57dfdec5fcbcce0b828b41c5890372706cd72fcc7861f18b` |
| Instantiated Q1 | `bbd75bb45b1862bf33198438ad0abea838bd756c5e269af1f5faf10ac4c8b5c2` |
| Instantiated Q2 | `404f0114c43b28e3e5eefc93f698c86d3e9301a629a1dc020ed2d590cf9fe5e6` |

## Read the output correctly

Inputs must be a reviewed, bounded, deterministic SELECT corpus. Volatile
functions, nondeterministic services and unstable LIMIT selections invalidate a
separate-execution oracle. `--ordered` additionally requires a fully determined
projected sequence; ORDER BY ties can legally permute. Q1 has one result on
this exact dataset; Q2 has 19 and is compared as a bag. Other query forms fail
explicitly. A mismatch is a failure to investigate, not by itself proof of an
optimizer bug.

Each mode receives one warm-up, followed by the requested repetitions (1–100).
Mode order rotates across rounds in a shared process, with no cache eviction or
cold-cache claim. An independent optimization-disabled execution supplies the
comparison result. The oracle preserves column names, unbound/empty rows,
duplicates, sequence when requested, and global blank-node identity (including
nested RDF 1.2 terms). Evaluation errors are fatal, never silently filtered.
Results and their graph-isomorphic comparison are held in memory: use small
inputs; this is **not** bounded-memory or cancellation-latency acceptance.

`sample` records measure ordinary, uninstrumented evaluation. `prepare_seconds`
includes evaluator configuration and parsing. `admission_seconds` includes
snapshot acquisition and applicable verification. `explain_seconds` includes
planning and iterator construction; `consume_seconds` exhausts/collects results.
`total_seconds` excludes graph-isomorphic comparison. Do not sum nested timing
fields. Separate `feedback` executions enable cardinality instrumentation and
report internal planning time, search work, intermediate observations and
complete-only q-error; **do not mix these into latency samples**. Partial or
correlated observations retain null q-error. Warm-ups are marked explicitly.

Load, statistics rebuild/activation, and initial shared-snapshot verification
are reported separately; reuse does not make those costs disappear. RSS from
`time -v` is whole-process peak including loading and the oracle, not a planner
allocation measurement. Require both exit status zero and the terminal
`complete` record with matching expected/emitted counts. An output prefix is
not a successful run. No automatic p95, confidence or speedup verdict is emitted.

## Initial observation, 2026-09-08

On Linux x86-64, Ryzen 9 7950X3D, Rust 1.98.0, release profile, RocksDB defaults,
one reader and no writers, all 84 observations (72 samples including warm-ups,
12 feedback executions) matched the independent results. Five timed repetitions
per mode are a diagnostic, not tail statistics. This final run followed native
test completion, but has no CPU isolation or confidence/noise contract.

Strict per-query statistics admission had medians of about 277–292 ms across
the two queries/modes. Explicit verified-snapshot reuse reduced that phase to
about 0.016–0.036 ms on this run, after a separately measured 283 ms initial
verification. Rebuild/activation took 758 ms. This identifies a removable
per-query full-scan cost; it is **not** an end-to-end corpus speedup claim.
Ordinary Q1 greedy/bounded medians were 0.103/0.708 ms: bounded planning without
statistics regressed on this input. With shared statistics they were
0.209/0.161 ms. For Q2, ordinary greedy/bounded medians were 0.403/0.376 ms,
and shared-statistics medians 0.662/0.612 ms. No threshold is inferred. The whole
process used 113,088 KiB peak RSS and exited zero in 9.43 seconds.

The locally run binary SHA-256 was
`02a084e5a5c38f6f7f753909454abbabd0a8993413453953ab1783b918b94a4c`;
raw JSONL SHA-256 was
`aec9ab2282a20960a271e67100891df811c8069fc2b0a6a8d018d6af74fcefcf`.
These identify this local observation, not a portable reproducible-build promise.

This compares retained baseline and candidate APIs in the **same binary**, not
an exact historical-parent build. The initial instrumented exploratory run is
not mixed with these uninstrumented samples. BSBM breadth, WatDiv/LDBC assets,
controlled parent-first baselines, resource/tail evidence and numeric threshold
ratification remain open under [ADR-0023](../docs/adr/0023-statistics-and-bounded-join-planning.md).
There was no frozen G3.2 corpus or numerical promotion gate at parent `8b5b6002`;
the plan's percentages were hypotheses, not already-established evidence.

## Conditional v2 follow-up, 2026-09-08

The retained executable from parent `fa13b21e` (the binary hash above) ran first,
then the conditional-v2 candidate, against the exact same dataset/query bytes.
Both exited zero with complete markers and all comparisons equal: parent
84/84 observations, candidate 112/112. This is an actual parent-first **local
diagnostic**, still not isolated-host or frozen-corpus acceptance. All native
test commands had finished, but unrelated host load was not controlled.

Five-repetition total-time medians in milliseconds, kept separate by binary:

| Query/mode | Parent | Candidate |
| --- | ---: | ---: |
| Q1 greedy | 0.171 | 0.087 |
| Q1 bounded v1 | 1.151 | 0.848 |
| Q1 conditional v2 | unavailable | 0.154 |
| Q1 shared-statistics bounded v1 | 0.219 | 0.162 |
| Q1 shared-statistics conditional v2 | unavailable | 0.166 |
| Q2 greedy | 0.421 | 0.839 |
| Q2 bounded v1 | 0.388 | 0.558 |
| Q2 conditional v2 | unavailable | 0.844 |
| Q2 shared-statistics bounded v1 | 0.601 | 1.261 |
| Q2 shared-statistics conditional v2 | unavailable | 1.271 |

The substantial variation in unchanged modes precludes a reliable cross-binary
speedup conclusion. V2 is slower than v1 for Q2 on this run and remains slower
than greedy for Q1. The strong evidence for the Q1 correction is the separately
instrumented work trace: v1 reads 204 quad rows and makes 103 bound invocations;
v2 reads 7 and makes 6. Both return the same one-row result. Q1 uses one
five-leaf DP group in both profiles; v2 avoids the broad type and numeric scans.
Q2's observed leaf work remains the same, with 19 result rows. None of these
observations justifies a default change or closes the full G3.2 gate.

Candidate binary SHA-256:
`b5d8f67ee0a13eb12a3d6647fec71e39f76420b3db9f5969a460d5c6f2ebe6c7`.
Parent/candidate raw JSONL SHA-256, respectively:
`afb1d105570312b6e03fa3fe89b0b4be6017cf5a6d040148353ee791707ce00d`,
`a3356a5154a753ace48652f171cbfa147290b9d1915ea7216bbb1cd5ac50929b`.
Whole-process peaks were 112,964/114,552 KiB and elapsed times 12.81/17.11 s;
these runs have different mode counts and are not comparable per-query costs.
Raw artifacts remain local; no binary or benchmark upload is implied.
