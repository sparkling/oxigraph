# Oxigraph engineering harness

This private package is the application-development control plane accepted by
ADR-0017. It is separate from `tools/metaharness`, which remains the immutable
semantic-qualification adapter.

The package requests current upstream `latest` dist-tags. Its committed npm
lock binds exact registry tarballs and SHA-512 integrity, and `.npmrc` disables
lifecycle scripts. Runtime publication and OpenRouter transport are forbidden.

Native provider processes use an attested role-specific timeout policy. The
architecture, critique, and review roles retain the ten-minute ceiling;
implementation and repair receive a bounded twenty minutes because patch
generation must synthesize and encode the complete frozen-source diff. The
task contract's aggregate wall ceiling may reduce, but never increase, those
limits. The selected value is bound into each tool-free task and the complete
ceiling map is bound into the committed control identity; unknown roles fail
before provider spawn. Canonical implementation and repair patches must also
pass Git's bounded parse-only `apply --numstat --whitespace=error` oracle before
the native invocation can be labelled `ACCEPT`; applicability to the frozen
evaluator remains the sealed reconstruction stage's authority. Same-host retry,
circuit-breaking, and cancellation remain unchanged.

Current activation boundary:

- `doctor` verifies the local installation and dependency bindings;
- `g1.2 preflight|run|replay` preserves the accepted RocksDB writer-serialization
  contract and its historical receipts;
- `g1.3 preflight|run|replay` binds the additive transaction-capability task to
  its post-G1.2 evaluator, including the expected single `E0432` compiler-red
  baseline and independently green controls;
- `g1.4 preflight|run|replay` binds the five-file writer-admission slice to its
  frozen 1/4/16-writer, reader-liveness, rollback/drop, timeout, and
  cancellation evaluator while protecting every other repository path;
- `g1.4a preflight|run|replay` binds the five-file keyed terminal-outcome slice
  to its evaluator-only public API, memory oracle, RocksDB reopen,
  duplicate-key, rollback/drop, legacy-compatibility, and process-abort
  lost-acknowledgement cases. The same evaluator commit updates the two older
  RocksDB capability assertions, so candidate verification runs the complete
  capability and compatibility targets without exclusions. Within the fixed
  seven-stage receipt vocabulary, the supplemental `service` slot carries the
  capability target and `compatibility` carries the compatibility target;
- `g1.4b preflight|run|replay` binds the sole mutable RocksDB wrapper to a
  frozen, evaluator-separated fault matrix for storage-call errors before and
  after staging, commit-attempt, final-batch, and rollback writes. Its runtime
  red signature is exactly six passing and two failing library tests: both
  failures expose a false RolledBack proof after commit-attempt marker errors.
  The qualified change must advance the in-memory phase before that marker
  call, keep durable Staging and CommitAttempted lookup indeterminate, and
  preserve one attempt plus one atomic final batch. This evidence covers the
  simulated state-machine branches only; it does not claim crash, power-loss,
  or fsync durability. Run `g14b-phase-order-20260828` selected patch
  `02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314`;
  receipt `d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`
  and exact replay both returned `ACCEPT`, and product commit `590a3229`
  passes the exact 8/8, 7/7, and 20/20 counted controls;
- `g1.5 preflight|run|replay` activates `http-client,rdf-12` explicitly and
  binds the six-file unified egress slice to deny-by-default SERVICE, LOAD,
  nested-document, response-limit, connection-budget, cancellation, and
  rollback evidence;
- `g1.5b preflight|run|replay` binds the four-file local UPDATE cancellation
  closure to typed cancellation before validation, during serialized RocksDB
  writer admission, and throughout mutation, while independently preserving
  writer-admission and G1.5 egress-policy evidence;
- `g1.5c preflight|run|replay` binds the three-file additive negotiated-update
  admission slice to the caller's exact request and cancellation token for
  custom backends and `Store`, while preserving the minimal transaction traits;
  its independent command runs both capability and writer-admission targets and
  its regression command runs cancellation, egress, and transactional-dataset
  targets. Command exit status proves every target in each set; the scalar
  receipt counts bind the final Cargo result lines (9 independent, 3 regression).
  Clean RocksDB builds use one Cargo job and a 12 GiB `/state` tmpfs ceiling so
  the feature-active build and later default-feature reference artefacts coexist.
  `maxResidentBytes` is the 16 GiB aggregate cgroup ceiling and includes that
  tmpfs state together with compiler, linker, and verifier process memory;
