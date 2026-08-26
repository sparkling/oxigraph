import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localNodeModulesRoot } from "../dependency-policy.mjs";
import {
  commandAuthority,
  parseCargoTestIds,
  runtimeProgramPlan,
  validateCargoTestIds,
} from "./execution-provenance.mjs";
import { commands, profiles } from "./profile-definitions.mjs";
import {
  AGENTIC_QE_VERSION_POLICY,
  agenticQeDependencyResolution,
  validateAgenticQeLockPolicy,
} from "./version-policy.mjs";

test("Cargo inventory parser accepts only complete libtest inventory lines", () => {
  const ids = parseCargoTestIds(
    [
      "alpha::works: test",
      "attacker alpha::spoof: test suffix",
      "beta::also_works: test",
      "  gamma::indented: test",
      "delta::bench: benchmark",
    ].join("\n"),
  );
  assert.deepEqual(ids, ["alpha::works", "beta::also_works"]);
  assert.doesNotThrow(() =>
    validateCargoTestIds("sentinels", ids, {
      expectedPassedTests: 2,
      requiredTestIds: ["beta::also_works"],
    }),
  );
  assert.throws(
    () =>
      validateCargoTestIds("sentinels", ids, {
        expectedPassedTests: 2,
        requiredTestIds: ["missing"],
      }),
    /omit required sentinels: missing/,
  );
});

