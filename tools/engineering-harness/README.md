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

Install and verify from this directory:

```bash
npm ci --ignore-scripts
npm test
npm run doctor
npm run g1.3:preflight
```

The package is local-only. Presence of this directory is not an engineering
readiness, product-correctness, semantic-qualification, or promotion claim.
