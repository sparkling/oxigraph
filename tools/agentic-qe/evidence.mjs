import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  createImplementationManifest,
  validateImplementationManifest,
} from "./implementation-manifest.mjs";
import {
  canonicalInside,
  portablePath,
  repoRoot,
  toolDir,
} from "./path-policy.mjs";
import { stableRegularFileBytes } from "./file-safety.mjs";
import { readAgenticPublication } from "./publication.mjs";
import {
  agenticReceiptBytes,
  validateAgenticOracle,
} from "./receipt-contract.mjs";

export {
  archiveOutputArtifacts,
  validateAgenticArtifactArchive,
} from "./artifact-archive.mjs";
export {
  implementationManifestsEqual,
  validateImplementationManifest,
} from "./implementation-manifest.mjs";
export { readAgenticFileBytes } from "./publication.mjs";
export {
  agenticOracleBytes,
  agenticReceiptBytes,
  agenticReceiptContentHash,
  agenticReceiptExecutionHash,
  archiveStructureMatches,
  outputBinding,
  publicationStructureMatches,
  stableCommandResult,
  validateAgenticOracle,
  validateAgenticReceipt,
} from "./receipt-contract.mjs";

const ignoredNames = new Set([".git", "node_modules", "target"]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileRecord(path) {
  const canonical = canonicalInside(repoRoot, path);
  const { bytes } = stableRegularFileBytes(canonical, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE implementation evidence",
  });
  return {
    path: portablePath(relative(repoRoot, canonical)),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function walk(path, records, visited) {
  const lexical = lstatSync(path);
  const canonical = canonicalInside(repoRoot, path, { allowRoot: true });
  const metadata = lexical.isSymbolicLink() ? statSync(canonical) : lexical;
  if (metadata.isFile()) {
    records.set(canonical, fileRecord(canonical));
    return;
  }
  if (!metadata.isDirectory()) return;
  if (visited.has(canonical)) return;
  visited.add(canonical);
  for (const entry of readdirSync(canonical, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    walk(join(canonical, entry.name), records, visited);
  }
}

function cargoPackages() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--locked", "--format-version", "1", "--no-deps"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  );
  const local = metadata.packages.filter((item) => item.source === null);
  const byDirectory = new Map(
    local.map((item) => [realpathSync(dirname(item.manifest_path)), item]),
  );
  return { local, byDirectory };
}

function packageDirectories(packageNames) {
  if (packageNames.length === 0) return [];
  const { local, byDirectory } = cargoPackages();
  const pending = packageNames.map((name) => {
    const matches = local.filter((item) => item.name === name);
    if (matches.length !== 1) {
      throw new Error(`expected one local Cargo package named ${name}`);
    }
    return matches[0];
  });
  const directories = new Set();
  while (pending.length > 0) {
    const item = pending.pop();
    const directory = realpathSync(dirname(item.manifest_path));
    if (directories.has(directory)) continue;
    directories.add(directory);
    for (const dependency of item.dependencies) {
      if (!dependency.path) continue;
      const dependencyDirectory = realpathSync(dependency.path);
      const localDependency = byDirectory.get(dependencyDirectory);
      if (!localDependency) {
        throw new Error(`local dependency is not workspace metadata: ${dependency.path}`);
      }
      pending.push(localDependency);
    }
  }
  return [...directories];
}

function snapshot(paths) {
  const records = new Map();
  const visited = new Set();
  for (const path of paths) walk(path, records, visited);
  return createImplementationManifest([...records.values()]);
}

function selectedEvidence(selected, commands) {
  const packageNames = new Set();
  const paths = new Set([
    join(repoRoot, "Cargo.toml"),
    join(repoRoot, "Cargo.lock"),
    join(repoRoot, "tools", "child-environment.mjs"),
    join(repoRoot, "tools", "dependency-policy.mjs"),
    toolDir,
  ]);
  for (const relativePath of [".cargo", "rust-toolchain", "rust-toolchain.toml"]) {
    const path = join(repoRoot, relativePath);
    if (existsSync(path)) paths.add(path);
  }
  for (const id of selected) {
    const policy = commands[id][2] ?? {};
    for (const name of policy.evidencePackages ?? []) packageNames.add(name);
    for (const path of policy.evidencePaths ?? []) {
      paths.add(canonicalInside(repoRoot, join(repoRoot, path)));
    }
  }
  for (const path of packageDirectories([...packageNames])) paths.add(path);
  return [...paths];
}

export function implementationSnapshot(selected, commands) {
  return snapshot(selectedEvidence(selected, commands));
}

export function changedInputs(before, after) {
  validateImplementationManifest(before);
  validateImplementationManifest(after);
  const beforeFiles = new Map(
    before.files.map((item) => [item.path, JSON.stringify(item)]),
  );
  const afterFiles = new Map(
    after.files.map((item) => [item.path, JSON.stringify(item)]),
  );
  return [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])]
    .filter((path) => beforeFiles.get(path) !== afterFiles.get(path))
    .sort();
}

export function outputArtifacts(selected, commands) {
  const paths = new Set();
  for (const id of selected) {
    const policy = commands[id][2] ?? {};
    for (const path of policy.outputPaths ?? []) paths.add(join(repoRoot, path));
  }
  if (paths.size === 0) {
    return {
      algorithm: "sha256",
      complete: true,
      missingPaths: [],
      invalidPaths: [],
      files: [],
      contentHash: sha256("[]"),
    };
  }
  const missingPaths = [...paths]
    .filter((path) => !existsSync(path))
    .map((path) => portablePath(relative(repoRoot, path)))
    .sort();
  const invalidPaths = [...paths]
    .filter((path) => {
      if (!existsSync(path)) return false;
      const metadata = lstatSync(path);
      return metadata.isSymbolicLink() || !metadata.isFile();
    })
    .map((path) => portablePath(relative(repoRoot, path)))
    .sort();
  const result = snapshot(
    [...paths].filter(
      (path) =>
        existsSync(path) &&
        !lstatSync(path).isSymbolicLink() &&
        lstatSync(path).isFile(),
    ),
  );
  return {
    ...result,
    complete: missingPaths.length === 0 && invalidPaths.length === 0,
    missingPaths,
    invalidPaths,
  };
}

export function validateAgenticPublication(
  receipt,
  options = {},
) {
  const publication = readAgenticPublication(receipt, options);
  const { receiptBytes, oracleBytes } = publication;
  const authoritativeReceipt = JSON.parse(receiptBytes);
  if (
    !receiptBytes.equals(agenticReceiptBytes(authoritativeReceipt)) ||
    !receiptBytes.equals(agenticReceiptBytes(receipt))
  ) {
    throw new Error("Agentic-QE immutable receipt bytes differ from the receipt");
  }
  const oracle = JSON.parse(oracleBytes);
  validateAgenticOracle(oracle, authoritativeReceipt, receiptBytes);
  return { ...publication, receipt: authoritativeReceipt, oracle };
}
