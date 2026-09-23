#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateShaclRevision,
  collectCandidateInventory,
  createCandidateRun,
  writeCandidateArtifact,
} from "./inventory.mjs";
import { verifyShaclCandidateArtifacts } from "../evidence/verify-programme.mjs";
import { hiddenIndexEntriesWithFiles } from "./hidden-entries.mjs";

const COUNT_FIELDS = [
  "discovered",
  "eligible",
  "passed",
  "unsupported",
  "failed",
  "excluded",
];
const KINDS = new Set(["PASS", "FAIL", "UNSUPPORTED", "EXCLUDED"]);
const LANE_DEFINITIONS = [
  {
    name: "validate",
    artifactName: "validate",
    inventoryLane: "validate",
    example: "w3c_runner",
    root: ["shacl12-test-suite", "tests"],
    expected: {
      discovered: 170,
      eligible: 168,
      passed: 168,
      unsupported: 0,
      failed: 0,
      excluded: 2,
    },
  },
  {
    name: "nodeExpressions",
    artifactName: "node-expressions",
    inventoryLane: "nodeExpressions",
    example: "w3c_node_expr_runner",
    root: ["shacl12-test-suite", "tests", "node-expr"],
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
    artifactName: "sparql-rules-infer",
    inventoryLane: "inferenceRules",
    example: "w3c_sparql_rules_runner",
    root: ["shacl12-test-suite", "tests", "inference-rules"],
    expected: {
      discovered: 21,
      eligible: 21,
      passed: 14,
      unsupported: 7,
      failed: 0,
      excluded: 0,
    },
  },
  {
    name: "srlRules",
    artifactName: "srl-rules",
    inventoryLane: "srl",
    example: "w3c_srl_rules_runner",
    root: ["shacl12-test-suite", "tests", "sparql-rl"],
    expected: {
      discovered: 203,
      eligible: 203,
      passed: 203,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    },
  },
  {
    name: "compactSyntax",
    artifactName: "compact-syntax",
    inventoryLane: "compactSyntax",
    example: "w3c_compact_runner",
    root: ["shacl12-cs", "tests", "valid"],
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

export function parseCase(lane, line) {
  if (typeof lane !== "string" || !lane || typeof line !== "string") {
    throw new Error("case evidence needs a lane and line");
  }
  const fields = line.split("\t");
  if (fields.length !== 4) {
    throw new Error(`${lane} emitted a case line without exactly four fields`);
  }
  const [kind, file, testId, detail] = fields;
  if (
    !KINDS.has(kind) ||
    !file ||
    !testId ||
    isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((component) => !component || component === "." || component === "..") ||
    /[\r\n\0]/u.test(testId) ||
    /[\r\n\0]/u.test(detail)
  ) {
    throw new Error(`${lane} emitted an invalid case identity`);
  }
  return { kind, file, testId, detail };
}

export function parseEvidence(definition, stdout) {
  if (
    !definition ||
    typeof definition.name !== "string" ||
    !definition.expected ||
    typeof stdout !== "string"
  ) {
    throw new Error("evidence parsing needs a lane definition and UTF-8 stdout");
  }
  const lines = stdout.split(/\r?\n/u);
  const cases = [];
  for (const line of lines) {
    if (/^(?:PASS|FAIL|UNSUPPORTED|EXCLUDED)\t/u.test(line)) {
      cases.push(parseCase(definition.name, line));
    }
  }
  const summaries = lines.filter((line) => line.startsWith("SUMMARY "));
  if (summaries.length !== 1) {
    throw evidenceError(
      `${definition.name} emitted ${summaries.length} summary lines instead of one`,
      { counts: null, cases },
    );
  }
  const match =
    /^SUMMARY discovered=(\d+) eligible=(\d+) passed=(\d+) unsupported=(\d+) failed=(\d+) excluded=(\d+)$/u.exec(
      summaries[0],
    );
  if (!match) {
    throw evidenceError(`${definition.name} emitted a malformed six-field summary`, {
      counts: null,
      cases,
    });
  }
  const counts = Object.fromEntries(
    COUNT_FIELDS.map((name, index) => [name, Number(match[index + 1])]),
  );
  const observed = { counts, cases };
  if (counts.discovered !== counts.eligible + counts.excluded) {
    throw evidenceError(`${definition.name} violates discovered count conservation`, observed);
  }
  if (counts.eligible !== counts.passed + counts.unsupported + counts.failed) {
    throw evidenceError(`${definition.name} violates eligible count conservation`, observed);
  }
  const byKind = { PASS: 0, FAIL: 0, UNSUPPORTED: 0, EXCLUDED: 0 };
  for (const testCase of cases) byKind[testCase.kind] += 1;
  for (const [kind, field] of [
    ["PASS", "passed"],
    ["FAIL", "failed"],
    ["UNSUPPORTED", "unsupported"],
    ["EXCLUDED", "excluded"],
  ]) {
    if (byKind[kind] !== counts[field]) {
      throw evidenceError(
        `${definition.name} ${kind} case lines do not match ${field}`,
        observed,
      );
    }
  }
  if (cases.length !== counts.discovered) {
    throw evidenceError(`${definition.name} case lines do not match discovered`, observed);
  }
  for (const name of COUNT_FIELDS) {
    if (counts[name] !== definition.expected[name]) {
      throw evidenceError(
        `${definition.name} ${name}=${counts[name]}, expected ${definition.expected[name]}`,
        observed,
      );
    }
  }
  return observed;
}

export async function main() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = realpathSync(resolve(moduleDirectory, "../.."));
  const candidateTargetRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
  const sourceBefore = implementationIdentity(repositoryRoot);
  const checkout = ensureCandidateCheckout(repositoryRoot);
  const inventory = collectCandidateInventory({
    checkout,
    implementation: sourceBefore.commit,
  });
  verifyInventoryIdentity(inventory, sourceBefore.commit);
  const run = createCandidateRun({
    repositoryRoot,
    implementation: sourceBefore.commit,
    kind: "rust-suite",
  });
  const inventoryArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "inventory.json",
    value: inventory,
  });

  const lanes = {};
  const joinedCases = [];
  const errors = [];
  for (const definition of LANE_DEFINITIONS) {
    const laneRoot = resolve(checkout, ...definition.root);
    requireDirectoryInside(laneRoot, checkout, `${definition.name} root`);
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
      laneRoot,
    ];
    const { execution, checkoutAuthenticationError } = executeCandidateChild({
      cwd: repositoryRoot,
      program: "cargo",
      args,
      checkout,
      targetRoot: candidateTargetRoot,
    });
    const stdoutArtifact = writeCandidateArtifact({
      repositoryRoot,
      run,
      name: `${definition.artifactName}.stdout.log`,
      value: execution.stdout,
    });
    const stderrArtifact = writeCandidateArtifact({
      repositoryRoot,
      run,
      name: `${definition.artifactName}.stderr.log`,
      value: execution.stderr,
    });
    const laneErrors = [];
    if (checkoutAuthenticationError !== null) {
      laneErrors.push(
        `candidate checkout reauthentication failed: ${checkoutAuthenticationError}`,
      );
    }
    let observed = { counts: null, cases: [] };
    try {
      observed = parseEvidence(definition, execution.stdout);
    } catch (error) {
      if (error.evidence) observed = error.evidence;
      laneErrors.push(errorMessage(error));
    }
    let joined = [];
    try {
      joined = joinCases(
        definition.name,
        inventory.lanes?.[definition.inventoryLane],
        observed.cases,
      );
    } catch (error) {
      if (Array.isArray(error.joined)) joined = error.joined;
      laneErrors.push(errorMessage(error));
    }
    const expectedStatus = definition.expected.unsupported > 0 ? 2 : 0;
    if (execution.error !== null) laneErrors.push(`spawn failed: ${execution.error}`);
    if (execution.signal !== null) laneErrors.push(`terminated by signal ${execution.signal}`);
    if (execution.status !== expectedStatus) {
      laneErrors.push(
        `${definition.name} exited with status ${execution.status}, expected ${expectedStatus}`,
      );
    }
    joinedCases.push(...joined);
    errors.push(...laneErrors.map((error) => `${definition.name}: ${error}`));
    lanes[definition.name] = {
      inventoryLane: definition.inventoryLane,
      command: { program: "cargo", args },
      status: {
        code: execution.status,
        signal: execution.signal,
        error: execution.error,
      },
      stdoutArtifact,
      stderrArtifact,
      counts: observed.counts,
      complete: laneErrors.length === 0,
      errors: laneErrors,
    };
    if (checkoutAuthenticationError !== null) break;
  }

  const sourceAfter = implementationIdentity(repositoryRoot, false);
  if (
    sourceAfter.commit !== sourceBefore.commit ||
    sourceAfter.branch !== sourceBefore.branch ||
    sourceAfter.status !== sourceBefore.status
  ) {
    errors.push("implementation source changed during candidate execution");
  }
  const casesArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "cases.json",
    value: {
      schema: "oxigraph.shacl-candidate-cases/v1",
      suiteCommit: run.suiteCommit,
      implementationCommit: run.implementationCommit,
      runId: run.runId,
      cases: joinedCases,
    },
  });
  const aggregateCounts = sumCounts(
    Object.values(lanes).map((lane) => lane.counts).filter((counts) => counts !== null),
  );
  if (aggregateCounts.discovered !== 569) {
    errors.push(`aggregate discovered=${aggregateCounts.discovered}, expected 569`);
  }
  if (joinedCases.length !== 569) {
    errors.push(`joined cases=${joinedCases.length}, expected 569`);
  }
  const receipt = {
    schema: "oxigraph.shacl-candidate-run/v1",
    kind: "rust-suite",
    suiteCommit: run.suiteCommit,
    implementationCommit: run.implementationCommit,
    runId: run.runId,
    inventoryArtifact,
    casesArtifact,
    lanes,
    aggregateCounts,
    sourceBefore,
    sourceAfter,
    complete: errors.length === 0,
    errors,
    completeConformance: false,
    qualified: false,
    promoted: false,
  };
  const receiptRef = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "receipt.json",
    value: receipt,
  });

  let verifier;
  try {
    verifier = await verifyShaclCandidateArtifacts(repositoryRoot, {
      receiptRef,
      expectedImplementationCommit: sourceBefore.commit,
    });
  } catch (error) {
    process.stderr.write(`candidate verifier failed: ${errorMessage(error)}\n`);
    return 1;
  }
  if (!verifier || verifier.ok !== true) {
    process.stderr.write(
      `candidate verifier rejected receipt: ${JSON.stringify(verifier?.errors ?? [])}\n`,
    );
    return 1;
  }
  process.stdout.write(`${JSON.stringify({ receiptRef, aggregateCounts }, null, 2)}\n`);
  if (errors.length > 0 || aggregateCounts.failed > 0) return 1;
  return aggregateCounts.unsupported > 0 ? 2 : 0;
}

