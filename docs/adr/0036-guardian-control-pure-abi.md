# ADR-0036: Guardian-control pure ABI

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-08-31
- Deciders: Oxigraph parity programme
- Implementation status: evaluator RED in progress through the B6 static
  closure checkpoint. Commit `7a539665` adds the
  reviewed source-absent, fail-closed evaluator checkpoint; commit `d3e6bd8b`
  adds source-independent exact-v2 controls for all nine byte positions, 108
  ignored-property variants, 63 hostile carriers, and the exact ten-operation
  private-store test inventory. Commits `c9b063de` and `36499acf` add the exact
  export/signature and predecessor manifests, synchronously pinned requirements
  oracle, bounded lexer, explicit top-level statement grammar, typed pure
  module-initializer grammar, and 69 pre-evaluation rejection controls with
  zero evaluation attempts. Commits `8e19f927` and `2d408a03` preserve the same
  RED shape on Node 20.0.0 as on Node 20.20.2 and the current runtime. Commit
  `ae71ecdd` moves all five byte-pinned predecessor and fixture checks ahead of
  candidate source read or import. Commit `f98724b4` adds the direct `acorn: latest`
  development dependency resolved to 8.18.0, pins its lock integrity, installed
  package manifest, and exact ESM entrypoint before loading that entrypoint,
  fixes ES2022 module parsing with preserved parentheses and no fallback, and
  rejects hashbang, return, await, and for-await syntax before the existing
  static controls. Commit `68aa25c9` adds the independently reviewed,
  import-safe adversarial registrar foundation. Its frozen two-test inventory
  has SHA-256
  `f448be91b5a4bb086e93e4ef529428bd0d509c14fd532e75e02ea1a256c0cb3e`;
  registration reads none of the injected candidate, oracle, or fresh-loader
  values and leaves both candidate-connected tests TODO. Commit `1327b6b4`
  removes the adversarial lane's static exact-v2 import. Direct entry hashes
  the exact-v2 source to
  `2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3`
  before its dynamic load attempt, while imported mode performs zero exact-v2,
  candidate, or fixture byte reads and zero predecessor or candidate module
  loads. Its direct-entry guard still performs filesystem metadata lookups, and
  ordinary hash-then-import does not eliminate a concurrent filesystem TOCTOU
  window. Commit `d71ed850` dynamically imports the adversarial module only
  after the main lane's five-source predecessor audit, constructs the frozen
  source-independent oracle, and registers the two candidate-connected TODOs
  through deferred getters. Registration reads no injected value; the executed
  TODO callbacks type-check candidate/oracle/fresh-loader exactly 2/2/1 times
  without calling the inert fresh loader. Removing the two duplicate direct-lane
  declarations leaves the exact direct/main/combined inventories at 10/15/25
  tests. Commit `96e4b712` freezes six source-independent
  oracle-design inventories without materializing candidate-dependent values:
  20 whole transition/state designs
  (`251604392360b8024cbaf7d1e6ad48cdbddb5187d049aaeb5dbb50ce3f1d5acb`),
  15 emitted-status designs
  (`6e03baa638cd3b48221e9182d9de1dd74a9a7b454fce40719badb3d0d9b7de5e`),
  four atomic two-status controls
  (`a2b9524c88bbd78aca2d189c150a9e5499c0da3505c9109734ce78f0fa038ba1`),
  26 symbolic prefix observations
  (`eeac031f7f929c856d3b46af63bbaeebc33b827eb55fee6f93a4a55f643e89a6`),
  252 descriptor aliases partitioned 91/112/28/21
  (`30129d8d237f720fea41a8730d561e4dd615f35da565e5807e54aebb0c2ab9da`),
  and 18 constructible precedence pairs
  (`51fb17d1ff193dc37db2b16be60251c7bc745f479f0a8ee980ee24bc0caa0762`).
  Commits `d76e5e94`, `5cdde062`, `142869f3`, `6f1f5e70`, and
  formatting-only `07d99dea` add the independently reviewed ESTree and
  provenance subset. At that checkpoint it rejected 117 layered
  source-independent negatives: 69 parser and grammar foundation controls
  outside the final semantic quota plus 48 semantic controls assigned exactly
  once within that final quota, and accepted five named synthetic positives. Of
  the 48 semantic controls, 46
  reach ESTree policy; the two earlier rejections are
  `requirements initializer semantic drift` and
  `shallow ambient freeze used as deep freeze`. Its 17 representative
  commit-mutation sources are inventory, not final closure. The accepted
  baseline classifies all 1,149 AST nodes, records
  84 bindings and references, 54 calls and callees, ten members, receivers,
  mutations, private operations, and private commits, 40 direct pre-commit
  calls, and the exact startup/input/state commit split 1/7/2. Independent
  adversarial replay closes the previously found private-read laundering,
  conditional/logical `?:`, `&&`, `||`, and `??` dominance, direct-body commit,
  non-returning failure-callback, and callback-recursion counterexamples. The
  commits `970c135b` and `05796367` then add and repair the separately encoded
  status-wire oracle. The first materialization was retained as review evidence
  after an independent NO-GO found that it consumed design registries and
  shared 15 non-primitive references across calls. The repair derives its
  primary STATUS and atomic-prefix values directly from `legalSequences` plus
  a freshly allocated evaluator-owned construction context. Its 28-function
  reachable primary closure contains no design-oracle builder or registry
  dependency; its five-function independent reconstruction closure contains no
  primary-builder dependency. Two independent post-repair reviews and a root
  reproduction returned GO for only this evaluator slice.

  The repaired oracle materializes 15 distinct STATUS records with 23 source-
  sequence memberships: 12 normal and three recovery-only, partitioned as six
  admission-only, three recovery-only, six neither, and zero both. It
  materializes four two-status atomic wire prefixes and rejects all four
  reversed-order, first-omission, second-omission, and inserted-delimiter
  variants. Its exact construction-context identity is
  `fd008c99ac11e32de80c25399d5a8d34bb6ab4832c6e58e969b84993b7470f23`;
  status and atomic design projections remain respectively
  `6e03baa638cd3b48221e9182d9de1dd74a9a7b454fce40719badb3d0d9b7de5e`
  and
  `a2b9524c88bbd78aca2d189c150a9e5499c0da3505c9109734ce78f0fa038ba1`;
  materialized status and atomic inventories are respectively
  `d871cbce866d934a6d30d8c1062e30f93b8a250b772b5284da50b83514fc4762`
  and
  `c6735a0da37cdaf3d6e9775dcb5dffc47f039e08df7d8db0adcf0313499479d4`;
  and the complete oracle identity is
  `57872372c67c5ad4580ed2945512fc5c7ec0923b121690c2a2927604608b3583`.
  Repeated construction yields deep-equal 124-object graphs with zero shared
  non-primitive references, retained byte views, or input aliases; 27 fresh-
  byte mutation probes leave the oracle and pins unchanged. Import-only mode
  performs zero byte reads and exposes exactly three exports on all three
  runtimes.

  Commits `957237a3` and `54b40874` first froze and schema-hardened the accepted
  static-evidence manifest. Integrated commit `358c19d0` (source commit
  `87d727bd`) adds the reviewed private-lookup slice. Integrated commit
  `d971bfa4` (source commit `97436e80`) then adds `SEM-N061` through
  `SEM-N082`, closing the `indirectCalls` and `reflectComputed` buckets at
  12/12 each. Integrated commit `86320201` (source commit `32d3ee00`) adds
  `SEM-N083` through `SEM-N092`, closing `bindingMemberWrites` at 14/14.
  Integrated commit `99649146` (source commit `62fa9cb3`) adds B3
  `SEM-N093` through `SEM-N114`: 15 `untrustedSinks` and seven `rawEscapes`
  controls across imported, ambient, local-call, receiver, operator, return,
  alias, aggregate, helper, and private-read paths. It closes those buckets at
  24/24 and 12/12 and kills the five exact non-equivalent weakening probes
  bound to `SEM-N093`, `SEM-N102`, `SEM-N108`, `SEM-N109`, and `SEM-N111`.
  At that intermediate checkpoint the manifest contained 69 foundation
  negatives, 114 semantic negatives, and 11 positives: 183 negatives and 194
  controls in total, with 216 semantic negatives remaining.

  Integrated commit `05bbd8bb` (source candidate `43b9c0cc`) adds B4
  `SEM-N115` through `SEM-N124` and closes `literalMisuse` at 14/14. These ten
  controls preserve literal-fragment provenance through ambient `String`
  coercion, nested fragments, local and module aliases, conditional/logical
  joins, local returns, and factored requirements dependencies. The amended
  source candidate repaired the independently identified ambient-`String`
  bypass before integration. Its focused static-policy case passes on the
  current Node runtime and Node 20; on both runtimes the complete relevant
  matrices retain the exact adversarial 9-pass/1-TODO and main
  8-pass/1-deliberate-failure/6-TODO shape. The exact weakening is killed by
  `SEM-N115`.

  Integrated commit `61122498` (source candidate `d07c43c`) adds B5
  `SEM-N125` through `SEM-N147`: 14 `scopeJoins` and nine `nestedRecursion`
  controls, closing those buckets at 18/18 and 12/12. Six non-equivalent
  weakening probes are killed and four false-positive probes remain accepted.
  The B5 ordered-control, ordered-semantic, and bucket-projection SHA-256
  identities are respectively
  `a2943afea60379318d0df11e973be1eab647576cf6f03671664f093abc601814`,
  `92720decee66fbd173d74dfff681b1d692728d88298700ead9dc53c1066ac62b`,
  and
  `20e1339842647707f7f163e8bbc90535c4587342803594c7c28126e4c78d53d1`.
  Tarjan traversal supplies the pinned full-SCC diagnostic; the existing
  analyzing-state guard remains a conservative recursion fallback, so this
  checkpoint does not claim that Tarjan alone proves recursion rejection.

  Integrated commit `2f9e51ed` (source candidate `cf9f2eb1`) adds B6
  `SEM-N148` through `SEM-N197`: 50 `commitMutations` controls covering ten
  commit owners across `if`, conditional, `&&`, `||`, and `??` forms. The
  bucket is now 67/200. Exactly 194 of the 197 semantic negatives reach ESTree;
  the other three are pinned pre-ESTree rejections. Five operator-specific
  mutants are killed and byte-exactly restored. Independent review returned GO
  for this bounded evaluator checkpoint on current Node 24.14.1, exact Node
  20.0.0, and Node 20.20.2 while preserving the exact direct 10/9/0/1, main
  15/8/1/6, and combined 25/17/1/7 test/pass/fail/TODO matrices.

  The current recursively frozen manifest therefore contains exactly 69
  foundation negatives, 197 semantic negatives, and 11 positives. The 67
  commit-mutation IDs are exactly the `commitMutations` bucket and a subset of
  the 197 semantic IDs, never an additive count. Current negative evidence is
  exactly `266 = 69 + 197`; against the semantic 330/11/200 targets, 133
  negatives, zero positives, and 133 commit mutations remain. The 133
  remaining commit mutations are part of, not additional to, the 133 remaining
  semantic negatives. The final all-layer negative target remains exactly
  `399 = 69 + 330`.

  The manifest schema is exactly
  `oxigraph.candidate-containment-guardian-control-static-evidence-manifest/v1`
  with SHA-256
  `eb34893fe9502ba08706fde2ee442711e1f902de281e3aa41552a1ce98df60e0`.
  Every one of its 277 control entries has only `id`, `name`, `bucket`,
  `sourceSha256`, `astSha256`, `astNodeCount`, `expectedStage`, and
  `expectedError`. The literal evidence tables pin the full UTF-8 source hash,
  normalized AST hash and node count, exact rejection stage, and full canonical
  rejection text rather than an error prefix or truncated assertion payload.
  AST normalization recursively omits exactly `end`, `loc`, `range`, `raw`,
  `sourceFile`, and `start`, then sorts object keys.
  `FOUNDATION-N008` is the sole parse rejection with a null AST hash and node
  count; all other entries carry literal AST and source pins. The six current
  aggregate identities are:
  - ordered 277-control identity projection:
    `444134de2df5e8a2786ee804b13f5dd8bca45dcf7958a9b13b0eb36e86f88d91`;
  - ordered 197-control semantic projection:
    `a5ab0a2701862159a2144e2ca31661263f06a83c68f1d72ca64847be6c3d51b9`;
  - semantic-bucket projection:
    `fc4b31fa4515cab07c9b72dc09dde3b46cdd62d0da3d34eb5074673a06e2aa9e`;
  - foundation ID/name projection:
    `3064a09db3f937a55e3d0febeca0a2f41ea836bc394cc1259748b268f59f6ce5`;
  - positive ID/name projection:
    `f73112c110a5ced50c3f64fcd53da66e022f20abbaef83ddb5be69d32390f420`;
  - commit-ID projection:
    `af002b5a28d207a69f841f9b1aabb186e5474b62e1c1b0c7c4241a70351bdd8b`.

  `SEM-N013` was deliberately rewritten rather than silently rebaselined. Its
  former unowned helper would now fail at the new owner policy before exercising
  the intended private-read laundering rejection, so the control now performs
  the same read in
  `verifyCandidateContainmentGuardianStatusFrameV1` with its exact
  `startupProjection` parameter and still rejects at `estree-policy` with
  `static gate: ESTree deepFreeze argument provenance`. The source/AST/node pins
  changed from
  `b4bc0847cbbd9b7f908f1abcd38b754f657952ae064dc489cc4b2d0e336b8329` /
  `20450c27418578ab4a84626011816d8be65662f565d91aefa7a0e6427ba9cfce` /
  1,162 to
  `cbc214639b03132d01081ac7c6acb6535a1b049ff7bb7e83989ee9d77d9d5364` /
  `179b90dc7f86d6790e60e5ebc2308386a6982e37e576447821eedee195fbe331` /
  1,156.

  The lookup policy authorizes exactly these 11 ordered
  function/store/key-parameter pairs:

  | Function                                                          | Store             | Key parameter       |
  | ----------------------------------------------------------------- | ----------------- | ------------------- |
  | `initializeCandidateContainmentGuardianControlV1`                 | `startupMetadata` | `startupProjection` |
  | `verifyCandidateContainmentGuardianStatusFrameV1`                 | `startupMetadata` | `startupProjection` |
  | `createCandidateContainmentGuardianAdmissionInputV1`              | `stateMetadata`   | `currentState`      |
  | `createCandidateContainmentGuardianCancelInputV1`                 | `stateMetadata`   | `currentState`      |
  | `createCandidateContainmentGuardianRecoveryRequestInputV1`        | `stateMetadata`   | `currentState`      |
  | `createCandidateContainmentGuardianControllerClosedInputV1`       | `stateMetadata`   | `currentState`      |
  | `createCandidateContainmentGuardianDiagnosticFailureInputV1`      | `stateMetadata`   | `currentState`      |
  | `createCandidateContainmentGuardianRecoveryControlHandoffInputV1` | `stateMetadata`   | `currentState`      |
  | `createCandidateContainmentGuardianStatusEofInputV1`              | `stateMetadata`   | `currentState`      |
  | `reduceCandidateContainmentGuardianControlV1`                     | `stateMetadata`   | `currentState`      |
  | `reduceCandidateContainmentGuardianControlV1`                     | `inputMetadata`   | `brandedInput`      |

  This is an exact 2/8/1 split across
  `startupMetadata`/`stateMetadata`/`inputMetadata`. The sibling evidence
  exercises one `has` and one `get` for each pair, giving 22 distinct observed
  operations. Positive controls `POS-P006` through `POS-P011` contribute exactly
  2/2/2/12/2/2 operations.
  Lookup keys must be the named function parameter and resolve to that exact
  parameter binding; a same-named local shadow, another parameter, a local
  value, or a computed expression is not authorized. The exact result lattice
  is `has` = `{kind: "immutable", freezable: true, tainted: false}` and `get` =
  `{kind: "private-read", freezable: false, tainted: true}`.

  A separate recursively frozen sibling receipt, rather than an extension of
  the static-evidence manifest, has schema
  `oxigraph.candidate-containment-guardian-control-private-lookup-evidence/v1`.
  Its five full SHA-256 pins are:
  - schema:
    `5ca5d446d3357b0b43b6421e1cedae2b62f37f9e58135349c7a663ec48b42b47`;
  - ordered methods `has`/`get`:
    `f0afdaedcb5432d380f9d18e533963f7dcdcff465c7b7864b89e72d09d235a01`;
  - ordered authorized-pair projection:
    `562ce95945ad0e110eb9c01866a44c5202f37f2d4381a8ac8d68d7bded28b1e1`;
  - ordered observed-operation projection:
    `164ab5c6d611fa840804fb88d4e59035e897f9f72db97e8161ef52f92834ada7`;
  - receipt without its two projection-hash fields:
    `c86485d7298cd768a4ceb254274c6b331a9fb6981a5ae73cd6fb6328d90bbd6b`.

  The exact semantic-bucket target/current/remaining counts are:

  | Bucket                | Target | Current | Remaining |
  | --------------------- | -----: | ------: | --------: |
  | `protectedAliases`    |     12 |      12 |         0 |
  | `indirectCalls`       |     12 |      12 |         0 |
  | `reflectComputed`     |     12 |      12 |         0 |
  | `bindingMemberWrites` |     14 |      14 |         0 |
  | `untrustedSinks`      |     24 |      24 |         0 |
  | `rawEscapes`          |     12 |      12 |         0 |
  | `literalMisuse`       |     14 |      14 |         0 |
  | `scopeJoins`          |     18 |      18 |         0 |
  | `nestedRecursion`     |     12 |      12 |         0 |
  | `commitMutations`     |    200 |      67 |       133 |

  Independent mutation review initially killed 14 of 15 manifest mutations and
  found that the schema-name mutation survived because the manifest was
  compared only with its defining constant. Commit `54b40874` adds a literal
  schema assertion plus the independent schema digest. The repaired exact
  artifact kills 15/15 probes. The accepted Ruflo evidence is stored under
  `programme-evidence/adr0036-static-manifest-54b40874-2026-08-30`.
  Independent semantic, runtime, and real-mutation reviews of the private-lookup
  slice then returned unanimous GO for only this bounded evaluator checkpoint;
  the mutation review killed 12/12 real evaluator mutations.
  The distinct accepted integrated Ruflo evidence key is
  `programme-evidence/adr0036-private-lookup-358c19d0-2026-08-30`.
  The independently reviewed callee/receiver and binding/member-write records
  are respectively
  `programme-evidence/adr0036-callee-receiver-d971bfa4-2026-08-30` and
  `programme-evidence/adr0036-binding-writes-86320201-2026-08-30`. Their
  B1 review killed nine of eleven deliberately weakened implementations; the
  other two were retained as honestly equivalent or shadowed mutations under
  the layered policy. B2's three non-equivalent weakening scenarios were all
  detected across the relevant layers. Neither batch changes the candidate
  source stop, import-purity contract, or three-runtime matrices.
  The B3 taint-boundary and B4 literal-path records are respectively
  `programme-evidence/adr0036-taint-boundary-99649146-2026-08-30` and
  `programme-evidence/adr0036-b4-literal-paths-05bbd8bb-2026-08-31`. They bind
  the exact integrated/source commits, counts, aggregate hashes, focused gates,
  and authority-null claim boundary without relabeling any earlier receipt.
  The corresponding B5 CFG/call-graph and B6 dominance records are
  `programme-evidence/adr0036-b5-cfg-callgraph-61122498-2026-08-31` and
  `programme-evidence/adr0036-b6-dominance-2f9e51ed-2026-08-31`. They bind the
  exact source and integrated commits, projection hashes, three-runtime
  matrices, mutation results, candidate-absence stop, and unchanged authority
  boundary.

  The source hard stop remains exactly 506 bytes with SHA-256
  `ac601db2df0b54bd27076633f2af1db613ee488d737c8bb85bd371febdc71de7`.
  The new four-TODO tail is exactly 12,095 bytes with SHA-256
  `3f58dc980e85a6d725a6c147c7d1f95d37e200197f84c292feaed9f4a5cd270c`.
  The integrated slice preserves import-only mode at zero byte reads and exactly
  three exports on each runtime.
  Current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 all produce the
  exact direct 10/9/0/1, main 15/8/1/6, and combined 25/17/1/7
  test/pass/fail/TODO matrices; the sole failure is the deliberate absent
  candidate. `npm audit` reports zero known vulnerabilities.

  This remains a partial source-hard-stopped foundation. The final semantic
  quota still requires 133 negative controls, all within the remaining 133
  commit mutations, beyond the current 197/11/67. The 69 parser and grammar foundation negatives
  are additional, so final all-layer evidence will contain 399 negatives rather
  than 330. The static lookup slice does not fix global malformed-expression
  diagnostic precedence or prove actual runtime `WeakMap` lookup behavior.
  The frozen protected-alias, callee/receiver, computed/reflection, indirect-
  call, binding/member-write, untrusted-sink, raw-escape, and literal-misuse
  quotas are complete, as are the scope-join and nested-recursion quotas.
  Successful-path reachability, the remaining commit-mutation quota,
  candidate-connected acceptance matrices, the absent production source
  module, runtime registration, and the physical native owner remain
  incomplete. Production containment readiness remains exactly
  `{status: "unavailable", reason: "native-adapter-unavailable"}`.

