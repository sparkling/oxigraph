# Native text-provider baseline

This is the local G3.3 baseline under [ADR-0024](../docs/adr/0024-rebuildable-derived-indexes.md),
not a production qualification, speed threshold, or promotion command.
The [Rust example](../lib/oxigraph/examples/text_benchmark.rs) has no additional
dependency and creates fresh temporary primary/index directories; it never
opens an operator database or changes protected harness evidence.

```sh
cargo build --locked --release -p oxigraph --features text-index --example text_benchmark -j12
./target/release/examples/text_benchmark 1000 30
./target/release/examples/text_benchmark 10000 30
./target/release/examples/text_benchmark 100000 30
```

Use a separate process for each size. Capture stdout JSONL and the exit status;
an absent final `complete` event or nonzero exit is not a successful run.
For process resource observations, wrap the exact executable with
`/usr/bin/time -v`; CPU affinity may be fixed with `taskset -c 8` on this host.
Record the source commit, executable and lockfile hashes, compiler, CPU/kernel,
affinity, repetition count, and output hashes beside the observations.

## Fixed inputs and oracle

Profile `oxigraph.text-benchmark.literal-grid.v1` admits only 1,000, 10,000 or
100,000 literal documents and 1–100 measured rounds. Each unique equal-width
subject is `urn:doc:NNNNNNNN`. Predicate alternates label/comment. Graph cycles
through physical default, two named IRIs and one fixed blank-node graph.
Language cycles English/French/untagged. Every lexical form contains `common`
and its unique ASCII token; divisibility by 2/3/10/1,000 adds
`alpha`/`beta`/`boundary`/`needle`. These generated inputs inherit the repository
license, not an external dataset license.

Input SHA-256 covers the profile line followed by each generated quad's N-Quads
display plus ` .\n`, in numeric document order. The 1,000-document fixture is
golden-tested as `b1f8dd8fe88654da67250db84b0b655b8e16988d628687750136502e291ba095`.
Every run emits its actual input hash and full runtime text profile; a changed
generator/hash/profile is a different baseline, not interchangeable evidence.

Nine query cases cover rare, intersection, empty, exact candidate boundary,
common, union, combined graph/language scope, independent predicate scope, and
top-seven truncation. An
independent ASCII lexical scan checks full quads, scores, result order, candidate
and match counts, and truncation. Equal-width unique IRI subjects make lexical
subject order identical to the v1 quad-byte tie order. No production tokenizer,
Tantivy result, index contents or provider scan supplies the expected answers.
Unicode, RDF-12, arbitrary identity and failure-path coverage remain in the
native `text_index`/`text_service` and provider unit tests; this generated corpus
does not replace them or claim natural-language relevance/BM25 quality.

Default logical ceilings are unchanged. An unscoped candidate count exceeding
10,000 must return typed `Limit`, even if scope or top-N would reduce output.
Additional samples set the boundary query's candidate ceiling to exactly its
known count, then one less, proving success versus first-excess failure.
Pre-cancelled queries must fail typed. A governed deletion/addition then checks
strict `NotFresh`, explicit eventual deletion filtering/missing addition and
lag context, followed by exact catch-up equivalence. No partial or errored run
is promoted to an equivalent result.

## Measurement boundary

- Load-plus-governance-base, rebuild, activation and catch-up are separate timings. The initial
  bulk load precedes a no-op governed receipt; the measured delta contains only
  the subsequent two semantic changes. Native durability defaults are retained.
- Each round obtains a strict view, timed separately. The view is retained for
  its nine queries; query order rotates. Round zero is warmup and excluded from
  measured quantiles. One native query runs at a time.
- Query timing includes checksum verification, RAM payload hydration, engine
  search and primary refinement. It excludes admission and oracle validation.
  Empty-query time is **not** a separately measured hydration time.
- The database/index have just been built. OS caches are not evicted; each
  provider call hydrates a fresh RAM index. Neither round zero nor a new process
  establishes a cold-OS-cache measurement. No cold-cache claim is made.
- Payload file bytes and whole-process peak RSS are different observations.
  RSS includes RocksDB, Tantivy, corpus/oracle copies and benchmark overhead;
  it is not an isolated index allocation or the logical provider ceiling.
- Report raw samples and per-case quantiles. Thirty rounds give only a coarse
  tail estimate; a shared-host observation does not establish a production
  p99, noise bound, throughput SLA or performance acceptance threshold.

Native correctness/resource evidence supports only this exact profile and
environment. Frozen numeric speed/tail/resource promotion decisions and any
unmeasured operational/concurrency claims remain separate programme work.

## Observed baseline — 2026-09-08

Product source `996ab94abeca06cbd02bede9bb765058206416a2`, with the example
added in `7c26ff3962565942a02f33e40a8529d299083627`. Example-source SHA-256:
`c8d0722fbfacd6844e2bed3b1f6c943c11bb2982f9949ba2321cb426433c5bdf`;
release executable: `63ca43857d509d54ecd2383411e9be8f2ce645fb6ab0bec3ee01fa2873f75413`;
lockfile: `3b13553240707e31ee3c0332a39faeb8af638a1e06173a73e784cd01f54f9e39`.
Built with Rust 1.98.0 (`88d9e12ae`, 2026-08-18), default features plus
`text-index` (not RDF-12), Linux 6.8.0-137-generic, Ryzen 9 7950X3D,
affinity CPU 8 on a shared host. All three commands used 30 measured rounds
plus one warmup, sequential processes, and the cache/durability boundary above.

