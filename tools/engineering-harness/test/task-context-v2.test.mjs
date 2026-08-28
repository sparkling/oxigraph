import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  gitObjectOid,
  loadTreeV2,
  parseTreeBytes,
  projectTreeManifestV2,
  treeEntryAtPath,
} from "../src/candidate/tree-v2.mjs";
import { createGitHome, runGit } from "../src/candidate/git.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import {
  TASK_V2_SOURCE_FILE_BYTES_CEILING,
  TASK_V2_SOURCE_FILE_COUNT_CEILING,
  TASK_V2_SOURCE_SNAPSHOT_ALGORITHM,
  TASK_V2_SOURCE_TOTAL_BYTES_CEILING,
  assertSealedTaskV2WorkerContext,
  createTaskV2Context as createRegisteredTaskV2Context,
  createTaskV2ContextControllerForTesting,
} from "../src/runtime/task-context-v2.mjs";

const PRESENT = "lib/oxigraph/src/existing_v2.rs";
const CREATED = "lib/oxigraph/src/new_v2.rs";
const SUPPORT = "lib/oxigraph/src/support_v2.rs";
const SHA1_WIDTH = 40;
const controllersByContractBytes = new WeakMap();
const testTreeObjectIdentities = new WeakMap();

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function oid(character, width = SHA1_WIDTH) {
  return character.repeat(width);
}

function treeRecord({ mode, type, objectId, path }) {
  return Buffer.from(`${mode} ${type} ${objectId}\t${path}\0`, "ascii");
}

function parsedTree(files, objectFormat = "sha1", extraDirectories = []) {
  const width = objectFormat === "sha1" ? 40 : 64;
  const directories = new Set(extraDirectories);
  for (const { path } of files) {
    const components = path.split("/");
    for (let length = 1; length < components.length; length += 1) {
      directories.add(components.slice(0, length).join("/"));
    }
  }
  const records = [...directories]
    .sort((left, right) => {
      const depth = left.split("/").length - right.split("/").length;
      return depth === 0
        ? Buffer.compare(Buffer.from(left), Buffer.from(right))
        : depth;
    })
    .map((path) =>
      treeRecord({
        mode: "040000",
        type: "tree",
        objectId: oid("d", width),
        path,
      }),
    );
  for (const file of files) {
    records.push(
      treeRecord({
        mode: file.mode ?? "100644",
        type: file.type ?? "blob",
        objectId: file.objectId,
        path: file.path,
      }),
    );
  }
  return parseTreeBytes(Buffer.concat(records), {
    expectedObjectFormat: objectFormat,
  });
}

function presentIdentity(objectId, contentSha256) {
  return {
    state: "present",
    mode: "100644",
    type: "blob",
    objectId,
    contentSha256,
  };
}

