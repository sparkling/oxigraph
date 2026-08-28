import { createHash } from "node:crypto";

import { validateTaskContractV2 } from "../contract-v2.mjs";
import {
  asciiFoldPathV2,
  validateTaskV2Path,
  validateTaskV2Scope,
} from "../policy/paths-v2.mjs";
import { isTaskV2Failure, taskV2Failure } from "../policy/task-v2-failures.mjs";
import {
  gitObjectOid,
  loadedProductionTreeV2ObjectIdentity,
  projectTreeManifestV2,
  treeEntriesAtAsciiFold,
  treeEntryAtPath,
} from "../candidate/tree-v2.mjs";
import { canonicalJson } from "../routing/features.mjs";
import { taskProfile } from "../task-profile.mjs";

export const TASK_V2_SOURCE_SNAPSHOT_ALGORITHM =
  "sha256-length-framed-path-content-v2";
export const TASK_V2_SOURCE_TOTAL_BYTES_CEILING = 512 * 1024;
export const TASK_V2_SOURCE_FILE_BYTES_CEILING = 256 * 1024;
export const TASK_V2_SOURCE_FILE_COUNT_CEILING = 256;

const PATH_BYTES_CEILING = 4 * 1024;
const PATCH_BYTES_CEILING = 256 * 1024;
const CONTRACT_BYTES_CEILING = 4 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const SOURCE_DIGEST_DOMAIN = Buffer.from(
  "oxigraph.engineering-task-source-snapshot/v2",
  "ascii",
);
const sealedWorkerContexts = new WeakMap();

function fail(detail) {
  throw taskV2Failure("ERR_SOURCE_SNAPSHOT", detail);
}

function mapSourceFailure(error) {
  if (isTaskV2Failure(error) && error.code === "ERR_SOURCE_SNAPSHOT") {
    return error;
  }
  return taskV2Failure("ERR_SOURCE_SNAPSHOT", error);
}

function sourceBoundary(operation) {
  try {
    return operation();
  } catch (error) {
    throw mapSourceFailure(error);
  }
}

async function asyncSourceBoundary(operation) {
  try {
    return await operation();
  } catch (error) {
    throw mapSourceFailure(error);
  }
}

function plainRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain record`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const record = plainRecord(value, label);
  const keys = Reflect.ownKeys(record);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== expected.length ||
    expected.some((key) => !keys.includes(key))
  ) {
    fail(`${label} has unsupported keys`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
  return record;
}

function denseArray(value, label, maximum = TASK_V2_SOURCE_FILE_COUNT_CEILING) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(`${label} must be a bounded array`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    !keys.includes("length") ||
    Array.from({ length: value.length }, (_, index) => String(index)).some(
      (key) => !keys.includes(key),
    )
  ) {
    fail(`${label} must be dense and have no extra properties`);
  }
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      fail(`${label}[${index}] must be an enumerable data property`);
    }
    normalized.push(descriptor.value);
  }
  return normalized;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !HEX64.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireGitOid(value, label, width) {
  if (
    typeof value !== "string" ||
    !GIT_OID.test(value) ||
    /^0+$/u.test(value) ||
    value.length !== width
  ) {
    fail(`${label} must be a full non-zero Git object identifier`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its fixed ceiling`);
  }
  return value;
}

function requireBoundedPath(value, label) {
  if (
    typeof value !== "string" ||
    value.length > PATH_BYTES_CEILING ||
    Buffer.byteLength(value, "utf8") > PATH_BYTES_CEILING
  ) {
    fail(`${label} exceeds its path ceiling`);
  }
  try {
    return validateTaskV2Path(value, label);
  } catch (error) {
    fail(error);
  }
}

function exactUtf8Content(value, label) {
  if (
    typeof value !== "string" ||
    value.length > TASK_V2_SOURCE_FILE_BYTES_CEILING ||
    value.includes("\0")
  ) {
    fail(`${label} must be bounded NUL-free UTF-8 text`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > TASK_V2_SOURCE_FILE_BYTES_CEILING) {
    fail(`${label} exceeds its byte ceiling`);
  }
  let decoded;
  try {
    decoded = UTF8.decode(bytes);
  } catch (error) {
    fail(error);
  }
  if (decoded !== value) fail(`${label} is not exact UTF-8 text`);
  return bytes;
}

function capturedBlobBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail("literal blob reader must return raw bytes");
  }
  const bytes = Buffer.from(value);
  if (bytes.length > TASK_V2_SOURCE_FILE_BYTES_CEILING) {
    fail("literal blob reader exceeded the per-file byte ceiling");
  }
  return bytes;
}

function contractAuthorityFromBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail("contractBytes must contain the exact raw contract bytes");
  }
  const bytes = Buffer.from(value);
  if (bytes.length === 0 || bytes.length > CONTRACT_BYTES_CEILING) {
    fail("contractBytes exceeds its fixed byte ceiling");
  }
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    fail(error);
  }
  if (Buffer.from(text, "utf8").compare(bytes) !== 0 || text.includes("\0")) {
    fail("contractBytes is not exact NUL-free UTF-8");
  }
  let contract;
  try {
    contract = JSON.parse(text);
  } catch (error) {
    fail(error);
  }
  try {
    validateTaskContractV2(contract);
  } catch (error) {
    fail(error);
  }
  deepFreeze(contract);
  return Object.freeze({
    contract,
    contractSha256: sha256(bytes),
    canonicalContractSha256: canonicalSha256(contract),
  });
}

function phaseTreeOid(contract, phase) {
  const value = plainRecord(contract[phase], `contract.${phase}`).tree;
  if (
    typeof value !== "string" ||
    !GIT_OID.test(value) ||
    /^0+$/u.test(value)
  ) {
    fail(
      `contract.${phase}.tree must be a full non-zero Git object identifier`,
    );
  }
  return value;
}

function normalizePresentIdentity(value, label, oidWidth) {
  exactKeys(
    value,
    ["state", "mode", "type", "objectId", "contentSha256"],
    label,
  );
  if (
    value.state !== "present" ||
    value.mode !== "100644" ||
    value.type !== "blob"
  ) {
    fail(`${label} must bind a present regular 100644 blob`);
  }
  return Object.freeze({
    state: "present",
    mode: "100644",
    type: "blob",
    objectId: requireGitOid(value.objectId, `${label}.objectId`, oidWidth),
    contentSha256: requireDigest(value.contentSha256, `${label}.contentSha256`),
  });
}

function normalizeAbsentIdentity(value, label) {
  exactKeys(value, ["state"], label);
  if (value.state !== "absent") fail(`${label} must be explicitly absent`);
  return Object.freeze({ state: "absent" });
}

function samePresentIdentity(left, right) {
  return (
    left.state === right.state &&
    left.mode === right.mode &&
    left.type === right.type &&
    left.objectId === right.objectId &&
    left.contentSha256 === right.contentSha256
  );
}

function normalizeMutableBaselines(contract, scope, oidWidth) {
  const protectedInputs = plainRecord(
    contract.protectedInputs,
    "contract.protectedInputs",
  );
  const values = denseArray(
    protectedInputs.mutableBaselines,
    "contract.protectedInputs.mutableBaselines",
    32,
  );
  if (values.length !== scope.mutableExact.length) {
    fail("mutableBaselines must bind every mutableExact path exactly once");
  }
  const createSet = new Set(scope.createExact);
  return Object.freeze(
    values.map((value, index) => {
      const label = `contract.protectedInputs.mutableBaselines[${index}]`;
      exactKeys(value, ["path", "state", "baseline", "evaluator"], label);
      const path = requireBoundedPath(value.path, `${label}.path`);
      if (path !== scope.mutableExact[index]) {
        fail("mutableBaselines order must equal mutableExact byte for byte");
      }
      const expectedState = createSet.has(path) ? "absent" : "present";
      if (value.state !== expectedState) {
        fail("mutable baseline state disagrees with createExact");
      }
      if (expectedState === "absent") {
        return Object.freeze({
          path,
          state: "absent",
          baseline: normalizeAbsentIdentity(
            value.baseline,
            `${label}.baseline`,
          ),
          evaluator: normalizeAbsentIdentity(
            value.evaluator,
            `${label}.evaluator`,
          ),
        });
      }
      const baseline = normalizePresentIdentity(
        value.baseline,
        `${label}.baseline`,
        oidWidth,
      );
      const evaluator = normalizePresentIdentity(
        value.evaluator,
        `${label}.evaluator`,
        oidWidth,
      );
      if (!samePresentIdentity(baseline, evaluator)) {
        fail("present baseline and evaluator identities must be equal");
      }
      return Object.freeze({
        path,
        state: "present",
        baseline,
        evaluator,
      });
    }),
  );
}

