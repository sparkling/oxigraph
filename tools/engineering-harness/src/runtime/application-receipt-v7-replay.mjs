import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from "node:path";
import { types as utilTypes } from "node:util";

import { copyBoundedBufferByFailureCategory } from "../candidate/containment-exact-v2.mjs";
import {
  taskV2DetailSha256,
  taskV2Failure,
} from "../policy/task-v2-failures.mjs";
import { canonicalJson } from "../routing/features.mjs";
import { verifyApplicationReceiptV7 } from "../receipts/application.mjs";

const MAX_CONTRACT_BYTES = 4 * 1024 * 1024;
// Keep the replay pre-parse ceiling compatible with the structural receipt
// module's 64 MiB serialized-byte ceiling. UTF-8 bytes are never fewer than
// JavaScript code units, so this rejects only inputs that cannot be valid.
const MAX_RECEIPT_CHARACTERS = 64 * 1024 * 1024;
const MAX_PATH_CHARACTERS = 4096;
const TEMPORARY_OWNER_PREFIX = "oxigraph-receipt-v7-owner-";
const TEMPORARY_OWNER_NAME = /^oxigraph-receipt-v7-owner-[A-Za-z0-9]{6}$/u;
const REPLAY_OPTION_KEYS = Object.freeze([
  "receipt",
  "repositoryRoot",
  "contractBytes",
]);
const OPERATION_KEYS = Object.freeze([
  "authorize",
  "parseContract",
  "realpath",
  "acquireTemporaryRoot",
  "describeTemporaryRoot",
  "createGitHome",
  "verifyRepository",
  "loadTree",
  "readBlob",
  "createContext",
  "assertSealedContext",
  "reconstructCandidate",
  "disposeCandidate",
  "releaseTemporaryRoot",
]);
const UNAVAILABLE = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const DIRECTORY_IDENTITY_KEYS = Object.freeze([
  "path",
  "realpath",
  "device",
  "inode",
  "mode",
  "uid",
  "gid",
  "directory",
  "symbolicLink",
]);

function exactOwnDataRecord(value, expectedKeys, label) {
  let descriptors;
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilTypes.isProxy(value) ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      throw new Error(`${label} is invalid`);
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    expectedKeys.some((key) => {
      const descriptor = descriptors[key];
      return !(
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    })
  ) {
    throw new Error(`${label} is invalid`);
  }
  return Object.fromEntries(
    expectedKeys.map((key) => [key, descriptors[key].value]),
  );
}

function snapshotOperations(value) {
  const operations = exactOwnDataRecord(
    value,
    OPERATION_KEYS,
    "application receipt v7 replay test operations",
  );
  if (
    OPERATION_KEYS.some(
      (key) =>
        typeof operations[key] !== "function" ||
        utilTypes.isProxy(operations[key]),
    )
  ) {
    throw new TypeError(
      "application receipt v7 replay test operations must be functions",
    );
  }
  return Object.freeze(operations);
}

function snapshotReplayOptions(value) {
  const options = exactOwnDataRecord(
    value,
    REPLAY_OPTION_KEYS,
    "application receipt v7 replay options",
  );
  if (
    typeof options.receipt !== "string" ||
    options.receipt.length === 0 ||
    options.receipt.length > MAX_RECEIPT_CHARACTERS ||
    options.receipt.includes("\0") ||
    typeof options.repositoryRoot !== "string" ||
    options.repositoryRoot.length === 0 ||
    options.repositoryRoot.length > MAX_PATH_CHARACTERS ||
    options.repositoryRoot.includes("\0") ||
    !isAbsolute(options.repositoryRoot)
  ) {
    throw new Error("application receipt v7 replay options are invalid");
  }
  let contractBytes;
  try {
    contractBytes = copyBoundedBufferByFailureCategory(
      options.contractBytes,
      "application receipt v7 contract bytes",
      { minimumBytes: 1, maximumBytes: MAX_CONTRACT_BYTES },
      () => {
        throw new Error("application receipt v7 replay options are invalid");
      },
      () => {
        throw new Error("application receipt v7 replay options are invalid");
      },
    );
  } catch {
    throw new Error("application receipt v7 replay options are invalid");
  }
  return Object.freeze({
    receipt: options.receipt,
    repositoryRoot: options.repositoryRoot,
    contractBytes,
  });
}

