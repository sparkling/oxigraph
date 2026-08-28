import { createHash } from "node:crypto";

import { isTaskV2Failure, taskV2Failure } from "../policy/task-v2-failures.mjs";
import { runGitBytes } from "./git.mjs";

const maximumProcessOutputBytes = 256 * 1024 * 1024;
const defaultTreeOutputBytes = 64 * 1024 * 1024;
const defaultDiffOutputBytes = 32 * 1024 * 1024;
const defaultBlobOutputBytes = 32 * 1024 * 1024;
const objectTypeOutputBytes = 64;
const maximumTreeRecords = 1_000_000;
const nul = Buffer.from([0]);
const treeInternals = new WeakMap();
const productionTreeObjectIdentities = new WeakMap();

const typeByMode = new Map([
  ["040000", "tree"],
  ["100644", "blob"],
  ["100755", "blob"],
  ["120000", "blob"],
  ["160000", "commit"],
]);

function fail(reason, message) {
  throw taskV2Failure(reason, message);
}

function plainRecord(value, label, reason) {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      fail(reason, `${label} must be a plain record`);
    }
    return value;
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(reason, error);
  }
}

function capturedBytes(value, label, reason) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail(reason, `${label} must be raw bytes`);
  }
  return Buffer.from(value);
}

function pathBytes(value, label, reason) {
  const bytes =
    typeof value === "string"
      ? Buffer.from(value, "utf8")
      : capturedBytes(value, label, reason);
  validateGitPath(bytes, label, reason);
  return bytes;
}

function validateGitPath(path, label, reason) {
  if (
    path.length === 0 ||
    path.includes(0) ||
    path[0] === 0x2f ||
    path[path.length - 1] === 0x2f
  ) {
    fail(reason, `${label} is not a non-empty relative Git path`);
  }
  let componentStart = 0;
  for (let index = 0; index <= path.length; index += 1) {
    if (index !== path.length && path[index] !== 0x2f) continue;
    const component = path.subarray(componentStart, index);
    if (
      component.length === 0 ||
      (component.length === 1 && component[0] === 0x2e) ||
      (component.length === 2 && component[0] === 0x2e && component[1] === 0x2e)
    ) {
      fail(reason, `${label} contains an invalid Git path component`);
    }
    componentStart = index + 1;
  }
}

function boundedOutputBytes(value, fallback, label, reason) {
  const selected = value ?? fallback;
  if (
    !Number.isSafeInteger(selected) ||
    selected <= 0 ||
    selected > maximumProcessOutputBytes
  ) {
    fail(reason, `${label} must be a bounded positive integer`);
  }
  return selected;
}

function objectFormatForLength(length, reason) {
  if (length === 40) return "sha1";
  if (length === 64) return "sha256";
  fail(reason, "Git object identifiers must be full-width SHA-1 or SHA-256");
}

function oidLengthForFormat(format, reason) {
  if (format === undefined || format === null) return undefined;
  if (format === "sha1") return 40;
  if (format === "sha256") return 64;
  fail(reason, "Git object format must be sha1 or sha256");
}

function validatedOid(oid, label, reason, expectedFormat, allowZero = false) {
  if (
    typeof oid !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)
  ) {
    fail(reason, `${label} must be a full lowercase Git object identifier`);
  }
  if (!allowZero && /^0+$/u.test(oid)) {
    fail(reason, `${label} must not be the zero object identifier`);
  }
  const format = objectFormatForLength(oid.length, reason);
  if (expectedFormat !== undefined && expectedFormat !== format) {
    fail(reason, `${label} does not use the expected Git object format`);
  }
  return Object.freeze({ oid, format, length: oid.length });
}

function assertAsciiHeader(bytes, label, reason) {
  if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
    fail(reason, `${label} contains non-ASCII metadata`);
  }
  return bytes.toString("ascii");
}

async function runTypedGitOperation(reason, operation) {
  try {
    return await operation();
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(reason, error);
  }
}

