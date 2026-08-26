import { randomUUID } from "node:crypto";
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
import {
  localNodeModulesRoot,
  validateLifecycleScriptPolicy,
  validateLatestDependencyLock,
} from "../dependency-policy.mjs";
import { validateMutationReceipt } from "../mutation/evidence.mjs";
import {
  comparePortablePaths,
  protectedInputs,
} from "./policy-contract.mjs";
import { sha256 } from "./receipt-contract.mjs";

export {
  qualificationContentHash,
  qualificationReceiptBytes,
  sha256,
  trustedRealGateValid,
  validateQualificationReceipt,
  validateSemanticEvidencePair,
  validateVerificationReceipt,
  verificationContentHash,
  verificationFromQualification,
  verificationReceiptBytes,
} from "./receipt-contract.mjs";
export {
  comparePortablePaths,
  mutablePolicy,
  protectedInputs,
} from "./policy-contract.mjs";

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
    comparePortablePaths(a.name, b.name),
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
  records.sort((left, right) => comparePortablePaths(left.path, right.path));
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].path === records[index].path) {
      throw new Error(`protected input roots overlap at: ${records[index].path}`);
    }
  }
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
    .sort(comparePortablePaths);
}

export function validateMutationQualification(value, inputs) {
  return validateMutationReceipt(value, inputs);
}

export function validateDarwinLockPolicy(adapterManifest, lockfile) {
  return validateLatestDependencyLock(
    "@metaharness/darwin",
    adapterManifest,
    lockfile,
  );
}

export function darwinLockResolution(repoRoot, toolDir) {
  const canonicalRoot = realpathSync(repoRoot);
  const canonicalToolDir = realpathSync(toolDir);
  if (!isInside(canonicalRoot, canonicalToolDir)) {
    throw new Error(`Darwin adapter escapes repository: ${canonicalToolDir}`);
  }
  const manifestPath = join(canonicalToolDir, "package.json");
  const lockfilePath = join(canonicalToolDir, "package-lock.json");
  const npmrcPath = join(canonicalToolDir, ".npmrc");
  for (const [path, label] of [
    [manifestPath, "Darwin adapter manifest"],
    [lockfilePath, "Darwin adapter lockfile"],
    [npmrcPath, "Darwin adapter .npmrc"],
  ]) {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`${label} must be a regular non-symlink file`);
    }
  }
  const manifestBytes = readFileSync(manifestPath);
  const lockfileBytes = readFileSync(lockfilePath);
  const npmrcBytes = readFileSync(npmrcPath);
  validateLifecycleScriptPolicy(npmrcBytes, "Darwin adapter .npmrc");
  const resolution = validateDarwinLockPolicy(
    JSON.parse(manifestBytes),
    JSON.parse(lockfileBytes),
  );
  return Object.freeze({
    ...resolution,
    manifest: portable(relative(canonicalRoot, manifestPath)),
    manifestSha256: sha256(manifestBytes),
    lockfile: portable(relative(canonicalRoot, lockfilePath)),
    lockfileSha256: sha256(lockfileBytes),
    npmrc: portable(relative(canonicalRoot, npmrcPath)),
    npmrcSha256: sha256(npmrcBytes),
  });
}

export function darwinInstallationSnapshot(repoRoot, toolDir) {
  const canonicalToolDir = realpathSync(toolDir);
  const resolution = darwinLockResolution(repoRoot, canonicalToolDir);
  const entry = realpathSync(
    fileURLToPath(import.meta.resolve("@metaharness/darwin")),
  );
  const packageRoot = realpathSync(resolve(dirname(entry), ".."));
  const nodeModulesRoot = localNodeModulesRoot(
    canonicalToolDir,
    "Darwin adapter",
  );
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
  if (resolution.version !== manifest.version) {
    throw new Error(
      `installed Darwin ${manifest.version} does not match lockfile resolution ${resolution.version}`,
    );
  }
  const packageSnapshot = snapshotRoots(packageRoot, ["."], {
    skipDirectories: false,
  });
  return {
    ...resolution,
    path: portable(relative(repoRoot, packageRoot)),
    entry: portable(relative(packageRoot, entry)),
    packageJsonSha256: sha256(packageJsonBytes),
    entrySha256: sha256(readFileSync(entry)),
    contentHash: packageSnapshot.contentHash,
    fileCount: packageSnapshot.fileCount,
  };
}
