import assert from "node:assert/strict";
import test from "node:test";
import { validateRegisteredDocuments } from "./registry.mjs";

function fixtures() {
  const documents = [
    document("rdf-a", "rdf-1.2"),
    document("sparql-a", "sparql-1.2"),
  ];
  return {
    requirements: {
      documents,
      reviewState: {
        documentCoverage: {
          registered: 2,
          represented: 2,
          setEquality: true,
        },
      },
    },
    standards: {
      families: [family("rdf-1.2", "rdf-a"), family("sparql-1.2", "sparql-a")],
    },
  };
}

test("accepts an exactly equal registered RDF/SPARQL document set", () => {
  const { requirements, standards } = fixtures();
  assert.deepEqual(
    validateRegisteredDocuments(requirements, standards).map(({ id }) => id),
    ["rdf-a", "sparql-a"],
  );
});

test("rejects a missing or extra registered document", () => {
  const { requirements, standards } = fixtures();
  standards.families[0].documents[0].id = "rdf-extra";
  assert.throws(
    () => validateRegisteredDocuments(requirements, standards),
    /document sets differ/,
  );
});

test("rejects duplicate ids and stale family counts", () => {
  const { requirements, standards } = fixtures();
  requirements.documents.push({ ...requirements.documents[0] });
  requirements.reviewState.documentCoverage.registered = 3;
  requirements.reviewState.documentCoverage.represented = 3;
  assert.throws(
    () => validateRegisteredDocuments(requirements, standards),
    /duplicate requirements document id/,
  );

  const second = fixtures();
  second.standards.families[0].documentCount = 2;
  assert.throws(
    () => validateRegisteredDocuments(second.requirements, second.standards),
    /documentCount is stale/,
  );
});

test("rejects URL and SHA-256 drift", () => {
  const { requirements, standards } = fixtures();
  requirements.documents[0].url = "https://www.w3.org/changed";
  assert.throws(
    () => validateRegisteredDocuments(requirements, standards),
    /family or URL mismatch/,
  );
  const unreviewed = fixtures();
  unreviewed.requirements.documents[0].url = "https://attacker.example/rdf-a";
  unreviewed.standards.families[0].documents[0].url =
    "https://attacker.example/rdf-a";
  assert.throws(
    () =>
      validateRegisteredDocuments(
        unreviewed.requirements,
        unreviewed.standards,
      ),
    /unreviewed W3C document URL/,
  );
  const second = fixtures();
  second.requirements.documents[0].sha256 = "0".repeat(63);
  assert.throws(
    () => validateRegisteredDocuments(second.requirements, second.standards),
    /invalid registered SHA-256/,
  );
});

function document(id, familyId) {
  return {
    id,
    family: familyId,
    url: `https://www.w3.org/${id}`,
    sha256: "a".repeat(64),
    applicability: "applicable",
  };
}

function family(id, documentId) {
  return {
    id,
    documentCount: 1,
    documents: [{ id: documentId, url: `https://www.w3.org/${documentId}` }],
  };
}
