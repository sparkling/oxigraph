# Native query comparison

The [`query_benchmark` example](../lib/oxigraph/examples/query_benchmark.rs)
compares ordinary greedy and opt-in bounded planning, each without statistics,
with strict per-query statistics verification, and with an explicitly shared
verified `StatisticsSnapshot`. Reuse requires a private live-store identity
match as well as the full checkpoint, so copied or reopened databases cannot
inherit an old handle. It adds no package or application dependency.
Four additional modes select conditional v2 and correlated v3, each without
statistics and with shared verified statistics. The original six retain v1/greedy
behavior. Per-record `cost_model` identifies the effective profile; `input`
lists all three cost identities. With two queries and five repetitions,
the current ten-mode runner emits 140 observations (120 samples including
warm-ups and 20 separate feedback executions). Historical six/eight-mode runs
below retain their original identities and counts.
This is a local diagnostic, **not frozen-corpus acceptance, qualification, or
default-planner promotion**. The legacy HTTP BSBM script cannot select these APIs.

`--mode` also accepts a comma-separated subset, for example
`--mode shared_statistics_greedy,shared_statistics_bounded_correlated_v3`.
Names must be exact and unique; empty entries and duplicate options are rejected.
The supplied initial order is preserved, then the existing per-round rotation
alternates the first mode. Selected modes share one dataset load and statistics
build/verification; neither admission nor the optimization-disabled oracle is
skipped. Per-record mode identity and completion counts describe the actual
subset. Defaults and single-mode behavior are unchanged. This enables paired
comparisons without repeating the large statistics setup.

## Machine-checked input identities

Pass `--input-manifest FILE.json` before the query pairs to require an exact
dataset SHA-256, RDF format, default-graph interpretation, and ordered inventory
of query SHA-256/comparison pairs. The checked bytes are retained for execution;
no query file is reopened after checking. Missing, reordered, duplicated or
changed inputs fail before temporary-store creation/loading. Output identifies
the manifest's own SHA-256; there is no refresh option. Without the flag the
existing arbitrary-input diagnostic remains available and reports null manifest
identity. Annotation fields such as `metadata` are explanatory, not executable
gates; these manifests do not pin modes, setup, repetitions or performance rules.

| Manifest | Required query order (all `--bag`) | Dataset interpretation |
| --- | --- | --- |
| [BSBM 100](query-inputs/bsbm-100-select-v1.json) | Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q10, Q11 | N-Triples, stored default |
| [WatDiv 10M](query-inputs/watdiv-10m-select-v1.json) | Q1, Q2, Q4, Q7, Q14, Q17 | N-Triples, stored default |
| [LDBC Q7](query-inputs/ldbc-q7-select-v1.json) | Q7 | N-Quads, named union |

Use the generators, licenses, archive/member hashes and fixed parameters below.
For example, after generating the ten BSBM queries:

```sh
set --
for query in 1 2 3 4 5 6 7 8 10 11; do
  set -- "$@" --bag "$pilot_dir/queries/q$query.rq"
done
target/release/examples/query_benchmark "$pilot_dir/dataset.nt" 3 \
  --input-manifest bench/query-inputs/bsbm-100-select-v1.json "$@"
```

