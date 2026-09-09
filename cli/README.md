Oxigraph CLI
============

[![Latest Version](https://img.shields.io/crates/v/oxigraph-cli.svg)](https://crates.io/crates/oxigraph-cli)
[![Crates.io downloads](https://img.shields.io/crates/d/oxigraph-cli)](https://crates.io/crates/oxigraph-cli)
[![Conda](https://img.shields.io/conda/vn/conda-forge/oxigraph-server)](https://anaconda.org/conda-forge/oxigraph-server)
[![actions status](https://github.com/oxigraph/oxigraph/workflows/build/badge.svg)](https://github.com/oxigraph/oxigraph/actions)
[![Gitter](https://badges.gitter.im/oxigraph/community.svg)](https://gitter.im/oxigraph/community)

Oxigraph CLI is a graph database implementing the [SPARQL](https://www.w3.org/TR/sparql11-overview/) standard.
It is packaged as a command-line tool allowing to manipulate RDF files, query them using SPARQL...
It also allows spawning an HTTP server on top of the database.

Oxigraph is in heavy development, and SPARQL query evaluation has not been optimized yet.

Oxigraph provides different installation methods for Oxigraph CLI:
* [`cargo install`](#installation) (multiplatform)
* [A Docker image](#using-a-docker-image)
* [A Pypi package](https://pypi.org/project/oxigraph): with [UV](https://docs.astral.sh/uv/) just run `uvx oxigraph`
* [A conda-forge package](https://anaconda.org/conda-forge/oxigraph-server)
* [Pre-built binaries](https://github.com/oxigraph/oxigraph/releases/latest)

It is also usable as [a Rust library](https://crates.io/crates/oxigraph) and as [a Python library](https://pyoxigraph.readthedocs.io/).

Oxigraph implements the following specifications:
* [SPARQL 1.1 Query](https://www.w3.org/TR/sparql11-query/), [SPARQL 1.1 Update](https://www.w3.org/TR/sparql11-update/), and [SPARQL 1.1 Federated Query](https://www.w3.org/TR/sparql11-federated-query/).
* [Turtle](https://www.w3.org/TR/turtle/), [TriG](https://www.w3.org/TR/trig/), [N-Triples](https://www.w3.org/TR/n-triples/), [N-Quads](https://www.w3.org/TR/n-quads/), and [RDF/XML](https://www.w3.org/TR/rdf-syntax-grammar/) RDF serialization formats for both data ingestion and retrieval.
* [SPARQL Query Results XML Format](https://www.w3.org/TR/rdf-sparql-XMLres/), [SPARQL 1.1 Query Results JSON Format](https://www.w3.org/TR/sparql11-results-json/) and [SPARQL 1.1 Query Results CSV and TSV Formats](https://www.w3.org/TR/sparql11-results-csv-tsv/).
* [SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/#query-operation) and [SPARQL 1.1 Graph Store HTTP Protocol](https://www.w3.org/TR/sparql11-http-rdf-update/).

A preliminary benchmark [is provided](../bench/README.md).

Note that Oxigraph CLI was previously named Oxigraph Server before version 0.4. Older versions are available under [this name](https://crates.io/crates/oxigraph_server).

[![Packaging status](https://repology.org/badge/vertical-allrepos/oxigraph.svg)](https://repology.org/project/oxigraph/versions)

## Installation

You need to have [a recent stable version of Rust and Cargo installed](https://www.rust-lang.org/tools/install) as well as Clang for the RocksDB Rust bindings.

The published crates.io, PyPI, Docker, and conda packages listed above are
upstream distributions; they do not establish availability of this fork's
extensions. To build the fork, including its reviewed submodules:

```sh
git clone --recursive --branch main https://github.com/sparkling/oxigraph.git
cd oxigraph
cargo build --locked --release -p oxigraph-cli --bin oxigraph
./target/release/oxigraph --version
./target/release/oxigraph serve --location ./data --bind 127.0.0.1:7878
```

The executable is `target/release/oxigraph`. Native TLS builds also need the
platform's OpenSSL development package when it is not otherwise available.
See the [R1 application validation](../docs/research/r1-application-validation-2026-09-07.md)
for the tested binary, persistent write/query/restart journey, and scope.
For an upstream release instead, use `cargo install oxigraph-cli` without
cloning this fork.

Some build options (cargo features) are available:
- `rocksdb-pkg-config`: links against an already compiled rocksdb shared library found using [pkg-config](https://crates.io/crates/pkg-config).
- `native-tls`: Enables Oxigraph HTTP client for query federation using the host OS TLS stack (enabled by default).
- `rustls-native` Enables Oxigraph HTTP client for query federation using [Rustls](https://crates.io/crates/rustls) and the native certificates.
- `rustls-webpki` Enables Oxigraph HTTP client for query federation using [Rustls](https://crates.io/crates/rustls) and the [Common CA Database](https://www.ccadb.org/) certificates.


## Usage

Run `oxigraph serve --location my_data_storage_directory` to start the server where `my_data_storage_directory` is the directory where you want Oxigraph data to be stored. It listens by default on `localhost:7878`.

The default `simple` entailment mode, in both `query` and the server, reads a
native repeatable snapshot without first copying the whole store. Explicit
finite entailment profiles still materialize their effective query dataset.
Simple queries preserve `FROM`, protocol graph selection, empty named graphs
and the named-graph-only `--union-default-graph` contract. Reads and their errors
are lazy, so querying is not a whole-store integrity check; failures encountered
after HTTP headers are sent use the existing streaming-error behavior.

The server provides an HTML UI, based on [YASGUI](https://yasgui.triply.cc), with a form to execute SPARQL requests.

It provides the following REST actions:
* `/query` allows evaluating SPARQL queries against the server repository following the [SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/#query-operation).
  For example:
  ```bash
  curl -X POST -H 'Content-Type:application/sparql-query' \
    --data 'SELECT * WHERE { ?s ?p ?o } LIMIT 10' http://localhost:7878/query
  ```
  This action supports content negotiation and could return [Turtle](https://www.w3.org/TR/turtle/), [N-Triples](https://www.w3.org/TR/n-triples/), [RDF/XML](https://www.w3.org/TR/rdf-syntax-grammar/), [SPARQL Query Results XML Format](https://www.w3.org/TR/rdf-sparql-XMLres/) and [SPARQL Query Results JSON Format](https://www.w3.org/TR/sparql11-results-json/).
* `/update` allows to execute SPARQL updates against the server repository following the [SPARQL 1.1 Protocol](https://www.w3.org/TR/sparql11-protocol/#update-operation).
  For example:
  ```sh
  curl -X POST -H 'Content-Type: application/sparql-update' \
    --data 'DELETE WHERE { <http://example.com/s> ?p ?o }' http://localhost:7878/update
  ```
* `/sparql` allows both SPARQL queries and update (see it as the union of `/query` and `/update`).
* `/store` allows to retrieve and change the server content using the [SPARQL 1.1 Graph Store HTTP Protocol](https://www.w3.org/TR/sparql11-http-rdf-update/).
  For example:
  ```sh
  curl -f -X POST -H 'Content-Type:application/n-triples' \
    -T MY_FILE.nt "http://localhost:7878/store?graph=http://example.com/g"
  ```
  will add the N-Triples file `MY_FILE.nt` to the server dataset inside of the `http://example.com/g` named graph.
  [Turtle](https://www.w3.org/TR/turtle/), [N-Triples](https://www.w3.org/TR/n-triples/) and [RDF/XML](https://www.w3.org/TR/rdf-syntax-grammar/) are supported.
  It is also possible to `POST`, `PUT` and `GET` the complete RDF dataset on the server using RDF dataset formats ([TriG](https://www.w3.org/TR/trig/) and [N-Quads](https://www.w3.org/TR/n-quads/)) against the `/store` endpoint.
  For example:
  ```sh
  curl -f -X POST -H 'Content-Type:application/n-quads' \
    -T MY_FILE.nq http://localhost:7878/store
  ```
  will add the N-Quads file `MY_FILE.nq` to the server dataset.

Use `oxigraph --help` to see the possible options when starting the server.

### Anonymous listener boundary (fork)

Without `--access-policy`, `serve` and `serve-read-only` use anonymous access for trusted local use.
Every resolved bind address must be loopback unless the operator explicitly
passes `--unsafe-allow-remote-anonymous`. Wildcard addresses (`0.0.0.0`, `::`)
and mixed loopback/non-loopback DNS answers require that option too. The server
resolves once and binds only the exact validated addresses; rejection happens
before opening or creating the store or either listener. IPv4-mapped IPv6
addresses are conservatively treated as non-loopback; use `127.0.0.1` or `::1`.

The unsafe option emits a warning and does **not** add authentication,
authorization, or trusted-proxy identity. Read-only mode and CORS are not access
control. Do not expose anonymous data or the separate operator listener to
untrusted clients. The authenticated profile below is separate from this unsafe option.

### Trusted-proxy access policy (fork)

Both serving modes accept `--access-policy <PATH>`. Start with the
[validated local example](examples/access-policy.json):

```sh
./target/release/oxigraph serve --location ./data --bind 127.0.0.1:7878 \
  --admin-bind 127.0.0.1:9797 --access-policy cli/examples/access-policy.json
```

The file is validated **before opening storage**. A valid proxy profile permits
non-loopback listening and conflicts with `--unsafe-allow-remote-anonymous`.
The backend has no TLS termination. Isolate it so only the configured proxy
peers can connect; a trusted loopback peer trusts **all local processes**.
The proxy must authenticate clients, remove every client-supplied
`Oxigraph-Identity` header, and insert exactly one fresh assertion. Simply
passing through a client's header is not authentication. Do not deploy the
local example unchanged on an untrusted machine or network.

The header is a single JSON object (not a bearer token or JWT):

```text
Oxigraph-Identity: {"scheme":"oxigraph-proxy-v1","subject":"reader","issuer":"local-edge","audience":"oxigraph-local","proxy_version":1,"issued_at":1000,"expires_at":1060}
```

These sample timestamps are deliberately expired; the trusted proxy supplies
current Unix seconds. The immediate **socket** peer, issuer, audience, and
proxy version must match the file. Expiry must be strictly later than now,
issuance no later than now plus configured skew, and lifetime within the
configured maximum. Duplicate headers/fields and unknown fields fail closed.
The assertion is at most 2 KiB; subjects/issuer/audience are at most 128 ASCII
letters, digits, or `._-:@/`. Files are at most 64 KiB, with up to 32 exact
numeric peers, 256 rules, 16 workload classes, lifetime 1–300 seconds, and
clock skew 0–30 seconds. IPv4-mapped IPv6 configured peers are rejected.

Every public route, including UI/static files, service descriptions, CORS, and
unknown routes, passes admission before `100 Continue` or body decoding.
Missing/invalid identity and provider failure return empty noncacheable 401;
authenticated denial returns empty noncacheable 403 without resource details.
Read-only serving still rejects writes even if a rule would allow them.
Unknown routes cannot be granted by the file profile. Header reads may prefetch
bytes within OxHTTP's bounded transport buffer; this is not zero socket read-ahead.

Rules match an exact subject, endpoint, HTTP method, and **all** possible
operations; no implicit role inheritance or merging of partial rules occurs.
The example grants readers `/query`, writers `/update`, and operators the
listed admin endpoints; it intentionally grants neither UI nor `/sparql` nor
Graph Store. Available endpoints are `ui`, `query`, `update`, `sparql`,
`graph-store`, `health`, `ready`, `metrics`, `audit`, and `access-policy`.
Operations are `discovery`, `query`, `update`, `graph-read`, `graph-write`,
`health`, and `operator`. Workload classes are operator-defined labels.
The optional admission profile below assigns their active/queued capacities;
they are not evaluator or memory quotas.

Graph Store rules additionally need `graphs`, containing `{"kind":"all"}`,
`{"kind":"dataset"}`, `{"kind":"default-graph"}`, or
`{"kind":"named-graph","iri":"urn:allowed"}`. Up to 128 selectors per rule
are accepted, with named IRIs at most 2 KiB. The authorizer and handler share
the same selector parser. These selectors do **not** constrain SPARQL results:
query/update permission admits the whole operation over its chosen dataset.
Form-encoded POST `/sparql` requires both query and update permission before
its body can be inspected; query-only callers should use `/query` or the
unambiguous SPARQL query media type. A CORS preflight must pass identity at the
proxy and authorize both `OPTIONS` and the requested method; `/sparql` POST
preflight requires query and update. Actual requests are independently checked.

All identity, authorization, cookie, `Forwarded`, and `X-Forwarded-*` headers
are stripped before CORS/business handlers. Service URLs use the direct request
authority; forwarded URL rewriting is not enabled by this profile. Configure
the proxy's `Host` accordingly. Native password storage, OAuth/OIDC issuance,
JWT key discovery, API-key lifecycle, and RDF row filtering are not provided.

On the optional loopback admin listener, explicitly authorized operators can:

- `POST /access/policy/reload` with an empty body: atomically load the same file.
  Keep `policy_id` unchanged and increase **both** policy `version` and proxy
  `version`. Replace the file atomically first. Valid reload returns 204;
  invalid/stale replacement returns generic 400 and keeps the previous policy.
- `GET`/`HEAD /access/audit`: retrieve the last 256 admission events and the
  count overwritten. Events contain fixed operation/reason labels, request ID,
  policy ID/version and process-/policy-version-scoped salted pseudonyms, never
  raw identity headers, subjects, queries, or graph selectors. This in-memory
  ring resets on restart; it is not a durable security log or credential.

Reload affects new admissions, including the next keep-alive request. An
already-admitted request keeps its immutable policy snapshot; reload does not
cancel it retroactively. Optional `anonymous_liveness` permits only GET/HEAD
`/health` on the admin listener, not readiness/metrics or data access.

Embedders can use `oxigraph_cli::access::{RequestIdentityProvider,
RequestAuthorizer, AccessPolicy, AccessController}` with OxHTTP's admission
hook and the pre-handler `prepare_request` wrapper. Metadata-only custom
extensions must honor the supplied deadline; the controller rejects late
results but cannot preempt arbitrary blocking custom code. Native providers
perform no I/O. See the [external compile/wire fixture](tests/access_extension.rs)
and [ADR-0026](../docs/adr/0026-service-identity-and-authorization.md).

### Workload admission (fork)

Both `serve` and `serve-read-only` accept `--workload-policy FILE` for explicit
process-local admission under [ADR-0027](../docs/adr/0027-workload-admission-and-operator-resources.md).
Without it the existing serving behavior is unchanged. For a local example:

```sh
oxigraph serve --location ./data --bind 127.0.0.1:7878 \
  --admin-bind 127.0.0.1:7879 --workload-policy cli/examples/workload-policy.json
```

The [example file](examples/workload-policy.json) illustrates the schema, not
production recommendations. Supply measured capacities for your deployment.
`max_active`/`max_queued` cap data requests; each class has additional
`max_active`/`max_queued` limits. `operator_max_active`/`operator_max_queued`
reserve a **separate**, additive pool for the admin listener; the class limits
apply only to data requests. Requests cannot claim this reserve via headers.
Enable `--admin-bind` to make that reserve reachable. Authentication and
authorization run first when `--access-policy` is configured.

Admission precedes `100 Continue`, body decoding and RDF work. All requests
have one priority. Among eligible requests the queue is FIFO, skipping classes
already at their active limit. A full global queue (checked first) or operator
queue returns empty noncacheable 503; a full class queue returns 429 with the
configured `Retry-After`. Queue expiry returns 503. No rejected request opens a
dataset transaction or starts evaluation/egress. Capacity remains held through
body processing, response serialization **and socket flush**, releasing on
success, observed I/O failure or Rust unwind. A slow client still holds its
slot until its work ends; without a request deadline, admission limits do not
shorten the existing transport timeout.

Files are bounded to 64 KiB and 16 classes, with ASCII alphanumeric/`_-` names
of 1–32 bytes, a positive version, positive active limits/queue timeout and
`retry_after_seconds` from 1 to 300. Queue capacities may be zero. The `default`
class is required for anonymous requests. Every configured access-policy class
must exist before store open. An access-policy reload introducing an unmapped
class causes requests using it to fail closed with 503, never fall back.
The admission policy itself is immutable until restart; malformed/unknown
fields and arithmetic overflow are rejected at startup.

Optional `request_body_limits` adds two explicit unsigned byte caps to that
same profile (illustrative values, not production defaults):

```json
"request_body_limits": { "max_encoded_bytes": 1048576, "max_decoded_bytes": 8388608 }
```

Encoded bytes mean the entity **after HTTP transfer decoding**, before content
decompression; decoded bytes mean the full decompressed body, not just RDF
terms. Headers, chunk framing and socket read-ahead do not count. Both fields
are required; zero permits no bytes at that stage. Limits apply to every
admitted request on both listeners, including read-only mode. Authentication
and admission still run first. Omitting this option keeps existing body handling.

An excessive declared `Content-Length` is refused before `100 Continue`.
Otherwise the complete fixed/chunked body and trailers are collected within the
encoded cap, then decompressed within the decoded cap, **before any handler or
RDF work**. Overflow returns 413 and closes without draining the oversized
input; malformed/truncated framing or compression returns 400, unsupported
content encodings return 415. Clients must tolerate a closed/reset connection
while still sending a rejected body. Accepted chunk trailers and known HEAD
representation lengths are preserved. These checks also cover Graph Store
`no_transaction` requests, but do not make accepted legacy bulk writes atomic.

This bounded profile supports identity, gzip/x-gzip (all members share one cap)
and zlib-wrapped HTTP deflate. Legacy raw deflate is accepted **only without a
zlib-looking prefix**; a corrupt or ambiguous zlib-looking stream is not retried
as raw. This is deliberately narrower raw compatibility than the old decoder.
Encoding lists and other codings are unsupported. The vendored OxHTTP server
without its `flate2` feature supports identity only in this profile; the CLI
already enables that feature. No new dependency is introduced.

The existing absolute request deadline also covers body collection and
decompression, including zero-output gzip members. These are byte caps, not
hard RSS, parser-work, multipart-part, CPU or result-byte limits. Encoded and
decoded buffers coexist for compressed inputs, and a handler may copy the
decoded buffer again; use sensible caps and external process memory controls.
The existing 128 MiB buffered-handler cap also remains in force where used.

Optional `max_result_bytes` is an unsigned cap in the same startup profile, for
example `"max_result_bytes": 8388608` (illustrative, not a production default).
Omission imposes no new result-byte cap; zero permits only empty generated and
emitted bodies. It applies to admitted requests on both listeners and in
read-only mode. Two independent counters each enforce the cap: bytes written
to the representation destination, and entity bytes emitted by HTTP. Bytes are
not charged twice to one budget. Headers, chunk framing and trailers do not
count. Generation includes serializer prologs, each row and final bytes across
streaming buffer resets; it covers SPARQL, Graph Store, service descriptions,
metrics, readiness and audit output. The transport cap also covers static UI
and diagnostic bodies.

Before headers, oversized successful output returns empty, noncacheable 503
without `Retry-After`. Existing errors retain their status (including request
400/413/415), with an oversized diagnostic body suppressed. After headers,
overflow or another serialization/evaluation error terminates the stream:
clients must reject incomplete results. No replacement error text, terminal
chunk or trailers make it a successful truncated response. This also corrects
the old error-text-plus-EOF behavior when no result cap is configured.

HEAD/304/204/informational responses emit no entity. HEAD retains known
representation length; 304 does not invent a length from its empty body.
Generation is still charged if an endpoint builds a representation for HEAD
(for example Graph Store), so that work can fail before headers. Empty write
and policy-reload acknowledgments remain possible at zero; output failure
after a commit never establishes rollback. The cap is not an evaluator-work,
row-count or RSS bound: query state, serializer-private rows/terms, Graph Store
snapshot/ETag preparation and allocator capacity remain outside it.

Optional `max_inner_join_build_rows` is an unsigned cumulative cap on rows
inserted into native Cartesian/hash **inner-join build tables**. For example,
`"max_inner_join_build_rows": 100000` is an illustrative operator choice, not
a production default. Admission creates one shared handle for the whole
request, including every operation of a SPARQL Update. Omission adds no cap;
zero permits queries/writes without such materialization. Exactly-at-limit
work succeeds; the next attempted insertion permanently exhausts that request's
budget. Duplicate rows and repeated/nested builds count separately.

This does not change the optimizer or require a different physical plan. A
streaming lateral join has no build table and does not charge this counter.
Scans/probes, term width, other operators' buffers, planning/inference, remote
SERVICE execution and RSS/CPU are not bounded by it. Operators without a build
table are not rejected. Native joins inside subqueries/EXISTS share the handle;
SILENT or a custom handler using the same handle cannot hide its exhaustion.

Before successful headers, exhausted queries/updates return empty noncacheable
503 without retry advice; after headers, the stream fails without a terminating
chunk. Owned updates check before commit and roll back the entire request.
Embedded callers may attach `InnerJoinBuildBudget` using
`SparqlEvaluator::with_inner_join_build_budget`; clones deliberately share it,
so independent requests need fresh handles. Borrowed transactions remain the
caller's rollback responsibility. This is not a general query-work/RSS quota.

Optional `max_sort_buffer_rows` independently caps cumulative native `ORDER BY`
buffer rows. For example, `"max_sort_buffer_rows": 100000` is an illustrative
operator choice, not a default. One fresh budget belongs to each admission;
duplicates, nested/repeated sorts and all update operations share its counter.
Zero permits empty sorts and unsorted work. Exactly-at-cap succeeds; the next
row permanently exhausts the budget. Omission preserves the unbounded sort path.

Each admitted tuple is charged before decoded sort-key construction and buffer
insertion, without reserving from the source iterator's size hint. Earlier
`ORDER BY` expression evaluation, row width, comparator CPU, other buffers,
inference and RSS are not bounded. Successful result order and duplicates are
unchanged. Exhaustion has the same 503/failed-stream and owned-update rollback
behavior described above, including under subqueries, EXISTS and SERVICE SILENT.
Embedded callers use `SortBufferBudget` with
`SparqlEvaluator::with_sort_buffer_budget`; cloned handles deliberately share
state, independently of any inner-join budget.

Optional unsigned `max_distinct_buffer_rows` caps cumulative unique tuples
retained by native hash DISTINCT operators. Admission creates a fresh
`DistinctBufferBudget`; nested/repeated operators, prepared evaluator clones
and all operations of an update share it. Each new tuple is charged before
cloning into its set, without reserving from a source size hint. Duplicates
already in that set do not recharge; the same tuple retained by another set
does. Omission leaves the original unbounded path unchanged.

Zero allows no retained tuples; exactly-at-cap succeeds until another unique
tuple is attempted. Successful first-occurrence order is unchanged. Early
consumers such as ASK or LIMIT may finish without attempting further rows;
that is not exhaustion. This counts physical hash DISTINCT operators, including
those emitted for REDUCED; an eliminated operator charges nothing. Aggregate
DISTINCT, native consecutive deduplication, groups, path/dataset deduplication,
child row creation, row width, hashing/comparison CPU and RSS are excluded.

Exhaustion has the same empty noncacheable 503, failed-stream and whole-request
rollback behavior for owned updates described above. The typed error identifies
`DistinctBufferRows` / `DistinctBuffer`. Embedded callers attach it with
`SparqlEvaluator::with_distinct_buffer_budget`; independent requests need fresh
handles and borrowed transactions remain the caller's rollback responsibility.
Join, sort and distinct budgets are independent; existing join-then-sort error
precedence is preserved ahead of distinct failure.

Optional `request_timeout_ms` (positive milliseconds) starts one absolute
monotonic deadline **before queueing**. It is not renewed on admission, body
read, evaluation, writer acquisition or serialization. Omitting it retains
the existing timeout behavior. Expiry while queued returns 503; a cooperative
HTTP checkpoint before response output reports 408 when the socket is still
usable. The transport closes both directions at expiry, so clients must also
handle a closed connection or incomplete response, not expect a final status.
An expired partial stream never receives a successful chunk terminator.

The shared token distinguishes timeout from explicit cancellation. Simple
queries, built-in SERVICE/LOAD (including SILENT), owned SPARQL updates and
transactional Graph Store writes observe it. A final pre-commit checkpoint
rolls back staged data and empty graphs; expiry after a commit attempt cannot
prove rollback, and losing the response does not mean the write did not commit.
Readiness uses the earlier of its own 250 ms limit and the remaining request
deadline. The old query-only `--timeout` uses a deadline token, not a detached
sleeping thread. The transport watcher is stopped and joined on completion
before connection reuse; timeout never releases capacity still owned by work.

Deadline-enabled queries support Simple, finite RDF, finite RDFS and bounded OWL
materialization. One request deadline spans snapshot copying, FROM/RDF merge
construction, inference and materialized reads, including scans with no matching rows.
Cancellation/expiry during materialization returns 408 before response streaming.
RDFS checkpoints also cover engine preflight, both input copies (including empty
named graphs), axiom generation, sparse rule scans, consistency ordering,
closure construction and memory estimation. OWL checks these phases too, including
equality, lists, keys, datatype checks, semantic witnesses and contradiction
deduplication. Both profiles preserve interned IDs and dataset iteration order
during controlled copies. Rule inventories and successful resource counters are
unchanged; this is not new semantic qualification or full allocation accounting.
Deadline-enabled Graph Store PUT and non-multipart POST reject the
legacy `no_transaction` bulk path with 400. Their missing cooperative checkpoints
are follow-up work; other methods retain their normal handling of that flag.
Individual RDF term parsing/formatting, custom callback, DNS and native storage calls remain
cooperative boundaries, not preemptible CPU or hard real-time guarantees.

The public Rust `AdmissionController::acquire` accepts a cancellation token;
queued cancellation is checked every 10 ms of scheduled execution. Cancelling
an active lease does not prematurely free its capacity. `snapshot()` exposes
active/queued counts without principal or query data. Idle/header connections
remain subject to a separate transport cap (active + queued + one rejection
connection for each listener), so this is not unlimited overload responsiveness.

Both CLI listeners use `AdmissionController::admit_request` to poll a trusted
OxHTTP `AdmissionAbort` during queue waits and before activation. An observed
socket error (for example, TCP reset) cancels the same token and frees the queue
slot without waiting for queue expiry. The transport latches consumed socket
errors and stops admission before `100 Continue` or body handling. Probes are
disarmed before active work and keep-alive reuse, even on unwind; no polling
thread, body reads, socket-mode changes or new dependency is added.
This does **not** treat TCP FIN as cancellation: a complete request may close its
write half and still receive a response. FIN-only closure, silent network loss
and errors after the final admission check remain bounded by existing timeouts,
not this probe. Linux reset fixtures verify queue release with the active lease
still held, operator isolation and no abandoned write after restart; GET,
fixed-length and chunked half-closed request fixtures remain successful.

Still pending: active-work disconnect propagation, deadline support for the
explicitly excluded paths above, finer parser/evaluator work counters,
per-principal/priority scheduling, atomic workload reload, resource-use metrics and
operational qualification. Cooperative admission is not a hard RSS/CPU/fd/disk
guarantee; use external process/container controls. This stage does not complete
G4.2 or promote the Proposed ADR.

### Local operational observations (fork)

`serve` and `serve-read-only` optionally expose a separate loopback listener:

```sh
./target/release/oxigraph serve --location ./data --bind 127.0.0.1:7878 --admin-bind 127.0.0.1:9797
curl -i http://127.0.0.1:9797/ready
curl http://127.0.0.1:9797/metrics
```

Only numeric loopback addresses with a nonzero port are accepted; the listener
is absent unless requested. Without an access policy it has only anonymous
observations, no maintenance routes. With a policy, readiness and metrics
require explicit operator permission and the two access-management routes
above are available. It never exposes CORS, RDF, or SPARQL. Do not expose or
reverse-proxy it to an untrusted network.
The public listener does not gain the operational routes. Both listeners have
CLI-process lifetime; this is not an in-process graceful-shutdown API.
Application requests are gated until both binds and startup notification
succeed. Startup failure exits the process and releases both listeners.

- `GET`/`HEAD /health`: process liveness, HTTP 200 without a storage scan.
- `GET`/`HEAD /ready`: one bounded native readiness observation. Ready or
  explicitly degraded is HTTP 200; not-ready is 503 with fixed reason tokens.
- `GET`/`HEAD /metrics`: the same native observation as at most 21 fixed,
  label-free Prometheus text-format gauges, plus 89 bounded transaction samples
  and 154 bounded query/update samples plus 143 policy samples (at most 407 total).
  A workload policy adds 60 admission samples (at most 467 total), described below.
  A storage-not-ready result remains
  HTTP 200 with `oxigraph_ready 0`; a clock-conversion failure is 503.

HEAD performs the same observation and suppresses its body. Responses use
`Cache-Control: no-store`; unsupported methods return 405 and unknown paths
return 404. Query strings are rejected without echoing their contents.

The listener allows two concurrent connections with a two-second transport
timeout and a separate 250 ms cooperative probe deadline. A blocked native I/O
call cannot be interrupted by that deadline. It uses the native default prefix
bounds: 128 primary records plus one encoded lookahead, a 1 MiB logical-byte
stopping threshold, and 256 outbox records. Partial primary coverage degrades;
partial outbox coverage fails readiness. Large governed histories therefore
need an explicit retention policy or a caller-configured native probe, not a
claim that a bounded prefix validated the full store.

The CLI currently declares no derived providers and no automatic circuit
breaker; its inventory is validly empty. Required-provider policies remain
available through the Rust API.

Transaction telemetry counts one terminal call result per admitted built-in
storage transaction, including autocommit and the transaction used by SPARQL
Update. `oxigraph_transactions_total{outcome="committed"}` distinguishes
committed, rejected, conflicted, cancelled, rolled-back, rollback-failed,
indeterminate, and abandoned observations. These eight fixed labels also index
the cumulative `oxigraph_transaction_duration_seconds` histogram, measured from
admission to terminal return/drop; `_bucket`, `_count`, and `_sum` use seconds.
`oxigraph_transaction_rollback_failures_total` includes explicit rollback
failures and failed validation pre-attempt rollbacks. The three families expose
exactly 89 samples, with no request keys, RDF, query text or raw errors.

Counters are shared by Store clones but reset on reopen/restart. They record
the observed result, not durable outcome lookup: an ambiguous response remains
indeterminate even if later lookup proves a commit. Drop is abandoned, not a
claim of successful rollback. Admission failures/wait time, bulk loaders,
governance maintenance, and external storage adapters are excluded from
transaction telemetry.

Store-bound SPARQL evaluation separately exports `oxigraph_queries_total`,
`oxigraph_updates_total`, `oxigraph_query_duration_seconds`, and
`oxigraph_update_duration_seconds`. Seven fixed outcome labels distinguish
succeeded, failed, cancelled, timed out, policy denied, indeterminate, and
abandoned. Duration starts at Store binding, including admission, caller delay,
and lazy result consumption. SELECT/CONSTRUCT success requires observed EOF;
the first returned error finishes the observation, while early drop is
abandoned. Update commit errors are indeterminate, never a replay instruction.
No extra reads, retries, or rollback calls are introduced. Query and update
counts are not HTTP response counts: parse failures, serialization failures,
and generic-dataset or borrowed-transaction bindings are outside this boundary.
`SILENT` success remains success. `oxigraph_egress_denials_total` and
`oxigraph_egress_denial_duration_seconds` record denied attempts separately,
using only `purpose="service|load|document"`. Nested-document rejection is not
recounted as LOAD rejection. Timing covers request/target-preflight entry through
the denial, not whole-query latency. Custom handlers, generic/borrowed bindings,
and standalone document loaders are not Store-attributed.

`oxigraph_shacl_commit_gates_total` and
`oxigraph_shacl_commit_gate_duration_seconds` use ten fixed disposition labels.
They measure returned gated commits, including validation, final guards, cleanup,
and native commit—not pure validator CPU time. Accepted validation may coexist
with an indeterminate commit. Start/preparation failures, explicit rollback,
pre-commit Drop, unwinding, and standalone validation are excluded. The current
CLI does not configure a SHACL policy, so those counters remain zero; zero is
not a claim that validation or remote egress is enabled.

With `--workload-policy`, five additional families observe admission:

- `oxigraph_admission_active` and `oxigraph_admission_queued`: current requests
  in the fixed `data` and `operator` pools.
- `oxigraph_admissions_total` and `oxigraph_admissions_queued_total`: all returned
  acquisition results and the queued subset. Fixed dispositions distinguish
  admission, global/class/operator refusal, unknown class, cancellation,
  request timeout, queue timeout and unavailability.
- `oxigraph_admission_queue_wait_seconds`: cumulative wait histograms for each
  pool, with the same microsecond resolution and fixed buckets as transaction
  telemetry. Only attempts that entered the queue contribute, from enqueue to
  their terminal scheduling observation (or observation of unavailability).
  This can include time after another thread has purged the entry.

Counters are shared by controller clones and reset on restart/new controller;
counts and sums saturate. These observations neither drive readiness nor claim
request success or rollback. Missing trusted context, authentication/authorization
refusals, idle connections, and denial rendering are excluded. Lease clones,
late cancellation, drop and unwind do not count an admitted attempt again.
An authorized scrape includes its own active operator lease. No class/policy
names, identities, queries, RDF or endpoints are exported. Without a workload
policy these families are absent, not zero. An unavailable controller snapshot
fails the scrape with bounded HTTP 503; configured result-byte limits still apply.
The additive Rust view is `AdmissionController::metrics()`; the original
four-field `snapshot()` remains unchanged.

Each snapshot is internally consistent, but readiness, transaction, evaluation,
policy and admission snapshots are not one atomic observation. See
[ADR-0022](../docs/adr/0022-operational-readiness-backup-and-recovery.md).

It is also possible to load RDF data offline using bulk loading:
`oxigraph load --location my_data_storage_directory --file my_file.nq`

## Receipt-bearing backups (fork)

Build this fork's CLI to use these commands. Stop any writer before opening the
source through the offline CLI; ordinary read-only handles must not coexist
with a writer.

```sh
oxigraph backup --with-receipt --location ./data --destination ./backup-new
oxigraph verify-backup --location ./backup-new
```

The fresh package contains `store/`, `contributors/`, and
`oxigraph-backup.complete`. The completion manifest is published last, after
file checksums and synchronization. Pre-publication failures leave an incomplete
directory, never a successful receipt. A final directory-sync error is explicitly
indeterminate: inspect and verify the existing package instead of overwriting it.
Successful verification checks the exact regular-file inventory, sizes, hashes,
and receipt bindings without opening the database. Keep the package immutable;
opening its `store/` writable can invalidate it. This is not an automated restore
drill or a production RPO/RTO claim. Use the separate restore command below to
validate a writable recovery copy.

Receipt creation currently requires Unix directory synchronization. The manifest
is bounded to 64 MiB, 100,000 data files, and 128 contributors. The CLI declares
an empty contributor inventory; Rust callers can supply frozen provider files
through `BackupOptions`. Checksums bind those files, not independently prove
their index semantics. Destinations must be exclusively operator-owned; this is
not a concurrent untrusted-filesystem sandbox. Native checkpoint I/O is not
interruptible; Rust cancellation is checked between native calls and copy chunks.
The existing plain `backup` command keeps its directory format. Both paths now
preserve recovered WAL writes when backing up a closed source read-only.

## Fresh-directory restore (fork)

Restore a receipt-bearing package without opening or modifying its source:

```sh
oxigraph restore --backup ./backup-new --destination ./restore-new
oxigraph serve --location ./restore-new/store --bind 127.0.0.1:7878
```

The destination must not exist and must be outside the backup. Restore verifies
the source and copied file inventories before opening the copy read-only, runs
the storage validator, compares topology, namespaces and primary/checkpoint
identity, and validates the entire retained outbox. It closes read-only handles
and synchronizes copied files/directories before publishing
`oxigraph-restore.complete`. The original manifest becomes
`oxigraph-backup.source` in the destination; the backup itself stays immutable.
The restored `store/` is then available for normal writable use.

Output identifies the backup fingerprint, quad/outbox counts, checkpoint-age
interval, and measured restore duration. By default `baseline=unconfigured`:
there is no invented recovery objective. To check a local drill against an
explicit policy, supply both `--max-backup-age-ms` and `--max-restore-time-ms`.
The CLI freezes those limits, reference time, and backup identity before restore
and reports the baseline fingerprint. Age is elapsed time since checkpoint
observations, not a count of lost changes. Duration ends at validated, synced
data, before completion-record publication; it is not full-service RTO.

Pre-publication errors, cancellation, or exceeded limits leave an incomplete
destination without a completion marker. Do not reuse or overwrite it. A final
directory-sync failure after publication is explicitly indeterminate, not a
successful return. Rust `RestoreReceipt::read` verifies the historical completion
record and its source-manifest binding; it does not revalidate a database changed
by subsequent writes or prove power-loss durability retroactively.

The CLI declares an empty contributor inventory. Packages with declared
contributors require Rust `RestoreOptions` with the exact policy and trusted
`RestoreContributor` adapters for present providers. Adapters inspect their
copied files and primary receipt lookups, not the expected observation; unknown,
duplicate, missing-required or mismatched state fails closed. Core rehashes files
after adapters run. Native restore currently requires Unix directory sync,
exclusively owned destinations, and cooperative cancellation around native I/O.
These are local recovery checks, not production recovery qualification.

## Using a Docker image

### Display the help menu
```sh
docker run --rm ghcr.io/oxigraph/oxigraph --help
```

### Run the Webserver

Published upstream images do not contain this fork's changes. From the fork
repository root, build a local image and explicitly opt in to the container's
non-loopback listener, publishing it only on host loopback:

```sh
docker build -f cli/Dockerfile -t oxigraph-fork .
docker run --rm -v "$PWD/data:/data" -p 127.0.0.1:7878:7878 oxigraph-fork serve --location /data --bind 0.0.0.0:7878 --unsafe-allow-remote-anonymous
```

Other containers on the container network may still reach that anonymous
listener. Use only a trusted local network. Without the explicit command, this
fork's image defaults to loopback inside the container and is not reachable
through Docker port publishing. No fork image publication is implied.

You can then access it from your machine on port `7878`:

```sh
# Open the GUI in a browser
firefox http://localhost:7878

# Post some data
curl http://localhost:7878/store?default -H 'Content-Type: text/turtle' -T ./data.ttl

# Make a query
curl -X POST -H 'Accept: application/sparql-results+json' -H 'Content-Type: application/sparql-query' --data 'SELECT * WHERE { ?s ?p ?o } LIMIT 10' http://localhost:7878/query

# Make an UPDATE
curl -X POST -H 'Content-Type: application/sparql-update' --data 'DELETE WHERE { <http://example.com/s> ?p ?o }' http://localhost:7878/update
```

### Reverse-proxy authentication

Use the [trusted-proxy access profile](#trusted-proxy-access-policy-fork)
for server-bound identity and authorization. Configure client authentication
and TLS at your chosen proxy, replace rather than append identity headers,
and prevent direct access to the backend and operator port.

The previous upstream Basic-auth Compose example did not produce the required
versioned identity assertion and used the upstream image, not this fork.
It is not an authenticated deployment recipe for this profile. A proxy's
authentication mechanism alone does not establish Oxigraph's request principal.

### Build the image

You could easily build your own Docker image by cloning this repository with its submodules, and going to the root folder:

```sh
git clone --recursive https://github.com/oxigraph/oxigraph.git
cd oxigraph
```

Then run this command to build the image locally:

```sh
docker build -t ghcr.io/oxigraph/oxigraph -f cli/Dockerfile .
```

## Systemd

It is possible to run Oxigraph in the background using systemd.

For that, you can use the following `oxigraph.service` file (it might be inserted into `/etc/systemd/system/` or `$HOME/.config/systemd/user`):
```ini
[Unit]
Description=Oxigraph database server
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/PATH/TO/oxigraph serve --location /PATH/TO/OXIGRAPH/DATA

[Install]
WantedBy=multi-user.target
```

## Man pages and autocompletion

Autocompletion for various shells are generated on build in the `target/{debug,release}/build/oxigraph-cli-<hash>/out/complete` directory.
Similarly, man pages are generated in the `target/{debug,release}/build/oxigraph-cli-<hash>/out/man` directory.

## Migration guide

### From 0.2 to 0.3
* The cli API has been completely rewritten. To start the server run `oxigraph serve --location MY_STORAGE` instead of `oxigraph --file MY_STORAGE`.
* Fast data bulk loading is now supported using `oxigraph load --location MY_STORAGE --file MY_FILE`. The file format is guessed from the extension (`.nt`, `.ttl`, `.nq`, ...).
* [RDF-star](https://w3c.github.io/rdf-star/cg-spec/2021-12-17.html) is now implemented.
* All operations are now transactional using the "repeatable read" isolation level:
  the store only exposes changes that have been "committed" (i.e. no partial writes)
  and the exposed state does not change for the complete duration of a read operation (e.g. a SPARQL query) or a read/write operation (e.g. a SPARQL update).


## Help

Feel free to use [GitHub discussions](https://github.com/oxigraph/oxigraph/discussions) or [the Gitter chat](https://gitter.im/oxigraph/community) to ask questions or talk about Oxigraph.
[Bug reports](https://github.com/oxigraph/oxigraph/issues) are also very welcome.

If you need advanced support or are willing to pay to get some extra features, feel free to reach out to [Tpt](https://github.com/Tpt).


## License

This project is licensed under either of

* Apache License, Version 2.0, ([LICENSE-APACHE](../LICENSE-APACHE) or
  http://www.apache.org/licenses/LICENSE-2.0)
* MIT license ([LICENSE-MIT](../LICENSE-MIT) or
  http://opensource.org/licenses/MIT)

at your option.


### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in Oxigraph by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
