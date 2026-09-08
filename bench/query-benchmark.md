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
resource bounds. The programme decider must ratify numerical gates after the
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
