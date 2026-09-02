import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { validateCandidatePatch, validateCandidatePath } from "./paths.mjs";
import {
  isTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "./task-v2-failures.mjs";

const ASCII_SEGMENT = "[A-Za-z0-9_][A-Za-z0-9._-]*";
const TASK_V2_PATH = new RegExp(
  `^${ASCII_SEGMENT}(?:/${ASCII_SEGMENT})*$`,
  "u",
);
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_CANONICAL_DECIMAL = /^[1-9][0-9]*$/u;
const MODIFICATION_HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u;
const MAX_HUNK_INTEGER = 2_147_483_647;
const MAX_SCOPE_PATHS = 32;
const DEFAULT_MAX_PATCH_BYTES = 262_144;
const DEFAULT_MAX_CHANGED_FILES = 16;
const DEFAULT_MAX_CHANGED_LINES = 4_096;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function fail(code, detail) {
  throw taskV2Failure(code, detail);
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function plainOwnDataSnapshot(value, label) {
  let descriptors;
  try {
    if (utilTypes.isProxy(value) || !plainObject(value)) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} must be a plain own-data record`,
      );
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", error);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    )
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must contain only enumerable own data properties`,
    );
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function exactUtf8Bytes(value, label, code = "ERR_PATCH_CANONICAL") {
  if (typeof value !== "string") fail(code, `${label} is not a string`);
  const bytes = Buffer.from(value, "utf8");
  let decoded;
  try {
    decoded = UTF8.decode(bytes);
  } catch (error) {
    fail(code, `${label} is not UTF-8: ${error}`);
  }
  if (decoded !== value) fail(code, `${label} is not exact UTF-8 text`);
  return bytes;
}

export function validateTaskV2Path(path, label = "path") {
  if (typeof path !== "string" || !TASK_V2_PATH.test(path)) {
    fail("ERR_PATH_INVALID", `${label} is not an ASCII-safe repository path`);
  }
  return path;
}

function foldAsciiUnchecked(path) {
  let folded = "";
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    folded +=
      code >= 0x41 && code <= 0x5a
        ? String.fromCharCode(code + 0x20)
        : path[index];
  }
  return folded;
}

export function asciiFoldPathV2(path) {
  return foldAsciiUnchecked(validateTaskV2Path(path));
}

function componentRelated(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function strictDescendant(path, prefix) {
  return path.startsWith(`${prefix}/`);
}

function frozenPathList(value, label, maximum = MAX_SCOPE_PATHS) {
  const values = exactOwnDataArray(value, label, maximum);
  const paths = [];
  for (let index = 0; index < values.length; index += 1) {
    paths.push(validateTaskV2Path(values[index], `${label}[${index}]`));
  }
  return Object.freeze(paths);
}

function rejectListRelations(paths, label) {
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < paths.length;
      rightIndex += 1
    ) {
      const left = paths[leftIndex];
      const right = paths[rightIndex];
      if (componentRelated(left, right)) {
        fail(
          "ERR_PATH_OVERLAP",
          `${label} has an exact duplicate or component overlap`,
        );
      }
      if (
        componentRelated(foldAsciiUnchecked(left), foldAsciiUnchecked(right))
      ) {
        fail("ERR_PATH_COLLISION", `${label} has a portable case collision`);
      }
    }
  }
}

