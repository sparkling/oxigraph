import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  statfs,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { harnessRoot } from "../paths.mjs";
import { runtimeRoot } from "../runtime/root-policy.mjs";
import {
  G17_BENCHMARK_OWNER_BATCH_NAME,
  replayG17ControlReceipt,
} from "./control-receipt-contract.mjs";

export const G17_CONTROL_AUTHORIZATION_NAME = "control-authorization.json";
export const G17_CONTROL_RECEIPT_NAME = "receipt.json";
export const G17_CONTROL_ENVELOPE_SEAL_SCHEMA =
  "oxigraph.g1.7-control-envelope-seal/v1";
export const G17_CONTROL_ENVELOPE_REPLAY_SCHEMA =
  "oxigraph.g1.7-sealed-control-envelope-replay/v1";
export const g17ControlEnvelopesRoot = join(
  runtimeRoot,
  "g1.7",
  "control-envelopes",
);

const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const MAX_FILES = 128;
const MAX_FILE_BYTES = 67_108_864n;
const MAX_AGGREGATE_BYTES = 268_435_456n;
const MAX_AUTHORIZATION_BYTES = 131_072n;
const TMPFS_MAGIC = 0x0102_1994n;
const RAMFS_MAGIC = 0x8584_58f6n;
const EXPECTED_NAMES = Object.freeze([
  G17_CONTROL_AUTHORIZATION_NAME,
  G17_BENCHMARK_OWNER_BATCH_NAME,
  G17_CONTROL_RECEIPT_NAME,
]);
const FILE_STABLE_FIELDS = Object.freeze([
  "dev",
  "ino",
  "uid",
  "gid",
  "mode",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
]);
const DIRECTORY_STABLE_FIELDS = Object.freeze([...FILE_STABLE_FIELDS]);
const ROOT_IDENTITY_FIELDS = Object.freeze([
  "dev",
  "ino",
  "uid",
  "gid",
  "mode",
  "nlink",
]);
const ROOT_STABLE_ACROSS_CHILD_CREATE_FIELDS = Object.freeze([
  "dev",
  "ino",
  "uid",
  "gid",
  "mode",
]);

export const G17_CONTROL_ENVELOPE_LIMITS = Object.freeze({
  maxFiles: MAX_FILES,
  maxFileBytes: Number(MAX_FILE_BYTES),
  maxAggregateBytes: Number(MAX_AGGREGATE_BYTES),
  maxAuthorizationBytes: Number(MAX_AUTHORIZATION_BYTES),
  fileMode: 0o400,
  directoryMode: 0o500,
  rootMode: 0o700,
  files: EXPECTED_NAMES,
});

export const G17_CONTROL_ENVELOPE_SEAL_CHECKPOINTS = Object.freeze([
  "run-created",
  "authorization-created",
  "authorization-written",
  "authorization-synced",
  "authorization-sealed",
  "owner-batch-created",
  "owner-batch-written",
  "owner-batch-synced",
  "owner-batch-sealed",
  "artifacts-directory-synced",
  "before-receipt-create",
  "receipt-created",
  "receipt-written",
  "receipt-synced",
  "receipt-sealed",
  "receipt-directory-synced",
  "directory-sealed",
  "parent-synced",
]);

export const G17_CONTROL_ENVELOPE_REPLAY_CHECKPOINTS = Object.freeze([
  "directory-opened",
  "initial-inventory",
  "files-opened",
  "authorization-read",
  "owner-batch-read",
  "receipt-read",
  "candidate-replayed",
  "before-final-inventory",
]);

const AUTHORITY = Object.freeze({
  controlExecution: false,
  qualificationExecution: false,
  promotion: false,
  publication: false,
  routerQuality: false,
  providerExecution: false,
});

