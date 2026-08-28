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

The current upstream synchronization checkpoint is merge commit
`e9d2db1b7c4eb974b406136e667e09ba06e34b48` (tree
`fcc5bb75c469fbbf80f77bc330279d3a7c593bfe`), whose ordered parents are fork
checkpoint `b295ea80...` and upstream `ec68e3dd...`. It adopts upstream's
atomic Graph Store `PUT` regression, quick-xml 0.42, and Python 3.9/abi3-py39
support changes while retaining the fork's stricter XML validation and QA
lanes. ADR-0014 deliberately keeps `POST` to a selected missing named graph at
`404 Not Found`; selector-less `POST` creation remains supported.

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
  semantics, atomic update behavior, runtime-derived capability-qualified
  service-description disclosure, and protocol/Graph Store validation.
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
claim cancellation after transaction start. Recovery analysis made the
remaining ADR-0018 product boundary explicit as G1.4a. Product commit
`2f518e04` now implements the built-in `Store` keyed path: memory provides a
process-local outcome oracle without claiming durability, while read-write
RocksDB reserves a stable transaction key, records exactly one synchronously
written `CommitAttempted` transition, atomically publishes RDF changes with the
`Committed` marker, and supports terminal lookup without replay. The accepted
tests separately cover lookup after an orderly read-only reopen and
lost-acknowledgement recovery after a post-commit process abort through a
read-write reopen; they do not yet prove the combined read-only-after-abort
path. The frozen seven-stage verifier accepted exact patch `3a196063...` as
candidate tree `390bb43a...` for public/service/compatibility/independent/
regression counts 7/9/20/3/2. This closes G1.4a, not G1.7 or promotion.
G1.4b closes the evaluator-separated simulated storage-call fault slice in
product commit `590a3229`. Frozen preflight contract
`926724ae8c8d206b4a4de576eb0120fc21c75aa96c99fb4f38664a2bdf3b44c8`
confirmed the exact six-pass/two-fail red signature. The native application
harness then selected patch
`02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314`,
returned `ACCEPT`, and admitted eight outcomes in receipt
`d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`;
exact replay returned the same candidate commit/tree and verdict. The fix
records the local `CommitAttempted` phase before the durable marker call, so a
pre- or post-write error cannot let drop falsely append `RolledBack`. Direct
post-application evidence is 8/8 fault cases, 7/7 outcome cases, and 20/20
compatibility cases. This is branch/state-machine evidence for injected
storage-call errors, not crash, power-loss, or fsync durability proof.
G1.5's unified egress profile is
implemented in `e452bad1` plus lifecycle hardening `3f4cdfd7` and accepted by
its frozen 12/8/13 evaluator split. Built-in `SERVICE`, `LOAD`, and nested
document retrieval now share a deny-by-default policy with typed failures,
separate encoded/decoded byte bounds, time and connection budgets, and remote
read cancellation. G1.5b is implemented in `280872dc` plus review hardening
`9b84bed6` and accepted by its frozen 6/6/12 evaluator split. One cancellation
token now covers validation, built-in RocksDB writer admission, local mutation,
and the final pre-commit checkpoint; owned transactions roll back before a
typed cancellation is returned. G1.5c is implemented in `3afe1e78` and
accepted by its frozen 5/15/21 evaluator split: the additive negotiated
binding carries the caller's exact transaction request and cancellation token
through custom-backend and `Store` admission without changing the minimal
transaction traits. A caller-owned transaction remains the caller's rollback
responsibility. G1.6 is implemented by exact product commit
`96d0ae7b177026506f4c8bfc74cf2eb88e71abc4` and integrated by
`baeabb067c8c8419973842e5e060adf832e3f738`. Its source-bound seven-stage
verifier returned `ACCEPT` for format/build/public-4/service-17/
compatibility-1/independent-1/regression-12, with artifact SHA-256
`4ff0fdafa3b8584f81033a89000814320a952bbc384523cd72dd57150963458b`.
Three product controls were rejected as required: the earlier product
(`96dc288bc70f5d5dfb62ce02d5954330534ac7921da17e912d74af4b6a200740`),
union-only disclosure
(`393b8c7239986a654e80f5213b653ea5c494fec4878b7fd79ced9a9c39321046`),
and CLI-TLS-gated server disclosure
(`3635ef690d75d10d8d5b4d7b316b7c6d487d7f6e9a8b47055a0c86630e387f5d`).
The disclosed profile is a deterministic configured-and-compiled capability
snapshot, not a remote-health or current-admission probe. ADR-0019 is therefore
Implemented. ADR-0018 remains Proposed because, although G1.4a and G1.4b have
now closed the built-in `Store` terminal-outcome/durable-lookup and simulated
storage-call phase-fault boundaries, the G1.7 compatibility, performance,
current-evidence, and separate human-promotion gates remain open.
The verifier artifacts are local-only evidence and grant no
semantic-qualification or promotion authority.

