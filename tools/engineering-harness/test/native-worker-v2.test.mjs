import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { statSync, writeFileSync } from "node:fs";
import {
  access,
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assembleCandidatePatchV2 } from "../src/policy/paths-v2.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";
import {
  createNativeWorkerV2ControllerForTesting,
  exercisePinnedFileVerificationForTesting,
  nativeWorkerV2OutputSchemaSha256,
  runNativeWorkerV2,
} from "../src/native/worker-v2.mjs";

const EXISTING = "lib/oxigraph/src/existing_v2.rs";
const CREATED = "lib/oxigraph/src/new_v2.rs";
const CONTRACT_BYTES = Buffer.from('{"schemaVersion":2}\n', "utf8");
const CONTEXT = Object.freeze({
  schemaVersion: 2,
  sourceSnapshot: Object.freeze({ sha256: "a".repeat(64) }),
  creationInstructions: Object.freeze([
    Object.freeze({ path: CREATED, transition: "A" }),
  ]),
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contract(objectFormat = "sha1", overrides = {}) {
  const width = objectFormat === "sha1" ? 40 : 64;
  return Object.freeze({
    routing: Object.freeze({
      pairedCalibration: true,
      forbidOpenRouter: true,
      providers: Object.freeze([
        Object.freeze({
          provider: "codex",
          transport: "native",
          model: "gpt-5.6-sol",
        }),
        Object.freeze({
          provider: "claude",
          transport: "native",
          model: "opus",
        }),
      ]),
    }),
    baseline: Object.freeze({ tree: "a".repeat(width) }),
    evaluator: Object.freeze({ tree: "b".repeat(width) }),
    scope: Object.freeze({
      mutableExact: Object.freeze([EXISTING, CREATED]),
      createExact: Object.freeze([CREATED]),
      mutablePrefixes: Object.freeze([]),
      blockedExact: Object.freeze([]),
      blockedPrefixes: Object.freeze([]),
      allowCreate: true,
      allowDelete: false,
      allowRename: false,
      allowModeChange: false,
      allowSymlink: false,
      allowSubmoduleChange: false,
    }),
    ceilings: Object.freeze({
      maxPatchBytes: 16_384,
      maxChangedFiles: 2,
      maxChangedLines: 64,
      maxWorkerOutputBytes: 262_144,
      maxTotalVerifierWallMs: 2_700_000,
      ...overrides,
    }),
  });
}

function sealedContext(currentContract, contractBytes = CONTRACT_BYTES) {
  const taskBytes = Buffer.from(JSON.stringify(CONTEXT), "utf8");
  return Object.freeze({
    context: CONTEXT,
    contract: currentContract,
    contractSha256: sha256(contractBytes),
    taskBytes,
    taskSha256: sha256(taskBytes),
  });
}

function completed(stdout = Buffer.alloc(0), overrides = {}) {
  const stdoutBytes = Buffer.isBuffer(stdout)
    ? Buffer.from(stdout)
    : Buffer.from(stdout, "utf8");
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
    stdout: stdoutBytes,
    stderr: Buffer.alloc(0),
    durationMs: 1,
    terminationErrors: Object.freeze([]),
    processErrors: Object.freeze([]),
    ...overrides,
  });
}

function output(overrides = {}) {
  return {
    summary: "bounded exact-create candidate",
    patch: null,
    creations: [{ path: CREATED, content: "pub struct SemanticChange;\n" }],
    findings: [],
    verdict: "ACCEPT",
    ...overrides,
  };
}

function modificationPatch() {
  return (
    `diff --git a/${EXISTING} b/${EXISTING}\n` +
    `--- a/${EXISTING}\n` +
    `+++ b/${EXISTING}\n` +
    "@@ -1 +1 @@\n" +
    "-old\n" +
    "+new\n"
  );
}

function controller({
  currentContract = contract(),
  processRunner,
  patchParser = async () => {},
  assertContext,
}) {
  return createNativeWorkerV2ControllerForTesting({
    assertContext:
      assertContext ??
      (({ context, contractBytes }) => {
        assert.equal(context, CONTEXT);
        assert.equal(sha256(contractBytes), sha256(CONTRACT_BYTES));
        return sealedContext(currentContract, contractBytes);
      }),
    processRunner,
    patchParser,
  });
}

