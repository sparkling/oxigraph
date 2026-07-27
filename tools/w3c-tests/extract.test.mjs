import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extractCandidates } from "./extract.mjs";

const html = Buffer.from(`<!doctype html>
<section id="normative">
  <h2 id="normative-heading">Normative</h2>
  <p id="requirement">Processors <em>MUST</em> reject invalid input.</p>
  <ul><li>They SHOULD NOT guess and MAY report a diagnostic.</li></ul>
  <table><tr id="grammar-production-term"><td>term ::= IRI</td></tr></table>
  <div class="grammarTable"><table><tr><td>
    <span id="rQuery">Query</span>
  </td><td class="gRuleBody">::= Select</td></tr></table></div>
  <pre id="extra-production">Update ::= Insert
Delete ::= Remove</pre>
</section>`);

test("extracts bounded BCP14 blocks and structural grammar identifiers", () => {
  const extraction = extractCandidates(documentFor(html), html);
  const grouped = extraction.candidates.reduce((groups, candidate) => {
    (groups[candidate.kind] ??= []).push(candidate);
    return groups;
  }, {});
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(grouped).map(([kind, values]) => [kind, values.length]),
    ),
    {
      "bcp14-block": 2,
      "grammar-production": 2,
      "syntax-production": 2,
    },
  );
  assert.ok(
    extraction.candidates.every(
      (candidate) =>
        candidate.sectionRef === "normative" &&
        /^[0-9a-f]{64}$/.test(candidate.bindingSha256),
    ),
  );
});

test("candidate ids and bindings are deterministic", () => {
  const document = documentFor(html);
  assert.deepEqual(
    extractCandidates(document, html).candidates,
    extractCandidates(document, Buffer.from(html)).candidates,
  );
});

test("does not treat lowercase prose or non-paragraph blocks as BCP14 candidates", () => {
  const source = Buffer.from(
    '<section id="s"><p>implementations must behave</p><div>MUST</div></section>',
  );
  assert.equal(
    extractCandidates(documentFor(source), source).candidates.length,
    0,
  );
});

test("rejects source hash drift and duplicate HTML ids", () => {
  assert.throws(
    () =>
      extractCandidates({ ...documentFor(html), sha256: "0".repeat(64) }, html),
    /source hash mismatch/,
  );
  const duplicate = Buffer.from(
    '<section id="same"><p id="same">A processor MUST stop.</p></section>',
  );
  assert.throws(
    () => extractCandidates(documentFor(duplicate), duplicate),
    /duplicate HTML ids/,
  );
  const invalidUtf8 = Buffer.from([0xff]);
  assert.throws(
    () => extractCandidates(documentFor(invalidUtf8), invalidUtf8),
    /not valid UTF-8/,
  );
});

function documentFor(bytes) {
  return {
    id: "rdf-fixture",
    family: "rdf-1.2",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
