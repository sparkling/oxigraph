#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hiddenIndexEntriesWithFiles } from "./hidden-entries.mjs";

const REPOSITORY = "https://github.com/w3c/data-shapes.git";
const MAX_PINNED_FILE_BYTES = 32 * 1024 * 1024;
const FULL_COMMIT = /^[0-9a-f]{40}$/;

export const historicalShaclRevision = deepFreeze({
  repository: REPOSITORY,
  suiteCommit: "eedda09f93c39be1d2e978f3f942631494ae25a0",
  suiteContentSha256:
    "1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a",
  specificationSha256: {
    core: "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
    nodeExpressions:
      "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
    sparql: "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
    rules: "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    compact: "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
  },
  grammarSha256: {
    compact: "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04",
  },
});

export const candidateShaclRevision = deepFreeze({
  repository: REPOSITORY,
  suiteCommit: "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
  suiteContentSha256:
    "fa1ff95904600c553036123fd6eef66ad281a934830673ee7e9402b3257a3376",
  specificationFiles: {
    overview: "shacl12-overview/index.html",
    core: "shacl12-core/index.html",
    nodeExpressions: "shacl12-node-expr/index.html",
    sparql: "shacl12-sparql/index.html",
    sparqlRl: "sparql12-rl/index.html",
    inferenceRules: "shacl12-inference-rules/index.html",
    compact: "shacl12-cs/index.html",
    ui: "shacl12-ui/index.html",
    profiling: "shacl12-profiling/index.html",
  },
  specificationSha256: {
    overview: "b6030ce909fa3364e9afb21a6c68fee9c5256a28b9bb8d0962023f7b5b5c67c8",
    core: "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
    nodeExpressions:
      "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
    sparql: "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8",
    sparqlRl: "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
    inferenceRules:
      "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
    compact: "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
    ui: "aeacbe7e229b41f0c533d2943ca5f73de0341c40dfa86f0caf4abf35d5ddaeea",
    profiling:
      "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
  },
  grammarFiles: {
    sparqlRl: "sparql12-rl/sparql-rl-grammar.bnf",
    compact: "shacl12-cs/SHACLC.g4",
  },
  grammarSha256: {
    sparqlRl: "511e88cfa9e33f7d38ee9379bf77c0db56bacfbd5858b7b55b4ca7a39f237a9e",
    compact: "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04",
  },
  declarationRows: 569,
  declarationBytes: 235376,
  declarationSha256:
    "25730098efb04ac9be0f853439843b7874784428ae712a73cc0d05bdcbc1909a",
});

const PROFILES = deepFreeze({
  validate: [
    "Core12Subset20260723",
    "NodeExpressions12Subset20260108",
    "SparqlExtensions12Subset20260130",
  ],
  nodeExpressions: [
    "Core12Subset20260723",
    "NodeExpressions12Subset20260108",
    "SparqlExtensions12Subset20260130",
  ],
  inferenceRules: [
    "Core12Subset20260723",
    "NodeExpressions12Subset20260108",
    "SparqlExtensions12Subset20260130",
    "Rules12Subset20260727",
  ],
  srl: ["Core12Subset20260723", "Rules12Subset20260727"],
});

const FIXED_CORE_EXCLUSIONS = deepFreeze([
  {
    stableId: "shacl12-test-suite/tests/core/node/in-002.ttl#<in-002>",
    path: "shacl12-test-suite/tests/core/node/in-002.ttl",
    sha256: "9fbabda6e0d4eddbbf0cbb71b83ac1ba434368a5fca30869fc3e6f06d07e640d",
    reason: "no-focus-node-and-absent-expected-source-shape",
  },
  {
    stableId:
      "shacl12-test-suite/tests/core/node/in-003.ttl#unparsed-approved-case",
    path: "shacl12-test-suite/tests/core/node/in-003.ttl",
    sha256: "3b6f11aec2bdb76b042b4b788064036ef4e9d3ae736efed28b3644b4caad4db3",
    reason: "undeclared-shsh-prefix",
  },
]);

