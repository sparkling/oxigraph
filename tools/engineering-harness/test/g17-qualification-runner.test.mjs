import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  agenticDependencyEvidenceNames,
  agenticOracleBytes,
  agenticReceiptBytes,
  agenticReceiptContentHash,
  agenticReceiptExecutionHash,
  agenticRuntimeContentHash,
  validateAgenticDependencyEvidence,
  validateAgenticReceipt,
} from "../../agentic-qe/receipt-contract.mjs";
import {
  commands as agenticCommands,
  profiles as agenticProfiles,
} from "../../agentic-qe/profile-definitions.mjs";
import {
  qualificationContentHash,
  qualificationReceiptBytes,
  verificationContentHash,
  verificationFromQualification,
  verificationReceiptBytes,
} from "../../metaharness/receipt-contract.mjs";
import {
  comparePortablePaths,
  mutablePolicy,
  protectedInputs,
} from "../../metaharness/policy-contract.mjs";
import { MUTATION_RECEIPT_SCHEMA_VERSION } from "../../mutation/schema.mjs";
import { classifyG17Qualification } from "../src/qualification/classification.mjs";
import {
  G17_LEGACY_V4_CONTRACT_SHA256,
  decodeSealedG17Contract,
  loadG17Contract,
} from "../src/qualification/contract.mjs";
import {
  g17DecisionArtifactsForSealing,
  loadG17DecisionSet,
  validateG17DecisionSetBinding,
} from "../src/qualification/decision-contract.mjs";
import {
  G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  G17_SEMANTIC_EVIDENCE_SCHEMA,
} from "../src/qualification/evidence-contract.mjs";
import {
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  g17G14bPrerequisiteProjectionSha256,
  replayG17G14bPrerequisite,
} from "../src/qualification/g14b-prerequisite.mjs";
import {
  G17QualificationDecisionGateError,
  assertG17ExecutionOwnerAvailable,
  preflightG17Qualification,
  runG17Qualification,
} from "../src/qualification/runner.mjs";
import {
  createG17Receipt,
  g17ReceiptBytes,
  verifyG17Receipt,
} from "../src/qualification/receipt.mjs";
import { createG17Run } from "../src/qualification/storage.mjs";
import { verifySealedG17Run } from "../src/qualification/verifier.mjs";
import { verifyG17NativeApplicationEvidence } from "../src/qualification/native-application-contract.mjs";
import { g17ReceiptIdentity } from "../src/qualification/identity.mjs";
import { g17IdentityFixture } from "./support/g17-identity-fixture.mjs";
import { createG17NativeApplicationFixture } from "./support/g17-native-application-fixture.mjs";