function requireCanonicalByteOrder(paths, label) {
  for (let index = 1; index < paths.length; index += 1) {
    if (
      Buffer.compare(
        Buffer.from(paths[index - 1], "ascii"),
        Buffer.from(paths[index], "ascii"),
      ) >= 0
    ) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} must use canonical byte order`,
      );
    }
  }
}

function rejectCrossRelations(leftPaths, rightPaths, label) {
  for (const left of leftPaths) {
    for (const right of rightPaths) {
      if (componentRelated(left, right)) {
        fail("ERR_PATH_OVERLAP", `${label} has an exact component overlap`);
      }
      if (
        componentRelated(foldAsciiUnchecked(left), foldAsciiUnchecked(right))
      ) {
        fail("ERR_PATH_COLLISION", `${label} has a portable case collision`);
      }
    }
  }
}

function snapshotScopeInput(scopeOrContract) {
  const input = plainOwnDataSnapshot(scopeOrContract, "v2 scope input");
  const scope = Object.hasOwn(input, "scope")
    ? plainOwnDataSnapshot(input.scope, "v2 scope")
    : input;
  let evaluatorPath = input.evaluatorPath;
  if (
    (evaluatorPath === undefined || evaluatorPath === null) &&
    Object.hasOwn(input, "evaluator")
  ) {
    const evaluator = plainOwnDataSnapshot(input.evaluator, "v2 evaluator");
    evaluatorPath = evaluator.path;
  }
  if (evaluatorPath !== undefined && evaluatorPath !== null) {
    validateTaskV2Path(evaluatorPath, "evaluator.path");
  } else {
    evaluatorPath = undefined;
  }
  return Object.freeze({ scope, evaluatorPath });
}

function v1ContractFor(scope, projected, evaluatorPath) {
  const blockedExact = Object.hasOwn(scope, "blockedExact")
    ? frozenPathList(scope.blockedExact, "scope.blockedExact", 256)
    : Object.freeze([]);
  const blockedPrefixes = Object.hasOwn(scope, "blockedPrefixes")
    ? frozenPathList(scope.blockedPrefixes, "scope.blockedPrefixes", 256)
    : Object.freeze([]);
  const contract = {
    scope: Object.freeze({
      mutableExact: projected.mutableExact,
      mutablePrefixes: projected.mutablePrefixes,
      blockedExact,
      blockedPrefixes,
      allowCreate: projected.allowCreate,
    }),
  };
  if (evaluatorPath !== undefined) contract.evaluatorPath = evaluatorPath;
  return Object.freeze(contract);
}

function validateLegacyProtection(path, contract) {
  try {
    const validated = validateCandidatePath(path, contract);
    if (validated !== path) {
      fail("ERR_PATH_INVALID", "v1 protection lookup changed a v2 path");
    }
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_PATH_COLLISION", error);
  }
}

function validateTaskV2ScopeInternal(scopeOrContract) {
  const captured = snapshotScopeInput(scopeOrContract);
  const { scope } = captured;
  const mutableExact = frozenPathList(scope.mutableExact, "scope.mutableExact");
  const createExact = frozenPathList(scope.createExact, "scope.createExact");
  const mutablePrefixes = frozenPathList(
    scope.mutablePrefixes,
    "scope.mutablePrefixes",
  );

  if (mutableExact.length === 0) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "scope.mutableExact must not be empty");
  }
  rejectListRelations(mutableExact, "scope.mutableExact");
  rejectListRelations(createExact, "scope.createExact");
  rejectListRelations(mutablePrefixes, "scope.mutablePrefixes");
  requireCanonicalByteOrder(mutableExact, "scope.mutableExact");
  requireCanonicalByteOrder(createExact, "scope.createExact");

  let previousMutableIndex = -1;
  for (let index = 0; index < createExact.length; index += 1) {
    const path = createExact[index];
    const mutableIndex = mutableExact.indexOf(path);
    if (mutableIndex < 0) {
      const folded = foldAsciiUnchecked(path);
      if (mutableExact.some((candidate) => componentRelated(candidate, path))) {
        fail(
          "ERR_PATH_OVERLAP",
          "scope.createExact overlaps mutableExact without an exact match",
        );
      }
      if (
        mutableExact.some((candidate) =>
          componentRelated(foldAsciiUnchecked(candidate), folded),
        )
      ) {
        fail(
          "ERR_PATH_COLLISION",
          "scope.createExact must match mutableExact byte for byte",
        );
      }
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        "scope.createExact must be a subset of scope.mutableExact",
      );
    }
    if (mutableIndex <= previousMutableIndex) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        "scope.createExact must preserve scope.mutableExact order",
      );
    }
    previousMutableIndex = mutableIndex;
  }

  const allowCreate = createExact.length > 0;
  if (
    Object.hasOwn(scope, "allowCreate") &&
    scope.allowCreate !== allowCreate
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "scope.allowCreate disagrees with scope.createExact",
    );
  }
  if (allowCreate && mutablePrefixes.length !== 0) {
    fail(
      "ERR_PATH_OVERLAP",
      "creation contracts require an empty mutablePrefixes list",
    );
  }
  if (mutablePrefixes.length > 0) {
    rejectCrossRelations(
      mutableExact,
      mutablePrefixes,
      "scope exact and prefix paths",
    );
  }

  const legacyContract = v1ContractFor(
    scope,
    { mutableExact, mutablePrefixes, allowCreate },
    captured.evaluatorPath,
  );
  for (const path of [...mutableExact, ...mutablePrefixes]) {
    validateLegacyProtection(path, legacyContract);
  }

  return Object.freeze({
    mutableExact,
    createExact,
    mutablePrefixes,
    allowCreate,
  });
}

export function validateTaskV2Scope(scopeOrContract) {
  return withTaskV2FailureBoundary(() =>
    validateTaskV2ScopeInternal(scopeOrContract),
  );
}

function contentBytes(value) {
  if (typeof value === "string") return exactUtf8Bytes(value, "blob content");
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  fail("ERR_PATCH_CANONICAL", "blob content must be bytes or UTF-8 text");
}

function validateObjectFormat(objectFormat) {
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "Git object format must be sha1 or sha256",
    );
  }
  return objectFormat;
}

export function gitBlobObjectIdV2(content, objectFormat) {
  const format = validateObjectFormat(objectFormat);
  const bytes = contentBytes(content);
  const header = Buffer.from(`blob ${bytes.length}\0`, "ascii");
  return createHash(format).update(header).update(bytes).digest("hex");
}

function contractObjectFormat(contract, options) {
  if (options !== undefined) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "Git object format may not be overridden by the caller",
    );
  }
  const baselineTree = contract?.baseline?.tree;
  const evaluatorTree = contract?.evaluator?.tree;
  for (const [label, oid] of [
    ["baseline tree", baselineTree],
    ["evaluator tree", evaluatorTree],
  ]) {
    if (
      typeof oid !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid) ||
      /^0+$/u.test(oid)
    ) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} must bind a full non-zero Git object identifier`,
      );
    }
  }
  if (baselineTree.length !== evaluatorTree.length) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "baseline and evaluator trees use different Git object formats",
    );
  }
  return baselineTree.length === 40 ? "sha1" : "sha256";
}

