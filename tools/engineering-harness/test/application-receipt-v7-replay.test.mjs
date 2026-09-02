import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import {
  disposeCandidateV2,
  reconstructCandidateV2,
} from "../src/candidate/reconstruct-v2.mjs";
import { loadTreeV2, readBlobByOid } from "../src/candidate/tree-v2.mjs";
import {
  parseTaskContractBytesV2,
  verifyTaskContractRepositoryV2,
} from "../src/contract-v2.mjs";
import {
  isTaskV2Failure,
  TASK_V2_PUBLIC_FAILURE_MESSAGE,
} from "../src/policy/task-v2-failures.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import { createApplicationReceiptV7PostGateReplayForTesting } from "../src/runtime/application-receipt-v7-replay.mjs";
import {
  assertSealedTaskV2WorkerContext,
  createTaskV2Context,
} from "../src/runtime/task-context-v2.mjs";
import { createExactApplicationReceiptV7Fixture } from "./support/application-receipt-v7-fixture.mjs";

const gateRequest = Object.freeze({ testOnly: "post-gate-v7-replay" });
const lifecycleTemporaryOwner = join(
  tmpdir(),
  "oxigraph-receipt-v7-owner-ABC123",
);
const lifecycleTemporaryRoot = join(lifecycleTemporaryOwner, "active");
let fixturePromise;
function exactFixture() {
  fixturePromise ??= createExactApplicationReceiptV7Fixture();
  return fixturePromise;
}
const frozenSerializedPromise = readFile(
  new URL(
    "./fixtures/application-receipt-v7-exact.json.br.b64",
    import.meta.url,
  ),
  "utf8",
).then((encoded) =>
  brotliDecompressSync(Buffer.from(encoded.trim(), "base64")).toString("utf8"),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertReplayFailure(error) {
  assert.equal(isTaskV2Failure(error), true);
  assert.equal(error.code, "ERR_RECEIPT_REPLAY");
  assert.equal(error.message, TASK_V2_PUBLIC_FAILURE_MESSAGE);
  assert.equal(error.stack, `TaskV2Failure: ${TASK_V2_PUBLIC_FAILURE_MESSAGE}`);
  assert.equal(error.terminal, true);
  assert.equal(error.retryAllowed, false);
  assert.match(error.detailSha256, /^[0-9a-f]{64}$/u);
  return true;
}

async function inspectDirectoryIdentity(path) {
  const stat = await lstat(path, { bigint: true });
  return Object.freeze({
    path,
    realpath: await realpath(path),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: Number(stat.mode & 0o777n),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    directory: stat.isDirectory(),
    symbolicLink: stat.isSymbolicLink(),
  });
}

function sameDirectoryIdentity(left, right) {
  return (
    left.path === right.path &&
    left.realpath === right.realpath &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.directory === right.directory &&
    left.symbolicLink === right.symbolicLink
  );
}

function exactTemporaryOwner(events, options = {}) {
  const leases = new Map();
  const ownedStates = new Map();
  const stateFor = (handle) => {
    const state = leases.get(handle);
    if (state === undefined || state.status !== "open") {
      throw new Error("temporary owner lease is not open");
    }
    return state;
  };
  return {
    async acquireTemporaryRoot(request) {
      events.push("acquireTemporaryRoot");
      assert.equal(Object.isFrozen(request), true);
      assert.deepEqual(Object.keys(request), ["repositoryRoot"]);
      let ownerPath;
      let state;
      try {
        ownerPath = await mkdtemp(join(tmpdir(), "oxigraph-receipt-v7-owner-"));
        const rootPath = join(ownerPath, "active");
        state = {
          status: "acquiring",
          ownerPath,
          rootPath,
          ownerIdentity: null,
          rootIdentity: null,
        };
        // Ownership starts before the next asynchronous action. If acquisition
        // cannot return a handle, this record still owns uncertain residue.
        ownedStates.set(ownerPath, state);
        state.ownerIdentity = await inspectDirectoryIdentity(ownerPath);
        await mkdir(rootPath, { mode: 0o700 });
        state.rootIdentity = await inspectDirectoryIdentity(rootPath);
        if (options.afterRootCreated !== undefined) {
          await options.afterRootCreated(
            Object.freeze({ ownerPath, rootPath }),
          );
        }
        const handle = Object.freeze(Object.create(null));
        state.status = "open";
        leases.set(handle, state);
        return handle;
      } catch (error) {
        if (ownerPath !== undefined) {
          try {
            if (options.cleanupAfterAcquisitionFailure !== undefined) {
              await options.cleanupAfterAcquisitionFailure(ownerPath);
            } else {
              await rm(ownerPath, { recursive: true, force: true });
            }
            state.status = "removed";
            ownedStates.delete(ownerPath);
          } catch (cleanupError) {
            state.status = "uncertain";
            throw new AggregateError(
              [error, cleanupError],
              "temporary owner acquisition and cleanup failed",
            );
          }
        }
        throw error;
      }
    },
    async describeTemporaryRoot(handle) {
      events.push("describeTemporaryRoot");
      const state = stateFor(handle);
      const owner = await inspectDirectoryIdentity(state.ownerPath);
      const root = await inspectDirectoryIdentity(state.rootPath);
      if (
        !sameDirectoryIdentity(owner, state.ownerIdentity) ||
        !sameDirectoryIdentity(root, state.rootIdentity)
      ) {
        throw new Error("temporary owner identity changed");
      }
      return Object.freeze({ owner, root });
    },
    async createGitHome(handle) {
      events.push("createGitHome");
      const state = stateFor(handle);
      const home = join(state.rootPath, "git-home");
      await mkdir(home, { mode: 0o700 });
      return inspectDirectoryIdentity(home);
    },
    async releaseTemporaryRoot(handle) {
      events.push("releaseTemporaryRoot");
      const state = stateFor(handle);
      state.status = "releasing";
      try {
        const owner = await inspectDirectoryIdentity(state.ownerPath);
        const root = await inspectDirectoryIdentity(state.rootPath);
        if (
          !sameDirectoryIdentity(owner, state.ownerIdentity) ||
          !sameDirectoryIdentity(root, state.rootIdentity)
        ) {
          throw new Error("temporary owner identity changed before release");
        }
        if (options.beforeQuarantine !== undefined) {
          await options.beforeQuarantine(
            Object.freeze({
              ownerPath: state.ownerPath,
              rootPath: state.rootPath,
            }),
          );
        }
        const quarantine = join(state.ownerPath, "quarantine");
        await rename(state.rootPath, quarantine);
        const moved = await inspectDirectoryIdentity(quarantine);
        if (
          moved.device !== state.rootIdentity.device ||
          moved.inode !== state.rootIdentity.inode ||
          moved.mode !== state.rootIdentity.mode ||
          moved.uid !== state.rootIdentity.uid ||
          moved.gid !== state.rootIdentity.gid ||
          moved.directory !== true ||
          moved.symbolicLink !== false
        ) {
          throw new Error("temporary owner identity changed during quarantine");
        }
        await rm(quarantine, { recursive: true, force: false });
        await rmdir(state.ownerPath);
        state.status = "removed";
        ownedStates.delete(state.ownerPath);
        return Object.freeze({ status: "removed" });
      } catch (error) {
        state.status = "uncertain";
        throw error;
      }
    },
    retainedAcquisitionStateForTesting(ownerPath) {
      const state = ownedStates.get(ownerPath);
      if (state === undefined || state.status !== "uncertain") return null;
      return Object.freeze({
        status: state.status,
        ownerPath: state.ownerPath,
        rootPath: state.rootPath,
        ownerIdentity: state.ownerIdentity,
        rootIdentity: state.rootIdentity,
      });
    },
    async recoverRetainedAcquisitionForTesting(ownerPath) {
      const state = ownedStates.get(ownerPath);
      if (
        state === undefined ||
        state.status !== "uncertain" ||
        state.ownerIdentity === null ||
        state.rootIdentity === null
      ) {
        throw new Error("retained temporary acquisition is not recoverable");
      }
      state.status = "recovering";
      try {
        const owner = await inspectDirectoryIdentity(state.ownerPath);
        const root = await inspectDirectoryIdentity(state.rootPath);
        if (
          !sameDirectoryIdentity(owner, state.ownerIdentity) ||
          !sameDirectoryIdentity(root, state.rootIdentity)
        ) {
          throw new Error("retained temporary acquisition identity changed");
        }
        const quarantine = join(state.ownerPath, "quarantine");
        await rename(state.rootPath, quarantine);
        const moved = await inspectDirectoryIdentity(quarantine);
        if (
          moved.device !== state.rootIdentity.device ||
          moved.inode !== state.rootIdentity.inode ||
          moved.mode !== state.rootIdentity.mode ||
          moved.uid !== state.rootIdentity.uid ||
          moved.gid !== state.rootIdentity.gid ||
          moved.directory !== true ||
          moved.symbolicLink !== false
        ) {
          throw new Error(
            "retained temporary acquisition changed during quarantine",
          );
        }
        await rm(quarantine, { recursive: true, force: false });
        await rmdir(state.ownerPath);
        state.status = "removed";
        ownedStates.delete(state.ownerPath);
        return Object.freeze({ status: "removed" });
      } catch (error) {
        state.status = "uncertain";
        throw error;
      }
    },
  };
}

function exactOperations(
  events,
  authorize,
  ownerOptions,
  temporaryOwner = exactTemporaryOwner(events, ownerOptions),
) {
  return {
    authorize(request, grant) {
      events.push("authorize");
      return authorize(request, grant);
    },
    parseContract(bytes) {
      events.push("parseContract");
      return parseTaskContractBytesV2(bytes);
    },
    async realpath(path) {
      events.push("realpath");
      return realpath(path);
    },
    acquireTemporaryRoot: temporaryOwner.acquireTemporaryRoot,
    describeTemporaryRoot: temporaryOwner.describeTemporaryRoot,
    async createGitHome(handle) {
      const identity = await temporaryOwner.createGitHome(handle);
      return identity;
    },
    async verifyRepository(contract, options) {
      events.push("verifyRepository");
      return verifyTaskContractRepositoryV2(contract, options);
    },
    async loadTree(options) {
      events.push("loadTree");
      return loadTreeV2(options);
    },
    async readBlob(options) {
      events.push("readBlob");
      return readBlobByOid(options);
    },
    async createContext(options) {
      events.push("createContext");
      return createTaskV2Context(options);
    },
    assertSealedContext(options) {
      events.push("assertSealedContext");
      return assertSealedTaskV2WorkerContext(options);
    },
    async reconstructCandidate(options) {
      events.push("reconstructCandidate");
      return reconstructCandidateV2(options);
    },
    async disposeCandidate(candidate) {
      events.push("disposeCandidate");
      await disposeCandidateV2(candidate);
    },
    releaseTemporaryRoot: temporaryOwner.releaseTemporaryRoot,
  };
}

test("frozen exact v7 receipt bytes bind the raw and canonical contract", async () => {
  const fixture = await exactFixture();
  const frozen = await frozenSerializedPromise;
  assert.equal(frozen, fixture.serialized);
  assert.equal(Buffer.byteLength(frozen, "utf8"), 39_344);
  assert.equal(
    sha256(frozen),
    "c4ec874e997e505700645561a06845e06bbfd9fe3611a6996a973dfd6c3202d9",
  );
  const receipt = JSON.parse(frozen);
  assert.equal(
    receipt.receiptSha256,
    "63f5741fb19e41212b789ea86d1379ff4f77a752dc011e1fab66a40a2f3e06c7",
  );
  assert.equal(
    receipt.taskV2.contractSha256,
    "58a9207303ab541552fa3b8342ad61bc24a3cb8b9b97a6d8236a58b3440489ad",
  );
  assert.equal(
    receipt.taskV2.canonicalContractSha256,
    "f345886f86725dbedf4a57b1abfd9e66d5153ae7d0c86e79bbe251e71bb22d08",
  );
});

test("exact dormant v7 receipt replays Git, context, and candidate identity after a private test gate", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    exactOperations(events, (request, grant) => {
      assert.equal(request, gateRequest);
      return grant;
    }),
  );
  const replayed = await controller.replay(gateRequest, {
    receipt: serialized,
    repositoryRoot: fixture.repositoryRoot,
    contractBytes: fixture.contractBytes,
  });

  assert.equal(replayed.receiptSha256, fixture.receipt.receiptSha256);
  assert.equal(canonicalJson(replayed), serialized);
  assert.deepEqual(events.slice(0, 8), [
    "authorize",
    "parseContract",
    "realpath",
    "acquireTemporaryRoot",
    "describeTemporaryRoot",
    "createGitHome",
    "verifyRepository",
    "loadTree",
  ]);
  assert.ok(events.includes("readBlob"));
  assert.deepEqual(events.slice(-3), [
    "reconstructCandidate",
    "disposeCandidate",
    "releaseTemporaryRoot",
  ]);
});

