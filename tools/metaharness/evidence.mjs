import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { validateMutationReceipt } from "../mutation/evidence.mjs";
import {
  mutationProjectionValid,
  mutationQualificationBindingValid,
} from "./mutation-binding.mjs";
import {
  agenticProjectionValid,
  agenticQualificationBindingValid,
} from "./agentic-binding.mjs";

export const protectedInputs = Object.freeze([
  ".github/workflows/tests.yml",
  "Cargo.toml",
  "Cargo.lock",
  "cli",
  "docs/adr",
  "docs/plans",
  "docs/research",
  "js",
  "lib",
  "python",
  "testsuite",
  "tools/agentic-qe",
  "tools/datalog-oracles",
  "tools/evidence",
  "tools/jena-parity",
  "tools/metaharness",
  "tools/mutation",
  "tools/owl2-tests",
  "tools/shacl-tests",
  "tools/w3c-tests",
]);

const skippedDirectoryNames = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "target",
]);

const skippedRepositoryDirectories = new Set(["js/pkg"]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function portable(path) {
  return path.split("\\").join("/");
}

export function isInside(root, path, { allowRoot = false } = {}) {
  const child = relative(root, path);
  if (child === "") return allowRoot;
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function rejectSymlinkComponents(root, path) {
  let cursor = root;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`path contains a symbolic link: ${cursor}`);
    }
  }
}

export function ensureDirectoryInside(root, path) {
  const canonicalRoot = realpathSync(root);
  const lexical = resolve(path);
  if (!isInside(canonicalRoot, lexical)) {
    throw new Error(`output path escapes protected root: ${path}`);
  }
  rejectSymlinkComponents(canonicalRoot, lexical);
  mkdirSync(lexical, { recursive: true });
  rejectSymlinkComponents(canonicalRoot, lexical);
  const canonical = realpathSync(lexical);
  if (!isInside(canonicalRoot, canonical)) {
    throw new Error(`canonical output path escapes protected root: ${canonical}`);
  }
  return canonical;
}