const UNSUPPORTED_INFERENCE_CASES = deepFreeze([
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-Multiply.ttl#<SPARQLRuleTemplate-example-Multiply>",
    path: "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-Multiply.ttl",
    sha256: "643639cb9ccdc476114c86f33c1e85b1d150b808e54678ab5d348a4227bee974",
    requirement: "requires-sh:SPARQLRuleTemplate",
  },
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-SymmetricProperty.ttl#<SPARQLRuleTemplate-example-SymmetricProperty>",
    path: "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-SymmetricProperty.ttl",
    sha256: "4b90244c027c66adf80021355cf3819c4fc12f716a4d9b070ae66473f6f4f22b",
    requirement: "requires-sh:SPARQLRuleTemplate",
  },
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/TripleRule-example-childCount.ttl#<TripleRule-example-childCount>",
    path: "shacl12-test-suite/tests/inference-rules/TripleRule-example-childCount.ttl",
    sha256: "17a9f7bdbaaad63c4c2ee4c58eb4d143aff4c645cddaab22a6b1bce02d91c475",
    requirement: "requires-rdf-sh:TripleRule-compilation",
  },
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/TripleRule-example-squares.ttl#<TripleRule-example-squares>",
    path: "shacl12-test-suite/tests/inference-rules/TripleRule-example-squares.ttl",
    sha256: "560b9f62c5876ff84cf04f87770df5f537fa4465fdad522e305f9b0080b6e3b8",
    requirement: "requires-rdf-sh:TripleRule-compilation",
  },
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/run-once-example.ttl#<run-once-example>",
    path: "shacl12-test-suite/tests/inference-rules/run-once-example.ttl",
    sha256: "740a64ee711a34a905dc57646ce756d8790de0ad5cc67fb91aec87c56113c45b",
    requirement: "requires-sh:runOnce",
  },
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/temp-triples-example.ttl#<temp-triples-example>",
    path: "shacl12-test-suite/tests/inference-rules/temp-triples-example.ttl",
    sha256: "392e4dd847c678ba3560ddca4aaaba0f8f3fe0b817d36d45c419ee99bddf1f91",
    requirement: "requires-temporary-triple-semantics",
  },
  {
    stableId:
      "shacl12-test-suite/tests/inference-rules/layers-example.ttl#<layers-example>",
    path: "shacl12-test-suite/tests/inference-rules/layers-example.ttl",
    sha256: "fefcdee5d947442a7d7825a207cbd622a5ca1275d9168ec8bb147a090ab561c8",
    requirement: "requires-sh:layer-and-sh:runOnce",
  },
]);

function main() {
  const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const targetRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
  ensureSecureDirectory(repositoryRoot, "target/w3c/shacl-1.2");
  const checkout = resolve(
    targetRoot,
    `data-shapes-${historicalShaclRevision.suiteCommit.slice(0, 12)}`,
  );
  ensureHistoricalCheckout(checkout, targetRoot);

  const suiteRoot = secureExistingDirectory(
    join(checkout, "shacl12-test-suite/tests"),
    checkout,
    "historical suite",
  );
  const suiteHash = treeHash(suiteRoot, checkout);
  requireEqual(
    suiteHash,
    historicalShaclRevision.suiteContentSha256,
    "historical suite tree SHA-256",
  );
  const specificationFiles = {
    core: "shacl12-core/index.html",
    nodeExpressions: "shacl12-node-expr/index.html",
    sparql: "shacl12-sparql/index.html",
    rules: "shacl12-rules/index.html",
    compact: "shacl12-cs/index.html",
  };
  const specificationSha256 = hashNamedFiles(checkout, specificationFiles);
  requireNamedHashes(
    specificationSha256,
    historicalShaclRevision.specificationSha256,
    "historical specification",
  );
  const grammarSha256 = hashNamedFiles(checkout, {
    compact: "shacl12-cs/SHACLC.g4",
  });
  requireNamedHashes(
    grammarSha256,
    historicalShaclRevision.grammarSha256,
    "historical grammar",
  );

  const suiteFiles = walk(suiteRoot);
  const ttlFiles = suiteFiles.filter((path) => path.endsWith(".ttl"));
  const srlFiles = suiteFiles.filter((path) => path.endsWith(".srl"));
  const categories = {};
  const statuses = { approved: 0, proposed: 0, rejected: 0 };
  for (const path of ttlFiles) {
    const relativePath = relative(suiteRoot, path);
    const category = relativePath.includes(sep)
      ? relativePath.split(sep)[0]
      : "root";
    categories[category] ??= {
      ttlFiles: 0,
      approvedEntries: 0,
      proposedEntries: 0,
      rejectedEntries: 0,
    };
    categories[category].ttlFiles += 1;
    const text = readPinnedText({ checkoutRoot: checkout }, path);
    for (const status of Object.keys(statuses)) {
      const count = [...text.matchAll(new RegExp(`sht:${status}\\b`, "g"))].length;
      statuses[status] += count;
      categories[category][`${status}Entries`] += count;
    }
  }
  const rootManifest = readPinnedText(
    { checkoutRoot: checkout },
    join(suiteRoot, "manifest.ttl"),
  );
  const rootIncludes = [...rootManifest.matchAll(/mf:include\s+<([^>]+)>/g)].map(
    (match) => match[1],
  );
  const rulesManifestTypes = {};
  for (const category of ["syntax", "wellformed", "stratification", "eval", "examples"]) {
    const text = readPinnedText(
      { checkoutRoot: checkout },
      join(suiteRoot, "rules", category, "manifest.ttl"),
    );
    for (const match of text.matchAll(/\bsrt:(Rules[A-Za-z]+Test)\b/g)) {
      rulesManifestTypes[match[1]] ??= 0;
      rulesManifestTypes[match[1]] += 1;
    }
  }
  const compactRoot = join(checkout, "shacl12-cs");
  const compactFiles = walk(join(compactRoot, "tests", "valid"));
  const compactSources = compactFiles.filter((path) => path.endsWith(".shaclc"));
  const compactExpected = compactFiles.filter((path) => path.endsWith(".ttl"));
  const compactExpectedNames = new Set(
    compactExpected.map((path) => path.slice(0, -4)),
  );
  const inventory = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      repository: historicalShaclRevision.repository,
      commit: historicalShaclRevision.suiteCommit,
      editorDrafts: {
        core: "https://w3c.github.io/data-shapes/shacl12-core/",
        nodeExpressions: "https://w3c.github.io/data-shapes/shacl12-node-expr/",
        sparql: "https://w3c.github.io/data-shapes/shacl12-sparql/",
        rules: "https://w3c.github.io/data-shapes/sparql12-rl/",
        compact: "https://w3c.github.io/data-shapes/shacl12-compact-syntax/",
      },
      testSuite: "https://w3c.github.io/data-shapes/data-shapes-test-suite/",
    },
    integrity: {
      suiteContentSha256: suiteHash,
      specificationSha256,
    },
    inventory: {
      ttlFiles: ttlFiles.length,
      manifestFiles: ttlFiles.filter((path) => path.endsWith("manifest.ttl")).length,
      statuses,
      categories,
      rootIncludes,
      rulesReachableFromRootManifest: rootIncludes.some((path) => path.startsWith("rules/")),
      rulesEvidence: {
        srlFixtureFiles: srlFiles.length,
        manifestEntries: Object.values(rulesManifestTypes).reduce(
          (sum, count) => sum + count,
          0,
        ),
        manifestTypes: rulesManifestTypes,
        executableOracle: true,
        rootReachable: false,
        mfApproval: "unspecified",
        lane: "supplemental",
        status: "executable-supplemental",
        reason:
          "The standalone manifest-rules.ttl provides syntax, well-formedness, stratification, and result-graph oracles but is not linked from the suite root and declares no mf:approval.",
      },
      compactSyntaxEvidence: {
        sourceFiles: compactSources.length,
        expectedGraphFiles: compactExpected.length,
        sourceExpectedPairs: compactSources.filter((path) =>
          compactExpectedNames.has(path.slice(0, -7)),
        ).length,
        grammarSha256: grammarSha256.compact,
        executableOracle: true,
        normative: false,
        lane: "supplemental",
        status: "executable-informative",
        reason:
          "The SHACL-C specification labels its 32 source/TTL graph-isomorphism pairs useful but non-normative.",
      },
    },
    qualification:
      "Inventory only. Passing reachable tests would not establish complete specification conformance.",
  };
  const output = resolve(targetRoot, "inventory.json");
  atomicHistoricalJson(output, inventory, repositoryRoot);
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
}

