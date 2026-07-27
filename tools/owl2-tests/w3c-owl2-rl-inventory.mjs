#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWrite, repositoryRoot } from "./safe-output.mjs";

const SOURCE_URL =
  "https://www.w3.org/2009/11/owl-test/approved/profile-RL.rdf";
const SOURCE_SHA256 =
  "af67cd7a007cbed8a54255d094a88f7304ec950457e13df58b51f507c6c29d00";
const EXPECTED_CASES = 70;
const EXPECTED_RDF_BASED_CASES = 68;

const repoRoot = repositoryRoot;

function usage() {
  console.log(`W3C OWL 2 RL approved-test inventory

Usage:
  node tools/owl2-tests/w3c-owl2-rl-inventory.mjs [options]

Options:
  --source <path>  Read an already downloaded profile-RL.rdf
  --output <path>  Write inventory JSON (default: target/w3c/owl2-rl-inventory.json)
  --stdout         Write the inventory to stdout instead of a file
  --help           Show this help

Without --source, the tool downloads the pinned W3C export and verifies its
SHA-256 before parsing it.`);
}

function parseArgs(values) {
  const args = {
    source: null,
    output: resolve(repoRoot, "target/w3c/owl2-rl-inventory.json"),
    stdout: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help") {
      usage();
      process.exit(0);
    } else if (value === "--stdout") {
      args.stdout = true;
    } else if (value === "--source" || value === "--output") {
      const next = values[index + 1];
      if (!next) throw new Error(`${value} requires a path`);
      args[value.slice(2)] = resolve(next);
      index += 1;
    } else {
      throw new Error(`unknown option: ${value}`);
    }
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadSource(path) {
  if (path) return readFileSync(path);
  const response = await fetch(SOURCE_URL, {
    headers: { accept: "application/rdf+xml, application/xml;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`W3C download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function firstLiteral(body, localName) {
  const match = body.match(
    new RegExp(
      `<test:${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/test:${localName}>`,
    ),
  );
  return match ? decodeXml(match[1].trim()) : null;
}

function resources(body, element) {
  return [
    ...body.matchAll(
      new RegExp(`<${element} rdf:resource="&test;([^"]+)"\\s*\\/>`, "g"),
    ),
  ].map((match) => match[1]);
}

function parseCases(xml) {
  const cases = [];
  const casePattern =
    /<test:TestCase rdf:about="([^"]+)">([\s\S]*?)<\/test:TestCase>/g;
  for (const match of xml.matchAll(casePattern)) {
    const body = match[2];
    const status = resources(body, "test:status");
    const profiles = resources(body, "test:profile");
    cases.push({
      uri: decodeXml(match[1]),
      identifier: firstLiteral(body, "identifier"),
      description: firstLiteral(body, "description"),
      types: resources(body, "rdf:type").sort(),
      semantics: resources(body, "test:semantics").sort(),
      profiles: profiles.sort(),
      species: resources(body, "test:species").sort(),
      normativeSyntax: resources(body, "test:normativeSyntax").sort(),
      status: status.at(0) ?? null,
      hasRdfXmlPremise: body.includes("<test:rdfXmlPremiseOntology"),
      hasRdfXmlConclusion: body.includes("<test:rdfXmlConclusionOntology"),
    });
  }
  return cases.sort((left, right) => left.uri.localeCompare(right.uri));
}

function assertInventory(cases) {
  if (cases.length !== EXPECTED_CASES) {
    throw new Error(
      `expected ${EXPECTED_CASES} approved RL cases, found ${cases.length}`,
    );
  }
  const nonApproved = cases.filter((item) => item.status !== "Approved");
  if (nonApproved.length > 0) {
    throw new Error(`${nonApproved.length} cases are not marked Approved`);
  }
  const outsideRl = cases.filter((item) => !item.profiles.includes("RL"));
  if (outsideRl.length > 0) {
    throw new Error(`${outsideRl.length} cases are not marked for RL`);
  }
  const rdfBased = cases.filter((item) =>
    item.semantics.includes("RDF-BASED"),
  );
  if (rdfBased.length !== EXPECTED_RDF_BASED_CASES) {
    throw new Error(
      `expected ${EXPECTED_RDF_BASED_CASES} RDF-based cases, found ${rdfBased.length}`,
    );
  }
}

function summarize(cases) {
  const countType = (type) =>
    cases.filter((item) => item.types.includes(type)).length;
  return {
    approvedRlCases: cases.length,
    rdfBasedCases: cases.filter((item) =>
      item.semantics.includes("RDF-BASED"),
    ).length,
    directSemanticsCases: cases.filter((item) =>
      item.semantics.includes("DIRECT"),
    ).length,
    positiveEntailmentCases: countType("PositiveEntailmentTest"),
    negativeEntailmentCases: countType("NegativeEntailmentTest"),
    consistencyCases: countType("ConsistencyTest"),
    inconsistencyCases: countType("InconsistencyTest"),
    rdfXmlPremiseCases: cases.filter((item) => item.hasRdfXmlPremise).length,
    rdfXmlConclusionCases: cases.filter((item) => item.hasRdfXmlConclusion)
      .length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await loadSource(args.source);
  const observedSha256 = sha256(source);
  if (observedSha256 !== SOURCE_SHA256) {
    throw new Error(
      `source SHA-256 mismatch: expected ${SOURCE_SHA256}, got ${observedSha256}`,
    );
  }
  const cases = parseCases(source.toString("utf8"));
  assertInventory(cases);
  const inventory = {
    schema: 1,
    source: {
      url: SOURCE_URL,
      sha256: observedSha256,
      status: "W3C OWL 2 approved test export",
    },
    summary: summarize(cases),
    cases,
  };
  const output = `${JSON.stringify(inventory, null, 2)}\n`;
  if (args.stdout) {
    process.stdout.write(output);
  } else {
    atomicWrite(args.output, output);
    console.log(
      `Wrote ${cases.length} hash-verified cases (${inventory.summary.rdfBasedCases} RDF-based, sha256=${observedSha256}) to ${args.output}`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