test("exact v7 replay rejects a different valid raw contract before Git or temporary state", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const changed = JSON.parse(fixture.contractBytes.toString("utf8"));
  changed.objective = `${changed.objective} `;
  const contractBytes = Buffer.from(`${JSON.stringify(changed)}\n`, "utf8");
  const events = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    exactOperations(events, (_request, grant) => grant),
  );

  await assert.rejects(
    controller.replay(gateRequest, {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes,
    }),
    assertReplayFailure,
  );
  assert.deepEqual(events, ["authorize", "parseContract", "realpath"]);
});

test("replay option accessors and non-Buffer byte carriers fail before effects", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    lifecycleOperations(fixture, events),
  );
  let getterCalls = 0;
  const accessorOptions = {};
  Object.defineProperties(accessorOptions, {
    receipt: {
      enumerable: true,
      get() {
        getterCalls += 1;
        return serialized;
      },
    },
    repositoryRoot: {
      enumerable: true,
      value: fixture.repositoryRoot,
    },
    contractBytes: {
      enumerable: true,
      value: fixture.contractBytes,
    },
  });
  const detached = Buffer.allocUnsafeSlow(fixture.contractBytes.length);
  fixture.contractBytes.copy(detached);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const shared = Buffer.from(
    new SharedArrayBuffer(fixture.contractBytes.length),
  );
  const foreignPrototypeBuffer = Buffer.from(fixture.contractBytes);
  Object.setPrototypeOf(
    foreignPrototypeBuffer,
    Object.create(Buffer.prototype),
  );
  const validOptions = {
    receipt: serialized,
    repositoryRoot: fixture.repositoryRoot,
    contractBytes: fixture.contractBytes,
  };
  const symbolicOptions = { ...validOptions };
  Object.defineProperty(symbolicOptions, Symbol("extra"), {
    enumerable: true,
    value: true,
  });
  const invalid = [
    accessorOptions,
    new Proxy(validOptions, {}),
    symbolicOptions,
    {
      receipt: serialized,
      contractBytes: fixture.contractBytes,
      repositoryRoot: fixture.repositoryRoot,
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
    },
    {
      ...validOptions,
      extra: true,
    },
    {
      receipt: Buffer.from(serialized),
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: fixture.contractBytes,
    },
    {
      receipt: " ".repeat(64 * 1024 * 1024 + 1),
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: fixture.contractBytes,
    },
    {
      receipt: serialized,
      repositoryRoot: "relative/repository",
      contractBytes: fixture.contractBytes,
    },
    {
      receipt: serialized,
      repositoryRoot: `${fixture.repositoryRoot}\0suffix`,
      contractBytes: fixture.contractBytes,
    },
    {
      receipt: serialized,
      repositoryRoot: `/${"a".repeat(4096)}`,
      contractBytes: fixture.contractBytes,
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: new Uint8Array(fixture.contractBytes),
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: new Proxy(fixture.contractBytes, {}),
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: foreignPrototypeBuffer,
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: shared,
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: detached,
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: Buffer.alloc(0),
    },
    {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: Buffer.alloc(4 * 1024 * 1024 + 1),
    },
  ];

  for (const options of invalid) {
    await assert.rejects(
      controller.replay(gateRequest, options),
      assertReplayFailure,
    );
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(events, Array(invalid.length).fill("authorize"));
});