Engineering-harness commit
`4a15caa07df37d884e7c74d4b69c0505ce3de6e1` centralizes those seven G1 task
profiles in one ordered fail-closed registry and derives the exact 27-command
CLI surface from it. Generic contract, preflight, run, and replay entrypoints
accept registered task IDs only; direct contract-path selection and malformed
or unregistered identities fail before runtime I/O. The committed control
passes 180/180 harness tests and a `runner-implemented` doctor while remaining
local-only, unregistered as MCP, and without promotion authority.
Follow-up commits `13352ff9` and `c2497225` register and evaluator-separate
G1.4a. Commits `1362f250`, `3bb4f0fb`, and `695def8d` add and bind the corrected
G1.4b evaluator without rewriting either historical registry checkpoint. The
current fail-closed registry therefore contains nine tasks and 33 commands.
After G2.1, the full package suite contains 667 tests: 663 pass, one fails, and
three intentional host-gated tests are skipped. The sole failure is the
deliberate sealed-subject freshness gate detecting the newly committed G2.1
product paths; it is not a helper/request regression or current-HEAD
qualification. The doctor retains the same native-only, local-only,
non-promoting boundary.

Follow-on harness commit
`afe30c7de7e3df6e72a0a855d83efc612339f261` closes the separate
candidate-rejection evidence control. Application receipt v6 now hash-binds
each reconstruction or applicability failure to one exact candidate execution,
successful implementation/repair invocation, patch digest, typed phase/code,
and bounded-detail digest. Every successful patch-producing invocation is
accounted for by either one verifier attempt or one rejection record; failed
lanes remain distinct even when their patch bytes match. This pre-verifier
evidence is non-trainable, v1-v5 receipts remain byte-exact replay-only, and a
candidate-disposal failure aborts receipt minting. The committed control passes
194/194 harness tests and the same `runner-implemented`, local-only doctor.

