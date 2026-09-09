# OxHTTP source provenance

This directory contains the source, licenses, README, changelog and tests from
the existing crates.io `oxhttp` 0.3.3 dependency. The original crate checksum is
`01d4ba13b109f473f649aa71dfc8a83c41cc0cd3eaf5f6adfe2a18046b985d8a`.
Upstream: <https://github.com/oxigraph/oxhttp>. Upstream `main` was inspected on
2026-09-09 and still lacked socket-context/header-admission APIs.

The published original manifest is used instead of Cargo's normalized copy;
the benchmark development dependency uses this workspace's existing compatible
version. Generated registry metadata and the crate's independent lockfile are
not copied. The workspace lockfile remains the dependency authority.

Fork changes are limited to the server's socket-derived `ConnectionInfo` and
optional pre-body request admission, their exports and native wire tests. The
encoder adds a server-controlled `Connection: close` path for admission denials;
its existing entry point still produces the original bytes. Client, parser and
body codec behavior are unchanged; one trailing-whitespace-only body doc line
is normalized for repository diff checks. ADR-0026 owns
the application identity/authorization contract; this library hook alone does
not implement it or grant publication/promotion authority.

The authenticated CLI wire test subsequently exposed an upstream CORS response
bug: the shared request-header filter dropped `Access-Control-Allow-Methods`.
Response encoding now preserves that field; client request filtering is unchanged.

Making this a workspace member also resolves the upstream optional AWS-LC TLS
feature's five transitive packages in `Cargo.lock`; none is enabled by the CLI's
default native-TLS build. Existing locked package versions are not upgraded.