function normalizeContractAuthority(
  contractBytes,
  evaluatorTree,
  resolveEvaluatorTreeObjectIdentity,
) {
  const contractAuthority = contractAuthorityFromBytes(contractBytes);
  const { contract, contractSha256 } = contractAuthority;
  let scope;
  try {
    scope = validateTaskV2Scope(contract);
  } catch (error) {
    fail(error);
  }
  for (const path of scope.mutableExact) {
    requireBoundedPath(path, "scope.mutableExact path");
  }

  // A lookup proves this is a tree map produced by the v2 parser, even when
  // the first mutable path is intentionally absent.
  try {
    treeEntryAtPath(evaluatorTree, scope.mutableExact[0]);
  } catch (error) {
    fail(error);
  }
  if (!new Set(["sha1", "sha256"]).has(evaluatorTree.objectFormat)) {
    fail("evaluator tree must bind one supported Git object format");
  }
  const oidWidth = evaluatorTree.objectFormat === "sha1" ? 40 : 64;
  const baselineTree = phaseTreeOid(contract, "baseline");
  const evaluatorTreeOid = phaseTreeOid(contract, "evaluator");
  if (
    baselineTree.length !== oidWidth ||
    evaluatorTreeOid.length !== oidWidth
  ) {
    fail("contract trees disagree with the parsed evaluator object format");
  }
  if (typeof resolveEvaluatorTreeObjectIdentity !== "function") {
    fail("evaluator tree identity resolver must be callable");
  }
  let loadedEvaluatorTreeOid;
  try {
    loadedEvaluatorTreeOid = resolveEvaluatorTreeObjectIdentity(
      evaluatorTree,
      contract,
    );
  } catch (error) {
    fail(error);
  }
  if (
    requireGitOid(
      loadedEvaluatorTreeOid,
      "loaded evaluator tree object identity",
      oidWidth,
    ) !== evaluatorTreeOid
  ) {
    fail("parsed evaluator tree does not name the contract evaluator tree");
  }
  const mutableBaselines = normalizeMutableBaselines(contract, scope, oidWidth);
  const maxPatchBytes = requireSafeInteger(
    plainRecord(contract.ceilings, "contract.ceilings").maxPatchBytes,
    "contract.ceilings.maxPatchBytes",
    1,
    PATCH_BYTES_CEILING,
  );
  const presentPaths = mutableBaselines
    .filter(({ state }) => state === "present")
    .map(({ path }) => path);
  let fullManifest;
  let protectedManifest;
  try {
    fullManifest = projectTreeManifestV2(evaluatorTree);
    protectedManifest = projectTreeManifestV2(evaluatorTree, {
      exclude: presentPaths,
    });
  } catch (error) {
    fail(error);
  }
  const expectedManifest = plainRecord(
    plainRecord(contract.protectedInputs, "contract.protectedInputs")
      .evaluatorManifest,
    "contract.protectedInputs.evaluatorManifest",
  );
  if (
    fullManifest.entries !== expectedManifest.entries ||
    fullManifest.sha256 !== expectedManifest.fullSha256 ||
    protectedManifest.entries !== expectedManifest.protectedEntries ||
    protectedManifest.sha256 !== expectedManifest.protectedSha256
  ) {
    fail("evaluator tree does not bind the contract evaluator manifest");
  }
  return Object.freeze({
    contract,
    contractSha256,
    canonicalContractSha256: contractAuthority.canonicalContractSha256,
    evaluatorTree,
    objectFormat: evaluatorTree.objectFormat,
    scope,
    mutableBaselines,
    mutableByPath: new Map(
      mutableBaselines.map((entry) => [entry.path, entry]),
    ),
    maxPatchBytes,
  });
}

