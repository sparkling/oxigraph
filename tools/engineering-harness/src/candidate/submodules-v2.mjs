import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { types as utilTypes } from "node:util";

import { runBoundedProcessBytes } from "../native/process.mjs";
import { validateTaskV2Path } from "../policy/paths-v2.mjs";
import {
  isTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "../policy/task-v2-failures.mjs";
import { GitBytesProcessFault, runGitBytes } from "./git.mjs";
import { createTreeV2PrimitivesForTrustedRunner } from "./tree-v2.mjs";

const archiveBytesCeiling = 64 * 1024 * 1024;
const gitStatusBytesCeiling = 4 * 1024 * 1024;
const gitTreeBytesCeiling = 16 * 1024 * 1024;
const gitMetadataBytesCeiling = 1024 * 1024;
const processOutputBytesCeiling = 4 * 1024 * 1024;
const processTimeoutMs = 300_000;
const materializationWallMs = 600_000;
const stagePrefix = "submodule-v2-";
const archiveMethod = "git-archive-tar-v1";
const archiveMtime = "2000-01-01T00:00:00Z";
const archiveMtimeSeconds = 946_684_800;
const tarBlockBytes = 512;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const testSeams = new WeakMap();

const tarEnvironment = Object.freeze({
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
  TZ: "UTC",
});
const sourceGitConfigPrefix = Object.freeze([
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "protocol.file.allow=never",
  "-c",
  "submodule.recurse=false",
]);

function fail(code, detail) {
  throw taskV2Failure(code, detail);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function privateFailureDigest(error) {
  if (isTaskV2Failure(error)) return error.detailSha256;
  return sha256(
    Buffer.from("v2 submodule materialization failed closed", "utf8"),
  );
}

function exactOwnDataRecord(value, label, keys, { frozen = false } = {}) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  ) {
    fail("ERR_RECONSTRUCTION", `${label} must be a plain own-data record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    fail("ERR_RECONSTRUCTION", error);
  }
  if (![Object.prototype, null].includes(prototype)) {
    fail("ERR_RECONSTRUCTION", `${label} must be a plain own-data record`);
  }
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.some((key) => typeof key !== "string") ||
    actual.length !== keys.length ||
    keys.some((key) => !actual.includes(key)) ||
    actual.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    ) ||
    (frozen && !Object.isFrozen(value))
  ) {
    fail("ERR_RECONSTRUCTION", `${label} has invalid private authority`);
  }
  return Object.freeze(
    Object.fromEntries(keys.map((key) => [key, descriptors[key].value])),
  );
}

function exactFunction(value, label) {
  if (typeof value !== "function" || utilTypes.isProxy(value)) {
    fail("ERR_RECONSTRUCTION", `${label} must be a fixed function capability`);
  }
  return value;
}

function privatePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n") ||
    !isAbsolute(value)
  ) {
    fail("ERR_RECONSTRUCTION", `${label} is not an exact private path`);
  }
  return resolve(value);
}

function contained(parent, child) {
  const relation = relative(parent, child);
  return (
    relation.length > 0 &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function disjoint(left, right) {
  return left !== right && !contained(left, right) && !contained(right, left);
}

async function exactDirectory(path, label) {
  let metadata;
  let canonical;
  try {
    metadata = await lstat(path);
    canonical = await realpath(path);
  } catch (error) {
    fail("ERR_BASELINE_STATE", error);
  }
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    canonical !== path
  ) {
    fail("ERR_BASELINE_STATE", `${label} is not an exact regular directory`);
  }
  return Object.freeze({ path, metadata });
}

function denseFrozenDeclarations(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    !Object.isFrozen(value) ||
    value.length > 64
  ) {
    fail("ERR_RECONSTRUCTION", "submodule declarations are not frozen");
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    fail("ERR_RECONSTRUCTION", error);
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ]);
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.some((key) => typeof key !== "string") ||
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    fail("ERR_RECONSTRUCTION", "submodule declarations are not exact");
  }
  const declarations = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail("ERR_RECONSTRUCTION", "submodule declaration is not own data");
    }
    const declaration = exactOwnDataRecord(
      descriptor.value,
      `submodules[${index}]`,
      ["path", "commit", "tree"],
      { frozen: true },
    );
    validateTaskV2Path(declaration.path, `submodules[${index}].path`);
    if (
      !oidPattern.test(declaration.commit) ||
      /^0+$/u.test(declaration.commit) ||
      !oidPattern.test(declaration.tree) ||
      /^0+$/u.test(declaration.tree) ||
      declaration.commit.length !== declaration.tree.length
    ) {
      fail("ERR_RECONSTRUCTION", "submodule object identities are invalid");
    }
    declarations.push(
      Object.freeze({
        path: declaration.path,
        commit: declaration.commit,
        tree: declaration.tree,
      }),
    );
  }
  for (let index = 1; index < declarations.length; index += 1) {
    const previous = declarations[index - 1].path;
    const current = declarations[index].path;
    if (
      Buffer.compare(
        Buffer.from(previous, "ascii"),
        Buffer.from(current, "ascii"),
      ) >= 0 ||
      current.startsWith(`${previous}/`)
    ) {
      fail("ERR_RECONSTRUCTION", "submodule declarations are ambiguous");
    }
  }
  return Object.freeze(declarations);
}

function snapshotSession(value) {
  const session = exactOwnDataRecord(
    value,
    "submodule materialization session",
    [
      "sourceRoot",
      "temporaryRoot",
      "workspace",
      "gitHome",
      "submodules",
      "complete",
      "failSafe",
      "quarantine",
    ],
    { frozen: true },
  );
  return Object.freeze({
    sourceRoot: privatePath(session.sourceRoot, "sourceRoot"),
    temporaryRoot: privatePath(session.temporaryRoot, "temporaryRoot"),
    workspace: privatePath(session.workspace, "workspace"),
    gitHome: privatePath(session.gitHome, "gitHome"),
    submodules: denseFrozenDeclarations(session.submodules),
    complete: exactFunction(session.complete, "complete"),
    failSafe: exactFunction(session.failSafe, "failSafe"),
    quarantine: exactFunction(session.quarantine, "quarantine"),
  });
}

function snapshotControllerInput(value) {
  const input = exactOwnDataRecord(value, "trusted candidate controller", [
    "claimCandidate",
  ]);
  return Object.freeze({
    claimCandidate: exactFunction(input.claimCandidate, "claimCandidate"),
  });
}

function coherentNoChild(outcome) {
  return (
    outcome?.noChild === true &&
    outcome.spawned === false &&
    outcome.reaped === false &&
    outcome.directChildCleanupSafe === true &&
    outcome.processGroupQuiescent === true
  );
}

function coherentCapture(outcome) {
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

function cleanupSafeGitFailure(error) {
  if (!(error instanceof GitBytesProcessFault)) return false;
  return coherentNoChild(error.outcome) || coherentCapture(error.outcome);
}

async function trackedGit(runners, attempt, input) {
  try {
    const output = await runners.gitBytesRunner(input);
    if (!Buffer.isBuffer(output)) {
      attempt.cleanupSafe = false;
      fail("ERR_RECONSTRUCTION", "Git did not return exact bytes");
    }
    return Buffer.from(output);
  } catch (error) {
    if (!cleanupSafeGitFailure(error)) attempt.cleanupSafe = false;
    throw error;
  }
}

async function trackedProcess(runners, attempt, input) {
  let outcome;
  try {
    outcome = await runners.processBytesRunner(input);
  } catch (error) {
    attempt.cleanupSafe = false;
    throw error;
  }
  const cleanupSafe = coherentNoChild(outcome) || coherentCapture(outcome);
  if (!cleanupSafe) attempt.cleanupSafe = false;
  let stdout;
  let stderr;
  try {
    stdout = outcome?.stdout;
    stderr = outcome?.stderr;
  } catch (error) {
    attempt.cleanupSafe = false;
    throw error;
  }
  if (
    !coherentCapture(outcome) ||
    outcome.disposition !== "completed" ||
    outcome.exitCode !== 0 ||
    !Buffer.isBuffer(stdout) ||
    !Buffer.isBuffer(stderr) ||
    stdout.length !== 0 ||
    stderr.length !== 0
  ) {
    fail("ERR_RECONSTRUCTION", "submodule extraction process failed closed");
  }
}

function exactOidLine(bytes, expected, label) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.equals(Buffer.from(`${expected}\n`, "ascii"))
  ) {
    fail("ERR_BASELINE_STATE", `${label} does not match its frozen identity`);
  }
}

function exactUtf8Line(bytes, label) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 2 ||
    bytes.length > 4097 ||
    bytes[bytes.length - 1] !== 0x0a ||
    bytes.subarray(0, -1).includes(0x0a) ||
    bytes.includes(0x00) ||
    bytes.includes(0x0d)
  ) {
    fail("ERR_BASELINE_STATE", `${label} is not an exact path line`);
  }
  const body = bytes.subarray(0, -1);
  let text;
  try {
    text = UTF8.decode(body);
  } catch (error) {
    fail("ERR_BASELINE_STATE", error);
  }
  if (!Buffer.from(text, "utf8").equals(body) || !isAbsolute(text)) {
    fail("ERR_BASELINE_STATE", `${label} has ambiguous path encoding`);
  }
  return resolve(text);
}

function exactCommitTree(bytes, declaration) {
  if (!Buffer.isBuffer(bytes) || bytes.includes(0x00)) {
    fail("ERR_BASELINE_STATE", "submodule commit bytes are invalid");
  }
  const headerEnd = bytes.indexOf(Buffer.from("\n\n", "ascii"));
  if (headerEnd < 0) {
    fail("ERR_BASELINE_STATE", "submodule commit has no exact header");
  }
  const firstLineEnd = bytes.indexOf(0x0a);
  if (
    firstLineEnd < 0 ||
    firstLineEnd > headerEnd ||
    !bytes
      .subarray(0, firstLineEnd)
      .equals(Buffer.from(`tree ${declaration.tree}`, "ascii"))
  ) {
    fail("ERR_BASELINE_STATE", "submodule commit tree does not match");
  }
}

async function exactContainedDirectory(root, path) {
  let current = root;
  for (const component of path.split("/")) {
    current = join(current, component);
    await exactDirectory(current, "submodule source");
  }
  if (!contained(root, current)) {
    fail("ERR_BASELINE_STATE", "submodule source escapes its controller");
  }
  return current;
}

async function verifySource({ declaration, roots, runGit, primitives }) {
  const source = await exactContainedDirectory(
    roots.sourceRoot,
    declaration.path,
  );
  let gitMarker;
  try {
    gitMarker = await lstat(join(source, ".git"));
  } catch (error) {
    fail("ERR_BASELINE_STATE", error);
  }
  if (
    gitMarker.isSymbolicLink() ||
    (!gitMarker.isDirectory() && !gitMarker.isFile())
  ) {
    fail("ERR_BASELINE_STATE", "submodule Git marker is invalid");
  }

  const topLevel = exactUtf8Line(
    await runGit({
      args: ["rev-parse", "--path-format=absolute", "--show-toplevel"],
      cwd: source,
      home: roots.gitHome,
      maxOutputBytes: 8192,
    }),
    "submodule top-level",
  );
  if (topLevel !== source || (await realpath(topLevel)) !== source) {
    fail("ERR_BASELINE_STATE", "submodule top-level identity changed");
  }
  const gitDirectory = exactUtf8Line(
    await runGit({
      args: ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
      cwd: source,
      home: roots.gitHome,
      maxOutputBytes: 8192,
    }),
    "submodule Git directory",
  );
  await exactDirectory(gitDirectory, "submodule Git directory");
  if (!contained(roots.sourceRoot, gitDirectory)) {
    fail(
      "ERR_BASELINE_STATE",
      "submodule Git directory escapes its controller",
    );
  }
  const objectDirectory = exactUtf8Line(
    await runGit({
      args: ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
      cwd: source,
      home: roots.gitHome,
      maxOutputBytes: 8192,
    }),
    "submodule object directory",
  );
  await exactDirectory(objectDirectory, "submodule object directory");
  if (!contained(roots.sourceRoot, objectDirectory)) {
    fail(
      "ERR_BASELINE_STATE",
      "submodule object directory escapes its controller",
    );
  }
  try {
    await lstat(join(objectDirectory, "info", "alternates"));
    fail("ERR_BASELINE_STATE", "submodule object alternates are not admitted");
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    if (error?.code !== "ENOENT") fail("ERR_BASELINE_STATE", error);
  }

  exactOidLine(
    await runGit({
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: source,
      home: roots.gitHome,
      maxOutputBytes: 1024,
    }),
    declaration.commit,
    "submodule HEAD",
  );
  exactCommitTree(
    await runGit({
      args: ["cat-file", "commit", declaration.commit],
      cwd: source,
      home: roots.gitHome,
      maxOutputBytes: gitMetadataBytesCeiling,
    }),
    declaration,
  );
  const status = await runGit({
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    cwd: source,
    home: roots.gitHome,
    maxOutputBytes: gitStatusBytesCeiling,
  });
  if (status.length !== 0) {
    fail("ERR_BASELINE_STATE", "submodule source is not clean");
  }
  const tree = await primitives.loadTreeV2({
    workspace: source,
    home: roots.gitHome,
    tree: declaration.tree,
    maxOutputBytes: gitTreeBytesCeiling,
  });
  if (
    tree.entries.some(
      (entry) => entry.mode === "160000" || entry.type === "commit",
    )
  ) {
    fail("ERR_OBJECT_TYPE", "nested submodule materialization is not admitted");
  }
  return Object.freeze({ declaration, source, tree });
}

async function reverifySource(plan, roots, runGit) {
  await exactContainedDirectory(roots.sourceRoot, plan.declaration.path);
  exactOidLine(
    await runGit({
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: plan.source,
      home: roots.gitHome,
      maxOutputBytes: 1024,
    }),
    plan.declaration.commit,
    "submodule HEAD",
  );
  exactCommitTree(
    await runGit({
      args: ["cat-file", "commit", plan.declaration.commit],
      cwd: plan.source,
      home: roots.gitHome,
      maxOutputBytes: gitMetadataBytesCeiling,
    }),
    plan.declaration,
  );
  const status = await runGit({
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    cwd: plan.source,
    home: roots.gitHome,
    maxOutputBytes: gitStatusBytesCeiling,
  });
  if (status.length !== 0) {
    fail(
      "ERR_BASELINE_STATE",
      "submodule source changed during materialization",
    );
  }
}

function decodeTarField(block, offset, length, label) {
  const field = block.subarray(offset, offset + length);
  const nul = field.indexOf(0x00);
  const end = nul < 0 ? field.length : nul;
  if (nul >= 0 && field.subarray(nul).some((byte) => byte !== 0x00)) {
    fail("ERR_OBJECT_TYPE", `${label} has ambiguous NUL padding`);
  }
  const bytes = field.subarray(0, end);
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    fail("ERR_OBJECT_TYPE", error);
  }
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    fail("ERR_OBJECT_TYPE", `${label} has ambiguous UTF-8`);
  }
  return text;
}

function tarOctal(block, offset, length, label) {
  const field = block.subarray(offset, offset + length);
  if (field.some((byte) => byte > 0x7f)) {
    fail("ERR_OBJECT_TYPE", `${label} uses a non-octal tar encoding`);
  }
  const text = field
    .toString("ascii")
    .replace(/[\0 ]+$/u, "")
    .trimStart();
  if (!/^[0-7]+$/u.test(text)) {
    fail("ERR_OBJECT_TYPE", `${label} is not canonical tar octal`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("ERR_OBJECT_TYPE", `${label} exceeds its tar ceiling`);
  }
  return value;
}

function tarChecksum(block) {
  const expected = tarOctal(block, 148, 8, "tar checksum");
  let actual = 0;
  for (let index = 0; index < block.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  if (actual !== expected) {
    fail("ERR_OBJECT_TYPE", "tar header checksum does not match");
  }
}

function safeArchivePath(value, type) {
  let path = value;
  if (type === "directory" && path.endsWith("/")) path = path.slice(0, -1);
  if (
    path.length === 0 ||
    path.length > 4096 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    fail("ERR_OBJECT_TYPE", "tar member path is not portable exact text");
  }
  const components = path.split("/");
  if (
    components.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    fail("ERR_OBJECT_TYPE", "tar member path has ambiguous components");
  }
  return path;
}

function safeSymlinkTarget(path, target) {
  if (
    target.length === 0 ||
    target.length > 4096 ||
    target.startsWith("/") ||
    target.includes("\\") ||
    /^[A-Za-z]:/u.test(target) ||
    /[\u0000-\u001f\u007f]/u.test(target)
  ) {
    fail("ERR_OBJECT_TYPE", "tar symlink target is not portable exact text");
  }
  const projected = posix.normalize(posix.join(posix.dirname(path), target));
  if (
    projected === ".." ||
    projected.startsWith("../") ||
    posix.isAbsolute(projected)
  ) {
    fail("ERR_OBJECT_TYPE", "tar symlink target escapes materialized source");
  }
  return target;
}

function zeroBlock(block) {
  return block.every((byte) => byte === 0x00);
}

function parseExactGitTar(archive) {
  if (
    !Buffer.isBuffer(archive) ||
    archive.length < tarBlockBytes * 2 ||
    archive.length > archiveBytesCeiling ||
    archive.length % tarBlockBytes !== 0
  ) {
    fail("ERR_OBJECT_TYPE", "Git archive has an invalid bounded tar envelope");
  }
  const entries = [];
  const paths = new Set();
  let offset = 0;
  let terminated = false;
  while (offset < archive.length) {
    const block = archive.subarray(offset, offset + tarBlockBytes);
    if (zeroBlock(block)) {
      if (
        offset + tarBlockBytes >= archive.length ||
        !zeroBlock(
          archive.subarray(offset + tarBlockBytes, offset + tarBlockBytes * 2),
        ) ||
        archive.subarray(offset).some((byte) => byte !== 0x00)
      ) {
        fail("ERR_OBJECT_TYPE", "Git tar termination is not exact");
      }
      terminated = true;
      break;
    }
    tarChecksum(block);
    if (
      !block.subarray(257, 263).equals(Buffer.from("ustar\0", "ascii")) ||
      !block.subarray(263, 265).equals(Buffer.from("00", "ascii"))
    ) {
      fail("ERR_OBJECT_TYPE", "Git archive uses an ambiguous tar protocol");
    }
    const typeByte = block[156];
    const type =
      typeByte === 0x00 || typeByte === 0x30
        ? "file"
        : typeByte === 0x35
          ? "directory"
          : typeByte === 0x32
            ? "symlink"
            : undefined;
    if (type === undefined) {
      fail("ERR_OBJECT_TYPE", "Git archive uses an unsupported tar member");
    }
    const name = decodeTarField(block, 0, 100, "tar name");
    const prefix = decodeTarField(block, 345, 155, "tar prefix");
    const path = safeArchivePath(
      prefix.length === 0 ? name : `${prefix}/${name}`,
      type,
    );
    if (paths.has(path)) {
      fail("ERR_OBJECT_TYPE", "Git archive repeats a member path");
    }
    paths.add(path);
    const mode = tarOctal(block, 100, 8, "tar mode");
    const size = tarOctal(block, 124, 12, "tar size");
    const mtime = tarOctal(block, 136, 12, "tar mtime");
    if (mtime !== archiveMtimeSeconds) {
      fail("ERR_OBJECT_TYPE", "Git tar member mtime is not fixed");
    }
    if ((type === "directory" || type === "symlink") && size !== 0) {
      fail("ERR_OBJECT_TYPE", "non-file tar member has content bytes");
    }
    const dataOffset = offset + tarBlockBytes;
    const paddedSize = Math.ceil(size / tarBlockBytes) * tarBlockBytes;
    if (dataOffset + paddedSize > archive.length) {
      fail("ERR_OBJECT_TYPE", "Git archive member exceeds its tar envelope");
    }
    const data = Buffer.from(archive.subarray(dataOffset, dataOffset + size));
    if (
      archive
        .subarray(dataOffset + size, dataOffset + paddedSize)
        .some((byte) => byte !== 0x00)
    ) {
      fail("ERR_OBJECT_TYPE", "Git tar member padding is not exact");
    }
    const rawTarget = decodeTarField(block, 157, 100, "tar link target");
    const target =
      type === "symlink"
        ? safeSymlinkTarget(path, rawTarget)
        : rawTarget.length === 0
          ? null
          : fail("ERR_OBJECT_TYPE", "non-symlink tar member has a link target");
    entries.push(Object.freeze({ path, type, mode, data, target }));
    offset = dataOffset + paddedSize;
  }
  if (!terminated) {
    fail("ERR_OBJECT_TYPE", "Git archive has no exact tar termination");
  }
  return Object.freeze(entries);
}

function exactTreePath(bytes) {
  let path;
  try {
    path = UTF8.decode(bytes);
  } catch (error) {
    fail("ERR_OBJECT_TYPE", error);
  }
  if (!Buffer.from(path, "utf8").equals(bytes)) {
    fail("ERR_OBJECT_TYPE", "submodule tree path has ambiguous encoding");
  }
  return safeArchivePath(path, "file");
}

function gitBlobOid(bytes, width) {
  const algorithm = width === 40 ? "sha1" : "sha256";
  return createHash(algorithm)
    .update(Buffer.from(`blob ${bytes.length}\0`, "ascii"))
    .update(bytes)
    .digest("hex");
}

function bindArchiveToTree(entries, tree, declaration) {
  const expected = new Map();
  for (const treeEntry of tree.entries) {
    const path = exactTreePath(treeEntry.path);
    if (expected.has(path)) {
      fail("ERR_OBJECT_TYPE", "submodule tree repeats a decoded path");
    }
    expected.set(path, treeEntry);
  }
  const observedLeaves = new Set();
  for (const entry of entries) {
    const treeEntry = expected.get(entry.path);
    if (treeEntry === undefined) {
      fail("ERR_OBJECT_TYPE", "Git archive contains a non-tree member");
    }
    if (entry.type === "directory") {
      if (
        treeEntry.mode !== "040000" ||
        treeEntry.type !== "tree" ||
        entry.mode !== 0o775
      ) {
        fail("ERR_OBJECT_TYPE", "Git tar directory does not match its tree");
      }
      continue;
    }
    observedLeaves.add(entry.path);
    if (entry.type === "file") {
      if (
        !["100644", "100755"].includes(treeEntry.mode) ||
        treeEntry.type !== "blob" ||
        gitBlobOid(entry.data, declaration.tree.length) !== treeEntry.oid ||
        entry.mode !== (treeEntry.mode === "100755" ? 0o775 : 0o664)
      ) {
        fail("ERR_OBJECT_TYPE", "Git tar file does not match its blob");
      }
      continue;
    }
    const targetBytes = Buffer.from(entry.target, "utf8");
    if (
      treeEntry.mode !== "120000" ||
      treeEntry.type !== "blob" ||
      entry.mode !== 0o777 ||
      gitBlobOid(targetBytes, declaration.tree.length) !== treeEntry.oid
    ) {
      fail("ERR_OBJECT_TYPE", "Git tar symlink does not match its blob");
    }
  }
  for (const [path, treeEntry] of expected) {
    if (treeEntry.type !== "tree" && !observedLeaves.has(path)) {
      fail("ERR_OBJECT_TYPE", "Git archive omits a frozen tree entry");
    }
  }
}

async function exactDestination(workspace, path) {
  const components = path.split("/");
  let parent = workspace;
  for (const component of components.slice(0, -1)) {
    parent = join(parent, component);
    await exactDirectory(parent, "submodule destination parent");
  }
  const destination = join(parent, components.at(-1));
  if (!contained(workspace, destination)) {
    fail("ERR_RECONSTRUCTION", "submodule destination escapes the candidate");
  }
  try {
    const metadata = await lstat(destination);
    const canonical = await realpath(destination);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      canonical !== destination ||
      (await readdir(destination)).length !== 0
    ) {
      fail(
        "ERR_RECONSTRUCTION",
        "submodule destination is not exact and empty",
      );
    }
    return Object.freeze({
      destination,
      existed: true,
      mode: metadata.mode & 0o777,
    });
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    if (error?.code === "ENOENT") {
      return Object.freeze({ destination, existed: false, mode: null });
    }
    fail("ERR_RECONSTRUCTION", error);
  }
}

async function snapshotRoots(session) {
  const sourceRoot = (await exactDirectory(session.sourceRoot, "source root"))
    .path;
  const temporaryRoot = await exactDirectory(
    session.temporaryRoot,
    "candidate temporary root",
  );
  const workspace = (
    await exactDirectory(session.workspace, "candidate workspace")
  ).path;
  const gitHome = (await exactDirectory(session.gitHome, "candidate Git home"))
    .path;
  if (
    (temporaryRoot.metadata.mode & 0o777) !== 0o700 ||
    !disjoint(sourceRoot, temporaryRoot.path) ||
    !contained(temporaryRoot.path, workspace) ||
    !contained(temporaryRoot.path, gitHome) ||
    !disjoint(workspace, gitHome)
  ) {
    fail("ERR_RECONSTRUCTION", "private submodule roots are not disjoint");
  }
  return Object.freeze({
    sourceRoot,
    temporaryRoot: temporaryRoot.path,
    workspace,
    gitHome,
  });
}

async function verifyExtractedTree(root, tree, declaration) {
  const expected = new Map(
    tree.entries.map((entry) => [exactTreePath(entry.path), entry]),
  );
  const observed = new Set();

  async function walk(directory, prefix = "") {
    const names = await readdir(directory);
    names.sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    for (const name of names) {
      const path = prefix.length === 0 ? name : `${prefix}/${name}`;
      const entry = expected.get(path);
      if (entry === undefined || observed.has(path)) {
        fail("ERR_OBJECT_TYPE", "extracted source contains an extra path");
      }
      observed.add(path);
      const absolute = join(root, ...path.split("/"));
      const metadata = await lstat(absolute);
      if (entry.mode === "040000" && entry.type === "tree") {
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          fail("ERR_OBJECT_TYPE", "extracted tree directory changed type");
        }
        await walk(absolute, path);
      } else if (["100644", "100755"].includes(entry.mode)) {
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          fail("ERR_OBJECT_TYPE", "extracted tree file changed type");
        }
        const bytes = await readFile(absolute);
        if (
          gitBlobOid(bytes, declaration.tree.length) !== entry.oid ||
          ((metadata.mode & 0o111) !== 0) !== (entry.mode === "100755")
        ) {
          fail("ERR_OBJECT_TYPE", "extracted tree file changed identity");
        }
      } else if (entry.mode === "120000" && entry.type === "blob") {
        if (!metadata.isSymbolicLink()) {
          fail("ERR_OBJECT_TYPE", "extracted tree symlink changed type");
        }
        const target = await readlink(absolute);
        if (
          gitBlobOid(Buffer.from(target, "utf8"), declaration.tree.length) !==
          entry.oid
        ) {
          fail("ERR_OBJECT_TYPE", "extracted tree symlink changed identity");
        }
      } else {
        fail(
          "ERR_OBJECT_TYPE",
          "extracted tree contains an unsupported object",
        );
      }
    }
  }

  await walk(root);
  if (observed.size !== expected.size) {
    fail("ERR_OBJECT_TYPE", "extracted source omits a frozen tree path");
  }
}

function archiveFileIdentity(metadata) {
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    nlink: metadata.nlink,
    size: metadata.size,
    mode: metadata.mode,
    uid: metadata.uid,
    gid: metadata.gid,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
  });
}

function sameArchiveFileIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

async function digestArchiveHandle(handle, size) {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < size) {
    const length = Math.min(buffer.length, size - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead !== length) {
      fail(
        "ERR_INTERNAL_FAIL_CLOSED",
        "archive descriptor read was incomplete",
      );
    }
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex");
}

async function createArchiveHandle(stageRoot, archive, retainedHandles) {
  const archivePath = join(stageRoot, "archive.tar");
  let handle;
  try {
    handle = await open(archivePath, "wx+", 0o600);
    await handle.writeFile(archive);
    await handle.sync();
    const metadata = await handle.stat({ bigint: true });
    if (
      metadata.nlink !== 1n ||
      metadata.size !== BigInt(archive.length) ||
      (metadata.mode & 0o777n) !== 0o600n ||
      (await digestArchiveHandle(handle, archive.length)) !== sha256(archive)
    ) {
      fail(
        "ERR_INTERNAL_FAIL_CLOSED",
        "archive descriptor identity is invalid",
      );
    }
    const record = {
      handle,
      identity: archiveFileIdentity(metadata),
      sha256: sha256(archive),
      closed: false,
      retainedHandles,
    };
    retainedHandles.add(handle);
    return record;
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {}
    }
    throw error;
  }
}

async function verifyArchiveHandle(record, expectedBytes) {
  const metadata = await record.handle.stat({ bigint: true });
  if (
    !sameArchiveFileIdentity(record.identity, archiveFileIdentity(metadata)) ||
    metadata.size !== BigInt(expectedBytes) ||
    (await digestArchiveHandle(record.handle, expectedBytes)) !== record.sha256
  ) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "archive descriptor changed during extraction",
    );
  }
}

async function closeArchiveHandle(record) {
  if (record.closed) return;
  await record.handle.close();
  record.closed = true;
  record.retainedHandles.delete(record.handle);
}

async function cleanupSafeAttempt(attempt) {
  for (const record of [...attempt.archiveHandles].reverse()) {
    await closeArchiveHandle(record);
  }
  for (const installation of [...attempt.installations].reverse()) {
    if (installation.installed) {
      await rm(installation.destination, { recursive: true, force: true });
    }
    if (installation.existed) {
      await mkdir(installation.destination, { mode: installation.mode });
      await chmod(installation.destination, installation.mode);
    }
  }
  for (const root of [...attempt.stageRoots].reverse()) {
    await rm(root, { recursive: true, force: true });
  }
}

function invokeSettlement(callback, value) {
  const result = callback(value);
  if (result !== undefined) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "lifecycle settlement must be synchronous",
    );
  }
}

async function materializeOnce(candidate, controller, runners) {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    utilTypes.isProxy(candidate)
  ) {
    fail("ERR_RECONSTRUCTION", "candidate identity is not exact");
  }
  if (controller.attempted.has(candidate)) {
    fail("ERR_RECONSTRUCTION", "submodule materialization is one-shot");
  }
  controller.attempted.add(candidate);
  const session = snapshotSession(controller.claimCandidate(candidate));
  const attempt = {
    cleanupSafe: true,
    stageRoots: [],
    installations: [],
    archiveHandles: [],
  };
  const wallController = new AbortController();
  const wallTimeout = setTimeout(
    () => wallController.abort(),
    materializationWallMs,
  );
  wallTimeout.unref();
  const runGit = (input) =>
    trackedGit(runners, attempt, {
      ...input,
      args: [...sourceGitConfigPrefix, ...input.args],
      signal: wallController.signal,
    });
  const primitives = createTreeV2PrimitivesForTrustedRunner(runGit);

  try {
    if (session.submodules.length === 0) {
      const evidence = Object.freeze([]);
      invokeSettlement(session.complete, evidence);
      return evidence;
    }

    const roots = await snapshotRoots(session);
    const plans = [];
    for (const declaration of session.submodules) {
      const verified = await verifySource({
        declaration,
        roots,
        runGit,
        primitives,
      });
      const destination = await exactDestination(
        roots.workspace,
        declaration.path,
      );
      plans.push(Object.freeze({ ...verified, ...destination }));
    }

    const evidence = [];
    for (const plan of plans) {
      const archive = await runGit({
        args: [
          "archive",
          "--format=tar",
          `--mtime=${archiveMtime}`,
          "--",
          plan.declaration.tree,
        ],
        cwd: plan.source,
        home: roots.gitHome,
        timeoutMs: processTimeoutMs,
        maxOutputBytes: archiveBytesCeiling,
      });
      const tarEntries = parseExactGitTar(archive);
      bindArchiveToTree(tarEntries, plan.tree, plan.declaration);
      await reverifySource(plan, roots, runGit);

      const stageRoot = await mkdtemp(join(roots.temporaryRoot, stagePrefix));
      attempt.stageRoots.push(stageRoot);
      const stageTree = join(stageRoot, "tree");
      await mkdir(stageTree, { mode: 0o700 });
      const archiveHandle = await createArchiveHandle(
        stageRoot,
        archive,
        controller.retainedArchiveHandles,
      );
      attempt.archiveHandles.push(archiveHandle);
      await trackedProcess(runners, attempt, {
        executable: "/usr/bin/tar",
        args: [
          "--extract",
          "--file=/proc/self/fd/3",
          "--directory=.",
          "--no-same-owner",
          "--no-same-permissions",
          "--delay-directory-restore",
          "--no-overwrite-dir",
          "--restrict",
        ],
        cwd: stageTree,
        environment: tarEnvironment,
        timeoutMs: processTimeoutMs,
        maxOutputBytes: processOutputBytesCeiling,
        inheritedFileDescriptors: [archiveHandle.handle.fd],
        signal: wallController.signal,
      });
      await verifyArchiveHandle(archiveHandle, archive.length);
      await verifyExtractedTree(stageTree, plan.tree, plan.declaration);
      const currentDestination = await exactDestination(
        roots.workspace,
        plan.declaration.path,
      );
      if (
        currentDestination.destination !== plan.destination ||
        currentDestination.existed !== plan.existed ||
        currentDestination.mode !== plan.mode
      ) {
        fail(
          "ERR_RECONSTRUCTION",
          "submodule destination changed during staging",
        );
      }

      const installation = {
        destination: plan.destination,
        existed: plan.existed,
        mode: plan.mode,
        installed: false,
      };
      attempt.installations.push(installation);
      if (plan.existed) await rmdir(plan.destination);
      await rename(stageTree, plan.destination);
      installation.installed = true;
      await closeArchiveHandle(archiveHandle);
      await rm(stageRoot, { recursive: true, force: true });
      attempt.stageRoots.splice(attempt.stageRoots.indexOf(stageRoot), 1);
      attempt.archiveHandles.splice(
        attempt.archiveHandles.indexOf(archiveHandle),
        1,
      );
      evidence.push(
        Object.freeze({
          path: plan.declaration.path,
          commit: plan.declaration.commit,
          tree: plan.declaration.tree,
          archiveSha256: sha256(archive),
          method: archiveMethod,
        }),
      );
    }
    const frozenEvidence = Object.freeze(evidence);
    invokeSettlement(session.complete, frozenEvidence);
    return frozenEvidence;
  } catch (error) {
    const detail = privateFailureDigest(error);
    if (!attempt.cleanupSafe) {
      invokeSettlement(session.quarantine, detail);
      throw error;
    }
    try {
      await cleanupSafeAttempt(attempt);
      invokeSettlement(session.failSafe, detail);
    } catch (cleanupError) {
      invokeSettlement(
        session.quarantine,
        sha256(Buffer.from("v2 submodule cleanup failed closed", "utf8")),
      );
      fail("ERR_INTERNAL_FAIL_CLOSED", cleanupError);
    }
    throw error;
  } finally {
    clearTimeout(wallTimeout);
  }
}

function createMaterializer(input, runners, { testing = false } = {}) {
  const controller = snapshotControllerInput(input);
  const state = Object.freeze({
    claimCandidate: controller.claimCandidate,
    attempted: new WeakSet(),
    retainedArchiveHandles: new Set(),
  });
  const materializer = {
    materialize(candidate) {
      return withTaskV2FailureBoundary(() =>
        materializeOnce(candidate, state, runners),
      );
    },
  };
  if (testing) {
    materializer.releaseRetainedForTesting = async () => {
      for (const handle of state.retainedArchiveHandles) await handle.close();
      state.retainedArchiveHandles.clear();
    };
  }
  return Object.freeze(materializer);
}

export function createSubmoduleV2MaterializerForTrustedController(input) {
  return createMaterializer(
    input,
    Object.freeze({
      gitBytesRunner: runGitBytes,
      processBytesRunner: runBoundedProcessBytes,
    }),
  );
}

/** Explicitly test-only runner injection, branded by module-private identity. */
export function createSubmoduleV2TestSeam(value) {
  const input = exactOwnDataRecord(value, "submodule v2 test seam", [
    "gitBytesRunner",
    "processBytesRunner",
  ]);
  const runners = Object.freeze({
    gitBytesRunner: exactFunction(input.gitBytesRunner, "gitBytesRunner"),
    processBytesRunner: exactFunction(
      input.processBytesRunner,
      "processBytesRunner",
    ),
  });
  const seam = Object.freeze(Object.create(null));
  testSeams.set(seam, runners);
  return seam;
}

/** Explicitly test-only controller creation; clones and proxies have no brand. */
export function createSubmoduleV2MaterializerForTesting(input, seam) {
  const runners = testSeams.get(seam);
  if (runners === undefined) {
    throw new TypeError(
      "v2 runner injection requires the exact branded test seam",
    );
  }
  return createMaterializer(input, runners, { testing: true });
}