function contract({
  presentPath = PRESENT,
  createPath = CREATED,
  presentBytes = Buffer.from("pub fn existing() {}\n"),
  presentObjectId = gitObjectOid(presentBytes, "sha1"),
  presentContentSha256 = sha256(presentBytes),
  maxPatchBytes = 16_384,
} = {}) {
  const identity = presentIdentity(presentObjectId, presentContentSha256);
  return {
    schemaVersion: 2,
    id: "test-task-context-v2",
    programme: "linked-data-store",
    decision: "ADR-0034",
    objective:
      "Prove exact schema-v2 source projection and immutable creation instructions.",
    localOnly: true,
    promotionAuthority: false,
    routing: {
      pairedCalibration: true,
      forbidOpenRouter: true,
      providers: [
        { provider: "codex", transport: "native", model: "gpt-5.6-sol" },
        { provider: "claude", transport: "native", model: "opus" },
      ],
    },
    baseline: { commit: oid("1"), tree: oid("a") },
    evaluator: {
      commit: oid("2"),
      parent: oid("1"),
      tree: oid("b"),
      path: SUPPORT,
      changeStatus: "A",
      blob: oid("3"),
      contentSha256: "3".repeat(64),
      patchSha256: "4".repeat(64),
    },
    protectedInputs: {
      manifestAlgorithm: "git-ls-tree-r-z-sort-nul-sha256-v1",
      mutableBaselines: [
        {
          path: presentPath,
          state: "present",
          baseline: { ...identity },
          evaluator: { ...identity },
        },
        {
          path: createPath,
          state: "absent",
          baseline: { state: "absent" },
          evaluator: { state: "absent" },
        },
      ],
      baselineManifest: {
        entries: 2,
        fullSha256: "5".repeat(64),
        protectedEntries: 1,
        protectedSha256: "6".repeat(64),
      },
      evaluatorManifest: {
        entries: 2,
        fullSha256: "5".repeat(64),
        protectedEntries: 1,
        protectedSha256: "6".repeat(64),
      },
      submodules: [],
    },
    scope: {
      mutableExact: [presentPath, createPath],
      createExact: [createPath],
      mutablePrefixes: [],
      blockedExact: [SUPPORT],
      blockedPrefixes: [],
      allowCreate: true,
      allowDelete: false,
      allowRename: false,
      allowModeChange: false,
      allowSymlink: false,
      allowSubmoduleChange: false,
    },
    verificationSequence: ["format", "build", "public"],
    commands: {
      format: { argv: ["cargo", "fmt", "--check"], timeoutMs: 120_000 },
      build: {
        argv: ["cargo", "test", "--no-run", "--test", "exact_create"],
        timeoutMs: 1_800_000,
      },
      public: { argv: ["cargo", "test"], timeoutMs: 120_000 },
    },
    ceilings: {
      maxPatchBytes,
      maxChangedFiles: 2,
      maxChangedLines: 64,
      maxWorkerOutputBytes: 262_144,
      maxBuildOutputBytes: 8_388_608,
      maxTestOutputBytesPerCommand: 2_097_152,
      maxTotalVerifierWallMs: 2_700_000,
      maxResidentBytes: 8_589_934_592,
      maxVerifierDiskBytes: 17_179_869_184,
      cargoBuildJobs: 4,
      maxRepairCycles: 0,
      maxCritiqueRounds: 0,
      networkDuringVerification: false,
    },
    initialRed: {
      commandRole: "public",
      exitCode: 101,
      passed: 0,
      failed: 1,
      requiredSubstrings: ["expected red fixture"],
      forbiddenSubstrings: [],
    },
    success: { publicPassed: 1 },
  };
}

function fixture({
  currentContract,
  presentBytes = Buffer.from("pub fn existing() {}\n"),
  supportBytes = Buffer.from("pub fn support() {}\n"),
  extraFiles = [],
  sourceAllowlist = [PRESENT, CREATED, SUPPORT],
  treeFiles,
} = {}) {
  const files = treeFiles ?? [
    {
      path: PRESENT,
      objectId: gitObjectOid(presentBytes, "sha1"),
    },
    {
      path: SUPPORT,
      objectId: gitObjectOid(supportBytes, "sha1"),
    },
    ...extraFiles.map(({ path, bytes, mode, type }) => ({
      path,
      objectId: gitObjectOid(bytes, "sha1"),
      mode,
      type,
    })),
  ];
  const evaluatorTree = parsedTree(files);
  const boundContract = structuredClone(currentContract ?? contract());
  const evaluatorEntry = treeEntryAtPath(evaluatorTree, SUPPORT);
  const fullManifest = projectTreeManifestV2(evaluatorTree);
  const presentPath =
    boundContract.protectedInputs.mutableBaselines.find(
      ({ state }) => state === "present",
    )?.path ?? PRESENT;
  let protectedManifest;
  try {
    protectedManifest = projectTreeManifestV2(evaluatorTree, {
      exclude: [presentPath],
    });
  } catch {
    protectedManifest = {
      entries: Math.max(0, fullManifest.entries - 1),
      sha256: "0".repeat(64),
    };
  }
  const manifest = {
    entries: fullManifest.entries,
    fullSha256: fullManifest.sha256,
    protectedEntries: protectedManifest.entries,
    protectedSha256: protectedManifest.sha256,
  };
  boundContract.evaluator.blob = evaluatorEntry.oid;
  boundContract.evaluator.contentSha256 = sha256(supportBytes);
  boundContract.protectedInputs.baselineManifest = { ...manifest };
  boundContract.protectedInputs.evaluatorManifest = { ...manifest };
  testTreeObjectIdentities.set(evaluatorTree, boundContract.evaluator.tree);

  const blobs = new Map([
    [gitObjectOid(presentBytes, "sha1"), Buffer.from(presentBytes)],
    [gitObjectOid(supportBytes, "sha1"), Buffer.from(supportBytes)],
    ...extraFiles.map(({ bytes }) => [
      gitObjectOid(bytes, "sha1"),
      Buffer.from(bytes),
    ]),
  ]);
  const contractBytes = Buffer.from(JSON.stringify(boundContract), "utf8");
  const controller = createTaskV2ContextControllerForTesting(
    () => sourceAllowlist,
    (tree) => {
      const objectId = testTreeObjectIdentities.get(tree);
      if (objectId === undefined) {
        throw new Error("test tree has no isolated object identity");
      }
      return objectId;
    },
  );
  controllersByContractBytes.set(contractBytes, controller);
  return {
    contract: boundContract,
    contractBytes,
    contractSha256: sha256(contractBytes),
    controller,
    evaluatorTree,
    sourceAllowlist,
    blobs,
  };
}

