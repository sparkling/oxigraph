# Oxigraph fork instructions

## Independent model session capacity (2026-09-19 user amendment)

Do not impose a fixed repository-wide session-count cap on independent Codex
(ChatGPT subscription) or Claude Code subscription processes. Four distinct
concurrent Codex sessions completed successfully on Codex 0.155.1; Claude
session capacity was not benchmarked. Do not add repository overrides for
native subagent counts. Client defaults and enforced per-session limits still
apply; independent sessions do not establish infinite capacity.
Select parallel work from ready dependencies and file ownership; preserve the
single integration writer and existing build/resource isolation. Historical
in-session capacity observations are not a global model-session limit.

Use the existing engineering delivery workflow's contributor proposals for
parallel native work: each contributor owns exclusive proposal paths and an
exact source identity; one root applies the aggregate after independent review.
Dispatch dependency-ready work immediately and assign review help when acceptance
is waiting. The 32-core host is a build resource, not a model-session limit.
The command owner must exclude overlapping builds/tests that share Cargo outputs
for their full lifetime; the current delivery wrapper does not enforce that lock.
Use configured task-specific model defaults, escalating concrete hard decisions.
The owner selected native Codex `gpt-6-astra` with `xhigh` reasoning for the
programme coordinator on 2026-09-20. It owns dependency sequencing, worker/model
allocation and acceptance decisions. Root remains the sole source writer and
engineering-workflow host. Select worker and reviewer routes independently.
Balance accepted correctness, elapsed time and total reported context/review/repair
tokens from ordinary work, without quota gates or a benchmark programme.

## Precedence and evidence

Active system, developer, and user instructions take priority, followed by the
nearest applicable `AGENTS.md`.

This is a policy-bearing Oxigraph fork. Accepted or Implemented fork ADRs and
their pinned evidence supersede general upstream guidance. Hash-ratified,
implemented slices of Proposed ADRs must follow their literal contracts, but
Proposed status grants no production, qualification, promotion, or publication
authority.

Before changing semantic, protocol, persistence, evidence, or harness behavior,
read the relevant ADRs. Treat pinned specification revisions, manifests, profile
locks, expected results, test inventories, thresholds, evaluator identities,
protected projections, and receipt validators as immutable evidence. Do not
silently refresh, reseal, rebaseline, or change expected results to make an
implementation pass. An upstream revision is evidence drift requiring explicit
review.

Specification conformance and suite results support only the exact pinned
revision, manifest, mode, and capability tested. They do not establish untested
protocol, service, persistence, operational, or production claims.

**ruflo-interface-contract:v2**

## Ruflo Interface Contract

- Use `search_ruvnet` for RuvNet source and capability claims when the Brain is installed; cite its source.
- Use `guidance_brain` / `guidance_recommend` and the live MCP registry for this process's actual registered, configured, reachable, healthy, and authorized state.
- Prefer a live structured Ruflo MCP tool for coordination, memory, routing, learning, and status. Discover deferred tools and schemas; never guess names or arguments.
- For a genuine Ruflo CLI-only gap, use `ruvnet_cli_help({executable: "ruflo", argv: ["<group>", "<command>"]})`, then `ruvnet_cli_run({executable: "ruflo", argv: [...]})` with the exact literal arguments that help authorized. Never guess `claude-flow` as the executable merely because an old package or instruction used that name.
- Direct shell is for bootstrap and administration that cannot depend on MCP: install/init, first MCP registration/start, diagnostics, and deliberate daemon work.
- Native Claude/Codex agents execute. Ruflo tracks a swarm only after `swarm_init` and `agent_spawn` create records; a native agent alone is not proof.
- Before generic testing or security agents, discover specialized installed QE or adversarial-security capabilities and disclose any fallback.

This interface contract governs Ruflo use without weakening this fork's stricter evidence, protected-state, provider, qualification, or publication boundaries.

## Runtime and authority boundaries

`tools/metaharness` is the semantic qualification harness.
`tools/engineering-harness` is the separate engineering implementation and
repair harness. Neither may substitute for the other, and an engineering pass
is not semantic truth, qualification, promotion, or publication.

Treat `.claude-flow/`, `.claude/`, `.swarm/`, `.ruvnet-brain/`, `.agentic-qe/`,
`agentdb.rvf*`, `ruvector.db`, `var/`, harness `.runtime` directories,
qualification locks and snapshots, mutable latest pointers, and
`/var/lib/oxigraph-engineering-harness/` as protected operator runtime state. Do
not create, mutate, repair, reseal, remove, checkpoint, or commit this state
without exact authorization.

Ordinary local validation does not authorize:

- any `g1.7:*` command or live containment/qualification run;
- provider-backed execution, benchmarking, or qualification;
- evidence promotion or baseline replacement;
- pushing, publishing, deploying, uploading, opening external changes, or
  updating public artefacts.

The presence of a script or credential grants no authority. Where provider
execution is explicitly authorized, use native provider clients and
authentication only; never use OpenRouter.

## Specifications

When behavior is unclear, consult both the applicable pinned fork evidence and
the specification relevant to the crate:

- `oxrdf`: <https://www.w3.org/TR/rdf12-concepts/> and
  <https://www.w3.org/TR/rdf-canon/>
- `oxttl`: <https://www.w3.org/TR/rdf12-turtle/>,
  <https://www.w3.org/TR/rdf12-trig/>,
  <https://www.w3.org/TR/rdf12-n-triples/>, and
  <https://www.w3.org/TR/rdf12-n-quads/>
