# Oxigraph engineering harness

This private package is the application-development control plane accepted by
ADR-0017. It is separate from `tools/metaharness`, which remains the immutable
semantic-qualification adapter.

The package requests current upstream `latest` dist-tags. Its committed npm
lock binds exact registry tarballs and SHA-512 integrity, and `.npmrc` disables
lifecycle scripts. Runtime publication and OpenRouter transport are forbidden.

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
  Verification runs the four-test `sparql_effective_capabilities` integration
  target as `public`, then runs only the 17 feature-active filtered
  `service_description::tests::` binary-unit tests as a separate bounded
  `service` stage; unrelated CLI binary tests are outside both argv surfaces.
  The verifier disables Cargo incremental state and test-profile debug info to
  keep cold state deterministic and bounded. Command timeout or exhausted
  verifier state (`ENOSPC`/`EDQUOT`) is infrastructure-inconclusive, cannot
  trigger a repair lane, and cannot mint routing quality. Five-stage contracts
  and their existing receipts remain replayable;
- `receipt verify` independently verifies stored application receipts without
  granting promotion authority;
- `factory diagnose` evaluates disposable `metaharness new` output without
  adopting its publication settings, broad permissions, legacy dependencies,
  or nonexistent MCP commands;
- no generated host configuration is installed; and
- no MCP server is registered until one canonical command registry is exercised
  through both the CLI and real JSON-RPC tests.

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
313.959 seconds. The verifier session receipt has SHA-256
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
```

The package is local-only. Presence of this directory is not an engineering
readiness, product-correctness, semantic-qualification, or promotion claim.
