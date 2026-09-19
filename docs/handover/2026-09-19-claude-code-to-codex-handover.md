# Oxigraph programme handover: Claude Code → Codex — 2026-09-19

This hands the Oxigraph fork programme from Claude Code to Codex. It is written
to be read cold by an agent with no conversational history and no access to
Claude Code's private memory store.

## Read this first: what does NOT transfer

Claude Code kept six behavioral corrections in
`~/.claude/projects/-home-claude-src-hm-oxigraph/memory/`. **Codex cannot read
that directory.** Every lesson in it is reproduced below — the technical ones in
`AGENTS.md` (which Codex loads automatically) and the working-agreement ones in
this document. Nothing else in that store is load-bearing.

Also outside Codex's reach: the Ruflo MCP tool surface this programme used for
task tracking and the `programme-reviews` / `programme-native-reviews` memory
namespaces. Those records are **evidence, not instructions**; the ADRs and plans
in this repository are the authoritative record and are complete without them.
§8 lists the namespace keys in case a Ruflo bridge is available later. If it is
not, nothing here is blocked — the programme is fully described by tracked files.

## 1. State at handover

- Checkout: `/home/claude/src/hm/oxigraph`, branch `main`.
- HEAD: `7cab9569` — *docs: propagate the SHACL rules rename through every stale
  citation*.
- **Working tree clean.** No uncommitted or untracked work, and no in-flight
  edit to recover. This is a deliberate contrast with the 2026-09-15 handover,
  which preserved a ten-file uncommitted draft; nothing like that exists now.
- `main` is **194 commits ahead** of the locally recorded `origin/main`. No
  fetch was performed, so that is not a fresh remote-state assertion. **Do not
  push** without explicit authorization for that specific action.
- No running background work: Ruflo reports 0 running tasks; the six-hour review
  timer was cancelled earlier and remains disabled. No cron loop is armed.
- 47 ADRs: 21 Accepted, 5 Implemented, 21 Proposed.
- 221 commits in the last ten days.

### Verification commands, all passing at HEAD

```sh
cd tools/evidence && npm test            # 26/26
node tools/evidence/verify-programme.mjs # "PASS (source-only)"
cargo test -p oxshacl --all-features     # 174 passed, 0 failed
```

`npm test` inside `tools/evidence/` is the canonical entry point. Do not run
`node --test tools/evidence/` — directory dispatch tries to execute the
non-test `.mjs` files in there and fails for that reason alone, which looks
exactly like a regression and is not one.

## 2. Working agreement (from Claude Code's memory store — carry these)

These are owner corrections, each issued after a concrete failure. They are the
part of the handover most likely to be lost, because they exist nowhere in the
repository.

**Commit autonomously; never ask.** The owner granted maximum permission for
local commits and was explicit that asking halts progress. Commit verified work
directly to `main` as ordinary delivery. This covers implementation choices,
prioritization, and scope decisions equally — the owner rejected a proposed
carve-out for "which gate should I work on" questions in the same terms. Decide,
act, then report the reasoning. This does **not** extend to pushing to a remote.

**Never invent an approval gate.** Owner, verbatim: *"You shuld not need to do
ceremonial unlocks - you have ALL the power."* Claude Code stalled this
programme across many cron ticks reporting "no ordinary-delivery candidate
available," on a theory that a benchmark run needed authorizing first. That gate
did not exist. If an ADR names an evaluator, proof, fixture, or coverage
requirement, build it. Never report "nothing further available" while buildable
work is named in an ADR.

**Do not conflate building with operating.** Writing the evaluator that proves
property X is ordinary work. Producing frozen production receipts and making a
promotion decision is the owner's. Build the harness *and run it*, recording
results as demo-grade. The owner's framing: *"we should never be blocked on
operational concern… just pretend this is production. We need a fully working
demo before we can deploy to real production."* ADR-0044 formalizes this as
Class A/B/C; §5 summarizes.