- `g1.6 preflight|run|replay` binds the four-file runtime-service-capability
  slice to a frozen two-path evaluator. The public evaluator identity remains
  the added `sparql_effective_capabilities` target, while private repository
  validation also freezes the modified CLI service-description tests, their
  Git order, and both blob/content identities. The task derives federation and
  remote-load claims from the shared evaluator's effective handlers, egress
  policy, and compiled transport without DNS or network probes; the server
  profile remains deny-all while standalone CLI query/update stay permissive.
  Its seven ordered stages are format, build, public, service, compatibility,
  independent, and regression. Verification runs the four-test
  `sparql_effective_capabilities` integration target as `public`, then runs
  only the 17 feature-active filtered
  `service_description::tests::` binary-unit tests as a separate bounded
  `service` stage. The separate `compatibility` stage requires exactly one
  ignored
  `service_description::tests::dependency_qualified_library_tls_is_enforced_without_cli_tls`
  canary under dependency-qualified library TLS with every CLI TLS feature
  disabled. The final frozen references require exactly one `independent` and
  12 `regression` results; unrelated CLI binary tests are outside these argv
  surfaces.
  The verifier disables Cargo incremental state and test-profile debug info to
  keep cold state deterministic and bounded. Command timeout or exhausted
  verifier state (`ENOSPC`/`EDQUOT`) is infrastructure-inconclusive, cannot
  trigger a repair lane, and cannot mint routing quality. G1.6 requires exact
  counted-stage results 4/17/1/1/12. Five- and six-stage historical contracts
  and their existing application receipts remain replayable;
- `g1.7:preflight`, `g1.7:run`, and `g1.7:verify` use a separate qualification
  binary rather than the application-task registry. Exact qualification
  contract v7 has SHA-256
  `42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80`.
  Its exact proposed control authorization and final decision set have raw
  SHA-256 values `31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767`
  and `b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5`.
  They remain `CONTROL_AUTH_PROPOSED` and `PROPOSED`/`UNAPPROVED`, so `run`
  exits 4 before identity, copied evidence, build, runtime-directory creation,
  or samples and writes no G1.7 run. A final binding remains non-authoritative
  until canonical control-receipt replay exists. Contract v1/v3/v4/v5/v6 bytes
  use Darwin-free pure `LEGACY_REPLAY_ONLY` dispatch; v5 and v6 proposed
  protocol artifacts are separately frozen by exact byte identity. Synthetic
  owner fixtures test replay but are not production owner evidence. The
  accepted G1.4b receipt is
  exact-bound at the prerequisite boundary, with projection `d57eb7cb...` and
  binding `5a4f5721...`, but it cannot replace the control receipt or execution
  owners. No controls, samples, benchmark result, current-v7 receipt,
  qualification, or promotion exists. The implemented lifecycle is a two-phase
  human gate: authorize permanently non-promoting negative and A/A controls,
  seal/replay them, then approve one final decision set binding that control
  receipt and the G1.4b prerequisite before subject/reference qualification.
  Promotion remains a later human-only action. V7 preserves v6's exact frozen
  authorization-bound sample-set framing/order, paired 10% negative-control
  non-inferiority, shared-seed two-direction 5% A/A equivalence, the inclusive
  5% MAD noise boundary, and mechanical FAIL/INCONCLUSIVE/PASS precedence. Its
  pure replay is differential-tested against the exact installed Darwin 0.9.3
  source modules; it is not a live control run or receipt;
- upstream merge `e9d2db1b` is exact-tree audited and is now the v7 product
  subject. Commit `d1e18c6e` binds its exact tree and `Cargo.lock`, records the
  evaluator as already present, separates the later control commit through
  qualified identity v2, and archives v6 byte-for-byte. Reseal task
  `task-1787888366495-gzxbhe` is complete, but grants no execution authority;
