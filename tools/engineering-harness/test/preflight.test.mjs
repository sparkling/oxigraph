import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskV2ExecutionGateForTesting,
  runG12Preflight,
  runTaskPreflight,
  runTaskPreflightV2,
  TASK_V2_EXECUTION_GATE_REQUEST,
} from "../src/runtime/preflight.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";
import { g12Profile } from "../src/task-profile.mjs";

const digest = "a".repeat(64);

function fixture(overrides = {}) {
  const calls = [];
  const evaluator = Object.freeze({ kind: "evaluator" });
  const contract = Object.freeze({ id: "g1.2-rocksdb-serialized-writers" });
  return {
    calls,
    options: {
      repoRoot: "/controller",
      resolveContract({ repoRoot, taskId }) {
        calls.push(["contract", repoRoot, taskId]);
        return {
          contract,
          contractPath: "contract.json",
          contractSha256: digest,
          repository: { baseline: { commit: "baseline" } },
        };
      },
      async resolveControl(input) {
        calls.push(["control", input]);
        return { harnessSha256: digest };
      },
      async reconstruct(input) {
        calls.push(["reconstruct", input]);
        return evaluator;
      },
      async materializeSubmodules(input) {
        calls.push(["submodules", input]);
        return [{ path: "native" }];
      },
      async createSourceSnapshot(input) {
        calls.push(["snapshot", input]);
        return { sha256: digest, contractSha256: input.contractSha256 };
      },
      async verifyBaseline(input) {
        calls.push(["verify", input]);
        return {
          verdict: "CONFIRMED_RED",
          initialRedMatched: true,
          referencesGreen: true,
        };
      },
      async dispose(input) {
        calls.push(["dispose", input]);
      },
      ...overrides,
    },
  };
}

test("generic preflight selects a registered task id", async () => {
  const state = fixture();
  const result = await runTaskPreflight({
    ...state.options,
    taskId: g12Profile.id,
  });
  assert.equal(result.schema, "oxigraph.g1.2-preflight/v1");
  assert.deepEqual(state.calls[0], ["contract", "/controller", g12Profile.id]);
});

test("generic preflight rejects contractPath and unknown ids before resolution", async () => {
  let resolutions = 0;
  const resolveContract = () => {
    resolutions += 1;
    throw new Error("must not resolve");
  };
  await assert.rejects(
    runTaskPreflight({
      contractPath: "/tmp/copied-contract.json",
      resolveContract,
    }),
    /contractPath selection is forbidden/u,
  );
  await assert.rejects(
    runTaskPreflight({ taskId: "g9.9-unregistered", resolveContract }),
    /unsupported engineering task/u,
  );
  assert.equal(resolutions, 0);
});

test("generic preflight rejects a resolver result for a different registered task", async () => {
  const state = fixture();
  await assert.rejects(
    runTaskPreflight({
      ...state.options,
      taskId: "g1.3-transaction-capabilities",
    }),
    /resolved contract does not match the selected engineering task/u,
  );
  assert.deepEqual(
    state.calls.map(([name]) => name),
    ["contract"],
  );
});

test("preflight freezes control before reconstructing and disposes the evaluator", async () => {
  const state = fixture();
  const result = await runG12Preflight(state.options);
  assert.equal(result.schema, "oxigraph.g1.2-preflight/v1");
  assert.equal(result.contractSha256, digest);
  assert.equal(result.sourceSnapshot.contractSha256, digest);
  assert.equal(result.redBaseline.verdict, "CONFIRMED_RED");
  assert.deepEqual(
    state.calls.map(([name]) => name),
    ["contract", "control", "reconstruct", "submodules", "snapshot", "verify", "dispose"],
  );
  const snapshotInput = state.calls[4][1];
  assert.equal(snapshotInput.evaluator.kind, "evaluator");
  assert.equal(snapshotInput.contract, result.contract);
  assert.equal(snapshotInput.contractSha256, digest);
});

test("preflight fails closed on a non-discriminating baseline and still disposes", async () => {
  const state = fixture({
    async verifyBaseline(input) {
      state.calls.push(["verify", input]);
      return {
        verdict: "INVALID_BASELINE",
        initialRedMatched: false,
        referencesGreen: true,
        commands: [
          {
            name: "public",
            disposition: "completed",
            exitCode: 101,
            signal: null,
            durationMs: 17,
            stdoutSha256: "b".repeat(64),
            stderrSha256: "c".repeat(64),
            stdoutTail: "sensitive evaluator output",
            stderrTail: "sensitive compiler output",
          },
          {
            name: "independent",
            disposition: "completed",
            exitCode: 101,
            signal: null,
            durationMs: 19,
            stdoutSha256: "d".repeat(64),
            stderrSha256: "e".repeat(64),
            stdoutTail: "",
            stderrTail: "failed to write output: No space left on device",
          },
        ],
      };
    },
  });
  await assert.rejects(runG12Preflight(state.options), (error) => {
    assert.match(
      error.message,
      /evaluator prerequisite is not confirmed red: .*"initialRedMatched":false.*"referencesGreen":true/u,
    );
    assert.match(
      error.message,
      /"commands":\[\{"name":"public","disposition":"completed","exitCode":101,"signal":null,"durationMs":17,"failureClass":"cargo-build-failed-unclassified","stdoutSha256":"b{64}","stderrSha256":"c{64}"\},\{"name":"independent","disposition":"completed","exitCode":101,"signal":null,"durationMs":19,"failureClass":"state-exhausted","ioArea":"unknown","ioErrno":"ENOSPC","stdoutSha256":"d{64}","stderrSha256":"e{64}"\}\]/u,
    );
    assert.doesNotMatch(error.message, /sensitive/u);
    return true;
  });
  assert.equal(state.calls.at(-1)[0], "dispose");
});

