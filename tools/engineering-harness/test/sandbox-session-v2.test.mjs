import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "../src/routing/features.mjs";
import {
  decodeSandboxSessionResultV2ForTesting,
  encodeSandboxSessionConfigurationV2,
  createSandboxVerificationSessionV2ForTesting,
  isSandboxSessionV2Fault,
  isTrustedSandboxSessionV2Report,
  runSandboxVerificationSessionV2,
  sandboxSessionV2CleanupSafeForTesting,
} from "../src/candidate/sandbox-session-v2.mjs";
import { createSandboxSessionWorkerV2ControllerForTesting } from "../src/candidate/sandbox-session-worker-v2.mjs";
import { parseSandboxSessionWorkerConfigurationV2 } from "../src/candidate/sandbox-session-worker-v2.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const commands = Object.freeze({
  format: Object.freeze({
    argv: Object.freeze(["cargo", "fmt", "--check"]),
    timeoutMs: 120_000,
  }),
  build: Object.freeze({
    argv: Object.freeze([
      "cargo",
      "test",
      "--no-run",
      "--test",
      "exact_create",
    ]),
    timeoutMs: 1_800_000,
  }),
  public: Object.freeze({
    argv: Object.freeze(["cargo", "test", "--test", "exact_create"]),
    timeoutMs: 120_000,
  }),
});

const ceilings = Object.freeze({
  maxBuildOutputBytes: 8_388_608,
  maxTestOutputBytesPerCommand: 2_097_152,
  maxTotalVerifierWallMs: 2_700_000,
  maxVerifierDiskBytes: 17_179_869_184,
  cargoBuildJobs: 4,
});

const configurationInput = Object.freeze({
  contractSha256: "a".repeat(64),
  verificationSequence: Object.freeze(["format", "build", "public"]),
  commands,
  ceilings,
});

function byteEvidence(bytes) {
  return {
    bytes: bytes.length,
    sha256: digest(bytes),
    base64: bytes.toString("base64"),
  };
}

function completedCommand(
  role,
  stdout = Buffer.alloc(0),
  observedPassed = null,
) {
  const stderr = Buffer.alloc(0);
  return {
    role,
    disposition: "completed",
    firstTerminalReason: "completed",
    spawned: true,
    noChild: false,
    exitCode: 0,
    signal: null,
    closeCode: 0,
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
    terminationErrorCount: 0,
    processErrorCount: 0,
    observedPassed,
    stdoutBytes: stdout.length,
    stdoutSha256: digest(stdout),
    stdoutBase64: stdout.toString("base64"),
    stderrBytes: stderr.length,
    stderrSha256: digest(stderr),
    stderrBase64: stderr.toString("base64"),
  };
}