function frozenTreeEntry({ mode, type, oid, path, record }) {
  const storedPath = Buffer.from(path);
  const storedRecord = Buffer.from(record);
  const foldedPath = asciiFoldPathBytes(storedPath);
  return Object.freeze({
    mode,
    type,
    oid,
    pathHex: storedPath.toString("hex"),
    foldedPathHex: foldedPath.toString("hex"),
    get path() {
      return Buffer.from(storedPath);
    },
    get record() {
      return Buffer.from(storedRecord);
    },
  });
}

function frozenDiffEntry({
  oldMode,
  newMode,
  oldOid,
  newOid,
  status,
  path,
  header,
}) {
  const storedPath = Buffer.from(path);
  const storedHeader = Buffer.from(header);
  const foldedPath = asciiFoldPathBytes(storedPath);
  return Object.freeze({
    oldMode,
    newMode,
    oldOid,
    newOid,
    status,
    pathHex: storedPath.toString("hex"),
    foldedPathHex: foldedPath.toString("hex"),
    get path() {
      return Buffer.from(storedPath);
    },
    get header() {
      return Buffer.from(storedHeader);
    },
  });
}

function sortedByRawPath(entries) {
  return [...entries].sort((left, right) =>
    Buffer.compare(left.path, right.path),
  );
}

function foldedIndex(entries) {
  const mutable = new Map();
  for (const entry of entries) {
    const group = mutable.get(entry.foldedPathHex) ?? [];
    group.push(entry);
    mutable.set(entry.foldedPathHex, group);
  }
  return new Map(
    [...mutable].map(([key, group]) => [
      key,
      Object.freeze(sortedByRawPath(group)),
    ]),
  );
}

function validateTreeTopology(entriesByPathHex, entries) {
  for (const entry of entries) {
    const path = entry.path;
    let slash = path.lastIndexOf(0x2f);
    while (slash !== -1) {
      const parentHex = path.subarray(0, slash).toString("hex");
      const parent = entriesByPathHex.get(parentHex);
      if (
        parent === undefined ||
        parent.type !== "tree" ||
        parent.mode !== "040000"
      ) {
        fail(
          "ERR_OBJECT_TYPE",
          "git ls-tree output is missing an exact parent tree entry",
        );
      }
      slash = path.lastIndexOf(0x2f, slash - 1);
    }
  }
}

function createTreeMap(entries, objectFormat) {
  const sortedEntries = Object.freeze(sortedByRawPath(entries));
  const entriesByPathHex = new Map(
    sortedEntries.map((entry) => [entry.pathHex, entry]),
  );
  const entriesByFoldedPathHex = foldedIndex(sortedEntries);
  validateTreeTopology(entriesByPathHex, sortedEntries);
  const tree = Object.freeze({
    schema: "oxigraph.git-tree-map/v2",
    objectFormat,
    oidHexLength:
      objectFormat === null ? null : oidLengthForFormat(objectFormat),
    entryCount: sortedEntries.length,
    treeEntryCount: sortedEntries.filter((entry) => entry.type === "tree")
      .length,
    manifestEntryCount: sortedEntries.filter((entry) => entry.type !== "tree")
      .length,
    entries: sortedEntries,
    get byPathHex() {
      return new Map(entriesByPathHex);
    },
    get entriesByPathHex() {
      return new Map(entriesByPathHex);
    },
    get byFoldedPathHex() {
      return new Map(entriesByFoldedPathHex);
    },
    get entriesByFoldedPathHex() {
      return new Map(entriesByFoldedPathHex);
    },
  });
  treeInternals.set(
    tree,
    Object.freeze({ sortedEntries, entriesByPathHex, entriesByFoldedPathHex }),
  );
  return tree;
}

export function pathBytesToHex(path) {
  return pathBytes(path, "path", "ERR_PATH_INVALID").toString("hex");
}

