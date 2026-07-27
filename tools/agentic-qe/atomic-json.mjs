import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  assertDirectorySnapshot,
  captureDirectorySnapshot,
  stableRegularFileBytes,
  syncDirectorySnapshot,
} from "./file-safety.mjs";
import {
  ensureDirectoryInsideRepository,
  repoRoot,
} from "./path-policy.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function directoryFsyncSupported(platform = process.platform) {
  return platform !== "win32";
}

function parentSnapshot(path) {
  const parent = ensureDirectoryInsideRepository(dirname(path));
  return captureDirectorySnapshot(parent, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE publication parent",
  });
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
    throw new Error("refusing to unlink a changed Agentic-QE temporary file");
  }
  unlinkSync(path);
}

export function createDurableDirectory(path) {
  const requested = resolve(path);
  const parent = parentSnapshot(requested);
  const target = join(parent.path, basename(requested));
  try {
    mkdirSync(target, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const collision = new Error(
        `refusing to replace immutable publication directory: ${target}`,
      );
      collision.code = "EEXIST";
      throw collision;
    }
    throw error;
  }
  const created = captureDirectorySnapshot(target, {
    repositoryRoot: repoRoot,
    expectedEntries: [],
    label: "Agentic-QE publication directory",
  });
  assertDirectorySnapshot(parent, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE publication parent",
  });
  syncDirectorySnapshot(parent, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE publication parent",
  });
  assertDirectorySnapshot(created, {
    repositoryRoot: repoRoot,
    expectedEntries: [],
    label: "Agentic-QE publication directory",
    stableMetadata: true,
  });
  assertDirectorySnapshot(parent, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE publication parent",
  });
  return created.path;
}

export function atomicJson(
  path,
  value,
  { replace = true } = {},
) {
  const requested = resolve(path);
  const parent = parentSnapshot(requested);
  const target = join(parent.path, basename(requested));
  if (existsSync(target)) {
    if (!replace) {
      throw new Error(`refusing to replace immutable publication: ${target}`);
    }
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`refusing to replace non-regular receipt: ${target}`);
    }
  }
  assertDirectorySnapshot(parent, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE publication parent",
  });
  const temporary = join(
    parent.path,
    `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  let descriptor;
  let temporaryIdentity;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    temporaryIdentity = fstatSync(descriptor);
    const opened = lstatSync(temporary);
    if (
      opened.isSymbolicLink() ||
      !opened.isFile() ||
      opened.dev !== temporaryIdentity.dev ||
      opened.ino !== temporaryIdentity.ino
    ) {
      throw new Error("Agentic-QE temporary publication changed while opening");
    }
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE publication parent",
    });
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE publication parent",
    });
    const staged = stableRegularFileBytes(temporary, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE temporary publication",
      requireSingleLink: true,
    });
    if (!staged.bytes.equals(bytes)) {
      throw new Error("Agentic-QE temporary publication bytes changed");
    }
    if (replace) {
      renameSync(temporary, target);
    } else {
      linkSync(temporary, target);
      unlinkSync(temporary);
    }
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE publication parent",
    });
    syncDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE publication parent",
    });
    const observed = stableRegularFileBytes(target, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE published JSON",
      requireSingleLink: true,
    });
    if (!observed.bytes.equals(bytes)) {
      throw new Error("Agentic-QE published JSON bytes changed");
    }
    assertDirectorySnapshot(parent, {
      repositoryRoot: repoRoot,
      label: "Agentic-QE publication parent",
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    cleanupTemporary(temporary, temporaryIdentity);
  }
  return { bytes, sha256: sha256(bytes) };
}
