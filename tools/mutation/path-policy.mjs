import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
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

export function portable(path) {
  return path.split("\\").join("/");
}

export function isInside(root, path, { allowRoot = false } = {}) {
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

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.isDirectory() === right.isDirectory() &&
    left.isFile() === right.isFile() &&
    left.isSymbolicLink() === right.isSymbolicLink()
  );
}

function sameFileState(left, right) {
  return (
    sameIdentity(left, right) &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function lexicalInside(root, path, { allowRoot = false } = {}) {
  const canonicalRoot = realpathSync(root);
  const lexical = resolve(path);
  if (!isInside(canonicalRoot, lexical, { allowRoot })) {
    throw new Error(`path escapes protected root: ${path}`);
  }
  return { canonicalRoot, lexical };
}

function directoryChain(root, directory) {
  const { canonicalRoot, lexical } = lexicalInside(root, directory, {
    allowRoot: true,
  });
  const chain = [];
  let cursor = canonicalRoot;
  for (const component of [
    "",
    ...relative(canonicalRoot, lexical).split(sep).filter(Boolean),
  ]) {
    if (component) cursor = join(cursor, component);
    const metadata = lstatSync(cursor);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`path contains a non-directory or symlink component: ${cursor}`);
    }
    if (!samePath(realpathSync(cursor), cursor)) {
      throw new Error(`directory component changed identity: ${cursor}`);
    }
    chain.push({ path: cursor, metadata });
  }
  return chain;
}

function existingDirectoryChain(root, directory) {
  const { canonicalRoot, lexical } = lexicalInside(root, directory, {
    allowRoot: true,
  });
  const chain = [];
  let cursor = canonicalRoot;
  const components = relative(canonicalRoot, lexical).split(sep).filter(Boolean);
  for (const component of ["", ...components]) {
    if (component) cursor = join(cursor, component);
    if (!existsSync(cursor)) break;
    const metadata = lstatSync(cursor);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      !samePath(realpathSync(cursor), cursor)
    ) {
      throw new Error(`path contains a non-directory or symlink component: ${cursor}`);
    }
    chain.push({ path: cursor, metadata });
  }
  return chain;
}

function assertDirectoryChain(chain) {
  for (const entry of chain) {
    const current = lstatSync(entry.path);
    if (
      current.isSymbolicLink() ||
      !current.isDirectory() ||
      !sameIdentity(entry.metadata, current) ||
      !samePath(realpathSync(entry.path), entry.path)
    ) {
      throw new Error(`directory identity changed: ${entry.path}`);
    }
  }
}

export function directoryIdentity(path) {
  const lexical = resolve(path);
  const metadata = lstatSync(lexical);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !samePath(realpathSync(lexical), lexical)
  ) {
    throw new Error(`unsafe directory identity: ${path}`);
  }
  return { path: lexical, metadata };
}

export function assertDirectoryIdentity(identity) {
  const current = lstatSync(identity.path);
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    !sameIdentity(identity.metadata, current) ||
    !samePath(realpathSync(identity.path), identity.path)
  ) {
    throw new Error(`directory identity changed: ${identity.path}`);
  }
}

export function ensureDirectoryInside(root, path) {
  const { canonicalRoot, lexical } = lexicalInside(root, path);
  const existing = existingDirectoryChain(canonicalRoot, lexical);
  assertDirectoryChain(existing);
  let cursor = existing.at(-1).path;
  const remaining = relative(cursor, lexical).split(sep).filter(Boolean);
  for (const component of remaining) {
    const parentIdentity = directoryIdentity(cursor);
    const next = join(cursor, component);
    try {
      mkdirSync(next, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    assertDirectoryIdentity(parentIdentity);
    directoryIdentity(next);
    syncDirectory(cursor);
    assertDirectoryIdentity(parentIdentity);
    cursor = next;
  }
  assertDirectoryChain(existing);
  directoryChain(canonicalRoot, lexical);
  return realpathSync(lexical);
}

export function createExclusiveDirectoryInside(root, path, { mode = 0o700 } = {}) {
  const { canonicalRoot, lexical } = lexicalInside(root, path);
  const parent = ensureDirectoryInside(canonicalRoot, dirname(lexical));
  const parentIdentity = directoryIdentity(parent);
  try {
    mkdirSync(lexical, { mode });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`refusing to reuse exclusive directory: ${lexical}`);
    }
    throw error;
  }
  assertDirectoryIdentity(parentIdentity);
  syncDirectory(parent);
  assertDirectoryIdentity(parentIdentity);
  const childIdentity = directoryIdentity(lexical);
  assertDirectoryIdentity(parentIdentity);
  assertDirectoryIdentity(childIdentity);
  return childIdentity.path;
}