function resultBytes(configurationSha256, overrides = {}) {
  const value = {
    schemaVersion: 2,
    configurationSha256,
    status: "completed",
    stage: "complete",
    commandCount: 3,
    commands: [
      completedCommand("format"),
      completedCommand("build"),
      completedCommand(
        "public",
        Buffer.from(
          "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
          "utf8",
        ),
        1,
      ),
    ],
    artifacts: [
      {
        name: "exact_create-0123456789abcdef",
        sha256: "b".repeat(64),
        bytes: 4096,
        mode: 0o755,
      },
    ],
    stateBytes: 8192,
    failure: null,
    ...overrides,
  };
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

test("v2 session configuration binds exact contract identity and canonical bytes", () => {
  const mutable = structuredClone(configurationInput);
  const bytes = encodeSandboxSessionConfigurationV2(mutable);
  const expected = Buffer.from(
    `${canonicalJson({ schemaVersion: 2, ...configurationInput })}\n`,
    "utf8",
  );
  assert.deepEqual(bytes, expected);

  mutable.contractSha256 = "f".repeat(64);
  mutable.commands.public.argv[2] = "mutated";
  assert.deepEqual(bytes, expected);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(bytes.subarray(0, -1).includes(0x0a), false);

  assert.throws(
    () =>
      encodeSandboxSessionConfigurationV2(
        new Proxy(structuredClone(configurationInput), {}),
      ),
    /configuration/u,
  );
  assert.throws(
    () =>
      encodeSandboxSessionConfigurationV2({
        ...configurationInput,
        callerAuthority: "/tmp/not-admitted",
      }),
    /configuration/u,
  );
  const surrogate = structuredClone(configurationInput);
  surrogate.commands.public.argv.push("unpaired-\ud800-surrogate");
  assert.throws(
    () => encodeSandboxSessionConfigurationV2(surrogate),
    /configuration/u,
  );
  for (const mutate of [
    (value) => {
      value.commands.build.argv = ["cargo", "test", "--no-run"];
    },
    (value) => {
      value.commands.build.argv.push("--release");
    },
    (value) => {
      value.commands.build.argv.push(
        "--test",
        "exact-create",
        "--test",
        "exact_create",
      );
    },
    (value) => {
      value.commands.public.argv.push("control-\u0001-byte");
    },
  ]) {
    const invalid = structuredClone(configurationInput);
    mutate(invalid);
    assert.throws(
      () => encodeSandboxSessionConfigurationV2(invalid),
      /configuration/u,
    );
  }
  const hugeSparse = structuredClone(configurationInput);
  hugeSparse.verificationSequence = [];
  hugeSparse.verificationSequence.length = 0xffffffff;
  assert.throws(
    () => encodeSandboxSessionConfigurationV2(hugeSparse),
    /configuration/u,
  );
});

test("v2 host and worker admit a configuration above the former one-MiB ceiling", () => {
  const value = structuredClone(configurationInput);
  for (const role of value.verificationSequence) {
    const count = role === "build" ? 120 : 96;
    for (let index = 0; index < count; index += 1) {
      const argument = `${role}-${index}-`.padEnd(4096, "x");
      if (role === "build") value.commands[role].argv.push("--features");
      value.commands[role].argv.push(argument);
    }
  }
  const bytes = encodeSandboxSessionConfigurationV2(value);
  assert.equal(bytes.length > 1024 * 1024, true);
  assert.equal(bytes.length <= 4 * 1024 * 1024, true);
  const parsed = parseSandboxSessionWorkerConfigurationV2(bytes);
  assert.equal(parsed.configurationSha256, digest(bytes));
  assert.equal(parsed.configuration.verificationSequence.length, 3);
});

test("v2 host parser validates full private bytes and exposes bounded frozen tails", () => {
  const configurationBytes =
    encodeSandboxSessionConfigurationV2(configurationInput);
  const configurationSha256 = digest(configurationBytes);
  const bytes = resultBytes(configurationSha256);
  const decoded = decodeSandboxSessionResultV2ForTesting({
    bytes,
    configurationBytes,
  });

  assert.equal(decoded.resultSha256, digest(bytes));
  assert.equal(decoded.resultBytes, bytes.length);
  assert.equal(decoded.session.configurationSha256, configurationSha256);
  assert.equal(decoded.session.commands[2].stdoutBytes, 94);
  assert.equal(
    Buffer.from(
      decoded.session.commands[2].stdoutTailBase64,
      "base64",
    ).toString("utf8"),
    "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
  );
  assert.equal(
    Object.hasOwn(decoded.session.commands[2], "stdoutBase64"),
    false,
  );
  assert.equal(
    Object.hasOwn(decoded.session.commands[2], "stderrBase64"),
    false,
  );
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.session), true);
  assert.equal(Object.isFrozen(decoded.session.commands), true);
  assert.equal(Object.isFrozen(decoded.session.commands[0]), true);
});

test("independent v2 worker and host parsers agree on exact generated bytes", async () => {
  const configurationBytes =
    encodeSandboxSessionConfigurationV2(configurationInput);
  let invocation = 0;
  const worker = createSandboxSessionWorkerV2ControllerForTesting({
    processRunner: async () => {
      const roleIndex = invocation;
      invocation += 1;
      return Object.freeze({
        ...safeOuterOutcome(),
        stdout:
          roleIndex === 2
            ? Buffer.from(
                "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
                "utf8",
              )
            : Buffer.alloc(0),
      });
    },
    artifactCollector: async ({ targetNames }) => {
      assert.deepEqual(targetNames, ["exact_create"]);
      return Object.freeze([
        Object.freeze({
          name: "exact_create-0123456789abcdef",
          sha256: "b".repeat(64),
          bytes: 4096,
          mode: 0o755,
        }),
      ]);
    },
    stateBytesReader: async () => 8192,
  });
  const generated = await worker.run(configurationBytes);
  const decoded = decodeSandboxSessionResultV2ForTesting({
    bytes: generated,
    configurationBytes,
  });
  assert.equal(invocation, 3);
  assert.equal(decoded.session.status, "completed");
  assert.equal(decoded.session.stage, "complete");
  assert.equal(decoded.session.commands[2].observedPassed, 1);
  assert.deepEqual(decoded.session.artifacts, [
    {
      name: "exact_create-0123456789abcdef",
      sha256: "b".repeat(64),
      bytes: 4096,
      mode: 0o755,
    },
  ]);
});

