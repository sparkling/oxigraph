import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SANDBOX_SESSION_WORKER_V2_FAILURE_CODES,
  createSandboxSessionWorkerV2ControllerForTesting,
  parseSandboxSessionWorkerConfigurationV2,
  parseSandboxSessionWorkerResultV2,
  runSandboxSessionWorkerV2,
} from "../src/candidate/sandbox-session-worker-v2.mjs";
import { exactCargoBuildArtifactStemsV2 } from "../src/policy/build-command-v2.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";
import { canonicalJson } from "../src/routing/features.mjs";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function wire(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function configuration(overrides = {}) {
  const value = {
    schemaVersion: 2,
    contractSha256: "a".repeat(64),
    verificationSequence: ["format", "build", "public"],
    commands: {
      format: { argv: ["cargo", "fmt", "--check"], timeoutMs: 120_000 },
      build: {
        argv: [
          "cargo",
          "test",
          "--no-run",
          "--test",
          "public",
          "--bin",
          "server",
        ],
        timeoutMs: 120_000,
      },
      public: {
        argv: ["cargo", "test", "--test", "public"],
        timeoutMs: 120_000,
      },
    },
    ceilings: {
      maxBuildOutputBytes: 8 * MiB,
      maxTestOutputBytesPerCommand: 2 * MiB,
      maxTotalVerifierWallMs: 600_000,
      maxVerifierDiskBytes: 2 * GiB,
      cargoBuildJobs: 2,
    },
  };
  return Object.assign(value, overrides);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactOutcome({
  stdout = Buffer.alloc(0),
  stderr = Buffer.alloc(0),
  exitCode = 0,
  disposition = "completed",
  firstTerminalReason = disposition,
  overrides = {},
} = {}) {
  return {
    disposition,
    firstTerminalReason,
    syntheticTestOnly: false,
    spawned: true,
    noChild: false,
    exitCode,
    signal: null,
    closeCode: exitCode,
    closeSignal: null,
    statusAgreement: true,
    reaped: true,
    directChildCleanupSafe: true,
    processGroupQuiescent: true,
    exitObserved: true,
    closeObserved: true,
    stdoutEof: true,
    stderrEof: true,
    stdinComplete: true,
    captureComplete: true,
    outputTruncated: false,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    durationMs: 7,
    terminationErrors: [],
    processErrors: [],
    ...overrides,
  };
}

function artifacts() {
  return [
    {
      name: "public-0123456789abcdef",
      sha256: "1".repeat(64),
      bytes: 12_345,
      mode: 0o755,
    },
    {
      name: "server-fedcba9876543210",
      sha256: "2".repeat(64),
      bytes: 54_321,
      mode: 0o755,
    },
  ];
}

function controller(options = {}) {
  const calls = [];
  const outcomes = [...(options.outcomes ?? [])];
  const value = createSandboxSessionWorkerV2ControllerForTesting({
    processRunner: async (request) => {
      calls.push(request);
      const next = outcomes.shift();
      if (next !== null && Object.getPrototypeOf(next) === Error.prototype) {
        throw next;
      }
      return next ?? exactOutcome();
    },
    artifactCollector:
      options.artifactCollector ??
      (async ({ targetNames }) => {
        assert.deepEqual(targetNames, ["public", "server"]);
        return artifacts();
      }),
    stateBytesReader: options.stateBytesReader ?? (() => 98_765),
  });
  return { value, calls };
}

function parsePrivate(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function schemaFailure(error) {
  return (
    error instanceof TaskV2Failure &&
    error.code === "ERR_CONTRACT_SCHEMA_OR_KEYS" &&
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

test("v2 build policy binds Cargo-normalized artifact stems without aliases", () => {
  assert.deepEqual(
    exactCargoBuildArtifactStemsV2([
      "cargo",
      "test",
      "--no-run",
      "--test",
      "public-test",
      "--bin",
      "server",
    ]),
    ["public_test", "server"],
  );
  assert.equal(
    exactCargoBuildArtifactStemsV2([
      "cargo",
      "test",
      "--no-run",
      "--test",
      "public-test",
      "--test",
      "public_test",
    ]),
    undefined,
  );
});

test("v2 configuration is exact canonical bytes bound to the raw contract", () => {
  const bytes = wire(configuration());
  const parsed = parseSandboxSessionWorkerConfigurationV2(bytes);
  assert.equal(parsed.configurationSha256, sha256(bytes));
  assert.equal(parsed.configuration.contractSha256, "a".repeat(64));
  assert.deepEqual(parsed.configuration.verificationSequence, [
    "format",
    "build",
    "public",
  ]);
  assert.equal(
    parsed.resultBytesCeiling,
    Math.ceil((8 * MiB + 2 * 2 * MiB) / 3) * 4 + 2 * MiB,
  );
  assertDeepFrozen(parsed);

  bytes.fill(0);
  assert.equal(parsed.configuration.contractSha256, "a".repeat(64));
});

test("v2 configuration rejects noncanonical, duplicate, malformed UTF-8, and oversized bytes", () => {
  const valid = configuration();
  const canonical = wire(valid);
  const duplicate = Buffer.from(
    canonical
      .toString("utf8")
      .replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2'),
  );
  const invalid = [
    Buffer.from(JSON.stringify(valid)),
    Buffer.from(`${JSON.stringify(valid)}\n`),
    Buffer.concat([canonical, Buffer.from("\n")]),
    duplicate,
    Buffer.from([0xc3, 0x28]),
    Buffer.alloc(MiB + 1, 0x20),
    Buffer.alloc(0),
  ];
  for (const bytes of invalid) {
    assert.throws(
      () => parseSandboxSessionWorkerConfigurationV2(bytes),
      schemaFailure,
    );
  }
});

test("v2 configuration enforces exact keys, generic ordered roles, and literal Cargo argv", () => {
  const invalid = [];
  {
    const value = configuration();
    value.extra = true;
    invalid.push(value);
  }
  {
    const value = configuration();
    delete value.contractSha256;
    invalid.push(value);
  }
  {
    const value = configuration();
    value.contractSha256 = "A".repeat(64);
    invalid.push(value);
  }
  {
    const value = configuration();
    value.verificationSequence = ["build", "format", "public"];
    invalid.push(value);
  }
  {
    const value = configuration();
    value.verificationSequence = ["format", "build", "build"];
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.public.argv = ["cargo"];
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.public.argv = ["rustc", "--version"];
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.public.argv.push("bad\nargument");
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.public.argv.push("\ud800");
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.build.argv = ["cargo", "test", "--no-run"];
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.build.argv.push("--release");
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.build.argv.push(
      "--test",
      "public-extra",
      "--test",
      "public_extra",
    );
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.public.argv.push("control-\u0001-byte");
    invalid.push(value);
  }
  {
    const value = configuration();
    value.commands.public.extra = true;
    invalid.push(value);
  }
  for (const value of invalid) {
    assert.throws(
      () => parseSandboxSessionWorkerConfigurationV2(wire(value)),
      schemaFailure,
    );
  }

  const roles = ["format", "build"];
  const commands = {
    format: { argv: ["cargo", "fmt"], timeoutMs: 1000 },
    build: {
      argv: ["cargo", "test", "--no-run", "--test", "public"],
      timeoutMs: 1000,
    },
  };
  for (let index = 0; index < 14; index += 1) {
    const role = `role-${index}`;
    roles.push(role);
    commands[role] = { argv: ["cargo", "test", role], timeoutMs: 1000 };
  }
  const accepted = configuration({ verificationSequence: roles, commands });
  assert.equal(
    parseSandboxSessionWorkerConfigurationV2(wire(accepted)).configuration
      .verificationSequence.length,
    16,
  );
  const seventeenth = deepClone(accepted);
  seventeenth.verificationSequence.push("overflow");
  seventeenth.commands.overflow = {
    argv: ["cargo", "test", "overflow"],
    timeoutMs: 1000,
  };
  assert.throws(
    () => parseSandboxSessionWorkerConfigurationV2(wire(seventeenth)),
    schemaFailure,
  );
});

test("v2 configuration enforces command, disk, wall, and aggregate result ceilings", () => {
  const mutations = [
    (value) => (value.ceilings.maxBuildOutputBytes = 1023),
    (value) => (value.ceilings.maxBuildOutputBytes = 64 * MiB + 1),
    (value) => (value.ceilings.maxTestOutputBytesPerCommand = 1023),
    (value) => (value.ceilings.maxTestOutputBytesPerCommand = 64 * MiB + 1),
    (value) => (value.ceilings.maxTotalVerifierWallMs = 999),
    (value) => (value.ceilings.maxTotalVerifierWallMs = 7_200_001),
    (value) => (value.ceilings.maxVerifierDiskBytes = 32 * MiB - 1),
    (value) => (value.ceilings.maxVerifierDiskBytes = 128 * GiB + 1),
    (value) => (value.ceilings.cargoBuildJobs = 0),
    (value) => (value.ceilings.cargoBuildJobs = 17),
    (value) => (value.commands.public.timeoutMs = 999),
    (value) => (value.commands.public.timeoutMs = 600_001),
  ];
  for (const mutate of mutations) {
    const value = configuration();
    mutate(value);
    assert.throws(
      () => parseSandboxSessionWorkerConfigurationV2(wire(value)),
      schemaFailure,
    );
  }

  const roles = ["format", "build"];
  const commands = {
    format: { argv: ["cargo", "fmt"], timeoutMs: 1000 },
    build: {
      argv: ["cargo", "test", "--no-run", "--test", "public"],
      timeoutMs: 1000,
    },
  };
  for (let index = 0; index < 14; index += 1) {
    const role = `overflow-${index}`;
    roles.push(role);
    commands[role] = { argv: ["cargo", "test", role], timeoutMs: 1000 };
  }
  const overflow = configuration({ verificationSequence: roles, commands });
  overflow.ceilings.maxBuildOutputBytes = 64 * MiB;
  overflow.ceilings.maxTestOutputBytesPerCommand = 64 * MiB;
  assert.throws(
    () => parseSandboxSessionWorkerConfigurationV2(wire(overflow)),
    schemaFailure,
  );
});

test("test controller executes generic roles in order through fixed Cargo authority", async () => {
  const { value: current, calls } = controller({
    outcomes: [
      exactOutcome({ stdout: Buffer.from("format ok") }),
      exactOutcome({ stdout: Buffer.from("build ok") }),
      exactOutcome({ stderr: Buffer.from("public ok") }),
    ],
  });
  const configBytes = wire(configuration());
  const resultBytes = await current.run(configBytes);
  const privateResult = parsePrivate(resultBytes);
  assert.equal(privateResult.status, "completed");
  assert.equal(privateResult.stage, "complete");
  assert.equal(privateResult.commandCount, 3);
  assert.equal(privateResult.configurationSha256, sha256(configBytes));
  assert.deepEqual(
    privateResult.commands.map(({ role }) => role),
    ["format", "build", "public"],
  );
  assert.deepEqual(privateResult.artifacts, artifacts());
  assert.equal(privateResult.stateBytes, 98_765);
  assert.equal(resultBytes.equals(wire(privateResult)), true);

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map(({ executable }) => executable),
    ["/usr/bin/setpriv", "/usr/bin/setpriv", "/usr/bin/setpriv"],
  );
  assert.deepEqual(calls[0].args, [
    "--bounding-set=-all",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    "--pdeathsig=SIGKILL",
    "/usr/bin/python3",
    "-I",
    "-S",
    "/runner/seccomp-launcher.py",
    "/state/cargo/bin/cargo",
    "fmt",
    "--check",
  ]);
  assert.equal(calls[0].cwd, "/workspace");
  assert.equal(calls[0].environment.CARGO_BUILD_JOBS, "2");
  assert.equal(calls[0].environment.HOME, "/state/home");
  assert.equal(calls[0].environment.PATH, "/state/cargo/bin:/usr/bin:/bin");
  assert.equal(
    Object.hasOwn(calls[0].environment, "OPENROUTER_API_KEY"),
    false,
  );
  assert.equal(calls[0].stdin.length, 0);
  assert.equal(calls[0].maxOutputBytes, 2 * MiB);
  assert.equal(calls[1].maxOutputBytes, 8 * MiB);
  assert.equal(runSandboxSessionWorkerV2.length, 1);
});

test("nonzero Cargo exits are completed evidence and format/build gate the attempted prefix", async () => {
  for (const scenario of [
    {
      outcomes: [exactOutcome({ exitCode: 1, stderr: Buffer.from("fmt red") })],
      stage: "format",
      count: 1,
    },
    {
      outcomes: [exactOutcome(), exactOutcome({ exitCode: 101 })],
      stage: "build",
      count: 2,
    },
  ]) {
    const { value: current, calls } = controller(scenario);
    const result = parsePrivate(await current.run(wire(configuration())));
    assert.equal(result.status, "completed");
    assert.equal(result.failure, null);
    assert.equal(result.stage, scenario.stage);
    assert.equal(result.commandCount, scenario.count);
    assert.equal(calls.length, scenario.count);
    assert.deepEqual(result.artifacts, []);
  }

  const { value: testsContinue, calls } = controller({
    outcomes: [exactOutcome(), exactOutcome(), exactOutcome({ exitCode: 101 })],
  });
  const result = parsePrivate(await testsContinue.run(wire(configuration())));
  assert.equal(result.status, "completed");
  assert.equal(result.stage, "complete");
  assert.equal(calls.length, 3);
});

test("the admitted one-second total wall boundary is executable rather than vacuously failed", async () => {
  const value = configuration();
  value.ceilings.maxTotalVerifierWallMs = 1000;
  for (const command of Object.values(value.commands)) command.timeoutMs = 1000;
  const { value: current, calls } = controller({
    outcomes: [exactOutcome(), exactOutcome(), exactOutcome()],
  });
  const result = parsePrivate(await current.run(wire(value)));
  assert.equal(result.status, "completed");
  assert.equal(result.stage, "complete");
  assert.equal(calls.length, 3);
  assert.equal(
    calls.every(({ timeoutMs }) => timeoutMs >= 1 && timeoutMs <= 1000),
    true,
  );
});

test("private records use canonical base64, exact byte counts, and SHA-256", async () => {
  const stdout = Buffer.from([0x00, 0xff, 0x0a, 0x41]);
  const stderr = Buffer.from("diagnostic\n", "utf8");
  const { value: current } = controller({
    outcomes: [
      exactOutcome({ stdout, stderr }),
      exactOutcome(),
      exactOutcome(),
    ],
  });
  const result = parsePrivate(await current.run(wire(configuration())));
  const record = result.commands[0];
  assert.equal(record.stdoutBase64, stdout.toString("base64"));
  assert.equal(record.stderrBase64, stderr.toString("base64"));
  assert.equal(record.stdoutBytes, stdout.length);
  assert.equal(record.stderrBytes, stderr.length);
  assert.equal(record.stdoutSha256, sha256(stdout));
  assert.equal(record.stderrSha256, sha256(stderr));
  assert.equal(Object.hasOwn(record, "durationMs"), false);
});

test("test-role records derive observedPassed only from one exact successful Cargo summary", async () => {
  const exactSummary = Buffer.from(
    "test result: ok. 7 passed; 0 failed; 1 ignored; 0 measured; 2 filtered out; finished in 0.01s\n",
  );
  const { value: exactController } = controller({
    outcomes: [
      exactOutcome(),
      exactOutcome(),
      exactOutcome({ stdout: exactSummary }),
    ],
  });
  const configBytes = wire(configuration());
  const exactBytes = await exactController.run(configBytes);
  const exact = parsePrivate(exactBytes);
  assert.equal(exact.commands[0].observedPassed, null);
  assert.equal(exact.commands[1].observedPassed, null);
  assert.equal(exact.commands[2].observedPassed, 7);
  assert.equal(
    parseSandboxSessionWorkerResultV2(exactBytes, configBytes).commands[2]
      .observedPassed,
    7,
  );

  for (const outcome of [
    exactOutcome({ stdout: Buffer.concat([exactSummary, exactSummary]) }),
    exactOutcome({
      stdout: Buffer.from(
        "test result: FAILED. 7 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
      ),
    }),
    exactOutcome({ stdout: exactSummary, exitCode: 101 }),
  ]) {
    const { value: ambiguous } = controller({
      outcomes: [exactOutcome(), exactOutcome(), outcome],
    });
    const result = parsePrivate(await ambiguous.run(configBytes));
    assert.equal(result.commands[2].observedPassed, null);
  }

  const tampered = deepClone(exact);
  tampered.commands[2].observedPassed = 8;
  assert.throws(
    () => parseSandboxSessionWorkerResultV2(wire(tampered), configBytes),
    schemaFailure,
  );
});

test("host parser validates the full private wire and exposes only fixed bounded tails", async () => {
  const secretPrefix = "token-that-must-not-survive-publicly:";
  const stdout = Buffer.from(`${secretPrefix}${"x".repeat(20 * 1024)}`);
  const { value: current } = controller({
    outcomes: [exactOutcome({ stdout }), exactOutcome(), exactOutcome()],
  });
  const configBytes = wire(configuration());
  const privateBytes = await current.run(configBytes);
  const projected = parseSandboxSessionWorkerResultV2(
    privateBytes,
    configBytes,
  );
  assertDeepFrozen(projected);
  assert.equal(projected.resultSha256, sha256(privateBytes));
  assert.equal(projected.resultBytes, privateBytes.length);
  assert.equal(projected.commands[0].stdoutBytes, stdout.length);
  assert.equal(projected.commands[0].stdoutSha256, sha256(stdout));
  assert.equal(
    Buffer.from(projected.commands[0].stdoutTailBase64, "base64").equals(
      stdout.subarray(stdout.length - 16 * 1024),
    ),
    true,
  );
  assert.equal(JSON.stringify(projected).includes(secretPrefix), false);
  assert.equal(Object.hasOwn(projected.commands[0], "stdoutBase64"), false);
  assert.equal(
    Object.hasOwn(projected.commands[0], "firstTerminalReason"),
    false,
  );
  assert.deepEqual(projected.artifacts, artifacts());
});

test("host parser rejects configuration mismatch and every worker-owned count/order/base64/digest/schema fault", async () => {
  const { value: current } = controller({
    outcomes: [exactOutcome(), exactOutcome(), exactOutcome()],
  });
  const configBytes = wire(configuration());
  const privateResult = parsePrivate(await current.run(configBytes));
  const invalid = [];
  {
    const value = deepClone(privateResult);
    value.commandCount += 1;
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    [value.commands[0], value.commands[1]] = [
      value.commands[1],
      value.commands[0],
    ];
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[0].stdoutBase64 = "Zg";
    value.commands[0].stdoutBytes = 1;
    value.commands[0].stdoutSha256 = sha256(Buffer.from("f"));
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[0].stdoutBytes += 1;
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[0].stderrSha256 = "0".repeat(64);
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[0].extra = true;
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.artifacts[0].name = "../public";
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.artifacts.push(deepClone(value.artifacts[0]));
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[0].stdoutEof = false;
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[0].exitCode = 1;
    value.commands[0].closeCode = 1;
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.commands[2].exitCode = -1;
    value.commands[2].closeCode = -1;
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    [value.artifacts[0], value.artifacts[1]] = [
      value.artifacts[1],
      value.artifacts[0],
    ];
    invalid.push(value);
  }
  {
    const value = deepClone(privateResult);
    value.failure = "PROCESS_PROOF";
    invalid.push(value);
  }
  for (const value of invalid) {
    assert.throws(
      () => parseSandboxSessionWorkerResultV2(wire(value), configBytes),
      schemaFailure,
    );
  }

  const changed = configuration();
  changed.contractSha256 = "b".repeat(64);
  assert.throws(
    () => parseSandboxSessionWorkerResultV2(wire(privateResult), wire(changed)),
    schemaFailure,
  );
  assert.throws(
    () =>
      parseSandboxSessionWorkerResultV2(
        Buffer.from(JSON.stringify(privateResult)),
        configBytes,
      ),
    schemaFailure,
  );
});

test("timeout, output, exit-close, EOF, capture, and reap faults never become success", async () => {
  const failures = [
    {
      expected: "TIME_BUDGET",
      outcome: exactOutcome({
        disposition: "timeout",
        firstTerminalReason: "timeout",
        exitCode: null,
        overrides: {
          closeCode: null,
          signal: "SIGKILL",
          closeSignal: "SIGKILL",
        },
      }),
    },
    {
      expected: "PROCESS_PROOF",
      outcome: exactOutcome({
        disposition: "output-limit",
        firstTerminalReason: "output-limit",
        overrides: { outputTruncated: true, captureComplete: false },
      }),
    },
    {
      expected: "PROCESS_PROOF",
      outcome: exactOutcome({ overrides: { closeCode: 9 } }),
    },
    {
      expected: "PROCESS_PROOF",
      outcome: exactOutcome({ exitCode: -1 }),
    },
    {
      expected: "PROCESS_PROOF",
      outcome: exactOutcome({ overrides: { stdoutEof: false } }),
    },
    {
      expected: "PROCESS_PROOF",
      outcome: exactOutcome({ overrides: { captureComplete: false } }),
    },
    {
      expected: "PROCESS_PROOF",
      outcome: exactOutcome({
        overrides: { reaped: false, processGroupQuiescent: false },
      }),
    },
  ];
  for (const { expected, outcome } of failures) {
    const { value: current } = controller({ outcomes: [outcome] });
    const result = parsePrivate(await current.run(wire(configuration())));
    assert.equal(result.status, "failed");
    assert.equal(result.stage, "format");
    assert.equal(result.failure, expected);
    assert.equal(result.commandCount, 0);
    assert.deepEqual(result.commands, []);
  }
});

test("async rejection, hostile output, paths, argv, and tokens are sanitized from failure wire", async () => {
  const secret = "OPENROUTER_API_KEY=token-secret";
  const hostPath = "/home/alice/private/repository";
  const rejected = new Error(`${hostPath} ${secret}`);
  const { value: current } = controller({ outcomes: [rejected] });
  const resultBytes = await current.run(wire(configuration()));
  const text = resultBytes.toString("utf8");
  const result = parsePrivate(resultBytes);
  assert.equal(result.status, "failed");
  assert.equal(result.failure, "INTERNAL_FAIL_CLOSED");
  assert.equal(result.commandCount, 0);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(hostPath), false);
  assert.equal(text.includes("fmt"), false);

  const hostile = exactOutcome({
    stdout: Buffer.from(`${secret} ${hostPath}`),
    overrides: { closeObserved: false, captureComplete: false },
  });
  const { value: hostileController } = controller({ outcomes: [hostile] });
  const hostileBytes = await hostileController.run(wire(configuration()));
  assert.equal(hostileBytes.includes(Buffer.from(secret)), false);
  assert.equal(hostileBytes.includes(Buffer.from(hostPath)), false);
});

test("configuration and process outcomes are captured without getters, Proxy authority, or TOCTOU", async () => {
  let getterCalls = 0;
  const outcome = exactOutcome();
  Object.defineProperty(outcome, "stdout", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must not run");
    },
  });
  const { value: getterController } = controller({ outcomes: [outcome] });
  const getterResult = parsePrivate(
    await getterController.run(wire(configuration())),
  );
  assert.equal(getterResult.status, "failed");
  assert.equal(getterCalls, 0);

  let proxyCalls = 0;
  const proxy = new Proxy(exactOutcome(), {
    get(target, key, receiver) {
      if (key === "then") return undefined;
      proxyCalls += 1;
      throw new Error("must not run");
    },
  });
  const { value: proxyController } = controller({ outcomes: [proxy] });
  const proxyResult = parsePrivate(
    await proxyController.run(wire(configuration())),
  );
  assert.equal(proxyResult.status, "failed");
  assert.equal(proxyCalls, 0);

  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { value: captureController } = createControllerWithRunner(async () => {
    await pending;
    return exactOutcome();
  });
  const bytes = wire(configuration());
  const expectedHash = sha256(bytes);
  const running = captureController.run(bytes);
  bytes.fill(0);
  release();
  const captured = parsePrivate(await running);
  assert.equal(captured.configurationSha256, expectedHash);
});

function createControllerWithRunner(processRunner) {
  return {
    value: createSandboxSessionWorkerV2ControllerForTesting({
      processRunner,
      artifactCollector: async () => artifacts(),
      stateBytesReader: () => 123,
    }),
  };
}

test("artifact and state evidence is exact, sorted, bounded, and fail-closed", async () => {
  const badArtifacts = [
    [{ ...artifacts()[0], name: "../escape" }],
    [{ ...artifacts()[0], bytes: 0 }],
    [{ ...artifacts()[0], mode: 0o644 }],
    [{ ...artifacts()[0], sha256: "A".repeat(64) }],
    [artifacts()[0], { ...artifacts()[0] }],
  ];
  for (const evidence of badArtifacts) {
    const { value: current } = controller({
      outcomes: [exactOutcome(), exactOutcome()],
      artifactCollector: async () => evidence,
    });
    const result = parsePrivate(await current.run(wire(configuration())));
    assert.equal(result.status, "failed");
    assert.equal(result.failure, "ARTIFACT_EVIDENCE");
    assert.equal(result.stage, "build");
  }

  const { value: diskOverflow } = controller({
    outcomes: [exactOutcome(), exactOutcome(), exactOutcome()],
    stateBytesReader: () => 2 * GiB + 1,
  });
  const result = parsePrivate(await diskOverflow.run(wire(configuration())));
  assert.equal(result.status, "failed");
  assert.equal(result.failure, "STATE_INVARIANT");
  assert.equal(result.stateBytes, null);
});

test("failure vocabulary is closed and private/public result values are deterministic and frozen", async () => {
  assert.deepEqual(SANDBOX_SESSION_WORKER_V2_FAILURE_CODES, [
    "CONFIGURATION",
    "PROCESS_PROOF",
    "TIME_BUDGET",
    "STATE_INVARIANT",
    "ARTIFACT_EVIDENCE",
    "RESULT_CEILING",
    "INTERNAL_FAIL_CLOSED",
  ]);
  assert.equal(Object.isFrozen(SANDBOX_SESSION_WORKER_V2_FAILURE_CODES), true);

  const configBytes = wire(configuration());
  const outcomes = [exactOutcome(), exactOutcome(), exactOutcome()];
  const first = controller({ outcomes }).value;
  const second = controller({ outcomes }).value;
  const firstBytes = await first.run(configBytes);
  const secondBytes = await second.run(configBytes);
  assert.equal(firstBytes.equals(secondBytes), true);
  assert.deepEqual(
    parseSandboxSessionWorkerResultV2(firstBytes, configBytes),
    parseSandboxSessionWorkerResultV2(secondBytes, configBytes),
  );
});

test("direct worker entrypoint reads its private protocol and fails silently on invalid configuration", () => {
  const secret = "token-must-not-escape";
  const outcome = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../src/candidate/sandbox-session-worker-v2.mjs",
          import.meta.url,
        ),
      ),
    ],
    {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, HOST_TOKEN: secret },
      input: Buffer.from(`not-json:${secret}`),
      encoding: null,
      timeout: 5000,
    },
  );
  assert.equal(outcome.status, 70);
  assert.deepEqual(outcome.stdout, Buffer.alloc(0));
  assert.deepEqual(outcome.stderr, Buffer.alloc(0));
});
