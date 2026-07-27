#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { atomicWrite, repositoryRoot } from "./safe-output.mjs";

const SOURCE_URL =
  "https://www.w3.org/2009/11/owl-test/approved/profile-RL.rdf";
const SOURCE_SHA256 =
  "af67cd7a007cbed8a54255d094a88f7304ec950457e13df58b51f507c6c29d00";
const SUPPORT_011_IRI =
  "http://www.w3.org/2002/03owlt/imports/support011-A";
const SUPPORT_011_URL =
  "https://www.w3.org/2002/03owlt/imports/support011-A";
const SUPPORT_011_SHA256 =
  "f92a919635e21ad412662c5544a1a9003652a3c8a09ae25620fc2e29a72a2572";
const EXPECTED_CASES = 70;
const EXPECTED_RDF_BASED = 68;
const EXPECTED_ASSERTIONS = 98;
const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = repositoryRoot;

function args(values) {
  const parsed = {
    source: null,
    output: resolve(repoRoot, "target/w3c/owl2-rl-execution.json"),
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--source" || value === "--output") {
      if (!values[index + 1]) throw new Error(`${value} requires a path`);
      parsed[value.slice(2)] = resolve(values[index + 1]);
      index += 1;
    } else if (value === "--help") {
      console.log(`Usage: node tools/owl2-tests/execute-w3c-owl2-rl.mjs
  [--source profile-RL.rdf] [--output receipt.json]`);
      process.exit(0);
    } else {
      throw new Error(`unknown option: ${value}`);
    }
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sourceBytes(path) {
  if (path) return readFileSync(path);
  return fetchPinnedBytes(SOURCE_URL, "W3C source");
}

async function fetchPinnedBytes(url, label) {
  let lastFailure = "no response";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastFailure = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 4) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 1_000 * 2 ** attempt),
      );
    }
  }
  throw new Error(`${label} download failed after five attempts: ${lastFailure}`);
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function resources(body, element) {
  return [
    ...body.matchAll(
      new RegExp(`<${element} rdf:resource="&test;([^"]+)"\\s*\\/>`, "g"),
    ),
  ].map((match) => match[1]);
}

function literal(body, name) {
  const match = body.match(
    new RegExp(`<test:${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/test:${name}>`),
  );
  return match ? decodeXml(match[1].trim()) : "";
}

function cases(xml) {
  const output = [];
  const pattern =
    /<test:TestCase rdf:about="([^"]+)">([\s\S]*?)<\/test:TestCase>/g;
  for (const match of xml.matchAll(pattern)) {
    const body = match[2];
    output.push({
      uri: decodeXml(match[1]),
      identifier: literal(body, "identifier") || decodeXml(match[1]),
      types: resources(body, "rdf:type"),
      semantics: resources(body, "test:semantics"),
      premise: literal(body, "rdfXmlPremiseOntology"),
      functionalPremise: literal(body, "fsPremiseOntology"),
      conclusion: literal(body, "rdfXmlConclusionOntology"),
      nonConclusion: literal(body, "rdfXmlNonConclusionOntology"),
    });
  }
  return output;
}

function assertions(testCase) {
  const output = [];
  const add = (type, mode, result = "") => {
    if (testCase.types.includes(type)) {
      if (result && !testCase[result]) {
        throw new Error(`${testCase.identifier} has no RDF/XML ${result}`);
      }
      output.push({ mode, result });
    }
  };
  add("PositiveEntailmentTest", "positive", "conclusion");
  add("NegativeEntailmentTest", "negative", "nonConclusion");
  add("ConsistencyTest", "consistency");
  add("InconsistencyTest", "inconsistency");
  return output;
}

function writeCorpus(temp, applicable, support011) {
  const supportPath = resolve(temp, "support011-A.rdf");
  writeFileSync(supportPath, support011);
  const rows = [];
  for (const [caseIndex, testCase] of applicable.entries()) {
    const premise = resolve(
      temp,
      `${caseIndex}-premise.${testCase.premise ? "rdf" : "nt"}`,
    );
    const conclusion = resolve(temp, `${caseIndex}-conclusion.rdf`);
    const nonConclusion = resolve(temp, `${caseIndex}-non-conclusion.rdf`);
    writeFileSync(
      premise,
      testCase.premise || functionalToNTriples(testCase.functionalPremise),
    );
    writeFileSync(conclusion, testCase.conclusion);
    writeFileSync(nonConclusion, testCase.nonConclusion);
    for (const { mode, result } of assertions(testCase)) {
      rows.push(
        [
          testCase.identifier,
          mode,
          premise,
          result === "nonConclusion" ? nonConclusion : conclusion,
          testCase.premise.includes(SUPPORT_011_IRI) ? supportPath : "-",
        ].join("\t"),
      );
    }
  }
  const manifest = resolve(temp, "manifest.tsv");
  writeFileSync(manifest, `${rows.join("\n")}\n`);
  return { manifest, assertionCount: rows.length };
}

