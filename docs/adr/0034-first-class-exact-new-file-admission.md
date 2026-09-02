# ADR-0034: First-class exact new-file admission in the engineering harness

- **Status**: Proposed
- **Date**: 2026-08-28
- Updated: 2026-09-02
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented with a separate dormant,
  non-product schema-v2 registration.
  Commits `78b2cf99` through `65fb0e7a` freeze schema-v1 byte compatibility and
  add the v2 path, tree, contract, reconstruction, worker-context, schema,
  assembly, and output-validation primitives. Commit `54a056e0` adds the exact-
  byte native runner/worker boundary, retained-descriptor verification, bounded
  Git parsing, and fail-closed original-process-group cleanup. Commits
  `faae3d28`, `5b980c08`, and `d07cfdfa` move reconstruction onto exact bytes,
  bind the raw contract, and seal the opaque candidate identity. Commit
  `11e72201` adds the one-shot opaque candidate/verifier lifecycle, exact
  submodule materialization, structural sandbox host/worker protocol, typed
  verifier classification, coherent cleanup/quarantine proofs, shared
  contract/session ceilings, and Cargo-normalized artifact binding. Commit
  `f3a0c127` exact-copies and retained-FD-binds the eight-file ESM/launcher
  payload with explicit runtime, execveat, same-UID, and transient-mutation
  nonclaims. Commit `c2cdde16` adds the dormant candidate-specific cgroup-v2 /
  pidfd lifecycle contract, bounded failure retention, and fixed readiness
  delegation without importing qualification code or minting physical
  authority. Commit `23997c29` adds the unregistered canonical supervisor
  request/status replay and an exact compile-only freestanding static
  supervisor attestation. That predecessor artifact implements no parser,
  writer, or containment mechanic, is never executed, and remains binding-null
  and authority-free. Commit `88b9d7e7` adds a separate successor FD-map v2,
  canonical argv/environment documents, an exact fourteen-file launch capsule,
  collision-safe-remap and bounded output/pidfd-lifecycle requirements, and a
  pure interactive START/READY/COMMIT/CANCEL reducer. The reducer re-executes
  supplied capsule bytes, keeps READY decision-null, binds later decision
  acknowledgements to exact decision bytes, keeps physical outcomes null, and
  makes pre-commit cleanup guardian-owned. Commit `7191ddde` adds an additive
  launch-capsule v2 successor with exact FDs 18-25, a CLOEXEC exec-outcome
  channel, positive held-stop `PTRACE_EVENT_EXEC` image proof, and complete
  child/parent failure classifications. It also adds an in-band, cancel-only
  `START`/`CAPSULE`/`READY`/`CANCEL`/terminal bootstrap. Retained-file claims
  are scoped to FDs 4-17; live FDs 0-3, global sole-writer proof, guardian
  cleanup, freshness, physical facts, and all authority remain unproved,
  null, or false. That successor passes 11/11 focused tests and its then-current
  related matrix passed 248/248 on both current Node and Node 20. Commit
  `ab668ddd` adds ADR-0035's separate unregistered pure guardian-journal
  contract: canonical write-once record bytes, raw hash chaining, exact replay
  anchors and state-specific bindings, conservative prefix/complete replay,
  null physical facts, and all-false authority. Commit `040f3343` executes a
  separate Linux x86-64 preflight successor only in a local test fixture. It
  observes the held execution-copy identity, exact descriptor inventories,
  cancel-only terminal transcript, bounded stream/process cleanup, and thirty
  returned fail-closed scenarios without producing semantic capsule facts,
  cgroup evidence, pidfd/waitid evidence, physical eligibility, or authority.
  Its focused suite passes 47/47, the top-level non-G1.7 suite excluding the
  separate committed-clean identity control passes 495/495, and that identity
  control passes 2/2 on both current Node and Node 20. Commit `fd9e4d05` then
  adds the ADR-owned early qualification gate; it is the first executable v2
  action and returns the fixed unavailable result before candidate/evaluator
  Git, submodule, process, provider, receipt, acceptance, rejection, or Router
  work. Commits `c9cb6423`, `997ad287`, and `dfd6d92d` freeze the exact
  baseline/evaluator/reference chain. Commit `f9ab7c72` adds a separate frozen
  dormant-v2 profile registry, its exact raw contract, production worker-
  context binding, and reconstruction evidence without adding the identity to
  the active v1 registry or CLI. The raw contract SHA-256 is
  `58a9207303ab541552fa3b8342ad61bc24a3cb8b9b97a6d8236a58b3440489ad`;
  its canonical SHA-256 is
  `f345886f86725dbedf4a57b1abfd9e66d5153ae7d0c86e79bbe251e71bb22d08`.
  The broader exact-create task is 97% in progress; ADR-0035's separate native
  task is 75% in progress. Committed schema-v1 fixtures remain byte-identical,
  and their active registry remains exactly nine tasks and 33 commands.
  Production containment remains fixed unavailable: the filesystem-backed
  native guardian/reaper, recovery mutation, race-free exec and pidfd/waitid
  binding, interactive native adapter, and full path-executed runtime-closure
  proof, application receipt v7/replay, dormant v2 command/CLI/package
  dispatch, and the complete gate are not implemented. G2.2 may not admit a
  new product module until the complete v2 gate, current host qualification,
  and a separately ratified commit-capable successor all pass
