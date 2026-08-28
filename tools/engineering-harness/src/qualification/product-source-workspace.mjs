import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rmdir,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual, types as utilTypes } from "node:util";

import { comparePortablePaths } from "../../../metaharness/policy-contract.mjs";
import { GitProcessFault, runGit } from "../candidate/git.mjs";
import { harnessRoot, repositoryRoot } from "../paths.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { G17_BENCHMARK_BUILD_PLAN } from "./benchmark-execution-plan.mjs";
import { loadG17Contract } from "./contract.mjs";
import { validateG17ControlAuthorization } from "./control-protocol.mjs";
import {
  deleteG17NativePlatformTree,
  verifyG17NativePlatform,
} from "./native-platform.mjs";
import {
  deleteG17NativeNode,
  verifyG17NativeSnapshotHelper,
} from "./native-snapshot.mjs";
import { G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS } from "./native-workspace-contract.mjs";

export const G17_PRODUCT_SOURCE_WORKSPACE_SCHEMA =
  "oxigraph.g1.7-product-source-workspace/v1";
export const G17_PRODUCT_SOURCE_PROJECTION_SCHEMA =
  "oxigraph.g1.7-product-source-projection/v1";

// Containment non-claim: held descriptors, O_NOFOLLOW/openat2, and metadata
// bracketing fail closed against observed substitution, but this owner does not
// claim WORM semantics or resistance to a concurrently hostile same-UID process
// racing its paths or inherited descriptors. The outer build owner must provide
// process isolation and prove child termination/reap before finish or destroy.

const SOURCE_MANIFEST_SCHEMA = "oxigraph.g1.7-product-source-filesystem/v1";
const SOURCE_OBJECT_CLOSURE_SCHEMA =
  "oxigraph.g1.7-product-source-object-closure/v1";
const EXPECTED_CONTROL_PROTOCOL_SHA256 =
  "4f5978b873873094196d5d5998565b0acb0bf883beac1466b2fa91343b96c0f2";
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const MAXIMUM_PATCH_BYTES = 8 * 1024 * 1024;
const MAXIMUM_GIT_TREE_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_GIT_OBJECT_RECORDS = 500_000;
const MAXIMUM_CLEANUP_DEPTH = 128;
const MAXIMUM_CLEANUP_ENTRIES = 500_000;
const CLEANUP_TIMEOUT_MS = 120_000;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_HAS_OWN = Object.hasOwn;
const NATIVE_ABORT_CONTROLLER = AbortController;
const NATIVE_ABORT_SIGNAL_PROTOTYPE = AbortSignal.prototype;
const NATIVE_ABORT_TIMEOUT = AbortSignal.timeout.bind(AbortSignal);
const NATIVE_ABORTED_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  NATIVE_ABORT_SIGNAL_PROTOTYPE,
  "aborted",
).get;
const NATIVE_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const NATIVE_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const MAXIMUM_SOURCE_ENTRIES = 200_000;
const MAXIMUM_SOURCE_DIRECTORIES =
  MAXIMUM_CLEANUP_ENTRIES - MAXIMUM_SOURCE_ENTRIES - 1;
const MAXIMUM_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAXIMUM_GIT_IMPORT_BYTES =
  MAXIMUM_SOURCE_BYTES + 256 * 1024 * 1024;
const MAXIMUM_GIT_IMPORT_OBJECT_BYTES = MAXIMUM_SOURCE_FILE_BYTES;
const MAXIMUM_SNAPSHOT_ARRAY_LENGTH = 10_000;
const MAXIMUM_SNAPSHOT_FIELDS = 10_000;
const MAXIMUM_SNAPSHOT_NODES = 100_000;
const MAXIMUM_SNAPSHOT_DEPTH = 64;
const TMPFS_MAGIC = 0x01021994n;
const RAMFS_MAGIC = 0x858458f6n;
const liveWorkspaces = new WeakMap();
const liveGates = new WeakMap();
const liveBuildCapabilities = new WeakMap();
const liveTestBuildReapProofs = new WeakMap();
// Deliberately strong: unreaped descendants may still hold inherited FDs, so
// dropping the opaque gate must not let FileHandle GC erase the retained proof.
const preservedUnreapedWorkspaces = new Set();
const OPEN_DIRECTORY_FLAGS =
  constants.O_RDONLY |
  constants.O_DIRECTORY |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK;
const OPEN_FILE_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export class G17ProductSourceWorkspaceFault extends Error {
  constructor(classification, phase, reason, cause) {
    super(
      `G1.7 product source workspace ${phase}/${classification}: ${reason}`,
      {
        cause,
      },
    );
    this.name = "G17ProductSourceWorkspaceFault";
    this.classification = classification;
    this.phase = phase;
    this.reason = reason;
  }
}

function fault(classification, phase, reason, cause) {
  throw new G17ProductSourceWorkspaceFault(
    classification,
    phase,
    reason,
    cause,
  );
}

function workCheckpoint(signal, phase = "composition") {
  if (signal !== undefined && NATIVE_ABORTED_GETTER.call(signal)) {
    fault("FAIL", phase, "product source work was cancelled");
  }
}

function validateWorkSignal(value, label) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) {
    fault("FAIL", "preflight", `${label} is not a genuine native AbortSignal`);
  }
  let prototype;
  try {
    prototype = OBJECT_GET_PROTOTYPE_OF(value);
  } catch (error) {
    fault("FAIL", "preflight", `${label} cannot be inspected safely`, error);
  }
  if (prototype !== NATIVE_ABORT_SIGNAL_PROTOTYPE) {
    fault("FAIL", "preflight", `${label} is not a native AbortSignal`);
  }
  try {
    NATIVE_ABORTED_GETTER.call(value);
  } catch (error) {
    fault("FAIL", "preflight", `${label} failed its native brand check`, error);
  }
  return value;
}

function captureWorkSignalLease(value, label) {
  const validated = validateWorkSignal(value, label);
  if (validated === undefined) {
    return Object.freeze({ signal: undefined, release() {} });
  }
  const controller = new NATIVE_ABORT_CONTROLLER();
  const propagate = () => controller.abort();
  let registered = false;
  try {
    NATIVE_ADD_EVENT_LISTENER.call(validated, "abort", propagate, { once: true });
    registered = true;
    if (NATIVE_ABORTED_GETTER.call(validated)) controller.abort();
  } catch (error) {
    if (registered) {
      try {
        NATIVE_REMOVE_EVENT_LISTENER.call(validated, "abort", propagate);
      } catch {}
    }
    fault("FAIL", "preflight", `${label} cannot be captured natively`, error);
  }
  let source = validated;
  let released = false;
  return Object.freeze({
    // Downstream process admission accepts only a genuine native signal. The
    // caller never receives this private copy, and local observations use the
    // captured native getter above.
    signal: controller.signal,
    release() {
      if (released) return;
      released = true;
      const captured = source;
      source = undefined;
      if (captured === undefined) return;
      // Read on both sides of removal. An abort through the removal boundary
      // is reflected in the private signal; a later abort is outside the
      // acquisition cancellation lifetime.
      if (NATIVE_ABORTED_GETTER.call(captured)) controller.abort();
      NATIVE_REMOVE_EVENT_LISTENER.call(captured, "abort", propagate);
      if (NATIVE_ABORTED_GETTER.call(captured)) controller.abort();
    },
  });
}

function findUnreapedGitFault(error, seen = new Set()) {
  if (error === null || typeof error !== "object" || seen.has(error)) {
    return undefined;
  }
  seen.add(error);
  if (
    error instanceof GitProcessFault &&
    typeof error.disposition === "string" &&
    error.disposition.endsWith("-unreaped")
  ) {
    return error;
  }
  if (error instanceof AggregateError) {
    for (const child of error.errors) {
      const found = findUnreapedGitFault(child, seen);
      if (found !== undefined) return found;
    }
  }
  return findUnreapedGitFault(error.cause, seen);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function objectIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
  });
}

function projectionRootIdentity(node) {
  return Object.freeze({
    device: node.identity.device,
    inode: node.identity.inode,
    uid: node.owner.uid,
    gid: node.owner.gid,
    filesystemType: node.filesystem.type,
  });
}

function projectionChildIdentity(node) {
  return Object.freeze({
    leafName: node.name,
    device: node.identity.device,
    inode: node.identity.inode,
    uid: node.owner.uid,
    gid: node.owner.gid,
    filesystemType: node.filesystem.type,
    parentDevice: node.parentIdentity.device,
    parentInode: node.parentIdentity.inode,
  });
}

function stableMetadata(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    uid: metadata.uid.toString(),
    gid: metadata.gid.toString(),
    nlink: metadata.nlink.toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  });
}

function sameStableMetadata(left, right) {
  return isDeepStrictEqual(stableMetadata(left), stableMetadata(right));
}

function procPath(handle, ...parts) {
  return join(`/proc/self/fd/${handle.fd}`, ...parts);
}

function currentOwner() {
  return Object.freeze({
    uid: typeof process.getuid === "function" ? BigInt(process.getuid()) : null,
    gid: typeof process.getgid === "function" ? BigInt(process.getgid()) : null,
  });
}

