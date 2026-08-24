# ADR-0017: Repository evolution and evidence promotion harness

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-24
- Deciders: Oxigraph parity programme
- Implementation status: Ruflo research orchestration, local MetaHarness read
  checks, policy-only synthetic Darwin qualification, and a user-scoped Dream
  Machine installation are verified; unattended Dream Machine execution is
  deferred behind the activation gates in this ADR
- Related:
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md),
  [ADR-0012 — Immutable broad Jena differential harness](0012-immutable-broad-jena-harness.md),
  [ADR-0013 — Mutation competence and provenance](0013-mutation-competence-and-provenance.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)

## Context

The linked-data-store programme now spans transactional persistence, standards
conformance, compatibility differentials, mutation testing, security, and
performance. Parallel research and bounded harness evolution can reduce the
cost of that work, but a second semantic runner or an autonomous publication
path would weaken the evidence boundary already established by ADR-0004,
ADR-0005, ADR-0012, and ADR-0013.

The repository already owns stronger proof than a generic agent loop:

- exact native Cargo, W3C, Jena, and Souffle commands;
- schema-v4 Agentic-QE receipts and immutable run publications;
- source-bound mutation receipts;
- a policy-only Darwin adapter with protected-input hashing; and
- an independent MetaHarness qualification verifier.

Dream Machine 0.1.1 is installed under the user npm prefix and its local CLI is
deterministic. The audited upstream source at commit
`8ce385786faa5e63cc0e7105cc6e96f663a51f07` does not, however, provide config
fields for native-provider-only execution, local-only publication, protected
paths, or shell-free evaluator argument vectors. Its compiled routine names an
OpenRouter credential, instructs creation of a public gist plus an issue,
branch push, and draft PR whose visibility follows the target repository, and
accepts executable-looking strings from config. The published CLI itself makes
no provider call and needs no model key; `/schedule` only emits workflow JSON
and defaults to a Claude model. OpenRouter is instead hard-coded in the
optional, disabled research workflow and appears as an example in the compiled
prompt. The npm 0.1.1 artifact also differs from current source carrying the
same version. These are activation blockers, not reasons to duplicate the
engine locally.

The current evidence plane has three independent fail-closed drifts after the
write-interface work:

- the reviewed Jena profile lock seals subject hash `1fe53cef...`, while the
  current subject recomputes to `997e2579...`; and
- Agentic-QE expects 133 default and 116 no-default CLI tests, while the current
  exact inventories contain 144 and 129 tests; and
- the OxDatalog mutation receipt remains valid for its sealed source snapshot,
  but that snapshot predates the protected `lib` changes and cannot satisfy a
  current full MetaHarness binding.

Full semantic MetaHarness qualification is therefore unavailable until a
reviewed evidence refresh closes all three inputs. A passing synthetic Darwin
run proves only the policy mechanics.

## Decision

Adopt a thin, local-first evolution control plane. It coordinates existing
authorities and may not replace them.

| Component | Permitted role | Not an authority for |
|---|---|---|
| Ruflo swarm, tasks, goals, and AgentDB | Parallel research, dependency state, transient project memory, and anti-drift coordination | RDF semantics, promotion, or release claims |
| RuvNet Brain | Source-grounded guidance for the rUv stack | Oxigraph behavior not established by local source/tests |
| MetaHarness genome, score, and OIA | Advisory readiness, risk, and infrastructure analysis | Product correctness or current semantic qualification |
| Darwin | Bounded evolution of ADR-0004's seven harness-policy surfaces | Rust source, manifests, expected results, thresholds, or semantic answers |
| Agentic-QE | Exact profile coordination and schema-v4 evidence publication | A simulated or JavaScript substitute for native Rust execution |
| Dream Machine | Local version/config compilation, rotation vocabulary, three-verdict discipline, and a secondary ledger | Scheduling, provider routing, publication, promotion, or replacement receipts |
| Native and differential runners | Pass/fail evidence for their exact named scopes | Claims broader than their reviewed inventories |

The execution rules are:

1. Implement one product capability slice before expanding its harness.
   Harness work remains proportional and should not exceed 20% of a programme
   slice without an explicit review.
2. Parallelize independent research, test design, and adversarial review.
   Permit one candidate writer and one conceptual change per evaluation.
3. Use isolated worktrees and isolated Cargo target directories for concurrent
   writers. Agentic-QE publication, Jena publication, mutation publication,
   and full MetaHarness qualification remain sequential because they share
   locks, protected snapshots, or mutable latest pointers.
