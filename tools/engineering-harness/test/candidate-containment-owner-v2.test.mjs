import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  candidateContainmentOwnerV2Readiness,
  createCandidateContainmentOwnerV2ForTesting,
  isCandidateContainmentV2Fault,
  isCandidateContainmentV2TestTrace,
  runCandidateContainmentOwnerV2,
} from "../src/candidate/containment-owner-v2.mjs";
import {
  isTrustedSandboxSessionV2Report,
  sandboxSessionV2ContainmentReadiness,
} from "../src/candidate/sandbox-session-v2.mjs";

const requestSha256 = "a".repeat(64);
const limits = Object.freeze({
  memoryMaxBytes: 8_589_934_592,
  memorySwapMaxBytes: 0,
  tasksMax: 512,
  wallMs: 2_700_000,
});

function input() {
  return {
    requestSha256,
    limits,
    signal: undefined,
  };
}

function acquired(
  generationSha256,
  resource = Object.freeze({ kind: "test-cgroup" }),
) {
  return {
    resource,
    generation: {
      source: "owner-random-256",
      sha256: generationSha256,
      fresh: true,
      reusable: false,
      exclusiveAdmission: true,
    },
    cgroup: {
      filesystem: "cgroup2",
      descriptorHeld: true,
      accessMode: "O_RDONLY|O_DIRECTORY|O_CLOEXEC",
      type: "domain\n",
      initialProcs: "",
    },
    readback: {
      memoryMax: `${limits.memoryMaxBytes}\n`,
      memorySwapMax: "0\n",
      pidsMax: `${limits.tasksMax}\n`,
    },
  };
}

function spawned(child = Object.freeze({ kind: "test-pidfd-child" })) {
  return {
    child,
    placement: {
      syscall: "clone3",
      cloneArgsSize: 88,
      flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
      exitSignal: "SIGCHLD",
      cgroupFdHeld: true,
      pidfdHeld: true,
      initialPlacement: true,
      fallbackUsed: false,
    },
  };
}

function mechanics(overrides = {}) {
  const calls = [];
  const resource = Object.freeze({ kind: "test-cgroup" });
  const child = Object.freeze({ kind: "test-pidfd-child" });
  const defaults = {
    async acquire(request) {
      return acquired(request.generationSha256, resource);
    },
    async spawn() {
      return spawned(child);
    },
    async wait() {
      return {
        mechanism: "pidfd-poll",
        bounded: true,
        pidfdReadable: true,
      };
    },
    async terminate() {
      return { mechanism: "cgroup.kill", cgroupKillWritten: true };
    },
    async reap() {
      return {
        syscall: "waitid",
        idType: "P_PIDFD",
        options: ["WEXITED"],
        result: "REAPED",
        siCode: "CLD_EXITED",
        exitCode: 0,
        signal: null,
        coreDumped: false,
      };
    },
    async observeTerminal() {
      return {
        cgroupProcs: "",
        cgroupEvents: "populated 0\nfrozen 0\n",
        pidsCurrent: "0\n",
      };
    },
    async cleanup() {
      return {
        cgroupRemoved: true,
        postCleanupOpen: "ENOENT",
        postCleanupStat: "ENOENT",
      };
    },
    async close({ child: ownedChild }) {
      return {
        cgroupFdClosed: true,
        pidfdClosed: ownedChild === undefined ? null : true,
      };
    },
    ...overrides,
  };
  const wrapped = Object.fromEntries(
    Object.entries(defaults).map(([name, implementation]) => [
      name,
      async (value) => {
        calls.push(name);
        return implementation(value);
      },
    ]),
  );
  return { calls, mechanics: wrapped };
}