function exactOwner(metadata, owner = currentOwner()) {
  return (
    (owner.uid === null || metadata.uid === owner.uid) &&
    (owner.gid === null || metadata.gid === owner.gid)
  );
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Buffer.isBuffer(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function captureOwnDataRecord(value, expected, label) {
  if (value === null || typeof value !== "object") {
    fault("FAIL", "preflight", `${label} must be a non-proxy record`);
  }
  if (utilTypes.isProxy(value) || Array.isArray(value)) {
    fault("FAIL", "preflight", `${label} must be a non-proxy record`);
  }
  let prototype;
  try {
    prototype = OBJECT_GET_PROTOTYPE_OF(value);
  } catch (error) {
    fault("FAIL", "preflight", `${label} prototype cannot be captured`, error);
  }
  if (![Object.prototype, null].includes(prototype)) {
    fault("FAIL", "preflight", `${label} has a foreign prototype`);
  }
  const expectedKeys = new Set(expected);
  const observed = new Set();
  // This is an exact authoritative projection, not an assertion that the
  // carrier has no inert baggage. Stream only enumerable string keys and stop
  // at the finite projection boundary; symbols and non-enumerable fields are
  // ignored without descriptor enumeration or observation.
  for (const key in value) {
    if (!OBJECT_HAS_OWN(value, key)) continue;
    if (!expectedKeys.has(key) || observed.size >= expected.length) {
      fault("FAIL", "preflight", `${label} has an unknown authoritative field`);
    }
    observed.add(key);
  }
  if (observed.size !== expected.length) {
    fault("FAIL", "preflight", `${label} authoritative fields are not exact`);
  }
  const captured = {};
  for (const key of expected) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (
      descriptor === undefined ||
      "get" in descriptor ||
      "set" in descriptor ||
      descriptor.enumerable !== true
    ) {
      fault("FAIL", "preflight", `${label}.${key} is not an own data field`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function snapshotInput(value, label, context, depth = 0) {
  // The only external entry is JSON parsed from decodeAuthorizationBytes after
  // its copied raw buffer has passed the 128 KiB (or tighter descriptor)
  // ceiling. Descriptor enumeration here is therefore byte-bounded and cannot
  // receive an arbitrary caller object.
  const snapshotContext =
    context ?? { ancestors: new WeakSet(), nodes: 0 };
  snapshotContext.nodes += 1;
  if (snapshotContext.nodes > MAXIMUM_SNAPSHOT_NODES) {
    fault("FAIL", "preflight", `${label} exceeds the snapshot node ceiling`);
  }
  if (depth > MAXIMUM_SNAPSHOT_DEPTH) {
    fault("FAIL", "preflight", `${label} exceeds the snapshot depth ceiling`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fault("FAIL", "preflight", `${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || Buffer.isBuffer(value)) {
    fault("FAIL", "preflight", `${label} contains unsupported data`);
  }
  if (utilTypes.isProxy(value)) {
    fault("FAIL", "preflight", `${label} contains a proxy`);
  }
  if (snapshotContext.ancestors.has(value))
    fault("FAIL", "preflight", `${label} contains a cycle`);
  const array = Array.isArray(value);
  if (
    OBJECT_GET_PROTOTYPE_OF(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fault("FAIL", "preflight", `${label} has a foreign prototype`);
  }
  snapshotContext.ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      fault("FAIL", "preflight", `${label} contains symbol fields`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ("get" in descriptor || "set" in descriptor) {
        fault("FAIL", "preflight", `${label} contains accessors`);
      }
      if (key !== "length" && descriptor.enumerable !== true) {
        fault("FAIL", "preflight", `${label} contains hidden fields`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAXIMUM_SNAPSHOT_ARRAY_LENGTH ||
        keys.length !== length + 1 ||
        descriptors.length?.enumerable !== false
      ) {
        fault("FAIL", "preflight", `${label} is not a dense field-free array`);
      }
      const output = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || descriptor.enumerable !== true) {
          fault("FAIL", "preflight", `${label} is not a dense field-free array`);
        }
        output[index] = snapshotInput(
          descriptor.value,
          `${label}[${index}]`,
          snapshotContext,
          depth + 1,
        );
      }
      return output;
    }
    if (keys.length > MAXIMUM_SNAPSHOT_FIELDS) {
      fault("FAIL", "preflight", `${label} exceeds the field ceiling`);
    }
    const output = {};
    for (const key of keys.sort()) {
      output[key] = snapshotInput(
        descriptors[key].value,
        `${label}.${key}`,
        snapshotContext,
        depth + 1,
      );
    }
    return output;
  } finally {
    snapshotContext.ancestors.delete(value);
  }
}

function safeRelativePath(path, label) {
  const components = typeof path === "string" ? path.split("/") : [];
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    Buffer.byteLength(path, "utf8") > 4_096 ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    components.length > MAXIMUM_CLEANUP_DEPTH ||
    components.some(
        (part) =>
          part.length === 0 ||
          part === "." ||
          part === ".." ||
          Buffer.byteLength(part, "utf8") > 255,
      )
  ) {
    fault("FAIL", "source", `${label} is not a safe portable path`);
  }
  return path;
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function boundedDelimitedRecords(
  output,
  { delimiter, maxBytes, maxRecords, label },
) {
  if (
    typeof output !== "string" ||
    Buffer.byteLength(output, "utf8") > maxBytes
  ) {
    fault("FAIL", "composition", `${label} exceeds its byte ceiling`);
  }
  if (output.length === 0) return [];
  if (!output.endsWith(delimiter)) {
    fault("FAIL", "composition", `${label} is not exactly framed`);
  }
  let records = 0;
  let offset = 0;
  while ((offset = output.indexOf(delimiter, offset)) !== -1) {
    records += 1;
    if (records > maxRecords) {
      fault("FAIL", "composition", `${label} exceeds its record ceiling`);
    }
    offset += delimiter.length;
  }
  const values = output.slice(0, -delimiter.length).split(delimiter);
  if (values.length !== records) {
    fault("FAIL", "composition", `${label} framing is inconsistent`);
  }
  return values;
}

function parseTree(output, prefix = "") {
  const records = boundedDelimitedRecords(output, {
    delimiter: "\0",
    maxBytes: MAXIMUM_GIT_TREE_OUTPUT_BYTES,
    maxRecords: MAXIMUM_SOURCE_ENTRIES,
    label: "Git source tree output",
  })
    .map((record) => {
      const match =
        /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40})\t(.+)$/u.exec(
          record,
        );
      if (match === null) {
        fault("FAIL", "source", "Git emitted an unsupported tree record");
      }
      const [, mode, type, object, rawPath] = match;
      const path = safeRelativePath(
        prefix.length === 0 ? rawPath : `${prefix}/${rawPath}`,
        "tree entry",
      );
      if (
        (mode === "160000" && type !== "commit") ||
        (mode !== "160000" && type !== "blob")
      ) {
        fault("FAIL", "source", `Git mode/type disagrees at ${path}`);
      }
      return Object.freeze({ mode, type, object, path });
    });
  records.sort((left, right) => comparePortablePaths(left.path, right.path));
  if (new Set(records.map(({ path }) => path)).size !== records.length) {
    fault("FAIL", "source", "Git tree contains duplicate portable paths");
  }
  return records;
}

function expectedDirectories(paths) {
  const directories = new Set([""]);
  for (const path of paths) {
    let current = dirname(path);
    while (current !== "." && current !== "") {
      directories.add(current);
      if (directories.size > MAXIMUM_SOURCE_DIRECTORIES) {
        fault(
          "FAIL",
          "source",
          "source snapshot exceeds its cleanup-safe directory ceiling",
        );
      }
      current = dirname(current);
    }
  }
  return directories;
}

async function verifyMaterializedTree(
  sourceNode,
  expectedEntries,
  { readOnly, signal },
) {
  workCheckpoint(signal, "source");
  if (
    !Array.isArray(expectedEntries) ||
    expectedEntries.length > MAXIMUM_SOURCE_ENTRIES
  ) {
    fault("FAIL", "source", "source snapshot exceeds its entry ceiling");
  }
  await requirePinnedDirectory(sourceNode, {
    phase: "source",
    mode: readOnly ? 0o555 : undefined,
  });
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]));
  const directories = expectedDirectories(expected.keys());
  const observed = [];
  let totalBytes = 0;

  async function walk(directoryHandle, prefix = "") {
    const directoryBefore = await directoryHandle.stat({ bigint: true });
    const entries = await readdir(procPath(directoryHandle), {
      withFileTypes: true,
    });
    entries.sort((left, right) => comparePortablePaths(left.name, right.name));
    for (const entry of entries) {
      workCheckpoint(signal, "source");
      const portablePath =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      safeRelativePath(portablePath, "materialized entry");
      const path = procPath(directoryHandle, entry.name);
      const namedBefore = await lstat(path, { bigint: true });
      if (namedBefore.isDirectory() && !namedBefore.isSymbolicLink()) {
        if (!directories.has(portablePath)) {
          fault(
            "FAIL",
            "source",
            `source contains extra directory: ${portablePath}`,
          );
        }
        const child = await open(path, OPEN_DIRECTORY_FLAGS).catch((error) =>
          fault(
            "FAIL",
            "source",
            `source directory cannot be pinned: ${portablePath}`,
            error,
          ),
        );
        try {
          const [heldBefore, namedAfterOpen] = await Promise.all([
            child.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
          if (
            !sameStableMetadata(namedBefore, heldBefore) ||
            !sameStableMetadata(namedBefore, namedAfterOpen) ||
            !exactOwner(heldBefore) ||
            heldBefore.nlink < 2n ||
            (readOnly && Number(heldBefore.mode & 0o7777n) !== 0o555)
          ) {
            fault(
              "FAIL",
              "source",
              `source directory metadata drifted: ${portablePath}`,
            );
          }
          await walk(child, portablePath);
          const [heldAfter, namedAfter] = await Promise.all([
            child.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
          if (
            !sameStableMetadata(heldBefore, heldAfter) ||
            !sameStableMetadata(heldBefore, namedAfter)
          ) {
            fault(
              "FAIL",
              "source",
              `source directory changed during traversal: ${portablePath}`,
            );
          }
        } finally {
          await child.close();
        }
        continue;
      }
      const expectedEntry = expected.get(portablePath);
      if (expectedEntry === undefined) {
        fault("FAIL", "source", `source contains extra entry: ${portablePath}`);
      }
      let bytes;
      let kind;
      let target;
      if (namedBefore.isSymbolicLink()) {
        if (
          expectedEntry.mode !== "120000" ||
          namedBefore.nlink !== 1n ||
          Number(namedBefore.mode & 0o7777n) !== 0o777
        ) {
          fault(
            "FAIL",
            "source",
            `unexpected source symlink: ${portablePath}`,
          );
        }
        target = await readlink(path);
        if (
          target.length === 0 ||
          target.includes("\0") ||
          isAbsolute(target) ||
          relative(dirname(portablePath), join(dirname(portablePath), target))
            .split(sep)
            .some((part) => part === "..")
        ) {
          fault("FAIL", "source", `escaping source symlink: ${portablePath}`);
        }
        const namedAfter = await lstat(path, { bigint: true });
        if (
          !sameStableMetadata(namedBefore, namedAfter) ||
          !exactOwner(namedAfter)
        ) {
          fault("FAIL", "source", `source symlink drifted: ${portablePath}`);
        }
        bytes = Buffer.from(target, "utf8");
        kind = "symlink";
      } else if (namedBefore.isFile()) {
        const handle = await open(path, OPEN_FILE_FLAGS).catch((error) =>
          fault(
            "FAIL",
            "source",
            `source file cannot be pinned: ${portablePath}`,
            error,
          ),
        );
        let heldBefore;
        let heldAfter;
        let namedAfter;
        try {
          heldBefore = await handle.stat({ bigint: true });
          if (
            !sameStableMetadata(namedBefore, heldBefore) ||
            !heldBefore.isFile() ||
            !exactOwner(heldBefore) ||
            heldBefore.nlink !== 1n ||
            heldBefore.size > BigInt(MAXIMUM_SOURCE_FILE_BYTES)
          ) {
            fault(
              "FAIL",
              "source",
              `source file metadata drifted: ${portablePath}`,
            );
          }
          bytes = await handle.readFile();
          [heldAfter, namedAfter] = await Promise.all([
            handle.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
        } finally {
          await handle.close();
        }
        if (
          !sameStableMetadata(heldBefore, heldAfter) ||
          !sameStableMetadata(heldBefore, namedAfter)
        ) {
          fault(
            "FAIL",
            "source",
            `source file changed while being read: ${portablePath}`,
          );
        }
        const observedMode =
          (heldBefore.mode & 0o111n) === 0n ? "100644" : "100755";
        const exactMode = expectedEntry.mode === "100755" ? 0o555 : 0o444;
        if (
          expectedEntry.mode !== observedMode ||
          (readOnly && Number(heldBefore.mode & 0o7777n) !== exactMode)
        ) {
          fault(
            "FAIL",
            "source",
            `source file metadata drifted: ${portablePath}`,
          );
        }
        kind = "file";
      } else {
        fault(
          "FAIL",
          "source",
          `source contains a special file: ${portablePath}`,
        );
      }
      if (gitBlobSha1(bytes) !== expectedEntry.object) {
        fault(
          "STALE",
          "source",
          `source blob differs from Git: ${portablePath}`,
        );
      }
      totalBytes += bytes.length;
      if (totalBytes > MAXIMUM_SOURCE_BYTES) {
        fault("FAIL", "source", "source snapshot exceeds its byte ceiling");
      }
      observed.push(
        Object.freeze({
          path: portablePath,
          mode: expectedEntry.mode,
          kind,
          bytes: bytes.length,
          gitBlob: expectedEntry.object,
          sha256: sha256(bytes),
          ...(kind === "symlink" ? { target } : {}),
        }),
      );
      expected.delete(portablePath);
      if (observed.length > MAXIMUM_SOURCE_ENTRIES) {
        fault("FAIL", "source", "source snapshot exceeds its entry ceiling");
      }
    }
    const directoryAfter = await directoryHandle.stat({ bigint: true });
    workCheckpoint(signal, "source");
    if (!sameStableMetadata(directoryBefore, directoryAfter)) {
      fault("FAIL", "source", "source directory changed during traversal");
    }
  }

  await walk(sourceNode.handle);
  if (expected.size !== 0) {
    fault(
      "STALE",
      "source",
      `source is missing Git entries: ${[...expected.keys()].slice(0, 5).join(", ")}`,
    );
  }
  observed.sort((left, right) => comparePortablePaths(left.path, right.path));
  const ownedEntryCount = observed.length + directories.size;
  if (ownedEntryCount > MAXIMUM_CLEANUP_ENTRIES) {
    fault("FAIL", "source", "source snapshot exceeds its cleanup ceiling");
  }
  return deepFreeze({
    entries: observed,
    entryCount: observed.length,
    ownedEntryCount,
    totalBytes,
    manifestSha256: canonicalSha256({
      schema: SOURCE_MANIFEST_SCHEMA,
      entries: observed,
    }),
  });
}

async function makeSourceReadOnly(sourceNode, expectedEntries, signal) {
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]));

  async function seal(directoryHandle, prefix = "") {
    const names = await readdir(procPath(directoryHandle));
    names.sort(comparePortablePaths);
    for (const name of names) {
      workCheckpoint(signal, "source");
      const portablePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      safeRelativePath(portablePath, "source seal entry");
      const path = procPath(directoryHandle, name);
      const namedBefore = await lstat(path, { bigint: true });
      if (namedBefore.isDirectory() && !namedBefore.isSymbolicLink()) {
        const child = await open(path, OPEN_DIRECTORY_FLAGS);
        try {
          const heldBefore = await child.stat({ bigint: true });
          if (
            !sameStableMetadata(namedBefore, heldBefore) ||
            !exactOwner(heldBefore) ||
            heldBefore.nlink < 2n
          ) {
            fault("FAIL", "source", `unsafe directory while sealing: ${portablePath}`);
          }
          await seal(child, portablePath);
          await child.chmod(0o555);
          const [heldAfter, namedAfter] = await Promise.all([
            child.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
          if (
            Number(heldAfter.mode & 0o7777n) !== 0o555 ||
            !sameStableMetadata(heldAfter, namedAfter) ||
            !isDeepStrictEqual(objectIdentity(heldBefore), objectIdentity(heldAfter))
          ) {
            fault("FAIL", "source", `directory seal drifted: ${portablePath}`);
          }
        } finally {
          await child.close();
        }
        continue;
      }
      const expectedEntry = expected.get(portablePath);
      if (expectedEntry === undefined) {
        fault("FAIL", "source", `unexpected seal entry: ${portablePath}`);
      }
      if (namedBefore.isSymbolicLink()) {
        if (
          expectedEntry.mode !== "120000" ||
          namedBefore.nlink !== 1n ||
          Number(namedBefore.mode & 0o7777n) !== 0o777
        ) {
          fault("FAIL", "source", `unsafe symlink while sealing: ${portablePath}`);
        }
        continue;
      }
      if (!namedBefore.isFile()) {
        fault("FAIL", "source", `special file while sealing: ${portablePath}`);
      }
      const handle = await open(path, OPEN_FILE_FLAGS);
      try {
        const heldBefore = await handle.stat({ bigint: true });
        if (
          !sameStableMetadata(namedBefore, heldBefore) ||
          !exactOwner(heldBefore) ||
          heldBefore.nlink !== 1n
        ) {
          fault("FAIL", "source", `unsafe file while sealing: ${portablePath}`);
        }
        await handle.chmod(expectedEntry.mode === "100755" ? 0o555 : 0o444);
        const [heldAfter, namedAfter] = await Promise.all([
          handle.stat({ bigint: true }),
          lstat(path, { bigint: true }),
        ]);
        if (
          !sameStableMetadata(heldAfter, namedAfter) ||
          !isDeepStrictEqual(objectIdentity(heldBefore), objectIdentity(heldAfter)) ||
          heldAfter.nlink !== 1n
        ) {
          fault("FAIL", "source", `file seal drifted: ${portablePath}`);
        }
      } finally {
        await handle.close();
      }
    }
  }

  await seal(sourceNode.handle);
  workCheckpoint(signal, "source");
  await sourceNode.handle.chmod(0o555);
  workCheckpoint(signal, "source");
}

async function cleanupGeneratedChildren(state) {
  const rootBefore = await state.rootNode.handle.stat({ bigint: true });
  if (
    !rootBefore.isDirectory() ||
    !isDeepStrictEqual(objectIdentity(rootBefore), state.rootNode.identity) ||
    !exactOwner(rootBefore) ||
    Number(rootBefore.mode & 0o7777n) !== 0o700
  ) {
    fault("FAIL", "cleanup", "held workspace root is not cleanup-safe");
  }
  const cleanupSignal = NATIVE_ABORT_TIMEOUT(CLEANUP_TIMEOUT_MS);
  const admitted = new Set(["source", "target", "control"]);
  const children = await readdir(procPath(state.rootNode.handle));
  const unexpected = children.filter((name) => !admitted.has(name));
  if (unexpected.length > 0) {
    fault(
      "FAIL",
      "cleanup",
      `workspace root contains unexpected cleanup entries: ${unexpected.join(", ")}`,
    );
  }
  for (const name of ["source", "target", "control"]) {
    const node = state.nodes?.[name];
    if (node === undefined) continue;
    if (node.handle === undefined) {
      if (!node.created) {
        if (children.includes(name)) {
          fault(
            "FAIL",
            "cleanup",
            `unowned workspace child cannot be cleaned: ${name}`,
          );
        }
        delete state.nodes[name];
        continue;
      }
      await pinCreatedChild(state.rootNode, node, "cleanup");
    }
    const request = {
      parentHandle: state.rootNode.handle,
      rootHandle: node.handle,
      targetName: name,
      maxEntries: MAXIMUM_CLEANUP_ENTRIES,
      maxDepth: MAXIMUM_CLEANUP_DEPTH,
      timeoutMs: CLEANUP_TIMEOUT_MS,
      signal: cleanupSignal,
    };
    if (state.cleanup.kind === "platform") {
      await deleteG17NativePlatformTree(state.cleanup.platform, request);
    } else {
      await deleteG17NativeNode({ helper: state.cleanup.helper, ...request });
    }
    await node.handle.close();
    delete state.nodes[name];
  }
  if ((await readdir(procPath(state.rootNode.handle))).length !== 0) {
    fault("FAIL", "cleanup", "workspace root is not empty after cleanup");
  }
  const rootAfter = await state.rootNode.handle.stat({ bigint: true });
  if (
    !rootAfter.isDirectory() ||
    !isDeepStrictEqual(objectIdentity(rootAfter), state.rootNode.identity) ||
    !exactOwner(rootAfter) ||
    Number(rootAfter.mode & 0o7777n) !== 0o700
  ) {
    fault("FAIL", "cleanup", "held workspace root changed during cleanup");
  }
}

async function gitText({
  args,
  context,
  home,
  environmentOverrides,
  stdin,
  maxOutputBytes = 64 * 1024 * 1024,
}) {
  const translate = (value) => {
    let output = value;
    for (const [parentPath, childPath] of context.pathBindings) {
      output = output.split(parentPath).join(childPath);
    }
    return output;
  };
  const output = await context.gitRunner({
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      ...args.map(translate),
    ],
    cwd: "/",
    home: translate(home),
    environmentOverrides: Object.fromEntries(
      Object.entries(environmentOverrides ?? {}).map(([key, value]) => [
        key,
        translate(value),
      ]),
    ),
    inheritedFileDescriptors: context.inheritedFileDescriptors,
    stdin,
    maxOutputBytes,
    timeoutMs: 300_000,
    signal: context.workSignal,
  });
  workCheckpoint(context.workSignal);
  return output;
}

async function createPrivateRepository(controlNode, context) {
  const controlDirectory = procPath(controlNode.handle);
  const gitHome = join(controlDirectory, "git-home");
  await mkdir(gitHome, { mode: 0o700 });
  const gitDirectory = join(controlDirectory, "composition.git");
  await gitText({
    args: ["init", "--bare", "--quiet", gitDirectory],
    context,
    home: gitHome,
  });
  await mkdir(join(gitDirectory, "info"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(gitDirectory, "info", "attributes"),
    [
      "* -text -crlf -ident -filter !eol !working-tree-encoding",
      "** -text -crlf -ident -filter !eol !working-tree-encoding",
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return Object.freeze({ gitDirectory, gitHome });
}

function treeObjectIds(output) {
  const ids = boundedDelimitedRecords(output, {
    delimiter: "\0",
    maxBytes: MAXIMUM_GIT_TREE_OUTPUT_BYTES,
    maxRecords: MAXIMUM_GIT_OBJECT_RECORDS,
    label: "Git object closure output",
  })
    .map((record) => {
      const match = /^(040000|100644|100755|120000|160000) (?:tree|blob|commit) ([0-9a-f]{40})\t/u.exec(
        record,
      );
      if (match === null) {
        fault("FAIL", "composition", "Git emitted an unsafe object closure record");
      }
      return match[1] === "160000" ? undefined : match[2];
    })
    .filter(Boolean);
  return ids;
}

async function inspectPrivateObjectClosure({
  context,
  gitDirectory,
  gitHome,
  alternateEnvironment,
  ordered,
}) {
  const maxOutputBytes = Math.max(1024 * 1024, ordered.length * 96);
  const output = await gitText({
    args: [
      `--git-dir=${gitDirectory}`,
      "cat-file",
      "--batch-check=%(objectname) %(objecttype) %(objectsize)",
    ],
    context,
    home: gitHome,
    environmentOverrides: alternateEnvironment,
    stdin: `${ordered.join("\n")}\n`,
    maxOutputBytes,
  });
  const records = boundedDelimitedRecords(output, {
    delimiter: "\n",
    maxBytes: maxOutputBytes,
    maxRecords: ordered.length,
    label: "Git private import admission output",
  });
  if (records.length !== ordered.length) {
    fault("FAIL", "composition", "Git private import admission is incomplete");
  }
  let bytes = 0n;
  const canonicalRecords = [];
  for (const [index, record] of records.entries()) {
    const match = /^([0-9a-f]{40}) (blob|tree|commit) (0|[1-9][0-9]*)$/u.exec(
      record,
    );
    if (
      match === null ||
      match[1] !== ordered[index] ||
      match[3].length > 20
    ) {
      fault("FAIL", "composition", "Git private import admission is malformed");
    }
    const size = BigInt(match[3]);
    if (size > BigInt(MAXIMUM_GIT_IMPORT_OBJECT_BYTES)) {
      fault(
        "FAIL",
        "composition",
        "Git private import object exceeds its byte ceiling",
      );
    }
    canonicalRecords.push(`${match[1]} ${match[2]} ${size.toString()}`);
    bytes += size;
    if (bytes > BigInt(MAXIMUM_GIT_IMPORT_BYTES)) {
      fault(
        "FAIL",
        "composition",
        "Git private import closure exceeds its byte ceiling",
      );
    }
  }
  return Object.freeze({
    objectCount: ordered.length,
    inflatedBytes: bytes,
    framingSha256: sha256(
      Buffer.from(`${canonicalRecords.join("\n")}\n`, "utf8"),
    ),
  });
}

async function enumeratePrivateObjectClosure({
  context,
  gitDirectory,
  gitHome,
  alternateEnvironment,
  roots,
  packName,
}) {
  const objectIds = new Set(roots);
  if (objectIds.size > MAXIMUM_GIT_OBJECT_RECORDS) {
    fault("FAIL", "composition", "Git object closure roots are unbounded");
  }
  for (const root of roots) {
    const tree = (
      await gitText({
        args: [`--git-dir=${gitDirectory}`, "rev-parse", `${root}^{tree}`],
        context,
        home: gitHome,
        environmentOverrides: alternateEnvironment,
      })
    ).trim();
    if (!GIT_OBJECT_PATTERN.test(tree)) {
      fault("FAIL", "composition", "Git closure root tree is malformed");
    }
    objectIds.add(tree);
    if (objectIds.size > MAXIMUM_GIT_OBJECT_RECORDS) {
      fault("FAIL", "composition", "Git object closure is unbounded");
    }
    const output = await gitText({
      args: [`--git-dir=${gitDirectory}`, "ls-tree", "-r", "-t", "-z", tree],
      context,
      home: gitHome,
      environmentOverrides: alternateEnvironment,
      maxOutputBytes: MAXIMUM_GIT_TREE_OUTPUT_BYTES,
    });
    for (const object of treeObjectIds(output)) {
      objectIds.add(object);
      if (objectIds.size > MAXIMUM_GIT_OBJECT_RECORDS) {
        fault("FAIL", "composition", "Git object closure is unbounded");
      }
    }
  }
  const ordered = [...objectIds].sort();
  const inspected = await inspectPrivateObjectClosure({
    context,
    gitDirectory,
    gitHome,
    alternateEnvironment,
    ordered,
  });
  return Object.freeze({
    context,
    gitDirectory,
    gitHome,
    alternateEnvironment: Object.freeze({ ...alternateEnvironment }),
    ordered: Object.freeze(ordered),
    packName,
    ...inspected,
  });
}

function derivedCompositionAdmission(paths) {
  const directories = new Set([""]);
  for (const { path } of paths) {
    safeRelativePath(path, "evaluator path");
    const components = path.split("/");
    components.pop();
    for (let length = 1; length <= components.length; length += 1) {
      directories.add(components.slice(0, length).join("/"));
    }
  }
  if (directories.size > MAXIMUM_GIT_OBJECT_RECORDS) {
    fault("FAIL", "composition", "derived tree object set is unbounded");
  }
  // Every post-image blob is already authenticated in the evaluator commit
  // closure. Only write-tree may create new bodies; reserve the entire bounded
  // recursive tree framing as a conservative inflated-byte allowance.
  return Object.freeze({
    objectCount: directories.size,
    inflatedBytes: BigInt(MAXIMUM_GIT_TREE_OUTPUT_BYTES),
  });
}

function admitPrivateObjectPlans(plans, derived) {
  let objects = derived.objectCount;
  let bytes = derived.inflatedBytes;
  const framing = [
    `derived-tree ${derived.objectCount} ${derived.inflatedBytes.toString()}`,
  ];
  for (const plan of plans) {
    objects += plan.objectCount;
    bytes += plan.inflatedBytes;
    framing.push(
      `${plan.packName} ${plan.objectCount} ${plan.inflatedBytes.toString()} ${plan.framingSha256}`,
    );
  }
  if (
    objects > MAXIMUM_GIT_OBJECT_RECORDS ||
    bytes > BigInt(MAXIMUM_GIT_IMPORT_BYTES)
  ) {
    fault(
      "FAIL",
      "composition",
      "aggregate private Git import admission exceeds its ceiling",
    );
  }
  return Object.freeze({
    objects,
    bytes,
    framingSha256: sha256(Buffer.from(`${framing.join("\n")}\n`, "utf8")),
  });
}

async function privateImportObjectClosure(plan) {
  const {
    context,
    gitDirectory,
    gitHome,
    alternateEnvironment,
    ordered,
    packName,
  } = plan;
  const prefix = join(gitDirectory, "objects", "pack", packName);
  const result = await gitText({
    args: [`--git-dir=${gitDirectory}`, "pack-objects", prefix],
    context,
    home: gitHome,
    environmentOverrides: alternateEnvironment,
    stdin: `${ordered.join("\n")}\n`,
    maxOutputBytes: 1024 * 1024,
  });
  if (!/^[0-9a-f]{40}\n$/u.test(result)) {
    fault("FAIL", "composition", "private Git pack import did not seal exactly");
  }
  const checked = await gitText({
    args: [
      `--git-dir=${gitDirectory}`,
      "cat-file",
      "--batch-check=%(objectname)",
    ],
    context,
    home: gitHome,
    stdin: `${ordered.join("\n")}\n`,
    maxOutputBytes: Math.max(1024 * 1024, ordered.length * 42),
  });
  const checkedObjects = boundedDelimitedRecords(checked, {
    delimiter: "\n",
    maxBytes: Math.max(1024 * 1024, ordered.length * 42),
    maxRecords: ordered.length,
    label: "Git private object check output",
  });
  if (!isDeepStrictEqual(checkedObjects, ordered)) {
    fault("FAIL", "composition", "private Git object closure is incomplete");
  }
  return Object.freeze({ objectCount: ordered.length, packSha1: result.trim() });
}

async function preflightSourceObjectCeilings({
  context,
  gitDirectory,
  gitHome,
  expectedEntries,
}) {
  if (expectedEntries.length > MAXIMUM_SOURCE_ENTRIES) {
    fault("FAIL", "source", "effective source exceeds its entry ceiling");
  }
  const objects = [...new Set(expectedEntries.map(({ object }) => object))].sort();
  if (objects.length > MAXIMUM_SOURCE_ENTRIES) {
    fault("FAIL", "source", "effective source object set is unbounded");
  }
  const maxOutputBytes = Math.max(1024 * 1024, objects.length * 96);
  const output = await gitText({
    args: [
      `--git-dir=${gitDirectory}`,
      "cat-file",
      "--batch-check=%(objectname) %(objecttype) %(objectsize)",
    ],
    context,
    home: gitHome,
    stdin: `${objects.join("\n")}\n`,
    maxOutputBytes,
  });
  const records = boundedDelimitedRecords(output, {
    delimiter: "\n",
    maxBytes: maxOutputBytes,
    maxRecords: objects.length,
    label: "Git source object size output",
  });
  if (records.length !== objects.length) {
    fault("FAIL", "source", "Git source object size output is incomplete");
  }
  const sizes = new Map();
  for (const [index, record] of records.entries()) {
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(record);
    if (
      match === null ||
      match[1] !== objects[index] ||
      match[2].length > 20
    ) {
      fault("FAIL", "source", "Git source object size output is malformed");
    }
    const size = BigInt(match[2]);
    if (size > BigInt(MAXIMUM_SOURCE_FILE_BYTES)) {
      fault("FAIL", "source", "effective source blob exceeds its byte ceiling");
    }
    sizes.set(match[1], size);
  }
  let totalBytes = 0n;
  for (const { object } of expectedEntries) {
    totalBytes += sizes.get(object);
    if (totalBytes > BigInt(MAXIMUM_SOURCE_BYTES)) {
      fault("FAIL", "source", "effective source exceeds its byte ceiling");
    }
  }
  return Object.freeze({
    uniqueObjects: objects.length,
    totalBytes: totalBytes.toString(),
  });
}

function decodeAuthorizationBytes(bytes, descriptor) {
  const maximumBytes = descriptor?.maxBytes ?? 128 * 1024;
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 2 ||
    bytes.length > maximumBytes
  ) {
    fault("FAIL", "preflight", "control authorization bytes are not bounded");
  }
  const ownedBytes = Buffer.from(bytes);
  if (ownedBytes.length !== bytes.length) {
    fault("FAIL", "preflight", "control authorization bytes are not bounded");
  }
  const text = ownedBytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(ownedBytes)) {
    fault("FAIL", "preflight", "control authorization is not exact UTF-8");
  }
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    fault("FAIL", "preflight", "control authorization is not JSON", error);
  }
  let authorization;
  try {
    authorization = validateG17ControlAuthorization(
      snapshotInput(decoded, "control authorization"),
    );
  } catch (error) {
    if (error instanceof G17ProductSourceWorkspaceFault) throw error;
    fault("FAIL", "preflight", "control authorization validation failed", error);
  }
  const canonicalBytes = Buffer.from(`${canonicalJson(authorization)}\n`, "utf8");
  const rawSha256 = sha256(ownedBytes);
  if (!canonicalBytes.equals(ownedBytes)) {
    fault(
      "FAIL",
      "preflight",
      "control authorization bytes are not canonical LF-framed bytes",
    );
  }
  if (
    descriptor !== undefined &&
    (rawSha256 !== descriptor.sha256 ||
      authorization.contentHash !== descriptor.contentHash ||
      authorization.schema !== descriptor.schema)
  ) {
    fault("FAIL", "preflight", "production authorization descriptor drifted");
  }
  if (
    authorization.status !== "CONTROL_AUTHORIZED" ||
    authorization.approval?.status !== "APPROVED" ||
    authorization.protocol.authorizationScope.negativeControlExecution !== true ||
    authorization.protocol.authorizationScope.aaNoiseControlExecution !== true ||
    authorization.protocol.authorizationScope.subjectQualificationExecution !== false ||
    authorization.protocol.authorizationScope
      .performanceReferenceQualificationExecution !== false ||
    canonicalSha256(authorization.protocol) !==
      EXPECTED_CONTROL_PROTOCOL_SHA256
  ) {
    fault(
      "FAIL",
      "preflight",
      "approved control authorization binding is invalid",
    );
  }
  return deepFreeze({
    authorization,
    authorizationBytes: ownedBytes,
    authorizationBinding: {
      rawSha256,
      contentHash: authorization.contentHash,
    },
  });
}

async function readStableAuthorization(path, descriptor) {
  const handle = await open(path, OPEN_FILE_FLAGS).catch((error) =>
    fault(
      "FAIL",
      "preflight",
      "production authorization cannot be opened without following links",
      error,
    ),
  );
  try {
    const [namedBefore, heldBefore] = await Promise.all([
      lstat(path, { bigint: true }),
      handle.stat({ bigint: true }),
    ]);
    if (
      !namedBefore.isFile() ||
      !sameStableMetadata(namedBefore, heldBefore) ||
      heldBefore.nlink !== 1n ||
      heldBefore.size < 2n ||
      heldBefore.size > BigInt(descriptor.maxBytes)
    ) {
      fault("FAIL", "preflight", "production authorization metadata is unsafe");
    }
    const bytes = await handle.readFile();
    const [namedAfter, heldAfter] = await Promise.all([
      lstat(path, { bigint: true }),
      handle.stat({ bigint: true }),
    ]);
    if (
      !sameStableMetadata(heldBefore, heldAfter) ||
      !sameStableMetadata(heldBefore, namedAfter)
    ) {
      fault("FAIL", "preflight", "production authorization changed while read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function authorizationPlan(input) {
  if (
    !SAFE_RUN_ID.test(input.controlRunId ?? "") ||
    typeof input.repoRoot !== "string" ||
    typeof input.workspaceRoot !== "string" ||
    !isAbsolute(input.repoRoot) ||
    !isAbsolute(input.workspaceRoot)
  ) {
    fault("FAIL", "preflight", "product source scalar input is invalid");
  }
  const authorization = input.authorization;
  const build = G17_BENCHMARK_BUILD_PLAN.find(
    ({ buildId }) => buildId === input.buildId,
  );
  if (build === undefined) {
    fault(
      "FAIL",
      "preflight",
      "build id is outside the frozen four-build plan",
    );
  }
  const product = authorization.protocol.products[build.productRole];
  const overlay = authorization.protocol.evaluatorOverlay;
  const composition = overlay.roleCompositions[build.productRole];
  return deepFreeze({
    authorization,
    authorizationBinding: input.authorizationBinding,
    controlRunId: input.controlRunId,
    buildId: build.buildId,
    productRole: build.productRole,
    product,
    evaluator: {
      commit: overlay.commit,
      parent: overlay.parent,
      tree: overlay.tree,
      patchSha256: overlay.patchSha256,
      paths: overlay.paths,
      composition,
    },
    repoRoot: input.repoRoot,
    workspaceRoot: input.workspaceRoot,
  });
}

function gateToken(state) {
  const gate = Object.freeze({
    schema: "oxigraph.g1.7-product-source-production-gate/v1",
  });
  liveGates.set(gate, state);
  return gate;
}

function gateTokenWithWorkSignalSource(inputSignal, label, state) {
  const workSignalSource = validateWorkSignal(inputSignal, `${label} signal`);
  return gateToken({
    ...state,
    workSignalSource,
  });
}

function releaseWorkSignalLeases(...states) {
  const leases = new Set();
  for (const state of states) {
    const lease = state?.workSignalLease;
    if (lease === undefined) continue;
    state.workSignalLease = undefined;
    leases.add(lease);
  }
  for (const lease of leases) lease.release();
}

function gateScalars(input, label) {
  if (
    !SAFE_RUN_ID.test(input.controlRunId ?? "") ||
    typeof input.workspaceRoot !== "string" ||
    !isAbsolute(input.workspaceRoot) ||
    !G17_BENCHMARK_BUILD_PLAN.some(({ buildId }) => buildId === input.buildId)
  ) {
    fault("FAIL", "preflight", `${label} scalar fields are invalid`);
  }
  return {
    controlRunId: input.controlRunId,
    buildId: input.buildId,
    workspaceRoot: input.workspaceRoot,
  };
}

export async function createG17ProductSourceProductionGate(input) {
  const captured = captureOwnDataRecord(
    input,
    ["platform", "workspaceRoot", "controlRunId", "buildId", "signal"],
    "production product source gate",
  );
  const scalars = gateScalars(captured, "production product source gate");
  const { contract } = loadG17Contract();
  const descriptor = contract.controlAuthorizationDecision;
  const authorizationPath = join(harnessRoot, descriptor.path);
  const authorization = decodeAuthorizationBytes(
    await readStableAuthorization(authorizationPath, descriptor),
    descriptor,
  );
  // This opaque platform check deliberately follows authorization validation:
  // a proposed artifact therefore fails before any workspace path is touched.
  await verifyG17NativePlatform(captured.platform);
  return gateTokenWithWorkSignalSource(captured.signal, "production product source gate", {
    ...scalars,
    ...authorization,
    repoRoot: repositoryRoot,
    cleanup: Object.freeze({ kind: "platform", platform: captured.platform }),
    gitRunner: runGit,
    afterChildMkdir: undefined,
    beforeReady: undefined,
    phase: "ready",
    production: true,
  });
}

/** Explicitly test-only authority injection for synthetic approval fixtures. */
export async function createG17ProductSourceGateForTesting(input) {
  const captured = captureOwnDataRecord(
    input,
    [
      "authorizationBytes",
      "cleanupHelper",
      "repoRoot",
      "workspaceRoot",
      "controlRunId",
      "buildId",
      "signal",
    ],
    "test-only product source gate",
  );
  const scalars = gateScalars(captured, "test-only product source gate");
  if (typeof captured.repoRoot !== "string" || !isAbsolute(captured.repoRoot)) {
    fault("FAIL", "preflight", "test-only repository root is invalid");
  }
  const authorization = decodeAuthorizationBytes(captured.authorizationBytes);
  await verifyG17NativeSnapshotHelper(captured.cleanupHelper);
  return gateTokenWithWorkSignalSource(captured.signal, "test-only product source gate", {
    ...scalars,
    ...authorization,
    repoRoot: captured.repoRoot,
    cleanup: Object.freeze({ kind: "helper", helper: captured.cleanupHelper }),
    gitRunner: runGit,
    afterChildMkdir: undefined,
    beforeReady: undefined,
    phase: "ready",
    production: false,
  });
}

/** Explicitly test-only fault and Git outcome injection. */
export async function createG17ProductSourceGateWithHooksForTesting(input) {
  const captured = captureOwnDataRecord(
    input,
    [
      "authorizationBytes",
      "cleanupHelper",
      "repoRoot",
      "workspaceRoot",
      "controlRunId",
      "buildId",
      "signal",
      "gitRunner",
      "afterChildMkdir",
      "beforeReady",
    ],
    "hooked test-only product source gate",
  );
  const scalars = gateScalars(captured, "hooked test-only product source gate");
  if (
    typeof captured.repoRoot !== "string" ||
    !isAbsolute(captured.repoRoot) ||
    typeof captured.gitRunner !== "function" ||
    utilTypes.isProxy(captured.gitRunner) ||
    (captured.afterChildMkdir !== undefined &&
      (typeof captured.afterChildMkdir !== "function" ||
        utilTypes.isProxy(captured.afterChildMkdir))) ||
    (captured.beforeReady !== undefined &&
      (typeof captured.beforeReady !== "function" ||
        utilTypes.isProxy(captured.beforeReady)))
  ) {
    fault("FAIL", "preflight", "hooked test-only authority is invalid");
  }
  const authorization = decodeAuthorizationBytes(captured.authorizationBytes);
  await verifyG17NativeSnapshotHelper(captured.cleanupHelper);
  return gateTokenWithWorkSignalSource(captured.signal, "hooked test-only product source gate", {
    ...scalars,
    ...authorization,
    repoRoot: captured.repoRoot,
    cleanup: Object.freeze({ kind: "helper", helper: captured.cleanupHelper }),
    gitRunner: captured.gitRunner,
    afterChildMkdir: captured.afterChildMkdir,
    beforeReady: captured.beforeReady,
    phase: "ready",
    production: false,
  });
}

async function rootState(root) {
  const handle = await open(root, OPEN_DIRECTORY_FLAGS);
  try {
    const [namedBefore, heldBefore, resolved, filesystemBefore] = await Promise.all([
      lstat(root, { bigint: true }),
      handle.stat({ bigint: true }),
      realpath(root),
      statfs(procPath(handle), { bigint: true }),
    ]);
    const expectedUid =
      typeof process.getuid === "function"
        ? BigInt(process.getuid())
        : namedBefore.uid;
    const expectedGid =
      typeof process.getgid === "function"
        ? BigInt(process.getgid())
        : namedBefore.gid;
    if (
      resolved !== root ||
      namedBefore.isSymbolicLink() ||
      !namedBefore.isDirectory() ||
      !heldBefore.isDirectory() ||
      !sameStableMetadata(namedBefore, heldBefore) ||
      Number(namedBefore.mode & 0o7777n) !== 0o700 ||
      namedBefore.uid !== expectedUid ||
      namedBefore.gid !== expectedGid ||
      namedBefore.nlink < 2n ||
      [TMPFS_MAGIC, RAMFS_MAGIC].includes(filesystemBefore.type)
    ) {
      fault(
        "FAIL",
        "workspace",
        "workspace root is not an exact owner-only non-tmpfs directory",
      );
    }
    const names = await readdir(procPath(handle));
    const [namedAfter, heldAfter, filesystemAfter] = await Promise.all([
      lstat(root, { bigint: true }),
      handle.stat({ bigint: true }),
      statfs(procPath(handle), { bigint: true }),
    ]);
    if (
      names.length !== 0 ||
      !sameStableMetadata(namedBefore, namedAfter) ||
      !sameStableMetadata(heldBefore, heldAfter) ||
      !sameStableMetadata(namedAfter, heldAfter) ||
      filesystemAfter.type !== filesystemBefore.type
    ) {
      fault("FAIL", "workspace", "workspace root is not empty");
    }
    return {
      handle,
      identity: objectIdentity(heldAfter),
      owner: { uid: heldAfter.uid.toString(), gid: heldAfter.gid.toString() },
      filesystem: {
        type: filesystemAfter.type.toString(),
        blockSize: filesystemAfter.bsize.toString(),
      },
      name: undefined,
      parentHandle: undefined,
      path: root,
      sealMetadata: undefined,
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function requirePinnedDirectory(node, { phase, mode, sealed = true }) {
  const namedPath =
    node.path ?? procPath(node.parentHandle, node.name);
  const [named, held, filesystem, resolved, parent] = await Promise.all([
    lstat(namedPath, { bigint: true }),
    node.handle.stat({ bigint: true }),
    statfs(procPath(node.handle), { bigint: true }),
    node.path === undefined ? undefined : realpath(node.path),
    node.parentHandle === undefined
      ? undefined
      : node.parentHandle.stat({ bigint: true }),
  ]).catch((error) =>
    fault("FAIL", phase, "pinned directory cannot be reverified", error),
  );
  if (
    (node.path !== undefined && resolved !== node.path) ||
    named.isSymbolicLink() ||
    !named.isDirectory() ||
    !held.isDirectory() ||
    !isDeepStrictEqual(objectIdentity(named), node.identity) ||
    !isDeepStrictEqual(objectIdentity(held), node.identity) ||
    named.uid.toString() !== node.owner.uid ||
    named.gid.toString() !== node.owner.gid ||
    named.dev !== held.dev ||
    filesystem.type.toString() !== node.filesystem.type ||
    (node.parentIdentity !== undefined &&
      (!isDeepStrictEqual(objectIdentity(parent), node.parentIdentity) ||
        parent.dev !== held.dev)) ||
    (mode !== undefined && Number(held.mode & 0o7777n) !== mode) ||
    (sealed &&
      node.sealMetadata !== undefined &&
      (!isDeepStrictEqual(stableMetadata(named), node.sealMetadata) ||
        !isDeepStrictEqual(stableMetadata(held), node.sealMetadata)))
  ) {
    fault("FAIL", phase, "pinned directory identity or metadata changed");
  }
  return held;
}

async function sealDirectoryIdentity(node) {
  const held = await requirePinnedDirectory(node, {
    phase: "workspace",
    sealed: false,
  });
  node.sealMetadata = stableMetadata(held);
}

async function pinCreatedChild(rootNode, node, phase) {
  const { name } = node;
  const path = procPath(rootNode.handle, name);
  const namedBefore = await lstat(path, { bigint: true });
  const handle = await open(path, OPEN_DIRECTORY_FLAGS).catch((error) =>
    fault("FAIL", phase, `workspace child cannot be pinned: ${name}`, error),
  );
  try {
    const [held, namedAfter, parentHeld, filesystem] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
      rootNode.handle.stat({ bigint: true }),
      statfs(procPath(handle), { bigint: true }),
    ]);
    if (
      !namedBefore.isDirectory() ||
      namedBefore.isSymbolicLink() ||
      !sameStableMetadata(namedBefore, held) ||
      !sameStableMetadata(namedBefore, namedAfter) ||
      !exactOwner(held) ||
      Number(held.mode & 0o7777n) !== 0o700 ||
      held.nlink < 2n ||
      !isDeepStrictEqual(objectIdentity(parentHeld), rootNode.identity) ||
      held.dev !== parentHeld.dev ||
      filesystem.type.toString() !== rootNode.filesystem.type
    ) {
      fault("FAIL", phase, `workspace child metadata is unsafe: ${name}`);
    }
    node.handle = handle;
    node.identity = objectIdentity(held);
    node.owner = { uid: held.uid.toString(), gid: held.gid.toString() };
    node.filesystem = {
      type: filesystem.type.toString(),
      blockSize: filesystem.bsize.toString(),
    };
    return node;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function createPinnedChild(
  rootNode,
  name,
  ownedNodes,
  afterChildMkdir,
) {
  const node = {
    handle: undefined,
    identity: undefined,
    owner: undefined,
    filesystem: undefined,
    parentHandle: rootNode.handle,
    parentIdentity: rootNode.identity,
    name,
    path: undefined,
    sealMetadata: undefined,
    created: false,
  };
  ownedNodes[name] = node;
  const path = procPath(rootNode.handle, name);
  await mkdir(path, { mode: 0o700 });
  node.created = true;
  await afterChildMkdir?.(name);
  return pinCreatedChild(rootNode, node, "workspace");
}

async function pinExistingDirectory(path, label) {
  const namedBefore = await lstat(path, { bigint: true });
  const handle = await open(path, OPEN_DIRECTORY_FLAGS).catch((error) =>
    fault("FAIL", "composition", `${label} cannot be pinned`, error),
  );
  try {
    const [held, namedAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      !namedBefore.isDirectory() ||
      namedBefore.isSymbolicLink() ||
      !sameStableMetadata(namedBefore, held) ||
      !sameStableMetadata(namedBefore, namedAfter) ||
      !exactOwner(held)
    ) {
      fault("FAIL", "composition", `${label} metadata is unsafe`);
    }
    return {
      handle,
      identity: objectIdentity(held),
      owner: { uid: held.uid.toString(), gid: held.gid.toString() },
      path,
      sealMetadata: stableMetadata(held),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function pinDirectoryChain(
  parentNode,
  relativePath,
  label,
  ownedHandles,
) {
  const handles = [];
  let parentHandle = parentNode.handle;
  for (const [index, name] of relativePath.split("/").entries()) {
    safeRelativePath(name, `${label} component`);
    const path = procPath(parentHandle, name);
    const namedBefore = await lstat(path, { bigint: true });
    const handle = await open(path, OPEN_DIRECTORY_FLAGS).catch((error) =>
      fault("FAIL", "composition", `${label} cannot be pinned`, error),
    );
    ownedHandles.push(handle);
    const [held, namedAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      !namedBefore.isDirectory() ||
      namedBefore.isSymbolicLink() ||
      !sameStableMetadata(namedBefore, held) ||
      !sameStableMetadata(namedBefore, namedAfter) ||
      !exactOwner(held)
    ) {
      await handle.close();
      fault(
        "FAIL",
        "composition",
        `${label} component ${index} metadata is unsafe`,
      );
    }
    handles.push(handle);
    parentHandle = handle;
  }
  return Object.freeze({
    handle: handles.at(-1),
    handles: Object.freeze(handles),
  });
}

function createGitContext({
  repository,
  rootObjects,
  submoduleObjects,
  control,
  source,
  workSignal,
  gitRunner,
}) {
  const handles = [
    repository.handle,
    rootObjects.handle,
    ...submoduleObjects.map(({ handle }) => handle),
    control.handle,
    source.handle,
  ];
  const pathBindings = handles
    .map((handle, index) => [procPath(handle), `/proc/self/fd/${index + 3}`])
    .sort((left, right) => right[0].length - left[0].length);
  return Object.freeze({
    inheritedFileDescriptors: Object.freeze(handles.map(({ fd }) => fd)),
    pathBindings: Object.freeze(pathBindings.map(Object.freeze)),
    workSignal,
    gitRunner,
  });
}

function extendGitContext(context, handles) {
  const inheritedFileDescriptors = [
    ...context.inheritedFileDescriptors,
    ...handles.map(({ fd }) => fd),
  ];
  const pathBindings = [
    ...context.pathBindings,
    ...handles.map((handle, index) => [
      procPath(handle),
      `/proc/self/fd/${context.inheritedFileDescriptors.length + index + 3}`,
    ]),
  ].sort((left, right) => right[0].length - left[0].length);
  return Object.freeze({
    inheritedFileDescriptors: Object.freeze(inheritedFileDescriptors),
    pathBindings: Object.freeze(pathBindings.map(Object.freeze)),
    workSignal: context.workSignal,
    gitRunner: context.gitRunner,
  });
}

async function releaseTemporaryGitHandles(state, handles) {
  const failures = [];
  for (const handle of handles) {
    try {
      await handle.close();
      const index = state.gitHandles.indexOf(handle);
      if (index !== -1) state.gitHandles.splice(index, 1);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "temporary inherited Git handles could not be closed",
    );
  }
}

async function withTemporaryGitHandles(state, handles, operation) {
  for (const handle of handles) {
    if (state.gitHandles.includes(handle)) {
      fault("FAIL", "composition", "temporary Git handle is already registered");
    }
    state.gitHandles.push(handle);
  }
  let value;
  try {
    value = await operation();
  } catch (error) {
    if (findUnreapedGitFault(error) !== undefined) throw error;
    try {
      await releaseTemporaryGitHandles(state, handles);
    } catch (releaseError) {
      throw new AggregateError([error, releaseError]);
    }
    throw error;
  }
  await releaseTemporaryGitHandles(state, handles);
  return value;
}

async function pinWorkspaceDirectoryPath(
  rootHandle,
  portablePath,
  label,
  { create },
) {
  safeRelativePath(portablePath, label);
  const handles = [];
  let parentHandle = rootHandle;
  try {
    for (const name of portablePath.split("/")) {
      const path = procPath(parentHandle, name);
      let namedBefore = await lstat(path, { bigint: true }).catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      });
      if (namedBefore === undefined) {
        if (!create) {
          await Promise.allSettled(handles.map((handle) => handle.close()));
          return undefined;
        }
        await mkdir(path, { mode: 0o700 });
        namedBefore = await lstat(path, { bigint: true });
      }
      const handle = await open(path, OPEN_DIRECTORY_FLAGS);
      handles.push(handle);
      const [held, namedAfter] = await Promise.all([
        handle.stat({ bigint: true }),
        lstat(path, { bigint: true }),
      ]);
      if (
        !namedBefore.isDirectory() ||
        namedBefore.isSymbolicLink() ||
        !sameStableMetadata(namedBefore, held) ||
        !sameStableMetadata(namedBefore, namedAfter) ||
        !exactOwner(held) ||
        held.nlink < 2n
      ) {
        fault("FAIL", "source", `${label} directory chain is unsafe`);
      }
      await handle.chmod(0o700);
      const [sealed, sealedNamed] = await Promise.all([
        handle.stat({ bigint: true }),
        lstat(path, { bigint: true }),
      ]);
      if (
        Number(sealed.mode & 0o7777n) !== 0o700 ||
        !sameStableMetadata(sealed, sealedNamed) ||
        !isDeepStrictEqual(objectIdentity(held), objectIdentity(sealed))
      ) {
        fault("FAIL", "source", `${label} directory mode could not be pinned`);
      }
      parentHandle = handle;
    }
    return Object.freeze({
      handle: handles.at(-1),
      parentHandle: handles.at(-2) ?? rootHandle,
      name: portablePath.split("/").at(-1),
      handles: Object.freeze(handles),
    });
  } catch (error) {
    await Promise.allSettled(handles.map((handle) => handle.close()));
    throw error;
  }
}

async function sharedObjectInventory(rootHandle, signal) {
  const records = [];
  workCheckpoint(signal);
  const rootBefore = await rootHandle.stat({ bigint: true });
  async function walk(directoryHandle, prefix = "", depth = 0) {
    if (depth > MAXIMUM_CLEANUP_DEPTH) {
      fault("FAIL", "composition", "shared Git object inventory is too deep");
    }
    workCheckpoint(signal);
    const directoryBefore = await directoryHandle.stat({ bigint: true });
    const names = await readdir(procPath(directoryHandle));
    names.sort(comparePortablePaths);
    for (const name of names) {
      if (depth + 1 > MAXIMUM_CLEANUP_DEPTH) {
        fault("FAIL", "composition", "shared Git object inventory is too deep");
      }
      workCheckpoint(signal);
      const path = procPath(directoryHandle, name);
      const portablePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      const namedBefore = await lstat(path, { bigint: true });
      if (namedBefore.isDirectory() && !namedBefore.isSymbolicLink()) {
        const child = await open(path, OPEN_DIRECTORY_FLAGS);
        try {
          const heldBefore = await child.stat({ bigint: true });
          if (!sameStableMetadata(namedBefore, heldBefore)) {
            fault("STALE", "composition", "shared Git directory changed");
          }
          records.push({
            path: portablePath,
            kind: "directory",
            metadata: stableMetadata(heldBefore),
          });
          await walk(child, portablePath, depth + 1);
          const [heldAfter, namedAfter] = await Promise.all([
            child.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
          if (
            !sameStableMetadata(heldBefore, heldAfter) ||
            !sameStableMetadata(heldBefore, namedAfter)
          ) {
            fault("STALE", "composition", "shared Git directory changed");
          }
        } finally {
          await child.close();
        }
      } else if (namedBefore.isFile()) {
        const namedAfter = await lstat(path, { bigint: true });
        if (!sameStableMetadata(namedBefore, namedAfter)) {
          fault("STALE", "composition", "shared Git object inventory changed");
        }
        records.push({
          path: portablePath,
          kind: "file",
          metadata: stableMetadata(namedBefore),
        });
      } else {
        fault("FAIL", "composition", "shared Git object store has a special entry");
      }
      if (records.length > MAXIMUM_CLEANUP_ENTRIES) {
        fault("FAIL", "composition", "shared Git object inventory is unbounded");
      }
    }
    const directoryAfter = await directoryHandle.stat({ bigint: true });
    workCheckpoint(signal);
    if (!sameStableMetadata(directoryBefore, directoryAfter)) {
      fault("STALE", "composition", "shared Git object root changed");
    }
  }
  await walk(rootHandle);
  workCheckpoint(signal);
  const rootAfter = await rootHandle.stat({ bigint: true });
  if (!sameStableMetadata(rootBefore, rootAfter)) {
    fault("STALE", "composition", "shared Git object root changed");
  }
  const rootMetadata = stableMetadata(rootAfter);
  return deepFreeze({
    rootMetadata,
    inventorySha256: canonicalSha256({
      schema: "oxigraph.g1.7-shared-git-object-inventory/v1",
      rootMetadata,
      records,
    }),
  });
}

async function sharedObjectPresence(rootHandle, object) {
  const path = procPath(rootHandle, object.slice(0, 2), object.slice(2));
  return lstat(path, { bigint: true })
    .then((metadata) => ({ present: true, metadata: stableMetadata(metadata) }))
    .catch((error) => {
      if (error?.code === "ENOENT") return { present: false };
      throw error;
    });
}

async function materializeProductSource(plan, state) {
  workCheckpoint(state.workSignal);
  const repository = await realpath(plan.repoRoot);
  if (repository !== plan.repoRoot) {
    fault("FAIL", "composition", "repository root is not canonical");
  }
  const repositoryNode = await pinExistingDirectory(repository, "repository root");
  state.gitHandles.push(repositoryNode.handle);
  await pinDirectoryChain(
    repositoryNode,
    ".git",
    "Git common directory",
    state.gitHandles,
  );
  const rootObjects = await pinDirectoryChain(
    repositoryNode,
    ".git/objects",
    "root Git object store",
    state.gitHandles,
  );
  const submoduleObjects = [];
  for (const gitlink of G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS) {
    const pinned = await pinDirectoryChain(
      repositoryNode,
      `.git/modules/${gitlink.path}/objects`,
      `Gitlink object store ${gitlink.path}`,
      state.gitHandles,
    ).catch((error) =>
      fault(
        "MISSING",
        "source",
        `required Gitlink object store is missing: ${gitlink.path}`,
        error,
      ),
    );
    submoduleObjects.push(pinned);
    workCheckpoint(state.workSignal);
  }
  const sourceDirectory = procPath(state.nodes.source.handle);
  const targetDirectory = procPath(state.nodes.target.handle);
  const controlDirectory = procPath(state.nodes.control.handle);
  const context = createGitContext({
    repository: repositoryNode,
    rootObjects,
    submoduleObjects,
    control: state.nodes.control,
    source: state.nodes.source,
    workSignal: state.workSignal,
    gitRunner: state.gitRunner,
  });
  const rootObjectEnvironment = {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: procPath(rootObjects.handle),
  };
  const inventoriesBefore = await Promise.all([
    sharedObjectInventory(rootObjects.handle, state.workSignal),
    ...submoduleObjects.map(({ handle }) =>
      sharedObjectInventory(handle, state.workSignal),
    ),
  ]);
  workCheckpoint(state.workSignal);
  const effectiveObjectBefore = await sharedObjectPresence(
    rootObjects.handle,
    plan.evaluator.composition.effectiveTree,
  );
  const { gitDirectory, gitHome } = await createPrivateRepository(
    state.nodes.control,
    context,
  );
  workCheckpoint(state.workSignal);
  const baseTree = (
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "rev-parse", `${plan.product.commit}^{tree}`],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
    })
  ).trim();
  const cargoLockBlob = (
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "rev-parse", `${plan.product.commit}:Cargo.lock`],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
    })
  ).trim();
  const cargoLockBytes = Buffer.from(
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "show", `${plan.product.commit}:Cargo.lock`],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
      maxOutputBytes: 16 * 1024 * 1024,
    }),
    "utf8",
  );
  if (
    baseTree !== plan.product.tree ||
    cargoLockBlob !== plan.product.cargoLockBlob ||
    sha256(cargoLockBytes) !== plan.product.cargoLockSha256
  ) {
    fault(
      "STALE",
      "composition",
      "product commit/tree/Cargo.lock binding drifted",
    );
  }

  const evaluatorParents = (
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "show", "-s", "--format=%P", plan.evaluator.commit],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
    })
  )
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const evaluatorTree = (
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "rev-parse", `${plan.evaluator.commit}^{tree}`],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
    })
  ).trim();
  const changes = (
    await gitText({
      args: [
        `--git-dir=${gitDirectory}`,
        "diff-tree",
        "--no-commit-id",
        "--name-status",
        "-r",
        plan.evaluator.commit,
      ],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
    })
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const expectedChanges = plan.evaluator.paths.map(
    ({ changeStatus, path }) => `${changeStatus}\t${path}`,
  );
  if (
    !isDeepStrictEqual(evaluatorParents, [plan.evaluator.parent]) ||
    evaluatorTree !== plan.evaluator.tree ||
    !isDeepStrictEqual(changes, expectedChanges)
  ) {
    fault(
      "STALE",
      "composition",
      "evaluator commit identity or path set drifted",
    );
  }
  for (const entry of plan.evaluator.paths) {
    safeRelativePath(entry.path, "evaluator path");
    const [blob, bytes] = await Promise.all([
      gitText({
        args: [`--git-dir=${gitDirectory}`, "rev-parse", `${plan.evaluator.commit}:${entry.path}`],
        context,
        home: gitHome,
        environmentOverrides: rootObjectEnvironment,
      }),
      gitText({
        args: [`--git-dir=${gitDirectory}`, "show", `${plan.evaluator.commit}:${entry.path}`],
        context,
        home: gitHome,
        environmentOverrides: rootObjectEnvironment,
        maxOutputBytes: MAXIMUM_PATCH_BYTES,
      }),
    ]);
    if (
      blob.trim() !== entry.blob ||
      sha256(Buffer.from(bytes, "utf8")) !== entry.contentSha256
    ) {
      fault("STALE", "composition", `evaluator path drifted: ${entry.path}`);
    }
  }
  const patchBytes = Buffer.from(
    await gitText({
      args: [
        `--git-dir=${gitDirectory}`,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        plan.evaluator.parent,
        plan.evaluator.commit,
      ],
      context,
      home: gitHome,
      environmentOverrides: rootObjectEnvironment,
      maxOutputBytes: MAXIMUM_PATCH_BYTES,
    }),
    "utf8",
  );
  if (
    patchBytes.length < 1 ||
    patchBytes.length > MAXIMUM_PATCH_BYTES ||
    sha256(patchBytes) !== plan.evaluator.patchSha256
  ) {
    fault("STALE", "composition", "evaluator binary patch binding drifted");
  }
  const patchText = patchBytes.toString("utf8");
  if (
    /(?:^|\n)GIT binary patch(?:\n|$)/u.test(patchText) ||
    /(?:^|\n)Binary files [^\n]+ differ(?:\n|$)/u.test(patchText)
  ) {
    fault(
      "FAIL",
      "composition",
      "binary patch expansion is not admitted by the product source owner",
    );
  }

  const rootImportPlan = await enumeratePrivateObjectClosure({
    context,
    gitDirectory,
    gitHome,
    alternateEnvironment: rootObjectEnvironment,
    roots: [plan.product.commit, plan.evaluator.parent, plan.evaluator.commit],
    packName: "authorized-root",
  });
  const preadmittedRequired = [];
  for (const [indexNumber, gitlink] of
    G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS.entries()) {
    const submoduleEnvironment = {
      GIT_ALTERNATE_OBJECT_DIRECTORIES: procPath(
        submoduleObjects[indexNumber].handle,
      ),
      GIT_INDEX_FILE: join(controlDirectory, `submodule-${indexNumber}.index`),
    };
    const observedTree = (
      await gitText({
        args: [
          `--git-dir=${gitDirectory}`,
          "rev-parse",
          `${gitlink.commit}^{tree}`,
        ],
        context,
        home: gitHome,
        environmentOverrides: submoduleEnvironment,
      })
    ).trim();
    if (observedTree !== gitlink.tree) {
      fault(
        "STALE",
        "source",
        `required gitlink tree drifted: ${gitlink.path}`,
      );
    }
    const submoduleEntries = parseTree(
      await gitText({
        args: [
          `--git-dir=${gitDirectory}`,
          "ls-tree",
          "-r",
          "-z",
          gitlink.commit,
        ],
        context,
        home: gitHome,
        environmentOverrides: submoduleEnvironment,
        maxOutputBytes: MAXIMUM_GIT_TREE_OUTPUT_BYTES,
      }),
      gitlink.path,
    );
    if (submoduleEntries.some(({ mode }) => mode === "160000")) {
      fault(
        "FAIL",
        "source",
        `nested gitlink is not admitted: ${gitlink.path}`,
      );
    }
    const importPlan = await enumeratePrivateObjectClosure({
      context,
      gitDirectory,
      gitHome,
      alternateEnvironment: submoduleEnvironment,
      roots: [gitlink.commit],
      packName: `authorized-submodule-${indexNumber}`,
    });
    preadmittedRequired.push(
      Object.freeze({
        gitlink: Object.freeze({ ...gitlink }),
        observedTree,
        submoduleEntries: Object.freeze(submoduleEntries),
        importPlan,
        privateSubmoduleEnvironment: Object.freeze({
          GIT_INDEX_FILE: join(
            controlDirectory,
            `submodule-${indexNumber}.index`,
          ),
        }),
      }),
    );
  }
  const importPlans = [
    rootImportPlan,
    ...preadmittedRequired.map(({ importPlan }) => importPlan),
  ];
  state.gitImportAdmission = admitPrivateObjectPlans(
    importPlans,
    derivedCompositionAdmission(plan.evaluator.paths),
  );
  // No pack or derived Git object body is written before every closure has
  // passed the one global admission above.
  for (const importPlan of importPlans) {
    await privateImportObjectClosure(importPlan);
  }
  const index = join(controlDirectory, "composition.index");
  const gitEnvironment = {
    GIT_INDEX_FILE: index,
  };
  await gitText({
    args: [`--git-dir=${gitDirectory}`, "read-tree", plan.product.commit],
    context,
    home: gitHome,
    environmentOverrides: gitEnvironment,
  });
  await gitText({
    args: [
      `--git-dir=${gitDirectory}`,
      "apply",
      "--cached",
      "--whitespace=error",
      "-",
    ],
    context,
    home: gitHome,
    environmentOverrides: gitEnvironment,
    stdin: patchText,
    maxOutputBytes: MAXIMUM_PATCH_BYTES,
  });
  const effectiveTree = (
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "write-tree"],
      context,
      home: gitHome,
      environmentOverrides: gitEnvironment,
    })
  ).trim();
  if (effectiveTree !== plan.evaluator.composition.effectiveTree) {
    fault(
      "STALE",
      "composition",
      "private composition tree differs from authorization",
    );
  }
  const effectiveManifestBlob = (
    await gitText({
      args: [
        `--git-dir=${gitDirectory}`,
        "rev-parse",
        `${effectiveTree}:lib/oxigraph/Cargo.toml`,
      ],
      context,
      home: gitHome,
      environmentOverrides: gitEnvironment,
    })
  ).trim();
  const effectiveManifestBytes = Buffer.from(
    await gitText({
      args: [
        `--git-dir=${gitDirectory}`,
        "show",
        `${effectiveTree}:lib/oxigraph/Cargo.toml`,
      ],
      context,
      home: gitHome,
      environmentOverrides: gitEnvironment,
      maxOutputBytes: 1024 * 1024,
    }),
    "utf8",
  );
  if (
    effectiveManifestBlob !==
      plan.evaluator.composition.effectiveManifestBlob ||
    sha256(effectiveManifestBytes) !==
      plan.evaluator.composition.effectiveManifestSha256
  ) {
    fault(
      "STALE",
      "composition",
      "effective manifest differs from authorization",
    );
  }

  const rootEntries = parseTree(
    await gitText({
      args: [`--git-dir=${gitDirectory}`, "ls-tree", "-r", "-z", effectiveTree],
      context,
      home: gitHome,
      environmentOverrides: gitEnvironment,
      maxOutputBytes: MAXIMUM_GIT_TREE_OUTPUT_BYTES,
    }),
  );
  const rootGitlinks = rootEntries.filter(({ mode }) => mode === "160000");
  const required = G17_NATIVE_WORKSPACE_REQUIRED_GITLINKS.map((gitlink) => {
    const entry = rootGitlinks.find(({ path }) => path === gitlink.path);
    if (entry?.object !== gitlink.commit) {
      fault("STALE", "source", `required gitlink drifted: ${gitlink.path}`);
    }
    return { ...gitlink };
  });
  const excludedGitlinks = rootGitlinks
    .filter(({ path }) => !required.some((item) => item.path === path))
    .map(({ path, object: commit }) => Object.freeze({ path, commit }))
    .sort((left, right) => comparePortablePaths(left.path, right.path));

  const expectedEntries = rootEntries.filter(({ mode }) => mode !== "160000");
  const sealedRequired = [];
  const preparedRequired = [];
  for (const [indexNumber, admitted] of preadmittedRequired.entries()) {
    const gitlink = required[indexNumber];
    const {
      observedTree,
      submoduleEntries,
      privateSubmoduleEnvironment,
    } = admitted;
    if (
      admitted.gitlink.path !== gitlink.path ||
      admitted.gitlink.commit !== gitlink.commit ||
      admitted.gitlink.tree !== gitlink.tree
    ) {
      fault("FAIL", "source", "pre-admitted Gitlink plan is not exact");
    }
    for (const entry of submoduleEntries) {
      if (expectedEntries.length >= MAXIMUM_SOURCE_ENTRIES) {
        fault("FAIL", "source", "effective source exceeds its entry ceiling");
      }
      expectedEntries.push(entry);
    }
    sealedRequired.push(
      Object.freeze({
        path: gitlink.path,
        commit: gitlink.commit,
        tree: observedTree,
        entryCount: submoduleEntries.length,
        manifestSha256: canonicalSha256(submoduleEntries),
      }),
    );
    preparedRequired.push(
      Object.freeze({ gitlink, privateSubmoduleEnvironment }),
    );
  }
  if (expectedEntries.length > MAXIMUM_SOURCE_ENTRIES) {
    fault("FAIL", "source", "effective source exceeds its entry ceiling");
  }
  expectedEntries.sort((left, right) =>
    comparePortablePaths(left.path, right.path),
  );
  const expectedPaths = expectedEntries.map(({ path }) => path);
  if (new Set(expectedPaths).size !== expectedEntries.length) {
    fault(
      "FAIL",
      "source",
      "effective source closure contains duplicate paths",
    );
  }
  if (expectedEntries.length + rootGitlinks.length > MAXIMUM_SOURCE_ENTRIES) {
    fault("FAIL", "source", "source checkout exceeds its entry ceiling");
  }
  expectedDirectories([
    ...expectedPaths,
    ...rootGitlinks.map(({ path }) => path),
  ]);
  await preflightSourceObjectCeilings({
    context,
    gitDirectory,
    gitHome,
    expectedEntries,
  });
  workCheckpoint(state.workSignal, "source");

  await gitText({
    args: [
      `--git-dir=${gitDirectory}`,
      `--work-tree=${sourceDirectory}`,
      "checkout-index",
      "--all",
      `--prefix=${sourceDirectory}${sep}`,
    ],
    context,
    home: gitHome,
    environmentOverrides: gitEnvironment,
  });
  for (const { path } of excludedGitlinks) {
    const placeholder = await pinWorkspaceDirectoryPath(
      state.nodes.source.handle,
      path,
      `excluded Gitlink ${path}`,
      { create: false },
    );
    if (placeholder === undefined) continue;
    try {
      const before = await placeholder.handle.stat({ bigint: true });
      if ((await readdir(procPath(placeholder.handle))).length !== 0) {
        fault(
          "FAIL",
          "source",
          `excluded gitlink placeholder is not empty: ${path}`,
        );
      }
      const named = await lstat(
        procPath(placeholder.parentHandle, placeholder.name),
        { bigint: true },
      );
      if (!sameStableMetadata(before, named)) {
        fault("FAIL", "source", `excluded Gitlink changed: ${path}`);
      }
      await rmdir(procPath(placeholder.parentHandle, placeholder.name));
      const after = await placeholder.handle.stat({ bigint: true });
      if (after.nlink !== 0n) {
        fault("FAIL", "source", `excluded Gitlink remained linked: ${path}`);
      }
    } finally {
      await Promise.allSettled(
        placeholder.handles.map((handle) => handle.close()),
      );
    }
  }

  for (const { gitlink, privateSubmoduleEnvironment } of preparedRequired) {
    const submoduleRoot = await pinWorkspaceDirectoryPath(
      state.nodes.source.handle,
      gitlink.path,
      `required Gitlink ${gitlink.path}`,
      { create: true },
    );
    await withTemporaryGitHandles(
      state,
      submoduleRoot.handles,
      async () => {
        const submoduleContext = extendGitContext(context, [submoduleRoot.handle]);
        const submoduleRootPath = procPath(submoduleRoot.handle);
        await gitText({
          args: [`--git-dir=${gitDirectory}`, "read-tree", gitlink.commit],
          context: submoduleContext,
          home: gitHome,
          environmentOverrides: privateSubmoduleEnvironment,
        });
        await gitText({
          args: [
            `--git-dir=${gitDirectory}`,
            `--work-tree=${submoduleRootPath}`,
            "checkout-index",
            "--all",
            `--prefix=${submoduleRootPath}${sep}`,
          ],
          context: submoduleContext,
          home: gitHome,
          environmentOverrides: privateSubmoduleEnvironment,
        });
      },
    );
  }
  const before = await verifyMaterializedTree(state.nodes.source, expectedEntries, {
    readOnly: false,
    signal: state.workSignal,
  });
  await makeSourceReadOnly(
    state.nodes.source,
    expectedEntries,
    state.workSignal,
  );
  const after = await verifyMaterializedTree(state.nodes.source, expectedEntries, {
    readOnly: true,
    signal: state.workSignal,
  });
  if (
    before.entryCount !== after.entryCount ||
    before.totalBytes !== after.totalBytes ||
    before.manifestSha256 !== after.manifestSha256
  ) {
    fault("FAIL", "source", "source changed while becoming read-only");
  }
  const symlinks = after.entries
    .filter(({ kind }) => kind === "symlink")
    .map(({ path, target, gitBlob }) =>
      Object.freeze({ path, target, gitBlob }),
    );
  const [inventoriesAfter, effectiveObjectAfter] = await Promise.all([
    Promise.all([
      sharedObjectInventory(rootObjects.handle, state.workSignal),
      ...submoduleObjects.map(({ handle }) =>
        sharedObjectInventory(handle, state.workSignal),
      ),
    ]),
    sharedObjectPresence(
      rootObjects.handle,
      plan.evaluator.composition.effectiveTree,
    ),
  ]);
  workCheckpoint(state.workSignal);
  if (!isDeepStrictEqual(inventoriesBefore, inventoriesAfter)) {
    fault(
      "FAIL",
      "composition",
      "shared Git object inventory changed during private composition",
    );
  }
  if (!isDeepStrictEqual(effectiveObjectBefore, effectiveObjectAfter)) {
    fault(
      "FAIL",
      "composition",
      "shared effective-tree presence changed during private composition",
    );
  }
  await Promise.allSettled(state.gitHandles.map((handle) => handle.close()));
  state.gitHandles = [];
  workCheckpoint(state.workSignal);
  return {
    sourceDirectory,
    targetDirectory,
    controlDirectory,
    expectedEntries: Object.freeze([...expectedEntries]),
    source: deepFreeze({
      productCommit: plan.product.commit,
      productTree: plan.product.tree,
      effectiveTree,
      cargoLock: {
        blob: cargoLockBlob,
        bytes: cargoLockBytes.length,
        sha256: sha256(cargoLockBytes),
      },
      evaluatorPatch: {
        bytes: patchBytes.length,
        sha256: sha256(patchBytes),
      },
      requiredGitlinks: sealedRequired,
      excludedGitlinks,
      symlinks,
      objectClosureSha256: canonicalSha256({
        schema: SOURCE_OBJECT_CLOSURE_SCHEMA,
        product: plan.product,
        evaluator: plan.evaluator,
        effectiveTree,
        requiredGitlinks: sealedRequired,
        excludedGitlinks,
        symlinks,
      }),
      entryCount: after.entryCount,
      totalBytes: after.totalBytes,
      manifestSha256: after.manifestSha256,
    }),
  };
}

async function requireEmptyPinnedDirectory(node, phase) {
  const before = await requirePinnedDirectory(node, {
    phase,
    mode: 0o700,
    sealed: false,
  });
  const names = await readdir(procPath(node.handle));
  const after = await requirePinnedDirectory(node, {
    phase,
    mode: 0o700,
    sealed: false,
  });
  if (names.length !== 0 || !sameStableMetadata(before, after)) {
    fault("FAIL", phase, "target directory is not stably empty");
  }
}

async function verifyCleanupBoundedTree(node, phase, signal) {
  workCheckpoint(signal, phase);
  const rootBefore = await requirePinnedDirectory(node, {
    phase,
    mode: 0o700,
    sealed: false,
  });
  const rootDevice = rootBefore.dev;
  let entries = 1;

  async function walk(directoryHandle, depth) {
    if (depth > MAXIMUM_CLEANUP_DEPTH) {
      fault("FAIL", phase, "owned tree exceeds its cleanup depth ceiling");
    }
    const directoryBefore = await directoryHandle.stat({ bigint: true });
    const names = await readdir(procPath(directoryHandle));
    names.sort(comparePortablePaths);
    for (const name of names) {
      workCheckpoint(signal, phase);
      if (depth + 1 > MAXIMUM_CLEANUP_DEPTH) {
        fault("FAIL", phase, "owned tree exceeds its cleanup depth ceiling");
      }
      entries += 1;
      if (entries > MAXIMUM_CLEANUP_ENTRIES) {
        fault("FAIL", phase, "owned tree exceeds its cleanup entry ceiling");
      }
      const path = procPath(directoryHandle, name);
      const namedBefore = await lstat(path, { bigint: true });
      if (namedBefore.dev !== rootDevice || !exactOwner(namedBefore)) {
        fault("FAIL", phase, "owned tree crosses its device or owner boundary");
      }
      if (namedBefore.isDirectory() && !namedBefore.isSymbolicLink()) {
        const child = await open(path, OPEN_DIRECTORY_FLAGS).catch((error) =>
          fault("FAIL", phase, "owned directory cannot be pinned", error),
        );
        try {
          const [heldBefore, namedAfterOpen] = await Promise.all([
            child.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
          if (
            !sameStableMetadata(namedBefore, heldBefore) ||
            !sameStableMetadata(namedBefore, namedAfterOpen) ||
            heldBefore.dev !== rootDevice ||
            !exactOwner(heldBefore) ||
            heldBefore.nlink < 2n
          ) {
            fault("FAIL", phase, "owned directory metadata drifted");
          }
          await walk(child, depth + 1);
          const [heldAfter, namedAfter] = await Promise.all([
            child.stat({ bigint: true }),
            lstat(path, { bigint: true }),
          ]);
          if (
            !sameStableMetadata(heldBefore, heldAfter) ||
            !sameStableMetadata(heldBefore, namedAfter)
          ) {
            fault("FAIL", phase, "owned directory changed during traversal");
          }
        } finally {
          await child.close();
        }
      } else if (namedBefore.isFile() || namedBefore.isSymbolicLink()) {
        const namedAfter = await lstat(path, { bigint: true });
        if (!sameStableMetadata(namedBefore, namedAfter)) {
          fault("FAIL", phase, "owned leaf changed during traversal");
        }
      } else {
        fault("FAIL", phase, "owned tree contains a special entry");
      }
    }
    const directoryAfter = await directoryHandle.stat({ bigint: true });
    workCheckpoint(signal, phase);
    if (!sameStableMetadata(directoryBefore, directoryAfter)) {
      fault("FAIL", phase, "owned tree changed during traversal");
    }
  }

  await walk(node.handle, 0);
  workCheckpoint(signal, phase);
  const rootAfter = await requirePinnedDirectory(node, {
    phase,
    mode: 0o700,
    sealed: false,
  });
  if (!sameStableMetadata(rootBefore, rootAfter)) {
    fault("FAIL", phase, "owned tree root changed during traversal");
  }
  return entries;
}

async function verifyLiveState(state, { requireTargetEmpty, phase }) {
  await requirePinnedDirectory(state.rootNode, { phase, mode: 0o700 });
  const filesystem = await statfs(procPath(state.rootNode.handle), {
    bigint: true,
  });
  if (
    filesystem.type.toString() !== state.rootNode.filesystem.type ||
    [TMPFS_MAGIC, RAMFS_MAGIC].includes(filesystem.type)
  ) {
    fault("FAIL", phase, "workspace filesystem identity changed");
  }
  const names = await readdir(procPath(state.rootNode.handle));
  if (!isDeepStrictEqual([...names].sort(), ["control", "source", "target"])) {
    fault("FAIL", phase, "workspace top-level inventory changed");
  }
  await Promise.all([
    requirePinnedDirectory(state.nodes.source, { phase, mode: 0o555 }),
    requirePinnedDirectory(state.nodes.control, { phase, mode: 0o700 }),
    requirePinnedDirectory(state.nodes.target, {
      phase,
      mode: 0o700,
      sealed: requireTargetEmpty,
    }),
  ]);
  if (requireTargetEmpty) {
    await requireEmptyPinnedDirectory(state.nodes.target, phase);
  } else {
    await verifyCleanupBoundedTree(state.nodes.target, phase);
  }
  await verifyCleanupBoundedTree(state.nodes.control, phase);
  const source = await verifyMaterializedTree(
    state.nodes.source,
    state.expectedEntries,
    { readOnly: true },
  );
  if (
    source.entryCount !== state.projection.source.entryCount ||
    source.totalBytes !== state.projection.source.totalBytes ||
    source.manifestSha256 !== state.projection.source.manifestSha256
  ) {
    fault("FAIL", phase, "product source bytes changed after acquisition");
  }
}

async function terminalVerification(state, options) {
  try {
    await verifyLiveState(state, options);
  } catch (error) {
    state.phase = "invalid";
    if (state.buildCapability !== undefined) {
      liveBuildCapabilities.delete(state.buildCapability);
      state.buildCapability = undefined;
    }
    if (error instanceof G17ProductSourceWorkspaceFault) throw error;
    fault("FAIL", options.phase, error.message, error);
  }
}

export async function createG17ProductSourceWorkspace(gate) {
  const gateState = liveGates.get(gate);
  if (gateState?.phase !== "ready") {
    fault("FAIL", "preflight", "product source production gate is not live");
  }
  gateState.phase = "acquiring";
  let plan;
  let state;
  try {
    const workSignalSource = gateState.workSignalSource;
    gateState.workSignalSource = undefined;
    const workSignalLease = captureWorkSignalLease(
      workSignalSource,
      "product source acquisition signal",
    );
    gateState.signal = workSignalLease.signal;
    gateState.workSignalLease = workSignalLease;
    plan = authorizationPlan(gateState);
    workCheckpoint(gateState.signal, "preflight");
    const [repository, root] = await Promise.all([
      realpath(plan.repoRoot),
      realpath(plan.workspaceRoot),
    ]);
    workCheckpoint(gateState.signal, "preflight");
    if (
      repository !== plan.repoRoot ||
      root !== plan.workspaceRoot ||
      contained(repository, root) ||
      contained(root, repository)
    ) {
      fault(
        "FAIL",
        "workspace",
        "canonical workspace root and repository must be disjoint",
      );
    }
    const rootNode = await rootState(root);
    workCheckpoint(gateState.signal, "workspace");
    state = {
      root,
      rootNode,
      nodes: {},
      gitHandles: [],
      gitImportAdmission: undefined,
      plan,
      cleanup: gateState.cleanup,
      workSignal: gateState.signal,
      workSignalLease: gateState.workSignalLease,
      gitRunner: gateState.gitRunner,
      afterChildMkdir: gateState.afterChildMkdir,
      beforeReady: gateState.beforeReady,
      production: gateState.production,
      phase: "acquiring",
    };
    for (const name of ["source", "target", "control"]) {
      await createPinnedChild(
        rootNode,
        name,
        state.nodes,
        state.afterChildMkdir,
      );
      workCheckpoint(state.workSignal, "workspace");
    }
    const materialized = await materializeProductSource(plan, state);
    workCheckpoint(state.workSignal, "workspace");
    await verifyCleanupBoundedTree(
      state.nodes.control,
      "workspace",
      state.workSignal,
    );
    await Promise.all([
      sealDirectoryIdentity(state.nodes.source),
      sealDirectoryIdentity(state.nodes.target),
      sealDirectoryIdentity(state.nodes.control),
      sealDirectoryIdentity(state.rootNode),
    ]);
    workCheckpoint(state.workSignal, "workspace");
    await requireEmptyPinnedDirectory(state.nodes.target, "workspace");
    workCheckpoint(state.workSignal, "workspace");
    const parentRoot = projectionRootIdentity(state.rootNode);
    const sourceChild = projectionChildIdentity(state.nodes.source);
    const targetChild = projectionChildIdentity(state.nodes.target);
    const generationCoordinate = {
      schema: "oxigraph.g1.7-product-source-generation-coordinate/v1",
      controlRunId: plan.controlRunId,
      buildId: plan.buildId,
      productRole: plan.productRole,
      authorization: plan.authorizationBinding,
      parentRoot,
      sourceChild,
      targetChild,
    };
    const generation = `g17-workspace-${canonicalSha256({
      ...generationCoordinate,
      kind: "workspace",
    })}`;
    const targetGeneration = `g17-target-${canonicalSha256({
      ...generationCoordinate,
      kind: "target",
    })}`;
    if (!SAFE_RUN_ID.test(generation) || !SAFE_RUN_ID.test(targetGeneration)) {
      fault("FAIL", "workspace", "derived workspace generations are unsafe");
    }
    const projectionBase = {
      schema: G17_PRODUCT_SOURCE_PROJECTION_SCHEMA,
      controlRunId: plan.controlRunId,
      authorization: plan.authorizationBinding,
      buildId: plan.buildId,
      productRole: plan.productRole,
      product: plan.product,
      evaluator: plan.evaluator,
      workspace: {
        generation,
        targetGeneration,
        isolated: true,
        targetIsolated: true,
        sourceReadOnlyAtBuildStart: true,
        targetEmptyAtBuildStart: true,
        parentRoot,
        sourceChild,
        targetChild,
      },
      source: materialized.source,
      authority: {
        build: false,
        launch: false,
        control: false,
        qualification: false,
        promotion: false,
        publication: false,
        provider: false,
        routerQuality: false,
      },
    };
    const projection = deepFreeze({
      ...projectionBase,
      contentHash: canonicalSha256(projectionBase),
    });
    const projectionBytes = Buffer.from(`${canonicalJson(projection)}\n`, "utf8");
    const projectionBinding = deepFreeze({
      rawSha256: sha256(projectionBytes),
      contentHash: projection.contentHash,
      buildId: plan.buildId,
      productRole: plan.productRole,
      controlRunId: plan.controlRunId,
      workspaceGeneration: generation,
      targetGeneration,
    });
    const workspace = Object.freeze({
      schema: G17_PRODUCT_SOURCE_WORKSPACE_SCHEMA,
    });
    await state.beforeReady?.();
    workCheckpoint(state.workSignal, "workspace");
    releaseWorkSignalLeases(state, gateState);
    workCheckpoint(state.workSignal, "workspace");
    Object.assign(state, {
      projection,
      projectionBytes,
      projectionBinding,
      expectedEntries: materialized.expectedEntries,
      workspace,
      gate,
      phase: "ready",
    });
    liveWorkspaces.set(workspace, state);
    gateState.phase = "consumed";
    gateState.workspace = workspace;
    return workspace;
  } catch (error) {
    releaseWorkSignalLeases(state, gateState);
    const unreapedGitFault = findUnreapedGitFault(error);
    if (state !== undefined && unreapedGitFault !== undefined) {
      state.phase = "unreaped-git";
      state.unreapedGitOutcome = unreapedGitFault.outcome;
      preservedUnreapedWorkspaces.add(state);
      gateState.phase = "unreaped-git";
      gateState.failedState = state;
      fault(
        "INCONCLUSIVE",
        "process",
        "unreaped Git process tree retains the workspace; cleanup is forbidden without a future outer reap proof",
        error,
      );
    }
    gateState.phase = "invalid";
    if (state !== undefined) {
      await Promise.allSettled(state.gitHandles.map((handle) => handle.close()));
      state.gitHandles = [];
      try {
        await cleanupGeneratedChildren(state);
        await state.rootNode.handle.close();
      } catch (cleanupError) {
        state.phase = "cleanup-failed";
        gateState.failedState = state;
        fault(
          "FAIL",
          "cleanup",
          "failed product-source acquisition could not be cleaned exactly",
          new AggregateError([error, cleanupError]),
        );
      }
    }
    if (error instanceof G17ProductSourceWorkspaceFault) throw error;
    fault("FAIL", "workspace", error.message, error);
  }
}

export async function verifyG17ProductSourceWorkspace(workspace) {
  const state = liveWorkspaces.get(workspace);
  if (state === undefined || !["ready", "built"].includes(state.phase)) {
    fault("FAIL", "verify", "product source workspace is not verifiable");
  }
  const priorPhase = state.phase;
  state.phase = "verifying";
  await terminalVerification(state, {
    phase: "verify",
    requireTargetEmpty: priorPhase === "ready",
  });
  if (state.phase !== "verifying") {
    fault("FAIL", "verify", "product source verification was superseded");
  }
  state.phase = priorPhase;
  return state.projection;
}

export async function beginG17ProductSourceBuild(workspace) {
  const state = liveWorkspaces.get(workspace);
  if (state?.phase !== "ready") {
    fault("FAIL", "build", "product source build cannot begin more than once");
  }
  if (state.production) {
    fault(
      "MISSING",
      "build",
      "production build begin awaits a physical owner that can prove child close and reap",
    );
  }
  state.phase = "beginning";
  await terminalVerification(state, {
    phase: "build",
    requireTargetEmpty: true,
  });
  if (state.phase !== "beginning") {
    fault("FAIL", "build", "product source build transition was superseded");
  }
  state.phase = "building";
  state.nodes.target.sealMetadata = undefined;
  const capability = Object.freeze({
    schema: "oxigraph.g1.7-product-source-build-capability/v1",
  });
  liveBuildCapabilities.set(capability, { state, workspace });
  state.buildCapability = capability;
  return capability;
}

export function g17ProductSourceBuildInputs(capability) {
  const captured = liveBuildCapabilities.get(capability);
  if (
    captured === undefined ||
    captured.state.phase !== "building" ||
    captured.state.buildCapability !== capability
  ) {
    fault("FAIL", "build", "product source build capability is not live");
  }
  const { state } = captured;
  return Object.freeze({
    inheritedFileDescriptors: Object.freeze([
      state.rootNode.handle.fd,
      state.nodes.source.handle.fd,
      state.nodes.target.handle.fd,
    ]),
    workspaceRoot: "/proc/self/fd/3",
    sourceDirectory: "/proc/self/fd/4",
    targetDirectory: "/proc/self/fd/5",
    targetCleanupLimits: Object.freeze({
      maxEntries: MAXIMUM_CLEANUP_ENTRIES,
      maxDepth: MAXIMUM_CLEANUP_DEPTH,
    }),
    buildCompletionBoundary:
      "physical-build-owner-must-prove-exact-child-close-and-reap-before-production-finish/v1",
    sourceProjectionBytes: Buffer.from(state.projectionBytes),
    sourceProjection: state.projectionBinding,
  });
}

export async function finishG17ProductSourceBuild(capability, _proof) {
  const captured = liveBuildCapabilities.get(capability);
  if (
    captured === undefined ||
    captured.state.phase !== "building" ||
    captured.state.buildCapability !== capability
  ) {
    fault("FAIL", "build", "product source build capability is not live");
  }
  // Deliberately unavailable until the physical build owner can mint a proof
  // from its own exact close/reap observation. No caller-supplied record is
  // inspected or accepted, and this failure leaves `building` live so destroy
  // remains forbidden.
  fault(
    "MISSING",
    "build",
    "production build finish requires an opaque physical-owner child-reap proof",
  );
}

/**
 * Explicitly test-only synthetic completion proof. It carries no production
 * authority and cannot be minted for a production gate.
 */
export function mintG17ProductSourceCompletedReapProofForTesting(capability) {
  const captured = liveBuildCapabilities.get(capability);
  if (
    captured === undefined ||
    captured.state.phase !== "building" ||
    captured.state.buildCapability !== capability
  ) {
    fault("FAIL", "build", "product source build capability is not live");
  }
  const { state, workspace } = captured;
  if (state.production) {
    fault("FAIL", "build", "test-only child-reap proof cannot authorize production");
  }
  if (state.testBuildReapProof !== undefined) {
    fault("FAIL", "build", "test-only child-reap proof was already minted");
  }
  const proof = Object.freeze({
    schema: "oxigraph.g1.7-product-source-test-completed-reap-proof/v1",
  });
  liveTestBuildReapProofs.set(
    proof,
    Object.freeze({
      state,
      workspace,
      capability,
      workspaceGeneration: state.projection.workspace.generation,
    }),
  );
  state.testBuildReapProof = proof;
  return proof;
}

/** Explicitly test-only transition; production finish remains unavailable. */
export async function finishG17ProductSourceBuildForTesting(capability, proof) {
  const captured = liveBuildCapabilities.get(capability);
  const proofBinding =
    proof !== null &&
    (typeof proof === "object" || typeof proof === "function")
      ? liveTestBuildReapProofs.get(proof)
      : undefined;
  if (
    captured === undefined ||
    captured.state.production ||
    captured.state.phase !== "building" ||
    captured.state.buildCapability !== capability ||
    proofBinding === undefined ||
    proofBinding.state !== captured.state ||
    proofBinding.workspace !== captured.workspace ||
    proofBinding.capability !== capability ||
    proofBinding.workspaceGeneration !==
      captured.state.projection.workspace.generation ||
    captured.state.testBuildReapProof !== proof
  ) {
    fault("FAIL", "build", "test-only child-reap proof is not live for this build");
  }
  const { state } = captured;
  state.phase = "finishing";
  try {
    await verifyLiveState(state, {
      phase: "build",
      requireTargetEmpty: false,
    });
    state.phase = "built";
    return Object.freeze({
      sourceProjectionBytes: Buffer.from(state.projectionBytes),
      sourceProjection: state.projectionBinding,
    });
  } catch (error) {
    state.phase = "invalid";
    if (error instanceof G17ProductSourceWorkspaceFault) throw error;
    fault("FAIL", "build", error.message, error);
  } finally {
    liveTestBuildReapProofs.delete(proof);
    state.testBuildReapProof = undefined;
    liveBuildCapabilities.delete(capability);
    state.buildCapability = undefined;
  }
}

export function g17ProductSourceWorkspacePathsForTesting(workspace) {
  const state = liveWorkspaces.get(workspace);
  if (state === undefined || state.production || state.phase === "destroyed") {
    fault("FAIL", "verify", "test-only product source paths are unavailable");
  }
  return Object.freeze({
    sourceDirectory: procPath(state.nodes.source.handle),
    targetDirectory: procPath(state.nodes.target.handle),
    controlDirectory: procPath(state.nodes.control.handle),
    workspaceRoot: procPath(state.rootNode.handle),
  });
}

export async function destroyG17ProductSourceWorkspace(target) {
  let state = liveWorkspaces.get(target);
  let workspace = target;
  if (state === undefined) {
    const gateState = liveGates.get(target);
    state = gateState?.failedState;
    workspace = undefined;
  }
  releaseWorkSignalLeases(state, liveGates.get(state?.gate ?? target));
  if (state?.phase === "unreaped-git") {
    fault(
      "INCONCLUSIVE",
      "cleanup",
      "unreaped Git process tree has no outer reap proof; held workspace is preserved without unlink",
    );
  }
  if (
    state === undefined ||
    !["ready", "building", "built", "invalid", "cleanup-failed"].includes(
      state.phase,
    )
  ) {
    fault("FAIL", "cleanup", "product source workspace is unavailable");
  }
  if (state.phase === "building") {
    fault(
      "FAIL",
      "cleanup",
      "live build child must be terminated and reaped before finish and destroy",
    );
  }
  const priorPhase = state.phase;
  state.phase = "destroying";
  if (state.buildCapability !== undefined) {
    liveBuildCapabilities.delete(state.buildCapability);
    state.buildCapability = undefined;
  }
  await Promise.allSettled(state.gitHandles.map((handle) => handle.close()));
  state.gitHandles = [];
  try {
    await cleanupGeneratedChildren(state);
    await state.rootNode.handle.close();
  } catch (error) {
    state.phase = "cleanup-failed";
    fault(
      "FAIL",
      "cleanup",
      "product source workspace cleanup was not exact",
      error,
    );
  }
  state.phase = "destroyed";
  if (workspace !== undefined) liveWorkspaces.delete(workspace);
  const gateState = liveGates.get(state.gate ?? target);
  if (gateState !== undefined) {
    gateState.phase = "destroyed";
    delete gateState.failedState;
  }
  return Object.freeze({ priorPhase, destroyed: true });
}
