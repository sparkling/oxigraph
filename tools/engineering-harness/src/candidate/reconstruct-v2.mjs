import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { types as utilTypes } from "node:util";

import { parseTaskContractBytesV2 } from "../contract-v2.mjs";
import {
  validateCandidatePatchV2,
  validateTaskV2Path,
  validateTaskV2Scope,
} from "../policy/paths-v2.mjs";
import {
  isTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "../policy/task-v2-failures.mjs";
import { createGitHome, GitBytesProcessFault, runGitBytes } from "./git.mjs";
import {
  createTreeV2PrimitivesForTrustedRunner,
  projectTreeManifestV2,
  treeEntriesAtAsciiFold,
  treeEntryAtPath,
} from "./tree-v2.mjs";

const temporaryPrefix = "oxigraph-candidate-v2-";
const cloneOutputBytes = 8 * 1024 * 1024;
const patchOutputBytes = 8 * 1024 * 1024;
const commitOutputBytes = 4 * 1024;
const commitMessage = Buffer.from(
  "Oxigraph engineering-harness v2 candidate\n",
  "utf8",
);
const commitIdentity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "harness@localhost",
  GIT_AUTHOR_NAME: "Oxigraph Engineering Harness",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "harness@localhost",
  GIT_COMMITTER_NAME: "Oxigraph Engineering Harness",
});
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function createReconstructionController(gitBytesRunner) {
  if (typeof gitBytesRunner !== "function") {
    throw new TypeError("v2 reconstruction requires a fixed Git-byte runner");
  }
  return {
    gitBytesRunner,
    handles: new WeakMap(),
    quarantinedRoots: new Set(),
  };
}

const productionController = createReconstructionController(runGitBytes);

function gitFailureCleanupSafe(error) {
  if (!(error instanceof GitBytesProcessFault)) return false;
  const outcome = error.outcome;
  if (
    outcome?.noChild === true &&
    outcome.spawned === false &&
    outcome.reaped === false &&
    outcome.directChildCleanupSafe === true &&
    outcome.processGroupQuiescent === true
  ) {
    return true;
  }
  return (
    outcome?.noChild === false &&
    outcome.spawned === true &&
    outcome.captureComplete === true &&
    outcome.reaped === true &&
    outcome.statusAgreement === true &&
    outcome.directChildCleanupSafe === true &&
    outcome.processGroupQuiescent === true &&
    outcome.exitObserved === true &&
    outcome.closeObserved === true &&
    outcome.stdoutEof === true &&
    outcome.stderrEof === true &&
    outcome.stdinComplete === true &&
    outcome.outputTruncated === false &&
    Array.isArray(outcome.processErrors) &&
    outcome.processErrors.length === 0
  );
}

async function runCandidateGit(controller, attempt, input) {
  try {
    return await controller.gitBytesRunner(input);
  } catch (error) {
    if (!gitFailureCleanupSafe(error)) attempt.cleanupSafe = false;
    throw error;
  }
}

function fail(code, detail) {
  throw taskV2Failure(code, detail);
}

function plainRecord(value, label, code = "ERR_CONTRACT_SCHEMA_OR_KEYS") {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilTypes.isProxy(value) ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      fail(code, `${label} must be a plain record`);
    }
    return value;
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(code, error);
  }
}

function exactRecord(value, label, keys, code = "ERR_CONTRACT_SCHEMA_OR_KEYS") {
  const record = plainRecord(value, label, code);
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(record);
  } catch (error) {
    fail(code, error);
  }
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== keys.length ||
    keys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    )
  ) {
    fail(code, `${label} has unexpected keys`);
  }
  return record;
}

