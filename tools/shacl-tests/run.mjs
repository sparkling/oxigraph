#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const repositoryRoot = realpathSync(resolve(import.meta.dirname, "../.."));
run(process.execPath, [resolve(import.meta.dirname, "inventory.mjs")], true);
const evidenceRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
assertSecurePath(evidenceRoot, repositoryRoot);
const inventoryPath = resolve(evidenceRoot, "inventory.json");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const checkout = resolve(
  evidenceRoot,
  `data-shapes-${inventory.source.commit.slice(0, 12)}`,
);
assertSecurePath(checkout, evidenceRoot);
const suiteRoot = resolve(checkout, "shacl12-test-suite/tests");

const laneDefinitions = [
  {
    name: "validate",
    example: "w3c_runner",
    root: suiteRoot,
    expected: {
      discovered: 169,
      eligible: 167,
      passed: 167,
      unsupported: 0,
      failed: 0,
      excluded: 2,
    },
  },
  {
    name: "nodeExpressions",
    example: "w3c_node_expr_runner",
    root: resolve(suiteRoot, "node-expr"),
    expected: {
      discovered: 143,
      eligible: 143,
      passed: 143,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    },
  },
  {
    name: "sparqlRulesInfer",
    example: "w3c_sparql_rules_runner",
    root: resolve(suiteRoot, "sparql/rules"),
    expected: {
      discovered: 6,
      eligible: 6,
      passed: 6,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    },
  },
  {
    name: "srlRules",
    example: "w3c_srl_rules_runner",
    root: resolve(suiteRoot, "rules"),
    expected: {
      discovered: 171,
      eligible: 171,
      passed: 171,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    },
  },
  {
    name: "compactSyntax",
    example: "w3c_compact_runner",
    root: resolve(checkout, "shacl12-cs/tests/valid"),
    expected: {
      discovered: 32,
      eligible: 32,
      passed: 32,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    },
  },
];

const lanes = {};
const allCases = [];
for (const definition of laneDefinitions) {
  assertSecurePath(definition.root, checkout);
  const args = [
    "run",
    "--locked",
    "-p",
    "oxshacl",
    "--example",
    definition.example,
    "--features",
    "w3c-tests,rdf-12",
    "--",
    definition.root,
  ];
  const execution = run("cargo", args, false);
  const parsed = parseEvidence(definition, execution.stdout);
  if (execution.status !== 0) {
    throw new Error(
      `${definition.example} exited with status ${execution.status}: ${execution.stderr}`,
    );
  }
  lanes[definition.name] = {
    command: `cargo ${args.slice(0, -1).join(" ")} <pinned-suite-root>`,
    counts: parsed.counts,
    stdoutSha256: sha256(execution.stdout),
    stderrSha256: sha256(execution.stderr),
  };
  allCases.push(
    ...parsed.cases.map((testCase) => ({
      lane: definition.name,
      ...testCase,
    })),
  );
}

const generatedAt = new Date().toISOString();
const caseArtifact = {
  schemaVersion: 1,
  generatedAt,
  sourceCommit: inventory.source.commit,
  suiteContentSha256: inventory.integrity.suiteContentSha256,
  cases: allCases,
};
const casesPath = resolve(evidenceRoot, "run-cases.json");
const casesContent = atomicJson(casesPath, caseArtifact);
const receipt = {
  schemaVersion: 2,
  generatedAt,
  sourceCommit: inventory.source.commit,
  suiteContentSha256: inventory.integrity.suiteContentSha256,
  lanes,
  aggregateCounts: sumCounts(Object.values(lanes).map((lane) => lane.counts)),
  casesArtifact: {
    path: relative(repositoryRoot, casesPath),
    sha256: sha256(casesContent),
    cases: allCases.length,
  },
  currentRulesDraft: {
    status: "supplemental-qualified",
    lane: "supplemental",
    rootReachable: false,
    mfApproval: "unspecified",
    reason:
      "All 171 standalone manifest-rules.ttl cases pass, including strict result-graph comparison for 16 evaluations; the manifest is not root-reachable and declares no mf:approval.",
  },
  compactSyntaxDraft: {
    status: "supplemental-qualified",
    lane: "supplemental",
    normativeTests: false,
    reason:
      "All 32 pinned SHACL-C source/TTL pairs pass strict graph-isomorphism comparison; the specification explicitly labels these tests non-normative.",
  },
  qualification:
    "Feature-set differential against the pinned draft suite. Unsupported and excluded cases are explicit; the SRL lane is supplemental because its manifest is not root-reachable and has unspecified approval.",
};
const receiptPath = resolve(evidenceRoot, "run-receipt.json");
atomicJson(receiptPath, receipt);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);