- **Depends on**:
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md)
- **Related**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)

## Context

ADR-0035 requires one small control boundary before native manager or guardian
code may own an effect. It fixes the normal and recovery-only process topology,
inherited-descriptor provenance, target supervisor descriptor map, epoch
framing, controller-loss behavior, and separation between guardian admission
and supervisor control. It does not fix the serialized guardian-control
vocabulary, exact reports and frames, byte ceilings, reducer transitions,
validation failures, or transcript-terminal rule. Implementing those rules
directly in native code without freezing them here would make the first
physical implementation its own oracle.

This decision is narrower than the existing supervisor control-v2 reducer.
Guardian control covers manager-to-guardian initialization, controller-to-
guardian admission, status framing, and recovery-only startup. It does not
replace or reinterpret supervisor `START`, `PREFLIGHT_READY`, `COMMIT`, or
`CANCEL` semantics.

## Decision

Add an authority-null `containment-guardian-control-v1` pure module and an
independent evaluator before any filesystem-backed or native guardian owner.
ADR-0035 supplies topology and descriptor provenance only. This ADR owns the
complete serialized guardian-control contract below. It derives the
controller-transferred admission roles from all 14 exact launch-capsule-v3 file
specifications. Guardian FD 7 is the held executable used for `execveat`; it is
not the capsule's separate `supervisorSelf` retained byte-copy at target
supervisor FD 6.