function reader(fixtureValue, calls = []) {
  return async (request) => {
    calls.push(request);
    assert.deepEqual(Object.keys(request), ["oid", "maxOutputBytes"]);
    assert.equal(Object.isFrozen(request), true);
    const bytes = fixtureValue.blobs.get(request.oid);
    if (bytes === undefined) throw new Error("unexpected object identity");
    return Buffer.from(bytes);
  };
}

function creationInput(fixtureValue, calls = []) {
  return {
    contractBytes: fixtureValue.contractBytes,
    evaluatorTree: fixtureValue.evaluatorTree,
    readBlobByOid: reader(fixtureValue, calls),
  };
}

function snapshotValidationInput(fixtureValue, snapshot) {
  return {
    snapshot,
    contractBytes: fixtureValue.contractBytes,
    evaluatorTree: fixtureValue.evaluatorTree,
  };
}

function contextValidationInput(fixtureValue, context) {
  return {
    context,
    contractBytes: fixtureValue.contractBytes,
    evaluatorTree: fixtureValue.evaluatorTree,
  };
}

function controllerFor(input) {
  const controller = controllersByContractBytes.get(input.contractBytes);
  if (controller === undefined) {
    throw new Error("test input is not bound to a source-profile controller");
  }
  return controller;
}

function createTaskV2SourceSnapshot(input) {
  return controllerFor(input).createTaskV2SourceSnapshot(input);
}

function validateCachedTaskV2SourceSnapshot(input) {
  return controllerFor(input).validateCachedTaskV2SourceSnapshot(input);
}

function createTaskV2Context(input) {
  return controllerFor(input).createTaskV2Context(input);
}

function validateCachedTaskV2Context(input) {
  return controllerFor(input).validateCachedTaskV2Context(input);
}

