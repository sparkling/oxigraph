#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agenticGeneratedWithinQualificationWindow,
  documentClaims,
  expectedCandidateClauseAudit,
  expectedCandidateShacl,
  expectedN3MaintenanceReceipt,
  expectedPins,
  semanticCommandIds,
  validateAdrIndex,
  validateCandidateShaclEvidence,
  validateDependencyClaims,
  validateDocumentClaims,
  validateFullReceipts,
  validateJsonDocuments,
  validateLedgerCounts,
  validateNormativeClaims,
  validateRegistryPins,
} from "./policy.mjs";
import { candidateShaclRevision } from "../shacl-tests/inventory.mjs";
import {
  agenticRuntimeContentHash,
  implementationSnapshot as agenticImplementationSnapshot,
  readAgenticFileBytes,
  validateAgenticArtifactArchive,
  validateAgenticPublication,
  validateAgenticReceipt,
} from "../agentic-qe/evidence.mjs";
import {
  commands as agenticCommands,
  profiles as agenticProfiles,
} from "../agentic-qe/profile-definitions.mjs";
import {
  agenticQeDependencyResolution,
  agenticQeLockResolution,
} from "../agentic-qe/version-policy.mjs";
import { loadBoundMutationQualification } from "../metaharness/mutation-binding.mjs";
import { agenticQualificationBindingValid } from "../metaharness/agentic-binding.mjs";
import { validateNormativeClauseInventoryBytes } from "./normative-clause-inventory.mjs";
import {
  validateNormativeControlAuditBytes,
  validateNormativeControlSource,
} from "./normative-control.mjs";
import {
  darwinInstallationSnapshot,
  darwinLockResolution,
  protectedSnapshot,
  trustedRealGateValid,
  validateQualificationReceipt,
  validateVerificationReceipt,
} from "../metaharness/evidence.mjs";

const toolDir = dirname(fileURLToPath(import.meta.url));

function inside(root, path) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

function regularPath(root, relativePath) {
  const lexical = resolve(root, relativePath);
  if (!inside(root, lexical))
    throw new Error(`${relativePath} escapes repository`);
  const metadata = lstatSync(lexical);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${relativePath} is not a regular non-symlink file`);
  }
  const canonical = realpathSync(lexical);
  if (!inside(root, canonical))
    throw new Error(`${relativePath} resolves outside repository`);
  return canonical;
}

function directoryPath(root, relativePath) {
  const lexical = resolve(root, relativePath);
  if (!inside(root, lexical))
    throw new Error(`${relativePath} escapes repository`);
  const metadata = lstatSync(lexical);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${relativePath} is not a regular non-symlink directory`);
  }
  const canonical = realpathSync(lexical);
  if (!inside(root, canonical))
    throw new Error(`${relativePath} resolves outside repository`);
  return canonical;
}

function text(root, relativePath) {
  return readFileSync(regularPath(root, relativePath), "utf8");
}

function json(root, relativePath) {
  try {
    return JSON.parse(text(root, relativePath));
  } catch (error) {
    throw new Error(
      `${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collect(errors, label, operation) {
  try {
    return operation();
  } catch (error) {
    errors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function gitHead(path) {
  if (!existsSync(join(path, ".git"))) {
    throw new Error(`registered checkout is uninitialized: ${path}`);
  }
  return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Lists index entries `git status` cannot see that still have a file on disk.
 *
 * `skip-worktree` and `assume-unchanged` entries are invisible to
 * `git status`, so a modified file behind one passes a clean check. Such an
 * entry is only harmless when its file is absent: nothing can then be read
 * from it. The E3 oracle relies on exactly that, to present a checkout whose
 * embedded corpus lacks some pinned files.
 */
export function hiddenIndexEntriesWithFiles(checkout) {
  const listing = execFileSync("git", ["-C", checkout, "ls-files", "-v", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const present = [];
  for (const entry of listing.split("\0")) {
    if (entry === "") continue;
    const tag = entry.slice(0, 1);
    const path = entry.slice(2);
    const hidden = tag === "S" || (tag !== tag.toUpperCase());
    if (hidden && existsSync(join(checkout, path))) present.push(path);
  }
  return present;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}


const CANDIDATE_COMMIT = /^[0-9a-f]{40}$/u;
const CANDIDATE_SHA256 = /^[0-9a-f]{64}$/u;
const CANDIDATE_RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function candidateArtifactRef(value, label) {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  if (JSON.stringify(keys) !== JSON.stringify(["bytes", "path", "sha256"])) {
    throw new Error(`${label} is not an exact ArtifactRef`);
  }
  if (
    typeof value.path !== "string" ||
    !value.path ||
    isAbsolute(value.path) ||
    value.path.includes("\\") ||
    value.path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} path is not repository-relative POSIX`);
  }
  if (!CANDIDATE_SHA256.test(value.sha256)) {
    throw new Error(`${label} SHA-256 is invalid`);
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error(`${label} byte length is invalid`);
  }
  return value;
}

