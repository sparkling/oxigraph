// Reviewed mappings from the grouped SHACL requirements ledger to the pinned
// data-shapes editor sources. These are deliberately qualified mappings, not
// family-level conformance claims.
export const shaclRequirementMappings = [
  mapping(
    "SHACL12-OVERVIEW-INFORMATIVE",
    "overview",
    ["shacl-1.2", "introduction"],
    "informative-navigation-only",
    [],
    [],
    "The overview introduces no independent processor conformance surface.",
  ),
  mapping(
    "SHACL12-CORE-SHAPES-GRAPH",
    "core",
    ["shapes", "shapes-graph", "ill-formed-shape-graphs", "shapes-recursion"],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/compile/well_formed.rs",
      "lib/oxshacl/src/compile/syntax.rs",
      "lib/oxshacl/src/compile/imports.rs",
    ],
    [
      "lib/oxshacl/tests/core_syntax_rule_matrix.rs",
      "lib/oxshacl/tests/core_well_formed.rs",
      "lib/oxshacl/tests/core_import_closure.rs",
    ],
    "All 113 pinned syntax-rule IDs have exact-set inventory coverage, and local/imported OWL identity, version, incompatibility, unresolved-import, and depth branches are tested. Complete sentence-level Core well-formedness remains unclaimed; recursive-shape behavior is implementation-defined by the draft and oxshacl rejects recursion.",
  ),
  mapping(
    "SHACL12-CORE-TARGETS-PATHS",
    "core",
    [
      "targets",
      "property-paths",
      "focusNodes",
      "value-nodes",
      "subClassOfInShapesGraph",
    ],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/path.rs",
      "lib/oxshacl/src/validate/semantics.rs",
      "lib/oxshacl/src/compile/well_formed/path.rs",
    ],
    [
      "lib/oxshacl/tests/core_syntax_rules.rs",
      "validate::semantics::tests::subclass_hierarchy_can_include_the_shapes_graph",
    ],
    "Pinned positive and syntax cases pass, including optional shapes-graph subclass semantics; application-level graph discovery and retrieval remain outside the store-neutral API.",
  ),
  mapping(
    "SHACL12-CORE-CONSTRAINTS",
    "core",
    ["core-components", "constraints", "value-nodes"],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/compile/constraints.rs",
      "lib/oxshacl/src/constraint.rs",
      "lib/oxshacl/src/validate/evaluate.rs",
    ],
    [
      "lib/oxshacl/tests/core_syntax_rule_matrix.rs",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
    "The approved validation corpus is green and every pinned syntax-rule ID is inventoried, but suite coverage alone does not close every normative evaluation branch.",
  ),
  mapping(
    "SHACL12-CORE-REPORTS",
    "core",
    [
      "validation-report",
      "results-validation-result",
      "conformanceDisallows",
      "shapesGraphWellFormed",
    ],
    "implemented-tested-subset",
    ["lib/oxshacl/src/report.rs", "lib/oxshacl/examples/w3c_runner/report_compare.rs"],
    [
      "lib/oxshacl/src/report/tests.rs",
      "core_well_formed::well_formed_report_term_is_opt_in_and_requires_certifying_compile",
    ],
    "Exact canonicalized report comparison is used by the pinned lane and sh:shapesGraphWellFormed is emitted only after opt-in certifying compilation; a family-complete report claim remains withheld.",
  ),
  mapping(
    "SHACL12-CORE-FAILURES",
    "core",
    ["failures", "ill-formed-shape-graphs", "validation-definition"],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/compile/api.rs",
      "lib/oxshacl/src/compile/conformance.rs",
      "lib/oxshacl/src/validate.rs",
    ],
    [
      "compile::tests::fails_closed_for_requested_entailment_regimes",
      "lib/oxshacl/tests/core_well_formed.rs",
    ],
    "Typed compile, unsupported-feature, limit, and validation failures are distinct from non-conformance, but no sentence-level proof covers the entire draft failure taxonomy.",
  ),
  mapping(
    "SHACL12-CORE-UPSTREAM-FIXTURES",
    "core",
    ["conformance"],
    "blocked-upstream",
    ["tools/shacl-tests/run.mjs"],
    ["target/w3c/shacl-1.2/run-cases.json"],
    "Two root-reachable fixtures are excluded with immutable hashes: core/node/in-002 has no focus target and lacks its expected source shape; core/node/in-003 uses an undeclared shsh prefix.",
  ),
  mapping(
    "SHACL12-SPARQL-CONSTRAINTS",
    "sparql",
    [
      "sparql-constraints",
      "constraint-components-validators",
      "pre-binding",
      "sparql-constraints-annotations",
    ],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/sparql.rs",
      "lib/oxshacl/src/compile/custom.rs",
      "lib/oxshacl/src/compile/result_annotations.rs",
    ],
    [
      "compile::custom::tests::validator_properties_enforce_their_normative_query_roles",
      "compile::custom::tests::every_declared_validator_is_syntax_checked_even_when_not_selected",
      "lib/oxshacl/tests/result_annotations.rs",
    ],
    "SELECT-only node/property validators, ASK-only generic validators, query syntax, prefixes, prebinding, result mapping, and annotations are checked; complete cross-product and error-branch closure is not claimed.",
  ),
  mapping(
    "SHACL12-SPARQL-NODE-EXPRESSIONS",
    "sparql",
    ["sparql-node-expressions", "SelectExpression", "SPARQLExprExpression"],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/compile/node_expression.rs",
      "lib/oxshacl/src/compile/node_expression/custom.rs",
      "lib/oxshacl/src/compile/node_expression/sparql_expression.rs",
      "lib/oxshacl/src/compile/node_expression/syntax.rs",
      "lib/oxshacl/src/expression.rs",
    ],
    [
      "node_expressions::sparql_select_expression_syntax_is_checked_before_evaluation",
      "lib/oxshacl/tests/custom_node_expression_sparql.rs",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
    "Queries must be xsd:string, SELECT projects exactly one in-scope variable, prefixes are cardinality-checked, ambiguous expression nodes fail compilation, and general functions compose with SPARQL expressions using blank-term-safe algebraic prebinding. Sentence-level error-branch closure remains open.",
  ),
  mapping(
    "SHACL12-SPARQL-RULES",
    "sparql",
    ["rules-syntax", "rules-graph", "rules-execution", "SPARQLRule"],
    "implemented-tested-subset-draft-open",
    ["lib/oxshacl/src/sparql_rules.rs", "lib/oxshacl/src/sparql_rules/execution.rs"],
    [
      "sparql_rules::tests::rules_graph_identifiers_and_global_conditions_fail_closed",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
    "Six pinned inference fixtures pass. Global conditions fail closed because the draft supplies no focus-node semantics, and the draft explicitly leaves repeated rule firing open in issue 1069; oxshacl uses a bounded fixpoint.",
  ),
  mapping(
    "SHACL12-SPARQL-CONFORMANCE",
    "sparql",
    ["conformance", "syntax-rules"],
    "residual-family-claim-withheld",
    [
      "lib/oxshacl/src/profile.rs",
      "lib/oxshacl/tests/core_syntax_rule_matrix.rs",
    ],
    ["target/w3c/shacl-1.2/clause-obligations.json"],
    "All 56 pinned SPARQL syntax-rule IDs are inventoried, but Core, node-expression, and rules interactions plus draft-open semantics prevent a complete extension claim.",
  ),
  mapping(
    "SHACL12-NODEEXPR-OPERATORS",
    "nodeExpressions",
    ["library", "library-list-operators", "library-advanced-sequence", "library-aggregation"],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/expression.rs",
      "lib/oxshacl/src/expression/cardinality.rs",
      "lib/oxshacl/src/compile/node_expression.rs",
    ],
    ["target/w3c/shacl-1.2/run-cases.json", "lib/oxshacl/tests/node_expressions.rs"],
    "All 143 pinned expression fixtures pass and all 35 syntax-rule IDs are inventoried; that corpus does not prove every failure and sequence edge.",
  ),
  mapping(
    "SHACL12-NODEEXPR-FUNCTIONS",
    "nodeExpressions",
    ["blank-node-functions", "NamedParameterFunctions", "ListParameterFunction", "sparql-functions"],
    "implemented-tested-subset",
    [
      "lib/oxshacl/src/expression.rs",
      "lib/oxshacl/src/expression/custom.rs",
      "lib/oxshacl/src/expression/numeric.rs",
      "lib/oxshacl/src/compile/node_expression.rs",
      "lib/oxshacl/src/compile/node_expression/custom.rs",
    ],
    [
      "lib/oxshacl/tests/node_expressions.rs",
      "lib/oxshacl/tests/custom_node_expressions.rs",
      "lib/oxshacl/tests/custom_node_expression_cardinality.rs",
      "lib/oxshacl/tests/custom_node_expression_sparql.rs",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
    "Built-ins plus general user-declared named-parameter and list-parameter functions cover recursive bodies, key parameters, argument cardinality, and SPARQL composition; sentence-level extension and error-semantics closure remains open.",
  ),
  mapping(
    "SHACL12-NODEEXPR-WELLFORMED",
    "nodeExpressions",
    ["syntax", "failure-handling", "custom-node-expressions"],
    "implemented-tested-subset-fail-closed",
    [
      "lib/oxshacl/src/compile/node_expression.rs",
      "lib/oxshacl/src/compile/node_expression/custom.rs",
      "lib/oxshacl/src/compile/node_expression/syntax.rs",
    ],
    [
      "node_expressions::blank_node_function_syntax_is_checked_at_compilation",
      "node_expressions::sparql_select_expression_syntax_is_checked_before_evaluation",
    ],
    "Known malformed and ambiguous graphs fail at compilation, declared custom function bodies are checked even when unused, and evaluation failure is distinct from an empty result; complete draft-wide failure taxonomy remains unclaimed.",
  ),
  mapping(
    "SHACL12-NODEEXPR-CONFORMANCE",
    "nodeExpressions",
    ["conformance", "index"],
    "residual-family-claim-withheld",
    ["lib/oxshacl/src/profile.rs"],
    [
      "lib/oxshacl/tests/core_syntax_rule_matrix.rs",
      "target/w3c/shacl-1.2/run-receipt.json",
    ],
    "The pinned draft and 143 fixtures are exact-hash bound and general custom function extension points are implemented, but sentence-level normative closure remains open.",
  ),
  mapping(
    "SHACL12-RULES-CONCRETE-SYNTAX",
    "rules",
    ["concrete-syntax", "shape-rules-syntax", "rdf-rules-syntax", "grammar"],
    "implemented-tested-text-syntax-subset",
    [
      "lib/oxshacl/src/srl/lexer.rs",
      "lib/oxshacl/src/srl/parser.rs",
      "lib/oxshacl/src/srl/parser/nodes.rs",
    ],
    ["lib/oxshacl/tests/srl_clause_inventory.rs", "target/w3c/shacl-1.2/run-cases.json"],
    "The complete 156-production textual grammar inventory and 138 pinned syntax cases are checked; the draft RDF Rules Syntax section is placeholder text, and no concrete body-abbreviation or RDF-to-SRL mapping is invented.",
  ),
  mapping(
    "SHACL12-RULES-WELLFORMED-STRATIFICATION",
    "rules",
    [
      "wellformed",
      "rule-dependency",
      "dependency-graph-construction-algorithm",
      "stratification",
    ],
    "implemented-tested-subset",
    ["lib/oxshacl/src/srl/check.rs", "lib/oxdatalog/src"],
    [
      "lib/oxshacl/tests/srl_clause_inventory.rs",
      "srl::check::tests::closed_recursive_dependency_is_rejected",
    ],
    "Pinned well-formedness and stratification cases pass with deterministic signed dependencies; unsupported draft constructs are rejected before evaluation.",
  ),
  mapping(
    "SHACL12-RULES-EVALUATION",
    "rules",
    ["rule-set-evaluation", "evaluation-preparation", "eval-rule", "eval-rule-set"],
    "implemented-tested-subset-fail-closed",
    [
      "lib/oxshacl/src/srl/evaluate.rs",
      "lib/oxshacl/src/srl/evaluate/native.rs",
      "lib/oxshacl/src/srl/imports.rs",
    ],
    [
      "lib/oxshacl/src/srl/tests.rs",
      "lib/oxshacl/tests/srl_query.rs",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
    "All 16 pinned evaluation cases pass. Inference, QUERY, inline data, imports, negation, FILTER, SET, expressions, tuple matching, and RDF 1.2 heads have native coverage. Removed FOR/IN clauses fail during parsing; blank-node body matching and unsupported head surfaces fail closed during execution.",
  ),
  mapping(
    "SHACL12-RULES-CONFORMANCE",
    "rules",
    ["conformance", "rules-abstract-syntax", "rule-set-evaluation"],
    "residual-draft-and-operation-gaps",
    ["lib/oxshacl/src/srl.rs", "lib/oxshacl/src/srl/evaluate.rs"],
    [
      "lib/oxshacl/tests/srl_clause_inventory.rs",
      "lib/oxshacl/tests/srl_query.rs",
      "target/w3c/shacl-1.2/run-receipt.json",
    ],
    "The 171-case supplemental SRL corpus is not root-reachable and has unspecified mf:approval. Public Infer and abstract single-triple QUERY roles are implemented, but placeholder RDF mapping, concrete body abbreviations, and draft-open issue 1069 prevent a conformance claim. Removed FOR/IN clauses are rejected as syntax.",
  ),
  mapping(
    "SHACL12-UI-METADATA",
    "ui",
    ["rendering-concepts", "widgets", "editors", "viewers", "property-roles"],
    "not-applicable-renderer-surface",
    [],
    ["lib/oxshacl/tests/ui_profiling_clause_inventory.rs"],
    "The metadata controls UI rendering and does not change validation semantics; oxshacl exposes no renderer.",
  ),
  mapping(
    "SHACL12-UI-ROLE",
    "ui",
    ["scope", "conformance", "renderer"],
    "not-applicable-role-separated",
    ["lib/oxshacl/src/profile.rs"],
    ["lib/oxshacl/tests/ui_profiling_clause_inventory.rs"],
    "UI conformance is explicitly separate from the implemented store-neutral validation and rules library.",
  ),
  mapping(
    "SHACL12-CS-PARSER",
    "compact",
    ["grammar-section"],
    "implemented-tested-informative-subset",
    ["lib/oxshacl/src/compact", "lib/oxshacl/src/compact.rs"],
    [
      "lib/oxshacl/tests/compact_syntax_inventory.rs",
      "lib/oxshacl/tests/compact_roundtrip.rs",
      "target/w3c/shacl-1.2/run-cases.json",
    ],
    "All 81 grammar productions, 30 mapping blocks, and 32 supplied positive graph pairs are inventoried and pass; local negative syntax, budget, and parse/RDF/serialization round-trip tests cover the public boundary while unsupported extension surfaces fail closed.",
  ),
  mapping(
    "SHACL12-CS-DRAFT",
    "compact",
    ["conventions", "grammar-section"],
    "draft-bound-no-normative-oracle",
    ["lib/oxshacl/src/profile/catalog.rs"],
    ["lib/oxshacl/tests/compact_syntax_inventory.rs", "lib/oxshacl/tests/compact_roundtrip.rs"],
    "The exact editor commit and source hash are bound, but the 32 examples are expressly informative. Local negative and round-trip tests supplement them; upstream still supplies no normative negative corpus or inverse RDF-to-SHACL-C oracle.",
  ),
  mapping(
    "SHACL12-PROFILING-DESCRIPTION",
    "profiling",
    ["defining-profiles", "creating-profiles", "profiling-specifications", "profiling-data"],
    "internal-catalog-only-w3c-claim-withheld",
    ["lib/oxshacl/src/profile/catalog.rs", "lib/oxshacl/src/profile.rs"],
    ["lib/oxshacl/tests/profile_negotiation.rs"],
    "Dated internal feature profiles have stable IDs, versions, dependencies, and canonical metadata, but W3C profile-author publication conventions are not claimed.",
  ),
  mapping(
    "SHACL12-PROFILING-NEGOTIATION",
    "profiling",
    ["conformance", "dependencies", "profiling-of-shacl", "rule-conformsto"],
    "internal-library-negotiation-only",
    ["lib/oxshacl/src/profile/negotiation.rs", "lib/oxshacl/src/profile/catalog.rs"],
    ["lib/oxshacl/tests/profile_negotiation.rs"],
    "The library resolves dependencies and rejects incompatible profile requests, but the W3C draft chiefly specifies publisher/data-author declarations; no HTTP discovery conformance claim is made.",
  ),
];

function mapping(
  id,
  document,
  sourceAnchors,
  status,
  implementationEvidence,
  testEvidence,
  residual,
) {
  return {
    id,
    document,
    sourceAnchors,
    status,
    implementationEvidence,
    testEvidence,
    residual,
  };
}

export const candidateClauseMappingRevision = deepFreezeCandidateMapping({
  schema: "oxigraph.shacl-candidate-clause-mapping/v1",
  repository: "https://github.com/w3c/data-shapes.git",
  suiteCommit: "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
  suiteContentSha256:
    "fa1ff95904600c553036123fd6eef66ad281a934830673ee7e9402b3257a3376",
  inventoryBinding: {
    schema: "oxigraph.shacl-candidate-inventory/v1",
    declarationProjection: {
      rows: 569,
      bytes: 235376,
      sha256: "25730098efb04ac9be0f853439843b7874784428ae712a73cc0d05bdcbc1909a",
    },
  },
  receiptBinding: {
    schema: "oxigraph.shacl-candidate-run/v1",
    kind: "clause-audit",
    auditArtifactSchema: "oxigraph.shacl-candidate-clause-audit/v1",
    completeConformance: false,
    qualified: false,
    promoted: false,
  },
  documents: {
    overview: candidateDocument(
      "shacl12-overview/index.html",
      "b6030ce909fa3364e9afb21a6c68fee9c5256a28b9bb8d0962023f7b5b5c67c8",
    ),
    core: candidateDocument(
      "shacl12-core/index.html",
      "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
    ),
    nodeExpressions: candidateDocument(
      "shacl12-node-expr/index.html",
      "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
    ),
    sparql: candidateDocument(
      "shacl12-sparql/index.html",
      "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8",
    ),
    sparqlRl: candidateDocument(
      "sparql12-rl/index.html",
      "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
    ),
    inferenceRules: candidateDocument(
      "shacl12-inference-rules/index.html",
      "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
    ),
    compact: candidateDocument(
      "shacl12-cs/index.html",
      "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
    ),
    ui: candidateDocument(
      "shacl12-ui/index.html",
      "aeacbe7e229b41f0c533d2943ca5f73de0341c40dfa86f0caf4abf35d5ddaeea",
    ),
    profiling: candidateDocument(
      "shacl12-profiling/index.html",
      "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
    ),
  },
  grammars: {
    sparqlRl: candidateDocument(
      "sparql12-rl/sparql-rl-grammar.bnf",
      "511e88cfa9e33f7d38ee9379bf77c0db56bacfbd5858b7b55b4ca7a39f237a9e",
    ),
    compact: candidateDocument(
      "shacl12-cs/SHACLC.g4",
      "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04",
    ),
  },
  retiredHistoricalRules: {
    path: "shacl12-rules/index.html",
    sha256: "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    state: "deleted-at-candidate",
  },
  candidateInventories: {
    coreSyntaxRules: 113,
    nodeExpressionSyntaxRules: 35,
    sparqlExtensionSyntaxRules: 46,
    inferenceRuleSyntaxRules: 25,
    sparqlRlGrammarProductions: 153,
  },
  movedSyntaxRuleIds: [
    "RulesGraph",
    "condition-node",
    "construct-count",
    "construct-datatype",
    "deactivated-in",
    "deactivated-maxCount",
    "rule",
    "rule-order-datatype",
    "rule-order-maxCount",
    "rule-type",
  ],
  preservedDatedProfiles: [
    "shacl-1.2-core-2026-07-23-subset-v1",
    "shacl-1.2-node-expressions-2026-01-08-subset-v1",
    "shacl-1.2-sparql-extensions-2026-01-30-subset-v1",
    "shacl-1.2-rules-2026-07-27-subset-v1",
    "shacl-1.2-compact-syntax-2025-10-30-subset-v1",
  ],
  historicalExports: {
    requirementMappings: {
      export: "shaclRequirementMappings",
      sourcePath: "tools/shacl-tests/shacl-requirements.mjs",
      baselineSourceSha256:
        "f8fc2457ca04949047f704fe6bbac8cca9599ae47c4766945692a1eaa24e2b37",
    },
    reviewedObligations: {
      export: "reviewedObligations",
      residualExport: "residualClaims",
      sourcePath: "tools/shacl-tests/clause-reviews.mjs",
      baselineSourceSha256:
        "70b8738d88d389320fbcea6e1c8d86f1853844eb30d7151384acf04e4f0a131a",
    },
  },
  ordinaryEvidenceCommits: {
    dataExecutionAndRuleProcessor: "e9a285c8217087a255072271f1bb444e70d43d32",
    bodyAbbreviationsAndRuleOrdering: "6e933eea37bd0f27660ee4a3471cdf11b910c949",
    coreValueUnion: "6c317a9a0448c9c92e6e47cf90e4434751b24a15",
    expectedPredicateLifecycle: "85580fc93f122565bdc0de48aef42a334174bb9e",
    candidateEvidenceContracts: "049e81c9fafa7aaf984808d48231e98ef56e6f46",
    completeGroundData: "2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
    srlBnode: "f706742b17e6674360c34cf6bdfc3b1b59ab59f3",
  },
  acceptedSliceEvidence: {
    completeGroundData: {
      taskId: "task-1789908162318-haeyko",
      commit: "2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
      acceptanceArtifact:
        "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json",
      acceptanceSha256:
        "39955651bc5bf1ecf071fff9c3fbf1df1dced2432861b3c3102ddbdbb989807f",
      workflowRunId: "e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
      evidenceKey:
        "programme-task-evidence/workflow-e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
      reviewArtifact:
        "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json#reviewResponse",
      reviewSha256:
        "15e46e33100c48c15687d722a6b2fc73988fa5910da4d1bac79b88ae7c65079b",
    },
    srlBnode: {
      taskId: "task-1789919062167-d1g7i1",
      commit: "f706742b17e6674360c34cf6bdfc3b1b59ab59f3",
      acceptanceArtifact:
        "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json",
      acceptanceSha256:
        "962baef59d23bc12cfa28421a437daa4d7ffa6fd1077cee5b08b72064b06ae9c",
      workflowRunId: "384d7494-7e95-49a0-8f71-442839b63a2c",
      evidenceKey:
        "programme-task-evidence/workflow-384d7494-7e95-49a0-8f71-442839b63a2c",
      reviewArtifact:
        "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json#artifactReferences[1]",
      reviewSha256:
        "0f5020e450a2a325700d226d946d90e656cd783441c5c1229d6bbb6da322fd4b",
    },
  },
  requiredBeforeAdoption: [],
});

export const candidateShaclRequirementMappings = [
  candidateMapping(
    "SHACL12-OVERVIEW-INFORMATIVE",
    [candidateFacet("overview-navigation", "overview", ["shacl-1.2", "introduction"], "Informative navigation only.")],
    "not-applicable-informative",
    "not-applicable",
    [],
    [],
    "The candidate overview creates no independent processor conformance surface.",
  ),
  candidateMapping(
    "SHACL12-CORE-SHAPES-GRAPH",
    [candidateFacet("core-shapes-graph", "core", ["shapes", "shapes-graph", "ill-formed-shape-graphs", "shapes-recursion"], "Core shapes-graph and well-formedness source.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/compile/well_formed.rs", "lib/oxshacl/src/compile/syntax.rs", "lib/oxshacl/src/compile/imports.rs"],
    ["lib/oxshacl/tests/core_syntax_rule_matrix.rs", "lib/oxshacl/tests/core_well_formed.rs", "lib/oxshacl/tests/core_import_closure.rs"],
    "The candidate retains 113 syntax-rule IDs, with a text correction in ignoredProperties-members-nodeKind. Equal ID count does not establish complete candidate prose closure; recursion remains rejected by local policy.",
  ),
  candidateMapping(
    "SHACL12-CORE-TARGETS-PATHS",
    [candidateFacet("core-targets-and-value-nodes", "core", ["targets", "property-paths", "focusNodes", "value-nodes", "value-nodes-property-shapes", "subClassOfInShapesGraph"], "Target, path, focus, value-node union/default, and optional shapes-graph subclass semantics.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/path.rs", "lib/oxshacl/src/validate.rs", "lib/oxshacl/src/validate/semantics.rs", "lib/oxshacl/src/compile/well_formed/path.rs"],
    ["lib/oxshacl/tests/core_values.rs", "lib/oxshacl/tests/core_syntax_rules.rs", "validate::semantics::tests::subclass_hierarchy_can_include_the_shapes_graph"],
    "The candidate property-value algorithm unions path and sh:values output before a lazy default. Commit 6c317a9a supplies ordinary local evidence; the candidate corpus remains unexecuted and application graph discovery remains outside the API.",
  ),
  candidateMapping(
    "SHACL12-CORE-CONSTRAINTS",
    [candidateFacet("core-constraints", "core", ["core-components", "constraints", "value-nodes", "value-nodes-property-shapes"], "Core constraint evaluation including the candidate value-node algorithm.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/compile/constraints.rs", "lib/oxshacl/src/constraint.rs", "lib/oxshacl/src/validate/evaluate.rs", "lib/oxshacl/src/validate.rs"],
    ["lib/oxshacl/tests/core_syntax_rule_matrix.rs", "lib/oxshacl/tests/core_values.rs"],
    "Ordinary local evidence covers the corrected value-node union/default behavior, but no candidate suite result or sentence-level Core closure is claimed.",
  ),
  candidateMapping(
    "SHACL12-CORE-REPORTS",
    [candidateFacet("core-reports", "core", ["validation-report", "results-validation-result", "conformanceDisallows", "shapesGraphWellFormed"], "Validation report construction and optional well-formedness declaration.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/report.rs", "lib/oxshacl/examples/w3c_runner/report_compare.rs"],
    ["lib/oxshacl/src/report/tests.rs", "core_well_formed::well_formed_report_term_is_opt_in_and_requires_certifying_compile"],
    "Exact report comparison and the opt-in term have ordinary evidence; complete candidate report conformance remains unclaimed.",
  ),
  candidateMapping(
    "SHACL12-CORE-FAILURES",
    [candidateFacet("core-failures", "core", ["failures", "ill-formed-shape-graphs", "validation-definition"], "Core failure and validation boundaries.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/compile/api.rs", "lib/oxshacl/src/compile/conformance.rs", "lib/oxshacl/src/validate.rs"],
    ["compile::tests::fails_closed_for_requested_entailment_regimes", "lib/oxshacl/tests/core_well_formed.rs"],
    "Typed failures remain distinct from non-conformance; candidate-wide failure closure is unexecuted and unclaimed.",
  ),
  candidateMapping(
    "SHACL12-CORE-UPSTREAM-FIXTURES",
    [candidateFacet("core-candidate-fixtures", "core", ["conformance"], "Candidate Core conformance source associated with the independently frozen inventory.")],
    "applicable-with-frozen-exclusions",
    "blocked-upstream",
    ["tools/shacl-tests/inventory.mjs", "tools/shacl-tests/run.mjs"],
    ["oxigraph.shacl-candidate-inventory/v1 declaration projection"],
    "The candidate inventory declares 170 Validate cases: 168 selected and the same two hash-bound exclusions. No candidate case has executed, and an observed outcome cannot change those declarations.",
  ),
  candidateMapping(
    "SHACL12-SPARQL-CONSTRAINTS",
    [candidateFacet("sparql-constraints", "sparql", ["sparql-constraints", "constraint-components-validators", "pre-binding", "sparql-constraints-annotations"], "SPARQL constraint, validator, prebinding, and annotation clauses.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/sparql.rs", "lib/oxshacl/src/compile/custom.rs", "lib/oxshacl/src/compile/result_annotations.rs"],
    ["compile::custom::tests::validator_properties_enforce_their_normative_query_roles", "compile::custom::tests::every_declared_validator_is_syntax_checked_even_when_not_selected", "lib/oxshacl/tests/result_annotations.rs"],
    "The candidate document retains these anchors. Ordinary evidence does not establish every candidate interaction or error branch.",
  ),
  candidateMapping(
    "SHACL12-SPARQL-NODE-EXPRESSIONS",
    [candidateFacet("sparql-node-expressions", "sparql", ["sparql-node-expressions", "SelectExpression", "SPARQLExprExpression"], "SPARQL-backed node-expression syntax and execution.")],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/compile/node_expression.rs", "lib/oxshacl/src/compile/node_expression/custom.rs", "lib/oxshacl/src/compile/node_expression/sparql_expression.rs", "lib/oxshacl/src/compile/node_expression/syntax.rs", "lib/oxshacl/src/expression.rs"],
    ["node_expressions::sparql_select_expression_syntax_is_checked_before_evaluation", "lib/oxshacl/tests/custom_node_expression_sparql.rs"],
    "Candidate execution is unobserved; complete cross-document Node Expressions interaction remains open.",
  ),
  candidateMapping(
    "SHACL12-SPARQL-RULES",
    [
      candidateFacet("inference-rule-syntax", "inferenceRules", ["syntax", "SPARQLRule"], "RDF SHACL rule types and SPARQL rule execution."),
      candidateFacet("inference-rules-graph", "inferenceRules", ["rules-graph"], "Rules-graph role and IRI identity."),
      candidateFacet("inference-global-rules", "inferenceRules", ["global-rules", "rules-execution"], "Global rules execute with an empty focus set."),
      candidateFacet("inference-rule-conditions", "inferenceRules", ["condition", "rules-execution"], "Conditions constrain shape-rule focus nodes; they are not a global-rule rejection rule."),
      candidateFacet("inference-deactivated-rules", "inferenceRules", ["deactivated-rules"], "Deactivated rules are ignored."),
      candidateFacet("inference-rule-layers", "inferenceRules", ["rule-layers", "rules-execution"], "Numeric SHACL rule layers."),
      candidateFacet("inference-rule-order", "inferenceRules", ["rule-order", "rules-execution"], "Same-order concurrency and ordered visibility."),
      candidateFacet("inference-run-once", "inferenceRules", ["run-once", "rules-execution"], "RDF sh:runOnce semantics, distinct from SPARQL-RL run-once strata."),
      candidateFacet("inference-expected-predicate", "inferenceRules", ["expectedPredicate", "rules-execution"], "Expected derived triples, per-layer preparation, and cleanup."),
      candidateFacet("inference-temporary-triples", "inferenceRules", ["tempTriple", "rules-execution"], "Temporary triples and reifier cleanup."),
      candidateFacet("inference-custom-processors", "inferenceRules", ["ruleProcessor"], "Unsupported custom processors must fail."),
      candidateFacet("inference-rule-sets", "inferenceRules", ["ruleSet"], "Named and included rule sets."),
    ],
    "applicable-with-unsupported-facets",
    "ordinary-tested-subset-and-explicit-unsupported",
    ["lib/oxshacl/src/sparql_rules.rs", "lib/oxshacl/src/sparql_rules/execution.rs", "lib/oxshacl/src/sparql_rules/derived.rs"],
    ["lib/oxshacl/tests/sparql_expected_predicate.rs", "sparql_rules::tests::rules_graph_identifiers_and_global_conditions_fail_closed", "oxigraph.shacl-candidate-inventory/v1 inference declarations"],
    "The old SPARQL rules anchors moved into a distinct inference-rules document and do not inherit historical pass status. expectedPredicate has ordinary local evidence from 85580fc9. RDF sh:runOnce, sh:tempTriple, sh:TripleRule and sh:SPARQLRuleTemplate execution remain exact unsupported surfaces. The local global-condition rejection is policy, not an explicit candidate MUST.",
  ),
  candidateMapping(
    "SHACL12-SPARQL-CONFORMANCE",
    [candidateFacet("sparql-conformance", "sparql", ["conformance", "syntax-rules"], "SPARQL Extensions conformance without moved rule syntax.")],
    "applicable",
    "residual-family-claim-withheld",
    ["lib/oxshacl/src/profile.rs", "lib/oxshacl/tests/core_syntax_rule_matrix.rs"],
    ["candidate SPARQL syntax inventory: 46 unique IDs"],
    "The candidate SPARQL inventory contains 46 syntax-rule IDs. The historical count of 56 and its receipts remain historical; ten moved rule IDs belong to inferenceRules and do not enlarge the SPARQL validation claim.",
  ),
  candidateMapping(
    "SHACL12-NODEEXPR-OPERATORS",
    [candidateFacet("node-expression-operators", "nodeExpressions", ["library", "library-list-operators", "library-advanced-sequence", "library-aggregation", "InstancesOfExpression", "NodesMatchingExpression"], "Node-expression library plus changed InstancesOf and NodesMatching syntax." )],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/expression.rs", "lib/oxshacl/src/expression/cardinality.rs", "lib/oxshacl/src/compile/node_expression.rs"],
    ["lib/oxshacl/tests/node_expressions.rs"],
    "The candidate keeps 35 syntax-rule IDs, but InstancesOfExpression now accepts a node expression returning classes and NodesMatchingExpression removes its explicit BlankNodeOrIRI constraint. Equal inventory count is not semantic equivalence; candidate fixtures remain unexecuted.",
  ),
  candidateMapping(
    "SHACL12-NODEEXPR-FUNCTIONS",
    [candidateFacet("node-expression-functions", "nodeExpressions", ["blank-node-functions", "NamedParameterFunctions", "ListParameterFunction", "sparql-functions"], "Built-in and custom functions, including the changed CustomListParameterFunction syntax." )],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/expression.rs", "lib/oxshacl/src/expression/custom.rs", "lib/oxshacl/src/expression/numeric.rs", "lib/oxshacl/src/compile/node_expression.rs", "lib/oxshacl/src/compile/node_expression/custom.rs"],
    ["lib/oxshacl/tests/node_expressions.rs", "lib/oxshacl/tests/custom_node_expressions.rs", "lib/oxshacl/tests/custom_node_expression_cardinality.rs", "lib/oxshacl/tests/custom_node_expression_sparql.rs"],
    "CustomListParameterFunction-syntax now MAY document argument shapes through sh:parameter and shnex:arg0, shnex:arg1, and so on. This documentation facet and the candidate function fixtures are not candidate-execution evidence.",
  ),
  candidateMapping(
    "SHACL12-NODEEXPR-WELLFORMED",
    [candidateFacet("node-expression-wellformed", "nodeExpressions", ["syntax", "failure-handling", "custom-node-expressions"], "Node-expression syntax and failure behavior.")],
    "applicable",
    "ordinary-tested-subset-fail-closed",
    ["lib/oxshacl/src/compile/node_expression.rs", "lib/oxshacl/src/compile/node_expression/custom.rs", "lib/oxshacl/src/compile/node_expression/syntax.rs"],
    ["node_expressions::blank_node_function_syntax_is_checked_at_compilation", "node_expressions::sparql_select_expression_syntax_is_checked_before_evaluation"],
    "Known malformed graphs fail closed, but the changed candidate syntax texts and full failure taxonomy remain unexecuted.",
  ),
  candidateMapping(
    "SHACL12-NODEEXPR-CONFORMANCE",
    [candidateFacet("node-expression-conformance", "nodeExpressions", ["conformance", "index"], "Node-expression processor conformance.")],
    "applicable",
    "residual-family-claim-withheld",
    ["lib/oxshacl/src/profile.rs"],
    ["oxigraph.shacl-candidate-inventory/v1 nodeExpressions declarations"],
    "The dated Node Expressions profile remains unchanged. Candidate source and 143 declared cases are separately bound and unexecuted; complete conformance remains unavailable.",
  ),
  candidateMapping(
    "SHACL12-RULES-CONCRETE-SYNTAX",
    [
      candidateFacet("sparql-rl-text-syntax", "sparqlRl", ["sparql-rl-grammar", "grammar", "version-announcement"], "SPARQL-RL textual syntax and version announcement."),
      candidateFacet("rdf-shacl-rule-syntax", "inferenceRules", ["syntax", "SPARQLRule", "TripleRule", "SPARQLRuleTemplate"], "Distinct RDF SHACL rule forms; no RDF-to-SPARQL-RL mapping is implied."),
    ],
    "applicable-with-distinct-rdf-facet",
    "ordinary-tested-text-syntax-subset-and-rdf-unsupported",
    ["lib/oxshacl/src/srl/lexer.rs", "lib/oxshacl/src/srl/parser.rs", "lib/oxshacl/src/srl/parser/nodes.rs"],
    ["lib/oxshacl/tests/srl_clause_inventory.rs", "candidate SPARQL-RL grammar inventory: 153 productions"],
    "Historical concrete-syntax and shape-rules-syntax anchors are absent, and the deleted rdf-rules-syntax placeholder has no same-model successor. The candidate 153-production grammar is a distinct identity from the historical 156-production TSV. RDF sh:TripleRule and sh:SPARQLRuleTemplate compilation remain unsupported.",
  ),
  candidateMapping(
    "SHACL12-RULES-WELLFORMED-STRATIFICATION",
    [candidateFacet("sparql-rl-wellformed-stratification", "sparqlRl", ["wellformed", "rule-dependency", "dependency-graph-construction-algorithm", "stratification"], "SPARQL-RL well-formedness, dependencies, and outcome-compatible stratification." )],
    "applicable",
    "ordinary-tested-subset",
    ["lib/oxshacl/src/srl/check.rs", "lib/oxdatalog/src"],
    ["lib/oxshacl/tests/srl_clause_inventory.rs", "srl::check::tests::closed_recursive_dependency_is_rejected"],
    "The candidate requires compatible dependency and stratification outcomes but permits algorithms other than its example. Closed recursive dependency rejection remains a conservative local policy for an undefined evaluation outcome; candidate corpus execution is pending.",
  ),
  candidateMapping(
    "SHACL12-RULES-EVALUATION",
    [
      candidateFacet("sparql-rl-evaluation", "sparqlRl", ["rule-set-evaluation", "evaluation-preparation", "eval-rule", "eval-rule-set"], "Rule-set preparation and evaluation algorithm."),
      candidateFacet("sparql-rl-expression-evaluation", "sparqlRl", ["eval-expression"], "Expression and functional-form evaluation."),
      candidateFacet("sparql-rl-ground-data", "sparqlRl", ["ground-data", "eval-rule", "eval-rule-set"], "Ground DATA and DATA-sensitive matching."),
      candidateFacet("sparql-rl-imports", "sparqlRl", ["process-imports"], "Optional bounded import processing and fail-closed errors."),
    ],
    "applicable-with-ambiguous-source",
    "ordinary-tested-subset-complete-ground-data-and-srl-bnode-evidence-bound",
    ["lib/oxshacl/src/srl/evaluate.rs", "lib/oxshacl/src/srl/evaluate/native.rs", "lib/oxshacl/src/srl/imports.rs"],
    [
      "lib/oxshacl/src/srl/tests.rs",
      "lib/oxshacl/tests/srl_query.rs",
      "lib/oxshacl/tests/srl_data_terms.rs",
      "lib/oxshacl/tests/srl_bnode.rs",
      "commit:2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
      "programme-task-evidence/workflow-e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
      "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json#39955651bc5bf1ecf071fff9c3fbf1df1dced2432861b3c3102ddbdbb989807f",
      "commit:f706742b17e6674360c34cf6bdfc3b1b59ab59f3",
      "programme-task-evidence/workflow-384d7494-7e95-49a0-8f71-442839b63a2c",
      "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json#962baef59d23bc12cfa28421a437daa4d7ffa6fd1077cee5b08b72064b06ae9c",
    ],
    "Accepted local base-plus-inline DATA interpretation; differs from literal G0 call sites; upstream intent unresolved. The component-notation flag inversion does not resolve that call-site discrepancy. Complete-ground-DATA and SRL BNODE slices are bound to their exact accepted commits and workflow evidence. Candidate evaluation obligations remain unexecuted, and a later pass cannot close this prose ambiguity.",
  ),
  candidateMapping(
    "SHACL12-RULES-CONFORMANCE",
    [candidateFacet("sparql-rl-conformance", "sparqlRl", ["conformance", "rules-abstract-syntax", "rule-set-evaluation", "rules-defns"], "SPARQL-RL syntax and rule-set evaluation conformance surfaces." )],
    "applicable",
    "residual-family-claim-withheld",
    ["lib/oxshacl/src/srl.rs", "lib/oxshacl/src/srl/evaluate.rs"],
    ["lib/oxshacl/tests/srl_clause_inventory.rs", "lib/oxshacl/tests/srl_query.rs", "oxigraph.shacl-candidate-inventory/v1 srl declarations"],
    "Infer and/or Query are abstract operations; Query is Infer followed by goal matching. The local single-triple Query restriction is not a specification MUST. Supplemental reachability and approval remain explicit, and candidate execution cannot establish complete conformance.",
  ),
  candidateMapping(
    "SHACL12-UI-METADATA",
    [candidateFacet("ui-metadata", "ui", ["rendering-concepts", "widgets", "editors", "viewers", "property-roles"], "UI rendering metadata." )],
    "not-applicable-renderer-surface",
    "not-applicable",
    [],
    ["lib/oxshacl/tests/ui_profiling_clause_inventory.rs"],
    "The candidate UI document does not change the store-neutral validator into a renderer.",
  ),
  candidateMapping(
    "SHACL12-UI-ROLE",
    [candidateFacet("ui-role", "ui", ["scope", "conformance", "renderer"], "Separate UI implementation role." )],
    "not-applicable-role-separated",
    "not-applicable",
    ["lib/oxshacl/src/profile.rs"],
    ["lib/oxshacl/tests/ui_profiling_clause_inventory.rs"],
    "Candidate source review does not confer UI implementation conformance.",
  ),
  candidateMapping(
    "SHACL12-CS-PARSER",
    [candidateFacet("compact-parser", "compact", ["grammar-section"], "SHACL-C grammar and mapping source." )],
    "applicable-informative-suite",
    "ordinary-tested-informative-subset",
    ["lib/oxshacl/src/compact", "lib/oxshacl/src/compact.rs"],
    ["lib/oxshacl/tests/compact_syntax_inventory.rs", "lib/oxshacl/tests/compact_roundtrip.rs", "oxigraph.shacl-candidate-inventory/v1 compactSyntax declarations"],
    "The candidate document and grammar bytes match the recorded source hashes, but candidate pairs remain unexecuted and informative.",
  ),
  candidateMapping(
    "SHACL12-CS-DRAFT",
    [candidateFacet("compact-draft", "compact", ["conventions", "grammar-section"], "Editor-draft conventions and grammar." )],
    "applicable-informative-suite",
    "draft-bound-no-normative-oracle",
    ["lib/oxshacl/src/profile/catalog.rs"],
    ["lib/oxshacl/tests/compact_syntax_inventory.rs", "lib/oxshacl/tests/compact_roundtrip.rs"],
    "The candidate identity remains separate even though the recorded Compact source and grammar hashes are unchanged. No normative negative or inverse oracle is supplied upstream.",
  ),
  candidateMapping(
    "SHACL12-PROFILING-DESCRIPTION",
    [candidateFacet("profiling-description", "profiling", ["defining-profiles", "creating-profiles", "profiling-specifications", "profiling-data"], "W3C profile description and publication roles." )],
    "not-applicable-publisher-role",
    "internal-catalog-only-w3c-claim-withheld",
    ["lib/oxshacl/src/profile/catalog.rs", "lib/oxshacl/src/profile.rs"],
    ["lib/oxshacl/tests/profile_negotiation.rs"],
    "Dated local ProfileIds and ProfileVersions remain unchanged and do not become W3C publisher claims under the candidate document.",
  ),
  candidateMapping(
    "SHACL12-PROFILING-NEGOTIATION",
    [
      candidateFacet("profiling-negotiation", "profiling", ["conformance", "dependencies", "profiling-of-shacl"], "Profiling conformance, dependency, and SHACL profile description."),
      candidateFacet("profiling-conforms-to-shapes-graph", "profiling", ["rule-conformstoshapesgraph"], "Derives sh:conformsToShapesGraph from a validation activity, its used graphs, generated report, and sh:conforms true."),
      candidateFacet("profiling-conforms-to-specification", "profiling", ["rule-conformstospecification"], "Propagates graph conformance through prof:isProfileOf to dcterms:conformsTo."),
    ],
    "not-applicable-publisher-and-data-author-role",
    "internal-library-negotiation-only",
    ["lib/oxshacl/src/profile/negotiation.rs", "lib/oxshacl/src/profile/catalog.rs"],
    ["lib/oxshacl/tests/profile_negotiation.rs"],
    "The historical rule-conformsto anchor is absent. Its two candidate successors have different vocabulary, provenance inputs, and conclusions, so no old claim transfers by name. No HTTP discovery, publisher, data-author, or W3C profiling claim is made.",
  ),
];

function candidateDocument(path, sha256) {
  return { path, sha256 };
}

function candidateFacet(id, document, anchors, interpretation) {
  const source = candidateClauseMappingRevision.documents[document];
  if (!source) throw new Error(`Unknown candidate document ${document}`);
  return {
    id,
    document,
    path: source.path,
    sha256: source.sha256,
    anchors,
    interpretation,
  };
}

function candidateMapping(
  id,
  sourceFacets,
  applicability,
  implementationStatus,
  implementationEvidence,
  testEvidence,
  residual,
) {
  return {
    id,
    mappingSchema: candidateClauseMappingRevision.schema,
    suiteCommit: candidateClauseMappingRevision.suiteCommit,
    sourceFacets,
    applicability,
    sourceStatus: applicability.includes("ambiguous-source")
      ? "source-reviewed-with-explicit-ambiguity"
      : "source-reviewed",
    implementationStatus,
    candidateExecutionStatus: "unexecuted",
    implementationEvidence,
    testEvidence,
    residual,
  };
}

function deepFreezeCandidateMapping(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreezeCandidateMapping(child);
  }
  return value;
}