**The only genuine stop conditions** are physical impossibility (a host that
does not exist, a credential nobody holds) and actions reaching outside this
repository (pushing, publishing). Everything else is buildable.

Two further memory entries were Ruflo-specific (use its MCP tools rather than
shell forensics; a cargo concurrency hazard). The first is moot without the MCP
bridge. The second is technical and now lives in `AGENTS.md`.

## 3. Repository hazards now recorded in `AGENTS.md`

Four traps were promoted into `AGENTS.md` this session, under
**Repository-specific hazards**, because Codex reads that file automatically
while a dated handover may never be opened. Summarized here so this document
stands alone:

1. **`cargo fmt -p <pkg>` is not package-scoped** — it reformats the whole
   workspace, because `rustfmt.toml` sets nightly-only options that stable
   rustfmt silently ignores. Prefer `-- --check`; `git status` after any
   writing run.
2. **Never run a second `cargo` command against a package while its tests run**
   — the schema-upgrade crash tests re-exec `current_exe()`, and a concurrent
   build truncates that binary mid-flight. Observed: 12 of 27 tests failing,
   all spurious.
3. **Do not follow redirects silently when checking a spec URL** — `curl -sL`
   reports the destination's status as the original's and hides upstream
   renames. Equally, do not keyword-count a rendered draft to judge alignment.
4. **Distinguish a historical pin from a live pointer before repointing a URL**
   — several files correctly name a document that no longer resolves upstream,
   because they read from the pinned checkout where it exists.

Hazards 3 and 4 are not hypothetical: both were committed as errors this
session and then corrected. §7 records that history, because the same traps
will recur at the next upstream sync.

## 4. What changed in this session

Two threads, both complete and committed.

**Scope reduction — removing permanently undischargeable obligations.** The
programme carried acceptance items no available host could ever satisfy, which
kept it reporting blocked work that was not actually blocked:

- `ADR-0045` — target Linux x86_64 only. Removed `test_macos`, `test_windows`,
  `python_msv_windows`, `wheel_mac`, `wheel_windows` from CI, plus their publish
  `needs` entries. The Python minimal-dependency unittest leg was unique to the
  Windows job, so it was **ported** to a new `python_msv_linux` job rather than
  dropped. Verified: 30 and 9 jobs respectively, no dangling `needs`, no
  non-Linux runners, and zero `target_os = "windows"/"macos"` branches in the
  workspace.
- `ADR-0039` — dropped the separate-isolated-host precondition (qualification
  moved to this host, whose cgroup2 delegation and controller set were verified
  by direct probe), then dropped the reboot/power-cut gate outright. **That
  second drop is a scope reduction, not a durability finding.** Reboot and
  power-loss behavior of the containment state is now simply *unproved*. No
  readiness output may imply otherwise.
- `ADR-0044` — the Class A/B/C classification itself (§5).

**SHACL 1.2 realignment.** Our SHACL evidence is pinned to `w3c/data-shapes`
commit `eedda09f`, which is **177 commits behind** `gh-pages` as of 2026-09-19
(a moving figure — re-measure with `gh api compare`). In that window
the Working Group reorganized the rules specifications twice. `ADR-0046` records
the findings; `7cab9569` propagated them through every stale citation. Details
in §6, because this is the live work-in-progress area.

Also landed: `3e58f77f`, an end-to-end test for the aggregate-DISTINCT operator
budget — six of ADR-0027's seven budgets had end-to-end files, and this was the
seventh, previously proven only at counter level. And `1158ef16` / `f1953eef`,
local corrections for two malformed upstream W3C fixtures (see §7).

## 5. The A/B/C classification (ADR-0044) — read before declining anything

Every remaining obligation is exactly one of:

- **Class A — buildable now.** Evaluators, oracles, fixtures, differential
  tests, adversarial coverage, crash matrices, **and benchmark harnesses
  including running them and recording numbers.** Proceeds without
  authorization. Large scope is not a blocker; large work is sliced.