function normalizeSourceAllowlist(value, scope) {
  const source = denseArray(value, "sourceAllowlist");
  if (source.length === 0) fail("sourceAllowlist must not be empty");
  const paths = [];
  const exact = new Set();
  const folded = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const path = requireBoundedPath(source[index], `sourceAllowlist[${index}]`);
    const foldedPath = asciiFoldPathV2(path);
    if (exact.has(path)) fail("sourceAllowlist contains an exact duplicate");
    if (folded.has(foldedPath)) {
      fail("sourceAllowlist contains a portable case collision");
    }
    exact.add(path);
    folded.add(foldedPath);
    paths.push(path);
  }
  for (const path of scope.mutableExact) {
    if (!exact.has(path)) {
      fail("sourceAllowlist must contain every exact mutable path");
    }
  }
  return Object.freeze(paths);
}

function requireExactFoldedTreeEntry(tree, path, expected) {
  let entry;
  let folded;
  try {
    entry = treeEntryAtPath(tree, path);
    folded = treeEntriesAtAsciiFold(tree, path);
  } catch (error) {
    fail(error);
  }
  if (expected === "absent") {
    if (entry !== undefined || folded.length !== 0) {
      fail("declared absent source path exists or has a case collision");
    }
    return undefined;
  }
  if (
    entry === undefined ||
    folded.length !== 1 ||
    folded[0].pathHex !== entry.pathHex
  ) {
    fail("present source path is missing or has a case collision");
  }
  if (entry.mode !== "100644" || entry.type !== "blob") {
    fail("present source path must resolve to a regular 100644 blob");
  }
  return entry;
}

function requireExactParentTrees(tree, path) {
  const components = path.split("/");
  for (let length = 1; length < components.length; length += 1) {
    const parent = components.slice(0, length).join("/");
    let entry;
    let folded;
    try {
      entry = treeEntryAtPath(tree, parent);
      folded = treeEntriesAtAsciiFold(tree, parent);
    } catch (error) {
      fail(error);
    }
    if (
      entry === undefined ||
      entry.mode !== "040000" ||
      entry.type !== "tree" ||
      folded.length !== 1 ||
      folded[0].pathHex !== entry.pathHex
    ) {
      fail("source path requires exact existing regular parent trees");
    }
  }
}

function requireCreationParentsAndNoDescendants(tree, path) {
  requireExactParentTrees(tree, path);

  const exactPrefix = Buffer.from(`${path}/`, "ascii");
  const foldedPrefix = Buffer.from(`${asciiFoldPathV2(path)}/`, "ascii");
  for (const entry of tree.entries) {
    const entryPath = entry.path;
    const foldedPath = Buffer.from(entry.foldedPathHex, "hex");
    if (
      entryPath.subarray(0, exactPrefix.length).equals(exactPrefix) ||
      foldedPath.subarray(0, foldedPrefix.length).equals(foldedPrefix)
    ) {
      fail("creation path may not be the ancestor of an existing object");
    }
  }
}

function sourceTreeEntries(authority, sourceAllowlist) {
  const createSet = new Set(authority.scope.createExact);
  const entries = new Map();
  for (const path of authority.scope.createExact) {
    requireExactFoldedTreeEntry(authority.evaluatorTree, path, "absent");
    requireCreationParentsAndNoDescendants(authority.evaluatorTree, path);
  }
  for (const path of sourceAllowlist) {
    if (createSet.has(path)) continue;
    requireExactParentTrees(authority.evaluatorTree, path);
    const entry = requireExactFoldedTreeEntry(
      authority.evaluatorTree,
      path,
      "present",
    );
    const mutable = authority.mutableByPath.get(path);
    if (
      mutable?.state === "present" &&
      (entry.oid !== mutable.evaluator.objectId ||
        entry.mode !== mutable.evaluator.mode ||
        entry.type !== mutable.evaluator.type)
    ) {
      fail("present mutable source differs from its evaluator identity");
    }
    entries.set(path, entry);
  }
  return entries;
}

function appendFrame(digest, bytes) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  digest.update(length).update(bytes);
}