The dedicated G1.7 qualification path is now fail-closed at qualification
contract v7, SHA-256
`42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80`.
Commits `8ca3804b` and `0257587e` implement and harden the two-phase protocol;
commits `20477225` and `799307fb` freeze its exact control statistics and
version the statistical protocol as v6. Commit `d1e18c6e` then archives those
exact v6 bytes and reseals the merged product as current v7. Contracts v5 and
v6 and their proposed authorization/final artifacts remain exact replay-only
fixtures rather than current authority.
Pure commits `d3af2e17` and `45121da9` now replay four isolated builds, two
serialized control sessions, and 392 exact launch records into deterministic
Darwin statistics and a bounded canonical control-receipt candidate. Exact
authorization bytes are hashed internally, and PASS, FAIL, and INCONCLUSIVE
fixtures are covered. This layer is deliberately `CANDIDATE_REPLAYED`: it
returns `binding: null`, `finalDecisionEligible: false`, and no execution,
Router-quality, promotion, or publication authority. Commit `fbbb692b` adds the
separate physical owner for exact three-file archives: exclusive no-follow
creation, 0400 files, a 0500 directory, receipt-last owner sequencing, ordered
file/directory sync calls, held-FD filesystem/device checks, exact bounded
readback, and post-seal replay. Sealing still returns no binding. Only a
physically replayed PASS can yield a prospective final-decision binding, and
every authority flag remains false. This proves current archive state and the
observed owner sequence, not historical receipt-last order from replay, crash or
power-loss durability, filesystem flush durability, or same-UID tamper
resistance.
Commit `f04b9bc7` adds the dormant authority-free non-tmpfs containment owner:
it freezes the global lock locator, held ancestry, distinct controller/holder/
worker/contender identities, cgroup-v2 limits and quiescence, and bounded
cleanup, but the proposed authorization fails before mechanics and no native
syscall adapter exists. Commit `a457f46c` adds the exact four-build execution
plan and descriptor-anchored product-source workspace. It globally admits the
root and required-submodule object closure before private Git writes, preserves
every handle on unreaped Git, and deliberately leaves production build
begin/finish unavailable until a supervising owner can supply non-forgeable
child-close/reap proof. Commit `c5687dac` adds pure build-process and four-
product evidence replay over the frozen Cargo request/environment, complete
held source/tool/output ancestry, raw streams, executable bytes, and ELF
identity. Those projections remain binding-null, final-decision-ineligible,
and authority-free; they are capture replay, not physical build execution.
Commit `3688ccda` adds a stricter second replay-only build-owner schema, but
deliberately does not treat caller-labelled capture or outcome records as
physical provenance. Commits `008ab939` and `da41d7e0` freeze the non-tmpfs
isolation policy and its exact descriptor-relative mount-namespace mapping:
held source FD 4 and target FD 5 must both be beneath workspace parent FD 3,
mapping read-only `/workspace/source` and writable `/state/target`. No native
adapter executes that policy. Commits `5d054857`, `a9f9afc2`, `f482bec0`, and `3b289522`
retain unsafe containment failures and place every destructive cleanup helper,
lease release, and owner close under one bounded terminal sequence. Commit
`c5050e9c` adds an authority-free POSIX raw-byte process supervisor with one shared
output ceiling, bounded argv, typed first-terminal reason, process-group
TERM/KILL escalation, separate close/EOF/reap truth, and retained unreaped
handles. It is a low-level prerequisite, not a physical build issuer. The
co-located physical issuer and native containment adapter remain unimplemented.
Commit `13afa94d` freezes canonical execution-request v1 bytes over the exact
authorization, plan, policy, source, toolchain, ownership, and full Cargo argv
identity. Commit `3f8951e3` hardens its byte and identifier inputs against
accessor, proxy, and prototype substitution. Because request v1 permanently
binds isolation policy v1, it is explicitly ineligible for physical launch and
cannot later be reinterpreted as eligible. Commit `8b2c6366` adds replay-only
process-evidence v3 over that request, the acyclic request-to-containment hash
graph, raw Cargo JSONL and cgroup terminal observations, and the held target
ELF. It remains `SUCCESSOR_PRIVATE_ISSUER_REQUIRED`, with physical execution,
binding, and every authority flag false; request v1 and process v3 are
legacy-incompatible with the successor path. Policy v2 (`ef869cf4`, corrected
in `466d2d78`) and execution request v2
`75a076938ac6c4ecc72c295f56d09e5c0f8e8787` now freeze a structurally
compatible graph, but request v2 remains
`POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED`/`STRUCTURAL_POLICY_ONLY`, with
`physicalLaunchEligible: false`, `binding: null`, and every authority flag
false. Commit `c113a88f321ade44e7d913f5da87a8184ea56148` adds the exact-attested
dormant native `execveat` Cargo helper and bounded status protocol. Its tests
compile but never execute the helper; the attestation remains
`DORMANT_ATTESTATION_ONLY`, has no exact runtime request/argv/environment
binding, and creates neither a physical issuer nor live authority. A private
co-located issuer, containment-v2 native adapter, production
control/sample/qualification owners, and live evidence are still required.
The exact control-authorization artifact is
`31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767`;
the exact final-decision-set artifact is
`b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5`.
They remain `CONTROL_AUTH_PROPOSED` and `PROPOSED`/`UNAPPROVED`, respectively.
`g1.7:run` therefore exits 4 as `DIAGNOSTIC_ONLY`/`INCONCLUSIVE` before
identity, evidence, build, runtime-directory creation, or sampling and creates
no G1.7 run artifact. A final binding cannot authorize qualification until a
real control receipt has been produced through that physical owner, replayed,
and bound by the separately approved final decision. There are no
current production G1.7 samples, physically sealed control receipt, benchmark
results, sealed qualification receipt, qualification, or promotion decision.

