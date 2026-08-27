import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { scrubbedChildEnvironment } from "../child-environment.mjs";
import {
  parseCargoTestIds,
  parseCargoTestSummaries,
} from "./native-test-contract.mjs";
import {
  applyCommandSafeguards,
  commandPassed,
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

test("qualification processes can disable every inherited environment name", async () => {
  const result = await execute(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.env))"],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureOutputBytes: 4_096,
      inheritEnvironment: false,
      env: {
        HOME: "/tmp/g17-home",
        LANG: "C.UTF-8",
        PATH: "/usr/bin:/bin",
      },
    },
  );
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.capturedOutput.stdout.toString("utf8")), {
    HOME: "/tmp/g17-home",
    LANG: "C.UTF-8",
    PATH: "/usr/bin:/bin",
  });
  await assert.rejects(
    execute(process.execPath, ["-e", "process.exit(99)"], {
      announce: false,
      inheritEnvironment: "no",
    }),
    /environment inheritance policy is invalid/u,
  );
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
  assert.throws(
    () => parseCargoTestIds("a: test\n".repeat(16_385)),
    /observation ceiling/u,
  );
  const cargoSummary =
    "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; " +
    "0 filtered out; finished in 0.01s\n";
  assert.throws(
    () => parseCargoTestSummaries(cargoSummary.repeat(4_097)),
    /observation ceiling/u,
  );
  assert.throws(
    () => parseNodeTestSummary("1..1\n".repeat(3)),
    /observation ceiling/u,
  );
  assert.throws(
    () => parseCargoTestIds(`${"i".repeat(4_097)}: test\n`),
    /observation ceiling/u,
  );
  assert.throws(
    () => parseCargoTestIds(`${"i".repeat(4_096)}: test\n`.repeat(1_025)),
    /observation ceiling/u,
  );
  assert.throws(() => parseCargoTestIds("x".repeat(65_537)), /byte ceiling/u);
});

test("exact safeguard fails closed when a complete spoof adds tests", () => {
  const output = [
    "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
    "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
  ].join("\n");
  const result = applyCommandSafeguards(
    {
      stdoutTail: output,
      stderrTail: "",
    },
    {
      minimumPassedTests: 3,
      expectedPassedTests: 3,
      expectedCargoSummaryCount: 1,
    },
  );
  assert.equal(result.testSafeguard.observedPassedTests, 6);
  assert.equal(result.testSafeguard.passed, false);
});

test("Cargo safeguard retains its bounded-tail compatibility fallback", () => {
  const result = applyCommandSafeguards(
    {
      stdoutTail:
        "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
      stderrTail: "",
    },
    { minimumPassedTests: 2, expectedPassedTests: 2 },
  );
  assert.equal(result.testSafeguard.observedPassedTests, 2);
  assert.equal(result.testSafeguard.passed, true);
});

test("Cargo safeguard rejects a FAILED terminal summary even after exit zero", async () => {
  const raw = await execute(
    process.execPath,
    [
      "-e",
      'process.stdout.write("test result: FAILED. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\\n")',
    ],
    { announce: false, quiet: true, timeoutMs: 1_000 },
  );
  const result = applyCommandSafeguards(raw, {
    minimumPassedTests: 3,
    expectedPassedTests: 3,
    expectedCargoSummaryCount: 1,
  });
  assert.equal(result.code, 0);
  assert.equal(result.testSafeguard.observed.allSuccessful, false);
  assert.equal(result.testSafeguard.passed, false);
  assert.equal(commandPassed(result), false);
});

test("Cargo safeguard rejects summaries emitted on stderr", async () => {
  const raw = await execute(
    process.execPath,
    [
      "-e",
      'process.stderr.write("test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\\n")',
    ],
    { announce: false, quiet: true, timeoutMs: 1_000 },
  );
  const result = applyCommandSafeguards(raw, {
    minimumPassedTests: 3,
    expectedPassedTests: 3,
    expectedCargoSummaryCount: 1,
  });
  assert.equal(result.testSafeguard.observed.allOnStdout, false);
  assert.equal(result.testSafeguard.passed, false);
  assert.equal(commandPassed(result), false);
});