### Predecessor envelope

The production module may depend directly on only these byte-pinned
predecessors:

| Predecessor                            | SHA-256                                                            | Contract use                                                        |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `containment-exact-v2.mjs`             | `2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3` | Exact buffers, canonical JSONL, SHA-256, null records, and freezing |
| `containment-guardian-recovery-v1.mjs` | `e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d` | Recovery vocabulary and bounded selection-field validation          |
| `containment-launch-capsule-v3.mjs`    | `9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d` | Exact current launch-capsule verification and 14-file specification |

Launch-capsule v3 is the current additive native-launch predecessor. It retains
the v2 file specification and supervisor FD map while adding the current
race-free exec and `PTRACE_EVENT_EXEC` outcome requirements. Supervisor-control
v2 and preflight-v4 are evidence only and may not be imported; their pinned
source hashes are respectively
`92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842` and
`747c913e60768c53bdeeec923a6ff2f1319121d743bddd8e4db663c1a03d23ff`.
Predecessor drift requires explicit ADR review and never an automatic hash
refresh.

### Bounded input representation

Every untrusted aggregate is received as a byte-bounded ordinary `Buffer` and
copied before decoding or hashing. There is no caller-provided descriptor,
right, event, transcript, or record array and no public object-record bypass.
Canonical JSON inputs contain exactly one JSON value followed by exactly one LF.
Malformed UTF-8, CR, NUL, embedded or trailing lines, duplicate-key encodings,
noncanonical key or value spellings, and trailing bytes fail. The byte ceiling
is checked before UTF-8 decode, JSON parse, hashing, sorting, element
inspection, predecessor verification, or aggregate allocation.

| Input                                       |                          Exact pre-decode ceiling |
| ------------------------------------------- | ------------------------------------------------: |
| Startup report                              |                                       8,192 bytes |
| Epoch                                       | exactly 32 raw bytes plus separately observed EOF |
| `ADMIT` frame                               |                                     131,072 bytes |
| Admission `recvmsg` report                  |                                      16,384 bytes |
| `CANCEL` frame                              |                                       4,096 bytes |
| `RECOVERY_REQUEST`, including its selection |                                      32,768 bytes |
| `STATUS` frame                              |                                       8,192 bytes |
| Raw diagnostics                             |                                      16,384 bytes |
| Diagnostic summary report                   |                                       1,024 bytes |

The maximum legal transcript contains seven symbols and at most 196,608 wire
bytes. Because the public contract is incremental and the legal frame kinds and
count are finite, each new frame's length and the resulting aggregate are
checked before that frame is decoded. There is no one-shot aggregate for which
earlier elements must be revisited.

An ordinary local-realm `Buffer` with non-shared backing is accepted,
length-checked intrinsically, and copied immediately. Proxies, an own `length`
property, `SharedArrayBuffer` backing, non-Buffer views, Buffer subclasses,
foreign Buffer prototypes, and branded lookalikes fail. Arbitrary additional
non-index own string or symbol properties, including data and accessor
properties, are outside the byte-carrier semantics: the module never
enumerates, inspects, reads, writes, or invokes them, they do not cause
rejection, and they are absent from the clean copy. All semantics derive only
from that immediate intrinsic copy of indexed bytes. This avoids an attacker-
controlled property-list allocation before the byte bound while guaranteeing
zero getter or setter invocations and no caller mutation. The module retains no
caller alias. Any returned bytes are fresh copy-on-read views. Foreign non-null
record and Array prototypes fail; the originating realm of a null-prototype
record is not observable and is not claimed.

### Exact startup contract

The startup report schema is
`oxigraph.candidate-containment-guardian-startup-report/v1`. Its exact root
field inventory is below. The listing order is normative for the requirements
vocabulary; JSON object bytes use the repository's canonical key order.

```text
schema
mode
requirementsSha256
expectedEpochSha256
openFileDescriptionObservationScopeSha256
descriptorCount
fd0
fd1
fd2
fd3
fd4
fd5
fd6
fd7
```

Every non-null descriptor slot has exactly these fields:

```text
fd
role
kind
accessMode
closeOnExec
direction
statusFlags
openFileDescriptionClass
openFileDescriptionIdentitySha256
byteLength
contentSha256
launchFileIdentitySha256
currentOffset
socketFamily
socketType
connected
lockHeld
```

The exact normal inventory is:

|  FD | Role                     | Kind             | Access     | CLOEXEC | Direction             | Additional requirement                        |
| --: | ------------------------ | ---------------- | ---------- | ------- | --------------------- | --------------------------------------------- |
|   0 | `controllerChannel`      | `unix-seqpacket` | `O_RDWR`   | `false` | `BIDIRECTIONAL`       | `AF_UNIX`, `SOCK_SEQPACKET`, connected `true` |
|   1 | `statusWrite`            | `pipe`           | `O_WRONLY` | `false` | `GUARDIAN_TO_MANAGER` | Socket and lock fields null                   |
|   2 | `diagnosticsWrite`       | `pipe`           | `O_WRONLY` | `false` | `GUARDIAN_TO_MANAGER` | Socket and lock fields null                   |
|   3 | `stateRoot`              | `directory`      | `O_RDONLY` | `false` | `NONE`                | `lockHeld: true`; socket fields null          |
|   4 | `delegatedRoot`          | `directory`      | `O_RDONLY` | `false` | `NONE`                | Socket and lock fields null                   |
|   5 | `guardianLifetimeCgroup` | `directory`      | `O_RDONLY` | `false` | `NONE`                | Socket and lock fields null                   |
|   6 | `epochRead`              | `pipe`           | `O_RDONLY` | `false` | `MANAGER_TO_GUARDIAN` | Socket and lock fields null                   |
|   7 | `supervisorExecutable`   | `regular`        | `O_RDONLY` | `false` | `NONE`                | Socket and lock fields null                   |

Normal `mode` is exactly `NORMAL` and `descriptorCount` is exactly 8.

The exact recovery-only inventory is:

|  FD | Role                          | Kind        | Access     | CLOEXEC | Direction             | Additional requirement               |
| --: | ----------------------------- | ----------- | ---------- | ------- | --------------------- | ------------------------------------ |
|   0 | `recoveryRequestRead`         | `pipe`      | `O_RDONLY` | `false` | `MANAGER_TO_GUARDIAN` | Socket and lock fields null          |
|   1 | `statusWrite`                 | `pipe`      | `O_WRONLY` | `false` | `GUARDIAN_TO_MANAGER` | Socket and lock fields null          |
|   2 | `diagnosticsWrite`            | `pipe`      | `O_WRONLY` | `false` | `GUARDIAN_TO_MANAGER` | Socket and lock fields null          |
|   3 | `stateRoot`                   | `directory` | `O_RDONLY` | `false` | `NONE`                | `lockHeld: true`; socket fields null |
|   4 | `delegatedRoot`               | `directory` | `O_RDONLY` | `false` | `NONE`                | Socket and lock fields null          |
|   5 | `recoveryActorLifetimeCgroup` | `directory` | `O_RDONLY` | `false` | `NONE`                | Socket and lock fields null          |
|   6 | `epochRead`                   | `pipe`      | `O_RDONLY` | `false` | `MANAGER_TO_GUARDIAN` | Socket and lock fields null          |
|   7 | null                          | n/a         | n/a        | n/a     | n/a                   | The complete slot value is null      |

Recovery `mode` is exactly `RECOVERY_ONLY` and `descriptorCount` is exactly 7.
`lockHeld` is `true` only for the `stateRoot` descriptor and null for every
other present startup descriptor in both modes.
All present startup open-file-description identity digests are pairwise
distinct. `expectedEpochSha256` equals the lowercase SHA-256 of the copied raw
epoch, whose byte length is exactly 32, and `epochEofObserved` supplied to the
startup constructor is the primitive `true`.

The open-file-description observation scope is the SHA-256 of canonical JSON
for the exact null-prototype record `{schema, requirementsSha256, mode,
epochSha256}`, where `schema` is
`oxigraph.candidate-containment-guardian-ofd-observation-scope/v1`. Within that
scope, a runtime reporter exhaustively compares the inventory in normative
order with `kcmp(KCMP_FILE)` or an ADR-0039-qualified equivalent and assigns an
equivalence-class integer equal to the first equivalent descriptor's normative
ordinal. The identity digest is the SHA-256 of canonical JSON for the exact
record `{schema, scopeSha256, equivalenceClass}`, where `schema` is
`oxigraph.candidate-containment-guardian-ofd-observation/v1`. For the required
non-aliased startup maps, each class equals its FD ordinal. Normal admission
rights continue the same scope at ordinals 8 through 21. At startup, all eight
descriptors are live and compared before FD 6 is closed. At admission, the
reporter compares all 14 concurrently live rights pairwise and each right to
the still-live regular startup FD 7. Nonaliasing against startup FD 0 through 6
is established by their exact different kernel kinds: socket, pipe, or
directory versus regular; it does not require retaining or reopening the closed
epoch pipe. The pure module recomputes the serialized scope/class digests and
rejects duplicate or noncanonical classes; it does not prove that the reporter
performed either the kernel comparisons or kind observations.

`byteLength`, `contentSha256`, and `launchFileIdentitySha256` are null for every
startup descriptor, including FD 7. Guardian FD 7's executable attestation is a
physical ADR-0038/0039 concern and is not conflated with the capsule's retained
`supervisorSelf` byte-copy. `currentOffset` is the integer 0 for regular FD 7
and null for all other startup descriptors. ADR-0038 must use offset-preserving
readback when attesting FD 7.

Access is the symbolic result of `F_GETFL & O_ACCMODE`; `O_RDONLY` is not
treated as a truthy bit. Descriptor `closeOnExec` is a separate `F_GETFD`
observation. Startup descriptors have survived exec and therefore report
`false`. A runtime reporter must reject `O_PATH` rather than translate it to
`O_RDONLY`. After removing `O_ACCMODE`, `statusFlags` is exactly `NONE` for
pipes and the socket, `O_LARGEFILE` for regular files, and
`O_LARGEFILE|O_DIRECTORY` for directories. This reflects an observed Linux
x86-64 `F_GETFL` contract rather than assuming a zero remainder. The reporter
rejects `O_APPEND`, `O_ASYNC`, `O_DIRECT`, `O_NOATIME`, `O_NONBLOCK`, `O_PATH`,
and any other flag outside the exact kind-specific value. The pure module
validates these reported observations but grants no kernel authority or
provenance.

### Exact admission-rights contract

The admission `recvmsg` report schema is
`oxigraph.candidate-containment-guardian-admission-recvmsg-report/v1`. Its exact
root fields are:

```text
schema
messageByteLength
messageRawSha256
messageTruncated
controlTruncated
controlMessageCount
controlLevel
controlType
rightsCount
right0
right1
right2
right3
right4
right5
right6
right7
right8
right9
right10
right11
right12
right13
```

Every right slot has exactly:

```text
index
role
targetSupervisorFd
kind
accessMode
closeOnExec
statusFlags
openFileDescriptionClass
openFileDescriptionIdentitySha256
byteLength
contentSha256
launchFileIdentitySha256
currentOffset
```

There is exactly one `SOL_SOCKET`/`SCM_RIGHTS` control message, exactly 14 rights
in this order, and both `messageTruncated` and `controlTruncated` are `false`:

| Index | Role                     | Target supervisor FD | Access     |
| ----: | ------------------------ | -------------------: | ---------- |
|     0 | `childExecutable`        |                    4 | `O_RDONLY` |
|     1 | `childStdin`             |                    5 | `O_RDONLY` |
|     2 | `supervisorSelf`         |                    6 | `O_RDONLY` |
|     3 | `payloadSandboxWorker`   |                    7 | `O_RDONLY` |
|     4 | `payloadProcess`         |                    8 | `O_RDONLY` |
|     5 | `payloadBuildCommand`    |                    9 | `O_RDONLY` |
|     6 | `payloadEvidenceLimits`  |                   10 | `O_RDONLY` |
|     7 | `payloadSessionLimits`   |                   11 | `O_RDONLY` |
|     8 | `payloadTaskFailures`    |                   12 | `O_RDONLY` |
|     9 | `payloadRoutingFeatures` |                   13 | `O_RDONLY` |
|    10 | `payloadSeccompLauncher` |                   14 | `O_RDONLY` |
|    11 | `launchArgv`             |                   15 | `O_RDONLY` |
|    12 | `launchEnvironment`      |                   16 | `O_RDONLY` |
|    13 | `childResult`            |                   17 | `O_RDWR`   |

Every right is a `regular` file, reports `closeOnExec: true` corresponding to
race-free receive with `MSG_CMSG_CLOEXEC`, and reports
`statusFlags: O_LARGEFILE` with the same rejected-flag rule as startup.
`messageByteLength` and
`messageRawSha256` equal the exact `ADMIT` datagram. Right identities are
pairwise distinct and distinct from all eight normal-startup identities.
`supervisorSelf` is the separate retained byte-copy transferred to supervisor FD
6 and does not bind guardian FD 7's executed image. Supervisor FDs 0 through 2
and the guardian-created job-cgroup FD 3 are never controller-transferred.

