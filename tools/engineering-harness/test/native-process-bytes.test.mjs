import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import { scrubbedChildEnvironment } from "../../child-environment.mjs";
import {
  deriveBoundedProcessByteStatusForTesting,
  runBoundedProcessBytes,
} from "../src/native/process.mjs";

const environment = scrubbedChildEnvironment({ NO_COLOR: "1" });

function request(overrides = {}) {
  return {
    executable: process.execPath,
    args: ["-e", ""],
    cwd: process.cwd(),
    environment,
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
    ...overrides,
  };
}

test("raw bounded process preserves arbitrary stdout and stderr bytes", async () => {
  const expectedStdout = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a]);
  const expectedStderr = Buffer.from([0x00, 0x80, 0xfd]);
  const outcome = await runBoundedProcessBytes(
    request({
      args: [
        "-e",
        "process.stdout.write(Buffer.from([0,255,254,128,10]));" +
          "process.stderr.write(Buffer.from([0,128,253]));",
      ],
    }),
  );

  assert.equal(outcome.disposition, "completed");
  assert.equal(outcome.firstTerminalReason, "completed");
  assert.equal(outcome.reaped, true);
  assert.equal(outcome.directChildCleanupSafe, true);
  assert.equal(outcome.exitObserved, true);
  assert.equal(outcome.closeObserved, true);
  assert.equal(outcome.statusAgreement, true);
  assert.equal(outcome.stdoutEof, true);
  assert.equal(outcome.stderrEof, true);
  assert.equal(outcome.captureComplete, true);
  assert.deepEqual(outcome.stdout, expectedStdout);
  assert.deepEqual(outcome.stderr, expectedStderr);
});

test("raw bounded process returns defensive copies of captured bytes", async () => {
  const outcome = await runBoundedProcessBytes(
    request({ args: ["-e", "process.stdout.write(Buffer.from([1,2,3]))"] }),
  );

  const first = outcome.stdout;
  first.fill(0);
  assert.deepEqual(outcome.stdout, Buffer.from([1, 2, 3]));
  assert.notStrictEqual(outcome.stdout, outcome.stdout);
});

test("raw bounded process admits the exact shared output ceiling", async () => {
  const outcome = await runBoundedProcessBytes(
    request({
      args: ["-e", "process.stdout.write(Buffer.from([1,2,3,4]))"],
      maxOutputBytes: 4,
    }),
  );

  assert.equal(outcome.disposition, "completed");
  assert.equal(outcome.outputTruncated, false);
  assert.equal(outcome.captureComplete, true);
  assert.deepEqual(outcome.stdout, Buffer.from([1, 2, 3, 4]));
});

test("raw bounded process fails closed on one byte beyond the shared ceiling", async () => {
  const outcome = await runBoundedProcessBytes(
    request({
      args: ["-e", "process.stdout.write(Buffer.from([1,2,3,4,5]))"],
      maxOutputBytes: 4,
    }),
  );

  assert.equal(outcome.disposition, "output-limit");
  assert.equal(outcome.firstTerminalReason, "output-limit");
  assert.equal(outcome.outputTruncated, true);
  assert.equal(outcome.captureComplete, false);
  assert.equal(outcome.reaped, true);
  assert.deepEqual(outcome.stdout, Buffer.from([1, 2, 3, 4]));
  assert.equal(outcome.stdout.length + outcome.stderr.length, 4);
});

test("raw bounded process uses one shared ceiling across stdout and stderr", async () => {
  const outcome = await runBoundedProcessBytes(
    request({
      args: [
        "-e",
        "process.stdout.write(Buffer.from([1,2,3]));" +
          "process.stderr.write(Buffer.from([4,5,6]));",
      ],
      maxOutputBytes: 5,
    }),
  );

  assert.equal(outcome.disposition, "output-limit");
  assert.equal(outcome.outputTruncated, true);
  assert.equal(outcome.stdout.length + outcome.stderr.length, 5);
});

test("raw bounded process enforces the exact aggregate UTF-8 argv ceiling", async () => {
  const controller = new AbortController();
  controller.abort();
  const halfCeiling = "\u00e9".repeat(262_144);
  const exact = await runBoundedProcessBytes(
    request({
      args: [halfCeiling, halfCeiling],
      signal: controller.signal,
    }),
  );

  assert.equal(exact.noChild, true);
  assert.throws(
    () =>
      runBoundedProcessBytes(
        request({
          args: [halfCeiling, `${halfCeiling}a`],
          signal: controller.signal,
        }),
      ),
    /aggregate UTF-8 byte ceiling/u,
  );
});

