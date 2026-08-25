import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createGitHome, runGit } from "../src/candidate/git.mjs";
import { loadTaskContract } from "../src/contract.mjs";
import { canonicalSha256 } from "../src/routing/features.mjs";
import {
  createG12SourceSnapshot,
  createG12TaskContext,
  G12_SOURCE_ALLOWLIST,
  G12_SOURCE_BYTE_CEILING,
} from "../src/runtime/task-context.mjs";

const identity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "fixture@localhost",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "fixture@localhost",
  GIT_COMMITTER_NAME: "Fixture",
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitObject(value) {
  return createHash("sha1").update(value).digest("hex");
}

function patch() {
  const path = G12_SOURCE_ALLOWLIST[0];
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-fn mutable() {}\n+fn mutable() { serialize(); }\n`;
}

function repairedPatch() {
  const path = G12_SOURCE_ALLOWLIST[0];
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-fn mutable() {}\n+fn mutable() { serialize_with_poison_recovery(); }\n`;
}

const outputs = Object.freeze({
  architecture: Object.freeze({
    summary: "Use a database-owned serial writer gate.",
    patch: null,
    findings: [],
    verdict: "ACCEPT",
  }),
  critique: Object.freeze({
    summary: "The gate must cover snapshot creation through commit/drop.",
    patch: null,
    findings: [],
    verdict: "ACCEPT",
  }),
  implementation: Object.freeze({
    summary: "Add the bounded gate.",
    patch: patch(),
    findings: [],
    verdict: "ACCEPT",
  }),
  review: Object.freeze({
    summary: "Repair the poison handling.",
    patch: null,
    findings: ["Poison handling is not fail-safe."],
    verdict: "REJECT",
  }),
});

