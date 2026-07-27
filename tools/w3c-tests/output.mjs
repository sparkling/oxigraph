import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function writeJsonAtomically(path, value, { root }) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const output = prepareOutput(root, path);
  if (existsSync(output.path) && !lstatSync(output.path).isFile()) {
    throw new Error("audit output destination is not a regular file");
  }
  const temporary = `${output.path}.tmp-${randomUUID()}`;
  let descriptor;
  let temporaryIdentity;
  try {
    assertOutputParent(output.parent, output.identity);
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    temporaryIdentity = fstatSync(descriptor, { bigint: true });
    assertTemporary(temporary, temporaryIdentity);
    assertOutputParent(output.parent, output.identity);
    let offset = 0;
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertTemporary(temporary, temporaryIdentity);
    assertOutputParent(output.parent, output.identity);
    renameSync(temporary, output.path);
    assertOutputParent(output.parent, output.identity);
    assertTemporary(output.path, temporaryIdentity);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    cleanupTemporary(temporary, temporaryIdentity, output);
  }
}

function prepareOutput(root, path) {
  if (
    typeof root !== "string" ||
    typeof path !== "string" ||
    !isAbsolute(root) ||
    !isAbsolute(path)
  ) {
    throw new Error("audit output root and path must be absolute");
  }
  const lexicalRoot = resolve(root);
  const child = relative(lexicalRoot, resolve(path));
  if (!inside(child)) throw new Error("audit output escapes repository");
  const canonicalRoot = realpathSync(lexicalRoot);
  const canonicalPath = resolve(canonicalRoot, child);
  const parent = dirname(canonicalPath);
  rejectSymlinkComponents(canonicalRoot, parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  rejectSymlinkComponents(canonicalRoot, parent);
  const identity = assertOutputParent(parent);
  return { identity, parent, path: canonicalPath };
}

function rejectSymlinkComponents(root, path) {
  let cursor = root;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`audit output contains a symbolic link: ${cursor}`);
    }
  }
}

function assertOutputParent(path, expected = undefined) {
  const metadata = lstatSync(path, { bigint: true });
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    realpathSync(path) !== path ||
    (expected &&
      (metadata.dev !== expected.dev || metadata.ino !== expected.ino))
  ) {
    throw new Error(
      "audit output directory changed or is not canonical and symlink-free",
    );
  }
  return { dev: metadata.dev, ino: metadata.ino };
}

function assertTemporary(path, identity) {
  const metadata = lstatSync(path, { bigint: true });
  if (
    !identity ||
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1n ||
    metadata.dev !== identity.dev ||
    metadata.ino !== identity.ino
  ) {
    throw new Error("audit output temporary changed during publication");
  }
}

function cleanupTemporary(path, identity, output) {
  try {
    assertOutputParent(output.parent, output.identity);
  } catch {
    return;
  }
  if (!existsSync(path)) return;
  const metadata = lstatSync(path, { bigint: true });
  if (
    identity &&
    !metadata.isSymbolicLink() &&
    metadata.isFile() &&
    metadata.nlink === 1n &&
    metadata.dev === identity.dev &&
    metadata.ino === identity.ino
  ) {
    unlinkSync(path);
  }
}

function inside(relativePath) {
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
