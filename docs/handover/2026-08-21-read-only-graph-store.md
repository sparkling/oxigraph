# Handover: read-only Graph Store repair and H&M installation

- Status: confirmed defect; repair not started
- Date: 2026-08-21
- Source repository: `/Users/henrik/source/oxigraph`
- Requested installation target: `/Users/henrik/source/hm/oxigraph`
- Governing decision: [ADR-0014](../adr/0014-rdf-dataset-graph-topology.md)

## Executive summary

The `sparkling/oxigraph` checkout correctly serves SPARQL queries from a store
opened with `serve-read-only`, but Graph Store Protocol `GET` and `HEAD` return
HTTP 500. This is a bug, not the intended read-only policy. Mutating Graph Store
and SPARQL Update operations correctly return HTTP 403 and must continue to do
so after the repair.

The Product Mock golden candidate is loaded and queryable in a temporary local
store. Its exact 47,011-triple graph passed the semantic sentinels below. The
current listener and data directory are validation assets, not a durable H&M
installation.

No source repair, ADR amendment, installation worktree, durable data directory,
remote deployment, or Hetzner service change has been made yet.

## Pinned source state

| Item | Value |
|---|---|
| Repository | `sparkling/oxigraph` |
| Checkout | `/Users/henrik/source/oxigraph` |
| Branch | `main` |
| Commit | `b6e8f65c98e32a6af6d04530d3aa0694bec8e236` |
| Tree | `294259c469ea07910ab9b35b29f63f38528adcdb` |
| Debug binary SHA-256 | `28620c9bc5fd8d6c8454e69daac391aca4d53906fd8438986bb2df27b10bfde9` |
| CLI version | `oxigraph 0.6.0-dev` |
| Requested H&M checkout | `/Users/henrik/source/hm/oxigraph` (absent at handover) |

The primary checkout has unrelated, pre-existing untracked agent and tooling
files. Preserve them. Stage and commit only files belonging to this repair.

## Confirmed defect

The following process is running at handover:

```text
PID       27687
Mode      serve-read-only
Bind      127.0.0.1:17878
Store     /tmp/semantic-query-oxigraph-validation.uV8xSl
```

Observed on 2026-08-21 against the golden named graph:

| Request | Expected | Actual |
|---|---:|---:|
| SPARQL `SELECT` through `/query` | 200 | 200; count `47011` |
| SPARQL RDF 1.2 `CONSTRUCT` through `/query` | 200 | 200 |
| Graph Store `GET` | 200 | 500 |
| Graph Store `HEAD` | 200 | 500 |
| SPARQL Update | 403 | 403 |
| Graph Store `PUT` | 403 | 403 |
| Graph Store `POST` | 403 | 403 |
| Graph Store `DELETE` | 403 | 403 |

The Graph Store `GET` response body is:

```text
Transaction are only possible on read-write instances
```

### Cause

[The Graph Store read path](../../cli/src/graph_store.rs) routes `GET` and
`HEAD` to `get()`, which calls `Store::start_transaction()` before reading graph
state and computing the representation ETag. That operation reaches the
RocksDB readable-transaction implementation, which rejects stores opened
read-only. The HTTP layer converts the storage error into HTTP 500.

This conflicts with the route policy: only `PUT`, `POST`, and `DELETE` are
guarded by the server's read-only mutation check. `GET` and `HEAD` are intended
to remain available.

## Living ADR drift

[ADR-0014](../adr/0014-rdf-dataset-graph-topology.md) is **Accepted**, dated
2026-07-27, and marked implemented. Its Graph Store decision explicitly says
that `GET` and `HEAD` return successful representations for existing graphs,
including empty named graphs. The running `serve-read-only` behavior violates
that accepted contract.

The repair must update ADR-0014 in the same coherent change:

- add `Updated: 2026-08-21`;
- retain its Accepted status;
- record that disk-backed `Store::open_read_only` Graph Store GET/HEAD is now
  covered by focused regression evidence.

## Golden candidate in the validation store

The authorized sealed candidate was retrieved read-only from Hetzner and
verified locally. No Semantic Builder worktree was modified or otherwise
entered beyond the exact authorized review artifacts.

| Item | Value |
|---|---|
| Candidate | `candidate:semantic-product-mock:all-14:v0.1.0` |
| Source revision | `7c45292fccb8b88afe263e18de6806667ae18573` |
| Candidate manifest SHA-256 | `2f950bb55dd110d9f82b012f124708747e6472f3304ab50c4f2ea28155a8e60e` |
| Validation receipt SHA-256 | `94c6ff69cb00154a00c2f89abd9697ec32a5ae602c07c7ec42b04f97cbb005c6` |
| Evidence coverage SHA-256 | `fb72cbd1f23e084855e61973cc660cceb3263e9c034e8684e08f1e09ee5d8fca` |
| Verified Turtle shards | `115/115` |
| Named graph | `urn:hm:graph:semantic-product-mock:gold-candidate-v0.1.0` |
| Named graphs in store | `1` |
| Named-graph triples | `47011` |
| Default-graph triples | `0` |
| RML TriplesMaps | `134` |
| R2RML predicate-object mappings | `492` |
| SHACL target shapes | `134` |
| SHACL property links | `492` |
| RDF 1.2 reifications | `14` |