export function asciiFoldPathBytes(path) {
  const source = capturedBytes(path, "path", "ERR_PATH_INVALID");
  const folded = Buffer.allocUnsafe(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const byte = source[index];
    folded[index] = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
  }
  return folded;
}

export function parseTreeBytes(bytesInput, options = {}) {
  const parsedOptions = plainRecord(
    options,
    "git ls-tree parser options",
    "ERR_BASELINE_STATE",
  );
  const bytes = capturedBytes(
    bytesInput,
    "git ls-tree output",
    "ERR_BASELINE_STATE",
  );
  const maximumBytes = boundedOutputBytes(
    parsedOptions.maxBytes,
    defaultTreeOutputBytes,
    "git ls-tree parser ceiling",
    "ERR_BASELINE_STATE",
  );
  if (bytes.length > maximumBytes) {
    fail("ERR_BASELINE_STATE", "git ls-tree output exceeds its parser ceiling");
  }
  const expectedOidLength = oidLengthForFormat(
    parsedOptions.expectedObjectFormat,
    "ERR_OBJECT_TYPE",
  );
  const entries = [];
  const exactPaths = new Set();
  let observedOidLength;
  let start = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(0, start);
    if (end === -1) {
      fail(
        "ERR_BASELINE_STATE",
        "git ls-tree output is not completely NUL framed",
      );
    }
    if (end === start) {
      fail("ERR_BASELINE_STATE", "git ls-tree output contains an empty record");
    }
    if (entries.length >= maximumTreeRecords) {
      fail(
        "ERR_BASELINE_STATE",
        "git ls-tree output exceeds its record ceiling",
      );
    }
    const record = bytes.subarray(start, end);
    const separator = record.indexOf(0x09);
    if (separator <= 0 || separator === record.length - 1) {
      fail(
        "ERR_BASELINE_STATE",
        "git ls-tree output contains a malformed record",
      );
    }
    const header = assertAsciiHeader(
      record.subarray(0, separator),
      "git ls-tree record header",
      "ERR_BASELINE_STATE",
    );
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]+)$/u.exec(header);
    if (match === null) {
      fail(
        "ERR_BASELINE_STATE",
        "git ls-tree output contains malformed metadata",
      );
    }
    const [, mode, type, oid] = match;
    if (typeByMode.get(mode) !== type) {
      fail(
        "ERR_OBJECT_TYPE",
        "git ls-tree output contains a mode/type mismatch",
      );
    }
    const identity = validatedOid(
      oid,
      "git ls-tree object identifier",
      "ERR_OBJECT_TYPE",
    );
    if (
      expectedOidLength !== undefined &&
      identity.length !== expectedOidLength
    ) {
      fail(
        "ERR_OBJECT_TYPE",
        "git ls-tree output uses the wrong object format",
      );
    }
    if (
      observedOidLength !== undefined &&
      identity.length !== observedOidLength
    ) {
      fail("ERR_OBJECT_TYPE", "git ls-tree output mixes Git object formats");
    }
    observedOidLength = identity.length;
    const path = Buffer.from(record.subarray(separator + 1));
    validateGitPath(path, "git ls-tree record path", "ERR_BASELINE_STATE");
    const pathHex = path.toString("hex");
    if (exactPaths.has(pathHex)) {
      fail(
        "ERR_BASELINE_STATE",
        "git ls-tree output contains a duplicate exact path",
      );
    }
    exactPaths.add(pathHex);
    entries.push(frozenTreeEntry({ mode, type, oid, path, record }));
    start = end + 1;
  }
  const objectFormat =
    observedOidLength === undefined
      ? (parsedOptions.expectedObjectFormat ?? null)
      : objectFormatForLength(observedOidLength, "ERR_OBJECT_TYPE");
  return createTreeMap(entries, objectFormat);
}

export function treeEntryAtPath(tree, path) {
  const internal = treeInternals.get(tree);
  if (internal === undefined) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "tree lookup requires a parsed v2 tree map",
    );
  }
  return internal.entriesByPathHex.get(pathBytesToHex(path));
}

