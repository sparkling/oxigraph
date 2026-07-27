#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const COMMIT = "eedda09f93c39be1d2e978f3f942631494ae25a0";
const REPOSITORY = "https://github.com/w3c/data-shapes.git";
const EXPECTED_SUITE_HASH =
  "1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a";
const EXPECTED_SPEC_HASHES = {
  core: "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
  nodeExpressions:
    "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
  sparql: "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
  rules: "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
  compact:
    "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
};
const EXPECTED_COMPACT_GRAMMAR_HASH =
  "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04";

const repositoryRoot = realpathSync(resolve(import.meta.dirname, "../.."));
const targetRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
const checkout = resolve(targetRoot, `data-shapes-${COMMIT.slice(0, 12)}`);
assertSecurePath(targetRoot, repositoryRoot);
mkdirSync(targetRoot, { recursive: true });
assertSecurePath(targetRoot, repositoryRoot);
ensureCheckout();
assertSecurePath(checkout, targetRoot);

const suiteRoot = join(checkout, "shacl12-test-suite/tests");
const suiteHash = treeHash(suiteRoot, checkout);
if (suiteHash !== EXPECTED_SUITE_HASH) {
  throw new Error(`suite hash mismatch: ${suiteHash}`);
}
const specFiles = {
  core: "shacl12-core/index.html",
  nodeExpressions: "shacl12-node-expr/index.html",
  sparql: "shacl12-sparql/index.html",
  rules: "shacl12-rules/index.html",
  compact: "shacl12-cs/index.html",
};
const specHashes = Object.fromEntries(
  Object.entries(specFiles).map(([name, path]) => [
    name,
    sha256(readPinnedFile(join(checkout, path))),
  ]),
);
for (const [name, expected] of Object.entries(EXPECTED_SPEC_HASHES)) {
  if (specHashes[name] !== expected) {
    throw new Error(`${name} specification hash mismatch: ${specHashes[name]}`);
  }
}

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
  const text = readFileSync(path, "utf8");
  for (const status of Object.keys(statuses)) {
    const count = [...text.matchAll(new RegExp(`sht:${status}\\b`, "g"))].length;
    statuses[status] += count;
    categories[category][`${status}Entries`] += count;
  }
}
const rootManifest = readFileSync(join(suiteRoot, "manifest.ttl"), "utf8");
const rootIncludes = [...rootManifest.matchAll(/mf:include\s+<([^>]+)>/g)].map(
  (match) => match[1],
);
const rulesManifestTypes = {};
for (const category of [
  "syntax",
  "wellformed",
  "stratification",
  "eval",
  "examples",
]) {
  const text = readFileSync(
    join(suiteRoot, "rules", category, "manifest.ttl"),
    "utf8",
  );
  for (const match of text.matchAll(/\bsrt:(Rules[A-Za-z]+Test)\b/g)) {
    rulesManifestTypes[match[1]] ??= 0;
    rulesManifestTypes[match[1]] += 1;
  }
}
const rulesManifestEntries = Object.values(rulesManifestTypes).reduce(
  (sum, count) => sum + count,
  0,
);
const compactRoot = join(checkout, "shacl12-cs");
const compactGrammarHash = sha256(
  readPinnedFile(join(compactRoot, "SHACLC.g4")),
);
if (compactGrammarHash !== EXPECTED_COMPACT_GRAMMAR_HASH) {
  throw new Error(`compact grammar hash mismatch: ${compactGrammarHash}`);
}
const compactFiles = walk(join(compactRoot, "tests", "valid"));
const compactSources = compactFiles.filter((path) => path.endsWith(".shaclc"));
const compactExpected = compactFiles.filter((path) => path.endsWith(".ttl"));
const compactExpectedNames = new Set(
  compactExpected.map((path) => path.slice(0, -4)),
);
const compactPairs = compactSources.filter((path) =>
  compactExpectedNames.has(path.slice(0, -7)),
).length;
const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    repository: REPOSITORY,
    commit: COMMIT,
    editorDrafts: {
      core: "https://w3c.github.io/data-shapes/shacl12-core/",
      nodeExpressions: "https://w3c.github.io/data-shapes/shacl12-node-expr/",
      sparql: "https://w3c.github.io/data-shapes/shacl12-sparql/",
      rules: "https://w3c.github.io/data-shapes/shacl12-rules/",
      compact: "https://w3c.github.io/data-shapes/shacl12-compact-syntax/",
    },
    testSuite:
      "https://w3c.github.io/data-shapes/data-shapes-test-suite/",
  },
  integrity: {
    suiteContentSha256: suiteHash,
    specificationSha256: specHashes,
  },
  inventory: {
    ttlFiles: ttlFiles.length,
    manifestFiles: ttlFiles.filter((path) => path.endsWith("manifest.ttl")).length,
    statuses,
    categories,
    rootIncludes,
    rulesReachableFromRootManifest: rootIncludes.some((path) =>
      path.startsWith("rules/"),
    ),
    rulesEvidence: {
      srlFixtureFiles: srlFiles.length,
      manifestEntries: rulesManifestEntries,
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
      sourceExpectedPairs: compactPairs,
      grammarSha256: compactGrammarHash,
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
atomicJson(output, inventory);
process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);

function ensureCheckout() {
  assertSecurePath(checkout, targetRoot);
  if (existsSync(checkout)) {
    if (!lstatSync(checkout).isDirectory()) {
      throw new Error(`checkout path is not a directory: ${checkout}`);
    }
    const head = git(["rev-parse", "HEAD"], checkout).trim();
    if (head !== COMMIT) {
      throw new Error(`existing checkout has unexpected commit ${head}`);
    }
    return;
  }
  const temporary = `${checkout}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  assertSecurePath(temporary, targetRoot);
  try {
    git(["clone", "--filter=blob:none", "--no-checkout", REPOSITORY, temporary]);
    git(["checkout", "--detach", COMMIT], temporary);
    assertSecurePath(temporary, targetRoot);
    renameSync(temporary, checkout);
    assertSecurePath(checkout, targetRoot);
  } finally {
    if (existsSync(temporary)) {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function git(argumentsList, cwd = repositoryRoot) {
  return execFileSync("git", argumentsList, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic link rejected in pinned input: ${path}`);
      }
      return entry.isDirectory() ? walk(path) : [path];
    })
    .sort();
}

function treeHash(directory, relativeRoot) {
  const hash = createHash("sha256");
  for (const path of walk(directory)) {
    hash.update(relative(relativeRoot, path));
    hash.update("\0");
    hash.update(sha256(readFileSync(path)));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function atomicJson(path, value) {
  assertSecurePath(dirname(path), repositoryRoot);
  mkdirSync(dirname(path), { recursive: true });
  assertSecurePath(dirname(path), repositoryRoot);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`refusing to replace symbolic link ${path}`);
  }
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
}

function assertSecurePath(path, parent) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes trusted root: ${candidate}`);
  }
  let current = root;
  const suffix = relative(root, candidate);
  for (const component of suffix ? suffix.split(sep) : []) {
    current = resolve(current, component);
    if (!existsSync(current)) {
      break;
    }
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`symbolic-link path component rejected: ${current}`);
    }
    const canonical = realpathSync(current);
    if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) {
      throw new Error(`canonical path escapes trusted root: ${canonical}`);
    }
  }
}

function readPinnedFile(path) {
  assertSecurePath(path, checkout);
  if (!lstatSync(path).isFile()) {
    throw new Error(`pinned input is not a regular file: ${path}`);
  }
  return readFileSync(path);
}
