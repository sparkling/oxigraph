// The official Ruflo ADR parser is a host-installed plugin, not a repository
// npm dependency. Keep this fail-closed integration outside the default
// `*.test.mjs` suite and run it explicitly with `npm run verify:adr`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRufloAdrImporter } from "./ruflo-adr-dry-run.mjs";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evidenceDir, "../..");
const script = resolve(evidenceDir, "ruflo-adr-dry-run.mjs");

test("official Ruflo parser sees the exact numeric ADR graph", () => {
  const importer = resolveRufloAdrImporter();
  const run = spawnSync(
    process.execPath,
    [script, "--repo-root", repoRoot, "--importer", importer],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout);

  assert.equal(report.mode, "official-ruflo-adr-import-dry-run");
  assert.equal(report.importer.plugin.name, "ruflo-adr");
  assert.equal(report.official.dryRun, true);
  assert.equal(report.official.storedRecords, 0);
  assert.equal(report.official.storedEdges, 0);
  assert.equal(report.official.total, 42);
  assert.equal(report.staging.files.length, 42);
  assert.deepEqual(report.staging.excludedMarkdown, ["docs/adr/README.md"]);
  assert.equal(
    report.staging.files.some((file) => file.endsWith("/README.md")),
    false,
  );
  assert.deepEqual(report.official.byStatus, {
    accepted: 15,
    implemented: 3,
    proposed: 24,
  });
  assert.deepEqual(report.official.byRelation, {
    amends: 6,
    related: 188,
    "depends-on": 57,
  });
  assert.equal(report.official.edges, 251);
  assert.deepEqual(report.official.danglingRefs, []);
  assert.deepEqual(report.official.statusMismatches, []);
  assert.deepEqual(report.official.errors, []);
  assert.equal(report.integrity.uniqueIds, 42);
  assert.deepEqual(report.integrity.duplicateIds, []);
  assert.deepEqual(report.integrity.unknownStatuses, []);
  assert.equal(report.integrity.rawEdges, 251);
  assert.equal(report.integrity.uniqueEdges, 251);
  assert.equal(report.integrity.duplicateEdges, 0);
  assert.deepEqual(report.integrity.danglingEdges, []);
  assert.deepEqual(report.integrity.selfEdges, []);
  assert.deepEqual(report.integrity.cycles, {
    "depends-on": [],
    supersedes: [],
  });
});