async function addFiles(workspace, entries) {
  for (const [path, content] of entries) {
    const absolute = join(workspace, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}

async function fixture(t) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "g12-task-context-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const workspace = join(temporaryRoot, "repo");
  const targetRoot = join(temporaryRoot, "target");
  const commandTemp = join(temporaryRoot, "tmp");
  await Promise.all([
    mkdir(workspace, { mode: 0o700 }),
    mkdir(targetRoot, { mode: 0o700 }),
    mkdir(commandTemp, { mode: 0o700 }),
  ]);
  const gitHome = await createGitHome(temporaryRoot);
  await runGit({ args: ["init", "--initial-branch=main"], cwd: workspace, home: gitHome });

  const source = new Map([
    [G12_SOURCE_ALLOWLIST[0], "fn mutable() {}\n"],
    [G12_SOURCE_ALLOWLIST[1], "fn rocksdb() {}\n"],
    [G12_SOURCE_ALLOWLIST[2], "mod rocksdb_wrapper;\n"],
    [G12_SOURCE_ALLOWLIST[3], "pub struct Store;\n"],
  ]);
  await addFiles(workspace, source);
  await runGit({ args: ["add", "--", ...source.keys()], cwd: workspace, home: gitHome });
  await runGit({
    args: ["commit", "-m", "baseline"],
    cwd: workspace,
    home: gitHome,
    environmentOverrides: identity,
  });
  const baselineCommit = (
    await runGit({ args: ["rev-parse", "HEAD"], cwd: workspace, home: gitHome })
  ).trim();
  const baselineTree = (
    await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: workspace, home: gitHome })
  ).trim();

  const evaluatorContent = "#[test]\nfn rejects_write_skew() {}\n";
  source.set(G12_SOURCE_ALLOWLIST[4], evaluatorContent);
  await addFiles(workspace, [[G12_SOURCE_ALLOWLIST[4], evaluatorContent]]);
  await runGit({ args: ["add", "--", G12_SOURCE_ALLOWLIST[4]], cwd: workspace, home: gitHome });
  await runGit({
    args: ["commit", "-m", "evaluator"],
    cwd: workspace,
    home: gitHome,
    environmentOverrides: { ...identity, GIT_AUTHOR_DATE: "2000-01-02T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-02T00:00:00Z" },
  });
  const evaluatorCommit = (
    await runGit({ args: ["rev-parse", "HEAD"], cwd: workspace, home: gitHome })
  ).trim();
  const evaluatorTree = (
    await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: workspace, home: gitHome })
  ).trim();
  const evaluatorBlob = (
    await runGit({
      args: ["rev-parse", `${evaluatorCommit}:${G12_SOURCE_ALLOWLIST[4]}`],
      cwd: workspace,
      home: gitHome,
    })
  ).trim();
  const mutableBlob = (
    await runGit({
      args: ["rev-parse", `${baselineCommit}:${G12_SOURCE_ALLOWLIST[0]}`],
      cwd: workspace,
      home: gitHome,
    })
  ).trim();
  const evaluatorPatch = await runGit({
    args: ["diff", "--binary", baselineCommit, evaluatorCommit],
    cwd: workspace,
    home: gitHome,
  });

  const contract = structuredClone(loadTaskContract().contract);
  contract.baseline = { commit: baselineCommit, tree: baselineTree };
  contract.evaluator = {
    ...contract.evaluator,
    commit: evaluatorCommit,
    parent: baselineCommit,
    tree: evaluatorTree,
    blob: evaluatorBlob,
    contentSha256: digest(evaluatorContent),
    patchSha256: digest(evaluatorPatch),
  };
  contract.protectedInputs.mutableBaselineBlob = mutableBlob;
  contract.protectedInputs.mutableBaselineSha256 = digest(source.get(G12_SOURCE_ALLOWLIST[0]));
  contract.protectedInputs.baselineManifest = {
    entries: 4,
    fullSha256: digest("baseline-full"),
    protectedEntries: 3,
    protectedSha256: digest("baseline-protected"),
  };
  contract.protectedInputs.evaluatorManifest = {
    entries: 5,
    fullSha256: digest("evaluator-full"),
    protectedEntries: 4,
    protectedSha256: digest("evaluator-protected"),
  };

  const evaluator = Object.freeze({
    temporaryRoot,
    workspace,
    targetRoot,
    commandTemp,
    gitHome,
    evaluatorPatch,
    candidateTree: evaluatorTree,
    candidateCommit: evaluatorCommit,
    candidatePatchSha256: null,
    evaluatorPatchSha256: contract.evaluator.patchSha256,
    changedPaths: Object.freeze([]),
    protectedManifest: Object.freeze({
      entries: contract.protectedInputs.evaluatorManifest.protectedEntries,
      sha256: contract.protectedInputs.evaluatorManifest.protectedSha256,
    }),
    kind: "evaluator",
  });
  const contractSha256 = digest("trusted fixture contract bytes");
  return { temporaryRoot, workspace, source, evaluator, contract, contractSha256 };
}

function prior(...roles) {
  return Object.fromEntries(roles.map((role) => [role, outputs[role]]));
}

function candidateDescriptor(contract, patchBytes = patch(), name = "initial") {
  return {
    patch: patchBytes,
    patchSha256: digest(patchBytes),
    commit: gitObject(`${name}-commit`),
    tree: gitObject(`${name}-tree`),
    protectedManifest: {
      entries: contract.protectedInputs.evaluatorManifest.protectedEntries,
      sha256: contract.protectedInputs.evaluatorManifest.protectedSha256,
    },
  };
}

function verifierReceipt(
  contract,
  verdict = "ACCEPT",
  candidate = candidateDescriptor(contract),
) {
  return {
    verdict,
    stage: verdict === "ACCEPT" ? "complete" : "evaluation",
    commands: contract.verificationSequence.map((name) => ({
      name,
      logicalArgv: [...contract.commands[name].argv],
      sandboxArgv: ["/usr/bin/bwrap", "--", ...contract.commands[name].argv],
      network: "isolated",
      workspace: "read-only",
      exitCode: verdict === "REJECT" && name === "public" ? 101 : 0,
      signal: null,
      disposition: "completed",
      durationMs: 1,
      stdoutSha256: digest(`${name}-stdout`),
      stderrSha256: digest(`${name}-stderr`),
      stdoutTail: ["public", "independent", "regression"].includes(name)
        ? verdict === "REJECT" && name === "public"
          ? "test result: FAILED. 0 passed; 2 failed;"
          : `test result: ok. ${contract.success[`${name}Passed`]} passed; 0 failed;`
        : `${name} passed`,
      stderrTail: "",
    })),
    artifacts: [{ name: "transaction_concurrency-sealed", sha256: digest("artifact"), bytes: 10 }],
    durationMs: 5,
    candidateTree: candidate.tree,
    protectedManifest: structuredClone(candidate.protectedManifest),
  };
}

