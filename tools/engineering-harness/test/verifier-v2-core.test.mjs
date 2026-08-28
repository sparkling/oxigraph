import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../src/routing/features.mjs";
import {
  classifyCandidateVerificationV2ForTesting,
  classifyTrustedCandidateVerificationV2,
} from "../src/candidate/verifier-v2-core.mjs";

const digest = (value) =>
  createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"))
    .digest("hex");

const candidate = Object.freeze({
  schemaVersion: 2,
  contractSha256: "a".repeat(64),
  evaluatorPatchSha256: "b".repeat(64),
  patchSha256: "c".repeat(64),
  commit: "d".repeat(40),
  tree: "e".repeat(40),
  pathStatuses: Object.freeze([
    Object.freeze({ path: "src/change.rs", status: "M" }),
    Object.freeze({ path: "src/new.rs", status: "A" }),
  ]),
  createdBlobs: Object.freeze([
    Object.freeze({
      path: "src/new.rs",
      mode: "100644",
      type: "blob",
      objectId: "f".repeat(40),
      contentSha256: "1".repeat(64),
    }),
  ]),
  manifests: Object.freeze({
    full: Object.freeze({ entries: 12, sha256: "2".repeat(64) }),
    protected: Object.freeze({ entries: 10, sha256: "3".repeat(64) }),
  }),
});

const contract = Object.freeze({
  verificationSequence: Object.freeze(["format", "build", "public"]),
  commands: Object.freeze({
    format: Object.freeze({
      argv: Object.freeze(["cargo", "fmt", "--check"]),
      timeoutMs: 1000,
    }),
    build: Object.freeze({
      argv: Object.freeze(["cargo", "test", "--no-run"]),
      timeoutMs: 1000,
    }),
    public: Object.freeze({
      argv: Object.freeze(["cargo", "test", "--test", "public"]),
      timeoutMs: 1000,
    }),
  }),
  success: Object.freeze({ publicPassed: 7 }),
});

function command(role, { exitCode = 0, observedPassed = null } = {}) {
  return Object.freeze({
    role,
    disposition: "completed",
    exitCode,
    signal: null,
    stdoutSha256: digest(`${role}:stdout`),
    stderrSha256: digest(`${role}:stderr`),
    observedPassed,
    stdoutTailBase64: Buffer.from("secret-output-token", "utf8").toString(
      "base64",
    ),
    stderrTailBase64: "",
  });
}

function report({
  containment = "verified",
  status = "completed",
  stage = "complete",
  failure = null,
  commands = [
    command("format"),
    command("build"),
    command("public", { observedPassed: 7 }),
  ],
} = {}) {
  return Object.freeze({
    invocation: Object.freeze({
      containment,
      configurationSha256: "4".repeat(64),
    }),
    process: Object.freeze({
      disposition: "completed",
      exitCode: 0,
      signal: null,
    }),
    resultSha256: "5".repeat(64),
    resultBytes: 4096,
    cleanupSafe: true,
    session: Object.freeze({
      schemaVersion: 2,
      configurationSha256: "4".repeat(64),
      status,
      stage,
      commandCount: commands.length,
      commands: Object.freeze(commands),
      artifacts: Object.freeze([
        Object.freeze({
          name: "public-0123456789abcdef",
          sha256: "6".repeat(64),
          bytes: 8192,
          mode: 0o755,
        }),
      ]),
      stateBytes: 16384,
      failure,
    }),
  });
}

function classify(sessionReport) {
  return classifyCandidateVerificationV2ForTesting({
    candidate,
    contract,
    report: sessionReport,
  });
}

test("v2 classifier accepts only typed green evidence under verified containment", () => {
  const result = classify(report());
  assert.equal(result.schema, "oxigraph.engineering-candidate-verification/v2");
  assert.equal(result.verdict, "ACCEPT");
  assert.equal(result.stage, "complete");
  assert.equal(result.reason, "all-predicates-satisfied");
  assert.strictEqual(result.candidate, candidate);
  assert.deepEqual(
    result.commands.map(({ role, observedPassed }) => ({
      role,
      observedPassed,
    })),
    [
      { role: "format", observedPassed: null },
      { role: "build", observedPassed: null },
      { role: "public", observedPassed: 7 },
    ],
  );
  assert.match(result.projectionSha256, /^[0-9a-f]{64}$/u);
  const { projectionSha256, ...projection } = result;
  assert.equal(projectionSha256, digest(canonicalJson(projection)));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /secret-output-token/u);
  assert.doesNotMatch(serialized, /stdoutTailBase64|stderrTailBase64|argv/u);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.commands), true);
  assert.equal(Object.isFrozen(result.commands[0]), true);
});

test("v2 classifier separates safe product rejection from infrastructure", () => {
  const cases = [
    {
      name: "format product failure",
      value: report({
        stage: "format",
        commands: [command("format", { exitCode: 1 })],
      }),
      verdict: "REJECT",
      stage: "format",
      reason: "command-failed",
    },
    {
      name: "build product failure",
      value: report({
        stage: "build",
        commands: [command("format"), command("build", { exitCode: 101 })],
      }),
      verdict: "REJECT",
      stage: "build",
      reason: "command-failed",
    },
    {
      name: "typed evaluator mismatch",
      value: report({
        commands: [
          command("format"),
          command("build"),
          command("public", { observedPassed: 6 }),
        ],
      }),
      verdict: "REJECT",
      stage: "public",
      reason: "success-predicate-mismatch",
    },
    {
      name: "unproved containment",
      value: report({ containment: "unproved" }),
      verdict: "INCONCLUSIVE",
      stage: "infrastructure",
      reason: "containment-unproved",
    },
    {
      name: "worker infrastructure failure",
      value: report({
        status: "failed",
        stage: "public",
        failure: "PROCESS_PROOF",
        commands: [command("format"), command("build")],
      }),
      verdict: "INCONCLUSIVE",
      stage: "infrastructure",
      reason: "worker-infrastructure",
    },
  ];
  for (const fixture of cases) {
    const result = classify(fixture.value);
    assert.equal(result.verdict, fixture.verdict, fixture.name);
    assert.equal(result.stage, fixture.stage, fixture.name);
    assert.equal(result.reason, fixture.reason, fixture.name);
  }
});

test("v2 classifier rejects command order and impossible typed observations", () => {
  for (const commands of [
    [command("build")],
    [command("format", { observedPassed: 1 }), command("build")],
    [command("format"), command("build"), command("public")],
    [
      command("format"),
      command("build"),
      command("public", { exitCode: 1, observedPassed: 7 }),
    ],
  ]) {
    assert.throws(() => classify(report({ commands })), /v2 verification/u);
  }
});

test("v2 trusted classifier rejects unbranded, cloned, and proxied reports", () => {
  const unbranded = report();
  for (const sessionReport of [
    unbranded,
    structuredClone(unbranded),
    new Proxy(unbranded, {}),
  ]) {
    assert.throws(
      () =>
        classifyTrustedCandidateVerificationV2({
          candidate,
          contract,
          report: sessionReport,
        }),
      /production trust brand/u,
    );
  }
});