function parseEvidence(definition, stdout) {
  const summaries = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SUMMARY "));
  if (summaries.length !== 1) {
    throw new Error(
      `${definition.name} emitted ${summaries.length} summary lines instead of one`,
    );
  }
  const match =
    /^SUMMARY discovered=(\d+) eligible=(\d+) passed=(\d+) unsupported=(\d+) failed=(\d+) excluded=(\d+)$/.exec(
      summaries[0],
    );
  if (!match) {
    throw new Error(`${definition.name} emitted a malformed six-field summary`);
  }
  const names = [
    "discovered",
    "eligible",
    "passed",
    "unsupported",
    "failed",
    "excluded",
  ];
  const counts = Object.fromEntries(
    names.map((name, index) => [name, Number(match[index + 1])]),
  );
  if (counts.discovered !== counts.eligible + counts.excluded) {
    throw new Error(`${definition.name} violates discovered count conservation`);
  }
  if (
    counts.eligible !== counts.passed + counts.unsupported + counts.failed
  ) {
    throw new Error(`${definition.name} violates eligible count conservation`);
  }
  for (const name of names) {
    if (counts[name] !== definition.expected[name]) {
      throw new Error(
        `${definition.name} ${name}=${counts[name]}, expected ${definition.expected[name]}`,
      );
    }
  }
  const cases = stdout
    .split(/\r?\n/)
    .filter((line) => /^(?:PASS|FAIL|UNSUPPORTED|EXCLUDED)\t/.test(line))
    .map((line) => parseCase(definition.name, line));
  const kindCounts = countKinds(cases);
  for (const [kind, field] of [
    ["PASS", "passed"],
    ["FAIL", "failed"],
    ["UNSUPPORTED", "unsupported"],
    ["EXCLUDED", "excluded"],
  ]) {
    if (kindCounts[kind] !== counts[field]) {
      throw new Error(
        `${definition.name} ${kind} case lines do not match ${field}`,
      );
    }
  }
  if (cases.length !== counts.discovered) {
    throw new Error(`${definition.name} case lines do not match discovered`);
  }
  return { counts, cases };
}

function parseCase(lane, line) {
  const fields = line.split("\t");
  if (fields.length !== 4) {
    throw new Error(`${lane} emitted a case line without exactly four fields`);
  }
  const [kind, file, testId, detail] = fields;
  if (
    !file ||
    !testId ||
    isAbsolute(file) ||
    file.split(/[\\/]/).some((component) => component === "..")
  ) {
    throw new Error(`${lane} emitted an invalid case identity`);
  }
  return { kind, file, testId, detail };
}

function countKinds(cases) {
  const counts = { PASS: 0, FAIL: 0, UNSUPPORTED: 0, EXCLUDED: 0 };
  for (const testCase of cases) {
    counts[testCase.kind] += 1;
  }
  return counts;
}

function sumCounts(countsList) {
  const output = {
    discovered: 0,
    eligible: 0,
    passed: 0,
    unsupported: 0,
    failed: 0,
    excluded: 0,
  };
  for (const counts of countsList) {
    for (const name of Object.keys(output)) {
      output[name] += counts[name];
    }
  }
  return output;
}

function run(command, args, print) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (print) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (print && result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
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
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
  return content;
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