test("replay copies contract bytes before the first asynchronous boundary", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const bytes = Buffer.from(fixture.contractBytes);
  const events = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    exactOperations(events, (_request, grant) => grant),
  );
  const replay = controller.replay(gateRequest, {
    receipt: serialized,
    repositoryRoot: fixture.repositoryRoot,
    contractBytes: bytes,
  });
  bytes.fill(0);

  const replayed = await replay;
  assert.equal(replayed.receiptSha256, fixture.receipt.receiptSha256);
  assert.equal(events.at(-1), "releaseTemporaryRoot");
});

function lifecycleOperations(fixture, events, options = {}) {
  const parsed = parseTaskContractBytesV2(fixture.contractBytes);
  const taskContext = fixture.receipt.taskV2.taskContext;
  const exactWorkerContext = JSON.parse(
    fixture.receipt.nativeInvocations[0].taskJson,
  ).context;
  const exactCandidate = fixture.receipt.taskV2.candidate;
  const candidate = options.candidateMismatch
    ? Object.freeze({ ...exactCandidate, tree: parsed.contract.baseline.tree })
    : exactCandidate;
  const handle = Object.hasOwn(options, "handle")
    ? options.handle
    : Object.freeze(Object.create(null));
  const identity = (path, inode, override = {}) =>
    Object.freeze({
      path,
      realpath: path,
      device: "1",
      inode,
      mode: 0o700,
      uid: process.geteuid(),
      gid: process.getegid(),
      directory: true,
      symbolicLink: false,
      ...override,
    });
  const owner = identity(lifecycleTemporaryOwner, "1", options.ownerIdentity);
  const root = identity(lifecycleTemporaryRoot, "2", options.rootIdentity);
  const home = identity(
    join(lifecycleTemporaryRoot, "git-home"),
    "3",
    options.homeIdentity,
  );
  return {
    authorize(_request, grant) {
      events.push("authorize");
      return grant;
    },
    parseContract() {
      events.push("parseContract");
      return parsed;
    },
    async realpath() {
      events.push("realpath");
      return options.canonicalRoot ?? fixture.repositoryRoot;
    },
    async acquireTemporaryRoot() {
      events.push("acquireTemporaryRoot");
      if (options.acquireFailure) throw new Error("acquire failure detail");
      return handle;
    },
    async describeTemporaryRoot(observedHandle) {
      events.push("describeTemporaryRoot");
      options.describedHandles?.push(observedHandle);
      if (options.describeFailure) throw new Error("describe failure detail");
      return Object.hasOwn(options, "leaseValue")
        ? options.leaseValue
        : Object.freeze({ owner, root });
    },
    async createGitHome(observedHandle) {
      events.push("createGitHome");
      options.homeHandles?.push(observedHandle);
      if (options.homeFailure) throw new Error("home failure detail");
      return home;
    },
    async verifyRepository() {
      events.push("verifyRepository");
      return fixture.receipt.taskV2.repository;
    },
    async loadTree() {
      events.push("loadTree");
      return Object.freeze({});
    },
    async readBlob() {
      events.push("readBlob");
      throw new Error("unexpected readBlob call");
    },
    async createContext() {
      events.push("createContext");
      return exactWorkerContext;
    },
    assertSealedContext() {
      events.push("assertSealedContext");
      return Object.freeze({ taskSha256: taskContext.taskSha256 });
    },
    async reconstructCandidate() {
      events.push("reconstructCandidate");
      return candidate;
    },
    async disposeCandidate() {
      events.push("disposeCandidate");
      if (options.disposeFailure) throw new Error("dispose failure detail");
    },
    async releaseTemporaryRoot(observedHandle) {
      events.push("releaseTemporaryRoot");
      options.releasedHandles?.push(observedHandle);
      if (options.releaseFailure) throw new Error("release failure detail");
      return Object.hasOwn(options, "releaseResult")
        ? options.releaseResult
        : Object.freeze({ status: "removed" });
    },
  };
}