function exactOwnDataArray(value, label, maximum = MAX_SCOPE_PATHS) {
  let descriptors;
  try {
    if (
      utilTypes.isProxy(value) ||
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} must be a bounded plain dense array`,
      );
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", error);
  }

  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must be a bounded plain dense array`,
    );
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
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must be a bounded plain dense array`,
    );
  }

  const captured = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label}[${index}] must be an enumerable own data property`,
      );
    }
    captured.push(descriptor.value);
  }
  return captured;
}

function exactOwnDataRecord(value, label, expectedKeys) {
  let descriptors;
  try {
    if (!plainObject(value)) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} must be a plain own-data record`,
      );
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", error);
  }

  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    )
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} keys must be exact enumerable own data properties`,
    );
  }
  return Object.fromEntries(
    expectedKeys.map((key) => [key, descriptors[key].value]),
  );
}

function ceiling(contract, name, fallback, maximum) {
  const value = contract?.ceilings?.[name] ?? fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("ERR_PATCH_CEILING", `${name} is outside its fixed bound`);
  }
  return value;
}

function canonicalInteger(raw, label, { positive = false } = {}) {
  const pattern = positive ? POSITIVE_CANONICAL_DECIMAL : CANONICAL_DECIMAL;
  if (!pattern.test(raw) || raw.length > 10) {
    fail("ERR_PATCH_CANONICAL", `${label} is not a canonical integer`);
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0) ||
    value > MAX_HUNK_INTEGER
  ) {
    fail("ERR_PATCH_CANONICAL", `${label} is outside its numeric bound`);
  }
  return value;
}

