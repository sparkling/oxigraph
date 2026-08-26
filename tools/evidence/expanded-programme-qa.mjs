import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { TextDecoder } from "node:util";

import { scrubbedChildEnvironment } from "../child-environment.mjs";
import { parseStrictJson } from "../w3c-tests/strict-json.mjs";

export const expandedProgrammePolicyPath =
  "tools/evidence/expanded-programme-qa-policy.json";
export const expandedProgrammeImplementationPaths = Object.freeze([
  ".gitignore",
  "tools/evidence/expanded-programme-qa-policy.json",
  "tools/evidence/expanded-programme-qa.mjs",
  "tools/evidence/expanded-programme-qa.test.mjs",
  "tools/evidence/run-expanded-programme-qa.mjs",
  "tools/evidence/verify-expanded-programme-qa.mjs",
  "tools/evidence/verify-expanded-programme-qa.test.mjs",
  "tools/evidence/package.json",
  "tools/child-environment.mjs",
  "tools/w3c-tests/strict-json.mjs",
]);

const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const systemGitExecutable = "/usr/bin/git";
const bubblewrapExecutable = "/usr/bin/bwrap";
const rufloSnapshotSchema = "oxigraph.expanded-programme-ruflo-snapshot/v1";
const rufloSnapshotProducer = Object.freeze({
  transport: "native-ruflo-mcp",
  taskInterfaces: ["task_list", "task_status"],
  memoryInterface: "memory_export",
});
const expectedAuthority = Object.freeze({
  claim: "committed programme document and graph consistency at one exact Git subject; Ruflo task-map consistency is observational only",
  semanticQualification: false,
  productImplementation: false,
  promotion: false,
  release: false,
  taskStatusAuthority: false,
  rufloObservationAffectsVerdict: false,
});
const reviewedQuickCommands = Object.freeze([
  {
    id: "evidence-tests",
    program: "node",
    args: ["--test", "--test-reporter=tap", "tools/evidence/normative-clause-inventory.test.mjs", "tools/evidence/normative-control.test.mjs", "tools/evidence/verify-programme.test.mjs", "tools/evidence/expanded-programme-qa.test.mjs", "tools/evidence/verify-expanded-programme-qa.test.mjs"],
    expectedNodeTests: 44,
    timeoutMs: 120000,
  },
  {
    id: "metaharness-tests",
    program: "node",
    args: ["--test", "--test-reporter=tap", "tools/metaharness/evidence.test.mjs", "tools/metaharness/qualification-contract.test.mjs"],
    expectedNodeTests: 13,
    timeoutMs: 120000,
  },
  {
    id: "agentic-adapter-tests",
    program: "node",
    args: ["--test", "--test-reporter=tap", "tools/agentic-qe/execution-provenance.test.mjs", "tools/agentic-qe/path-policy.test.mjs", "tools/agentic-qe/process-runner.test.mjs", "tools/owl2-tests/safe-output.test.mjs"],
    expectedNodeTests: 18,
    timeoutMs: 120000,
  },
  {
    id: "cargo-format",
    program: "cargo",
    args: ["fmt", "--all", "--", "--check"],
    timeoutMs: 120000,
  },
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveReviewedExecutable(rootInput, program) {
  canonicalRoot(rootInput);
  const requestedCanonical = (() => {
    if (!isAbsolute(program)) return null;
    try {
      return realpathSync(program);
    } catch {
      return null;
    }
  })();
  const nodeCanonical = realpathSync(process.execPath);
  let candidates;
  if (program === "node" || requestedCanonical === nodeCanonical) {
    candidates = [process.execPath];
  } else if (program === "cargo") {
    candidates = [
      "/cargo/bin/cargo",
      join(userInfo().homedir, ".cargo", "bin", "cargo"),
      "/usr/bin/cargo",
    ];
  } else if (program === "git" || requestedCanonical === realpathSync(systemGitExecutable)) {
    candidates = [systemGitExecutable];
  } else if (
    program === bubblewrapExecutable ||
    requestedCanonical === realpathSync(bubblewrapExecutable)
  ) {
    candidates = [bubblewrapExecutable];
  } else {
    throw new Error(`executable is not in the reviewed allowlist: ${program}`);
  }
  for (const candidate of candidates) {
    try {
      const metadata = lstatSync(candidate);
      if (!metadata.isFile() && !metadata.isSymbolicLink()) continue;
      const canonical = realpathSync(candidate);
      const canonicalMetadata = lstatSync(canonical);
      if (!canonicalMetadata.isFile()) continue;
      if (process.platform !== "win32" && (canonicalMetadata.mode & 0o111) === 0) continue;
      return {
        invocation: candidate,
        canonical,
        sha256: sha256(readFileSync(canonical)),
      };
    } catch {
      // Continue to the next reviewed executable location.
    }
  }
  throw new Error(`reviewed executable is unavailable: ${program}`);
}

function portable(value) {
  return value.split(sep).join("/");
}

function isInside(root, value, { allowRoot = false } = {}) {
  const child = relative(root, value);
  return (allowRoot && child === "") || (child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function canonicalRoot(root) {
  return realpathSync(resolve(root));
}

function containedPath(root, path, { allowDirectory = false } = {}) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
    throw new Error(`unsafe repository-relative path: ${String(path)}`);
  }
  const requested = resolve(root, path);
  if (!isInside(root, requested)) throw new Error(`path escapes repository: ${path}`);
  const components = relative(root, requested).split(sep);
  let cursor = root;
  for (const component of components) {
    cursor = join(cursor, component);
    const metadata = lstatSync(cursor);
    if (metadata.isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
  }
  const canonical = realpathSync(requested);
  if (!isInside(root, canonical)) throw new Error(`canonical path escapes repository: ${path}`);
  const metadata = lstatSync(canonical);
  if (metadata.isFile() || (allowDirectory && metadata.isDirectory())) return canonical;
  throw new Error(`unsupported repository path type: ${path}`);
}

function readContained(root, path) {
  return readFileSync(containedPath(root, path));
}

function assertNoSymlinkComponents(path) {
  const components = [];
  let cursor = path;
  while (dirname(cursor) !== cursor) {
    components.push(cursor);
    cursor = dirname(cursor);
  }
  for (const component of components.reverse()) {
    if (lstatSync(component).isSymbolicLink()) {
      throw new Error("protected Ruflo snapshot path component must not be a symlink");
    }
  }
}

function readDescriptorSnapshot(descriptor, size) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count === 0) {
      throw new Error("protected Ruflo snapshot ended while reading");
    }
    offset += count;
  }
  return bytes;
}