test("candidate containment production owner is fixed unavailable without invoking mechanics", async () => {
  const readiness = candidateContainmentOwnerV2Readiness();
  assert.deepEqual(readiness, {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.equal(Object.isFrozen(readiness), true);
  assert.strictEqual(sandboxSessionV2ContainmentReadiness(), readiness);

  await assert.rejects(runCandidateContainmentOwnerV2(input()), (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.phase, "preflight");
    assert.equal(error.reason, "native-adapter-unavailable");
    assert.equal(error.cleanupSafe, true);
    assert.deepEqual(error.lifecycle, ["NEW"]);
    return true;
  });
});

test("candidate containment test owner proves the exact successful lifecycle without minting production authority", async () => {
  const fixture = mechanics();
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );
  const trace = await controller.run(input());

  assert.deepEqual(fixture.calls, [
    "acquire",
    "spawn",
    "wait",
    "reap",
    "observeTerminal",
    "cleanup",
    "close",
  ]);
  assert.deepEqual(trace.lifecycle, [
    "NEW",
    "ACQUIRING",
    "ACQUIRED_EMPTY_CONFIGURED",
    "CLONE_COMMIT_STARTED",
    "SPAWN_COMMITTED",
    "RUNNING",
    "DIRECT_CHILD_REAPED",
    "CGROUP_QUIESCENT",
    "CLEANING",
    "CGROUP_REMOVED",
    "DESCRIPTORS_CLOSED",
    "CLOSED",
  ]);
  assert.equal(trace.schema, "oxigraph.candidate-containment-test-trace/v1");
  assert.equal(trace.containment, "simulated");
  assert.equal(trace.productionAuthority, false);
  assert.equal(trace.cleanupSafe, true);
  assert.equal(Object.hasOwn(trace, "classification"), false);
  assert.match(trace.ownerRequestSha256, /^[0-9a-f]{64}$/u);
  assert.equal(trace.acquisition.generation.source, "owner-random-256");
  assert.equal(trace.acquisition.generation.fresh, true);
  assert.equal(trace.acquisition.generation.reusable, false);
  assert.equal(trace.acquisition.generation.exclusiveAdmission, true);
  assert.deepEqual(trace.placement.flags, ["CLONE_INTO_CGROUP", "CLONE_PIDFD"]);
  assert.equal(trace.placement.cloneArgsSize, 88);
  assert.equal(trace.placement.exitSignal, "SIGCHLD");
  assert.equal(trace.supervision.wait.mechanism, "pidfd-poll");
  assert.equal(trace.supervision.wait.bounded, true);
  assert.equal(trace.supervision.reap.syscall, "waitid");
  assert.equal(trace.supervision.reap.idType, "P_PIDFD");
  assert.deepEqual(trace.supervision.reap.options, ["WEXITED"]);
  assert.equal(trace.terminal.cgroupProcsEmpty, true);
  assert.equal(trace.terminal.cgroupPopulated, false);
  assert.equal(trace.terminal.pidsCurrent, 0);
  assert.equal(isCandidateContainmentV2TestTrace(trace), true);
  assert.equal(isTrustedSandboxSessionV2Report(trace), false);
  assert.equal(controller.retainedStateCountForTesting(), 0);
  assert.equal(Object.isFrozen(trace), true);
});

test("candidate containment input and test mechanics reject authority-shaped objects", async () => {
  const fixture = mechanics();
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );
  await assert.rejects(
    controller.run({ ...input(), expectedContainment: true }),
    /input/u,
  );
  assert.deepEqual(fixture.calls, []);

  assert.throws(
    () => createCandidateContainmentOwnerV2ForTesting(new Proxy({}, {})),
    /mechanics/u,
  );
  const accessorMechanics = mechanics().mechanics;
  Object.defineProperty(accessorMechanics, "spawn", {
    enumerable: true,
    get() {
      throw new Error("must not invoke a mechanics getter");
    },
  });
  assert.throws(
    () => createCandidateContainmentOwnerV2ForTesting(accessorMechanics),
    /mechanics/u,
  );
});

test("candidate containment cleans a proven child-free resource after limit readback mismatch", async () => {
  const fixture = mechanics({
    async acquire(request) {
      const value = acquired(request.generationSha256);
      value.readback.memoryMax = "max\n";
      return value;
    },
  });
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );

  await assert.rejects(controller.run(input()), (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.phase, "acquire");
    assert.equal(error.cleanupSafe, true);
    assert.deepEqual(error.lifecycle, [
      "NEW",
      "ACQUIRING",
      "ACQUIRED_EMPTY_CONFIGURED",
      "CLEANING",
      "CGROUP_REMOVED",
      "DESCRIPTORS_CLOSED",
      "CLOSED",
    ]);
    return true;
  });
  assert.deepEqual(fixture.calls, ["acquire", "cleanup", "close"]);
  assert.equal(controller.retainedStateCountForTesting(), 0);
});

