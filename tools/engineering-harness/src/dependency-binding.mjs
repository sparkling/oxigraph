import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import {
  localNodeModulesRoot,
  validateLatestDependencyLock,
  validateLifecycleScriptPolicy,
} from "../../dependency-policy.mjs";
import { harnessRoot, isContained, repositoryRoot } from "./paths.mjs";

export const REQUIRED_PACKAGES = Object.freeze([
  "@metaharness/avo",
  "@metaharness/darwin",
  "@metaharness/harness",
  "@metaharness/router",
  "metaharness",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

export function dependencyLockResolution({ adapterRoot = harnessRoot } = {}) {
  const canonicalRoot = realpathSync(adapterRoot);
  if (!isContained(repositoryRoot, canonicalRoot)) {
    throw new Error(`engineering harness escapes repository: ${canonicalRoot}`);
  }
  const manifestPath = join(canonicalRoot, "package.json");
  const lockfilePath = join(canonicalRoot, "package-lock.json");
  const npmrcPath = join(canonicalRoot, ".npmrc");
  const manifest = readJson(manifestPath, "engineering harness manifest");
  const lockfile = readJson(lockfilePath, "engineering harness lockfile");
  const npmrc = readRegular(npmrcPath, "engineering harness .npmrc");
  validateLifecycleScriptPolicy(npmrc, "engineering harness .npmrc");
  const packages = REQUIRED_PACKAGES.map((name) =>
    validateLatestDependencyLock(name, manifest.value, lockfile.value),
  );
  return Object.freeze({
    packages,
    manifest: relative(repositoryRoot, manifestPath),
    manifestSha256: sha256(manifest.bytes),
    lockfile: relative(repositoryRoot, lockfilePath),
    lockfileSha256: sha256(lockfile.bytes),
    npmrc: relative(repositoryRoot, npmrcPath),
    npmrcSha256: sha256(npmrc),
  });
}

export function installedDependencyResolution() {
  const resolution = dependencyLockResolution();
  const nodeModules = localNodeModulesRoot(harnessRoot, "engineering harness");
  const packages = resolution.packages.map((locked) => {
    const packageRoot = realpathSync(join(nodeModules, locked.name));
    if (!isContained(nodeModules, packageRoot)) {
      throw new Error(`installed ${locked.name} escapes local node_modules`);
    }
    const manifest = readJson(
      join(packageRoot, "package.json"),
      `installed ${locked.name} manifest`,
    );
    if (
      manifest.value.name !== locked.name ||
      manifest.value.version !== locked.version
    ) {
      throw new Error(
        `installed ${locked.name} ${manifest.value.version ?? "<missing>"} ` +
          `does not match lockfile ${locked.version}`,
      );
    }
    return Object.freeze({
      ...locked,
      installedPackageJsonSha256: sha256(manifest.bytes),
    });
  });
  return Object.freeze({ ...resolution, packages });
}