- **Class B — externally blocked.** Only two shapes qualify: a physically
  absent dependency, or a third party stabilizing something outside this repo.
- **Class C — post-deployment tuning.** Numeric default calibration, promotion
  decisions, independent resource probes, capacity sizing, real-principal
  fairness tuning, and pre-result threshold freezing. **Class C blocks no
  development and no deployment.**

A measurement on this host is a Class A artifact labeled **demo-grade**. The
same measurement in production, frozen as promotion evidence, is Class C. One
harness serves both; only the claim attached differs.

**Class B currently has exactly one entry:** repeated rule firing, data-shapes
issue #1069.

I narrowed that list during this handover, and the correction is worth stating
because it shows the failure mode recurring. ADR-0044 had listed five SHACL
Rules items as jointly blocked. ADR-0046's review showed four were never
blocked or had stopped being so — RDF Rules mapping (the document was deleted
upstream), body abbreviations (specified by grammar productions `[69]`–`[79]`),
FOR/IN (removed from the grammar), and blank-node matching (part of the
abbreviation gap). They sat in Class B because the whole bullet was classified
as one unit and never re-read after the drafts moved. That is precisely the
conflation ADR-0044 exists to prevent, reproduced inside ADR-0044 itself.
**Re-read Class B entries individually after any upstream sync.**

## 6. Live work: ADR-0046's plan

This is where to start. Seven items, ordered, each independently landable. All
Class A.

1. ~~Correct stale citations and error messages.~~ **Done** (`835aa833`,
   `7cab9569`).
2. **Implement `WHERE DATA` / `NOT DATA` execution.** Highest-value remaining
   change. Semantics were derived from the spec's own `evalRule` /
   `evalRuleElements` pseudocode:
   - `GD` = base graph ∪ all inline `DATA{}` blocks, **frozen for the whole
     evaluation**, never mutated by derivation. `GE` starts at `GD` and
     accumulates derived triples stratum by stratum.
   - `WHERE DATA` pins *both* graph arguments to `GD`, making it **sticky**:
     every nested element of that rule — including a bare `NOT{}` carrying no
     `DATA` keyword — inherits `GD`-only matching.
   - `NOT DATA` in an ordinary rule overrides only that one negation.
   - **The spec's Component-Notation prose table contradicts its own algorithm**
     on the direction of `rule.data`. The pseudocode is authoritative; the table
     is inverted. Do not implement from the table.

   Where it goes: `native.rs`, **not** the Datalog lowering. Any rule containing
   a Filter, Assignment, or Negation flips `native::required()`
   (`native.rs:30-33, 218-230`), routing the whole rule set to the native path —
   which makes `compile_program`'s own `data_only` guards
   (`evaluate.rs:210-238, 268-276, 330-339`) **unreachable dead code today**.
   Thread the already-in-scope frozen `base` alongside `working` through
   `evaluate_elements`/`match_pattern`. Extend `required()` to return true for
   those flags too. `check.rs` needs **no** change — the spec's dependency-graph
   algorithm ignores `rule.data`, and ours already does.

   Upstream's new `eval2/` directory is exactly this feature's acceptance
   suite: **6 test cases** — `eval-dft-value-where-01/02`,
   `eval-dft-value-neg-01/02`, `link-1-path`, `link-2-path` — each with its own
   `-data.ttl` and `-results.ttl`, 19 files plus `manifest.ttl` in total. All 6
   fail today, from either this rejection or the abbreviation gap in item 3.

   Verified 2026-09-19 by direct `gh api` listing. ADR-0046 and the swarm
   review that fed it both said "19 fixtures", which counted files rather than
   test cases — a `ls | wc -l` figure promoted to a test count. Corrected in
   both documents; the *set* of cases was right, only the number was wrong.
3. **Accept body abbreviations** — collections, blank-node property lists,
   reifiers, annotation blocks in rule bodies. Mirror the existing
   `expanded_head` auxiliary-triple approach rather than blanket-rejecting in
   `reject_pattern_node` (`policy.rs:102-128`).