- `receipt verify` independently verifies stored application receipts without
  granting promotion authority;
- application receipt v6 adds an exact `candidateRejections` collection and
  event kind. Each record binds one candidate execution, one successful
  implementation or repair invocation, its patch SHA-256, a typed
  reconstruction/applicability phase and failure code, and a digest of bounded
  canonical failure detail. One invocation may be represented by an attempt or
  one rejection, never both; paired lanes are not deduplicated by patch digest.
  These pre-verifier failures authorize no Router quality. Candidate-disposal
  failure is outside this evidence type and aborts receipt minting;
- v5 retains bounded rejected critique and review diagnostics together with the
  optional exact-count `compatibility` verifier stage; v4 preserves both
  diagnostics as mandatory, and v3 keeps rejected critique diagnostics
  mandatory with rejected review diagnostics optional for historical replay.
  Versions v1-v5 are byte-exact replay-only and cannot mint current routing
  quality;
- `factory diagnose` evaluates disposable `metaharness new` output without
  adopting its publication settings, broad permissions, legacy dependencies,
  or nonexistent MCP commands;
- no generated host configuration is installed; and
- no MCP server is registered until one canonical command registry is exercised
  through both the CLI and real JSON-RPC tests.

The committed control surface is now generated from one fail-closed registry.
`engineeringTaskRegistry` is the sole ordered identity authority for these
exact task IDs:

```text
g1.2-rocksdb-serialized-writers
g1.3-transaction-capabilities
g1.4-bounded-writer-admission
g1.4a-store-terminal-outcomes
g1.4b-outcome-fault-safety
g1.5-unified-egress-policy
g1.5b-update-cancellation
g1.5c-negotiated-update
g1.6-runtime-derived-service-claims
```

Each contract path is derived as `tasks/g1/<slug>/contract.json`; public contract, preflight,
programme, and replay APIs select by canonical `taskId` only. Unknown,
path-like, inherited, accessor-backed, duplicate, or caller-path-selected task
identities are rejected before filesystem, runtime, verifier, or receipt I/O.
The exported per-G1 profiles, contract-path constants, and named wrappers are
compatibility shims over that generic task API, not parallel dispatch
authorities.

The same registry generates the task portion of an exact ordered 33-command
CLI surface. The CLI resolves a slug to its registered `taskId` and dispatches
preflight, run, and replay dynamically; the registry admits no extra, missing,
duplicate, reordered, or malformed command. Its canonical order is:

```text
doctor           -> doctor
g1.2.preflight   -> g1.2 preflight
g1.3.preflight   -> g1.3 preflight
g1.4.preflight   -> g1.4 preflight
g1.4a.preflight  -> g1.4a preflight
g1.4b.preflight  -> g1.4b preflight
g1.5.preflight   -> g1.5 preflight
g1.5b.preflight  -> g1.5b preflight
g1.5c.preflight  -> g1.5c preflight
g1.6.preflight   -> g1.6 preflight
g1.2.run         -> g1.2 run [--run-id <safe-id>]
g1.2.replay      -> g1.2 replay --receipt <runtime-name>
g1.3.run         -> g1.3 run [--run-id <safe-id>]
g1.3.replay      -> g1.3 replay --receipt <runtime-name>
g1.4.run         -> g1.4 run [--run-id <safe-id>]
g1.4.replay      -> g1.4 replay --receipt <runtime-name>
g1.4a.run        -> g1.4a run [--run-id <safe-id>]
g1.4a.replay     -> g1.4a replay --receipt <runtime-name>
g1.4b.run        -> g1.4b run [--run-id <safe-id>]
g1.4b.replay     -> g1.4b replay --receipt <runtime-name>
g1.5.run         -> g1.5 run [--run-id <safe-id>]
g1.5.replay      -> g1.5 replay --receipt <runtime-name>
g1.5b.run        -> g1.5b run [--run-id <safe-id>]
g1.5b.replay     -> g1.5b replay --receipt <runtime-name>
g1.5c.run        -> g1.5c run [--run-id <safe-id>]
g1.5c.replay     -> g1.5c replay --receipt <runtime-name>
g1.6.run         -> g1.6 run [--run-id <safe-id>]
g1.6.replay      -> g1.6 replay --receipt <runtime-name>
receipt.verify   -> receipt verify --receipt <runtime-name>
history.inspect  -> history inspect
factory.diagnose -> factory diagnose --claude <outside-path> --codex <outside-path>
help             -> help
version          -> version
```

