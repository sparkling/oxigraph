> Historical README excerpt; ordinary-policy instructions are superseded by [current guide](README.md).
> Frozen obligations and dated evidence retain their original scope. No new execution authority.

### ADR-0036 C16 checkpoint — 2026-09-02

The C15 section above remains historical evidence. C16 is GREEN from RED commit
`5f717090fcc118d299cadf446fe0703026d360b6` to integrated commit
`930a7722490b8ad63d6825a25bd7bcb138140dd3`, tree
`2492ce6e2dd4f73e1c9749e657f05e09e71fd962`; the integrated patch SHA-256 is
`c81948744ff415d4ab72cea4a7aa51ceedfcf2da25def018e91232dfbd85bb87`.
Only the evaluators changed. The adversarial evaluator is 658,087 bytes at
SHA-256 `b2edf959bf2e7bd933d37c3521c495da955b1e7a4eac069361465f443de423ef`
and Git blob `63fa67d7bd4fe7a2921fbc8f77c57b8e75adb010`; the main evaluator is
912,778 bytes at SHA-256
`bc0b322dc5394a30fd846bd756899d77e6dfdec783108c648720ad2ba4ca2207`
and Git blob `aa8253e7188a7499d840ea7eac7ed71fa3184677`.

The frozen private-store receipt identity is
`914baa75ad37e662895caf2002f98f395c47586bd8681d746ecd97820c7a18aa`.
It binds three stores, ten owner operations, five phases, and 50 unique controls
(40 primary and ten fresh), with ten controls per phase. Store owner/control
splits are 1/7/2 and 5/35/10. Candidate behavior is 274 attempts / 224 successes
/ 50 rejections; owner targets are 70/30/40; primary/fresh calls are 246/28;
setup/downstream calls are 168/36. The exact control-ID and owner-operation
preimages have identities
`fcecf21e42d79a9a8f40d0514c1c2f2cdbf77b9af2dd64630347053f81eea364`
and `828671fb22e3cb674daa99d972b87250cf059da5e0524d8b725407f66f0748b1`.
The exact ordered phase-name array has identity
`c7c768bdabe36cc08a7bcafdfc4046c3647a4fa13b77fcdc6a1d1891bdd178f9`;
the distinct exact sorted phase-count object preimage has identity
`61af05cd58789f22f82dc3014e2ba36fd3781183437d0ba0326edfef78f193ae`.

The fresh candidate is distinct and loaded once through read/pin/decode/audit/
import sequence 1/2/3/4/5, with a one-step ordinal advance, canonical source
SHA-256 plus padded ordinal query, and the full main audit before import. The
live oracle remains
`57a65ccb545a7c0deaba0f0306273925165e622d0dbc37d1eafc9f4ffa5657f5`.
The registration inventory now has three entries, zero registration TODOs, and
identity
`b91336686a76ed8b28d2b68dbc4f6739d60486a1ea03d30797d6980bcb5c04c9`.

Current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass direct
11/11/0/0 and report main 19/18/0/1 and combined 30/29/0/1
test/pass/fail/TODO. The post-integration Node 24.14.1 combined result is the
same; the helper passes 20/20 and the ADR verifier passes 1/1. Independent
review returned APPROVE with no findings and reproduced combined results on
Node 24.14.1 and Node 20.20.2. These focused C16 totals do not relabel the
preserved broad `npm test` totals above.

C17 final aggregate is the sole evaluator TODO; C18-C21 remain pending. At the
pre-documentation freeze, task `task-1788204847572-uh0olo` was recorded
`in_progress` at 95%; its ledger closure is a post-integration action, not
evidence conferred by this README. ADR-0036 remains Proposed and readiness
remains exactly `{status: "unavailable", reason: "native-adapter-unavailable"}`.
No source,
helper, fixture, package, lockfile, dependency, runtime, filesystem, process,
cgroup, G1.7, G2.2, qualification, promotion, publication, push, product, or
physical authority changed, and the dual-host plan remains unresolved.

### ADR-0036 C17-C21 checkpoint — 2026-09-03