function identity({ subjectCommit = "a".repeat(40), dependencies } = {}) {
  return g17IdentityFixture({ subjectCommit, dependencies });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const legacyDecisionRoot = fileURLToPath(new URL("fixtures", import.meta.url));
const legacyV4ContractBytes = readFileSync(
  new URL("fixtures/g17-qualification-contract-v4.json", import.meta.url),
);
const legacyV4Contract = decodeSealedG17Contract({
  bytes: legacyV4ContractBytes,
  receiptSha256: G17_LEGACY_V4_CONTRACT_SHA256,
});

function loadLegacyV4Contract() {
  return legacyV4Contract;
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

async function g14bPrerequisiteEvidence() {
  const encoded = await readFile(
    new URL(
      "fixtures/g14b-accepted-application-receipt-v6.json.gz.b64",
      import.meta.url,
    ),
    "utf8",
  );
  const bytes = gunzipSync(
    Buffer.from(encoded.replaceAll(/\s/gu, ""), "base64"),
  );
  const projection = replayG17G14bPrerequisite({ receiptBytes: bytes });
  return {
    projection,
    projectionSha256: g17G14bPrerequisiteProjectionSha256(projection),
    artifact: {
      name: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
      bytes,
    },
  };
}

function artifactRecord(name, bytes) {
  return { name, bytes: bytes.length, sha256: sha256(bytes) };
}

function resealG17Receipt(receipt) {
  receipt.contentHash = canonicalSha256({
    schema: receipt.schema,
    contract: receipt.contract,
    identity: receipt.identity,
    evidence: receipt.evidence,
    benchmark: receipt.benchmark,
    authority: receipt.authority,
    final: receipt.final,
    artifacts: receipt.artifacts,
  });
  receipt.executionHash = canonicalSha256({
    contentHash: receipt.contentHash,
    run: receipt.run,
  });
  receipt.receiptSha256 = canonicalSha256({
    schema: receipt.schema,
    run: receipt.run,
    contract: receipt.contract,
    identity: receipt.identity,
    evidence: receipt.evidence,
    benchmark: receipt.benchmark,
    authority: receipt.authority,
    final: receipt.final,
    artifacts: receipt.artifacts,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
  });
  return receipt;
}

function assertNoLiveRuntimeDependencies(source) {
  const imports = [
    ...source.matchAll(/(?:from\s+|\bimport\s+)"([^"]+)"/gu),
  ].map((match) => match[1]);
  assert.ok(
    imports.every(
      (specifier) =>
        !/^(?:node:)?(?:child_process|fs(?:\/promises)?)$/u.test(specifier),
    ),
  );
  assert.doesNotMatch(source, /\bprocess\s*(?:\.|\[)/u);
}

async function agenticOwnerEvidence(subjectCommit = "a".repeat(40)) {
  const dependencyBytes = {
    manifestBytes: await readFile(
      new URL("../../agentic-qe/package.json", import.meta.url),
    ),
    lockfileBytes: await readFile(
      new URL("../../agentic-qe/package-lock.json", import.meta.url),
    ),
    npmrcBytes: await readFile(
      new URL("../../agentic-qe/.npmrc", import.meta.url),
    ),
    installedPackageJsonBytes: await readFile(
      new URL(
        "../../agentic-qe/node_modules/agentic-qe/package.json",
        import.meta.url,
      ),
    ),
  };
  const locked = JSON.parse(dependencyBytes.lockfileBytes).packages[
    "node_modules/agentic-qe"
  ];
  const dependency = {
    name: "agentic-qe",
    policy: "latest",
    version: locked.version,
    resolved: locked.resolved,
    integrity: locked.integrity,
    manifest: "tools/agentic-qe/package.json",
    manifestSha256: sha256(dependencyBytes.manifestBytes),
    lockfile: "tools/agentic-qe/package-lock.json",
    lockfileSha256: sha256(dependencyBytes.lockfileBytes),
    npmrc: "tools/agentic-qe/.npmrc",
    npmrcSha256: sha256(dependencyBytes.npmrcBytes),
    installedPackageJsonSha256: sha256(
      dependencyBytes.installedPackageJsonBytes,
    ),
  };
  const dependencyEvidence = validateAgenticDependencyEvidence({
    dependency,
    ...dependencyBytes,
  });
  const commandIds = agenticProfiles["g1-regression"];
  const commands = commandIds.map((id) => {
    const [program, args, policy] = agenticCommands[id];
    const expected = policy.expectedPassedTests;
    const ids = [...policy.expectedTestIds].sort();
    const stdoutTail =
      `test result: ok. ${expected} passed; 0 failed; 0 ignored; ` +
      "0 measured; 0 filtered out; finished in 0.01s\n";
    const inventoryStdout = `${ids.map((testId) => `${testId}: test`).join("\n")}\n`;
    return {
      id,
      program,
      args,
      code: 0,
      signal: null,
      spawnError: null,
      timedOut: false,
      cleanupUnconfirmed: false,
      terminationReason: null,
      terminationSignalError: null,
      killAttempted: false,
      outputLimitExceeded: false,
      scanLimitExceeded: false,
      scanFailureReason: null,
      outputLimitBytes: 64 * 1024 * 1024,
      timeoutMs: policy.timeoutMs,
      testSafeguard: {
        format: "cargo-libtest-v1",
        minimumPassedTests: policy.minimumPassedTests,
        expectedPassedTests: expected,
        observedPassedTests: expected,
        expectedSummaryCount: policy.expectedCargoSummaryCount ?? null,
        observedSummaryCount: 1,
        observed: {
          source: "stream",
          summaries: [
            {
              stream: "stdout",
              status: "ok",
              passed: expected,
              failed: 0,
              ignored: 0,
              measured: 0,
              filteredOut: 0,
            },
          ],
          summaryCount: 1,
          terminal: true,
          countsSafe: true,
          allSuccessful: true,
          allOnStdout: true,
          outcomeCount: expected,
          totals: {
            passed: expected,
            failed: 0,
            ignored: 0,
            measured: 0,
            filteredOut: 0,
          },
        },
        passed: true,
      },
      testInventory: {
        observedTests: expected,
        ids,
        outputLimitBytes: 64 * 1024 * 1024,
        output: {
          stdoutBytes: Buffer.byteLength(inventoryStdout),
          stderrBytes: 0,
          stdoutSha256: sha256(inventoryStdout),
          stderrSha256: sha256(Buffer.alloc(0)),
        },
        stdoutTail: inventoryStdout,
        stderrTail: "",
      },
      output: {
        stdoutBytes: Buffer.byteLength(stdoutTail),
        stderrBytes: 0,
        stdoutSha256: sha256(stdoutTail),
        stderrSha256: sha256(Buffer.alloc(0)),
      },
      stdoutTail,
      stderrTail: "",
    };
  });
  const implementationFiles = [
    {
      path: "Cargo.toml",
      bytes: 1,
      sha256: "1".repeat(64),
    },
  ];
  const implementationContentHash = sha256(JSON.stringify(implementationFiles));
  const emptyContentHash = sha256("[]");
  const runId = "22222222-2222-4222-8222-222222222222";
  const profile = "g1-regression";
  const publicationRoot = `target/agentic-qe/${profile}/runs/${runId}`;
  const receipt = {
    schemaVersion: 5,
    runId,
    adapter: "oxigraph-agentic-qe",
    agenticQeVersion: dependency.version,
    profile,
    generatedAt: "2026-08-26T19:59:59.000Z",
    repository: {
      gitHead: subjectCommit,
      worktreeDirty: false,
      rdfTestsCommit: "b".repeat(40),
      rdfCanonTestsCommit: "c".repeat(40),
    },
    implementation: {
      algorithm: "sha256",
      files: implementationFiles,
      contentHash: implementationContentHash,
      stable: true,
      afterContentHash: implementationContentHash,
      changedPaths: [],
    },
    authority: {
      commands: commandIds.map((id) => ({ id })),
      childEnvironmentPolicy: "inherited-safe-name-allowlist-v1",
      agenticQeDependency: dependency,
    },
    runtime: [
      {
        program: "agentic-qe",
        context: "host",
        invokedPath: "/repo/tools/agentic-qe/node_modules/.bin/aqe",
        path: "/repo/tools/agentic-qe/node_modules/agentic-qe/dist/cli.js",
        executableSha256: "1".repeat(64),
        versionStdout: dependency.version,
        versionStderr: "",
      },
      {
        program: "cargo",
        context: "host",
        invokedPath: "/usr/bin/cargo",
        path: "/usr/bin/cargo",
        executableSha256: "2".repeat(64),
        versionStdout: "cargo 1.90.0",
        versionStderr: "",
      },
      {
        program: "git",
        context: "host",
        invokedPath: "/usr/bin/git",
        path: "/usr/bin/git",
        executableSha256: "3".repeat(64),
        versionStdout: "git version 2.51.0",
        versionStderr: "",
      },
      {
        program: "node",
        context: "host",
        invokedPath: "/usr/bin/node",
        path: "/usr/bin/node",
        executableSha256: "4".repeat(64),
        versionStdout: "v24.7.0",
        versionStderr: "",
      },
      {
        program: "rustc",
        context: "host",
        invokedPath: "/usr/bin/rustc",
        path: "/usr/bin/rustc",
        executableSha256: "5".repeat(64),
        versionStdout: "rustc 1.90.0",
        versionStderr: "",
      },
    ],
    commands,
    artifacts: {
      algorithm: "sha256",
      complete: true,
      missingPaths: [],
      invalidPaths: [],
      files: [],
      contentHash: emptyContentHash,
      archive: {
        algorithm: "sha256",
        complete: true,
        root: `target/agentic-qe/${profile}/artifacts/${emptyContentHash}`,
        files: [],
        totalBytes: 0,
        contentHash: emptyContentHash,
      },
    },
    publication: {
      schemaVersion: 1,
      immutable: true,
      root: publicationRoot,
      receiptPath: `${publicationRoot}/receipt.json`,
      oraclePath: `${publicationRoot}/oracle.json`,
    },
    passed: true,
  };
  receipt.contentHash = agenticReceiptContentHash(receipt);
  receipt.executionHash = agenticReceiptExecutionHash(receipt);
  const receiptBytes = agenticReceiptBytes(receipt);
  const oracle = {
    schemaVersion: 1,
    profile,
    runId,
    passed: true,
    baselinePassed: true,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    receiptSha256: sha256(receiptBytes),
  };
  const oracleBytes = agenticOracleBytes(oracle);
  const passedTests = commands.reduce(
    (sum, command) => sum + command.testSafeguard.observedPassedTests,
    0,
  );
  const agenticQe = {
    status: "PASS",
    subjectCommit,
    profile,
    runId,
    generatedAt: receipt.generatedAt,
    commandCount: commands.length,
    passedTests,
    receiptSha256: sha256(receiptBytes),
    oracleSha256: sha256(oracleBytes),
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    runtimeContentHash: agenticRuntimeContentHash(receipt.runtime),
    implementationContentHash,
    artifactContentHash: emptyContentHash,
    archiveContentHash: emptyContentHash,
    archiveFileCount: 0,
    dependencyContentHash: dependencyEvidence.contentHash,
  };
  const projection = {
    schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
    status: "PASS",
    agenticQe,
    native: [],
    applicationReceipts: [],
  };
  return {
    agenticQe,
    dependencyArtifacts: [
      {
        name: agenticDependencyEvidenceNames.manifest,
        bytes: dependencyBytes.manifestBytes,
      },
      {
        name: agenticDependencyEvidenceNames.lockfile,
        bytes: dependencyBytes.lockfileBytes,
      },
      {
        name: agenticDependencyEvidenceNames.npmrc,
        bytes: dependencyBytes.npmrcBytes,
      },
      {
        name: agenticDependencyEvidenceNames.installedPackageJson,
        bytes: dependencyBytes.installedPackageJsonBytes,
      },
    ],
    oracleBytes,
    projection,
    receiptBytes,
  };
}

async function compatibilityOwnerEvidence(runId) {
  const nativeFixture = createG17NativeApplicationFixture({ runId });
  const subjectIdentity = nativeFixture.input.identity;
  const agentic = await agenticOwnerEvidence(subjectIdentity.subject.commit);
  const nativeProjection = verifyG17NativeApplicationEvidence(
    nativeFixture.input,
  );
  const g14b = await g14bPrerequisiteEvidence();
  const projection = {
    schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
    status: "PASS",
    agenticQe: agentic.agenticQe,
    native: nativeProjection,
    applicationReceipts: [g14b.projection],
  };
  return {
    ...agentic,
    identity: subjectIdentity,
    native: {
      projection: nativeProjection,
      artifacts: nativeFixture.input.artifacts,
    },
    projection,
    artifacts: [
      ...agentic.dependencyArtifacts,
      { name: "agentic-oracle.json", bytes: agentic.oracleBytes },
      { name: "agentic-receipt.json", bytes: agentic.receiptBytes },
      g14b.artifact,
      ...nativeFixture.input.artifacts,
    ],
  };
}
function missing(status, reason) {
  return {
    status,
    sha256: status === "MISSING" ? null : "2".repeat(64),
    reasons: [reason],
    projection: null,
    artifacts: [],
  };
}

function darwinFixtureDependency(overrides = {}) {
  const version = overrides.version ?? "0.9.3";
  return {
    name: "@metaharness/darwin",
    policy: "latest",
    version,
    resolved: `https://registry.npmjs.org/@metaharness/darwin/-/darwin-${version}.tgz`,
    integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
    installedPackageJsonSha256: "1".repeat(64),
    ...overrides,
  };
}

function semanticMutationBinding() {
  const runId = "00000000-0000-4000-8000-000000000000";
  return {
    valid: true,
    error: null,
    path: `target/mutation/oxdatalog/runs/${runId}/receipt.json`,
    sha256: "2".repeat(64),
    schemaVersion: MUTATION_RECEIPT_SCHEMA_VERSION,
    runId,
    contentHash: "3".repeat(64),
    executionHash: "4".repeat(64),
    inputContentHash: "5".repeat(64),
    publicationContentHash: "6".repeat(64),
    nativeOutcomesSha256: "7".repeat(64),
    configSha256: "8".repeat(64),
    counts: {
      generated: 1,
      caught: 1,
      missed: 0,
      timeout: 0,
      unviable: 0,
      viable: 1,
    },
    mutationScorePercent: 100,
  };
}

function semanticAgenticBinding() {
  const runId = "11111111-1111-4111-8111-111111111111";
  const root = `target/agentic-qe/metaharness-semantic-gate/runs/${runId}`;
  const artifactContentHash = "9".repeat(64);
  return {
    path: `${root}/receipt.json`,
    sha256: "a".repeat(64),
    schemaVersion: 5,
    runId,
    generatedAt: "2026-08-26T17:00:00.500Z",
    contentHash: "b".repeat(64),
    executionHash: "c".repeat(64),
    runtimeContentHash: "1".repeat(64),
    oraclePath: `${root}/oracle.json`,
    oracleSha256: "d".repeat(64),
    implementationContentHash: "e".repeat(64),
    artifactContentHash,
    archiveContentHash: "f".repeat(64),
    archiveRoot: `target/agentic-qe/metaharness-semantic-gate/artifacts/${artifactContentHash}`,
    archiveFileCount: 1,
  };
}

function sealSemanticOwner(dependency, qualification, mutateVerification) {
  qualification.contentHash = qualificationContentHash(qualification);
  const qualificationBytes = qualificationReceiptBytes(qualification);
  const verification = verificationFromQualification(
    qualification,
    qualificationBytes,
  );
  mutateVerification?.(verification);
  verification.contentHash = verificationContentHash(verification);
  const verificationBytes = verificationReceiptBytes(verification);
  const projection = {
    schema: G17_SEMANTIC_EVIDENCE_SCHEMA,
    status: "PASS",
    qualification: {
      sha256: sha256(qualificationBytes),
      contentHash: qualification.contentHash,
      mode: qualification.mode,
      darwinVersion: qualification.darwinVersion,
    },
    verification: {
      sha256: sha256(verificationBytes),
      contentHash: verification.contentHash,
      protectedContentHash: verification.protectedContentHash,
      darwinContentHash: verification.darwinContentHash,
    },
  };
  return {
    dependency,
    qualification,
    qualificationBytes,
    verification,
    verificationBytes,
    projection,
  };
}

function semanticOwnerEvidence({
  dependency = darwinFixtureDependency(),
  syntheticSummary = {
    baseline: { finalScore: 0.9, testPassRate: 1, safetyScore: 1 },
    winner: { finalScore: 1, testPassRate: 1, safetyScore: 1 },
    recordCount: 2,
    promotedCount: 1,
  },
} = {}) {
  const files = [
    {
      path: "README.md",
      kind: "file",
      sha256: "0".repeat(64),
      bytes: 1,
    },
  ];
  const snapshot = {
    algorithm: "sha256",
    contentHash: sha256(JSON.stringify(files)),
    fileCount: files.length,
    roots: protectedInputs,
    files,
  };
  const darwin = {
    name: dependency.name,
    policy: dependency.policy,
    version: dependency.version,
    resolved: dependency.resolved,
    integrity: dependency.integrity,
    manifest: "tools/metaharness/package.json",
    manifestSha256: "1".repeat(64),
    lockfile: "tools/metaharness/package-lock.json",
    lockfileSha256: "2".repeat(64),
    npmrc: "tools/metaharness/.npmrc",
    npmrcSha256: "3".repeat(64),
    path: "tools/metaharness/node_modules/@metaharness/darwin",
    entry: "dist/index.js",
    packageJsonSha256: dependency.installedPackageJsonSha256,
    entrySha256: "4".repeat(64),
    contentHash: "5".repeat(64),
    fileCount: 1,
  };
  const projectionHash = "6".repeat(64);
  const qualification = {
    schemaVersion: 2,
    qualification: "oxigraph-policy-only-darwin",
    darwinVersion: dependency.version,
    mode: "synthetic-and-semantic-gate",
    runtime: {
      node: {
        invokedPath: "/usr/bin/node",
        path: "/usr/bin/node",
        version: "v24.7.0",
        executableSha256: "7".repeat(64),
      },
      platform: "linux",
      architecture: "x64",
    },
    startedAt: "2026-08-26T17:00:00.000Z",
    finishedAt: "2026-08-26T17:00:01.000Z",
    policyBoundary: {
      mutable: mutablePolicy,
      protectedInputs,
    },
    inputs: {
      before: snapshot,
      after: snapshot,
      changedPaths: [],
      protectedInputsStable: true,
      darwin: { before: darwin, after: darwin, stable: true },
      implementationStable: true,
    },
    synthetic: {
      seed: 12026,
      generations: 2,
      childrenPerGeneration: 2,
      first: syntheticSummary,
      second: syntheticSummary,
      projectionHash,
      replayProjectionHash: projectionHash,
    },
    safety: {
      directoryBlocked: true,
      generatedCodeBlocked: true,
      directoryFindingCount: 1,
      codeFindingCount: 1,
    },
    mutation: semanticMutationBinding(),
    realGate: {
      taskId: "semantic-gate-task",
      exitCode: 0,
      timedOut: false,
      blockedActions: [],
      durationMs: 500,
      stdoutHash: "8".repeat(64),
      stderrHash: "9".repeat(64),
      agenticReceipt: semanticAgenticBinding(),
      receiptError: null,
      passed: true,
    },
    gates: {
      solve: true,
      regression: true,
      safety: true,
      cost: true,
      reproducibility: true,
    },
    passed: true,
  };
  return sealSemanticOwner(dependency, qualification);
}

function resealSemanticOwner(
  owner,
  { mutateQualification, mutateVerification } = {},
) {
  const qualification = structuredClone(owner.qualification);
  mutateQualification?.(qualification);
  return sealSemanticOwner(
    structuredClone(owner.dependency),
    qualification,
    mutateVerification,
  );
}

function semanticProvider(owner) {
  return async () => ({
    status: "PASS",
    sha256: canonicalSha256(owner.projection),
    reasons: [],
    projection: owner.projection,
    artifacts: [
      {
        name: "semantic-qualification.json",
        bytes: owner.qualificationBytes,
      },
      {
        name: "semantic-verification.json",
        bytes: owner.verificationBytes,
      },
    ],
  });
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-runner-"));
  await chmod(root, 0o700);
  const runsRoot = join(root, "runs");
  await mkdir(runsRoot, { mode: 0o700 });
  t.after(async () => {
    for (const entry of await readdir(runsRoot).catch(() => [])) {
      await chmod(join(runsRoot, entry), 0o700).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  });
  return { root, runsRoot };
}

async function sealCurrentG17Fixture({
  runId,
  runsRoot,
  contractLoader = loadLegacyV4Contract,
  identityProvider = async () => identity(),
  semanticProvider = async () => missing("MISSING", "missing"),
  compatibilityProvider = async () => missing("MISSING", "missing"),
  benchmarkInput,
  artifactTransform = (artifacts) => artifacts,
  clock = (() => {
    const times = [
      new Date("2026-08-26T18:00:00.000Z"),
      new Date("2026-08-26T18:00:01.000Z"),
    ];
    return () => times.shift();
  })(),
}) {
  const started = clock();
  const loaded = contractLoader();
  const decisions = validateG17DecisionSetBinding({
    contract: loaded.contract,
    decisions: loadG17DecisionSet({
      contract: loaded.contract,
      root: legacyDecisionRoot,
    }),
    startedAt: started.toISOString(),
  });
  const subjectIdentity = await identityProvider({ contract: loaded.contract });
  const semanticEvidence = await semanticProvider({
    contract: loaded.contract,
    identity: subjectIdentity,
  });
  const compatibilityEvidence = await compatibilityProvider({
    contract: loaded.contract,
    identity: subjectIdentity,
  });
  const semantic = {
    status: semanticEvidence.status,
    sha256: semanticEvidence.sha256,
    reasons: [...semanticEvidence.reasons],
    projection: semanticEvidence.projection,
  };
  const compatibility = {
    status: compatibilityEvidence.status,
    sha256: compatibilityEvidence.sha256,
    reasons: [...compatibilityEvidence.reasons],
    projection: compatibilityEvidence.projection,
  };
  const benchmark = benchmarkInput ?? {
    status: "NOT_RUN",
    sampleCount: 0,
    samplesSha256: null,
    summarySha256: null,
    budgetBreaches: [],
  };
  const final = classifyG17Qualification({
    semantic,
    compatibility,
    benchmark,
    referenceDecision: decisions.reference,
    budgetDecision: decisions.performance,
    noiseDecision: decisions.noise,
  });
  const observations = {
    schema: "oxigraph.g1.7-qualification-observations/v1",
    identity: subjectIdentity,
    semantic,
    compatibility,
    benchmark,
  };
  const artifacts = artifactTransform([
    { name: "contract.json", bytes: Buffer.from(loaded.bytes) },
    ...g17DecisionArtifactsForSealing({
      contract: loaded.contract,
      root: legacyDecisionRoot,
    }),
    { name: "identity.json", bytes: canonicalBytes(subjectIdentity) },
    { name: "observations.json", bytes: canonicalBytes(observations) },
    ...semanticEvidence.artifacts,
    ...compatibilityEvidence.artifacts,
  ]).sort((left, right) => comparePortablePaths(left.name, right.name));
  const manifestArtifacts = artifacts.map(({ name, bytes }) =>
    artifactRecord(name, bytes),
  );
  const manifest = {
    schema: "oxigraph.g1.7-qualification-artifact-manifest/v1",
    runId,
    artifacts: manifestArtifacts,
  };
  const manifestBytes = canonicalBytes(manifest);
  const receiptArtifacts = [
    ...manifestArtifacts,
    artifactRecord("manifest.json", manifestBytes),
  ].sort((left, right) => comparePortablePaths(left.name, right.name));
  const receipt = createG17Receipt({
    run: {
      id: runId,
      startedAt: started.toISOString(),
      finishedAt: clock().toISOString(),
    },
    contract: {
      id: loaded.contract.id,
      sha256: loaded.contractSha256,
      suiteHash: loaded.contract.benchmark.suite.taskHash,
      referenceDecision: decisions.reference.status,
      budgetDecision: decisions.performance.status,
      noiseDecision: decisions.noise.status,
    },
    identity: g17ReceiptIdentity(subjectIdentity),
    evidence: { semantic, compatibility },
    benchmark,
    final,
    artifacts: receiptArtifacts,
  });
  const run = await createG17Run({ runId, runsRoot });
  for (const artifact of artifacts) {
    await run.write(artifact.name, artifact.bytes);
  }
  await run.write("manifest.json", manifestBytes);
  await run.seal(g17ReceiptBytes(receipt));
  return { receipt, runPath: run.path };
}

test("sealed evidence replay imports only pure receipt-contract modules", async () => {
  const agenticContract = await readFile(
    new URL("../../agentic-qe/receipt-contract.mjs", import.meta.url),
    "utf8",
  );
  const sealedReplay = await readFile(
    new URL("../src/qualification/sealed-evidence.mjs", import.meta.url),
    "utf8",
  );
  const profileDefinitions = await readFile(
    new URL("../../agentic-qe/profile-definitions.mjs", import.meta.url),
    "utf8",
  );
  const profileReasoning = await readFile(
    new URL("../../agentic-qe/profile-reasoning.mjs", import.meta.url),
    "utf8",
  );
  const semanticContract = await readFile(
    new URL("../../metaharness/receipt-contract.mjs", import.meta.url),
    "utf8",
  );
  const semanticAgenticBinding = await readFile(
    new URL("../../metaharness/agentic-binding.mjs", import.meta.url),
    "utf8",
  );
  const semanticMutationContract = await readFile(
    new URL("../../metaharness/mutation-contract.mjs", import.meta.url),
    "utf8",
  );
  const semanticPolicyContract = await readFile(
    new URL("../../metaharness/policy-contract.mjs", import.meta.url),
    "utf8",
  );
  const mutationSchema = await readFile(
    new URL("../../mutation/schema.mjs", import.meta.url),
    "utf8",
  );
  const imports = [...agenticContract.matchAll(/from\s+"([^"]+)"/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(imports, [
    "node:crypto",
    "./native-test-contract.mjs",
    "./node-test-contract.mjs",
    "./runtime-plan.mjs",
  ]);
  assert.deepEqual(
    [...semanticContract.matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    [
      "node:crypto",
      "./agentic-binding.mjs",
      "./mutation-contract.mjs",
      "./policy-contract.mjs",
    ],
  );
  assert.doesNotMatch(sealedReplay, /agentic-qe\/evidence\.mjs/u);
  assert.doesNotMatch(sealedReplay, /metaharness\/evidence\.mjs/u);
  assert.deepEqual(
    [...profileDefinitions.matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    ["./profile-reasoning.mjs"],
  );
  assert.doesNotMatch(profileReasoning, /\bimport\s/u);
  assertNoLiveRuntimeDependencies(agenticContract);
  assertNoLiveRuntimeDependencies(profileDefinitions);
  assertNoLiveRuntimeDependencies(profileReasoning);
  assertNoLiveRuntimeDependencies(semanticContract);
  assertNoLiveRuntimeDependencies(semanticAgenticBinding);
  assertNoLiveRuntimeDependencies(semanticMutationContract);
  assertNoLiveRuntimeDependencies(semanticPolicyContract);
  assertNoLiveRuntimeDependencies(mutationSchema);
  assertNoLiveRuntimeDependencies(sealedReplay);
});

test("schema-v5 replay derives Cargo claims from complete retained bytes", async () => {
  const owner = await agenticOwnerEvidence();
  const receipt = JSON.parse(owner.receiptBytes);
  const commandIds = agenticProfiles["g1-regression"];
  const options = {
    expectedProfile: "g1-regression",
    expectedAgenticQeVersion: receipt.agenticQeVersion,
    expectedAgenticQeDependency: receipt.authority.agenticQeDependency,
    expectedRuntime: structuredClone(receipt.runtime),
    expectedCommandIds: commandIds,
    expectedCommands: agenticCommands,
  };
  assert.doesNotThrow(() => validateAgenticReceipt(receipt, options));

  const rebindOutput = (ownerRecord, stdout, stderr) => {
    ownerRecord.stdoutTail = stdout;
    ownerRecord.stderrTail = stderr;
    ownerRecord.output.stdoutBytes = Buffer.byteLength(stdout);
    ownerRecord.output.stderrBytes = Buffer.byteLength(stderr);
    ownerRecord.output.stdoutSha256 = sha256(stdout);
    ownerRecord.output.stderrSha256 = sha256(stderr);
  };
  const variants = [
    (candidate) =>
      rebindOutput(candidate.commands[0], "no Cargo summary\n", ""),
    (candidate) =>
      rebindOutput(candidate.commands[0], "x\n".repeat(524_288), ""),
    (candidate) =>
      rebindOutput(candidate.commands[0].testInventory, "wrong: test\n", ""),
    (candidate) => {
      const output = candidate.commands[0].stdoutTail;
      rebindOutput(candidate.commands[0], "", output);
    },
  ];
  for (const mutate of variants) {
    const candidate = structuredClone(receipt);
    mutate(candidate);
    candidate.contentHash = agenticReceiptContentHash(candidate);
    candidate.executionHash = agenticReceiptExecutionHash(candidate);
    assert.throws(
      () => validateAgenticReceipt(candidate, options),
      /execution or hash contract/u,
    );
  }
});

test("G1.7 preflight reports honest inconclusive decisions without side effects", async () => {
  const loaded = loadG17Contract();
  const result = await preflightG17Qualification({
    contractLoader: () => loaded,
    identityProvider: async () => identity(),
  });
  assert.equal(result.schema, "oxigraph.g1.7-qualification-preflight/v1");
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.ok(result.final.reasons.includes("reference-proposed"));
  assert.ok(result.final.reasons.includes("performance-budget-proposed"));
  assert.ok(result.final.reasons.includes("noise-budget-proposed"));
  assert.deepEqual(result.authority, {
    localOnly: true,
    promotionAuthority: false,
    routerQualityAuthority: false,
    publicationAuthority: false,
  });
});

test("G1.7 run rejects proposed decisions before identity or evidence execution", async (t) => {
  const { root, runsRoot } = await fixture(t);
  const routerHistory = join(root, "router-history.jsonl");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(routerHistory, "immutable-router-history\n", { mode: 0o600 }),
  );
  const beforeHistory = await readFile(routerHistory);
  const loaded = loadG17Contract();
  const calls = [];
  await assert.rejects(
    runG17Qualification({
      runId: "run-00000001",
      runsRoot,
      contractLoader: () => loaded,
      identityProvider: async () => calls.push("identity"),
      semanticProvider: async () => calls.push("semantic"),
      compatibilityProvider: async () => calls.push("compatibility"),
      clock: () => new Date("2026-08-26T18:00:00.000Z"),
    }),
    (error) => {
      assert.ok(error instanceof G17QualificationDecisionGateError);
      assert.equal(error.code, "G17_DECISIONS_UNAPPROVED");
      assert.equal(error.result.final.verdict, "INCONCLUSIVE");
      assert.deepEqual(error.result.final.reasons, [
        "reference-proposed",
        "performance-budget-proposed",
        "noise-budget-proposed",
        "semantic-not-run",
        "compatibility-not-run",
        "benchmark-not-run",
      ]);
      return true;
    },
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(await readdir(runsRoot), []);
  assert.deepEqual(await readFile(routerHistory), beforeHistory);
});

test("G1.7 decision gate dominates oversized provider output without creating a run", async (t) => {
  const { runsRoot } = await fixture(t);
  const runId = "run-envelope-overflow";
  await assert.rejects(
    runG17Qualification({
      runId,
      runsRoot,
      contractLoader: () => loadG17Contract(),
      identityProvider: async () => identity(),
      semanticProvider: async () => missing("MISSING", "missing"),
      compatibilityProvider: async () => ({
        ...missing("MISSING", "missing"),
        artifacts: Array.from({ length: 61 }, (_, index) => ({
          name: `overflow-${String(index).padStart(3, "0")}.bin`,
          bytes: Buffer.from([index]),
        })),
      }),
      clock: () => new Date("2026-08-26T18:00:00.000Z"),
    }),
    /decisions are proposed/u,
  );
  assert.deepEqual(await readdir(runsRoot), []);
});

test("G1.7 approved execution owner remains mechanically unavailable", () => {
  assert.throws(
    () => assertG17ExecutionOwnerAvailable(),
    (error) => {
      assert.equal(error.code, "G17_EXECUTION_OWNER_UNIMPLEMENTED");
      assert.match(error.message, /attested build and sample owner/u);
      return true;
    },
  );
});

test("sealed verifier imports no live identity, evidence, process, Git, or Router modules", async () => {
  const source = await readFile(
    new URL("../src/qualification/verifier.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /currentG17|application-evidence|child_process|Router|routing\/history|\bgit\b/u,
  );
});

test("sealed verifier rejects a hash-consistent compatibility PASS without copied Agentic receipt and oracle bytes", async (t) => {
  const { runsRoot } = await fixture(t);
  const loaded = loadLegacyV4Contract();
  const projection = {
    schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
    status: "PASS",
    agenticQe: {
      status: "PASS",
      subjectCommit: "a".repeat(40),
      profile: "g1-regression",
      runId: "00000000-0000-4000-8000-000000000000",
      generatedAt: "2026-08-26T17:59:59.000Z",
      commandCount: 11,
      passedTests: 66,
      receiptSha256: "1".repeat(64),
      oracleSha256: "2".repeat(64),
      contentHash: "3".repeat(64),
      executionHash: "4".repeat(64),
      runtimeContentHash: "8".repeat(64),
      implementationContentHash: "5".repeat(64),
      artifactContentHash: "6".repeat(64),
      archiveContentHash: "7".repeat(64),
      archiveFileCount: 0,
    },
    native: [],
    applicationReceipts: [],
  };
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-vacuous-pass",
    runsRoot,
    contractLoader: () => loaded,
    identityProvider: async () => identity(),
    semanticProvider: async () => missing("MISSING", "missing"),
    compatibilityProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: [],
      projection,
      artifacts: [],
    }),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /compatibility PASS artifacts are incomplete/u,
  );
});

test("sealed verifier rejects missing or rehashed decision bytes before owner evidence", async (t) => {
  const { runsRoot } = await fixture(t);
  for (const [runId, artifactTransform, pattern] of [
    [
      "run-missing-reference-decision",
      (artifacts) =>
        artifacts.filter(({ name }) => name !== "reference-decision.json"),
      /current contract decision artifacts are incomplete/u,
    ],
    [
      "run-rehashed-reference-decision",
      (artifacts) =>
        artifacts.map((artifact) =>
          artifact.name === "reference-decision.json"
            ? { ...artifact, bytes: Buffer.from("{}\n", "utf8") }
            : artifact,
        ),
      /reference decision raw hash does not verify/u,
    ],
  ]) {
    const result = await sealCurrentG17Fixture({
      runId,
      runsRoot,
      artifactTransform,
      compatibilityProvider: async () => ({
        status: "PASS",
        sha256: canonicalSha256({
          schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
          status: "PASS",
        }),
        reasons: [],
        projection: {
          schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
          status: "PASS",
        },
        artifacts: [],
      }),
    });
    await assert.rejects(
      verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
      pattern,
    );
  }
});

test("sealed verifier refuses executed benchmark claims without a replay owner", async (t) => {
  const { runsRoot } = await fixture(t);
  const result = await sealCurrentG17Fixture({
    runId: "run-unreplayed-benchmark",
    runsRoot,
    benchmarkInput: {
      status: "PASS",
      sampleCount: 1,
      samplesSha256: "a".repeat(64),
      summarySha256: "b".repeat(64),
      budgetBreaches: [],
    },
    artifactTransform: (artifacts) => [
      ...artifacts,
      { name: "benchmark-samples.json", bytes: Buffer.from("{}\n") },
      { name: "benchmark-summary.json", bytes: Buffer.from("{}\n") },
    ],
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /executed benchmark replay owner is unavailable/u,
  );
});

test("sealed verifier replays synthetic Agentic and native owner-contract fixtures", async (t) => {
  const { runsRoot } = await fixture(t);
  const runId = "run-valid-zero-artifact-owner";
  const owner = await compatibilityOwnerEvidence(runId);
  const subjectIdentity = owner.identity;
  const times = [
    new Date("2026-08-26T20:00:00.000Z"),
    new Date("2026-08-26T20:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId,
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () => subjectIdentity,
    semanticProvider: async () => missing("MISSING", "missing"),
    compatibilityProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(owner.projection),
      reasons: [],
      projection: owner.projection,
      artifacts: owner.artifacts,
    }),
    clock: () => times.shift(),
  });
  const verified = await verifySealedG17Run({
    runId: result.receipt.run.id,
    runsRoot,
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.verificationStatus, "LEGACY_REPLAY_ONLY");
  assert.equal(verified.qualificationEligible, false);
  assert.deepEqual(verified.evidenceAssurance, {
    semantic: "NOT_APPLICABLE",
    compatibility: "LEGACY_REPLAY_ONLY",
  });
  assert.equal(owner.agenticQe.archiveFileCount, 0);
  assert.equal(owner.agenticQe.commandCount, 11);
  assert.equal(owner.agenticQe.passedTests, 66);
  assert.equal(owner.native.projection.totalPassedTests, 23);
});

test("sealed verifier rejects copied G1.4b receipt or claim tampering after outer rehash", async (t) => {
  const { runsRoot } = await fixture(t);
  for (const [runId, mutate] of [
    [
      "run-g14b-byte-tamper",
      (owner) => {
        owner.artifacts = owner.artifacts.map((artifact) =>
          artifact.name === G17_G14B_PREREQUISITE_ARTIFACT_NAME
            ? {
                ...artifact,
                bytes: Buffer.concat([
                  artifact.bytes,
                  Buffer.from("\n", "utf8"),
                ]),
              }
            : artifact,
        );
      },
    ],
    [
      "run-g14b-claim-tamper",
      (owner) => {
        owner.projection = structuredClone(owner.projection);
        owner.projection.applicationReceipts[0].binding.claim.crashDurability = true;
      },
    ],
  ]) {
    const owner = await compatibilityOwnerEvidence(runId);
    mutate(owner);
    const times = [
      new Date("2026-08-26T20:00:00.000Z"),
      new Date("2026-08-26T20:00:01.000Z"),
    ];
    const result = await sealCurrentG17Fixture({
      runId,
      runsRoot,
      contractLoader: () => loadG17Contract(),
      identityProvider: async () => owner.identity,
      semanticProvider: async () => missing("MISSING", "missing"),
      compatibilityProvider: async () => ({
        status: "PASS",
        sha256: canonicalSha256(owner.projection),
        reasons: [],
        projection: owner.projection,
        artifacts: owner.artifacts,
      }),
      clock: () => times.shift(),
    });
    await assert.rejects(
      verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
      /copied G1\.4b prerequisite evidence is invalid/u,
    );
  }
});

test("sealed verifier keeps executed unversioned legacy evidence replay-only", async (t) => {
  const { runsRoot } = await fixture(t);
  const currentRunId = "run-current-v3-for-legacy";
  const owner = await compatibilityOwnerEvidence(currentRunId);
  const subjectIdentity = owner.identity;
  const current = await sealCurrentG17Fixture({
    runId: currentRunId,
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () => subjectIdentity,
    semanticProvider: async () => missing("MISSING", "missing"),
    compatibilityProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(owner.projection),
      reasons: [],
      projection: owner.projection,
      artifacts: owner.artifacts,
    }),
    clock: (() => {
      const times = [
        new Date("2026-08-26T20:00:00.000Z"),
        new Date("2026-08-26T20:00:01.000Z"),
      ];
      return () => times.shift();
    })(),
  });

  const legacyRunId = "run-legacy-unversioned-pass";
  const legacyProjection = structuredClone(
    current.receipt.evidence.compatibility.projection,
  );
  delete legacyProjection.schema;
  delete legacyProjection.agenticQe.dependencyContentHash;
  const legacyCompatibility = {
    status: "PASS",
    sha256: canonicalSha256(legacyProjection),
    reasons: [],
    projection: legacyProjection,
  };

  const dependencyNames = new Set(
    Object.values(agenticDependencyEvidenceNames),
  );
  const decisionNames = new Set([
    "reference-decision.json",
    "performance-budget-decision.json",
    "noise-budget-decision.json",
  ]);
  const retainedNames = current.receipt.artifacts
    .map(({ name }) => name)
    .filter(
      (name) =>
        name !== "manifest.json" &&
        name !== "observations.json" &&
        !decisionNames.has(name) &&
        !dependencyNames.has(name),
    );
  const bytesByName = new Map();
  for (const name of retainedNames) {
    bytesByName.set(name, await readFile(join(current.runPath, name)));
  }
  const legacyContractBytes = await readFile(
    new URL("./fixtures/g17-qualification-contract-v1.json", import.meta.url),
  );
  const legacyContract = JSON.parse(legacyContractBytes);
  bytesByName.set("contract.json", legacyContractBytes);
  const legacyBenchmark = {
    status: "NOISY",
    sampleCount: 1,
    samplesSha256: "a".repeat(64),
    summarySha256: "b".repeat(64),
    budgetBreaches: ["legacy-noise"],
  };
  bytesByName.set("benchmark-samples.json", Buffer.from("{}\n", "utf8"));
  bytesByName.set("benchmark-summary.json", Buffer.from("{}\n", "utf8"));
  const observations = JSON.parse(
    await readFile(join(current.runPath, "observations.json")),
  );
  observations.compatibility = legacyCompatibility;
  observations.benchmark = legacyBenchmark;
  bytesByName.set("observations.json", canonicalBytes(observations));

  const manifestArtifacts = [...bytesByName]
    .map(([name, bytes]) => artifactRecord(name, bytes))
    .sort((left, right) => comparePortablePaths(left.name, right.name));
  const manifest = {
    schema: "oxigraph.g1.7-qualification-artifact-manifest/v1",
    runId: legacyRunId,
    artifacts: manifestArtifacts,
  };
  const manifestBytes = canonicalBytes(manifest);
  bytesByName.set("manifest.json", manifestBytes);
  const receiptArtifacts = [
    ...manifestArtifacts,
    artifactRecord("manifest.json", manifestBytes),
  ].sort((left, right) => comparePortablePaths(left.name, right.name));

  const legacyReceipt = resealG17Receipt({
    ...structuredClone(current.receipt),
    run: { ...current.receipt.run, id: legacyRunId },
    contract: {
      id: legacyContract.id,
      sha256: sha256(legacyContractBytes),
      suiteHash: legacyContract.benchmark.suite.taskHash,
      referenceDecision: legacyContract.referenceDecision.status,
      budgetDecision: legacyContract.budgetDecision.status,
      noiseDecision: legacyContract.noiseDecision.status,
    },
    evidence: {
      semantic: current.receipt.evidence.semantic,
      compatibility: legacyCompatibility,
    },
    benchmark: legacyBenchmark,
    final: classifyG17Qualification(
      {
        semantic: current.receipt.evidence.semantic,
        compatibility: legacyCompatibility,
        benchmark: legacyBenchmark,
        referenceDecision: legacyContract.referenceDecision,
        budgetDecision: legacyContract.budgetDecision,
        noiseDecision: legacyContract.noiseDecision,
      },
      { currentV4: false },
    ),
    artifacts: receiptArtifacts,
  });
  const legacyReceiptBytes = g17ReceiptBytes(legacyReceipt);
  const structural = verifyG17Receipt(legacyReceiptBytes);
  assert.equal(structural.structurallyValid, true);
  assert.equal(structural.ok, false);
  assert.equal(structural.verificationStatus, "LEGACY_REPLAY_ONLY");
  assert.equal(structural.qualificationEligible, false);
  assert.deepEqual(structural.evidenceSchemaState, {
    semantic: "NOT_APPLICABLE",
    compatibility: "LEGACY_REPLAY_ONLY",
  });

  const run = await createG17Run({ runId: legacyRunId, runsRoot });
  for (const [name, bytes] of [...bytesByName].sort(([left], [right]) =>
    comparePortablePaths(left, right),
  )) {
    await run.write(name, bytes);
  }
  await run.seal(legacyReceiptBytes);

  const verified = await verifySealedG17Run({ runId: legacyRunId, runsRoot });
  assert.equal(verified.ok, false);
  assert.equal(verified.verificationStatus, "LEGACY_REPLAY_ONLY");
  assert.equal(verified.qualificationEligible, false);
  assert.deepEqual(verified.evidenceAssurance, {
    semantic: "NOT_APPLICABLE",
    compatibility: "LEGACY_REPLAY_ONLY",
  });
});