export function treeEntriesAtAsciiFold(tree, path) {
  const internal = treeInternals.get(tree);
  if (internal === undefined) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "tree lookup requires a parsed v2 tree map",
    );
  }
  const foldedHex = asciiFoldPathBytes(
    pathBytes(path, "path", "ERR_PATH_INVALID"),
  ).toString("hex");
  return internal.entriesByFoldedPathHex.get(foldedHex) ?? Object.freeze([]);
}

function normalizedExclusions(exclude) {
  if (!Array.isArray(exclude)) {
    fail("ERR_PROTECTED_MANIFEST", "manifest exclusions must be an array");
  }
  const exclusions = new Set();
  for (const [index, path] of exclude.entries()) {
    const hex = pathBytes(
      path,
      `manifest exclusion ${index}`,
      "ERR_PROTECTED_MANIFEST",
    ).toString("hex");
    if (exclusions.has(hex)) {
      fail(
        "ERR_PROTECTED_MANIFEST",
        "manifest exclusions contain a duplicate path",
      );
    }
    exclusions.add(hex);
  }
  return exclusions;
}

export function projectTreeManifestV2(tree, options = {}) {
  const parsedOptions = plainRecord(
    options,
    "manifest projection options",
    "ERR_PROTECTED_MANIFEST",
  );
  const exclude = parsedOptions.exclude ?? [];
  const internal = treeInternals.get(tree);
  if (internal === undefined) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "manifest projection requires a parsed v2 tree map",
    );
  }
  const exclusions = normalizedExclusions(exclude);
  for (const pathHex of exclusions) {
    const entry = internal.entriesByPathHex.get(pathHex);
    if (entry === undefined || entry.type === "tree") {
      fail(
        "ERR_PROTECTED_MANIFEST",
        "manifest exclusion does not select an exact non-tree entry",
      );
    }
  }
  const records = internal.sortedEntries
    .filter((entry) => entry.type !== "tree" && !exclusions.has(entry.pathHex))
    .map((entry) => entry.record)
    .sort(Buffer.compare);
  const framed = Buffer.concat(records.flatMap((record) => [record, nul]));
  const storedRecords = Object.freeze(
    records.map((record) => Buffer.from(record)),
  );
  const storedFrame = Buffer.from(framed);
  return Object.freeze({
    schema: "oxigraph.git-tree-manifest/v2",
    entries: storedRecords.length,
    entryCount: storedRecords.length,
    excludedEntries: exclusions.size,
    sha256: createHash("sha256").update(storedFrame).digest("hex"),
    get records() {
      return storedRecords.map((record) => Buffer.from(record));
    },
    get framed() {
      return Buffer.from(storedFrame);
    },
  });
}

export function gitObjectOid(bytesInput, options = {}) {
  const normalized =
    typeof options === "string" ? { algorithm: options } : options;
  if (normalized === null || typeof normalized !== "object") {
    fail("ERR_OBJECT_TYPE", "Git object hash options must be a record");
  }
  const algorithm = normalized.algorithm ?? "sha1";
  const type = normalized.type ?? "blob";
  if (algorithm !== "sha1" && algorithm !== "sha256") {
    fail("ERR_OBJECT_TYPE", "Git object hash algorithm must be sha1 or sha256");
  }
  if (!new Set(["blob", "tree", "commit", "tag"]).has(type)) {
    fail("ERR_OBJECT_TYPE", "Git object hash type is invalid");
  }
  const bytes =
    typeof bytesInput === "string"
      ? Buffer.from(bytesInput, "utf8")
      : capturedBytes(bytesInput, "Git object content", "ERR_OBJECT_TYPE");
  const header = Buffer.from(`${type} ${bytes.length}\0`, "ascii");
  return createHash(algorithm).update(header).update(bytes).digest("hex");
}

