import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_V2_FAILURE_CLASSIFICATION,
  TASK_V2_FAILURE_CODES,
  TASK_V2_PUBLIC_FAILURE_MESSAGE,
  TaskV2Failure,
  mapTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "../src/policy/task-v2-failures.mjs";

const EXPECTED_CODES = [
  "ERR_CONTRACT_SCHEMA_OR_KEYS",
  "ERR_PATH_INVALID",
  "ERR_PATH_OVERLAP",
  "ERR_PATH_COLLISION",
  "ERR_PARENT_TREE",
  "ERR_BASELINE_STATE",
  "ERR_OBJECT_TYPE",
  "ERR_PATCH_CANONICAL",
  "ERR_PATCH_CEILING",
  "ERR_CANDIDATE_STATUS",
  "ERR_PROTECTED_MANIFEST",
  "ERR_SOURCE_SNAPSHOT",
  "ERR_RECONSTRUCTION",
  "ERR_RECEIPT_REPLAY",
  "ERR_INTERNAL_FAIL_CLOSED",
];

test("task-v2 exports exactly the fifteen immutable terminal failure codes", () => {
  assert.deepEqual(TASK_V2_FAILURE_CODES, EXPECTED_CODES);
  assert.equal(Object.isFrozen(TASK_V2_FAILURE_CODES), true);
  assert.equal(Object.isFrozen(TASK_V2_FAILURE_CLASSIFICATION), true);
  assert.deepEqual(Object.keys(TASK_V2_FAILURE_CLASSIFICATION), EXPECTED_CODES);
  for (const code of EXPECTED_CODES) {
    assert.deepEqual(TASK_V2_FAILURE_CLASSIFICATION[code], {
      terminal: true,
      retryAllowed: false,
    });
    assert.equal(Object.isFrozen(TASK_V2_FAILURE_CLASSIFICATION[code]), true);
  }
  assert.throws(() => TASK_V2_FAILURE_CODES.push("ERR_MORE"), TypeError);
  assert.throws(() => {
    TASK_V2_FAILURE_CLASSIFICATION.ERR_PATH_INVALID.retryAllowed = true;
  }, TypeError);
});

test("every typed failure has only the fixed sanitized public projection", () => {
  for (const code of EXPECTED_CODES) {
    const secret = `/home/operator/private/${code}\ncommand stderr: token=secret`;
    const failure = taskV2Failure(code, secret);
    assert.equal(failure instanceof TaskV2Failure, true);
    assert.equal(failure.message, TASK_V2_PUBLIC_FAILURE_MESSAGE);
    assert.deepEqual(Object.keys(failure), [
      "code",
      "publicMessage",
      "terminal",
      "retryAllowed",
      "detailSha256",
    ]);
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(failure).map((key) => [key, failure[key]]),
      ),
      {
        code,
        publicMessage: TASK_V2_PUBLIC_FAILURE_MESSAGE,
        terminal: true,
        retryAllowed: false,
        detailSha256: failure.detailSha256,
      },
    );
    assert.match(failure.detailSha256, /^[0-9a-f]{64}$/u);
    assert.equal(Object.isFrozen(failure), true);
    assert.doesNotMatch(failure.stack, /operator|stderr|secret/u);
    assert.doesNotMatch(JSON.stringify(failure), /operator|stderr|secret/u);
    assert.equal(Object.hasOwn(failure, "cause"), false);
  }
  assert.throws(
    () => taskV2Failure("ERR_NOT_IN_THE_TAXONOMY", "detail"),
    TypeError,
  );
});

test("unknown failures map once to internal fail-closed without remapping typed errors", async () => {
  const typed = taskV2Failure("ERR_PATH_INVALID", "bad path");
  assert.equal(mapTaskV2Failure(typed), typed);

  const unknown = new Error(
    "/private/worktree/file: command output that must remain private",
  );
  const first = mapTaskV2Failure(unknown);
  const second = mapTaskV2Failure(unknown);
  assert.equal(first.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.equal(first.detailSha256, second.detailSha256);
  assert.doesNotMatch(JSON.stringify(first), /private|command output/u);

  const spoofed = Object.freeze({
    code: "ERR_PATH_INVALID",
    message: "pretend this is a trusted typed failure",
  });
  assert.equal(mapTaskV2Failure(spoofed).code, "ERR_INTERNAL_FAIL_CLOSED");

  const prototypeSpoof = Object.create(TaskV2Failure.prototype);
  prototypeSpoof.code = "ERR_PATH_INVALID";
  prototypeSpoof.secret = "/private/path stderr token";
  const mappedPrototypeSpoof = mapTaskV2Failure(prototypeSpoof);
  assert.equal(mappedPrototypeSpoof.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.notEqual(mappedPrototypeSpoof, prototypeSpoof);
  assert.doesNotMatch(JSON.stringify(mappedPrototypeSpoof), /private|token/u);

  const proxiedTyped = new Proxy(typed, {});
  const mappedProxy = mapTaskV2Failure(proxiedTyped);
  assert.equal(mappedProxy.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.notEqual(mappedProxy, proxiedTyped);

  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("/private/prototype trap token");
      },
    },
  );
  const mappedHostileProxy = mapTaskV2Failure(hostileProxy);
  assert.equal(mappedHostileProxy.code, "ERR_INTERNAL_FAIL_CLOSED");
  assert.doesNotMatch(
    JSON.stringify(mappedHostileProxy),
    /private|trap|token/u,
  );

  let synchronousAttempts = 0;
  assert.throws(
    () =>
      withTaskV2FailureBoundary(() => {
        synchronousAttempts += 1;
        throw unknown;
      }),
    (error) => error.code === "ERR_INTERNAL_FAIL_CLOSED",
  );
  assert.equal(synchronousAttempts, 1);

  let asynchronousAttempts = 0;
  await assert.rejects(
    withTaskV2FailureBoundary(async () => {
      asynchronousAttempts += 1;
      throw typed;
    }),
    (error) => error === typed,
  );
  assert.equal(asynchronousAttempts, 1);
});

test("the one-attempt boundary preserves successful synchronous and asynchronous values", async () => {
  const value = Object.freeze({ accepted: true });
  assert.equal(
    withTaskV2FailureBoundary(() => value),
    value,
  );
  assert.equal(await withTaskV2FailureBoundary(async () => value), value);
});