The audited upstream merge `e9d2db1b...` is now the exact v7 product subject:
tree `fcc5bb75...`, `Cargo.lock` blob `763b2fed...`, and lock SHA-256
`587e4563...`. Its evaluator is already present as ancestor `3aca932e...`;
qualified identity v2 separates that immutable product from the later committed
harness/control commit and rejects product-path drift. Ruflo reseal task
`task-1787888366495-gzxbhe` is complete at this pure, non-executing boundary.
Current Ruflo task map
`task-plans/linked-data-store-g0-g4-2026-08-28-v15` records its historical
corrected G1.7 checkpoint at 60%. The current Ruflo G1.7 row is 73%: pure
receipt-candidate task `task-1787892615000-rdwz7q` is complete in
`45121da9`, and physical-envelope task `task-1787896401667-xookiy` is complete
in `fbbb692b` with all authority false. Workspace/build-owner task
`task-1787902127894-7n7vk3` is 92%, and containment task
`task-1787902138074-0w648x` is 89%; both remain in progress.
The archived v6 protocol/statistics bytes retain their exact historical identity
and grant no Phase-A, provider, control, sample, benchmark, qualification, or
promotion authority.

Contract v7 preserves v6's frozen canonical authorization-bound sample-set
bytes and their ordered SHA-256 identity, paired 10% log non-inferiority for the negative
control, two one-sided paired 5% A/A equivalence directions with one shared
per-case Darwin seed, an inclusive 5% MAD noise boundary, and mechanical
per-control and aggregate verdict precedence. The pure attributed replay is
differential-tested against the exact installed Darwin 0.9.3 modules. This is
a statistics contract, not a live measurement or receipt.

The owner and receipt-candidate contract tests prove pure verifier behavior
over synthetic fixtures. The separate physical tests prove exact archive
creation and replay over synthetic receipt fixtures; they do not prove a live
control owner emitted current evidence. Contract
v1/v3/v4/v5/v6 bytes replay through a Darwin-free pure boundary and remain
legacy-only, never qualification-eligible. The accepted G1.4b receipt
`d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`
is copied, hash-bound, and pure-replayed at the current prerequisite boundary.
Its exact compatibility projection and binding are `d57eb7cb...` and
`5a4f5721...`; the claim remains limited to simulated storage-call pre/post-write
faults, not crash, power-loss, or fsync durability. This prerequisite and the
candidate replay and physical archive capability do not substitute for a live
physically sealed control receipt or the execution owners.

The implemented approval protocol requires two explicit human phases. Phase A
may authorize only permanently non-promoting negative and independently built
A/A noise controls, whose complete raw owner receipt must be sealed and
replayed. Phase B may then bind that receipt, the exact G1.4b prerequisite, and
the observed signature into one atomic final reference/performance/noise
decision before subject/reference qualification. Human product promotion
remains a later, separate action. The physical control-envelope/sealed-archive
replay is implemented, but the live control and qualification execution owners
are still absent. The proposed files, pure candidate replay, and prospective
physical binding capability therefore grant no approval or execution authority.

