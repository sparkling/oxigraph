# ADR-0019: Unified egress, cancellation, and service claims

- **Status**: Implemented
- **Date**: 2026-08-24
- Updated: 2026-09-10
- Deciders: Oxigraph parity programme
- Implementation status: G1.5's unified-egress, G1.5b's owned-update
  cancellation, and G1.5c's negotiated backend-admission profiles are
  implemented and source-bound; G1.6 runtime-derived service claims are also
  implemented and accepted by the sealed seven-stage verifier and its negative
  controls
- **Depends on**:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md)
- **Related**:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md)

## Context

Query evaluation already accepts service handlers and a cancellation token,
and the built-in HTTP client has time and redirect limits. SPARQL `LOAD`,
default `SERVICE`, and remote document/JSON-LD context egress are nevertheless
assembled through different paths. Owned update mutation now shares one
pre-commit cancellation contract, but the legacy generic transaction opener
cannot interrupt an arbitrary backend while it blocks and caller-owned
transactions do not provide an update-scoped savepoint.
There is no single policy for schemes, destinations, DNS changes, redirects,
response size, or connection budgets.

The CLI service description is intentionally conservative under ADR-0011.
Future disclosure must reflect effective runtime behavior, not compile-time
features or aspirational parity.

## Decision

Route every built-in remote `SERVICE`, `LOAD`, and document-loader request
through one egress-policy capability. The policy validates schemes, hosts,
resolved addresses, redirects, byte limits, time budgets, and connection
budgets. It revalidates every DNS resolution and redirect and can deny private,
loopback, link-local, or otherwise disallowed destinations. Custom handlers
remain possible, but their use is an explicit capability boundary rather than
an implicit bypass of the built-in policy.
Compressed and decoded byte limits are separate. URL credentials, cookies,
and authorization headers are never forwarded across origins implicitly. File
access is a different explicit capability; an HTTP allow rule does not
authorize `file:`. Server profiles default to no built-in network egress until
a reviewed policy enables it.

Thread one cancellation/deadline context through query algebra, remote body
reads, update loops, document parsing, staging, and writer-gate acquisition.
For an update-owned transaction, cancellation before `CommitAttempted` rolls
the complete request back. A binding to a caller-owned transaction may retain
staged mutations after an error; the caller must discard that transaction, or
use a separately accepted savepoint contract, to obtain rollback.
Cancellation after that transition follows ADR-0018 and ADR-0020 and may
return an indeterminate transaction key; it may not claim rollback without
proof.

Generate service descriptions from the evaluator's effective configured and
compiled capabilities and closed evidence. This deterministic snapshot is not
a remote-health probe or a promise that a later request will be admitted. A
disabled, policy-blocked, untested, or unavailable capability is not
advertised. ADR-0011's conservative SPARQL 1.0/1.1 disclosure remains the
baseline until richer claims have exact endpoint evidence.

## Acceptance boundary

The additive ADR-0027 native deadline slice extends the token with an optional
absolute monotonic deadline and distinct query/update `TimedOut` outcomes.
Built-in and custom SERVICE boundaries check handler/iterator return, including
EOF; whole-request deadlines cannot be SILENT-ed, while ordinary remote-policy
timeouts retain their prior semantics. Owned writes still check before commit,
never infer rollback after a commit attempt, and metrics distinguish timeout
from explicit cancellation. New native tests supplement, and do not refresh or
promote, the pinned G1.5-G1.6 qualification evidence below.

The 2026-09-10 native handler acceptance additionally supplies a real admitted
lease to explicitly allowed loopback SERVICE/LOAD. Whole-request expiry now
preserves HTTP 408 instead of being misclassified as internal 500; ordinary
remote timeouts retain their SILENT behavior. Partial SERVICE reads fail, and
owned LOAD rolls back triples and empty graphs across reopen. Both serve modes
remain deny-all; this is not positive server-egress qualification.

The accepted bounded G1.5-G1.6 implementation profile proves:

- loopback fixtures for allowed and denied targets, DNS rebinding, redirects,
  cross-origin credentials, partial/compressed streams, response limits,
  timeouts, and connection failures;