These already-documented inputs and native boundary/state tests define the scoped
`G3.2-opt-in-select-v1` workload, not general or full official-suite coverage.
Empty controls remain in the inventory; no official expected
result is replaced. Numeric gates and noise treatment still need a deliberate
baseline-first freeze before a gated performance run. Native state-fallback
and retained-snapshot plan-determinism tests are documented in
[ADR-0023](../docs/adr/0023-statistics-and-bounded-join-planning.md#full-statisticsplanning-promotion).

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

### Explicit dataset and setup options

`--format nt|nq` defaults to N-Triples. N-Quads preserves graph names and
cross-graph blank-node identity. `--default-graph stored|named-union` defaults
to leaving the parsed query dataset unchanged, including any `FROM` clauses;
`named-union` explicitly selects the native union of named graphs. The same
dataset selection is applied to both the independent oracle and every mode.

`--setup statistics|query-only` defaults to the historical statistics setup,
even for a selected non-statistics mode. Explicit `query-only` skips index
creation, rebuild/activation and initial verification. It requires one of
`greedy`, `bounded`, `bounded_conditional_v2`, or `bounded_correlated_v3`;
statistics modes and the default all-mode selection are rejected. Scan-limit options
`--max-input-records` and `--max-input-bytes` are also rejected in this setup:
they do not bound the atomic dataset loader or process memory. The `input`
record identifies format, dataset selection and setup; skipped statistics
timings and limits are null, not zero-cost statistics observations. Historical
statistics runs and query-only runs are different measurement envelopes.

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

## Ten-template SELECT pilot and isolated mode selection

`bsbm-100-queries.sh` now instantiates every upstream Explore SELECT template
(Q1–Q8, Q10, Q11). Q1/Q2 bytes and the dataset above are unchanged. Q9 DESCRIBE
and Q12 CONSTRUCT are excluded because this runner compares SELECT results.
This remains a diagnostic subset, not the official random parameter mix or a
ratified performance corpus. The additional fixed parameters are:

| Query | Parameters beyond the shared prefix | Observed rows | SHA-256 |
| --- | --- | ---: | --- |
| Q3 | Type1; features 38/418; x=0, y=1000 | 8 | `ecef0e53398a81a1ccf102f140f11a832dad6814c0076d401566bd823a14a591` |
| Q4 | Type1; features 29/25/36; x=0, y=0 | 4 | `8ca15e949566a8c4f66cfdbe6f5e9e94b5c38de59b4bf10109ce7518b1401216` |
| Q5 | dataFromProducer1/Product11 | 1 | `2b26e7065d6c07d7b543f1f49e60cac1838b5f5b8beda10af984bbbc802bfb53` |
| Q6 | word `turgescence` | 1 | `510a4500ea6afcfa5de31f756dc236b9fc17be462360f497a099a375f62cfaf7` |
| Q7 | dataFromProducer1/Product37; fixed date below | 14 | `ed3426a99f33122a1deb259010a5051e38d3e25e9baf7dee9e2e14f9a317ce9f` |
| Q8 | dataFromProducer1/Product37 | 6 | `cb7920a985119ff96cf51f20010c1ab19fdf68d2c1d2f45f763102fcdf907f1f` |
| Q10 | dataFromProducer1/Product1; fixed date below | 0 | `d4ef552ea104e55ca18d897f5f69de6b377715d1cd9228131bea60e2c7451f86` |
| Q11 | dataFromVendor1/Offer1 | 10 | `1237d21207d1949b9ce4a68c03a5ee01d55b4ea3c49b927233fdc64b50174e87` |

Type/feature/product/offer IRIs use the upstream BSBM instances prefix. The
fixed typed dateTime is `2008-06-20T00:00:00`, the generator's declared date,
not wall-clock time. Product labels are unique on this exact dataset, so the
label-ordered LIMIT/OFFSET queries have stable membership. Q8's six English
reviews are below LIMIT 20; date ties are compared as a bag. Q10 is an explicit
empty-result control: the only vendor is British, not American. Q7 exercises
the review OPTIONAL but not a matching German offer. These gaps require a
larger/other subset before broad offer-path performance claims.

After generating a fresh pilot directory as above:

```sh
set --
for query in 1 2 3 4 5 6 7 8 10 11; do
  set -- "$@" --bag "$pilot_dir/queries/q$query.rq"
done
target/release/examples/query_benchmark "$pilot_dir/dataset.nt" 3 "$@" \
  > "$pilot_dir/explore-select.jsonl"
```

The retained `fa13b21e` parent ran first, then product source `382a6a7d`, on
these exact inputs: exit zero and 300/300 versus 400/400 observations, all equal.
They have six/eight modes respectively, three timed repetitions, warm-ups and
separate feedback. Candidate binary SHA-256 was
`6a94ae71ff44dd7b460e3a46de6d93c3c66e78503e7289ad9384759d39252270`;
parent/candidate raw SHA-256:
`b08fb3657d02f7992c5a1d230dcca23f947b7b88fe9ee9eb52166a900fbe962f` /
`d25e1f245b0b2505d82e39dc404dd7d24c8e561032bbb8c52d11c622d8058cec`.
The initial parent-only parameter exploration is not pooled into these runs.

Results expose remaining product work, not a performance pass: Q8 greedy,
bounded v1 and conditional v2 read 77, 3,095 and 1,115 quad rows respectively;
shared-statistics v2 reads 129. All return six rows. Q5 shared-statistics v2
reads 2,728 quad rows versus greedy's 388 for the same one-row result. Three
repetitions do not establish p95 tails or reliable cross-binary speedups.

The runner additionally accepts `--mode NAME` immediately after repetitions.
An unknown/repeated mode or missing query is rejected; omitting the option
selects the rotating ten-mode comparison. `input.selected_modes` and
`mode_rotation` identify the actual selection, and completion counts scale
with it. Each invocation creates a fresh temporary store:

```sh
/usr/bin/time -v -o "$pilot_dir/q8-v2.time" \
  target/release/examples/query_benchmark "$pilot_dir/dataset.nt" 20 \
  --mode bounded_conditional_v2 --bag "$pilot_dir/queries/q8.rq" \
  > "$pilot_dir/q8-v2.jsonl"
```

Names are the eight earlier `mode` values plus `bounded_correlated_v3` and
`shared_statistics_bounded_correlated_v3` (an invalid name lists all ten).
Use the same query set, repetitions and process envelope for each mode before
comparing RSS. Every mode still includes loading, statistics build/verification,
the independent oracle and separate feedback. This makes whole-process peaks
comparable in scope, **not** isolated planner allocations, cold-cache evidence,
a resource ceiling, or frozen acceptance. Historical executables lack this
option; do not attribute a new-runner result to an unchanged historical binary.

Full G3.2 still needs reproducible WatDiv/LDBC subsets, parent-first controlled
measurements including complete/null q-error coverage, per-query tails and
resource bounds. Deliberately freeze numerical gates and noise rules after the
parent baseline and before the gated candidate run; no pilot observation is
retroactively an acceptance threshold. Opt-in acceptance does not require
changing the ordinary greedy default.

## Correlated v3 follow-up, 2026-09-08

The exact ten SELECT inputs above pass in all ten modes: exit zero, 500/500
observations (400 samples including warm-ups and 100 separate feedback runs).
The run followed native tests and fuzz completion. No CPU isolation or tail
confidence claim is made. V1/V2 remain selectable and reproduce their scan-work
observations. The explicit V3 product correction gives:

| Query/mode | V2 quad rows | V3 quad rows | Unchanged result rows |
| --- | ---: | ---: | ---: |
| Q8, no statistics | 1,115 | 77 | 6 |
| Q8, shared statistics | 129 | 93 | 6 |
| Q5, shared statistics | 2,728 | 388 | 1 |
| Q7, shared statistics | 177 | 83 | 14 |

Q8 unbound scan rows fall from 1,064/64 to 14 in both V3 modes; the remaining
work consists of indexed probes. This is not a universal speedup: Q8 greedy
still has a lower three-sample median (0.346 ms) than no-stat/shared-stat V3
(0.427/0.510 ms), and shared-stat V3 reads more rows than greedy (93 vs 77).
The ten-query run uses shared caches and only three timed repetitions; it does
not establish p95 performance, isolated planner memory or default promotion.

Binary SHA-256:
`c4c5f831351acb14262e2f353b85aff53f8703f833516230113954e23798a330`.
Raw JSONL SHA-256:
`be687192e99164e3b32de59f3181370c0518f336aa0ecfbfbafa0bf676edf0cf`.
Whole-process peak RSS is 113,936 KiB and elapsed time 31.39 seconds; neither
is comparable to historical whole-run costs with different mode counts.
The WatDiv input contract below now fixes one further diagnostic corpus.
LDBC inputs and parent-first ratified acceptance remain open.

## Fixed WatDiv input and baseline preparation

Use the intact official [WatDiv 10M dataset and stress workloads](https://dsg.uwaterloo.ca/watdiv/index.shtml),
not a subset of subjects that severs generated relationships. Cite G. Aluç,
O. Hartig, M. T. Özsu and K. Daudjee, *Diversified Stress Testing of RDF Data
Management Systems*, ISWC 2014, pp. 197–212. The upstream download/use conditions
and attribution remain applicable; this repository does not relicense or
redistribute their data or queries.

| Input | SHA-256 |
| --- | --- |
| `watdiv.10M.tar.bz2` | `1d0a8a4725c98974eb7347ce3e6d9cab44f9f40389589809674254151b745af6` |
| Extracted `watdiv.10M.nt` | `7cfe0341d578a677d3b5d562eaaf94d67aff8587d9e0ef3d83cc82765b77cddd` |
| `stress-workloads.tar.gz` | `98796d4c8db67a1f68b3d1958d8f1334d5d38fe6da1c5e8eae72a8823ac7eed5` |

The extracted file is 1,542,624,409 bytes and has 10,916,457 triple lines.
The [extractor](watdiv-10m-queries.sh) selects unchanged, one-line SELECTs from
`watdiv-stress-100/test.1.sparql`. These positions were selected before any
candidate measurement, for contrasting shapes; they are not the official
20-template basic suite or the full stress workload. No parameters, filters,
LIMITs, or triple ordering are rewritten. Empty outcomes stay visible.

| Line / file | Shape | SHA-256 |
| --- | --- | --- |
| 1 / `q1.rq` | Three-leaf selective star | `97f292a405fff77691b69af07dcde72f5089ad862cd14efa244e8da781964af1` |
| 2 / `q2.rq` | Four-leaf selective offer star | `98dc727b8b1e2c3a7be2e9419edc5dac6f4fe2d6989891f95ea905ae0839a437` |
| 4 / `q4.rq` | Eight-leaf product/genre cycle | `b9f69da89ae5936ad30d68a0552281c73aeaa2d811f20f59a9a5190b9ec29968` |
| 7 / `q7.rq` | Six-leaf author/self-edge join | `69ae752081ecf890a36acf4b679ca590f6c1394af79be1aec4ae7316fba9dbe4` |
| 14 / `q14.rq` | Two-leaf broad star | `4972c502256f96680defeafc6dc15ee3e0a975ba31b8c4eddce275de3a7076ad` |
| 17 / `q17.rq` | Three-leaf author/demographic join | `0dde5aa65432ad52792ffe8abe27225a685ca6254823c438eab92f913bcbd13d` |

Download into a fresh directory, verify the archive hashes above before
extracting, and verify the extracted data hash before running:

```sh
watdiv_dir=$(mktemp -d /tmp/oxigraph-watdiv-XXXXXX)
curl --fail --location --output "$watdiv_dir/watdiv.10M.tar.bz2" \
  https://dsg.uwaterloo.ca/watdiv/watdiv.10M.tar.bz2
curl --fail --location --output "$watdiv_dir/stress-workloads.tar.gz" \
  https://dsg.uwaterloo.ca/watdiv/stress-workloads.tar.gz
sha256sum "$watdiv_dir/watdiv.10M.tar.bz2" "$watdiv_dir/stress-workloads.tar.gz"
tar -xjkf "$watdiv_dir/watdiv.10M.tar.bz2" -C "$watdiv_dir" watdiv.10M.nt
sha256sum "$watdiv_dir/watdiv.10M.nt"
sh bench/watdiv-10m-queries.sh "$watdiv_dir/stress-workloads.tar.gz" "$watdiv_dir/queries"
test "$(cat "$watdiv_dir/queries/COMPLETE")" = watdiv-six-select-v1
```

The extractor requires a checksum-matching archive and fresh absolute output
directory. It rechecks the archive after extraction and writes `COMPLETE` last.
A failed directory is retained for diagnosis; neither its existence nor an
output prefix proves completion. No source download is executed as a program.

The comparator now accepts `--max-input-records N` and `--max-input-bytes N`
before the query pairs, in either order with `--mode`. Values must be nonzero
64-bit integers; duplicate/unknown options fail before loading. Defaults remain
1,000,000 records and 64 MiB. The input record reports both effective limits.
These bound the statistics input scan, **not** loading, process RSS, result
materialization or planner allocation. Provider/generation defaults and all
optimizer profiles remain unchanged. The diagnostic still builds/verifies
statistics for every mode, preserving the existing setup envelope.

```sh
cargo build --locked --release -p oxigraph --features statistics --example query_benchmark
/usr/bin/time -v -o "$watdiv_dir/greedy.time" target/release/examples/query_benchmark \
  "$watdiv_dir/watdiv.10M.nt" 5 --mode greedy \
  --max-input-records 12000000 --max-input-bytes 4294967296 \
  --bag "$watdiv_dir/queries/q1.rq" --bag "$watdiv_dir/queries/q2.rq" \
  --bag "$watdiv_dir/queries/q4.rq" --bag "$watdiv_dir/queries/q7.rq" \
  --bag "$watdiv_dir/queries/q14.rq" --bag "$watdiv_dir/queries/q17.rq" \
  > "$watdiv_dir/greedy.jsonl"
```

Require exit zero, all six query records, and a completion record with 42/42
equivalent observations (36 samples including warmups, six feedback runs).
This measures the current unchanged greedy product path, not an old binary
rebuilt and relabelled as a historical parent. Five repetitions are input
validation, not a controlled p95 baseline or numerical acceptance decision.
Prepare the controlled parent-only baseline and ratify the resource/tail gates
before running a gated candidate. Full G3.2 acceptance remains open.

The first greedy input-validation run completed with exit zero and 42/42
equivalent observations. Lines 1/2/7 returned zero rows; lines 4/14/17 returned
56/9,909/11. Thus only the latter three establish nonempty shape coverage.
Keep the empty controls; do not describe them as successful selective retrieval.
Five-sample medians for lines 4/14/17 were 198/75/106 ms. These are diagnostic
observations, not p95 bounds or a speedup comparison.

Setup dominated: atomic load 311.7 s, statistics rebuild/activation 493.5 s,
initial verification 220.7 s; total elapsed 1,202.3 s and whole-process peak
21,664,748 KiB. Later native compilation overlapped this run, so no isolated-host
claim is made. An explicitly separate no-statistics setup path and the existing
bulk loader are candidates for reducing future preparation time; neither may
silently change the historical setup envelope or waive statistics validation.
The optimization-disabled oracle remains separate from query latency.

Raw JSONL SHA-256:
`ee13e776e8622c32ca6cf4dc310064678e58d0dde6e69f3b9cd4fd27009d1e02`.
The run used retained binary
`95f6b0d347744f9eff8385d804897f23fac555d5d59d0217d7477289bf66068b`
from the input-limit patch on `6f2c1014`, before the equivalent parity-test lint
cleanup. The committed `e6317a1b` binary is separately identified as
`0fb6e387b8e9519c42fa6c851d5892f62b73a585eaaa661d73d7d6923af82773`
and passed a 30-observation all-mode BSBM smoke test. Do not relabel the older
binary as the final source build or these input checks as a candidate gate.

## LDBC Q7 materialization diagnostic

This uses the official [SPB 2.0.2 source](https://github.com/ldbc/ldbc_spb_bm_2.0/tree/ce6323c0936306729408233dc70d26f2389b34c6),
commit `ce6323c0936306729408233dc70d26f2389b34c6`, under its Apache-2.0 license
and NOTICE. It is an ordinary-SPARQL validation subset, **not** the full SPB
workload or its inference/performance qualification. The public generator needs
a populated endpoint; it is not an endpoint-free way to regenerate this data.

Use the official `datasets_and_queries/validation/data/validation_data.zip`,
retaining these three members as N-Quads. Together they contain 150,036 quads
and all 12 Q7 validation result resources. Do not flatten their graph names.

| Input | SHA-256 |
| --- | --- |
| `validation_data.zip` | `bc3ed99a3b6e0f3270c6dd5a24b3dac2db17946c9e257540feec454b831a3057` |
| `generatedCreativeWorks-000004.nq` | `316ac8ca67011ba96ef5abb97b83d9d649eb8c3fda46ebd8afe3b23265fab80f` |
| `generatedCreativeWorks-000025.nq` | `08dcdddd9db93d993d3ab8073d67b88dabae2f5496f70e587b4a739ad08133ab` |
| `generatedCreativeWorks-000102.nq` | `19a4233af9ecd3a92b87b4cd37b7499d89ef9fab018ce7f25b15d32e9e1eb035` |
| `sparql/basic/aggregation_standard/query7.txt` | `a031c4c49fee5c423e814fa166413dcdb479ecc33c4cb99d1c90fec6dbd678ff` |
| `validation/basic/standard/query7Validation.txt` | `c30f2854f9b66f00a591a41082f6610284b6374eaeef4bc0ed3bec8ce38f3a51` |

The official parameters are `cwork:NewsItem` and the half-open UTC interval
`2011-02-08T21:01:00.000Z` to `2011-02-08T22:01:00.000Z`. Instantiate only the
two upstream placeholders. Verify downloaded and extracted hashes above before
loading; keep the original validation output unchanged:

```sh
ldbc_dir=$(mktemp -d /tmp/oxigraph-ldbc-XXXXXX)
ldbc_source=https://raw.githubusercontent.com/ldbc/ldbc_spb_bm_2.0/ce6323c0936306729408233dc70d26f2389b34c6/datasets_and_queries
curl --fail --location --output "$ldbc_dir/validation_data.zip" "$ldbc_source/validation/data/validation_data.zip"
curl --fail --location --output "$ldbc_dir/query7.txt" "$ldbc_source/sparql/basic/aggregation_standard/query7.txt"
curl --fail --location --output "$ldbc_dir/query7Validation.txt" "$ldbc_source/validation/basic/standard/query7Validation.txt"
sha256sum "$ldbc_dir/validation_data.zip" "$ldbc_dir/query7.txt" "$ldbc_dir/query7Validation.txt"
unzip -n "$ldbc_dir/validation_data.zip" generatedCreativeWorks-000004.nq \
  generatedCreativeWorks-000025.nq generatedCreativeWorks-000102.nq -d "$ldbc_dir"
sha256sum "$ldbc_dir"/*.nq
sed -e 's|{{{cwType}}}|cwork:NewsItem|g' \
  -e 's|{{{cwFilterdateCreatediedCondition}}}|FILTER(?dateCreated >= "2011-02-08T21:01:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> \&\& ?dateCreated < "2011-02-08T22:01:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>) .|g' \
  "$ldbc_dir/query7.txt" > "$ldbc_dir/query7.rq"
cargo build --locked --release -p oxigraph-cli --bin oxigraph
target/release/oxigraph load --location "$ldbc_dir/db" --file \
  "$ldbc_dir/generatedCreativeWorks-000004.nq" "$ldbc_dir/generatedCreativeWorks-000025.nq" \
  "$ldbc_dir/generatedCreativeWorks-000102.nq"
/usr/bin/time -v -o "$ldbc_dir/query7.time" target/release/oxigraph query \
  --location "$ldbc_dir/db" --query-file "$ldbc_dir/query7.rq" \
  --union-default-graph --results-file "$ldbc_dir/query7.json"
```

Instantiated query SHA-256:
`e1ca83475c854ca2d7e355caa39bca2a424fee7e205626fcf113e61f528ffd28`.
Q5/Q9/Q11 require reference knowledge and/or entailment; running them over these
raw files does not establish their official result contracts. This CLI run
does not select bounded-planner or statistics profiles.

The old query-time materializer copied each named graph by scanning the entire
dataset, doing work proportional to graphs × quads. The native repair uses the
existing GSPO graph-prefix range in both ordinary and merged-default copies.
It retains materialization, snapshot isolation, topology, graph selection and
per-source blank-node rewriting. It does not yet eliminate whole-store copying
or add materialization cancellation.

On the same persisted data, old CLI binary
`4aa5f8394e58079a536eda97de6a601d38745f199184840523d6d7c723d677e4`
at `e6317a1b` took 204.73 s; the indexed-copy binary
`f1675348ed7ef8c13d5319174b9ae09ce05a0b4a62d4f67ac4ee30d49fc0a8f9`
took 6.30 s. Both exited zero with the exact same 12-row term bag. Peak RSS was
512,024/512,136 KiB; memory was not improved. These are single diagnostic runs
on a shared host, not p95, a universal speedup, or numerical promotion evidence.
Parent/candidate JSON hashes are respectively
`63e2ddcc714254a3130f0fbaa93a69f6dba32de8fdcf24e76cfa4f418f0772a8`
and `576a778347c125a2fd24a1c31d75ca40938250fe5c34a2b85636d77a4663bae0`;
serialization order can differ while the bags agree.

Against the official XML expectation, all six columns and all 12 resources
agree. One datetime is serialized as `.92` rather than `.920`; the raw lexical
bags therefore differ. DateTime-value normalization gives equal bags, with all
other terms compared exactly. Preserve both observations; do not claim raw
term equality to the official file or silently update its expected values.

### Native Simple query path

The next CLI/HTTP repair binds Simple queries directly to the native Store
snapshot. Finite entailment and the public owned entailment adapter retain
materialization. A discovered in-memory union bug is corrected at the same
time: exclude the physical default graph before deduplicating named triples.

On the same Q7 store and query above, three sequential parent/candidate pairs
gave the following whole-process observations (`/usr/bin/time -v`, all exit 0):

| Run | Parent `0bac1f00` seconds / peak KiB | Native Simple seconds / peak KiB |
| --- | --- | --- |
| 1 | 6.33 / 513,716 | 0.06 / 34,304 |
| 2 | 6.23 / 510,064 | 0.06 / 34,304 |
| 3 | 5.48 / 508,712 | 0.05 / 34,048 |

All six outputs match the retained parent columns and exact 12-row term bag.
Candidate binary SHA-256:
`97a7a535372ce8526ac3b4e04e6879e6cfe5effa01b1cc441cc029b6f8697a8f`.
Each candidate JSON has SHA-256
`41983091e3b4991d16087d07d0be4b4ac8d69ab7d94bc3ccd572f4b3c01ce9ba`.
The three parent JSON hashes are
`5250ecf3d7339a4f7e53ed71938fc9cfbd73827b12a0b5b7f2e876276739af9d`,
`cdb9ad93e416df4983a4d71ccedede5934365f1a5263d5f398916177d466bde0`,
and `e6404251ccf5a38c96d03f6b6b559261a0325a7ff2c0ef48575f2c141ad60c28`.
Local raw outputs, time reports and candidate binary are retained under
`/tmp/oxigraph-simple-query-8P6z8s`; input reproduction is above. This is a
shared-host diagnostic, without cache eviction or randomized order, not p95,
a universal speedup, or default-planner promotion. First-parent-run setup
overlapped the end of a short lint check; no exclusive-host claim is made.

Validation: all 158 CLI tests pass, including the new `--stats` path; the
focused HTTP tests cover memory/reopened-disk datasets, merged blank-node scope,
empty/missing graph slots, protocol precedence, lazy snapshots, cancellation,
version rejection and terminal metrics. The affected library matrix passes
67 tests; the no-default-features lanes pass three HTTP tests and the new
memory union regression. Production CLI Clippy with `rdf-12` passes; the
broader test lint lane still fails on seven existing diagnostics in
`cli/src/service_description/tests.rs`, not in the changed files. No dependency,
protected baseline, expected semantic result, or entailment profile is changed.

## Parent-path baseline preparation, 2026-09-08

These measurements prepare acceptance; they do not add application behavior,
ratify a threshold, close G3.2 or promote a planner. Exact source parent is
`8cd38a54aeb0ec3503e06c25cd942e5979f2f43e`. Local raw JSONL and `time -v` reports
are retained in `/tmp/oxigraph-g32-baseline-eINjwN`, not uploaded. Runs use Rust
1.98.0 release/statistics, one reader, no writers, and CPU affinity `taskset -c 8`.
This shared Ryzen 9 7950X3D host is **not isolated**: CPU 8 has an SMT sibling,
the unchanged governor is `powersave`, and unrelated host activity remains.
Our own builds/tests do not overlap these timing runs. Quantiles below use
nearest rank, excluding the one warm-up and separate feedback execution.

For all ten fixed BSBM SELECT queries above, each of three fresh processes per
mode ran 100 timed repetitions: `greedy` and `shared_statistics_greedy`, using
the historical statistics setup. All **6,120 observations** matched the
optimization-disabled oracle, and all six processes exited zero with exact
completion counts. Whole-process elapsed time was 3.24–3.79 s / 3.08–3.34 s;
peak RSS was 114,800–115,104 / 115,160–115,692 KiB respectively. The retained
parent binary SHA-256 is
`ad1ec6a77cb089e5d8c05931c8590f2ca38d1cd460edb6a44001840912c63b96`.

Unchanged-query p95 variation exceeds the proposed 5% gate: greedy Q2 ranges
0.377–0.579 ms and shared-statistics Q5 ranges 1.304–1.680 ms across processes.
This is a demonstrated measurement limitation, not an optimizer regression or
permission to loosen a gate until a candidate passes. Do not pool these samples
into a speedup claim. Complete-only leaf q-error and intermediate observations
remain in the raw feedback; partial/correlated q-error remains null.

The N-Quads/query-only extension above uses a separately identified binary,
SHA-256 `2d0b3b0cd684f91bec9daa68b237a2f5e28b3acc73d9cb70293fb4cd6b1101de`.
The three LDBC members above concatenate, in the listed order without graph
rewriting, to 150,036 quads with SHA-256
`e07ecce50009f1246d7c6aa4b8f456eeef991f9db1e8477b6a99bb7f97529839`.
After verifying the source hashes, reproduce a query-only run with:

```sh
test ! -e "$ldbc_dir/q7-subset.nq" &&
  unzip -p "$ldbc_dir/validation_data.zip" generatedCreativeWorks-000004.nq \
    generatedCreativeWorks-000025.nq generatedCreativeWorks-000102.nq > "$ldbc_dir/q7-subset.nq"
cargo build --release --locked -p oxigraph --features statistics --example query_benchmark
/usr/bin/time -v -o "$ldbc_dir/q7-example.time" taskset -c 8 \
  target/release/examples/query_benchmark "$ldbc_dir/q7-subset.nq" 100 \
  --mode greedy --format nq --default-graph named-union --setup query-only \
  --bag "$ldbc_dir/query7.rq" > "$ldbc_dir/q7-example.jsonl"
```

Three fresh processes completed **306/306 observations**, with the same 12-row
result as the disabled oracle. Their p50/p95 were 15.588/19.189,
16.229/20.350 and 23.160/41.982 ms. Whole-process elapsed was 5.42/5.60/7.03 s,
peak RSS 464,684/463,016/463,544 KiB. Atomic loading is included in that RSS,
unlike the earlier preloaded CLI measurements; these are not interchangeable
memory observations. Q7 has 4,140 observed quad-leaf rows; only one of its six
leaf cardinalities is complete (q-error 2.043956), so there is no six-leaf
q-error distribution to report. This is still the reviewed Q7 subset, not full
LDBC/SPB acceptance or exact lexical equality to its official XML expectation.

The same new binary ran the six unchanged WatDiv queries on all 10,916,457
triples: `--mode greedy --setup query-only`, 30 timed repetitions, CPU 8.
It exited zero with **192/192 equivalent observations** (186 samples including
six warm-ups, plus six feedback executions). Observed nearest-rank timings:

| Query | Result rows | p50 ms | p95 ms | Instrumented quad-leaf rows |
| --- | ---: | ---: | ---: | ---: |
| Q1 | 0 | 0.038 | 0.046 | 3 |
| Q2 | 0 | 0.054 | 0.071 | 3 |
| Q4 | 56 | 186.552 | 262.729 | 36,144 |
| Q7 | 0 | 215.017 | 267.616 | 21,299 |
| Q14 | 9,909 | 54.346 | 63.620 | 11,595 |
| Q17 | 11 | 78.058 | 79.394 | 8,486 |

Total elapsed was 498.43 s, atomic load 321.66 s, peak RSS 21,670,664 KiB.
Skipping statistics preparation does not bound or substantially reduce atomic
loader peak memory. This is one shared-host process, not a repeatability gate;
its setup/repetition/affinity envelope differs from the earlier five-repetition
WatDiv run, so the two totals are not a product speedup comparison. Raw JSONL
SHA-256: `b4a11bc3340cacace1ad3c15beb9b165fe45c59984e0733293956d1fc36a71e9`.

The machine-checked inputs above and native statistics-state/determinism tests
now close those focused preparation gaps. Remaining acceptance work is scoped
statistics-mode comparisons, resource ceilings beyond the synthetic observations,
and repeatable per-query tails. Deliberately freeze
numerical thresholds and noise rules after the parent baseline and before
a gated candidate run. The separate manual pre-run approval introduced in
`1771b64e` was not required by the original contract; see the correction in
[ADR-0023](../docs/adr/0023-statistics-and-bounded-join-planning.md#full-statisticsplanning-promotion).
The already-completed transaction writer matrices are
not new G3.2 prerequisites; ordinary default-planner promotion is a separate
decision from acceptance of an opt-in profile.

## Planner-only resource diagnostic

[`join_planning`](../lib/sparopt/examples/join_planning.rs) separates optimizer
work from store loading and result collection. It adds no dependency and uses
a deterministic same-subject star with 2–64 leaves, optional 0–65,536-byte IRI
padding, 1–1,000 repetitions and explicit `greedy|v1|v2|v3` selection. It parses
once, obtains an untimed reference plan/report, then checks exact equality
after every measured optimization. Nine/64-leaf bounded configurations also
perform an untimed default-greedy comparison. Input cloning, parsing, printing,
equality checks and the reference runs are outside the reported sample time.
The full synthetic plan is printed for exact cross-binary comparison.

```sh
cargo build --release --locked -p sparopt --all-features --example join_planning
/usr/bin/time -v taskset -c 8 target/release/examples/join_planning 8 0 100 v1
/usr/bin/time -v taskset -c 8 target/release/examples/join_planning 9 0 100 v1
/usr/bin/time -v taskset -c 8 target/release/examples/join_planning 64 0 100 v1
```

The parent `1771b64e` optimizer and the lazy candidate-construction change ran
all four modes for `(leaves, padding) = (8,0), (9,0), (64,0), (8,16384)`.
All 32 processes exited zero with `complete 100`, covering 3,200 timed runs.
Every repeated and cross-binary plan/report matched exactly. Eight-leaf search
has 255 states and 2,032 candidates for V1/V2, 1,016 for unhinted V3; nine/64
leaves have zero DP work and exactly match greedy fallback. These are synthetic
shape checks without statistics, not representative RDF query-result coverage.

Eight-leaf unpadded V1 p50/p95 was 0.653/0.909 ms parent and 0.457/0.495 ms
candidate. V2 p50 was 0.767/0.957 ms, V3 0.500/0.761 ms, and unchanged
64-leaf greedy p50 was 56.834/90.455 ms. This variability rules out a general
speedup conclusion from these shared-host processes. The deterministic gain
is avoiding rejected tree construction, proven by the native failing-eager /
passing-lazy regression, not a ratified percentage. Whole-process peak RSS
was 3,584–4,352 KiB across both binaries; this includes inputs/reference plans
and does not isolate optimizer allocations or establish a global memory quota.

Local raw output/time reports and both binaries are retained under
`/tmp/oxigraph-g32-planner-Fw9iLq`. Parent binary SHA-256:
`feb66058b005d22bceacbca2ebd0098f6c17e58ef21f334fba6f82e5ba78e844`;
candidate: `590eddf01a8c38d83adf6e297e2db1a90ee96b27d533f3d8cf9bb8347411d9d5`.
Both use the same diagnostic behavior and Rust 1.98.0 release/all-features;
the parent diagnostic source precedes formatting-only changes. Raw timings
are local diagnostics, not protected baselines, qualification or promotion.
The final diagnostic uses explicit buffered, fallible stdout writes and has
SHA-256 `e7ade2797decf7198a99eb09c6ca3141b02dfa30f9bca5ec0b1893b2b03f6d22`.
All 16 final one-repetition plan/report comparisons still equal the retained
parent, and eight invalid argument cases are rejected. Do not relabel the
earlier timing binary as this final build. Native optimizer tests pass 19/15
with all/minimal features, query/statistics checks pass 25 plus six minimal
query checks, and the pinned Oxigraph SPARQL and optimizer suites pass.
Library/example Clippy passes in both feature configurations; a broader test
lint attempt also reported pre-existing test-code diagnostics, not an
application build failure.

## WatDiv V3 and statistics lookup diagnostic

On 2026-09-08, source `2760f0e3` ran the same six WatDiv inputs, 30 repetitions,
CPU 8, `--mode bounded_correlated_v3 --setup query-only` and the checked WatDiv
manifest. All **192/192 observations** equal the optimization-disabled oracle
(186 samples including six warm-ups, six separate feedback executions).
Result counts remain 0, 0, 56, 0, 9,909 and 11. Comparing the parent greedy run
above with this run:

| Query | Greedy / V3 quad-leaf rows | Greedy / V3 p50 ms | Greedy / V3 p95 ms |
| --- | ---: | ---: | ---: |
| Q1 | 3 / 3 | 0.038 / 0.042 | 0.046 / 0.053 |
| Q2 | 3 / 3 | 0.054 / 0.051 | 0.071 / 0.065 |
| Q4 | 36,144 / 55,720 | 186.552 / 254.387 | 262.729 / 402.538 |
| Q7 | 21,299 / 21,299 | 215.017 / 214.329 | 267.616 / 257.232 |
| Q14 | 11,595 / 11,595 | 54.346 / 99.683 | 63.620 / 632.620 |
| Q17 | 8,486 / 8,486 | 78.058 / 95.339 | 79.394 / 118.489 |

Q4 expands genre before title/expiry under V3; greedy filters title/expiry
first. Both plans obey their profiles. Without statistics the bound-subject
spokes receive generic probe estimates, which miss the differing fanout and
selectivity. Q4's extra 19,576 rows are deterministic work, not host noise.
The other timings remain noisy shared-host diagnostics, not acceptance or
aggregate speedup. Each query has only one complete feedback leaf in either
plan; complete-leaf q-errors are unchanged, and correlated partial leaves
remain null. Fewer complete feedback observations are not automatically a
regression or an estimation improvement.

V3 elapsed 491.47 s, load 284.565 s, peak RSS 21,679,476 KiB; setup and query
work are separate. The binary SHA-256 is
`1d958443444f1b233aae4890e6a4383412df8758bd268658acd8d10b221a10db`.
Raw `run.jsonl` under `/tmp/oxigraph-g32-watdiv-v3-UM4Mwo` has SHA-256
`9e85ce68945a96d6d72787137c5aefd06a0261186f6703b180ccb21b97bf8b3a`;
`run.time`: `9fdea15774769d72f59de0f9215701defd0c7d4c840a5bac0c86f12bce42068e`.

A separate product correction uses the already-verified canonical index for
exact statistics scope/count lookups instead of linear scans. Counts, estimates,
wildcard behavior, payloads and cost profiles are unchanged. A local public-API
microprobe builds 1,000 one-quad predicate scopes and times five loops of 10,000
exact count-plus-scope lookups, excluding build/read setup. Parent loop times
are 61.899–63.233 ms (median 62.427); corrected times are 2.173–2.485 ms
(median 2.286). This is a narrow lookup diagnostic, not query speedup or G3.2
acceptance. No affinity or isolated-host claim is made.
The temporary source `lookup_probe.rs` beside the raw files has SHA-256
`141368ba32e81f0bb54d953e1b583d8276c2b9172fbd32b886799c5aada9cc1e`;
parent/candidate binaries are `lookup-parent` and `lookup-candidate`, SHA-256
`06ba29d9daa67188e196f602dcfe91aecba36f2ec28342bf6b5e8b2e6b684528` and
`498dc269dc29ad28b8a5ebfaf0e162a3209ee6e8a24092aa0b8154e6bdfa77bf`.
Native scope/state/planning tests pass 28 with `statistics,rdf-12` and 26 with
`--no-default-features --features statistics`; focused Clippy and release build
pass. No threshold is relaxed and the next measurement is shared verified
statistics on the existing scoped corpus.
