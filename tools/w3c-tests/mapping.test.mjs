import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extractCandidates } from "./extract.mjs";
import { candidateSetHash, verifyReviewedMappings } from "./mapping.mjs";

const bytes = Buffer.from(
  '<section id="rules"><p id="rule">A parser MUST reject this.</p></section>',
);
const document = {
  id: "rdf-fixture",
  family: "rdf-1.2",
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const extraction = extractCandidates(document, bytes);

test("accepts exact candidate mapping equality", () => {
  const result = verifyReviewedMappings(
    [document],
    [{ document, extraction }],
    [mappedDocument()],
  );
  assert.equal(result[0].candidateCount, 1);
});

test("rejects missing and extra candidate mappings", () => {
  const missing = mappedDocument();
  missing.candidateCount = 0;
  assert.throws(
    () =>
      verifyReviewedMappings([document], [{ document, extraction }], [missing]),
    /candidate mapping count is stale/,
  );
  const extra = mappedDocument();
  extra.candidateSetSha256 = "a".repeat(64);
  assert.throws(
    () =>
      verifyReviewedMappings([document], [{ document, extraction }], [extra]),
    /candidate mappings are missing, extra, or stale/,
  );
});

test("rejects stale section refs, candidate bindings, and source hashes", () => {
  const staleSection = mappedDocument();
  staleSection.sectionRefs = ["old-section"];
  assert.throws(
    () =>
      verifyReviewedMappings(
        [document],
        [{ document, extraction }],
        [staleSection],
      ),
    /candidate section refs differ/,
  );
  const staleBinding = mappedDocument();
  staleBinding.candidateSetSha256 = "0".repeat(64);
  assert.throws(
    () =>
      verifyReviewedMappings(
        [document],
        [{ document, extraction }],
        [staleBinding],
      ),
    /candidate mappings are missing, extra, or stale/,
  );
  const staleSource = mappedDocument();
  staleSource.sourceSha256 = "0".repeat(64);
  assert.throws(
    () =>
      verifyReviewedMappings(
        [document],
        [{ document, extraction }],
        [staleSource],
      ),
    /source binding is stale/,
  );
});

function mappedDocument() {
  return {
    documentId: document.id,
    family: document.family,
    sourceSha256: document.sha256,
    candidateCount: extraction.candidates.length,
    candidateSetSha256: candidateSetHash(extraction.candidates),
    sectionRefs: [
      ...new Set(
        extraction.candidates.map((candidate) => candidate.sectionRef),
      ),
    ].sort(),
  };
}