- the same policy is reached by built-in `SERVICE` and `LOAD` paths;
- remote document and JSON-LD context loading cannot bypass the policy;
- cancellation during every owned-update phase leaves no partial primary
  state, including negotiated backend admission;
- error variants distinguish policy denial, timeout, cancellation, remote
  failure, conflict, and indeterminate commit;
- every capability-qualified service-description feature is exercised by the
  sealed endpoint evaluator, including absent claims under the deny-all
  control; and
- query text, RDF payloads, credentials, IRIs, and user identifiers are absent
  from default telemetry.

## Consequences

- Server operators get one reviewable outbound security boundary.
- Query and update cancellation acquire consistent transaction semantics.
- Runtime profiles may advertise different capabilities without lying about a
  disabled feature.
- Existing callers relying on unrestricted built-in egress may need an
  explicit policy configuration.

## Alternatives rejected

- **Keep `SERVICE` and `LOAD` policy separate.** Redirect and cancellation
  fixes would remain bypassable through the other path.
- **Derive claims from Cargo features.** Compilation does not prove runtime
  policy, availability, or endpoint behavior.
- **Treat timeout as cancellation.** A timeout source and the transaction's
  durable outcome are separate facts.

## Evidence and task ownership

Current boundaries are visible in
[`sparql/http.rs`](../../lib/oxigraph/src/sparql/http.rs),
[`http.rs`](../../lib/oxigraph/src/http.rs),
[`sparql/update.rs`](../../lib/oxigraph/src/sparql/update.rs), and
[`service_description.rs`](../../cli/src/service_description.rs).

G1.5's unified-egress profile is implemented by product commits `e452bad1` and
`3f4cdfd7`. Built-in `SERVICE`, `LOAD`, and nested document retrieval share an
explicit egress policy; the governed profile denies by default, applies
conjunctive origin/address admission, rejects credentials and redirects, keeps
encoded and decoded response limits separate, shares a connection budget, and
returns typed policy, timeout, cancellation, remote, and budget failures.
Cancellation while reading a remote `LOAD` response rolls back its staged
update, and terminal response paths close the body before releasing admission.

The evaluator-only commit is
`f1fa7900191a4eaffd2d9c92694851152a5e4fb1`, with tree
`829b42c96c6bf72839f7858c6da932c8709d2d60`, evaluator blob
`fea9d5a25e680ff30d27592139152b85e0852581`, content SHA-256
`96a414d1ccf78e323e310a853ca6f1c060567c44b02b688b8de523a0ebf61e87`,
and evaluator patch SHA-256
`aacc284628b9bb64073a97eee29c555fef327c23cd169cf15ea2e1d1e1d9ee91`.
The frozen contract digest is
`e77e11a02e55e995583f0bab118878a42c490b562e0826c6b1611db096c6dfec`.
It retained 1,382 protected entries with manifest SHA-256
`5f7c03cef435fd8ed8750b6ce13f8807481413e75dc1b943dbc118fdd9ccda30`.

The engineering harness reconstructed exact product patch
`88ba98acece42a0dc595c9b44951de90fe7f0c2a0c33c3f6bf0cad95ff36c3cc`
as candidate commit `dce82860d028d675471b6990127d143a66144e82` and tree
`ee4562f93bfa8558a931806bc4d8934df187506f`. The isolated verifier returned
`ACCEPT` after format, build, 12 public egress-policy tests, 8 independent
`LOAD` tests, and 13 `SERVICE` regressions in 308.871 seconds. Its
`verifier-session-result.json` was 112,685 bytes with SHA-256
`4d1f9df209046b439db07346a22f2b4c9063f80b913d2a752abcc7a1123234eb`.