test("adding the current schema and G1.4b prerequisite to legacy Agentic evidence does not manufacture native owner bytes", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = await agenticOwnerEvidence();
  const g14b = await g14bPrerequisiteEvidence();
  const projection = structuredClone(owner.projection);
  delete projection.agenticQe.dependencyContentHash;
  projection.applicationReceipts = [g14b.projection];
  const result = await sealCurrentG17Fixture({
    runId: "run-schema-only-upgrade",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () => identity(),
    semanticProvider: async () => missing("MISSING", "missing"),
    compatibilityProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: [],
      projection,
      artifacts: [
        { name: "agentic-oracle.json", bytes: owner.oracleBytes },
        { name: "agentic-receipt.json", bytes: owner.receiptBytes },
        g14b.artifact,
      ],
    }),
    clock: (() => {
      const times = [
        new Date("2026-08-26T20:00:00.000Z"),
        new Date("2026-08-26T20:00:01.000Z"),
      ];
      return () => times.shift();
    })(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /compatibility PASS seven-artifact native evidence is incomplete|copied Agentic-QE evidence is invalid/u,
  );
});

test("sealed verifier rejects copied compatibility evidence that violates the pure Agentic receipt contract", async (t) => {
  const { runsRoot } = await fixture(t);
  const loaded = loadLegacyV4Contract();
  const runId = "run-invalid-owner-evidence";
  const nativeFixture = createG17NativeApplicationFixture({ runId });
  const subjectIdentity = nativeFixture.input.identity;
  const native = verifyG17NativeApplicationEvidence(nativeFixture.input);
  const g14b = await g14bPrerequisiteEvidence();
  const projection = {
    schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
    status: "PASS",
    agenticQe: {
      status: "PASS",
      subjectCommit: "a".repeat(40),
      profile: "g1-regression",
      runId: "00000000-0000-4000-8000-000000000000",
      generatedAt: "2026-08-26T17:59:59.000Z",
      commandCount: 11,
      passedTests: 66,
      receiptSha256: "1".repeat(64),
      oracleSha256: "2".repeat(64),
      contentHash: "3".repeat(64),
      executionHash: "4".repeat(64),
      runtimeContentHash: "8".repeat(64),
      implementationContentHash: "5".repeat(64),
      artifactContentHash: "6".repeat(64),
      archiveContentHash: "7".repeat(64),
      archiveFileCount: 0,
    },
    native,
    applicationReceipts: [g14b.projection],
  };
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId,
    runsRoot,
    contractLoader: () => loaded,
    identityProvider: async () => subjectIdentity,
    semanticProvider: async () => missing("MISSING", "missing"),
    compatibilityProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: [],
      projection,
      artifacts: [
        { name: "agentic-receipt.json", bytes: Buffer.from("{}\n") },
        { name: "agentic-oracle.json", bytes: Buffer.from("{}\n") },
        g14b.artifact,
        ...nativeFixture.input.artifacts,
      ],
    }),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied Agentic-QE evidence is invalid/u,
  );
});

