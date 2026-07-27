const extraction =
  "Uppercase BCP 14 keywords in HTML paragraph/list elements plus structurally identifiable grammar/syntax productions";
const exclusions =
  "This is a deterministic candidate topology, not a sentence-level normative-requirement enumeration.";

export const normativeControlContract = Object.freeze({
  schemaVersion: 1,
  families: Object.freeze(["rdf-1.2", "sparql-1.2"]),
  documents: 23,
  candidates: 618,
  bcp14Blocks: 213,
  grammarProductions: 405,
  extraction,
  exclusions,
  candidateDisposition: "mapped-unassessed",
  clauseEnumerationComplete: false,
  conformanceClaim: "none",
  controlPaths: Object.freeze([
    "docs/research/normative-requirements.json",
    "docs/research/standards-registry.json",
    "tools/w3c-tests/reviewed-rdf-1.2.json",
    "tools/w3c-tests/reviewed-sparql-1.2.json",
  ]),
});

export function assertNormativeControlContract({ families, totals }) {
  if (
    JSON.stringify(families) !==
      JSON.stringify(normativeControlContract.families) ||
    totals?.documents !== normativeControlContract.documents ||
    totals?.candidates !== normativeControlContract.candidates ||
    totals?.bcp14Blocks !== normativeControlContract.bcp14Blocks ||
    totals?.grammarProductions !== normativeControlContract.grammarProductions
  ) {
    throw new Error(
      "W3C normative control topology differs from the reviewed bounded contract",
    );
  }
}
