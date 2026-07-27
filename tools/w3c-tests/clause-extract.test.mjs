import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extractClauseInventory } from "./clause-extract.mjs";

function document(bytes, applicability = "applicable") {
  return {
    id: "rdf-fixture",
    family: "rdf-1.2",
    applicability,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test("captures sentence clauses, definitions, tables, and full grammar rows", () => {
  const source = Buffer.from(`<!doctype html>
    <section id="normative">
      <p id="duties">Processors <em class="rfc2119">must</em> stop. They MAY warn.</p>
      <dl><dt id="term">Term</dt><dd>A normative definition.</dd></dl>
      <table><tr id="rQuery"><td>Query</td><td>::= Select Where</td></tr></table>
      <table><tr id="rdfXml"><td>6.2.5 Production nodeElementIRIs</td>
        <td>anyURI - ( coreSyntaxTerms | rdf:li | oldTerms )</td></tr></table>
      <table><tr id="constraint"><td>A value is valid only when finite.</td></tr></table>
      <pre id="grammar">Insert ::= "INSERT" Data
Delete ::= "DELETE" Data</pre>
      <section id="section-grammar-productions">
        <section id="annotationAttr">
          <h4>6.2.26 Production annotationAttr</h4>
          <div class="productionOuter"><p>attribute(IRI == rdf:annotation)</p></div>
        </section>
      </section>
    </section>`);
  const records = extractClauseInventory(document(source), source).records;
  const kinds = records.reduce((counts, record) => {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(kinds, {
    "bcp14-clause": 2,
    "grammar-production": 5,
    "normative-definition": 2,
    "normative-table-row": 1,
  });
  assert.ok(
    records.some(
      (record) =>
        record.kind === "grammar-production" &&
        record.excerpt === "Query ::= Select Where",
    ),
  );
  assert.ok(
    records.some(
      (record) =>
        record.kind === "grammar-production" &&
        record.excerpt ===
          "6.2.5 Production nodeElementIRIs anyURI - ( coreSyntaxTerms | rdf:li | oldTerms )",
    ),
  );
  assert.ok(
    records.some(
      (record) =>
        record.kind === "grammar-production" &&
        record.excerpt ===
          "Production annotationAttr attribute(IRI == rdf:annotation)",
    ),
  );
});

test("excludes informative/example ancestry and avoids nested list duplication", () => {
  const source = Buffer.from(`
    <section id="normative">
      <ul><li>Outer text.<p id="inner">A processor MUST stop.</p></li></ul>
      <aside><p>A processor MUST ignore this example.</p></aside>
      <section id="info" class="informative"><p>MUST not be captured.</p></section>
    </section>`);
  const records = extractClauseInventory(document(source), source).records;
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record) => record.excerpt).sort(),
    ["A processor MUST stop.", "Outer text."],
  );
});

test("retains non-BCP14 literal invariants from mixed list items", () => {
  const source = Buffer.from(`
    <section id="section-Graph-Literal">
      <ol>
        <li id="language-component">
          If and only if the datatype IRI is rdf:langString, there is a
          non-empty language tag. The language tag
          <em class="rfc2119">MUST</em> be well-formed.
        </li>
      </ol>
    </section>`);
  const records = extractClauseInventory(document(source), source).records;
  assert.equal(records.length, 2);
  assert.ok(
    records.some(
      (record) =>
        record.kind === "normative-prose-block" &&
        record.structuralRef === "language-component:context" &&
        record.excerpt ===
          "If and only if the datatype IRI is rdf:langString, there is a non-empty language tag.",
    ),
  );
  assert.ok(
    records.some(
      (record) =>
        record.kind === "bcp14-clause" &&
        record.keywords.includes("MUST") &&
        record.excerpt === "The language tag MUST be well-formed.",
    ),
  );
});

test("informative documents produce no processor-clause candidates", () => {
  const source = Buffer.from(
    '<section id="guide"><p>A processor MUST do something.</p></section>',
  );
  assert.deepEqual(
    extractClauseInventory(document(source, "informative"), source).records,
    [],
  );
});

test("rejects source drift, duplicate ids, and invalid UTF-8", () => {
  const source = Buffer.from('<section id="same"><p id="same">Text.</p></section>');
  assert.throws(
    () => extractClauseInventory(document(source), source),
    /duplicate HTML ids/,
  );
  assert.throws(
    () =>
      extractClauseInventory(
        { ...document(source), sha256: "0".repeat(64) },
        source,
      ),
    /source hash mismatch/,
  );
  const invalid = Buffer.from([0xff]);
  assert.throws(
    () => extractClauseInventory(document(invalid), invalid),
    /not valid UTF-8/,
  );
});