Right `openFileDescriptionClass` values are exactly 8 through 21 in inventory
order and their identity digests use the startup scope formula above. For every
right, `byteLength`, `contentSha256`, and `launchFileIdentitySha256` exactly
equal the corresponding verified launch-capsule-v3 file entry's `byteLength`,
`sha256`, and SHA-256 of canonical JSON for its complete `identity` record. Thus
this pure module cannot pair a valid capsule with a serialized right report
whose byte, identity, or offset bindings differ. That is only a serialized-
report guarantee: it does not prove that the received open file description or
its underlying object remained unchanged after observation. Every right's
`currentOffset` is the integer 0 and equals the capsule entry's `initialOffset`.
Before remap, exec, or transfer of control, ADR-0038's physical owner must close
the controller's sending aliases, prove that no mutable alias can invalidate
the observation at that boundary, and immediately revalidate every right's
content, complete identity, and offset with offset-preserving reads. It must
fail closed on any mismatch. This pure contract intentionally makes no capsule
claim about guardian FD 7.

### Exact wire frames and recovery selection

All wire frames use schema
`oxigraph.candidate-containment-guardian-control-frame/v1`. Sequence numbers
start at zero and increase by one across both directions. The first wire frame
uses 64 lowercase zeroes as `previousFrameSha256`; every later wire frame binds
the SHA-256 of the exact preceding wire-frame bytes. Synthetic observations do
not consume a wire sequence number and do not replace the preceding wire
frame.

Unless stated otherwise, a `*Sha256` binding below is the lowercase SHA-256 of
repository-canonical JSON bytes without a trailing LF. Raw wire and capsule
digests include their exact terminating LF. `startupSha256` is the digest of the
copied canonical startup-report JSONL bytes. `epochSha256` is the digest of the
32 copied raw epoch bytes. `launchCapsuleV3Sha256` is the verified capsule's raw
JSONL digest. `recoverySelectionSha256` is the digest of the embedded selection's
canonical JSON bytes. `previousFrameSha256`, admission, recovery-request, and
status raw digests bind exact JSONL bytes.

`ADMIT` has exactly:

```text
schema
action
mode
sequence
previousFrameSha256
requirementsSha256
startupSha256
epochSha256
launchCapsuleV3Sha256
launchCapsuleV3
```

Its `action` is `ADMIT`, mode is `NORMAL`, and `launchCapsuleV3` is canonical
standard base64 of the exact launch-capsule-v3 JSONL bytes. The decoded bytes
must pass the pinned launch-capsule-v3 verifier and match
`launchCapsuleV3Sha256`.

`CANCEL` has exactly:

```text
schema
action
mode
sequence
previousFrameSha256
requirementsSha256
startupSha256
epochSha256
admissionFrameSha256
```

Its `action` is `CANCEL`, mode is `NORMAL`, and `admissionFrameSha256` is null
when no admission preceded it or the exact prior `ADMIT` digest otherwise. It
has no ancillary data; the constructor requires primitive truncation flags
`false` and control-message count zero.

`RECOVERY_REQUEST` has exactly:

```text
schema
action
mode
sequence
previousFrameSha256
requirementsSha256
startupSha256
epochSha256
recoverySelectionSha256
recoverySelection
```

Its `action` is `RECOVERY_REQUEST`, mode is `RECOVERY_ONLY`, carries no
ancillary data, and is followed by observed request-pipe EOF;
`requestEofObserved` must be the primitive `true`. The embedded selection schema
is
`oxigraph.candidate-containment-guardian-recovery-selection/v1`, and has
exactly:

```text
schema
targetSha256
recoveryRequirementsSha256
recoveryPlanSha256
recoveryReplaySha256
lifecycleInventorySha256
attemptSha256
planStatus
requiredActorKind
actorKind
recoveryActorEpochSha256
attemptDirectoryName
lifetimeAnchorProjectionSha256
lifetimeAttemptAnchorRawSha256
disposition
quarantineReason
sourceLocation
decisionSourceLocation
requiredDestinationLocation
stateCount
state0
state1
state2
state3
state4
state5
state6
state7
state8
state9
state10
state11
state12
state13
state14
state15
state16
state17
state18
```

`planStatus` is `RECOVERY_PLAN_READY`; `requiredActorKind` and `actorKind` are
both `RECOVERY_ONLY_GUARDIAN`; and `recoveryActorEpochSha256` equals the startup
epoch digest. `attemptDirectoryName` equals that same digest. `stateCount` is 1
through 19 because a `RECOVERY_PLAN_READY` plan has a nonempty state sequence.
Each used `stateN` is the SHA-256 of the repository-canonical JSON encoding of
the corresponding exact recovery-v1 lifecycle-state string, in order, and every
unused slot is null. Recovery-v1 owns disposition, quarantine-reason, location,
state, and nullability vocabularies; this contract validates the bounded
serialized binding without copying or weakening them.

The manager-side ADR-0037 owner must construct the selection from the full
tuple accepted by `verifyCandidateContainmentRecoveryAttemptV1`: attempt,
target, lifecycle inventory observation, previous recovery replay, plan,
lifetime-anchor projection, and lifetime-attempt-anchor raw digest. This pure
module cannot prove that serialized digests came from those private branded
values; it validates only their exact bounded pairing. ADR-0037 must perform
the branded predecessor verification before constructing the request.

For that constructor, `targetSha256`, `attemptSha256`, and
`lifetimeAttemptAnchorRawSha256` equal the identically named digest fields on
the verified tuple; `lifecycleInventorySha256` equals the verified lifecycle
inventory observation's `inventorySha256`. `recoveryRequirementsSha256` equals
the pinned recovery-v1 requirements digest. `recoveryPlanSha256`,
`recoveryReplaySha256`, and `lifetimeAnchorProjectionSha256` are the digests of
canonical JSON for the complete verified plan, replay, and lifetime-anchor
projections. `planStatus`, `requiredActorKind`, `actorKind`, actor epoch,
attempt-directory name, disposition, quarantine reason, source, decision
source, destination, state count, and state slots equal the corresponding
verified predecessor fields or the exact derived mappings above. ADR-0037 must
fail before serialization if any equality is absent.

`STATUS` has exactly:

```text
schema
action
mode
sequence
previousFrameSha256
requirementsSha256
startupSha256
epochSha256
state
admissionFrameSha256
recoveryRequestFrameSha256
terminalReason
```

Its action is `STATUS`. The last three fields are always present and null where
inapplicable. Exact status states are:

```text
NORMAL_READY
ADMISSION_ACCEPTED
CANCEL_REQUIRED
RECOVERY_REQUIRED
RECOVERY_REQUEST_ACCEPTED
CONTROL_TERMINAL
```

Exact terminal reasons are:

```text
EXPLICIT_CANCEL
CONTROLLER_CLOSED
DIAGNOSTIC_FAILURE
RECOVERY_CONTROL_HANDOFF
```

Only `CONTROL_TERMINAL` has a non-null terminal reason. It is the final wire
status, but it neither proves status EOF nor makes the transcript terminal.

Diagnostics remain a separate raw FD 2 stream and never become application
output. The bounded diagnostic-summary schema is
`oxigraph.candidate-containment-guardian-diagnostic-summary/v1`, with exact
fields `schema`, `byteLength`, `rawSha256`, and `eofObserved`. It must bind the
separately copied raw bytes. `eofObserved` must be a primitive boolean; either
value is a valid external diagnostic-failure observation and does not change
the fail-closed transition. Status and diagnostics have no inferred
cross-stream ordering.

### Incremental reducer and exact API

Wire frames and synthetic observations are distinct. The only synthetic inputs
are `CONTROLLER_CLOSED`, `DIAGNOSTIC_FAILURE`, `RECOVERY_CONTROL_HANDOFF`, and
`STATUS_EOF`; there is no generic terminal input. The recovery handoff records
only the runtime owner's claimed control-boundary handoff. It is not evidence
of recovery execution or completion.

The public module has exactly these named exports:

```text
CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS
CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256

createCandidateContainmentGuardianStartupV1
createCandidateContainmentGuardianAdmissionInputV1
createCandidateContainmentGuardianCancelInputV1
createCandidateContainmentGuardianRecoveryRequestInputV1
createCandidateContainmentGuardianControllerClosedInputV1
createCandidateContainmentGuardianDiagnosticFailureInputV1
createCandidateContainmentGuardianRecoveryControlHandoffInputV1
createCandidateContainmentGuardianStatusEofInputV1

initializeCandidateContainmentGuardianControlV1
reduceCandidateContainmentGuardianControlV1
verifyCandidateContainmentGuardianStatusFrameV1
```

The specific positional signatures are:

```text
createCandidateContainmentGuardianStartupV1(
  startupReportBytes,
  epochBytes,
  epochEofObserved,
)

createCandidateContainmentGuardianAdmissionInputV1(
  currentState,
  admissionFrameBytes,
  recvmsgReportBytes,
)

createCandidateContainmentGuardianCancelInputV1(
  currentState,
  cancelFrameBytes,
  messageTruncated,
  controlTruncated,
  controlMessageCount,
)

createCandidateContainmentGuardianRecoveryRequestInputV1(
  currentState,
  recoveryRequestFrameBytes,
  requestEofObserved,
)

createCandidateContainmentGuardianControllerClosedInputV1(currentState)
createCandidateContainmentGuardianDiagnosticFailureInputV1(
  currentState,
  diagnosticSummaryReportBytes,
  rawDiagnosticBytes,
)
createCandidateContainmentGuardianRecoveryControlHandoffInputV1(currentState)
createCandidateContainmentGuardianStatusEofInputV1(currentState)

initializeCandidateContainmentGuardianControlV1(startupProjection)
reduceCandidateContainmentGuardianControlV1(currentState, brandedInput)
verifyCandidateContainmentGuardianStatusFrameV1(
  startupProjection,
  statusFrameBytes,
)
```