export function collectCandidateInventory({ checkout, implementation }) {
  requireFullCommit(implementation, "implementation");
  const checkoutRoot = requireDirectory(checkout, "candidate checkout");
  assertGitIdentity(
    checkoutRoot,
    candidateShaclRevision.suiteCommit,
    "candidate checkout",
  );

  return collectCandidateInventoryContents({
    checkout: checkoutRoot,
    implementation,
  });
}

export function collectCandidateInventoryContents({ checkout, implementation }) {
  requireFullCommit(implementation, "implementation");
  const checkoutRoot = requireDirectory(checkout, "candidate checkout");

  const suiteRoot = secureExistingDirectory(
    join(checkoutRoot, "shacl12-test-suite/tests"),
    checkoutRoot,
    "candidate suite",
  );
  const suiteContentSha256 = treeHash(suiteRoot, checkoutRoot);
  requireEqual(
    suiteContentSha256,
    candidateShaclRevision.suiteContentSha256,
    "candidate suite tree SHA-256",
  );

  const specificationSha256 = hashNamedFiles(
    checkoutRoot,
    candidateShaclRevision.specificationFiles,
  );
  requireNamedHashes(
    specificationSha256,
    candidateShaclRevision.specificationSha256,
    "candidate specification",
  );
  const grammarSha256 = hashNamedFiles(
    checkoutRoot,
    candidateShaclRevision.grammarFiles,
  );
  requireNamedHashes(
    grammarSha256,
    candidateShaclRevision.grammarSha256,
    "candidate grammar",
  );

  const context = { checkoutRoot, suiteRoot };
  const validate = collectSelectedCases(
    context,
    suiteRoot,
    "sht:Validate",
    "validate",
    "Core/NodeExpr/SPARQL-validation",
  )
    .filter(
      (entry) =>
        entry.sources[0].path !==
        "shacl12-test-suite/tests/core/node/in-003.ttl",
    )
    .map((entry) => classifyValidationCase(entry));
  validate.push(in003Sentinel(context));

  const nodeExpressions = collectSelectedCases(
    context,
    join(suiteRoot, "node-expr"),
    "sht:EvalNodeExpr",
    "nodeExpressions",
    "node-expression-evaluation",
  );
  const inferenceRules = collectInferenceCases(context);
  const srl = collectSrlCases(context);
  const compactSyntax = collectCompactCases(context);

  const lanes = {
    validate: finalizeCases(validate),
    nodeExpressions: finalizeCases(nodeExpressions),
    inferenceRules: finalizeCases(inferenceRules),
    srl: finalizeCases(srl),
    compactSyntax: finalizeCases(compactSyntax),
  };
  const counts = Object.fromEntries(
    Object.entries(lanes).map(([lane, cases]) => [lane, cases.length]),
  );
  requireCounts(counts);
  requireDeclarations(lanes);

  const projection = declarationProjection(lanes);
  requireEqual(
    projection.rows,
    candidateShaclRevision.declarationRows,
    "candidate declaration rows",
  );
  requireEqual(
    projection.bytes,
    candidateShaclRevision.declarationBytes,
    "candidate declaration bytes",
  );
  requireEqual(
    projection.sha256,
    candidateShaclRevision.declarationSha256,
    "candidate declaration SHA-256",
  );

  return {
    schema: "oxigraph.shacl-candidate-inventory/v1",
    source: {
      repository: candidateShaclRevision.repository,
      suiteCommit: candidateShaclRevision.suiteCommit,
      implementationCommit: implementation,
    },
    integrity: {
      suiteContentSha256,
      specificationSha256,
      grammarSha256,
      declarationProjection: projection,
    },
    lanes,
    counts,
    knownInferenceOrphan: {
      path: "shacl12-test-suite/tests/inference-rules/rdfs/rdfs1.ttl",
      sha256: sourceRecord(
        context,
        join(suiteRoot, "inference-rules/rdfs/rdfs1.ttl"),
      ).sha256,
      reason:
        "not reachable through inference-rules/manifest.ttl; excluded from manifest inventory",
    },
    fixedCoreExclusions: FIXED_CORE_EXCLUSIONS.map(
      ({ path, sha256, reason }) => ({ path, sha256, reason }),
    ),
    completeConformance: false,
    qualified: false,
    promoted: false,
  };
}