function evidenceError(message, evidence) {
  const error = new Error(message);
  error.evidence = evidence;
  return error;
}

function joinCases(lane, declarations, observedCases) {
  if (!Array.isArray(declarations)) {
    throw new Error(`${lane} inventory declarations are missing`);
  }
  const expected = new Map();
  for (const declaration of declarations) {
    const identity = declaration?.runnerIdentity;
    const key = identityKey(identity?.file, identity?.testId);
    if (expected.has(key)) throw new Error(`${lane} has duplicate declared identity ${key}`);
    expected.set(key, declaration);
  }
  const seen = new Set();
  const joined = [];
  const errors = [];
  for (const observed of observedCases) {
    const key = identityKey(observed.file, observed.testId);
    if (seen.has(key)) {
      errors.push(`duplicate observed identity ${key}`);
      continue;
    }
    seen.add(key);
    const declaration = expected.get(key);
    if (!declaration) {
      errors.push(`unexpected observed identity ${key}`);
      continue;
    }
    const requiredKind =
      declaration.declaration === "excluded"
        ? "EXCLUDED"
        : declaration.declaration === "unsupported"
          ? "UNSUPPORTED"
          : "PASS";
    if (observed.kind !== requiredKind) {
      errors.push(
        `${key} emitted ${observed.kind}, expected ${requiredKind} for ${declaration.declaration}`,
      );
    }
    if (
      requiredKind === "UNSUPPORTED" &&
      (typeof declaration.requiredCapability !== "string" ||
        observed.detail !== declaration.requiredCapability)
    ) {
      errors.push(
        `${key} emitted unsupported detail ${JSON.stringify(observed.detail)}, expected ${JSON.stringify(declaration.requiredCapability)}`,
      );
    }
    joined.push({
      ...observed,
      inventoryLane: declaration.lane,
      stableId: declaration.stableId ?? declaration.id,
      id: declaration.id,
      type: declaration.type,
      status: declaration.status,
      profileIds: declaration.profileIds,
      declaration: declaration.declaration,
      requiredCapability: declaration.requiredCapability,
      sources: declaration.sources,
      references: declaration.references ?? [],
      runnerIdentity: declaration.runnerIdentity,
    });
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) errors.push(`missing observed identity ${key}`);
  }
  if (errors.length > 0) {
    const error = new Error(errors.join("; "));
    error.joined = joined;
    throw error;
  }
  return joined;
}

