#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NUMERIC_ADR = /^\d{4}-.+\.md$/;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "../..");

function existingImporter(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved) || basename(resolved) !== "import.mjs") {
    return null;
  }
  const parser = join(dirname(resolved), "lib", "parse-adrs.mjs");
  const records = join(dirname(resolved), "lib", "index-records.mjs");
  return existsSync(parser) && existsSync(records) ? realpathSync(resolved) : null;
}

export function resolveRufloAdrImporter(explicitPath) {
  if (explicitPath) {
    const importer = existingImporter(explicitPath);
    if (!importer) {
      throw new Error(`not a Ruflo ADR importer: ${resolve(explicitPath)}`);
    }
    return importer;
  }

  if (process.env.RUFLO_ADR_IMPORTER) {
    return resolveRufloAdrImporter(process.env.RUFLO_ADR_IMPORTER);
  }

  const codexHome = process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");
  const cacheRoot = join(
    codexHome,
    "plugins",
    "cache",
    "ruflo",
    "ruflo-adr",
  );
  const versions = existsSync(cacheRoot)
    ? readdirSync(cacheRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        )
    : [];
  for (const version of versions) {
    const importer = existingImporter(
      join(cacheRoot, version, "scripts", "import.mjs"),
    );
    if (importer) return importer;
  }

  throw new Error(
    "Ruflo ADR importer not found; install ruflo-adr or pass --importer <path>",
  );
}

function canonicalCycle(nodes) {
  const body = nodes.slice(0, -1);
  const rotations = body.map((_, index) => {
    const rotated = [...body.slice(index), ...body.slice(0, index)];
    return [...rotated, rotated[0]];
  });
  rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
  return rotations[0];
}

export function findDirectedCycles(edges, relation) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (edge.relation !== relation || edge.from === edge.to) continue;
    const targets = adjacency.get(edge.from) ?? new Set();
    targets.add(edge.to);
    adjacency.set(edge.from, targets);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
  }

  const state = new Map();
  const stack = [];
  const stackIndex = new Map();
  const cycles = new Map();

  function visit(node) {
    state.set(node, 1);
    stackIndex.set(node, stack.length);
    stack.push(node);
    const targets = [...(adjacency.get(node) ?? [])].sort();
    for (const target of targets) {
      if ((state.get(target) ?? 0) === 0) {
        visit(target);
      } else if (state.get(target) === 1) {
        const cycle = canonicalCycle([
          ...stack.slice(stackIndex.get(target)),
          target,
        ]);
        cycles.set(cycle.join("->"), cycle);
      }
    }
    stack.pop();
    stackIndex.delete(node);
    state.set(node, 2);
  }

  for (const node of [...adjacency.keys()].sort()) {
    if ((state.get(node) ?? 0) === 0) visit(node);
  }
  return [...cycles.values()].sort((left, right) =>
    left.join("\0").localeCompare(right.join("\0")),
  );
}

function stageNumericAdrs(repoRoot) {
  const sourceDir = join(repoRoot, "docs", "adr");
  const markdown = readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const names = markdown.filter((name) => NUMERIC_ADR.test(name));
  if (names.length === 0) {
    throw new Error(`no numeric ADRs found under ${sourceDir}`);
  }

  const root = mkdtempSync(join(tmpdir(), "oxigraph-ruflo-adr-"));
  const stagedDir = join(root, "docs", "adr");
  mkdirSync(stagedDir, { recursive: true });
  for (const name of names) {
    copyFileSync(join(sourceDir, name), join(stagedDir, name));
  }
  return {
    root,
    files: names.map((name) => `docs/adr/${name}`),
    excludedMarkdown: markdown
      .filter((name) => !NUMERIC_ADR.test(name))
      .map((name) => `docs/adr/${name}`),
  };
}

function readPluginMetadata(importer) {
  const manifest = join(
    resolve(dirname(importer), ".."),
    ".claude-plugin",
    "plugin.json",
  );
  if (!existsSync(manifest)) return null;
  const parsed = JSON.parse(readFileSync(manifest, "utf8"));
  return { name: parsed.name, version: parsed.version };
}