function sourceDigest(contractSha256, files) {
  const digest = createHash("sha256");
  appendFrame(digest, SOURCE_DIGEST_DOMAIN);
  appendFrame(digest, Buffer.from(contractSha256, "ascii"));
  for (const file of files) {
    appendFrame(digest, Buffer.from(file.path, "ascii"));
    appendFrame(digest, Buffer.from(file.content, "utf8"));
  }
  return digest.digest("hex");
}

function verifiedSourceFile(authority, path, entry, contentBytes) {
  if (
    gitObjectOid(contentBytes, {
      algorithm: authority.objectFormat,
      type: "blob",
    }) !== entry.oid
  ) {
    fail("literal blob bytes do not match the evaluator tree object identity");
  }
  const contentSha256 = sha256(contentBytes);
  const mutable = authority.mutableByPath.get(path);
  if (
    mutable?.state === "present" &&
    (contentSha256 !== mutable.evaluator.contentSha256 ||
      contentSha256 !== mutable.baseline.contentSha256)
  ) {
    fail("present mutable content differs from its independently bound digest");
  }
  let content;
  try {
    content = UTF8.decode(contentBytes);
  } catch (error) {
    fail(error);
  }
  if (
    Buffer.from(content, "utf8").compare(contentBytes) !== 0 ||
    content.includes("\0")
  ) {
    fail("source blob is not exact NUL-free UTF-8 text");
  }
  return Object.freeze({
    path,
    bytes: contentBytes.length,
    sha256: contentSha256,
    content,
  });
}

async function createSourceSnapshotCore(
  authority,
  sourceAllowlist,
  readBlobByOid,
) {
  if (typeof readBlobByOid !== "function") {
    fail("readBlobByOid must be a literal blob-reader function");
  }
  const entries = sourceTreeEntries(authority, sourceAllowlist);
  const files = [];
  let totalBytes = 0;
  for (const path of sourceAllowlist) {
    const entry = entries.get(path);
    if (entry === undefined) continue;
    let output;
    try {
      output = await readBlobByOid(
        Object.freeze({
          oid: entry.oid,
          maxOutputBytes: TASK_V2_SOURCE_FILE_BYTES_CEILING,
        }),
      );
    } catch (error) {
      fail(error);
    }
    const bytes = capturedBlobBytes(output);
    totalBytes += bytes.length;
    if (totalBytes > TASK_V2_SOURCE_TOTAL_BYTES_CEILING) {
      fail("source snapshot exceeds its total byte ceiling");
    }
    files.push(verifiedSourceFile(authority, path, entry, bytes));
  }
  return deepFreeze({
    schemaVersion: 2,
    algorithm: TASK_V2_SOURCE_SNAPSHOT_ALGORITHM,
    contractSha256: authority.contractSha256,
    totalBytes,
    sha256: sourceDigest(authority.contractSha256, files),
    files,
  });
}

function normalizeCachedFile(authority, path, entry, value, index) {
  const label = `sourceSnapshot.files[${index}]`;
  exactKeys(value, ["path", "bytes", "sha256", "content"], label);
  if (value.path !== path) fail("source snapshot file order/path drifted");
  const contentBytes = exactUtf8Content(value.content, `${label}.content`);
  requireSafeInteger(
    value.bytes,
    `${label}.bytes`,
    0,
    TASK_V2_SOURCE_FILE_BYTES_CEILING,
  );
  requireDigest(value.sha256, `${label}.sha256`);
  if (
    value.bytes !== contentBytes.length ||
    value.sha256 !== sha256(contentBytes)
  ) {
    fail("cached source file content binding drifted");
  }
  return verifiedSourceFile(authority, path, entry, contentBytes);
}