function sourceFault(error) {
  return (
    error instanceof TaskV2Failure &&
    error.code === "ERR_SOURCE_SNAPSHOT" &&
    error.terminal === true &&
    error.retryAllowed === false
  );
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("v2 context omits absent sources and binds exact immutable creation instructions", async () => {
  const current = fixture();
  const calls = [];
  const context = await createTaskV2Context(creationInput(current, calls));

  assert.equal(context.schemaVersion, 2);
  assert.equal(
    context.sourceSnapshot.algorithm,
    TASK_V2_SOURCE_SNAPSHOT_ALGORITHM,
  );
  assert.deepEqual(
    context.sourceSnapshot.files.map(({ path }) => path),
    [PRESENT, SUPPORT],
  );
  assert.equal(
    context.sourceSnapshot.files.some(({ path }) => path === CREATED),
    false,
  );
  assert.deepEqual(context.creationInstructions, [
    {
      path: CREATED,
      baselineState: "absent",
      requiredStatus: "A",
      finalMode: "100644",
      finalType: "blob",
      maxPatchBytes: 16_384,
    },
  ]);
  assert.deepEqual(Object.keys(context.creationInstructions[0]), [
    "path",
    "baselineState",
    "requiredStatus",
    "finalMode",
    "finalType",
    "maxPatchBytes",
  ]);
  assert.deepEqual(context.bindings, {
    taskSchemaVersion: 2,
    sourceSnapshotSha256: context.sourceSnapshot.sha256,
    creationInstructionsSha256: sha256(
      Buffer.from(canonicalJson(context.creationInstructions), "utf8"),
    ),
  });
  assert.equal(calls.length, 2);
  assert.equal(
    calls.some((call) => Object.hasOwn(call, "path")),
    false,
  );
  assert.ok(
    calls.every(
      ({ maxOutputBytes }) =>
        maxOutputBytes === TASK_V2_SOURCE_FILE_BYTES_CEILING,
    ),
  );
  assertDeepFrozen(context);
  const sealed = current.controller.assertSealedTaskV2WorkerContext({
    context,
    contractBytes: current.contractBytes,
  });
  assert.equal(sealed.context, context);
  assert.deepEqual(sealed.contract, current.contract);
  assertDeepFrozen(sealed.contract);
  assert.equal(sealed.contractSha256, current.contractSha256);
  assert.deepEqual(sealed.taskBytes, Buffer.from(JSON.stringify(context)));
  assert.equal(sealed.taskSha256, sha256(sealed.taskBytes));
  assert.throws(
    () =>
      assertSealedTaskV2WorkerContext({
        context,
        contractBytes: current.contractBytes,
      }),
    sourceFault,
  );
  assert.throws(
    () =>
      current.controller.assertSealedTaskV2WorkerContext({
        context: structuredClone(context),
        contractBytes: current.contractBytes,
      }),
    sourceFault,
  );

  assert.deepEqual(
    validateCachedTaskV2SourceSnapshot(
      snapshotValidationInput(current, context.sourceSnapshot),
    ),
    context.sourceSnapshot,
  );
  assert.deepEqual(
    validateCachedTaskV2Context(contextValidationInput(current, context)),
    context,
  );
});

test("source snapshot and task context bytes are deterministic", async () => {
  const current = fixture();
  const first = await createTaskV2Context(creationInput(current));
  const second = await createTaskV2Context(creationInput(current));
  const snapshot = await createTaskV2SourceSnapshot(creationInput(current));

  assert.deepEqual(second, first);
  assert.deepEqual(snapshot, first.sourceSnapshot);
  assert.equal(canonicalJson(second), canonicalJson(first));
  assert.equal(second.sourceSnapshot.sha256, first.sourceSnapshot.sha256);
  assert.equal(
    second.bindings.creationInstructionsSha256,
    first.bindings.creationInstructionsSha256,
  );
});

test("full contract, evaluator manifest, raw bytes, and profile authority are inseparable", async () => {
  const current = fixture();
  const calls = [];
  const sameFilesDifferentTree = parsedTree(
    [
      {
        path: PRESENT,
        objectId: gitObjectOid(Buffer.from("pub fn existing() {}\n"), "sha1"),
      },
      {
        path: SUPPORT,
        objectId: gitObjectOid(Buffer.from("pub fn support() {}\n"), "sha1"),
      },
    ],
    "sha1",
    ["empty"],
  );
  testTreeObjectIdentities.set(sameFilesDifferentTree, oid("c"));
  assert.deepEqual(
    projectTreeManifestV2(sameFilesDifferentTree),
    projectTreeManifestV2(current.evaluatorTree),
  );
  await assert.rejects(
    current.controller.createTaskV2Context({
      ...creationInput(current, calls),
      evaluatorTree: sameFilesDifferentTree,
    }),
    sourceFault,
  );
  assert.equal(calls.length, 0);

  const alternateBytes = Buffer.from("alternate\n", "utf8");
  const alternateTree = parsedTree([
    {
      path: PRESENT,
      objectId: gitObjectOid(Buffer.from("pub fn existing() {}\n"), "sha1"),
    },
    {
      path: SUPPORT,
      objectId: gitObjectOid(Buffer.from("pub fn support() {}\n"), "sha1"),
    },
    {
      path: "lib/oxigraph/src/alternate_v2.rs",
      objectId: gitObjectOid(alternateBytes, "sha1"),
    },
  ]);
  await assert.rejects(
    current.controller.createTaskV2Context({
      ...creationInput(current, calls),
      evaluatorTree: alternateTree,
    }),
    sourceFault,
  );
  assert.equal(calls.length, 0);

  const partialContractBytes = Buffer.from(
    JSON.stringify({ schemaVersion: 2 }),
    "utf8",
  );
  await assert.rejects(
    current.controller.createTaskV2Context({
      contractBytes: partialContractBytes,
      evaluatorTree: current.evaluatorTree,
      readBlobByOid: reader(current, calls),
    }),
    sourceFault,
  );
  assert.equal(calls.length, 0);

  await assert.rejects(
    current.controller.createTaskV2Context({
      ...creationInput(current, calls),
      sourceAllowlist: [PRESENT, CREATED, SUPPORT],
    }),
    sourceFault,
  );
  assert.equal(calls.length, 0);

  const context = await createTaskV2Context(creationInput(current));
  const alternateContractBytes = Buffer.concat([
    current.contractBytes,
    Buffer.from("\n", "ascii"),
  ]);
  assert.throws(
    () =>
      current.controller.assertSealedTaskV2WorkerContext({
        context,
        contractBytes: alternateContractBytes,
      }),
    sourceFault,
  );
});

test("production authority rejects legacy task-id reuse before any source read", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-task-context-v2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  await mkdir(repository);
  const home = await createGitHome(root);
  await runGit({
    args: ["init", "--initial-branch=main"],
    cwd: repository,
    home,
  });
  const presentBytes = Buffer.from("pub fn existing() {}\n");
  const supportBytes = Buffer.from("pub fn support() {}\n");
  for (const [path, bytes] of [
    [PRESENT, presentBytes],
    [SUPPORT, supportBytes],
  ]) {
    const absolute = join(repository, ...path.split("/"));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }
  await runGit({ args: ["add", "-A"], cwd: repository, home });
  const treeOid = (
    await runGit({ args: ["write-tree"], cwd: repository, home })
  ).trim();
  const evaluatorTree = await loadTreeV2({
    workspace: repository,
    home,
    tree: treeOid,
  });
  const bound = contract({
    presentBytes,
    presentObjectId: treeEntryAtPath(evaluatorTree, PRESENT).oid,
    presentContentSha256: sha256(presentBytes),
  });
  bound.id = "g1.2-rocksdb-serialized-writers";
  bound.evaluator.tree = treeOid;
  bound.evaluator.blob = treeEntryAtPath(evaluatorTree, SUPPORT).oid;
  bound.evaluator.contentSha256 = sha256(supportBytes);
  const full = projectTreeManifestV2(evaluatorTree);
  const protectedManifest = projectTreeManifestV2(evaluatorTree, {
    exclude: [PRESENT],
  });
  const manifest = {
    entries: full.entries,
    fullSha256: full.sha256,
    protectedEntries: protectedManifest.entries,
    protectedSha256: protectedManifest.sha256,
  };
  bound.protectedInputs.baselineManifest = { ...manifest };
  bound.protectedInputs.evaluatorManifest = { ...manifest };
  const contractBytes = Buffer.from(JSON.stringify(bound), "utf8");
  let sourceReads = 0;
  await assert.rejects(
    createRegisteredTaskV2Context({
      contractBytes,
      evaluatorTree,
      readBlobByOid: async () => {
        sourceReads += 1;
        return Buffer.alloc(0);
      },
    }),
    sourceFault,
  );
  assert.equal(sourceReads, 0);
});

