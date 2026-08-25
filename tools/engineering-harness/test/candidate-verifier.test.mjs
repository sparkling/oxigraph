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

const emptyDiagnostic = Object.freeze({
  primaryClass: null,
  rustcCodes: Object.freeze([]),
  childRole: "unknown",
  childTermination: null,
  childExitCode: null,
  childSignalNumber: null,
  childSignalName: null,
  ioArea: "unknown",
  ioErrno: null,
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

function fakeSessionRunner({
  calls,
  publicRed = false,
  compilerRed = false,
  buildFails = false,
  formatFails = false,
  failureDisposition = "completed",
  failureDiagnostic = emptyDiagnostic,
  sandboxArgv = null,
}) {
  return async (options) => {
    calls.push(options);
    const names = formatFails
      ? ["format"]
      : buildFails
        ? ["format", "build"]
        : ["format", "build", "public", "independent", "regression"];
    const records = names.map((name) => {
      const failed = (name === "format" && formatFails) || (name === "build" && buildFails);
      let exitCode = failed ? (failureDisposition === "completed" ? 101 : null) : 0;
      let stdout = "";
      let stderr = "";
      if (name === "public") {
        if (compilerRed) {
          exitCode = 101;
          stderr = [
            "error[E0432]: unresolved imports `crate::Alpha`, `crate::Beta`",
            "  --> lib/oxigraph/tests/compiler_fixture.rs:9:5",
            "Alpha Beta",
            "error: could not compile `oxigraph` (test \"compiler_fixture\") due to 1 previous error",
          ].join("\n");
        } else if (publicRed) {
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
        signal: failed && failureDisposition !== "completed" ? "SIGKILL" : null,
        disposition: failed ? failureDisposition : "completed",
        durationMs: 1,
        stdout,
        stderr,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
        diagnostic: failed ? failureDiagnostic : emptyDiagnostic,
      });
    });
    return Object.freeze({
      invocation: Object.freeze({
        argv: Object.freeze(
          sandboxArgv ?? [
            "/usr/bin/systemd-run",
            "--user",
            "--scope",
            "--",
            "/usr/bin/bwrap",
            "--size",
            String(options.maxDiskBytes),
            "--tmpfs",
            "/state",
          ],
        ),
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
      resultSha256: sha256(`session:${publicRed}:${compilerRed}:${buildFails}:${formatFails}:${failureDisposition}`),
      resultBytes: 1024,
      session: Object.freeze({
        schemaVersion: 1,
        status: "completed",
        stage: formatFails ? "format" : buildFails ? "build" : "complete",
        commands: Object.freeze(records),
        artifacts: formatFails || buildFails
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
    sha256: sha256("session:false:false:false:false:completed"),
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
  assert.equal(result.candidateTree, candidate.candidateTree);
  assert.strictEqual(result.protectedManifest, candidate.protectedManifest);
});

test("candidate verifier binds exact identity on product and infrastructure fail-fast outcomes", async (t) => {
  const { candidate } = await fixture(t);
  const cases = [
    {
      name: "format product rejection",
      options: { formatFails: true },
      stage: "format",
    },
    {
      name: "build infrastructure timeout",
      options: { buildFails: true, failureDisposition: "timeout" },
      stage: "build",
    },
  ];
  for (const fixtureCase of cases) {
    const calls = [];
    const verifier = createVerifierForTesting(
      fakeSessionRunner({ calls, ...fixtureCase.options }),
    );
    const result = await verifier.verifyCandidate({ candidate, contract });
    assert.equal(result.verdict, "REJECT", fixtureCase.name);
    assert.equal(result.stage, fixtureCase.stage, fixtureCase.name);
    assert.equal(result.candidateTree, candidate.candidateTree, fixtureCase.name);
    assert.strictEqual(
      result.protectedManifest,
      candidate.protectedManifest,
      fixtureCase.name,
    );
    assert.equal(calls.length, 1, fixtureCase.name);
  }
});

test("candidate verifier admits production-sized sandbox evidence and rejects invalid producer output", async (t) => {
  const { candidate } = await fixture(t);
  const productionArgv = Array.from(
    { length: 140 },
    (_, index) => (index === 0 ? "/usr/bin/systemd-run" : `sandbox-argument-${index}`),
  );
  const verifier = createVerifierForTesting(
    fakeSessionRunner({ calls: [], sandboxArgv: productionArgv }),
  );
  const result = await verifier.verifyCandidate({ candidate, contract });
  assert.equal(result.verdict, "ACCEPT");
  assert.equal(result.commands[0].sandboxArgv.length, 140);

  const invalidArgv = [
    Array.from({ length: 1025 }, (_, index) => `sandbox-argument-${index}`),
    ["/usr/bin/bwrap", ""],
    ["/usr/bin/bwrap", "line\nbreak"],
    ["/usr/bin/bwrap", "x".repeat(4097)],
  ];
  for (const sandboxArgv of invalidArgv) {
    const invalidVerifier = createVerifierForTesting(
      fakeSessionRunner({ calls: [], sandboxArgv }),
    );
    await assert.rejects(
      invalidVerifier.verifyCandidate({ candidate, contract }),
      /single-session verifier returned invalid infrastructure evidence/u,
    );
  }
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

test("compiler-red baseline requires one exact rustc error and green controls", async (t) => {
  const { candidate } = await fixture(t);
  const evaluator = Object.freeze({
    ...candidate,
    candidatePatchSha256: null,
    kind: "evaluator",
  });
  const compilerContract = Object.freeze({
    ...contract,
    evaluator: Object.freeze({ commit: evaluator.candidateCommit }),
    initialRed: Object.freeze({
      kind: "compiler",
      commandRole: "public",
      exitCode: 101,
      rustcCode: "E0432",
      rustcErrorCount: 1,
      primaryPath: "lib/oxigraph/tests/compiler_fixture.rs",
      requiredExports: Object.freeze(["Alpha", "Beta"]),
      requiredSubstrings: Object.freeze([
        "error[E0432]: unresolved imports",
        "could not compile `oxigraph` (test \"compiler_fixture\") due to 1 previous error",
      ]),
      forbiddenSubstrings: Object.freeze(["no test target named", "timed out"]),
    }),
    success: Object.freeze({ publicPassed: 2, independentPassed: 3, regressionPassed: 2 }),
  });
  const verifier = createVerifierForTesting(
    fakeSessionRunner({ calls: [], compilerRed: true }),
  );
  const result = await verifier.verifyRedBaseline({
    candidate: evaluator,
    contract: compilerContract,
  });

  assert.equal(result.verdict, "CONFIRMED_RED");
  assert.equal(result.initialRedMatched, true);
  assert.equal(result.referencesGreen, true);
  assert.deepEqual(
    result.commands.map(({ name }) => name),
    ["format", "build", "public", "independent", "regression"],
  );
});

test("red baseline retains bounded full-buffer diagnostics without changing candidate receipts", async (t) => {
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
  const failureDiagnostic = Object.freeze({
    ...emptyDiagnostic,
    primaryClass: "child-process-signaled",
    childRole: "rustc",
    childTermination: "signal",
    childSignalNumber: 9,
    childSignalName: "SIGKILL",
  });
  const runner = fakeSessionRunner({
    calls: [],
    buildFails: true,
    failureDiagnostic,
  });
  const verifier = createVerifierForTesting(runner);

  const baseline = await verifier.verifyRedBaseline({
    candidate: evaluator,
    contract: redContract,
  });
  assert.equal(baseline.verdict, "INCONCLUSIVE");
  assert.deepEqual(baseline.commands[1].diagnostic, failureDiagnostic);

  const product = await verifier.verifyCandidate({ candidate, contract });
  assert.equal(product.verdict, "REJECT");
  assert.equal(Object.hasOwn(product.commands[1], "diagnostic"), false);
});