test("v7 replay cleans candidate then temporary root exactly once", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const releasedHandles = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    lifecycleOperations(fixture, events, { releasedHandles }),
  );

  const replayed = await controller.replay(gateRequest, {
    receipt: serialized,
    repositoryRoot: fixture.repositoryRoot,
    contractBytes: fixture.contractBytes,
  });
  assert.equal(replayed.receiptSha256, fixture.receipt.receiptSha256);
  assert.equal(events.filter((item) => item === "disposeCandidate").length, 1);
  assert.equal(
    events.filter((item) => item === "releaseTemporaryRoot").length,
    1,
  );
  assert.deepEqual(events.slice(-2), [
    "disposeCandidate",
    "releaseTemporaryRoot",
  ]);
  assert.equal(releasedHandles.length, 1);
  assert.equal(Object.isFrozen(releasedHandles[0]), true);
  assert.equal(Object.getPrototypeOf(releasedHandles[0]), null);
  assert.deepEqual(Reflect.ownKeys(releasedHandles[0]), []);
});

test("a released owner handle cannot be reused or released twice", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const operations = exactOperations(events, (_request, grant) => grant);
  const acquire = operations.acquireTemporaryRoot;
  let handle;
  operations.acquireTemporaryRoot = async (request) => {
    handle = await acquire(request);
    return handle;
  };
  const controller =
    createApplicationReceiptV7PostGateReplayForTesting(operations);
  await controller.replay(gateRequest, {
    receipt: serialized,
    repositoryRoot: fixture.repositoryRoot,
    contractBytes: fixture.contractBytes,
  });

  await assert.rejects(operations.describeTemporaryRoot(handle));
  await assert.rejects(operations.createGitHome(handle));
  await assert.rejects(operations.releaseTemporaryRoot(handle));
});