function validateSourceSnapshotCore(authority, sourceAllowlist, snapshot) {
  exactKeys(
    snapshot,
    [
      "schemaVersion",
      "algorithm",
      "contractSha256",
      "totalBytes",
      "sha256",
      "files",
    ],
    "sourceSnapshot",
  );
  if (
    snapshot.schemaVersion !== 2 ||
    snapshot.algorithm !== TASK_V2_SOURCE_SNAPSHOT_ALGORITHM ||
    snapshot.contractSha256 !== authority.contractSha256
  ) {
    fail("cached source snapshot schema or contract binding drifted");
  }
  requireDigest(snapshot.sha256, "sourceSnapshot.sha256");
  requireSafeInteger(
    snapshot.totalBytes,
    "sourceSnapshot.totalBytes",
    0,
    TASK_V2_SOURCE_TOTAL_BYTES_CEILING,
  );
  const entries = sourceTreeEntries(authority, sourceAllowlist);
  const expectedPaths = sourceAllowlist.filter((path) => entries.has(path));
  const values = denseArray(snapshot.files, "sourceSnapshot.files");
  if (values.length !== expectedPaths.length) {
    fail("cached source snapshot must omit exactly the absent creation paths");
  }
  const files = values.map((value, index) =>
    normalizeCachedFile(
      authority,
      expectedPaths[index],
      entries.get(expectedPaths[index]),
      value,
      index,
    ),
  );
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  if (
    totalBytes !== snapshot.totalBytes ||
    sourceDigest(authority.contractSha256, files) !== snapshot.sha256
  ) {
    fail("cached source snapshot aggregate binding drifted");
  }
  return deepFreeze({
    schemaVersion: 2,
    algorithm: TASK_V2_SOURCE_SNAPSHOT_ALGORITHM,
    contractSha256: authority.contractSha256,
    totalBytes,
    sha256: snapshot.sha256,
    files,
  });
}

function deriveCreationInstructions(authority) {
  return deepFreeze(
    authority.scope.createExact.map((path) => ({
      path,
      baselineState: "absent",
      requiredStatus: "A",
      finalMode: "100644",
      finalType: "blob",
      maxPatchBytes: authority.maxPatchBytes,
    })),
  );
}

function taskContextProjection(snapshot, creationInstructions) {
  return deepFreeze({
    schemaVersion: 2,
    bindings: {
      taskSchemaVersion: 2,
      sourceSnapshotSha256: snapshot.sha256,
      creationInstructionsSha256: canonicalSha256(creationInstructions),
    },
    sourceSnapshot: snapshot,
    creationInstructions,
  });
}

function sealWorkerContext(context, authority, sourceAllowlist, sealStore) {
  const taskJson = JSON.stringify(context);
  sealStore.set(
    context,
    Object.freeze({
      contractSha256: authority.contractSha256,
      canonicalContractSha256: authority.canonicalContractSha256,
      sourceAllowlistSha256: canonicalSha256(sourceAllowlist),
      sourceSnapshotSha256: context.sourceSnapshot.sha256,
      creationInstructionsSha256: context.bindings.creationInstructionsSha256,
      taskJson,
      taskSha256: sha256(Buffer.from(taskJson, "utf8")),
    }),
  );
  return context;
}

function creationInstructionsFromCache(value, expected) {
  const values = denseArray(value, "creationInstructions", 32);
  if (values.length !== expected.length) {
    fail("cached creation instructions changed exact authority");
  }
  const instructionKeys = [
    "path",
    "baselineState",
    "requiredStatus",
    "finalMode",
    "finalType",
    "maxPatchBytes",
  ];
  for (let index = 0; index < values.length; index += 1) {
    const instruction = values[index];
    exactKeys(instruction, instructionKeys, `creationInstructions[${index}]`);
    for (const key of instructionKeys) {
      if (instruction[key] !== expected[index][key]) {
        fail("cached creation instructions changed exact authority");
      }
    }
  }
  return expected;
}

function registeredSourceAllowlist(authority) {
  try {
    const profile = taskProfile(authority.contract);
    if (
      profile.taskSchemaVersion !== 2 ||
      profile.contractRawSha256 !== authority.contractSha256
    ) {
      fail(
        "registered task profile does not bind this exact schema-v2 contract",
      );
    }
    return profile.sourceAllowlist;
  } catch (error) {
    fail(error);
  }
}

function resolvedSourceAllowlist(authority, resolveSourceAllowlist) {
  if (typeof resolveSourceAllowlist !== "function") {
    fail("source allowlist resolver must be callable");
  }
  let value;
  try {
    value = resolveSourceAllowlist(authority);
  } catch (error) {
    fail(error);
  }
  return normalizeSourceAllowlist(value, authority.scope);
}

