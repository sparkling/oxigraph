import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { harnessRoot } from "../paths.mjs";
import { ignoredByGit } from "./control-identity.mjs";
import { runtimeRoot } from "./root-policy.mjs";

export { runtimeRoot };

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

async function requirePrivateDirectory(path) {
  const metadata = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("engineering runtime must be a private owner-only directory");
  }
}

export async function ensureRuntimeRoot() {
  try {
    await mkdir(runtimeRoot, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await requirePrivateDirectory(runtimeRoot);
  const canonical = await realpath(runtimeRoot);
  if (!contained(harnessRoot, canonical) || !ignoredByGit(canonical)) {
    throw new Error("engineering runtime root is not inside its ignored policy path");
  }
  return canonical;
}

export async function runtimePath(name) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    basename(name) !== name ||
    name.includes("\u0000")
  ) {
    throw new Error("runtime artifact name must be a single safe path component");
  }
  const root = await ensureRuntimeRoot();
  const path = join(root, name);
  if (!ignoredByGit(path)) throw new Error("runtime artifact path is not ignored");
  return path;
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writePrivateRuntimeArtifact(name, bytes) {
  if (typeof bytes !== "string" && !Buffer.isBuffer(bytes)) {
    throw new Error("runtime artifact bytes must be a string or Buffer");
  }
  const path = await runtimePath(name);
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  if (!ignoredByGit(temporary)) throw new Error("runtime temporary path is not ignored");
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, path);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(`runtime artifact already exists: ${name}`);
      }
      throw error;
    }
    await unlink(temporary);
    await syncDirectory(parent);
    return path;
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

export async function readPrivateRuntimeArtifact(
  name,
  { maxBytes = 64 * 1024 * 1024 } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("runtime artifact read ceiling must be a positive safe integer");
  }
  const path = await runtimePath(name);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    const uid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    if (
      !metadata.isFile() ||
      metadata.uid !== uid ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maxBytes
    ) {
      throw new Error("runtime artifact is not a bounded private regular file");
    }
    const bytes = await handle.readFile();
    if (bytes.length !== metadata.size || bytes.length > maxBytes) {
      throw new Error("runtime artifact changed during its bounded read");
    }
    const after = await handle.stat();
    if (
      after.dev !== metadata.dev ||
      after.ino !== metadata.ino ||
      after.size !== metadata.size ||
      after.mtimeMs !== metadata.mtimeMs ||
      after.ctimeMs !== metadata.ctimeMs
    ) {
      throw new Error("runtime artifact changed during its bounded read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function isIgnoredRuntimePath(path) {
  const root = await ensureRuntimeRoot();
  let parent;
  try {
    parent = await realpath(dirname(path));
  } catch {
    return false;
  }
  return contained(root, parent) && ignoredByGit(path);
}
