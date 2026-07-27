# W3C OWL 2 RL/RDF evidence

`w3c-owl2-rl-inventory.mjs` downloads or reads the W3C approved OWL 2 RL test
export, verifies its pinned SHA-256, and writes a deterministic machine-readable
inventory.

Run against the official source:

```bash
node tools/owl2-tests/w3c-owl2-rl-inventory.mjs
```

Run offline against an already downloaded file:

```bash
node tools/owl2-tests/w3c-owl2-rl-inventory.mjs \
  --source /path/to/profile-RL.rdf
```

The pin contains 70 approved RL-profile cases, of which 68 declare RDF-based
semantics.

`execute-w3c-owl2-rl.mjs` executes every entailment and consistency assertion
from those 68 cases with the native `Owl2RlRdf` engine:

```bash
node tools/owl2-tests/execute-w3c-owl2-rl.mjs
```

The native runner is a standalone checked-in Cargo workspace with its own
`Cargo.lock`; execution uses `--locked`, so local Oxigraph dependency changes
must deliberately refresh and revalidate that nested lock before the oracle
can run.

It verifies the approved export and imported `support011-A` ontology against
pinned SHA-256 digests, parses RDF/XML (plus the three Functional Syntax-only
premises supported by the export), resolves the pinned import, matches
existential blank-node conclusions, and writes a deterministic JSON receipt to
`target/w3c/owl2-rl-execution.json`. The current gate is 98/98 assertion checks.

The engine covers the exact 78 identifiers in W3C Tables 4–9. Forty-six
fixed-arity positive rule cores compile to `oxdatalog::Program`; the remaining
32 use bounded equality, RDF-list, key, datatype, and contradiction operators.
First-derivation provenance and receipts expose which execution path was used.
