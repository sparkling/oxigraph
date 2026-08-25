import assert from "node:assert/strict";
import test from "node:test";
import { runG12Preflight } from "../src/runtime/preflight.mjs";

const digest = "a".repeat(64);

function fixture(overrides = {}) {
  const calls = [];
  const evaluator = Object.freeze({ kind: "evaluator" });
  const contract = Object.freeze({ id: "g1.2-rocksdb-serialized-writers" });
  return {
    calls,
    options: {
      repoRoot: "/controller",
      resolveContract({ repoRoot }) {
        calls.push(["contract", repoRoot]);
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
      /"commands":\[\{"name":"public","disposition":"completed","exitCode":101,"signal":null,"durationMs":17,"failureClass":"command-failed","stdoutSha256":"b{64}","stderrSha256":"c{64}"\},\{"name":"independent","disposition":"completed","exitCode":101,"signal":null,"durationMs":19,"failureClass":"state-exhausted","stdoutSha256":"d{64}","stderrSha256":"e{64}"\}\]/u,
    );
    assert.doesNotMatch(error.message, /sensitive/u);
    return true;
  });
  assert.equal(state.calls.at(-1)[0], "dispose");
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