function validateRawDiffModes(status, oldMode, newMode, oldOid, newOid) {
  const zeroOid = "0".repeat(oldOid.length);
  if (
    status === "A" &&
    (oldMode !== "000000" || newMode !== "100644" || oldOid !== zeroOid)
  ) {
    fail(
      "ERR_CANDIDATE_STATUS",
      "raw added entry has invalid mode or old identity",
    );
  }
  if (
    status === "M" &&
    (oldMode !== "100644" || newMode !== "100644" || oldOid === zeroOid)
  ) {
    fail(
      "ERR_CANDIDATE_STATUS",
      "raw modified entry has invalid modes or identity",
    );
  }
  if (newOid === zeroOid || (status === "M" && oldOid === newOid)) {
    fail(
      "ERR_CANDIDATE_STATUS",
      "raw changed entry has invalid object identities",
    );
  }
}

function createDiffMap(changes, objectFormat) {
  const sortedChanges = Object.freeze(sortedByRawPath(changes));
  const byPathHex = new Map(
    sortedChanges.map((entry) => [entry.pathHex, entry]),
  );
  const byFoldedPathHex = foldedIndex(sortedChanges);
  return Object.freeze({
    schema: "oxigraph.git-raw-diff/v2",
    objectFormat,
    oidHexLength:
      objectFormat === null ? null : oidLengthForFormat(objectFormat),
    changeCount: sortedChanges.length,
    changes: sortedChanges,
    get byPathHex() {
      return new Map(byPathHex);
    },
    get changesByPathHex() {
      return new Map(byPathHex);
    },
    get byFoldedPathHex() {
      return new Map(byFoldedPathHex);
    },
  });
}

export function parseRawDiffTreeBytes(bytesInput, options = {}) {
  const parsedOptions = plainRecord(
    options,
    "git diff-tree parser options",
    "ERR_CANDIDATE_STATUS",
  );
  const bytes = capturedBytes(
    bytesInput,
    "git diff-tree output",
    "ERR_CANDIDATE_STATUS",
  );
  const maximumBytes = boundedOutputBytes(
    parsedOptions.maxBytes,
    defaultDiffOutputBytes,
    "git diff-tree parser ceiling",
    "ERR_CANDIDATE_STATUS",
  );
  if (bytes.length > maximumBytes) {
    fail(
      "ERR_CANDIDATE_STATUS",
      "git diff-tree output exceeds its parser ceiling",
    );
  }
  const expectedOidLength = oidLengthForFormat(
    parsedOptions.expectedObjectFormat,
    "ERR_CANDIDATE_STATUS",
  );
  const changes = [];
  const exactPaths = new Set();
  let observedOidLength;
  let start = 0;
  while (start < bytes.length) {
    const headerEnd = bytes.indexOf(0, start);
    if (headerEnd === -1 || headerEnd === start) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "git diff-tree output has invalid NUL framing",
      );
    }
    const pathStart = headerEnd + 1;
    const pathEnd = bytes.indexOf(0, pathStart);
    if (pathEnd === -1 || pathEnd === pathStart) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "git diff-tree output has invalid path framing",
      );
    }
    if (changes.length >= maximumTreeRecords) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "git diff-tree output exceeds its record ceiling",
      );
    }
    const headerBytes = bytes.subarray(start, headerEnd);
    const header = assertAsciiHeader(
      headerBytes,
      "git diff-tree record header",
      "ERR_CANDIDATE_STATUS",
    );
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AM])$/u.exec(
      header,
    );
    if (match === null) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "git diff-tree output contains invalid metadata",
      );
    }
    const [, oldMode, newMode, oldOid, newOid, status] = match;
    const oldIdentity = validatedOid(
      oldOid,
      "git diff-tree old object identifier",
      "ERR_CANDIDATE_STATUS",
      undefined,
      true,
    );
    const newIdentity = validatedOid(
      newOid,
      "git diff-tree new object identifier",
      "ERR_CANDIDATE_STATUS",
      oldIdentity.format,
    );
    if (
      expectedOidLength !== undefined &&
      (oldIdentity.length !== expectedOidLength ||
        newIdentity.length !== expectedOidLength)
    ) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "git diff-tree output uses the wrong object format",
      );
    }
    if (
      observedOidLength !== undefined &&
      oldIdentity.length !== observedOidLength
    ) {
      fail("ERR_CANDIDATE_STATUS", "git diff-tree output mixes object formats");
    }
    observedOidLength = oldIdentity.length;
    validateRawDiffModes(status, oldMode, newMode, oldOid, newOid);
    const path = Buffer.from(bytes.subarray(pathStart, pathEnd));
    validateGitPath(path, "git diff-tree record path", "ERR_CANDIDATE_STATUS");
    const pathHex = path.toString("hex");
    if (exactPaths.has(pathHex)) {
      fail(
        "ERR_CANDIDATE_STATUS",
        "git diff-tree output repeats an exact path",
      );
    }
    exactPaths.add(pathHex);
    changes.push(
      frozenDiffEntry({
        oldMode,
        newMode,
        oldOid,
        newOid,
        status,
        path,
        header: headerBytes,
      }),
    );
    start = pathEnd + 1;
  }
  const objectFormat =
    observedOidLength === undefined
      ? (parsedOptions.expectedObjectFormat ?? null)
      : objectFormatForLength(observedOidLength, "ERR_CANDIDATE_STATUS");
  return createDiffMap(changes, objectFormat);
}

