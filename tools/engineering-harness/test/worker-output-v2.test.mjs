import assert from "node:assert/strict";
import test from "node:test";

import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";
import { validateWorkerOutputV2 } from "../src/policy/worker-output-v2.mjs";

const output = () => ({
  summary: "bounded exact-create candidate",
  patch: null,
  creations: [
    {
      path: "lib/oxigraph/src/store/semantic_changes.rs",
      content: "pub struct SemanticChange;\n",
    },
  ],
  findings: [],
  verdict: "ACCEPT",
});

function reconstructionFault(error) {
  return (
    error instanceof TaskV2Failure &&
    error.code === "ERR_RECONSTRUCTION" &&
    error.terminal === true &&
    error.retryAllowed === false
  );
}

test("v2 worker output preserves exact structured creation content", () => {
  const source = output();
  const validated = validateWorkerOutputV2(source, "implementation");
  assert.deepEqual(validated, source);
  assert.equal(validated.creations[0].content, source.creations[0].content);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.creations), true);
  assert.equal(Object.isFrozen(validated.creations[0]), true);
});

test("v2 worker output keeps role authority exact", () => {
  assert.deepEqual(
    validateWorkerOutputV2(
      {
        ...output(),
        patch: null,
        creations: [],
      },
      "review",
    ),
    {
      ...output(),
      patch: null,
      creations: [],
    },
  );
  for (const invalid of [
    { role: "review", value: output() },
    {
      role: "architecture",
      value: { ...output(), patch: "diff --git x x\n", creations: [] },
    },
    {
      role: "repair",
      value: { ...output(), patch: null, creations: [] },
    },
    {
      role: "implementation",
      value: { ...output(), verdict: "INCONCLUSIVE" },
    },
    {
      role: "implementation",
      value: { ...output(), patch: "", creations: [] },
    },
  ]) {
    assert.throws(
      () => validateWorkerOutputV2(invalid.value, invalid.role),
      reconstructionFault,
    );
  }
  assert.deepEqual(
    validateWorkerOutputV2(
      { ...output(), patch: null, creations: [], verdict: "INCONCLUSIVE" },
      "implementation",
    ),
    { ...output(), patch: null, creations: [], verdict: "INCONCLUSIVE" },
  );
});

test("v2 worker output rejects extra, hidden, symbolic, sparse, and accessor authority without getters", () => {
  const extra = output();
  extra.authority = true;
  assert.throws(
    () => validateWorkerOutputV2(extra, "implementation"),
    reconstructionFault,
  );

  const hidden = output();
  Object.defineProperty(hidden.creations, "hidden", { value: true });
  assert.throws(
    () => validateWorkerOutputV2(hidden, "implementation"),
    reconstructionFault,
  );

  const symbolic = output();
  symbolic.findings[Symbol("authority")] = "hidden";
  assert.throws(
    () => validateWorkerOutputV2(symbolic, "implementation"),
    reconstructionFault,
  );

  const sparse = output();
  sparse.creations.length = 2;
  assert.throws(
    () => validateWorkerOutputV2(sparse, "implementation"),
    reconstructionFault,
  );

  const accessor = output();
  let getterCalls = 0;
  Object.defineProperty(accessor.creations[0], "content", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "attacker\n";
    },
  });
  assert.throws(
    () => validateWorkerOutputV2(accessor, "implementation"),
    reconstructionFault,
  );
  assert.equal(getterCalls, 0);

  let proxyLengthReads = 0;
  const proxiedCreations = new Proxy(output().creations, {
    get(target, property, receiver) {
      if (property === "length") proxyLengthReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () =>
      validateWorkerOutputV2(
        { ...output(), creations: proxiedCreations },
        "implementation",
      ),
    reconstructionFault,
  );
  assert.equal(proxyLengthReads, 0);
});

test("v2 worker output enforces byte ceilings, exact UTF-8, paths, and verdicts", () => {
  const invalid = [
    { ...output(), summary: "a".repeat(4097) },
    { ...output(), patch: "a".repeat(262_145) },
    {
      ...output(),
      creations: [{ ...output().creations[0], path: "../escape.rs" }],
    },
    {
      ...output(),
      creations: [{ ...output().creations[0], path: `a${"b".repeat(4096)}` }],
    },
    {
      ...output(),
      creations: [{ ...output().creations[0], content: "\ud800" }],
    },
    { ...output(), findings: ["a".repeat(2049)] },
    { ...output(), verdict: "PROMOTE" },
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateWorkerOutputV2(value, "implementation"),
      reconstructionFault,
    );
  }
});

test("v2 worker output failures expose only the fixed terminal public shape", () => {
  let failure;
  try {
    validateWorkerOutputV2(
      { ...output(), verdict: "PROMOTE" },
      "implementation",
    );
  } catch (error) {
    failure = error;
  }
  assert.equal(reconstructionFault(failure), true);
  assert.deepEqual(Object.keys(failure).sort(), [
    "code",
    "detailSha256",
    "publicMessage",
    "retryAllowed",
    "terminal",
  ]);
  assert.equal(failure.message, "engineering task v2 failed closed");
  assert.equal(
    failure.stack,
    "TaskV2Failure: engineering task v2 failed closed",
  );
  assert.match(failure.detailSha256, /^[0-9a-f]{64}$/u);
});