Every input constructor binds its private metadata to the exact current-state
brand and digest. The reducer rejects stale, cross-state, cross-mode,
cross-session, separately imported, serialized, spread, or structured-cloned
lookalikes before reading their fields. It is an immutable incremental reducer,
not a transcript-array API.

The startup projection has exact fields `schema`, `mode`,
`requirementsSha256`, `startupReportByteLength`, `startupReportSha256`,
`epochSha256`, `descriptorCount`, `authority`, and `physicalFacts`. Every input
projection has exact null-padded fields `schema`, `kind`, `boundStateSha256`,
`frameByteLength`, `frameSha256`, `auxiliaryByteLength`, `auxiliarySha256`,
`authority`, and `physicalFacts`.

The projection schemas are exactly:

| Projection      | Schema                                                            |
| --------------- | ----------------------------------------------------------------- |
| Requirements    | `oxigraph.candidate-containment-guardian-control-requirements/v1` |
| Startup         | `oxigraph.candidate-containment-guardian-startup/v1`              |
| Input           | `oxigraph.candidate-containment-guardian-control-input/v1`        |
| State           | `oxigraph.candidate-containment-guardian-control-state/v1`        |
| Transition      | `oxigraph.candidate-containment-guardian-control-transition/v1`   |
| Status artifact | `oxigraph.candidate-containment-guardian-status-artifact/v1`      |

The fixed input projection fields map as follows:

| Kind                       | `frame*` fields                 | `auxiliary*` fields        |
| -------------------------- | ------------------------------- | -------------------------- |
| `ADMIT`                    | Exact admission frame           | Exact `recvmsg` report     |
| `CANCEL`                   | Exact cancel frame              | null                       |
| `RECOVERY_REQUEST`         | Exact recovery-request frame    | null                       |
| `CONTROLLER_CLOSED`        | null                            | null                       |
| `DIAGNOSTIC_FAILURE`       | Exact diagnostic-summary report | Exact raw diagnostic bytes |
| `RECOVERY_CONTROL_HANDOFF` | null                            | null                       |
| `STATUS_EOF`               | null                            | null                       |

State projections have exactly:

```text
schema
mode
phase
requirementsSha256
startupSha256
epochSha256
lastWireFrameSha256
nextWireSequence
aggregateWireBytes
admissionFrameSha256
recoveryRequestFrameSha256
admissionCount
cancelObserved
controllerClosedObserved
diagnosticFailureObserved
recoveryControlHandoffObserved
controlTerminalReason
statusEofObserved
transcriptTerminal
eventCount
authority
physicalFacts
stateSha256
```

Exact phases are `WAITING_NORMAL_INPUT`, `WAITING_RECOVERY_REQUEST`,
`WAITING_RECOVERY_HANDOFF`, `CONTROL_TERMINAL_EMITTED`, and
`TRANSCRIPT_TERMINAL`. `stateSha256` binds the canonical projection preceding
that field.

Initialization and reduction return an exact transition projection with fields
`schema`, `state`, `statusFrameCount`, `statusFrame0`, and `statusFrame1`.
`statusFrameCount` is 0 through 2 and unused fixed slots are null. Each non-null
status artifact has a copy-on-read `bytes` property and exact fields `schema`,
`mode`, `sequence`, `byteLength`, `rawSha256`, `state`, `terminalReason`,
`authority`, and `physicalFacts`. The status verifier returns the same exact
artifact shape after structural and startup/epoch binding checks; reducer
transition legality remains a separate guarantee.

For avoidance of accessor ambiguity, the exact own-key inventory of a status
artifact is `bytes`, `schema`, `mode`, `sequence`, `byteLength`, `rawSha256`,
`state`, `terminalReason`, `authority`, and `physicalFacts`. `bytes` is the sole
accessor: it is enumerable, nonconfigurable, has no setter, and returns a fresh
ordinary Buffer. Every other key is an enumerable, nonconfigurable,
nonwritable data property after freezing.

All records returned by the module have a null prototype, exact enumerable
fields, and are recursively frozen. Frozen vocabulary arrays inside the
requirements value are exact dense ordinary local arrays. Each access to a byte
property returns a fresh ordinary Buffer and exposes no retained alias.

The exact private-state manifest is three WeakMaps with lexical identifiers
`startupMetadata`, `inputMetadata`, and `stateMetadata`; no WeakSet or other
mutable permission store is permitted. Each constructor or reducer performs all
fallible work before its single private-state commit. The evaluator owns early
failure, late failure, successful commit, failure-after-success, and
cross-module-instance controls for all three stores.

Normal initialization emits `NORMAL_READY`; recovery initialization emits no
status. One reducer input emits at most two status frames. Every
reducer-reachable proper prefix of these exact complete sequences is accepted
with `transcriptTerminal: false`:

| ID  | Complete sequence                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | `NORMAL_READY -> CANCEL -> CANCEL_REQUIRED -> CONTROL_TERMINAL(EXPLICIT_CANCEL) -> STATUS_EOF`                                               |
| N2  | `NORMAL_READY -> ADMIT -> ADMISSION_ACCEPTED -> CANCEL -> CANCEL_REQUIRED -> CONTROL_TERMINAL(EXPLICIT_CANCEL) -> STATUS_EOF`                |
| N3  | `NORMAL_READY -> CONTROLLER_CLOSED -> RECOVERY_REQUIRED -> CONTROL_TERMINAL(CONTROLLER_CLOSED) -> STATUS_EOF`                                |
| N4  | `NORMAL_READY -> ADMIT -> ADMISSION_ACCEPTED -> CONTROLLER_CLOSED -> RECOVERY_REQUIRED -> CONTROL_TERMINAL(CONTROLLER_CLOSED) -> STATUS_EOF` |
| N5a | `NORMAL_READY -> DIAGNOSTIC_FAILURE -> CONTROL_TERMINAL(DIAGNOSTIC_FAILURE) -> STATUS_EOF`                                                   |
| N5b | `NORMAL_READY -> ADMIT -> ADMISSION_ACCEPTED -> DIAGNOSTIC_FAILURE -> CONTROL_TERMINAL(DIAGNOSTIC_FAILURE) -> STATUS_EOF`                    |
| R1  | `RECOVERY_REQUEST -> RECOVERY_REQUEST_ACCEPTED -> RECOVERY_CONTROL_HANDOFF -> CONTROL_TERMINAL(RECOVERY_CONTROL_HANDOFF) -> STATUS_EOF`      |
| R2  | `RECOVERY_REQUEST -> RECOVERY_REQUEST_ACCEPTED -> DIAGNOSTIC_FAILURE -> CONTROL_TERMINAL(DIAGNOSTIC_FAILURE) -> STATUS_EOF`                  |

The reducer transition table is exact:

| Current phase or operation | Input                             | Emitted statuses                                           | Successor phase and changed fields                                                            |
| -------------------------- | --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Normal initialization      | startup                           | `NORMAL_READY`                                             | `WAITING_NORMAL_INPUT`; event count 1                                                         |
| Recovery initialization    | startup                           | none                                                       | `WAITING_RECOVERY_REQUEST`; event count 0                                                     |
| `WAITING_NORMAL_INPUT`     | `ADMIT` when admission count is 0 | `ADMISSION_ACCEPTED`                                       | Same phase; admission digest set; admission count 1                                           |
| `WAITING_NORMAL_INPUT`     | `CANCEL`                          | `CANCEL_REQUIRED`, `CONTROL_TERMINAL(EXPLICIT_CANCEL)`     | `CONTROL_TERMINAL_EMITTED`; cancel observed; terminal reason `EXPLICIT_CANCEL`                |
| `WAITING_NORMAL_INPUT`     | `CONTROLLER_CLOSED`               | `RECOVERY_REQUIRED`, `CONTROL_TERMINAL(CONTROLLER_CLOSED)` | `CONTROL_TERMINAL_EMITTED`; controller close observed; terminal reason `CONTROLLER_CLOSED`    |
| `WAITING_NORMAL_INPUT`     | `DIAGNOSTIC_FAILURE`              | `CONTROL_TERMINAL(DIAGNOSTIC_FAILURE)`                     | `CONTROL_TERMINAL_EMITTED`; diagnostic failure observed; terminal reason `DIAGNOSTIC_FAILURE` |
| `WAITING_RECOVERY_REQUEST` | `RECOVERY_REQUEST`                | `RECOVERY_REQUEST_ACCEPTED`                                | `WAITING_RECOVERY_HANDOFF`; request digest set                                                |
| `WAITING_RECOVERY_HANDOFF` | `RECOVERY_CONTROL_HANDOFF`        | `CONTROL_TERMINAL(RECOVERY_CONTROL_HANDOFF)`               | `CONTROL_TERMINAL_EMITTED`; handoff observed; terminal reason `RECOVERY_CONTROL_HANDOFF`      |
| `WAITING_RECOVERY_HANDOFF` | `DIAGNOSTIC_FAILURE`              | `CONTROL_TERMINAL(DIAGNOSTIC_FAILURE)`                     | `CONTROL_TERMINAL_EMITTED`; diagnostic failure observed; terminal reason `DIAGNOSTIC_FAILURE` |
| `CONTROL_TERMINAL_EMITTED` | `STATUS_EOF`                      | none                                                       | `TRANSCRIPT_TERMINAL`; status EOF observed; transcript terminal                               |

