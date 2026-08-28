import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  agenticRuntimeContentHash,
  validateAgenticArtifactArchive,
  validateAgenticPublication,
  validateAgenticReceipt,
} from "../../../agentic-qe/evidence.mjs";
import { agenticRuntimeProvenance } from "../../../agentic-qe/execution-provenance.mjs";
import {
  agenticDependencyEvidenceNames,
  validateAgenticDependencyEvidence,
} from "../../../agentic-qe/receipt-contract.mjs";
import {
  commands as agenticCommands,
  profiles as agenticProfiles,
} from "../../../agentic-qe/profile-definitions.mjs";
import { agenticQeDependencyResolution } from "../../../agentic-qe/version-policy.mjs";
import {
  darwinInstallationSnapshot,
  protectedSnapshot,
  validateSemanticEvidencePair,
} from "../../../metaharness/evidence.mjs";
import { comparePortablePaths } from "../../../metaharness/policy-contract.mjs";
import { execute } from "../../../agentic-qe/process-runner.mjs";
import { canonicalSha256 } from "../routing/features.mjs";
import {
  G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  G17_SEMANTIC_EVIDENCE_SCHEMA,
} from "./evidence-contract.mjs";
import {
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  g17G14bPrerequisiteProjectionSha256,
  inspectG17G14bPrerequisite,
  replayG17G14bPrerequisite,
} from "./g14b-prerequisite.mjs";
import { runG17NativeApplication } from "./native-application.mjs";
import { repositoryRoot } from "../paths.mjs";

const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function boundedRegularFile(
  path,
  root,
  label,
  maxBytes = MAX_EVIDENCE_BYTES,
  minBytes = 1,
) {
  const lexical = resolve(path);
  if (!contained(root, lexical))
    throw new Error(`${label} escapes its evidence root`);
  const metadata = lstatSync(lexical);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < minBytes ||
    metadata.size > maxBytes
  ) {
    throw new Error(`${label} is not a bounded regular file`);
  }
  const bytes = readFileSync(lexical);
  if (bytes.length !== metadata.size)
    throw new Error(`${label} changed during read`);
  return bytes;
}

