import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { fstatSync } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256,
} from "../src/qualification/benchmark-owner-contract.mjs";
import { loadG17Contract } from "../src/qualification/contract.mjs";
import { loadG17ControlProtocol } from "../src/qualification/control-protocol.mjs";
import {
  buildG17NativeSnapshotHelper,
  closeG17NativeSnapshotHelper,
} from "../src/qualification/native-snapshot.mjs";
import {
  G17ProductSourceWorkspaceFault,
  beginG17ProductSourceBuild,
  createG17ProductSourceGateForTesting,
  createG17ProductSourceGateWithHooksForTesting,
  createG17ProductSourceProductionGate,
  createG17ProductSourceWorkspace,
  destroyG17ProductSourceWorkspace,
  finishG17ProductSourceBuild,
  finishG17ProductSourceBuildForTesting,
  g17ProductSourceBuildInputs,
  g17ProductSourceWorkspacePathsForTesting,
  mintG17ProductSourceCompletedReapProofForTesting,
  verifyG17ProductSourceWorkspace,
} from "../src/qualification/product-source-workspace.mjs";
import {
  GitProcessFault,
  runGit,
  runGitWithProcessRunnerForTesting,
} from "../src/candidate/git.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
let helperRoot;
let cleanupHelper;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function approvedAuthorizationBytes() {
  const { contract } = loadG17Contract();
  const protocol = loadG17ControlProtocol({ contract });
  const authorization = structuredClone(protocol.authorization);
  authorization.status = "CONTROL_AUTHORIZED";
  authorization.approval = {
    status: "APPROVED",
    approvedBy: "product-source-workspace-test-reviewer",
    approvedAt: "2026-08-28T00:00:00.000Z",
  };
  const { contentHash: ignored, ...unsigned } = authorization;
  authorization.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(authorization)}\n`, "utf8");
}

async function fixture(t, name) {
  const parent = await mkdtemp(join(tmpdir(), `g17-product-source-${name}-`));
  const root = join(parent, "workspace");
  await mkdir(root, { mode: 0o700 });
  t.after(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(parent, { recursive: true, force: true });
  });
  return { parent, root };
}

async function testGate(root, buildId = "negative-control", overrides = {}) {
  return createG17ProductSourceGateForTesting({
    authorizationBytes: approvedAuthorizationBytes(),
    cleanupHelper,
    repoRoot: repositoryRoot,
    workspaceRoot: root,
    controlRunId: "g17-control-source-test",
    buildId,
    signal: undefined,
    ...overrides,
  });
}

async function hookedTestGate(root, hooks = {}) {
  return createG17ProductSourceGateWithHooksForTesting({
    authorizationBytes: approvedAuthorizationBytes(),
    cleanupHelper,
    repoRoot: repositoryRoot,
    workspaceRoot: root,
    controlRunId: "g17-control-source-hook-test",
    buildId: "negative-control",
    signal: undefined,
    gitRunner: runGit,
    afterChildMkdir: undefined,
    beforeReady: undefined,
    ...hooks,
  });
}

async function workspace(t, name, buildId = "negative-control") {
  const paths = await fixture(t, name);
  const gate = await testGate(paths.root, buildId);
  return {
    ...paths,
    gate,
    workspace: await createG17ProductSourceWorkspace(gate),
  };
}

async function finishTestBuild(capability) {
  const proof = mintG17ProductSourceCompletedReapProofForTesting(capability);
  return finishG17ProductSourceBuildForTesting(capability, proof);
}

async function objectInventory(root = join(repositoryRoot, ".git", "objects")) {
  const rootMetadata = await lstat(root, { bigint: true });
  const records = [
    {
      path: "",
      mode: rootMetadata.mode.toString(),
      inode: rootMetadata.ino.toString(),
      size: rootMetadata.size.toString(),
      mtimeNs: rootMetadata.mtimeNs.toString(),
      ctimeNs: rootMetadata.ctimeNs.toString(),
    },
  ];
  async function walk(directory, prefix = "") {
    const names = await readdir(directory);
    names.sort();
    for (const name of names) {
      const path = join(directory, name);
      const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      const metadata = await lstat(path, { bigint: true });
      records.push({
        path: relativePath,
        mode: metadata.mode.toString(),
        inode: metadata.ino.toString(),
        size: metadata.size.toString(),
        mtimeNs: metadata.mtimeNs.toString(),
        ctimeNs: metadata.ctimeNs.toString(),
      });
      if (metadata.isDirectory()) await walk(path, relativePath);
    }
  }
  await walk(root);
  return canonicalSha256(records);
}

async function waitForPath(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await lstat(path).then(() => true).catch(() => false)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function assertWorkspaceProjectionShape(workspaceProjection) {
  assert.deepEqual(Object.keys(workspaceProjection).sort(), [
    "generation",
    "isolated",
    "parentRoot",
    "sourceChild",
    "sourceReadOnlyAtBuildStart",
    "targetChild",
    "targetEmptyAtBuildStart",
    "targetGeneration",
    "targetIsolated",
  ]);
  assert.match(workspaceProjection.generation, /^g17-workspace-[0-9a-f]{64}$/u);
  assert.match(workspaceProjection.targetGeneration, /^g17-target-[0-9a-f]{64}$/u);
  assert.ok(workspaceProjection.generation.length <= 128);
  assert.ok(workspaceProjection.targetGeneration.length <= 128);
  assert.deepEqual(Object.keys(workspaceProjection.parentRoot).sort(), [
    "device",
    "filesystemType",
    "gid",
    "inode",
    "uid",
  ]);
  for (const field of ["device", "inode", "uid", "gid"]) {
    assert.match(workspaceProjection.parentRoot[field], /^[0-9]+$/u);
  }
  assert.match(workspaceProjection.parentRoot.filesystemType, /^-?[0-9]+$/u);
  for (const [field, leafName] of [
    ["sourceChild", "source"],
    ["targetChild", "target"],
  ]) {
    const child = workspaceProjection[field];
    assert.deepEqual(Object.keys(child).sort(), [
      "device",
      "filesystemType",
      "gid",
      "inode",
      "leafName",
      "parentDevice",
      "parentInode",
      "uid",
    ]);
    assert.equal(child.leafName, leafName);
    assert.equal(child.parentDevice, workspaceProjection.parentRoot.device);
    assert.equal(child.parentInode, workspaceProjection.parentRoot.inode);
    assert.equal(child.device, workspaceProjection.parentRoot.device);
    for (const identityField of [
      "device",
      "inode",
      "uid",
      "gid",
      "parentDevice",
      "parentInode",
    ]) {
      assert.match(child[identityField], /^[0-9]+$/u);
    }
    assert.match(child.filesystemType, /^-?[0-9]+$/u);
  }
}

test.before(async () => {
  helperRoot = await mkdtemp(join(tmpdir(), "g17-product-source-helper-"));
  cleanupHelper = await buildG17NativeSnapshotHelper({
    outputDirectory: helperRoot,
    signal: undefined,
  });
});

test.after(async () => {
  if (cleanupHelper !== undefined) {
    await closeG17NativeSnapshotHelper(cleanupHelper);
  }
  if (helperRoot !== undefined) await rm(helperRoot, { recursive: true, force: true });
});

test("production proposed authorization fails before workspace filesystem creation", async () => {
  const absent = join(tmpdir(), `g17-product-source-proposed-${process.pid}`);
  await rm(absent, { recursive: true, force: true });
  await assert.rejects(
    createG17ProductSourceProductionGate({
      platform: undefined,
      workspaceRoot: absent,
      controlRunId: "g17-control-proposed",
      buildId: "negative-control",
      signal: undefined,
    }),
    (error) =>
      error instanceof G17ProductSourceWorkspaceFault &&
      error.phase === "preflight",
  );
  await assert.rejects(lstat(absent), { code: "ENOENT" });
});

test("test-only approval gate binds exact canonical authorization bytes", async (t) => {
  const { root } = await fixture(t, "authorization-bytes");
  const bytes = approvedAuthorizationBytes();
  assert.equal(
    canonicalSha256(JSON.parse(bytes).protocol),
    G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256,
  );
  for (const forged of [
    Buffer.concat([bytes, Buffer.from("\n")]),
    Buffer.from(bytes.toString("utf8").replace('"APPROVED"', '"REJECTED"')),
    Buffer.alloc(128 * 1024 + 1, 0x61),
  ]) {
    await assert.rejects(
      testGate(root, "negative-control", { authorizationBytes: forged }),
      (error) =>
        error instanceof G17ProductSourceWorkspaceFault &&
        error.phase === "preflight",
    );
  }
});

test("gate captures bounded authority and ignores inert baggage without observation", async (t) => {
  const { root } = await fixture(t, "gate-descriptors");
  const base = {
    authorizationBytes: approvedAuthorizationBytes(),
    cleanupHelper,
    repoRoot: repositoryRoot,
    workspaceRoot: root,
    controlRunId: "g17-control-gate-descriptors",
    buildId: "negative-control",
    signal: undefined,
  };
  let accessorInvoked = false;
  const accessor = { ...base };
  Object.defineProperty(accessor, "buildId", {
    enumerable: true,
    get() {
      accessorInvoked = true;
      return "negative-control";
    },
  });
  await assert.rejects(
    createG17ProductSourceGateForTesting(accessor),
    /own data field/u,
  );
  assert.equal(accessorInvoked, false);
  await assert.rejects(
    createG17ProductSourceGateForTesting(new Proxy(base, {})),
    /non-proxy record/u,
  );
  const baggage = { ...base };
  const baggageSymbol = Symbol("extra");
  Object.defineProperty(baggage, baggageSymbol, {
    get() {
      accessorInvoked = true;
      throw new Error("symbol baggage getter must not run");
    },
  });
  Object.defineProperty(baggage, "hidden", {
    get() {
      accessorInvoked = true;
      throw new Error("hidden baggage getter must not run");
    },
  });
  await createG17ProductSourceGateForTesting(baggage);
  assert.equal(accessorInvoked, false);
  await assert.rejects(
    createG17ProductSourceGateForTesting({ ...base, extra: true }),
    /unknown authoritative field/u,
  );
  const controller = new AbortController();
  await assert.rejects(
    testGate(root, "negative-control", {
      signal: new Proxy(controller.signal, {}),
    }),
    /genuine native AbortSignal/u,
  );
  await assert.rejects(
    testGate(root, "negative-control", {
      signal: Object.create(AbortSignal.prototype),
    }),
    /native brand check/u,
  );
  let getterInvoked = false;
  const ownGetterController = new AbortController();
  const ownGetterSignal = ownGetterController.signal;
  Object.defineProperty(ownGetterSignal, "aborted", {
    configurable: true,
    get() {
      getterInvoked = true;
      return false;
    },
  });
  Object.defineProperty(ownGetterSignal, Symbol("ignored signal baggage"), {
    get() {
      getterInvoked = true;
      throw new Error("signal baggage getter must not run");
    },
  });
  ownGetterController.abort();
  const ownGetterGate = await testGate(root, "negative-control", {
    signal: ownGetterSignal,
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(ownGetterGate),
    /work was cancelled/u,
  );
  assert.equal(getterInvoked, false);
  assert.equal(getEventListeners(ownGetterSignal, "abort").length, 0);
  const prototypeGetterSignal = new AbortController().signal;
  Object.setPrototypeOf(
    prototypeGetterSignal,
    Object.create(AbortSignal.prototype, {
      aborted: {
        get() {
          getterInvoked = true;
          return false;
        },
      },
    }),
  );
  await assert.rejects(
    testGate(root, "negative-control", { signal: prototypeGetterSignal }),
    /not a native AbortSignal/u,
  );
  assert.equal(getterInvoked, false);
});

test("work-signal leases do not accumulate across repeated gate and acquisition failures", async (t) => {
  const { root } = await fixture(t, "work-signal-lease");
  const controller = new AbortController();
  const baseline = getEventListeners(controller.signal, "abort").length;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await assert.rejects(
      testGate(root, "negative-control", {
        cleanupHelper: Object.freeze({}),
        signal: controller.signal,
      }),
      /snapshot helper is not live/u,
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, baseline);
  }

  const dormantGates = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    dormantGates.push(
      await testGate(root, "negative-control", { signal: controller.signal }),
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, baseline);
  }
  assert.equal(dormantGates.length, 16);

  const sentinel = join(root, "preexisting");
  await writeFile(sentinel, "forces root admission failure\n", { mode: 0o600 });
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const gate = await testGate(root, "negative-control", {
      signal: controller.signal,
    });
    assert.equal(getEventListeners(controller.signal, "abort").length, baseline);
    const acquisition = createG17ProductSourceWorkspace(gate);
    assert.equal(
      getEventListeners(controller.signal, "abort").length,
      baseline + 1,
    );
    await assert.rejects(
      acquisition,
      /workspace root is not empty/u,
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, baseline);
  }
  await rm(sentinel);

  const gate = await testGate(root, "negative-control", {
    signal: controller.signal,
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, baseline);
  const acquisition = createG17ProductSourceWorkspace(gate);
  assert.equal(
    getEventListeners(controller.signal, "abort").length,
    baseline + 1,
  );
  const acquired = await acquisition;
  assert.equal(getEventListeners(controller.signal, "abort").length, baseline);
  controller.abort();
  await verifyG17ProductSourceWorkspace(acquired);
  await destroyG17ProductSourceWorkspace(acquired);
});

test("authorization snapshot rejects oversized arrays and excessive depth", async (t) => {
  const { root } = await fixture(t, "authorization-snapshot-limits");
  const variants = [];
  const oversized = JSON.parse(approvedAuthorizationBytes());
  oversized.protocol.products = Array(10_001).fill(null);
  variants.push(oversized);
  const deep = JSON.parse(approvedAuthorizationBytes());
  let cursor = deep.approval;
  for (let depth = 0; depth < 70; depth += 1) {
    cursor.nested = {};
    cursor = cursor.nested;
  }
  variants.push(deep);
  for (const authorization of variants) {
    const { contentHash: ignored, ...unsigned } = authorization;
    authorization.contentHash = canonicalSha256(unsigned);
    const bytes = Buffer.from(`${canonicalJson(authorization)}\n`, "utf8");
    assert.ok(bytes.length < 128 * 1024);
    await assert.rejects(
      testGate(root, "negative-control", { authorizationBytes: bytes }),
      (error) =>
        error instanceof G17ProductSourceWorkspaceFault &&
        error.phase === "preflight",
    );
  }
});

test("gate owns authorization bytes and max-length run ids derive bounded generations", async (t) => {
  const { root } = await fixture(t, "max-run-id");
  const authorizationBytes = approvedAuthorizationBytes();
  const expectedRawSha256 = sha256(authorizationBytes);
  const gatePromise = createG17ProductSourceGateForTesting({
    authorizationBytes,
    cleanupHelper,
    repoRoot: repositoryRoot,
    workspaceRoot: root,
    controlRunId: "a".repeat(128),
    buildId: "negative-control",
    signal: undefined,
  });
  authorizationBytes.fill(0);
  const gate = await gatePromise;
  const acquired = await createG17ProductSourceWorkspace(gate);
  const projection = await verifyG17ProductSourceWorkspace(acquired);
  assert.equal(projection.authorization.rawSha256, expectedRawSha256);
  assertWorkspaceProjectionShape(projection.workspace);
  await destroyG17ProductSourceWorkspace(acquired);
});

test("post-acquisition composition failure deletes only generated children", async (t) => {
  const { parent, root } = await fixture(t, "acquisition-cleanup");
  const fakeRepository = join(parent, "fake-repository");
  await mkdir(fakeRepository, { mode: 0o700 });
  const gate = await testGate(root, "negative-control", {
    repoRoot: fakeRepository,
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    (error) => error instanceof G17ProductSourceWorkspaceFault,
  );
  assert.deepEqual(await readdir(root), []);
  assert.deepEqual(await readdir(fakeRepository), []);
});

test("a fail-after-mkdir child is repinned through the held root and cleaned", async (t) => {
  const { root } = await fixture(t, "child-mkdir-gap");
  let injected = false;
  const gate = await hookedTestGate(root, {
    afterChildMkdir(name) {
      if (name === "source" && !injected) {
        injected = true;
        throw new Error("synthetic failure after child mkdir");
      }
    },
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    /synthetic failure after child mkdir/u,
  );
  assert.equal(injected, true);
  assert.deepEqual(await readdir(root), []);
});

test("an unreaped Git outcome preserves held workspace bytes and forbids destroy", async (t) => {
  const { root } = await fixture(t, "unreaped-git");
  const sentinel = join(root, "control", "unreaped-sentinel");
  const outcome = Object.freeze({
    exitCode: null,
    signal: null,
    disposition: "cancelled-unreaped",
    stdout: "",
    stderr: "synthetic unreaped process tree",
    durationMs: 2_000,
    terminationErrors: Object.freeze([]),
  });
  const gitRunner = (input) =>
    runGitWithProcessRunnerForTesting(input, async () => {
      await writeFile(sentinel, "must remain linked\n", {
        flag: "wx",
        mode: 0o600,
      });
      return outcome;
    });
  const gate = await hookedTestGate(root, { gitRunner });
  let acquisitionError;
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    (error) => {
      acquisitionError = error;
      return (
        error instanceof G17ProductSourceWorkspaceFault &&
        error.classification === "INCONCLUSIVE" &&
        error.phase === "process" &&
        error.cause instanceof GitProcessFault &&
        error.cause.disposition === "cancelled-unreaped" &&
        error.cause.outcome === outcome
      );
    },
  );
  assert.ok(acquisitionError);
  assert.equal(await readFile(sentinel, "utf8"), "must remain linked\n");
  assert.deepEqual((await readdir(root)).sort(), ["control", "source", "target"]);
  await assert.rejects(
    destroyG17ProductSourceWorkspace(gate),
    (error) =>
      error instanceof G17ProductSourceWorkspaceFault &&
      error.classification === "INCONCLUSIVE" &&
      error.phase === "cleanup" &&
      /preserved without unlink/u.test(error.message),
  );
  assert.equal(await readFile(sentinel, "utf8"), "must remain linked\n");
});

test("an unreaped submodule checkout retains every temporary inherited handle", async (t) => {
  const { root } = await fixture(t, "unreaped-submodule-handles");
  let checkoutCount = 0;
  let baseDescriptorCount;
  let retainedDescriptors;
  const outcome = Object.freeze({
    exitCode: null,
    signal: null,
    disposition: "timeout-unreaped",
    stdout: "",
    stderr: "synthetic unreaped submodule checkout",
    durationMs: 2_000,
    terminationErrors: Object.freeze([]),
  });
  const gitRunner = (input) => {
    if (input.args.includes("checkout-index")) {
      checkoutCount += 1;
      if (checkoutCount === 1) {
        baseDescriptorCount = input.inheritedFileDescriptors.length;
      } else if (checkoutCount === 2) {
        retainedDescriptors = [...input.inheritedFileDescriptors];
        return runGitWithProcessRunnerForTesting(input, async () => outcome);
      }
    }
    return runGit(input);
  };
  const gate = await hookedTestGate(root, { gitRunner });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    (error) =>
      error instanceof G17ProductSourceWorkspaceFault &&
      error.phase === "process" &&
      error.cause instanceof GitProcessFault &&
      error.cause.disposition === "timeout-unreaped",
  );
  assert.equal(checkoutCount, 2);
  assert.ok(retainedDescriptors.length > baseDescriptorCount);
  for (const descriptor of retainedDescriptors) {
    assert.doesNotThrow(() => fstatSync(descriptor));
  }
  await assert.rejects(destroyG17ProductSourceWorkspace(gate), /preserved/u);
  for (const descriptor of retainedDescriptors) {
    assert.doesNotThrow(() => fstatSync(descriptor));
  }

  const ordinaryFixture = await fixture(t, "reaped-submodule-handles");
  let ordinaryCheckoutCount = 0;
  let ordinaryBaseCount;
  let ordinaryTemporaryDescriptors;
  const ordinaryRunner = (input) => {
    if (input.args.includes("checkout-index")) {
      ordinaryCheckoutCount += 1;
      if (ordinaryCheckoutCount === 1) {
        ordinaryBaseCount = input.inheritedFileDescriptors.length;
      } else if (ordinaryCheckoutCount === 2) {
        ordinaryTemporaryDescriptors = input.inheritedFileDescriptors.slice(
          ordinaryBaseCount,
        );
        return runGitWithProcessRunnerForTesting(input, async () =>
          Object.freeze({
            exitCode: 1,
            signal: null,
            disposition: "completed",
            stdout: "",
            stderr: "synthetic ordinary checkout failure",
            durationMs: 1,
            terminationErrors: Object.freeze([]),
          }),
        );
      }
    }
    return runGit(input);
  };
  const ordinaryGate = await hookedTestGate(ordinaryFixture.root, {
    gitRunner: ordinaryRunner,
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(ordinaryGate),
    /synthetic ordinary checkout failure/u,
  );
  assert.equal(ordinaryCheckoutCount, 2);
  assert.ok(ordinaryTemporaryDescriptors.length > 0);
  for (const descriptor of ordinaryTemporaryDescriptors) {
    assert.throws(() => fstatSync(descriptor), { code: "EBADF" });
  }
  assert.deepEqual(await readdir(ordinaryFixture.root), []);
});

test("oversized private object admission fails before pack allocation", async (t) => {
  const { root } = await fixture(t, "oversized-private-import");
  let admissionCalls = 0;
  let packCalls = 0;
  const gitRunner = (input) => {
    if (input.args.includes("pack-objects")) packCalls += 1;
    if (
      input.args.includes(
        "--batch-check=%(objectname) %(objecttype) %(objectsize)",
      ) &&
      admissionCalls === 0
    ) {
      admissionCalls += 1;
      return runGitWithProcessRunnerForTesting(input, async (processInput) => {
        const objects = processInput.stdin.trim().split("\n");
        return Object.freeze({
          exitCode: 0,
          signal: null,
          disposition: "completed",
          stdout: `${objects
            .map((object) => `${object} blob ${64 * 1024 * 1024 + 1}`)
            .join("\n")}\n`,
          stderr: "",
          durationMs: 1,
          terminationErrors: Object.freeze([]),
        });
      });
    }
    return runGit(input);
  };
  const gate = await hookedTestGate(root, { gitRunner });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    /private import object exceeds its byte ceiling/u,
  );
  assert.equal(admissionCalls, 1);
  assert.equal(packCalls, 0);
  assert.deepEqual(await readdir(root), []);

  const malformedFixture = await fixture(t, "malformed-private-import");
  let malformedAdmissionCalls = 0;
  let malformedPackCalls = 0;
  const malformedRunner = async (input) => {
    if (input.args.includes("pack-objects")) malformedPackCalls += 1;
    if (
      input.args.includes(
        "--batch-check=%(objectname) %(objecttype) %(objectsize)",
      ) &&
      malformedAdmissionCalls === 0
    ) {
      malformedAdmissionCalls += 1;
      const records = (await runGit(input)).trim().split("\n");
      records[0] = records[0].replace(/ [0-9]+$/u, " 00");
      return `${records.join("\n")}\n`;
    }
    return runGit(input);
  };
  const malformedGate = await hookedTestGate(malformedFixture.root, {
    gitRunner: malformedRunner,
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(malformedGate),
    /private import admission is malformed/u,
  );
  assert.equal(malformedAdmissionCalls, 1);
  assert.equal(malformedPackCalls, 0);
  assert.deepEqual(await readdir(malformedFixture.root), []);
});

test("aggregate closure overflow across root and submodules fails before the first pack", async (t) => {
  const { root } = await fixture(t, "aggregate-private-import");
  let admissionCalls = 0;
  let packCalls = 0;
  const targetPerClosure = 768 * 1024 * 1024;
  const gitRunner = async (input) => {
    if (input.args.includes("pack-objects")) packCalls += 1;
    if (
      input.args.includes(
        "--batch-check=%(objectname) %(objecttype) %(objectsize)",
      )
    ) {
      admissionCalls += 1;
      const output = await runGit(input);
      const records = output.trim().split("\n");
      let remaining = targetPerClosure;
      const rewritten = records.map((record) => {
        const match = /^([0-9a-f]{40}) (blob|tree|commit) [0-9]+$/u.exec(record);
        assert.ok(match);
        const size = Math.min(64 * 1024 * 1024, remaining);
        remaining -= size;
        return `${match[1]} ${match[2]} ${size}`;
      });
      assert.equal(remaining, 0, "fixture closure must contain enough framed objects");
      return `${rewritten.join("\n")}\n`;
    }
    return runGit(input);
  };
  const gate = await hookedTestGate(root, { gitRunner });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    /aggregate private Git import admission exceeds its ceiling/u,
  );
  assert.equal(admissionCalls, 3);
  assert.equal(packCalls, 0);
  assert.deepEqual(await readdir(root), []);
});

test("pre-aborted work fails before creation and does not poison cleanup", async (t) => {
  const { root } = await fixture(t, "pre-abort");
  const controller = new AbortController();
  controller.abort();
  const gate = await testGate(root, "negative-control", {
    signal: controller.signal,
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    (error) =>
      error instanceof G17ProductSourceWorkspaceFault &&
      error.phase === "preflight",
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.deepEqual(await readdir(root), []);
});

test("mid-composition cancellation reaches Git and cleanup uses independent authority", async (t) => {
  const { root } = await fixture(t, "mid-composition-abort");
  const controller = new AbortController();
  const gate = await testGate(root, "negative-control", {
    signal: controller.signal,
  });
  const acquisition = createG17ProductSourceWorkspace(gate);
  acquisition.catch(() => {});
  await waitForPath(join(root, "control", "composition.git"));
  controller.abort();
  await assert.rejects(
    acquisition,
    (error) =>
      error instanceof G17ProductSourceWorkspaceFault &&
      /cancelled/u.test(error.message),
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.deepEqual(await readdir(root), []);
});

test("cancellation at the final publication checkpoint cannot return ready", async (t) => {
  const { root } = await fixture(t, "final-publication-abort");
  const controller = new AbortController();
  let reachedPublication = false;
  const gate = await hookedTestGate(root, {
    signal: controller.signal,
    beforeReady() {
      reachedPublication = true;
      controller.abort();
    },
  });
  await assert.rejects(
    createG17ProductSourceWorkspace(gate),
    (error) =>
      error instanceof G17ProductSourceWorkspaceFault &&
      /work was cancelled/u.test(error.message),
  );
  assert.equal(reachedPublication, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.deepEqual(await readdir(root), []);
});

test("all four roles materialize exact authority-free projections through one-shot builds", async (t) => {
  const projections = [];
  for (const build of G17_BENCHMARK_BUILD_PLAN) {
    const acquired = await workspace(t, build.buildId, build.buildId);
    const projection = await verifyG17ProductSourceWorkspace(acquired.workspace);
    projections.push(projection);
    assert.equal(projection.buildId, build.buildId);
    assert.equal(projection.productRole, build.productRole);
    assert.equal(
      projection.source.effectiveTree,
      projection.evaluator.composition.effectiveTree,
    );
    assert.deepEqual(Object.values(projection.authority), Array(8).fill(false));
    assertWorkspaceProjectionShape(projection.workspace);
    const { contentHash, ...unsigned } = projection;
    assert.equal(contentHash, canonicalSha256(unsigned));

    const beginResults = await Promise.allSettled([
      beginG17ProductSourceBuild(acquired.workspace),
      beginG17ProductSourceBuild(acquired.workspace),
    ]);
    assert.equal(beginResults.filter(({ status }) => status === "fulfilled").length, 1);
    assert.match(
      beginResults.find(({ status }) => status === "rejected").reason.message,
      /more than once/u,
    );
    const capability = beginResults.find(
      ({ status }) => status === "fulfilled",
    ).value;
    const first = g17ProductSourceBuildInputs(capability);
    assert.equal(first.inheritedFileDescriptors.length, 3);
    assert.equal(new Set(first.inheritedFileDescriptors).size, 3);
    assert.equal(first.workspaceRoot, "/proc/self/fd/3");
    assert.equal(first.sourceDirectory, "/proc/self/fd/4");
    assert.equal(first.targetDirectory, "/proc/self/fd/5");
    assert.deepEqual(first.targetCleanupLimits, {
      maxEntries: 500_000,
      maxDepth: 128,
    });
    assert.equal(
      first.buildCompletionBoundary,
      "physical-build-owner-must-prove-exact-child-close-and-reap-before-production-finish/v1",
    );
    const exactBytes = Buffer.from(first.sourceProjectionBytes);
    assert.equal(sha256(exactBytes), first.sourceProjection.rawSha256);
    assert.deepEqual(JSON.parse(exactBytes), projection);
    first.sourceProjectionBytes.fill(0);
    assert.deepEqual(
      g17ProductSourceBuildInputs(capability).sourceProjectionBytes,
      exactBytes,
    );
    await writeFile(
      join(g17ProductSourceWorkspacePathsForTesting(acquired.workspace).targetDirectory, "built"),
      "build output\n",
      { flag: "wx", mode: 0o600 },
    );
    await finishTestBuild(capability);
    assert.throws(() => g17ProductSourceBuildInputs(capability), /not live/u);
    await destroyG17ProductSourceWorkspace(acquired.workspace);
  }
  assert.equal(new Set(projections.map((item) => item.workspace.generation)).size, 4);
  assert.equal(
    projections[2].source.manifestSha256,
    projections[3].source.manifestSha256,
  );
});

test("target preseeding terminalizes the build transition", async (t) => {
  const acquired = await workspace(t, "target-preseed");
  const { targetDirectory } = g17ProductSourceWorkspacePathsForTesting(
    acquired.workspace,
  );
  await writeFile(join(targetDirectory, "preseed"), "forbidden\n", {
    flag: "wx",
    mode: 0o600,
  });
  await assert.rejects(beginG17ProductSourceBuild(acquired.workspace));
  await assert.rejects(verifyG17ProductSourceWorkspace(acquired.workspace), /not verifiable/u);
  await destroyG17ProductSourceWorkspace(acquired.workspace);
});

test("destroy refuses a live build until its outer owner finishes the reaped child boundary", async (t) => {
  const acquired = await workspace(t, "live-build-destroy");
  const capability = await beginG17ProductSourceBuild(acquired.workspace);
  const { targetDirectory } = g17ProductSourceWorkspacePathsForTesting(
    acquired.workspace,
  );
  await writeFile(join(targetDirectory, "live-output"), "still owned\n", {
    flag: "wx",
    mode: 0o600,
  });
  await assert.rejects(
    destroyG17ProductSourceWorkspace(acquired.workspace),
    /terminated and reaped/u,
  );
  await assert.rejects(
    verifyG17ProductSourceWorkspace(acquired.workspace),
    /not verifiable/u,
  );
  assert.equal(
    g17ProductSourceBuildInputs(capability).buildCompletionBoundary,
    "physical-build-owner-must-prove-exact-child-close-and-reap-before-production-finish/v1",
  );
  for (const callerAssertion of [
    { disposition: "completed", reaped: true },
    { disposition: "timeout-unreaped", reaped: false },
    { disposition: "cancelled-unreaped", reaped: false },
  ]) {
    await assert.rejects(
      finishG17ProductSourceBuild(capability, callerAssertion),
      (error) =>
        error instanceof G17ProductSourceWorkspaceFault &&
        error.classification === "MISSING" &&
        /physical-owner child-reap proof/u.test(error.message),
    );
    assert.equal(g17ProductSourceBuildInputs(capability).targetDirectory, "/proc/self/fd/5");
  }
  let proofObservations = 0;
  const forgedProof = new Proxy(
    {},
    {
      get() {
        proofObservations += 1;
        throw new Error("forged proof getter must not run");
      },
    },
  );
  await assert.rejects(
    finishG17ProductSourceBuild(capability, forgedProof),
    /physical-owner child-reap proof/u,
  );
  await assert.rejects(
    finishG17ProductSourceBuildForTesting(capability, forgedProof),
    /test-only child-reap proof is not live/u,
  );
  assert.equal(proofObservations, 0);
  await assert.rejects(
    destroyG17ProductSourceWorkspace(acquired.workspace),
    /terminated and reaped/u,
  );
  await finishTestBuild(capability);
  await destroyG17ProductSourceWorkspace(acquired.workspace);
});

test("test-only reap proofs are one-shot and bound to one exact build", async (t) => {
  const first = await workspace(t, "reap-proof-first");
  const second = await workspace(t, "reap-proof-second");
  const firstCapability = await beginG17ProductSourceBuild(first.workspace);
  const secondCapability = await beginG17ProductSourceBuild(second.workspace);
  const firstProof = mintG17ProductSourceCompletedReapProofForTesting(
    firstCapability,
  );
  await assert.rejects(
    finishG17ProductSourceBuildForTesting(secondCapability, firstProof),
    /not live for this build/u,
  );
  assert.equal(g17ProductSourceBuildInputs(firstCapability).sourceDirectory, "/proc/self/fd/4");
  assert.equal(g17ProductSourceBuildInputs(secondCapability).sourceDirectory, "/proc/self/fd/4");
  const secondProof = mintG17ProductSourceCompletedReapProofForTesting(
    secondCapability,
  );
  await finishG17ProductSourceBuildForTesting(secondCapability, secondProof);
  await finishG17ProductSourceBuildForTesting(firstCapability, firstProof);
  await assert.rejects(
    finishG17ProductSourceBuildForTesting(firstCapability, firstProof),
    /not live for this build/u,
  );
  await destroyG17ProductSourceWorkspace(first.workspace);
  await destroyG17ProductSourceWorkspace(second.workspace);
});

test("a valid test reap proof cannot finish a tampered source tree", async (t) => {
  const acquired = await workspace(t, "finish-source-tamper");
  const capability = await beginG17ProductSourceBuild(acquired.workspace);
  const { sourceDirectory } = g17ProductSourceWorkspacePathsForTesting(
    acquired.workspace,
  );
  const cargo = join(sourceDirectory, "Cargo.toml");
  await chmod(cargo, 0o600);
  await writeFile(cargo, "[workspace]\n");
  const proof = mintG17ProductSourceCompletedReapProofForTesting(capability);
  await assert.rejects(
    finishG17ProductSourceBuildForTesting(capability, proof),
  );
  await assert.rejects(
    finishG17ProductSourceBuildForTesting(capability, proof),
    /not live for this build/u,
  );
  await destroyG17ProductSourceWorkspace(acquired.workspace);
});

test("source byte tampering terminalizes verification", async (t) => {
  const acquired = await workspace(t, "source-tamper");
  const { sourceDirectory } = g17ProductSourceWorkspacePathsForTesting(
    acquired.workspace,
  );
  const cargo = join(sourceDirectory, "Cargo.toml");
  await chmod(cargo, 0o600);
  await writeFile(cargo, "[workspace]\n");
  await assert.rejects(verifyG17ProductSourceWorkspace(acquired.workspace));
  await assert.rejects(beginG17ProductSourceBuild(acquired.workspace), /cannot begin/u);
  await destroyG17ProductSourceWorkspace(acquired.workspace);
});

test("native cleanup unlinks a target hardlink without chmodding external data", async (t) => {
  const acquired = await workspace(t, "hardlink-sentinel");
  const sentinel = join(acquired.parent, "sentinel");
  await writeFile(sentinel, "outside exact bytes\n", { mode: 0o640 });
  const before = await lstat(sentinel, { bigint: true });
  const { targetDirectory } = g17ProductSourceWorkspacePathsForTesting(
    acquired.workspace,
  );
  await link(sentinel, join(targetDirectory, "sentinel-hardlink"));
  await assert.rejects(beginG17ProductSourceBuild(acquired.workspace));
  await destroyG17ProductSourceWorkspace(acquired.workspace);
  const after = await lstat(sentinel, { bigint: true });
  assert.equal(await readFile(sentinel, "utf8"), "outside exact bytes\n");
  assert.equal(after.nlink, 1n);
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeNs, before.mtimeNs);
});

test("root substitution fails closed while descriptor cleanup remains contained", async (t) => {
  const acquired = await workspace(t, "root-substitution");
  const displaced = join(acquired.parent, "workspace-displaced");
  await rename(acquired.root, displaced);
  await mkdir(acquired.root, { mode: 0o700 });
  const marker = join(acquired.root, "replacement-marker");
  await writeFile(marker, "replacement\n", { mode: 0o600 });
  await assert.rejects(verifyG17ProductSourceWorkspace(acquired.workspace));
  await destroyG17ProductSourceWorkspace(acquired.workspace);
  assert.equal(await readFile(marker, "utf8"), "replacement\n");
  assert.deepEqual(await readdir(displaced), []);
});

test("child substitution is terminal and cannot delete the substituted directory", async (t) => {
  const acquired = await workspace(t, "child-substitution");
  const { workspaceRoot } = g17ProductSourceWorkspacePathsForTesting(acquired.workspace);
  await rename(join(workspaceRoot, "source"), join(workspaceRoot, "source-displaced"));
  await mkdir(join(workspaceRoot, "source"), { mode: 0o700 });
  await writeFile(join(workspaceRoot, "source", "sentinel"), "external\n");
  await assert.rejects(verifyG17ProductSourceWorkspace(acquired.workspace));
  await assert.rejects(destroyG17ProductSourceWorkspace(acquired.workspace));
  assert.equal(
    await readFile(join(workspaceRoot, "source", "sentinel"), "utf8"),
    "external\n",
  );
  await rm(join(workspaceRoot, "source"), { recursive: true });
  await rename(join(workspaceRoot, "source-displaced"), join(workspaceRoot, "source"));
  await destroyG17ProductSourceWorkspace(acquired.workspace);
});

test("FIFO and symlink substitutions reject without blocking and leave cleanup retryable", async (t) => {
  for (const kind of ["fifo", "symlink"]) {
    const paths = await fixture(t, `special-${kind}`);
    const controller = new AbortController();
    const gate = await testGate(paths.root, "negative-control", {
      signal: controller.signal,
    });
    const acquired = {
      ...paths,
      workspace: await createG17ProductSourceWorkspace(gate),
    };
    const sourceDirectory = join(acquired.root, "source");
    const cargo = join(sourceDirectory, "Cargo.toml");
    const displaced = join(acquired.parent, `${kind}-Cargo.toml-displaced`);
    await chmod(sourceDirectory, 0o755);
    await rename(cargo, displaced);
    if (kind === "fifo") execFileSync("/usr/bin/mkfifo", [cargo]);
    else await symlink("Cargo.toml-displaced", cargo);
    await chmod(sourceDirectory, 0o555);
    controller.abort();
    await assert.rejects(verifyG17ProductSourceWorkspace(acquired.workspace));
    if (kind === "fifo") {
      await assert.rejects(destroyG17ProductSourceWorkspace(acquired.workspace));
      await rm(cargo);
      await chmod(sourceDirectory, 0o755);
      await rename(displaced, cargo);
      await chmod(sourceDirectory, 0o555);
      await destroyG17ProductSourceWorkspace(acquired.workspace);
    } else {
      await destroyG17ProductSourceWorkspace(acquired.workspace);
    }
  }
});

test("private Git composition leaves the shared object inventory unchanged", async (t) => {
  const before = await objectInventory();
  const acquired = await workspace(t, "private-git");
  const after = await objectInventory();
  assert.equal(after, before);
  await destroyG17ProductSourceWorkspace(acquired.workspace);
});

test("source import closure contains no direct process or dynamic-provider escape", async () => {
  const source = await readFile(
    join(repositoryRoot, "tools/engineering-harness/src/qualification/product-source-workspace.mjs"),
    "utf8",
  );
  const git = await readFile(
    join(repositoryRoot, "tools/engineering-harness/src/candidate/git.mjs"),
    "utf8",
  );
  const processSource = await readFile(
    join(repositoryRoot, "tools/engineering-harness/src/native/process.mjs"),
    "utf8",
  );
  assert.deepEqual(
    [...new Set([...source.matchAll(/\bfrom "([^"]+)";/gu)].map((match) => match[1]))].sort(),
    [
      "../../../metaharness/policy-contract.mjs",
      "../candidate/git.mjs",
      "../paths.mjs",
      "../routing/features.mjs",
      "./benchmark-execution-plan.mjs",
      "./contract.mjs",
      "./control-protocol.mjs",
      "./native-platform.mjs",
      "./native-snapshot.mjs",
      "./native-workspace-contract.mjs",
      "node:crypto",
      "node:fs",
      "node:fs/promises",
      "node:path",
      "node:util",
    ].sort(),
  );
  assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexecFile\s*\(/u);
  assert.doesNotMatch(source, /import\s*\(/u);
  assert.doesNotMatch(source, /rev-parse[^\n]*--git-common-dir/u);
  assert.doesNotMatch(source, /\n\s*chmod,/u);
  assert.match(source, /\.chmod\(/u);
  assert.match(source, /--no-ext-diff/u);
  assert.match(source, /--no-textconv/u);
  assert.match(source, /privateImportObjectClosure/u);
  assert.match(source, /admitPrivateObjectPlans/u);
  assert.match(source, /binary patch expansion is not admitted/u);
  assert.ok(
    source.indexOf("state.gitImportAdmission = admitPrivateObjectPlans") <
      source.indexOf("for (const importPlan of importPlans)"),
  );
  assert.match(source, /production build begin awaits a physical owner/u);
  assert.match(source, /production build finish requires an opaque physical-owner/u);
  assert.match(git, /GIT_NO_LAZY_FETCH:\s*"1"/u);
  assert.match(git, /GIT_NO_REPLACE_OBJECTS:\s*"1"/u);
  assert.match(git, /GIT_CONFIG_GLOBAL:\s*"\/dev\/null"/u);
  assert.match(git, /\bsignal,\s*\n\s*\}\);/u);
  assert.match(source, /signal:\s*context\.workSignal/u);
  assert.match(source, /NATIVE_ABORT_TIMEOUT\(CLEANUP_TIMEOUT_MS\)/u);
  assert.doesNotMatch(source, /signal:\s*state\.signal/u);
  assert.match(processSource, /types as utilTypes/u);
  assert.match(processSource, /nativeAbortedGetter\.call/u);
  assert.match(processSource, /nativeAddEventListener\.call/u);
  assert.match(processSource, /controller\.signal/u);
  const gateCapture = source.slice(
    source.indexOf("function captureOwnDataRecord"),
    source.indexOf("function snapshotInput"),
  );
  const signalCapture = source.slice(
    source.indexOf("function captureWorkSignalLease"),
    source.indexOf("function findUnreapedGitFault"),
  );
  const processSignalCapture = processSource.slice(
    processSource.indexOf("function capturedAbortSignal"),
    processSource.indexOf("function validatedInheritedFileDescriptors"),
  );
  assert.doesNotMatch(
    `${gateCapture}\n${signalCapture}\n${processSignalCapture}`,
    /getOwnPropertyDescriptors|Reflect\.ownKeys/u,
  );
  assert.ok(
    source.indexOf("bytes.length > maximumBytes") <
      source.indexOf('snapshotInput(decoded, "control authorization")'),
  );
  assert.match(source, /only external entry is JSON parsed/u);
});