test("v7 replay error digest binds cleanup failures without exposing them", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const run = async (cleanupFails) => {
    const events = [];
    const controller = createApplicationReceiptV7PostGateReplayForTesting(
      lifecycleOperations(fixture, events, {
        candidateMismatch: true,
        disposeFailure: cleanupFails,
        releaseFailure: cleanupFails,
      }),
    );
    let observed;
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      (error) => {
        assertReplayFailure(error);
        observed = error;
        assert.doesNotMatch(error.message, /dispose|remove|failure detail/u);
        assert.doesNotMatch(error.stack, /dispose|remove|failure detail/u);
        return true;
      },
    );
    assert.deepEqual(events.slice(-2), [
      "disposeCandidate",
      "releaseTemporaryRoot",
    ]);
    return observed.detailSha256;
  };

  const primaryOnly = await run(false);
  const withCleanupFailures = await run(true);
  assert.notEqual(primaryOnly, withCleanupFailures);
});

test("an invalid acquired handle is returned to its owner exactly once", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const releasedHandles = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    lifecycleOperations(fixture, events, {
      handle: undefined,
      releasedHandles,
    }),
  );

  await assert.rejects(
    controller.replay(gateRequest, {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: fixture.contractBytes,
    }),
    assertReplayFailure,
  );
  assert.deepEqual(events, [
    "authorize",
    "parseContract",
    "realpath",
    "acquireTemporaryRoot",
    "releaseTemporaryRoot",
  ]);
  assert.deepEqual(releasedHandles, [undefined]);
  assert.equal(events.includes("disposeCandidate"), false);
});

