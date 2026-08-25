# Oxigraph

[![Latest Version](https://img.shields.io/crates/v/oxigraph.svg)](https://crates.io/crates/oxigraph)
[![Released API docs](https://docs.rs/oxigraph/badge.svg)](https://docs.rs/oxigraph)
[![PyPI](https://img.shields.io/pypi/v/pyoxigraph)](https://pypi.org/project/pyoxigraph/)
[![npm](https://img.shields.io/npm/v/oxigraph)](https://www.npmjs.com/package/oxigraph)
[![tests status](https://github.com/oxigraph/oxigraph/actions/workflows/tests.yml/badge.svg)](https://github.com/oxigraph/oxigraph/actions)
[![artifacts status](https://github.com/oxigraph/oxigraph/actions/workflows/artifacts.yml/badge.svg)](https://github.com/oxigraph/oxigraph/actions)
[![dependency status](https://deps.rs/repo/github/oxigraph/oxigraph/status.svg)](https://deps.rs/repo/github/oxigraph/oxigraph)
[![Gitter](https://badges.gitter.im/oxigraph/community.svg)](https://gitter.im/oxigraph/community)
[![Twitter URL](https://img.shields.io/twitter/url?style=social&url=https%3A%2F%2Ftwitter.com%2Foxigraph)](https://twitter.com/oxigraph)

## Fork and extension notice

**Upstream Oxigraph** is the Rust RDF graph database and RDF/SPARQL toolkit
maintained at [oxigraph/oxigraph](https://github.com/oxigraph/oxigraph). It is
the foundation described in the next section.

**This fork, `sparkling/oxigraph`,** retains that upstream foundation and adds
a separately bounded semantic-parity extension: RDF 1.2 and SPARQL 1.2
profiles, RDF-native Datalog, RDFS and OWL 2 RL/RDF reasoning, SHACL processor
profiles, cross-interface dataset topology, backend-neutral transactional RDF
writes for replacement persistence planes, and source-bound qualification. The
extension is deliberately not presented as a replacement for every Apache Jena
capability or as blanket W3C-family conformance.

Published extension documentation: <https://sparkling.github.io/oxigraph/>.

## Upstream Oxigraph

Oxigraph is both a graph database and a [RDF](https://www.w3.org/TR/rdf11-primer/) and [SPARQL](https://www.w3.org/TR/sparql11-overview/) toolkit.

Its goal is to provide a compliant, safe, and fast graph database based on the [RocksDB](https://rocksdb.org/) key-value store.
It also provides a set of utilities for RDF basic manipulation (parsing, serialization, canonicalization) and building SPARQL implementations (SPARQL results parsers/serializers, SPARQL parser...).

Oxigraph is in heavy development and SPARQL query evaluation has not been optimized yet.
Oxigraph internal design [is described on the wiki](https://github.com/oxigraph/oxigraph/wiki/Architecture).

Oxigraph implements the following specifications:

- [SPARQL Query](https://www.w3.org/TR/sparql-query/), [SPARQL Update](https://www.w3.org/TR/sparql-update/), and [SPARQL Federated Query](https://www.w3.org/TR/sparql-federated-query/).
- [Turtle](https://www.w3.org/TR/turtle/), [TriG](https://www.w3.org/TR/trig/), [N-Triples](https://www.w3.org/TR/n-triples/), [N-Quads](https://www.w3.org/TR/n-quads/), [RDF/XML](https://www.w3.org/TR/rdf-syntax-grammar/) and [JSON-LD](https://www.w3.org/TR/json-ld/) RDF serialization formats for both data ingestion and retrieval.
- [SPARQL Query Results XML Format](https://www.w3.org/TR/rdf-sparql-XMLres/), [SPARQL Query Results JSON Format](https://www.w3.org/TR/sparql-results-json/) and [SPARQL Query Results CSV and TSV Formats](https://www.w3.org/TR/sparql-results-csv-tsv/).
- [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/).

Most implementations are nearly fully conformant with the latest recommendations (1.1 for RDF, SPARQL and JSON-LD) with preliminary support for 1.2 RDF and SPARQL drafts.

## Semantic parity extensions

Oxigraph also provides a version-pinned, bounded semantic-parity profile for
selected RDF 1.2, SPARQL 1.2, SHACL 1.2, RDFS, and OWL 2 RL/RDF behavior. It
extends the core database without silently broadening an RDF or SPARQL claim:
unsupported profiles, unsafe rule programs, and unavailable execution modes
fail closed. This is a defined implementation and evidence scope, not a claim
of complete Apache Jena portfolio parity or complete W3C family conformance.

The extension includes:

- RDF 1.2 term/version handling and explicit empty named-graph topology across
  model, I/O, stores, query/update, Graph Store, CLI, Python, and JavaScript
  surfaces.
- Backend-neutral `TransactionalDataset` and `WritableDataset` traits with
  read-your-writes, request-atomic generic SPARQL Update, explicit
  `CREATE`/`CLEAR`/`DROP` topology, rollback, and custom backend errors. The
  built-in `Store` implements the contract; production replacement adapters
  remain gated by the shared conformance and isolation work in the linked plan.
- SPARQL 1.2 syntax/version handling, result-media negotiation, active-dataset
  semantics, atomic update behavior, conservative service-description
  disclosure, and protocol/Graph Store validation.
- `oxdatalog`, an RDF-native bounded Datalog engine with D0 positive recursion,
  D1 stratified negation, D2 run-once generated terms, limits, cancellation,
  deterministic provenance, and queryable inferred views.
- `oxrdfs`, a finite active-vocabulary RDFS 1.2 profile, and `oxowl`, a bounded
  OWL 2 RL/RDF profile with 78 named rules: 46 Datalog rules and 32 specialized
  operators.
- `oxshacl`, a fail-closed SHACL processor surface covering dated Core, Node
  Expressions, SPARQL, Rules, Compact Syntax, and profile-negotiation roles.
  Evaluation uses stable read-only snapshots and keeps inferred/report graphs
  separate from the source store.
- Source-bound qualification: official-suite lanes, a classified Apache Jena
  6.1.0 differential, mutation testing, Agentic-QE command coordination, and
  MetaHarness/Darwin policy-only verification.

Agentic-QE and Darwin request their upstream `latest` dist-tags. Committed npm
lockfiles carry exact versions and registry SRI; installs disable lifecycle
scripts. Agentic-QE receipts bind installed package metadata and executable
hashes, while Darwin qualification additionally hashes its installed package
tree before and after each reviewed run.

`tools/metaharness` remains the semantic qualification adapter.
`tools/engineering-harness` is now the separate local-only G1-G3 application
control plane accepted by ADR-0017. It consumes frozen evaluator commits,
reconstructs candidates in disposable Git workspaces, runs one
network-isolated verifier session, and keeps product promotion human-owned.
G1.2 per-instance RocksDB writer serialization is implemented in `7eec1f07`;
G1.3 typed capability negotiation is implemented in `3bf9468c` and accepted by
its frozen 9/3/3 evaluator split. G1.4 bounded writer admission is implemented
in `b2ed9119` plus formatting follow-up `5a704914` and accepted by its frozen
6/2/2 evaluator split: 1/4/16 writers serialize without lost commits, readers
remain live, rollback/drop release the permit, and queued cancellation or
timeout occurs before snapshot creation without publication. This does not
claim cancellation after transaction start. G1.5's unified egress profile is
implemented in `e452bad1` plus lifecycle hardening `3f4cdfd7` and accepted by
its frozen 12/8/13 evaluator split. Built-in `SERVICE`, `LOAD`, and nested
document retrieval now share a deny-by-default policy with typed failures,
separate encoded/decoded byte bounds, time and connection budgets, and remote
read cancellation. G1.5b is implemented in `280872dc` plus review hardening
`9b84bed6` and accepted by its frozen 6/6/12 evaluator split. One cancellation
token now covers validation, built-in RocksDB writer admission, local mutation,
and the final pre-commit checkpoint; owned transactions roll back before a
typed cancellation is returned. The legacy generic transaction opener cannot
observe cancellation while an arbitrary backend blocks, and a caller-owned
transaction remains the caller's rollback responsibility. G1.5c owns the
additive negotiated-backend binding, and G1.6 still owns runtime-derived
service claims, so ADR-0019 stays Proposed. ADR-0018 likewise remains Proposed
until the G1.7 compatibility, performance, and current-evidence promotion gate.

Rust consumers enable the corresponding bounded surfaces explicitly:

```toml
oxigraph = { version = "*", features = ["rdf-12", "datalog", "rdfs", "owl2-rl", "shacl"] }
```

The last sealed reviewed executable evidence includes 575/575 pinned RDF 1.2
official cases, 269/269 SPARQL 1.2 cases, 86/86 RDF Dataset Canonicalization
cases, 519/519 eligible SHACL cases, 98/98 OWL 2 RL/RDF assertions, and a
76-scenario/198-assertion Jena differential. These counts are evidence for the
named pinned suites and profiles only. They are not a substitute for every
normative clause in a W3C document family. They are also historical for their
sealed subject after the backend-neutral write changes: the Jena subject lock
and Agentic-QE exact CLI inventories must be reviewed, and the source-bound
OxDatalog mutation receipt must be regenerated for its exact scope, before full
MetaHarness qualification can be described as current HEAD evidence.

### Published documentation and evidence

Use the following documentation as the authority for scope, implementation
decisions, and verification. The current evidence summary is the quickest
entry point; the machine-readable ledgers and their explicit freshness fields
are the source of truth for sealed-subject versus current-HEAD claims.

- [Documentation home](https://sparkling.github.io/oxigraph/)
- [Current semantic-parity evidence summary](https://sparkling.github.io/oxigraph/research/semantic-parity-current-summary.html)
- [Visual semantic-parity programme report](https://sparkling.github.io/oxigraph/research/semantic-parity-programme.html)
- [Implementation and MetaHarness qualification plan](https://sparkling.github.io/oxigraph/plans/semantic-parity-metaharness-plan.html)
- [Machine-readable conformance ledger](https://sparkling.github.io/oxigraph/research/conformance-ledger.json)
- [Normative requirements inventory](https://sparkling.github.io/oxigraph/research/normative-requirements.json)
- [Standards registry and pinned source revisions](https://sparkling.github.io/oxigraph/research/standards-registry.json)
- [All semantic-parity architecture decision records](https://sparkling.github.io/oxigraph/adr/README.html)
- [Backend-neutral transactional write decision](./docs/adr/0016-backend-neutral-transactional-writes.md)
- [Persistence and linked-data-store parity plan](./docs/plans/persistence-write-and-linked-data-parity-plan.md)
- [Repository evolution and evidence promotion decision](./docs/adr/0017-repository-evolution-and-evidence-promotion-harness.md)
- [Linked-data-store evolution harness plan](./docs/plans/linked-data-store-evolution-harness-plan.md)
- [Outstanding linked-data-store decisions and statuses](./docs/adr/README.md)

The ADRs explain the principal boundaries:

- [Outcome-oriented Apache Jena parity](https://sparkling.github.io/oxigraph/adr/0001-outcome-oriented-jena-parity.html),
  [W3C-first 1.2 parity](https://sparkling.github.io/oxigraph/adr/0006-w3c-first-12-parity.html), and the
  [immutable Jena differential harness](https://sparkling.github.io/oxigraph/adr/0012-immutable-broad-jena-harness.html)
  define compatibility as named observable outcomes rather than an API clone.
- [RDF-native Datalog](https://sparkling.github.io/oxigraph/adr/0002-rdf-native-datalog-engine.html),
  [OWL 2 RL over Datalog](https://sparkling.github.io/oxigraph/adr/0007-owl-profiles-over-datalog.html),
  [SHACL processor profiles](https://sparkling.github.io/oxigraph/adr/0008-shacl-processor-profiles.html), and
  [snapshot reasoning](https://sparkling.github.io/oxigraph/adr/0009-snapshot-reasoning-materialization.html)
  define the bounded inference and validation architecture.
- [MetaHarness/Darwin qualification](https://sparkling.github.io/oxigraph/adr/0004-metaharness-darwin-qualification.html),
  [Agentic-QE integration](https://sparkling.github.io/oxigraph/adr/0005-agentic-qe-integration.html), and
  [mutation competence and provenance](https://sparkling.github.io/oxigraph/adr/0013-mutation-competence-and-provenance.html)
  define how evidence is produced without letting orchestration rewrite the
  semantic oracle.
- [Dataset graph topology](https://sparkling.github.io/oxigraph/adr/0014-rdf-dataset-graph-topology.html) and
  [parallel bulk-load failure semantics](https://sparkling.github.io/oxigraph/adr/0015-parallel-bulk-load-failure-semantics.html)
  document the cross-interface storage and operational guarantees.
- [Backend-neutral transactional writes](./docs/adr/0016-backend-neutral-transactional-writes.md)
  define the public persistence-plane seam and the exact atomicity, rollback,
  read-your-writes, and graph-topology guarantees required by generic SPARQL
  Update.
- [The outstanding linked-data-store ADR programme](./docs/adr/README.md)
  splits transaction guarantees, egress/cancellation, durable commits,
  transaction-time SHACL, operations/recovery, statistics/planning, derived
  indexes, explicit federation, service identity, workload governance, safe
  upgrades, RDF4J REST interoperability, remote transactions,
  multi-repository lifecycle, incremental entailment, and analytical/WCOJ
  research into ADR-0018 through ADR-0033. All sixteen are Proposed living
  plans, not claims of implemented behavior.

The [normative requirements inventory](https://sparkling.github.io/oxigraph/research/normative-requirements.json)
keeps broad claims honest: it records open, blocked, and draft-unclear
obligations separately from passing executable lanes. Consult it before
describing the profile as complete RDF 1.2, SPARQL 1.2, SHACL 1.2, or Apache
Jena parity.

It is split into multiple parts:

- [The database written as a Rust library](./lib/oxigraph). Its source code is in the `lib` directory.
  [![Latest Version](https://img.shields.io/crates/v/oxigraph.svg)](https://crates.io/crates/oxigraph)
  [![Released API docs](https://docs.rs/oxigraph/badge.svg)](https://docs.rs/oxigraph)
- [`pyoxigraph` that exposes Oxigraph to the Python world](./python). Its source code is in the `python` directory. [![PyPI](https://img.shields.io/pypi/v/pyoxigraph)](https://pypi.org/project/pyoxigraph/)
- [JavaScript bindings for Oxigraph](./js). WebAssembly is used to package Oxigraph into a NodeJS compatible NPM package. Its source code is in the `js` directory.
  [![npm](https://img.shields.io/npm/v/oxigraph)](https://www.npmjs.com/package/oxigraph)
- [Oxigraph binary](./cli) that provides a standalone command-line tool allowing to manipulate RDF data and spawn a web server implementing the [SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/) and the [SPARQL 1.1 Graph Store Protocol](https://www.w3.org/TR/sparql11-http-rdf-update/). Its source code and instructions (including Docker) are in the `cli` directory.
  Note that it was previously named [Oxigraph server](https://crates.io/crates/oxigraph-server).
  [![Latest Version](https://img.shields.io/crates/v/oxigraph-cli.svg)](https://crates.io/crates/oxigraph-cli)

Also, some parts of Oxigraph are available as standalone Rust crates to be reused in other Rust projects:
* [`oxrdf`](./lib/oxrdf), datastructures encoding RDF basic concepts (the [`oxigraph::model`](crate::model) module).
* [`oxrdfio`](./lib/oxrdfio), a unified parser and serializer API for RDF formats (the [`oxigraph::io`](crate::io) module). It itself relies on:
  * [`oxttl`](./lib/oxttl), N-Triple, N-Quad, Turtle, TriG and N3 parsing and serialization.
  * [`oxrdfxml`](./lib/oxrdfxml), RDF/XML parsing and serialization.
  * [`oxjsonld`](./lib/oxjsonld), JSON-LD RDF serialization/deserialization algorithms.
* [`spareval`](./lib/spareval), a SPARQL evaluator.
* [`spargebra`](./lib/spargebra), a SPARQL parser.
* [`sparesults`](./lib/sparesults), parsers and serializers for SPARQL result formats.
* [`sparopt`](./lib/sparopt), a SPARQL optimizer.
* [`oxsdatatypes`](./lib/oxsdatatypes), an implementation of some XML Schema datatypes.
* [`spargeo`](./lib/spargeo), a partial implementation of [GeoSPARQL](https://docs.ogc.org/is/22-047r1/22-047r1.html).

The library layers in Oxigraph. The elements above depend on the elements below:
![Oxigraph libraries architecture diagram](./docs/arch-diagram.svg)

A preliminary benchmark [is provided](bench/README.md). There is also [a document describing Oxigraph technical architecture](https://github.com/oxigraph/oxigraph/wiki/Architecture).

## Help

Feel free to use [GitHub discussions](https://github.com/oxigraph/oxigraph/discussions) or [the Gitter chat](https://gitter.im/oxigraph/community) to ask questions or talk about Oxigraph.
[Bug reports](https://github.com/oxigraph/oxigraph/issues) are also very welcome.

If you need advanced support or are willing to pay to get some extra features, feel free to reach out to [Tpt](https://github.com/Tpt/).


## License

This project is licensed under either of

- Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or
  http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or
  http://opensource.org/licenses/MIT)

at your option.

### Contribution

When cloning this codebase, clone the submodules using
`git clone --recursive https://github.com/oxigraph/oxigraph.git` to clone the repository including submodules or
`git submodule update --init` to add the submodules to the already cloned repository.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in Oxigraph by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.


## Sponsors

* [Zazuko](https://zazuko.com/), a knowledge graph consulting company.
* [RelationLabs](https://relationlabs.ai/) that is building [Relation-Graph](https://github.com/relationlabs/Relation-Graph), a SPARQL database module for the [Substrate blockchain platform](https://substrate.io/) based on Oxigraph.
* [Field 33](https://field33.com) that was building [an ontology management platform](https://plow.pm/).
* [Magnus Bakken](https://github.com/magbak) who is building [Data Treehouse](https://www.data-treehouse.com/), a time-series + RDF datalake platform, and [chrontext](https://github.com/magbak/chrontext), a SPARQL query endpoint on top of joint RDF and time series databases.
* [DeciSym.AI](https://www.decisym.ai/) a cybersecurity consulting company providing RDF-based software.
* [ACE IoT Solutions](https://aceiotsolutions.com/), a building IOT platform.
* [Albin Larsson](https://byabbe.se/) who is building [GovDirectory](https://www.govdirectory.org/), a directory of public agencies based on Wikidata.

And [others](https://github.com/sponsors/Tpt). Many thanks to them!
