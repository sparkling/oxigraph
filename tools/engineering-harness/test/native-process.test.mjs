import assert from "node:assert/strict";
import test from "node:test";
import { scrubbedChildEnvironment } from "../../child-environment.mjs";
import { runBoundedProcess } from "../src/native/process.mjs";

const environment = scrubbedChildEnvironment({ NO_COLOR: "1" });

test("bounded process captures a successful literal-argv invocation", async () => {
  const outcome = await runBoundedProcess({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    cwd: process.cwd(),
    environment,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.disposition, "completed");
  assert.equal(outcome.stdout, "ok");
});

test("bounded process terminates cancelled and excessive-output groups", async () => {
  const controller = new AbortController();
  const cancelled = runBoundedProcess({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    environment,
    timeoutMs: 5000,
    maxOutputBytes: 1024,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 30);
  assert.equal((await cancelled).disposition, "cancelled");

  const excessive = await runBoundedProcess({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    environment,
    timeoutMs: 5000,
    maxOutputBytes: 128,
  });
  assert.equal(excessive.disposition, "output-limit");
  assert.equal(Buffer.byteLength(excessive.stdout), 128);
});

test("bounded process escalates to SIGKILL even when SIGTERM delivery fails", async () => {
  const signals = [];
  const controller = new AbortController();
  const running = runBoundedProcess({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    environment,
    timeoutMs: 5000,
    maxOutputBytes: 1024,
    signal: controller.signal,
    killProcess: (pid, signal) => {
      signals.push(signal);
      if (signal === "SIGTERM") {
        const error = new Error("proof");
        error.code = "EPERM";
        throw error;
      }
      return process.kill(pid, signal);
    },
  });
  setTimeout(() => controller.abort(), 30);
  const outcome = await running;
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(outcome.disposition, "cancelled");
  assert.equal(outcome.terminationErrors[0].signal, "SIGTERM");
});