test("a rejected acquisition never fabricates a releasable handle", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const releasedHandles = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    lifecycleOperations(fixture, events, {
      acquireFailure: true,
      releasedHandles,
    }),
  );

  await assert.rejects(
    controller.replay(gateRequest, {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: fixture.contractBytes,
    }),
    assertReplayFailure,
  );
  assert.equal(events.includes("releaseTemporaryRoot"), false);
  assert.deepEqual(releasedHandles, []);
});

test("the reference owner removes state when acquisition fails mid-creation", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  let ownerPath;
  const operations = exactOperations(events, (_request, grant) => grant, {
    afterRootCreated: ({ ownerPath: createdOwnerPath }) => {
      ownerPath = createdOwnerPath;
      throw new Error("injected acquisition failure");
    },
  });
  const controller =
    createApplicationReceiptV7PostGateReplayForTesting(operations);

  await assert.rejects(
    controller.replay(gateRequest, {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: fixture.contractBytes,
    }),
    assertReplayFailure,
  );
  assert.equal(events.includes("releaseTemporaryRoot"), false);
  assert.notEqual(ownerPath, undefined);
  await assert.rejects(lstat(ownerPath), { code: "ENOENT" });
});

test("the reference owner retains and recovers an uncertain acquisition", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  let ownerPath;
  let cleanupAttempts = 0;
  const temporaryOwner = exactTemporaryOwner(events, {
    afterRootCreated: ({ ownerPath: createdOwnerPath }) => {
      ownerPath = createdOwnerPath;
      throw new Error("injected acquisition failure");
    },
    cleanupAfterAcquisitionFailure: async (observedOwnerPath) => {
      cleanupAttempts += 1;
      assert.equal(observedOwnerPath, ownerPath);
      throw new Error("injected acquisition cleanup failure");
    },
  });
  const operations = exactOperations(
    events,
    (_request, grant) => grant,
    undefined,
    temporaryOwner,
  );
  const controller =
    createApplicationReceiptV7PostGateReplayForTesting(operations);

  try {
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      assertReplayFailure,
    );
    assert.equal(events.includes("releaseTemporaryRoot"), false);
    assert.equal(cleanupAttempts, 1);
    assert.notEqual(ownerPath, undefined);

    const retained =
      temporaryOwner.retainedAcquisitionStateForTesting(ownerPath);
    assert.notEqual(retained, null);
    assert.equal(retained.status, "uncertain");
    assert.equal(retained.ownerPath, ownerPath);
    assert.equal(retained.rootPath, join(ownerPath, "active"));
    assert.equal(
      sameDirectoryIdentity(
        await inspectDirectoryIdentity(retained.ownerPath),
        retained.ownerIdentity,
      ),
      true,
    );
    assert.equal(
      sameDirectoryIdentity(
        await inspectDirectoryIdentity(retained.rootPath),
        retained.rootIdentity,
      ),
      true,
    );

    assert.deepEqual(
      await temporaryOwner.recoverRetainedAcquisitionForTesting(ownerPath),
      { status: "removed" },
    );
    assert.equal(
      temporaryOwner.retainedAcquisitionStateForTesting(ownerPath),
      null,
    );
    await assert.rejects(lstat(ownerPath), { code: "ENOENT" });
  } finally {
    if (ownerPath !== undefined) {
      await rm(ownerPath, { recursive: true, force: true });
    }
  }
});