test("candidate containment never cleans an acquisition whose cgroup identity or empty membership is unproved", async () => {
  for (const mutate of [
    (value) => {
      value.cgroup.filesystem = "tmpfs";
    },
    (value) => {
      value.cgroup.initialProcs = "4242\n";
    },
    (value) => {
      value.generation.fresh = false;
    },
  ]) {
    const fixture = mechanics({
      async acquire(request) {
        const value = acquired(request.generationSha256);
        mutate(value);
        return value;
      },
    });
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.phase, "acquire");
      assert.equal(error.cleanupSafe, false);
      assert.equal(error.lifecycle.at(-1), "FAILED_RETAINED");
      return true;
    });
    assert.deepEqual(fixture.calls, ["acquire"]);
    assert.equal(controller.retainedStateCountForTesting(), 1);
  }
});

test("candidate containment retains all authority when clone commitment is uncertain", async () => {
  const fixture = mechanics({
    async spawn() {
      throw new Error("injected clone3 uncertainty");
    },
  });
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );

  await assert.rejects(controller.run(input()), (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.phase, "spawn");
    assert.equal(error.cleanupSafe, false);
    assert.equal(error.lifecycle.at(-1), "FAILED_RETAINED");
    return true;
  });
  assert.deepEqual(fixture.calls, ["acquire", "spawn"]);
  assert.equal(controller.retainedStateCountForTesting(), 1);
});

test("candidate containment terminates the whole cgroup then reaps and cleans after wait failure", async () => {
  const fixture = mechanics({
    async wait() {
      throw new Error("injected timeout");
    },
  });
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );

  await assert.rejects(controller.run(input()), (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.phase, "wait");
    assert.equal(error.reason, "child-wait-failed");
    assert.equal(error.cleanupSafe, true);
    assert.equal(error.lifecycle.at(-1), "CLOSED");
    return true;
  });
  assert.deepEqual(fixture.calls, [
    "acquire",
    "spawn",
    "wait",
    "terminate",
    "reap",
    "observeTerminal",
    "cleanup",
    "close",
  ]);
  assert.equal(controller.retainedStateCountForTesting(), 0);
});

test("candidate containment never destroys or closes after reap or quiescence uncertainty", async () => {
  for (const [method, replacement, expectedCalls] of [
    [
      "reap",
      async () => {
        throw new Error("injected waitid uncertainty");
      },
      ["acquire", "spawn", "wait", "reap"],
    ],
    [
      "observeTerminal",
      async () => ({
        cgroupProcs: "4242\n",
        cgroupEvents: "populated 1\nfrozen 0\n",
        pidsCurrent: "1\n",
      }),
      [
        "acquire",
        "spawn",
        "wait",
        "reap",
        "observeTerminal",
        "terminate",
        "observeTerminal",
      ],
    ],
  ]) {
    const fixture = mechanics({ [method]: replacement });
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.cleanupSafe, false);
      assert.equal(error.lifecycle.at(-1), "FAILED_RETAINED");
      return true;
    });
    assert.deepEqual(fixture.calls, expectedCalls);
    assert.equal(controller.retainedStateCountForTesting(), 1);
  }
});

test("candidate containment kills escaped descendants and re-observes terminal emptiness before cleanup", async () => {
  let observations = 0;
  const fixture = mechanics({
    async observeTerminal() {
      observations += 1;
      return observations === 1
        ? {
            cgroupProcs: "4242\n",
            cgroupEvents: "populated 1\nfrozen 0\n",
            pidsCurrent: "1\n",
          }
        : {
            cgroupProcs: "",
            cgroupEvents: "populated 0\nfrozen 0\n",
            pidsCurrent: "0\n",
          };
    },
  });
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );
  const trace = await controller.run(input());
  assert.deepEqual(fixture.calls, [
    "acquire",
    "spawn",
    "wait",
    "reap",
    "observeTerminal",
    "terminate",
    "observeTerminal",
    "cleanup",
    "close",
  ]);
  assert.equal(trace.lifecycle.includes("CANCELLING"), true);
  assert.equal(trace.cleanupSafe, true);
});

