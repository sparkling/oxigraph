function cargo(args, expectedPassedTests, evidencePackages, policy = {}) {
  return [
    "cargo",
    ["test", "--locked", ...args],
    {
      minimumPassedTests: expectedPassedTests,
      expectedPassedTests,
      timeoutMs: 300_000,
      evidencePackages,
      ...policy,
    },
  ];
}

function command(program, args, policy = {}) {
  return [program, args, { timeoutMs: 300_000, ...policy }];
}

export const reasoningCommands = {
  storeReasoning: cargo(
    [
      "-p",
      "oxigraph",
      "--no-default-features",
      "--features",
      "datalog",
      "--test",
      "reasoning",
    ],
    7,
    ["oxigraph", "oxdatalog"],
    {
      requiredTestIds: [
        "evaluation_snapshot_preserves_empty_named_graph_topology",
      ],
    },
  ),
  storeSemanticProfiles: cargo(
    [
      "-p",
      "oxigraph",
      "--no-default-features",
      "--features",
      "datalog,rdfs,owl2-rl,shacl,rdf-12",
      "--test",
      "semantic_reasoning",
    ],
    4,
    ["oxigraph", "oxdatalog", "oxrdfs", "oxowl", "oxshacl"],
  ),
  datalogJena: command(
    "bash",
    ["tools/datalog-oracles/run-jena.sh", "--require"],
    {
      evidencePackages: ["oxdatalog"],
      evidencePaths: [
        "tools/datalog-oracles",
        "tools/jena-parity/.mise.toml",
      ],
      outputPaths: [
        "target/datalog-oracles/jena/status.properties",
        "target/datalog-oracles/jena/ancestor.oxdatalog.tsv",
        "target/datalog-oracles/jena/ancestor.jena.tsv",
        "target/datalog-oracles/jena/cycle.oxdatalog.tsv",
        "target/datalog-oracles/jena/cycle.jena.tsv",
        "target/datalog-oracles/jena/classpath.sha256",
      ],
    },
  ),
  rdfsJena: command(
    "bash",
    ["tools/datalog-oracles/run-jena-rdfs.sh", "--require"],
    {
      evidencePackages: ["oxrdfs"],
      evidencePaths: [
        "tools/datalog-oracles",
        "tools/jena-parity/.mise.toml",
      ],
      outputPaths: [
        "target/datalog-oracles/jena-rdfs/status.properties",
        "target/datalog-oracles/jena-rdfs/rdfs-schema.oxrdfs.tsv",
        "target/datalog-oracles/jena-rdfs/rdfs-schema.jena.tsv",
        "target/datalog-oracles/jena-rdfs/classpath.sha256",
      ],
    },
  ),
  datalogSouffle: command(
    "bash",
    ["tools/datalog-oracles/run-souffle.sh", "--require"],
    {
      evidencePackages: ["oxdatalog"],
      evidencePaths: ["tools/datalog-oracles"],
      outputPaths: [
        "target/datalog-oracles/souffle/status.properties",
        "target/datalog-oracles/souffle/path.oxdatalog.tsv",
        "target/datalog-oracles/souffle/path.tsv",
      ],
    },
  ),
  rdfsD0: cargo(
    ["-p", "oxrdfs", "--all-features", "--test", "rdfs_d0"],
    14,
    ["oxrdfs"],
  ),
  rdfsFull: cargo(
    ["-p", "oxrdfs", "--all-targets", "--all-features"],
    37,
    ["oxrdfs"],
    {
      requiredTestIds: [
        "explicitly_empty_named_graph_gets_graph_local_axioms",
      ],
    },
  ),
  owlPositiveSeed: cargo(
    ["-p", "oxowl", "--all-features", "--test", "owl2_rl"],
    13,
    ["oxowl"],
  ),
  owlFull: cargo(
    ["-p", "oxowl", "--all-targets", "--all-features"],
    34,
    ["oxowl"],
    {
      requiredTestIds: [
        "explicitly_empty_named_graph_gets_graph_local_axioms",
      ],
    },
  ),
  owlInventory: command(
    "node",
    ["tools/owl2-tests/w3c-owl2-rl-inventory.mjs"],
    {
      timeoutMs: 120_000,
      evidencePaths: ["tools/owl2-tests"],
      outputPaths: ["target/w3c/owl2-rl-inventory.json"],
    },
  ),
  owlW3c: command(
    "node",
    ["tools/owl2-tests/execute-w3c-owl2-rl.mjs"],
    {
      timeoutMs: 900_000,
      evidencePackages: ["oxowl", "oxrdfio"],
      evidencePaths: ["tools/owl2-tests"],
      outputPaths: ["target/w3c/owl2-rl-execution.json"],
    },
  ),
  shaclFull: cargo(
    ["-p", "oxshacl", "--all-targets", "--all-features"],
    167,
    ["oxshacl"],
    {
      requiredTestIds: [
        "rules::tests::datalog_rules_share_the_outer_cancellation_token",
        "sparql::runtime::tests::synchronous_wasm_control_policy_fails_closed",
      ],
    },
  ),
  shaclNoDefault: cargo(
    ["-p", "oxshacl", "--all-targets", "--no-default-features"],
    114,
    ["oxshacl"],
    {
      requiredTestIds: [
        "rules::tests::datalog_rules_share_the_outer_cancellation_token",
      ],
    },
  ),
  shaclW3c: command("node", ["tools/shacl-tests/run.mjs"], {
    timeoutMs: 900_000,
    evidencePackages: ["oxshacl"],
    evidencePaths: ["tools/shacl-tests"],
    outputPaths: [
      "target/w3c/shacl-1.2/inventory.json",
      "target/w3c/shacl-1.2/run-receipt.json",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
  }),
  shaclClauseAudit: command(
    "node",
    ["tools/shacl-tests/clause-audit.mjs"],
    {
      timeoutMs: 300_000,
      evidencePaths: ["tools/shacl-tests", "testsuite/rdf-tests"],
      outputPaths: ["target/w3c/shacl-1.2/clause-obligations.json"],
    },
  ),
  shaclJena: command("node", ["tools/shacl-tests/jena-compact.mjs"], {
    timeoutMs: 300_000,
    evidencePackages: ["oxshacl"],
    evidencePaths: [
      "tools/shacl-tests",
      "tools/shacl-tests/jena-compact",
    ],
    outputPaths: ["target/datalog-oracles/jena-shaclc/receipt.json"],
  }),
  jenaParity: command("bash", ["tools/jena-parity/scripts/run.sh"], {
    timeoutMs: 900_000,
    evidencePaths: [
      "tools/jena-parity/.mise.toml",
      "tools/jena-parity/inventory",
      "tools/jena-parity/oracle",
      "tools/jena-parity/profile.lock.json",
      "tools/jena-parity/runner",
      "tools/jena-parity/scripts",
    ],
    outputPaths: [
      "target/jena-parity/parity-receipt.json",
      "target/jena-parity/resolved-inventory.json",
      "target/jena-parity/jena-observations.json",
    ],
  }),
};

const existing = [
  "oxrdf12",
  "sparql12Parser",
  "sparql12Evaluator",
  "sparqlUpdateAtomicity",
  "queryEntailmentProfiles",
  "queryEntailmentBoundary",
  "sparqlServiceHttp",
  "sparql12Results",
  "sparql11ResultsBoundary",
  "jsonLd12",
  "jsonLd11DirectionBoundary",
  "rdfXml12",
  "terseSerializerApis",
  "rdfIoProfiles",
  "cliHttp",
  "cliHttpNoDefault",
  "geosparql",
  "rdfc10",
];
const datalog = [
  "datalogD0",
  "datalogD1",
  "datalogD2",
  "datalogFull",
  "storeReasoning",
  "datalogJena",
  "datalogSouffle",
];
const rdfs = ["rdfsD0", "rdfsFull", "rdfsJena"];
const owl = ["owlPositiveSeed", "owlFull", "owlInventory", "owlW3c"];
const shacl = [
  "shaclFull",
  "shaclNoDefault",
  "shaclW3c",
  "shaclClauseAudit",
  "shaclJena",
];
const w3c12 = [
  "normativeControlAudit",
  "normativeClauseInventory",
  "w3cRdf12",
  "rdfXmlSerializerManifest",
  "terseSerializerManifest",
  "w3cSparql12",
  "sparqlServiceHttp",
  "shaclW3c",
  "shaclClauseAudit",
];
const semanticGate = [
  "agenticAdapter",
  ...existing,
  "supportingParserSuites",
  "normativeControlAudit",
  "normativeClauseInventory",
  "w3cRdf12",
  "rdfXmlSerializerManifest",
  "terseSerializerManifest",
  "w3cSparql12",
  "datalogFull",
  "storeReasoning",
  "storeSemanticProfiles",
  "datalogJena",
  "datalogSouffle",
  "rdfsFull",
  "rdfsJena",
  "owlFull",
  "owlW3c",
  "shaclFull",
  "shaclNoDefault",
  "shaclW3c",
  "shaclClauseAudit",
  "shaclJena",
  "jenaParity",
];

export const profiles = {
  "agentic-adapter": ["agenticAdapter"],
  existing,
  "supporting-suites": ["supportingParserSuites"],
  w3c: w3c12,
  "rdfc-10": ["rdfc10"],
  datalog,
  "datalog-jena": ["datalogJena"],
  "rdfs-jena": ["rdfsJena"],
  "datalog-souffle": ["datalogSouffle"],
  store: ["storeReasoning", "storeSemanticProfiles"],
  rdfs,
  "owl2-rl": owl,
  "owl2-rl-inventory": ["owlInventory"],
  "owl2-rl-w3c": ["owlW3c"],
  "shacl-1.2": shacl,
  "jena-parity": ["jenaParity"],
  "metaharness-semantic-gate": semanticGate,
  parity: [
    "agenticAdapter",
    ...existing,
    "supportingParserSuites",
    "normativeControlAudit",
    "normativeClauseInventory",
    "w3cRdf12",
    "rdfXmlSerializerManifest",
    "terseSerializerManifest",
    "w3cSparql12",
    ...datalog,
    "storeSemanticProfiles",
    ...rdfs,
    ...owl,
    ...shacl,
    "jenaParity",
  ],
};

export const profileNames = Object.keys(profiles).join("|");