function git(root, args) {
  return execFileSync("/usr/bin/git", args, {
    cwd: root,
    env: gitEnvironment,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function expectedAgenticPassedTests(commandIds) {
  return commandIds.reduce((sum, id) => {
    const policy = agenticCommands[id]?.[2];
    const expected = policy?.expectedPassedTests ?? policy?.expectedNodeTests;
    if (!Number.isSafeInteger(expected) || expected < 1) {
      throw new Error(
        `G1.7 Agentic command has no exact test inventory: ${id}`,
      );
    }
    return sum + expected;
  }, 0);
}

export function g17AgenticProfileContract(contract) {
  const reviewed = contract?.compatibility?.agenticQe;
  const commandIds = agenticProfiles["g1-regression"];
  const actual = {
    profile: "g1-regression",
    commandIds,
    expectedCommands: commandIds.length,
    expectedPassedTests: expectedAgenticPassedTests(commandIds),
  };
  if (!isDeepStrictEqual(reviewed, actual)) {
    throw new Error("G1.7 Agentic profile differs from its owner definition");
  }
  return Object.freeze({
    ...actual,
    commandIds: Object.freeze([...actual.commandIds]),
  });
}

function missingAgentic(reason) {
  return Object.freeze({
    status: "MISSING",
    sha256: null,
    reasons: Object.freeze([reason]),
    projection: null,
    artifacts: Object.freeze([]),
  });
}

function staleAgentic(observedSha256) {
  return Object.freeze({
    status: "STALE",
    sha256: observedSha256,
    reasons: Object.freeze(["agentic-evidence-invalid-or-stale"]),
    projection: null,
    artifacts: Object.freeze([]),
  });
}

export function verifyG17ImplementationFiles(receipt, root) {
  for (const file of receipt.implementation.files) {
    const path = resolve(root, file.path);
    if (
      !contained(root, path) ||
      relative(root, path).split(sep).includes("..")
    ) {
      throw new Error(
        "Agentic implementation path escapes evidence repository",
      );
    }
    const bytes = boundedRegularFile(
      path,
      root,
      "Agentic implementation input",
      MAX_EVIDENCE_BYTES,
      0,
    );
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error("Agentic implementation input differs from its receipt");
    }
  }
  if (
    sha256(JSON.stringify(receipt.implementation.files)) !==
    receipt.implementation.contentHash
  ) {
    throw new Error(
      "Agentic implementation manifest differs from its content hash",
    );
  }
}

export async function inspectG17AgenticEvidence({
  contract,
  identity,
  evidenceRepositoryRoot = repositoryRoot,
  maximumGeneratedAtMs,
}) {
  const profile = g17AgenticProfileContract(contract);
  const root = realpathSync(evidenceRepositoryRoot);
  const latestPath = join(
    root,
    "target",
    "agentic-qe",
    profile.profile,
    "receipt.json",
  );
  if (!existsSync(latestPath)) return missingAgentic("agentic-receipt-absent");
  const latestBytes = boundedRegularFile(
    latestPath,
    root,
    "Agentic latest receipt",
  );
  const observedSha256 = sha256(latestBytes);
  try {
    const candidate = JSON.parse(latestBytes);
    const dependency = agenticQeDependencyResolution();
    const publication = validateAgenticPublication(candidate, {
      repositoryRoot: root,
    });
    const receipt = publication.receipt;
    const expectedRuntime = await agenticRuntimeProvenance(
      profile.commandIds,
      agenticCommands,
      dependency.version,
    );
    validateAgenticReceipt(receipt, {
      expectedProfile: profile.profile,
      expectedAgenticQeVersion: dependency.version,
      expectedAgenticQeDependency: dependency,
      expectedRuntime,
      expectedCommandIds: profile.commandIds,
      expectedCommands: agenticCommands,
      minimumGeneratedAtMs: 0,
      maximumGeneratedAtMs,
    });
    validateAgenticArtifactArchive(receipt, { repositoryRoot: root });
    const dependencyBytes = {
      manifestBytes: boundedRegularFile(
        join(root, dependency.manifest),
        root,
        "Agentic dependency manifest",
      ),
      lockfileBytes: boundedRegularFile(
        join(root, dependency.lockfile),
        root,
        "Agentic dependency lockfile",
      ),
      npmrcBytes: boundedRegularFile(
        join(root, dependency.npmrc),
        root,
        "Agentic dependency npm policy",
      ),
      installedPackageJsonBytes: boundedRegularFile(
        join(
          root,
          "tools",
          "agentic-qe",
          "node_modules",
          "agentic-qe",
          "package.json",
        ),
        root,
        "installed Agentic dependency manifest",
      ),
    };
    const dependencyEvidence = validateAgenticDependencyEvidence({
      dependency,
      ...dependencyBytes,
    });
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const status = git(root, ["status", "--short"]);
    if (
      head !== identity?.subject?.commit ||
      status.length !== 0 ||
      receipt.repository?.gitHead !== identity.subject.commit ||
      receipt.repository?.worktreeDirty !== false ||
      realpathSync(receipt.repository.root) !== root
    ) {
      throw new Error(
        "Agentic receipt is not for the clean qualification subject",
      );
    }
    verifyG17ImplementationFiles(receipt, root);
    const passedTests = receipt.commands.reduce(
      (sum, command) => sum + command.testSafeguard.observedPassedTests,
      0,
    );
    if (receipt.commands.length !== 11 || passedTests !== 66) {
      throw new Error("Agentic receipt does not prove the exact 11/66 profile");
    }
    const artifacts = [
      {
        name: agenticDependencyEvidenceNames.installedPackageJson,
        bytes: dependencyBytes.installedPackageJsonBytes,
      },
      {
        name: agenticDependencyEvidenceNames.lockfile,
        bytes: dependencyBytes.lockfileBytes,
      },
      {
        name: agenticDependencyEvidenceNames.manifest,
        bytes: dependencyBytes.manifestBytes,
      },
      {
        name: agenticDependencyEvidenceNames.npmrc,
        bytes: dependencyBytes.npmrcBytes,
      },
      {
        name: "agentic-oracle.json",
        bytes: publication.oracleBytes,
      },
      {
        name: "agentic-receipt.json",
        bytes: publication.receiptBytes,
      },
    ];
    for (const [index, file] of receipt.artifacts.archive.files.entries()) {
      artifacts.push({
        name: `agentic-archive-${String(index).padStart(4, "0")}.bin`,
        bytes: boundedRegularFile(
          join(root, file.path),
          root,
          "Agentic archive file",
        ),
      });
    }
    artifacts.sort((left, right) =>
      comparePortablePaths(left.name, right.name),
    );
    const projection = {
      status: "PASS",
      subjectCommit: receipt.repository.gitHead,
      profile: receipt.profile,
      runId: receipt.runId,
      generatedAt: receipt.generatedAt,
      commandCount: receipt.commands.length,
      passedTests,
      receiptSha256: sha256(publication.receiptBytes),
      oracleSha256: sha256(publication.oracleBytes),
      contentHash: receipt.contentHash,
      executionHash: receipt.executionHash,
      runtimeContentHash: agenticRuntimeContentHash(expectedRuntime),
      implementationContentHash: receipt.implementation.contentHash,
      artifactContentHash: receipt.artifacts.contentHash,
      archiveContentHash: receipt.artifacts.archive.contentHash,
      archiveFileCount: receipt.artifacts.archive.files.length,
      dependencyContentHash: dependencyEvidence.contentHash,
    };
    return Object.freeze({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: Object.freeze([]),
      projection: Object.freeze(projection),
      artifacts: Object.freeze(artifacts.map(Object.freeze)),
    });
  } catch {
    return staleAgentic(observedSha256);
  }
}

export async function runG17NativeCompatibility({
  contract,
  contractBytes,
  contractSha256,
  identity,
  runId,
  repoRoot = repositoryRoot,
  signal,
}) {
  return runG17NativeApplication({
    contract,
    contractBytes,
    contractSha256,
    identity,
    runId,
    repoRoot,
    signal,
  });
}
function missingSemantic(reasons) {
  return Object.freeze({
    status: "MISSING",
    sha256: null,
    reasons: Object.freeze(reasons),
    projection: null,
    artifacts: Object.freeze([]),
  });
}

export async function inspectG17SemanticEvidence({
  repoRoot = repositoryRoot,
  executeCommand = execute,
}) {
  const root = realpathSync(repoRoot);
  const qualificationPath = join(
    root,
    "target",
    "metaharness",
    "qualification.json",
  );
  const verificationPath = join(
    root,
    "target",
    "metaharness",
    "verification.json",
  );
  const missing = [];
  if (!existsSync(qualificationPath)) missing.push("full-qualification-absent");
  if (!existsSync(verificationPath))
    missing.push("independent-verification-absent");
  if (missing.length > 0) return missingSemantic(missing);
  const observed = Buffer.concat([
    boundedRegularFile(qualificationPath, root, "semantic qualification"),
    boundedRegularFile(verificationPath, root, "semantic verification"),
  ]);
  try {
    const owner = await executeCommand(
      process.execPath,
      ["tools/metaharness/verify.mjs"],
      {
        cwd: root,
        quiet: true,
        announce: false,
        timeoutMs: 1_200_000,
      },
    );
    if (owner.code !== 0 || owner.timedOut || owner.spawnError !== null) {
      throw new Error("semantic owner verifier rejected evidence");
    }
    const qualificationBytes = boundedRegularFile(
      qualificationPath,
      root,
      "semantic qualification",
    );
    const verificationBytes = boundedRegularFile(
      verificationPath,
      root,
      "semantic verification",
    );
    const qualification = JSON.parse(qualificationBytes);
    const verification = JSON.parse(verificationBytes);
    const darwin = darwinInstallationSnapshot(
      root,
      join(root, "tools", "metaharness"),
    );
    const protectedContentHash = protectedSnapshot(root).contentHash;
    if (
      qualification.inputs?.after?.contentHash !== protectedContentHash ||
      qualification.inputs?.darwin?.after?.contentHash !== darwin.contentHash
    ) {
      throw new Error("semantic qualification inputs are stale");
    }
    const ownerProjection = validateSemanticEvidencePair({
      qualification,
      qualificationBytes,
      verification,
      verificationBytes,
      expectedDarwinVersion: darwin.version,
      expectedDarwinDependency: {
        ...darwin,
        installedPackageJsonSha256: darwin.packageJsonSha256,
      },
    });
    const projection = {
      ...ownerProjection,
      schema: G17_SEMANTIC_EVIDENCE_SCHEMA,
    };
    return Object.freeze({
      status: "PASS",
      sha256: canonicalSha256(projection),
      reasons: Object.freeze([]),
      projection: Object.freeze(projection),
      artifacts: Object.freeze([
        Object.freeze({
          name: "semantic-qualification.json",
          bytes: qualificationBytes,
        }),
        Object.freeze({
          name: "semantic-verification.json",
          bytes: verificationBytes,
        }),
      ]),
    });
  } catch {
    return Object.freeze({
      status: "STALE",
      sha256: sha256(observed),
      reasons: Object.freeze(["semantic-evidence-invalid-or-stale"]),
      projection: null,
      artifacts: Object.freeze([]),
    });
  }
}

export async function collectG17CompatibilityEvidence(options) {
  const [agenticQe, native, g14bPrerequisite] = await Promise.all([
    inspectG17AgenticEvidence(options),
    runG17NativeCompatibility(options),
    inspectG17G14bPrerequisite({
      receiptPath: options.g14bApplicationReceiptPath,
    }),
  ]);
  return combineG17CompatibilityEvidence({
    agenticQe,
    native,
    g14bPrerequisite,
  });
}

function replayAcceptedG14bPrerequisite(evidence) {
  const status = evidence?.status;
  if (status !== "PASS") return evidence;
  const artifacts = evidence?.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== 1) {
    throw new Error("G1.7 G1.4b prerequisite PASS artifact is incomplete");
  }
  const artifact = artifacts[0];
  const artifactName = artifact?.name;
  const suppliedReceiptBytes = artifact?.bytes;
  if (
    artifactName !== G17_G14B_PREREQUISITE_ARTIFACT_NAME ||
    !Buffer.isBuffer(suppliedReceiptBytes)
  ) {
    throw new Error("G1.7 G1.4b prerequisite PASS artifact is incomplete");
  }
  const receiptBytes = Buffer.from(suppliedReceiptBytes);
  const evidenceProjection = evidence?.projection;
  const evidenceSha256 = evidence?.sha256;
  const evidenceReasons = evidence?.reasons;
  const projection = replayG17G14bPrerequisite({
    receiptBytes,
  });
  if (
    !isDeepStrictEqual(projection, evidenceProjection) ||
    evidenceSha256 !== g17G14bPrerequisiteProjectionSha256(projection) ||
    !Array.isArray(evidenceReasons) ||
    evidenceReasons.length !== 0
  ) {
    throw new Error("G1.7 G1.4b prerequisite PASS projection drifted");
  }
  return Object.freeze({
    status: "PASS",
    sha256: g17G14bPrerequisiteProjectionSha256(projection),
    reasons: Object.freeze([]),
    projection,
    artifacts: Object.freeze([
      Object.freeze({
        name: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
        bytes: receiptBytes,
      }),
    ]),
  });
}

export function combineG17CompatibilityEvidence({
  agenticQe,
  native,
  g14bPrerequisite = inspectG17G14bPrerequisite(),
}) {
  const acceptedG14b = replayAcceptedG14bPrerequisite(g14bPrerequisite);
  const status =
    native.status === "FAIL"
      ? "FAIL"
      : agenticQe.status === "PASS" &&
          native.status === "PASS" &&
          acceptedG14b.status === "PASS"
        ? "PASS"
        : agenticQe.status === "STALE" ||
            native.status === "STALE" ||
            acceptedG14b.status === "STALE"
          ? "STALE"
          : "MISSING";
  const projection = {
    schema: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
    status,
    agenticQe: agenticQe.projection,
    native: native.projection,
    applicationReceipts:
      acceptedG14b.status === "PASS"
        ? Object.freeze([acceptedG14b.projection])
        : Object.freeze([]),
  };
  return Object.freeze({
    status,
    sha256: canonicalSha256(projection),
    reasons: Object.freeze([
      ...agenticQe.reasons,
      ...native.reasons,
      ...acceptedG14b.reasons,
    ]),
    projection: Object.freeze(projection),
    artifacts: Object.freeze([
      ...agenticQe.artifacts,
      ...native.artifacts,
      ...acceptedG14b.artifacts,
    ]),
  });
}
