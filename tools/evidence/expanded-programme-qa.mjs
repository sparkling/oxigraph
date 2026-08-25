import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { TextDecoder } from "node:util";

import { parseStrictJson } from "../w3c-tests/strict-json.mjs";

export const expandedProgrammePolicyPath =
  "tools/evidence/expanded-programme-qa-policy.json";
export const expandedProgrammeImplementationPaths = Object.freeze([
  "tools/evidence/expanded-programme-qa-policy.json",
  "tools/evidence/expanded-programme-qa.mjs",
  "tools/evidence/expanded-programme-qa.test.mjs",
  "tools/evidence/run-expanded-programme-qa.mjs",
  "tools/evidence/verify-expanded-programme-qa.mjs",
  "tools/evidence/verify-expanded-programme-qa.test.mjs",
  "tools/evidence/package.json",
  "tools/w3c-tests/strict-json.mjs",
]);

const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function parseOwnership(text, policy) {
  const ownershipText = section(text, "### ADR ownership map", "### G0 —");
  const sourceRows = [];
  const ownership = {};
  for (const line of ownershipText.split(/\r?\n/u)) {
    const cells = tableCells(line);
    if (!cells || cells.length < 2 || !/^G[0-4]\./u.test(cells[0])) continue;
    const owners = [...cells[1].matchAll(/ADR-\d{4}/gu)].map((match) => match[0]);
    sourceRows.push({ label: cells[0], owners });
    const declared = policy.ownershipRows.find((row) => row.label === cells[0]);
    if (declared) {
      for (const task of declared.tasks) ownership[task] = [...owners];
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
  const value = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  return {
    commit: value(["rev-parse", "HEAD"]),
    tree: value(["rev-parse", "HEAD^{tree}"]),
    trackedClean: value(["status", "--porcelain=v1", "--untracked-files=no"]) === "",
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
  if (policy?.schema !== "oxigraph.expanded-programme-qa-policy/v1") {
    throw new Error("expanded programme QA policy schema is invalid");
  }
  if (Object.values(policy.assertionWeights).reduce((sum, value) => sum + value, 0) !== 98) {
    throw new Error("expanded programme QA committed-source weights must total 98");
  }
  if (Object.keys(policy.tasks).length !== 39 || policy.adrs.length !== 16) {
    throw new Error("expanded programme QA policy inventory is invalid");
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
  const parsedOwnership = parseOwnership(plan, policy);
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
    tasks: parseTasks(plan),
    dependencies: Object.fromEntries(
      Object.entries(policy.tasks).map(([id, task]) => [id, [...task.dependencies]]),
    ),
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
  for (const [id, control] of Object.entries(policy.controls)) {
    graph[id] = [...control.dependencies];
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
  const indexedFiles = model.indexRows.map((row) => row.file).sort();
  if (!sameArray(indexedFiles, model.allAdrFiles)) indexErrors.push("ADR index file set drift");
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
  return String(value)
    .split(/\r?\n/u)
    .filter(Boolean)
    .every((line) => line.startsWith("?? "));
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
    `${left.planId}:${left.taskId}`.localeCompare(`${right.planId}:${right.taskId}`),
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
      diagnostics: ["Ruflo task store or task-plan memory is unavailable"],
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
    Object.fromEntries(Object.entries(taskIds).sort(([left], [right]) => left.localeCompare(right))),
    Object.fromEntries(Object.entries(projectedTaskIds).sort(([left], [right]) => left.localeCompare(right))),
  )) {
    errors.push("Ruflo memory/task-store pointer drift");
  }
  return {
    authority,
    disposition: errors.length === 0 ? "MATCH" : "MISMATCH",
    memoryKeys: [...policy.ruflo.memoryKeys],
    mapValueHashes: mapValueHashes.sort((left, right) => left.key.localeCompare(right.key)),
    taskProjectionHash: projection.sha256,
    stableRows: projection.counts.stable,
    rollupRows: projection.counts.rollup,
    controlRows: projection.counts.control,
    runtime,
    diagnostics: [...new Set(errors)].sort(),
  };
}

export function classifyQaVerdict({
  sourceOk,
  commandsDisposition,
  rufloDisposition,
}) {
  if (!sourceOk || commandsDisposition === "FAIL" || rufloDisposition === "MISMATCH") {
    return { verdict: "FAIL", exitCode: 1 };
  }
  if (commandsDisposition !== "PASS" || rufloDisposition !== "MATCH") {
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
    rufloDisposition: rufloObservation.disposition,
  });
  const policyFile = source.model.inputManifest.files.find(
    (file) => file.path === expandedProgrammePolicyPath,
  );
  return {
    schema: "oxigraph.expanded-programme-qa/v1",
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