- Programme task: `task-1787935934614-ibmjn1` (`HARNESS-CREATE-EXACT`)
- **Depends on**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)
- **Related**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md)

## Context

The private engineering harness reconstructs a frozen evaluator tree, admits a
bounded candidate patch, checks the protected-tree projection, and creates a
deterministic candidate commit. Its schema-v1 contracts intentionally support
only edits to files already present in the baseline. Although the patch parser
has an `allowCreate` branch, v1 contract validation requires that value to be
false. Baseline verification also resolves every `mutableExact` path as an
existing Git blob, protected-manifest counts subtract every mutable path, and
worker source snapshots require every allowlisted file to exist.

G2.2 needs a focused semantic-change module rather than an unrelated expansion
of `store.rs`. Merely changing `allowCreate` would therefore open the patch
parser without fixing baseline identity, protected counts, source projection,
raw Git status, path ambiguity, or receipt replay. Creating an empty product
file first would make the old harness appear applicable, but would move an
architectural admission decision outside the exact candidate contract. Putting
the implementation in `store.rs` would avoid the harness limitation by making
the product boundary worse.

The harness needs an explicit representation of absence. Creation is a
different state transition from modification and must be frozen, reconstructed,
and receipted as such.

## Decision

Add a schema-v2 engineering task contract with first-class, exact new-file
admission. Keep the committed schema-v1 task and receipt fixtures and their
canonical projection bytes byte-identical, and keep schema-v1 parsing, command,
and replay behavior compatible while shared parser, dispatch, and command
sources add v2. V1 continues to require `allowCreate: false` and reject every
creation patch. This task-contract version is distinct from the engineering
application-receipt versions described below.

### Shared exact-v2 byte-helper ownership amendment

ADR-0034 owns the shared
[`containment-exact-v2.mjs`](../../tools/engineering-harness/src/candidate/containment-exact-v2.mjs)
source and the additive category-aware byte-helper ABI specified below.
ADR-0036 is a pinned consumer, not a co-owner. At the amendment baseline
`3ecff6f2`, the source SHA-256 is
`2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3`
and its existing public surface is exactly these 18 function exports:

```text
sha256
nullRecord
deepFreeze
frozenCopyOnReadBytes
exactRecord
exactDenseArray
boundedInteger
exactBoolean
exactDigest
exactDecimal
exactUnicodeString
copyBoundedBuffer
exactBufferByteLength
decodeCanonicalJsonLine
canonicalJsonLine
canonicalJsonBytes
encodeCanonicalBase64
decodeCanonicalBase64
```

An implementation owned by this ADR may add exactly this function without
changing any existing export's name, positional signature, defaults, return
value, failure behavior, or other observable semantics:

```text
copyBoundedBufferByFailureCategory(
  value,
  label,
  { minimumBytes = 0, maximumBytes },
  failBounds,
  failShape,
)
```

The helper defines an observable intrinsic-Uint8 byte carrier, not Buffer
construction provenance. All intrinsics named below are retained before a
caller value is accepted. Its validation and first-failure order is exact:

1. If retained `util.types.isProxy` identifies `value` as a Proxy, or retained
   `util.types.isUint8Array(value)` is false, call `failShape`. This stage reads
   no caller property, enumerates no caller key, and invokes no caller
   accessor.
2. Read `value`'s length with the retained typed-array intrinsic length getter.
   An unreadable or non-safe intrinsic length, an invalid byte interval, or a
   length outside that interval calls `failBounds`. No later shape condition is
   inspected first.
3. Require the immediate prototype to equal the retained local
   `Buffer.prototype`, require no own `length` property, and read the backing
   store with the retained typed-array intrinsic backing getter. An inspection
   failure, a different immediate prototype, an own `length`, or
   `SharedArrayBuffer` backing calls `failShape`. For non-shared backing, prove
   liveness only by retained `Reflect.construct(DataView, [backing, 0, 0])`;
   failure of that zero-length view construction also calls `failShape`.
4. Only after every preceding validation succeeds, allocate a fresh ordinary
   local Buffer, copy the indexed bytes with retained intrinsics, return it, and
   retain no caller alias.

The first applicable stage owns a combined fault. A non-Uint8 forgery fails
shape before bounds. An over-bound intrinsic Uint8 value with a later prototype,
own-length, backing-read, shared-backing, or detached-backing fault fails bounds.
A detached carrier whose intrinsic length is zero fails bounds when the minimum
is one, but reaches the liveness check and fails shape when zero is in range. A
local `Uint8Array` whose immediate prototype has been normalized to the retained
local `Buffer.prototype` is intentionally admitted: the supported observations
cannot distinguish its construction history from a Buffer's. In contrast,
`Object.create(Buffer.prototype)`, a `DataView`, and a non-Uint8 typed array
remain non-Uint8 forgeries and fail at stage 1 even if their immediate prototype
is changed to `Buffer.prototype`.