function normalizeCreationInput(
  input,
  label,
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
) {
  exactKeys(input, ["contractBytes", "evaluatorTree", "readBlobByOid"], label);
  const authority = normalizeContractAuthority(
    input.contractBytes,
    input.evaluatorTree,
    resolveEvaluatorTreeObjectIdentity,
  );
  const sourceAllowlist = resolvedSourceAllowlist(
    authority,
    resolveSourceAllowlist,
  );
  return { authority, sourceAllowlist, readBlobByOid: input.readBlobByOid };
}

function normalizeValidationInput(
  input,
  valueKey,
  label,
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
) {
  exactKeys(input, [valueKey, "contractBytes", "evaluatorTree"], label);
  const authority = normalizeContractAuthority(
    input.contractBytes,
    input.evaluatorTree,
    resolveEvaluatorTreeObjectIdentity,
  );
  const sourceAllowlist = resolvedSourceAllowlist(
    authority,
    resolveSourceAllowlist,
  );
  return { authority, sourceAllowlist, value: input[valueKey] };
}

async function createTaskV2SourceSnapshotWithResolver(
  input,
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
) {
  return asyncSourceBoundary(async () => {
    const normalized = normalizeCreationInput(
      input,
      "source snapshot input",
      resolveSourceAllowlist,
      resolveEvaluatorTreeObjectIdentity,
    );
    return createSourceSnapshotCore(
      normalized.authority,
      normalized.sourceAllowlist,
      normalized.readBlobByOid,
    );
  });
}

function validateCachedTaskV2SourceSnapshotWithResolver(
  input,
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
) {
  return sourceBoundary(() => {
    const normalized = normalizeValidationInput(
      input,
      "snapshot",
      "cached source snapshot input",
      resolveSourceAllowlist,
      resolveEvaluatorTreeObjectIdentity,
    );
    return validateSourceSnapshotCore(
      normalized.authority,
      normalized.sourceAllowlist,
      normalized.value,
    );
  });
}

async function createTaskV2ContextWithResolver(
  input,
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
  sealStore,
) {
  return asyncSourceBoundary(async () => {
    const normalized = normalizeCreationInput(
      input,
      "task context input",
      resolveSourceAllowlist,
      resolveEvaluatorTreeObjectIdentity,
    );
    const snapshot = await createSourceSnapshotCore(
      normalized.authority,
      normalized.sourceAllowlist,
      normalized.readBlobByOid,
    );
    return sealWorkerContext(
      taskContextProjection(
        snapshot,
        deriveCreationInstructions(normalized.authority),
      ),
      normalized.authority,
      normalized.sourceAllowlist,
      sealStore,
    );
  });
}

function validateCachedTaskV2ContextWithResolver(
  input,
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
  sealStore,
) {
  return sourceBoundary(() => {
    const normalized = normalizeValidationInput(
      input,
      "context",
      "cached task context input",
      resolveSourceAllowlist,
      resolveEvaluatorTreeObjectIdentity,
    );
    exactKeys(
      normalized.value,
      ["schemaVersion", "bindings", "sourceSnapshot", "creationInstructions"],
      "taskContext",
    );
    if (normalized.value.schemaVersion !== 2) {
      fail("cached task context changed its task schema version");
    }
    const snapshot = validateSourceSnapshotCore(
      normalized.authority,
      normalized.sourceAllowlist,
      normalized.value.sourceSnapshot,
    );
    const expectedInstructions = deriveCreationInstructions(
      normalized.authority,
    );
    const creationInstructions = creationInstructionsFromCache(
      normalized.value.creationInstructions,
      expectedInstructions,
    );
    exactKeys(
      normalized.value.bindings,
      [
        "taskSchemaVersion",
        "sourceSnapshotSha256",
        "creationInstructionsSha256",
      ],
      "taskContext.bindings",
    );
    const expectedInstructionSha256 = canonicalSha256(creationInstructions);
    if (
      normalized.value.bindings.taskSchemaVersion !== 2 ||
      normalized.value.bindings.sourceSnapshotSha256 !== snapshot.sha256 ||
      normalized.value.bindings.creationInstructionsSha256 !==
        expectedInstructionSha256
    ) {
      fail("cached task context binding drifted");
    }
    return sealWorkerContext(
      taskContextProjection(snapshot, creationInstructions),
      normalized.authority,
      normalized.sourceAllowlist,
      sealStore,
    );
  });
}