Each input and emitted status increments `eventCount` by one. Incoming and
emitted wire-frame lengths increment `aggregateWireBytes`; synthetic inputs and
diagnostic-stream bytes do not. Each emitted status advances
`nextWireSequence`, becomes `lastWireFrameSha256`, and binds the preceding wire
frame. Fields not named as changed in the table survive unchanged.

Immediately after normal initialization, `mode` is `NORMAL`, phase is
`WAITING_NORMAL_INPUT`, `startupSha256` equals the startup report's raw JSONL
digest, `epochSha256` equals the raw epoch digest, `lastWireFrameSha256` equals
the emitted `NORMAL_READY` digest, `nextWireSequence` is 1,
`aggregateWireBytes` is that status frame's byte length, both admission and
recovery-request digests are null, admission count is 0, every observation flag
is false, terminal reason is null, transcript terminal is false, and event
count is 1. Immediately after recovery initialization, mode is `RECOVERY_ONLY`,
phase is `WAITING_RECOVERY_REQUEST`, last-wire digest is 64 lowercase zeroes,
next sequence and aggregate wire bytes are 0, the same nullable fields and flags
have their zero values, and event count is 0. Both states bind the exported
requirements digest, exact authority, exact physical facts, and their computed
state digest.

Status-frame nullability and binding are exact:

| Status                                  | Admission digest             | Recovery-request digest      | Terminal reason                                    |
| --------------------------------------- | ---------------------------- | ---------------------------- | -------------------------------------------------- |
| `NORMAL_READY`                          | null                         | null                         | null                                               |
| `ADMISSION_ACCEPTED`                    | exact admitted frame         | null                         | null                                               |
| `CANCEL_REQUIRED`                       | exact admitted frame or null | null                         | null                                               |
| `RECOVERY_REQUIRED`                     | exact admitted frame or null | null                         | null                                               |
| `RECOVERY_REQUEST_ACCEPTED`             | null                         | exact recovery-request frame | null                                               |
| `CONTROL_TERMINAL` after normal input   | exact admitted frame or null | null                         | exact normal terminal reason                       |
| `CONTROL_TERMINAL` after recovery input | null                         | exact recovery-request frame | `RECOVERY_CONTROL_HANDOFF` or `DIAGNOSTIC_FAILURE` |

Every status mode equals its startup mode; requirements, startup, and epoch
digests equal the current state; and sequence/previous-frame bindings follow
the single wire chain. No other nullability combination is valid.

When one input emits two status frames, both are an atomic transition output;
there is no independently reducible state between them. The evaluator still
checks the exact first-frame wire prefix before the second frame, but does not
invent a public state at that internal output boundary.

Only the final `STATUS_EOF` observation changes `transcriptTerminal` to true.
Any other ordering fails. `maximumAdmissionsPerTranscript` is 1 and
`concurrentAdmissionsPermitted` is false.
`maximumAdmissionsPerGuardianLifetime` is unasserted. This is one admission per
linear reducer transcript or generation, not one admission for an entire
physical guardian lifetime. Cross-invocation serialization and protection
against forking or replaying an earlier immutable state remain runtime-owner
obligations.

Every sequence is control-only. It establishes no `COMMIT`, supervisor launch,
application output, cleanup, journal fact, cgroup fact, or recovery completion.

### Exact failures, requirements, and hardening

The complete validation failure vocabulary is:

