import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export const LATEST_DIST_TAG = "latest";
const exactSemver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function sha512Integrity(value, label) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) {
    throw new Error(`${label} must use sha512 SRI`);
  }
  const encoded = value.slice("sha512-".length);
  const digest = Buffer.from(encoded, "base64");
  if (digest.length !== 64 || digest.toString("base64") !== encoded) {
    throw new Error(`${label} is not a canonical SHA-512 digest`);
  }
  return value;
}

export function localNodeModulesRoot(adapterDir, label) {
  const canonicalAdapterDir = realpathSync(adapterDir);
  const lexicalNodeModules = join(canonicalAdapterDir, "node_modules");
  const metadata = lstatSync(lexicalNodeModules);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} node_modules must be a real local directory`);
  }
  const canonicalNodeModules = realpathSync(lexicalNodeModules);
  const child = relative(canonicalAdapterDir, canonicalNodeModules);
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error(`${label} node_modules escapes its adapter directory`);
  }
  return canonicalNodeModules;
}

export function validateLifecycleScriptPolicy(bytes, label) {
  if (!/^ignore-scripts=true\r?\n?$/.test(bytes.toString("utf8"))) {
    throw new Error(`${label} must disable lifecycle scripts`);
  }
}

export function validateLatestDependencyLock(
  packageName,
  adapterManifest,
  lockfile,
) {
  object(adapterManifest, `${packageName} adapter manifest`);
  object(lockfile, `${packageName} adapter lockfile`);
  if (lockfile.lockfileVersion !== 3) {
    throw new Error(`${packageName} adapter lockfile must use lockfileVersion 3`);
  }
  const requested = adapterManifest.dependencies?.[packageName];
  const lockedRequest = lockfile.packages?.[""]?.dependencies?.[packageName];
  if (requested !== LATEST_DIST_TAG || lockedRequest !== LATEST_DIST_TAG) {
    throw new Error(
      `${packageName} manifest and lockfile must both request the latest dist-tag`,
    );
  }

  const locked = lockfile.packages?.[`node_modules/${packageName}`];
  const version =
    typeof locked?.version === "string" ? exactSemver.exec(locked.version) : null;
  if (
    version === null ||
    (version[4] !== undefined &&
      version[4]
        .split(".")
        .some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0"))
  ) {
    throw new Error(`${packageName} lockfile has no exact semantic version`);
  }
  const packageBaseName = packageName.slice(packageName.lastIndexOf("/") + 1);
  const expectedResolved =
    `https://registry.npmjs.org/${packageName}/-/` +
    `${packageBaseName}-${locked.version}.tgz`;
  if (locked.resolved !== expectedResolved) {
    throw new Error(
      `${packageName} lockfile does not resolve through the official npm registry`,
    );
  }
  return Object.freeze({
    name: packageName,
    policy: LATEST_DIST_TAG,
    version: locked.version,
    resolved: locked.resolved,
    integrity: sha512Integrity(
      locked.integrity,
      `${packageName} lockfile integrity`,
    ),
  });
}
