import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { extractClauseInventory } from "../w3c-tests/clause-extract.mjs";
import {
  validateNormativeClauseInventory,
  validateNormativeClauseInventoryBytes,
} from "./normative-clause-inventory.mjs";

test("accepts the exact source-bound, explicitly unassessed inventory", () => {
  const fixture = inventoryFixture();
  const inventory = validateNormativeClauseInventoryBytes(
    Buffer.from(`${JSON.stringify(fixture.inventory)}\n`),
    fixture.options,
  );
  assert.equal(inventory.scope.clauseEnumerationComplete, false);
  assert.equal(inventory.scope.conformanceClaim, "none");
  assert.ok(
    inventory.records.every(
      (record) =>
        record.actor === "unassessed" &&
        record.disposition === "unassessed",
    ),
  );
});

test("rejects overclaims and injected claim fields", () => {
  const fixture = inventoryFixture();
  for (const mutation of [
    (inventory) => {
      inventory.scope.clauseEnumerationComplete = true;
    },
    (inventory) => {
      inventory.scope.conformanceClaim = "full";
    },
  ]) {
    const inventory = changed(fixture.inventory, mutation);
    assert.throws(
      () => validateNormativeClauseInventory(inventory, fixture.options),
      /scope overstates its claim/,
    );
  }

  const scopeClaim = changed(fixture.inventory, (inventory) => {
    inventory.scope.claimReady = true;
  });
  assert.throws(
    () => validateNormativeClauseInventory(scopeClaim, fixture.options),
    /scope fields are invalid/,
  );
  const topLevelClaim = changed(fixture.inventory, (inventory) => {
    inventory.conformance = "full";
  });
  assert.throws(
    () => validateNormativeClauseInventory(topLevelClaim, fixture.options),
    /inventory fields are invalid/,
  );
});

test("rejects actor or disposition promotion after record hashes are repaired", () => {
  const fixture = inventoryFixture();
  for (const field of ["actor", "disposition"]) {
    const inventory = changed(fixture.inventory, (copy) => {
      copy.records[0][field] = field === "actor" ? "processor" : "pass";
      rebindRecord(copy.records[0]);
    });
    assert.throws(
      () => validateNormativeClauseInventory(inventory, fixture.options),
      /invalid W3C structural clause record/,
    );
  }
});

test("rejects record drift even when the attacker recomputes record hashes", () => {
  const fixture = inventoryFixture();
  const inventory = changed(fixture.inventory, (copy) => {
    copy.records[0].structuralRef = "attacker-reclassified";
    rebindRecord(copy.records[0]);
  });
  assert.throws(
    () => validateNormativeClauseInventory(inventory, fixture.options),
    /differs from source-bound extraction/,
  );

  const reordered = changed(fixture.inventory, (copy) => {
    [copy.records[0], copy.records[1]] = [copy.records[1], copy.records[0]];
  });
  assert.throws(
    () => validateNormativeClauseInventory(reordered, fixture.options),
    /differs from source-bound extraction/,
  );
});

test("rejects document, total, and kind-topology drift", () => {
  const fixture = inventoryFixture();
  const document = changed(fixture.inventory, (inventory) => {
    inventory.documents[0].sourceSha256 = "0".repeat(64);
  });
  assert.throws(
    () => validateNormativeClauseInventory(document, fixture.options),
    /document binding is invalid/,
  );

  const totals = changed(fixture.inventory, (inventory) => {
    inventory.totals.records += 1;
  });
  assert.throws(
    () => validateNormativeClauseInventory(totals, fixture.options),
    /totals are invalid/,
  );

  const kind = changed(fixture.inventory, (inventory) => {
    inventory.totals.byKind["invented-claim"] = 1;
  });
  assert.throws(
    () => validateNormativeClauseInventory(kind, fixture.options),
    /kinds fields are invalid/,
  );
});

test("rejects unreviewed fetch URLs and exact source-byte drift", () => {
  const fixture = inventoryFixture();
  const fetched = changed(fixture.inventory, (inventory) => {
    inventory.documents[0].fetchedUrl = "https://example.test/spec";
  });
  assert.throws(
    () => validateNormativeClauseInventory(fetched, fixture.options),
    /document binding is invalid/,
  );

  assert.throws(
    () =>
      validateNormativeClauseInventory(fixture.inventory, {
        ...fixture.options,
        readSourceBytes: () => Buffer.from("<p>changed</p>"),
      }),
    /source hash mismatch/,
  );
});

