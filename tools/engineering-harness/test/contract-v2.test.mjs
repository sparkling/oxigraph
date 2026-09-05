import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  gitObjectOid,
  loadTreeV2,
  projectTreeManifestV2,
  readBlobByOid,
  treeEntryAtPath,
} from "../src/candidate/tree-v2.mjs";
import { createGitHome, runGit, runGitBytes } from "../src/candidate/git.mjs";
import {
  parseTaskContractBytesV2,
  validateTaskContractV2,
  verifyTaskContractRepositoryV2,
} from "../src/contract-v2.mjs";
import { encodeSandboxSessionConfigurationV2 } from "../src/candidate/sandbox-session-v2.mjs";
import {
  isTaskV2Failure,
  TaskV2Failure,
} from "../src/policy/task-v2-failures.mjs";
import { repositoryRoot } from "../src/paths.mjs";
import { canonicalJson } from "../src/routing/features.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exactCreateBaselineCommit = "c9cb6423faf9b510bd6e19bf94cce9ab2803bda9";
const exactCreateEvaluatorCommit = "997ad287fe089c8d791e0b733caae6240602de8f";
const exactCreateEvaluatorTree = "a5ae6b11fcfe0ae085c0e1b6d7eba18d70572f99";
const exactCreateEvaluatorPath =
  "lib/oxigraph/tests/engineering_harness_exact_create_v2.rs";
const exactCreateCreatedPath =
  "lib/oxigraph/tests/engineering_harness_exact_create_v2_created.rs";
const exactCreatePresentPath =
  "lib/oxigraph/tests/engineering_harness_exact_create_v2_present.rs";
const exactCreateContractPath = join(
  repositoryRoot,
  "tools",
  "engineering-harness",
  "tasks",
  "v2",
  "harness-create-exact-v2",
  "contract.json",
);

function failureCode(code) {
  return (error) => {
    assert.equal(error instanceof TaskV2Failure, true);
    assert.equal(isTaskV2Failure(error), true);
    assert.equal(error.code, code);
    assert.equal(error.terminal, true);
    assert.equal(error.retryAllowed, false);
    return true;
  };
}