function createTreeV2Primitives(gitBytesRunner, loadedTreeSink) {
  if (typeof gitBytesRunner !== "function") {
    throw new TypeError("Git byte runner must be a function");
  }

  async function requireTreeObject({
    workspace,
    home,
    identity,
    timeoutMs,
    signal,
  }) {
    const output = capturedBytes(
      await runTypedGitOperation("ERR_OBJECT_TYPE", () =>
        gitBytesRunner({
          args: ["cat-file", "-t", identity.oid],
          cwd: workspace,
          home,
          timeoutMs,
          maxOutputBytes: objectTypeOutputBytes,
          signal,
        }),
      ),
      "git cat-file object type output",
      "ERR_OBJECT_TYPE",
    );
    if (!output.equals(Buffer.from("tree\n", "ascii"))) {
      fail(
        "ERR_OBJECT_TYPE",
        "Git object identity does not name a tree object",
      );
    }
  }

  async function loadTreeV2({
    workspace,
    tree,
    home,
    timeoutMs = 120_000,
    maxOutputBytes = defaultTreeOutputBytes,
    signal,
  }) {
    const identity = validatedOid(tree, "tree", "ERR_OBJECT_TYPE");
    await requireTreeObject({ workspace, home, identity, timeoutMs, signal });
    const ceiling = boundedOutputBytes(
      maxOutputBytes,
      defaultTreeOutputBytes,
      "git ls-tree output ceiling",
      "ERR_BASELINE_STATE",
    );
    const output = await runTypedGitOperation("ERR_BASELINE_STATE", () =>
      gitBytesRunner({
        args: ["ls-tree", "-r", "-t", "-z", "--full-tree", identity.oid],
        cwd: workspace,
        home,
        timeoutMs,
        maxOutputBytes: ceiling,
        signal,
      }),
    );
    const parsed = parseTreeBytes(output, {
      expectedObjectFormat: identity.format,
      maxBytes: ceiling,
    });
    if (loadedTreeSink !== undefined) loadedTreeSink(parsed, identity.oid);
    return parsed;
  }

  async function readBlobByOid({
    workspace,
    oid,
    home,
    timeoutMs = 120_000,
    maxOutputBytes = defaultBlobOutputBytes,
    signal,
  }) {
    const identity = validatedOid(
      oid,
      "blob object identifier",
      "ERR_OBJECT_TYPE",
    );
    const ceiling = boundedOutputBytes(
      maxOutputBytes,
      defaultBlobOutputBytes,
      "git cat-file output ceiling",
      "ERR_OBJECT_TYPE",
    );
    const output = capturedBytes(
      await runTypedGitOperation("ERR_OBJECT_TYPE", () =>
        gitBytesRunner({
          args: ["cat-file", "blob", identity.oid],
          cwd: workspace,
          home,
          timeoutMs,
          maxOutputBytes: ceiling,
          signal,
        }),
      ),
      "git cat-file output",
      "ERR_OBJECT_TYPE",
    );
    if (output.length > ceiling) {
      fail("ERR_OBJECT_TYPE", "git cat-file output exceeds its byte ceiling");
    }
    if (gitObjectOid(output, identity.format) !== identity.oid) {
      fail(
        "ERR_OBJECT_TYPE",
        "git cat-file output does not match its object identity",
      );
    }
    return Buffer.from(output);
  }

  async function diffTreesV2({
    workspace,
    oldTree,
    newTree,
    home,
    timeoutMs = 120_000,
    maxOutputBytes = defaultDiffOutputBytes,
    signal,
  }) {
    const oldIdentity = validatedOid(oldTree, "old tree", "ERR_OBJECT_TYPE");
    const newIdentity = validatedOid(
      newTree,
      "new tree",
      "ERR_OBJECT_TYPE",
      oldIdentity.format,
    );
    await requireTreeObject({
      workspace,
      home,
      identity: oldIdentity,
      timeoutMs,
      signal,
    });
    await requireTreeObject({
      workspace,
      home,
      identity: newIdentity,
      timeoutMs,
      signal,
    });
    const ceiling = boundedOutputBytes(
      maxOutputBytes,
      defaultDiffOutputBytes,
      "git diff-tree output ceiling",
      "ERR_CANDIDATE_STATUS",
    );
    const output = await runTypedGitOperation("ERR_CANDIDATE_STATUS", () =>
      gitBytesRunner({
        args: [
          "diff-tree",
          "-r",
          "--raw",
          "-z",
          "--no-renames",
          "--no-commit-id",
          "--no-abbrev",
          oldIdentity.oid,
          newIdentity.oid,
        ],
        cwd: workspace,
        home,
        timeoutMs,
        maxOutputBytes: ceiling,
        signal,
      }),
    );
    return parseRawDiffTreeBytes(output, {
      expectedObjectFormat: oldIdentity.format,
      maxBytes: ceiling,
    });
  }

  return Object.freeze({ loadTreeV2, readBlobByOid, diffTreesV2 });
}