G1.5b is implemented by product commits `280872dc` and `9b84bed6`. The exact
four-path product patch
`ccf256b17f4ea01be82025485bc9bd20d4d9868c0307be922009f87792a9743f`
(30,748 bytes) was reconstructed from evaluator-only commit
`776b212dda26a4967f82098a90ade4c2d83aade1`, tree
`8f966046c4aa9f160a0869e0bac6d72cde04efa2`, under frozen contract
`ab01ef3e29fbded8c8c042359851bd0c02c9fa1fd97afbc00eadc0b3a48e1525`.
The evaluator patch is
`fbb93b4cfead8c6cf333241a647f13478c3380580bb0a9547c473fee0f6b5a7e`.
The candidate commit was `33a0eefb5ee6a84e3a12a5585eec1ebf3a35a86a`,
tree `d5413be86dae88f4b353ef4979ca8307f408357d`; 1,386 protected
entries retained manifest
`65cedf8d5a2cb289b3cd60d929fbc04fbbd1332e508a2bfd697f738b51c2c0f3`.
The isolated verifier returned `ACCEPT` after format, build, 6 public
cancellation tests, 6 independent writer-admission tests, and 12 egress
regressions in 431.682 seconds. Its 113,635-byte session artifact has SHA-256
`4f6107ca9357ccc15b353a858729e8110495ec5079a40785f2edb9a83ca18f48`.

That receipt proves typed cancellation and rollback for transactions owned by
the update binding, including built-in Store admission. The plain
`TransactionalDataset::start_transaction` method is checked before and after
the call but cannot be interrupted while an arbitrary implementation blocks.
`on_transaction` borrows caller-owned state and cannot roll back only the
current update without savepoints, so it is explicitly outside this receipt.

G1.5c is implemented by product commit
`3afe1e7850d60945342a8a6e7072e85a63683be1`, tree
`938a1f3a1a68f67c1725b4240dd6ce2e7cff1188`. Evaluator-only commit
`fbd11e1802c295da3b4e510686e18090b62f381b`, tree
`d36eeb470334b7be3fe381b52c640d95e724c479`, has patch SHA-256
`6a67bad0ce50de23e7a926218e163d2508a1e6f766231cec41d41db8193752cc`.
The frozen preflight returned `CONFIRMED_RED` with green references; its
118,757-byte artifact has SHA-256
`b4d4ba3af11d85727ec13157e3a07a11548436d4bfff74f0bb92c16efd22a262`.

Frozen contract
`05b6ba498344fc412a810bb79eb80344f90577a442ce03c41637cbabd4a26ce1`
reconstructed exact 7,252-byte three-path product patch
`229d326bb22f46b992bc6d6212be1346de88b0d5bf1b9cad56dc0150611066c8`
as candidate commit `bbbbc5aa6b1cb1ba283c272e1f87fbc53483b728`, tree
`40137fa6306e8c282da16fbeb0d46418e27d0f3a`. It retained 1,389 protected
entries with manifest
`f0d009cd1b48b6c850b45026a2956fea752c8e9cf932022d7e34aa37cf5fb2bb`
and returned `ACCEPT` after format/build, five public negotiated-admission
tests, fifteen independent capability/writer-admission tests, and twenty-one
cancellation/egress/transaction regressions in 1,337.018 seconds. Its
118,202-byte `verifier-session-result.json` has SHA-256
`94461758757f1d4402713f6bed115e1bbd318d1fc35b02c7ea2c3b27a2b3f23b`.
The run used one Cargo job, a 12 GiB state ceiling, and a 16 GiB aggregate
ceiling; directly observed peaks stayed below both and every cgroup memory
event counter remained zero.

This verifier evidence closes cancellable negotiated admission for owned
updates while preserving the minimal traits and the caller-owned rollback
boundary.

G1.6 is implemented by exact product commit
`96d0ae7b177026506f4c8bfc74cf2eb88e71abc4`, tree
`269ccb9b519c6beaf311bfc9ec5c7539acb79498`, with product patch SHA-256
`6ac04ebee08ce571e403a3937c41d258521bf9e172b2f3e666949266b73239b3`.
It was integrated without changing those four product blobs by merge commit
`baeabb067c8c8419973842e5e060adf832e3f738`. The implementation is confined to
[`main.rs`](../../cli/src/main.rs),
[`service_description.rs`](../../cli/src/service_description.rs),
[`http.rs`](../../lib/oxigraph/src/http.rs), and
[`sparql/mod.rs`](../../lib/oxigraph/src/sparql/mod.rs). Service-description
input and federation claims now come from the evaluator's effective
capability snapshot, union-default-graph configuration is disclosed for both
query and update endpoints, and every server query and update path uses the
same deny-all egress evaluator. The standalone CLI remains explicitly
permissive rather than inheriting the server profile.