test("non-canonical repository realpaths fail before temporary state", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const invalidRoots = [
    "/",
    tmpdir(),
    "relative/repository",
    `${fixture.repositoryRoot}\0suffix`,
    `${fixture.repositoryRoot}/child/..`,
  ];

  for (const canonicalRoot of invalidRoots) {
    const events = [];
    const operations = lifecycleOperations(fixture, events, { canonicalRoot });
    const controller =
      createApplicationReceiptV7PostGateReplayForTesting(operations);
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      assertReplayFailure,
    );
    assert.deepEqual(events, ["authorize", "parseContract", "realpath"]);
  }
});

test("temporary-root and Git-home identity violations fail closed", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const otherUid = process.geteuid() === 0 ? 1 : 0;
  let leaseGetterCalls = 0;
  let identityProxyTraps = 0;
  const identityProxy = new Proxy(
    {},
    {
      get() {
        identityProxyTraps += 1;
        throw new Error("identity proxy must not run");
      },
      getPrototypeOf() {
        identityProxyTraps += 1;
        throw new Error("identity proxy must not run");
      },
      ownKeys() {
        identityProxyTraps += 1;
        throw new Error("identity proxy must not run");
      },
    },
  );
  const accessorLease = {};
  Object.defineProperties(accessorLease, {
    owner: {
      enumerable: true,
      get() {
        leaseGetterCalls += 1;
        throw new Error("lease getter must not run");
      },
    },
    root: {
      enumerable: true,
      value: null,
    },
  });
  const cases = [
    {
      name: "describe throws",
      options: { describeFailure: true },
    },
    {
      name: "proxied lease",
      options: { leaseValue: new Proxy(Object.freeze({}), {}) },
    },
    {
      name: "malformed lease",
      options: { leaseValue: Object.freeze({ owner: null, root: null }) },
    },
    {
      name: "accessor lease",
      options: { leaseValue: accessorLease },
    },
    {
      name: "proxied owner identity",
      options: {
        leaseValue: Object.freeze({ owner: identityProxy, root: null }),
      },
    },
    {
      name: "wrong owner name",
      options: {
        ownerIdentity: {
          path: join(tmpdir(), "other-receipt-owner-ABC123"),
          realpath: join(tmpdir(), "other-receipt-owner-ABC123"),
        },
      },
    },
    {
      name: "owner mode",
      options: { ownerIdentity: { mode: 0o755 } },
    },
    {
      name: "owner symlink",
      options: { ownerIdentity: { symbolicLink: true } },
    },
    {
      name: "owner uid",
      options: { ownerIdentity: { uid: otherUid } },
    },
    {
      name: "root device",
      options: { rootIdentity: { device: "2" } },
    },
    {
      name: "root aliases owner inode",
      options: { rootIdentity: { inode: "1" } },
    },
    {
      name: "root realpath",
      options: {
        rootIdentity: { realpath: `${lifecycleTemporaryRoot}-different` },
      },
    },
    {
      name: "lease contains repository",
      options: {
        canonicalRoot: join(lifecycleTemporaryRoot, "repository"),
      },
    },
    {
      name: "Git home escape",
      options: {
        homeIdentity: {
          path: join(tmpdir(), "outside-git-home"),
          realpath: join(tmpdir(), "outside-git-home"),
        },
      },
    },
    {
      name: "Git home symlink",
      options: { homeIdentity: { symbolicLink: true } },
    },
    {
      name: "Git home device",
      options: { homeIdentity: { device: "2" } },
    },
    {
      name: "Git home owner",
      options: { homeIdentity: { uid: otherUid } },
    },
  ];

  for (const scenario of cases) {
    const events = [];
    const controller = createApplicationReceiptV7PostGateReplayForTesting(
      lifecycleOperations(fixture, events, scenario.options),
    );
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      assertReplayFailure,
      scenario.name,
    );
    assert.equal(
      events.filter((event) => event === "releaseTemporaryRoot").length,
      1,
      scenario.name,
    );
    assert.equal(events.includes("reconstructCandidate"), false, scenario.name);
  }
  assert.equal(leaseGetterCalls, 0);
  assert.equal(identityProxyTraps, 0);
});