The right-hand forms are the usage strings printed by `help`. Commit
`4a15caa07df37d884e7c74d4b69c0505ce3de6e1` implements this control. Its
committed tree passes all 180 engineering-harness tests and reports
`runner-implemented` from `doctor`, with all five dependencies requested from
`latest`, both native host interfaces valid, `mcpRegistered: false`,
`localOnly: true`, and `promotionAuthority: false`.

Commit `afe30c7de7e3df6e72a0a855d83efc612339f261` implements the follow-on
rejection-evidence control. Its committed tree passes all 194 harness tests and
the same doctor boundary. Adversarial coverage includes two independently
failed provider lanes, a mixed accepted/rejected run, frozen-submodule and
thrown-verifier failures, repair reconstruction, exact event ordering,
identical-patch lane separation, raw-detail non-retention, disposal abort, and
fixed SHA-256/byte-length replay fixtures captured from pre-v6 v1-v5 receipts.
The detail digest is hash-bound evidence, not a signature or a way to recover
the deliberately discarded raw error.

G1.3 product commit `3bf9468c` has also passed the harness's direct candidate
reconstruction and frozen verifier: exact patch `2d5412df6210246266426e3b7ee8be599744fc1093c9ac272b8d8d64a34fef04`,
candidate tree `b369e766a3f8c02f6d580924dd943e08ebafcdf0`, unchanged protected
manifest, and green format/build/public-9/independent-3/regression-3 stages.
The earlier application runs remain useful routing and failure evidence; they
do not replace this source-bound product verification or grant promotion
authority.

G1.4 product commits `b2ed9119` and `5a704914` also passed direct candidate
reconstruction and the frozen verifier. Contract
`cc20ae29420ff2a3b328b35bdc8f26dcd6cd39e978ec6fcfc0de93290334df39`
admitted exact patch
`47bfdb31333a13ba5d90bca3f06767fe889f05c0e9aebf5b3628d3942eafa7db`
as candidate tree `7d47e7352d64171563da8dd8d00fcb9b4c1f790d`, retained protected
manifest `537184400702bd927208c3f314c014386a65390061f263d7924855d38777bb3b`,
and returned `ACCEPT` for format/build/public-6/independent-2/regression-2 in
313.959 seconds. The verifier session artifact has SHA-256
`1a6061c95e1cf960aeb8d7f0145b032c60a0423e0f69afbc5a92731a3594729a`.

G1.5c product commit `3afe1e78` passed its direct frozen verification after an
exact `CONFIRMED_RED` preflight. Contract
`05b6ba498344fc412a810bb79eb80344f90577a442ce03c41637cbabd4a26ce1`
admitted the 7,252-byte three-path patch
`229d326bb22f46b992bc6d6212be1346de88b0d5bf1b9cad56dc0150611066c8`
as candidate tree `40137fa6306e8c282da16fbeb0d46418e27d0f3a`, retained the
1,389-entry protected manifest
`f0d009cd1b48b6c850b45026a2956fea752c8e9cf932022d7e34aa37cf5fb2bb`,
and returned `ACCEPT` for format/build/public-5/independent-15/regression-21 in
1,337.018 seconds. The 118,202-byte verifier session has SHA-256
`94461758757f1d4402713f6bed115e1bbd318d1fc35b02c7ea2c3b27a2b3f23b`.