The sealed run reconstructed that product against baseline
`826bd7a2622282b4194aa03ffc1b9effbb0adae0` with evaluator commit
`8dcb795a08e3605c18c662d13b040311a260ac2b`, evaluator tree
`973d5ed5615fc2f34a1e9d0da657d01f5c899755`, evaluator patch SHA-256
`93893693ed9804d56589169168c4dcd464bdeef2bc8dfea9e0eee0689888cee6`,
and frozen contract SHA-256
`abd16ee2f4d2c7c4b89b651e9412e126cac468456e7a1633c1143dce1f5accd3`.
Preflight returned `CONFIRMED_RED` with green references. All 1,398 protected
entries were retained with manifest SHA-256
`a5c3f5c448a9aa1a615f7b4b1d60b8c5e43965240c5981acb66fa356831b155f`.
The isolated seven-stage verifier returned `ACCEPT` after format, build, four
public capability tests, seventeen service-description tests, one non-vacuous
compatibility test, one independent test, and twelve regressions in
1,153.499 seconds. Its 126,368-byte `verifier-session-result.json` has SHA-256
`4ff0fdafa3b8584f81033a89000814320a952bbc384523cd72dd57150963458b`.

Three exact negative candidates establish that the positive verdict depends
on the complete product behavior:

- The previous product patch over `6f447333..27bd0d43`, SHA-256
  `1b30556c3392aaf1a4f0041ce3f69fd00a929fba4fd62ee2b4c04edb6297566e`,
  tree `7b3cf9567cd6ca763165f38727675dec66870c00`, was reconstructed as
  `9aad0121280e32ddbbc0893c4cc583d10f065eb7` and returned `REJECT`. It
  passed 4 public tests, failed 2 of 17 service-description tests, failed the
  1 compatibility canary, and passed the independent test and 12 regressions
  in 1,139.452 seconds. The failed service tests were
  `union_default_graph_is_disclosed_for_query_and_update_evaluation` and
  `server_endpoints_use_the_shared_deny_all_evaluator`. Its 129,120-byte
  verifier artifact has SHA-256
  `96dc288bc70f5d5dfb62ce02d5954330534ac7921da17e912d74af4b6a200740`;
  the 57,145-byte atomic outer evidence has SHA-256
  `9e5c54a5e687948b4183bb57878764975cc0a7701a86e02ce3ab8254eb89287c`.
- The union-only patch, SHA-256
  `543379f0df24e5f8e144239d7dc674e1e618521494fa9f0c7b2132b12e88e330`,
  tree `f249d49ebf440734e0e05368ea78ac6c0f444e52`, returned `REJECT` after
  4 public, 16 of 17 service-description, 1 compatibility, 1 independent, and
  12 regression tests in 1,148.684 seconds. Its 127,834-byte verifier artifact
  has SHA-256
  `393b8c7239986a654e80f5213b653ea5c494fec4878b7fd79ced9a9c39321046`.
- The CLI-TLS-gated server patch, SHA-256
  `e3f15a88f61711873a1e7f9f41a79fae737b8531d9f9422309ec7d488e4e9578`,
  tree `964a63bf5f91a44f569565e1fa1de7bb262ce7cd`, returned `REJECT` after
  4 public, 17 service-description, 0 of 1 compatibility, 1 independent, and
  12 regression tests in 1,147.933 seconds. Its 127,654-byte verifier artifact
  has SHA-256
  `3635ef690d75d10d8d5b4d7b316b7c6d487d7f6e9a8b47055a0c86630e387f5d`;
  the 53,766-byte atomic outer evidence has SHA-256
  `33049ddad8d1136015f7b5a866ba4ba9b8e0d2953606de9195d7ef7f17c38333`.

A direct verifier test also proves that zero or two compatibility results are
rejected, preserving the single non-vacuous compatibility canary. These are
verifier-session artifacts and atomic control evidence, not application
receipts. They close this ADR's bounded implementation profile only; they do
not grant current-HEAD semantic umbrella qualification. Remaining programme
dependencies are recorded in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