function canonicalModificationRange(startRaw, countRaw, label) {
  const start = canonicalInteger(startRaw, `${label} start`);
  const count =
    countRaw === undefined ? 1 : canonicalInteger(countRaw, `${label} count`);
  const canonical = count === 1 ? String(start) : `${start},${count}`;
  if (countRaw !== undefined && count === 1) {
    fail(
      "ERR_PATCH_CANONICAL",
      `${label} count one must use the omitted-count form`,
    );
  }
  return { count, canonical };
}

function pathStatus(path, scope) {
  if (scope.createExact.includes(path)) return "A";
  if (scope.mutableExact.includes(path)) return "M";
  if (
    scope.mutablePrefixes.some(
      (prefix) => path === prefix || strictDescendant(path, prefix),
    )
  ) {
    return "M";
  }

  const folded = foldAsciiUnchecked(path);
  if (
    [...scope.mutableExact, ...scope.mutablePrefixes].some((candidate) =>
      componentRelated(folded, foldAsciiUnchecked(candidate)),
    )
  ) {
    fail("ERR_PATH_COLLISION", "patch path has a portable case collision");
  }
  fail("ERR_PATH_INVALID", "patch path is outside exact v2 authority");
}

function parseSectionPath(line) {
  const match = /^diff --git a\/(\S+) b\/(\S+)$/u.exec(line);
  if (match === null || match[1] !== match[2]) {
    fail("ERR_PATCH_CANONICAL", "diff header is not byte-exact");
  }
  return validateTaskV2Path(match[1], "candidate patch path");
}