G1.6 exact product commit `96d0ae7b177026506f4c8bfc74cf2eb88e71abc4`
is integrated unchanged by merge commit
`baeabb067c8c8419973842e5e060adf832e3f738`. Evaluator
`8dcb795a08e3605c18c662d13b040311a260ac2b`, evaluator tree
`973d5ed5615fc2f34a1e9d0da657d01f5c899755`, evaluator patch SHA-256
`93893693ed9804d56589169168c4dcd464bdeef2bc8dfea9e0eee0689888cee6`,
contract SHA-256
`abd16ee2f4d2c7c4b89b651e9412e126cac468456e7a1633c1143dce1f5accd3`,
and protected 1,398-entry manifest SHA-256
`a5c3f5c448a9aa1a615f7b4b1d60b8c5e43965240c5981acb66fa356831b155f`
bound the accepted run. The exact product patch SHA-256
`6ac04ebee08ce571e403a3937c41d258521bf9e172b2f3e666949266b73239b3`
reconstructed candidate tree `269ccb9b519c6beaf311bfc9ec5c7539acb79498`.
After a `CONFIRMED_RED` preflight, the verifier returned `ACCEPT` for
format/build/public-4/service-17/compatibility-1/independent-1/regression-12
in 1,153.499 seconds. Its 126,368-byte artifact has SHA-256
`4ff0fdafa3b8584f81033a89000814320a952bbc384523cd72dd57150963458b`.

The exact negative-control matrix also closed:

- Earlier-product patch
  `1b30556c3392aaf1a4f0041ce3f69fd00a929fba4fd62ee2b4c04edb6297566e`,
  tree `7b3cf9567cd6ca763165f38727675dec66870c00`, candidate
  `9aad0121280e32ddbbc0893c4cc583d10f065eb7`, was rejected after public-4,
  service-15 with two failures, compatibility-0 with one failure,
  independent-1, and regression-12. Its 1,139.452-second verifier artifact is
  `96dc288bc70f5d5dfb62ce02d5954330534ac7921da17e912d74af4b6a200740`;
  atomic outer evidence is
  `9e5c54a5e687948b4183bb57878764975cc0a7701a86e02ce3ab8254eb89287c`.
- Union-only patch
  `543379f0df24e5f8e144239d7dc674e1e618521494fa9f0c7b2132b12e88e330`,
  tree `f249d49ebf440734e0e05368ea78ac6c0f444e52`, was rejected after
  public-4, service-16 with one failure, compatibility-1, independent-1, and
  regression-12. Its 1,148.684-second verifier artifact is
  `393b8c7239986a654e80f5213b653ea5c494fec4878b7fd79ced9a9c39321046`.
- CLI-TLS-gated server patch
  `e3f15a88f61711873a1e7f9f41a79fae737b8531d9f9422309ec7d488e4e9578`,
  tree `964a63bf5f91a44f569565e1fa1de7bb262ce7cd`, was rejected after public-4,
  service-17, compatibility-0 with one failure, independent-1, and
  regression-12. Its 1,147.933-second verifier artifact is
  `3635ef690d75d10d8d5b4d7b316b7c6d487d7f6e9a8b47055a0c86630e387f5d`;
  atomic outer evidence is
  `33049ddad8d1136015f7b5a866ba4ba9b8e0d2953606de9195d7ef7f17c38333`.

A direct verifier test rejects compatibility counts of zero or two. These are
verifier-session artifacts, not application receipts. The contract remains
`localOnly: true` and `promotionAuthority: false`; acceptance neither qualifies
semantics nor authorizes product promotion or publication.

Install and verify from this directory:

```bash
npm ci --ignore-scripts
npm test
npm run doctor
npm run g1.3:preflight
npm run g1.4:preflight
npm run g1.5:preflight
npm run g1.5b:preflight
npm run g1.5c:preflight
npm run g1.6:preflight
npm run g1.7:preflight
```

At the fail-closed v7 checkpoint, `npm test` reports 415 tests: 413 pass, none
fail, and two intentional live-host tests are skipped. `npm run doctor` passes
with 33 registered application commands and the latest-policy lock resolving
AVO 0.1.4, Darwin 0.9.3, Harness 0.2.0, Router 0.4.0, and MetaHarness 0.4.8.
Those versions are lock evidence, not a promise that future `latest` tags will
remain unchanged.

The package is local-only. Presence of this directory is not an engineering
readiness, product-correctness, semantic-qualification, or promotion claim.