test("Cargo safeguard rejects duplicate and nonterminal summaries", () => {
  const summary =
    "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s";
  for (const stdoutTail of [
    `${summary}\n${summary}`,
    `${summary}\ntrailing output`,
  ]) {
    const result = applyCommandSafeguards(
      { stdoutTail, stderrTail: "" },
      {
        minimumPassedTests: 2,
        expectedPassedTests: 2,
        expectedCargoSummaryCount: 1,
      },
    );
    assert.equal(result.testSafeguard.passed, false);
  }
});

test("Cargo safeguard accepts a reviewed terminal multi-summary shape", () => {
  const result = applyCommandSafeguards(
    {
      stdoutTail: [
        "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.01s",
        "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.01s",
      ].join("\n"),
      stderrTail: "",
    },
    {
      minimumPassedTests: 3,
      expectedPassedTests: 3,
      expectedCargoSummaryCount: 2,
    },
  );
  assert.equal(result.testSafeguard.observed.summaryCount, 2);
  assert.equal(result.testSafeguard.observed.outcomeCount, 3);
  assert.equal(result.testSafeguard.passed, true);
});

test("Cargo safeguard conserves inventoried outcomes", () => {
  const result = applyCommandSafeguards(
    {
      stdoutTail:
        "test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s",
      stderrTail: "",
    },
    {
      minimumPassedTests: 2,
      expectedPassedTests: 2,
      expectedCargoSummaryCount: 1,
    },
  );
  assert.equal(result.testSafeguard.observed.outcomeCount, 3);
  assert.equal(result.testSafeguard.passed, false);
});

test("Cargo test inventory survives bounded diagnostic tails", async () => {
  const result = await execute(
    process.execPath,
    [
      "-e",
      'process.stdout.write("first: test\\nsecond: test\\n" + "diagnostic\\n".repeat(7000))',
    ],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureCargoTestIds: true,
    },
  );
  assert.deepEqual(result.observedCargoTestIds, ["first", "second"]);
  assert.equal(result.scanLimitExceeded, false);
  assert.equal(result.stdoutTail.includes("first: test"), false);
});

test("streaming UTF-8 decoding preserves split Cargo test IDs and tails", async () => {
  const result = await execute(
    process.execPath,
    [
      "-e",
      [
        "process.stdout.write(Buffer.from([0x63, 0x61, 0x66, 0xc3]))",
        "setTimeout(() => process.stdout.write(Buffer.from([0xa9, 0x3a, 0x20, 0x74, 0x65, 0x73, 0x74, 0x0a])), 10)",
      ].join(";"),
    ],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureCargoTestIds: true,
    },
  );
  assert.equal(result.scanLimitExceeded, false);
  assert.deepEqual(result.observedCargoTestIds, ["café"]);
  assert.equal(result.stdoutTail, "café: test\n");
});

test("invalid and incomplete UTF-8 fail scanners closed", async () => {
  for (const source of [
    "process.stdout.write(Buffer.from([0xc3, 0x28]))",
    "process.stdout.write(Buffer.from([0xc3]))",
  ]) {
    const result = await execute(process.execPath, ["-e", source], {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureCargoTestIds: true,
    });
    assert.equal(result.code, 0);
    assert.equal(result.scanLimitExceeded, true);
    assert.equal(result.scanFailureReason, "invalid-or-incomplete-utf8");
    assert.equal(commandPassed(result), false);
  }
});

