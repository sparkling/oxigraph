import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import {
  isContained,
  portablePath,
  repoRoot,
} from "./path-policy.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const FILE_KEYS = ["path", "bytes", "sha256"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  const lexical = resolve(repoRoot, path);
  return (
    isContained(repoRoot, lexical) &&
    portablePath(relative(repoRoot, lexical)) === path
  );
}

function canonicalRecord(record) {
  return {
    path: record.path,
    bytes: record.bytes,
    sha256: record.sha256,
  };
}

function validRecord(record) {
  return (
    record !== null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    JSON.stringify(Object.keys(record)) === JSON.stringify(FILE_KEYS) &&
    canonicalPath(record.path) &&
    Number.isSafeInteger(record.bytes) &&
    record.bytes >= 0 &&
    typeof record.sha256 === "string" &&
    SHA256.test(record.sha256)
  );
}

export function implementationContentHash(files) {
  return sha256(JSON.stringify(files.map(canonicalRecord)));
}

export function validateImplementationManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.algorithm !== "sha256" ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(validRecord)
  ) {
    throw new Error("Agentic-QE implementation manifest is invalid");
  }
  for (let index = 1; index < manifest.files.length; index += 1) {
    if (manifest.files[index - 1].path >= manifest.files[index].path) {
      throw new Error(
        "Agentic-QE implementation manifest paths are not sorted and unique",
      );
    }
  }
  if (
    typeof manifest.contentHash !== "string" ||
    !SHA256.test(manifest.contentHash) ||
    manifest.contentHash !== implementationContentHash(manifest.files)
  ) {
    throw new Error("Agentic-QE implementation manifest hash is invalid");
  }
  return manifest;
}

export { implementationManifestValid } from "./receipt-contract.mjs";

export function createImplementationManifest(files) {
  const records = files
    .map(canonicalRecord)
    .sort((left, right) => {
      if (left.path < right.path) return -1;
      if (left.path > right.path) return 1;
      return 0;
    });
  const manifest = {
    algorithm: "sha256",
    files: records,
    contentHash: implementationContentHash(records),
  };
  return validateImplementationManifest(manifest);
}

export function implementationManifestsEqual(left, right) {
  validateImplementationManifest(left);
  validateImplementationManifest(right);
  return (
    left.contentHash === right.contentHash &&
    JSON.stringify(left.files) === JSON.stringify(right.files)
  );
}
