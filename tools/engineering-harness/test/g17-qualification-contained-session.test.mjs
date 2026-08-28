import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  fstatSync,
  ftruncateSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeSync,
} from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  qualificationSandboxEnvironment,
  qualificationSandboxSessionArguments,
  createQualificationSandboxSessionForTesting,
  normalizeG17NativeSessionForTesting,
} from "../src/qualification/contained-session.mjs";
import { createG17NativeSessionWorkerForTesting } from "../src/qualification/contained-session-worker.mjs";
import {
  createG17NativeSessionConfiguration,
  g17NativeSessionCommands,
} from "../src/qualification/native-session-contract.mjs";
import { runSandboxVerificationSession } from "../src/candidate/sandbox-session.mjs";
import { runBoundedProcess } from "../src/native/process.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import {
  syntheticG17Isolation,
  syntheticG17LaunchAttestation,
} from "./support/g17-native-session-fixture.mjs";
import { loadG17LegacyV4Contract } from "./support/g17-legacy-v4-contract-fixture.mjs";

const mebibyte = 1024 * 1024;

function sessionPlatformBinding() {
  return {
    schema: "oxigraph.g1.7-linux-native-platform-closure/v4",
    manifestSha256: "a".repeat(64),
    roles: {
      ar: { root: "platform", path: "usr/bin/x86_64-linux-gnu-ar" },
      cc: { root: "platform", path: "usr/bin/x86_64-linux-gnu-gcc-13" },
      cxx: { root: "platform", path: "usr/bin/x86_64-linux-gnu-g++-13" },
      libclang: {
        root: "platform",
        path: "usr/lib/llvm-18/lib/libclang-18.so.1",
      },
      rustc: { root: "toolchain", path: "bin/rustc" },
      rustfmt: { root: "toolchain", path: "bin/rustfmt" },
    },
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertDescriptorsClosed(descriptors) {
  assert.equal(descriptors.length, 8);
  for (const descriptor of descriptors) {
    assert.throws(
      () => fstatSync(descriptor),
      (error) => error?.code === "EBADF",
    );
  }
}

function descriptorsReferencing(root) {
  const references = [];
  for (const name of readdirSync("/proc/self/fd")) {
    try {
      const target = readlinkSync(`/proc/self/fd/${name}`);
      if (target === root || target.startsWith(`${root}/`))
        references.push(Number(name));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return references;
}

function descriptorsStartingWith(prefix) {
  const references = [];
  for (const name of readdirSync("/proc/self/fd")) {
    try {
      const target = readlinkSync(`/proc/self/fd/${name}`);
      if (target.startsWith(prefix)) references.push(Number(name));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return references;
}

function commandPlan() {
  const sealedContract = loadG17LegacyV4Contract();
  return g17NativeSessionCommands({
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
  });
}

function syntheticCommandRecord(command, overrides = {}) {
  const stdout = Buffer.from("", "utf8");
  const stderr = Buffer.from("", "utf8");
  const launchAttestation = Buffer.from("{}\n", "utf8");
  return {
    name: command.name,
    logicalArgv: command.argv,
    exitCode: 0,
    signal: null,
    disposition: "completed",
    durationMs: 5,
    stdoutBase64: stdout.toString("base64"),
    stderrBase64: stderr.toString("base64"),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    launchAttestationBase64: launchAttestation.toString("base64"),
    launchAttestationSha256: sha256(launchAttestation),
    terminationErrors: [],
    descendantsObserved: 0,
    ...overrides,
  };
}

function workerMountinfo() {
  return [
    "1 0 0:1 / / ro - tmpfs platform rw",
    "2 1 0:2 / /dev ro - devtmpfs devtmpfs rw",
    "15 2 0:15 / /dev/pts rw - devpts devpts rw",
    "3 1 0:3 / /proc rw - proc proc rw",
    "4 1 0:4 / /toolchain ro - tmpfs toolchain rw",
    "5 1 0:5 / /workspace ro - tmpfs workspace rw",
    "6 1 0:6 / /cargo-home ro - tmpfs cargo-home rw",
    "7 1 0:7 / /control/cgroup2 ro - cgroup2 cgroup2 rw",
    "8 1 0:100 / /state rw - tmpfs tmpfs rw,size=33554432",
    "9 8 0:100 /home /state/home rw - tmpfs tmpfs rw,size=33554432",
    "10 8 0:100 /target /state/target rw - tmpfs tmpfs rw,size=33554432",
    "11 8 0:100 /tmp /state/tmp rw - tmpfs tmpfs rw,size=33554432",
    "12 1 0:12 / /runner/contained-session-worker.mjs ro - tmpfs worker rw",
    "13 1 0:13 / /runner/seccomp-launcher.py ro - tmpfs launcher rw",
    "14 1 0:14 / /result/session.json ro - tmpfs result rw",
    "",
  ].join("\n");
}

function workerOutcome(overrides = {}) {
  return {
    exitCode: 0,
    signal: null,
    disposition: "completed",
    durationMs: 5,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    attestation: Buffer.from("{}\n", "utf8"),
    terminationErrors: Object.freeze([]),
    ...overrides,
  };
}

async function runSyntheticSession(root, raw, options = {}) {
  const sourceDirectory = join(root, "source");
  const cargoHomeDirectory = join(root, "cargo-home");
  const toolchainDirectory = join(root, "toolchain");
  const platformDirectory = join(root, "platform");
  const cargoExecutable = join(toolchainDirectory, "bin", "cargo");
  await Promise.all([
    mkdir(sourceDirectory, { recursive: true, mode: 0o700 }),
    mkdir(cargoHomeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(join(platformDirectory, "runner"), { recursive: true, mode: 0o700 }),
    mkdir(join(toolchainDirectory, "bin"), { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    writeFile(join(sourceDirectory, "descriptor-slot"), "workspace\n"),
    writeFile(join(cargoHomeDirectory, "descriptor-slot"), "cargo-home\n"),
    writeFile(cargoExecutable, "synthetic Cargo\n"),
    writeFile(join(toolchainDirectory, "bin", "rustc"), "synthetic rustc\n"),
    writeFile(
      join(platformDirectory, "runner", "contained-session-worker.mjs"),
      "synthetic contained-session worker\n",
    ),
    writeFile(
      join(platformDirectory, "runner", "seccomp-launcher.py"),
      "synthetic seccomp launcher\n",
    ),
  ]);
  await Promise.all([
    chmod(cargoExecutable, 0o500),
    chmod(join(toolchainDirectory, "bin", "rustc"), 0o500),
    chmod(
      join(platformDirectory, "runner", "contained-session-worker.mjs"),
      0o400,
    ),
    chmod(join(platformDirectory, "runner", "seccomp-launcher.py"), 0o400),
  ]);
  await options.prepare?.({
    sourceDirectory,
    cargoHomeDirectory,
    toolchainDirectory,
    platformDirectory,
  });
  const sealedContract = loadG17LegacyV4Contract();
  const platform = sessionPlatformBinding();
  const policy = {
    schema: "oxigraph.g1.7-linux-native-isolation-policy/v4",
    sha256: "b".repeat(64),
  };
  const reviewed = sealedContract.contract.compatibility.nativeSession;
  const requestedLimits = {
    totalWallMs: reviewed.maxTotalWallMs,
    residentBytes: reviewed.maxResidentBytes,
    diskBytes: reviewed.maxDiskBytes,
    cargoBuildJobs: reviewed.cargoBuildJobs,
    tasksMax: reviewed.tasksMax,
    memorySwapBytes: reviewed.memorySwapMaxBytes,
  };
  const configuration = createG17NativeSessionConfiguration({
    runId: "g17-contained-synthetic",
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
    platform,
    policy,
    workspaceProjectionSha256: "c".repeat(64),
    requestedLimits,
  });
  const runSession = createQualificationSandboxSessionForTesting(
    async (request) => {
      assert.equal(request.inheritedFileDescriptors.length, 8);
      assert.equal(
        new Set(request.inheritedFileDescriptors).size,
        request.inheritedFileDescriptors.length,
      );
      for (const descriptor of request.inheritedFileDescriptors) {
        assert.doesNotThrow(() => fstatSync(descriptor));
      }
      const [
        platformDescriptor,
        cgroupDescriptor,
        cargoHomeDescriptor,
        toolchainDescriptor,
        workspaceDescriptor,
        workerDescriptor,
        launcherDescriptor,
        outputDescriptor,
      ] = request.inheritedFileDescriptors;
      assert.equal(
        readFileSync(
          `/proc/self/fd/${platformDescriptor}/runner/contained-session-worker.mjs`,
          "utf8",
        ),
        "synthetic contained-session worker\n",
      );
      assert.equal(fstatSync(cgroupDescriptor).isDirectory(), true);
      assert.equal(
        readFileSync(
          `/proc/self/fd/${cargoHomeDescriptor}/descriptor-slot`,
          "utf8",
        ),
        "cargo-home\n",
      );
      assert.equal(
        readFileSync(`/proc/self/fd/${toolchainDescriptor}/bin/cargo`, "utf8"),
        "synthetic Cargo\n",
      );
      assert.equal(
        readFileSync(
          `/proc/self/fd/${workspaceDescriptor}/descriptor-slot`,
          "utf8",
        ),
        "workspace\n",
      );
      assert.equal(
        readFileSync(`/proc/self/fd/${workerDescriptor}`, "utf8"),
        "synthetic contained-session worker\n",
      );
      assert.equal(
        readFileSync(`/proc/self/fd/${launcherDescriptor}`, "utf8"),
        "synthetic seccomp launcher\n",
      );
      assert.equal(fstatSync(outputDescriptor).isFile(), true);
      const commands = (raw.commands ?? []).map((record, index) => {
        const attestation = syntheticG17LaunchAttestation(
          configuration,
          configuration.commands[index],
          index,
        );
        return {
          ...record,
          launchAttestationBase64: attestation.toString("base64"),
          launchAttestationSha256: sha256(attestation),
        };
      });
      const result = {
        ...raw,
        schema: "oxigraph.g1.7-native-session-result/v5",
        configuration,
        commands,
        isolation:
          raw.outcome === "error"
            ? null
            : syntheticG17Isolation(configuration, raw.stateBytes ?? 4_096),
      };
      const serialized = Buffer.from(`${canonicalJson(result)}\n`, "utf8");
      ftruncateSync(outputDescriptor, 0);
      assert.equal(
        writeSync(outputDescriptor, serialized, 0, serialized.length, null),
        serialized.length,
      );
      await options.onRequest?.(request, serialized);
      if (options.runnerError !== undefined) throw options.runnerError;
      return Object.freeze(
        options.outcome ?? {
          disposition: "completed",
          exitCode: 0,
          signal: null,
          durationMs: 10,
          stdout: "",
          stderr: "",
          terminationErrors: Object.freeze([]),
        },
      );
    },
  );
  return runSession({
    runId: "g17-contained-synthetic",
    contractBytes: sealedContract.bytes,
    contractSha256: sealedContract.contractSha256,
    platform,
    policy,
    workspaceProjectionSha256: "c".repeat(64),
    requestedLimits,
    sourceDirectory,
    cargoHomeDirectory,
    toolchainDirectory,
    platformDirectory,
  });
}

test("production worker normalizes only the reviewed mount ancestry", () => {
  const worker = createG17NativeSessionWorkerForTesting({
    now: () => 0,
    assertStateAnchors: () => {},
    runCargoCommand: async () => workerOutcome(),
    quiesceUntrustedProcesses: async () => 0,
  });
  const mounts = worker.normalizeMountinfo(workerMountinfo());
  assert.equal(
    mounts.find(({ destination }) => destination === "/workspace")
      .parentMountId,
    "1",
  );
  assert.equal(
    mounts.find(({ destination }) => destination === "/dev/pts").parentMountId,
    "2",
  );
  assert.equal(
    mounts.find(({ destination }) => destination === "/state/tmp")
      .parentMountId,
    "8",
  );
  assert.equal(Object.hasOwn(mounts[0], "privateRoot"), false);

  for (const drifted of [
    workerMountinfo().replace("5 1 0:5 / /workspace", "5 99 0:5 / /workspace"),
    workerMountinfo().replace("15 2 0:15 / /dev/pts", "15 1 0:15 / /dev/pts"),
    workerMountinfo().replace(
      "10 8 0:100 /target /state/target",
      "10 1 0:100 /target /state/target",
    ),
  ]) {
    assert.throws(
      () => worker.normalizeMountinfo(drifted),
      /mount ancestry drifted/u,
    );
  }
});

test("production worker stops at the first terminal command and bounds oversize evidence", async () => {
  const commands = commandPlan().slice(0, 3);
  const observedCommands = [];
  const outcomes = [
    workerOutcome(),
    workerOutcome({ exitCode: 7 }),
    workerOutcome(),
  ];
  let anchorChecks = 0;
  const worker = createG17NativeSessionWorkerForTesting({
    now: () => 0,
    assertStateAnchors: () => {
      anchorChecks += 1;
    },
    runCargoCommand: async (request) => {
      observedCommands.push(request);
      return outcomes[observedCommands.length - 1];
    },
    quiesceUntrustedProcesses: async () => 0,
  });
  const execution = await worker.executeSession({
    commands,
    environment: Object.freeze({}),
    requestedLimits: Object.freeze({ totalWallMs: 10_000 }),
  });
  assert.equal(observedCommands.length, 2);
  assert.equal(anchorChecks, 4);
  assert.ok(observedCommands.every(({ timeoutMs }) => timeoutMs === 9_250));
  assert.equal(execution.outcome, "fail");
  assert.deepEqual(execution.reason, {
    code: "command-exit-nonzero",
    command: commands[1].name,
  });
  assert.equal(execution.commands.length, 2);

  const serialized = worker.serializedResult(
    {
      schema: "oxigraph.g1.7-native-session-result/v5",
      configuration: { runId: "bounded-worker-test" },
      outcome: "pass",
      reason: null,
      commands: [{ stdoutBase64: "x".repeat(4_096) }],
      stateBytes: 0,
      durationMs: 9,
      finalDescendantsObserved: 0,
      isolation: {},
    },
    512,
  );
  assert.ok(serialized.length <= 512);
  assert.equal(serialized.at(-1), 0x0a);
  assert.deepEqual(JSON.parse(serialized), {
    commands: [],
    configuration: { runId: "bounded-worker-test" },
    durationMs: 9,
    finalDescendantsObserved: null,
    isolation: null,
    outcome: "error",
    reason: { code: "result-too-large", command: null },
    schema: "oxigraph.g1.7-native-session-result/v5",
    stateBytes: null,
  });
});

test("qualification result normalizer independently rejects signal, UTF-8, and duration lies", () => {
  const commands = commandPlan();
  const raw = {
    schema: "oxigraph.g1.7-native-session-result/v5",
    outcome: "fail",
    reason: { code: "command-exit-nonzero", command: commands[0].name },
    commands: [syntheticCommandRecord(commands[0], { exitCode: 7 })],
    stateBytes: 4_096,
    durationMs: 5,
    finalDescendantsObserved: 0,
  };
  const normalize = (value, maxTotalWallMs = 7_200_000) =>
    normalizeG17NativeSessionForTesting({
      raw: value,
      commands,
      maxDiskBytes: 256 * mebibyte,
      maxTotalWallMs,
    });
  assert.equal(normalize(raw).outcome, "fail");

  const invalidSignal = structuredClone(raw);
  invalidSignal.commands[0].exitCode = null;
  invalidSignal.commands[0].signal = "SIGFAKE";
  invalidSignal.reason.code = "command-signal";
  assert.throws(
    () => normalize(invalidSignal),
    /impossible qualification command result/u,
  );

  const commandOverrun = structuredClone(raw);
  commandOverrun.commands[0].durationMs = commands[0].timeoutMs + 1;
  commandOverrun.durationMs = commandOverrun.commands[0].durationMs;
  assert.throws(
    () => normalize(commandOverrun),
    /invalid qualification command result/u,
  );

  const totalOverrun = structuredClone(raw);
  totalOverrun.durationMs = 7_200_001;
  assert.throws(
    () => normalize(totalOverrun),
    /invalid qualification-session result schema/u,
  );

  const impossibleAggregate = structuredClone(raw);
  impossibleAggregate.durationMs = 0;
  assert.throws(
    () => normalize(impossibleAggregate),
    /shorter than its sequential commands/u,
  );

  const invalidUtf8 = structuredClone(raw);
  const invalidBytes = Buffer.from([0xff]);
  invalidUtf8.commands[0].stdoutBase64 = invalidBytes.toString("base64");
  invalidUtf8.commands[0].stdoutSha256 = sha256(invalidBytes);
  assert.throws(() => normalize(invalidUtf8), /invalid .* stdout UTF-8/u);
});

test("qualification sandbox uses only the exact descriptor transport", () => {
  const environment = qualificationSandboxEnvironment(
    sessionPlatformBinding(),
    2,
  );
  const args = qualificationSandboxSessionArguments({
    maxDiskBytes: 256 * mebibyte,
    environment,
  });
  const expectedBinds = [
    ["--ro-bind-fd", "3", "/"],
    ["--ro-bind-fd", "4", "/control/cgroup2"],
    ["--ro-bind-fd", "5", "/cargo-home"],
    ["--ro-bind-fd", "6", "/toolchain"],
    ["--ro-bind-fd", "7", "/workspace"],
    ["--ro-bind-fd", "8", "/runner/contained-session-worker.mjs"],
    ["--ro-bind-fd", "9", "/runner/seccomp-launcher.py"],
    ["--bind-fd", "10", "/result/session.json"],
  ];
  for (const [operation, descriptor, destination] of expectedBinds) {
    const destinationIndex = args.indexOf(destination);
    assert.ok(destinationIndex > 1, `${destination} was not mounted`);
    assert.deepEqual(args.slice(destinationIndex - 2, destinationIndex + 1), [
      operation,
      descriptor,
      destination,
    ]);
  }
  assert.deepEqual(
    args.flatMap((value, index) =>
      ["--ro-bind-fd", "--bind-fd"].includes(value)
        ? [args.slice(index, index + 3)]
        : [],
    ),
    expectedBinds,
  );
  assert.ok(args.includes("--unshare-net"));
  assert.ok(args.includes("--unshare-pid"));
  assert.ok(args.includes("--clearenv"));
  assert.equal(args.includes("--ro-bind"), false);
  assert.equal(args.includes("--bind"), false);
  assert.equal(args.includes("--symlink"), false);
  assert.equal(args.includes("--pipe"), false);
  const rootRemountIndex = args.findIndex(
    (value, index) => value === "--remount-ro" && args[index + 1] === "/",
  );
  assert.ok(args.indexOf("/result/session.json") < rootRemountIndex);
  assert.deepEqual(
    qualificationSandboxEnvironment(sessionPlatformBinding(), 2),
    environment,
  );
  assert.equal(environment.CC, "/usr/bin/x86_64-linux-gnu-gcc-13");
  assert.equal(environment.CXX, "/usr/bin/x86_64-linux-gnu-g++-13");
  assert.equal(environment.LIBCLANG_PATH, "/usr/lib/llvm-18/lib");
  assert.equal(environment.PATH, "/toolchain/bin:/usr/bin");
  assert.throws(
    () =>
      qualificationSandboxSessionArguments({
        maxDiskBytes: 256 * mebibyte,
        environment,
        sourceDirectory: "/must-not-be-admitted",
      }),
    /fields are not exact/u,
  );
});

test("qualification result accepts exact final-descendant containment evidence", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "oxigraph-g17-contained-final-result-"),
  );
  const inheritedFileDescriptors = [];
  const cgroupDescriptorsBefore = descriptorsReferencing("/sys/fs/cgroup");
  try {
    const commands = commandPlan();
    const report = await runSyntheticSession(
      root,
      {
        schema: "oxigraph.g1.7-native-session-result/v5",
        outcome: "incomplete",
        reason: { code: "final-live-descendants", command: null },
        commands: commands.map((command) => syntheticCommandRecord(command)),
        stateBytes: 4_096,
        durationMs: 30,
        finalDescendantsObserved: 1,
      },
      {
        onRequest(request) {
          inheritedFileDescriptors.push(...request.inheritedFileDescriptors);
        },
      },
    );
    assert.equal(report.session.outcome, "incomplete");
    assert.deepEqual(report.session.reason, {
      code: "final-live-descendants",
      command: null,
    });
    assert.equal(report.session.finalDescendantsObserved, 1);
    assert.ok(
      report.session.commands.every(
        ({ descendantsObserved }) => descendantsObserved === 0,
      ),
    );
    assert.equal(report.artifact.name, "native-session.json");
    assert.equal(report.projection.status, "INCOMPLETE");
    const originalDigest = report.artifact.sha256;
    const mutable = report.artifact.bytes;
    mutable.fill(0);
    assert.equal(sha256(report.artifact.bytes), originalDigest);
    assert.equal(report.artifact.bytes.length, report.resultBytes);
    assert.equal(report.invocation.cargoExecutable, "/toolchain/bin/cargo");
    assert.equal(
      report.invocation.argv.some((argument) => argument.startsWith(root)),
      false,
    );
    assertDescriptorsClosed(inheritedFileDescriptors);
    assert.deepEqual(descriptorsReferencing(root), []);
    assert.deepEqual(
      descriptorsStartingWith(join(tmpdir(), "oxigraph-g17-native-session-")),
      [],
    );
    assert.deepEqual(
      descriptorsReferencing("/sys/fs/cgroup"),
      cgroupDescriptorsBefore,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("qualification result rejects impossible completed and infrastructure states", async () => {
  const commands = commandPlan();
  for (const [name, raw] of [
    [
      "null-state",
      {
        schema: "oxigraph.g1.7-native-session-result/v5",
        outcome: "pass",
        reason: null,
        commands: commands.map((command) => syntheticCommandRecord(command)),
        stateBytes: null,
        durationMs: 20,
        finalDescendantsObserved: 0,
      },
    ],
    [
      "completed-descendant",
      {
        schema: "oxigraph.g1.7-native-session-result/v5",
        outcome: "pass",
        reason: null,
        commands: commands.map((command, index) =>
          syntheticCommandRecord(command, {
            descendantsObserved: index === 1 ? 1 : 0,
          }),
        ),
        stateBytes: 4_096,
        durationMs: 20,
        finalDescendantsObserved: 0,
      },
    ],
    [
      "error-with-commands",
      {
        schema: "oxigraph.g1.7-native-session-result/v5",
        outcome: "error",
        reason: { code: "infrastructure", command: null },
        commands: [syntheticCommandRecord(commands[0])],
        stateBytes: null,
        durationMs: 20,
        finalDescendantsObserved: null,
      },
    ],
  ]) {
    const root = await mkdtemp(
      join(tmpdir(), `oxigraph-g17-contained-${name}-`),
    );
    try {
      await assert.rejects(
        runSyntheticSession(root, raw),
        /(?:native session contract|invalid qualification-session)/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("qualification session closes every owned descriptor on runner and replay failures", async () => {
  const commands = commandPlan();
  const completed = {
    schema: "oxigraph.g1.7-native-session-result/v5",
    outcome: "pass",
    reason: null,
    commands: commands.map((command) => syntheticCommandRecord(command)),
    stateBytes: 4_096,
    durationMs: 20,
    finalDescendantsObserved: 0,
  };
  for (const [name, raw, options, pattern] of [
    [
      "runner-error",
      completed,
      { runnerError: new Error("synthetic runner failure") },
      /synthetic runner failure/u,
    ],
    [
      "nonzero",
      completed,
      {
        outcome: Object.freeze({
          disposition: "completed",
          exitCode: 23,
          signal: null,
          durationMs: 10,
          stdout: "",
          stderr: "synthetic nonzero",
          terminationErrors: Object.freeze([]),
        }),
      },
      /namespace did not complete/u,
    ],
    [
      "malformed-artifact",
      { ...completed, stateBytes: null },
      {},
      /native session contract/u,
    ],
  ]) {
    const root = await mkdtemp(
      join(tmpdir(), `oxigraph-g17-contained-close-${name}-`),
    );
    const inheritedFileDescriptors = [];
    const cgroupDescriptorsBefore = descriptorsReferencing("/sys/fs/cgroup");
    try {
      await assert.rejects(
        runSyntheticSession(root, raw, {
          ...options,
          onRequest(request) {
            inheritedFileDescriptors.push(...request.inheritedFileDescriptors);
          },
        }),
        pattern,
      );
      assertDescriptorsClosed(inheritedFileDescriptors);
      assert.deepEqual(descriptorsReferencing(root), []);
      assert.deepEqual(
        descriptorsStartingWith(join(tmpdir(), "oxigraph-g17-native-session-")),
        [],
      );
      assert.deepEqual(
        descriptorsReferencing("/sys/fs/cgroup"),
        cgroupDescriptorsBefore,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("qualification session rejects symlinked and wrong-type sources without descriptor leaks", async () => {
  const commands = commandPlan();
  const raw = {
    schema: "oxigraph.g1.7-native-session-result/v5",
    outcome: "pass",
    reason: null,
    commands: commands.map((command) => syntheticCommandRecord(command)),
    stateBytes: 4_096,
    durationMs: 20,
    finalDescendantsObserved: 0,
  };
  for (const [name, prepare, pattern] of [
    [
      "runner-symlink",
      async ({ platformDirectory }) => {
        const runner = join(platformDirectory, "runner");
        const replacement = join(platformDirectory, "runner-replacement");
        await mkdir(replacement, { mode: 0o700 });
        await rm(runner, { recursive: true });
        await symlink("runner-replacement", runner);
      },
      /platform runner root could not be pinned/u,
    ],
    [
      "launcher-symlink",
      async ({ platformDirectory }) => {
        const runner = join(platformDirectory, "runner");
        await rm(join(runner, "seccomp-launcher.py"));
        await symlink(
          "contained-session-worker.mjs",
          join(runner, "seccomp-launcher.py"),
        );
      },
      /seccomp launcher could not be pinned/u,
    ],
    [
      "cargo-directory",
      async ({ toolchainDirectory }) => {
        const cargo = join(toolchainDirectory, "bin", "cargo");
        await rm(cargo);
        await mkdir(cargo, { mode: 0o500 });
      },
      /Cargo executable could not be pinned/u,
    ],
  ]) {
    const root = await mkdtemp(
      join(tmpdir(), `oxigraph-g17-contained-source-${name}-`),
    );
    let processInvoked = false;
    const cgroupDescriptorsBefore = descriptorsReferencing("/sys/fs/cgroup");
    try {
      await assert.rejects(
        runSyntheticSession(root, raw, {
          prepare,
          onRequest() {
            processInvoked = true;
          },
        }),
        pattern,
      );
      assert.equal(processInvoked, false);
      assert.deepEqual(descriptorsReferencing(root), []);
      assert.deepEqual(
        descriptorsStartingWith(join(tmpdir(), "oxigraph-g17-native-session-")),
        [],
      );
      assert.deepEqual(
        descriptorsReferencing("/sys/fs/cgroup"),
        cgroupDescriptorsBefore,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test(
  "systemd-run, prlimit, and Bubblewrap preserve then consume the exact FD transport",
  {
    timeout: 30_000,
    skip:
      process.platform !== "linux" ||
      process.env.OXIGRAPH_G17_LIVE_FD_TRANSPORT !== "1"
        ? "set OXIGRAPH_G17_LIVE_FD_TRANSPORT=1 on the reviewed Linux host"
        : false,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-fd-transport-"));
    const platform = join(root, "platform");
    const sourceRoots = Array.from({ length: 4 }, (_, index) =>
      join(root, `source-${index}`),
    );
    const worker = join(root, "worker");
    const launcher = join(root, "launcher");
    const output = join(root, "session.json");
    const handles = [];
    try {
      await Promise.all([
        mkdir(join(platform, "bin"), { recursive: true, mode: 0o700 }),
        mkdir(join(platform, "proc"), { recursive: true, mode: 0o700 }),
        mkdir(join(platform, "control", "cgroup2"), {
          recursive: true,
          mode: 0o700,
        }),
        mkdir(join(platform, "cargo-home"), { recursive: true, mode: 0o700 }),
        mkdir(join(platform, "toolchain"), { recursive: true, mode: 0o700 }),
        mkdir(join(platform, "workspace"), { recursive: true, mode: 0o700 }),
        mkdir(join(platform, "runner"), { recursive: true, mode: 0o700 }),
        mkdir(join(platform, "result"), { recursive: true, mode: 0o700 }),
        ...sourceRoots.map((path) => mkdir(path, { mode: 0o700 })),
      ]);
      await Promise.all([
        copyFile("/usr/bin/busybox", join(platform, "bin", "busybox")),
        writeFile(
          join(platform, "runner", "worker"),
          "platform worker placeholder\n",
        ),
        writeFile(
          join(platform, "runner", "launcher"),
          "platform launcher placeholder\n",
        ),
        writeFile(join(platform, "result", "session.json"), ""),
        writeFile(worker, "worker descriptor\n"),
        writeFile(launcher, "launcher descriptor\n"),
        writeFile(output, ""),
      ]);
      await Promise.all([
        chmod(join(platform, "bin", "busybox"), 0o555),
        chmod(join(platform, "result", "session.json"), 0o400),
        chmod(worker, 0o400),
        chmod(launcher, 0o400),
        chmod(output, 0o600),
      ]);
      for (const path of [platform, ...sourceRoots, worker, launcher, output]) {
        handles.push(await open(path, path === output ? "r+" : "r"));
      }
      const inheritedFileDescriptors = handles.map(({ fd }) => fd);
      const script = [
        'leaked=""',
        "for fd in 3 4 5 6 7 8 9 10; do",
        '  if [ -e "/proc/self/fd/$fd" ]; then leaked="${leaked}${fd},"; fi',
        "done",
        'printf "%s\\n" "$leaked" > /result/session.json',
      ].join("\n");
      const outcome = await runBoundedProcess({
        executable: "/usr/bin/systemd-run",
        args: [
          "--user",
          "--scope",
          "--quiet",
          "--collect",
          "--",
          "/usr/bin/prlimit",
          "--core=0",
          "--fsize=1048576",
          "--",
          "/usr/bin/bwrap",
          "--die-with-parent",
          "--new-session",
          "--unshare-user",
          "--uid",
          "0",
          "--gid",
          "0",
          "--clearenv",
          "--ro-bind-fd",
          "3",
          "/",
          "--proc",
          "/proc",
          "--ro-bind-fd",
          "4",
          "/control/cgroup2",
          "--ro-bind-fd",
          "5",
          "/cargo-home",
          "--ro-bind-fd",
          "6",
          "/toolchain",
          "--ro-bind-fd",
          "7",
          "/workspace",
          "--ro-bind-fd",
          "8",
          "/runner/worker",
          "--ro-bind-fd",
          "9",
          "/runner/launcher",
          "--bind-fd",
          "10",
          "/result/session.json",
          "--remount-ro",
          "/",
          "--setenv",
          "PATH",
          "/bin",
          "--",
          "/bin/busybox",
          "sh",
          "-c",
          script,
        ],
        cwd: tmpdir(),
        environment: Object.freeze({
          HOME: "/nonexistent",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          PATH: "/usr/bin:/bin",
          XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
        }),
        timeoutMs: 20_000,
        maxOutputBytes: 64 * 1024,
        inheritedFileDescriptors,
      });
      assert.equal(
        outcome.exitCode,
        0,
        `${outcome.disposition}\n${outcome.stdout}\n${outcome.stderr}`,
      );
      assert.equal(await readFile(output, "utf8"), "\n");
      for (const descriptor of inheritedFileDescriptors) {
        assert.doesNotThrow(() => fstatSync(descriptor));
      }
    } finally {
      await Promise.allSettled(handles.map((handle) => handle.close()));
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("candidate verifier refuses qualification command pairs", async () => {
  await assert.rejects(
    runSandboxVerificationSession({
      workspace: "/nonexistent",
      commands: commandPlan(),
      maxTotalWallMs: 150_000,
      maxResidentBytes: 2 * 1024 * mebibyte,
      maxDiskBytes: 512 * mebibyte,
      cargoBuildJobs: 2,
      maxBuildOutputBytes: mebibyte,
      maxTestOutputBytesPerCommand: mebibyte,
    }),
    /supported frozen sequence/u,
  );
});