function parseCreationSection({
  lines,
  index,
  path,
  objectFormat,
  maxChangedLines,
}) {
  const width = objectFormat === "sha1" ? 40 : 64;
  const mode = lines[index + 1];
  const indexLine = lines[index + 2];
  const oldHeader = lines[index + 3];
  const newHeader = lines[index + 4];
  const hunkHeader = lines[index + 5];
  if (
    mode !== "new file mode 100644" ||
    oldHeader !== "--- /dev/null" ||
    newHeader !== `+++ b/${path}`
  ) {
    fail(
      "ERR_PATCH_CANONICAL",
      "creation metadata is not the exact six-record form",
    );
  }
  const hunk = /^@@ -0,0 \+1,([1-9][0-9]*) @@$/u.exec(hunkHeader ?? "");
  if (hunk === null) {
    fail(
      "ERR_PATCH_CANONICAL",
      "creation hunk is not the exact full-file range",
    );
  }
  const lineCount = canonicalInteger(hunk[1], "creation line count", {
    positive: true,
  });
  if (lineCount > maxChangedLines) {
    fail("ERR_PATCH_CEILING", "creation exceeds the changed-line ceiling");
  }
  const payloadStart = index + 6;
  const payloadEnd = payloadStart + lineCount;
  if (payloadEnd > lines.length) {
    fail("ERR_PATCH_CANONICAL", "creation payload is incomplete");
  }
  const payload = [];
  for (let cursor = payloadStart; cursor < payloadEnd; cursor += 1) {
    const line = lines[cursor];
    if (typeof line !== "string" || !line.startsWith("+")) {
      fail(
        "ERR_PATCH_CANONICAL",
        "creation payload must contain addition lines only",
      );
    }
    payload.push(line.slice(1));
  }
  const content = `${payload.join("\n")}\n`;
  const bytes = exactUtf8Bytes(content, `created content for ${path}`);
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) {
    fail(
      "ERR_PATCH_CANONICAL",
      "created content must be non-empty and terminal-LF-terminated",
    );
  }
  const objectId = gitBlobObjectIdV2(bytes, objectFormat);
  const expectedIndex = `index ${"0".repeat(width)}..${objectId}`;
  if (indexLine !== expectedIndex) {
    fail(
      "ERR_PATCH_CANONICAL",
      "creation index does not bind the full recomputed blob identity",
    );
  }

  return Object.freeze({
    nextIndex: payloadEnd,
    changedLines: lineCount,
    blob: Object.freeze({
      path,
      mode: "100644",
      type: "blob",
      objectId,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  });
}

function parseModificationSection({
  lines,
  index,
  path,
  maxChangedLines,
  contract,
}) {
  let sectionEnd = index + 1;
  while (
    sectionEnd < lines.length &&
    !lines[sectionEnd].startsWith("diff --git ")
  ) {
    sectionEnd += 1;
  }
  const sectionPatch = `${lines.slice(index, sectionEnd).join("\n")}\n`;
  const v1CompatibilityContract = {
    ...contract,
    scope: { ...contract.scope, allowCreate: false },
    ceilings: {
      ...contract.ceilings,
      maxPatchBytes: DEFAULT_MAX_PATCH_BYTES,
      maxChangedFiles: MAX_SCOPE_PATHS,
      maxChangedLines: DEFAULT_MAX_CHANGED_LINES,
    },
  };
  try {
    if (
      validateCandidatePatch(sectionPatch, v1CompatibilityContract).length !== 1
    ) {
      fail("ERR_PATCH_CANONICAL", "modification has ambiguous v1 paths");
    }
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_PATCH_CANONICAL", error);
  }

  let cursor = index + 1;
  let hunkCount = 0;
  let changedLines = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  while (cursor < sectionEnd) {
    const line = lines[cursor];
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line === "\\ No newline at end of file") {
        cursor += 1;
        continue;
      }
      if (line[0] === " ") {
        oldRemaining -= 1;
        newRemaining -= 1;
      } else if (line[0] === "-") {
        oldRemaining -= 1;
        changedLines += 1;
      } else if (line[0] === "+") {
        newRemaining -= 1;
        changedLines += 1;
      }
      if (changedLines > maxChangedLines) {
        fail("ERR_PATCH_CEILING", "patch exceeds the changed-line ceiling");
      }
      cursor += 1;
      continue;
    }

    const hunk = MODIFICATION_HUNK.exec(line);
    if (hunk !== null) {
      const oldRange = canonicalModificationRange(hunk[1], hunk[2], "old hunk");
      const newRange = canonicalModificationRange(hunk[3], hunk[4], "new hunk");
      oldRemaining = oldRange.count;
      newRemaining = newRange.count;
      hunkCount += 1;
    }
    cursor += 1;
  }
  if (
    hunkCount === 0 ||
    changedLines === 0 ||
    oldRemaining !== 0 ||
    newRemaining !== 0
  ) {
    fail(
      "ERR_PATCH_CANONICAL",
      "modification must contain a complete changed v1-canonical hunk",
    );
  }
  return Object.freeze({ nextIndex: sectionEnd, changedLines });
}

