import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitHome, runGit } from "../src/candidate/git.mjs";
import { createVerifierForTesting } from "../src/candidate/verifier.mjs";
import { sha256 } from "../src/candidate/manifest.mjs";

const identity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "fixture@localhost",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "fixture@localhost",
  GIT_COMMITTER_NAME: "Fixture",
});

const commands = Object.freeze({
  format: { argv: ["cargo", "fmt"], timeoutMs: 1_000 },
  build: {
    argv: [
      "cargo",
      "test",
      "--no-run",
      "--test",
      "public_fixture",
      "--test",
      "independent_fixture",
      "--test",
      "regression_fixture",
    ],
    timeoutMs: 1_000,
  },
  public: { argv: ["cargo", "test", "public"], timeoutMs: 1_000 },
  independent: { argv: ["cargo", "test", "independent"], timeoutMs: 1_000 },
  regression: { argv: ["cargo", "test", "regression"], timeoutMs: 1_000 },
});

const contract = Object.freeze({
  commands,
  evaluator: { commit: "fixture" },
  ceilings: {
    maxTotalVerifierWallMs: 10_000,
    maxTestOutputBytesPerCommand: 64 * 1024,
    maxBuildOutputBytes: 64 * 1024,
    cargoBuildJobs: 2,
    maxResidentBytes: 512 * 1024 * 1024,
    maxVerifierDiskBytes: 512 * 1024 * 1024,
  },
  initialRed: {
    exitCode: 101,
    passed: 0,
    failed: 2,
    requiredSubstrings: ["lost update reproduced", "write skew reproduced"],
    forbiddenSubstrings: ["could not compile", "timed out"],
  },
  success: { publicPassed: 2, independentPassed: 3, regressionPassed: 2 },
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-verifier-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "repo");
  const targetRoot = join(root, "target");
  const commandTemp = join(root, "tmp");
  const gitHome = await createGitHome(root);
  await Promise.all([
    mkdir(workspace, { mode: 0o700 }),
    mkdir(targetRoot, { mode: 0o700 }),
    mkdir(commandTemp, { mode: 0o700 }),
  ]);
  await runGit({ args: ["init", "--initial-branch=main"], cwd: workspace, home: gitHome });
  await writeFile(join(workspace, "source.rs"), "fn main() {}\n", "utf8");
  await runGit({ args: ["add", "source.rs"], cwd: workspace, home: gitHome });
  await runGit({
    args: ["commit", "-m", "sealed"],
    cwd: workspace,
    home: gitHome,
    environmentOverrides: identity,
  });
  const candidateCommit = (
    await runGit({ args: ["rev-parse", "HEAD"], cwd: workspace, home: gitHome })
  ).trim();
  const candidateTree = (
    await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: workspace, home: gitHome })
  ).trim();
  return {
    candidate: Object.freeze({
      temporaryRoot: root,
      workspace,
      targetRoot,
      commandTemp,
      gitHome,
      candidateCommit,
      candidateTree,
      candidatePatchSha256: "a".repeat(64),
      protectedManifest: Object.freeze({ entries: 1, sha256: "b".repeat(64) }),
      kind: "candidate",
    }),
  };
}

