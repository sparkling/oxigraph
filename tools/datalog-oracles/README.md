# Datalog reference oracles

`run-jena.sh` compares OxDatalog D0 with Apache Jena's real forward-RETE rule
engine on the frozen ancestor and cycle fixtures.

```bash
bash tools/datalog-oracles/run-jena.sh --require
```

Both Jena lanes re-exec through the repository's checked-in
`tools/jena-parity/.mise.toml` and validate the exact Java, Maven, and Rust
versions before compiling or executing. This prevents Maven and `java` from
silently selecting incompatible JDKs after a shell or login change.
`--require` fails if mise, Cargo, Java, Maven, OpenSSL, execution, or any
comparison is unavailable. `--if-available` records an explicit skip only when
a required executable is absent.

Jena's version is read from `jena/pom.xml`. Evidence under
`target/datalog-oracles/jena/` records the version and SHA-256 hashes of the
shared toolchain configuration, POM, Java runner, resolved Maven runtime JARs,
fixture inputs, expected outputs, and both engines' outputs. The lane proves
only the named positive-recursive binary D0 fixtures.

`run-jena-rdfs.sh` compares the finite OxRDFS profile with Jena's real
`ModelFactory.createRDFSModel` API on one frozen schema-and-instance fixture:

```bash
bash tools/datalog-oracles/run-jena-rdfs.sh --require
```

The fixture asserts ten entailed and four not-entailed outcomes across
subproperty and subclass closure, domain, range, instance propagation, and
resource typing. Evidence under `target/datalog-oracles/jena-rdfs/` binds the
Jena version, Java runner, three fixture inputs, and both engines' outputs.
It also binds a portable hash manifest of every resolved Maven runtime JAR.
Only those fourteen assertions are established; this is not an unrestricted
RDFS regime or broader Jena compatibility claim.

`run-souffle.sh` independently compares stratified negation followed by
recursive closure with exact Soufflé 2.5 behavior:

```bash
bash tools/datalog-oracles/run-souffle.sh --require
```

It records source, fixture, native-output, and Soufflé-output hashes under
`target/datalog-oracles/souffle/`. This lane proves only the frozen D1
safe-path fixture; native rejection, boundedness, generation, RDF, and store
tests remain separate authorities.