test("tree identity, mode, absence, and case failures stop before blob reads", async () => {
  const presentBytes = Buffer.from("pub fn existing() {}\n");
  const supportBytes = Buffer.from("pub fn support() {}\n");
  const presentOid = gitObjectOid(presentBytes, "sha1");
  const supportOid = gitObjectOid(supportBytes, "sha1");
  const cases = [
    fixture({
      treeFiles: [{ path: SUPPORT, objectId: supportOid }],
    }),
    fixture({
      treeFiles: [
        { path: PRESENT, objectId: presentOid, mode: "100755" },
        { path: SUPPORT, objectId: supportOid },
      ],
    }),
    fixture({
      treeFiles: [
        { path: PRESENT, objectId: presentOid },
        { path: CREATED, objectId: oid("e") },
        { path: SUPPORT, objectId: supportOid },
      ],
    }),
    fixture({
      treeFiles: [
        {
          path: PRESENT.replace("existing_v2.rs", "Existing_v2.rs"),
          objectId: presentOid,
        },
        { path: SUPPORT, objectId: supportOid },
      ],
    }),
    fixture({
      treeFiles: [
        { path: PRESENT, objectId: presentOid },
        {
          path: "lib/oxigraph/SRC/other_v2.rs",
          objectId: oid("9"),
        },
        { path: SUPPORT, objectId: supportOid },
      ],
    }),
    fixture({
      treeFiles: [
        { path: PRESENT, objectId: oid("f") },
        { path: SUPPORT, objectId: supportOid },
      ],
    }),
  ];

  for (const current of cases) {
    const calls = [];
    await assert.rejects(
      createTaskV2Context(creationInput(current, calls)),
      sourceFault,
    );
    assert.equal(calls.length, 0);
  }
});