test("rejects stale content hashes and duplicate JSON object keys", () => {
  const fixture = inventoryFixture();
  const staleHash = structuredClone(fixture.inventory);
  staleHash.inventoryContentSha256 = "0".repeat(64);
  assert.throws(
    () => validateNormativeClauseInventory(staleHash, fixture.options),
    /content hash is invalid/,
  );

  const stale = structuredClone(fixture.inventory);
  stale.qualification = "complete";
  assert.throws(
    () => validateNormativeClauseInventory(stale, fixture.options),
    /qualification is invalid/,
  );

  const serialized = JSON.stringify(fixture.inventory).replace(
    '"schemaVersion":1',
    '"schemaVersion":1,"schemaVersion":1',
  );
  assert.throws(
    () =>
      validateNormativeClauseInventoryBytes(
        Buffer.from(serialized),
        fixture.options,
      ),
    /duplicate object key "schemaVersion"/,
  );
});

test("default cache reader accepts only the canonical source-cache path", (t) => {
  const fixture = inventoryFixture();
  const root = temporary(t);
  const sourceRoot = join(root, "target/w3c/normative-control/sources");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    join(
      sourceRoot,
      `${fixture.document.id}-${fixture.document.sha256}.html`,
    ),
    fixture.sourceBytes,
  );
  assert.doesNotThrow(() =>
    validateNormativeClauseInventory(fixture.inventory, {
      root: realpathSync(root),
      source: fixture.options.source,
    }),
  );

  const unsafeRoot = temporary(t);
  const outside = temporary(t);
  const link = join(unsafeRoot, "target/w3c/normative-control/sources");
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(outside, link, "dir");
  assert.throws(
    () =>
      validateNormativeClauseInventory(fixture.inventory, {
        root: realpathSync(unsafeRoot),
        source: fixture.options.source,
      }),
    /source directory is unsafe/,
  );
});

function inventoryFixture() {
  const sourceBytes = Buffer.from(`<!doctype html>
    <section id="requirements">
      <p id="duty">Processors MUST validate input.</p>
      <p id="ordinary">This paragraph defines ordinary behavior.</p>
      <dl><dt id="term">Term</dt><dd id="meaning">A normative meaning.</dd></dl>
      <table><tr id="grammar"><td>Query ::= Select Where</td></tr></table>
      <table><tr id="constraint"><td>Values are finite.</td></tr></table>
      <pre id="code">normative example without a grammar delimiter</pre>
    </section>`);
  const document = {
    id: "rdf-fixture",
    family: "rdf-1.2",
    applicability: "applicable",
    url: "https://www.w3.org/TR/rdf12-concepts/",
    sha256: sha256(sourceBytes),
  };
  const extraction = extractClauseInventory(document, sourceBytes);
  const records = structuredClone(extraction.records);
  const byKind = Object.fromEntries(
    [...new Set(records.map((record) => record.kind))]
      .sort()
      .map((kind) => [
        kind,
        records.filter((record) => record.kind === kind).length,
      ]),
  );
  const inventory = {
    schemaVersion: 1,
    qualification:
      "Over-inclusive structural review inventory; not a complete normative-clause enumeration or a conformance claim.",
    scope: {
      registeredDocumentSetEquality: true,
      sourceHashesExact: true,
      informativeDocumentsExcluded: true,
      informativeAndExampleAncestryExcluded: true,
      includes:
        "BCP14 sentences, normative prose blocks, definition-list entries, table rows, code blocks, and grammar productions with right-hand sides",
      knownLimitations:
        "Heuristic HTML tokenization and normative-region classification can over- or under-include content; actors and dispositions remain unassessed.",
      clauseEnumerationComplete: false,
      conformanceClaim: "none",
    },
    totals: {
      documents: 1,
      records: records.length,
      byKind,
    },
    documents: [
      {
        id: document.id,
        family: document.family,
        applicability: document.applicability,
        registeredUrl: document.url,
        fetchedUrl: document.url,
        sourceSha256: document.sha256,
        sectionCount: extraction.sectionIds.length,
        recordCount: records.length,
        recordSetSha256: sha256(
          JSON.stringify(records.map((record) => record.bindingSha256)),
        ),
      },
    ],
    records,
  };
  inventory.inventoryContentSha256 = contentHash(inventory);
  return {
    document,
    sourceBytes,
    inventory,
    options: {
      source: { documents: [document] },
      readSourceBytes: () => sourceBytes,
    },
  };
}

function changed(inventory, mutation) {
  const copy = structuredClone(inventory);
  mutation(copy);
  copy.inventoryContentSha256 = contentHash(copy);
  return copy;
}

function rebindRecord(record) {
  record.bindingSha256 = sha256(
    JSON.stringify([
      record.id,
      record.documentId,
      record.family,
      record.documentApplicability,
      record.kind,
      record.sectionRef,
      record.structuralRef,
      record.keywords,
      record.actor,
      record.disposition,
      record.textSha256,
      record.sourceSha256,
    ]),
  );
}

function contentHash(inventory) {
  const { inventoryContentSha256: ignored, ...content } = inventory;
  return sha256(JSON.stringify(content));
}

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-clause-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