4. Freeze the hypothesis, evaluator inventory, fitness function, thresholds,
   and baseline before the candidate runs. Evaluate parent and candidate on
   the same corpus.
5. Protect Rust source, standards inputs, expected outcomes, test inventories,
   thresholds, dependency manifests, CI, ADRs, and receipt validators from
   Darwin mutation. Failed and rejected variants remain evidence.
6. Require `ACCEPT`, `REJECT`, or `INCONCLUSIVE`; missing credentials, stale
   locks, incomplete inventories, silent evaluators, and unverifiable receipts
   produce `INCONCLUSIVE` or `REJECT`, never fabricated success.
7. Promotion is a human decision. No push, gist, issue, PR, deployment,
   schedule, merge, or public upload is allowed without explicit authorization
   in the active task.
8. Model execution uses native provider clients and authentication only.
   OpenRouter is prohibited, including fallback or retry routing.

The installed source-backed infrastructure audit is **OIA** (Open
Infrastructure Architecture, layers L1-L9). Its point-in-time result is an
advisory read, not a durable qualification receipt. No OVA-named Dream Machine
or Ruflo component was found in the installed source, so OVA is not used as a
plan or evidence label.

## Dream Machine activation gates

Dream Machine remains unscheduled and uncommitted as a repository runner. Gates
1-7 are prerequisites that must be revalidated at the start and end of each
proposed run; later source, package, inventory, policy, or repository drift
reopens them. Gate 8 is per-run authority and never closes permanently:

1. **Supply chain:** select a source-corresponding, reviewed, immutable package
   or build; verify registry integrity/signature or provenance, `gitHead`,
   installed bytes, and an exact source commit; pin every optional evaluator
   backend; prohibit lifecycle scripts. The observed npm 0.1.1 artifact has
   integrity
   `sha512-ChagmBIuBHesdqW3nENh+heJgjHiIsSu4pLEX5Mp9X4orXDiUIb5xdsX4g3C8xSrMwzhyK+QO5jxENSMbgTcDg==`,
   shasum `93c9ff8f58e942899b99397f64416a6aedea7b79`, and `gitHead`
   `3de01079abe64e4a1f2d3fe3b758523705b3bf47`. The installed
   `package.json` and `dist/bin.js` SHA-256 values are respectively
   `0768ae19c78df7bb6dc5a0a584329fe7d8a9e69c98242d9ce1546261cc195428`
   and `359bb2c1d9f9e85f8fe627fd51c304c81a4ea965ddfac968c6c13231a665da37`.
   These observations do not close the gate: GitHub has no `v0.1.1` tag or
   release, the npm attestation endpoint returned 404, and correspondence
   between those bytes, that `gitHead`, and the audited source remains
   unverified.
2. **Provider policy:** express and enforce a native-provider allowlist with no
   OpenRouter example, secret, endpoint, workflow, fallback, or retry.
3. **Publication policy:** express `local-only` in config and enforce it below
   the prompt layer. `autoMerge: false` is necessary but insufficient.
4. **Execution policy:** replace shell command strings with reviewed executable
   and literal-argument vectors; constrain network, filesystem, and protected
   paths; reject exit-zero/silent evaluators without a required artifact.
5. **Repository adapter:** delegate to the existing Agentic-QE and
   MetaHarness entrypoints; do not copy CI logic or introduce another receipt
   format. The Dream ledger is secondary to the conformance ledger and native
   receipts. Upstream's Actions helper currently hashes a report and then
   appends the witness to the same report, invalidating the hash. Require a
   finalized-report-byte round trip and store the witness separately; a stamp
   over subsequently modified bytes is invalid.
6. **Isolation:** run only from a clean, disposable worktree with bounded
   resources and no ambient GitHub publication authority.
7. **Evidence repair:** refresh the Jena subject lock through its separate
   reviewed operation, update exact Agentic-QE test inventories, run the Jena
   profile, verify the mutation harness and regenerate the exact OxDatalog
   receipt with pinned `cargo-mutants` 27.1.0, freeze all protected ADR, plan,
   and research documents, then close full MetaHarness qualification and
   independent evidence verification.
8. **Operator decision:** obtain explicit authorization for any schedule or
   external publication after reviewing the generated routine byte-for-byte.
   Re-obtain it for every active task and exact generated artifact.

