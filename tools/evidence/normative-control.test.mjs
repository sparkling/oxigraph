import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { candidateSetHash } from "../w3c-tests/mapping.mjs";
import {
  validateNormativeControlAudit,
  validateNormativeControlAuditBytes,
  validateNormativeControlSource,
} from "./normative-control.mjs";

const repositoryRoot = realpathSync(resolve(import.meta.dirname, "../.."));

test("committed controls retain the exact bounded, non-conformance topology", () => {
  const source = validateNormativeControlSource(repositoryRoot);
  assert.equal(source.documents.length, 23);
  assert.equal(
    source.mappings.reduce((sum, item) => sum + item.candidateCount, 0),
    618,
  );
  assert.equal(source.controlFiles.length, 4);
});

test("strict receipt validation accepts the reviewed bounded contract", (t) => {
  const fixture = receiptFixture(t);
  const bytes = Buffer.from(`${JSON.stringify(fixture.audit)}\n`);
  const receipt = validateNormativeControlAuditBytes(bytes, fixture.options);
  assert.equal(receipt.scope.candidateDisposition, "mapped-unassessed");
  assert.equal(receipt.scope.clauseEnumerationComplete, false);
  assert.equal(receipt.scope.conformanceClaim, "none");
});

test("receipt validation rejects overclaims and injected claim fields", (t) => {
  const fixture = receiptFixture(t);
  const conformance = changed(fixture.audit, (audit) => {
    audit.scope.conformanceClaim = "full";
  });
  assert.throws(
    () => validateNormativeControlAudit(conformance, fixture.options),
    /overstates its bounded claim/,
  );

  const completeness = changed(fixture.audit, (audit) => {
    audit.scope.clauseEnumerationComplete = true;
  });
  assert.throws(
    () => validateNormativeControlAudit(completeness, fixture.options),
    /overstates its bounded claim/,
  );

  const injected = changed(fixture.audit, (audit) => {
    audit.scope.claimReady = true;
  });
  assert.throws(
    () => validateNormativeControlAudit(injected, fixture.options),
    /scope fields are invalid/,
  );
});

test("receipt validation rejects stale controls and candidate mappings", (t) => {
  const fixture = receiptFixture(t);
  const controls = changed(fixture.audit, (audit) => {
    audit.sourcePolicy.controlFiles[0].sha256 = "0".repeat(64);
  });
  assert.throws(
    () => validateNormativeControlAudit(controls, fixture.options),
    /control files changed/,
  );

  const candidate = changed(fixture.audit, (audit) => {
    audit.candidates[0].structuralRef = "different";
    audit.candidates[0].bindingSha256 = candidateBindingHash(
      audit.candidates[0],
    );
  });
  assert.throws(
    () => validateNormativeControlAudit(candidate, fixture.options),
    /candidate set is stale/,
  );
});

test("receipt validation rejects stale content hashes and duplicate JSON keys", (t) => {
  const fixture = receiptFixture(t);
  const stale = structuredClone(fixture.audit);
  stale.totals.candidates = 2;
  assert.throws(
    () => validateNormativeControlAudit(stale, fixture.options),
    /total candidates is invalid/,
  );

  const serialized = JSON.stringify(fixture.audit).replace(
    '"schemaVersion":1',
    '"schemaVersion":1,"schemaVersion":1',
  );
  assert.throws(
    () =>
      validateNormativeControlAuditBytes(
        Buffer.from(serialized),
        fixture.options,
      ),
    /duplicate object key "schemaVersion"/,
  );
});

test("source validation rejects a reviewed mapping status promotion", (t) => {
  const root = copiedControls(t);
  assert.equal(validateNormativeControlSource(root).documents.length, 23);
  const path = join(root, "tools/w3c-tests/reviewed-rdf-1.2.json");
  const mapping = JSON.parse(readFileSync(path, "utf8"));
  mapping.candidateDisposition = "pass";
  writeFileSync(path, `${JSON.stringify(mapping, null, 2)}\n`);
  assert.throws(
    () => validateNormativeControlSource(root),
    /reviewed mapping header is invalid/,
  );
});