Stage 3's liveness check may not use `ArrayBuffer.prototype.slice`, any other
species-bearing operation, or any copying operation. Such probes can consult a
backing store's `constructor` or `Symbol.species` and can allocate or copy before
shape validation. Those properties remain unread, and the only byte copy is the
fresh result created at stage 4. Arbitrary additional non-index own string or
symbol properties remain unenumerated, unread, unwritten, and absent from the
copy. Both failure callbacks are terminal and may not return.

The supported-runtime basis is the engineering harness's Node `>=20` floor and
its Node 20/current-runtime lanes. Those runtimes provide the retained public
Node and language intrinsics above, but no supported intrinsic that recovers a
carrier's Buffer-construction history once the same observable intrinsic-Uint8
brand and immediate local prototype are present. This ADR-local contract is
therefore complete in terms of supported observations and adds no external
library, native add-on, undocumented V8 dependency, or construction-provenance
claim.

The existing `copyBoundedBuffer` and `exactBufferByteLength` functions retain
their current semantics; the new category-aware order is not retrofitted into
either function.

The following nine source files are the complete direct-importer set at the
amendment baseline. Their bytes and SHA-256 identities remain unchanged by the
additive helper slice:

| Direct importer | SHA-256 |
| --- | --- |
| `containment-guardian-journal-v1.mjs` | `c48c6692752550a547fa5936ab47c78170c6e33f0d8d527fe2d24c4ffc5e1276` |
| `containment-guardian-journal-v2.mjs` | `0fd3751914828519300cdcb3d327824ce78c5b95e5a9acd7211a376b548f0075` |
| `containment-guardian-lifetime-v1.mjs` | `f454ee962615e887c294f4aabade6a640ac1881fd3662842b75a3be8afb8f3e5` |
| `containment-guardian-recovery-v1.mjs` | `e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d` |
| `containment-launch-capsule-v2.mjs` | `4b6a7ed38f3b91d25488d0f9a3c88d376e1907086be17c62dc949ab80c74dda4` |
| `containment-launch-capsule-v3.mjs` | `9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d` |
| `containment-supervisor-bootstrap-v3.mjs` | `f045a0830067f9e41d6532663754938d1cdeece4f088b732dac054ba9fe3efa5` |
| `containment-supervisor-control-v2.mjs` | `92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842` |
| `containment-supervisor-preflight-v4.mjs` | `747c913e60768c53bdeeec923a6ff2f1319121d743bddd8e4db663c1a03d23ff` |

Adding the helper changes the shared exact-v2 source identity and therefore
requires explicit downstream evidence review even though those nine importer
sources remain byte-identical. No source pin, fixture digest, expected result,
or receipt may be silently refreshed, resealed, or rebaselined. This amendment
does not authorize a package-manifest or lockfile change, dependency refresh,
readiness transition, runtime registration, qualification, authority,
promotion, or publication. All such state remains unchanged until exact
re-pinned evidence is separately reviewed.

#### 2026-09-02 shared-helper implementation checkpoint

Commit `41dd2508` implements the additive helper specified above. The live
`containment-exact-v2.mjs` is now 12,687 bytes with SHA-256
`194fb41e523b334206e91b2dfda8894f5e661a3d034b7330e3e6bd549e4c744e`.
The 18 exports listed above remain unchanged and the new helper is the additive
19th export. All nine incumbent importer source identities in the table above
remain unchanged; ADR-0036 is the only consumer changed by its separately
reviewed C15 slice.

The helper-focused matrix passes 20/20 on current Node 24.14.1, exact Node
20.0.0, and Node 20.20.2. This implementation changes no package manifest,
lockfile, dependency, registry, readiness value, runtime surface, or authority.
It neither qualifies nor promotes the helper or any downstream consumer. The
earlier 10,833-byte source identity
`2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3`
remains the historical C14 envelope; it is not the live C15 source identity.

### Exact scope and mutable baselines

Schema v2 keeps `scope.mutableExact` as the total byte-exact candidate path
authorization and adds `scope.createExact`, an ordered byte-exact subset whose
paths are absent from both the baseline and evaluator trees and must be created
by the candidate. Entries in `mutableExact` that are not in `createExact` must
already be regular blobs. Prefix admission does not imply creation. A derived
`allowCreate` projection is true exactly when
`createExact.length > 0`; it grants no path by itself, and a supplied or cached
value that disagrees with the derivation is rejected.

`protectedInputs.mutableBaselines` binds every exact mutable path once, in
canonical byte order, with one of two states:

- `present`, carrying separate `baseline` and `evaluator` identities, each with
  exact mode `100644`, type `blob`, full Git object ID, and content SHA-256; or
- `absent`, carrying explicit absent baseline and evaluator states and no blob
  or content digest, and requiring membership in `createExact`.