function formatRejectReceipt(contract, candidate, sandboxArgc) {
  const receipt = verifierReceipt(contract, "REJECT", candidate);
  const command = receipt.commands[0];
  command.exitCode = 1;
  command.sandboxArgv = Array.from(
    { length: sandboxArgc },
    (_, index) => (index === 0 ? "/usr/bin/systemd-run" : `sandbox-argument-${index}`),
  );
  command.stdoutTail = "Diff in /workspace/lib/oxigraph/src/storage/rocksdb_wrapper.rs";
  receipt.stage = "format";
  receipt.commands = [command];
  return receipt;
}

test("architecture task includes only tree-verified allowlisted UTF-8 sources and bounded authority", async (t) => {
  const state = await fixture(t);
  const sourceSnapshot = await createG12SourceSnapshot({
    evaluator: state.evaluator,
    contract: state.contract,
    contractSha256: state.contractSha256,
  });
  await rm(state.workspace, { recursive: true, force: true });
  const task = await createG12TaskContext({
    role: "architecture",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
  });

  assert.deepEqual(task.sourceSnapshot.files.map(({ path }) => path), G12_SOURCE_ALLOWLIST);
  assert.equal(
    task.sourceSnapshot.totalBytes,
    [...state.source.values()].reduce((total, value) => total + Buffer.byteLength(value), 0),
  );
  assert.ok(task.sourceSnapshot.totalBytes < G12_SOURCE_BYTE_CEILING);
  assert.equal(task.sourceSnapshot.contractSha256, state.contractSha256);
  assert.match(task.sourceSnapshot.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(task.sourceSnapshot.files.every((file) => /^[0-9a-f]{64}$/u.test(file.sha256)));
  assert.equal(task.bindings.contractSha256, state.contractSha256);
  assert.equal(task.bindings.evaluator.tree, state.contract.evaluator.tree);
  assert.equal(task.bindings.sourceSnapshotSha256, task.sourceSnapshot.sha256);
  assert.equal(task.bindings.currentCandidateSha256, null);
  assert.deepEqual(task.bindings.scope.mutableExact, [G12_SOURCE_ALLOWLIST[0]]);
  assert.deepEqual(task.bindings.verification.commands.public.argv, state.contract.commands.public.argv);
  assert.equal(task.bindings.verification.success.publicPassed, 2);
  assert.deepEqual(Object.values(task.authority), [false, false, false, false, false, false, false, false]);
  assert.equal(task.prior, null);
  assert.equal(task.currentCandidate, null);
  assert.equal(task.verifier, null);
  assert.equal(Object.isFrozen(task.sourceSnapshot.files[0]), true);

  const tamperedSnapshot = structuredClone(sourceSnapshot);
  tamperedSnapshot.files[0].content = "fn forged() {}\n";
  await assert.rejects(
    createG12TaskContext({
      role: "architecture",
      sourceSnapshot: tamperedSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /file binding is invalid/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "architecture",
      sourceSnapshot: structuredClone(sourceSnapshot),
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /not sealed by this process/u,
  );
  const changedContract = structuredClone(state.contract);
  changedContract.objective = `${changedContract.objective} forged`;
  await assert.rejects(
    createG12TaskContext({
      role: "architecture",
      sourceSnapshot,
      contract: changedContract,
      contractSha256: state.contractSha256,
    }),
    /sealed for a different task contract/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "architecture",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: digest("different trusted contract bytes"),
    }),
    /raw contract digest differs/u,
  );
});

test("source sealing rejects workspace tamper, symlinks, path escape, non-UTF8, and oversized files", async (t) => {
  const state = await fixture(t);
  const mutable = join(state.workspace, G12_SOURCE_ALLOWLIST[0]);
  await writeFile(mutable, "fn tampered() {}\n");
  await assert.rejects(
    createG12SourceSnapshot({
      evaluator: state.evaluator,
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /differs from evaluator tree/u,
  );

  await writeFile(mutable, state.source.get(G12_SOURCE_ALLOWLIST[0]));
  const linked = join(state.workspace, G12_SOURCE_ALLOWLIST[1]);
  await unlink(linked);
  await symlink(G12_SOURCE_ALLOWLIST[0], linked);
  await assert.rejects(
    createG12SourceSnapshot({
      evaluator: state.evaluator,
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /symlink/u,
  );

  const escaped = { ...state.evaluator, workspace: state.temporaryRoot };
  await assert.rejects(
    createG12SourceSnapshot({
      evaluator: escaped,
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /escapes|private temporary root/u,
  );

  await unlink(linked);
  await writeFile(linked, Buffer.from([0xff, 0xfe]));
  await assert.rejects(
    createG12SourceSnapshot({
      evaluator: state.evaluator,
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /not valid UTF-8/u,
  );

  await writeFile(linked, Buffer.alloc(256 * 1024 + 1, 0x61));
  await assert.rejects(
    createG12SourceSnapshot({
      evaluator: state.evaluator,
      contract: state.contract,
      contractSha256: state.contractSha256,
    }),
    /byte ceiling/u,
  );
});

test("role contexts require exactly the appropriate prior outputs and verifier receipt", async (t) => {
  const state = await fixture(t);
  const sourceSnapshot = await createG12SourceSnapshot({
    evaluator: state.evaluator,
    contract: state.contract,
    contractSha256: state.contractSha256,
  });
  const critique = await createG12TaskContext({
    role: "critique",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture"),
  });
  assert.deepEqual(Object.keys(critique.prior.outputs), ["architecture"]);

  const implementation = await createG12TaskContext({
    role: "implementation",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture", "critique"),
  });
  assert.deepEqual(Object.keys(implementation.prior.outputs), ["architecture", "critique"]);
  assert.equal(implementation.response.patch, "required-unified-diff-within-mutable-exact");

  const initialCandidate = candidateDescriptor(state.contract);
  const receipt = verifierReceipt(state.contract, "ACCEPT", initialCandidate);
  const review = await createG12TaskContext({
    role: "review",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture", "critique", "implementation"),
    currentCandidate: initialCandidate,
    verifierReceipt: receipt,
  });
  assert.match(review.verifier.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(review.verifier.receipt.verdict, "ACCEPT");
  assert.deepEqual(review.currentCandidate, initialCandidate);
  assert.equal(
    review.bindings.currentCandidateSha256,
    canonicalSha256(initialCandidate),
  );
  assert.equal(
    review.verifier.currentCandidateSha256,
    review.bindings.currentCandidateSha256,
  );
  assert.equal(Object.isFrozen(review.currentCandidate), true);
  assert.equal(review.response.patch, "must-be-null");

  const repair = await createG12TaskContext({
    role: "repair",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture", "critique", "implementation"),
    currentCandidate: initialCandidate,
    verifierReceipt: verifierReceipt(
      state.contract,
      "REJECT",
      initialCandidate,
    ),
  });
  assert.equal(repair.verifier.receipt.verdict, "REJECT");
  assert.equal(repair.response.patch, "required-unified-diff-within-mutable-exact");

  const repairedCandidate = candidateDescriptor(
    state.contract,
    repairedPatch(),
    "repair-1",
  );
  const repairCycleTwo = await createG12TaskContext({
    role: "repair",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture", "critique", "implementation"),
    currentCandidate: repairedCandidate,
    verifierReceipt: verifierReceipt(
      state.contract,
      "REJECT",
      repairedCandidate,
    ),
  });
  assert.notEqual(
    repairCycleTwo.currentCandidate.patch,
    repairCycleTwo.prior.outputs.implementation.patch,
  );
  assert.equal(repairCycleTwo.currentCandidate.patch, repairedPatch());

  const reviewAfterRepair = await createG12TaskContext({
    role: "review",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture", "critique", "implementation"),
    currentCandidate: repairedCandidate,
    verifierReceipt: verifierReceipt(
      state.contract,
      "ACCEPT",
      repairedCandidate,
    ),
  });
  assert.equal(reviewAfterRepair.currentCandidate.patch, repairedPatch());
  assert.notEqual(
    reviewAfterRepair.currentCandidate.patchSha256,
    initialCandidate.patchSha256,
  );

  await assert.rejects(
    createG12TaskContext({
      role: "repair",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: {
        ...initialCandidate,
        patchSha256: digest("different patch"),
      },
      verifierReceipt: verifierReceipt(
        state.contract,
        "REJECT",
        initialCandidate,
      ),
    }),
    /does not bind the admitted patch bytes/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "review",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: initialCandidate,
      verifierReceipt: {
        ...receipt,
        candidateTree: gitObject("different candidate tree"),
      },
    }),
    /does not match the exact current candidate/u,
  );
  const incompleteReceipt = {
    ...verifierReceipt(state.contract, "REJECT", initialCandidate),
  };
  delete incompleteReceipt.candidateTree;
  delete incompleteReceipt.protectedManifest;
  await assert.rejects(
    createG12TaskContext({
      role: "repair",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: initialCandidate,
      verifierReceipt: incompleteReceipt,
    }),
    /must bind the exact current candidate/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "review",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: { ...initialCandidate, injected: true },
      verifierReceipt: receipt,
    }),
    /currentCandidate keys must be exactly/u,
  );

  await assert.rejects(
    createG12TaskContext({
      role: "repair",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: initialCandidate,
      verifierReceipt: receipt,
    }),
    /repair requires a rejecting verifier receipt/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "review",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: initialCandidate,
      verifierReceipt: verifierReceipt(
        state.contract,
        "REJECT",
        initialCandidate,
      ),
    }),
    /review requires an accepted complete verifier receipt/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "repair",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation", "review"),
      currentCandidate: initialCandidate,
      verifierReceipt: verifierReceipt(
        state.contract,
        "REJECT",
        initialCandidate,
      ),
    }),
    /keys must be exactly/u,
  );

  await assert.rejects(
    createG12TaskContext({
      role: "critique",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: { ...prior("architecture"), injected: outputs.architecture },
    }),
    /keys must be exactly/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "architecture",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      unknownAuthority: true,
    }),
    /keys must be exactly/u,
  );
  await assert.rejects(
    createG12TaskContext({
      role: "review",
      sourceSnapshot,
      contract: state.contract,
      contractSha256: state.contractSha256,
      priorOutputs: prior("architecture", "critique", "implementation"),
      currentCandidate: initialCandidate,
      verifierReceipt: { ...receipt, injected: "untrusted" },
    }),
    /keys must be exactly/u,
  );
});