test("candidate containment retains ownership after destructive cleanup or descriptor-close uncertainty", async () => {
  for (const method of ["cleanup", "close"]) {
    const fixture = mechanics({
      [method]: async () => {
        throw new Error(`injected ${method} uncertainty`);
      },
    });
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.cleanupSafe, false);
      assert.equal(error.lifecycle.at(-1), "FAILED_RETAINED");
      return true;
    });
    assert.equal(controller.retainedStateCountForTesting(), 1);
    if (method === "cleanup")
      assert.equal(fixture.calls.includes("close"), false);
  }
});

test("candidate containment test capability is one-shot and rejects concurrent reuse", async () => {
  let release;
  const fixture = mechanics({
    wait: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            mechanism: "pidfd-poll",
            bounded: true,
            pidfdReadable: true,
          });
      }),
  });
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );
  const running = controller.run(input());
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(controller.run(input()), /already consumed/u);
  release();
  await running;
  await assert.rejects(controller.run(input()), /already consumed/u);
});

test("candidate containment bounds every never-settling mechanic and retains its pending authority", async () => {
  const pending = async () => new Promise(() => {});
  const cases = [
    ["acquire", { acquire: pending }, ["acquire"], "acquire"],
    ["spawn", { spawn: pending }, ["acquire", "spawn"], "spawn"],
    [
      "wait",
      { wait: pending },
      ["acquire", "spawn", "wait", "terminate"],
      "wait",
    ],
    [
      "terminate",
      {
        async wait() {
          throw new Error("enter cancellation");
        },
        terminate: pending,
      },
      ["acquire", "spawn", "wait", "terminate"],
      "terminate",
    ],
    ["reap", { reap: pending }, ["acquire", "spawn", "wait", "reap"], "reap"],
    [
      "observeTerminal",
      { observeTerminal: pending },
      ["acquire", "spawn", "wait", "reap", "observeTerminal"],
      "quiescence",
    ],
    [
      "cleanup",
      { cleanup: pending },
      ["acquire", "spawn", "wait", "reap", "observeTerminal", "cleanup"],
      "cleanup",
    ],
    [
      "close",
      { close: pending },
      [
        "acquire",
        "spawn",
        "wait",
        "reap",
        "observeTerminal",
        "cleanup",
        "close",
      ],
      "close",
    ],
  ];
  for (const [label, overrides, expectedCalls, phase] of cases) {
    const fixture = mechanics(overrides);
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
      { operationTimeoutMs: 20 },
    );
    const started = Date.now();
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true, label);
      assert.equal(error.phase, phase, label);
      assert.equal(error.cleanupSafe, false, label);
      return true;
    });
    assert.equal(Date.now() - started < 1000, true, label);
    assert.deepEqual(fixture.calls, expectedCalls, label);
    assert.equal(controller.retainedStateCountForTesting(), 1, label);
    assert.equal(controller.pendingOperationCountForTesting(), 1, label);
  }
});

test("candidate containment permanently retains late acquisition and clone authority after timeout", async () => {
  for (const method of ["acquire", "spawn"]) {
    let release;
    let lateValue;
    const fixture = mechanics({
      [method]: (request) =>
        new Promise((resolve) => {
          release = () => {
            lateValue =
              method === "acquire"
                ? acquired(request.generationSha256)
                : spawned();
            resolve(lateValue);
          };
        }),
    });
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
      { operationTimeoutMs: 20 },
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true, method);
      assert.equal(error.cleanupSafe, false, method);
      return true;
    });
    assert.deepEqual(controller.retainedOperationStatesForTesting(), [
      {
        method,
        boundaryWon: true,
        settled: false,
        outcome: "pending",
      },
    ]);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.pendingOperationCountForTesting(), 1, method);
    assert.equal(
      controller.hasRetainedOperationValueForTesting(lateValue),
      true,
      method,
    );
    assert.deepEqual(controller.retainedOperationStatesForTesting(), [
      {
        method,
        boundaryWon: true,
        settled: true,
        outcome: "fulfilled",
      },
    ]);
  }
});