`mutableBaselines` has exactly one entry for every `mutableExact` path.
`createExact` is a duplicate-free byte-exact subset of `mutableExact`; its
entries are `absent`, while every `mutableExact` entry outside that subset is
`present`. The ordered `mutableBaselines` paths equal `mutableExact`. For each
present entry, the baseline and evaluator identities must be equal but are
resolved independently from their respective trees, checked as exact regular
`100644 blob` entries, and content-hashed independently. An absent path becoming
present before the candidate patch, a present path becoming absent, or an
evaluator changing a present mutable blob is contract drift.

Protected manifests use phase-specific exclusions. Let `P` be the count of
present mutable entries and `M` be `mutableExact.length`:

- baseline and evaluator protected manifests exclude the `P` present entries
  only, so their protected counts are their respective full counts minus `P`;
- absent entries are not subtracted from baseline or evaluator counts because
  they are not source-tree entries; and
- the candidate protected manifest excludes all `M` final `mutableExact`
  entries, including every newly created entry, so its protected count and
  digest must equal the evaluator protected projection.

Full and protected manifest counts and digests remain exact inputs. Contract
validation, reconstruction, and receipt replay all recompute the appropriate
phase projection rather than applying one subtraction formula everywhere.

### Literal path and tree controls

All v2 paths use the explicit ASCII-safe segment grammar
`[A-Za-z0-9_][A-Za-z0-9._-]*`, joined only by `/`. This excludes absolute and
drive paths, `.` and `..`, empty segments, trailing slash, backslash, control
bytes, leading `-`, Git pathspec magic, wildcards, and revision separators.
Each declared creation path must have an existing regular directory parent
chain in both source trees. The harness rejects creation of directories,
implicit parent directories, symlinks, gitlinks, nested repositories, and paths
beneath a symlink or gitlink.

`mutableExact`, its `createExact` subset, and `mutablePrefixes` are checked with
exact component boundaries. A v2 creation contract requires
`mutablePrefixes: []`; a non-empty prefix list, including one that overlaps an
exact path, rejects rather than widening authority. `mutableExact` entries may
not duplicate or be ancestors or descendants of one another; every
`createExact` entry must match one `mutableExact` entry byte for byte and
introduces no second authorization. The fixed portable case fold is ASCII
`A`-`Z` to `a`-`z`; the same duplicate and component-prefix checks run on those
folded bytes.

No pathspec lookup decides presence or object identity. For both baseline and
evaluator, the verifier parses complete NUL-framed
`git ls-tree -r -t -z --full-tree <tree>` output, including `040000 tree`
entries, into an exact byte-keyed object map. Every `createExact` target must be
absent as any object, must not be the ancestor of an existing object, and may
share only its exact-spelled strict ancestors, each of which must be a tree.
The target, its ancestors, and all declared exact paths are checked against
existing file and directory paths under portable case fold; an alternate-case
collision rejects even when the exact byte path is absent. Exact-spelled parent
trees and a present mutable entry's own exact bound object are the only allowed
matches. A different existing file or directory with the same folded path
rejects. A present mutable entry must resolve to its already-bound
`100644 blob` object.

The verifier reads a selected blob by its already-validated object ID with
literal `git cat-file blob <object-id>`. It does not interpolate a path into
revision syntax or pass a candidate path as a Git pathspec.

### Canonical creation patch and candidate tree

A created file must be non-empty, UTF-8, and terminal-LF-terminated. Empty files
and files without a terminal LF are not admitted by schema v2. Its unique
full-file unified-diff form contains exactly these records in this order, with
no blank or additional metadata records:

1. `diff --git a/<path> b/<path>` with byte-identical paths;
2. `new file mode 100644`;
3. a full-width `index <zero-object-id>..<new-blob>` whose new object ID is
   recomputed from the complete admitted content;
4. `--- /dev/null`;
5. `+++ b/<path>`; and
6. exactly one `@@ -0,0 +1,N @@` hunk, where positive safe integer `N` equals
   the number of following `+` payload lines.

The patch itself has one terminal LF. A `\ No newline at end of file` marker,
context line, removal line, second hunk, partial-file hunk, zero-line hunk, or
alternate range spelling rejects. Creation sections occur once per
`createExact` path in canonical byte order.

Modification sections retain the v1 metadata form. Deletion, rename, copy,
binary patch, mode change, symlink, gitlink, directory creation, repeated
section, mixed create/modify metadata, and a creation section for a `present`
path all fail closed.

After applying the patch to the index, the harness parses the complete
NUL-framed raw diff between evaluator and candidate trees with rename detection
disabled. Every `createExact` path must have raw status `A`; every changed
`mutableExact` path outside `createExact` must have status `M`; no other status
or path is accepted. Every final `mutableExact` entry must be a regular
`100644 blob`, and every declared `createExact` path is required to be present.
V2 has no optional creation.

### Worker context, reconstruction, and receipts

Absent paths are omitted from source snapshots. The immutable worker context
instead carries explicit creation instructions derived from the contract:
exact path, required `A` transition, final `100644` type, patch ceiling, and the
fact that no baseline content exists. Present source files retain exact content
and digest bindings. A worker cannot manufacture creation authority by naming a
path that is absent from this instruction set.