- `oxrdfxml`: <https://www.w3.org/TR/rdf12-xml/>
- `oxjsonld`: <https://www.w3.org/TR/json-ld11-api/>
- `spargebra` and `sparopt`: <https://www.w3.org/TR/sparql12-query/> and
  <https://www.w3.org/TR/sparql12-update/>
- `spareval`: <https://www.w3.org/TR/sparql12-query/>,
  <https://www.w3.org/TR/sparql12-update/>, and
  <https://www.w3.org/TR/sparql12-federated-query/>
- `sparesults`: <https://www.w3.org/TR/sparql12-results-json/>,
  <https://www.w3.org/TR/sparql12-results-csv-tsv/>, and
  <https://www.w3.org/TR/sparql12-results-xml/>
- `oxigraph-cli`: <https://www.w3.org/TR/sparql12-protocol/> and
  <https://www.w3.org/TR/sparql12-graph-store-protocol/>
- `spargeo`: <https://docs.ogc.org/is/22-047r1/22-047r1.html>

ADR-0011 controls this fork's SPARQL mode selection, `VERSION` semantics, and
conservative capability advertisement. Live specification pages are research
inputs, not replacements for pinned fork evidence.

## Testing

Run the smallest relevant tests first, followed by the applicable fork
validation matrix.

`cargo test -p oxigraph-testsuite` is the upstream file-based conformance lane.
It is useful, but it is not the complete fork suite. Depending on scope, fork
validation also includes workspace and feature-matrix Rust tests, focused API
and persistence tests, pinned semantic profiles, evidence validation, and the
relevant JavaScript harness contracts. Follow the applicable CI matrix and ADR
gates; do not infer untested coverage.

For changed JavaScript harness or evidence contracts, run the relevant focused
test files first under both the current supported Node runtime and Node 20,
then run any explicit non-G1.7 matrix required by the applicable ADR. Inspect
package scripts before invoking a broad `npm test`: repository-wide commands
include G1.7 surfaces and are not the default validation lane. Do not invoke
`qualify`, `qualify:synthetic`, or any `g1.7:*` script without separate explicit
authority.

When feasible, place specification fixtures under `testsuite/oxigraph-tests/`:

- `oxttl` and `oxrdfxml`: `parser`, `parser-error`, `parser-lenient`, or
  `parser-recovery`
- `oxjsonld`: `jsonld`
- `spargeo`: `geosparql`
- `spargebra` and `spareval`: `sparql`
- `sparopt`: `sparql-optimization`
- `sparesults`: `sparql-results`

Use focused Rust integration tests and independent fixtures for fork-specific
API, protocol, persistence, recovery, and operational behavior not represented
by those suites.

## Repository-specific hazards

Four traps in this repository that cost real debugging time. Each was diagnosed
empirically here; none is obvious from the code.

**`cargo fmt -p <pkg>` is not scoped to that package.** Unlike `build -p` and
`test -p`, it reformats every workspace member. `rustfmt.toml` sets nightly-only
options (`imports_granularity`, `normalize_comments`, and others) that stable
rustfmt silently ignores, so a stable `cargo fmt` rewrites files away from their
checked-in nightly-produced form — workspace-wide. Prefer the read-only
`-- --check`. After any writing run, `git status --short` and revert unrelated
churn before staging.

**Never run a second `cargo` command against a package while its tests are
running.** The schema-upgrade crash tests re-exec `std::env::current_exe()` to
model real process kills, and `cargo test` reuses one binary path for the whole
package. A concurrent build truncates that binary mid-flight; already-running
tests then re-exec a half-written file. This produces failures that look like
genuine regressions in unrelated tests (observed: 12 of 27 failing, all
spurious). Finish isolated verification *before* starting a full run, or use a
separate `--target-dir`. Suspect this race first when unrelated tests fail
immediately after another cargo invocation.

**Do not follow redirects silently when checking a specification URL.**
`curl -sL` reports the *destination's* status as though it were the original's,
which hides an upstream rename. `w3.org/TR/shacl12-rules/` returns 301 to
`TR/sparql12-rl/`; a `-sL` check reports 200 and the rename passes unnoticed.
Use `curl -sI`, or `-w '%{url_effective} %{num_redirects}'`. Equally, do not
conclude anything from keyword-counting a rendered draft: a term appearing many
times on a superseded document falsely implies alignment, and appearing zero
times on a live one falsely implies abandonment when the concept is specified in
prose under another name. Read the prose, or diff the source. See ADR-0046.

**Distinguish a historical pin from a live pointer before repointing a URL.**
`tools/shacl-tests/inventory.mjs`, `clause-audit.mjs`, and the `RULES`
descriptor's `specification_iri` in `lib/oxshacl/src/profile/catalog.rs` all
name `shacl12-rules/`, which no longer resolves upstream. They are correct:
they read from the pinned `eedda09f` checkout where that file exists and hashes
to the recorded value. Repointing them at the live document would break the pin
while looking like a cleanup. The accessor documented as returning the *live*
draft was repointed; the pin records were not.

## Fuzz testing

When modifying a listed crate, run each relevant target for one minute:

```shell
cargo fuzz run <target> --sanitizer none -- -max_total_time=60
```

Targets:

- `oxttl`: `nquads`, `trig`, `n3`
- `oxrdfxml`: `rdf_xml`
- `oxjsonld`: `jsonld`
- `spargebra`: `sparql_query`, `sparql_update`
- `spareval`: `sparql_query_eval`, `sparql_update_eval`
- `sparesults`: `sparql_results_json`, `sparql_results_tsv`,
  `sparql_results_xml`
