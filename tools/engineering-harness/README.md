# Oxigraph engineering harness

This private package is the application-development control plane accepted by
ADR-0017. It is separate from `tools/metaharness`, which remains the immutable
semantic-qualification adapter.

The package requests current upstream `latest` dist-tags. Its committed npm
lock binds exact registry tarballs and SHA-512 integrity, and `.npmrc` disables
lifecycle scripts. Runtime publication and OpenRouter transport are forbidden.

Current activation boundary:

- `doctor` verifies the local installation and dependency bindings;
- `factory diagnose` evaluates disposable `metaharness new` output without
  adopting its publication settings, broad permissions, legacy dependencies,
  or nonexistent MCP commands;
- no generated host configuration is installed; and
- no MCP server is registered until one canonical command registry is exercised
  through both the CLI and real JSON-RPC tests.

Install and verify from this directory:

```bash
npm ci --ignore-scripts
npm test
npm run doctor
```

The package is local-only. Presence of this directory is not an engineering
readiness, product-correctness, semantic-qualification, or promotion claim.