export function regularFileInside(root, path) {
  const { canonicalRoot, lexical } = lexicalInside(root, path);
  const chain = directoryChain(canonicalRoot, dirname(lexical));
  const metadata = lstatSync(lexical);
  assertDirectoryChain(chain);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    !samePath(realpathSync(lexical), lexical)
  ) {
    throw new Error(`expected one regular non-symlink file: ${lexical}`);
  }
  return lexical;
}

export function readStableFileBytes(
  root,
  path,
  { expectedParentIdentity } = {},
) {
  const { canonicalRoot, lexical } = lexicalInside(root, path);
  const chain = directoryChain(canonicalRoot, dirname(lexical));
  if (expectedParentIdentity) assertDirectoryIdentity(expectedParentIdentity);
  const initial = lstatSync(lexical);
  if (initial.isSymbolicLink() || !initial.isFile() || initial.nlink !== 1) {
    throw new Error(`mutation evidence is not one regular file: ${path}`);
  }
  assertDirectoryChain(chain);
  const descriptor = openSync(
    lexical,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    assertDirectoryChain(chain);
    if (expectedParentIdentity) assertDirectoryIdentity(expectedParentIdentity);
    if (!opened.isFile() || opened.nlink !== 1 || !sameFileState(initial, opened)) {
      throw new Error(`mutation evidence changed while opening: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const current = lstatSync(lexical);
    assertDirectoryChain(chain);
    if (expectedParentIdentity) assertDirectoryIdentity(expectedParentIdentity);
    if (
      !sameFileState(opened, after) ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      !sameFileState(opened, current) ||
      bytes.length !== opened.size
    ) {
      throw new Error(`mutation evidence changed while reading: ${path}`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export function rejectSymlinksUnder(path) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`mutation output contains a symbolic link: ${path}`);
  }
  if (!metadata.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    rejectSymlinksUnder(join(path, entry.name));
  }
}

export function syncDirectory(path, { platform = process.platform } = {}) {
  if (platform === "win32") return false;
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return true;
}

function temporaryPath(parent, target) {
  return join(
    parent,
    `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`,
  );
}

function durableTemporary(parent, target, bytes, parentIdentity) {
  const temporary = temporaryPath(parent, target);
  let descriptor;
  try {
    assertDirectoryIdentity(parentIdentity);
    descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    assertDirectoryIdentity(parentIdentity);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertDirectoryIdentity(parentIdentity);
    return temporary;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) {
      assertDirectoryIdentity(parentIdentity);
      unlinkSync(temporary);
    }
    throw error;
  }
}

export function writeExclusiveDurableFile(path, bytes, root) {
  const { canonicalRoot, lexical } = lexicalInside(root, path);
  const parent = dirname(lexical);
  const parentIdentity = directoryIdentity(parent);
  directoryChain(canonicalRoot, parent);
  if (existsSync(lexical)) {
    throw new Error(`refusing to replace immutable mutation publication: ${path}`);
  }
  const temporary = durableTemporary(parent, lexical, bytes, parentIdentity);
  try {
    assertDirectoryIdentity(parentIdentity);
    linkSync(temporary, lexical);
    assertDirectoryIdentity(parentIdentity);
    unlinkSync(temporary);
    syncDirectory(parent);
    assertDirectoryIdentity(parentIdentity);
  } finally {
    if (existsSync(temporary)) {
      assertDirectoryIdentity(parentIdentity);
      unlinkSync(temporary);
    }
  }
}

export function writeJsonAtomic(path, value, root) {
  const { canonicalRoot, lexical } = lexicalInside(root, path);
  const parent = ensureDirectoryInside(canonicalRoot, dirname(lexical));
  const parentIdentity = directoryIdentity(parent);
  if (existsSync(lexical)) {
    const metadata = lstatSync(lexical);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.nlink !== 1
    ) {
      throw new Error(`refusing to replace non-regular receipt: ${lexical}`);
    }
  }
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporary = durableTemporary(parent, lexical, bytes, parentIdentity);
  try {
    assertDirectoryIdentity(parentIdentity);
    renameSync(temporary, lexical);
    assertDirectoryIdentity(parentIdentity);
    syncDirectory(parent);
    assertDirectoryIdentity(parentIdentity);
  } finally {
    if (existsSync(temporary)) {
      assertDirectoryIdentity(parentIdentity);
      unlinkSync(temporary);
    }
  }
}