test("sealed verifier rejects rehashed native raw-output and derived-projection tampering", async (t) => {
  const { runsRoot } = await fixture(t);
  const loaded = loadLegacyV4Contract();
  for (const [runId, mutate] of [
    [
      "run-native-output-tamper",
      (owner) => {
        const sessionArtifact = owner.artifacts.find(
          ({ name }) => name === "native-session.json",
        );
        const nativeDocument = JSON.parse(sessionArtifact.bytes);
        const substituted = Buffer.from(
          "test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n" +
            "test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
        );
        nativeDocument.commands[1].stdoutBase64 =
          substituted.toString("base64");
        nativeDocument.commands[1].stdoutSha256 = sha256(substituted);
        const mutatedBytes = canonicalBytes(nativeDocument);
        owner.artifacts = owner.artifacts.map((artifact) =>
          artifact.name === sessionArtifact.name
            ? { ...artifact, bytes: mutatedBytes }
            : artifact,
        );
      },
    ],
    [
      "run-native-projection-tamper",
      (owner) => {
        owner.projection = structuredClone(owner.projection);
        owner.projection.native.lanes[0].observedPassedTests = 19;
      },
    ],
  ]) {
    const owner = await compatibilityOwnerEvidence(runId);
    const subjectIdentity = owner.identity;
    mutate(owner);
    const times = [
      new Date("2026-08-26T20:00:00.000Z"),
      new Date("2026-08-26T20:00:01.000Z"),
    ];
    const result = await sealCurrentG17Fixture({
      runId,
      runsRoot,
      contractLoader: () => loaded,
      identityProvider: async () => subjectIdentity,
      semanticProvider: async () => missing("MISSING", "missing"),
      compatibilityProvider: async () => ({
        status: "PASS",
        sha256: canonicalSha256(owner.projection),
        reasons: [],
        projection: owner.projection,
        artifacts: owner.artifacts,
      }),
      clock: () => times.shift(),
    });
    await assert.rejects(
      verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
      /copied native compatibility evidence is invalid/u,
    );
  }
});