Candidate reconstruction remains deterministic: the raw contract digest,
evaluator patch, canonical candidate patch, ordered path/status projection,
candidate tree, protected manifest, and fixed `commit-tree` identity are all
bound. The engineering task contract, worker context, source snapshot, and
task-level reconstruction/verification projections advance together from their
current schema v1 to explicit schema v2 for a v2 task; none reinterprets v1
bytes.

That task-level schema family is separate from
`oxigraph.engineering-application-receipt/v1` through `/v6`. Those application
receipt fixture bytes remain byte-identical, and their verification and replay
behavior remains compatible while shared verifier sources evolve to add v7. A
v2 task whose application receipt body binds the ordered mutable-baseline
states, ordered `A`/`M` projection, phase-specific protected manifests, and
created blob identities must emit
`oxigraph.engineering-application-receipt/v7`; it may not relabel an older
application receipt. Replay recomputes every value from exact Git objects and
rejects a receipt that relabels creation as modification.

### Dormant pre-registration and early execution gate

This ADR exclusively owns and ratifies the dormant application-receipt-v7
constructor, verifier, and replay; schema-v2 command dispatch and candidate
reconstruction; frozen v2 task profile; and exact command, CLI, and package
literals. Application receipts v1 through v6 and committed schema-v1 receipt
and task fixtures remain byte-identical; schema-v1 parsing, command, and replay
behavior remains compatible while the shared dispatch sources add v2. ADR-0039
may consume the ratified v2 bytes unchanged after host qualification; it does
not own or revise them.

Every schema-v2 preflight, run, and replay request carries exactly:

```js
{
  contractSchemaVersion: 2,
  executionGate: "native-containment-qualification-v1",
}
```

The first executable action is the fail-closed qualification gate. It runs
before `reconstruct-v2` performs workspace preparation or any candidate or
evaluator Git read. While that gate returns exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, preflight,
run, and replay perform zero candidate or evaluator Git work, submodule work,
process launch, provider work, `ACCEPT`, `REJECT`, application-receipt
emission, or Router-quality work. A later check immediately before physical
execution remains mandatory defense in depth; it does not replace or defer the
early gate.

The exact dormant v2 implementation surface belongs to this ADR:

- `tools/engineering-harness/src/receipts/application.mjs`;
- `tools/engineering-harness/src/runtime/application-admission.mjs`;
- `tools/engineering-harness/src/contract.mjs`;
- `tools/engineering-harness/src/contract-v2.mjs`;
- `tools/engineering-harness/src/runtime/preflight.mjs`;
- `tools/engineering-harness/src/runtime/g12-programme.mjs`;
- `tools/engineering-harness/src/runtime/task-context-v2.mjs`;
- `tools/engineering-harness/src/candidate/reconstruct-v2.mjs`;
- `tools/engineering-harness/src/task-profile.mjs`;
- `tools/engineering-harness/src/command-registry.mjs`;
- `tools/engineering-harness/bin/oxigraph-engineering-harness.mjs`;
- `tools/engineering-harness/package.json`; and
- `tools/engineering-harness/tasks/v2/harness-create-exact-v2/contract.json`.

Focused evidence belongs in these existing paths:

- `tools/engineering-harness/test/application-receipt.test.mjs`;
- `tools/engineering-harness/test/application-admission.test.mjs`;
- `tools/engineering-harness/test/contract.test.mjs`;
- `tools/engineering-harness/test/contract-v2.test.mjs`;
- `tools/engineering-harness/test/preflight.test.mjs`;
- `tools/engineering-harness/test/g12-programme.test.mjs`;
- `tools/engineering-harness/test/candidate-reconstruction-v2.test.mjs`;
- `tools/engineering-harness/test/task-context-v2.test.mjs`;
- `tools/engineering-harness/test/task-profile.test.mjs`; and
- `tools/engineering-harness/test/cli.test.mjs`.

The remaining implementation must freeze the receipt/command/CLI fixtures
before dormant dispatch registration and continue to prove that every
unavailable-gate path reaches none of the forbidden effects above.

### Bounded failure behavior

The implementation follows the programme's adopted MetaHarness ADR-160 —
Escalation scheduler bounded loops — discipline. Validation, reconstruction,
snapshot creation, and replay each make one bounded attempt and return one
finite typed reason. No path error, Git lookup error, patch mismatch, status
mismatch, or receipt mismatch triggers an automatic retry, permissive fallback,
prefix widening, or reinterpretation as v1. The initial v2 taxonomy is exactly:

- `ERR_CONTRACT_SCHEMA_OR_KEYS`;
- `ERR_PATH_INVALID`, `ERR_PATH_OVERLAP`, or `ERR_PATH_COLLISION`;
- `ERR_PARENT_TREE` or `ERR_BASELINE_STATE`;
- `ERR_OBJECT_TYPE`;
- `ERR_PATCH_CANONICAL` or `ERR_PATCH_CEILING`;
- `ERR_CANDIDATE_STATUS`;
- `ERR_PROTECTED_MANIFEST` or `ERR_SOURCE_SNAPSHOT`;
- `ERR_RECONSTRUCTION` or `ERR_RECEIPT_REPLAY`; and
- `ERR_INTERNAL_FAIL_CLOSED` for an otherwise unclassified terminal failure.

