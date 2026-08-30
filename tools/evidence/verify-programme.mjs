#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agenticGeneratedWithinQualificationWindow,
  documentClaims,
  expectedN3MaintenanceReceipt,
  expectedPins,
  semanticCommandIds,
  validateAdrIndex,
  validateDependencyClaims,
  validateDocumentClaims,
  validateFullReceipts,
  validateJsonDocuments,
  validateLedgerCounts,
  validateNormativeClaims,
  validateRegistryPins,
} from "./policy.mjs";
import {
  agenticRuntimeContentHash,
  implementationSnapshot as agenticImplementationSnapshot,
  readAgenticFileBytes,
  validateAgenticArtifactArchive,
  validateAgenticPublication,
  validateAgenticReceipt,
} from "../agentic-qe/evidence.mjs";
import {
  commands as agenticCommands,
  profiles as agenticProfiles,
} from "../agentic-qe/profile-definitions.mjs";
import {
  agenticQeDependencyResolution,
  agenticQeLockResolution,
} from "../agentic-qe/version-policy.mjs";
import { loadBoundMutationQualification } from "../metaharness/mutation-binding.mjs";
import { agenticQualificationBindingValid } from "../metaharness/agentic-binding.mjs";
import { validateNormativeClauseInventoryBytes } from "./normative-clause-inventory.mjs";
import {
  validateNormativeControlAuditBytes,
  validateNormativeControlSource,
} from "./normative-control.mjs";
import {
  darwinInstallationSnapshot,
  darwinLockResolution,
  protectedSnapshot,
  trustedRealGateValid,
  validateQualificationReceipt,
  validateVerificationReceipt,
} from "../metaharness/evidence.mjs";

const toolDir = dirname(fileURLToPath(import.meta.url));

function inside(root, path) {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

function regularPath(root, relativePath) {
  const lexical = resolve(root, relativePath);
  if (!inside(root, lexical))
    throw new Error(`${relativePath} escapes repository`);
  const metadata = lstatSync(lexical);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${relativePath} is not a regular non-symlink file`);
  }
  const canonical = realpathSync(lexical);
  if (!inside(root, canonical))
    throw new Error(`${relativePath} resolves outside repository`);
  return canonical;
}

function directoryPath(root, relativePath) {
  const lexical = resolve(root, relativePath);
  if (!inside(root, lexical))
    throw new Error(`${relativePath} escapes repository`);
  const metadata = lstatSync(lexical);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${relativePath} is not a regular non-symlink directory`);
  }
  const canonical = realpathSync(lexical);
  if (!inside(root, canonical))
    throw new Error(`${relativePath} resolves outside repository`);
  return canonical;
}

function text(root, relativePath) {
  return readFileSync(regularPath(root, relativePath), "utf8");
}

