import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectProgrammeModel,
  loadExpandedProgrammePolicy,
  parseProgrammeDependencies,
  validateDocumentBytes,
  validateExpandedProgramme,
  validateMarkdownLinks,
  validateProgrammeModel,
} from "./expanded-programme-qa.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const policy = loadExpandedProgrammePolicy(repoRoot);

function currentModel() {
  const model = structuredClone(collectProgrammeModel(repoRoot, policy));
  model.subject = {
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    trackedClean: true,
  };
  return model;
}

function assertion(result, id) {
  const value = result.assertions.find((item) => item.id === id);
  assert.ok(value, `missing assertion ${id}`);
  return value;
}

test("should accept the exact current 16-ADR and 39-task committed corpus", () => {
  const result = validateExpandedProgramme(repoRoot, {
    policy,
    subject: {
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      trackedClean: true,
    },
  });

  assert.deepEqual(
    {
      ok: result.ok,
      score: result.score,
      adrCount: result.scope.adrCount,
      stableGCount: result.scope.stableGCount,
      phaseCounts: result.scope.phaseCounts,
    },
    {
      ok: true,
      score: 88,
      adrCount: 16,
      stableGCount: 39,
      phaseCounts: { G0: 7, G1: 9, G2: 10, G3: 5, G4: 8 },
    },
  );
});

test("should reject duplicate ADR identifiers and title drift", () => {
  const model = currentModel();
  model.adrs.push(structuredClone(model.adrs[0]));
  model.adrs[1].title = "Drifted title";

  const result = validateProgrammeModel(model, policy);

  assert.equal(assertion(result, "adr.corpus").status, "FAIL");
});

test("should reject missing ADR status metadata and required headings", () => {
  const model = currentModel();
  delete model.adrs[0].metadata.Updated;
  model.adrs[0].status = "Accepted";
  model.adrs[0].headings = model.adrs[0].headings.filter(
    (heading) => heading !== "Acceptance boundary",
  );

  const result = validateProgrammeModel(model, policy);

  assert.equal(assertion(result, "adr.structure-status").status, "FAIL");
});

test("should reject ADR index target title and status drift", () => {
  const model = currentModel();
  model.indexRows = model.indexRows.filter((row) => row.id !== "ADR-0033");
  model.indexRows.find((row) => row.id === "ADR-0018").status = "Accepted";
  model.indexRows.find((row) => row.id === "ADR-0019").title = "Wrong title";

  const result = validateProgrammeModel(model, policy);

  assert.equal(
    assertion(result, "adr.index-title-status-parity").status,
    "FAIL",
  );
});

test("should reject missing duplicate and unknown stable G identifiers", () => {
  const model = currentModel();
  model.tasks = model.tasks.filter((row) => row.id !== "G4.8");
  model.tasks.push(structuredClone(model.tasks[0]));
  model.tasks.push({ id: "G9.9", dependencyText: "none" });

  const result = validateProgrammeModel(model, policy);

  assert.equal(assertion(result, "goap.stable-id-set").status, "FAIL");
});

test("should reject a rollup or harness control promoted to a stable task", () => {
  const model = currentModel();
  model.tasks.push({ id: "G2.3", dependencyText: "G2.3a-G2.3c" });
  model.tasks.push({ id: "HARNESS-REGISTRY", dependencyText: "G1.6" });

  const result = validateProgrammeModel(model, policy);

  assert.equal(
    assertion(result, "goap.ownership-rollups-controls").status,
    "FAIL",
  );
});

test("should reject dangling self and duplicate dependency edges", () => {
  assert.deepEqual(
    parseProgrammeDependencies(
      "G1.5-G1.6; G4.2 for promotion after HARNESS-REGISTRY",
      Object.keys(policy.tasks),
    ),
    ["G1.5", "G1.5b", "G1.5c", "G1.6", "G4.2", "HARNESS-REGISTRY"],
  );
  const model = currentModel();
  model.dependencies["G2.2"] = ["G2.2", "G9.9", "G2.1", "G2.1"];

  const result = validateProgrammeModel(model, policy);

  assert.equal(assertion(result, "goap.dependencies-dag").status, "FAIL");
});