The sealed artifact staging directory is currently
`/tmp/semantic-product-mock-gold-candidate-v010.JUxU4E`. Both that directory
and the validation database are under `/tmp` and must not be treated as durable
custody.

## Required repair

### 1. Add the failing regression first

The test must create a real disk-backed writable store, add both a populated
and an empty named graph, close the writer, and reopen the same database with
`Store::open_read_only`. It must exercise the actual Graph Store HTTP handler
in read-only server mode.

At minimum, assert:

- named-graph `GET` returns 200, the expected RDF, and an ETag;
- named-graph `HEAD` returns 200 with the same ETag and no body;
- an existing empty named graph returns 200;
- a missing named graph returns 404;
- selector-less dataset `GET` succeeds in a topology-preserving format;
- all mutation routes remain 403;
- graph and dataset content remain unchanged.

An in-memory writable `Store::new()` passed to the handler with only the
`read_only` Boolean set does not reproduce this defect and is not an adequate
regression oracle.

### 2. Repair read state acquisition

Make Graph Store `GET`/`HEAD` acquire a coherent snapshot that works for
`Store::open_read_only`. Preserve the existing transactional snapshot semantics
for writable stores and the graph-topology guarantees in ADR-0014. Do not work
around the error by opening the production read-only database read-write.

The repair must preserve:

- empty named-graph existence;
- dataset named-graph topology;
- stable representation-specific ETags;
- conditional GET/HEAD behavior;
- RDF 1.1, RDF 1.2 Basic, and full RDF 1.2 representation negotiation;
- HTTP 403 for every mutation route in read-only mode.

### 3. Update the living decision

Update ADR-0014 as described above and review the final diff against its
Decision, Consequences, and Acceptance boundary. Do not broaden the change into
a general Graph Store conformance claim.

## Qualification gates

Run the narrow regression red before implementation and green afterward, then
run at least:

```bash
cargo test --locked --package oxigraph-cli --bin oxigraph graph_store \
  -- --nocapture --test-threads=1

cargo test --locked --package oxigraph-cli read_only \
  -- --nocapture --test-threads=1

cargo test --locked --package oxigraph-cli --bin oxigraph protocol_wire \
  -- --nocapture --test-threads=1

cargo test --locked --package oxttl --features rdf-12 --test version_directive

cargo build --locked --release --package oxigraph-cli --bin oxigraph
```

Do not accept a filtered test command that reports zero executed tests.

The installed runtime gate is:

1. `GET`, `HEAD`, and conditional GET return the expected 200/304 responses and
   a stable ETag for the golden graph.
2. SPARQL reports exactly 47,011 triples and the semantic sentinels above.
3. Update, PUT, POST, and DELETE return 403.
4. The post-rejection graph count remains 47,011.
5. The listener remains bound only to `127.0.0.1`.

## H&M installation handoff

After the source commit passes qualification:

1. Create a clean checkout or worktree at
   `/Users/henrik/source/hm/oxigraph` at the verified repair commit. Do not move
   or absorb the existing checkout's unrelated untracked files.
2. Build the release binary from that H&M checkout with `--locked`.
3. Select and document a durable store directory under the H&M project tree.
   No durable local convention existed at handover, so do not silently treat a
   `/tmp` path as the installed store.
4. Recreate the golden store from the 115 checksum-verified source documents,
   using explicit RDF 1.2 parsing and an all-or-nothing load boundary.
5. Stop only the owned validation listener on `127.0.0.1:17878`; do not stop or
   probe unrelated servers or ports.
6. Start the release binary with `serve-read-only` against the durable store and
   run the installed runtime gate above.

## Security boundary

- Keep Oxigraph loopback-only. Do not bind the raw RDF API publicly or through
  Tailscale.
- `SparqlEvaluator::new()` retains the default HTTP `SERVICE` handler. Raw
  caller-controlled SPARQL can therefore initiate outbound requests. The
  semantic-query application must be the sole caller and use fixed,
  server-owned query templates with validated values.
- Do not enable CORS or `--union-default-graph` for this installation.
- Do not weaken read-only mutation rejection while repairing GET/HEAD.
- Before any broader deployment, disable arbitrary SPARQL `SERVICE` HTTP in the
  fork and add a regression proving that it cannot connect.

## Explicit non-goals

- No Hetzner deployment or service change.
- No Semantic Builder implementation or worktree changes.
- No Jena or Fuseki substitution.
- No semantic-query or Semantic Fabric integration in this repair slice.
- No public/raw SPARQL service exposure.

## Completion evidence expected in the next handover

- repair commit and exact tree;
- release binary SHA-256;
- focused and full test counts with zero failures;
- ADR-0014 update;
- installed checkout and durable store paths;
- golden graph count and semantic sentinel receipt;
- GET/HEAD/ETag and mutation-rejection HTTP receipt;
- confirmation that only the owned listener was replaced;
- clean scoped diff with unrelated files preserved.