export function validateCandidatePatchV2(patch, contract, options = undefined) {
  const maxPatchBytes = ceiling(
    contract,
    "maxPatchBytes",
    DEFAULT_MAX_PATCH_BYTES,
    DEFAULT_MAX_PATCH_BYTES,
  );
  const maxChangedFiles = ceiling(
    contract,
    "maxChangedFiles",
    DEFAULT_MAX_CHANGED_FILES,
    MAX_SCOPE_PATHS,
  );
  const maxChangedLines = ceiling(
    contract,
    "maxChangedLines",
    DEFAULT_MAX_CHANGED_LINES,
    DEFAULT_MAX_CHANGED_LINES,
  );
  const patchBytes = exactUtf8Bytes(patch, "candidate patch");
  if (patchBytes.length === 0) {
    fail("ERR_PATCH_CANONICAL", "candidate patch must not be empty");
  }
  if (patchBytes.length > maxPatchBytes) {
    fail("ERR_PATCH_CEILING", "candidate patch exceeds its byte ceiling");
  }
  if (patch.includes("\0") || patch.includes("\r") || !patch.endsWith("\n")) {
    fail(
      "ERR_PATCH_CANONICAL",
      "candidate patch must be raw NUL-free LF-terminated text",
    );
  }

  const scope = validateTaskV2Scope(contract);
  const objectFormat = contractObjectFormat(contract, options);
  const captured = snapshotScopeInput(contract);
  const legacyContract = v1ContractFor(
    captured.scope,
    scope,
    captured.evaluatorPath,
  );
  const lines = patch.slice(0, -1).split("\n");
  const paths = [];
  const pathStatuses = [];
  const createdBlobs = [];
  const seenExact = new Set();
  const seenFolded = new Set();
  let creationCursor = 0;
  let changedLines = 0;
  let index = 0;

  while (index < lines.length) {
    const path = parseSectionPath(lines[index]);
    const foldedPath = foldAsciiUnchecked(path);
    if ([...seenExact].some((candidate) => componentRelated(candidate, path))) {
      fail(
        "ERR_PATH_OVERLAP",
        "candidate patch repeats or overlaps an exact path",
      );
    }
    if (
      [...seenFolded].some((candidate) =>
        componentRelated(candidate, foldedPath),
      )
    ) {
      fail(
        "ERR_PATH_COLLISION",
        "candidate patch repeats or overlaps a folded path",
      );
    }
    seenExact.add(path);
    seenFolded.add(foldedPath);
    if (paths.length >= maxChangedFiles) {
      fail("ERR_PATCH_CEILING", "candidate patch exceeds its file ceiling");
    }

    const status = pathStatus(path, scope);
    validateLegacyProtection(path, legacyContract);
    let parsed;
    if (status === "A") {
      if (scope.createExact[creationCursor] !== path) {
        fail(
          "ERR_PATCH_CANONICAL",
          "creation sections do not follow createExact order",
        );
      }
      parsed = parseCreationSection({
        lines,
        index,
        path,
        objectFormat,
        maxChangedLines: maxChangedLines - changedLines,
      });
      createdBlobs.push(parsed.blob);
      creationCursor += 1;
    } else {
      if (lines[index + 1]?.startsWith("new file mode ")) {
        fail("ERR_PATCH_CANONICAL", "present path carries creation metadata");
      }
      parsed = parseModificationSection({
        lines,
        index,
        path,
        maxChangedLines: maxChangedLines - changedLines,
        contract,
      });
    }
    changedLines += parsed.changedLines;
    if (changedLines > maxChangedLines) {
      fail("ERR_PATCH_CEILING", "candidate patch exceeds its line ceiling");
    }
    paths.push(path);
    pathStatuses.push(Object.freeze({ path, status }));
    index = parsed.nextIndex;
  }

  if (paths.length === 0 || changedLines === 0) {
    fail("ERR_PATCH_CANONICAL", "candidate patch has no changed path");
  }
  if (creationCursor !== scope.createExact.length) {
    fail("ERR_CANDIDATE_STATUS", "candidate patch omits a required creation");
  }
  const canonicalPathStatuses = [...pathStatuses].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.path, "ascii"),
      Buffer.from(right.path, "ascii"),
    ),
  );

  return Object.freeze({
    paths: Object.freeze(paths),
    pathStatuses: Object.freeze(canonicalPathStatuses),
    createdBlobs: Object.freeze(createdBlobs),
    changedLines,
  });
}