| Error message        | Meaning                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CONTROL_BOUNDS`     | Pre-decode byte ceiling, epoch length, count, slot, or aggregate ceiling                                            |
| `CONTROL_SHAPE`      | Buffer type, brand, local prototype, own-length, shared-backing, UTF-8, JSONL, canonical, or record-field violation |
| `CONTROL_STARTUP`    | Mode, FD, role, kind, access, direction, flag, socket, lock, EOF, or startup alias violation                        |
| `CONTROL_FRAME`      | Schema, action, carrier, structural sequence, truncation, or forbidden ancillary violation                          |
| `CONTROL_RIGHTS`     | Control-message count/type, right count/order/role/kind/access/flag/alias violation                                 |
| `CONTROL_BINDING`    | Requirements, startup, epoch, capsule, recovery selection, predecessor, previous-frame, or state binding mismatch   |
| `CONTROL_TRANSITION` | Illegal prefix, replay, reorder, second admission, recovery admission, or post-close/terminal input                 |

Each thrown error's message is exactly one code with no dynamic detail.
Structural sequence range or type errors are `CONTROL_FRAME`; a structurally
valid but unexpected sequence is `CONTROL_TRANSITION`. `DIAGNOSTIC_FAILURE` is
a legal terminal reason, not a validation error.

When an input has multiple faults, validation precedence is exactly
`CONTROL_BOUNDS`, `CONTROL_SHAPE`, `CONTROL_STARTUP`, `CONTROL_FRAME`,
`CONTROL_RIGHTS`, `CONTROL_BINDING`, then `CONTROL_TRANSITION`, skipping
categories irrelevant to that constructor. Bounds covers only raw byte,
aggregate byte, declared count, and fixed-slot range ceilings; a within-bound
but wrong exact startup descriptor count is `CONTROL_STARTUP`, and a
within-bound but wrong control-message or rights count is `CONTROL_RIGHTS`.
Admission truncation and ancillary metadata are `CONTROL_RIGHTS`; cancel
truncation or ancillary metadata are `CONTROL_FRAME`.

The single frozen requirements value has exact top-level fields `schema`,
`version`, `predecessors`, `schemas`, `limits`, `modes`, `startupMaps`,
`admissionRights`, `frameFields`, `vocabularies`, `legalSequences`,
`privateStateStores`, `authority`, `physicalFacts`, and `nonclaims`. It contains
all literals ratified above, including the source pins.

The normative machine-readable value is the complete JSON object in
[`fixtures/0036-guardian-control-requirements-v1.json`](fixtures/0036-guardian-control-requirements-v1.json).
Every nested record key, array item and order, null, number, boolean, string,
specifier, source pin, import name, schema, limit, vocabulary, sequence,
authority, physical fact, and nonclaim in that file is exact. Its canonical JSON
SHA-256 is
`0f244f7242eb40a615245a5eda77d5380e368f43a8382f27b3cdb5c1a387e499`,
which is the exact exported requirements digest.

The fixture's normal startup-map digest is
`1f2bcfca0089977fc1c5fdde2bfcfa6eed671e839a2daee87b5c19d3c2b4fffb`,
its recovery-only map digest is
`620b125181725cff59b7d11d08f193250f9046d3aec4021016418d0ab42d4594`,
and its 14-right map digest is
`082b09e65c5b58c92a909f27e3f9dd8b83e4833885e35846a31ace14c82744a2`.
The startup-map preimages are eight-slot arrays in FD order. Every present slot
is an exact spec record containing `fd`, `role`, `kind`, `accessMode`,
`closeOnExec`, `direction`, `statusFlags`, `openFileDescriptionClass`,
`byteBinding`, `currentOffset`, `socketFamily`, `socketType`, `connected`, and
`lockHeld`; recovery-only slot 7 is the complete value null. The right-map
preimage is a 14-record array in right-index order whose records contain
`index`, `role`, `targetSupervisorFd`, `kind`, `accessMode`, `closeOnExec`,
`statusFlags`, `openFileDescriptionClass`, `byteBinding`, and `currentOffset`.
`byteBinding` is `NONE` for present startup slots and
`MATCH_LAUNCH_CAPSULE_V3_ROLE` for rights. The maps use every exact value and
nullability rule in the preceding tables and prose.

The production module constructs the value in source and never reads the docs
fixture. The evaluator parses the fixture as its independent oracle and also
reconstructs the three map preimages from separately authored goldens. Importing
the production requirements object as expected data is forbidden.

`version` is the integer 1. The exact nonclaims record is:

```text
socketTransferProved: false
descriptorFactsProved: false
epochOriginProved: false
recoveryBrandProvenanceProved: false
runtimeSerializationProved: false
guardianExecutionProved: false
recoveryExecutionProved: false
cleanupProved: false
runtimeRegistrationProved: false
productionReadinessProved: false
```

The exact authority record is:

```text
transportAuthority: false
descriptorAuthority: false
filesystemAuthority: false
cgroupAuthority: false
processAuthority: false
recoveryAuthority: false
runtimeAuthority: false
```

The exact physical-facts record is:

```text
socketTransfer: null
descriptorInventory: null
epochOrigin: null
guardianExecution: null
recoveryExecution: null
cleanup: null
```

The evaluator performs a static source gate before evaluating the module. Only
exact named imports from the three pinned predecessors are allowed. Aliased,
default, namespace, side-effect, re-export, dynamic-import, `import.meta`,
`eval`, `Function`, constructor-gadget, encoded-identifier, host-API, provider,
runtime, and test-gaming paths fail with zero evaluation attempts.

The security-relevant syntax and dataflow gate uses the direct `acorn`
development dependency from the engineering-harness manifest. The manifest
requests `latest`; the committed lockfile binds the exact reviewed parser
artifact and integrity. Parsing is fixed to `ecmaVersion: 2022` and
`sourceType: "module"`, with hashbangs, top-level return, top-level await, and
every unclassified syntax node rejected. There is no lexer, regular-expression,
or permissive parser fallback. Parser-lock drift is evaluator-evidence drift
and requires review before the gate can run against candidate source.

The resulting ESTree analysis is reject-by-default. It classifies every
binding, receiver, callee, member access, literal role, branch join, mutation,
and private-store operation by provenance. Imported helpers, ambient
intrinsics, exported functions, and private stores may not be aliased or used
as first-class values. Function parameters remain untrusted until an exact
approved normalizer produces a bounded value. Computed members, indirect calls,
binding or member writes, unknown/union provenance, and mutable values reaching
a return or private-store commit fail before evaluation. The exact requirements
initializer is normalized from its AST and compared with the independently
pinned requirements oracle; capability-looking strings outside their exact
normative AST roles are rejected.

The analysis proves exactly ten direct private-store commits: one
`startupMetadata.set`, seven `inputMetadata.set`, and two `stateMetadata.set`
operations in their named owning functions. Each commit is outside control
flow, is dominated by every fallible operation, receives already frozen local
arguments, and is followed only by `return <prebuiltIdentifier>`. No early
return, later read, call, branch, throw, coercion, mutation, second commit,
store alias, or metadata path into the returned graph is permitted. Runtime
failure-atomicity and cross-module controls remain required independently of
this static proof.

The exact import allowlist is:

| Specifier                                | Exact named imports                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `./containment-exact-v2.mjs`             | `boundedInteger`, `canonicalJsonBytes`, `canonicalJsonLine`, `copyBoundedBuffer`, `decodeCanonicalBase64`, `decodeCanonicalJsonLine`, `deepFreeze`, `exactBoolean`, `exactDigest`, `exactRecord`, `frozenCopyOnReadBytes`, `nullRecord`, `sha256`                                                                                                                              |
| `./containment-launch-capsule-v3.mjs`    | `CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3`, `CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3`, `verifyCandidateContainmentLaunchCapsuleV3`                                                                                                                                                                                                                             |
| `./containment-guardian-recovery-v1.mjs` | `CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1`, `CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1`, `CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1`, `CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1`, `CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1`, `CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1`, `CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1` |

Production source may reference only the ambient language intrinsics `Array`,
`Boolean`, `Error`, `Number`, `Object`, `Reflect`, `Set`, `String`, and
`WeakMap`. `Buffer` is deliberately absent: production code may neither call a
Buffer static nor invoke a Buffer prototype directly. This is an identifier
allowlist, not authority: no prototype lookup from untrusted values is
permitted. `Date`, `JSON`, `Promise`, `Proxy`,
`globalThis`, `process`, environment access, timers, randomness, direct crypto,
filesystem, networking, process, worker, VM, and module-loader APIs are
forbidden. Canonical JSON, hashing, and byte handling arrive only through the
pinned exact-v2 helpers.

The module accepts data only. It accepts no root pathname and no injectable
filesystem, socket, cgroup, process, clock, randomness, execution, provider, or
test callback. Its brands prove only same-module construction and pairing,
never physical origin or authority.

## Owned files

This ADR owns these new candidate and evaluator paths:

- `docs/adr/fixtures/0036-guardian-control-requirements-v1.json`;
- `tools/engineering-harness/src/candidate/containment-guardian-control-v1.mjs`;
- `tools/engineering-harness/test/candidate-containment-guardian-control-v1.test.mjs`;
  and
- `tools/engineering-harness/test/candidate-containment-guardian-control-v1-adversarial.test.mjs`.

It also authorizes changes to the following shared harness files solely to add
`acorn` as an evaluator-only `latest` development dependency and bind its exact
resolved artifact. No other dependency may be refreshed by that change:

- `tools/engineering-harness/package.json`; and
- `tools/engineering-harness/package-lock.json`.

The parser is not a production-module dependency, is not part of the five-
package runtime dependency identity in ADR-0017, and grants no production or
provider capability. A separate analyzer support file would require another
explicit owned-file amendment; until then the analyzer remains in the main
evaluator.

It may import only exact named exports from `containment-exact-v2.mjs`,
`containment-guardian-recovery-v1.mjs`, and
`containment-launch-capsule-v3.mjs`. It does not own or modify those
predecessors, journal-v1, journal-v2, lifetime-v1, supervisor-control-v2,
supervisor-preflight-v4, registries, readiness, or any production runtime.

## Nonclaims and authority boundary

Creation or verification of a control value proves none of the following:

- socket creation, peer identity, message delivery, or actual `SCM_RIGHTS`
  transfer;
- descriptor origin, access mode, non-aliasing, ownership, closure, or lifetime
  in a process;
- the truth of a reported `F_GETFL`, `F_GETFD`, `O_PATH`, open-file-description
  identity, `MSG_CMSG_CLOEXEC`, truncation, carrier, or peer observation;
- epoch randomness, freshness, pipe origin, exact writer, or observed EOF;
- state-root locking, journal persistence or durability, cgroup state, process
  placement, execution, parentage, pidfd ownership, wait authority, or reap;
- guardian, manager, recovery, containment, application-result, or cleanup
  execution;
- private-brand provenance for the recovery-v1 tuple serialized by ADR-0037;
  or
- one-admission serialization across forked reducer states or separate module
  invocations; or
- runtime registration, G1.7 execution, qualification, promotion, or
  publication.

All authority fields remain false, all physical facts remain null or false, and
production readiness remains exactly unchanged.

## Acceptance boundary

Implementation requires:

- an evaluator-owned RED suite before production source exists, followed by the
  smallest source that satisfies the frozen public surface;
- exact positive cases for both modes and every permitted frame prefix;
- exact independent goldens for all named exports, the requirements value and
  digest, schemas, fixed-slot projections, status bytes, authority, physical
  facts, and whole transition outputs;
- exhaustive missing, extra, duplicated, aliased, wrong-kind, wrong-mode,
  wrong-direction, reordered, over-count, over-byte, short-epoch, trailing-byte,
  and missing-EOF controls;
- exact `SCM_RIGHTS` count/order/CLOEXEC/truncation controls, all 91 right-pair
  aliases, all 112 right-to-startup aliases, all 28 normal-startup aliases, all
  21 recovery-startup aliases, and rejection of normal/recovery confusion;
- complete controller-close, explicit cancel, diagnostic, and terminal reducer
  transitions with no invented physical observation;
- every reducer-reachable proper prefix, each internal emitted-status wire
  prefix, and all delete, duplicate, reorder, direction, sequence,
  second-admission, stale-state, and post-terminal mutations of the eight legal
  sequences;
- bounds-first and trap-free adversarial validation, copy-on-entry and
  copy-on-read bytes, recursive output freezing, and exact private-store commit
  controls;
- rejection of launch-capsule v2 substitution, a birth actor in recovery mode,
  non-null recovery state padding, malformed canonical bytes, foreign non-null
  prototypes, Proxies, own `length`, subclasses, shared backing, and separately
  imported brands, plus zero-invocation normalization controls for arbitrary
  additional non-index own string, symbol, data, getter, and setter properties
  that prove no enumeration, inspection, read, write, invocation, or caller
  mutation;
- a pre-evaluation static import/export and ambient-capability audit;
- reject-by-default ESTree binding/provenance analysis, path-sensitive
  normative-literal reconstruction, and exact ten-operation private-store
  commit-position proof, with zero candidate evaluation attempts for every
  negative control;
- byte-identical predecessor sources and fixtures, and unchanged registries and
  `{status: "unavailable", reason: "native-adapter-unavailable"}` readiness; and
- focused and complete explicit non-G1.7 suites on the current Node runtime and
  Node 20, followed by independent contract, compatibility, and security review.

Passing this boundary permits ADR-0037 work only. It grants no permission to
start a filesystem-backed manager or guardian owner.

## Consequences

- Native code receives an independently frozen transport and failure oracle.
- Normal admission and recovery startup cannot silently share descriptors or
  authority.
- The runtime owner must serialize reducer-state use and ADR-0037 must convert
  branded recovery-v1 values into the bounded selection report.
- A new exact-value contract, private-state commit protocol, and adversarial
  evaluator must be maintained.
- No production behavior changes at this stage.