function parseOfficialOutput(result) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `official importer exited ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`official importer returned invalid JSON: ${error.message}`);
  }
}

function assertCleanIntegrity(report) {
  const failures = [];
  if (report.official.dryRun !== true) failures.push("import was not a dry run");
  if (report.official.storedRecords !== 0 || report.official.storedEdges !== 0) {
    failures.push("dry run reported stored records or edges");
  }
  if (report.official.total !== report.staging.files.length) {
    failures.push("official total does not equal staged numeric file count");
  }
  if (report.official.edges !== report.integrity.uniqueEdges) {
    failures.push("official edge total does not equal parser edge total");
  }
  if (report.integrity.duplicateIds.length > 0) failures.push("duplicate ADR ids");
  if (report.integrity.unknownStatuses.length > 0) failures.push("unknown statuses");
  if (report.integrity.danglingEdges.length > 0) failures.push("dangling edges");
  if (report.integrity.selfEdges.length > 0) failures.push("self edges");
  if (report.integrity.cycles["depends-on"].length > 0) {
    failures.push("depends-on cycles");
  }
  if (report.integrity.cycles.supersedes.length > 0) {
    failures.push("supersedes cycles");
  }
  if (report.official.danglingRefs.length > 0) failures.push("official dangling refs");
  if (report.official.statusMismatches.length > 0) {
    failures.push("official status mismatches");
  }
  if (report.official.errors.length > 0) failures.push("official importer errors");
  if (failures.length > 0) {
    throw new Error(`ADR graph failed closed: ${failures.join(", ")}`);
  }
}

export async function runRufloAdrDryRun({
  repoRoot = DEFAULT_REPO_ROOT,
  importer: importerPath,
} = {}) {
  const resolvedRepo = realpathSync(resolve(repoRoot));
  const importer = resolveRufloAdrImporter(importerPath);
  const staging = stageNumericAdrs(resolvedRepo);
  try {
    const result = spawnSync(process.execPath, [importer], {
      cwd: resolvedRepo,
      encoding: "utf8",
      env: {
        ...process.env,
        ADR_ROOT: staging.root,
        CLI_CORE: "0",
        IMPORT_DRY_RUN: "1",
        IMPORT_FORMAT: "json",
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    const official = parseOfficialOutput(result);

    const parserPath = join(dirname(importer), "lib", "parse-adrs.mjs");
    const recordsPath = join(dirname(importer), "lib", "index-records.mjs");
    const { findAdrs, parseAdr } = await import(pathToFileURL(parserPath).href);
    const { uniqueEdges } = await import(pathToFileURL(recordsPath).href);
    const adrs = findAdrs(staging.root).map((file) => parseAdr(file, staging.root));
    const rawEdges = adrs.flatMap((adr) => adr.links);
    const edges = uniqueEdges(rawEdges);
    const idCounts = new Map();
    for (const adr of adrs) idCounts.set(adr.id, (idCounts.get(adr.id) ?? 0) + 1);
    const ids = new Set(idCounts.keys());

    const report = {
      schemaVersion: 1,
      mode: "official-ruflo-adr-import-dry-run",
      importer: {
        executable: importer,
        parser: realpathSync(parserPath),
        plugin: readPluginMetadata(importer),
      },
      staging: {
        selector: "docs/adr/NNNN-*.md",
        files: staging.files,
        excludedMarkdown: staging.excludedMarkdown,
      },
      official,
      integrity: {
        uniqueIds: ids.size,
        duplicateIds: [...idCounts]
          .filter(([, count]) => count > 1)
          .map(([id]) => id)
          .sort(),
        unknownStatuses: adrs
          .filter((adr) => adr.status.toLowerCase() === "unknown")
          .map((adr) => adr.id)
          .sort(),
        rawEdges: rawEdges.length,
        uniqueEdges: edges.length,
        duplicateEdges: rawEdges.length - edges.length,
        danglingEdges: edges.filter((edge) => !ids.has(edge.to)),
        selfEdges: edges.filter((edge) => edge.from === edge.to),
        cycles: {
          "depends-on": findDirectedCycles(edges, "depends-on"),
          supersedes: findDirectedCycles(edges, "supersedes"),
        },
      },
    };
    assertCleanIntegrity(report);
    return report;
  } finally {
    rmSync(staging.root, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root" || arg === "--importer") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      options[arg === "--repo-root" ? "repoRoot" : "importer"] = value;
      index += 1;
    } else if (arg === "--help") {
      return { help: true };
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node tools/evidence/ruflo-adr-dry-run.mjs " +
        "[--repo-root PATH] [--importer PATH]",
    );
    return;
  }
  const report = await runRufloAdrDryRun(options);
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`ruflo ADR dry-run failed: ${error.message}`);
    process.exitCode = 1;
  });
}
