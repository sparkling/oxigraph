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
import { dirname, relative, resolve, sep } from "node:path";

const repositoryRoot = realpathSync(resolve(import.meta.dirname, "../.."));
const inventoryExecution = run(
  process.execPath,
  [resolve(import.meta.dirname, "inventory.mjs")],
  false,
);
if (inventoryExecution.status !== 0) {
  throw new Error(`SHACL inventory failed: ${inventoryExecution.stderr}`);
}
const inventory = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "target/w3c/shacl-1.2/inventory.json"),
    "utf8",
  ),
);
const fixtures = resolve(
  repositoryRoot,
  "target/w3c/shacl-1.2",
  `data-shapes-${inventory.source.commit.slice(0, 12)}`,
  "shacl12-cs/tests/valid",
);
assertSecurePath(fixtures, repositoryRoot);
const pom = resolve(import.meta.dirname, "jena-compact/pom.xml");
assertSecurePath(pom, repositoryRoot);
const args = [
  "-q",
  "-f",
  pom,
  "compile",
  "exec:java",
  `-Dexec.args=${fixtures}`,
];
const execution = run("mvn", args, false);
if (execution.status !== 0) {
  throw new Error(`Jena compact oracle failed: ${execution.stderr}`);
}
const summary = execution.stdout
  .split(/\r?\n/)
  .filter((line) => line.startsWith("SUMMARY "));
if (summary.length !== 1) {
  throw new Error(`Jena compact oracle emitted ${summary.length} summaries`);
}
const match =
  /^SUMMARY discovered=(\d+) eligible=(\d+) passed=(\d+) unsupported=(\d+) failed=(\d+) excluded=(\d+)$/.exec(
    summary[0],
  );
if (!match) throw new Error("Jena compact oracle summary is malformed");
const fields = [
  "discovered",
  "eligible",
  "passed",
  "unsupported",
  "failed",
  "excluded",
];
const counts = Object.fromEntries(
  fields.map((field, index) => [field, Number(match[index + 1])]),
);
const expected = {
  discovered: 32,
  eligible: 32,
  passed: 32,
  unsupported: 0,
  failed: 0,
  excluded: 0,
};
for (const field of fields) {
  if (counts[field] !== expected[field]) {
    throw new Error(
      `Jena compact ${field}=${counts[field]}, expected ${expected[field]}`,
    );
  }
}
const caseLines = execution.stdout
  .split(/\r?\n/)
  .filter((line) => /^(?:PASS|FAIL|UNSUPPORTED|EXCLUDED)\t/.test(line));
if (
  caseLines.length !== counts.discovered ||
  caseLines.some((line) => line.split("\t").length !== 4)
) {
  throw new Error("Jena compact per-case evidence is incomplete");
}
const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  oracle: {
    name: "Apache Jena SHACL-C",
    version: "6.1.0",
    dependency: "org.apache.jena:jena-shacl:6.1.0",
  },
  source: {
    repository: inventory.source.repository,
    commit: inventory.source.commit,
    suiteContentSha256: inventory.integrity.suiteContentSha256,
    grammarSha256:
      inventory.inventory.compactSyntaxEvidence.grammarSha256,
  },
  command: "mvn -q -f tools/shacl-tests/jena-compact/pom.xml compile exec:java <pinned-fixtures>",
  counts,
  stdoutSha256: sha256(execution.stdout),
  stderrSha256: sha256(execution.stderr),
  qualification:
    "Jena 6.1.0 and Oxigraph independently match the same 32 pinned SHACL-C source/TTL graph-isomorphism pairs.",
};
const output = resolve(
  repositoryRoot,
  "target/datalog-oracles/jena-shaclc/receipt.json",
);
atomicJson(output, receipt);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);

function run(command, argumentsList, print) {
  const result = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (print) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
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
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function assertSecurePath(path, parent) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes trusted root: ${candidate}`);
  }
  let current = root;
  for (const component of relative(root, candidate).split(sep).filter(Boolean)) {
    current = resolve(current, component);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`symbolic-link component rejected: ${current}`);
    }
  }
}