function json(root, relativePath) {
  try {
    return JSON.parse(text(root, relativePath));
  } catch (error) {
    throw new Error(
      `${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collect(errors, label, operation) {
  try {
    return operation();
  } catch (error) {
    errors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function gitHead(path) {
  if (!existsSync(join(path, ".git"))) {
    throw new Error(`registered checkout is uninitialized: ${path}`);
  }
  return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const allCurrentClaims = documentClaims;
const adrClaimIds = Object.freeze({
  "0001-outcome-oriented-jena-parity.md": ["Jena"],
  "0002-rdf-native-datalog-engine.md": ["Datalog"],
  "0003-w3c-12-conformance-baseline.md": [
    "RDF 1.2",
    "SPARQL 1.2",
    "RDFS",
    "SHACL 1.2",
  ],
  "0005-agentic-qe-integration.md": ["Agentic-QE"],
  "0007-owl-profiles-over-datalog.md": ["OWL 2 RL"],
  "0008-shacl-processor-profiles.md": ["SHACL 1.2"],
  "0009-snapshot-reasoning-materialization.md": ["semantic integration"],
  "0010-bounded-rdf-dataset-canonicalization.md": ["RDF canonicalization"],
  "0012-immutable-broad-jena-harness.md": ["Jena"],
  "0013-mutation-competence-and-provenance.md": ["Datalog"],
});

function readResearchJson(root, errors) {
  const directory = resolve(root, "docs/research");
  const documents = new Map();
  const names =
    collect(errors, "docs/research", () =>
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort(),
    ) ?? [];
  for (const name of names) {
    const value = collect(errors, `docs/research/${name}`, () =>
      json(root, `docs/research/${name}`),
    );
    if (value !== undefined) documents.set(name, value);
  }
  return documents;
}

function verifyN3MaintenanceReceiptIntegrity(root, errors) {
  const relativePath = `docs/research/${expectedN3MaintenanceReceipt.path}`;
  const bytes = collect(errors, `${relativePath} bytes`, () =>
    readFileSync(regularPath(root, relativePath)),
  );
  if (bytes === undefined) return;
  const actual = sha256(bytes);
  if (actual !== expectedN3MaintenanceReceipt.sha256) {
    errors.push(
      `${relativePath}: expected SHA-256 ${expectedN3MaintenanceReceipt.sha256}, got ${actual}`,
    );
  }
}

function verifyDocuments(root, errors) {
  for (const relativePath of [
    "docs/research/semantic-parity-current-summary.md",
    "docs/plans/semantic-parity-metaharness-plan.md",
    "docs/research/semantic-parity-programme.html",
  ]) {
    const value = collect(errors, relativePath, () => text(root, relativePath));
    if (value !== undefined) {
      validateDocumentClaims(relativePath, value, allCurrentClaims, errors);
    }
  }
  for (const [name, ids] of Object.entries(adrClaimIds)) {
    const relativePath = `docs/adr/${name}`;
    const value = collect(errors, relativePath, () => text(root, relativePath));
    if (value === undefined) continue;
    const claims = allCurrentClaims
      .filter((claim) => ids.includes(claim.id))
      .map((claim) => ({ ...claim, documentWide: true }));
    validateDocumentClaims(relativePath, value, claims, errors);
  }
}

function verifyAdrIndex(root, errors) {
  const directory = resolve(root, "docs/adr");
  const names = collect(
    errors,
    "docs/adr",
    () =>
      new Set(
        readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => entry.name),
      ),
  );
  const index = collect(errors, "docs/adr/README.md", () =>
    text(root, "docs/adr/README.md"),
  );
  if (names && index !== undefined) validateAdrIndex(index, names, errors);
}

function checkoutHeads(root, mode, errors, resolveHead) {
  const paths = {
    "w3c-rdf-tests": "testsuite/rdf-tests",
    "w3c-rdf-canon-tests": "testsuite/rdf-canon",
    "w3c-json-ld-api": "testsuite/json-ld-api",
    "w3c-json-ld-streaming": "testsuite/json-ld-streaming",
    "w3c-n3": "testsuite/N3",
  };
  const heads = {};
  for (const [id, relativePath] of Object.entries(paths)) {
    const head = collect(errors, `${id} checkout`, () =>
      resolveHead(directoryPath(root, relativePath)),
    );
    if (head !== undefined) heads[id] = head;
  }
  const shaclPath = resolve(
    root,
    `target/w3c/shacl-1.2/data-shapes-${expectedPins["w3c-data-shapes"].slice(0, 12)}`,
  );
  if (existsSync(shaclPath)) {
    const head = collect(errors, "w3c-data-shapes checkout", () =>
      resolveHead(directoryPath(root, relative(root, shaclPath))),
    );
    if (head !== undefined) heads["w3c-data-shapes"] = head;
  } else if (mode === "full") {
    errors.push(
      "w3c-data-shapes checkout: pinned full-mode checkout is missing",
    );
  }
  return heads;
}

function verifyShaclSourcePin(root, errors) {
  const paths = [
    "tools/shacl-tests/inventory.mjs",
    "tools/shacl-tests/clause-audit.mjs",
  ];
  for (const relativePath of paths) {
    const value = collect(errors, relativePath, () => text(root, relativePath));
    if (
      value !== undefined &&
      !value.includes(expectedPins["w3c-data-shapes"])
    ) {
      errors.push(
        `${relativePath}: does not bind the current W3C Data Shapes pin`,
      );
    }
  }
}

function readReceipts(root, errors) {
  const paths = {
    meta: "target/metaharness/qualification.json",
    metaVerification: "target/metaharness/verification.json",
  };
  const receipts = {};
  const receiptBytes = {};
  for (const [id, relativePath] of Object.entries(paths)) {
    const bytes = collect(errors, `${id} receipt bytes`, () =>
      readAgenticFileBytes(relativePath, { repositoryRoot: root }),
    );
    if (bytes === undefined) continue;
    receiptBytes[id] = bytes;
    const value = collect(errors, `${id} receipt`, () => JSON.parse(bytes));
    if (value !== undefined) receipts[id] = value;
  }

  let mutationProjection;
  if (!receipts.meta?.mutation?.path) {
    errors.push("mutation publication: MetaHarness binding is missing");
  } else {
    collect(errors, "mutation source-bound receipt contract", () => {
      const loaded = loadBoundMutationQualification(
        root,
        receipts.meta.mutation,
      );
      receipts.mutation = loaded.receipt;
      mutationProjection = loaded.verified;
    });
  }

  let agenticProjection;
  const binding = receipts.meta?.realGate?.agenticReceipt;
  if (!agenticQualificationBindingValid(binding)) {
    errors.push("Agentic-QE publication: MetaHarness binding is missing");
  } else {
    const agenticBytes = collect(errors, "Agentic-QE receipt bytes", () =>
      readAgenticFileBytes(binding.path, { repositoryRoot: root }),
    );
    if (agenticBytes) {
      const agentic = collect(errors, "Agentic-QE receipt", () =>
        JSON.parse(agenticBytes),
      );
      if (agentic) receipts.agentic = agentic;
    }
    if (receipts.agentic && agenticBytes) {
      collect(errors, "Agentic-QE receipt contract", () => {
        const agenticQeDependency = agenticQeDependencyResolution();
        const selected = agenticProfiles["metaharness-semantic-gate"];
        const publication = validateAgenticPublication(receipts.agentic, {
          repositoryRoot: root,
        });
        receipts.agentic = publication.receipt;
        validateAgenticReceipt(receipts.agentic, {
          expectedProfile: "metaharness-semantic-gate",
          expectedAgenticQeVersion: agenticQeDependency.version,
          expectedAgenticQeDependency: agenticQeDependency,
          expectedRuntimeContentHash: binding.runtimeContentHash,
          expectedCommandIds: semanticCommandIds,
          expectedCommands: agenticCommands,
          minimumGeneratedAtMs: Date.parse(receipts.meta.startedAt),
          maximumGeneratedAtMs: Date.parse(receipts.meta.finishedAt),
        });
        if (
          !agenticGeneratedWithinQualificationWindow(
            receipts.meta,
            receipts.agentic,
          )
        ) {
          throw new Error(
            "Agentic-QE receipt was not generated within the qualification interval",
          );
        }
        const archive = validateAgenticArtifactArchive(receipts.agentic, {
          repositoryRoot: root,
        });
        if (!publication.receiptBytes.equals(agenticBytes)) {
          throw new Error(
            "qualification receipt differs from immutable publication",
          );
        }
        const verifierRoot = realpathSync(resolve(toolDir, "../.."));
        if (root !== verifierRoot) {
          throw new Error(
            "full verification must execute from the target repository",
          );
        }
        const implementation = agenticImplementationSnapshot(
          selected,
          agenticCommands,
        );
        if (
          implementation.contentHash !==
          receipts.agentic.implementation.contentHash
        ) {
          throw new Error("Agentic-QE implementation snapshot is stale");
        }
        if (
          binding.path !== receipts.agentic.publication.receiptPath ||
          binding.oraclePath !== receipts.agentic.publication.oraclePath ||
          binding.sha256 !== sha256(agenticBytes) ||
          binding.oracleSha256 !== sha256(publication.oracleBytes) ||
          binding.schemaVersion !== receipts.agentic.schemaVersion ||
          binding.runId !== receipts.agentic.runId ||
          binding.generatedAt !== receipts.agentic.generatedAt ||
          binding.contentHash !== receipts.agentic.contentHash ||
          binding.executionHash !== receipts.agentic.executionHash ||
          binding.runtimeContentHash !==
            agenticRuntimeContentHash(receipts.agentic.runtime) ||
          binding.implementationContentHash !== implementation.contentHash ||
          binding.artifactContentHash !==
            receipts.agentic.artifacts.contentHash ||
          binding.archiveContentHash !== archive.contentHash ||
          binding.archiveRoot !== archive.root ||
          binding.archiveFileCount !== archive.files.length
        ) {
          throw new Error(
            "MetaHarness Agentic-QE binding differs from publication",
          );
        }
        receipts.agenticOracle = publication.oracle;
        agenticProjection = {
          schemaVersion: receipts.agentic.schemaVersion,
          runId: receipts.agentic.runId,
          generatedAt: receipts.agentic.generatedAt,
          receiptSha256: sha256(agenticBytes),
          oracleSha256: sha256(publication.oracleBytes),
          contentHash: receipts.agentic.contentHash,
          executionHash: receipts.agentic.executionHash,
          runtimeContentHash: agenticRuntimeContentHash(
            receipts.agentic.runtime,
          ),
          implementationContentHash: implementation.contentHash,
          artifactContentHash: receipts.agentic.artifacts.contentHash,
          archiveContentHash: archive.contentHash,
        };
      });
      for (const [id, sourcePath] of [
        ["jena", "target/jena-parity/parity-receipt.json"],
        ["shaclInventory", "target/w3c/shacl-1.2/inventory.json"],
        ["shacl", "target/w3c/shacl-1.2/run-receipt.json"],
        ["shaclJenaCompact", "target/datalog-oracles/jena-shaclc/receipt.json"],
        ["normativeControl", "target/w3c/normative-control/audit.json"],
        [
          "normativeClauseInventory",
          "target/w3c/normative-control/clause-inventory.json",
        ],
      ]) {
        const matches =
          receipts.agentic.artifacts?.archive?.files?.filter(
            (file) => file?.sourcePath === sourcePath,
          ) ?? [];
        if (matches.length !== 1) {
          errors.push(
            `Agentic-QE archive: expected one ${sourcePath} binding, got ${matches.length}`,
          );
          continue;
        }
        const value = collect(errors, `${id} archived receipt`, () => {
          const file = matches[0];
          const bytes = readAgenticFileBytes(file.path, {
            repositoryRoot: root,
          });
          if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
            throw new Error("archive bytes differ from the immutable manifest");
          }
          if (id === "normativeControl") {
            return validateNormativeControlAuditBytes(bytes, { root });
          }
          if (id === "normativeClauseInventory") {
            return validateNormativeClauseInventoryBytes(bytes, { root });
          }
          return JSON.parse(bytes);
        });
        if (value !== undefined) receipts[id] = value;
      }
    }
  }

  if (receipts.meta) {
    collect(errors, "MetaHarness qualification contract", () => {
      const darwin = darwinInstallationSnapshot(
        root,
        join(root, "tools", "metaharness"),
      );
      validateQualificationReceipt(receipts.meta, {
        expectedDarwinVersion: darwin.version,
        requireFull: true,
      });
      if (!trustedRealGateValid(receipts.meta.realGate)) {
        throw new Error("MetaHarness real gate is not independently closed");
      }
      const current = protectedSnapshot(root);
      if (
        current.contentHash !== receipts.meta.inputs.after.contentHash ||
        darwin.contentHash !== receipts.meta.inputs.darwin.after.contentHash
      ) {
        throw new Error("MetaHarness qualification inputs are stale");
      }
      const nodePath = realpathSync(receipts.meta.runtime.node.path);
      const currentNodePath = realpathSync(process.execPath);
      if (
        nodePath !== currentNodePath ||
        receipts.meta.runtime.node.path !== currentNodePath ||
        receipts.meta.runtime.node.invokedPath !== process.execPath ||
        sha256(readFileSync(nodePath)) !==
          receipts.meta.runtime.node.executableSha256 ||
        process.version !== receipts.meta.runtime.node.version ||
        receipts.meta.runtime.platform !== process.platform ||
        receipts.meta.runtime.architecture !== process.arch
      ) {
        throw new Error("MetaHarness qualification Node provenance drifted");
      }
      if (!receipts.metaVerification) {
        throw new Error("MetaHarness verification receipt is missing");
      }
      validateVerificationReceipt(receipts.metaVerification, {
        qualification: {
          path: paths.meta,
          sha256: sha256(receiptBytes.meta),
          contentHash: receipts.meta.contentHash,
        },
        protectedContentHash: current.contentHash,
        darwinContentHash: darwin.contentHash,
        mutation: mutationProjection,
        agentic: agenticProjection,
      });
    });
  }
  return receipts;
}

export function verifyProgramme(
  rootInput,
  { mode = "source-only", resolveHead = gitHead } = {},
) {
  if (!["source-only", "full"].includes(mode))
    throw new Error(`unsupported mode: ${mode}`);
  const root = realpathSync(rootInput);
  const errors = [];
  const documents = readResearchJson(root, errors);
  validateJsonDocuments(documents, errors);
  verifyN3MaintenanceReceiptIntegrity(root, errors);
  const ledger = documents.get("conformance-ledger.json");
  const normative = documents.get("normative-requirements.json");
  const registry = documents.get("standards-registry.json");
  if (ledger) validateLedgerCounts(ledger, errors);
  const dependencyResolutions = {
    agenticQe: collect(errors, "Agentic-QE dependency policy", () =>
      agenticQeLockResolution({
        adapterDir: join(root, "tools/agentic-qe"),
        repositoryRoot: root,
      }),
    ),
    darwin: collect(errors, "Darwin dependency policy", () =>
      darwinLockResolution(root, join(root, "tools/metaharness")),
    ),
  };
  if (ledger) validateDependencyClaims(ledger, dependencyResolutions, errors);
  if (normative && ledger) validateNormativeClaims(normative, ledger, errors);
  collect(errors, "W3C normative control source", () =>
    validateNormativeControlSource(root),
  );

  const heads = checkoutHeads(root, mode, errors, resolveHead);
  if (registry && ledger) validateRegistryPins(registry, ledger, heads, errors);
  verifyShaclSourcePin(root, errors);
  verifyAdrIndex(root, errors);
  verifyDocuments(root, errors);

  if (mode === "full") {
    const receipts = readReceipts(root, errors);
    validateFullReceipts(receipts, errors);
  }
  return { ok: errors.length === 0, mode, errors };
}

function parseArguments(args) {
  let mode = "source-only";
  let root = resolve(toolDir, "../..");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source-only") mode = "source-only";
    else if (arg === "--full") mode = "full";
    else if (arg === "--root") {
      if (!args[index + 1]) throw new Error("--root requires a path");
      root = resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { mode, root };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = verifyProgramme(options.root, { mode: options.mode });
  if (result.ok) {
    console.log(`Programme evidence verification: PASS (${result.mode})`);
    return;
  }
  console.error(`Programme evidence verification: FAIL (${result.mode})`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