test("repair accepts production-sized sandbox evidence and rejects receipts above the shared limit", async (t) => {
  const state = await fixture(t);
  const sourceSnapshot = await createG12SourceSnapshot({
    evaluator: state.evaluator,
    contract: state.contract,
    contractSha256: state.contractSha256,
  });
  const currentCandidate = candidateDescriptor(state.contract);
  const input = {
    role: "repair",
    sourceSnapshot,
    contract: state.contract,
    contractSha256: state.contractSha256,
    priorOutputs: prior("architecture", "critique", "implementation"),
    currentCandidate,
  };

  const repair = await createG12TaskContext({
    ...input,
    verifierReceipt: formatRejectReceipt(state.contract, currentCandidate, 140),
  });
  assert.equal(repair.verifier.receipt.stage, "format");
  assert.equal(repair.verifier.receipt.commands.length, 1);
  assert.equal(repair.verifier.receipt.commands[0].sandboxArgv.length, 140);

  const boundaryRepair = await createG12TaskContext({
    ...input,
    verifierReceipt: formatRejectReceipt(state.contract, currentCandidate, 1024),
  });
  assert.equal(boundaryRepair.verifier.receipt.commands[0].sandboxArgv.length, 1024);

  await assert.rejects(
    createG12TaskContext({
      ...input,
      verifierReceipt: formatRejectReceipt(state.contract, currentCandidate, 1025),
    }),
    /sandboxArgv must be a non-empty bounded argv array/u,
  );
});