function exactUnavailable(value) {
  try {
    const projected = exactOwnDataRecord(
      value,
      Object.freeze(["status", "reason"]),
      "application receipt v7 replay gate result",
    );
    return (
      Object.isFrozen(value) &&
      projected.status === UNAVAILABLE.status &&
      projected.reason === UNAVAILABLE.reason
    );
  } catch {
    return false;
  }
}

function pathContains(parent, child) {
  const delta = relative(parent, child);
  return (
    delta === "" ||
    (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`))
  );
}

function opaqueTemporaryHandle(value) {
  let prototype;
  let keys;
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilTypes.isProxy(value) ||
      !Object.isFrozen(value)
    ) {
      throw new Error("invalid handle");
    }
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  } catch {
    throw new Error("application receipt v7 temporary handle is invalid");
  }
  if (prototype !== null || keys.length !== 0) {
    throw new Error("application receipt v7 temporary handle is invalid");
  }
  return value;
}

function directoryIdentity(value, path, label) {
  const identity = exactOwnDataRecord(value, DIRECTORY_IDENTITY_KEYS, label);
  const uid =
    typeof process.geteuid === "function" ? process.geteuid() : undefined;
  const gid =
    typeof process.getegid === "function" ? process.getegid() : undefined;
  if (
    !Object.isFrozen(value) ||
    identity.path !== path ||
    identity.realpath !== path ||
    typeof identity.device !== "string" ||
    !/^[1-9][0-9]*$/u.test(identity.device) ||
    typeof identity.inode !== "string" ||
    !/^[1-9][0-9]*$/u.test(identity.inode) ||
    identity.mode !== 0o700 ||
    !Number.isSafeInteger(identity.uid) ||
    !Number.isSafeInteger(identity.gid) ||
    identity.uid !== uid ||
    identity.gid !== gid ||
    identity.directory !== true ||
    identity.symbolicLink !== false
  ) {
    throw new Error(`${label} is invalid`);
  }
  return Object.freeze(identity);
}

function directoryIdentityPath(value, label) {
  return exactOwnDataRecord(value, DIRECTORY_IDENTITY_KEYS, label).path;
}

function temporaryLeaseProjection(value, repositoryRoot) {
  const lease = exactOwnDataRecord(
    value,
    Object.freeze(["owner", "root"]),
    "application receipt v7 temporary lease",
  );
  if (!Object.isFrozen(value)) {
    throw new Error("application receipt v7 temporary lease is invalid");
  }
  const ownerPath = directoryIdentityPath(
    lease.owner,
    "application receipt v7 temporary owner identity",
  );
  const rootPath = directoryIdentityPath(
    lease.root,
    "application receipt v7 temporary root identity",
  );
  const temporaryParent = resolve(tmpdir());
  if (
    typeof ownerPath !== "string" ||
    ownerPath.length === 0 ||
    ownerPath.length > MAX_PATH_CHARACTERS ||
    ownerPath.includes("\0") ||
    !isAbsolute(ownerPath) ||
    ownerPath !== resolve(ownerPath) ||
    dirname(ownerPath) !== temporaryParent ||
    basename(ownerPath).length <= TEMPORARY_OWNER_PREFIX.length ||
    !TEMPORARY_OWNER_NAME.test(basename(ownerPath)) ||
    rootPath !== join(ownerPath, "active") ||
    pathContains(repositoryRoot, ownerPath) ||
    pathContains(ownerPath, repositoryRoot) ||
    pathContains(repositoryRoot, rootPath) ||
    pathContains(rootPath, repositoryRoot)
  ) {
    throw new Error("application receipt v7 temporary lease paths are invalid");
  }
  const owner = directoryIdentity(
    lease.owner,
    ownerPath,
    "application receipt v7 temporary owner identity",
  );
  const root = directoryIdentity(
    lease.root,
    rootPath,
    "application receipt v7 temporary root identity",
  );
  if (
    owner.device !== root.device ||
    owner.uid !== root.uid ||
    owner.gid !== root.gid ||
    (owner.device === root.device && owner.inode === root.inode)
  ) {
    throw new Error("application receipt v7 temporary lease identity changed");
  }
  return Object.freeze({ owner, root });
}

function removedLeaseResult(value) {
  const result = exactOwnDataRecord(
    value,
    Object.freeze(["status"]),
    "application receipt v7 temporary release result",
  );
  if (!Object.isFrozen(value) || result.status !== "removed") {
    throw new Error(
      "application receipt v7 temporary release did not complete",
    );
  }
  return Object.freeze({ status: "removed" });
}

function contractProjection(parsed) {
  const { contract, contractSha256 } = parsed;
  const success = {};
  for (const name of contract.verificationSequence.slice(2)) {
    success[`${name}Passed`] = contract.success[`${name}Passed`];
  }
  return Object.freeze({
    sha256: contractSha256,
    baseline: Object.freeze({
      commit: contract.baseline.commit,
      tree: contract.baseline.tree,
    }),
    evaluator: Object.freeze({
      commit: contract.evaluator.commit,
      tree: contract.evaluator.tree,
      patchSha256: contract.evaluator.patchSha256,
    }),
    success: Object.freeze(success),
  });
}

function taskContextProjection(context, sealed) {
  return Object.freeze({
    schemaVersion: context.schemaVersion,
    taskSha256: sealed.taskSha256,
    sourceSnapshotSha256: context.sourceSnapshot.sha256,
    creationInstructionsSha256: context.bindings.creationInstructionsSha256,
  });
}

function requireReplayMatch(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`application receipt v7 ${label} does not replay`);
  }
}

function failureRecord(phase, error) {
  return Object.freeze({
    phase,
    detailSha256: taskV2DetailSha256("ERR_RECEIPT_REPLAY", error),
  });
}

function replayFailure(records) {
  return taskV2Failure("ERR_RECEIPT_REPLAY", canonicalJson(records));
}

async function replayAfterTestGate(optionsValue, operations) {
  let phase = "options";
  let candidate;
  let temporaryHandle;
  let temporaryAcquired = false;
  let replayed;
  const failures = [];
  try {
    const options = snapshotReplayOptions(optionsValue);
    phase = "structural-receipt";
    const verification = verifyApplicationReceiptV7(options.receipt);
    if (!verification.ok) {
      throw new Error("application receipt v7 is structurally invalid");
    }
    const receipt = verification.receipt;

    phase = "contract";
    const parsed = operations.parseContract(options.contractBytes);
    phase = "repository-root";
    const canonicalRoot = await operations.realpath(options.repositoryRoot);
    if (
      typeof canonicalRoot !== "string" ||
      canonicalRoot.length === 0 ||
      canonicalRoot.length > MAX_PATH_CHARACTERS ||
      canonicalRoot.includes("\0") ||
      !isAbsolute(canonicalRoot) ||
      canonicalRoot !== resolve(canonicalRoot) ||
      canonicalRoot === parsePath(canonicalRoot).root ||
      canonicalRoot === resolve(tmpdir())
    ) {
      throw new Error("application receipt v7 repository root is invalid");
    }

    phase = "contract-identity";
    if (
      receipt.taskV2.id !== parsed.contract.id ||
      receipt.taskV2.contractSha256 !== parsed.contractSha256 ||
      receipt.taskV2.canonicalContractSha256 !== parsed.canonicalContractSha256
    ) {
      throw new Error(
        "application receipt v7 contract identity does not replay",
      );
    }
    requireReplayMatch(
      receipt.taskV2.verificationSequence,
      parsed.contract.verificationSequence,
      "verification sequence",
    );
    requireReplayMatch(
      receipt.contract,
      contractProjection(parsed),
      "contract projection",
    );

    phase = "temporary-acquire";
    temporaryHandle = await operations.acquireTemporaryRoot(
      Object.freeze({ repositoryRoot: canonicalRoot }),
    );
    temporaryAcquired = true;
    opaqueTemporaryHandle(temporaryHandle);
    phase = "temporary-describe";
    const temporaryLease = temporaryLeaseProjection(
      await operations.describeTemporaryRoot(temporaryHandle),
      canonicalRoot,
    );
    phase = "git-home";
    const homeIdentity = directoryIdentity(
      await operations.createGitHome(temporaryHandle),
      join(temporaryLease.root.path, "git-home"),
      "application receipt v7 Git home identity",
    );
    if (
      homeIdentity.uid !== temporaryLease.root.uid ||
      homeIdentity.gid !== temporaryLease.root.gid ||
      homeIdentity.device !== temporaryLease.root.device
    ) {
      throw new Error("application receipt v7 Git home escaped its root");
    }
    const home = homeIdentity.path;
    phase = "repository";
    const repository = await operations.verifyRepository(parsed.contract, {
      repoRoot: canonicalRoot,
      home,
    });
    requireReplayMatch(
      receipt.taskV2.repository,
      repository,
      "repository projection",
    );

    phase = "evaluator-tree";
    const evaluatorTree = await operations.loadTree({
      workspace: canonicalRoot,
      home,
      tree: parsed.contract.evaluator.tree,
    });
    phase = "task-context";
    const context = await operations.createContext({
      contractBytes: options.contractBytes,
      evaluatorTree,
      readBlobByOid: ({ oid, maxOutputBytes }) =>
        operations.readBlob({
          workspace: canonicalRoot,
          home,
          oid,
          maxOutputBytes,
        }),
    });
    phase = "sealed-task-context";
    const sealed = operations.assertSealedContext({
      context,
      contractBytes: options.contractBytes,
    });
    requireReplayMatch(
      receipt.taskV2.taskContext,
      taskContextProjection(context, sealed),
      "task context",
    );
    phase = "worker-task-contexts";
    for (const invocation of receipt.nativeInvocations) {
      const workerTask = JSON.parse(invocation.taskJson);
      requireReplayMatch(
        workerTask.context,
        context,
        `worker task context ${invocation.id}`,
      );
    }

    phase = "candidate";
    const selectedAttempt = receipt.attempts.find(
      ({ id }) => id === receipt.selectedCandidate.attemptId,
    );
    candidate = await operations.reconstructCandidate({
      repositoryRoot: canonicalRoot,
      contractBytes: options.contractBytes,
      patch: selectedAttempt.patch,
    });
    phase = "candidate-identity";
    requireReplayMatch(
      receipt.taskV2.candidate,
      candidate,
      "candidate projection",
    );
    replayed = receipt;
  } catch (error) {
    failures.push(failureRecord(phase, error));
  }

  if (candidate !== undefined) {
    try {
      await operations.disposeCandidate(candidate);
    } catch (error) {
      failures.push(failureRecord("candidate-cleanup", error));
    }
  }
  if (temporaryAcquired) {
    try {
      removedLeaseResult(
        await operations.releaseTemporaryRoot(temporaryHandle),
      );
    } catch (error) {
      failures.push(failureRecord("temporary-release", error));
    }
  }
  if (failures.length > 0) throw replayFailure(Object.freeze(failures));
  return replayed;
}

/**
 * Explicitly test-only post-gate replay owner. It has no production operations,
 * cannot mint product authority, and invokes its injected authorizer before it
 * inspects deferred receipt options. The authorizer must return the private
 * per-controller grant passed to it; a caller-forgeable status is insufficient.
 */
export function createApplicationReceiptV7PostGateReplayForTesting(value) {
  const operations = snapshotOperations(value);
  const grant = Object.freeze(Object.create(null));
  const replay = (gateRequest, deferredOptions) => {
    let decision;
    try {
      decision = operations.authorize(gateRequest, grant);
    } catch (error) {
      throw replayFailure(
        Object.freeze([failureRecord("authorization", error)]),
      );
    }
    if (decision !== grant) {
      if (exactUnavailable(decision)) return UNAVAILABLE;
      throw replayFailure(
        Object.freeze([
          failureRecord(
            "authorization",
            new Error("application receipt v7 replay was not authorized"),
          ),
        ]),
      );
    }
    return replayAfterTestGate(deferredOptions, operations);
  };
  return Object.freeze({ replay });
}