test("preflight exposes bounded cold-build failure classes without raw tails", async () => {
  const state = fixture({
    async verifyBaseline(input) {
      state.calls.push(["verify", input]);
      return {
        verdict: "INCONCLUSIVE",
        initialRedMatched: false,
        referencesGreen: false,
        commands: [
          {
            name: "format",
            disposition: "completed",
            exitCode: 1,
            stderrTail: "error[E0599]: private compiler detail\ncould not compile `secret`",
          },
          {
            name: "build",
            disposition: "completed",
            exitCode: 101,
            stderrTail: "error: linking with `cc` failed: private linker detail",
          },
          {
            name: "public",
            disposition: "completed",
            exitCode: 101,
            stderrTail: "failed to run custom build command for `secret-native`",
          },
          {
            name: "independent",
            disposition: "completed",
            exitCode: 101,
            stderrTail: "rustc-LLVM ERROR: private toolchain detail",
          },
          {
            name: "regression",
            disposition: "completed",
            exitCode: 101,
            stderrTail: "attempting to make an HTTP request, but --offline was specified",
          },
        ],
      };
    },
  });
  await assert.rejects(runG12Preflight(state.options), (error) => {
    assert.match(error.message, /"failureClass":"rust-compiler-diagnostic"/u);
    assert.match(error.message, /"failureClass":"linker-error"/u);
    assert.match(error.message, /"failureClass":"native-build-error"/u);
    assert.match(error.message, /"failureClass":"toolchain-error"/u);
    assert.match(error.message, /"failureClass":"offline-dependency"/u);
    assert.doesNotMatch(error.message, /private|secret|rustc-LLVM|HTTP request/u);
    return true;
  });
});

test("preflight classifies sandbox filesystem failures without leaking paths", async () => {
  const state = fixture({
    async verifyBaseline(input) {
      state.calls.push(["verify", input]);
      return {
        verdict: "INCONCLUSIVE",
        initialRedMatched: false,
        referencesGreen: false,
        commands: [
          {
            name: "build",
            disposition: "completed",
            exitCode: 101,
            stderrTail: "failed to write /private/path: Read-only file system (os error 30)",
          },
        ],
      };
    },
  });
  await assert.rejects(runG12Preflight(state.options), (error) => {
    assert.match(error.message, /"failureClass":"sandbox-filesystem"/u);
    assert.doesNotMatch(error.message, /private\/path|Read-only/u);
    return true;
  });
});

test("preflight exposes bounded compiler evidence without command text", async () => {
  const state = fixture({
    async verifyBaseline(input) {
      state.calls.push(["verify", input]);
      return {
        verdict: "INCONCLUSIVE",
        initialRedMatched: false,
        referencesGreen: false,
        commands: [
          {
            name: "build",
            disposition: "completed",
            exitCode: 101,
            stderrTail: "could not compile `secret`",
            diagnostic: {
              primaryClass: "child-process-signaled",
              rustcCodes: ["E0277", "E0599"],
              childRole: "rustc",
              childTermination: "signal",
              childExitCode: null,
              childSignalNumber: 9,
              childSignalName: "SIGKILL",
              ioArea: "unknown",
              ioErrno: null,
            },
          },
        ],
      };
    },
  });
  await assert.rejects(runG12Preflight(state.options), (error) => {
    assert.match(error.message, /"failureClass":"child-process-signaled"/u);
    assert.match(error.message, /"rustcCodes":\["E0277","E0599"\]/u);
    assert.match(
      error.message,
      /"childRole":"rustc","childTermination":"signal","childExitCode":null,"childSignalNumber":9,"childSignalName":"SIGKILL"/u,
    );
    assert.doesNotMatch(error.message, /private|secret|missing method/u);
    return true;
  });
});

test("preflight recognizes bounded compiler temporary-state failures", async () => {
  const state = fixture({
    async verifyBaseline(input) {
      state.calls.push(["verify", input]);
      return {
        verdict: "INCONCLUSIVE",
        initialRedMatched: false,
        referencesGreen: false,
        commands: [
          {
            name: "build",
            disposition: "completed",
            exitCode: 101,
            stderrTail:
              "error: couldn't create a temp dir: No such file or directory (os error 2) at path /private/state",
          },
        ],
      };
    },
  });
  await assert.rejects(runG12Preflight(state.options), (error) => {
    assert.match(error.message, /"failureClass":"sandbox-filesystem"/u);
    assert.doesNotMatch(error.message, /private|No such file|temp dir/u);
    return true;
  });
});

