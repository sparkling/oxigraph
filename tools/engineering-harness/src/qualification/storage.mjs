import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { comparePortablePaths } from "../../../metaharness/policy-contract.mjs";
import { ignoredByGit } from "../runtime/control-identity.mjs";
import {
  ensureRuntimeRoot,
  runtimeRoot,
} from "../runtime/storage.mjs";

const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const SAFE_ARTIFACT = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const MAX_RUN_FILES = 64;
const MAX_RUN_BYTES = 64 * 1024 * 1024;

export const g17RunsRoot = join(runtimeRoot, "g1.7", "runs");

function fail(message) {
  throw new Error(`G1.7 run storage: ${message}`);
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function safeRunId(value) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("unsafe run id");
  return value;
}

function safeArtifactName(value) {
  if (
    typeof value !== "string" ||
    !SAFE_ARTIFACT.test(value) ||
    basename(value) !== value ||
    value === "receipt.json"
  ) {
    fail("safe artifact name is required");
  }
  return value;
}

function ownerUid(metadata) {
  return typeof process.getuid === "function" ? process.getuid() : metadata.uid;
}

async function requireDirectory(path, mode, label) {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== ownerUid(metadata) ||
    (metadata.mode & 0o777) !== mode
  ) {
    fail(`${label} must be an owner-only non-symlink directory`);
  }
  return metadata;
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureChildDirectory(parent, name) {
  const path = join(parent, name);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await requireDirectory(path, 0o700, name);
  const canonical = await realpath(path);
  if (!contained(parent, canonical)) fail(`${name} directory escaped its parent`);
  return canonical;
}

async function ensureRunsRoot(runsRoot) {
  if (runsRoot === g17RunsRoot) {
    const root = await ensureRuntimeRoot();
    const qualification = await ensureChildDirectory(root, "g1.7");
    const runs = await ensureChildDirectory(qualification, "runs");
    if (!ignoredByGit(runs) || !contained(root, runs)) {
      fail("production run root is not contained in the ignored runtime");
    }
    return runs;
  }
  const canonical = await realpath(runsRoot);
  await requireDirectory(canonical, 0o700, "injected run root");
  return canonical;
}

async function writePrivateFile(runPath, name, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_RUN_BYTES) {
    fail("artifact bytes must be a non-empty bounded Buffer");
  }
  const path = join(runPath, name);
  let handle;
  let created = false;
  try {
    handle = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    await handle.writeFile(bytes);
    await handle.sync();
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== ownerUid(metadata) ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.nlink !== 1 ||
      metadata.size !== bytes.length
    ) {
      fail("written artifact is not a private regular file");
    }
    await handle.close();
    handle = undefined;
    await syncDirectory(runPath);
    return path;
  } catch (error) {
    if (error.code === "EEXIST") fail(`artifact already exists: ${name}`);
    if (created) {
      try {
        await handle?.close();
        handle = undefined;
        await unlink(path);
      } catch {
        // The original write failure remains authoritative.
      }
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function createG17Run({ runId, runsRoot = g17RunsRoot }) {
  const safeId = safeRunId(runId);
  const root = await ensureRunsRoot(runsRoot);
  const path = join(root, safeId);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") fail(`run already exists: ${safeId}`);
    throw error;
  }
  await requireDirectory(path, 0o700, "new run");
  const canonical = await realpath(path);
  if (!contained(root, canonical)) fail("new run escaped its fixed root");
  await syncDirectory(root);
  let sealed = false;
  return Object.freeze({
    runId: safeId,
    path: canonical,
    async write(name, bytes) {
      if (sealed) fail("run is already sealed");
      return writePrivateFile(canonical, safeArtifactName(name), bytes);
    },
    async seal(receiptBytes) {
      if (sealed) fail("run is already sealed");
      await writePrivateFile(canonical, "receipt.json", receiptBytes);
      sealed = true;
      await chmod(canonical, 0o500);
      await requireDirectory(canonical, 0o500, "sealed run");
      await syncDirectory(root);
      return canonical;
    },
  });
}

async function readPrivateFile(path, { maxBytes = MAX_RUN_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RUN_BYTES) {
    fail("read ceiling is invalid");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.uid !== ownerUid(before) ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > maxBytes
    ) {
      fail("artifact is not a bounded private regular file");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.length !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      fail("artifact changed during its stable read");
    }
    return bytes;
  } catch (error) {
    if (error.message.startsWith("G1.7 run storage:")) throw error;
    fail(`artifact is not a bounded private regular file: ${error.message}`);
  } finally {
    await handle?.close();
  }
}

export async function openSealedG17Run({ runId, runsRoot = g17RunsRoot }) {
  const safeId = safeRunId(runId);
  const root = await ensureRunsRoot(runsRoot);
  const path = join(root, safeId);
  await requireDirectory(path, 0o500, "sealed run");
  const canonical = await realpath(path);
  if (!contained(root, canonical)) fail("sealed run escaped its fixed root");
  const directoryEntries = await readdir(canonical, { withFileTypes: true });
  if (
    directoryEntries.length < 2 ||
    directoryEntries.length > MAX_RUN_FILES ||
    directoryEntries.some((entry) => !entry.isFile())
  ) {
    fail("sealed run entries are invalid");
  }
  const entries = directoryEntries
    .map(({ name }) => name)
    .sort(comparePortablePaths);
  if (!entries.includes("receipt.json") || entries.some((name) => !SAFE_ARTIFACT.test(name))) {
    fail("sealed run entries are invalid");
  }
  return Object.freeze({
    runId: safeId,
    path: canonical,
    entries: Object.freeze(entries),
    async read(name, options) {
      if (!entries.includes(name) || basename(name) !== name) {
        fail("sealed artifact name is not in the run inventory");
      }
      return readPrivateFile(join(canonical, name), options);
    },
  });
}