function request(currentController, overrides = {}) {
  return currentController.createRequest({
    context: CONTEXT,
    contractBytes: Buffer.from(CONTRACT_BYTES),
    provider: "codex",
    role: "implementation",
    directive: "Implement only the exact admitted semantic-change module.",
    roleInput: { acceptance: ["exact create"] },
    ...overrides,
  });
}

function terminalFailure(code) {
  return (error) =>
    error instanceof TaskV2Failure &&
    error.code === code &&
    error.terminal === true &&
    error.retryAllowed === false;
}

test("retained descriptor verification rejects same-inode mutation and restoration", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-worker-v2-pin-test-"));
  const path = join(root, "pinned.bin");
  const original = Buffer.from("AAAA", "ascii");
  try {
    await writeFile(path, original);
    assert.deepEqual(
      exercisePinnedFileVerificationForTesting(path, () => {}),
      Object.freeze({ sha256: sha256(original), size: original.length }),
    );

    assert.throws(
      () =>
        exercisePinnedFileVerificationForTesting(path, () => {
          writeFileSync(path, Buffer.from("BBBB", "ascii"));
        }),
      terminalFailure("ERR_INTERNAL_FAIL_CLOSED"),
    );

    writeFileSync(path, original);
    const beforeRestore = statSync(path, { bigint: true });
    assert.throws(
      () =>
        exercisePinnedFileVerificationForTesting(path, () => {
          writeFileSync(path, Buffer.from("CCCC", "ascii"));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
          writeFileSync(path, original);
        }),
      terminalFailure("ERR_INTERNAL_FAIL_CLOSED"),
    );
    const afterRestore = statSync(path, { bigint: true });
    assert.equal(afterRestore.ino, beforeRestore.ino);
    assert.equal(afterRestore.size, beforeRestore.size);
    assert.notEqual(afterRestore.ctimeNs, beforeRestore.ctimeNs);
    assert.deepEqual(await readFile(path), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 Codex request is opaque, one-shot, contract-routed, and assembles exact creation bytes", async () => {
  let processCalls = 0;
  let parserCalls = 0;
  let parsedPatch;
  let outputRoot;
  let observedPrompt;
  let observedExecutableSha256;
  let observedSchemaSha256;
  const accepted = output();
  const currentContract = contract();
  const currentController = controller({
    currentContract,
    processRunner: async ({
      executable,
      args,
      stdin,
      inheritedFileDescriptors,
    }) => {
      processCalls += 1;
      observedPrompt = stdin.toString("utf8");
      assert.equal(executable, "/proc/self/fd/3");
      assert.equal(inheritedFileDescriptors.length, 2);
      observedExecutableSha256 = sha256(
        await readFile(`/proc/self/fd/${inheritedFileDescriptors[0]}`),
      );
      observedSchemaSha256 = sha256(
        await readFile(`/proc/self/fd/${inheritedFileDescriptors[1]}`),
      );
      assert.ok(args.includes("gpt-5.6-sol"));
      assert.equal(
        args[args.indexOf("--output-schema") + 1],
        "/proc/self/fd/4",
      );
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      outputRoot = dirname(outputPath);
      await writeFile(outputPath, JSON.stringify(accepted), "utf8");
      return completed();
    },
    patchParser: async ({ patch }) => {
      parserCalls += 1;
      parsedPatch = patch;
    },
  });
  const sealedRequest = request(currentController);
  assert.deepEqual(Object.keys(sealedRequest), ["schema", "requestSha256"]);
  assert.equal(Object.isFrozen(sealedRequest), true);

  const result = await currentController.run(sealedRequest);
  const expected = assembleCandidatePatchV2(
    currentContract,
    accepted.patch,
    accepted.creations,
  );
  assert.equal(processCalls, 1);
  assert.equal(parserCalls, 1);
  assert.equal(parsedPatch, expected.patch);
  assert.equal(result.status, "ACCEPT");
  assert.equal(result.output.patch, expected.patch);
  assert.deepEqual(result.candidateProjection, expected.projection);
  assert.deepEqual(result.providerOutputV2, accepted);
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.invocation.requestSha256, sealedRequest.requestSha256);
  assert.equal(
    result.invocation.outputSchemaSha256,
    nativeWorkerV2OutputSchemaSha256,
  );
  assert.equal(result.invocation.outputSchemaSha256, observedSchemaSha256);
  assert.equal(
    result.invocation.executableAttestation.sha256,
    observedExecutableSha256,
  );
  assert.equal(result.invocation.executableAttestation.childFd, 3);
  assert.equal(
    result.invocation.outputSchemaTransport,
    "inherited-readonly-fd-v1",
  );
  assert.equal(result.invocation.outputSchemaChildFd, 4);
  assert.equal(JSON.stringify(result.invocation).includes("/home/"), false);
  assert.equal(JSON.stringify(result.invocation).includes("/usr/"), false);
  assert.equal(
    result.invocation.promptSha256,
    sha256(Buffer.from(observedPrompt)),
  );
  assert.match(observedPrompt, /Creations contains exactly one/u);
  assert.doesNotMatch(observedPrompt, /OPENROUTER/iu);
  await assert.rejects(access(outputRoot));

  await assert.rejects(
    currentController.run(sealedRequest),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(processCalls, 1);
});

test("v2 worker preserves raw mixed modifications and derives SHA-1/SHA-256 creation identities", async () => {
  for (const objectFormat of ["sha1", "sha256"]) {
    const currentContract = contract(objectFormat);
    const rawModification = modificationPatch();
    const accepted = output({ patch: rawModification });
    let parsedPatch;
    const currentController = controller({
      currentContract,
      processRunner: async ({ args }) => {
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(outputPath, JSON.stringify(accepted), "utf8");
        return completed();
      },
      patchParser: async ({ patch }) => {
        parsedPatch = patch;
      },
    });
    const result = await currentController.run(request(currentController));
    assert.equal(
      result.output.patch.slice(0, rawModification.length),
      rawModification,
    );
    assert.equal(parsedPatch, result.output.patch);
    assert.deepEqual(result.candidateProjection.pathStatuses, [
      { path: EXISTING, status: "M" },
      { path: CREATED, status: "A" },
    ]);
    assert.equal(
      result.candidateProjection.createdBlobs[0].objectId.length,
      objectFormat === "sha1" ? 40 : 64,
    );
    assert.equal(
      result.invocation.finalPatchSha256,
      sha256(Buffer.from(result.output.patch)),
    );
  }
});

test("v2 invocation and request digests ignore private random execution-root names", async () => {
  const argsDigests = [];
  const requestDigests = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentController = controller({
      processRunner: async ({ args }) => {
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(outputPath, JSON.stringify(output()), "utf8");
        return completed();
      },
    });
    const sealedRequest = request(currentController);
    const result = await currentController.run(sealedRequest);
    requestDigests.push(sealedRequest.requestSha256);
    argsDigests.push(result.invocation.argsSha256);
    assert.equal(
      result.invocation.argsNormalization,
      "execution-root-token-v1",
    );
  }
  assert.equal(new Set(requestDigests).size, 1);
  assert.equal(new Set(argsDigests).size, 1);
});