function textContained(root, path) {
  return utf8Decoder.decode(readContained(root, path));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function fileManifest(root, paths) {
  const files = [...new Set(paths)].sort().map((path) => {
    const bytes = readContained(root, path);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { files, sha256: sha256(canonicalJsonBytes(files)) };
}

export function createRepositoryManifest(rootInput, paths) {
  return fileManifest(canonicalRoot(rootInput), paths);
}

export function readStrictRepositoryJson(rootInput, path) {
  const root = canonicalRoot(rootInput);
  return JSON.parse(JSON.stringify(parseStrictJson(readContained(root, path), path)));
}

function sameRecord(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function strictlySortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function snapshotMemoryMaps(snapshot, policy) {
  const memoryExport = snapshot?.memoryExport;
  if (
    memoryExport?.schema !== "ruflo-memory-export/v1" ||
    memoryExport?.namespace !== policy.ruflo.namespace ||
    !Array.isArray(memoryExport?.entries) ||
    memoryExport.count !== memoryExport.entries.length ||
    !sameArray(
      Object.keys(memoryExport).sort(),
      ["count", "entries", "namespace", "schema"],
    ) ||
    memoryExport.entries.some((entry) =>
      !sameArray(Object.keys(entry ?? {}).sort(), ["key", "namespace", "value"])
    ) ||
    !sameArray(
      memoryExport.entries.map((entry) => entry.key),
      [...policy.ruflo.memoryKeys].sort(),
    )
  ) {
    throw new Error("protected Ruflo memory export contract is invalid");
  }
  const maps = {};
  for (const key of policy.ruflo.memoryKeys) {
    const matches = memoryExport.entries.filter(
      (entry) => entry?.key === key && entry?.namespace === policy.ruflo.namespace,
    );
    if (matches.length !== 1 || typeof matches[0].value !== "string") {
      throw new Error(`protected Ruflo memory export does not contain exactly one ${key}`);
    }
    maps[key] = JSON.parse(JSON.stringify(parseStrictJson(
      Buffer.from(matches[0].value),
      `protected Ruflo memory ${key}`,
    )));
  }
  return maps;
}

export function readProtectedRufloSnapshot(rootInput, pathInput) {
  const root = canonicalRoot(rootInput);
  if (typeof pathInput !== "string" || !isAbsolute(pathInput)) {
    throw new Error("protected Ruflo snapshot path must be absolute");
  }
  const requested = resolve(pathInput);
  assertNoSymlinkComponents(requested);
  const metadata = lstatSync(requested);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("protected Ruflo snapshot must be a regular non-symlink file");
  }
  const canonical = realpathSync(requested);
  if (isInside(root, canonical, { allowRoot: true })) {
    throw new Error("protected Ruflo snapshot must be outside the candidate repository");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o222) !== 0) {
    throw new Error("protected Ruflo snapshot must be read-only");
  }
  if (metadata.size <= 0 || metadata.size > 8 * 1024 * 1024) {
    throw new Error("protected Ruflo snapshot size is invalid");
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new Error("protected Ruflo snapshot requires no-follow file opens");
  }
  const descriptor = openSync(
    requested,
    constants.O_RDONLY |
      constants.O_NOFOLLOW |
      (constants.O_CLOEXEC ?? 0),
  );
  let bytes;
  try {
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.dev !== metadata.dev ||
      before.ino !== metadata.ino ||
      before.size !== metadata.size ||
      (process.platform !== "win32" && (before.mode & 0o222) !== 0)
    ) {
      throw new Error("protected Ruflo snapshot changed before open");
    }
    const first = readDescriptorSnapshot(descriptor, before.size);
    const middle = fstatSync(descriptor);
    const second = readDescriptorSnapshot(descriptor, before.size);
    const after = fstatSync(descriptor);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== middle.mtimeMs ||
      before.ctimeMs !== middle.ctimeMs ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      !first.equals(second)
    ) {
      throw new Error("protected Ruflo snapshot changed while reading");
    }
    bytes = first;
  } finally {
    closeSync(descriptor);
  }
  const snapshot = JSON.parse(JSON.stringify(parseStrictJson(
    bytes,
    "protected Ruflo snapshot",
  )));
  if (
    snapshot?.schema !== rufloSnapshotSchema ||
    !sameRecord(snapshot?.producer, rufloSnapshotProducer) ||
    !Array.isArray(snapshot?.tasks) ||
    snapshot.tasks.length > 1_000 ||
    snapshot.tasks.some((task) =>
      !sameArray(Object.keys(task ?? {}).sort(), ["description", "tags", "taskId"]) ||
      typeof task.taskId !== "string" ||
      typeof task.description !== "string" ||
      !Array.isArray(task.tags) ||
      task.tags.some((tag) => typeof tag !== "string") ||
      !strictlySortedUnique(task.tags)
    ) ||
    !strictlySortedUnique(snapshot.tasks.map((task) => task.taskId)) ||
    !sameArray(Object.keys(snapshot).sort(), ["memoryExport", "producer", "schema", "tasks"])
  ) {
    throw new Error("protected Ruflo snapshot contract is invalid");
  }
  if (!bytes.equals(canonicalJsonBytes(snapshot))) {
    throw new Error("protected Ruflo snapshot bytes are not canonical");
  }
  return {
    snapshot,
    binding: {
      schema: snapshot.schema,
      producer: structuredClone(snapshot.producer),
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
  };
}

function normalizeCell(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/`/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function tableCells(line) {
  if (!line.trim().startsWith("|")) return null;
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map(normalizeCell);
}

function section(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex === -1) return "";
  const endIndex = text.indexOf(end, startIndex + start.length);
  return text.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

function parseAdr(path, text) {
  const heading = /^# (ADR-\d{4}): (.+)$/mu.exec(text);
  const metadata = {};
  for (const match of text.matchAll(/^- ([A-Za-z][A-Za-z ]+):\s*(.+)$/gmu)) {
    metadata[match[1]] = match[2].trim();
  }
  return {
    id: heading?.[1] ?? null,
    file: path,
    title: heading?.[2] ?? null,
    status: metadata.Status ?? null,
    metadata,
    headings: [...text.matchAll(/^## (.+)$/gmu)].map((match) => match[1].trim()),
  };
}

function parseAdrIndex(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/u)) {
    const cells = tableCells(line);
    if (!cells || cells.length < 2) continue;
    const match = /^ADR-(\d{4}) — (.+)$/u.exec(cells[0]);
    const target = /\((\d{4}-[^)#?]+\.md)(?:#[^)]+)?\)/u.exec(line)?.[1];
    if (!match || !target) continue;
    rows.push({
      id: `ADR-${match[1]}`,
      file: `docs/adr/${target}`,
      title: match[2],
      status: cells[1],
    });
  }
  return rows;
}

function parseTaskSection(text, start, end, dependencyColumn) {
  const rows = [];
  for (const line of section(text, start, end).split(/\r?\n/u)) {
    const cells = tableCells(line);
    if (!cells || cells.length <= dependencyColumn) continue;
    const match = /^(G[0-4]\.\d+[a-z]?)\b/u.exec(cells[0]);
    if (!match) continue;
    rows.push({ id: match[1], dependencyText: cells[dependencyColumn] });
  }
  return rows;
}

function parseTasks(text) {
  return [
    ...parseTaskSection(text, "### G0 —", "### G1 —", 3),
    ...parseTaskSection(text, "### G1 —", "### G1 application", 1),
    ...parseTaskSection(text, "### G2 —", "### G3 —", 1),
    ...parseTaskSection(text, "### G3 —", "### G4 —", 1),
    ...parseTaskSection(text, "### G4 —", "## Evaluator DAG", 1),
  ];
}

function expectedOwnership(policy) {
  const ownership = {};
  for (const row of policy.ownershipRows) {
    for (const task of row.tasks) ownership[task] = [...row.owners];
  }
  return ownership;
}

function taskIdParts(id) {
  const match = /^G(\d+)\.(\d+)([a-z]?)$/u.exec(id);
  return match
    ? [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), match[3]]
    : null;
}

function compareTaskIds(left, right) {
  const leftParts = taskIdParts(left);
  const rightParts = taskIdParts(right);
  if (!leftParts || !rightParts) return left < right ? -1 : left > right ? 1 : 0;
  return leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] ||
    (leftParts[2] < rightParts[2] ? -1 : leftParts[2] > rightParts[2] ? 1 : 0);
}

export function parseProgrammeDependencies(value, availableTaskIds) {
  const available = [...new Set(availableTaskIds)].sort(compareTaskIds);
  const dependencies = [];
  const append = (id) => {
    if (!dependencies.includes(id)) dependencies.push(id);
  };
  for (const match of String(value).matchAll(
    /\b(G\d+\.\d+[a-z]?)\s*-\s*(G\d+\.\d+[a-z]?)\b|\b(G\d+\.\d+[a-z]?)\b|HARNESS-REGISTRY/gu,
  )) {
    if (match[1] && match[2]) {
      const start = match[1];
      const end = match[2];
      const startParts = taskIdParts(start);
      const endParts = taskIdParts(end);
      if (startParts && endParts && startParts[0] === endParts[0]) {
        for (const id of available) {
          if (compareTaskIds(id, start) >= 0 && compareTaskIds(id, end) <= 0) append(id);
        }
      } else {
        append(start);
        append(end);
      }
    } else {
      append(match[3] ?? match[0]);
    }
  }
  return dependencies;
}

function parseOwnership(text, taskIds) {
  const ownershipText = section(text, "### ADR ownership map", "### G0 —");
  const sourceRows = [];
  const ownership = {};
  for (const line of ownershipText.split(/\r?\n/u)) {
    const cells = tableCells(line);
    if (!cells || cells.length < 2 || !/^G[0-4]\./u.test(cells[0])) continue;
    const owners = [...cells[1].matchAll(/ADR-\d{4}/gu)].map((match) => match[0]);
    sourceRows.push({ label: cells[0], owners });
    for (const task of parseProgrammeDependencies(cells[0], taskIds)) {
      if (taskIds.includes(task)) ownership[task] = [...owners];
    }
  }
  return { ownership, sourceRows };
}

function headingSlug(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/&[a-z0-9#]+;/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function markdownAnchors(text) {
  const counts = new Map();
  const anchors = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const base = headingSlug(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function localLinkError(root, sourcePath, rawTarget, anchors) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawTarget.replace(/^<|>$/gu, ""));
  } catch {
    return { code: "LINK_ENCODING", path: sourcePath, target: rawTarget };
  }
  const hashIndex = decoded.indexOf("#");
  const targetPart = (hashIndex === -1 ? decoded : decoded.slice(0, hashIndex)).split("?", 1)[0];
  const fragment = hashIndex === -1 ? "" : decoded.slice(hashIndex + 1);
  const sourceAbsolute = resolve(root, sourcePath);
  const targetAbsolute = targetPart
    ? resolve(dirname(sourceAbsolute), targetPart)
    : sourceAbsolute;
  if (!isInside(root, targetAbsolute)) {
    return { code: "LINK_ESCAPE", path: sourcePath, target: rawTarget };
  }
  const targetRelative = portable(relative(root, targetAbsolute));
  if (!existsSync(targetAbsolute)) {
    return { code: "LINK_MISSING", path: sourcePath, target: rawTarget };
  }
  try {
    containedPath(root, targetRelative, { allowDirectory: true });
  } catch (error) {
    return {
      code: String(error.message).includes("symlink") ? "LINK_SYMLINK" : "LINK_UNSAFE",
      path: sourcePath,
      target: rawTarget,
    };
  }
  if (fragment) {
    const metadata = lstatSync(targetAbsolute);
    if (!metadata.isFile() || !/\.md$/iu.test(targetRelative)) {
      return { code: "ANCHOR_TARGET", path: sourcePath, target: rawTarget };
    }
    let targetAnchors = anchors.get(targetRelative);
    if (!targetAnchors) {
      targetAnchors = markdownAnchors(textContained(root, targetRelative));
      anchors.set(targetRelative, targetAnchors);
    }
    if (!targetAnchors.has(fragment.toLowerCase())) {
      return { code: "ANCHOR_MISSING", path: sourcePath, target: rawTarget };
    }
  }
  return null;
}

export function validateMarkdownLinks(rootInput, documents) {
  const root = canonicalRoot(rootInput);
  const errors = [];
  const anchors = new Map();
  let checked = 0;
  for (const sourcePath of documents) {
    const text = textContained(root, sourcePath);
    const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/gu;
    for (const match of text.matchAll(linkPattern)) {
      const rawTarget = match[1];
      checked += 1;
      if (/^[a-z][a-z0-9+.-]*:/iu.test(rawTarget) || rawTarget.startsWith("//")) {
        try {
          new URL(rawTarget, "https://local.invalid/");
        } catch {
          errors.push({ code: "EXTERNAL_URL", path: sourcePath, target: rawTarget });
        }
        continue;
      }
      const error = localLinkError(root, sourcePath, rawTarget, anchors);
      if (error) errors.push(error);
    }
  }
  return { checked, errors };
}

export function validateDocumentBytes(path, bytes) {
  const errors = [];
  let text;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    return [{ code: "UTF8", path }];
  }
  if (text.includes("\0")) errors.push({ code: "NUL_BYTE", path });
  if (/^(?:<{7}|={7}|>{7})(?: |$)/mu.test(text)) {
    errors.push({ code: "CONFLICT_MARKER", path });
  }
  if (/[\t ]+$/mu.test(text)) errors.push({ code: "TRAILING_WHITESPACE", path });
  if (!text.endsWith("\n")) errors.push({ code: "FINAL_NEWLINE", path });
  if (path.endsWith(".json")) {
    try {
      parseStrictJson(bytes, path);
    } catch {
      errors.push({ code: "STRICT_JSON", path });
    }
  }
  return errors;
}

function gitSubject(root) {
  const executable = resolveReviewedExecutable(root, "git");
  const value = (args) =>
    execFileSync(executable.invocation, [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      ...args,
    ], {
      cwd: root,
      encoding: "utf8",
      env: scrubbedChildEnvironment({
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      }),
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }).trim();
  const indexFlagsClean = value(["ls-files", "-v"])
    .split(/\r?\n/u)
    .filter(Boolean)
    .every((line) => line.startsWith("H "));
  return {
    commit: value(["rev-parse", "HEAD"]),
    tree: value(["rev-parse", "HEAD^{tree}"]),
    trackedClean:
      indexFlagsClean &&
      value(["status", "--porcelain=v1", "--untracked-files=all"]) === "",
  };
}

export function readExpandedProgrammeGitSubject(rootInput) {
  return gitSubject(canonicalRoot(rootInput));
}

export function loadExpandedProgrammePolicy(
  rootInput,
  path = expandedProgrammePolicyPath,
) {
  const root = canonicalRoot(rootInput);
  const parsed = parseStrictJson(readContained(root, path), path);
  const policy = JSON.parse(JSON.stringify(parsed));
  if (policy?.schema !== "oxigraph.expanded-programme-qa-policy/v2") {
    throw new Error("expanded programme QA policy schema is invalid");
  }
  if (Object.values(policy.assertionWeights).reduce((sum, value) => sum + value, 0) !== 98) {
    throw new Error("expanded programme QA committed-source weights must total 98");
  }
  if (Object.keys(policy.tasks).length !== 39 || policy.adrs.length !== 16) {
    throw new Error("expanded programme QA policy inventory is invalid");
  }
  if (!sameRecord(policy.authority, expectedAuthority)) {
    throw new Error("expanded programme QA authority contract is invalid");
  }
  if (!sameRecord(policy.quickCommands, reviewedQuickCommands)) {
    throw new Error("expanded programme QA command allowlist is invalid");
  }
  if (
    policy.ruflo?.snapshotSchema !== rufloSnapshotSchema ||
    !sameArray(
      Object.keys(policy.ruflo).sort(),
      ["controlRows", "memoryKeys", "namespace", "rollupRows", "snapshotSchema", "stableRows"],
    )
  ) {
    throw new Error("expanded programme QA Ruflo snapshot policy is invalid");
  }
  return policy;
}

export function collectProgrammeModel(rootInput, policy) {
  const root = canonicalRoot(rootInput);
  const planPath = "docs/plans/linked-data-store-evolution-harness-plan.md";
  const plan = textContained(root, planPath);
  const documents = Object.fromEntries(
    policy.sourceDocuments.map((path) => [path, textContained(root, path)]),
  );
  const adrs = policy.adrs.map((item) => parseAdr(item.file, documents[item.file]));
  const indexRows = parseAdrIndex(documents["docs/adr/README.md"]);
  const allAdrFiles = readdirSync(containedPath(root, "docs/adr", { allowDirectory: true }))
    .filter((name) => /^\d{4}-.*\.md$/u.test(name))
    .map((name) => `docs/adr/${name}`)
    .sort();
  const tasks = parseTasks(plan);
  const taskIds = tasks.map((task) => task.id);
  const parsedOwnership = parseOwnership(plan, taskIds);
  const controlEdges = {};
  const controlRows = [];
  for (const match of plan.matchAll(/\b(G\d+\.\d+[a-z]?)\s*→\s*`?(HARNESS-[A-Z-]+)`?\s*→\s*(G\d+\.\d+[a-z]?)/gu)) {
    const control = {
      id: match[2],
      dependencies: [match[1]],
      blocks: [match[3]],
    };
    controlRows.push(control);
    controlEdges[control.id] = {
      dependencies: control.dependencies,
      blocks: control.blocks,
    };
  }
  const documentErrors = [expandedProgrammePolicyPath, ...policy.sourceDocuments]
    .flatMap((path) => validateDocumentBytes(path, readContained(root, path)));
  const links = validateMarkdownLinks(root, policy.sourceDocuments);
  const claims = policy.claims.map((claim) => ({
    ...claim,
    present: documents[claim.path]?.includes(claim.text) === true,
  }));
  return {
    subject: null,
    inputManifest: fileManifest(root, [expandedProgrammePolicyPath, ...policy.sourceDocuments]),
    adrs,
    allAdrFiles,
    indexRows,
    tasks,
    dependencies: Object.fromEntries(
      tasks.map((task) => [task.id, parseProgrammeDependencies(task.dependencyText, taskIds)]),
    ),
    controls: controlEdges,
    controlRows,
    ownership: parsedOwnership.ownership,
    ownershipRows: parsedOwnership.sourceRows,
    claims,
    documentErrors,
    linkErrors: links.errors,
    checkedLinks: links.checked,
  };
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueIds(values) {
  return new Set(values).size === values.length;
}

function assertion(policy, id, errors, evidence) {
  return {
    id,
    category: id.split(".", 1)[0],
    authority: "committed-source",
    mandatory: true,
    weight: policy.assertionWeights[id],
    status: errors.length === 0 ? "PASS" : "FAIL",
    evidence,
    diagnostics: errors.sort(),
  };
}

function graphErrors(model, policy) {
  const errors = [];
  const stable = new Set(Object.keys(policy.tasks));
  const controls = new Set(Object.keys(policy.controls));
  const allowed = new Set([...stable, ...controls]);
  const graph = { ...model.dependencies };
  const controlRows = Array.isArray(model.controlRows) ? model.controlRows : [];
  if (controlRows.length !== controls.size) {
    errors.push("source control-edge row count drift");
  }
  if (!uniqueIds(controlRows.map((row) => row.id))) {
    errors.push("duplicate source control edge");
  }
  for (const [id, control] of Object.entries(model.controls ?? {})) {
    graph[id] = [...control.dependencies];
  }
  for (const [id, expected] of Object.entries(policy.controls)) {
    if (!sameRecord(model.controls?.[id], expected)) {
      errors.push(`${id}: source control-edge drift`);
    }
  }
  for (const [id, expected] of Object.entries(policy.tasks)) {
    const observed = model.dependencies[id];
    if (!sameArray(observed, expected.dependencies)) errors.push(`${id}: dependency policy drift`);
    if (!Array.isArray(observed)) continue;
    if (!uniqueIds(observed)) errors.push(`${id}: duplicate dependency`);
    for (const dependency of observed) {
      if (!allowed.has(dependency)) errors.push(`${id}: unknown dependency ${dependency}`);
      if (dependency === id) errors.push(`${id}: self dependency`);
    }
    const source = model.tasks.find((row) => row.id === id);
    if (source?.dependencyText !== expected.sourceDependencies) {
      errors.push(`${id}: source dependency text drift`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      errors.push(`dependency cycle at ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph[id] ?? []) {
      if (allowed.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of allowed) visit(id);
  return errors;
}

export function validateProgrammeModel(model, policy) {
  const assertions = [];
  const expectedAdrs = new Map(policy.adrs.map((item) => [item.id, item]));
  const adrIds = model.adrs.map((item) => item.id);
  const corpusErrors = [];
  if (!uniqueIds(adrIds)) corpusErrors.push("duplicate ADR identifier");
  if (model.adrs.length !== policy.adrs.length) corpusErrors.push("ADR count drift");
  for (const adr of model.adrs) {
    const expected = expectedAdrs.get(adr.id);
    if (!expected) corpusErrors.push(`unexpected ADR ${adr.id}`);
    else if (adr.file !== expected.file || adr.title !== expected.title) {
      corpusErrors.push(`${adr.id}: file or title drift`);
    }
  }
  assertions.push(assertion(policy, "adr.corpus", corpusErrors, { adrCount: model.adrs.length }));

  const structureErrors = [];
  for (const adr of model.adrs) {
    const expected = expectedAdrs.get(adr.id);
    if (!expected) continue;
    if (adr.status !== expected.status) structureErrors.push(`${adr.id}: status drift`);
    for (const key of ["Status", "Date", "Updated"]) {
      if (!adr.metadata[key]) structureErrors.push(`${adr.id}: missing ${key}`);
    }
    const headings = policy.headingProfiles[expected.headingProfile];
    if (!sameArray(adr.headings, headings)) structureErrors.push(`${adr.id}: heading drift`);
  }
  assertions.push(assertion(policy, "adr.structure-status", structureErrors, { proposed: model.adrs.filter((adr) => adr.status === "Proposed").length }));

  const indexErrors = [];
  if (model.allAdrFiles.length !== policy.indexedAdrCount) indexErrors.push("numbered ADR file count drift");
  if (model.indexRows.length !== policy.indexedAdrCount) indexErrors.push("ADR index row count drift");
  const expectedIndexedAdrIds = Array.from(
    { length: policy.indexedAdrCount },
    (_, index) => `ADR-${String(index + 1).padStart(4, "0")}`,
  );
  const numberedAdrIds = model.allAdrFiles.map(
    (file) => `ADR-${/^docs\/adr\/(\d{4})-/u.exec(file)?.[1] ?? "invalid"}`,
  );
  const indexIds = model.indexRows.map((row) => row.id);
  if (!sameArray(numberedAdrIds, expectedIndexedAdrIds)) {
    indexErrors.push("numbered ADR identifier set drift");
  }
  if (!uniqueIds(indexIds) || !sameArray([...indexIds].sort(), expectedIndexedAdrIds)) {
    indexErrors.push("ADR index identifier set drift");
  }
  const indexedFiles = model.indexRows.map((row) => row.file).sort();
  if (!sameArray(indexedFiles, model.allAdrFiles)) indexErrors.push("ADR index file set drift");
  for (const row of model.indexRows) {
    const fileId = `ADR-${/^docs\/adr\/(\d{4})-/u.exec(row.file)?.[1] ?? "invalid"}`;
    if (row.id !== fileId) indexErrors.push(`${row.id}: ADR index identifier/file drift`);
  }
  const indexById = new Map(model.indexRows.map((row) => [row.id, row]));
  for (const expected of policy.adrs) {
    const row = indexById.get(expected.id);
    if (!row || row.file !== expected.file || row.title !== expected.title || row.status !== expected.status) {
      indexErrors.push(`${expected.id}: index parity drift`);
    }
  }
  assertions.push(assertion(policy, "adr.index-title-status-parity", indexErrors, { indexedAdrCount: model.indexRows.length }));

  const taskErrors = [];
  const expectedTaskIds = Object.keys(policy.tasks);
  const taskIds = model.tasks.map((row) => row.id);
  if (!uniqueIds(taskIds)) taskErrors.push("duplicate stable G identifier");
  if (!sameArray([...taskIds].sort(), [...expectedTaskIds].sort())) taskErrors.push("stable G identifier set drift");
  const phaseCounts = Object.fromEntries(
    Object.keys(policy.phaseCounts).map((phase) => [phase, taskIds.filter((id) => id.startsWith(`${phase}.`)).length]),
  );
  if (JSON.stringify(phaseCounts) !== JSON.stringify(policy.phaseCounts)) taskErrors.push("phase count drift");
  assertions.push(assertion(policy, "goap.stable-id-set", taskErrors, { stableGCount: taskIds.length, phaseCounts }));

  const dependenciesErrors = graphErrors(model, policy);
  assertions.push(assertion(policy, "goap.dependencies-dag", dependenciesErrors, { nodes: expectedTaskIds.length + Object.keys(policy.controls).length }));

  const ownershipErrors = [];
  const forbiddenStable = new Set([...Object.keys(policy.rollups), ...Object.keys(policy.controls)]);
  for (const id of taskIds) {
    if (forbiddenStable.has(id)) ownershipErrors.push(`${id}: control or rollup promoted to stable task`);
  }
  const expectedOwners = expectedOwnership(policy);
  for (const id of expectedTaskIds) {
    if (!sameArray(model.ownership[id], expectedOwners[id])) ownershipErrors.push(`${id}: ownership drift`);
  }
  const expectedRows = policy.ownershipRows.map((row) => ({ label: row.label, owners: row.owners }));
  if (JSON.stringify(model.ownershipRows) !== JSON.stringify(expectedRows)) ownershipErrors.push("ownership source table drift");
  assertions.push(assertion(policy, "goap.ownership-rollups-controls", ownershipErrors, { rollups: Object.keys(policy.rollups), controls: Object.keys(policy.controls) }));

  assertions.push(assertion(policy, "documents.local-links-and-anchors", model.linkErrors.map((item) => `${item.code}:${item.path}:${item.target}`), { checkedLinks: model.checkedLinks }));

  const documentErrors = [
    ...model.documentErrors.map((item) => `${item.code}:${item.path}`),
    ...model.claims.filter((claim) => !claim.present).map((claim) => `missing claim:${claim.path}`),
  ];
  assertions.push(assertion(policy, "documents.format-and-strict-json", documentErrors, { documents: policy.sourceDocuments.length, claims: model.claims.length }));

  const controlErrors = [];
  if (!gitObjectPattern.test(model.subject?.commit ?? "")) controlErrors.push("invalid Git commit");
  if (!gitObjectPattern.test(model.subject?.tree ?? "")) controlErrors.push("invalid Git tree");
  if (model.subject?.trackedClean !== true) controlErrors.push("tracked worktree is dirty");
  if (!sha256Pattern.test(model.inputManifest?.sha256 ?? "")) controlErrors.push("invalid input manifest");
  assertions.unshift(assertion(policy, "control.exact-subject-and-inputs", controlErrors, { commit: model.subject?.commit ?? null, tree: model.subject?.tree ?? null, inputManifestSha256: model.inputManifest?.sha256 ?? null }));

  const score = assertions.filter((item) => item.status === "PASS").reduce((sum, item) => sum + item.weight, 0);
  return {
    ok: assertions.every((item) => item.status === "PASS"),
    score,
    assertions,
    scope: {
      adrIds: policy.adrs.map((item) => item.id),
      adrCount: policy.adrs.length,
      stableGIds: expectedTaskIds,
      stableGCount: expectedTaskIds.length,
      phaseCounts: policy.phaseCounts,
      rollups: Object.keys(policy.rollups),
      controls: Object.keys(policy.controls),
    },
  };
}

export function validateExpandedProgramme(
  rootInput,
  { policy = loadExpandedProgrammePolicy(rootInput), subject = null } = {},
) {
  const root = canonicalRoot(rootInput);
  const model = collectProgrammeModel(root, policy);
  model.subject = subject ?? gitSubject(root);
  return { ...validateProgrammeModel(model, policy), model };
}

export function receiptBytesSha256(value) {
  return sha256(canonicalJsonBytes(value));
}

export function trackedCleanFromPorcelain(value) {
  return String(value).trim() === "";
}

function taskValues(store) {
  if (Array.isArray(store?.tasks)) return store.tasks;
  if (store?.tasks && typeof store.tasks === "object") return Object.values(store.tasks);
  return [];
}

export function normalizeTaskStore(store, policy) {
  const stable = new Set(Object.keys(policy.tasks));
  const rollups = new Set(Object.keys(policy.rollups));
  const controls = new Set(Object.keys(policy.controls));
  const records = [];
  const errors = [];
  for (const task of taskValues(store)) {
    const tags = Array.isArray(task?.tags) ? task.tags : [];
    const planTags = tags.filter((tag) => typeof tag === "string" && tag.startsWith("plan:"));
    for (const tag of planTags) {
      const planId = tag.slice("plan:".length);
      if (!/^G[0-9]\.\d+[a-z]?$/u.test(planId)) continue;
      records.push({
        kind: stable.has(planId) ? "stable" : rollups.has(planId) ? "rollup" : "unknown",
        planId,
        taskId: typeof task.taskId === "string" ? task.taskId : null,
      });
    }
    const isControl =
      typeof task?.description === "string" &&
      task.description.startsWith("[HARNESS-REGISTRY]");
    if (isControl || tags.includes("harness:static-registry")) {
      records.push({
        kind: controls.has("HARNESS-REGISTRY") ? "control" : "unknown",
        planId: "HARNESS-REGISTRY",
        taskId: typeof task.taskId === "string" ? task.taskId : null,
      });
    }
  }
  records.sort((left, right) =>
    compareStrings(`${left.planId}:${left.taskId}`, `${right.planId}:${right.taskId}`),
  );
  const ids = records.map((record) => record.planId);
  if (new Set(ids).size !== ids.length) errors.push("duplicate programme task mapping");
  for (const record of records) {
    if (record.kind === "unknown") errors.push(`unknown programme task mapping ${record.planId}`);
    if (!record.taskId) errors.push(`missing Ruflo task ID for ${record.planId}`);
  }
  const counts = {
    stable: records.filter((record) => record.kind === "stable").length,
    rollup: records.filter((record) => record.kind === "rollup").length,
    control: records.filter((record) => record.kind === "control").length,
  };
  if (counts.stable !== policy.ruflo.stableRows) errors.push("stable Ruflo row count drift");
  if (counts.rollup !== policy.ruflo.rollupRows) errors.push("rollup Ruflo row count drift");
  if (counts.control !== policy.ruflo.controlRows) errors.push("control Ruflo row count drift");
  return { records, counts, errors: [...new Set(errors)].sort(), sha256: sha256(canonicalJsonBytes(records)) };
}

function findObjectProperty(value, names, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const name of names) {
    const candidate = value[name];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  for (const candidate of Object.values(value)) {
    const found = findObjectProperty(candidate, names, seen);
    if (found) return found;
  }
  return null;
}

function exactRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function observeRufloState({
  policy,
  taskStore,
  memoryMaps,
  runtime = null,
  snapshot = null,
}) {
  const authority = "non-authoritative-local-audit";
  if (!taskStore || !memoryMaps) {
    return {
      authority,
      disposition: "UNAVAILABLE",
      memoryKeys: [...policy.ruflo.memoryKeys],
      mapValueHashes: [],
      taskProjectionHash: null,
      stableRows: null,
      rollupRows: null,
      controlRows: null,
      runtime,
      snapshot,
      diagnostics: ["protected public-interface Ruflo snapshot is unavailable"],
    };
  }
  const projection = normalizeTaskStore(taskStore, policy);
  const errors = [...projection.errors];
  const mapValueHashes = [];
  for (const key of policy.ruflo.memoryKeys) {
    if (!(key in memoryMaps)) errors.push(`missing Ruflo memory map ${key}`);
    else mapValueHashes.push({ key, sha256: sha256(canonicalJsonBytes(memoryMaps[key])) });
  }
  const latestKey = policy.ruflo.memoryKeys.at(-1);
  const latest = memoryMaps[latestKey];
  const dependencies = findObjectProperty(latest, ["dependencies", "dependencyGraph", "adjacency"]);
  const expectedDependencies = {
    ...Object.fromEntries(
      Object.entries(policy.tasks).map(([id, task]) => [id, task.dependencies]),
    ),
    ...Object.fromEntries(
      Object.entries(policy.controls).map(([id, control]) => [id, control.dependencies]),
    ),
  };
  if (!dependencies) {
    errors.push("corrected Ruflo dependency map is missing");
  } else {
    const observedIds = Object.keys(dependencies).filter((id) => id in expectedDependencies).sort();
    if (!sameArray(observedIds, Object.keys(expectedDependencies).sort())) {
      errors.push("corrected Ruflo dependency node set drift");
    }
    for (const [id, expected] of Object.entries(expectedDependencies)) {
      if (!exactRecord(dependencies[id], expected)) errors.push(`${id}: corrected Ruflo dependency drift`);
    }
  }
  const taskIds = {};
  for (const value of Object.values(memoryMaps)) {
    Object.assign(taskIds, findObjectProperty(value, ["taskIds", "rufloTaskIds", "taskMap"]) ?? {});
  }
  const projectedTaskIds = Object.fromEntries(
    projection.records.map((record) => [record.planId, record.taskId]),
  );
  if (!exactRecord(
    Object.fromEntries(Object.entries(taskIds).sort(([left], [right]) => compareStrings(left, right))),
    Object.fromEntries(Object.entries(projectedTaskIds).sort(([left], [right]) => compareStrings(left, right))),
  )) {
    errors.push("Ruflo memory/task-store pointer drift");
  }
  return {
    authority,
    disposition: errors.length === 0 ? "MATCH" : "MISMATCH",
    memoryKeys: [...policy.ruflo.memoryKeys],
    mapValueHashes: mapValueHashes.sort((left, right) => compareStrings(left.key, right.key)),
    taskProjectionHash: projection.sha256,
    stableRows: projection.counts.stable,
    rollupRows: projection.counts.rollup,
    controlRows: projection.counts.control,
    runtime,
    snapshot,
    diagnostics: [...new Set(errors)].sort(),
  };
}

export function observeProtectedRufloSnapshot({ policy, snapshot, binding }) {
  if (!snapshot || !binding) {
    return observeRufloState({
      policy,
      taskStore: null,
      memoryMaps: null,
      snapshot: null,
    });
  }
  const memoryMaps = snapshotMemoryMaps(snapshot, policy);
  return observeRufloState({
    policy,
    taskStore: { tasks: snapshot.tasks },
    memoryMaps,
    runtime: {
      transport: snapshot.producer.transport,
      taskInterfaces: [...snapshot.producer.taskInterfaces],
      memoryInterface: snapshot.producer.memoryInterface,
    },
    snapshot: binding,
  });
}

export function classifyQaVerdict({
  sourceOk,
  commandsDisposition,
}) {
  if (!sourceOk || commandsDisposition === "FAIL") {
    return { verdict: "FAIL", exitCode: 1 };
  }
  if (commandsDisposition !== "PASS") {
    return { verdict: "INCONCLUSIVE", exitCode: 2 };
  }
  return { verdict: "PASS", exitCode: 0 };
}

function commandDisposition(commands, expectedCount) {
  if (Array.isArray(commands) && commands.some((command) => command.disposition === "FAIL")) return "FAIL";
  if (!Array.isArray(commands) || commands.length !== expectedCount) return "INCONCLUSIVE";
  if (commands.some((command) => command.disposition !== "PASS")) return "INCONCLUSIVE";
  return "PASS";
}

export function buildExpandedProgrammeReceipt({
  policy,
  source,
  commands,
  rufloObservation,
  implementation,
}) {
  const commandsState = commandDisposition(commands, policy.quickCommands.length);
  const toolingStatus = commandsState;
  const toolingAssertion = {
    id: "tooling.bounded-contracts",
    category: "tooling",
    authority: "committed-source",
    mandatory: true,
    weight: policy.assertionWeights["tooling.bounded-contracts"],
    status: toolingStatus,
    evidence: { commands: commands?.length ?? 0 },
    diagnostics: commands
      .filter((command) => command.disposition !== "PASS")
      .map((command) => `${command.id}:${command.failureClass ?? command.disposition}`)
      .sort(),
  };
  const assertions = [...source.assertions, toolingAssertion];
  const committedScore = assertions
    .filter((item) => item.status === "PASS")
    .reduce((sum, item) => sum + item.weight, 0);
  const observationalScore = rufloObservation.disposition === "MATCH" ? 2 : 0;
  const classification = classifyQaVerdict({
    sourceOk: source.ok,
    commandsDisposition: commandsState,
  });
  const policyFile = source.model.inputManifest.files.find(
    (file) => file.path === expandedProgrammePolicyPath,
  );
  return {
    schema: "oxigraph.expanded-programme-qa/v2",
    programme: policy.programme,
    subject: {
      commit: source.model.subject.commit,
      tree: source.model.subject.tree,
      trackedClean: source.model.subject.trackedClean,
      policy: { path: expandedProgrammePolicyPath, sha256: policyFile.sha256 },
      implementation,
      inputs: source.model.inputManifest,
    },
    scope: source.scope,
    assertions,
    commands,
    rufloObservation,
    score: {
      source: committedScore,
      observational: observationalScore,
      total: committedScore + observationalScore,
      threshold: 98,
      criticalFailure: classification.verdict === "FAIL",
    },
    verdict: classification.verdict,
    authority: structuredClone(policy.authority),
  };
}

function ensurePublicationDirectory(root, path) {
  const child = relative(root, path);
  if (!isInside(root, path)) throw new Error("receipt publication escapes root");
  let cursor = root;
  for (const component of child.split(sep)) {
    cursor = join(cursor, component);
    if (existsSync(cursor)) {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`unsafe receipt publication directory: ${portable(relative(root, cursor))}`);
      }
    } else {
      mkdirSync(cursor, { mode: 0o700 });
    }
  }
}

export function publishExpandedProgrammeReceipt(rootInput, receipt) {
  const root = canonicalRoot(rootInput);
  if (!gitObjectPattern.test(receipt?.subject?.commit ?? "")) {
    throw new Error("receipt subject commit is invalid");
  }
  const bytes = canonicalJsonBytes(receipt);
  const digest = sha256(bytes);
  const directory = resolve(
    root,
    "target",
    "programme-qa",
    "runs",
    receipt.subject.commit,
    digest,
  );
  ensurePublicationDirectory(root, directory);
  const path = join(directory, "receipt.json");
  if (existsSync(path)) {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("existing receipt path is unsafe");
    }
    if (!readFileSync(path).equals(bytes)) throw new Error("immutable receipt collision");
    return { path, sha256: digest, bytes, idempotent: true };
  }
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return { path, sha256: digest, bytes, idempotent: false };
}