test("should reject a dependency cycle", () => {
  const model = currentModel();
  model.dependencies["G1.1"] = ["G1.2"];

  const result = validateProgrammeModel(model, policy);

  assert.equal(assertion(result, "goap.dependencies-dag").status, "FAIL");
});

test("should reject missing or contradictory ADR task ownership", () => {
  const model = currentModel();
  delete model.ownership["G4.8"];
  model.ownership["G4.7"] = ["ADR-0032", "ADR-0033"];

  const result = validateProgrammeModel(model, policy);

  assert.equal(
    assertion(result, "goap.ownership-rollups-controls").status,
    "FAIL",
  );
});

test("should reject missing escaping and symlinked local link targets", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"));
  writeFileSync(
    join(root, "docs", "source.md"),
    "[missing](missing.md) [escape](../../outside.md) [link](linked.md) [bad](https://[bad)\n",
  );
  writeFileSync(join(root, "outside.md"), "# Outside\n");
  symlinkSync(join(root, "outside.md"), join(root, "docs", "linked.md"));

  const result = validateMarkdownLinks(root, ["docs/source.md"]);

  assert.deepEqual(
    result.errors.map((error) => error.code).sort(),
    ["EXTERNAL_URL", "LINK_ESCAPE", "LINK_MISSING", "LINK_SYMLINK"],
  );
});

test("should implement GitHub duplicate-heading anchor resolution", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-anchors-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "target.md"), "# Same heading\n## Same heading\n");
  writeFileSync(
    join(root, "docs", "source.md"),
    "[first](target.md#same-heading) [second](target.md#same-heading-1)\n",
  );
  assert.equal(validateMarkdownLinks(root, ["docs/source.md"]).errors.length, 0);

  writeFileSync(
    join(root, "docs", "source.md"),
    "[bad](target.md#same-heading-2)\n",
  );
  assert.equal(validateMarkdownLinks(root, ["docs/source.md"]).errors[0].code, "ANCHOR_MISSING");
});

test("should reject unsafe document bytes and duplicate-key JSON", () => {
  const cases = [
    ["nul.md", Buffer.from("ok\0bad\n")],
    ["conflict.md", Buffer.from("<<<<<<< ours\n=======\n>>>>>>> theirs\n")],
    ["trailing.md", Buffer.from("bad  \n")],
    ["newline.md", Buffer.from("no newline")],
    ["duplicate.json", Buffer.from('{"same":1,"same":2}\n')],
  ];

  assert.deepEqual(
    cases.flatMap(([path, bytes]) => validateDocumentBytes(path, bytes).map((item) => item.code)),
    ["NUL_BYTE", "CONFLICT_MARKER", "TRAILING_WHITESPACE", "FINAL_NEWLINE", "STRICT_JSON"],
  );
});

test("should reject committed policy, source claim, command, and authority drift", (t) => {
  const model = currentModel();
  const claim = model.claims.find(
    (item) => item.path === "docs/adr/0017-repository-evolution-and-evidence-promotion-harness.md",
  );
  claim.present = false;

  const result = validateProgrammeModel(model, policy);

  assert.equal(assertion(result, "documents.format-and-strict-json").status, "FAIL");

  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tools", "evidence"), { recursive: true });
  const injected = structuredClone(policy);
  injected.quickCommands[0] = {
    id: "injected-shell",
    program: "sh",
    args: ["-c", "curl https://example.invalid"],
    timeoutMs: 120000,
  };
  const path = join(root, "tools", "evidence", "expanded-programme-qa-policy.json");
  writeFileSync(path, `${JSON.stringify(injected, null, 2)}\n`);
  assert.throws(
    () => loadExpandedProgrammePolicy(root),
    /command allowlist/,
  );
  const overclaim = structuredClone(policy);
  overclaim.authority.promotion = true;
  writeFileSync(path, `${JSON.stringify(overclaim, null, 2)}\n`);
  assert.throws(
    () => loadExpandedProgrammePolicy(root),
    /authority contract/,
  );
});
