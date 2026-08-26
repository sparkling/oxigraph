import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createDurableDirectory } from "./atomic-json.mjs";
import {
  assertDirectorySnapshot,
  captureDirectorySnapshot,
  stableRegularFileBytes,
  syncDirectorySnapshot,
} from "./file-safety.mjs";
import {
  canonicalInside,
  outputRoot,
  portablePath,
  repoRoot,
} from "./path-policy.mjs";
import { archiveStructureMatches } from "./receipt-contract.mjs";

export { archiveStructureMatches } from "./receipt-contract.mjs";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function archiveRootFor(profile, contentHash, { create = false } = {}) {
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(profile) ||
    !/^[0-9a-f]{64}$/.test(contentHash)
  ) {
    throw new Error("invalid profile artifact archive identity");
  }
  const path = join(outputRoot, profile, "artifacts", contentHash);
  if (!create) return path;
  try {
    return createDurableDirectory(path);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return captureDirectorySnapshot(path, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE artifact archive root",
    }).path;
  }
}

function stableArchiveBytes(path, expected, { singleLink = false } = {}) {
  const { bytes } = stableRegularFileBytes(path, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE artifact",
    requireSingleLink: singleLink,
  });
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error(`artifact bytes changed or are invalid: ${path}`);
  }
  return bytes;
}

function cleanupTemporary(path, identity) {
  if (!existsSync(path)) return;
  const current = lstatSync(path);
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    current.dev !== identity?.dev ||
    current.ino !== identity?.ino
  ) {
    throw new Error("refusing to unlink a changed Agentic-QE archive temporary");
  }
  unlinkSync(path);
}

function atomicArchiveFile(path, bytes, expectedSha256, parent) {
  assertDirectorySnapshot(parent, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE artifact archive root",
  });
  if (existsSync(path)) {
    stableArchiveBytes(
      path,
      {
        bytes: bytes.length,
        sha256: expectedSha256,
      },
      { singleLink: true },
    );
    return;
  }
  const temporary = join(
    parent.path,
    `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let descriptor;
  let temporaryIdentity;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    temporaryIdentity = fstatSync(descriptor);
    const lexical = lstatSync(temporary);
    if (
      lexical.isSymbolicLink() ||
      !lexical.isFile() ||
      lexical.dev !== temporaryIdentity.dev ||
      lexical.ino !== temporaryIdentity.ino
    ) {
      throw new Error("Agentic-QE archive temporary changed while opening");
    }
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE artifact archive root",
    });
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    stableArchiveBytes(
      temporary,
      {
        bytes: bytes.length,
        sha256: expectedSha256,
      },
      { singleLink: true },
    );
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    unlinkSync(temporary);
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE artifact archive root",
    });
    syncDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE artifact archive root",
    });
    stableArchiveBytes(
      path,
      {
        bytes: bytes.length,
        sha256: expectedSha256,
      },
      { singleLink: true },
    );
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE artifact archive root",
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    cleanupTemporary(temporary, temporaryIdentity);
  }
}

export function archiveOutputArtifacts(profile, artifacts) {
  if (
    artifacts?.complete !== true ||
    !Array.isArray(artifacts.files) ||
    !/^[0-9a-f]{64}$/.test(artifacts.contentHash ?? "")
  ) {
    throw new Error("cannot archive incomplete output artifacts");
  }
  const totalBytes = artifacts.files.reduce(
    (sum, file) => sum + (Number.isSafeInteger(file?.bytes) ? file.bytes : NaN),
    0,
  );
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ARCHIVE_BYTES) {
    throw new Error("artifact archive exceeds its reviewed byte ceiling");
  }
  const root = archiveRootFor(profile, artifacts.contentHash, { create: true });
  const rootSnapshot = captureDirectorySnapshot(root, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE artifact archive root",
  });
  const files = [];
  for (const [index, source] of artifacts.files.entries()) {
    const sourcePath = join(repoRoot, source.path);
    const canonicalSource = canonicalInside(repoRoot, sourcePath);
    if (portablePath(relative(repoRoot, canonicalSource)) !== source.path) {
      throw new Error(`artifact source path is invalid: ${source.path}`);
    }
    const bytes = stableArchiveBytes(sourcePath, source);
    const destination = join(root, `${String(index).padStart(4, "0")}.bin`);
    atomicArchiveFile(destination, bytes, source.sha256, rootSnapshot);
    files.push({
      sourcePath: source.path,
      path: portablePath(relative(repoRoot, destination)),
      bytes: source.bytes,
      sha256: source.sha256,
    });
  }
  assertDirectorySnapshot(rootSnapshot, {
    repositoryRoot: repoRoot,
    expectedEntries: files.map((file) => basename(file.path)),
    label: "Agentic-QE artifact archive root",
  });
  return {
    algorithm: "sha256",
    complete: true,
    root: portablePath(relative(repoRoot, root)),
    files,
    totalBytes,
    contentHash: sha256(JSON.stringify(files)),
  };
}

export function validateAgenticArtifactArchive(
  receipt,
  { repositoryRoot = repoRoot } = {},
) {
  if (!archiveStructureMatches(receipt)) {
    throw new Error("Agentic-QE artifact archive contract is invalid");
  }
  const root = join(repositoryRoot, receipt.artifacts.archive.root);
  const expectedEntries = receipt.artifacts.archive.files.map(
    (file) => basename(file.path),
  );
  const before = captureDirectorySnapshot(root, {
    repositoryRoot,
    expectedEntries,
    label: "Agentic-QE artifact archive root",
  });
  for (const file of receipt.artifacts.archive.files) {
    const path = join(repositoryRoot, file.path);
    const expectedPath = join(before.path, basename(file.path));
    if (resolve(path) !== expectedPath) {
      throw new Error(`Agentic-QE archived artifact path is unsafe: ${file.path}`);
    }
    const { bytes } = stableRegularFileBytes(path, {
      repositoryRoot,
      label: "Agentic-QE archived artifact",
      requireSingleLink: true,
    });
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`artifact bytes changed or are invalid: ${path}`);
    }
    assertDirectorySnapshot(before, {
      repositoryRoot,
      expectedEntries,
      label: "Agentic-QE artifact archive root",
      stableMetadata: true,
    });
  }
  assertDirectorySnapshot(before, {
    repositoryRoot,
    expectedEntries,
    label: "Agentic-QE artifact archive root",
    stableMetadata: true,
  });
  return receipt.artifacts.archive;
}
