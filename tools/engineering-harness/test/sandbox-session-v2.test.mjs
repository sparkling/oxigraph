import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
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

test("v2 retained closure has a bounded static ESM request inventory", async () => {
  const inventory = [
    [
      new URL(
        "../src/candidate/sandbox-session-worker-v2.mjs",
        import.meta.url,
      ),
      [
        "node:crypto",
        "node:fs",
        "node:fs/promises",
        "node:path",
        "node:perf_hooks",
        "node:url",
        "node:util",
        "../native/process.mjs",
        "../policy/build-command-v2.mjs",
        "../policy/evidence-limits.mjs",
        "../policy/session-v2-limits.mjs",
        "../policy/task-v2-failures.mjs",
        "../routing/features.mjs",
      ],
    ],
    [
      new URL("../src/native/process.mjs", import.meta.url),
      ["node:child_process", "node:fs", "node:perf_hooks", "node:util"],
    ],
    [new URL("../src/policy/build-command-v2.mjs", import.meta.url), []],
    [new URL("../src/policy/evidence-limits.mjs", import.meta.url), []],
    [new URL("../src/policy/session-v2-limits.mjs", import.meta.url), []],
    [
      new URL("../src/policy/task-v2-failures.mjs", import.meta.url),
      ["node:crypto"],
    ],
    [new URL("../src/routing/features.mjs", import.meta.url), ["node:crypto"]],
  ];
  const retainedSources = new Set(inventory.map(([source]) => source.href));
  for (const [source, expected] of inventory) {
    const text = await readFile(source, "utf8");
    assert.doesNotMatch(
      text,
      /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\(/u,
    );
    assert.doesNotMatch(
      text,
      /\b(?:eval|Function|AsyncFunction|GeneratorFunction|createRequire|WebAssembly)\b|\bprocess\.getBuiltinModule\b|\b(?:compileFunction|runInNewContext|runInThisContext)\b/u,
    );
    const requests = [
      ...text.matchAll(
        /(?:^|\n)import(?:\s+[\s\S]*?\s+from)?\s+["']([^"']+)["'];/gu,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(requests, expected);
    const importTokens = [...text.matchAll(/\bimport\b/gu)].length;
    const importMetaTokens = [...text.matchAll(/\bimport\.meta\b/gu)].length;
    assert.equal(
      importTokens,
      requests.length + importMetaTokens,
      "every import token must be one inventoried static request or import.meta",
    );
    for (const specifier of expected.filter((value) => value.startsWith("."))) {
      assert.equal(retainedSources.has(new URL(specifier, source).href), true);
    }
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

test("v2 structural host binds exact private closure copies through retained descriptors", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-fixture-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const requests = [];
  const expectedClosure = [
    [
      new URL(
        "../src/candidate/sandbox-session-worker-v2.mjs",
        import.meta.url,
      ),
      "/runner/candidate/sandbox-session-worker-v2.mjs",
    ],
    [
      new URL("../src/native/process.mjs", import.meta.url),
      "/runner/native/process.mjs",
    ],
    [
      new URL("../src/policy/build-command-v2.mjs", import.meta.url),
      "/runner/policy/build-command-v2.mjs",
    ],
    [
      new URL("../src/policy/evidence-limits.mjs", import.meta.url),
      "/runner/policy/evidence-limits.mjs",
    ],
    [
      new URL("../src/policy/session-v2-limits.mjs", import.meta.url),
      "/runner/policy/session-v2-limits.mjs",
    ],
    [
      new URL("../src/policy/task-v2-failures.mjs", import.meta.url),
      "/runner/policy/task-v2-failures.mjs",
    ],
    [
      new URL("../src/routing/features.mjs", import.meta.url),
      "/runner/routing/features.mjs",
    ],
    [
      new URL("../src/candidate/seccomp-launcher.py", import.meta.url),
      "/runner/seccomp-launcher.py",
    ],
  ];
  const expectedBytes = await Promise.all(
    expectedClosure.map(([source]) => readFile(source)),
  );
  const controller = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      requests.push(request);
      assert.equal(request.inheritedFileDescriptors.length, 8);
      assert.equal(new Set(request.inheritedFileDescriptors).size, 8);
      const fdBindings = [];
      for (let index = 0; index < request.args.length; index += 1) {
        if (request.args[index] === "--ro-bind-fd") {
          fdBindings.push({
            childFd: request.args[index + 1],
            destination: request.args[index + 2],
          });
        }
      }
      assert.deepEqual(
        fdBindings.map(({ childFd }) => childFd),
        ["3", "4", "5", "6", "7", "8", "9", "10"],
      );
      assert.deepEqual(
        fdBindings.map(({ destination }) => destination),
        expectedClosure.map(([, destination]) => destination),
      );
      assert.equal(
        request.args.some(
          (argument, index) =>
            argument === "--ro-bind" &&
            request.args[index + 2]?.startsWith("/runner"),
        ),
        false,
      );
      const retainedBytes = await Promise.all(
        request.inheritedFileDescriptors.map((descriptor) =>
          readFile(`/proc/self/fd/${descriptor}`),
        ),
      );
      assert.deepEqual(retainedBytes, expectedBytes);
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
    "partial-esm-launcher-retained-fd-v1",
  );
  assert.equal(
    report.invocation.runtimeExecutableClosureBinding,
    "path-exec-unproved",
  );
  assert.equal(
    report.invocation.esmClosureInventory,
    "tested-static-request-inventory-v1",
  );
  assert.equal(report.invocation.dynamicCodeLoadingResistance, false);
  assert.equal(report.invocation.execveat, false);
  assert.equal(report.invocation.sameUidTamperResistance, false);
  assert.equal(report.invocation.transientMutationPrevention, false);
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
  const expectedWorkerClosure = expectedClosure
    .slice(0, -1)
    .map(([, destination], index) => ({
      destination,
      sha256: digest(expectedBytes[index]),
    }));
  assert.equal(
    report.invocation.observedWorkerSha256,
    digest(expectedBytes[0]),
  );
  assert.equal(
    report.invocation.observedWorkerClosureSha256,
    digest(Buffer.from(`${canonicalJson(expectedWorkerClosure)}\n`, "utf8")),
  );
  assert.equal(
    report.invocation.observedSeccompLauncherSha256,
    digest(expectedBytes.at(-1)),
  );
  assert.doesNotMatch(
    JSON.stringify(report.invocation),
    new RegExp(workspace, "u"),
  );
  assert.equal(report.session.commands[2].observedPassed, 1);
  for (const descriptor of requests[0].inheritedFileDescriptors) {
    await assert.rejects(
      readFile(`/proc/self/fd/${descriptor}`),
      (error) => error.code === "ENOENT",
    );
  }
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

test("v2 structural host rejects retained-closure mutate then restore", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-closure-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const controller = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      const closurePath = `/proc/self/fd/${request.inheritedFileDescriptors[0]}`;
      const original = await readFile(closurePath);
      const changed = Buffer.from(original);
      changed[0] ^= 0x01;
      await chmod(closurePath, 0o600);
      await writeFile(closurePath, changed);
      await writeFile(closurePath, original);
      await chmod(closurePath, 0o400);
      await writeFile(
        resultFileFromRequest(request),
        resultBytes(digest(request.stdin)),
      );
      return safeOuterOutcome();
    },
  );
  await assert.rejects(
    controller.runSandboxVerificationSessionV2(sessionInput(workspace)),
    (error) => {
      assert.equal(isSandboxSessionV2Fault(error), true);
      assert.equal(error.reason, "protocol-or-inode");
      assert.equal(error.cleanupSafe, true);
      assert.equal(
        error.invocation.executableClosureBinding,
        "partial-esm-launcher-retained-fd-v1",
      );
      assert.equal(error.invocation.sameUidTamperResistance, false);
      return true;
    },
  );
});

test("v2 structural host retains authority when the runner rejects or evidence access throws", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-unknown-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const retainedDescriptors = [];
  const controllers = [
    createSandboxVerificationSessionV2ForTesting(async (request) => {
      retainedDescriptors.push([...request.inheritedFileDescriptors]);
      throw new Error("runner rejected without process proof");
    }),
    createSandboxVerificationSessionV2ForTesting(async (request) => {
      retainedDescriptors.push([...request.inheritedFileDescriptors]);
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
    const descriptors = retainedDescriptors.at(-1);
    assert.equal(descriptors.length, 8);
    for (const descriptor of descriptors) {
      assert.equal(
        (await readFile(`/proc/self/fd/${descriptor}`)).length > 0,
        true,
      );
    }
  }
});

test("v2 structural host quarantines a possibly-live closure handle after close uncertainty", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "oxigraph-v2-host-close-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  let failNextClose = false;
  let closeFailed = false;
  let retainedDescriptors;
  const controller = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      retainedDescriptors = [...request.inheritedFileDescriptors];
      await writeFile(
        resultFileFromRequest(request),
        resultBytes(digest(request.stdin)),
      );
      failNextClose = true;
      return safeOuterOutcome();
    },
    async (handle) => {
      if (failNextClose && !closeFailed) {
        closeFailed = true;
        throw new Error("injected retained closure close uncertainty");
      }
      await handle.close();
    },
  );
  await assert.rejects(
    controller.runSandboxVerificationSessionV2(sessionInput(workspace)),
    (error) => {
      assert.equal(isSandboxSessionV2Fault(error), true);
      assert.equal(error.reason, "cleanup");
      assert.equal(error.cleanupSafe, false);
      return true;
    },
  );
  assert.equal(closeFailed, true);
  assert.equal(retainedDescriptors.length, 8);
  assert.equal(
    (await readFile(`/proc/self/fd/${retainedDescriptors[0]}`)).length > 0,
    true,
  );
});

test("v2 structural host retains pre-spawn materialization authority when close never settles", async (t) => {
  const workspace = await mkdtemp(
    join(tmpdir(), "oxigraph-v2-host-materialize-close-"),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  let runnerCalled = false;
  let retainedDescriptor;
  const controller = createSandboxVerificationSessionV2ForTesting(
    async () => {
      runnerCalled = true;
      throw new Error("process runner must remain unreachable");
    },
    async (handle) => {
      retainedDescriptor ??= handle.fd;
      throw new Error("injected pre-spawn close uncertainty");
    },
  );
  await assert.rejects(
    controller.runSandboxVerificationSessionV2(sessionInput(workspace)),
    (error) => {
      assert.equal(isSandboxSessionV2Fault(error), true);
      assert.equal(error.reason, "cleanup");
      assert.equal(error.cleanupSafe, false);
      return true;
    },
  );
  assert.equal(runnerCalled, false);
  assert.equal(Number.isInteger(retainedDescriptor), true);
  assert.equal(
    (await readFile(`/proc/self/fd/${retainedDescriptor}`)).length > 0,
    true,
  );
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