function fakeSessionRunner({ calls, publicRed = false, buildFails = false }) {
  return async (options) => {
    calls.push(options);
    const names = buildFails
      ? ["format", "build"]
      : ["format", "build", "public", "independent", "regression"];
    const records = names.map((name) => {
      let exitCode = name === "build" && buildFails ? 101 : 0;
      let stdout = "";
      if (name === "public") {
        if (publicRed) {
          exitCode = 101;
          stdout = [
            "lost update reproduced",
            "write skew reproduced",
            "test result: FAILED. 0 passed; 2 failed; 0 ignored",
          ].join("\n");
        } else {
          stdout = "test result: ok. 2 passed; 0 failed; 0 ignored";
        }
      }
      if (name === "independent") {
        stdout = "test result: ok. 3 passed; 0 failed; 0 ignored";
      }
      if (name === "regression") {
        stdout = "test result: ok. 2 passed; 0 failed; 0 ignored";
      }
      return Object.freeze({
        name,
        logicalArgv: Object.freeze([...commands[name].argv]),
        exitCode,
        signal: null,
        disposition: "completed",
        durationMs: 1,
        stdout,
        stderr: "",
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(""),
      });
    });
    return Object.freeze({
      invocation: Object.freeze({
        argv: Object.freeze([
          "/usr/bin/systemd-run",
          "--user",
          "--scope",
          "--",
          "/usr/bin/bwrap",
          "--size",
          String(options.maxDiskBytes),
          "--tmpfs",
          "/state",
        ]),
        logicalCommands: Object.freeze([]),
        network: "isolated",
        workspace: "read-only",
        state: "single-quota-tmpfs",
      }),
      outcome: Object.freeze({
        exitCode: 0,
        signal: null,
        disposition: "completed",
        durationMs: 5,
        stdout: "",
        stderr: "",
      }),
      resultSha256: sha256(`session:${publicRed}:${buildFails}`),
      resultBytes: 1024,
      session: Object.freeze({
        schemaVersion: 1,
        status: "completed",
        stage: buildFails ? "build" : "complete",
        commands: Object.freeze(records),
        artifacts: buildFails
          ? Object.freeze([])
          : Object.freeze(
              ["public_fixture", "independent_fixture", "regression_fixture"].map(
                (name) => Object.freeze({
                  name: `${name}-sealed`,
                  sha256: sha256(name),
                  bytes: name.length,
                  mode: 0o700,
                }),
              ),
            ),
        stateBytes: 4096,
        durationMs: 5,
      }),
    });
  };
}

test("candidate verifier runs one persistent session and binds invocation and result evidence", async (t) => {
  const { candidate } = await fixture(t);
  const calls = [];
  const verifier = createVerifierForTesting(fakeSessionRunner({ calls }));
  const result = await verifier.verifyCandidate({
    candidate,
    contract,
  });
  assert.equal(result.verdict, "ACCEPT");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workspace, candidate.workspace);
  assert.equal(Object.hasOwn(calls[0], "targetRoot"), false);
  assert.equal(Object.hasOwn(calls[0], "commandTemp"), false);
  assert.equal(result.artifacts.length, 4);
  assert.ok(result.artifacts.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256)));
  assert.ok(result.commands.every(({ network }) => network === "isolated"));
  assert.ok(result.commands.every(({ sandboxArgv }) => sandboxArgv === result.commands[0].sandboxArgv));
  assert.deepEqual(result.artifacts.at(-1), {
    name: "verifier-session-result.json",
    sha256: sha256("session:false:false"),
    bytes: 1024,
  });
});

test("candidate verifier stops at a failed build", async (t) => {
  const { candidate } = await fixture(t);
  const calls = [];
  const verifier = createVerifierForTesting(fakeSessionRunner({ calls, buildFails: true }));
  const result = await verifier.verifyCandidate({
    candidate,
    contract,
  });
  assert.equal(result.verdict, "REJECT");
  assert.equal(result.stage, "build");
  assert.equal(calls.length, 1);
  assert.deepEqual(result.commands.map(({ name }) => name), ["format", "build"]);
  assert.deepEqual(result.artifacts.map(({ name }) => name), ["verifier-session-result.json"]);
});

test("red baseline requires the exact anomaly and green independent references", async (t) => {
  const { candidate } = await fixture(t);
  const evaluator = Object.freeze({
    ...candidate,
    candidatePatchSha256: null,
    kind: "evaluator",
  });
  const redContract = Object.freeze({
    ...contract,
    evaluator: Object.freeze({ commit: evaluator.candidateCommit }),
  });
  const calls = [];
  const verifier = createVerifierForTesting(fakeSessionRunner({ calls, publicRed: true }));
  const result = await verifier.verifyRedBaseline({
    candidate: evaluator,
    contract: redContract,
  });
  assert.equal(result.verdict, "CONFIRMED_RED");
  assert.equal(result.initialRedMatched, true);
  assert.equal(result.referencesGreen, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    result.commands.map(({ name }) => name),
    ["format", "build", "public", "independent", "regression"],
  );
});