test("preflight exposes only the admitted target area for compiler temp failures", async () => {
  const state = fixture({
    async verifyBaseline(input) {
      state.calls.push(["verify", input]);
      return {
        verdict: "INCONCLUSIVE",
        initialRedMatched: false,
        referencesGreen: false,
        commands: [
          {
            name: "build",
            disposition: "completed",
            exitCode: 101,
            stdoutSha256: "0".repeat(64),
            stderrSha256: "1".repeat(64),
            diagnostic: {
              primaryClass: "sandbox-filesystem",
              rustcCodes: [],
              childRole: "unknown",
              childTermination: null,
              childExitCode: null,
              childSignalNumber: null,
              childSignalName: null,
              ioArea: "target",
              ioErrno: "ENOENT",
            },
          },
        ],
      };
    },
  });
  await assert.rejects(runG12Preflight(state.options), (error) => {
    assert.match(error.message, /"ioArea":"target","ioErrno":"ENOENT"/u);
    assert.doesNotMatch(error.message, /\/state\/target|rustc|temp dir|No such file/u);
    return true;
  });
});

test("preflight disposes after preparation failures without invoking the verifier", async () => {
  const state = fixture({
    async createSourceSnapshot(input) {
      state.calls.push(["snapshot", input]);
      throw new Error("source seal failed");
    },
  });
  await assert.rejects(runG12Preflight(state.options), /source seal failed/);
  assert.deepEqual(
    state.calls.map(([name]) => name),
    ["contract", "control", "reconstruct", "submodules", "snapshot", "dispose"],
  );
});

test("schema-v2 preflight returns the exact unavailable gate before options", () => {
  let optionTraps = 0;
  const deferredOptions = new Proxy(
    {},
    {
      get() {
        optionTraps += 1;
        throw new Error("deferred preflight options were inspected");
      },
      has() {
        optionTraps += 1;
        throw new Error("deferred preflight options were inspected");
      },
      ownKeys() {
        optionTraps += 1;
        throw new Error("deferred preflight options were inspected");
      },
    },
  );

  const result = runTaskPreflightV2(
    TASK_V2_EXECUTION_GATE_REQUEST,
    deferredOptions,
  );
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(optionTraps, 0);
});

test("schema-v2 execution gate rejects hostile requests before readiness", () => {
  let readinessCalls = 0;
  const gate = createTaskV2ExecutionGateForTesting(() => {
    readinessCalls += 1;
    return Object.freeze({
      status: "unavailable",
      reason: "native-adapter-unavailable",
    });
  });
  let proxyTraps = 0;
  const hostile = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        proxyTraps += 1;
        throw new Error("gate request trap");
      },
      ownKeys() {
        proxyTraps += 1;
        throw new Error("gate request trap");
      },
    },
  );
  const accessor = {};
  let getterCalls = 0;
  Object.defineProperty(accessor, "contractSchemaVersion", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 2;
    },
  });
  Object.defineProperty(accessor, "executionGate", {
    enumerable: true,
    value: "native-containment-qualification-v1",
  });

  for (const request of [
    hostile,
    accessor,
    {},
    {
      executionGate: "native-containment-qualification-v1",
      contractSchemaVersion: 2,
    },
    {
      contractSchemaVersion: 2,
      executionGate: "native-containment-qualification-v1",
      extra: true,
    },
  ]) {
    assert.throws(() => gate(request), (error) => {
      assert.equal(error instanceof TaskV2Failure, true);
      assert.equal(error.code, "ERR_CONTRACT_SCHEMA_OR_KEYS");
      assert.equal(error.terminal, true);
      assert.equal(error.retryAllowed, false);
      return true;
    });
  }
  assert.equal(proxyTraps, 0);
  assert.equal(getterCalls, 0);
  assert.equal(readinessCalls, 0);
});

test("schema-v2 execution gate makes one bounded readiness attempt", () => {
  for (const readiness of [
    () => Object.freeze({ status: "verified", reason: "test-only" }),
    () => Object.freeze({ status: "unproved", reason: "invalid-proof" }),
    () => ({ status: "unavailable", reason: "native-adapter-unavailable" }),
    () => {
      throw new Error("private readiness failure");
    },
  ]) {
    let calls = 0;
    const gate = createTaskV2ExecutionGateForTesting(() => {
      calls += 1;
      return readiness();
    });
    assert.throws(() => gate(TASK_V2_EXECUTION_GATE_REQUEST), (error) => {
      assert.equal(error instanceof TaskV2Failure, true);
      assert.equal(error.terminal, true);
      assert.equal(error.retryAllowed, false);
      assert.doesNotMatch(
        `${error.stack}\n${JSON.stringify(error)}`,
        /private readiness/u,
      );
      return true;
    });
    assert.equal(calls, 1);
  }
});
