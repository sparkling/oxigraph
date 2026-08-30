# Oxigraph fork instructions

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