test("sealed verifier rejects copied semantic evidence that violates the pure MetaHarness receipt contract", async (t) => {
  const { runsRoot } = await fixture(t);
  const loaded = loadLegacyV4Contract();
  const projection = {
    schema: G17_SEMANTIC_EVIDENCE_SCHEMA,
    status: "PASS",
    qualification: {
      sha256: "1".repeat(64),
      contentHash: "2".repeat(64),
      mode: "synthetic-and-semantic-gate",
      darwinVersion: "0.9.3",
    },
    verification: {
      sha256: "3".repeat(64),
      contentHash: "4".repeat(64),
      protectedContentHash: "5".repeat(64),
      darwinContentHash: "6".repeat(64),
    },
  };
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-invalid-semantic-evidence",
    runsRoot,
    contractLoader: () => loaded,
    identityProvider: async () => identity(),
    semanticProvider: async () => ({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: [],
      projection,
      artifacts: [
        { name: "semantic-qualification.json", bytes: Buffer.from("{}\n") },
        { name: "semantic-verification.json", bytes: Buffer.from("{}\n") },
      ],
    }),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});

test("sealed verifier replays a synthetic MetaHarness owner-contract fixture", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = semanticOwnerEvidence();
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-valid-semantic-owner",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  const verified = await verifySealedG17Run({
    runId: result.receipt.run.id,
    runsRoot,
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.verificationStatus, "LEGACY_REPLAY_ONLY");
  assert.equal(verified.qualificationEligible, false);
  assert.deepEqual(verified.evidenceAssurance, {
    semantic: "LEGACY_REPLAY_ONLY",
    compatibility: "NOT_APPLICABLE",
  });
});