async function writeRepositoryFile(repository, path, content) {
  const absolute = join(repository, ...path.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function commit(repository, home, message) {
  await runGit({ args: ["commit", "-m", message], cwd: repository, home });
  return (
    await runGit({ args: ["rev-parse", "HEAD"], cwd: repository, home })
  ).trim();
}

async function treeOf(repository, home, commitOid) {
  return (
    await runGit({
      args: ["rev-parse", `${commitOid}^{tree}`],
      cwd: repository,
      home,
    })
  ).trim();
}

function contractManifest(tree, exclusions, missingPresent = false) {
  const full = projectTreeManifestV2(tree);
  if (missingPresent) {
    return {
      entries: full.entries,
      fullSha256: full.sha256,
      protectedEntries: full.entries - exclusions.length,
      protectedSha256: "0".repeat(64),
    };
  }
  const protectedManifest = projectTreeManifestV2(tree, {
    exclude: exclusions,
  });
  return {
    entries: full.entries,
    fullSha256: full.sha256,
    protectedEntries: protectedManifest.entries,
    protectedSha256: protectedManifest.sha256,
  };
}

function changed(contract, mutate) {
  const clone = structuredClone(contract);
  mutate(clone);
  return clone;
}

function contractWithDenseSessionConfiguration(contract, featurePairCount) {
  return changed(contract, (value) => {
    const testRoles = [
      "public",
      ...Array.from({ length: 13 }, (_, index) => `role-${index}`),
    ];
    value.verificationSequence = ["format", "build", ...testRoles];
    value.commands = {
      format: { argv: ["cargo", "fmt", "--check"], timeoutMs: 120_000 },
      build: {
        argv: ["cargo", "test", "--no-run", "--test", "public"],
        timeoutMs: 120_000,
      },
    };
    for (const role of testRoles) {
      value.commands[role] = {
        argv: ["cargo", "test", "--test", "public"],
        timeoutMs: 120_000,
      };
    }
    for (const role of value.verificationSequence.slice(1)) {
      for (let index = 0; index < featurePairCount; index += 1) {
        value.commands[role].argv.push(
          "--features",
          `${role}-${index}-`.padEnd(4096, "x"),
        );
      }
    }
    value.success = Object.fromEntries(
      testRoles.map((role) => [`${role}Passed`, 1]),
    );
  });
}

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

async function createFixture(
  t,
  {
    objectFormat = "sha1",
    evaluatorStatus = "A",
    collision = "none",
    presentDrift = "none",
    includeSubmodule = false,
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-contract-v2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  await mkdir(repository);
  const home = await createGitHome(root);
  const initArgs = ["init", "--initial-branch=main"];
  if (objectFormat === "sha256") initArgs.push("--object-format=sha256");
  await runGit({ args: initArgs, cwd: repository, home });
  await runGit({
    args: ["config", "user.name", "Contract V2 Test"],
    cwd: repository,
    home,
  });
  await runGit({
    args: ["config", "user.email", "contract-v2@example.invalid"],
    cwd: repository,
    home,
  });

  let createPath = "src/new.rs";
  let submodules = [];
  let gitlink;
  if (collision === "tree") createPath = "src/new";
  if (collision === "file-parent") createPath = "src/parent/new.rs";
  if (collision === "symlink-parent") createPath = "src/link/new.rs";
  if (collision === "gitlink-parent") createPath = "vendor/module/new.rs";

  if (collision === "gitlink-parent") {
    await writeRepositoryFile(repository, "seed.txt", "seed\n");
    await runGit({ args: ["add", "-A"], cwd: repository, home });
    const targetCommit = await commit(repository, home, "seed gitlink target");
    const targetTree = await treeOf(repository, home, targetCommit);
    gitlink = { path: "vendor/module", commit: targetCommit, tree: targetTree };
    submodules = [gitlink];
  }
  if (includeSubmodule) {
    const moduleRepository = join(repository, "vendor/module");
    await mkdir(moduleRepository, { recursive: true });
    const moduleInitArgs = ["init", "--initial-branch=main"];
    if (objectFormat === "sha256") {
      moduleInitArgs.push("--object-format=sha256");
    }
    await runGit({ args: moduleInitArgs, cwd: moduleRepository, home });
    await runGit({
      args: ["config", "user.name", "Contract V2 Submodule Test"],
      cwd: moduleRepository,
      home,
    });
    await runGit({
      args: ["config", "user.email", "submodule@example.invalid"],
      cwd: moduleRepository,
      home,
    });
    await writeRepositoryFile(moduleRepository, "module.txt", "module\n");
    await runGit({ args: ["add", "-A"], cwd: moduleRepository, home });
    const targetCommit = await commit(moduleRepository, home, "seed submodule");
    const targetTree = await treeOf(moduleRepository, home, targetCommit);
    gitlink = { path: "vendor/module", commit: targetCommit, tree: targetTree };
    submodules = [gitlink];
  }

  await writeRepositoryFile(repository, "src/protected.rs", "protected\n");
  await writeRepositoryFile(
    repository,
    "tests/protected.rs",
    "evaluator parent tree\n",
  );
  if (presentDrift !== "missing") {
    await writeRepositoryFile(repository, "src/existing.rs", "existing\n");
  }
  if (evaluatorStatus === "M") {
    await writeRepositoryFile(repository, "tests/evaluator.rs", "before\n");
  }
  if (presentDrift === "absent-present") {
    await writeRepositoryFile(repository, createPath, "unexpected\n");
  }
  if (collision === "case") {
    await writeRepositoryFile(repository, "src/New.rs", "case collision\n");
  }
  if (collision === "tree") {
    await writeRepositoryFile(repository, "src/new/child.rs", "tree target\n");
  }
  if (collision === "file-parent") {
    await writeRepositoryFile(repository, "src/parent", "not a directory\n");
  }
  if (collision === "symlink-parent") {
    await mkdir(join(repository, "src"), { recursive: true });
    await symlink("protected.rs", join(repository, "src/link"));
  }
  await runGit({ args: ["add", "-A"], cwd: repository, home });
  if (gitlink !== undefined) {
    await runGit({
      args: [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${gitlink.commit},${gitlink.path}`,
      ],
      cwd: repository,
      home,
    });
  }
  const baselineCommit = await commit(repository, home, "baseline");
  const baselineTreeOid = await treeOf(repository, home, baselineCommit);

  await writeRepositoryFile(
    repository,
    "tests/evaluator.rs",
    evaluatorStatus === "A" ? "added evaluator\n" : "modified evaluator\n",
  );
  await runGit({
    args: ["add", "--", "tests/evaluator.rs"],
    cwd: repository,
    home,
  });
  const evaluatorCommit = await commit(repository, home, "evaluator");
  const evaluatorTreeOid = await treeOf(repository, home, evaluatorCommit);

  const baselineTree = await loadTreeV2({
    workspace: repository,
    home,
    tree: baselineTreeOid,
  });
  const evaluatorTree = await loadTreeV2({
    workspace: repository,
    home,
    tree: evaluatorTreeOid,
  });
  const evaluatorEntry = treeEntryAtPath(evaluatorTree, "tests/evaluator.rs");
  const evaluatorContent = await readBlobByOid({
    workspace: repository,
    home,
    oid: evaluatorEntry.oid,
  });
  const patch = await runGitBytes({
    args: [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baselineCommit,
      evaluatorCommit,
      "--",
    ],
    cwd: repository,
    home,
    maxOutputBytes: 1024 * 1024,
  });

  const missingPresent = presentDrift === "missing";
  let presentObjectId;
  let presentContentSha256;
  if (missingPresent) {
    const missingContent = Buffer.from("missing identity\n");
    presentObjectId = gitObjectOid(missingContent, objectFormat);
    presentContentSha256 = sha256(missingContent);
  } else {
    const presentEntry = treeEntryAtPath(baselineTree, "src/existing.rs");
    const presentContent = await readBlobByOid({
      workspace: repository,
      home,
      oid: presentEntry.oid,
    });
    presentObjectId = presentEntry.oid;
    presentContentSha256 = sha256(presentContent);
  }
  const presentIdentity = {
    state: "present",
    mode: "100644",
    type: "blob",
    objectId: presentObjectId,
    contentSha256: presentContentSha256,
  };
  const presentPaths = ["src/existing.rs"];
  const contract = {
    schemaVersion: 2,
    id: `test-contract-v2-${evaluatorStatus.toLowerCase()}`,
    programme: "linked-data-store",
    decision: "ADR-0034",
    objective:
      "Prove exact schema-v2 creation admission against an isolated synthetic repository.",
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
    baseline: { commit: baselineCommit, tree: baselineTreeOid },
    evaluator: {
      commit: evaluatorCommit,
      parent: baselineCommit,
      tree: evaluatorTreeOid,
      path: "tests/evaluator.rs",
      changeStatus: evaluatorStatus,
      blob: evaluatorEntry.oid,
      contentSha256: sha256(evaluatorContent),
      patchSha256: sha256(patch),
    },
    protectedInputs: {
      manifestAlgorithm: "git-ls-tree-r-z-sort-nul-sha256-v1",
      mutableBaselines: [
        {
          path: "src/existing.rs",
          state: "present",
          baseline: { ...presentIdentity },
          evaluator: { ...presentIdentity },
        },
        {
          path: createPath,
          state: "absent",
          baseline: { state: "absent" },
          evaluator: { state: "absent" },
        },
      ],
      baselineManifest: contractManifest(
        baselineTree,
        presentPaths,
        missingPresent,
      ),
      evaluatorManifest: contractManifest(
        evaluatorTree,
        presentPaths,
        missingPresent,
      ),
      submodules,
    },
    scope: {
      mutableExact: ["src/existing.rs", createPath],
      createExact: [createPath],
      mutablePrefixes: [],
      blockedExact: ["tests/evaluator.rs"],
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
        argv: ["cargo", "test", "--no-run", "--test", "public"],
        timeoutMs: 120_000,
      },
      public: {
        argv: ["cargo", "test", "--test", "public"],
        timeoutMs: 120_000,
      },
    },
    ceilings: {
      maxPatchBytes: 256 * 1024,
      maxChangedFiles: 2,
      maxChangedLines: 128,
      maxWorkerOutputBytes: 1024 * 1024,
      maxBuildOutputBytes: 8 * 1024 * 1024,
      maxTestOutputBytesPerCommand: 2 * 1024 * 1024,
      maxTotalVerifierWallMs: 600_000,
      maxResidentBytes: 1024 * 1024 * 1024,
      maxVerifierDiskBytes: 2 * 1024 * 1024 * 1024,
      cargoBuildJobs: 2,
      maxRepairCycles: 1,
      maxCritiqueRounds: 1,
      networkDuringVerification: false,
    },
    initialRed: {
      commandRole: "public",
      exitCode: 101,
      passed: 0,
      failed: 1,
      requiredSubstrings: ["expected synthetic red"],
      forbiddenSubstrings: ["network access"],
    },
    success: { publicPassed: 1 },
  };
  return {
    root,
    repository,
    home,
    contract,
    baselineTree,
    evaluatorTree,
  };
}

test("strict v2 schema and repository verification accept exact A and M fixtures", async (t) => {
  for (const evaluatorStatus of ["A", "M"]) {
    const fixture = await createFixture(t, { evaluatorStatus });
    assert.equal(validateTaskContractV2(fixture.contract), fixture.contract);
    const verified = await verifyTaskContractRepositoryV2(fixture.contract, {
      repoRoot: fixture.repository,
      home: fixture.home,
    });
    assert.equal(
      verified.schema,
      "oxigraph.engineering-task-contract-repository/v2",
    );
    assert.equal(verified.objectFormat, "sha1");
    assert.equal(verified.evaluator.changeStatus, evaluatorStatus);
    assert.deepEqual(
      verified.mutableBaselines.map(({ path, state }) => ({ path, state })),
      [
        { path: "src/existing.rs", state: "present" },
        { path: "src/new.rs", state: "absent" },
      ],
    );
    assert.equal(
      verified.baselineManifest.protectedEntries,
      verified.baselineManifest.entries - 1,
    );
  }
});

test("schema-v2 routing admits explicit Astra efforts without changing legacy provider records", async (t) => {
  const { contract } = await createFixture(t);
  assert.equal(validateTaskContractV2(contract), contract);

  for (const reasoningEffort of ["low", "medium", "high", "xhigh", "max"]) {
    const astra = changed(contract, (value) => {
      value.routing.providers[0] = {
        provider: "codex",
        transport: "native",
        model: "gpt-6-astra",
        reasoningEffort,
      };
    });
    assert.equal(validateTaskContractV2(astra), astra);
  }

  for (const mutate of [
    (value) => {
      value.routing.providers[0].model = "gpt-6-astra";
    },
    (value) => {
      value.routing.providers[0].reasoningEffort = "high";
    },
    (value) => {
      value.routing.providers[0].reasoningEffort = null;
    },
    (value) => {
      value.routing.providers[0].reasoningEffort = undefined;
    },
    (value) => {
      value.routing.providers[0] = {
        provider: "codex",
        transport: "native",
        model: "gpt-6-astra",
        reasoningEffort: "minimal",
      };
    },
    (value) => {
      value.routing.providers[1].reasoningEffort = "high";
    },
    (value) => {
      value.routing.providers[1].reasoningEffort = null;
    },
    (value) => {
      value.routing.providers[1].reasoningEffort = undefined;
    },
  ]) {
    assert.throws(
      () => validateTaskContractV2(changed(contract, mutate)),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
  }
});

test("raw v2 contract parsing owns exact bytes and binds raw and canonical identities", async (t) => {
  const { contract } = await createFixture(t);
  const raw = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8");
  const expectedRawSha256 = sha256(raw);
  const expectedCanonicalSha256 = sha256(
    Buffer.from(canonicalJson(contract), "utf8"),
  );
  const parsed = parseTaskContractBytesV2(raw);

  raw.fill(0);
  assert.deepEqual(Reflect.ownKeys(parsed), [
    "contract",
    "contractSha256",
    "canonicalContractSha256",
  ]);
  assert.equal(parsed.contractSha256, expectedRawSha256);
  assert.equal(parsed.canonicalContractSha256, expectedCanonicalSha256);
  assert.notEqual(parsed.contractSha256, parsed.canonicalContractSha256);
  assert.deepEqual(parsed.contract, contract);
  assert.notEqual(parsed.contract, contract);
  assert.equal(Object.isFrozen(parsed), true);
  assertDeepFrozen(parsed.contract);

  const boundaryText = Buffer.from(JSON.stringify(contract), "utf8");
  const boundary = Buffer.concat([
    boundaryText,
    Buffer.alloc(4 * 1024 * 1024 - boundaryText.length, 0x20),
  ]);
  assert.equal(
    parseTaskContractBytesV2(boundary).contractSha256,
    sha256(boundary),
  );
});

test("exact-create dormant contract binds the frozen evaluator and unique missing module", async (t) => {
  const contractFile = await lstat(exactCreateContractPath);
  assert.equal(contractFile.isFile(), true);
  assert.equal(contractFile.isSymbolicLink(), false);
  assert.equal(contractFile.mode & 0o170000, 0o100000);
  const raw = await readFile(exactCreateContractPath);
  assert.equal(
    sha256(raw),
    "58a9207303ab541552fa3b8342ad61bc24a3cb8b9b97a6d8236a58b3440489ad",
  );
  const parsed = parseTaskContractBytesV2(raw);
  assert.equal(parsed.contractSha256, sha256(raw));
  assert.equal(parsed.contract.id, "harness-create-exact-v2-control");
  assert.equal(parsed.contract.schemaVersion, 2);
  assert.equal(parsed.contract.baseline.commit, exactCreateBaselineCommit);
  assert.equal(parsed.contract.evaluator.commit, exactCreateEvaluatorCommit);
  assert.equal(parsed.contract.evaluator.parent, exactCreateBaselineCommit);
  assert.equal(parsed.contract.evaluator.tree, exactCreateEvaluatorTree);
  assert.equal(parsed.contract.evaluator.path, exactCreateEvaluatorPath);
  assert.deepEqual(parsed.contract.scope.mutableExact, [
    exactCreateCreatedPath,
    exactCreatePresentPath,
  ]);
  assert.deepEqual(parsed.contract.scope.createExact, [exactCreateCreatedPath]);
  assert.equal(parsed.contract.localOnly, true);
  assert.equal(parsed.contract.promotionAuthority, false);
  assert.equal(parsed.contract.initialRed.commandRole, "public");
  assert.equal(parsed.contract.initialRed.exitCode, 101);
  assert.equal(parsed.contract.initialRed.rustcCode, "E0583");
  assert.equal(parsed.contract.initialRed.rustcErrorCount, 1);
  assert.equal(parsed.contract.success.publicPassed, 3);

  const root = await mkdtemp(join(tmpdir(), "oxigraph-exact-create-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = await createGitHome(root);
  const verified = await verifyTaskContractRepositoryV2(parsed.contract, {
    repoRoot: repositoryRoot,
    home,
  });
  assert.deepEqual(
    verified.mutableBaselines.map(({ path, state }) => ({ path, state })),
    [
      { path: exactCreateCreatedPath, state: "absent" },
      { path: exactCreatePresentPath, state: "present" },
    ],
  );

  const evaluatorTree = await loadTreeV2({
    workspace: repositoryRoot,
    home,
    tree: exactCreateEvaluatorTree,
  });
  assert.equal(
    treeEntryAtPath(evaluatorTree, exactCreateCreatedPath),
    undefined,
  );
  const evaluatorEntry = treeEntryAtPath(
    evaluatorTree,
    exactCreateEvaluatorPath,
  );
  const presentEntry = treeEntryAtPath(evaluatorTree, exactCreatePresentPath);
  assert.deepEqual(
    [evaluatorEntry.mode, evaluatorEntry.type, evaluatorEntry.oid],
    ["100644", "blob", parsed.contract.evaluator.blob],
  );
  assert.deepEqual(
    [presentEntry.mode, presentEntry.type, presentEntry.oid],
    ["100644", "blob", "f84c77471cb73df8905041738b6973113a51473a"],
  );
  const evaluatorSource = (
    await readBlobByOid({
      workspace: repositoryRoot,
      home,
      oid: evaluatorEntry.oid,
    })
  ).toString("utf8");
  assert.equal(
    evaluatorSource.match(
      /^mod engineering_harness_exact_create_v2_created;$/gmu,
    )?.length,
    1,
  );
  assert.equal(
    evaluatorSource.match(
      /^mod engineering_harness_exact_create_v2_present;$/gmu,
    )?.length,
    1,
  );
});

test("raw v2 contract parsing rejects hostile byte containers, malformed text, and overflow", async () => {
  const shared = new Uint8Array(new SharedArrayBuffer(8));
  for (const invalid of [
    "{}",
    Buffer.alloc(0),
    Buffer.from([0xc3, 0x28]),
    Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    Buffer.from("{} trailing", "utf8"),
    Buffer.alloc(4 * 1024 * 1024 + 1, 0x20),
    shared,
  ]) {
    assert.throws(
      () => parseTaskContractBytesV2(invalid),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
  }
});

test("contract acceptance proves the projected v2 session configuration fits its shared ceiling", async (t) => {
  const { contract } = await createFixture(t);
  const accepted = contractWithDenseSessionConfiguration(contract, 60);
  const raw = Buffer.from(`${canonicalJson(accepted)}\n`, "utf8");
  assert.equal(raw.length > 3 * 1024 * 1024, true);
  assert.equal(raw.length <= 4 * 1024 * 1024, true);

  const parsed = parseTaskContractBytesV2(raw);
  const configurationBytes = encodeSandboxSessionConfigurationV2({
    contractSha256: parsed.contractSha256,
    verificationSequence: parsed.contract.verificationSequence,
    commands: parsed.contract.commands,
    ceilings: {
      maxBuildOutputBytes: parsed.contract.ceilings.maxBuildOutputBytes,
      maxTestOutputBytesPerCommand:
        parsed.contract.ceilings.maxTestOutputBytesPerCommand,
      maxTotalVerifierWallMs: parsed.contract.ceilings.maxTotalVerifierWallMs,
      maxVerifierDiskBytes: parsed.contract.ceilings.maxVerifierDiskBytes,
      cargoBuildJobs: parsed.contract.ceilings.cargoBuildJobs,
    },
  });
  assert.equal(configurationBytes.length > 3 * 1024 * 1024, true);
  assert.equal(configurationBytes.length <= 4 * 1024 * 1024, true);

  const overflow = contractWithDenseSessionConfiguration(contract, 68);
  assert.throws(
    () => validateTaskContractV2(overflow),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
});

test("repository verification binds each initialized submodule commit and tree", async (t) => {
  const fixture = await createFixture(t, { includeSubmodule: true });
  const options = { repoRoot: fixture.repository, home: fixture.home };
  await verifyTaskContractRepositoryV2(fixture.contract, options);

  const wrongTree = changed(fixture.contract, (value) => {
    value.protectedInputs.submodules[0].tree = value.baseline.tree;
  });
  await assert.rejects(
    verifyTaskContractRepositoryV2(wrongTree, options),
    failureCode("ERR_BASELINE_STATE"),
  );
});

test("v2 schema has exact keys, derived creation authority, ordered baselines, and one OID width", async (t) => {
  const { contract } = await createFixture(t);
  const cases = [
    changed(contract, (value) => {
      value.registrationCommit = value.evaluator.commit;
    }),
    changed(contract, (value) => {
      delete value.scope.createExact;
    }),
    changed(contract, (value) => {
      value.scope.allowCreate = false;
    }),
    changed(contract, (value) => {
      value.scope.allowRename = true;
    }),
    changed(contract, (value) => {
      value.protectedInputs.mutableExclusion = "src/existing.rs";
    }),
    changed(contract, (value) => {
      value.protectedInputs.mutableBaselines.reverse();
    }),
    changed(contract, (value) => {
      value.protectedInputs.mutableBaselines[1].state = "present";
    }),
    changed(contract, (value) => {
      value.protectedInputs.mutableBaselines[0].evaluator.objectId = "1".repeat(
        40,
      );
    }),
    changed(contract, (value) => {
      value.evaluator.blob = "1".repeat(64);
    }),
    changed(contract, (value) => {
      value.protectedInputs.baselineManifest.protectedEntries += 1;
    }),
  ];
  for (const invalid of cases) {
    assert.throws(
      () => validateTaskContractV2(invalid),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
  }
  assert.throws(
    () =>
      validateTaskContractV2(
        changed(contract, (value) => {
          value.evaluator.path = ":(glob)**";
        }),
      ),
    failureCode("ERR_PATH_INVALID"),
  );
});

test("v2 command, expected-pass, and resource ceilings match downstream bounds", async (t) => {
  const { contract } = await createFixture(t);
  const maximum = changed(contract, (value) => {
    value.commands.public.argv.push("x".repeat(4096));
    for (const command of Object.values(value.commands)) {
      command.timeoutMs = 7_200_000;
    }
    Object.assign(value.ceilings, {
      maxPatchBytes: 262_144,
      maxChangedFiles: 32,
      maxChangedLines: 4096,
      maxWorkerOutputBytes: 1_048_576,
      maxBuildOutputBytes: 66_584_576,
      maxTestOutputBytesPerCommand: 66_584_576,
      maxTotalVerifierWallMs: 7_200_000,
      maxResidentBytes: 68_719_476_736,
      maxVerifierDiskBytes: 137_438_953_472,
      cargoBuildJobs: 16,
      maxRepairCycles: 2,
      maxCritiqueRounds: 1,
    });
  });
  assert.equal(validateTaskContractV2(maximum), maximum);
  for (const perCommandMaximum of [
    changed(contract, (value) => {
      value.ceilings.maxBuildOutputBytes = 67_108_864;
      value.ceilings.maxTestOutputBytesPerCommand = 1024;
    }),
    changed(contract, (value) => {
      value.ceilings.maxBuildOutputBytes = 1024;
      value.ceilings.maxTestOutputBytesPerCommand = 67_108_864;
    }),
  ]) {
    assert.equal(validateTaskContractV2(perCommandMaximum), perCommandMaximum);
  }

  const invalid = [
    changed(contract, (value) => {
      value.commands.build.argv = ["cargo", "test", "--no-run"];
    }),
    changed(contract, (value) => {
      value.commands.build.argv = [
        "cargo",
        "test",
        "--no-run",
        "--test=public",
      ];
    }),
    changed(contract, (value) => {
      value.commands.build.argv.push("--release");
    }),
    changed(contract, (value) => {
      value.commands.build.argv.push("--target-dir", "/tmp/elsewhere");
    }),
    changed(contract, (value) => {
      value.commands.build.argv.push(
        "--test",
        "public-extra",
        "--test",
        "public_extra",
      );
    }),
    changed(contract, (value) => {
      value.commands.build.argv = [
        "cargo",
        "test",
        "--no-run",
        "--test",
        "public",
        "--test",
        "public",
      ];
    }),
    changed(contract, (value) => {
      value.commands.public.argv = ["cargo"];
    }),
    changed(contract, (value) => {
      value.commands.public.argv = ["rustc", "--version"];
    }),
    changed(contract, (value) => {
      value.commands.public.argv.push("x".repeat(4097));
    }),
    changed(contract, (value) => {
      value.commands.public.argv.push("unpaired-\ud800-surrogate");
    }),
    changed(contract, (value) => {
      value.commands.public.argv.push("control-\u0001-byte");
    }),
    changed(contract, (value) => {
      value.objective = `${value.objective}\ud800`;
    }),
    changed(contract, (value) => {
      value.routing.providers[0].model = "gpt-5.6-\ud800";
    }),
    changed(contract, (value) => {
      value.initialRed.requiredSubstrings.push("\ud800");
    }),
    changed(contract, (value) => {
      value.commands.public.timeoutMs = 999;
    }),
    changed(contract, (value) => {
      value.commands.public.timeoutMs =
        value.ceilings.maxTotalVerifierWallMs + 1;
    }),
    changed(contract, (value) => {
      value.success.publicPassed = 0;
    }),
    changed(contract, (value) => {
      value.ceilings.maxBuildOutputBytes = 66_584_576;
      value.ceilings.maxTestOutputBytesPerCommand = 66_584_577;
    }),
    ...[
      ["maxPatchBytes", 262_145],
      ["maxChangedFiles", 33],
      ["maxChangedLines", 4097],
      ["maxWorkerOutputBytes", 1_048_577],
      ["maxBuildOutputBytes", 1023],
      ["maxBuildOutputBytes", 67_108_865],
      ["maxTestOutputBytesPerCommand", 1023],
      ["maxTestOutputBytesPerCommand", 67_108_865],
      ["maxTotalVerifierWallMs", 999],
      ["maxTotalVerifierWallMs", 7_200_001],
      ["maxResidentBytes", 268_435_455],
      ["maxResidentBytes", 68_719_476_737],
      ["maxVerifierDiskBytes", 33_554_431],
      ["maxVerifierDiskBytes", 137_438_953_473],
      ["cargoBuildJobs", 17],
      ["maxRepairCycles", 3],
      ["maxCritiqueRounds", 2],
    ].map(([name, ceiling]) =>
      changed(contract, (value) => {
        value.ceilings[name] = ceiling;
      }),
    ),
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateTaskContractV2(value),
      failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
    );
  }
});

test("schema inspection rejects hidden, symbolic, and accessor array authority without invoking getters", async (t) => {
  const { contract } = await createFixture(t);
  const symbolic = changed(contract, () => {});
  Object.defineProperty(symbolic.scope.mutableExact, Symbol("authority"), {
    value: "src/other.rs",
    enumerable: true,
  });
  assert.throws(
    () => validateTaskContractV2(symbolic),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );

  const hidden = changed(contract, () => {});
  Object.defineProperty(hidden.scope.mutableExact, "hidden", {
    value: "src/other.rs",
    enumerable: false,
  });
  assert.throws(
    () => validateTaskContractV2(hidden),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );

  const accessor = changed(contract, () => {});
  let arrayGetterCalls = 0;
  Object.defineProperty(accessor.scope.mutableExact, "0", {
    configurable: true,
    enumerable: true,
    get() {
      arrayGetterCalls += 1;
      return "src/existing.rs";
    },
  });
  assert.throws(
    () => validateTaskContractV2(accessor),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  assert.equal(arrayGetterCalls, 0);
});

test("initial-red variant discovery never invokes an untrusted kind getter", async (t) => {
  const { contract } = await createFixture(t);
  const hostile = changed(contract, () => {});
  let getterCalls = 0;
  Object.defineProperty(hostile.initialRed, "kind", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return "compiler";
    },
  });
  assert.throws(
    () => validateTaskContractV2(hostile),
    failureCode("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  assert.equal(getterCalls, 0);
});

test("repository verification rejects absent/present drift and every parent collision", async (t) => {
  const cases = [
    { options: { presentDrift: "absent-present" }, code: "ERR_PARENT_TREE" },
    { options: { presentDrift: "missing" }, code: "ERR_BASELINE_STATE" },
    { options: { collision: "case" }, code: "ERR_PATH_COLLISION" },
    { options: { collision: "tree" }, code: "ERR_PARENT_TREE" },
    { options: { collision: "file-parent" }, code: "ERR_PARENT_TREE" },
    { options: { collision: "symlink-parent" }, code: "ERR_PARENT_TREE" },
    { options: { collision: "gitlink-parent" }, code: "ERR_PARENT_TREE" },
  ];
  for (const { options, code } of cases) {
    const fixture = await createFixture(t, options);
    assert.equal(validateTaskContractV2(fixture.contract), fixture.contract);
    await assert.rejects(
      verifyTaskContractRepositoryV2(fixture.contract, {
        repoRoot: fixture.repository,
        home: fixture.home,
      }),
      failureCode(code),
    );
  }
});

test("repository verification rejects manifest, count, mutable blob, evaluator blob, and patch tamper", async (t) => {
  const fixture = await createFixture(t);
  const repositoryOptions = {
    repoRoot: fixture.repository,
    home: fixture.home,
  };
  const manifestDigest = changed(fixture.contract, (value) => {
    value.protectedInputs.baselineManifest.protectedSha256 = "1".repeat(64);
  });
  await assert.rejects(
    verifyTaskContractRepositoryV2(manifestDigest, repositoryOptions),
    failureCode("ERR_PROTECTED_MANIFEST"),
  );

  const manifestCount = changed(fixture.contract, (value) => {
    value.protectedInputs.evaluatorManifest.entries += 1;
    value.protectedInputs.evaluatorManifest.protectedEntries += 1;
  });
  await assert.rejects(
    verifyTaskContractRepositoryV2(manifestCount, repositoryOptions),
    failureCode("ERR_PROTECTED_MANIFEST"),
  );

  for (const tampered of [
    changed(fixture.contract, (value) => {
      const identity = value.protectedInputs.mutableBaselines[0];
      identity.baseline.objectId = value.evaluator.blob;
      identity.evaluator.objectId = value.evaluator.blob;
    }),
    changed(fixture.contract, (value) => {
      const identity = value.protectedInputs.mutableBaselines[0];
      identity.baseline.contentSha256 = "2".repeat(64);
      identity.evaluator.contentSha256 = "2".repeat(64);
    }),
    changed(fixture.contract, (value) => {
      value.evaluator.blob =
        value.protectedInputs.mutableBaselines[0].baseline.objectId;
    }),
    changed(fixture.contract, (value) => {
      value.evaluator.patchSha256 = "3".repeat(64);
    }),
  ]) {
    await assert.rejects(
      verifyTaskContractRepositoryV2(tampered, repositoryOptions),
      failureCode("ERR_BASELINE_STATE"),
    );
  }
});

test("repository verification rejects commit and tree-ish identity substitution", async (t) => {
  const fixture = await createFixture(t);
  const options = { repoRoot: fixture.repository, home: fixture.home };
  const commitAsTree = changed(fixture.contract, (value) => {
    value.baseline.tree = value.baseline.commit;
  });
  await assert.rejects(
    verifyTaskContractRepositoryV2(commitAsTree, options),
    failureCode("ERR_BASELINE_STATE"),
  );

  const treeAsCommit = changed(fixture.contract, (value) => {
    value.baseline.commit = value.baseline.tree;
    value.evaluator.parent = value.baseline.tree;
  });
  await assert.rejects(
    verifyTaskContractRepositoryV2(treeAsCommit, options),
    failureCode("ERR_OBJECT_TYPE"),
  );

  const notDirect = changed(fixture.contract, (value) => {
    value.baseline.commit = value.evaluator.commit;
    value.baseline.tree = value.evaluator.tree;
    value.evaluator.parent = value.evaluator.commit;
  });
  await assert.rejects(
    verifyTaskContractRepositoryV2(notDirect, options),
    failureCode("ERR_BASELINE_STATE"),
  );
});

test("SHA-256 repositories use the same exact contract and verification model when supported", async (t) => {
  let fixture;
  try {
    fixture = await createFixture(t, { objectFormat: "sha256" });
  } catch (error) {
    if (/object-format|sha256|unknown option/iu.test(String(error?.message))) {
      t.skip("installed Git does not support SHA-256 repositories");
      return;
    }
    throw error;
  }
  assert.equal(validateTaskContractV2(fixture.contract), fixture.contract);
  const verified = await verifyTaskContractRepositoryV2(fixture.contract, {
    repoRoot: fixture.repository,
    home: fixture.home,
  });
  assert.equal(verified.objectFormat, "sha256");
  assert.equal(verified.baseline.commit.length, 64);
  assert.equal(verified.evaluator.blob.length, 64);
});

test("contract-v2 validation leaves the committed v1 contract module byte-identical", async () => {
  const path = new URL("../src/contract.mjs", import.meta.url);
  const workingBytes = await readFile(path);
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const committedBytes = await runGitBytes({
    args: ["show", "HEAD:tools/engineering-harness/src/contract.mjs"],
    cwd: repository,
    home: "/tmp",
    maxOutputBytes: 4 * 1024 * 1024,
  });
  assert.deepEqual(workingBytes, committedBytes);
});