test("Cargo test ID byte ceilings bound individual and aggregate retention", async () => {
  const oversized = await execute(
    process.execPath,
    ["-e", 'process.stdout.write("x".repeat(4097) + ": test\\n")'],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureCargoTestIds: true,
    },
  );
  assert.equal(oversized.scanLimitExceeded, true);
  assert.equal(oversized.scanFailureReason, "cargo-test-id-byte-limit");
  assert.deepEqual(oversized.observedCargoTestIds, []);

  const aggregate = await execute(
    process.execPath,
    [
      "-e",
      'for (let i = 0; i < 1100; i += 1) process.stdout.write(`${i}-` + "x".repeat(4085) + ": test\\n")',
    ],
    {
      announce: false,
      quiet: true,
      timeoutMs: 2_000,
      captureCargoTestIds: true,
    },
  );
  assert.equal(aggregate.scanLimitExceeded, true);
  assert.equal(aggregate.scanFailureReason, "cargo-test-id-total-byte-limit");
  assert.ok(aggregate.observedCargoTestIds.length < 1100);
});

test("raw process output capture is explicit, exact, and bounded", async () => {
  const uncaptured = await execute(
    process.execPath,
    ["-e", 'process.stdout.write("alpha"); process.stderr.write("beta")'],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
    },
  );
  assert.equal(uncaptured.capturedOutput, undefined);
  assert.equal(uncaptured.outputLimitExceeded, false);
  assert.equal(uncaptured.outputLimitBytes, 64 * 1024 * 1024);

  const captured = await execute(
    process.execPath,
    ["-e", 'process.stdout.write("alpha"); process.stderr.write("beta")'],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
      captureOutputBytes: 16,
    },
  );
  assert.equal(captured.code, 0);
  assert.equal(captured.outputLimitExceeded, false);
  assert.equal(captured.outputLimitBytes, 16);
  assert.deepEqual(captured.capturedOutput, {
    limitBytes: 16,
    stdout: Buffer.from("alpha"),
    stderr: Buffer.from("beta"),
  });
});

test("raw process output capture rejects invalid ceilings before spawning", async () => {
  for (const captureOutputBytes of [0, 1.5, 64 * 1024 * 1024 + 1]) {
    await assert.rejects(
      execute(process.execPath, ["-e", "process.exit(99)"], {
        announce: false,
        quiet: true,
        captureOutputBytes,
      }),
      /captured process output ceiling is invalid/u,
    );
  }
});

test("unterminated scanner fragments stay bounded and cannot forge a Cargo summary", async () => {
  const result = await execute(
    process.execPath,
    [
      "-e",
      'process.stdout.write("x".repeat(1024 * 1024)); process.stdout.write("test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\\n")',
    ],
    {
      announce: false,
      quiet: true,
      timeoutMs: 1_000,
    },
  );
  assert.equal(result.code, 0);
  assert.equal(result.observedPassedTests, 0);
  assert.equal(result.scanLimitExceeded, true);
  assert.equal(result.scanFailureReason, "unterminated-scanner-fragment-limit");
  assert.ok(result.stdoutTail.length <= 65_536);
});

test("scanner observation arrays fail closed at their fixed ceiling", async () => {
  const result = await execute(
    process.execPath,
    [
      "-e",
      "for (let i = 0; i < 17000; i += 1) process.stdout.write(`case-${i}: test\\n`)",
    ],
    {
      announce: false,
      quiet: true,
      timeoutMs: 2_000,
      captureCargoTestIds: true,
    },
  );
  assert.equal(result.code, 0);
  assert.equal(result.scanLimitExceeded, true);
  assert.equal(result.observedCargoTestIds.length, 16_384);
});