Tests must enumerate every public reason and prove that unknown internal errors
map to one terminal fail-closed result without exposing host paths or command
output.

## G2.2 admission gate

Implement and freeze the schema-v2 control before the G2.2 evaluator admits a
new semantic-change module. The gate is complete only after the
contract/profile registry, candidate reconstruction, worker context,
receipt/replay, CLI dispatch, and focused negative controls all use the same
exact v2 model. Passing this harness gate is engineering evidence only; it does
not implement G2.2, change ADR-0020's Proposed status, or grant semantic
qualification or promotion authority.

The currently designed containment protocol is cancel-only and rejects
`COMMIT`. Therefore completion of this dormant gate and later ADR-0039 host
qualification still cannot admit G2.2. A separately ratified commit-capable
successor, with its own evaluator and exact receipt/cleanup semantics, must
close before any semantic-change module can execute or commit.

There is no pre-v2 exception or contingency. No product file, empty or
otherwise, may be added to manufacture a present baseline before this gate is
implemented and frozen.

## Acceptance boundary

The implementation must prove:

- all committed engineering task-contract and task-level receipt/projection
  schema-v1 fixtures are byte-identical, v1 still requires
  `allowCreate: false`, and v1 rejects creation metadata;
- committed application-receipt v1-v6 fixture bytes are byte-identical and
  their verification and replay behavior remains compatible, while an
  application receipt for a v2 task uses the new v7 schema and exact v2 fields;
- the exact `contractSchemaVersion: 2` / execution-gate pair is required by
  every v2 preflight, run, and replay path; unavailable or invalid
  qualification stops before reconstruction workspace preparation and performs
  zero candidate/evaluator Git, submodule, process, provider, `ACCEPT`,
  `REJECT`, receipt-emission, or Router-quality work;
- a frozen v2 fixture reconstructs one exact new module and one mixed
  existing-file/new-file candidate with raw statuses `M` and `A` respectively;
- absent baselines are omitted from snapshots, explicit creation instructions
  are exact and immutable, source protected counts subtract present entries
  only, and candidate protected counts subtract every final `mutableExact`
  entry;
- baseline and evaluator independently prove every present mutable entry as the
  same exact `100644 blob` object and verified content SHA-256;
- baseline/evaluator state drift, case collisions, pathspec magic, missing or
  non-directory parents, tree-object targets, exact/prefix overlap,
  symlink/gitlink ancestry, implicit directory creation, and every forbidden
  patch transition reject before verification commands;
- the one-hunk full-file creation form accepts its exact non-empty terminal-LF
  fixture and rejects empty content, missing terminal LF, a newline marker,
  metadata reordering, alternate ranges, context/removal lines, or extra hunks;
- every final `mutableExact` tree entry is an admitted regular `100644 blob`,
  and literal tree/object lookup is unaffected by path-shaped Git syntax;
- reconstruction and receipt replay are byte-deterministic and reject status,
  object, manifest, contract, snapshot, patch, tree, or commit tampering;
- the finite failure taxonomy, no-retry rule, ceilings, native-provider-only
  routing, local-only behavior, and no-promotion boundary are covered by
  exhaustive control tests; and
- a frozen G2.2 profile can name its new product module only after these focused
  tests and the full engineering-harness regression suite pass, the exact host
  qualification is current, and a separately ratified commit-capable successor
  has replaced the cancel-only boundary.

## Consequences

- Future tasks can add deliberately named modules without weakening exact path,
  protected-input, worker-context, or receipt controls.
- Creation becomes visibly different from modification in contracts and
  evidence, preventing a pre-created file from laundering an absent baseline.
- V2 adds validation and receipt complexity, but v1 evidence remains stable and
  replayable.
- G2.2 receives a clean module boundary after a separate harness-control slice;
  product progress, not the harness change itself, remains the application
  outcome authority.

## Alternatives rejected

- **Flip `allowCreate` to true.** The flag neither identifies an exact path nor
  fixes absent baselines, manifests, snapshots, raw status, or receipts.
- **Commit an empty module before freezing the evaluator.** This disguises
  creation as modification and moves admission outside the candidate evidence.
  It is prohibited; there is no pre-v2 admission path.
- **Put the semantic-change implementation in `store.rs`.** Harness limitations
  are not a reason to enlarge an already central product module or blur the
  change-governance boundary.
- **Allow a mutable prefix.** Prefix admission gives a worker authority to name
  files that the contract did not individually freeze.
- **Use Git pathspec or `<tree>:<path>` lookup.** Candidate-shaped syntax can be
  interpreted by Git rather than compared as literal path bytes.

## Evidence and task ownership

Ruflo task `task-1787935934614-ibmjn1` owns the
`HARNESS-CREATE-EXACT` implementation and evidence. It is in progress at 97%.
The committed implementation sequence is:

- `78b2cf99` freezes every schema-v1 task-contract and task-level receipt byte;
- `767d774e`, `189a2c4b`, and `91c3126f` add exact v2 path, Git-tree, and
  contract controls;
- `75e178a4`, `5c9f499a`, `605a4a06`, `671fb3bd`, and `65fb0e7a` add
  deterministic reconstruction, schema, sealed task context, exact patch
  assembly, and worker-output validation; and
- `54a056e0` adds the unregistered native worker-v2. It copies exact stdin,
  binds provider/schema/Git execution to retained read-only descriptors,
  compares bigint `dev`, `ino`, `nlink`, `size`, mode, ownership, `mtimeNs`,
  `ctimeNs`, and SHA-256 before and after execution, and retains unsafe roots
  until the direct child is reaped and its original process group is absent;
- `faae3d28`, `5b980c08`, and `d07cfdfa` pass exact bytes through Git, bind the
  raw task contract, and seal deterministic reconstruction behind an opaque
  candidate identity; and
- `11e72201` adds exact submodule claims, the structural host/worker wire,
  shared build/configuration policy, one-shot verification and disposal,
  module-branded reports, typed classification, and quarantine on incomplete
  Git, process, session, or disposal cleanup proof; and
- `f3a0c127` private-copies the exact eight-file ESM/launcher payload, mounts it
  through ordered retained read-only FDs, binds every destination to expected
  bytes, verifies identity and bytes after the child, closes proven-safe
  handles, and strongly retains possibly-live handles on cleanup uncertainty;
  and
- `c2cdde16` freezes the candidate-specific containment-owner state machine and
  test authority boundary. It binds a fresh non-reusable generation to the
  exact request plus fixed memory/swap/task/wall limits; requires cgroup-v2
  identity, empty initial membership, LF-exact readback, clone3 initial
  placement, pidfd poll/waitid, whole-cgroup cancellation, direct-child reap,
  parsed terminal emptiness, post-removal absence, and permanent retention of
  any pending or late authority-bearing operation. The trace is explicitly
  `simulated`, is separately branded, and cannot satisfy the sandbox production
  report brand; and
- `23997c29` freezes the successor canonical request/status replay contract,
  exact owner/generation/launch/environment/stdin/payload/limit bindings, FD
  map, three cleanup-safe terminal sequences, and honest-null replay. It also
  adds a freestanding static Linux/x86-64 skeleton whose reviewed C source
  defines only a fail-closed exit-125 entry, plus pure source/compiler/recipe/
  ELF/protocol attestation. Tests compile the source twice into private 0400
  files but never execute it. The artifact states that no request parser,
  status writer, native
  mechanic, compiler causality, runtime closure, or execution authority exists.
  Copy-on-read byte views prevent caller mutation from staling bound digests,
  and replay records only equality of the two supplied executable byte strings;
  and
- `88b9d7e7` freezes the separate successor FD-map v2 and exact launch/control
  capsule. It binds canonical argv and environment bytes, fourteen exact file
  identities, child-descriptor requirements for 0-11, dynamic scratch/output/
  pidfd-descriptor requirements for 18-23, bounded concurrent output-drain
  requirements, later decision-byte acknowledgements, and guardian-owned pre-
  commit cleanup. READY remains decision-null. Pure replay independently
  verifies the supplied capsule and preserves null physical, cleanup, binding,
  final-decision, and authority fields. It neither implements the declared
  mechanics nor reinterprets any schema-v1 byte; and
- `7191ddde` freezes the next unregistered launch and bootstrap boundary. The
  launch successor assigns FDs 18-25, specifies exact 16-byte child trace,
  stop, remap, close, and `execveat` failure records, and accepts execution only
  after a held `PTRACE_EVENT_EXEC`, exact live image identity, and zero-byte
  outcome EOF. The bootstrap transfers exact capsule bytes in-band before
  `READY`, binds request/generation/guardian/requirements identity across every
  frame, and accepts only pre-clone cancellation. Its retained-file inventory
  is limited to FDs 4-17, while FDs 0-3, guardian status-writer closure,
  freshness, cleanup, physical outcomes, binding, final decisions, and all
  authority remain future requirements, null, or false; and
- `ab668ddd` freezes ADR-0035's additive pure guardian-journal contract without
  registering it. The exact 18-state cancel-only graph uses canonical semantic
  projection digests and LF-bearing raw record hashes, generation/birth-epoch/
  optional-head replay anchors, state-specific operation/evidence bindings,
  replay-only chain validation, distinct complete/prefix statuses, null
  physical and durability facts, and all-false authority. It performs no
  filesystem, guardian, recovery, cgroup, or executable-preflight mechanics;
  and
- `040f3343` executes only the separate ADR-0035 preflight successor in a
  local Linux x86-64 test fixture. The exact execution copy, held executable
  identity, child FD0-19 pre-preflight inventory, FD0-17 READY inventory,
  three-frame cancel-only transcript, process/stream closure, and thirty
  returned fail-closed scenarios are observed. Semantic retained-file
  validation, cgroup facts, FD-6 execution binding, durable guardian state,
  pidfd/waitid reap, physical/final eligibility, and every authority remain
  null or false. The fixture is not registered as the physical adapter.