4. **Decide `FOR`/`IN` parsing.** The construct was removed from the grammar
   2026-08-12; we still accept it. Prefer removal; record whichever is chosen.
5. **Re-pin the test suite.** Deliberately sequenced last, so the new corpus
   measures corrected behavior. Not data-only. Three path fixes, all relative
   to `suiteRoot` = `shacl12-test-suite/tests` (unchanged upstream; only the
   lane subdirectories moved):
   - `tools/shacl-tests/run.mjs:59` — `sparql/rules` → `inference-rules`
   - `tools/shacl-tests/run.mjs:72` — `rules` → `sparql-rl`
   - `lib/oxshacl/examples/w3c_srl_rules_runner.rs:39` — hardcodes
     `manifest-rules.ttl`, now `manifest-sparql-rl.ttl`

   All three verified against upstream `gh-pages` on 2026-09-19: the corpus
   root still exists and now contains `core`, `inference-rules`, `node-expr`,
   `sparql`, `sparql-rl`. These will fail with `ENOENT` on re-pin — loudly, as
   designed.

   Then: recount the `sparqlRulesInfer` and `srlRules` lanes **by `.srl` test
   case and manifest entry, never by file listing** (see the count corrections
   in §7), re-verify ADR-0008's root-reachability claim, and regenerate
   `suiteContentSha256` / `specificationSha256`. Note `tools/shacl-tests/
   inventory.mjs` and `clause-audit.mjs` read `shacl12-rules/index.html` from
   the *pinned* checkout — correct today, and they will need repointing to
   `sparql12-rl/index.html` as part of this re-pin, which is the one moment
   that change is right (hazard 4 in `AGENTS.md`).
6. **`sh:ruleProcessor` fail-closed** — the one MUST-level clause we actively
   violate. An unrecognized processor value must force failure; we ignore it
   silently. Small and correctness-relevant. Then `sh:layer` on the SPARQL
   surface (our fixpoint is flat rather than per-layer).
