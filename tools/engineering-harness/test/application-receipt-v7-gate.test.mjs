import assert from "node:assert/strict";
import test from "node:test";

import {
  isTaskV2Failure,
  TASK_V2_PUBLIC_FAILURE_MESSAGE,
} from "../src/policy/task-v2-failures.mjs";
import { createApplicationReceiptV7PostGateReplayForTesting } from "../src/runtime/application-receipt-v7-replay.mjs";

const gateRequest = Object.freeze({ testOnly: "post-gate-v7-replay" });

function replayFailure(error) {
  assert.equal(isTaskV2Failure(error), true);
  assert.equal(error.code, "ERR_RECEIPT_REPLAY");
  assert.equal(error.message, TASK_V2_PUBLIC_FAILURE_MESSAGE);
  assert.equal(error.stack, `TaskV2Failure: ${TASK_V2_PUBLIC_FAILURE_MESSAGE}`);
  assert.equal(error.terminal, true);
  assert.equal(error.retryAllowed, false);
  return true;
}

function operations(authorize, effects = []) {
  const blocked = (name) => () => {
    effects.push(name);
    throw new Error(`${name} must remain unreachable`);
  };
  return {
    authorize,
    parseContract: blocked("parseContract"),
    realpath: blocked("realpath"),
    acquireTemporaryRoot: blocked("acquireTemporaryRoot"),
    describeTemporaryRoot: blocked("describeTemporaryRoot"),
    createGitHome: blocked("createGitHome"),
    verifyRepository: blocked("verifyRepository"),
    loadTree: blocked("loadTree"),
    readBlob: blocked("readBlob"),
    createContext: blocked("createContext"),
    assertSealedContext: blocked("assertSealedContext"),
    reconstructCandidate: blocked("reconstructCandidate"),
    disposeCandidate: blocked("disposeCandidate"),
    releaseTemporaryRoot: blocked("releaseTemporaryRoot"),
  };
}

function hostileDeferredOptions() {
  let traps = 0;
  const value = new Proxy(
    {},
    {
      get() {
        traps += 1;
        throw new Error("deferred input was inspected");
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("deferred input was inspected");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("deferred input was inspected");
      },
      ownKeys() {
        traps += 1;
        throw new Error("deferred input was inspected");
      },
    },
  );
  return Object.freeze({ value, traps: () => traps });
}

test("exact unavailable gate returns before deferred options or effects", () => {
  const effects = [];
  const controller = createApplicationReceiptV7PostGateReplayForTesting(
    operations(
      () =>
        Object.freeze({
          status: "unavailable",
          reason: "native-adapter-unavailable",
        }),
      effects,
    ),
  );
  const hostile = hostileDeferredOptions();

  const result = controller.replay(gateRequest, hostile.value);
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(hostile.traps(), 0);
  assert.deepEqual(effects, []);
});

test("caller-forged, asynchronous, malformed, and thrown gate results fail first", () => {
  const proxied = new Proxy(
    Object.freeze({ status: "verified", reason: "proxy" }),
    {},
  );
  const decisions = [
    () => Object.freeze({ status: "verified", reason: "caller-forged" }),
    () =>
      Promise.resolve(
        Object.freeze({
          status: "unavailable",
          reason: "native-adapter-unavailable",
        }),
      ),
    () => ({
      status: "unavailable",
      reason: "native-adapter-unavailable",
    }),
    () =>
      Object.freeze({
        status: "unavailable",
        reason: "native-adapter-unavailable",
        extra: true,
      }),
    () => proxied,
    () => undefined,
    () => {
      throw new Error("gate detail must not escape");
    },
  ];

  for (const decision of decisions) {
    const effects = [];
    const hostile = hostileDeferredOptions();
    const controller = createApplicationReceiptV7PostGateReplayForTesting(
      operations(decision, effects),
    );
    assert.throws(
      () => controller.replay(gateRequest, hostile.value),
      (error) => {
        replayFailure(error);
        assert.doesNotMatch(error.message, /gate detail|caller-forged/u);
        assert.doesNotMatch(error.stack, /gate detail|caller-forged/u);
        return true;
      },
    );
    assert.equal(hostile.traps(), 0);
    assert.deepEqual(effects, []);
  }
});

test("operation accessors and proxied functions are rejected without calls", () => {
  let getterCalls = 0;
  const accessor = operations(() => undefined);
  Object.defineProperty(accessor, "authorize", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => undefined;
    },
  });
  assert.throws(
    () => createApplicationReceiptV7PostGateReplayForTesting(accessor),
    /operations is invalid/u,
  );
  assert.equal(getterCalls, 0);

  const proxied = operations(() => undefined);
  proxied.realpath = new Proxy(proxied.realpath, {});
  assert.throws(
    () => createApplicationReceiptV7PostGateReplayForTesting(proxied),
    /must be functions/u,
  );

  const valid = operations(() => undefined);
  const { releaseTemporaryRoot: _omitted, ...missing } = valid;
  const symbolic = operations(() => undefined);
  Object.defineProperty(symbolic, Symbol("extra"), {
    enumerable: true,
    value: () => undefined,
  });
  const invalidRecords = [
    new Proxy(valid, {}),
    missing,
    { ...valid, extra() {} },
    Object.fromEntries(Object.entries(valid).reverse()),
    symbolic,
  ];
  for (const invalid of invalidRecords) {
    assert.throws(
      () => createApplicationReceiptV7PostGateReplayForTesting(invalid),
      /operations is invalid/u,
    );
  }
});