function identityKey(file, testId) {
  if (typeof file !== "string" || !file || typeof testId !== "string" || !testId) {
    throw new Error("runner identity must contain file and testId");
  }
  return `${file}\u0000${testId}`;
}

function sumCounts(countsList) {
  const total = Object.fromEntries(COUNT_FIELDS.map((name) => [name, 0]));
  for (const counts of countsList) {
    for (const name of COUNT_FIELDS) total[name] += counts[name];
  }
  return total;
}

function implementationIdentity(repositoryRoot, requireClean = true) {
  const top = realpathSync(git(repositoryRoot, ["rev-parse", "--show-toplevel"]).trim());
  if (top !== repositoryRoot) throw new Error("candidate execution requires the canonical checkout");
  const branch = git(repositoryRoot, ["branch", "--show-current"]).trim();
  if (requireClean && branch !== "main") {
    throw new Error("candidate execution requires main");
  }
  const commit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("implementation commit is not full SHA-1");
  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (requireClean && status !== "") {
    throw new Error("candidate execution requires a clean implementation source");
  }
  return { commit, branch, status };
}

function ensureCandidateCheckout(repositoryRoot) {
  const targetRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
  ensureDirectoryPath(targetRoot, repositoryRoot, "candidate checkout parent");
  const checkout = resolve(
    targetRoot,
    `data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}`,
  );
  if (!existsSync(checkout)) {
    const temporary = `${checkout}.tmp-${randomUUID()}`;
    try {
      git(repositoryRoot, [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        candidateShaclRevision.repository,
        temporary,
      ]);
      git(temporary, ["checkout", "--detach", candidateShaclRevision.suiteCommit]);
      verifyCandidateCheckout(temporary, targetRoot);
      renameSync(temporary, checkout);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    }
  }
  verifyCandidateCheckout(checkout, targetRoot);
  return checkout;
}