The C16 section above remains historical evidence. C17 started at evaluator
RED `0bafc84dea56dd4e75fffa0546dcdcf48c2ea408` and is GREEN at integrated
commit `b037ed0a77575463d9babbe4ab43d8a17f0b4032`, tree
`64cb90bc403663436f91c268c2a3da04b76bf370`. The approved pre-commit RED
working-tree diff serialization is
`24cbaaf5f9f370cbe996a82a47da105edf1009103bf3bb2900737d238086914f`;
the committed base-to-RED full-index binary diff is
`f15ea43c349372e804614571ccd3d05048c50db3b9a98c0db885ca53d560e691`.
The committed RED-to-GREEN full-index binary diff is
`100108871cebdd223bcada9e6379b361b3657ddc3b6b0b6d88839b01bc501bbb`
and is one evaluator hunk, +213/-1. The complete committed full-index C17
delta is one evaluator file, +3,277/-13, at
`531ef7163befd608033023a2357762b3396263e34c5ca9bca4e962d7995db101`.

The main evaluator is 1,016,600 bytes at SHA-256
`52666c2545ac06d1134848d685e3e450b4375de2e0ec04048081cc334e55a302`
and Git blob `022623c453e8177300e3dc843426eae6c5e84ec5`. Its normalized AST has
97,343 nodes and identity
`09806ef6b91200c376c72d6667c88cd14aca8e5298ddf9ca4adb12438f14d579`.
At integrated C17, the adversarial evaluator, candidate, live fixture,
predecessors, package, lockfile, dependency, and registration identities are
unchanged from C16. Within that frozen identity set, later commit `b915c5f6`
changes only `package.json`: it adds the dormant exact-create preflight, run,
and replay scripts without changing dependencies, engines, or the lockfile. The
current manifest is 2,790 bytes at SHA-256
`6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8`
and Git blob `b480befac6ce8ba3fd9fa74dbf3963df58048926`. This later script-only drift does
not rebaseline C17.

The final aggregate performs exactly four setup, 252 descriptor-alias, and 63
precedence calls: 319 monitored calls with four returns and 315 throws. It
kills all 318 receipt mutations and all 25 behavioral classes with zero
survivors. The stable receipt identity is
`eb548452b2f59a139730d11c0eb7046a2f0f4ab9c445e895ca5a7865382fb377`.

Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass focused 20/20,
direct 11/11, main 19/19, and combined 30/30 with zero failures or TODOs; the
official ADR verifier passes 1/1. Independent C18 contract, C19 compatibility,
and C20 security/mutation reviews each returned APPROVE with zero blocking
findings. C20 kept its denominators separate and killed 438/438 direct
hostile/static, 122/122 main expansion/oracle, 134/134 private-commit/
compatibility, 318/318 receipt, and 25/25 behavioral-class mutations, with
byte-exact restoration and zero survivors.

Evidence is stored and read back under
`programme-evidence/adr0036-c17-green-integration-b037ed0a-2026-09-02`,
`programme-evidence/adr0036-c18-contract-review-b037ed0a-2026-09-02`,
`programme-evidence/adr0036-c19-compatibility-review-b037ed0a-2026-09-02`, and
`programme-evidence/adr0036-c20-security-mutation-review-b037ed0a-2026-09-02`.
Commit `c01b3c6a` is the local documentation/ledger closure boundary for C21
task `task-1788204883871-l9tsh9` and ADR-0036 programme umbrella
`task-1788042241332-xafq11`; both Ruflo rows and immutable receipt
`programme-evidence/adr0036-c21-local-closure-c01b3c6a-2026-09-03` were read
back. This makes ADR-0037 S0 `task-1788205371168-e6caq3` and
ADR-0041 S1 `task-1788403485637-t9wn40` dependency-eligible only. Both remain
pending at zero progress and unstarted. External Gist/main publication is
transferred to pending task `task-1788409495130-6ikk41`, with
`gistUpdated:false` and `pushed:false` still exact.

No G1.7 command ran. ADR-0036 remains Proposed and readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`. This checkpoint
grants no product, runtime, filesystem, process, cgroup, G2.2, qualification,
promotion, publication, push, or physical authority.

The package is local-only. Presence of this directory is not an engineering
readiness, product-correctness, semantic-qualification, or promotion claim.