- `41dd2508` implements the ADR-0034-owned additive
  `copyBoundedBufferByFailureCategory` export. The exact-v2 source advances to
  12,687 bytes and SHA-256
  `194fb41e523b334206e91b2dfda8894f5e661a3d034b7330e3e6bd549e4c744e`;
  its original 18 exports and all nine incumbent importer source identities
  remain unchanged. The helper-focused matrix passes 20/20 on Node 24.14.1,
  20.0.0, and 20.20.2, with no package, lock, dependency, registry, readiness,
  runtime, or authority change; and
- `fd9e4d05` adds the exact schema-v2 gate request and makes the unavailable
  native-qualification check the first executable action of v2 preflight, run,
  and replay. It performs one readiness attempt and no downstream effect;
- `c9cb6423`, `997ad287`, and `dfd6d92d` freeze the exact-create baseline,
  unique-E0583 evaluator, and one-`A`/one-`M` green reference chain. The
  baseline-to-evaluator and evaluator-to-reference patch SHA-256 values are
  `46433385d66880f8ae902a1bde2ddc1a210e857b5c29acb8d28c266bc66206d2`
  and
  `e2a2ad5e9207468b3c1beeb6634b3a29987066bd61a1403b774f68f44a9a0ff9`;
  and
- `f9ab7c72` registers only the separate dormant schema-v2 control profile and
  exact contract, binds the production v2 worker context to its raw digest and
  source allowlist, and reconstructs the frozen reference tree. It leaves the
  nine active v1 profiles and 33-command surface unchanged and grants no
  product, provider, qualification, promotion, or publication authority.

For the `f9ab7c72` checkpoint, the six-file focused matrix passes 87/87 on
Node 24; the exact four-file profile/contract/reconstruction/context matrix
passes 55/55 on Node 20.0.0 and Node 20.20.2; and the complete top-level
non-G1.7 harness suite, excluding the committed-clean identity control, passes
694/694 on Node 24 and Node 20.20.2. Agentic-QE 3.13.12 independently executes
the four-file matrix at 55/55. The real Cargo oracle fails only the evaluator
with exit 101 and one `E0583`, then passes the reference with 3/3 tests. Fresh
independent contract, compatibility, and hostile-input reviews returned
APPROVE for this narrow Proposed, dormant, authority-null checkpoint;
production activation remains NO-GO.
At the earlier `040f3343` checkpoint only the new preflight execution copy was
executed; the frozen predecessor artifact was not. The `f9ab7c72` checkpoint
also executed only the exact evaluator/reference Cargo test oracle, not a
native containment path. No live G1.7 control, provider,
benchmark, qualification, or promotion path was run for this checkpoint. The
full suite's already-
recorded deliberate G1.7 sealed-subject freshness failure is not relabelled
green.

This checkpoint detects same-inode mutation, including mutate-then-restore,
before accepting worker output. It does not prevent transient altered bytes
from executing, prove immutability on weak/coarse-timestamp filesystems, or
contain descendants that escape the original process group with `setsid` or
`setpgid`; numeric process-group reuse is also not an identity-bearing cleanup
proof. Those limitations keep the worker unregistered until the cgroup/native
supervisor owner and the rest of this ADR's acceptance gate exist.

The structural runner now labels the narrow payload proof
`partial-esm-launcher-retained-fd-v1` and separately labels the runtime closure
`path-exec-unproved`. It makes no execveat, dynamic-loading, same-UID, or
transient-mutation-prevention claim. The production API therefore remains fixed
`unavailable` and performs no candidate Git, submodule, sandbox, ACCEPT, or
REJECT work. The next implementation boundary is the filesystem-backed native
guardian/recovery owner, including the race-free exec event, direct-child
pidfd/waitid evidence, delegated cgroup-parent ownership, crash recovery, and
the remaining output and runtime-closure proof.
ADR-0035 owns the stable guardian/reaper, intent-first write-once journal,
restart reconciliation, and executable cancel-only preflight decisions within
that boundary; it does not relax this ADR's gate.
Application receipt v7/replay, dormant command/CLI/package dispatch, and the
frozen G2.2 profile follow.
Schema-v1 compatibility remains visible
in [`contract.mjs`](../../tools/engineering-harness/src/contract.mjs),
[`paths.mjs`](../../tools/engineering-harness/src/policy/paths.mjs),
[`reconstruct.mjs`](../../tools/engineering-harness/src/candidate/reconstruct.mjs),
and [`task-context.mjs`](../../tools/engineering-harness/src/runtime/task-context.mjs);
the unregistered boundary is implemented separately in the corresponding
`*-v2` modules. The [linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md)
places this task before G2.2. Until its acceptance boundary is implemented,
schema v1 remains the only active command/CLI engineering-contract family;
the separate dormant v2 control cannot execute, and product file creation
remains forbidden.