test("v2 Claude readonly requests accept only one terminal structured result and never parse patches", async () => {
  let parserCalls = 0;
  let processCalls = 0;
  let transportedSchemaSha256;
  const readonly = output({ patch: null, creations: [] });
  const currentController = controller({
    processRunner: async ({ args }) => {
      processCalls += 1;
      assert.ok(args.includes("opus"));
      transportedSchemaSha256 = sha256(
        Buffer.from(args[args.indexOf("--json-schema") + 1], "utf8"),
      );
      return completed(
        JSON.stringify([
          { type: "system", subtype: "init" },
          { type: "result", is_error: false, structured_output: readonly },
        ]),
      );
    },
    patchParser: async () => {
      parserCalls += 1;
    },
  });
  const result = await currentController.run(
    request(currentController, {
      provider: "claude",
      role: "review",
      directive: "Review the sealed candidate only.",
    }),
  );
  assert.equal(result.status, "ACCEPT");
  assert.equal(result.model, "opus");
  assert.equal(result.output.patch, null);
  assert.equal(processCalls, 1);
  assert.equal(parserCalls, 0);
  assert.equal(result.invocation.outputSchemaSha256, transportedSchemaSha256);
  assert.equal(result.invocation.outputSchemaTransport, "argv-utf8-v1");
  assert.equal(result.invocation.outputSchemaChildFd, null);
  assert.match(result.outcome.stdoutSha256, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(result).includes("structured_output"), false);
});