export function createCandidateRun({ repositoryRoot, implementation, kind }) {
  requireFullCommit(implementation, "implementation");
  requireRunKind(kind);
  const root = requireDirectory(repositoryRoot, "repository root");
  assertGitIdentity(root, implementation, "implementation repository");
  const branch = git(["branch", "--show-current"], root).trim();
  if (branch !== "main") {
    throw new Error(`candidate execution requires main, found ${branch || "detached HEAD"}`);
  }

  const runId = randomUUID();
  const relativePath = candidateRunPath({ implementation, kind, runId });
  const parentPath = dirname(relativePath);
  const parent = ensureSecureDirectory(root, parentPath);
  const runDirectory = resolve(parent, runId);
  mkdirSync(runDirectory, { mode: 0o700 });
  secureExistingDirectory(runDirectory, root, "candidate run directory");
  return {
    path: toPosix(relative(root, runDirectory)),
    runId,
    suiteCommit: candidateShaclRevision.suiteCommit,
    implementationCommit: implementation,
    kind,
  };
}

export function writeCandidateArtifact({ repositoryRoot, run, name, value }) {
  const root = requireDirectory(repositoryRoot, "repository root");
  validateRun(run);
  assertGitIdentity(root, run.implementationCommit, "implementation repository");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(`invalid candidate artifact name: ${name}`);
  }
  const expectedRunPath = candidateRunPath({
    implementation: run.implementationCommit,
    kind: run.kind,
    runId: run.runId,
  });
  if (run.path !== expectedRunPath) {
    throw new Error("candidate run path disagrees with its immutable identity");
  }
  const runDirectory = secureExistingDirectory(
    resolve(root, run.path),
    root,
    "candidate run directory",
  );
  const path = resolve(runDirectory, name);
  if (dirname(path) !== runDirectory) {
    throw new Error("candidate artifact must be a direct run-directory child");
  }

  let content;
  if (name.endsWith(".json")) {
    if (Buffer.isBuffer(value) || value === undefined) {
      throw new Error("JSON candidate artifacts require a serializable value");
    }
    const encoded = JSON.stringify(value, null, 2);
    if (encoded === undefined) {
      throw new Error("JSON candidate artifact value is not serializable");
    }
    content = Buffer.from(`${encoded}\n`, "utf8");
  } else if (Buffer.isBuffer(value)) {
    content = value;
  } else if (typeof value === "string") {
    content = Buffer.from(value, "utf8");
  } else {
    throw new Error("non-JSON candidate artifacts require string or Buffer bytes");
  }

  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  return {
    path: toPosix(relative(root, path)),
    sha256: sha256(content),
    bytes: content.byteLength,
  };
}

function collectSelectedCases(context, directory, type, lane, capability) {
  return walk(directory)
    .filter((path) => path.endsWith(".ttl"))
    .flatMap((path) => {
      const text = readPinnedText(context, path);
      return namedBlocks(text, type)
        .filter(([, , body]) => caseStatus(body) === "approved")
        .map(([, id, body]) => {
          const evidence = wrapperEvidence(context, path, body);
          return {
            id,
            stableId: `${relativeSourcePath(context, path)}#${id}`,
            manifest: {
              path: relativeSourcePath(context, path),
              base: relativeSourcePath(context, dirname(path)),
            },
            lane,
            type: type.replace("sht:", ""),
            status: "approved",
            requiredCapability: capability,
            profileIds: [...PROFILES[lane]],
            eligibility: "candidate-selected-unexecuted",
            ...evidence,
          };
        });
    });
}