function functionalToNTriples(source) {
  if (!source) return "";
  const prefixes = new Map();
  for (const match of source.matchAll(
    /Prefix\(\s*([^:=\s]*):?=\s*<([^>]+)>\s*\)/g,
  )) {
    prefixes.set(match[1], match[2]);
  }
  const iri = (value) => {
    const token = value.trim();
    if (token.startsWith("<") && token.endsWith(">")) return token.slice(1, -1);
    const separator = token.indexOf(":");
    const prefix = separator < 0 ? "" : token.slice(0, separator);
    const local = separator < 0 ? token : token.slice(separator + 1);
    if (!prefixes.has(prefix)) throw new Error(`unknown FS prefix: ${token}`);
    return `${prefixes.get(prefix)}${local}`;
  };
  const literal = (value) =>
    value.replace(
      /\^\^([A-Za-z_][\w.-]*:|:)([\w.-]+)$/,
      (_, prefix, local) => `^^<${iri(`${prefix}${local}`)}>`,
    );
  const triples = [];
  const add = (subject, predicate, object) => {
    triples.push(`<${iri(subject)}> <${iri(predicate)}> ${object} .`);
  };
  for (const match of source.matchAll(/FunctionalDataProperty\((\S+)\)/g)) {
    add(
      match[1],
      "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>",
      "<http://www.w3.org/2002/07/owl#FunctionalProperty>",
    );
  }
  for (const match of source.matchAll(/DataPropertyRange\((\S+)\s+(\S+)\)/g)) {
    add(
      match[1],
      "<http://www.w3.org/2000/01/rdf-schema#range>",
      `<${iri(match[2])}>`,
    );
  }
  for (const match of source.matchAll(
    /ClassAssertion\(DataHasValue\((\S+)\s+("(?:[^"\\]|\\.)*"\^\^\S+)\)\s+(\S+)\)/g,
  )) {
    add(match[3], match[1], literal(match[2]));
  }
  for (const match of source.matchAll(
    /DataPropertyAssertion\((\S+)\s+(\S+)\s+("(?:[^"\\]|\\.)*"\^\^\S+)\)/g,
  )) {
    add(match[2], match[1], literal(match[3]));
  }
  return `${triples.join("\n")}\n`;
}

function runNative(manifest) {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      resolve(toolDir, "native-runner/Cargo.toml"),
      "--",
      manifest,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`native runner failed:\n${result.stderr}`);
  }
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const options = args(process.argv.slice(2));
  const source = await sourceBytes(options.source);
  if (sha256(source) !== SOURCE_SHA256) {
    throw new Error(`W3C source SHA-256 mismatch: ${sha256(source)}`);
  }
  const allCases = cases(source.toString("utf8"));
  if (allCases.length !== EXPECTED_CASES) {
    throw new Error(`expected ${EXPECTED_CASES} cases, found ${allCases.length}`);
  }
  const applicable = allCases.filter((item) =>
    item.semantics.includes("RDF-BASED"),
  );
  const support011 = await fetchPinnedBytes(SUPPORT_011_URL, "W3C import");
  if (sha256(support011) !== SUPPORT_011_SHA256) {
    throw new Error(`W3C import SHA-256 mismatch: ${sha256(support011)}`);
  }
  if (applicable.length !== EXPECTED_RDF_BASED) {
    throw new Error(
      `expected ${EXPECTED_RDF_BASED} RDF-based cases, found ${applicable.length}`,
    );
  }
  const temp = mkdtempSync(resolve(tmpdir(), "oxowl-w3c-"));
  try {
    const corpus = writeCorpus(temp, applicable, support011);
    if (corpus.assertionCount !== EXPECTED_ASSERTIONS) {
      throw new Error(
        `expected ${EXPECTED_ASSERTIONS} assertions, found ${corpus.assertionCount}`,
      );
    }
    const results = runNative(corpus.manifest);
    if (results.length !== corpus.assertionCount) {
      throw new Error(
        `expected ${corpus.assertionCount} results, got ${results.length}`,
      );
    }
    const failed = results.filter((item) => !item.passed);
    const receipt = {
      schema: 1,
      source: {
        url: SOURCE_URL,
        sha256: SOURCE_SHA256,
        approvedRlCases: allCases.length,
        rdfBasedCases: applicable.length,
      },
      imports: [
        {
          iri: SUPPORT_011_IRI,
          url: SUPPORT_011_URL,
          sha256: SUPPORT_011_SHA256,
        },
      ],
      execution: {
        assertions: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
      },
      failures: failed,
      results,
    };
    atomicWrite(options.output, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(
      `OWL 2 RL/RDF: ${receipt.execution.passed}/${results.length} assertions passed`,
    );
    if (failed.length > 0) {
      for (const item of failed) {
        console.error(`${item.id} [${item.mode}]: ${item.error ?? "failed"}`);
      }
      process.exitCode = 1;
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