test("v2 Claude rejects malformed bytes and non-success envelopes with exact byte evidence", async () => {
  const readonly = output({ patch: null, creations: [] });
  const cases = [
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
    Buffer.from(JSON.stringify(readonly), "utf8"),
    Buffer.from(
      JSON.stringify({
        type: "result",
        is_error: true,
        structured_output: readonly,
      }),
      "utf8",
    ),
    Buffer.from(
      JSON.stringify({ type: "result", structured_output: readonly }),
      "utf8",
    ),
    Buffer.from(
      JSON.stringify([
        {
          type: "result",
          is_error: false,
          structured_output: readonly,
        },
        { type: "system", subtype: "late" },
      ]),
      "utf8",
    ),
  ];
  for (const bytes of cases) {
    let parserCalls = 0;
    const currentController = controller({
      processRunner: async () => completed(bytes),
      patchParser: async () => {
        parserCalls += 1;
      },
    });
    const result = await currentController.run(
      request(currentController, {
        provider: "claude",
        role: "review",
        directive: "Review only.",
      }),
    );
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.failure.code, "ERR_RECONSTRUCTION");
    assert.equal(result.outcome.stdoutSha256, sha256(bytes));
    assert.equal(parserCalls, 0);
  }
});

test("v2 process failure is sanitized, terminal, and grants no retry", async () => {
  let processCalls = 0;
  let executionRoot;
  const currentController = controller({
    processRunner: async ({ cwd }) => {
      processCalls += 1;
      executionRoot = cwd;
      throw new Error("secret /home/operator/provider.log");
    },
  });
  const sealedRequest = request(currentController);
  const result = await currentController.run(sealedRequest);
  assert.equal(processCalls, 1);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.outcome, null);
  assert.equal(result.failure.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.equal(result.failure.terminal, true);
  assert.equal(result.failure.retryAllowed, false);
  assert.equal(JSON.stringify(result).includes("/home/operator"), false);
  assert.equal(JSON.stringify(result).includes(executionRoot), false);
  assert.equal(JSON.stringify(result.invocation).includes("/home/"), false);
  assert.deepEqual(Object.keys(result.failure).sort(), [
    "code",
    "detailSha256",
    "publicMessage",
    "retryAllowed",
    "terminal",
  ]);
  await assert.rejects(
    currentController.run(sealedRequest),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(processCalls, 1);
  assert.equal(await access(executionRoot).then(() => true), true);
  await rm(executionRoot, { recursive: true, force: true });
});

test("v2 inconclusive failures expose no untrusted provider prose", async () => {
  const currentController = controller({
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(
        outputPath,
        JSON.stringify(
          output({
            summary: "secret /home/operator/provider.log",
            patch: null,
            creations: [],
            findings: ["raw stderr token=secret"],
            verdict: "INCONCLUSIVE",
          }),
        ),
        "utf8",
      );
      return completed();
    },
  });
  const result = await currentController.run(request(currentController));
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(Object.hasOwn(result, "output"), false);
  assert.equal(JSON.stringify(result).includes("/home/operator"), false);
  assert.equal(JSON.stringify(result).includes("token=secret"), false);
});

test("v2 unreaped process evidence preserves its execution root", async () => {
  let executionRoot;
  const currentController = controller({
    processRunner: async ({ cwd }) => {
      executionRoot = cwd;
      return completed(Buffer.alloc(0), {
        disposition: "timeout-unreaped",
        firstTerminalReason: "timeout",
        reaped: false,
        directChildCleanupSafe: false,
        stdoutEof: false,
        stderrEof: false,
        captureComplete: false,
      });
    },
  });
  const result = await currentController.run(request(currentController));
  try {
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.outcome.reaped, false);
    assert.equal(result.failure.code, "ERR_INTERNAL_FAIL_CLOSED");
    assert.equal(await access(executionRoot).then(() => true), true);
    assert.equal(JSON.stringify(result).includes(executionRoot), false);
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
});