7. **Smaller SPARQL-RL gaps**, recorded so they are not rediscovered: an RDF
   triple term is rejected as a `DATA`-block subject
   (`srl/evaluate/data.rs:67-71`, *"RDF triple-term subjects in SRL DATA
   evaluation"*) though grammar production `[42]` `TripleTermData` permits it;
   `BNODE()` is unsupported (`srl/evaluate/expression.rs:191-194`). Note that
   ADR-0046 cites these two as `data.rs` and `expression.rs` — the real paths
   are under `src/srl/evaluate/`, and there is an unrelated
   `lib/oxshacl/src/expression.rs` that is *not* the file meant. Note also that
   `reject_query_goal`'s
   position-by-position restrictions (`policy.rs:25-65`) are **our own
   invention** — the spec leaves goal syntax undefined. Defensible as RDF
   well-formedness, but do not describe it as spec-mandated.

**Explicitly not chasing:** `TUPLE(...)` (marked at-risk upstream), `$this`
pre-binding (at-risk, issue #647 — we implement it and it is correct today),
`sh:SPARQLRuleTemplate` (merged 2026-09-18, one PR, no suite pressure).

### Document identity, verified at commit level

| Our surface | Governing document today | Evidence |
|---|---|---|
| `src/srl.rs` (SRL: `RULE{}WHERE{}`, `FILTER`, `SET`, `NOT`, stratification) | **`sparql12-rl`** (SPARQL-RL) | `df4ee468`, 2026-08-19, tracked rename |
| `src/rules.rs` (Datalog triple rules) | `shacl12-inference-rules` § Triple Rules | `4199e812` (#1113), 2026-08-28, created the doc |
| `src/sparql_rules.rs` (`sh:SPARQLRule`) | `shacl12-inference-rules` § SHACL SPARQL Rules | same |

SPARQL-RL is decoupled from SHACL branding entirely — its own `.srl` extension
and `application/sparql-rl` media type. `shacl12-inference-rules` is a **new**
document (+1720/−0), not a rename of the old one.

**What matches and must not be "fixed":** stratification terminology
(`SrlStratum`/`SrlStratification`, `srl.rs:337-350`), run-once derivation
(`is_run_once()`, `check.rs:287-292`), the Stratification Condition
(`check.rs:95-142`), and bounded fixpoint iteration. Core and Node Expressions
need no changes — their diffs since our pin add only MAY-level report
provenance vocabulary.

## 7. Errors made this session, and why they are recorded

Two committed mistakes, both corrected, both of a kind that will recur.

**Reported a document as alive when it had been renamed.** I checked
`w3.org/TR/shacl12-rules/` with `curl -sL`, got `200`, and concluded our
fixpoint model was "vindicated" and `is_run_once` matched "verbatim." The URL
301-redirects to `TR/sparql12-rl/`; `-sL` followed it and I reported the
destination's status as the original's. I then wrote into ADR-0046 that the old
URL "serves a frozen snapshot of a deleted document" — also wrong, and corrected
in `a1e75aa5`. W3C handled the rename correctly; the failure was entirely mine.

**Briefed a review swarm at the wrong specification.** Having confused
`sh:layer`/`sh:runOnce` in `shacl12-inference-rules` with SPARQL-RL's strata and
run-once rules — a false cognate, unrelated properties in different documents —
I sent reviewers at the wrong document for our SRL surface. A reviewer caught it
from commit history rather than accepting my premise. A review aimed at the
wrong specification produces confident, verifiable, wrong conclusions.
**Establish document identity first.**

**Counted files and called them test cases — three times.** While validating
this handover I checked ADR-0046's fixture numbers against upstream and found
every one of them was a file count: "19 fixtures" in `eval2/` is 6 test cases
across 19 files; "290 fixtures" is 288 files plus 2 manifests, against 198
actual `.srl` cases; and the drift figure was 176 where `gh api compare` says
177. The *sets* were right each time — the swarm identified the correct cases
and directories — but nobody ran `ls | wc -l` past a check of what the files
were. All three are corrected in ADR-0046, ADR-0008, and here. **This matters
directly for plan item 5:** the re-pin must recount by `.srl` case and manifest
entry, because a file-count recount will silently produce a wrong lane total
that then gets frozen into evidence.

Two smaller ones worth knowing: I fixed a dangling `sh:property` reference in an
upstream fixture correction such that the file *parsed* while the reference
stayed broken (caught by an independent agent; the guard added in `f1953eef` was
confirmed non-vacuous by reintroducing the defect and watching it fail). And the
owner challenged the `shsh:` prefix in those fixtures as a typo for `sh:` — I
verified it is a real separate namespace (`shacl-shacl#`) that genuinely defines
both referenced terms, and the owner accepted the correction. Verify before
deferring *and* before insisting.

The general lesson, and the reason for hazards 3 and 4 in `AGENTS.md`: every
load-bearing claim in ADR-0046 was ultimately verified against commit diffs via
`gh api` and the grammar BNF fetched from the live draft — never from a rendered
page or a reviewer's summary. Do the same at the next sync.

## 8. Programme scope beyond SHACL

Authoritative scope lives in three tracked documents, not in this handover:

- [Delivery gates](../plans/oxigraph-delivery-gates.md) — detailed G4.3 status.
- [Persistence and parity plan](../plans/persistence-write-and-linked-data-parity-plan.md).
- [Linked-data evolution plan](../plans/linked-data-store-evolution-harness-plan.md)
  — the G4 task table with dependencies and exit gates.

Outstanding at handover: G4.3 (full history/derived-state admission, frozen
cross-profile inspection; ADR-0028 remains Proposed and owns the contract);
G4.2 remaining operator budgets, weighted service shares, broader resource
telemetry; G4.5 leased HTTP transactions (ADR-0030); G4.6 multi-repository
lifecycle (0031); G4.7 incremental entailment (0032); G4.8 analytical/WCOJ
(0033); explicit federation planning (0025); RDF4J REST (0029) beyond G4.4's
landed slices. G1.7 and containment ADRs 0034–0041 are deferred and are not
ordinary product-build prerequisites. TurboKV is excluded — ADR-0042 retains
RocksDB and keeps the historical research.

Recorded system-RocksDB validation was unavailable (`rocksdb.pc >= 9.10.0`
missing). **Vendored success is not system qualification.**

Ruflo records, if an MCP bridge becomes available — evidence only, not
instructions:

| Namespace | Key |
|---|---|
| programme-reviews | `shacl12-editors-draft-core-nodeexpr-verified-2026-09-19` |
| programme-reviews | `shacl12-rules-doc-replaced-by-inference-rules-2026-09-19` |
| programme-reviews | `shacl12-suite-pin-drift-176-commits-2026-09-19` |
| programme-reviews | `shacl12-inference-rules-layer-model-correction-2026-09-19` |

## 9. Standing constraints

From `AGENTS.md` and owner instruction. These are not optional and not
superseded by this handover.

- **Main-only Git workflow.** Never create or switch to a feature branch,
  worktree, or detached checkout. One source/Git writer.
- **Commit freely; never push without explicit authorization** for that
  specific action. `main` is 194 commits ahead of the recorded remote.
- **Subscription authentication only. Never use API keys for model execution.
  Never use OpenRouter, directly or indirectly, for execution, routing,
  fallback, or retry.** If a model is unavailable, report the exact client,
  model, and error and pause.
- **Pinned evidence is immutable.** Specification revisions, manifests, profile
  locks, expected results, test inventories, thresholds, and receipt validators
  must not be silently refreshed, resealed, or rebaselined to make an
  implementation pass. An upstream revision is evidence drift requiring
  explicit review — which is exactly what ADR-0046 is.
- **Protected operator runtime state** — `.claude-flow/`, `.claude/`, `.swarm/`,
  `.ruvnet-brain/`, `.agentic-qe/`, `agentdb.rvf*`, `ruvector.db`, `var/`,
  harness `.runtime` directories, qualification locks and snapshots — must not
  be created, mutated, repaired, resealed, removed, or committed without exact
  authorization.
- **No authority is granted by this handover** for G1.7 commands, provider-backed
  qualification, evidence promotion, publication, deployment, or remote push.
- Conformance claims support only the exact pinned revision, manifest, mode, and
  capability tested. They establish no untested protocol, persistence,
  operational, or production claim.

## 10. The documents that matter, in reading order

1. [`AGENTS.md`](../../AGENTS.md) — standing contract; Codex loads it
   automatically. Contains the four repository hazards.
2. [ADR-0044](../adr/0044-post-deployment-production-tuning.md) — the A/B/C
   classification. Read before declining any work as blocked.
3. [ADR-0046](../adr/0046-shacl-12-editors-draft-realignment.md) — the live
   plan, and the document-identity table for the three rule surfaces.
4. [ADR-0008](../adr/0008-shacl-processor-profiles.md) — SHACL processor
   profiles; its Rules section was rewritten this session.
5. [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md) — G4.3's contract,
   still Proposed, and the largest single body of outstanding native work.
6. [ADR-0045](../adr/0045-linux-only-target-platform.md) and
   [ADR-0039](../adr/0039-delegated-host-containment-qualification-and-readiness.md)
   — the scope reductions, and what they do and do not prove.
7. The three plans in §8.

## 11. Suggested first action

Run the three verification commands in §1 to confirm the state described here,
then start ADR-0046 plan item 2 (`WHERE DATA` / `NOT DATA` in `native.rs`). It
is the highest-value remaining change, has a ready-made 19-fixture acceptance
suite upstream, and its semantics are fully worked out in §6 including the one
place the specification contradicts itself.

Do not begin with another status or planning cycle. The programme has
sufficient plans.