function fail(message, cause) {
  const error = new Error(`G1.7 control envelope: ${message}`);
  if (cause !== undefined) error.cause = cause;
  throw error;
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactOptions(value, required, optional, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    fail(`${label} contains symbol fields`);
  }
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    fail(`${label} fields are not exact`);
  }
  const snapshot = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable data field`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function safeRunId(value) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail("control run id is unsafe");
  }
  return value;
}

function snapshotBytes(value, label, maximum = MAX_FILE_BYTES) {
  if (!Buffer.isBuffer(value)) fail(`${label} must be a Buffer`);
  if (value.length < 1 || BigInt(value.length) > maximum) {
    fail(`${label} is outside its byte ceiling`);
  }
  return Buffer.from(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function currentUid() {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    fail("the physical envelope contract requires Linux owner identities");
  }
  return BigInt(process.getuid());
}

function requireLinuxFlags() {
  for (const name of ["O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK"]) {
    if (!Number.isInteger(constants[name])) {
      fail(`${name} is unavailable`);
    }
  }
}

async function classifyHeldFilesystem(handle, label) {
  const filesystem = await statfs(procFdPath(handle), { bigint: true }).catch(
    (error) => fail(`${label} held filesystem cannot be classified`, error),
  );
  if (
    typeof filesystem.type !== "bigint" ||
    filesystem.type === TMPFS_MAGIC ||
    filesystem.type === RAMFS_MAGIC
  ) {
    fail(`${label} must be on a classified non-tmpfs filesystem`);
  }
  return filesystem.type;
}

function requireFilesystemChain(
  metadata,
  filesystemType,
  expectedDevice,
  expectedFilesystemType,
  label,
) {
  requireBigintFields(metadata, ["dev"], label);
  if (
    metadata.dev !== expectedDevice ||
    filesystemType !== expectedFilesystemType
  ) {
    fail(`${label} crossed its held filesystem or device boundary`);
  }
}

function requireBigintFields(metadata, fields, label) {
  for (const field of fields) {
    if (typeof metadata?.[field] !== "bigint") {
      fail(`${label} lacks bigint ${field}`);
    }
  }
}

function mode(metadata) {
  return metadata.mode & 0o777n;
}

function requireDirectoryMetadata(metadata, expectedMode, label) {
  requireBigintFields(metadata, DIRECTORY_STABLE_FIELDS, label);
  if (
    !metadata.isDirectory() ||
    metadata.uid !== currentUid() ||
    mode(metadata) !== BigInt(expectedMode) ||
    metadata.nlink < 1n
  ) {
    fail(`${label} is not the exact owner directory`);
  }
}

function requireFileMetadata(metadata, maximumBytes, label) {
  requireBigintFields(metadata, FILE_STABLE_FIELDS, label);
  if (
    !metadata.isFile() ||
    metadata.uid !== currentUid() ||
    mode(metadata) !== 0o400n ||
    metadata.nlink !== 1n ||
    metadata.size < 1n ||
    metadata.size > maximumBytes
  ) {
    fail(`${label} is not an exact sealed regular file`);
  }
}

function requireNewFileMetadata(metadata, label) {
  requireBigintFields(metadata, FILE_STABLE_FIELDS, label);
  if (
    !metadata.isFile() ||
    metadata.uid !== currentUid() ||
    mode(metadata) !== 0o600n ||
    metadata.nlink !== 1n ||
    metadata.size !== 0n
  ) {
    fail(`${label} is not an exact new private regular file`);
  }
}

function requireSameMetadata(before, after, fields, label) {
  requireBigintFields(before, fields, `${label} before`);
  requireBigintFields(after, fields, `${label} after`);
  for (const field of fields) {
    if (before[field] !== after[field]) {
      fail(`${label} changed at ${field}`);
    }
  }
}

function requirePathObject(
  pathMetadata,
  heldMetadata,
  label,
  fields = ["dev", "ino", "uid", "gid", "mode", "nlink", "size"],
) {
  requireSameMetadata(heldMetadata, pathMetadata, fields, `${label} pathname`);
}

function fileMaximum(name) {
  return name === G17_CONTROL_AUTHORIZATION_NAME
    ? MAX_AUTHORIZATION_BYTES
    : MAX_FILE_BYTES;
}

export function validateG17ControlEnvelopeBudget(options) {
  const { fileSizes } = exactOptions(
    options,
    ["fileSizes"],
    [],
    "control envelope budget options",
  );
  if (
    !Array.isArray(fileSizes) ||
    Object.getPrototypeOf(fileSizes) !== Array.prototype
  ) {
    fail("control envelope file count is outside its ceiling");
  }
  const descriptors = Object.getOwnPropertyDescriptors(fileSizes);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = descriptors.length;
  if (
    keys.some((key) => typeof key !== "string") ||
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > MAX_FILES
  ) {
    fail("control envelope file count is outside its ceiling");
  }
  const length = lengthDescriptor.value;
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => !expectedKeys.has(key))
  ) {
    fail("control envelope file count is outside its ceiling");
  }
  const sizes = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      fail("control envelope file sizes must be dense data fields");
    }
    sizes.push(descriptor.value);
  }
  let aggregateBytes = 0n;
  for (const size of sizes) {
    if (typeof size !== "bigint" || size < 1n || size > MAX_FILE_BYTES) {
      fail("control envelope file size is outside its ceiling");
    }
    aggregateBytes += size;
    if (aggregateBytes > MAX_AGGREGATE_BYTES) {
      fail("control envelope aggregate bytes exceed their ceiling");
    }
  }
  return Object.freeze({
    files: length,
    aggregateBytes: aggregateBytes.toString(),
  });
}

function procFdPath(handle, name = undefined) {
  const base = `/proc/self/fd/${handle.fd}`;
  return name === undefined ? base : `${base}/${name}`;
}

async function checkpoint(observer, phase, context) {
  if (observer === undefined) return;
  await observer(Object.freeze({ phase, ...context }));
}

async function syncDirectoryPath(path) {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        constants.O_DIRECTORY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function ensureProductionRoot() {
  let parent = harnessRoot;
  for (const name of [".runtime", "g1.7", "control-envelopes"]) {
    const path = join(parent, name);
    try {
      await mkdir(path, { mode: 0o700 });
      await syncDirectoryPath(parent);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const named = await lstat(path, { bigint: true });
    requireDirectoryMetadata(named, 0o700, name);
    const canonical = await realpath(path);
    if (canonical !== path || !contained(parent, canonical)) {
      fail(`${name} escaped its fixed parent`);
    }
    parent = canonical;
  }
  if (parent !== g17ControlEnvelopesRoot || !contained(runtimeRoot, parent)) {
    fail("production envelope root escaped its fixed runtime policy path");
  }
  return parent;
}

async function resolveStorageRoot(configuredRoot, production) {
  const root = production
    ? await ensureProductionRoot()
    : resolve(configuredRoot);
  const named = await lstat(root, { bigint: true }).catch((error) =>
    fail("control envelope root is unavailable", error),
  );
  if (named.isSymbolicLink()) fail("control envelope root cannot be a symlink");
  requireDirectoryMetadata(named, 0o700, "control envelope root");
  const canonical = await realpath(root);
  if (canonical !== root) {
    fail("control envelope root contains a symlinked component");
  }
  return { canonical };
}

async function openDirectory(path, expectedMode, label) {
  let handle;
  try {
    const namedBefore = await lstat(path, { bigint: true });
    if (namedBefore.isSymbolicLink()) fail(`${label} cannot be a symlink`);
    handle = await open(
      path,
      constants.O_RDONLY |
        constants.O_DIRECTORY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
    const held = await handle.stat({ bigint: true });
    requireDirectoryMetadata(held, expectedMode, label);
    requirePathObject(namedBefore, held, label);
    const namedAfter = await lstat(path, { bigint: true });
    requirePathObject(namedAfter, held, label);
    return { handle, metadata: held };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.message?.startsWith("G1.7 control envelope:")) throw error;
    fail(`${label} cannot be opened safely`, error);
  }
}

async function exactInventory(directoryHandle, expected, label) {
  const entries = await readdir(procFdPath(directoryHandle), {
    withFileTypes: true,
  }).catch((error) => fail(`${label} cannot be enumerated`, error));
  if (entries.length > MAX_FILES || entries.some((entry) => !entry.isFile())) {
    fail(`${label} contains an invalid entry type or count`);
  }
  const names = entries.map((entry) => entry.name).sort();
  if (!isDeepStrictEqual(names, [...expected].sort())) {
    fail(`${label} inventory is not exact`);
  }
  return names;
}

async function writeExact(handle, bytes, label) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesWritten < 1) fail(`${label} write made no progress`);
    offset += bytesWritten;
  }
}

async function readExact(handle, size, label) {
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(`${label} size cannot be represented safely`);
  }
  const length = Number(size);
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      length - offset,
      offset,
    );
    if (bytesRead < 1) fail(`${label} ended before its declared size`);
    offset += bytesRead;
  }
  const probe = Buffer.allocUnsafe(1);
  const { bytesRead } = await handle.read(probe, 0, 1, length);
  if (bytesRead !== 0) fail(`${label} grew beyond its declared size`);
  return bytes;
}

async function writeSealedFile({
  directoryHandle,
  expectedDevice,
  expectedFilesystemType,
  runId,
  runPath,
  name,
  bytes,
  observer,
  phasePrefix,
}) {
  const path = procFdPath(directoryHandle, name);
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    const created = await handle.stat({ bigint: true });
    requireNewFileMetadata(created, `${name} created file`);
    const createdFilesystemType = await classifyHeldFilesystem(handle, name);
    requireFilesystemChain(
      created,
      createdFilesystemType,
      expectedDevice,
      expectedFilesystemType,
      name,
    );
    requirePathObject(await lstat(path, { bigint: true }), created, name);
    await checkpoint(observer, `${phasePrefix}-created`, {
      runId,
      runPath,
      name,
    });

    await writeExact(handle, bytes, name);
    await checkpoint(observer, `${phasePrefix}-written`, {
      runId,
      runPath,
      name,
    });
    await handle.sync();
    await checkpoint(observer, `${phasePrefix}-synced`, {
      runId,
      runPath,
      name,
    });

    const written = await handle.stat({ bigint: true });
    if (
      !written.isFile() ||
      written.uid !== currentUid() ||
      mode(written) !== 0o600n ||
      written.nlink !== 1n ||
      written.size !== BigInt(bytes.length)
    ) {
      fail(`${name} write metadata drifted`);
    }
    const readback = await readExact(handle, written.size, `${name} readback`);
    const afterRead = await handle.stat({ bigint: true });
    requireSameMetadata(
      written,
      afterRead,
      FILE_STABLE_FIELDS,
      `${name} readback`,
    );
    if (!readback.equals(bytes)) fail(`${name} readback bytes drifted`);

    await handle.chmod(0o400);
    await handle.sync();
    const sealed = await handle.stat({ bigint: true });
    requireFileMetadata(sealed, fileMaximum(name), `${name} sealed file`);
    const sealedFilesystemType = await classifyHeldFilesystem(handle, name);
    requireFilesystemChain(
      sealed,
      sealedFilesystemType,
      expectedDevice,
      expectedFilesystemType,
      name,
    );
    if (
      sealed.dev !== written.dev ||
      sealed.ino !== written.ino ||
      sealed.size !== written.size ||
      sealed.nlink !== written.nlink ||
      sealed.uid !== written.uid
    ) {
      fail(`${name} object identity drifted while sealing`);
    }
    requirePathObject(await lstat(path, { bigint: true }), sealed, name);
    await checkpoint(observer, `${phasePrefix}-sealed`, {
      runId,
      runPath,
      name,
    });
    return Object.freeze({
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  } catch (error) {
    if (error?.code === "EEXIST") fail(`sealed file already exists: ${name}`);
    if (error?.message?.startsWith("G1.7 control envelope:")) throw error;
    fail(`${name} cannot be written exclusively`, error);
  } finally {
    await handle?.close();
  }
}

function snapshotSealInput(options) {
  const { authorizationBytes, ownerBatchBytes, receiptBytes } = exactOptions(
    options,
    ["authorizationBytes", "ownerBatchBytes", "receiptBytes"],
    [],
    "control envelope seal options",
  );
  const authorization = snapshotBytes(
    authorizationBytes,
    "control authorization",
    MAX_AUTHORIZATION_BYTES,
  );
  const ownerBatch = snapshotBytes(ownerBatchBytes, "benchmark owner batch");
  const receipt = snapshotBytes(receiptBytes, "control receipt");
  validateG17ControlEnvelopeBudget({
    fileSizes: [
      BigInt(authorization.length),
      BigInt(ownerBatch.length),
      BigInt(receipt.length),
    ],
  });
  const candidateReplay = replayG17ControlReceipt({
    authorizationBytes: authorization,
    receiptBytes: receipt,
    artifactsByName: new Map([[G17_BENCHMARK_OWNER_BATCH_NAME, ownerBatch]]),
  });
  return {
    runId: safeRunId(candidateReplay.receipt.runId),
    authorization,
    ownerBatch,
    receipt,
  };
}

async function sealWithStorage(storage, options) {
  const input = snapshotSealInput(options);
  requireLinuxFlags();
  const root = await resolveStorageRoot(storage.root, storage.production);
  const rootOpened = await openDirectory(
    root.canonical,
    0o700,
    "control envelope root",
  );
  const namedRunPath = join(root.canonical, input.runId);
  let rootFilesystemType;
  let runHandle;
  try {
    rootFilesystemType = await classifyHeldFilesystem(
      rootOpened.handle,
      "control envelope root",
    );
    const anchoredRunPath = procFdPath(rootOpened.handle, input.runId);
    try {
      await mkdir(anchoredRunPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail(`control envelope already exists: ${input.runId}`);
      }
      throw error;
    }
    await rootOpened.handle.sync();
    const runCanonical = await realpath(anchoredRunPath);
    if (
      runCanonical !== namedRunPath ||
      !contained(root.canonical, runCanonical)
    ) {
      fail("new control envelope escaped its fixed root");
    }
    const opened = await openDirectory(
      anchoredRunPath,
      0o700,
      "new control envelope",
    );
    runHandle = opened.handle;
    const runFilesystemType = await classifyHeldFilesystem(
      runHandle,
      "new control envelope",
    );
    requireFilesystemChain(
      opened.metadata,
      runFilesystemType,
      rootOpened.metadata.dev,
      rootFilesystemType,
      "new control envelope",
    );
    await checkpoint(storage.observer, "run-created", {
      runId: input.runId,
      runPath: namedRunPath,
    });

    const authorization = await writeSealedFile({
      directoryHandle: runHandle,
      expectedDevice: opened.metadata.dev,
      expectedFilesystemType: runFilesystemType,
      runId: input.runId,
      runPath: namedRunPath,
      name: G17_CONTROL_AUTHORIZATION_NAME,
      bytes: input.authorization,
      observer: storage.observer,
      phasePrefix: "authorization",
    });
    const ownerBatch = await writeSealedFile({
      directoryHandle: runHandle,
      expectedDevice: opened.metadata.dev,
      expectedFilesystemType: runFilesystemType,
      runId: input.runId,
      runPath: namedRunPath,
      name: G17_BENCHMARK_OWNER_BATCH_NAME,
      bytes: input.ownerBatch,
      observer: storage.observer,
      phasePrefix: "owner-batch",
    });
    await exactInventory(
      runHandle,
      [G17_CONTROL_AUTHORIZATION_NAME, G17_BENCHMARK_OWNER_BATCH_NAME],
      "pre-receipt control envelope",
    );
    await runHandle.sync();
    await checkpoint(storage.observer, "artifacts-directory-synced", {
      runId: input.runId,
      runPath: namedRunPath,
    });
    await checkpoint(storage.observer, "before-receipt-create", {
      runId: input.runId,
      runPath: namedRunPath,
      name: G17_CONTROL_RECEIPT_NAME,
    });
    const receipt = await writeSealedFile({
      directoryHandle: runHandle,
      expectedDevice: opened.metadata.dev,
      expectedFilesystemType: runFilesystemType,
      runId: input.runId,
      runPath: namedRunPath,
      name: G17_CONTROL_RECEIPT_NAME,
      bytes: input.receipt,
      observer: storage.observer,
      phasePrefix: "receipt",
    });
    const entries = await exactInventory(
      runHandle,
      EXPECTED_NAMES,
      "complete control envelope",
    );
    await runHandle.sync();
    await checkpoint(storage.observer, "receipt-directory-synced", {
      runId: input.runId,
      runPath: namedRunPath,
    });
    await runHandle.chmod(0o500);
    await runHandle.sync();
    const sealedDirectory = await runHandle.stat({ bigint: true });
    requireDirectoryMetadata(sealedDirectory, 0o500, "sealed control envelope");
    const sealedFilesystemType = await classifyHeldFilesystem(
      runHandle,
      "sealed control envelope",
    );
    requireFilesystemChain(
      sealedDirectory,
      sealedFilesystemType,
      rootOpened.metadata.dev,
      rootFilesystemType,
      "sealed control envelope",
    );
    requirePathObject(
      await lstat(namedRunPath, { bigint: true }),
      sealedDirectory,
      "sealed control envelope",
    );
    await checkpoint(storage.observer, "directory-sealed", {
      runId: input.runId,
      runPath: namedRunPath,
    });
    await rootOpened.handle.sync();
    await checkpoint(storage.observer, "parent-synced", {
      runId: input.runId,
      runPath: namedRunPath,
    });
    const rootAfter = await rootOpened.handle.stat({ bigint: true });
    requireSameMetadata(
      rootOpened.metadata,
      rootAfter,
      ROOT_STABLE_ACROSS_CHILD_CREATE_FIELDS,
      "control envelope root",
    );
    const rootFilesystemTypeAfter = await classifyHeldFilesystem(
      rootOpened.handle,
      "control envelope root",
    );
    requireFilesystemChain(
      rootAfter,
      rootFilesystemTypeAfter,
      rootOpened.metadata.dev,
      rootFilesystemType,
      "control envelope root",
    );
    const postSealReplay = await replayWithStorage(
      Object.freeze({ ...storage, observer: undefined }),
      { controlRunId: input.runId },
    );
    const inventory = [authorization, ownerBatch, receipt];
    if (!isDeepStrictEqual(postSealReplay.storage.inventory, inventory)) {
      fail("post-seal exact replay inventory differs from the sealed inputs");
    }
    return deepFreeze({
      schema: G17_CONTROL_ENVELOPE_SEAL_SCHEMA,
      status: "SEALED",
      runId: input.runId,
      inventory,
      entries,
      prospectiveFinalDecisionBinding: null,
      authority: { ...AUTHORITY },
      claims: {
        receiptLastOwnerSequence: true,
        orderedFileAndDirectoryFsyncCallsReturned: true,
        postSealExactReplayComplete: true,
        crashDurability: false,
        powerLossDurability: false,
        filesystemFlushDurability: false,
        sameUidTamperResistance: false,
      },
    });
  } catch (error) {
    if (error?.message?.startsWith("G1.7 control envelope:")) throw error;
    fail(
      `control envelope sealing failed: ${error?.message ?? String(error)}`,
      error,
    );
  } finally {
    try {
      await runHandle?.close();
    } finally {
      await rootOpened.handle.close();
    }
  }
}

async function openSealedFiles(
  directoryHandle,
  expectedDevice,
  expectedFilesystemType,
) {
  const files = [];
  try {
    for (const name of EXPECTED_NAMES) {
      const path = procFdPath(directoryHandle, name);
      let handle;
      try {
        handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const before = await handle.stat({ bigint: true });
        requireFileMetadata(before, fileMaximum(name), name);
        const filesystemType = await classifyHeldFilesystem(handle, name);
        requireFilesystemChain(
          before,
          filesystemType,
          expectedDevice,
          expectedFilesystemType,
          name,
        );
        requirePathObject(await lstat(path, { bigint: true }), before, name);
        files.push({ name, path, handle, before, filesystemType });
      } catch (error) {
        await handle?.close().catch(() => {});
        throw error;
      }
    }
    validateG17ControlEnvelopeBudget({
      fileSizes: files.map(({ before }) => before.size),
    });
    return files;
  } catch (error) {
    await Promise.all(
      files.map(({ handle }) => handle.close().catch(() => {})),
    );
    if (error?.message?.startsWith("G1.7 control envelope:")) throw error;
    fail("sealed control files cannot be opened safely", error);
  }
}

function prospectiveBinding(candidateReplay) {
  if (
    candidateReplay.outcome !== "CONTROL_SEALED_PASS" ||
    candidateReplay.negativeControlSignature === null
  ) {
    return null;
  }
  const receipt = candidateReplay.receipt;
  return deepFreeze({
    schema: receipt.schema,
    status: receipt.status,
    runId: receipt.runId,
    rawSha256: candidateReplay.receiptRawSha256,
    receiptSha256: receipt.receiptSha256,
    authorizationRawSha256: receipt.authorization.rawSha256,
    authorizationContentHash: receipt.authorization.contentHash,
    negativeControlSignatureContentHash:
      candidateReplay.negativeControlSignature.contentHash,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    environmentClass: receipt.environmentClass,
  });
}

async function replayWithStorage(storage, options) {
  const { controlRunId } = exactOptions(
    options,
    ["controlRunId"],
    [],
    "sealed control envelope replay options",
  );
  const runId = safeRunId(controlRunId);
  requireLinuxFlags();
  const root = await resolveStorageRoot(storage.root, storage.production);
  const rootOpened = await openDirectory(
    root.canonical,
    0o700,
    "control envelope root",
  );
  const rootBefore = rootOpened.metadata;
  const namedRunPath = join(root.canonical, runId);
  const anchoredRunPath = procFdPath(rootOpened.handle, runId);
  let rootFilesystemType;
  let runHandle;
  let files = [];
  try {
    rootFilesystemType = await classifyHeldFilesystem(
      rootOpened.handle,
      "control envelope root",
    );
    const runOpened = await openDirectory(
      anchoredRunPath,
      0o500,
      "sealed control envelope",
    );
    runHandle = runOpened.handle;
    const directoryBefore = runOpened.metadata;
    const runFilesystemType = await classifyHeldFilesystem(
      runHandle,
      "sealed control envelope",
    );
    requireFilesystemChain(
      directoryBefore,
      runFilesystemType,
      rootBefore.dev,
      rootFilesystemType,
      "sealed control envelope",
    );
    requirePathObject(
      await lstat(namedRunPath, { bigint: true }),
      directoryBefore,
      "sealed control envelope",
    );
    const runCanonical = await realpath(anchoredRunPath);
    if (
      runCanonical !== namedRunPath ||
      !contained(root.canonical, runCanonical)
    ) {
      fail("sealed control envelope escaped its fixed root");
    }
    await checkpoint(storage.observer, "directory-opened", {
      runId,
      runPath: namedRunPath,
    });
    const initialInventory = await exactInventory(
      runHandle,
      EXPECTED_NAMES,
      "sealed control envelope",
    );
    await checkpoint(storage.observer, "initial-inventory", {
      runId,
      runPath: namedRunPath,
    });
    files = await openSealedFiles(
      runHandle,
      directoryBefore.dev,
      runFilesystemType,
    );
    await checkpoint(storage.observer, "files-opened", {
      runId,
      runPath: namedRunPath,
    });

    const bytesByName = new Map();
    for (const file of files) {
      const bytes = await readExact(file.handle, file.before.size, file.name);
      await checkpoint(
        storage.observer,
        file.name === G17_CONTROL_AUTHORIZATION_NAME
          ? "authorization-read"
          : file.name === G17_BENCHMARK_OWNER_BATCH_NAME
            ? "owner-batch-read"
            : "receipt-read",
        { runId, runPath: namedRunPath, name: file.name },
      );
      const after = await file.handle.stat({ bigint: true });
      requireSameMetadata(
        file.before,
        after,
        FILE_STABLE_FIELDS,
        `${file.name} stable read`,
      );
      requirePathObject(
        await lstat(file.path, { bigint: true }),
        after,
        file.name,
      );
      bytesByName.set(file.name, bytes);
    }

    const candidateReplay = replayG17ControlReceipt({
      authorizationBytes: bytesByName.get(G17_CONTROL_AUTHORIZATION_NAME),
      receiptBytes: bytesByName.get(G17_CONTROL_RECEIPT_NAME),
      artifactsByName: new Map([
        [
          G17_BENCHMARK_OWNER_BATCH_NAME,
          bytesByName.get(G17_BENCHMARK_OWNER_BATCH_NAME),
        ],
      ]),
    });
    if (candidateReplay.receipt.runId !== runId) {
      fail("sealed control envelope directory and receipt run ids differ");
    }
    await checkpoint(storage.observer, "candidate-replayed", {
      runId,
      runPath: namedRunPath,
    });

    for (const file of files) {
      const finalMetadata = await file.handle.stat({ bigint: true });
      const finalFilesystemType = await classifyHeldFilesystem(
        file.handle,
        file.name,
      );
      requireFilesystemChain(
        finalMetadata,
        finalFilesystemType,
        directoryBefore.dev,
        runFilesystemType,
        file.name,
      );
      if (finalFilesystemType !== file.filesystemType) {
        fail(`${file.name} held filesystem changed during replay`);
      }
      requireSameMetadata(
        file.before,
        finalMetadata,
        FILE_STABLE_FIELDS,
        `${file.name} post-replay`,
      );
      requirePathObject(
        await lstat(file.path, { bigint: true }),
        finalMetadata,
        file.name,
      );
    }
    await checkpoint(storage.observer, "before-final-inventory", {
      runId,
      runPath: namedRunPath,
    });
    const finalInventory = await exactInventory(
      runHandle,
      EXPECTED_NAMES,
      "sealed control envelope final",
    );
    if (!isDeepStrictEqual(initialInventory, finalInventory)) {
      fail("sealed control envelope inventory changed during replay");
    }
    const directoryAfter = await runHandle.stat({ bigint: true });
    const runFilesystemTypeAfter = await classifyHeldFilesystem(
      runHandle,
      "sealed control envelope",
    );
    requireFilesystemChain(
      directoryAfter,
      runFilesystemTypeAfter,
      rootBefore.dev,
      rootFilesystemType,
      "sealed control envelope",
    );
    requireSameMetadata(
      directoryBefore,
      directoryAfter,
      DIRECTORY_STABLE_FIELDS,
      "sealed control envelope directory",
    );
    requirePathObject(
      await lstat(namedRunPath, { bigint: true }),
      directoryAfter,
      "sealed control envelope",
    );
    const rootAfter = await rootOpened.handle.stat({ bigint: true });
    const rootFilesystemTypeAfter = await classifyHeldFilesystem(
      rootOpened.handle,
      "control envelope root",
    );
    requireFilesystemChain(
      rootAfter,
      rootFilesystemTypeAfter,
      rootBefore.dev,
      rootFilesystemType,
      "control envelope root",
    );
    requireSameMetadata(
      rootBefore,
      rootAfter,
      ROOT_IDENTITY_FIELDS,
      "control envelope root",
    );
    requirePathObject(
      await lstat(root.canonical, { bigint: true }),
      rootAfter,
      "control envelope root",
      ROOT_IDENTITY_FIELDS,
    );

    const binding = prospectiveBinding(candidateReplay);
    const inventory = EXPECTED_NAMES.map((name) => {
      const bytes = bytesByName.get(name);
      return Object.freeze({
        name,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    });
    return deepFreeze({
      schema: G17_CONTROL_ENVELOPE_REPLAY_SCHEMA,
      status: "SEALED_ARCHIVE_REPLAYED",
      outcome: candidateReplay.outcome,
      sealedArchiveReplayComplete: true,
      receiptCandidateReplayComplete:
        candidateReplay.receiptCandidateReplayComplete,
      finalDecisionBindingAvailable: binding !== null,
      prospectiveFinalDecisionBinding: binding,
      candidateReplay,
      storage: {
        runId,
        inventory,
        entries: finalInventory,
        filesystemType: rootFilesystemType.toString(),
        directoryMode: "0500",
        fileMode: "0400",
        currentStateStable: true,
        nonTmpfs: true,
        historicalReceiptLastProvenByReplay: false,
        sameUidTamperResistance: false,
        crashDurability: false,
        powerLossDurability: false,
        filesystemFlushDurability: false,
      },
      authority: { ...AUTHORITY },
    });
  } catch (error) {
    if (error?.message?.startsWith("G1.7 control envelope:")) throw error;
    fail(
      `sealed control envelope replay failed: ${error?.message ?? String(error)}`,
      error,
    );
  } finally {
    await Promise.allSettled(
      files.map(({ handle }) => handle.close().catch(() => {})),
    );
    try {
      await runHandle?.close();
    } finally {
      await rootOpened.handle.close();
    }
  }
}

function createStorage({ root, production, observer }) {
  const storage = Object.freeze({ root, production, observer });
  return Object.freeze({
    ...storage,
    seal: (options) => sealWithStorage(storage, options),
    replay: (options) => replayWithStorage(storage, options),
  });
}

export function createG17ControlEnvelopeOwnerForTesting(options) {
  const { envelopesRoot, onCheckpoint } = exactOptions(
    options,
    ["envelopesRoot"],
    ["onCheckpoint"],
    "control envelope test owner options",
  );
  if (typeof envelopesRoot !== "string" || envelopesRoot.length === 0) {
    fail("test control envelope root must be a path string");
  }
  if (onCheckpoint !== undefined && typeof onCheckpoint !== "function") {
    fail("control envelope checkpoint observer must be a function");
  }
  return createStorage({
    root: resolve(envelopesRoot),
    production: false,
    observer: onCheckpoint,
  });
}

const productionStorage = createStorage({
  root: g17ControlEnvelopesRoot,
  production: true,
  observer: undefined,
});

export function sealG17ControlEnvelope(options) {
  return productionStorage.seal(options);
}

export function replaySealedG17ControlEnvelope(options) {
  return productionStorage.replay(options);
}