test("candidate containment classifies every throwing mechanic without retry", async () => {
  const cases = [
    [
      "acquire",
      { acquire: async () => Promise.reject(new Error("acquire")) },
      false,
    ],
    ["spawn", { spawn: async () => Promise.reject(new Error("spawn")) }, false],
    ["wait", { wait: async () => Promise.reject(new Error("wait")) }, true],
    [
      "terminate",
      {
        wait: async () => Promise.reject(new Error("wait")),
        terminate: async () => Promise.reject(new Error("terminate")),
      },
      false,
    ],
    ["reap", { reap: async () => Promise.reject(new Error("reap")) }, false],
    [
      "quiescence",
      {
        observeTerminal: async () => Promise.reject(new Error("observe")),
      },
      false,
    ],
    [
      "cleanup",
      { cleanup: async () => Promise.reject(new Error("cleanup")) },
      false,
    ],
    ["close", { close: async () => Promise.reject(new Error("close")) }, false],
  ];
  for (const [phase, overrides, cleanupSafe] of cases) {
    const fixture = mechanics(overrides);
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true, phase);
      assert.equal(error.phase, phase, phase);
      assert.equal(error.cleanupSafe, cleanupSafe, phase);
      return true;
    });
    assert.equal(
      fixture.calls.filter((name) => name === phase).length <= 1,
      true,
      phase,
    );
  }
});

test("candidate containment owns pre-abort and wait-abort behavior", async () => {
  const preAborted = new AbortController();
  preAborted.abort();
  const preFixture = mechanics();
  const preController = createCandidateContainmentOwnerV2ForTesting(
    preFixture.mechanics,
  );
  await assert.rejects(
    preController.run({ ...input(), signal: preAborted.signal }),
    (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.phase, "preflight");
      assert.equal(error.reason, "already-aborted");
      assert.equal(error.cleanupSafe, true);
      return true;
    },
  );
  assert.deepEqual(preFixture.calls, []);

  const controllerAbort = new AbortController();
  const fixture = mechanics({
    async wait() {
      return new Promise(() => {});
    },
  });
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
    { operationTimeoutMs: 1000 },
  );
  const running = controller.run({
    ...input(),
    signal: controllerAbort.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controllerAbort.abort();
  await assert.rejects(running, (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.phase, "wait");
    assert.equal(error.reason, "child-wait-pending");
    assert.equal(error.cleanupSafe, false);
    return true;
  });
  assert.deepEqual(fixture.calls, ["acquire", "spawn", "wait", "terminate"]);
  assert.equal(controller.retainedStateCountForTesting(), 1);

  const beforeCloneAbort = new AbortController();
  const beforeCloneFixture = mechanics({
    async acquire(request) {
      beforeCloneAbort.abort();
      return acquired(request.generationSha256);
    },
  });
  const beforeCloneController = createCandidateContainmentOwnerV2ForTesting(
    beforeCloneFixture.mechanics,
  );
  await assert.rejects(
    beforeCloneController.run({
      ...input(),
      signal: beforeCloneAbort.signal,
    }),
    (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.phase, "cancel");
      assert.equal(error.reason, "aborted-before-clone");
      assert.equal(error.cleanupSafe, true);
      return true;
    },
  );
  assert.deepEqual(beforeCloneFixture.calls, ["acquire", "cleanup", "close"]);
});

test("candidate containment binds fixed task policy and all limits into its owner request", async () => {
  const changed = input();
  changed.limits = { ...limits, tasksMax: 513 };
  const fixture = mechanics();
  const controller = createCandidateContainmentOwnerV2ForTesting(
    fixture.mechanics,
  );
  await assert.rejects(controller.run(changed), /task limit/u);
  assert.deepEqual(fixture.calls, []);
});