function snapshotInput(value) {
  const input = exactRecord(
    value,
    "v2 reconstruction input",
    ["repositoryRoot", "contractBytes", "patch"],
    "ERR_RECONSTRUCTION",
  );
  if (
    typeof input.repositoryRoot !== "string" ||
    input.repositoryRoot.length === 0 ||
    input.repositoryRoot.includes("\0")
  ) {
    fail("ERR_RECONSTRUCTION", "repositoryRoot must be a non-empty path");
  }
  const parsedContract = parseTaskContractBytesV2(input.contractBytes);
  const { contract } = parsedContract;
  const patchProjection = validateCandidatePatchV2(input.patch, contract);
  return Object.freeze({
    repositoryRoot: input.repositoryRoot,
    contract,
    contractSha256: parsedContract.contractSha256,
    canonicalContractSha256: parsedContract.canonicalContractSha256,
    patch: input.patch,
    patchProjection,
    patchSha256: sha256(input.patch),
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function typedOperation(code, operation) {
  try {
    return await operation();
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(code, error);
  }
}

function validatedCommandOid(value, label, oidLength) {
  if (!Buffer.isBuffer(value)) {
    fail("ERR_RECONSTRUCTION", `${label} is not exact Git output bytes`);
  }
  const match = /^([0-9a-f]+)\n$/u.exec(value.toString("ascii"));
  const oid = match?.[1];
  if (
    oid === undefined ||
    !value.equals(Buffer.from(`${oid}\n`, "ascii")) ||
    !oidPattern.test(oid) ||
    /^0+$/u.test(oid) ||
    oid.length !== oidLength
  ) {
    fail("ERR_RECONSTRUCTION", `${label} is not an exact object identifier`);
  }
  return oid;
}

async function requireOwnerOnly(temporaryRoot) {
  const mode =
    (await typedOperation("ERR_RECONSTRUCTION", () => stat(temporaryRoot)))
      .mode & 0o777;
  if (mode !== 0o700) {
    fail("ERR_RECONSTRUCTION", "candidate temporary root is not owner-only");
  }
}

async function requireClean(runGit, workspace, gitHome) {
  const status = await typedOperation("ERR_RECONSTRUCTION", () =>
    runGit({
      args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      cwd: workspace,
      home: gitHome,
      maxOutputBytes: patchOutputBytes,
    }),
  );
  if (status.length !== 0) {
    fail("ERR_RECONSTRUCTION", "candidate workspace is not clean");
  }
}

function parseCommitHeader(output, label, oidLength) {
  if (!Buffer.isBuffer(output)) {
    fail("ERR_RECONSTRUCTION", `${label} is not exact commit bytes`);
  }
  const headerEnd = output.indexOf(Buffer.from("\n\n", "ascii"));
  if (headerEnd < 0) {
    fail("ERR_RECONSTRUCTION", `${label} has malformed commit bytes`);
  }
  const header = [];
  const headerBytes = output.subarray(0, headerEnd);
  let start = 0;
  while (start <= headerBytes.length) {
    const end = headerBytes.indexOf(0x0a, start);
    if (end === -1) {
      header.push(Buffer.from(headerBytes.subarray(start)));
      break;
    }
    header.push(Buffer.from(headerBytes.subarray(start, end)));
    start = end + 1;
  }
  const treeMatch = /^tree ([0-9a-f]+)$/u.exec(header[0]?.toString("ascii"));
  if (treeMatch === null) {
    fail("ERR_RECONSTRUCTION", `${label} has no exact tree header`);
  }
  if (!header[0].equals(Buffer.from(`tree ${treeMatch[1]}`, "ascii"))) {
    fail("ERR_RECONSTRUCTION", `${label} has a non-exact tree header`);
  }
  const tree = validatedCommandOid(
    Buffer.from(`${treeMatch[1]}\n`, "ascii"),
    `${label} tree header`,
    oidLength,
  );
  const parents = header
    .filter((line) => line.subarray(0, 7).equals(Buffer.from("parent ")))
    .map((line) =>
      validatedCommandOid(
        Buffer.concat([line.subarray(7), Buffer.from("\n")]),
        `${label} parent header`,
        oidLength,
      ),
    );
  return Object.freeze({ tree, parents: Object.freeze(parents) });
}

async function readCommitHeader({
  runGit,
  workspace,
  gitHome,
  oid,
  label,
  oidLength,
}) {
  const output = await typedOperation("ERR_RECONSTRUCTION", () =>
    runGit({
      args: ["cat-file", "commit", oid],
      cwd: workspace,
      home: gitHome,
      maxOutputBytes: patchOutputBytes,
    }),
  );
  return parseCommitHeader(output, label, oidLength);
}

function exactPathBytes(path) {
  return Buffer.from(path, "ascii");
}

function sameEntryPath(entry, path) {
  return entry.path.equals(exactPathBytes(path));
}

function requireNoFoldedAlternate(tree, path, code) {
  const foldedEntries = treeEntriesAtAsciiFold(tree, path);
  if (
    foldedEntries.length > 1 ||
    (foldedEntries.length === 1 && !sameEntryPath(foldedEntries[0], path))
  ) {
    fail(code, `tree has a folded collision at ${path}`);
  }
  return foldedEntries;
}

function requireParentTrees(tree, path) {
  const components = path.split("/");
  for (let length = 1; length < components.length; length += 1) {
    const parent = components.slice(0, length).join("/");
    const folded = requireNoFoldedAlternate(tree, parent, "ERR_PATH_COLLISION");
    const entry = treeEntryAtPath(tree, parent);
    if (
      folded.length !== 1 ||
      entry === undefined ||
      entry.mode !== "040000" ||
      entry.type !== "tree"
    ) {
      fail("ERR_PARENT_TREE", `path has no exact regular tree parent: ${path}`);
    }
  }
}

function requireAbsentPath(tree, path) {
  requireParentTrees(tree, path);
  const folded = requireNoFoldedAlternate(tree, path, "ERR_PATH_COLLISION");
  if (treeEntryAtPath(tree, path) !== undefined) {
    fail("ERR_BASELINE_STATE", `required absent path is present: ${path}`);
  }
  if (folded.length !== 0) {
    fail("ERR_PATH_COLLISION", `required absent path has a folded collision`);
  }
}

function requireRegularBlob(tree, path, missingCode) {
  requireParentTrees(tree, path);
  const folded = requireNoFoldedAlternate(tree, path, "ERR_PATH_COLLISION");
  const entry = treeEntryAtPath(tree, path);
  if (entry === undefined || folded.length !== 1) {
    fail(missingCode, `required path is absent: ${path}`);
  }
  if (entry.mode !== "100644" || entry.type !== "blob") {
    fail("ERR_OBJECT_TYPE", `required path is not a 100644 blob: ${path}`);
  }
  return entry;
}

async function requireBoundPhase({
  primitives,
  workspace,
  gitHome,
  tree,
  path,
  expected,
}) {
  const entry = requireRegularBlob(tree, path, "ERR_BASELINE_STATE");
  if (entry.oid !== expected.objectId) {
    fail("ERR_BASELINE_STATE", `mutable baseline object changed: ${path}`);
  }
  const content = await primitives.readBlobByOid({
    workspace,
    home: gitHome,
    oid: expected.objectId,
  });
  if (sha256(content) !== expected.contentSha256) {
    fail("ERR_BASELINE_STATE", `mutable baseline content changed: ${path}`);
  }
  return entry;
}

async function requireMutableBaselines({
  primitives,
  workspace,
  gitHome,
  baselineTree,
  evaluatorTree,
  mutableBaselines,
}) {
  for (const binding of mutableBaselines) {
    if (binding.state === "absent") {
      requireAbsentPath(baselineTree, binding.path);
      requireAbsentPath(evaluatorTree, binding.path);
      continue;
    }
    const baselineEntry = await requireBoundPhase({
      primitives,
      workspace,
      gitHome,
      tree: baselineTree,
      path: binding.path,
      expected: binding.baseline,
    });
    const evaluatorEntry = await requireBoundPhase({
      primitives,
      workspace,
      gitHome,
      tree: evaluatorTree,
      path: binding.path,
      expected: binding.evaluator,
    });
    if (baselineEntry.oid !== evaluatorEntry.oid) {
      fail(
        "ERR_BASELINE_STATE",
        `evaluator changed a present mutable baseline: ${binding.path}`,
      );
    }
  }
}

function manifestIdentity(manifest) {
  return Object.freeze({ entries: manifest.entries, sha256: manifest.sha256 });
}

function requireManifestBinding(full, protectedManifest, expected, label) {
  if (
    full.entries !== expected.entries ||
    full.sha256 !== expected.fullSha256 ||
    protectedManifest.entries !== expected.protectedEntries ||
    protectedManifest.sha256 !== expected.protectedSha256
  ) {
    fail("ERR_PROTECTED_MANIFEST", `${label} manifest does not match contract`);
  }
}

function pathFromDiffEntry(entry) {
  const bytes = entry.path;
  if (bytes.some((byte) => byte > 0x7f)) {
    fail("ERR_CANDIDATE_STATUS", "raw diff contains a non-ASCII path");
  }
  const path = bytes.toString("ascii");
  try {
    validateTaskV2Path(path, "raw diff path");
  } catch (error) {
    if (isTaskV2Failure(error)) {
      fail("ERR_CANDIDATE_STATUS", error);
    }
    throw error;
  }
  if (!bytes.equals(exactPathBytes(path))) {
    fail("ERR_CANDIDATE_STATUS", "raw diff path changed during decoding");
  }
  return path;
}

function requireExactStatuses(diff, patchProjection, scope) {
  const actual = diff.changes.map((entry) =>
    Object.freeze({ path: pathFromDiffEntry(entry), status: entry.status }),
  );
  const expected = patchProjection.pathStatuses;
  if (
    actual.length !== expected.length ||
    actual.some(
      (entry, index) =>
        entry.path !== expected[index].path ||
        entry.status !== expected[index].status,
    )
  ) {
    fail(
      "ERR_CANDIDATE_STATUS",
      "candidate raw status projection does not equal the patch projection",
    );
  }

  const createPaths = new Set(scope.createExact);
  for (const entry of actual) {
    const expectedStatus = createPaths.has(entry.path) ? "A" : "M";
    if (
      !scope.mutableExact.includes(entry.path) ||
      entry.status !== expectedStatus
    ) {
      fail("ERR_CANDIDATE_STATUS", "candidate raw status is not admitted");
    }
  }
  for (const path of scope.createExact) {
    if (!actual.some((entry) => entry.path === path && entry.status === "A")) {
      fail("ERR_CANDIDATE_STATUS", "candidate omits a required creation");
    }
  }
  return Object.freeze(actual);
}

async function requireCandidateTree({
  primitives,
  workspace,
  gitHome,
  candidateTree,
  scope,
  createdBlobs,
}) {
  for (const path of scope.mutableExact) {
    requireRegularBlob(candidateTree, path, "ERR_CANDIDATE_STATUS");
  }
  for (const blob of createdBlobs) {
    const entry = requireRegularBlob(
      candidateTree,
      blob.path,
      "ERR_CANDIDATE_STATUS",
    );
    if (
      entry.mode !== blob.mode ||
      entry.type !== blob.type ||
      entry.oid !== blob.objectId
    ) {
      fail("ERR_RECONSTRUCTION", "created blob identity does not match patch");
    }
    const content = await primitives.readBlobByOid({
      workspace,
      home: gitHome,
      oid: entry.oid,
    });
    if (sha256(content) !== blob.contentSha256) {
      fail("ERR_RECONSTRUCTION", "created blob content does not match patch");
    }
  }
}

function frozenCreatedBlobs(createdBlobs) {
  return Object.freeze(
    createdBlobs.map((blob) =>
      Object.freeze({
        path: blob.path,
        mode: blob.mode,
        type: blob.type,
        objectId: blob.objectId,
        contentSha256: blob.contentSha256,
      }),
    ),
  );
}

function frozenIdentity({
  contractSha256,
  evaluatorPatchSha256,
  patchSha256,
  commit,
  tree,
  pathStatuses,
  createdBlobs,
  fullManifest,
  protectedManifest,
}) {
  return Object.freeze({
    schemaVersion: 2,
    contractSha256,
    evaluatorPatchSha256,
    patchSha256,
    commit,
    tree,
    pathStatuses: Object.freeze(
      pathStatuses.map((entry) =>
        Object.freeze({ path: entry.path, status: entry.status }),
      ),
    ),
    createdBlobs: frozenCreatedBlobs(createdBlobs),
    manifests: Object.freeze({
      full: manifestIdentity(fullManifest),
      protected: manifestIdentity(protectedManifest),
    }),
  });
}

function safeTemporaryRoot(root) {
  const resolvedRoot = resolve(root);
  const resolvedTemporary = resolve(tmpdir());
  return (
    dirname(resolvedRoot) === resolvedTemporary &&
    basename(resolvedRoot).startsWith(temporaryPrefix)
  );
}

async function removeTemporaryRoot(root) {
  if (!safeTemporaryRoot(root)) {
    fail("ERR_INTERNAL_FAIL_CLOSED", "refusing an unrecognized v2 temp root");
  }
  await typedOperation("ERR_INTERNAL_FAIL_CLOSED", () =>
    rm(root, { recursive: true, force: true }),
  );
}

async function prepareWorkspace(input, attempt, runGit) {
  const source = await typedOperation("ERR_RECONSTRUCTION", () =>
    realpath(input.repositoryRoot),
  );
  if (source === resolve("/")) {
    fail(
      "ERR_RECONSTRUCTION",
      "repository root may not be the filesystem root",
    );
  }

  const temporaryRoot = await typedOperation("ERR_RECONSTRUCTION", () =>
    mkdtemp(join(tmpdir(), temporaryPrefix)),
  );
  attempt.temporaryRoot = temporaryRoot;
  await requireOwnerOnly(temporaryRoot);
  const workspace = join(temporaryRoot, "repo");
  const gitHome = await typedOperation("ERR_RECONSTRUCTION", () =>
    createGitHome(temporaryRoot),
  );
  await typedOperation("ERR_RECONSTRUCTION", () =>
    runGit({
      args: [
        "clone",
        "--local",
        "--no-hardlinks",
        "--no-checkout",
        "--config",
        "core.hooksPath=/dev/null",
        "--",
        source,
        workspace,
      ],
      cwd: temporaryRoot,
      home: gitHome,
      timeoutMs: 300_000,
      maxOutputBytes: cloneOutputBytes,
    }),
  );
  for (const [name, value] of [
    ["core.hooksPath", "/dev/null"],
    ["core.autocrlf", "false"],
    ["credential.helper", ""],
    ["protocol.file.allow", "never"],
  ]) {
    await typedOperation("ERR_RECONSTRUCTION", () =>
      runGit({
        args: ["config", "--local", name, value],
        cwd: workspace,
        home: gitHome,
      }),
    );
  }
  return Object.freeze({ source, temporaryRoot, workspace, gitHome });
}

async function reconstructCandidateV2Once(rawInput, controller) {
  const input = snapshotInput(rawInput);
  const { contract } = input;
  const attempt = { cleanupSafe: true, temporaryRoot: undefined };
  const runGit = (gitInput) => runCandidateGit(controller, attempt, gitInput);
  const primitives = createTreeV2PrimitivesForTrustedRunner(runGit);

  try {
    const prepared = await prepareWorkspace(input, attempt, runGit);
    const { source, temporaryRoot, workspace, gitHome } = prepared;
    const oidLength = contract.baseline.tree.length;
    const baselineCommit = await readCommitHeader({
      runGit,
      workspace,
      gitHome,
      oid: contract.baseline.commit,
      label: "baseline commit",
      oidLength,
    });
    const evaluatorCommit = await readCommitHeader({
      runGit,
      workspace,
      gitHome,
      oid: contract.evaluator.commit,
      label: "evaluator commit",
      oidLength,
    });
    if (
      baselineCommit.tree !== contract.baseline.tree ||
      evaluatorCommit.tree !== contract.evaluator.tree ||
      evaluatorCommit.parents.length !== 1 ||
      evaluatorCommit.parents[0] !== contract.baseline.commit
    ) {
      fail(
        "ERR_RECONSTRUCTION",
        "baseline or evaluator commit ancestry does not match the contract",
      );
    }

    const baselineTree = await primitives.loadTreeV2({
      workspace,
      home: gitHome,
      tree: contract.baseline.tree,
    });
    await typedOperation("ERR_RECONSTRUCTION", () =>
      runGit({
        args: ["checkout", "--detach", contract.baseline.commit],
        cwd: workspace,
        home: gitHome,
        maxOutputBytes: patchOutputBytes,
      }),
    );
    const checkedOutBaseline = validatedCommandOid(
      await typedOperation("ERR_RECONSTRUCTION", () =>
        runGit({ args: ["write-tree"], cwd: workspace, home: gitHome }),
      ),
      "checked-out baseline tree",
      oidLength,
    );
    if (checkedOutBaseline !== contract.baseline.tree) {
      fail("ERR_RECONSTRUCTION", "checked-out baseline tree changed");
    }
    await requireClean(runGit, workspace, gitHome);

    const evaluatorPatch = await typedOperation("ERR_RECONSTRUCTION", () =>
      runGit({
        args: [
          "diff",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          contract.baseline.commit,
          contract.evaluator.commit,
        ],
        cwd: workspace,
        home: gitHome,
        maxOutputBytes: patchOutputBytes,
      }),
    );
    if (sha256(evaluatorPatch) !== contract.evaluator.patchSha256) {
      fail("ERR_RECONSTRUCTION", "frozen evaluator patch digest changed");
    }
    await typedOperation("ERR_RECONSTRUCTION", () =>
      runGit({
        args: ["apply", "--index", "--whitespace=error", "-"],
        cwd: workspace,
        home: gitHome,
        stdin: evaluatorPatch,
        maxOutputBytes: patchOutputBytes,
      }),
    );
    const reconstructedEvaluatorTree = validatedCommandOid(
      await typedOperation("ERR_RECONSTRUCTION", () =>
        runGit({ args: ["write-tree"], cwd: workspace, home: gitHome }),
      ),
      "reconstructed evaluator tree",
      oidLength,
    );
    if (reconstructedEvaluatorTree !== contract.evaluator.tree) {
      fail("ERR_RECONSTRUCTION", "frozen evaluator tree did not reconstruct");
    }
    const evaluatorTree = await primitives.loadTreeV2({
      workspace,
      home: gitHome,
      tree: contract.evaluator.tree,
    });

    await requireMutableBaselines({
      primitives,
      workspace,
      gitHome,
      baselineTree,
      evaluatorTree,
      mutableBaselines: contract.protectedInputs.mutableBaselines,
    });
    const presentPaths = contract.protectedInputs.mutableBaselines
      .filter((binding) => binding.state === "present")
      .map((binding) => binding.path);
    const baselineFull = projectTreeManifestV2(baselineTree);
    const baselineProtected = projectTreeManifestV2(baselineTree, {
      exclude: presentPaths,
    });
    const evaluatorFull = projectTreeManifestV2(evaluatorTree);
    const evaluatorProtected = projectTreeManifestV2(evaluatorTree, {
      exclude: presentPaths,
    });
    requireManifestBinding(
      baselineFull,
      baselineProtected,
      contract.protectedInputs.baselineManifest,
      "baseline",
    );
    requireManifestBinding(
      evaluatorFull,
      evaluatorProtected,
      contract.protectedInputs.evaluatorManifest,
      "evaluator",
    );

    // The raw patch has already passed the strict v2 parser. It is applied once;
    // no canonicalization, preflight application, retry, or fallback occurs.
    await typedOperation("ERR_RECONSTRUCTION", () =>
      runGit({
        args: ["apply", "--index", "--whitespace=error", "-"],
        cwd: workspace,
        home: gitHome,
        stdin: Buffer.from(input.patch, "utf8"),
        maxOutputBytes: patchOutputBytes,
      }),
    );
    const candidateTreeOid = validatedCommandOid(
      await typedOperation("ERR_RECONSTRUCTION", () =>
        runGit({ args: ["write-tree"], cwd: workspace, home: gitHome }),
      ),
      "candidate tree",
      oidLength,
    );
    const rawDiff = await primitives.diffTreesV2({
      workspace,
      home: gitHome,
      oldTree: contract.evaluator.tree,
      newTree: candidateTreeOid,
    });
    const pathStatuses = requireExactStatuses(
      rawDiff,
      input.patchProjection,
      contract.scope,
    );
    const candidateTree = await primitives.loadTreeV2({
      workspace,
      home: gitHome,
      tree: candidateTreeOid,
    });
    await requireCandidateTree({
      primitives,
      workspace,
      gitHome,
      candidateTree,
      scope: contract.scope,
      createdBlobs: input.patchProjection.createdBlobs,
    });

    const candidateFull = projectTreeManifestV2(candidateTree);
    const candidateProtected = projectTreeManifestV2(candidateTree, {
      exclude: contract.scope.mutableExact,
    });
    if (
      candidateProtected.entries !== evaluatorProtected.entries ||
      candidateProtected.sha256 !== evaluatorProtected.sha256
    ) {
      fail(
        "ERR_PROTECTED_MANIFEST",
        "candidate changed the evaluator protected projection",
      );
    }

    const candidateCommit = validatedCommandOid(
      await typedOperation("ERR_RECONSTRUCTION", () =>
        runGit({
          args: [
            "commit-tree",
            candidateTreeOid,
            "-p",
            contract.evaluator.commit,
          ],
          cwd: workspace,
          home: gitHome,
          stdin: commitMessage,
          environmentOverrides: commitIdentity,
          maxOutputBytes: commitOutputBytes,
        }),
      ),
      "candidate commit",
      oidLength,
    );
    const candidateCommitHeader = await readCommitHeader({
      runGit,
      workspace,
      gitHome,
      oid: candidateCommit,
      label: "candidate commit",
      oidLength,
    });
    if (
      candidateCommitHeader.tree !== candidateTreeOid ||
      candidateCommitHeader.parents.length !== 1 ||
      candidateCommitHeader.parents[0] !== contract.evaluator.commit
    ) {
      fail("ERR_RECONSTRUCTION", "candidate commit identity is not exact");
    }
    await typedOperation("ERR_RECONSTRUCTION", () =>
      runGit({
        args: ["checkout", "--detach", candidateCommit],
        cwd: workspace,
        home: gitHome,
        maxOutputBytes: patchOutputBytes,
      }),
    );
    await requireClean(runGit, workspace, gitHome);

    const identity = frozenIdentity({
      contractSha256: input.contractSha256,
      evaluatorPatchSha256: contract.evaluator.patchSha256,
      patchSha256: input.patchSha256,
      commit: candidateCommit,
      tree: candidateTreeOid,
      pathStatuses,
      createdBlobs: input.patchProjection.createdBlobs,
      fullManifest: candidateFull,
      protectedManifest: candidateProtected,
    });
    controller.handles.set(identity, {
      state: "ready",
      sourceRoot: source,
      temporaryRoot,
      workspace,
      gitHome,
      contract,
      contractSha256: input.contractSha256,
      canonicalContractSha256: input.canonicalContractSha256,
      candidate: identity,
      submodules: contract.protectedInputs.submodules,
      cleanupSafe: attempt.cleanupSafe,
      quarantineDetailSha256: null,
    });
    return identity;
  } catch (error) {
    const root = attempt.temporaryRoot;
    if (root !== undefined) {
      if (!attempt.cleanupSafe) {
        controller.quarantinedRoots.add(root);
      } else {
        try {
          await removeTemporaryRoot(root);
        } catch (cleanupError) {
          controller.quarantinedRoots.add(root);
          throw cleanupError;
        }
      }
    }
    throw error;
  }
}

export function reconstructCandidateV2(input) {
  return withTaskV2FailureBoundary(() =>
    reconstructCandidateV2Once(input, productionController),
  );
}

function disposeCandidateV2WithController(candidate, controller) {
  return withTaskV2FailureBoundary(async () => {
    const handle = controller.handles.get(candidate);
    if (
      handle === undefined ||
      !["ready", "verified"].includes(handle.state) ||
      handle.cleanupSafe !== true
    ) {
      fail("ERR_RECONSTRUCTION", "candidate v2 handle is unknown or disposed");
    }
    handle.state = "disposing";
    try {
      await removeTemporaryRoot(handle.temporaryRoot);
      handle.state = "disposed";
    } catch (error) {
      handle.cleanupSafe = false;
      handle.state = "quarantined";
      handle.quarantineDetailSha256 = sha256(
        Buffer.from("candidate disposal failed closed", "utf8"),
      );
      controller.quarantinedRoots.add(handle.temporaryRoot);
      throw error;
    }
  });
}

export function disposeCandidateV2(candidate) {
  return disposeCandidateV2WithController(candidate, productionController);
}

/** Explicitly test-only fixed Git-byte runner injection. */
export function createCandidateV2ReconstructorForTesting(gitBytesRunner) {
  const controller = createReconstructionController(gitBytesRunner);
  return Object.freeze({
    reconstructCandidateV2: (input) =>
      withTaskV2FailureBoundary(() =>
        reconstructCandidateV2Once(input, controller),
      ),
    disposeCandidateV2: (candidate) =>
      disposeCandidateV2WithController(candidate, controller),
  });
}