test("hard timeout aborts with typed cleanup uncertainty for an escaped descendant", async () => {
  const started = Date.now();
  let escapedPid;
  try {
    await assert.rejects(
      execute(
        process.execPath,
        [
          "-e",
          [
            'const { spawn } = require("node:child_process")',
            'const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 10000)"], { detached: true, stdio: ["ignore", "inherit", "ignore"] })',
            "process.stdout.write(`${child.pid}\\n`)",
            "child.unref()",
            "process.exit(0)",
          ].join(";"),
        ],
        {
          announce: false,
          quiet: true,
          timeoutMs: 50,
          terminationGraceMs: 25,
          captureOutputBytes: 4_096,
        },
      ),
      (error) => {
        assert.equal(error.code, "PROCESS_CLEANUP_UNCONFIRMED");
        assert.equal(error.processResult.timedOut, true);
        assert.equal(error.processResult.cleanupUnconfirmed, true);
        escapedPid = Number.parseInt(
          error.processResult.capturedOutput.stdout.toString("utf8"),
          10,
        );
        assert.ok(Number.isInteger(escapedPid));
        assert.doesNotThrow(() => process.kill(escapedPid, 0));
        return true;
      },
    );
    assert.ok(Date.now() - started < 1_000);
  } finally {
    if (Number.isInteger(escapedPid)) {
      try {
        process.kill(escapedPid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
});

test("timeout completes the KILL phase for a same-group TERM-resistant descendant", async () => {
  let descendantPid;
  try {
    await assert.rejects(
      execute(
        process.execPath,
        [
          "-e",
          [
            'const { spawn } = require("node:child_process")',
            'const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" })',
            "process.stdout.write(`${child.pid}\\n`)",
            "setInterval(() => {}, 1000)",
          ].join(";"),
        ],
        {
          announce: false,
          quiet: true,
          timeoutMs: 50,
          terminationGraceMs: 50,
          captureOutputBytes: 4_096,
        },
      ),
      (error) => {
        assert.equal(error.code, "PROCESS_CLEANUP_UNCONFIRMED");
        assert.equal(error.processResult.killAttempted, true);
        descendantPid = Number.parseInt(
          error.processResult.capturedOutput.stdout.toString("utf8"),
          10,
        );
        assert.ok(Number.isInteger(descendantPid));
        return true;
      },
    );
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
      try {
        process.kill(descendantPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
        alive = false;
      }
    }
    assert.equal(alive, false);
  } finally {
    if (Number.isInteger(descendantPid)) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
});

test("raw process output ceiling aborts with exact bounded partial evidence", async () => {
  await assert.rejects(
    execute(
      process.execPath,
      [
        "-e",
        'process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000)',
      ],
      {
        announce: false,
        quiet: true,
        timeoutMs: 2_000,
        terminationGraceMs: 25,
        captureOutputBytes: 32,
      },
    ),
    (error) => {
      assert.equal(error.code, "PROCESS_CLEANUP_UNCONFIRMED");
      const result = error.processResult;
      assert.equal(result.outputLimitExceeded, true);
      assert.equal(result.terminationReason, "output-limit");
      assert.equal(result.capturedOutput.stdout.length, 32);
      assert.equal(result.capturedOutput.stderr.length, 0);
      assert.equal(result.output.stdoutBytes, 32);
      assert.equal(
        result.output.stdoutSha256,
        createHash("sha256").update(result.capturedOutput.stdout).digest("hex"),
      );
      return true;
    },
  );
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
      expectedCargoSummaryCount: 1,
      expectedTestIds: ["first", "second"],
      timeoutMs: 1_000,
    }),
  );
  assert.throws(
    () =>
      validateCommand("bad-summary-count", "cargo", ["test", "--locked"], {
        minimumPassedTests: 1,
        expectedPassedTests: 1,
        expectedCargoSummaryCount: 0,
        timeoutMs: 1_000,
      }),
    /invalid Cargo summary-count safeguard/u,
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
  assert.throws(
    () =>
      validateCommand("node-command", "node", ["--version"], {
        timeoutMs: 1_000,
        requireCompleteOutputReplay: "yes",
      }),
    /invalid complete-output replay policy/u,
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
  await assert.rejects(
    execute(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      announce: false,
      quiet: true,
      timeoutMs: 50,
      terminationGraceMs: 25,
    }),
    (error) =>
      error.code === "PROCESS_CLEANUP_UNCONFIRMED" &&
      error.processResult.timedOut === true &&
      error.processResult.cleanupUnconfirmed === true,
  );
});