test("v2 process-group proof disagreement fails closed and preserves its execution root", async () => {
  let executionRoot;
  const currentController = controller({
    processRunner: async ({ cwd }) => {
      executionRoot = cwd;
      return completed(Buffer.alloc(0), {
        processGroupQuiescent: false,
        captureComplete: false,
      });
    },
  });
  const result = await currentController.run(request(currentController));
  try {
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.failure.code, "ERR_INTERNAL_FAIL_CLOSED");
    assert.equal(result.outcome.processGroupQuiescent, false);
    assert.equal(await access(executionRoot).then(() => true), true);
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }
});

test("v2 requests cannot cross controllers, be cloned, or select a caller model", async () => {
  let processCalls = 0;
  let assertionCalls = 0;
  const make = () =>
    controller({
      assertContext: ({ contractBytes }) => {
        assertionCalls += 1;
        return sealedContext(contract(), contractBytes);
      },
      processRunner: async () => {
        processCalls += 1;
        return completed();
      },
    });
  const first = make();
  const second = make();
  const sealedRequest = request(first);
  assert.equal(assertionCalls, 1);
  await assert.rejects(
    second.run(sealedRequest),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  await assert.rejects(
    first.run({ ...sealedRequest }),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  await assert.rejects(
    runNativeWorkerV2(sealedRequest),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(processCalls, 0);

  assert.throws(
    () =>
      first.createRequest({
        context: CONTEXT,
        contractBytes: Buffer.from(CONTRACT_BYTES),
        provider: "codex",
        role: "implementation",
        directive: "exact",
        roleInput: {},
        model: "attacker-selected",
      }),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(assertionCalls, 1);
});

test("v2 request capture rejects accessors and Proxies without invoking getters", () => {
  let getterCalls = 0;
  let processCalls = 0;
  const currentController = controller({
    processRunner: async () => {
      processCalls += 1;
      return completed();
    },
  });
  const accessor = {
    context: CONTEXT,
    contractBytes: Buffer.from(CONTRACT_BYTES),
    provider: "codex",
    role: "implementation",
    directive: "exact",
    roleInput: {},
  };
  Object.defineProperty(accessor, "directive", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "attacker";
    },
  });
  assert.throws(
    () => currentController.createRequest(accessor),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.throws(
    () => currentController.createRequest(new Proxy(accessor, {})),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.throws(
    () =>
      request(currentController, {
        roleInput: { oversized: "x".repeat(524_289) },
      }),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(getterCalls, 0);
  assert.equal(processCalls, 0);
});

test("v2 request capture uses native byte brands and never coerces hostile roles", () => {
  let observations = 0;
  const explosive = () => {
    observations += 1;
    throw new Error("must not observe hostile authority");
  };
  const contractBytes = Buffer.from(CONTRACT_BYTES);
  const taskBytes = Buffer.from(JSON.stringify(CONTEXT), "utf8");
  for (const bytes of [contractBytes, taskBytes]) {
    for (const name of ["buffer", "byteLength", "byteOffset"]) {
      Object.defineProperty(bytes, name, {
        configurable: true,
        get: explosive,
      });
    }
    Object.defineProperty(bytes, Symbol.iterator, {
      configurable: true,
      get: explosive,
    });
  }
  const currentController = controller({
    assertContext: ({ contractBytes: captured }) => ({
      ...sealedContext(contract(), captured),
      taskBytes,
    }),
    processRunner: async () => completed(),
  });
  const sealedRequest = request(currentController, { contractBytes });
  assert.match(sealedRequest.requestSha256, /^[0-9a-f]{64}$/u);

  const hostileRole = new Proxy(
    {},
    {
      get: explosive,
      getPrototypeOf: explosive,
      ownKeys: explosive,
    },
  );
  assert.throws(
    () => request(currentController, { role: hostileRole }),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.throws(
    () =>
      request(currentController, {
        contractBytes: new Uint8Array(new SharedArrayBuffer(1)),
      }),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(observations, 0);
});

test("v2 process evidence rejects accessors without invoking them", async () => {
  let stdoutGetterCalls = 0;
  const currentController = controller({
    processRunner: async () => {
      const evidence = { ...completed() };
      Object.defineProperty(evidence, "stdout", {
        enumerable: true,
        get() {
          stdoutGetterCalls += 1;
          return "{}";
        },
      });
      return evidence;
    },
  });
  const result = await currentController.run(request(currentController));
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.failure.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.equal(stdoutGetterCalls, 0);
});

test("v2 Codex output rejects symlinks, hard links, and malformed bytes before patch parsing", async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), "oxigraph-worker-v2-test-"));
  const outside = join(outsideRoot, "outside.json");
  await writeFile(outside, JSON.stringify(output()), "utf8");
  let parserCalls = 0;
  try {
    for (const writer of [
      (path) => symlink(outside, path),
      (path) => link(outside, path),
      (path) => writeFile(path, Buffer.from([0xff])),
    ]) {
      const currentController = controller({
        processRunner: async ({ args }) => {
          const outputPath = args[args.indexOf("--output-last-message") + 1];
          await writer(outputPath);
          return completed();
        },
        patchParser: async () => {
          parserCalls += 1;
        },
      });
      const result = await currentController.run(request(currentController));
      assert.equal(result.status, "INCONCLUSIVE");
      assert.equal(result.failure.code, "ERR_RECONSTRUCTION");
      assert.equal(parserCalls, 0);
      assert.equal(await access(outside).then(() => true), true);
    }
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("v2 invalid provider output and parser faults each terminate after one attempt", async () => {
  for (const currentOutput of [
    output({ patch: "", creations: [] }),
    output({ creations: [{ path: CREATED, content: "no terminal LF" }] }),
  ]) {
    let processCalls = 0;
    let parserCalls = 0;
    const currentController = controller({
      processRunner: async ({ args }) => {
        processCalls += 1;
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(outputPath, JSON.stringify(currentOutput), "utf8");
        return completed();
      },
      patchParser: async () => {
        parserCalls += 1;
      },
    });
    const result = await currentController.run(request(currentController));
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(processCalls, 1);
    assert.equal(parserCalls, 0);
    assert.equal(result.failure.retryAllowed, false);
  }

  let parserCalls = 0;
  let parserRoot;
  const currentController = controller({
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(output()), "utf8");
      return completed();
    },
    patchParser: async ({ cwd }) => {
      parserCalls += 1;
      parserRoot = cwd;
      throw new Error("Git diagnostic /secret/repo");
    },
  });
  const result = await currentController.run(request(currentController));
  assert.equal(parserCalls, 1);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.failure.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.equal(JSON.stringify(result).includes("/secret/repo"), false);
  assert.equal(await access(parserRoot).then(() => true), true);
  await rm(parserRoot, { recursive: true, force: true });
});

test("v2 production Git parser consumes exact patch bytes through the byte runner", async () => {
  let executionRoot;
  const currentContract = contract();
  const currentController = createNativeWorkerV2ControllerForTesting({
    assertContext: ({ contractBytes }) =>
      sealedContext(currentContract, contractBytes),
    processRunner: async ({ args, cwd }) => {
      executionRoot = cwd;
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(output()), "utf8");
      return completed();
    },
  });
  const result = await currentController.run(request(currentController));
  assert.equal(result.status, "ACCEPT");
  assert.match(result.output.patch, /new file mode 100644/u);
  await assert.rejects(access(executionRoot));
});

test("v2 pre-aborted native signals stop before provider spawn and consume the request", async () => {
  const abort = new AbortController();
  abort.abort();
  let processCalls = 0;
  const currentController = controller({
    processRunner: async () => {
      processCalls += 1;
      return completed();
    },
  });
  const sealedRequest = request(currentController, { signal: abort.signal });
  await assert.rejects(
    currentController.run(sealedRequest),
    terminalFailure("ERR_INTERNAL_FAIL_CLOSED"),
  );
  await assert.rejects(
    currentController.run(sealedRequest),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(processCalls, 0);
});

test("v2 sealed context bytes and digests must agree before a provider can run", () => {
  let processCalls = 0;
  const currentController = controller({
    assertContext: ({ contractBytes }) => ({
      ...sealedContext(contract(), contractBytes),
      taskSha256: "f".repeat(64),
    }),
    processRunner: async () => {
      processCalls += 1;
      return completed();
    },
  });
  assert.throws(
    () => request(currentController),
    terminalFailure("ERR_RECONSTRUCTION"),
  );
  assert.equal(processCalls, 0);
});