test("blob content and contract digest mismatches fail once without leaking detail", async () => {
  const current = fixture();
  let attempts = 0;
  await assert.rejects(
    createTaskV2Context({
      ...creationInput(current),
      readBlobByOid: async () => {
        attempts += 1;
        throw new Error("/private/worktree command stderr token=secret");
      },
    }),
    (error) => {
      assert.equal(sourceFault(error), true);
      assert.doesNotMatch(
        `${error.stack}\n${JSON.stringify(error)}`,
        /private|stderr|secret|token/u,
      );
      return true;
    },
  );
  assert.equal(attempts, 1);

  const wrongBlob = fixture();
  let wrongBlobAttempts = 0;
  await assert.rejects(
    createTaskV2Context({
      ...creationInput(wrongBlob),
      readBlobByOid: async () => {
        wrongBlobAttempts += 1;
        return Buffer.from("wrong bytes\n");
      },
    }),
    sourceFault,
  );
  assert.equal(wrongBlobAttempts, 1);

  const bytes = Buffer.from("pub fn existing() {}\n");
  const wrongDigestContract = contract({
    presentBytes: bytes,
    presentContentSha256: "0".repeat(64),
  });
  const wrongDigest = fixture({ currentContract: wrongDigestContract });
  await assert.rejects(
    createTaskV2Context(creationInput(wrongDigest)),
    sourceFault,
  );
});

test("source allowlist paths are exact, collision-free, and complete", async () => {
  const invalidAllowlists = [
    [PRESENT, SUPPORT],
    [PRESENT, CREATED, SUPPORT, SUPPORT],
    [PRESENT, CREATED, SUPPORT, SUPPORT.toUpperCase()],
    [PRESENT, CREATED, "../escape.rs"],
    [PRESENT, CREATED, SUPPORT, "lib/oxigraph/src/missing_v2.rs"],
  ];
  for (const sourceAllowlist of invalidAllowlists) {
    const current = fixture({ sourceAllowlist });
    const calls = [];
    await assert.rejects(
      createTaskV2Context(creationInput(current, calls)),
      sourceFault,
    );
    assert.equal(calls.length, 0);
  }

  const sourceAllowlist = [PRESENT, CREATED, SUPPORT];
  sourceAllowlist[Symbol("authority")] = CREATED;
  const current = fixture({ sourceAllowlist });
  const calls = [];
  await assert.rejects(
    createTaskV2Context(creationInput(current, calls)),
    sourceFault,
  );
  assert.equal(calls.length, 0);
});