test("v2 host parser rejects noncanonical wire and byte-evidence ambiguity", () => {
  const configurationBytes =
    encodeSandboxSessionConfigurationV2(configurationInput);
  const configurationSha256 = digest(configurationBytes);
  const canonical = resultBytes(configurationSha256);
  const parsed = JSON.parse(canonical);
  const variants = [
    Buffer.from(JSON.stringify(parsed), "utf8"),
    Buffer.from(` ${canonical.toString("utf8")}`, "utf8"),
    Buffer.from(
      canonical
        .toString("utf8")
        .replace(
          `\"configurationSha256\":\"${configurationSha256}\"`,
          `\"configurationSha256\":\"${configurationSha256}\",\"configurationSha256\":\"${configurationSha256}\"`,
        ),
      "utf8",
    ),
    Buffer.concat([
      canonical.subarray(0, 12),
      Buffer.from([0xff]),
      canonical.subarray(13),
    ]),
  ];
  for (const bytes of variants) {
    assert.throws(
      () =>
        decodeSandboxSessionResultV2ForTesting({
          bytes,
          configurationBytes,
        }),
      /session result/u,
    );
  }

  for (const mutate of [
    (value) => {
      value.commands[2].stdoutBase64 = "A===";
    },
    (value) => {
      value.commands[2].stdoutBytes += 1;
    },
    (value) => {
      value.commands[2].stdoutSha256 = "0".repeat(64);
    },
    (value) => {
      value.commands[1].role = "public";
    },
    (value) => {
      value.commandCount = 2;
    },
    (value) => {
      value.stage = "build";
    },
    (value) => {
      value.commands[0].signal = "SIGTERM";
      value.commands[0].closeSignal = "SIGTERM";
    },
    (value) => {
      value.commands[0].exitCode = 256;
      value.commands[0].closeCode = 256;
    },
    (value) => {
      value.artifacts[0].name = "other-0123456789abcdef";
    },
    (value) => {
      value.commands.splice(1);
      value.commandCount = 1;
      value.stage = "format";
      value.artifacts = [];
    },
    (value) => {
      value.commands.splice(2);
      value.commandCount = 2;
      value.stage = "build";
      value.artifacts = [];
    },
  ]) {
    const value = JSON.parse(canonical);
    mutate(value);
    assert.throws(
      () =>
        decodeSandboxSessionResultV2ForTesting({
          bytes: Buffer.from(`${canonicalJson(value)}\n`, "utf8"),
          configurationBytes,
        }),
      /session result/u,
    );
  }
});

test("v2 cleanup proof rejects contradictory or incomplete native outcomes", () => {
  const safe = {
    disposition: "completed",
    firstTerminalReason: "completed",
    spawned: true,
    noChild: false,
    exitCode: 0,
    signal: null,
    closeCode: 0,
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
    terminationErrors: [],
    processErrors: [],
  };
  assert.equal(sandboxSessionV2CleanupSafeForTesting(safe), true);
  for (const unsafe of [
    { ...safe, reaped: false },
    { ...safe, noChild: true },
    { ...safe, spawned: false },
    { ...safe, stdoutEof: false },
    { ...safe, statusAgreement: false },
    { ...safe, processGroupQuiescent: false },
    { ...safe, processErrors: [{ code: "EIO" }] },
    { ...safe, outputTruncated: true },
  ]) {
    assert.equal(sandboxSessionV2CleanupSafeForTesting(unsafe), false);
  }
  assert.equal(
    sandboxSessionV2CleanupSafeForTesting({
      ...safe,
      disposition: "spawn-error",
      firstTerminalReason: "spawn-error",
      spawned: false,
      noChild: true,
      exitCode: null,
      closeCode: null,
      reaped: false,
      statusAgreement: false,
      exitObserved: false,
      closeObserved: false,
      stdoutEof: false,
      stderrEof: false,
      stdinComplete: true,
      captureComplete: false,
      processErrors: [{ code: "ENOENT" }],
    }),
    true,
  );
  const noChild = {
    ...safe,
    disposition: "spawn-error",
    firstTerminalReason: "spawn-error",
    spawned: false,
    noChild: true,
    exitCode: null,
    signal: null,
    closeCode: null,
    closeSignal: null,
    statusAgreement: false,
    reaped: false,
    exitObserved: false,
    closeObserved: false,
    stdoutEof: false,
    stderrEof: false,
    captureComplete: false,
    processErrors: [{ code: "ENOENT" }],
  };
  for (const unsafe of [
    { ...noChild, exitCode: 1 },
    { ...noChild, closeCode: 1 },
    { ...noChild, signal: "SIGTERM", closeSignal: "SIGTERM" },
    { ...noChild, exitObserved: true, closeObserved: true },
    { ...noChild, statusAgreement: true },
    { ...noChild, captureComplete: true },
    { ...noChild, terminationErrors: [{ signal: "SIGKILL" }] },
    { ...noChild, processErrors: [] },
  ]) {
    assert.equal(sandboxSessionV2CleanupSafeForTesting(unsafe), false);
  }
});