function collectInferenceCases(context) {
  const directory = join(context.suiteRoot, "inference-rules");
  const rootManifest = join(directory, "manifest.ttl");
  const includes = [...readPinnedText(context, rootManifest).matchAll(
    /mf:include\s+<([^>]+)>/g,
  )].map((match) => match[1]);
  const wrappers = [];
  for (const include of includes) {
    const path = join(directory, include);
    if (include.endsWith("manifest.ttl")) {
      const nestedIncludes = [
        ...readPinnedText(context, path).matchAll(/mf:include\s+<([^>]+)>/g),
      ].map((match) => match[1]);
      wrappers.push(...nestedIncludes.map((entry) => join(dirname(path), entry)));
    } else {
      wrappers.push(path);
    }
  }

  const unsupported = new Map(
    UNSUPPORTED_INFERENCE_CASES.map((entry) => [entry.stableId, entry]),
  );
  const observedUnsupported = new Set();
  const cases = wrappers.flatMap((path) => {
    const text = readPinnedText(context, path);
    return namedBlocks(text, "sht:Infer").map(([, id, body]) => {
      const stableId = `${relativeSourcePath(context, path)}#${id}`;
      const evidence = wrapperEvidence(context, path, body);
      const unsupportedCase = unsupported.get(stableId);
      if (unsupportedCase) {
        const primary = evidence.sources.find(
          (entry) => entry.path === unsupportedCase.path,
        );
        if (!primary || primary.sha256 !== unsupportedCase.sha256) {
          throw new Error(`unsupported inference identity/hash drift: ${stableId}`);
        }
        observedUnsupported.add(stableId);
      }
      return {
        id,
        stableId,
        manifest: {
          path: relativeSourcePath(context, path),
          base: relativeSourcePath(context, dirname(path)),
        },
        lane: "inferenceRules",
        type: "Infer",
        status: caseStatus(body),
        requiredCapability:
          unsupportedCase?.requirement ??
          (basename(path).startsWith("rdfs-")
            ? "ordinary-sh:SPARQLRule-with-external-data/shapes/result-graphs"
            : "ordinary-sh:SPARQLRule-execution"),
        profileIds: [...PROFILES.inferenceRules],
        eligibility: unsupportedCase
          ? "known-profile-unsupported"
          : "runner-transport-required-unexecuted",
        ...evidence,
      };
    });
  });
  for (const stableId of unsupported.keys()) {
    if (!observedUnsupported.has(stableId)) {
      throw new Error(`missing frozen unsupported inference case: ${stableId}`);
    }
  }
  return cases;
}

function collectSrlCases(context) {
  const directory = join(context.suiteRoot, "sparql-rl");
  const rootManifest = join(directory, "manifest-sparql-rl.ttl");
  const manifests = [
    ...readPinnedText(context, rootManifest).matchAll(/<([^>]+manifest\.ttl)>/g),
  ].map((match) => join(directory, match[1]));
  if (manifests.length !== 6) {
    throw new Error(`candidate SPARQL-RL root lists ${manifests.length} manifests`);
  }

  return manifests.flatMap((manifest) => {
    const text = readPinnedText(context, manifest);
    const entries = /mf:entries\s*\(([\s\S]*?)\)\s*\./.exec(text)?.[1];
    if (entries === undefined) {
      throw new Error(`missing mf:entries list in ${relativeSourcePath(context, manifest)}`);
    }
    const ids = [...entries.matchAll(/(?<![\w-]):([\w-]+)/g)].map(
      (match) => `:${match[1]}`,
    );
    return ids.map((id) => {
      const match = new RegExp(
        `(?:^|\\n)\\s*${escapeRegex(id)}\\s+rdf:type\\s+srlt:([^\\s;]+)\\s*;([\\s\\S]*?)\\n\\s*\\.`,
        "m",
      ).exec(text);
      if (!match) {
        throw new Error(`missing SPARQL-RL entry ${id} in ${relativeSourcePath(context, manifest)}`);
      }
      const [, type, body] = match;
      const action = /mf:action\s+\[([\s\S]*?)\]\s*;/.exec(body)?.[1] ?? "";
      const referenceDefinitions = [
        ["ruleset", turtleObject(action, "srlt:ruleset") ?? turtleObject(body, "mf:action")],
        ["dataGraph", turtleObject(action, "srlt:data")],
        ["expectedResult", turtleObject(body, "mf:result")],
      ];
      const references = referenceDefinitions
        .filter(([, reference]) => reference)
        .map(([role, reference]) => ({
          role,
          disposition: "external-file",
          ...sourceRecord(context, join(dirname(manifest), reference)),
        }));
      const sources = uniqueSourceRecords([
        sourceRecord(context, manifest),
        ...references.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
      ]);
      const testId = turtleString(body, "mf:name");
      if (testId === null) {
        throw new Error(`missing simple mf:name for ${id} in ${relativeSourcePath(context, manifest)}`);
      }
      return {
        id: `${relativeSourcePath(context, manifest)}#${id}`,
        localId: id,
        manifest: {
          path: relativeSourcePath(context, manifest),
          base: relativeSourcePath(context, dirname(manifest)),
        },
        lane: "srl",
        type,
        status: "unspecified",
        requiredCapability:
          type === "RulesEvalTest"
            ? "SPARQL-RL-evaluation"
            : "SPARQL-RL-parser-and-static-analysis",
        profileIds: [...PROFILES.srl],
        eligibility: "adapter-required-unexecuted",
        adapterRequirements: [
          "sparql-rl-tests-namespace",
          "manifest-sparql-rl-root",
          "six-included-manifests",
        ],
        sources,
        references,
        runnerIdentity: {
          file: stripSourcePrefix(
            relativeSourcePath(context, manifest),
            "shacl12-test-suite/tests/sparql-rl/",
          ),
          testId,
        },
      };
    });
  });
}