test("runtime planning binds latest Agentic-QE and semantic authorities", () => {
  const fixtureManifest = { dependencies: { "agentic-qe": "latest" } };
  const fixtureLock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "agentic-qe": "latest" } },
      "node_modules/agentic-qe": {
        version: "1.2.3",
        resolved:
          "https://registry.npmjs.org/agentic-qe/-/agentic-qe-1.2.3.tgz",
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      },
    },
  };
  assert.equal(
    validateAgenticQeLockPolicy(fixtureManifest, fixtureLock).version,
    "1.2.3",
  );
  for (const invalid of [
    [{ dependencies: { "agentic-qe": "1.2.3" } }, fixtureLock],
    [
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/agentic-qe": {
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/agentic-qe/-/agentic-qe-1.2.3.tgz",
            integrity: "sha512-not-canonical",
          },
        },
      },
    ],
    [
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/agentic-qe": {
            ...fixtureLock.packages["node_modules/agentic-qe"],
            version: "latest",
          },
        },
      },
    ],
    [
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/agentic-qe": {
            ...fixtureLock.packages["node_modules/agentic-qe"],
            resolved: "file:../../attacker.tgz",
          },
        },
      },
    ],
    [fixtureManifest, { ...fixtureLock, lockfileVersion: 2 }],
  ]) {
    assert.throws(() => validateAgenticQeLockPolicy(...invalid));
  }

  const dependency = agenticQeDependencyResolution();
  assert.equal(dependency.name, "agentic-qe");
  assert.equal(dependency.policy, AGENTIC_QE_VERSION_POLICY);
  assert.match(dependency.version, /^\d+\.\d+\.\d+/);
  assert.match(dependency.integrity, /^sha512-/);
  assert.match(dependency.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(dependency.lockfileSha256, /^[0-9a-f]{64}$/);
  assert.match(dependency.npmrcSha256, /^[0-9a-f]{64}$/);
  assert.match(dependency.installedPackageJsonSha256, /^[0-9a-f]{64}$/);
  for (const required of [
    "tools/child-environment.mjs",
    "tools/dependency-policy.mjs",
  ]) {
    assert.ok(commands.agenticAdapter[2].evidencePaths.includes(required));
  }
  const root = mkdtempSync(join(tmpdir(), "dependency-policy-test-"));
  try {
    const adapter = join(root, "adapter");
    const outside = join(root, "outside");
    mkdirSync(adapter);
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(adapter, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => localNodeModulesRoot(adapter, "fixture adapter"),
      /real local directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(
    runtimeProgramPlan(
      ["datalogJena", "datalogSouffle", "owlW3c", "shaclW3c", "shaclJena", "jenaParity"],
      commands,
    ),
    {
      host: [
        "bash",
        "cargo",
        "git",
        "java",
        "mise",
        "mvn",
        "node",
        "rustc",
        "souffle",
      ],
      jenaParityMise: ["cargo", "java", "mvn", "rustc"],
    },
  );
  assert.equal(
    commandAuthority("shaclJena", "node"),
    "Apache Jena differential oracle",
  );
  assert.deepEqual(commands.normativeControlAudit[2], {
    timeoutMs: 300_000,
    evidencePaths: [
      "docs/research/normative-requirements.json",
      "docs/research/standards-registry.json",
      "tools/w3c-tests",
    ],
    outputPaths: ["target/w3c/normative-control/audit.json"],
  });
  for (const profile of ["w3c", "metaharness-semantic-gate", "parity"]) {
    assert.equal(
      profiles[profile].filter((id) => id === "normativeControlAudit").length,
      1,
    );
  }
  for (const profile of ["w3c", "metaharness-semantic-gate", "parity"]) {
    assert.equal(
      profiles[profile].filter((id) => id === "normativeClauseInventory")
        .length,
      1,
    );
  }
  const persistenceWrite = [
    "transactionalDatasetWrites",
    "sparqlUpdateAtomicity",
    "persistenceDatasetAdapterTopology",
    "persistenceDatasetTopology",
    "persistenceServiceClaims",
    "persistenceServiceClaimsNoDefault",
    "parallelLoadFailureSemantics",
  ];
  assert.deepEqual(profiles["persistence-write"], persistenceWrite);
  for (const id of persistenceWrite) {
    const [program, args, policy] = commands[id];
    assert.equal(program, "cargo");
    assert.deepEqual(args.slice(0, 2), ["test", "--locked"]);
    assert.equal(policy.requiredTestIds, undefined);
    assert.equal(policy.expectedTestIds.length, policy.expectedPassedTests);
  }
  assert.equal(profiles["metaharness-semantic-gate"].length, 41);
  assert.equal(profiles.parity.length, 47);
});

test("G1 regression profile freezes the exact implemented transaction surface", () => {
  const commandIds = [
    "g11TransactionStateModel",
    "g12TransactionConcurrency",
    "g13TransactionCapabilities",
    "g14RocksdbWriterSerialization",
    "g15SparqlEgressPolicy",
    "g15bSparqlUpdateCancellation",
    "g15cSparqlNegotiatedUpdate",
    "g16EffectiveCapabilities",
    "g16ServiceClaims",
    "g16CompatibilityCanary",
    "g16SparqlVersion",
  ];
  assert.deepEqual(profiles["g1-regression"], commandIds);

  const expected = {
    g11TransactionStateModel: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_state_model",
      ],
      count: 3,
      packages: ["oxigraph"],
      timeoutMs: 420_000,
    },
    g12TransactionConcurrency: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_concurrency",
      ],
      count: 2,
      packages: ["oxigraph"],
      timeoutMs: 90_000,
    },
    g13TransactionCapabilities: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_capabilities",
      ],
      count: 9,
      packages: ["oxigraph"],
      timeoutMs: 120_000,
    },
    g14RocksdbWriterSerialization: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "rocksdb_writer_serialization",
      ],
      count: 6,
      packages: ["oxigraph"],
      timeoutMs: 120_000,
    },
    g15SparqlEgressPolicy: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_egress_policy",
      ],
      count: 12,
      packages: ["oxigraph"],
      timeoutMs: 180_000,
    },
    g15bSparqlUpdateCancellation: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "sparql_update_cancellation",
      ],
      count: 6,
      packages: ["oxigraph"],
      timeoutMs: 180_000,
    },
    g15cSparqlNegotiatedUpdate: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "sparql_negotiated_update",
      ],
      count: 5,
      packages: ["oxigraph"],
      timeoutMs: 180_000,
    },
    g16EffectiveCapabilities: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client-native-tls,rdf-12",
        "--test",
        "sparql_effective_capabilities",
      ],
      count: 4,
      packages: ["oxigraph"],
      timeoutMs: 300_000,
    },
    g16ServiceClaims: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph-cli",
        "--features",
        "native-tls,rdf-12",
        "--bin",
        "oxigraph",
        "service_description::tests::",
      ],
      count: 17,
      packages: ["oxigraph-cli"],
      timeoutMs: 300_000,
    },
    g16CompatibilityCanary: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph-cli",
        "--no-default-features",
        "--features",
        "oxigraph/http-client-native-tls,rdfs,geosparql,owl2-rl",
        "--bin",
        "oxigraph",
        "service_description::tests::dependency_qualified_library_tls_is_enforced_without_cli_tls",
        "--",
        "--exact",
        "--ignored",
      ],
      count: 1,
      packages: ["oxigraph-cli"],
      timeoutMs: 300_000,
    },
    g16SparqlVersion: {
      args: [
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "rdf-12",
        "--test",
        "sparql_version",
      ],
      count: 1,
      packages: ["oxigraph"],
      timeoutMs: 2_700_000,
    },
  };

  let totalTests = 0;
  for (const id of commandIds) {
    const [program, args, policy] = commands[id];
    const contract = expected[id];
    assert.equal(program, "cargo", id);
    assert.deepEqual(args, contract.args, id);
    assert.equal(policy.expectedPassedTests, contract.count, id);
    assert.equal(policy.minimumPassedTests, contract.count, id);
    assert.equal(policy.timeoutMs, contract.timeoutMs, id);
    assert.deepEqual(policy.evidencePackages, contract.packages, id);
    assert.equal(policy.requiredTestIds, undefined, id);
    assert.equal(policy.expectedTestIds.length, contract.count, id);
    assert.deepEqual(
      policy.expectedTestIds,
      [...policy.expectedTestIds].sort(),
      `${id}: reviewed IDs must be sorted`,
    );
    assert.equal(
      new Set(policy.expectedTestIds).size,
      contract.count,
      `${id}: reviewed IDs must be unique`,
    );
    assert.doesNotThrow(() =>
      validateCargoTestIds(id, policy.expectedTestIds, policy),
    );
    totalTests += contract.count;
  }
  assert.equal(totalTests, 66);

  const policy = commands.g13TransactionCapabilities[2];
  const ids = policy.expectedTestIds;
  for (const invalid of [
    ids.slice(1),
    [...ids, "attacker::extra"],
    ["attacker::replacement", ...ids.slice(1)],
    [ids[0], ids[0], ...ids.slice(2)],
  ]) {
    assert.throws(() =>
      validateCargoTestIds("g13TransactionCapabilities", invalid, policy),
    );
  }

  assert.equal(commands.agenticAdapter[2].expectedNodeTests, 19);
  assert.equal(profiles["metaharness-semantic-gate"].length, 41);
  assert.equal(profiles.parity.length, 47);
});
