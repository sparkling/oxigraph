import assert from "node:assert/strict";
import test from "node:test";
import { scrubbedChildEnvironment } from "../child-environment.mjs";
import {
  applyCommandSafeguards,
  countCargoPassedTests,
  execute,
  parseNodeTestSummary,
  validateCommand,
} from "./process-runner.mjs";

test("child processes cannot inherit provider, proxy, or secret authority", () => {
  const environment = scrubbedChildEnvironment(
    { AQE_MEMORY_BACKEND: "memory" },
    {
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      ANTHROPIC_API_KEY: "secret",
      OPENAI_BASE_URL: "https://attacker.invalid",
      OPENROUTER_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      HTTPS_PROXY: "https://proxy.invalid",
      AWS_ACCESS_KEY_ID: "secret",
      AWS_PROFILE: "production",
      DOCKER_CONFIG: "/secret/docker",
      GIT_ASKPASS: "/secret/helper",
      CC: "/secret/compiler",
      DYLD_LIBRARY_PATH: "/secret/dylib",
      LD_LIBRARY_PATH: "/secret/lib",
      MAVEN_OPTS: "-javaagent:/secret/agent.jar",
      NODE_OPTIONS: "--require=/secret/inject.js",
      RUSTFLAGS: "-C linker=/secret/linker",
      RUSTUP_TOOLCHAIN: "/secret/toolchain",
      UNREVIEWED_VALUE: "hidden",
    },
  );
  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
    AQE_MEMORY_BACKEND: "memory",
  });
  assert.throws(
    () => scrubbedChildEnvironment({ OPENROUTER_API_KEY: "secret" }),
    /override is prohibited/,
  );
  for (const name of ["CC", "LD_LIBRARY_PATH", "MAVEN_OPTS", "RUSTFLAGS"]) {
    assert.throws(
      () => scrubbedChildEnvironment({ [name]: "attacker" }),
      /override is prohibited/,
    );
  }
});

test("counts only complete, line-anchored libtest summaries", () => {
  const output = [
    "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.01s",
    "attacker: test result: ok. 9000 passed;",
    "test result: ok. 7000 passed;",
    "test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in .20s",
  ].join("\n");
  assert.equal(countCargoPassedTests(output), 5);

  const tap = [
    "1..15",
    "# tests 15",
    "# suites 0",
    "# pass 15",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 12.5",
  ].join("\n");
  const observed = parseNodeTestSummary(tap);
  assert.equal(observed.pass, 15);
  assert.equal(observed.duplicateOrMissing, false);
  assert.equal(observed.terminal, true);
  assert.equal(observed.conserved, true);
  assert.equal(
    applyCommandSafeguards(
      { observedNodeTestSummary: observed },
      { expectedNodeTests: 15, expectedNodeSuites: 0 },
    ).testSafeguard.passed,
    true,
  );
  assert.equal(
    applyCommandSafeguards(
      {
        observedNodeTestSummary: parseNodeTestSummary(
          `${tap}\ntrailing output`,
        ),
      },
      { expectedNodeTests: 15, expectedNodeSuites: 0 },
    ).testSafeguard.passed,
    false,
  );
});

test("exact safeguard fails closed when a complete spoof adds tests", () => {
  const result = applyCommandSafeguards(
    {
      observedPassedTests: countCargoPassedTests(
        [
          "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
          "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
        ].join("\n"),
      ),
    },
    { minimumPassedTests: 3, expectedPassedTests: 3 },
  );
  assert.equal(result.testSafeguard.observedPassedTests, 6);
  assert.equal(result.testSafeguard.passed, false);
});

test("Cargo test inventory survives bounded diagnostic tails", async () => {
  const result = await execute(
    process.execPath,
    [
      "-e",
      'process.stdout.write("first: test\\nsecond: test\\n" + "x".repeat(70000))',
    ],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureCargoTestIds: true,
    },
  );
  assert.deepEqual(result.observedCargoTestIds, ["first", "second"]);
  assert.equal(result.stdoutTail.includes("first: test"), false);
});

test("Cargo inventories and required sentinels are unambiguous", () => {
  assert.throws(
    () =>
      validateCommand("bad", "cargo", ["test", "--locked"], {
        minimumPassedTests: 2,
        expectedPassedTests: 2,
        expectedTestIds: ["same", "same"],
        timeoutMs: 1_000,
      }),
    /invalid reviewed Cargo test inventory/,
  );
  assert.doesNotThrow(() =>
    validateCommand("good", "cargo", ["test", "--locked"], {
      minimumPassedTests: 2,
      expectedPassedTests: 2,
      expectedTestIds: ["first", "second"],
      timeoutMs: 1_000,
    }),
  );
  assert.throws(
    () =>
      validateCommand("partial-as-exact", "cargo", ["test", "--locked"], {
        minimumPassedTests: 2,
        expectedPassedTests: 2,
        expectedTestIds: ["first"],
        timeoutMs: 1_000,
      }),
    /invalid reviewed Cargo test inventory/,
  );
  assert.doesNotThrow(() =>
    validateCommand("sentinels", "cargo", ["test", "--locked"], {
      minimumPassedTests: 3,
      expectedPassedTests: 3,
      requiredTestIds: ["critical"],
      timeoutMs: 1_000,
    }),
  );
  for (const requiredTestIds of [[], ["same", "same"]]) {
    assert.throws(
      () =>
        validateCommand("bad-sentinels", "cargo", ["test", "--locked"], {
          minimumPassedTests: 2,
          expectedPassedTests: 2,
          requiredTestIds,
          timeoutMs: 1_000,
        }),
      /invalid required Cargo test sentinels/,
    );
  }
  assert.throws(
    () =>
      validateCommand("ambiguous", "cargo", ["test", "--locked"], {
        minimumPassedTests: 1,
        expectedPassedTests: 1,
        expectedTestIds: ["same"],
        requiredTestIds: ["same"],
        timeoutMs: 1_000,
      }),
    /invalid required Cargo test sentinels/,
  );
});

test("every command has an explicit positive timeout", () => {
  assert.throws(
    () => validateCommand("node-command", "node", ["--version"], {}),
    /invalid command or timeout/,
  );
  assert.doesNotThrow(() =>
    validateCommand("node-command", "node", ["--version"], {
      timeoutMs: 1_000,
    }),
  );
  assert.doesNotThrow(() =>
    validateCommand(
      "node-tests",
      "node",
      ["--test", "--test-reporter=tap", "probe.test.mjs"],
      {
        timeoutMs: 1_000,
        expectedNodeTests: 1,
        expectedNodeSuites: 0,
      },
    ),
  );
});

test("command timeout fails closed", async () => {
  const result = await execute(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      announce: false,
      quiet: true,
      timeoutMs: 50,
    },
  );
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});