function collectCompactCases(context) {
  const directory = join(context.checkoutRoot, "shacl12-cs/tests/valid");
  return walk(directory)
    .filter((path) => path.endsWith(".shaclc"))
    .map((input) => {
      const expected = `${input.slice(0, -7)}.ttl`;
      const inputSource = sourceRecord(context, input);
      const expectedSource = sourceRecord(context, expected);
      return {
        id: inputSource.path,
        lane: "compactSyntax",
        type: "informative-positive-pair",
        status: "informative",
        requiredCapability: "SHACL-C-parse-and-RDF-mapping",
        profileIds: [],
        eligibility: "candidate-selected-unexecuted",
        sources: [inputSource, expectedSource],
        references: [
          { role: "source", disposition: "external-file", ...inputSource },
          {
            role: "expectedResult",
            disposition: "external-file",
            ...expectedSource,
          },
        ],
        runnerIdentity: {
          file: basename(input),
          testId: basename(input),
        },
      };
    });
}

function classifyValidationCase(entry) {
  const exclusion = FIXED_CORE_EXCLUSIONS.find(
    (candidate) => candidate.stableId === entry.stableId,
  );
  if (!exclusion) {
    return entry;
  }
  const primary = entry.sources.find((source) => source.path === exclusion.path);
  if (!primary || primary.sha256 !== exclusion.sha256) {
    throw new Error(`fixed validation exclusion identity/hash drift: ${entry.stableId}`);
  }
  return {
    ...entry,
    eligibility: "fixed-hash-excluded",
    exclusion: exclusion.reason,
  };
}

function in003Sentinel(context) {
  const exclusion = FIXED_CORE_EXCLUSIONS[1];
  const input = sourceRecord(context, join(context.checkoutRoot, exclusion.path));
  if (input.sha256 !== exclusion.sha256) {
    throw new Error("core/node/in-003 fixed exclusion hash drift");
  }
  return {
    id: "unparsed-approved-case",
    stableId: exclusion.stableId,
    lane: "validate",
    type: "unparsed-fixture",
    status: "approved",
    requiredCapability: "valid-Turtle-fixture",
    profileIds: [...PROFILES.validate],
    eligibility: "fixed-hash-excluded",
    exclusion: exclusion.reason,
    sources: [input],
    runnerIdentity: {
      file: "core/node/in-003.ttl",
      testId: "core/node/in-003",
    },
  };
}

function finalizeCases(cases) {
  return cases.map((entry) => ({
    ...entry,
    sources: uniqueSourceRecords(entry.sources),
    declaration: declarationFor(entry.eligibility),
    runnerIdentity: entry.runnerIdentity ?? manifestRunnerIdentity(entry),
  }));
}

function manifestRunnerIdentity(entry) {
  const roots = {
    validate: "shacl12-test-suite/tests/",
    nodeExpressions: "shacl12-test-suite/tests/node-expr/",
    inferenceRules: "shacl12-test-suite/tests/inference-rules/",
  };
  const root = roots[entry.lane];
  if (!root || !entry.manifest || !entry.id.startsWith("<") || !entry.id.endsWith(">")) {
    throw new Error(`cannot derive runner identity for ${entry.stableId ?? entry.id}`);
  }
  const file = stripSourcePrefix(entry.manifest.path, root);
  const reference = entry.id.slice(1, -1);
  const base = `file:///candidate/${entry.manifest.path}`;
  const resolved = new URL(reference, base).href;
  const runnerRoot = `file:///candidate/${root}`;
  const testId = resolved.startsWith(runnerRoot) ? resolved.slice(runnerRoot.length) : `<${resolved}>`;
  return { file, testId };
}

function wrapperEvidence(context, path, body) {
  const action = /mf:action\s+\[([\s\S]*?)\]\s*;/.exec(body)?.[1] ?? "";
  const referenceDefinitions = [
    ["dataGraph", rawTurtleReference(action, "sht:dataGraph")],
    ["shapesGraph", rawTurtleReference(action, "sht:shapesGraph")],
    ["expectedResult", rawTurtleReference(body, "mf:result")],
  ];
  const references = referenceDefinitions.map(([role, raw]) => {
    const resolved = raw && raw !== "<>" ? join(dirname(path), raw.slice(1, -1)) : path;
    return {
      role,
      disposition: raw ? (raw === "<>" ? "same-wrapper" : "external-file") : "embedded",
      ...sourceRecord(context, resolved),
    };
  });
  return {
    sources: uniqueSourceRecords([
      sourceRecord(context, path),
      ...references.map(({ path: sourcePath, sha256: digest }) => ({
        path: sourcePath,
        sha256: digest,
      })),
    ]),
    references,
  };
}

