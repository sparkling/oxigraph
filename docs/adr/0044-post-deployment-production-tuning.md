# ADR-0044: Post-deployment production tuning

- **Status**: Accepted
- **Date**: 2026-09-19
- Deciders: Oxigraph parity programme
- Implementation status: not applicable. This record defines a boundary, not a
  feature. It holds no code and blocks nothing.
- **Related**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md),
  [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](0042-retain-rocksdb-and-gate-replacement-backend-experiments.md),
  [ADR-0043 — Delivery recovery and proportional release boundary](0043-delivery-recovery-and-proportional-release-boundary.md)

## Context

Several ADRs in this programme end with a criterion of the form "freeze
throughput and p95 latency," "establish the numeric default," "show
reproducible benefit on a target cohort," or "promote after parent-first
baselining." Those sentences describe calibration against a real workload.
They do not describe code.

For a long stretch of delivery this distinction was lost. Criteria of that
shape were read as gates over the surrounding feature, and work that was
plainly implementable — evaluators, oracles, differential fixtures, adversarial
coverage, benchmark harnesses — was declined as "evaluator-authority-gated"
or "awaiting promotion evidence." The effect was a programme reporting that no
deliverable work remained while a dozen named, buildable obligations sat
unwritten in the ADRs. That was a bookkeeping failure, not a real constraint.

The correction is to name the post-deployment tier explicitly, once, here, so
that no other ADR's exit criteria can be misread as a development gate again.

## Decision

Every remaining obligation in this programme falls into exactly one of three
classes. The class determines whether it blocks development.

**Class A — buildable now.** Ordinary delivery. Includes writing evaluators,
eligibility oracles, frozen-corpus fixtures, differential tests, adversarial
resource coverage, crash matrices, and **benchmark and measurement harnesses,
including running them and recording the numbers**. Large scope is not a
blocker; large work is sliced. A missing consumer is not a blocker; the
consumer is built too. Class A work proceeds without authorization.

**Class B — externally blocked.** Only two shapes qualify: a dependency that
is physically absent (a host that does not exist, a credential nobody holds,
an unreachable service), or a dependency on a third party stabilizing something
outside this repository (an unresolved specification draft question). Class B
items are recorded with the exact missing thing named.

**Class C — post-deployment tuning.** This record's subject. Work that can only
be done meaningfully once the application is operational in a real production
setting, against real traffic, real data volumes, and real hardware.

A measurement taken on a development host is a Class A artifact and is labeled
**demo-grade**. The same measurement repeated in production against real load,
and then frozen as the basis of a promotion decision, is Class C. The harness
is built once and serves both; only the claim attached to its output differs.

### What is Class C, exhaustively

1. **Numeric default and ceiling calibration.** ADR-0027 states that "numeric
   defaults and regression ceilings are frozen only after parent-first
   baselining" and that it "does not invent production capacity values."
   Queue depths, deadline defaults, per-principal caps, and operator budget
   ceilings are tuned to observed production load. Development supplies the
   mechanism and demo-grade measurements; production supplies the numbers.
2. **Promotion decisions.** Flipping an opt-in path to a default: ADR-0023's
   bounded join planning ("before a speed claim or default promotion"),
   ADR-0024's spatial provider, ADR-0033's `Auto` mode. Each requires
   reproducible benefit on a predeclared cohort of real queries.
3. **Independent resource probes.** ADR-0027 requires, for promotion only, "a
   frozen public evaluator plus an independent resource probe that cannot
   inspect implementation counters directly." Externally observed resource
   behavior is a production-observation instrument.
4. **Capacity and sizing.** Index build time and on-disk size against real
   corpus volumes; peak resident memory under real concurrency; prefix-Bloom
   filter policy for RDF column families, whose value depends on real
   negative-prefix access patterns rather than synthetic ones.
5. **Real-principal fairness tuning.** Weighted service shares and aging
   parameters calibrated against the actual distribution of principals and
   query shapes, which no fixture predicts.
6. **Threshold freezing for qualification evidence.** Where an ADR requires a
   reference, budget, or threshold to be approved **before** samples are
   produced — G1.7 and ADR-0041 in particular — that ordering is a genuine
   evidence-integrity constraint, not ceremony. An evaluator tuned after seeing
   its own results proves nothing. The evaluator is Class A and gets written;
   the pre-result freezing and the sampling run it gates are Class C.

### What Class C explicitly does not cover

Class C does not cover, and must never be cited to defer:

- writing any evaluator, oracle, fixture, or test, including adversarial and
  crash-matrix coverage;
- building a benchmark or load-generation harness, running it on this server,
  and recording demo-grade results;
- adding instrumentation a measurement needs (for example, cancellation-latency
  histograms, which ADR-0027's operational criterion requires and which are not
  yet instrumented);
- implementing a feature whose ADR happens to also contain a promotion
  criterion;
- deploying to this server.

## Security and operational behavior

- Demo-grade measurements are labeled as such wherever recorded, and are never
  described as frozen production promotion evidence, qualification receipts, or
  a basis for a performance claim.
- Production tuning changes bounded policy values. It does not change semantics,
  result multisets, error dispositions, or storage formats. A tuning change that
  would alter behavior is a feature change and returns to Class A with its own
  ADR review.
- This record grants no authority it does not already hold: no promotion, no
  publication, no G1.7 qualification, no default exposure, and no remote push.

## Explicit non-goals

- Inventing production capacity numbers in advance.
- Blocking deployment to this server on any item above.
- Treating this record as a place to park work that is merely large,
  unscaffolded, or lacking a consumer. Those are Class A and get sliced.
- Replacing the owning ADRs' own acceptance criteria. Each ADR keeps its
  criteria; this record only classifies them.

## Consequences

- Development proceeds against Class A until Class A is empty, without pausing
  for authorization it already has.
- The programme can state honestly what remains: a buildable backlog, a short
  Class B list with the missing dependency named, and this Class C tier that
  opens only once the application is live.
- Deployment to this server is unblocked by construction, because nothing in
  Class C precedes it.
- Some Class C items may never be exercised if the application is not promoted
  to a production setting. That is an acceptable outcome and not a delivery gap.

## Alternatives rejected

- **Leave the criteria distributed across the owning ADRs.** That is the status
  quo that produced the misreading; the tiers were adjacent in the same bulleted
  lists and got conflated.
- **Delete the criteria as unreachable.** They are correct requirements for a
  production promotion; the error was treating them as development gates.
- **Treat every measurement as production-grade.** A number measured on a
  development host under synthetic load is not evidence about production, and
  labeling it so would be the dishonest inverse of the original error.

## Evidence and task ownership

This record owns no implementation task. Each Class C item remains recorded in
its originating ADR's own acceptance section, and its status there is unchanged
by this classification. The current Class B list is: a separate authorized
isolated host for delegated qualification runs (ADR-0039), and the unresolved
upstream RDF Rules draft dispositions behind two invalid SHACL fixtures
(semantic-parity plan item 2, issues 1069 and 1074).

Amended 2026-09-19: this list originally also carried macOS and Windows
reproduction runners. Classifying them as Class B was accurate but the wrong
remedy — an obligation that can never be discharged does not belong in an
acceptance list at all. Those platforms are now out of scope entirely and the
target is Linux x86_64 only, per
[ADR-0045](0045-linux-only-target-platform.md). Class B is for a dependency
that is absent *now* and could plausibly arrive; permanently unreachable scope
gets removed instead.
