import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import {
  LATEST_DIST_TAG,
  localNodeModulesRoot,
  validateLifecycleScriptPolicy,
  validateLatestDependencyLock,
} from "../dependency-policy.mjs";
import {
  isContained,
  portablePath,
  repoRoot,
  toolDir,
} from "./path-policy.mjs";

export const AGENTIC_QE_VERSION_POLICY = LATEST_DIST_TAG;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readRegular(path, label) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return readFileSync(path);
}

function readJson(path, label) {
  const bytes = readRegular(path, label);
  try {
    return { bytes, value: JSON.parse(bytes) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export function validateAgenticQeLockPolicy(adapterManifest, lockfile) {
  return validateLatestDependencyLock("agentic-qe", adapterManifest, lockfile);
}

export function agenticQeLockResolution({
  adapterDir = toolDir,
  repositoryRoot = repoRoot,
} = {}) {
  const canonicalRepositoryRoot = realpathSync(repositoryRoot);
  const canonicalAdapterDir = realpathSync(adapterDir);
  if (!isContained(canonicalRepositoryRoot, canonicalAdapterDir)) {
    throw new Error(
      `Agentic-QE adapter escapes repository: ${canonicalAdapterDir}`,
    );
  }
  const adapterManifestPath = join(canonicalAdapterDir, "package.json");
  const lockfilePath = join(canonicalAdapterDir, "package-lock.json");
  const npmrcPath = join(canonicalAdapterDir, ".npmrc");
  const adapterManifest = readJson(
    adapterManifestPath,
    "Agentic-QE adapter manifest",
  );
  const lockfile = readJson(lockfilePath, "Agentic-QE adapter lockfile");
  const npmrcBytes = readRegular(npmrcPath, "Agentic-QE adapter .npmrc");
  validateLifecycleScriptPolicy(npmrcBytes, "Agentic-QE adapter .npmrc");
  const resolution = validateAgenticQeLockPolicy(
    adapterManifest.value,
    lockfile.value,
  );
  return Object.freeze({
    ...resolution,
    manifest: portablePath(
      relative(canonicalRepositoryRoot, adapterManifestPath),
    ),
    manifestSha256: sha256(adapterManifest.bytes),
    lockfile: portablePath(relative(canonicalRepositoryRoot, lockfilePath)),
    lockfileSha256: sha256(lockfile.bytes),
    npmrc: portablePath(relative(canonicalRepositoryRoot, npmrcPath)),
    npmrcSha256: sha256(npmrcBytes),
  });
}

export function agenticQeDependencyResolution() {
  const resolution = agenticQeLockResolution();

  const nodeModulesRoot = localNodeModulesRoot(toolDir, "Agentic-QE adapter");
  const packageRoot = realpathSync(join(nodeModulesRoot, "agentic-qe"));
  if (!isContained(nodeModulesRoot, packageRoot)) {
    throw new Error(
      `Agentic-QE installation escapes local node_modules: ${packageRoot}`,
    );
  }
  const installedManifestPath = join(packageRoot, "package.json");
  const installedManifest = readJson(
    installedManifestPath,
    "installed Agentic-QE manifest",
  );
  if (
    installedManifest.value.name !== "agentic-qe" ||
    installedManifest.value.version !== resolution.version
  ) {
    throw new Error(
      `installed Agentic-QE ${installedManifest.value.version ?? "<missing>"} ` +
        `does not match lockfile resolution ${resolution.version}`,
    );
  }

  return Object.freeze({
    ...resolution,
    installedPackageJsonSha256: sha256(installedManifest.bytes),
  });
}