test("cached snapshot and context tampering cannot manufacture authority", async () => {
  const current = fixture();
  const context = await createTaskV2Context(creationInput(current));

  const contentTamper = structuredClone(context.sourceSnapshot);
  contentTamper.files[0].content = "tampered\n";
  assert.throws(
    () =>
      validateCachedTaskV2SourceSnapshot(
        snapshotValidationInput(current, contentTamper),
      ),
    sourceFault,
  );

  const placeholderTamper = structuredClone(context.sourceSnapshot);
  placeholderTamper.files.splice(1, 0, {
    path: CREATED,
    bytes: 0,
    sha256: sha256(Buffer.alloc(0)),
    content: "",
  });
  assert.throws(
    () =>
      validateCachedTaskV2SourceSnapshot(
        snapshotValidationInput(current, placeholderTamper),
      ),
    sourceFault,
  );

  const instructionTamper = structuredClone(context);
  instructionTamper.creationInstructions[0].maxPatchBytes += 1;
  instructionTamper.bindings.creationInstructionsSha256 = sha256(
    Buffer.from(canonicalJson(instructionTamper.creationInstructions), "utf8"),
  );
  assert.throws(
    () =>
      validateCachedTaskV2Context(
        contextValidationInput(current, instructionTamper),
      ),
    sourceFault,
  );

  const bindingTamper = structuredClone(context);
  bindingTamper.bindings.sourceSnapshotSha256 = "0".repeat(64);
  assert.throws(
    () =>
      validateCachedTaskV2Context(
        contextValidationInput(current, bindingTamper),
      ),
    sourceFault,
  );

  const extraKeyTamper = structuredClone(context);
  extraKeyTamper.creationInstructions[0].baselineContent = "invented";
  assert.throws(
    () =>
      validateCachedTaskV2Context(
        contextValidationInput(current, extraKeyTamper),
      ),
    sourceFault,
  );
});

test("builders reject caller-supplied snapshots or creation authority before reads", async () => {
  const current = fixture();
  for (const supplied of [
    {
      creationInstructions: [
        {
          path: "lib/oxigraph/src/attacker.rs",
          baselineState: "absent",
          requiredStatus: "A",
          finalMode: "100644",
          finalType: "blob",
          maxPatchBytes: 16_384,
        },
      ],
    },
    { sourceSnapshot: { files: [] } },
  ]) {
    const calls = [];
    await assert.rejects(
      createTaskV2Context({ ...creationInput(current, calls), ...supplied }),
      sourceFault,
    );
    assert.equal(calls.length, 0);
  }
});

test("source file, aggregate, count, and patch ceilings fail closed", async () => {
  const oversizedBytes = Buffer.alloc(
    TASK_V2_SOURCE_FILE_BYTES_CEILING + 1,
    0x61,
  );
  const oversizedContract = contract({
    presentBytes: oversizedBytes,
    presentObjectId: gitObjectOid(oversizedBytes, "sha1"),
    presentContentSha256: sha256(oversizedBytes),
  });
  const oversized = fixture({
    currentContract: oversizedContract,
    presentBytes: oversizedBytes,
  });
  await assert.rejects(
    createTaskV2Context(creationInput(oversized)),
    sourceFault,
  );

  const half = Buffer.alloc(TASK_V2_SOURCE_TOTAL_BYTES_CEILING / 2, 0x61);
  const one = Buffer.from("x");
  const third = "lib/oxigraph/src/third_v2.rs";
  const aggregateContract = contract({
    presentBytes: half,
    presentObjectId: gitObjectOid(half, "sha1"),
    presentContentSha256: sha256(half),
  });
  const aggregate = fixture({
    currentContract: aggregateContract,
    presentBytes: half,
    supportBytes: half,
    extraFiles: [{ path: third, bytes: one }],
    sourceAllowlist: [PRESENT, CREATED, SUPPORT, third],
  });
  await assert.rejects(
    createTaskV2Context(creationInput(aggregate)),
    sourceFault,
  );

  const tooManyPaths = Array.from(
    { length: TASK_V2_SOURCE_FILE_COUNT_CEILING + 1 },
    (_, index) => `src/generated_${String(index).padStart(3, "0")}.rs`,
  );
  const tooMany = fixture({ sourceAllowlist: tooManyPaths });
  await assert.rejects(
    createTaskV2Context(creationInput(tooMany)),
    sourceFault,
  );

  const invalidPatchCeiling = fixture({
    currentContract: contract({ maxPatchBytes: 262_145 }),
  });
  await assert.rejects(
    createTaskV2Context(creationInput(invalidPatchCeiling)),
    sourceFault,
  );
});