test("raw bounded process observes cancellation before and after spawn", async () => {
  const preController = new AbortController();
  preController.abort();
  const beforeSpawn = await runBoundedProcessBytes(
    request({
      args: ["-e", "throw new Error('must not spawn')"],
      signal: preController.signal,
    }),
  );
  assert.equal(beforeSpawn.disposition, "cancelled");
  assert.equal(beforeSpawn.firstTerminalReason, "cancelled");
  assert.equal(beforeSpawn.spawned, false);
  assert.equal(beforeSpawn.noChild, true);
  assert.equal(beforeSpawn.reaped, false);
  assert.equal(beforeSpawn.directChildCleanupSafe, true);
  assert.equal(beforeSpawn.statusAgreement, false);
  assert.equal(beforeSpawn.exitObserved, false);
  assert.equal(beforeSpawn.closeObserved, false);
  assert.equal(beforeSpawn.stdoutEof, false);
  assert.equal(beforeSpawn.stderrEof, false);
  assert.equal(getEventListeners(preController.signal, "abort").length, 0);

  const controller = new AbortController();
  const running = runBoundedProcessBytes(
    request({
      args: ["-e", "process.stdout.write('started'); setInterval(() => {}, 1000)"],
      timeoutMs: 5_000,
      signal: controller.signal,
    }),
  );
  setTimeout(() => controller.abort(), 30);
  const afterSpawn = await running;
  assert.equal(afterSpawn.disposition, "cancelled");
  assert.equal(afterSpawn.firstTerminalReason, "cancelled");
  assert.equal(afterSpawn.spawned, true);
  assert.equal(afterSpawn.reaped, true);
  assert.equal(afterSpawn.exitObserved, true);
  assert.equal(afterSpawn.closeObserved, true);
  assert.equal(afterSpawn.statusAgreement, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("raw bounded process distinguishes a native spawn failure from a reap", async () => {
  const outcome = await runBoundedProcessBytes(
    request({ executable: "/oxigraph-test/nonexistent-byte-process" }),
  );

  assert.equal(outcome.disposition, "spawn-error");
  assert.equal(outcome.firstTerminalReason, "spawn-error");
  assert.equal(outcome.spawned, false);
  assert.equal(outcome.noChild, true);
  assert.equal(outcome.reaped, false);
  assert.equal(outcome.directChildCleanupSafe, true);
  assert.equal(outcome.captureComplete, false);
  assert.equal(outcome.processErrors.length, 1);
});

test("raw bounded process waits for inherited stdout EOF before settling", async () => {
  let settled = false;
  const running = runBoundedProcessBytes(
    request({
      args: [
        "-e",
        "require('node:child_process').spawn(process.execPath," +
          "['-e','setTimeout(() => {}, 120)']," +
          "{stdio:['ignore','inherit','ignore']});",
      ],
    }),
  ).then((outcome) => {
    settled = true;
    return outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false);
  const outcome = await running;
  assert.equal(outcome.exitObserved, true);
  assert.equal(outcome.closeObserved, true);
  assert.equal(outcome.stdoutEof, true);
  assert.equal(outcome.reaped, true);
});

test("raw bounded process preserves timeout as the first terminal reason", async () => {
  const outcome = await runBoundedProcessBytes(
    request({
      args: ["-e", "process.stdout.write('started'); setInterval(() => {}, 1000)"],
      timeoutMs: 40,
    }),
  );

  assert.equal(outcome.disposition, "timeout");
  assert.equal(outcome.firstTerminalReason, "timeout");
  assert.equal(outcome.spawned, true);
  assert.equal(outcome.reaped, true);
  assert.equal(outcome.statusAgreement, true);
});

test("raw bounded process signals descendants holding pipes after leader exit", async () => {
  const descendant =
    "process.on('SIGTERM',()=>{});" +
    "process.stdout.write('descendant-ready\\n');" +
    "setTimeout(()=>process.exit(0),3000);";
  const leader =
    "const {spawn}=require('node:child_process');" +
    `spawn(process.execPath,['-e',${JSON.stringify(descendant)}],` +
    "{stdio:['ignore','inherit','inherit']});process.exit(0);";
  const outcome = await runBoundedProcessBytes(
    request({ args: ["-e", leader], timeoutMs: 500 }),
  );

  assert.equal(outcome.firstTerminalReason, "timeout");
  assert.equal(outcome.disposition, "timeout");
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.closeCode, 0);
  assert.equal(outcome.stdoutEof, true);
  assert.equal(outcome.stderrEof, true);
  assert.equal(outcome.reaped, true);
  assert.match(outcome.stdout.toString("utf8"), /descendant-ready/u);
});

test("raw bounded process keeps the first reason when timeout and abort race", async () => {
  const controller = new AbortController();
  const running = runBoundedProcessBytes(
    request({
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 35,
      signal: controller.signal,
    }),
  );
  setTimeout(() => controller.abort(), 35);
  const outcome = await running;

  assert.match(outcome.firstTerminalReason, /^(?:timeout|cancelled)$/u);
  assert.equal(outcome.disposition, outcome.firstTerminalReason);
  assert.equal(outcome.reaped, true);
  assert.equal(outcome.statusAgreement, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("raw bounded process rejects overlapping active runs and releases after close", async () => {
  const controller = new AbortController();
  const first = runBoundedProcessBytes(
    request({
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 5_000,
      signal: controller.signal,
    }),
  );
  let overlap;
  let overlapError;
  try {
    overlap = await runBoundedProcessBytes(request());
  } catch (error) {
    overlapError = error;
  }
  controller.abort();
  const firstOutcome = await first;

  assert.equal(overlap, undefined);
  assert.equal(overlapError?.code, "ERR_BOUNDED_BYTE_PROCESS_BUSY");
  assert.equal(firstOutcome.firstTerminalReason, "cancelled");
  assert.equal((await runBoundedProcessBytes(request())).disposition, "completed");
});

test("raw bounded process retains its sole admission slot until late close", async () => {
  const escapedDescendant = "setTimeout(()=>process.exit(0),2800);";
  const leader =
    "const {spawn}=require('node:child_process');" +
    `spawn(process.execPath,['-e',${JSON.stringify(escapedDescendant)}],` +
    "{detached:true,stdio:['ignore','inherit','inherit']});" +
    "process.exit(0);";
  const unreaped = await runBoundedProcessBytes(
    request({ args: ["-e", leader], timeoutMs: 250 }),
  );
  let retainedError;
  try {
    await runBoundedProcessBytes(request());
  } catch (error) {
    retainedError = error;
  }

  assert.equal(unreaped.disposition, "timeout-unreaped");
  assert.equal(unreaped.reaped, false);
  assert.equal(retainedError?.code, "ERR_BOUNDED_BYTE_PROCESS_BUSY");

  const deadline = Date.now() + 3_000;
  let recovered;
  while (recovered === undefined && Date.now() < deadline) {
    try {
      recovered = await runBoundedProcessBytes(request());
    } catch (error) {
      if (error?.code !== "ERR_BOUNDED_BYTE_PROCESS_BUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(recovered?.disposition, "completed");
  assert.equal(unreaped.disposition, "timeout-unreaped");
  assert.equal(unreaped.reaped, false);
});

test("test-only status driver rejects exit and close disagreement", () => {
  const status = deriveBoundedProcessByteStatusForTesting({
    spawned: true,
    spawnErrorObserved: false,
    exitObserved: true,
    exitCode: 0,
    exitSignal: null,
    closeObserved: true,
    closeCode: 1,
    closeSignal: null,
    stdoutEof: true,
    stderrEof: true,
  });

  assert.equal(status.syntheticTestOnly, true);
  assert.equal(status.statusAgreement, false);
  assert.equal(status.reaped, false);
  assert.equal(status.directChildCleanupSafe, true);
});

test("test-only status driver distinguishes no child from a reap", () => {
  const status = deriveBoundedProcessByteStatusForTesting({
    spawned: false,
    spawnErrorObserved: true,
    exitObserved: false,
    exitCode: null,
    exitSignal: null,
    closeObserved: true,
    closeCode: -2,
    closeSignal: null,
    stdoutEof: false,
    stderrEof: false,
  });

  assert.equal(status.noChild, true);
  assert.equal(status.reaped, false);
  assert.equal(status.statusAgreement, false);
  assert.equal(status.directChildCleanupSafe, true);
});

test("raw bounded process rejects proxies and accessors without observing them", () => {
  let observations = 0;
  const explosive = () => {
    observations += 1;
    throw new Error("must not observe caller code");
  };
  const proxy = new Proxy({}, { get: explosive, ownKeys: explosive });

  assert.throws(() => runBoundedProcessBytes(proxy), /plain own-data record/u);
  assert.throws(
    () => runBoundedProcessBytes(request({ args: proxy })),
    /arguments must be a plain dense array/u,
  );
  assert.throws(
    () => runBoundedProcessBytes(request({ environment: proxy })),
    /environment must be a plain own-data record/u,
  );
  assert.throws(
    () =>
      runBoundedProcessBytes(
        request({ inheritedFileDescriptors: proxy }),
      ),
    /inherited file descriptors must be a plain dense array/u,
  );

  const withGetter = request();
  Object.defineProperty(withGetter, "timeoutMs", {
    enumerable: true,
    get: explosive,
  });
  assert.throws(
    () => runBoundedProcessBytes(withGetter),
    /timeoutMs must be an own data property/u,
  );

  const environmentWithGetter = { ...environment };
  Object.defineProperty(environmentWithGetter, "EXPLOSIVE", {
    enumerable: true,
    get: explosive,
  });
  assert.throws(
    () =>
      runBoundedProcessBytes(
        request({ environment: environmentWithGetter }),
      ),
    /environment property EXPLOSIVE must be data/u,
  );

  const proxiedSignal = new Proxy(new AbortController().signal, {
    get: explosive,
  });
  assert.throws(
    () => runBoundedProcessBytes(request({ signal: proxiedSignal })),
    /genuine native AbortSignal/u,
  );
  assert.equal(observations, 0);
});

test("raw bounded process rejects unknown input fields", () => {
  assert.throws(
    () => runBoundedProcessBytes(request({ killProcess: process.kill })),
    /unexpected property: killProcess/u,
  );
});