test("sealed verifier rejects a rehashed synthetic summary outside the frozen MetaHarness receipt schema", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = semanticOwnerEvidence({
    syntheticSummary: { attackerControlled: true },
  });
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-rehashed-synthetic-summary",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});

test("sealed verifier rejects rehashed Darwin search parameters outside the frozen MetaHarness policy contract", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = resealSemanticOwner(semanticOwnerEvidence(), {
    mutateQualification: (qualification) => {
      qualification.synthetic.seed = 99;
      qualification.synthetic.generations = 1;
      qualification.synthetic.childrenPerGeneration = 1;
    },
  });
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-rehashed-darwin-policy",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});

test("sealed verifier rejects a rehashed protected snapshot algorithm", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = resealSemanticOwner(semanticOwnerEvidence(), {
    mutateQualification: (qualification) => {
      qualification.inputs.before.algorithm = "sha1";
      qualification.inputs.after.algorithm = "sha1";
    },
  });
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-rehashed-snapshot-algorithm",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});

test("sealed verifier rejects verification rederived from itself instead of qualification", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = resealSemanticOwner(semanticOwnerEvidence(), {
    mutateVerification: (verification) => {
      verification.protectedContentHash = "f".repeat(64);
    },
  });
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-self-derived-verification",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});

test("sealed verifier rejects MetaHarness evidence completed after G1.7 acquisition", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = resealSemanticOwner(semanticOwnerEvidence(), {
    mutateQualification: (qualification) => {
      qualification.finishedAt = "2026-08-26T18:00:00.001Z";
    },
  });
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-late-semantic-evidence",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});

test("sealed verifier rejects a Darwin dependency outside the official registry", async (t) => {
  const { runsRoot } = await fixture(t);
  const owner = semanticOwnerEvidence({
    dependency: darwinFixtureDependency({
      resolved: "https://packages.example.invalid/darwin-0.9.3.tgz",
    }),
  });
  const times = [
    new Date("2026-08-26T18:00:00.000Z"),
    new Date("2026-08-26T18:00:01.000Z"),
  ];
  const result = await sealCurrentG17Fixture({
    runId: "run-untrusted-darwin-registry",
    runsRoot,
    contractLoader: loadLegacyV4Contract,
    identityProvider: async () =>
      identity({ dependencies: [owner.dependency] }),
    semanticProvider: semanticProvider(owner),
    compatibilityProvider: async () => missing("MISSING", "missing"),
    clock: () => times.shift(),
  });
  await assert.rejects(
    verifySealedG17Run({ runId: result.receipt.run.id, runsRoot }),
    /copied MetaHarness evidence is invalid/u,
  );
});
