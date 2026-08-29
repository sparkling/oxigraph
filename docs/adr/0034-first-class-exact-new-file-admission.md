# ADR-0034: First-class exact new-file admission in the engineering harness

- **Status**: Proposed
- **Date**: 2026-08-28
- Updated: 2026-08-29
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented and deliberately unregistered.
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
  supervisor attestation. The artifact implements no parser, writer, or
  containment mechanic, is never executed, and remains binding-null and
  authority-free. Commit `88b9d7e7` adds a separate successor FD-map v2,
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
  null, or false. The task is 91% in progress after 11/11 focused and 248/248
  related non-G1.7 tests on both current Node and Node 20 plus three
  independent GO reviews.
  Existing schema-v1 bytes remain untouched. Production containment remains
  fixed unavailable: the guardian, interactive native adapter, and full
  path-executed runtime-closure proof,
  application receipt v7/replay, evaluator reconstruction, profile/CLI
  registration, and the complete gate are not implemented. Schema-v1 remains
  the only registered task contract, and G2.2 may not admit a new product
  module until the complete v2 gate passes
- Programme task: `task-1787935934614-ibmjn1` (`HARNESS-CREATE-EXACT`)
- **Depends on**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)
- **Related**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)

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
admission. Keep all engineering task-contract schema-v1 files, canonical bytes,
parsers, task-level receipt/projection bytes, and replay behavior unchanged; v1
continues to require `allowCreate: false` and reject every creation patch. This
task-contract version is distinct from the engineering application-receipt
versions described below.

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
receipt bytes and verifiers remain unchanged. A v2 task whose application
receipt body binds the ordered mutable-baseline states, ordered `A`/`M`
projection, phase-specific protected manifests, and created blob identities
must emit `oxigraph.engineering-application-receipt/v7`; it may not relabel an
older application receipt. Replay recomputes every value from exact Git objects
and rejects a receipt that relabels creation as modification.

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

There is no pre-v2 exception or contingency. No product file, empty or
otherwise, may be added to manufacture a present baseline before this gate is
implemented and frozen.

## Acceptance boundary

The implementation must prove:

- all committed engineering task-contract and task-level receipt/projection
  schema-v1 fixtures are byte-identical, v1 still requires
  `allowCreate: false`, and v1 rejects creation metadata;
- application receipts v1-v6 and their verifiers are byte-identical, while an
  application receipt for a v2 task uses the new v7 schema and exact v2 fields;
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
  tests and the full engineering-harness regression suite pass.

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
`HARNESS-CREATE-EXACT` implementation and evidence. It is in progress at 91%.
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
  authority remain future requirements, null, or false.

The focused launch/bootstrap tests pass 11/11. The expanded related v1/v2 plus
application-receipt regression matrix passes 248/248 on both the current Node
runtime and Node 20. Three independent adversarial/compatibility audits returned
GO after capsule substitution, exec-transition, trace-failure, descriptor
scope, writer-scope, freshness, diagnostics-normalization, pipe/pidfd lifecycle,
and cleanup-ownership blockers were corrected. Their GO is only for this narrow Proposed,
unregistered, authority-null foundation; production activation remains NO-GO.
The earlier focused protocol/attestation tests remain 16/16 and the committed-
identity control remains 2/2.
No supervisor artifact was executed, and no live G1.7 control, provider,
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
REJECT work. The next implementation boundary is the native guardian/supervisor
mechanics, same-inode executed-supervisor binding, kernel executable eligibility,
exact output observation, delegated cgroup-parent ownership and crash recovery,
followed by delegated-host physical tests and the full runtime closure.
Application receipt v7/replay, evaluator
reconstruction, profile and CLI dispatch, and the frozen G2.2 profile follow.
Schema-v1 compatibility remains visible
in [`contract.mjs`](../../tools/engineering-harness/src/contract.mjs),
[`paths.mjs`](../../tools/engineering-harness/src/policy/paths.mjs),
[`reconstruct.mjs`](../../tools/engineering-harness/src/candidate/reconstruct.mjs),
and [`task-context.mjs`](../../tools/engineering-harness/src/runtime/task-context.mjs);
the unregistered boundary is implemented separately in the corresponding
`*-v2` modules. The [linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md)
places this task before G2.2. Until its acceptance boundary is implemented,
schema v1 remains the only registered engineering contract and file creation
remains forbidden.
