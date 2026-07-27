import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function inside(root, path, { allowRoot = false } = {}) {
  const child = relative(root, path);
  if (child === "") return allowRoot;
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function samePath(left, right) {
  const normalize = (value) => resolve(value).replaceAll("\\", "/");
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function checkedPath(repositoryRoot, path, { allowRoot = false } = {}) {
  const root = realpathSync(repositoryRoot);
  const lexical = resolve(path);
  if (!inside(root, lexical, { allowRoot })) {
    throw new Error(`Agentic-QE path escapes repository: ${path}`);
  }
  return { root, lexical };
}

export function rejectSymlinkComponents(repositoryRoot, path) {
  const { root, lexical } = checkedPath(repositoryRoot, path, {
    allowRoot: true,
  });
  let cursor = root;
  for (const component of relative(root, lexical).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`Agentic-QE path contains a symbolic link: ${cursor}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return lexical;
}

function fileStateMatches(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function singleLink(metadata, required) {
  return !required || metadata.nlink === 1;
}

export function stableRegularFileBytes(
  path,
  {
    repositoryRoot,
    label = "Agentic-QE file",
    requireSingleLink = false,
  },
) {
  const { lexical } = checkedPath(repositoryRoot, path);
  rejectSymlinkComponents(repositoryRoot, lexical);
  const initial = lstatSync(lexical);
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    !singleLink(initial, requireSingleLink)
  ) {
    const requirement = requireSingleLink
      ? "a regular file with one stable path"
      : "a regular file";
    throw new Error(`${label} is not ${requirement}: ${path}`);
  }
  const descriptor = openSync(
    lexical,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !fileStateMatches(initial, opened) ||
      !singleLink(opened, requireSingleLink)
    ) {
      throw new Error(`${label} changed while opening: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    rejectSymlinkComponents(repositoryRoot, lexical);
    const current = lstatSync(lexical);
    if (
      !fileStateMatches(opened, after) ||
      !fileStateMatches(opened, current) ||
      !singleLink(after, requireSingleLink) ||
      !singleLink(current, requireSingleLink) ||
      bytes.length !== opened.size
    ) {
      throw new Error(`${label} changed while reading: ${path}`);
    }
    return { bytes, metadata: opened };
  } finally {
    closeSync(descriptor);
  }
}

function directoryEntries(path, expectedEntries, label) {
  if (expectedEntries === undefined) return undefined;
  const observed = readdirSync(path).sort();
  const expected = [...expectedEntries].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains unexpected files`);
  }
  return observed;
}

export function captureDirectorySnapshot(
  path,
  {
    repositoryRoot,
    expectedEntries,
    label = "Agentic-QE directory",
  },
) {
  const { lexical } = checkedPath(repositoryRoot, path);
  rejectSymlinkComponents(repositoryRoot, lexical);
  const metadata = lstatSync(lexical);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !samePath(realpathSync(lexical), lexical)
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return {
    path: lexical,
    dev: metadata.dev,
    ino: metadata.ino,
    nlink: metadata.nlink,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    entries: directoryEntries(lexical, expectedEntries, label),
  };
}

export function assertDirectorySnapshot(
  expected,
  {
    repositoryRoot,
    expectedEntries,
    label = "Agentic-QE directory",
    stableMetadata = false,
  },
) {
  const current = captureDirectorySnapshot(expected.path, {
    repositoryRoot,
    expectedEntries,
    label,
  });
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    (stableMetadata &&
      (current.nlink !== expected.nlink ||
        current.size !== expected.size ||
        current.mtimeMs !== expected.mtimeMs ||
        current.ctimeMs !== expected.ctimeMs)) ||
    (expected.entries !== undefined &&
      JSON.stringify(current.entries) !== JSON.stringify(expected.entries))
  ) {
    throw new Error(`${label} changed during use`);
  }
  return current;
}

export function syncDirectorySnapshot(
  expected,
  { repositoryRoot, label = "Agentic-QE directory" },
) {
  assertDirectorySnapshot(expected, { repositoryRoot, label });
  if (process.platform === "win32") return false;
  const descriptor = openSync(
    expected.path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isDirectory() ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino
    ) {
      throw new Error(`${label} changed while opening for fsync`);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  assertDirectorySnapshot(expected, { repositoryRoot, label });
  return true;
}