function safeOuterOutcome() {
  return Object.freeze({
    disposition: "completed",
    firstTerminalReason: "completed",
    syntheticTestOnly: false,
    spawned: true,
    noChild: false,
    exitCode: 0,
    signal: null,
    closeCode: 0,
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
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    durationMs: 1,
    terminationErrors: Object.freeze([]),
    processErrors: Object.freeze([]),
  });
}

function sessionInput(workspace) {
  return {
    workspace,
    contractSha256: configurationInput.contractSha256,
    verificationSequence: configurationInput.verificationSequence,
    commands: configurationInput.commands,
    ceilings: {
      ...configurationInput.ceilings,
      maxResidentBytes: 8_589_934_592,
    },
    signal: undefined,
  };
}

function resultFileFromRequest(request) {
  const index = request.args.indexOf("/result/session.json");
  assert.notEqual(index, -1);
  return request.args[index - 1];
}

test("v2 structural host pins result bytes and labels observed closure evidence unproved", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-fixture-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const requests = [];
  const controller = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      requests.push(request);
      await writeFile(
        resultFileFromRequest(request),
        resultBytes(digest(request.stdin)),
      );
      return safeOuterOutcome();
    },
  );
  const report = await controller.runSandboxVerificationSessionV2(
    sessionInput(workspace),
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].executable, "/usr/bin/systemd-run");
  assert.equal(Buffer.isBuffer(requests[0].stdin), true);
  assert.equal(requests[0].stdin.at(-1), 0x0a);
  assert.equal(isTrustedSandboxSessionV2Report(report), true);
  assert.equal(report.cleanupSafe, true);
  assert.equal(report.invocation.containment, "unproved");
  assert.equal(
    report.invocation.executableClosureBinding,
    "read-then-path-bind-unproved",
  );
  assert.match(report.invocation.observedWorkerSha256, /^[0-9a-f]{64}$/u);
  assert.match(
    report.invocation.observedWorkerClosureSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(
    report.invocation.observedSeccompLauncherSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.match(report.invocation.argsSha256, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(report.invocation),
    new RegExp(workspace, "u"),
  );
  assert.equal(report.session.commands[2].observedPassed, 1);
});

test("v2 structural host rejects pathname replacement after retaining the result inode", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-replace-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const controller = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      const outputFile = resultFileFromRequest(request);
      await unlink(outputFile);
      await writeFile(outputFile, resultBytes(digest(request.stdin)), {
        mode: 0o600,
      });
      return safeOuterOutcome();
    },
  );
  await assert.rejects(
    controller.runSandboxVerificationSessionV2(sessionInput(workspace)),
    (error) => {
      assert.equal(isSandboxSessionV2Fault(error), true);
      assert.equal(error.reason, "protocol-or-inode");
      assert.equal(error.cleanupSafe, true);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(workspace, "u"));
      return true;
    },
  );
});

test("v2 structural host retains authority when the runner rejects or evidence access throws", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-unknown-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const controllers = [
    createSandboxVerificationSessionV2ForTesting(async () => {
      throw new Error("runner rejected without process proof");
    }),
    createSandboxVerificationSessionV2ForTesting(async () => {
      const outcome = { ...safeOuterOutcome() };
      Object.defineProperty(outcome, "noChild", {
        enumerable: true,
        get() {
          throw new Error("untrusted evidence getter");
        },
      });
      return outcome;
    }),
  ];
  for (const controller of controllers) {
    await assert.rejects(
      controller.runSandboxVerificationSessionV2(sessionInput(workspace)),
      (error) => {
        assert.equal(isSandboxSessionV2Fault(error), true);
        assert.equal(error.reason, "protocol-or-inode");
        assert.equal(error.cleanupSafe, false);
        return true;
      },
    );
  }
});

test("v2 production session fails before spawn while cgroup ownership is unavailable", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-disabled-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await assert.rejects(
    runSandboxVerificationSessionV2(sessionInput(workspace)),
    (error) => {
      assert.equal(isSandboxSessionV2Fault(error), true);
      assert.equal(error.reason, "containment-unavailable");
      assert.equal(error.cleanupSafe, true);
      assert.equal(error.process.spawned, false);
      assert.equal(error.process.noChild, true);
      return true;
    },
  );
});