test("candidate containment requires raw LF-exact cgroup limit readbacks", async () => {
  for (const readback of [
    { memoryMax: String(limits.memoryMaxBytes) },
    { memoryMax: "max\n" },
    { memorySwapMax: "0 \n" },
    { pidsMax: `${limits.tasksMax}\n${limits.tasksMax}\n` },
  ]) {
    const fixture = mechanics({
      async acquire(request) {
        const value = acquired(request.generationSha256);
        Object.assign(value.readback, readback);
        return value;
      },
    });
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.phase, "acquire");
      assert.equal(error.cleanupSafe, true);
      return true;
    });
    assert.deepEqual(fixture.calls, ["acquire", "cleanup", "close"]);
  }
});

test("candidate containment parses bounded cgroup events while rejecting malformed or duplicate rows", async () => {
  const validFixture = mechanics({
    async observeTerminal() {
      return {
        cgroupProcs: "",
        cgroupEvents: "frozen 0\npressure 7\npopulated 0\n",
        pidsCurrent: "0\n",
      };
    },
  });
  const validController = createCandidateContainmentOwnerV2ForTesting(
    validFixture.mechanics,
  );
  const trace = await validController.run(input());
  assert.match(trace.terminal.eventsRawSha256, /^[0-9a-f]{64}$/u);

  for (const cgroupEvents of [
    "populated 0\npopulated 0\n",
    "populated 0",
    "populated +0\n",
    "frozen 0\n",
    `${"x".repeat(4096)}\n`,
  ]) {
    const fixture = mechanics({
      async observeTerminal() {
        return { cgroupProcs: "", cgroupEvents, pidsCurrent: "0\n" };
      },
    });
    const controller = createCandidateContainmentOwnerV2ForTesting(
      fixture.mechanics,
    );
    await assert.rejects(controller.run(input()), (error) => {
      assert.equal(isCandidateContainmentV2Fault(error), true);
      assert.equal(error.phase, "quiescence");
      assert.equal(error.cleanupSafe, false);
      return true;
    });
    assert.equal(fixture.calls.includes("cleanup"), false);
  }
});

test("candidate containment admission permits sequential safe generations but blocks concurrent or retained attempts", async () => {
  const fixture = mechanics();
  const first = createCandidateContainmentOwnerV2ForTesting(fixture.mechanics);
  const firstTrace = await first.run(input());
  const second = createCandidateContainmentOwnerV2ForTesting(fixture.mechanics);
  const secondTrace = await second.run(input());
  assert.notEqual(
    firstTrace.acquisition.generation.sha256,
    secondTrace.acquisition.generation.sha256,
  );

  let release;
  const concurrentFixture = mechanics({
    wait: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            mechanism: "pidfd-poll",
            bounded: true,
            pidfdReadable: true,
          });
      }),
  });
  const active = createCandidateContainmentOwnerV2ForTesting(
    concurrentFixture.mechanics,
  );
  const contender = createCandidateContainmentOwnerV2ForTesting(
    concurrentFixture.mechanics,
  );
  const running = active.run(input());
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(contender.run(input()), (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.reason, "concurrent-admission-blocked");
    return true;
  });
  release();
  await running;

  const retainedFixture = mechanics({
    async spawn() {
      throw new Error("uncertain clone");
    },
  });
  const retained = createCandidateContainmentOwnerV2ForTesting(
    retainedFixture.mechanics,
  );
  await assert.rejects(retained.run(input()));
  const blocked = createCandidateContainmentOwnerV2ForTesting(
    retainedFixture.mechanics,
  );
  await assert.rejects(blocked.run(input()), (error) => {
    assert.equal(isCandidateContainmentV2Fault(error), true);
    assert.equal(error.reason, "retained-admission-blocked");
    return true;
  });
});

test("candidate containment owner has no qualification, G1.7, process-group, or systemd dependency", async () => {
  const source = await readFile(
    new URL("../src/candidate/containment-owner-v2.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /src\/qualification|\.\.\/qualification/u);
  assert.doesNotMatch(source, /g1\.7|G17|systemd-run|processGroup|kill\(-/u);
  assert.doesNotMatch(
    source,
    /node:child_process|\b(?:spawn|execFile|fork)\s*\(/u,
  );
});