function canonicalCreationSectionV2({
  path,
  content,
  objectFormat,
  maxPatchBytes,
  maxChangedLines,
}) {
  if (typeof content !== "string") {
    fail("ERR_PATCH_CANONICAL", `created content for ${path} is not a string`);
  }
  if (content.length === 0) {
    fail("ERR_PATCH_CANONICAL", `created content for ${path} is empty`);
  }
  if (content.length > maxPatchBytes) {
    fail("ERR_PATCH_CEILING", `created content for ${path} is too large`);
  }
  if (
    content.includes("\0") ||
    content.includes("\r") ||
    !content.endsWith("\n")
  ) {
    fail(
      "ERR_PATCH_CANONICAL",
      `created content for ${path} must be NUL/CR-free and terminal-LF-terminated`,
    );
  }

  const bytes = exactUtf8Bytes(content, `created content for ${path}`);
  if (bytes.length > maxPatchBytes) {
    fail("ERR_PATCH_CEILING", `created content for ${path} is too large`);
  }
  let lineCount = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) lineCount += 1;
  }
  if (lineCount > maxChangedLines) {
    fail(
      "ERR_PATCH_CEILING",
      `created content for ${path} exceeds the changed-line ceiling`,
    );
  }

  const width = objectFormat === "sha1" ? 40 : 64;
  const objectId = gitBlobObjectIdV2(bytes, objectFormat);
  const payload = `+${content.slice(0, -1).replaceAll("\n", "\n+")}\n`;
  const section =
    `diff --git a/${path} b/${path}\n` +
    "new file mode 100644\n" +
    `index ${"0".repeat(width)}..${objectId}\n` +
    "--- /dev/null\n" +
    `+++ b/${path}\n` +
    `@@ -0,0 +1,${lineCount} @@\n` +
    payload;
  return Object.freeze({ section, lineCount });
}

export function assembleCandidatePatchV2(
  contract,
  modificationsPatch,
  creations,
) {
  if (modificationsPatch !== null && typeof modificationsPatch !== "string") {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "v2 modifications patch must be a raw string or null",
    );
  }
  if (modificationsPatch === "") {
    fail(
      "ERR_PATCH_CANONICAL",
      "v2 modifications patch must use null when no fragment exists",
    );
  }

  const scope = validateTaskV2Scope(contract);
  const objectFormat = contractObjectFormat(contract);
  const maxPatchBytes = ceiling(
    contract,
    "maxPatchBytes",
    DEFAULT_MAX_PATCH_BYTES,
    DEFAULT_MAX_PATCH_BYTES,
  );
  const maxChangedFiles = ceiling(
    contract,
    "maxChangedFiles",
    DEFAULT_MAX_CHANGED_FILES,
    MAX_SCOPE_PATHS,
  );
  const maxChangedLines = ceiling(
    contract,
    "maxChangedLines",
    DEFAULT_MAX_CHANGED_LINES,
    DEFAULT_MAX_CHANGED_LINES,
  );
  if (
    modificationsPatch !== null &&
    modificationsPatch.length > maxPatchBytes
  ) {
    fail("ERR_PATCH_CEILING", "v2 modifications patch is too large");
  }

  const creationValues = exactOwnDataArray(creations, "creations");
  if (creationValues.length !== scope.createExact.length) {
    fail(
      "ERR_CANDIDATE_STATUS",
      "creations must exactly cover scope.createExact",
    );
  }
  if (creationValues.length > maxChangedFiles) {
    fail("ERR_PATCH_CEILING", "creations exceed the changed-file ceiling");
  }
  const capturedCreations = creationValues.map((value, index) =>
    exactOwnDataRecord(value, `creations[${index}]`, ["path", "content"]),
  );

  const creationSections = [];
  let creationLines = 0;
  for (let index = 0; index < capturedCreations.length; index += 1) {
    const { path, content } = capturedCreations[index];
    validateTaskV2Path(path, `creations[${index}].path`);
    if (path !== scope.createExact[index]) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "creations must follow scope.createExact exactly",
      );
    }
    const creation = canonicalCreationSectionV2({
      path,
      content,
      objectFormat,
      maxPatchBytes,
      maxChangedLines: maxChangedLines - creationLines,
    });
    creationLines += creation.lineCount;
    creationSections.push(creation.section);
  }

  const patch = `${modificationsPatch ?? ""}${creationSections.join("")}`;
  const projection = validateCandidatePatchV2(patch, contract);
  return Object.freeze({ patch, projection });
}

export const validateV2Path = validateTaskV2Path;
export const validateV2Scope = validateTaskV2Scope;
