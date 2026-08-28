import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { validateTaskContractV2 } from "../contract-v2.mjs";
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
import { createGitHome, runGit, runGitBytes } from "./git.mjs";
import {
  diffTreesV2,
  loadTreeV2,
  projectTreeManifestV2,
  readBlobByOid,
  treeEntriesAtAsciiFold,
  treeEntryAtPath,
} from "./tree-v2.mjs";

const temporaryPrefix = "oxigraph-candidate-v2-";
const cloneOutputBytes = 8 * 1024 * 1024;
const patchOutputBytes = 8 * 1024 * 1024;
const commitOutputBytes = 4 * 1024;
const commitMessage = "Oxigraph engineering-harness v2 candidate\n";
const commitIdentity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "harness@localhost",
  GIT_AUTHOR_NAME: "Oxigraph Engineering Harness",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "harness@localhost",
  GIT_COMMITTER_NAME: "Oxigraph Engineering Harness",
});
const reconstructionHandles = new WeakMap();
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

function fail(code, detail) {
  throw taskV2Failure(code, detail);
}

function plainRecord(value, label, code = "ERR_CONTRACT_SCHEMA_OR_KEYS") {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
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

function exactArray(
  value,
  label,
  code = "ERR_CONTRACT_SCHEMA_OR_KEYS",
  maximum = 1024,
) {
  let descriptors;
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      fail(code, `${label} must be a plain array`);
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(code, error);
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    fail(code, `${label} exceeds its array ceiling`);
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    fail(code, `${label} must be dense and have no extra properties`);
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail(code, `${label}[${index}] must be an enumerable data property`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function snapshotPolicyPaths(value, label) {
  const paths = exactArray(value ?? [], label);
  if (paths.length > 32) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `${label} exceeds its path ceiling`);
  }
  return Object.freeze(
    paths.map((path, index) => validateTaskV2Path(path, `${label}[${index}]`)),
  );
}

function validatedOid(value, label, expectedLength) {
  if (
    typeof value !== "string" ||
    !oidPattern.test(value) ||
    /^0+$/u.test(value) ||
    (expectedLength !== undefined && value.length !== expectedLength)
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must be a full non-zero object identifier`,
    );
  }
  return value;
}

function validatedSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `${label} must be a SHA-256 digest`);
  }
  return value;
}

function validatedCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function snapshotManifest(value, label) {
  const record = exactRecord(value, label, [
    "entries",
    "fullSha256",
    "protectedEntries",
    "protectedSha256",
  ]);
  return Object.freeze({
    entries: validatedCount(record.entries, `${label}.entries`),
    fullSha256: validatedSha256(record.fullSha256, `${label}.fullSha256`),
    protectedEntries: validatedCount(
      record.protectedEntries,
      `${label}.protectedEntries`,
    ),
    protectedSha256: validatedSha256(
      record.protectedSha256,
      `${label}.protectedSha256`,
    ),
  });
}

function snapshotPhase(value, label, state, oidLength) {
  if (state === "absent") {
    const phase = exactRecord(value, label, ["state"]);
    if (phase.state !== "absent") {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} must bind the absent state`,
      );
    }
    return Object.freeze({ state: "absent" });
  }

  const phase = exactRecord(value, label, [
    "state",
    "mode",
    "type",
    "objectId",
    "contentSha256",
  ]);
  if (
    phase.state !== "present" ||
    phase.mode !== "100644" ||
    phase.type !== "blob"
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must bind a present 100644 blob`,
    );
  }
  return Object.freeze({
    state: "present",
    mode: "100644",
    type: "blob",
    objectId: validatedOid(phase.objectId, `${label}.objectId`, oidLength),
    contentSha256: validatedSha256(
      phase.contentSha256,
      `${label}.contentSha256`,
    ),
  });
}

function snapshotMutableBaselines(value, scope, oidLength) {
  const records = exactArray(value, "protectedInputs.mutableBaselines");
  if (records.length !== scope.mutableExact.length) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "mutableBaselines must bind every mutableExact path once",
    );
  }
  const createPaths = new Set(scope.createExact);
  return Object.freeze(
    records.map((value, index) => {
      const label = `protectedInputs.mutableBaselines[${index}]`;
      const record = exactRecord(value, label, [
        "path",
        "state",
        "baseline",
        "evaluator",
      ]);
      if (record.path !== scope.mutableExact[index]) {
        fail(
          "ERR_CONTRACT_SCHEMA_OR_KEYS",
          "mutableBaselines paths must equal mutableExact in order",
        );
      }
      const expectedState = createPaths.has(record.path) ? "absent" : "present";
      if (record.state !== expectedState) {
        fail(
          "ERR_CONTRACT_SCHEMA_OR_KEYS",
          `${label}.state disagrees with createExact`,
        );
      }
      const baseline = snapshotPhase(
        record.baseline,
        `${label}.baseline`,
        expectedState,
        oidLength,
      );
      const evaluator = snapshotPhase(
        record.evaluator,
        `${label}.evaluator`,
        expectedState,
        oidLength,
      );
      if (
        expectedState === "present" &&
        (baseline.objectId !== evaluator.objectId ||
          baseline.contentSha256 !== evaluator.contentSha256)
      ) {
        fail(
          "ERR_CONTRACT_SCHEMA_OR_KEYS",
          `${label} changes a present mutable baseline in the evaluator`,
        );
      }
      return Object.freeze({
        path: record.path,
        state: expectedState,
        baseline,
        evaluator,
      });
    }),
  );
}

function snapshotContract(value) {
  validateTaskContractV2(value);
  const contract = exactRecord(value, "v2 contract", [
    "schemaVersion",
    "id",
    "programme",
    "decision",
    "objective",
    "localOnly",
    "promotionAuthority",
    "routing",
    "baseline",
    "evaluator",
    "protectedInputs",
    "scope",
    "verificationSequence",
    "commands",
    "ceilings",
    "initialRed",
    "success",
  ]);
  if (contract.schemaVersion !== 2) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "candidate reconstruction requires schemaVersion 2",
    );
  }

  const baselineRecord = exactRecord(contract.baseline, "baseline", [
    "commit",
    "tree",
  ]);
  const baselineTree = validatedOid(baselineRecord.tree, "baseline.tree");
  const oidLength = baselineTree.length;
  const baseline = Object.freeze({
    commit: validatedOid(baselineRecord.commit, "baseline.commit", oidLength),
    tree: baselineTree,
  });

  const evaluatorRecord = exactRecord(contract.evaluator, "evaluator", [
    "commit",
    "parent",
    "tree",
    "path",
    "changeStatus",
    "blob",
    "contentSha256",
    "patchSha256",
  ]);
  const evaluator = Object.freeze({
    commit: validatedOid(evaluatorRecord.commit, "evaluator.commit", oidLength),
    tree: validatedOid(evaluatorRecord.tree, "evaluator.tree", oidLength),
    patchSha256: validatedSha256(
      evaluatorRecord.patchSha256,
      "evaluator.patchSha256",
    ),
  });

  const scopeRecord = exactRecord(contract.scope, "scope", [
    "mutableExact",
    "createExact",
    "mutablePrefixes",
    "blockedExact",
    "blockedPrefixes",
    "allowCreate",
    "allowDelete",
    "allowRename",
    "allowModeChange",
    "allowSymlink",
    "allowSubmoduleChange",
  ]);
  const blockedExact = snapshotPolicyPaths(
    scopeRecord.blockedExact,
    "scope.blockedExact",
  );
  const blockedPrefixes = snapshotPolicyPaths(
    scopeRecord.blockedPrefixes,
    "scope.blockedPrefixes",
  );
  const scopeInput = {
    mutableExact: scopeRecord.mutableExact,
    createExact: scopeRecord.createExact,
    mutablePrefixes: scopeRecord.mutablePrefixes,
    blockedExact,
    blockedPrefixes,
  };
  scopeInput.allowCreate = scopeRecord.allowCreate;
  const scope = validateTaskV2Scope({ scope: scopeInput });
  const frozenScope = Object.freeze({
    mutableExact: scope.mutableExact,
    createExact: scope.createExact,
    mutablePrefixes: scope.mutablePrefixes,
    blockedExact,
    blockedPrefixes,
    allowCreate: scope.allowCreate,
  });

  const protectedInputsRecord = exactRecord(
    contract.protectedInputs,
    "protectedInputs",
    [
      "manifestAlgorithm",
      "mutableBaselines",
      "baselineManifest",
      "evaluatorManifest",
      "submodules",
    ],
  );
  const protectedInputs = Object.freeze({
    mutableBaselines: snapshotMutableBaselines(
      protectedInputsRecord.mutableBaselines,
      frozenScope,
      oidLength,
    ),
    baselineManifest: snapshotManifest(
      protectedInputsRecord.baselineManifest,
      "protectedInputs.baselineManifest",
    ),
    evaluatorManifest: snapshotManifest(
      protectedInputsRecord.evaluatorManifest,
      "protectedInputs.evaluatorManifest",
    ),
  });

  const ceilingRecord = exactRecord(contract.ceilings, "ceilings", [
    "maxPatchBytes",
    "maxChangedFiles",
    "maxChangedLines",
    "maxWorkerOutputBytes",
    "maxBuildOutputBytes",
    "maxTestOutputBytesPerCommand",
    "maxTotalVerifierWallMs",
    "maxResidentBytes",
    "maxVerifierDiskBytes",
    "cargoBuildJobs",
    "maxRepairCycles",
    "maxCritiqueRounds",
    "networkDuringVerification",
  ]);
  const ceilings = Object.freeze({
    maxPatchBytes: ceilingRecord.maxPatchBytes,
    maxChangedFiles: ceilingRecord.maxChangedFiles,
    maxChangedLines: ceilingRecord.maxChangedLines,
  });

  return Object.freeze({
    schemaVersion: 2,
    baseline,
    evaluator,
    scope: frozenScope,
    protectedInputs,
    ceilings,
  });
}

function snapshotInput(value) {
  const input = exactRecord(
    value,
    "v2 reconstruction input",
    ["repositoryRoot", "contract", "patch"],
    "ERR_RECONSTRUCTION",
  );
  if (
    typeof input.repositoryRoot !== "string" ||
    input.repositoryRoot.length === 0 ||
    input.repositoryRoot.includes("\0")
  ) {
    fail("ERR_RECONSTRUCTION", "repositoryRoot must be a non-empty path");
  }
  const contract = snapshotContract(input.contract);
  const patchProjection = validateCandidatePatchV2(input.patch, contract);
  return Object.freeze({
    repositoryRoot: input.repositoryRoot,
    contract,
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
  const oid = value.trim();
  if (
    value !== `${oid}\n` ||
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

async function requireClean(workspace, gitHome) {
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
  const headerEnd = output.indexOf("\n\n");
  if (headerEnd < 0) {
    fail("ERR_RECONSTRUCTION", `${label} has malformed commit bytes`);
  }
  const header = output.slice(0, headerEnd).split("\n");
  const treeLine = header[0];
  const treeMatch = /^tree ([0-9a-f]+)$/u.exec(treeLine);
  if (treeMatch === null) {
    fail("ERR_RECONSTRUCTION", `${label} has no exact tree header`);
  }
  const tree = validatedCommandOid(
    `${treeMatch[1]}\n`,
    `${label} tree header`,
    oidLength,
  );
  const parents = header
    .filter((line) => line.startsWith("parent "))
    .map((line) =>
      validatedCommandOid(
        `${line.slice("parent ".length)}\n`,
        `${label} parent header`,
        oidLength,
      ),
    );
  return Object.freeze({ tree, parents: Object.freeze(parents) });
}

async function readCommitHeader({ workspace, gitHome, oid, label, oidLength }) {
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

async function requireBoundPhase({ workspace, gitHome, tree, path, expected }) {
  const entry = requireRegularBlob(tree, path, "ERR_BASELINE_STATE");
  if (entry.oid !== expected.objectId) {
    fail("ERR_BASELINE_STATE", `mutable baseline object changed: ${path}`);
  }
  const content = await readBlobByOid({
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
      workspace,
      gitHome,
      tree: baselineTree,
      path: binding.path,
      expected: binding.baseline,
    });
    const evaluatorEntry = await requireBoundPhase({
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
    const content = await readBlobByOid({
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

async function prepareWorkspace(input) {
  const source = await typedOperation("ERR_RECONSTRUCTION", () =>
    realpath(input.repositoryRoot),
  );
  if (source === resolve("/")) {
    fail(
      "ERR_RECONSTRUCTION",
      "repository root may not be the filesystem root",
    );
  }

  let temporaryRoot;
  try {
    temporaryRoot = await typedOperation("ERR_RECONSTRUCTION", () =>
      mkdtemp(join(tmpdir(), temporaryPrefix)),
    );
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
    return Object.freeze({ temporaryRoot, workspace, gitHome });
  } catch (error) {
    if (temporaryRoot !== undefined) await removeTemporaryRoot(temporaryRoot);
    throw error;
  }
}

async function reconstructCandidateV2Once(rawInput) {
  const input = snapshotInput(rawInput);
  const { contract } = input;
  const prepared = await prepareWorkspace(input);
  const { temporaryRoot, workspace, gitHome } = prepared;

  try {
    const oidLength = contract.baseline.tree.length;
    const baselineCommit = await readCommitHeader({
      workspace,
      gitHome,
      oid: contract.baseline.commit,
      label: "baseline commit",
      oidLength,
    });
    const evaluatorCommit = await readCommitHeader({
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

    const baselineTree = await loadTreeV2({
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
    await requireClean(workspace, gitHome);

    const evaluatorPatch = await typedOperation("ERR_RECONSTRUCTION", () =>
      runGitBytes({
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
    const evaluatorTree = await loadTreeV2({
      workspace,
      home: gitHome,
      tree: contract.evaluator.tree,
    });

    await requireMutableBaselines({
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
        stdin: input.patch,
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
    const rawDiff = await diffTreesV2({
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
    const candidateTree = await loadTreeV2({
      workspace,
      home: gitHome,
      tree: candidateTreeOid,
    });
    await requireCandidateTree({
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
    await requireClean(workspace, gitHome);

    const identity = frozenIdentity({
      patchSha256: input.patchSha256,
      commit: candidateCommit,
      tree: candidateTreeOid,
      pathStatuses,
      createdBlobs: input.patchProjection.createdBlobs,
      fullManifest: candidateFull,
      protectedManifest: candidateProtected,
    });
    reconstructionHandles.set(identity, {
      temporaryRoot,
      disposed: false,
    });
    return identity;
  } catch (error) {
    await removeTemporaryRoot(temporaryRoot);
    throw error;
  }
}

export function reconstructCandidateV2(input) {
  return withTaskV2FailureBoundary(() => reconstructCandidateV2Once(input));
}

export function disposeCandidateV2(candidate) {
  return withTaskV2FailureBoundary(async () => {
    const handle = reconstructionHandles.get(candidate);
    if (handle === undefined || handle.disposed) {
      fail("ERR_RECONSTRUCTION", "candidate v2 handle is unknown or disposed");
    }
    handle.disposed = true;
    await removeTemporaryRoot(handle.temporaryRoot);
  });
}