export function createTaskV2SourceSnapshot(input) {
  return createTaskV2SourceSnapshotWithResolver(
    input,
    registeredSourceAllowlist,
    loadedProductionTreeV2ObjectIdentity,
  );
}

export function validateCachedTaskV2SourceSnapshot(input) {
  return validateCachedTaskV2SourceSnapshotWithResolver(
    input,
    registeredSourceAllowlist,
    loadedProductionTreeV2ObjectIdentity,
  );
}

export function createTaskV2Context(input) {
  return createTaskV2ContextWithResolver(
    input,
    registeredSourceAllowlist,
    loadedProductionTreeV2ObjectIdentity,
    sealedWorkerContexts,
  );
}

export function validateCachedTaskV2Context(input) {
  return validateCachedTaskV2ContextWithResolver(
    input,
    registeredSourceAllowlist,
    loadedProductionTreeV2ObjectIdentity,
    sealedWorkerContexts,
  );
}

/** Explicitly test-only source-profile resolver injection. */
export function createTaskV2ContextControllerForTesting(
  resolveSourceAllowlist,
  resolveEvaluatorTreeObjectIdentity,
) {
  if (
    typeof resolveSourceAllowlist !== "function" ||
    typeof resolveEvaluatorTreeObjectIdentity !== "function"
  ) {
    throw new TypeError("test authority resolvers must be callable");
  }
  const testSeals = new WeakMap();
  const sourceResolver = (authority) =>
    resolveSourceAllowlist(authority.contract);
  const assertTestSeal = (input) =>
    assertSealedTaskV2WorkerContextFromStore(input, testSeals);
  return Object.freeze({
    createTaskV2SourceSnapshot: (input) =>
      createTaskV2SourceSnapshotWithResolver(
        input,
        sourceResolver,
        resolveEvaluatorTreeObjectIdentity,
      ),
    validateCachedTaskV2SourceSnapshot: (input) =>
      validateCachedTaskV2SourceSnapshotWithResolver(
        input,
        sourceResolver,
        resolveEvaluatorTreeObjectIdentity,
      ),
    createTaskV2Context: (input) =>
      createTaskV2ContextWithResolver(
        input,
        sourceResolver,
        resolveEvaluatorTreeObjectIdentity,
        testSeals,
      ),
    validateCachedTaskV2Context: (input) =>
      validateCachedTaskV2ContextWithResolver(
        input,
        sourceResolver,
        resolveEvaluatorTreeObjectIdentity,
        testSeals,
      ),
    assertSealedTaskV2WorkerContext: assertTestSeal,
  });
}

function assertSealedTaskV2WorkerContextFromStore(input, sealStore) {
  return sourceBoundary(() => {
    exactKeys(input, ["context", "contractBytes"], "worker context assertion");
    const contractAuthority = contractAuthorityFromBytes(input.contractBytes);
    const context = input.context;
    const seal = sealStore.get(context);
    const taskJson = seal === undefined ? null : JSON.stringify(context);
    if (
      seal === undefined ||
      seal.contractSha256 !== contractAuthority.contractSha256 ||
      seal.canonicalContractSha256 !==
        contractAuthority.canonicalContractSha256 ||
      seal.sourceSnapshotSha256 !== context?.sourceSnapshot?.sha256 ||
      seal.creationInstructionsSha256 !==
        context?.bindings?.creationInstructionsSha256 ||
      taskJson !== seal.taskJson ||
      sha256(Buffer.from(taskJson, "utf8")) !== seal.taskSha256
    ) {
      fail("worker context was not fully validated for these contract bytes");
    }
    return Object.freeze({
      context,
      contract: contractAuthority.contract,
      contractSha256: contractAuthority.contractSha256,
      taskBytes: Buffer.from(seal.taskJson, "utf8"),
      taskSha256: seal.taskSha256,
    });
  });
}

export function assertSealedTaskV2WorkerContext(input) {
  return assertSealedTaskV2WorkerContextFromStore(input, sealedWorkerContexts);
}

export const createTaskSourceSnapshotV2 = createTaskV2SourceSnapshot;
export const createTaskContextV2 = createTaskV2Context;
