import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { open } from "node:fs/promises";
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

test("bounded process maps retained parent descriptors to child fd 3", async () => {
  const descriptor = await open(new URL(import.meta.url), "r");
  try {
    const outcome = await runBoundedProcess({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(require('node:fs').readFileSync(3, 'utf8'))",
      ],
      cwd: process.cwd(),
      environment,
      timeoutMs: 1000,
      maxOutputBytes: 64 * 1024,
      inheritedFileDescriptors: [descriptor.fd],
    });
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.stdout, /maps retained parent descriptors/u);
    assert.equal((await descriptor.stat()).isFile(), true);
  } finally {
    await descriptor.close();
  }
});

test("bounded process rejects malformed, duplicate, and closed inherited descriptors", async () => {
  const base = {
    executable: process.execPath,
    args: ["-e", ""],
    cwd: process.cwd(),
    environment,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  };
  for (const inheritedFileDescriptors of [
    "3",
    Array.from({ length: 33 }, (_, index) => index),
    [0, 0],
    [-1],
    [1.5],
    new Array(1),
  ]) {
    assert.throws(
      () => runBoundedProcess({ ...base, inheritedFileDescriptors }),
      /inherited file descriptors/u,
    );
  }
  const descriptor = await open(new URL(import.meta.url), "r");
  const closed = descriptor.fd;
  await descriptor.close();
  assert.throws(
    () => runBoundedProcess({ ...base, inheritedFileDescriptors: [closed] }),
    /not live/u,
  );
});

test("bounded process rejects forged signals and ignores native-signal baggage", async () => {
  const base = {
    executable: process.execPath,
    args: ["-e", "throw new Error('must not spawn')"],
    cwd: process.cwd(),
    environment,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  };
  let observations = 0;
  const proxied = new Proxy(new AbortController().signal, {
    get() {
      observations += 1;
      throw new Error("proxy getter must not run");
    },
  });
  const ownGetter = new AbortController().signal;
  Object.defineProperty(ownGetter, "aborted", {
    configurable: true,
    get() {
      observations += 1;
      throw new Error("own getter must not run");
    },
  });
  Object.defineProperty(ownGetter, Symbol("ignored signal baggage"), {
    get() {
      observations += 1;
      throw new Error("symbol getter must not run");
    },
  });
  const prototypeGetter = new AbortController().signal;
  Object.setPrototypeOf(
    prototypeGetter,
    Object.create(AbortSignal.prototype, {
      aborted: {
        configurable: true,
        get() {
          observations += 1;
          throw new Error("prototype getter must not run");
        },
      },
    }),
  );
  for (const signal of [
    proxied,
    prototypeGetter,
    Object.create(AbortSignal.prototype),
    { aborted: false },
  ]) {
    assert.throws(
      () => runBoundedProcess({ ...base, signal }),
      /native AbortSignal|native brand/u,
    );
  }
  const accepted = await runBoundedProcess({
    ...base,
    args: ["-e", "process.stdout.write('accepted')"],
    signal: ownGetter,
  });
  assert.equal(accepted.stdout, "accepted");
  assert.equal(getEventListeners(ownGetter, "abort").length, 0);
  assert.equal(observations, 0);
});

test("bounded process terminates cancelled and excessive-output groups", async () => {
  const preController = new AbortController();
  preController.abort();
  const preCancelled = await runBoundedProcess({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    environment,
    timeoutMs: 5000,
    maxOutputBytes: 1024,
    signal: preController.signal,
  });
  assert.equal(preCancelled.disposition, "cancelled");

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