function verifyCandidateCheckout(checkout, targetRoot) {
  requireDirectoryInside(checkout, targetRoot, "candidate checkout");
  const head = git(checkout, ["rev-parse", "HEAD"]).trim();
  const status = git(checkout, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (
    head !== candidateShaclRevision.suiteCommit ||
    status !== "" ||
    hiddenIndexEntriesWithFiles(checkout).length > 0
  ) {
    throw new Error("candidate checkout is not the exact clean pinned revision");
  }
}

function ensureDirectoryPath(path, parent, label) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  assertPathComponents(candidate, root, label);
  mkdirSync(candidate, { recursive: true });
  assertPathComponents(candidate, root, label);
  requireDirectoryInside(candidate, root, label);
}

function assertPathComponents(path, parent, label) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    throw new Error(`${label} escapes its trusted root`);
  }
  let current = root;
  for (const component of candidate.slice(root.length).split("/").filter(Boolean)) {
    current = resolve(current, component);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link`);
    }
    const canonical = realpathSync(current);
    if (canonical !== root && !canonical.startsWith(`${root}/`)) {
      throw new Error(`${label} escapes its trusted root`);
    }
  }
}

function verifyInventoryIdentity(inventory, implementation) {
  if (
    inventory?.schema !== "oxigraph.shacl-candidate-inventory/v1" ||
    inventory.source?.suiteCommit !== candidateShaclRevision.suiteCommit ||
    inventory.source?.implementationCommit !== implementation ||
    inventory.integrity?.declarationProjection?.rows !== candidateShaclRevision.declarationRows ||
    inventory.integrity?.declarationProjection?.bytes !== candidateShaclRevision.declarationBytes ||
    inventory.integrity?.declarationProjection?.sha256 !== candidateShaclRevision.declarationSha256
  ) {
    throw new Error("candidate inventory identity does not match the frozen interface");
  }
}

function requireDirectoryInside(path, parent, label) {
  const root = realpathSync(parent);
  assertPathComponents(path, root, label);
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) {
    throw new Error(`${label} is not a regular directory`);
  }
  const canonical = realpathSync(path);
  if (canonical !== root && !canonical.startsWith(`${root}/`)) {
    throw new Error(`${label} escapes its trusted root`);
  }
}

export function executeCandidateChild({
  cwd,
  program,
  args,
  checkout,
  targetRoot,
  executeChild = execute,
  authenticateCheckout = verifyCandidateCheckout,
}) {
  const execution = executeChild(cwd, program, args);
  let checkoutAuthenticationError = null;
  try {
    authenticateCheckout(checkout, targetRoot);
  } catch (error) {
    checkoutAuthenticationError = errorMessage(error);
  }
  return { execution, checkoutAuthenticationError };
}

function execute(cwd, program, args) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? errorMessage(result.error) : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry !== null && entry === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