const productionPrimitives = createTreeV2Primitives(
  runGitBytes,
  (tree, objectId) => productionTreeObjectIdentities.set(tree, objectId),
);

// Production owners may bind a stricter, fixed Git-byte runner so they can
// retain lifecycle-local cleanup evidence. Task inputs never select this
// runner; caller-provided process or Git authority remains forbidden.
export function createTreeV2PrimitivesForTrustedRunner(gitBytesRunner) {
  return createTreeV2Primitives(gitBytesRunner);
}

export function loadedProductionTreeV2ObjectIdentity(tree) {
  const objectId = productionTreeObjectIdentities.get(tree);
  if (objectId === undefined) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "tree identity requires a production-loaded v2 tree map",
    );
  }
  return objectId;
}

export function loadTreeV2(input) {
  return runTypedGitOperation("ERR_INTERNAL_FAIL_CLOSED", () =>
    productionPrimitives.loadTreeV2(input),
  );
}

export function readBlobByOid(input) {
  return runTypedGitOperation("ERR_INTERNAL_FAIL_CLOSED", () =>
    productionPrimitives.readBlobByOid(input),
  );
}

export function diffTreesV2(input) {
  return runTypedGitOperation("ERR_INTERNAL_FAIL_CLOSED", () =>
    productionPrimitives.diffTreesV2(input),
  );
}

/** Explicitly test-only Git-byte-runner injection for literal argv controls. */
export function createTreeV2PrimitivesForTesting(gitBytesRunner) {
  return createTreeV2Primitives(gitBytesRunner);
}