Commit `be08cf3bbcb836ec46df2b864d31e80f5b837b52` implements G2.1's additive
transactional namespace registry across memory, RocksDB, and the test-only
rewritten persistence plane. Prefix validation follows exact `PN_PREFIX`
semantics, including empty/default and Unicode prefixes without normalization;
iteration uses raw UTF-8 order, duplicate IRIs are allowed, and RDF and
namespace clear remain independent. Namespace writes share transaction,
rollback, snapshot, and keyed-outcome boundaries with RDF writes, while parser,
SPARQL, and dump integration stays explicit. The default-feature evaluator
passes 13/13 across memory, RocksDB, and the rewritten plane; the no-default
evaluator passes 8/8 across memory and the rewritten plane. Focused regressions
pass `store` 26/26, `transaction_outcomes` 7/7, `transaction_state_model` 3/3, and
`transactional_dataset` 3/3. [ADR-0020](./docs/adr/0020-transactional-metadata-receipts-and-change-delivery.md)
remains Proposed because G2.2-G2.3c are not implemented.

[ADR-0034](./docs/adr/0034-first-class-exact-new-file-admission.md) separately
gates G2.2's candidate-created semantic-change module. Commits `78b2cf99`
through `65fb0e7a` preserve schema-v1 evidence while adding the exact v2
path/tree/contract/reconstruction/context/schema/assembly controls. Commit
`54a056e0` adds a reviewed but unregistered exact-byte native worker with
retained-descriptor provider/schema/Git verification and original-process-
group cleanup. Commit `11e72201` adds the still-unregistered opaque candidate
lifecycle, exact submodule materialization, structural sandbox protocol,
one-shot verifier/disposal, typed classification, and strict cleanup quarantine;
the related non-G1.7 matrix passes 128/128. Production remains fixed
unavailable until the cgroup owner and retained-FD executable-closure proof
exist. Application receipt v7/replay, evaluator/profile/CLI registration, the
complete ADR-0034 gate, and G2.2 remain open, so no new product module or
promotion authority is admitted by this checkpoint.

Rust consumers enable the corresponding bounded surfaces explicitly:

```toml
oxigraph = { version = "*", features = ["rdf-12", "datalog", "rdfs", "owl2-rl", "shacl"] }
```

The last sealed reviewed executable evidence includes 575/575 pinned RDF 1.2
official cases, 269/269 SPARQL 1.2 cases, 86/86 RDF Dataset Canonicalization
cases, 519/519 eligible SHACL cases, 98/98 OWL 2 RL/RDF assertions, and a
76-scenario/198-assertion Jena differential. These counts are evidence for the
named pinned suites and profiles only. They are not a substitute for every
normative clause in a W3C document family. G0.1-G0.5 previously closed their
scoped source-registration, Jena runner/profile, and Agentic-QE inventory work:
`46ef17fc` restores the locked Jena runner, `22a8033e` binds two byte-identical
76-scenario/198-assertion runs to that reviewed subject, and `253a2b34` binds
the exact 144/144 default, 129/129 no-default, and 45/45
`persistence-write` inventories. The adapter contract now passes 40/40 under
schema v5. At committed tracked-source subject `5a93890f`, immutable adapter
run `5e6202d7-e020-4af9-ae0d-1d4c8704a28e` (40/40), `persistence-write` run
`73b6a484-f830-49d2-b4cc-de1549928613` (45/45), and G1 regression run
`34602f2a-7332-4649-aef0-d51029389cfb` (66/66) were independently reopened
against freshly acquired runtime, dependency, implementation, publication,
oracle, and archive evidence. Their broad dirty flag records only the protected
untracked Ruflo/runtime paths; tracked source was clean. These are scoped
receipts, not the unrun 47-command aggregate Agentic receipt.
G0.6 has now regenerated immutable OxDatalog run
`731e6467-2cab-4260-8d15-b34e4ebc8ed6` with 358 generated, 278 caught,
80 unviable, zero missed, and zero timed out under `cargo-mutants` 27.1.0.
G0.7's earlier reconciliation remains historical after the schema-v5 contract
change and these protected-document edits; root `README.md` remains part of the
MetaHarness protected snapshot. Full MetaHarness semantic qualification, its
independent verification, and the separate G1.7 compatibility/performance
promotion gate remain open. At the current v7 control checkpoint, the pinned
product subject is `e9d2db1b` and execution remains `INCONCLUSIVE`: the merged
subject is pure-resealed, but control authorization and the final decision set are still
proposed/unapproved, all semantic, compatibility, and benchmark stages are
`NOT_RUN`, and `run` exits 4 before identity or tracked-tree inspection. Pure
candidate replay is complete in `45121da9` but remains
`finalDecisionEligible: false` with `binding: null`. Physical sealed-envelope
replay is complete in `fbbb692b`, but no current control archive exists and the
production execution owners are absent. The umbrella claim is still withheld.

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
- [The linked-data-store ADR programme](./docs/adr/README.md)
  splits transaction guarantees, egress/cancellation, durable commits,
  transaction-time SHACL, operations/recovery, statistics/planning, derived
  indexes, explicit federation, service identity, workload governance, safe
  upgrades, RDF4J REST interoperability, remote transactions,
  multi-repository lifecycle, incremental entailment, and analytical/WCOJ
  research into ADR-0018 and ADR-0020 through ADR-0034; ADR-0019 records the
  implemented egress, cancellation, and service-claim slice. Sixteen decisions
  remain Proposed living plans. ADR-0020 includes implemented G2.1 namespace
  support but remains Proposed until G2.2-G2.3c are complete; ADR-0034's 85%
  in-progress harness controls remain unregistered until their full v2
  acceptance gate closes.

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