Generated Dream prompts are never hand-edited into compliance. Either the
compiler/config model enforces these gates or the runner stays disabled.
Every activation attempt must also emit a machine-readable, independently
verifiable status record. For each gate it binds the package digest and source
commit, literal negative-test command and verifier-output hash, observation
time and freshness/expiry rule, exact generated-artifact digest, disposition,
and approving actor. Prompt text and a bare checksum are not closure evidence.

## Consequences

- The programme gains parallel research, durable task state, frozen
  hypotheses, and bounded policy evolution without creating a second oracle.
- Dream Machine's useful vocabulary and deterministic tools can be evaluated
  locally while its high-authority autonomous path remains disabled.
- Existing fail-closed drift is visible. Historical Jena and mutation receipts
  remain valid for their sealed July subjects but are not current-HEAD proof.
- A synthetic Darwin qualification may demonstrate deterministic policy
  mechanics, but only a fresh full qualification plus independent verification
  supports a semantic-qualification claim.
- Volatile `.claude-flow`, `.claude`, `.swarm`, RVF, RuVector, and `var` state
  remains local runtime state and is not a committed harness definition.

## Alternatives rejected

- **Schedule Dream Machine immediately.** Rejected because provider,
  publication, protected-path, shell, evidence, and supply-chain controls are
  not expressible in its current config.
- **Post-process the generated prompt.** Rejected because it creates a
  hand-maintained, unverifiable fork of the compiler output.
- **Replace Agentic-QE receipts with Dream witnesses.** Rejected because a
  checksum is not the repository's source-, inventory-, artifact-, and
  execution-bound evidence contract.
- **Let Darwin edit Rust or evaluators.** Rejected by ADR-0004; it permits
  reward hacking and invalidates the oracle boundary.
- **Run every evidence profile on every candidate.** Rejected because it
  duplicates expensive work. Use an affected fast gate, then the sequential
  full gate only for a promotion candidate.
- **Commit generic Ruflo runtime output as the harness.** Rejected because the
  current generated policies classify this Rust workspace generically and do
  not encode its immutable semantic authorities.

## Evidence

- [Execution plan](../plans/linked-data-store-evolution-harness-plan.md)
- [Existing policy-only qualification adapter](../../tools/metaharness/qualify.mjs)
- [Existing independent verifier](../../tools/metaharness/verify.mjs)
- [Agentic-QE profile registry](../../tools/agentic-qe/profile-definitions.mjs)
- [Reviewed Jena profile lock](../../tools/jena-parity/profile.lock.json)
- [Dream Machine audited source](https://github.com/ruvnet/dream-machine/tree/8ce385786faa5e63cc0e7105cc6e96f663a51f07)
- [Dream config schema](https://github.com/ruvnet/dream-machine/blob/8ce385786faa5e63cc0e7105cc6e96f663a51f07/packages/compile/src/config.ts)
- [Dream compiled pipeline](https://github.com/ruvnet/dream-machine/blob/8ce385786faa5e63cc0e7105cc6e96f663a51f07/packages/compile/src/index.ts)
- RuvNet implementation source:
  `metaharness/packages/darwin-mode/src/evolve.ts` and
  `metaharness/packages/darwin-mode/src/bench/gates.ts`

Non-authoritative local verification on 2026-08-24 established:

- Dream Machine 0.1.1 at `/home/claude/.local/bin/dream-machine`;
- byte-identical output from two config compilations;
- a missing-ledger path that reported an empty valid ledger because npm 0.1.1
  catches ledger read errors; this is not ledger-validation evidence, and
  activation requires an explicit existing ledger whose absence and read
  errors fail distinctly;
- MetaHarness genome `ready`, risk `0.21`, test confidence `0.8`;
- harness score 71/100, with tool safety 100 and memory usefulness 40;
- a point-in-time OIA dry-run reporting composite security severity `clean`
  but generic `unknown-harness@0.0.0` identity; no durable OIA receipt was
  produced, so this is advisory only;
- repository MetaHarness tests 13/13 and synthetic qualification `PASS`; and
- a deterministic two-generation/two-child Darwin dry-run plan with no write
  execution.

## Decision boundary

This ADR is **Proposed** for repository adoption. The active-task constraints
that independently prohibit OpenRouter and unauthorized external publication
remain in force while it is reviewed. It does not claim that Dream Machine is
an approved unattended runner, that full MetaHarness qualification is current,
or that a generated candidate is safe to promote. Those claims require a human
decision on this ADR, continuously current prerequisites, per-run
authorization, an activation status record, and exact current receipts above.