function declarationProjection(lanes) {
  const rows = Object.entries(lanes).flatMap(([lane, cases]) =>
    cases.map((entry) => [
      lane,
      entry.stableId ?? entry.id,
      entry.type,
      entry.status,
      entry.declaration,
      [...entry.profileIds].sort(compareStrings),
      uniqueSourceRecords(entry.sources)
        .map(({ path, sha256: digest }) => [path, digest])
        .sort(comparePairs),
    ]),
  );
  rows.sort((left, right) =>
    compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]),
  );
  const bytes = Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
  return { rows: rows.length, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function namedBlocks(text, type) {
  return [
    ...text.matchAll(
      new RegExp(
        `(?:^|\\n)\\s*([^\\s]+)\\s*(?:\\n\\s*)?(?:rdf:type|a)\\s+${escapeRegex(type)}\\s*;([\\s\\S]*?mf:status\\s+sht:(?:approved|proposed|rejected))`,
        "g",
      ),
    ),
  ];
}

function caseStatus(body) {
  if (/sht:approved\b/.test(body)) return "approved";
  if (/sht:proposed\b/.test(body)) return "proposed";
  if (/sht:rejected\b/.test(body)) return "rejected";
  return "unspecified";
}

function rawTurtleReference(text, predicate) {
  return new RegExp(`${escapeRegex(predicate)}\\s+(<>|<[^>]+>)`).exec(text)?.[1] ?? null;
}

function turtleObject(text, predicate) {
  return new RegExp(`${escapeRegex(predicate)}\\s+<([^>]+)>`).exec(text)?.[1] ?? null;
}

function turtleString(text, predicate) {
  const value = new RegExp(`${escapeRegex(predicate)}\\s+"([^"\\\\]*)"`).exec(text)?.[1];
  return value ?? null;
}

function sourceRecord(context, path) {
  const bytes = readPinnedFile(context, path);
  return { path: relativeSourcePath(context, path), sha256: sha256(bytes) };
}

function uniqueSourceRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = `${record.path}\0${record.sha256}`;
    unique.set(key, { path: record.path, sha256: record.sha256 });
  }
  return [...unique.values()];
}

function declarationFor(eligibility) {
  if (eligibility === "fixed-hash-excluded") return "excluded";
  if (eligibility === "known-profile-unsupported") return "unsupported";
  return "selected";
}

function requireCounts(counts) {
  const expected = {
    validate: 170,
    nodeExpressions: 143,
    inferenceRules: 21,
    srl: 203,
    compactSyntax: 32,
  };
  for (const [lane, count] of Object.entries(expected)) {
    requireEqual(counts[lane], count, `${lane} declaration count`);
  }
}

function requireDeclarations(lanes) {
  const expected = {
    validate: { selected: 168, unsupported: 0, excluded: 2 },
    nodeExpressions: { selected: 143, unsupported: 0, excluded: 0 },
    inferenceRules: { selected: 14, unsupported: 7, excluded: 0 },
    srl: { selected: 203, unsupported: 0, excluded: 0 },
    compactSyntax: { selected: 32, unsupported: 0, excluded: 0 },
  };
  for (const [lane, cases] of Object.entries(lanes)) {
    const actual = { selected: 0, unsupported: 0, excluded: 0 };
    for (const entry of cases) actual[entry.declaration] += 1;
    for (const [declaration, count] of Object.entries(expected[lane])) {
      requireEqual(actual[declaration], count, `${lane} ${declaration} declaration count`);
    }
  }
}

function hashNamedFiles(root, files) {
  return Object.fromEntries(
    Object.entries(files).map(([name, path]) => [
      name,
      sha256(readPinnedFile({ checkoutRoot: root }, join(root, path))),
    ]),
  );
}

function requireNamedHashes(actual, expected, label) {
  for (const [name, digest] of Object.entries(expected)) {
    requireEqual(actual[name], digest, `${label} ${name} SHA-256`);
  }
}