function candidateRegularPath(root, relativePath) {
  const lexical = resolve(root, relativePath);
  if (!inside(root, lexical)) throw new Error(`${relativePath} escapes repository`);
  let current = root;
  for (const component of relative(root, lexical).split(sep).filter(Boolean)) {
    current = resolve(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${relativePath} contains a symbolic-link path component`);
    }
  }
  return regularPath(root, relativePath);
}

function readCandidateArtifact(root, reference, label, receiptMtime) {
  candidateArtifactRef(reference, label);
  const path = candidateRegularPath(root, reference.path);
  const metadata = lstatSync(path);
  if (metadata.mtimeMs > receiptMtime) {
    throw new Error(`${label} is newer than its receipt`);
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength !== reference.bytes) {
    throw new Error(`${label} byte length does not match its ref`);
  }
  if (sha256(bytes) !== reference.sha256) {
    throw new Error(`${label} SHA-256 does not match its ref`);
  }
  return { bytes, path };
}

function parseCanonicalCandidateJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const canonical = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (!bytes.equals(canonical)) throw new Error(`${label} is not canonical JSON with one trailing newline`);
  return value;
}

function candidateRunDirectory(kind, suiteCommit, implementationCommit, runId) {
  const base = kind === "jena-compact"
    ? "target/datalog-oracles/jena-shaclc/revisions"
    : "target/w3c/shacl-1.2/revisions";
  return `${base}/${suiteCommit}/${implementationCommit}/${runId}`;
}

function verifyCandidateDescriptor(errors) {
  if (!isDeepStrictEqual(candidateShaclRevision, expectedCandidateShacl.revision)) {
    errors.push("candidate SHACL revision descriptor differs from independent policy");
  }
}

function candidateClauseNormalize(value) {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function candidateClauseAnchoredText(html, anchor, documentIndex = candidateClauseHtmlIndex(html)) {
  const element = candidateClauseAnchoredElement(documentIndex, anchor);
  if (element.closeStart === null) throw new Error(`unclosed candidate source anchor ${anchor}`);
  return candidateClauseNormalize(
    documentIndex.masked.slice(element.openEnd, element.closeStart),
  );
}

function candidateClauseSyntaxRules(document, html, descriptor, applicability) {
  return [...html.matchAll(/data-syntax-rule=["']([^"']+)["']/giu)].map((match) => {
    const tagStart = html.lastIndexOf("<", match.index);
    const openEnd = html.indexOf(">", match.index);
    const tag = /^<([a-z][\w-]*)\b/iu.exec(html.slice(tagStart, openEnd + 1))?.[1];
    const close = tag ? html.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, openEnd) : -1;
    const rule = match[1];
    return {
      id: `${document}:${rule}`,
      document,
      path: descriptor.path,
      sha256: descriptor.sha256,
      rule,
      textSha256: sha256(candidateClauseNormalize(html.slice(openEnd + 1, close < 0 ? openEnd + 1 : close))),
      applicability,
      status: "candidate-unexecuted",
    };
  });
}

function candidateClauseBcp14(
  document,
  html,
  descriptor,
  applicability,
  documentIndex = candidateClauseHtmlIndex(html),
) {
  const clauses = new Map();
  const occurrences = new Map();
  const textElements = new Set(["p", "li", "td", "th"]);
  for (const element of documentIndex.elements) {
    if (!textElements.has(element.tag)) continue;
    if (element.closeStart === null) {
      throw new Error(`unclosed candidate BCP14 element ${element.tag} at ${element.start}`);
    }
    const value = candidateClauseNormalize(
      documentIndex.masked.slice(element.openEnd, element.closeStart),
    );
    const keywords = [...new Set([...value.matchAll(/\b(MUST(?: NOT)?|SHOULD(?: NOT)?|MAY|REQUIRED)\b/gu)].map((entry) => entry[1]))];
    if (keywords.length === 0) continue;
    const textSha256 = sha256(value);
    const section = element.sectionIds.at(-1) ?? null;
    const id = `bcp14:${document}:${section ?? "unsectioned"}:${textSha256.slice(0, 12)}`;
    clauses.set(id, {
      id,
      kind: "bcp14",
      document,
      path: descriptor.path,
      sha256: descriptor.sha256,
      section,
      anchor: null,
      facetId: null,
      keywords,
      textSha256,
      applicability,
      status: "raw-candidate-unreviewed",
    });
    const positions = occurrences.get(id) ?? [];
    positions.push({ start: element.start, end: element.end });
    occurrences.set(id, positions);
  }
  documentIndex.bcp14Occurrences = occurrences;
  return [...clauses.values()];
}

function candidateClauseAnchoredElement(documentIndex, anchor) {
  const matches = documentIndex.elementsById.get(anchor) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `missing candidate source anchor ${anchor}`
        : `duplicate candidate source anchor ${anchor}`,
    );
  }
  return matches[0];
}

function candidateClauseHtmlIndex(html) {
  const masked = candidateClauseMaskIgnoredHtml(html);
  const elements = [];
  const elementsById = new Map();
  const stack = [];
  const voidElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
  ]);
  for (let start = masked.indexOf("<"); start >= 0; start = masked.indexOf("<", start + 1)) {
    let quote = null;
    let end = start + 1;
    for (; end < masked.length; end += 1) {
      const character = masked[end];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= masked.length) break;
    const raw = html.slice(start, end + 1);
    const tagMatch = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/iu.exec(raw);
    if (!tagMatch) {
      start = end;
      continue;
    }
    const tag = tagMatch[2].toLowerCase();
    if (tagMatch[1]) {
      const openIndex = stack.findLastIndex((element) => element.tag === tag);
      if (openIndex >= 0) {
        for (let index = stack.length - 1; index >= openIndex; index -= 1) {
          const element = stack.pop();
          element.closeStart = start;
          element.end = index === openIndex ? end + 1 : start;
        }
      }
      start = end;
      continue;
    }
    const id = /\bid\s*=\s*(["'])([^"']+)\1/iu.exec(raw)?.[2] ?? null;
    const sectionIds = stack.at(-1)?.sectionIds.slice() ?? [];
    if (tag === "section" && id !== null) sectionIds.push(id);
    const element = {
      id,
      tag,
      start,
      openEnd: end + 1,
      closeStart: null,
      end: null,
      sectionIds,
    };
    elements.push(element);
    if (id !== null) {
      const matches = elementsById.get(id) ?? [];
      matches.push(element);
      elementsById.set(id, matches);
    }
    if (/\/\s*>$/u.test(raw) || voidElements.has(tag)) {
      element.closeStart = end + 1;
      element.end = end + 1;
    } else {
      stack.push(element);
    }
    start = end;
  }
  return { masked, elements, elementsById, bcp14Occurrences: new Map() };
}

function candidateClauseMaskIgnoredHtml(html) {
  const mask = (value) => value.replace(/[^\r\n]/gu, " ");
  return html
    .replace(/<!--[\s\S]*?-->/gu, mask)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/giu, mask);
}

function candidateClauseGrammarProductions(grammar, source, descriptor) {
  const records = [];
  let current = null;
  const append = () => {
    if (current === null) return;
    const value = current.lines.join(" ").replace(/\s+/gu, " ").trim();
    records.push({
      id: `${grammar}:${current.number}`,
      grammar,
      path: descriptor.path,
      sha256: descriptor.sha256,
      number: current.number,
      name: current.name,
      textSha256: sha256(value),
      status: "candidate-unexecuted",
    });
  };
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\[(\d+)\]\s+([^\s]+)\s+::=\s*(.*)$/u.exec(line);
    if (match) {
      append();
      current = { number: Number(match[1]), name: match[2], lines: [match[3]] };
    } else if (current !== null && /^\s+/u.test(line)) {
      current.lines.push(line.trim());
    } else if (/^@[A-Za-z][A-Za-z0-9_-]*$/u.test(line.trim())) {
      append();
      current = null;
    } else if (line.trim() !== "") {
      throw new Error(`unparsed ${grammar} grammar line after production ${current?.number ?? 0}`);
    }
  }
  append();
  return records;
}

function verifyCandidateClauseSources(root, checkoutPath, audit, errors) {
  const checkout = collect(errors, "candidate clause-audit checkout", () =>
    directoryPath(root, relative(root, checkoutPath)),
  );
  if (checkout === undefined) return;
  const head = collect(errors, "candidate clause-audit checkout identity", () => gitHead(checkout));
  if (head !== undefined && head !== expectedCandidateShacl.revision.suiteCommit) {
    errors.push("candidate clause-audit checkout differs from the frozen suite commit");
  }
  const status = collect(errors, "candidate clause-audit checkout status", () =>
    execFileSync("git", ["-C", checkout, "status", "--porcelain=v1", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (status !== undefined && status !== "") {
    errors.push("candidate clause-audit checkout is not clean");
  }
  const hidden = collect(errors, "candidate clause-audit checkout hidden entries", () =>
    hiddenIndexEntriesWithFiles(checkout),
  );
  if (hidden !== undefined && hidden.length > 0) {
    errors.push("candidate clause-audit checkout hides a present file from git status");
  }
  const facetsByDocument = new Map();
  for (const mapping of expectedCandidateClauseAudit.mappings) {
    for (const facet of mapping.sourceFacets) {
      const facets = facetsByDocument.get(facet.document) ?? [];
      facets.push({ ...facet, sourceStatus: mapping.sourceStatus });
      facetsByDocument.set(facet.document, facets);
    }
  }
  const applicability = {
    overview: "informative-navigation",
    core: "validation-processor",
    nodeExpressions: "node-expression-processor",
    sparql: "sparql-validation-processor",
    sparqlRl: "sparql-rl-processor",
    inferenceRules: "inference-rules-processor",
    compact: "compact-syntax-parser",
    ui: "renderer-or-ui",
    profiling: "profile-author-or-data-author",
  };
  const syntaxDocuments = new Set(["core", "nodeExpressions", "sparql", "inferenceRules"]);
  const clauseCandidates = [];
  const syntaxRules = [];
  const documentIndexes = new Map();
  for (const [name, descriptor] of Object.entries(expectedCandidateClauseAudit.mappingRevision.documents)) {
    const bytes = collect(errors, `candidate clause-audit document ${name}`, () =>
      readFileSync(candidateRegularPath(checkout, descriptor.path)),
    );
    if (bytes === undefined) continue;
    if (sha256(bytes) !== descriptor.sha256) {
      errors.push(`candidate clause-audit document ${name} SHA-256 drifted`);
      continue;
    }
    const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const documentIndex = candidateClauseHtmlIndex(html);
    documentIndexes.set(name, documentIndex);
    if (syntaxDocuments.has(name)) syntaxRules.push(...candidateClauseSyntaxRules(name, html, descriptor, applicability[name]));
    clauseCandidates.push(
      ...candidateClauseBcp14(name, html, descriptor, applicability[name], documentIndex),
    );
    for (const facet of facetsByDocument.get(name) ?? []) {
      for (const anchor of facet.anchors) {
        const value = collect(errors, `candidate clause-audit ${facet.id} anchor ${anchor}`, () =>
          candidateClauseAnchoredText(html, anchor, documentIndex),
        );
        if (value === undefined) continue;
        clauseCandidates.push({
          id: `facet:${facet.id}:${anchor}`,
          kind: "source-facet",
          document: name,
          path: descriptor.path,
          sha256: descriptor.sha256,
          section: anchor,
          anchor,
          facetId: facet.id,
          keywords: [],
          textSha256: sha256(value),
          applicability: applicability[name],
          status: facet.sourceStatus,
        });
      }
    }
  }
  const grammarProductions = [];
  for (const [name, descriptor] of Object.entries(expectedCandidateClauseAudit.mappingRevision.grammars)) {
    const bytes = collect(errors, `candidate clause-audit grammar ${name}`, () =>
      readFileSync(candidateRegularPath(checkout, descriptor.path)),
    );
    if (bytes !== undefined && sha256(bytes) !== descriptor.sha256) {
      errors.push(`candidate clause-audit grammar ${name} SHA-256 drifted`);
    } else if (bytes !== undefined && name === "sparqlRl") {
      grammarProductions.push(...candidateClauseGrammarProductions(name, new TextDecoder("utf-8", { fatal: true }).decode(bytes), descriptor));
    }
  }
  if (!isDeepStrictEqual(audit?.clauseCandidates, clauseCandidates)) {
    errors.push("candidate clause-audit raw clause candidates differ from the pinned source bytes");
  }
  if (!isDeepStrictEqual(audit?.syntaxRules, syntaxRules)) {
    errors.push("candidate clause-audit syntax rules differ from the pinned source bytes");
  }
  if (!isDeepStrictEqual(audit?.grammarProductions, grammarProductions)) {
    errors.push("candidate clause-audit grammar productions differ from the pinned source bytes");
  }
  const expectedFacetById = new Map(
    expectedCandidateClauseAudit.mappings.flatMap((mapping) =>
      mapping.sourceFacets.map((facet) => [facet.id, facet]),
    ),
  );
  const actualJoinById = new Map(
    (audit?.rawObligationJoins ?? []).map((join) => [join?.obligationId, join]),
  );
  for (const obligation of expectedCandidateClauseAudit.obligations) {
    const expectedClauseIds = [];
    const seen = new Set();
    const add = (id) => {
      if (!seen.has(id)) {
        expectedClauseIds.push(id);
        seen.add(id);
      }
    };
    for (const facetId of obligation.sourceFacetIds) {
      const facet = expectedFacetById.get(facetId);
      const documentIndex = documentIndexes.get(facet?.document);
      if (!facet || !documentIndex) continue;
      for (const anchor of facet.anchors) {
        add(`facet:${facet.id}:${anchor}`);
        const scope = candidateClauseAnchoredElement(documentIndex, anchor);
        for (const [id, occurrences] of documentIndex.bcp14Occurrences) {
          if (
            occurrences.some(
              ({ start, end }) => start >= scope.start && end <= scope.end,
            )
          ) {
            add(id);
          }
        }
      }
    }
    if (!isDeepStrictEqual(actualJoinById.get(obligation.id)?.clauseCandidateIds, expectedClauseIds)) {
      errors.push(
        `candidate clause-audit raw BCP14 join differs from pinned anchor scope for ${obligation.id}`,
      );
    }
  }
}

export function verifyShaclCandidateArtifacts(
  rootInput,
  { receiptRef, expectedImplementationCommit } = {},
) {
  const errors = [];
  const root = collect(errors, "candidate repository root", () => realpathSync(rootInput));
  if (!CANDIDATE_COMMIT.test(expectedImplementationCommit ?? "")) {
    errors.push("candidate expected implementation commit is not a full lowercase Git commit");
  }
  if (root === undefined) return { ok: false, errors };

  let receipt;
  let receiptPath;
  let receiptMtime;
  const receiptArtifact = collect(errors, "candidate receipt", () => {
    candidateArtifactRef(receiptRef, "candidate receipt ref");
    const path = candidateRegularPath(root, receiptRef.path);
    const metadata = lstatSync(path);
    const bytes = readFileSync(path);
    if (bytes.byteLength !== receiptRef.bytes || sha256(bytes) !== receiptRef.sha256) {
      throw new Error("candidate receipt bytes do not match their explicit ref");
    }
    return { bytes, path, mtimeMs: metadata.mtimeMs };
  });
  if (receiptArtifact === undefined) return { ok: false, errors };
  receiptPath = receiptArtifact.path;
  receiptMtime = receiptArtifact.mtimeMs;
  receipt = collect(errors, "candidate receipt JSON", () =>
    parseCanonicalCandidateJson(receiptArtifact.bytes, receiptRef.path),
  );
  if (receipt === undefined) return { ok: false, errors };

  if (!CANDIDATE_RUN_ID.test(receipt?.runId ?? "")) errors.push("candidate receipt run ID is invalid");
  if (!CANDIDATE_COMMIT.test(receipt?.implementationCommit ?? "")) {
    errors.push("candidate receipt implementation commit is invalid");
  }
  if (receipt?.implementationCommit !== expectedImplementationCommit) {
    errors.push("candidate receipt implementation commit differs from the expected source");
  }
  if (receipt?.suiteCommit !== expectedCandidateShacl.revision.suiteCommit) {
    errors.push("candidate receipt suite commit differs from the frozen revision");
  }
  if (!["rust-suite", "jena-compact", "clause-audit"].includes(receipt?.kind)) {
    errors.push("candidate receipt kind is invalid");
  }
  const runDirectory = candidateRunDirectory(
    receipt?.kind,
    receipt?.suiteCommit,
    receipt?.implementationCommit,
    receipt?.runId,
  );
  if (receiptRef.path !== `${runDirectory}/receipt.json`) {
    errors.push("candidate receipt path disagrees with its revision/source/run identity");
  }
  if (receiptPath !== resolve(root, receiptRef.path)) {
    errors.push("candidate receipt canonical path disagrees with its ref");
  }

  const clauseAudit = receipt?.kind === "clause-audit";
  const boundReferences = [["candidate inventory artifact", receipt?.inventoryArtifact, true, null, null]];
  if (clauseAudit) {
    boundReferences.push(["candidate clause-audit artifact", receipt?.auditArtifact, true, null, null]);
  } else {
    boundReferences.push(["candidate cases artifact", receipt?.casesArtifact, true, null, null]);
    for (const [laneName, lane] of Object.entries(receipt?.lanes ?? {})) {
      boundReferences.push([`candidate ${laneName} stdout artifact`, lane?.stdoutArtifact, false, laneName, "stdout"]);
      boundReferences.push([`candidate ${laneName} stderr artifact`, lane?.stderrArtifact, false, laneName, "stderr"]);
    }
  }
  const seenPaths = new Set([receiptRef.path]);
  const loaded = new Map();
  const raw = {};
  for (const [label, reference, jsonArtifact, laneName, stream] of boundReferences) {
    const artifact = collect(errors, label, () => {
      candidateArtifactRef(reference, label);
      if (dirname(reference.path) !== runDirectory) {
        throw new Error(`${label} is not a direct child of the receipt run directory`);
      }
      if (seenPaths.has(reference.path)) throw new Error(`${label} duplicates a bound artifact path`);
      seenPaths.add(reference.path);
      return readCandidateArtifact(root, reference, label, receiptMtime);
    });
    if (artifact !== undefined) {
      if (jsonArtifact) {
        loaded.set(label, collect(errors, `${label} JSON`, () => parseCanonicalCandidateJson(artifact.bytes, reference.path)));
      } else {
        raw[laneName] ??= {};
        raw[laneName][stream] = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
      }
    }
  }
  const inventory = loaded.get("candidate inventory artifact");
  const evidence = clauseAudit
    ? loaded.get("candidate clause-audit artifact")
    : loaded.get("candidate cases artifact");
  if (inventory !== undefined && evidence !== undefined) {
    const checkoutPath = `${root}/target/w3c/shacl-1.2/data-shapes-${expectedCandidateShacl.revision.suiteCommit.slice(0, 12)}`;
    if (clauseAudit) verifyCandidateClauseSources(root, checkoutPath, evidence, errors);
    collect(errors, "candidate evidence policy", () =>
      validateCandidateShaclEvidence({
        receipt,
        inventory,
        ...(clauseAudit ? { audit: evidence } : { cases: evidence }),
        raw,
        repositoryRoot: root,
        checkoutPath,
        runDirectory,
      }, errors),
    );
  }
  return { ok: errors.length === 0, errors };
}

const allCurrentClaims = documentClaims;
const adrClaimIds = Object.freeze({
  "0001-outcome-oriented-jena-parity.md": ["Jena"],
  "0002-rdf-native-datalog-engine.md": ["Datalog"],
  "0003-w3c-12-conformance-baseline.md": [
    "RDF 1.2",
    "SPARQL 1.2",
    "RDFS",
    "SHACL 1.2",
  ],
  "0005-agentic-qe-integration.md": ["Agentic-QE"],
  "0007-owl-profiles-over-datalog.md": ["OWL 2 RL"],
  "0008-shacl-processor-profiles.md": ["SHACL 1.2"],
  "0009-snapshot-reasoning-materialization.md": ["semantic integration"],
  "0010-bounded-rdf-dataset-canonicalization.md": ["RDF canonicalization"],
  "0012-immutable-broad-jena-harness.md": ["Jena"],
  "0013-mutation-competence-and-provenance.md": ["Datalog"],
});

function readResearchJson(root, errors) {
  const directory = resolve(root, "docs/research");
  const documents = new Map();
  const names =
    collect(errors, "docs/research", () =>
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort(),
    ) ?? [];
  for (const name of names) {
    const value = collect(errors, `docs/research/${name}`, () =>
      json(root, `docs/research/${name}`),
    );
    if (value !== undefined) documents.set(name, value);
  }
  return documents;
}

function verifyN3MaintenanceReceiptIntegrity(root, errors) {
  const relativePath = `docs/research/${expectedN3MaintenanceReceipt.path}`;
  const bytes = collect(errors, `${relativePath} bytes`, () =>
    readFileSync(regularPath(root, relativePath)),
  );
  if (bytes === undefined) return;
  const actual = sha256(bytes);
  if (actual !== expectedN3MaintenanceReceipt.sha256) {
    errors.push(
      `${relativePath}: expected SHA-256 ${expectedN3MaintenanceReceipt.sha256}, got ${actual}`,
    );
  }
}

function verifyDocuments(root, errors) {
  for (const relativePath of [
    "docs/research/semantic-parity-current-summary.md",
    "docs/plans/semantic-parity-metaharness-plan.md",
    "docs/research/semantic-parity-programme.html",
  ]) {
    const value = collect(errors, relativePath, () => text(root, relativePath));
    if (value !== undefined) {
      validateDocumentClaims(relativePath, value, allCurrentClaims, errors);
    }
  }
  for (const [name, ids] of Object.entries(adrClaimIds)) {
    const relativePath = `docs/adr/${name}`;
    const value = collect(errors, relativePath, () => text(root, relativePath));
    if (value === undefined) continue;
    const claims = allCurrentClaims
      .filter((claim) => ids.includes(claim.id))
      .map((claim) => ({ ...claim, documentWide: true }));
    validateDocumentClaims(relativePath, value, claims, errors);
  }
}

function verifyAdrIndex(root, errors) {
  const directory = resolve(root, "docs/adr");
  const names = collect(
    errors,
    "docs/adr",
    () =>
      new Set(
        readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => entry.name),
      ),
  );
  const index = collect(errors, "docs/adr/README.md", () =>
    text(root, "docs/adr/README.md"),
  );
  if (names && index !== undefined) validateAdrIndex(index, names, errors);
}

function checkoutHeads(root, mode, errors, resolveHead) {
  const paths = {
    "w3c-rdf-tests": "testsuite/rdf-tests",
    "w3c-rdf-canon-tests": "testsuite/rdf-canon",
    "w3c-json-ld-api": "testsuite/json-ld-api",
    "w3c-json-ld-streaming": "testsuite/json-ld-streaming",
    "w3c-n3": "testsuite/N3",
  };
  const heads = {};
  for (const [id, relativePath] of Object.entries(paths)) {
    const head = collect(errors, `${id} checkout`, () =>
      resolveHead(directoryPath(root, relativePath)),
    );
    if (head !== undefined) heads[id] = head;
  }
  const shaclPath = resolve(
    root,
    `target/w3c/shacl-1.2/data-shapes-${expectedPins["w3c-data-shapes"].slice(0, 12)}`,
  );
  if (existsSync(shaclPath)) {
    const head = collect(errors, "w3c-data-shapes checkout", () =>
      resolveHead(directoryPath(root, relative(root, shaclPath))),
    );
    if (head !== undefined) heads["w3c-data-shapes"] = head;
  } else if (mode === "full") {
    errors.push(
      "w3c-data-shapes checkout: pinned full-mode checkout is missing",
    );
  }
  return heads;
}

function verifyShaclSourcePin(root, errors) {
  const paths = [
    "tools/shacl-tests/inventory.mjs",
    "tools/shacl-tests/clause-audit.mjs",
  ];
  for (const relativePath of paths) {
    const value = collect(errors, relativePath, () => text(root, relativePath));
    if (
      value !== undefined &&
      !value.includes(expectedPins["w3c-data-shapes"])
    ) {
      errors.push(
        `${relativePath}: does not bind the current W3C Data Shapes pin`,
      );
    }
  }
}

function readReceipts(root, errors) {
  const paths = {
    meta: "target/metaharness/qualification.json",
    metaVerification: "target/metaharness/verification.json",
  };
  const receipts = {};
  const receiptBytes = {};
  for (const [id, relativePath] of Object.entries(paths)) {
    const bytes = collect(errors, `${id} receipt bytes`, () =>
      readAgenticFileBytes(relativePath, { repositoryRoot: root }),
    );
    if (bytes === undefined) continue;
    receiptBytes[id] = bytes;
    const value = collect(errors, `${id} receipt`, () => JSON.parse(bytes));
    if (value !== undefined) receipts[id] = value;
  }

  let mutationProjection;
  if (!receipts.meta?.mutation?.path) {
    errors.push("mutation publication: MetaHarness binding is missing");
  } else {
    collect(errors, "mutation source-bound receipt contract", () => {
      const loaded = loadBoundMutationQualification(
        root,
        receipts.meta.mutation,
      );
      receipts.mutation = loaded.receipt;
      mutationProjection = loaded.verified;
    });
  }

  let agenticProjection;
  const binding = receipts.meta?.realGate?.agenticReceipt;
  if (!agenticQualificationBindingValid(binding)) {
    errors.push("Agentic-QE publication: MetaHarness binding is missing");
  } else {
    const agenticBytes = collect(errors, "Agentic-QE receipt bytes", () =>
      readAgenticFileBytes(binding.path, { repositoryRoot: root }),
    );
    if (agenticBytes) {
      const agentic = collect(errors, "Agentic-QE receipt", () =>
        JSON.parse(agenticBytes),
      );
      if (agentic) receipts.agentic = agentic;
    }
    if (receipts.agentic && agenticBytes) {
      collect(errors, "Agentic-QE receipt contract", () => {
        const agenticQeDependency = agenticQeDependencyResolution();
        const selected = agenticProfiles["metaharness-semantic-gate"];
        const publication = validateAgenticPublication(receipts.agentic, {
          repositoryRoot: root,
        });
        receipts.agentic = publication.receipt;
        validateAgenticReceipt(receipts.agentic, {
          expectedProfile: "metaharness-semantic-gate",
          expectedAgenticQeVersion: agenticQeDependency.version,
          expectedAgenticQeDependency: agenticQeDependency,
          expectedRuntimeContentHash: binding.runtimeContentHash,
          expectedCommandIds: semanticCommandIds,
          expectedCommands: agenticCommands,
          minimumGeneratedAtMs: Date.parse(receipts.meta.startedAt),
          maximumGeneratedAtMs: Date.parse(receipts.meta.finishedAt),
        });
        if (
          !agenticGeneratedWithinQualificationWindow(
            receipts.meta,
            receipts.agentic,
          )
        ) {
          throw new Error(
            "Agentic-QE receipt was not generated within the qualification interval",
          );
        }
        const archive = validateAgenticArtifactArchive(receipts.agentic, {
          repositoryRoot: root,
        });
        if (!publication.receiptBytes.equals(agenticBytes)) {
          throw new Error(
            "qualification receipt differs from immutable publication",
          );
        }
        const verifierRoot = realpathSync(resolve(toolDir, "../.."));
        if (root !== verifierRoot) {
          throw new Error(
            "full verification must execute from the target repository",
          );
        }
        const implementation = agenticImplementationSnapshot(
          selected,
          agenticCommands,
        );
        if (
          implementation.contentHash !==
          receipts.agentic.implementation.contentHash
        ) {
          throw new Error("Agentic-QE implementation snapshot is stale");
        }
        if (
          binding.path !== receipts.agentic.publication.receiptPath ||
          binding.oraclePath !== receipts.agentic.publication.oraclePath ||
          binding.sha256 !== sha256(agenticBytes) ||
          binding.oracleSha256 !== sha256(publication.oracleBytes) ||
          binding.schemaVersion !== receipts.agentic.schemaVersion ||
          binding.runId !== receipts.agentic.runId ||
          binding.generatedAt !== receipts.agentic.generatedAt ||
          binding.contentHash !== receipts.agentic.contentHash ||
          binding.executionHash !== receipts.agentic.executionHash ||
          binding.runtimeContentHash !==
            agenticRuntimeContentHash(receipts.agentic.runtime) ||
          binding.implementationContentHash !== implementation.contentHash ||
          binding.artifactContentHash !==
            receipts.agentic.artifacts.contentHash ||
          binding.archiveContentHash !== archive.contentHash ||
          binding.archiveRoot !== archive.root ||
          binding.archiveFileCount !== archive.files.length
        ) {
          throw new Error(
            "MetaHarness Agentic-QE binding differs from publication",
          );
        }
        receipts.agenticOracle = publication.oracle;
        agenticProjection = {
          schemaVersion: receipts.agentic.schemaVersion,
          runId: receipts.agentic.runId,
          generatedAt: receipts.agentic.generatedAt,
          receiptSha256: sha256(agenticBytes),
          oracleSha256: sha256(publication.oracleBytes),
          contentHash: receipts.agentic.contentHash,
          executionHash: receipts.agentic.executionHash,
          runtimeContentHash: agenticRuntimeContentHash(
            receipts.agentic.runtime,
          ),
          implementationContentHash: implementation.contentHash,
          artifactContentHash: receipts.agentic.artifacts.contentHash,
          archiveContentHash: archive.contentHash,
        };
      });
      for (const [id, sourcePath] of [
        ["jena", "target/jena-parity/parity-receipt.json"],
        ["shaclInventory", "target/w3c/shacl-1.2/inventory.json"],
        ["shacl", "target/w3c/shacl-1.2/run-receipt.json"],
        ["shaclJenaCompact", "target/datalog-oracles/jena-shaclc/receipt.json"],
        ["normativeControl", "target/w3c/normative-control/audit.json"],
        [
          "normativeClauseInventory",
          "target/w3c/normative-control/clause-inventory.json",
        ],
      ]) {
        const matches =
          receipts.agentic.artifacts?.archive?.files?.filter(
            (file) => file?.sourcePath === sourcePath,
          ) ?? [];
        if (matches.length !== 1) {
          errors.push(
            `Agentic-QE archive: expected one ${sourcePath} binding, got ${matches.length}`,
          );
          continue;
        }
        const value = collect(errors, `${id} archived receipt`, () => {
          const file = matches[0];
          const bytes = readAgenticFileBytes(file.path, {
            repositoryRoot: root,
          });
          if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
            throw new Error("archive bytes differ from the immutable manifest");
          }
          if (id === "normativeControl") {
            return validateNormativeControlAuditBytes(bytes, { root });
          }
          if (id === "normativeClauseInventory") {
            return validateNormativeClauseInventoryBytes(bytes, { root });
          }
          return JSON.parse(bytes);
        });
        if (value !== undefined) receipts[id] = value;
      }
    }
  }

  if (receipts.meta) {
    collect(errors, "MetaHarness qualification contract", () => {
      const darwin = darwinInstallationSnapshot(
        root,
        join(root, "tools", "metaharness"),
      );
      validateQualificationReceipt(receipts.meta, {
        expectedDarwinVersion: darwin.version,
        requireFull: true,
      });
      if (!trustedRealGateValid(receipts.meta.realGate)) {
        throw new Error("MetaHarness real gate is not independently closed");
      }
      const current = protectedSnapshot(root);
      if (
        current.contentHash !== receipts.meta.inputs.after.contentHash ||
        darwin.contentHash !== receipts.meta.inputs.darwin.after.contentHash
      ) {
        throw new Error("MetaHarness qualification inputs are stale");
      }
      const nodePath = realpathSync(receipts.meta.runtime.node.path);
      const currentNodePath = realpathSync(process.execPath);
      if (
        nodePath !== currentNodePath ||
        receipts.meta.runtime.node.path !== currentNodePath ||
        receipts.meta.runtime.node.invokedPath !== process.execPath ||
        sha256(readFileSync(nodePath)) !==
          receipts.meta.runtime.node.executableSha256 ||
        process.version !== receipts.meta.runtime.node.version ||
        receipts.meta.runtime.platform !== process.platform ||
        receipts.meta.runtime.architecture !== process.arch
      ) {
        throw new Error("MetaHarness qualification Node provenance drifted");
      }
      if (!receipts.metaVerification) {
        throw new Error("MetaHarness verification receipt is missing");
      }
      validateVerificationReceipt(receipts.metaVerification, {
        qualification: {
          path: paths.meta,
          sha256: sha256(receiptBytes.meta),
          contentHash: receipts.meta.contentHash,
        },
        protectedContentHash: current.contentHash,
        darwinContentHash: darwin.contentHash,
        mutation: mutationProjection,
        agentic: agenticProjection,
      });
    });
  }
  return receipts;
}

export function verifyProgramme(
  rootInput,
  { mode = "source-only", resolveHead = gitHead } = {},
) {
  if (!["source-only", "full"].includes(mode))
    throw new Error(`unsupported mode: ${mode}`);
  const root = realpathSync(rootInput);
  const errors = [];
  verifyCandidateDescriptor(errors);
  const documents = readResearchJson(root, errors);
  validateJsonDocuments(documents, errors);
  verifyN3MaintenanceReceiptIntegrity(root, errors);
  const ledger = documents.get("conformance-ledger.json");
  const normative = documents.get("normative-requirements.json");
  const registry = documents.get("standards-registry.json");
  if (ledger) validateLedgerCounts(ledger, errors);
  const dependencyResolutions = {
    agenticQe: collect(errors, "Agentic-QE dependency policy", () =>
      agenticQeLockResolution({
        adapterDir: join(root, "tools/agentic-qe"),
        repositoryRoot: root,
      }),
    ),
    darwin: collect(errors, "Darwin dependency policy", () =>
      darwinLockResolution(root, join(root, "tools/metaharness")),
    ),
  };
  if (ledger) validateDependencyClaims(ledger, dependencyResolutions, errors);
  if (normative && ledger) validateNormativeClaims(normative, ledger, errors);
  collect(errors, "W3C normative control source", () =>
    validateNormativeControlSource(root),
  );

  const heads = checkoutHeads(root, mode, errors, resolveHead);
  if (registry && ledger) validateRegistryPins(registry, ledger, heads, errors);
  verifyShaclSourcePin(root, errors);
  verifyAdrIndex(root, errors);
  verifyDocuments(root, errors);

  if (mode === "full") {
    const receipts = readReceipts(root, errors);
    validateFullReceipts(receipts, errors);
  }
  return { ok: errors.length === 0, mode, errors };
}

function parseArguments(args) {
  let mode = "source-only";
  let root = resolve(toolDir, "../..");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source-only") mode = "source-only";
    else if (arg === "--full") mode = "full";
    else if (arg === "--root") {
      if (!args[index + 1]) throw new Error("--root requires a path");
      root = resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { mode, root };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = verifyProgramme(options.root, { mode: options.mode });
  if (result.ok) {
    console.log(`Programme evidence verification: PASS (${result.mode})`);
    return;
  }
  console.error(`Programme evidence verification: FAIL (${result.mode})`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
