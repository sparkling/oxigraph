# ADR-0045: Linux-only target platform

- **Status**: Accepted
- **Date**: 2026-09-19
- Deciders: Oxigraph parity programme
- Implementation status: implemented. Apple and Windows CI jobs and release
  artifacts are removed; the Python minimal-dependency unittest leg that was
  unique to the Windows job is ported to Linux.
- **Related**:
  [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](0042-retain-rocksdb-and-gate-replacement-backend-experiments.md),
  [ADR-0043 — Delivery recovery and proportional release boundary](0043-delivery-recovery-and-proportional-release-boundary.md),
  [ADR-0044 — Post-deployment production tuning](0044-post-deployment-production-tuning.md)

## Context

The programme carried a three-platform target: Linux, Apple, and Windows. CI
ran `cargo test` on `macos-latest` and `windows-latest`, released wheels and
binaries for both, and the semantic-parity plan listed "platform
reproducibility evidence for Linux, macOS, and Windows" as a closure item.

No macOS or Windows host is available to this programme, and none will be
provisioned. The Apple and Windows legs were therefore not evidence of
anything — they were either unverifiable locally or running only in hosted CI
that the programme cannot reproduce, inspect, or debug. ADR-0044 had classified
the macOS and Windows reproduction runners as externally blocked (Class B) on
the grounds that the hosts are physically absent. That classification was
accurate but incomplete: an obligation that can never be discharged is not
blocked work, it is work that should not be on the list.

ADR-0044 recorded a second Class B item on the same grounds: a separate
authorized isolated host for delegated qualification runs (ADR-0039). That
requirement was dropped separately on the same day, for the same reason and by
the same reasoning — no such host exists or will — as were the reboot and
power-cut receipts that briefly survived it. ADR-0039 now qualifies fully on
this programme's own Linux host, and reboot/power-loss behavior sits outside
what qualification claims rather than inside it as a permanent gap. This record
does not itself resolve that item; see
[ADR-0039's amendment](0039-delegated-host-containment-qualification-and-readiness.md#amended-2026-09-19-the-delegated-host-is-this-server).

## Decision

The single supported target platform is **Linux x86_64**. Every test, every
build, every benchmark, and every release artifact targets Linux only.

Concretely:

- `test_macos`, `test_windows`, and `python_msv_windows` are removed from
  `.github/workflows/tests.yml`. The agentic-qe adapter suite that
  `test_windows` also ran is already covered by the Linux job, so no coverage
  is lost there. The Python minimal-dependency `unittest` leg was unique to
  `python_msv_windows`, so it is **ported** to a new `python_msv_linux` job
  rather than dropped; `test_linux_msv` continues to cover the Rust
  minimum-supported-version path.
- `wheel_mac` and `wheel_windows` are removed from
  `.github/workflows/artifacts.yml`, along with their entries in the
  `publish_pyoxigraph_pypi` and `publish_oxigraph_pypi` dependency lists. The
  Linux glibc and musl wheels are the complete release matrix. No Apple or
  Windows binary or wheel is produced or published.
- The semantic-parity plan's multi-platform reproducibility item narrows to
  Linux, which is ordinary buildable work rather than an externally blocked
  one.

No Rust source change is required: a search for `target_os = "windows"`,
`target_os = "macos"`, and `target_family = "windows"` across the workspace
returns zero matches, so there is no platform-conditional code to retire and
no dead `cfg` branch left behind.

## Security and operational behavior

- Removing a platform removes claims, not guarantees. Nothing in this change
  weakens a Linux behavior, and no test that ran on Linux stops running.
- The published artifact set narrows. Any downstream consumer expecting an
  Apple or Windows wheel from this repository no longer receives one. That is
  the intended, visible consequence.
- Portability is not asserted either way. The code may well build elsewhere;
  this programme simply produces no evidence for that and makes no claim about
  it.

## Explicit non-goals

- Claiming the codebase is Linux-specific. Upstream Oxigraph supports more
  platforms; this is a scope decision for this programme's evidence and
  release surface, not a statement about the code's portability.
- Removing anything that runs on Linux.
- Resolving ADR-0039's separate-isolated-host requirement, which is a
  different constraint and stays open.
- Reintroducing multi-platform support later without its own ADR. If a macOS
  or Windows host ever becomes available, restoring those legs is a new
  decision with its own acceptance criteria.

## Consequences

- CI is faster and cheaper, and every remaining job runs on a platform the
  programme can reproduce and debug directly.
- The semantic-parity closure backlog loses one Class B item outright and
  converts its Linux remainder to buildable work.
- The release matrix is Linux glibc plus Linux musl. That is the honest extent
  of what this programme tests.
- Platform-specific regressions on Apple or Windows will not be detected. Since
  they could not have been fixed or verified here either, the programme is not
  losing a capability it had.

## Alternatives rejected

- **Keep the jobs running in hosted CI.** They would produce pass/fail signals
  the programme cannot reproduce locally, investigate on failure, or attach to
  any receipt. A green check nobody can explain is worse than an absent one.
- **Mark the platforms `continue-on-error` and ignore failures.** The wheel jobs
  already carried `continue-on-error: true`, which is precisely the problem: a
  release leg that is allowed to fail silently is not a release guarantee.
- **Keep them as aspirational scope.** ADR-0044 exists to stop unreachable
  obligations from sitting in acceptance lists and being mistaken for pending
  work. Leaving these would repeat that error.

## Evidence and task ownership

CI definitions live in `.github/workflows/tests.yml` and
`.github/workflows/artifacts.yml`; both parse cleanly with no dangling job
dependencies after this change. The semantic-parity plan's platform item is
updated in place. No programme task is closed by this record: it removes scope
rather than completing it.