- [`oxrdf`](./lib/oxrdf), datastructures encoding RDF basic concepts (the [`oxigraph::model`](crate::model) module).
- [`oxrdfio`](./lib/oxrdfio), a unified parser and serializer API for RDF formats (the [`oxigraph::io`](crate::io) module). It itself relies on:
  - [`oxttl`](./lib/oxttl), N-Triple, N-Quad, Turtle, TriG and N3 parsing and serialization.
  - [`oxrdfxml`](./lib/oxrdfxml), RDF/XML parsing and serialization.
  - [`oxjsonld`](./lib/oxjsonld), JSON-LD RDF serialization/deserialization algorithms.
- [`spareval`](./lib/spareval), a SPARQL evaluator.
- [`spargebra`](./lib/spargebra), a SPARQL parser.
- [`sparesults`](./lib/sparesults), parsers and serializers for SPARQL result formats.
- [`sparopt`](./lib/sparopt), a SPARQL optimizer.
- [`oxsdatatypes`](./lib/oxsdatatypes), an implementation of some XML Schema datatypes.
- [`spargeo`](./lib/spargeo), a partial implementation of [GeoSPARQL](https://docs.ogc.org/is/22-047r1/22-047r1.html).

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

- [Zazuko](https://zazuko.com/), a knowledge graph consulting company.
- [RelationLabs](https://relationlabs.ai/) that is building [Relation-Graph](https://github.com/relationlabs/Relation-Graph), a SPARQL database module for the [Substrate blockchain platform](https://substrate.io/) based on Oxigraph.
- [Field 33](https://field33.com) that was building [an ontology management platform](https://plow.pm/).
- [Magnus Bakken](https://github.com/magbak) who is building [Data Treehouse](https://www.data-treehouse.com/), a time-series + RDF datalake platform, and [chrontext](https://github.com/magbak/chrontext), a SPARQL query endpoint on top of joint RDF and time series databases.
- [DeciSym.AI](https://www.decisym.ai/) a cybersecurity consulting company providing RDF-based software.
- [ACE IoT Solutions](https://aceiotsolutions.com/), a building IOT platform.
- [Albin Larsson](https://byabbe.se/) who is building [GovDirectory](https://www.govdirectory.org/), a directory of public agencies based on Wikidata.

And [others](https://github.com/sponsors/Tpt). Many thanks to them!
