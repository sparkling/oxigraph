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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateShaclRevision,
  collectCandidateInventory,
  createCandidateRun,
  writeCandidateArtifact,
} from "./inventory.mjs";
import { verifyShaclCandidateArtifacts } from "../evidence/verify-programme.mjs";
import { executeCandidateChild, parseEvidence } from "./run.mjs";

const DEFINITION = {
  name: "jenaCompact",
  expected: {
    discovered: 32,
    eligible: 32,
    passed: 32,
    unsupported: 0,
    failed: 0,
    excluded: 0,
  },
};

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
    kind: "jena-compact",
  });
  const inventoryArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "inventory.json",
    value: inventory,
  });

  const fixtures = resolve(checkout, "shacl12-cs/tests/valid");
  requireDirectoryInside(fixtures, checkout, "compact fixture root");
  const pom = resolve(moduleDirectory, "jena-compact/pom.xml");
  requireFileInside(pom, repositoryRoot, "Jena pom");
  const args = [
    "-q",
    "-f",
    pom,
    "compile",
    "exec:java",
    `-Dexec.args=${fixtures}`,
  ];
  const { execution, checkoutAuthenticationError } = executeCandidateChild({
    cwd: repositoryRoot,
    program: "mvn",
    args,
    checkout,
    targetRoot: candidateTargetRoot,
  });
  const stdoutArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "jena-compact.stdout.log",
    value: execution.stdout,
  });
  const stderrArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "jena-compact.stderr.log",
    value: execution.stderr,
  });
  const errors = [];
  if (checkoutAuthenticationError !== null) {
    errors.push(
      `candidate checkout reauthentication failed: ${checkoutAuthenticationError}`,
    );
  }
  let observed = { counts: null, cases: [] };
  try {
    observed = parseEvidence(DEFINITION, execution.stdout);
  } catch (error) {
    if (error.evidence) observed = error.evidence;
    errors.push(errorMessage(error));
  }
  let joinedCases = [];
  try {
    joinedCases = joinCompactCases(inventory.lanes?.compactSyntax, observed.cases);
  } catch (error) {
    if (Array.isArray(error.joined)) joinedCases = error.joined;
    errors.push(errorMessage(error));
  }
  if (execution.error !== null) errors.push(`spawn failed: ${execution.error}`);
  if (execution.signal !== null) errors.push(`terminated by signal ${execution.signal}`);
  if (execution.status !== 0) errors.push(`Jena exited with status ${execution.status}, expected 0`);

  const sourceAfter = implementationIdentity(repositoryRoot, false);
  if (
    sourceAfter.commit !== sourceBefore.commit ||
    sourceAfter.branch !== sourceBefore.branch ||
    sourceAfter.status !== sourceBefore.status
  ) {
    errors.push("implementation source changed during Jena execution");
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
  if (joinedCases.length !== 32) {
    errors.push(`joined compact cases=${joinedCases.length}, expected 32`);
  }
  const lanes = {
    jenaCompact: {
      inventoryLane: "compactSyntax",
      command: { program: "mvn", args },
      status: {
        code: execution.status,
        signal: execution.signal,
        error: execution.error,
      },
      stdoutArtifact,
      stderrArtifact,
      counts: observed.counts,
      complete: errors.length === 0,
      errors: [...errors],
    },
  };
  const aggregateCounts =
    observed.counts ?? {
      discovered: 0,
      eligible: 0,
      passed: 0,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    };
  const receipt = {
    schema: "oxigraph.shacl-candidate-run/v1",
    kind: "jena-compact",
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
  return errors.length === 0 ? 0 : 1;
}

function joinCompactCases(declarations, observedCases) {
  if (!Array.isArray(declarations)) throw new Error("compact inventory declarations are missing");
  const expected = new Map();
  for (const declaration of declarations) {
    const identity = declaration?.runnerIdentity;
    const key = identityKey(identity?.file, identity?.testId);
    if (expected.has(key)) throw new Error(`duplicate compact declaration ${key}`);
    expected.set(key, declaration);
  }
  const seen = new Set();
  const joined = [];
  const errors = [];
  for (const observed of observedCases) {
    const key = identityKey(observed.file, observed.testId);
    if (seen.has(key)) {
      errors.push(`duplicate observed compact identity ${key}`);
      continue;
    }
    seen.add(key);
    const declaration = expected.get(key);
    if (!declaration) {
      errors.push(`unexpected observed compact identity ${key}`);
      continue;
    }
    if (declaration.declaration !== "selected" || observed.kind !== "PASS") {
      errors.push(
        `${key} emitted ${observed.kind} for ${declaration.declaration} declaration`,
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
      sources: declaration.sources,
      references: declaration.references ?? [],
      runnerIdentity: declaration.runnerIdentity,
    });
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) errors.push(`missing observed compact identity ${key}`);
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
  if (head !== candidateShaclRevision.suiteCommit || status !== "") {
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

function requireFileInside(path, parent, label) {
  const root = realpathSync(parent);
  assertPathComponents(path, root, label);
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
    throw new Error(`${label} is not a regular file`);
  }
  const canonical = realpathSync(path);
  if (canonical !== root && !canonical.startsWith(`${root}/`)) {
    throw new Error(`${label} escapes its trusted root`);
  }
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