function receiptFixture(t) {
  const root = temporary(t);
  const controlPaths = ["a.json", "b.json", "c.json", "d.json"];
  for (const [index, path] of controlPaths.entries()) {
    writeFileSync(join(root, path), `${index}\n`);
  }
  const sourceSha256 = sha256("source");
  const candidate = {
    id: `rdf-fixture:bcp14-block:${"0".repeat(24)}`,
    documentId: "rdf-fixture",
    family: "rdf-1.2",
    kind: "bcp14-block",
    sectionRef: "requirement",
    structuralRef: "must",
    keywords: ["MUST"],
    textSha256: sha256("Processors MUST comply."),
    sourceSha256,
    excerpt: "Processors MUST comply.",
  };
  candidate.bindingSha256 = candidateBindingHash(candidate);
  const mapping = {
    documentId: "rdf-fixture",
    family: "rdf-1.2",
    sourceSha256,
    candidateCount: 1,
    candidateSetSha256: candidateSetHash([candidate]),
    sectionRefs: ["requirement"],
  };
  const source = {
    documents: [
      {
        id: "rdf-fixture",
        family: "rdf-1.2",
        applicability: "applicable",
        url: "https://example.test/spec",
        sha256: sourceSha256,
      },
    ],
    mappings: [mapping],
    controlFiles: controlPaths.map((path) => {
      const bytes = readFileSync(join(root, path));
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
  const contract = {
    schemaVersion: 1,
    families: ["rdf-1.2"],
    documents: 1,
    candidates: 1,
    bcp14Blocks: 1,
    grammarProductions: 0,
    extraction: "fixture extraction",
    exclusions: "fixture exclusion",
    candidateDisposition: "mapped-unassessed",
    clauseEnumerationComplete: false,
    conformanceClaim: "none",
    controlPaths,
  };
  const audit = {
    schemaVersion: 1,
    scope: {
      families: contract.families,
      registeredDocumentSetEquality: true,
      extraction: contract.extraction,
      exclusions: contract.exclusions,
      candidateDisposition: contract.candidateDisposition,
      clauseEnumerationComplete: contract.clauseEnumerationComplete,
      conformanceClaim: contract.conformanceClaim,
    },
    sourcePolicy: {
      registry: controlPaths[0],
      exactRegisteredResponseSha256Required: true,
      currentUrlFetchedOnEveryAudit: true,
      descriptorStableControlAndCacheReads: true,
      controlFiles: source.controlFiles,
    },
    totals: {
      documents: 1,
      candidates: 1,
      bcp14Blocks: 1,
      grammarProductions: 0,
    },
    documents: [
      {
        id: "rdf-fixture",
        family: "rdf-1.2",
        applicability: "applicable",
        registeredUrl: "https://example.test/spec",
        fetchedUrl: "https://example.test/spec",
        sourceSha256,
        sourceCache:
          `target/w3c/normative-control/sources/rdf-fixture-${sourceSha256}.html`,
        sectionCount: 1,
        candidateCount: 1,
        candidateSetSha256: mapping.candidateSetSha256,
      },
    ],
    candidates: [candidate],
  };
  audit.auditContentSha256 = contentHash(audit);
  return { audit, options: { root, source, contract } };
}

function copiedControls(t) {
  const root = temporary(t);
  for (const path of [
    "docs/research/normative-requirements.json",
    "docs/research/standards-registry.json",
    "tools/w3c-tests/reviewed-rdf-1.2.json",
    "tools/w3c-tests/reviewed-sparql-1.2.json",
  ]) {
    const destination = join(root, path);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    copyFileSync(join(repositoryRoot, path), destination);
  }
  return root;
}

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-normative-control-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function changed(audit, mutation) {
  const copy = structuredClone(audit);
  mutation(copy);
  copy.auditContentSha256 = contentHash(copy);
  return copy;
}

function contentHash(audit) {
  const { auditContentSha256: ignored, ...content } = audit;
  return sha256(JSON.stringify(content));
}

function candidateBindingHash(candidate) {
  return sha256(
    JSON.stringify([
      candidate.id,
      candidate.documentId,
      candidate.family,
      candidate.kind,
      candidate.sectionRef,
      candidate.structuralRef,
      candidate.keywords,
      candidate.textSha256,
      candidate.sourceSha256,
    ]),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
