# R1 application validation — 2026-09-07

The existing RocksDB-backed Oxigraph CLI was built and exercised as an actual
loopback HTTP server, stopped, and reopened against the same temporary store.

- Command: `cargo build --locked --release -p oxigraph-cli --bin oxigraph --jobs 4`
- Result: optimized release build passed in 1 minute 38 seconds.
- Compiler: `rustc 1.98.0 (88d9e12ae 2026-08-18)`.
- Binary: `target/release/oxigraph`, reporting `oxigraph 0.6.0-dev`.
- Binary SHA-256: `f1a59419858df05bbaaa3640ae447f5b19a6a59ce92a63d3aacb5f7f6adaea48`.
- Build source: `7d89e7bc`; Rust source, Cargo manifests/lock, and RocksDB
  sources matched that commit. The product delta is `eb0f0cc2`.
- N3 source fetchability is recorded [separately](n3-submodule-publication-2026-09-07.md).

The live demonstration passed 15 observations:

1. A multi-operation SPARQL Update returned HTTP 204.
2. An operation read data inserted earlier in the same request.
3. A query observed committed named-graph data.
4. An independently empty named graph returned HTTP 200 and no triples.
5. A later `CREATE GRAPH` against an existing graph failed deterministically.
6. The failed request's earlier inserted triple was absent.
7. The failed request's earlier created graph returned HTTP 404.
8. A new server process opened the same on-disk store.
9. Committed named-graph data survived restart.
10. The read-your-writes result survived restart.
11. Empty named-graph membership survived restart.
12. The rolled-back triple remained absent after restart.
13. The rolled-back graph remained absent after restart.
14. `CLEAR GRAPH` removed triples while retaining graph membership.
15. `DROP GRAPH` removed graph membership.

The failed request used a duplicate graph creation, not network failure:

```sparql
INSERT DATA { <urn:r1:rollback:s> <urn:r1:p> <urn:r1:o> };
CREATE GRAPH <urn:r1:rollback:g>;
CREATE GRAPH <urn:r1:empty>
```

`urn:r1:empty` had already been committed. The response was HTTP 500 with
an already-exists error, followed by false/404 checks for the staged changes.
All server processes were stopped after validation; the test did not expose
a public endpoint or change operator data.

The existing native regressions also passed:

```sh
cargo test --locked -p oxigraph --test update_atomicity \
  --test transactional_dataset --test dataset_topology --jobs 4
```

Results: update atomicity 2/2, transactional dataset 3/3, graph topology 9/9.
Earlier affected Rust, conformance, binding, and fuzz results remain recorded
in [ADR-0043](../adr/0043-delivery-recovery-and-proportional-release-boundary.md).
No new harness, dependency, qualification baseline, or expected result was
created for this demonstration. This is process-restart evidence, not a
power-loss durability, performance, production-operations, or full-parity claim.