| Documents | Admission p50/p95 ms | Rare-query p50/p95 ms | Rebuild s | Catch-up s | Payload bytes | Process peak RSS KiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 3.156 / 3.331 | 0.231 / 0.246 | 0.028 | 0.020 | 177,777 | 34,488 |
| 10,000 | 25.592 / 34.984 | 1.334 / 1.892 | 0.150 | 0.182 | 1,753,914 | 69,332 |
| 100,000 | 411.229 / 509.457 | 15.611 / 18.985 | 2.472 | 2.459 | 17,731,778 | 315,168 |

Quantiles are sorted nearest ranks (p50 rank 15, p95 rank 29 of 30).
Rebuild/catch-up exclude their separate activation costs: respectively
0.011/0.007 s, 0.088/0.089 s and 1.891/1.875 s. Load-plus-governance-base
was 0.007, 0.064 and 1.465 s. At 100,000 documents the exact-boundary query
returns 10,000 matches (p50/p95 44.560/58.045 ms); common, union and predicate
queries correctly return typed candidate-limit failures. Those failures are
not result-equivalence successes. All three runs exit zero with 279 query
checks, three lag checks and three resource checks each.

Raw local logs are `/tmp/oxigraph-g33-text-baseline-PyBagJ/{1000,10000,100000}.jsonl`
with adjacent `.time` files; they are not a downloadable release or protected
qualification receipt. JSONL SHA-256 values, in ascending size order:

- `dad126c3dec455e3b03c0fb2f625586d26a4f7be8a51aa6bd0fdf31292d2afe8`
- `cfac2cbaef23b8477e43accc5258a5dd56e0f19af610500022ee433198f2015e`
- `ec246702b93c54ddc0680553f3387b50f48c766dc674cd79c3fe45743269808d`

The larger input hashes are
`fa2d2878c5ea26103dc84488154a2ce5e552bd7d5658448d41417e084bcbf718`
and `c57c1e795ae1eb7eb90825a1f2dcd069dcb2ca2b52a4dff7b46ea4d9c7e6a40b`.
The dominant measured short-query cost is full-snapshot strict admission;
payload hydration remains included in query time. The next optimization must
preserve exact snapshot identity, file-corruption checks, cancellation and
resource ceilings. These observations do not ratify a numeric promotion gate.

## Explicit prepared-session comparison

Add `--prepared` to the same size/repetition command to prepare one verified
RAM session per round and reuse it for all nine distinct queries. The default
remains one-shot. Inputs, order rotation, oracle and ceilings are unchanged;
the `query_mode` field distinguishes the two paths. `preparation` events measure
the checksum-copy/open operation separately from strict `admission` and `query`.
The per-record `api` (and completion's `catch_up_query_api`) explicitly labels
the auxiliary calls: global `query_mode` applies only to timed `query` records.
The additional lag/resource checks still use the one-shot path; focused native
tests cover retained-session lag, corruption, control and captured limits.

Run the two modes sequentially with the **same rebuilt executable**. Compare
the total nine-query cost plus preparation, not just a prepared query with
one-shot hydration included. Admission is unchanged and must still be reported.
The retained session has warm private engine caches across queries and remains
allocated until the round ends. This is an explicit multi-query workload, not
a claim about single-query requests, cold caches or a default SPARQL speedup.

### Observed retained-session comparison — 2026-09-08

Both modes ran at 100,000 documents, 30 measured rounds plus one warmup,
sequentially (one-shot first) on the host/CPU affinity described above, using
the same release executable
`0a4e9c124dedb1d8700eeb6513e953506b10dd958b095f209288e5054cb40517`.
The measured working source is the retained-session implementation on parent
`7c26ff39`, before the additive per-record API-label clarification. The
unchanged text-provider source SHA-256 is
`f1567e141c41536e2d1384276717b3daf7047eb027ac4eeaacb2b067341da55e`
and example-source SHA-256 is
`eb95813a1639f43973a6c3435fa8aeb1c38b39c3007e63da9a14a5fb4fd4b41c`.
The lockfile and generated input hash remain those reported above. Each mode
exited zero with 279 query checks, three lag checks and three resource checks.
These historical raw logs lack the later `api` labels: their `query_mode` applies
only to the timed query records, and all auxiliary query checks are one-shot.

| Operation | One-shot p50/p95 ms | Prepared p50/p95 ms |
| --- | ---: | ---: |
| Nine queries, including preparation/loading | 216.800 / 235.340 | 84.989 / 103.218 |
| Preparation alone | Included in each query | 13.785 / 16.076 |
| Strict admission, separately | 424.649 / 501.465 | 366.581 / 433.296 |

The first row sums the nine queries and any separate preparation **per round**
before taking nearest-rank quantiles; it does not sum individual quantiles.
Three of the nine cases are expected candidate-limit failures at this scale.
Shared-host/order/cache effects are uncontrolled, so these observations are not
a ratified speedup ratio or tail bound. Admission uses identical code in both
modes: its timing difference is not an implementation improvement. Whole-process
peak RSS was 315,420/315,700 KiB, including the corpus and oracle, not just RAM
index bytes. The deterministic changed-file regression separately proves that
prepared queries do not rehydrate durable payloads, even for different terms.

Raw logs remain local in `/tmp/oxigraph-g33-text-baseline-PyBagJ/`:

- `session-oneshot-100000.jsonl`: `62573e27265e9c11bec3e978106217015b81aba237752b29b315944e39e973b2`
- `session-prepared-100000.jsonl`: `764e15d016da015f43612d189c229a9a6a6b8d0bd087f49a002a15ca7c16240e`