function treeHash(directory, relativeRoot) {
  const hash = createHash("sha256");
  for (const path of walk(directory)) {
    hash.update(toPosix(relative(relativeRoot, path)));
    hash.update("\0");
    hash.update(sha256(readPinnedFile({ checkoutRoot: relativeRoot }, path)));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function walk(directory) {
  const root = realpathSync(directory);
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic link rejected in pinned input: ${path}`);
      }
      if (entry.isDirectory()) return walk(path);
      if (!entry.isFile()) {
        throw new Error(`non-regular pinned input rejected: ${path}`);
      }
      return [path];
    })
    .sort(compareStrings);
}

function readPinnedText(context, path) {
  return readPinnedFile(context, path).toString("utf8");
}

function readPinnedFile(context, path) {
  const root = context.checkoutRoot;
  const candidate = secureExistingFile(path, root, "pinned input");
  const size = statSync(candidate).size;
  if (size > MAX_PINNED_FILE_BYTES) {
    throw new Error(`pinned input exceeds ${MAX_PINNED_FILE_BYTES} bytes: ${candidate}`);
  }
  return readFileSync(candidate);
}

function relativeSourcePath(context, path) {
  const relativePath = toPosix(relative(context.checkoutRoot, resolve(path)));
  if (!relativePath || relativePath.startsWith("../")) {
    throw new Error(`source path escapes candidate checkout: ${path}`);
  }
  return relativePath;
}

function assertGitIdentity(root, expectedCommit, label) {
  const head = git(["rev-parse", "HEAD"], root).trim();
  requireEqual(head, expectedCommit, `${label} commit`);
  const status = git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    root,
  );
  if (status !== "") {
    throw new Error(`${label} is not clean:\n${status}`);
  }
  if (hiddenIndexEntriesWithFiles(root).length > 0) {
    throw new Error(`${label} hides a present file from git status`);
  }
}

function git(argumentsList, cwd) {
  return execFileSync("git", argumentsList, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ensureHistoricalCheckout(checkout, targetRoot) {
  assertContained(checkout, targetRoot);
  if (existsSync(checkout)) {
    secureExistingDirectory(checkout, targetRoot, "historical checkout");
    const head = git(["rev-parse", "HEAD"], checkout).trim();
    requireEqual(head, historicalShaclRevision.suiteCommit, "historical checkout commit");
    return;
  }
  const temporary = `${checkout}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  assertContained(temporary, targetRoot);
  try {
    git(
      ["clone", "--filter=blob:none", "--no-checkout", historicalShaclRevision.repository, temporary],
      targetRoot,
    );
    git(["checkout", "--detach", historicalShaclRevision.suiteCommit], temporary);
    secureExistingDirectory(temporary, targetRoot, "temporary historical checkout");
    renameSync(temporary, checkout);
    secureExistingDirectory(checkout, targetRoot, "historical checkout");
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
}

function atomicHistoricalJson(path, value, repositoryRoot) {
  assertContained(dirname(path), repositoryRoot);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      throw new Error(`refusing to replace symbolic link ${path}`);
    }
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function candidateRunPath({ implementation, kind, runId }) {
  const root =
    kind === "jena-compact"
      ? "target/datalog-oracles/jena-shaclc/revisions"
      : "target/w3c/shacl-1.2/revisions";
  return `${root}/${candidateShaclRevision.suiteCommit}/${implementation}/${runId}`;
}

function validateRun(run) {
  if (!run || typeof run !== "object") throw new Error("candidate run is required");
  requireRunKind(run.kind);
  requireFullCommit(run.implementationCommit, "run implementation");
  requireEqual(
    run.suiteCommit,
    candidateShaclRevision.suiteCommit,
    "run suite commit",
  );
  if (
    typeof run.runId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      run.runId,
    )
  ) {
    throw new Error("candidate run ID is not a lowercase UUID v4");
  }
}

function requireRunKind(kind) {
  if (!["rust-suite", "jena-compact", "clause-audit"].includes(kind)) {
    throw new Error(`invalid candidate run kind: ${kind}`);
  }
}

function ensureSecureDirectory(parent, relativePath) {
  const root = realpathSync(parent);
  let current = root;
  for (const component of relativePath.split("/").filter(Boolean)) {
    if (component === "." || component === ".." || component.includes(sep)) {
      throw new Error(`invalid secure directory component: ${component}`);
    }
    current = resolve(current, component);
    assertContained(current, root);
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 });
    }
    secureExistingDirectory(current, root, "candidate output directory");
  }
  return current;
}

function requireDirectory(path, label) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`${label} path is required`);
  }
  return secureExistingDirectory(path, path, label);
}

function secureExistingDirectory(path, parent, label) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  assertContained(candidate, root);
  const status = lstatSync(candidate);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`${label} is not a real directory: ${candidate}`);
  }
  const canonical = realpathSync(candidate);
  assertContained(canonical, root);
  rejectSymlinkComponents(canonical, root);
  return canonical;
}

function secureExistingFile(path, parent, label) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  assertContained(candidate, root);
  rejectSymlinkComponents(candidate, root);
  const status = lstatSync(candidate);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`${label} is not a regular file: ${candidate}`);
  }
  const canonical = realpathSync(candidate);
  assertContained(canonical, root);
  return canonical;
}

function rejectSymlinkComponents(path, root) {
  let current = root;
  const suffix = relative(root, path);
  for (const component of suffix ? suffix.split(sep) : []) {
    current = resolve(current, component);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`symbolic-link path component rejected: ${current}`);
    }
  }
}

function assertContained(path, parent) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes trusted root: ${candidate}`);
  }
}

function requireFullCommit(value, label) {
  if (typeof value !== "string" || !FULL_COMMIT.test(value)) {
    throw new Error(`${label} must be a full lowercase Git commit`);
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: ${actual} != ${expected}`);
  }
}

function stripSourcePrefix(path, prefix) {
  if (!path.startsWith(prefix)) {
    throw new Error(`source path ${path} is outside runner root ${prefix}`);
  }
  return path.slice(prefix.length);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePairs(left, right) {
  return compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