test("temporary-owner release failure is terminal after candidate disposal", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    lifecycleOperations(fixture, events, {
      releaseFailure: true,
    }),
  );

  await assert.rejects(
    controller.replay(gateRequest, {
      receipt: serialized,
      repositoryRoot: fixture.repositoryRoot,
      contractBytes: fixture.contractBytes,
    }),
    assertReplayFailure,
  );
  assert.equal(events.includes("disposeCandidate"), true);
  assert.equal(events.includes("releaseTemporaryRoot"), true);
  assert.deepEqual(events.slice(-2), [
    "disposeCandidate",
    "releaseTemporaryRoot",
  ]);
});

test("temporary-owner release requires one exact frozen completion", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const invalidResults = [
    { status: "removed" },
    Object.freeze({ status: "retained" }),
    Object.freeze({ status: "removed", extra: true }),
    new Proxy(Object.freeze({ status: "removed" }), {}),
  ];
  for (const releaseResult of invalidResults) {
    const events = [];
    const controller = createApplicationReceiptV7PostGateReplayForTesting(
      lifecycleOperations(fixture, events, { releaseResult }),
    );
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      assertReplayFailure,
    );
    assert.deepEqual(events.slice(-2), [
      "disposeCandidate",
      "releaseTemporaryRoot",
    ]);
  }
});

test("the owner refuses to remove a root replaced before release", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  let lease;
  let displaced;
  const operations = exactOperations(events, (_request, grant) => grant);
  const describe = operations.describeTemporaryRoot;
  operations.describeTemporaryRoot = async (handle) => {
    lease = await describe(handle);
    return lease;
  };
  const dispose = operations.disposeCandidate;
  operations.disposeCandidate = async (candidate) => {
    await dispose(candidate);
    displaced = join(lease.owner.path, "displaced");
    await rename(lease.root.path, displaced);
    await mkdir(lease.root.path, { mode: 0o700 });
  };
  const controller =
    createApplicationReceiptV7PostGateReplayForTesting(operations);
  try {
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      assertReplayFailure,
    );
    assert.equal(events.at(-1), "releaseTemporaryRoot");
    assert.equal((await lstat(lease.root.path)).isDirectory(), true);
    assert.equal((await lstat(displaced)).isDirectory(), true);
  } finally {
    if (lease !== undefined) {
      await rm(dirname(lease.root.path), { recursive: true, force: true });
    }
  }
});

test("the owner refuses to remove a root swapped during quarantine", async () => {
  const fixture = await exactFixture();
  const serialized = await frozenSerializedPromise;
  const events = [];
  let ownerPath;
  let displaced;
  let quarantine;
  const operations = exactOperations(events, (_request, grant) => grant, {
    beforeQuarantine: async (lease) => {
      ownerPath = lease.ownerPath;
      displaced = join(ownerPath, "displaced");
      quarantine = join(ownerPath, "quarantine");
      await rename(lease.rootPath, displaced);
      await mkdir(lease.rootPath, { mode: 0o700 });
    },
  });
  const controller =
    createApplicationReceiptV7PostGateReplayForTesting(operations);
  try {
    await assert.rejects(
      controller.replay(gateRequest, {
        receipt: serialized,
        repositoryRoot: fixture.repositoryRoot,
        contractBytes: fixture.contractBytes,
      }),
      assertReplayFailure,
    );
    assert.equal(events.at(-1), "releaseTemporaryRoot");
    assert.equal((await lstat(quarantine)).isDirectory(), true);
    assert.equal((await lstat(displaced)).isDirectory(), true);
  } finally {
    if (ownerPath !== undefined) {
      await rm(ownerPath, { recursive: true, force: true });
    }
  }
});

test("structural application receipts retain a pure import boundary", async () => {
  const source = await readFile(
    new URL("../src/receipts/application.mjs", import.meta.url),
    "utf8",
  );
  const imports = [
    ...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gmu),
  ].map(([, specifier]) => specifier);
  assert.equal(
    imports.some(
      (specifier) =>
        specifier.startsWith("node:fs") ||
        specifier === "node:child_process" ||
        specifier.startsWith("../candidate/") ||
        specifier === "../contract-v2.mjs" ||
        specifier.startsWith("../runtime/"),
    ),
    false,
  );
});