export function writeJsonAtomic(path, value, root) {
  const canonicalRoot = realpathSync(root);
  const parent = ensureDirectoryInside(canonicalRoot, dirname(path));
  const target = resolve(path);
  if (!isInside(canonicalRoot, target)) {
    throw new Error(`receipt path escapes protected root: ${path}`);
  }
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`refusing to replace non-regular receipt: ${target}`);
    }
  }
  const temporary = join(
    parent,
    `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
    if (process.platform !== "win32") {
      const parentDescriptor = openSync(parent, "r");
      try {
        fsyncSync(parentDescriptor);
      } finally {
        closeSync(parentDescriptor);
      }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function inputFiles(root, path, output, { skipDirectories = true } = {}) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    const linkTarget = readlinkSync(path);
    const lexicalTarget = resolve(dirname(path), linkTarget);
    if (!isInside(root, lexicalTarget)) {
      throw new Error(`protected input symlink escapes repository: ${path}`);
    }
    const target = realpathSync(path);
    if (!isInside(root, target) || !lstatSync(target).isFile()) {
      throw new Error(`protected input symlink has an unsafe target: ${path}`);
    }
    output.push({ path, linkTarget, target });
    return;
  }
  if (metadata.isFile()) {
    output.push({ path });
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`unsupported protected input: ${path}`);
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const entryPath = join(path, entry.name);
    if (
      skipDirectories &&
      entry.isDirectory() &&
      (skippedDirectoryNames.has(entry.name) ||
        skippedRepositoryDirectories.has(portable(relative(root, entryPath))))
    ) {
      continue;
    }
    inputFiles(root, entryPath, output, { skipDirectories });
  }
}

export function snapshotRoots(root, roots, options = {}) {
  const canonicalRoot = realpathSync(root);
  const files = [];
  for (const input of roots) {
    const absolute = resolve(canonicalRoot, input);
    if (!isInside(canonicalRoot, absolute, { allowRoot: true })) {
      throw new Error(`protected input escapes repository: ${input}`);
    }
    if (!existsSync(absolute)) {
      throw new Error(`protected input is missing: ${input}`);
    }
    inputFiles(canonicalRoot, absolute, files, options);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const records = files.map((input) => {
    const name = portable(relative(canonicalRoot, input.path));
    if (input.linkTarget !== undefined) {
      const targetName = portable(relative(canonicalRoot, input.target));
      const targetBytes = readFileSync(input.target);
      const linkBytes = Buffer.from(input.linkTarget);
      return {
        path: name,
        kind: "symlink",
        linkTarget: input.linkTarget,
        target: targetName,
        sha256: sha256(
          JSON.stringify({
            linkTarget: input.linkTarget,
            target: targetName,
            targetSha256: sha256(targetBytes),
          }),
        ),
        bytes: linkBytes.length,
      };
    }
    const bytes = readFileSync(input.path);
    return {
      path: name,
      kind: "file",
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  });
  return {
    algorithm: "sha256",
    contentHash: sha256(JSON.stringify(records)),
    fileCount: records.length,
    roots,
    files: records,
  };
}

export function protectedSnapshot(repoRoot) {
  return snapshotRoots(repoRoot, protectedInputs);
}

export function changedInputs(before, after) {
  const left = new Map(before.files.map((item) => [item.path, item.sha256]));
  const right = new Map(after.files.map((item) => [item.path, item.sha256]));
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => left.get(path) !== right.get(path))
    .sort();
}

export function validateMutationQualification(value, inputs) {
  return validateMutationReceipt(value, inputs);
}

export function darwinInstallationSnapshot(repoRoot, toolDir) {
  const canonicalToolDir = realpathSync(toolDir);
  const entry = realpathSync(
    fileURLToPath(import.meta.resolve("@metaharness/darwin")),
  );
  const packageRoot = realpathSync(resolve(dirname(entry), ".."));
  const nodeModulesRoot = realpathSync(join(canonicalToolDir, "node_modules"));
  if (!isInside(nodeModulesRoot, packageRoot)) {
    throw new Error(`Darwin installation escapes local node_modules: ${packageRoot}`);
  }
  const packageJsonPath = join(packageRoot, "package.json");
  const packageJsonBytes = readFileSync(packageJsonPath);
  const manifest = JSON.parse(packageJsonBytes);
  if (manifest.name !== "@metaharness/darwin") {
    throw new Error(`unexpected Darwin package name: ${manifest.name}`);
  }
  if (typeof manifest.version !== "string" || !manifest.version) {
    throw new Error("installed Darwin package has no version");
  }
  const adapterManifest = JSON.parse(
    readFileSync(join(canonicalToolDir, "package.json")),
  );
  const pinnedVersion = adapterManifest.dependencies?.["@metaharness/darwin"];
  if (pinnedVersion !== manifest.version) {
    throw new Error(
      `installed Darwin ${manifest.version} does not match exact adapter pin ${pinnedVersion}`,
    );
  }
  const packageSnapshot = snapshotRoots(packageRoot, ["."], {
    skipDirectories: false,
  });
  return {
    name: manifest.name,
    version: manifest.version,
    path: portable(relative(repoRoot, packageRoot)),
    entry: portable(relative(packageRoot, entry)),
    packageJsonSha256: sha256(packageJsonBytes),
    entrySha256: sha256(readFileSync(entry)),
    contentHash: packageSnapshot.contentHash,
    fileCount: packageSnapshot.fileCount,
  };
}

export function qualificationContentHash(receipt) {
  const realGate = receipt.realGate;
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      qualification: receipt.qualification,
      darwinVersion: receipt.darwinVersion,
      mode: receipt.mode,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      runtime: receipt.runtime,
      policyBoundary: receipt.policyBoundary,
      inputs: receipt.inputs,
      synthetic: receipt.synthetic,
      safety: receipt.safety,
      mutation: receipt.mutation,
      realGate:
        realGate === null
          ? null
          : {
              taskId: realGate.taskId,
              exitCode: realGate.exitCode,
              timedOut: realGate.timedOut,
              blockedActions: realGate.blockedActions,
              durationMs: realGate.durationMs,
              stdoutHash: realGate.stdoutHash,
              stderrHash: realGate.stderrHash,
              agenticReceipt: realGate.agenticReceipt,
              receiptError: realGate.receiptError,
              passed: realGate.passed,
            },
      gates: receipt.gates,
      passed: receipt.passed,
    }),
  );
}

const realGateKeys = Object.freeze(
  [
    "agenticReceipt",
    "blockedActions",
    "durationMs",
    "exitCode",
    "passed",
    "receiptError",
    "stderrHash",
    "stdoutHash",
    "taskId",
    "timedOut",
  ].sort(),
);
const qualificationGateKeys = Object.freeze(
  ["solve", "regression", "safety", "cost", "reproducibility"].sort(),
);

export function trustedRealGateValid(
  realGate,
  { timeoutMs = 1_200_000 } = {},
) {
  const hash = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
  return (
    realGate !== null &&
    typeof realGate === "object" &&
    !Array.isArray(realGate) &&
    JSON.stringify(Object.keys(realGate).sort()) ===
      JSON.stringify(realGateKeys) &&
    typeof realGate.taskId === "string" &&
    realGate.taskId.length > 0 &&
    realGate.exitCode === 0 &&
    realGate.timedOut === false &&
    Array.isArray(realGate.blockedActions) &&
    realGate.blockedActions.length === 0 &&
    Number.isFinite(timeoutMs) &&
    timeoutMs >= 0 &&
    Number.isFinite(realGate.durationMs) &&
    realGate.durationMs >= 0 &&
    realGate.durationMs <= timeoutMs &&
    hash(realGate.stdoutHash) &&
    hash(realGate.stderrHash) &&
    agenticQualificationBindingValid(realGate.agenticReceipt) &&
    realGate.receiptError === null &&
    realGate.passed === true
  );
}

function strictIsoTimestampMs(value) {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}

export function validateQualificationReceipt(
  receipt,
  { expectedDarwinVersion, requireFull = true },
) {
  const startedAt = strictIsoTimestampMs(receipt?.startedAt);
  const finishedAt = strictIsoTimestampMs(receipt?.finishedAt);
  const agenticGeneratedAt = strictIsoTimestampMs(
    receipt?.realGate?.agenticReceipt?.generatedAt,
  );
  const fullMode = receipt?.mode === "synthetic-and-semantic-gate";
  const syntheticMode = receipt?.mode === "synthetic-only";
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.schemaVersion !== 2 ||
    receipt.qualification !== "oxigraph-policy-only-darwin" ||
    receipt.darwinVersion !== expectedDarwinVersion ||
    (!fullMode && !syntheticMode) ||
    (requireFull && !fullMode) ||
    receipt.passed !== true ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    finishedAt < startedAt ||
    receipt.inputs?.protectedInputsStable !== true ||
    receipt.inputs?.implementationStable !== true ||
    receipt.inputs?.darwin?.stable !== true ||
    receipt.inputs?.before?.contentHash !== receipt.inputs?.after?.contentHash ||
    !Array.isArray(receipt.inputs?.changedPaths) ||
    receipt.inputs.changedPaths.length !== 0 ||
    receipt.synthetic?.projectionHash !==
      receipt.synthetic?.replayProjectionHash ||
    receipt.safety?.directoryBlocked !== true ||
    receipt.safety?.generatedCodeBlocked !== true ||
    receipt.gates === null ||
    typeof receipt.gates !== "object" ||
    Array.isArray(receipt.gates) ||
    JSON.stringify(Object.keys(receipt.gates).sort()) !==
      JSON.stringify(qualificationGateKeys) ||
    qualificationGateKeys.some((gate) => receipt.gates[gate] !== true) ||
    (fullMode &&
      (!mutationQualificationBindingValid(receipt.mutation) ||
        !trustedRealGateValid(receipt.realGate) ||
        !Number.isFinite(agenticGeneratedAt) ||
        agenticGeneratedAt < startedAt ||
        agenticGeneratedAt > finishedAt)) ||
    (syntheticMode &&
      (receipt.mutation !== null || receipt.realGate !== null)) ||
    receipt.contentHash !== qualificationContentHash(receipt)
  ) {
    throw new Error("Darwin qualification receipt failed its hash or gate contract");
  }
  return receipt;
}

export function verificationContentHash(receipt) {
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      verified: receipt.verified,
      qualification: receipt.qualification,
      protectedContentHash: receipt.protectedContentHash,
      darwinContentHash: receipt.darwinContentHash,
      mutation: receipt.mutation,
      agentic: receipt.agentic,
    }),
  );
}

export function validateVerificationReceipt(
  receipt,
  {
    qualification,
    protectedContentHash,
    darwinContentHash,
    mutation,
    agentic,
  },
) {
  const hash = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.schemaVersion !== 1 ||
    receipt.verified !== true ||
    !hash(receipt.qualification?.sha256) ||
    !hash(receipt.qualification?.contentHash) ||
    !hash(receipt.protectedContentHash) ||
    !hash(receipt.darwinContentHash) ||
    !mutationProjectionValid(receipt.mutation) ||
    !agenticProjectionValid(receipt.agentic) ||
    JSON.stringify(receipt.qualification) !== JSON.stringify(qualification) ||
    receipt.protectedContentHash !== protectedContentHash ||
    receipt.darwinContentHash !== darwinContentHash ||
    JSON.stringify(receipt.mutation) !== JSON.stringify(mutation) ||
    JSON.stringify(receipt.agentic) !== JSON.stringify(agentic) ||
    receipt.contentHash !== verificationContentHash(receipt)
  ) {
    throw new Error("Darwin verification receipt failed its evidence bindings");
  }
  return receipt;
}
