import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_OWNER_V2_SCHEMA,
  verifyG17BenchmarkBuildOwnerV2,
} from "../src/qualification/benchmark-owner-contract.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "../src/qualification/benchmark-execution-plan.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /G1\.7 benchmark owner contract/u;
const EXECUTABLE_PATH =
  "/state/target/release/deps/transactional_write-build-owner-v2";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function seal(unsigned) {
  const value = {
    ...structuredClone(unsigned),
    contentHash: canonicalSha256(unsigned),
  };
  return {
    value,
    bytes: Buffer.from(`${canonicalJson(value)}\n`, "utf8"),
  };
}

function cargoStdout(executablePath = EXECUTABLE_PATH) {
  return Buffer.from(
    `${JSON.stringify({
      reason: "compiler-artifact",
      package_id: "path+file:///workspace/source/lib/oxigraph#0.5.0",
      manifest_path: "/workspace/source/lib/oxigraph/Cargo.toml",
      target: {
        kind: ["bench"],
        crate_types: ["bin"],
        name: "transactional_write",
        src_path: "/workspace/source/lib/oxigraph/benches/transactional_write.rs",
        edition: "2021",
        doc: false,
        doctest: false,
        test: true,
      },
      profile: {
        opt_level: "3",
        debuginfo: 0,
        debug_assertions: false,
        overflow_checks: false,
        test: true,
      },
      features: [],
      filenames: [executablePath],
      executable: executablePath,
      fresh: false,
    })}\n${JSON.stringify({ reason: "build-finished", success: true })}\n`,
    "utf8",
  );
}

function fixture({
  buildIndex = 0,
  captureMode = "synthetic-test-only",
} = {}) {
  const plan = G17_BENCHMARK_BUILD_PLAN[buildIndex];
  const stdoutBytes = cargoStdout();
  const stderrBytes = Buffer.from("reviewed warning\n", "utf8");
  const executableBytes = Buffer.from("\u007fELF-v2-fixture", "utf8");
  const authorization = {
    rawSha256: "a".repeat(64),
    contentHash: "b".repeat(64),
  };
  const workspaceOwner = {
    rawSha256: "c".repeat(64),
    contentHash: "d".repeat(64),
  };
  const result = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: { bytes: stdoutBytes.length, sha256: sha256(stdoutBytes) },
    stderr: { bytes: stderrBytes.length, sha256: sha256(stderrBytes) },
  };
  const unsigned = {
    schema: G17_BENCHMARK_BUILD_OWNER_V2_SCHEMA,
    controlRunId: "build-owner-v2-fixture",
    authorization,
    executionPlan: {
      schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
      sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipe: {
        schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
        sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      },
    },
    buildId: plan.buildId,
    productRole: plan.productRole,
    workspaceOwner,
    command: {
      program: G17_BENCHMARK_BUILD_PROGRAM,
      argv: structuredClone(G17_BENCHMARK_BUILD_ARGV),
      environment: structuredClone(G17_BENCHMARK_BUILD_ENVIRONMENT),
      environmentSha256: G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
      cwd: G17_BENCHMARK_EXECUTION_PLAN.build.workingDirectory,
      targetDirectory: G17_BENCHMARK_EXECUTION_PLAN.build.targetDirectory,
      ordinal: buildIndex + 1,
    },
    supervision: {
      processGeneration: `g17-process-${String(buildIndex + 1).padStart(2, "0")}`,
      captureMode,
      spawned: true,
      disposition: "completed",
      reaped: true,
      exit: { observed: true, exitCode: 0, signal: null },
      close: { observed: true, exitCode: 0, signal: null },
      stdoutEofObserved: true,
      stderrEofObserved: true,
      captureComplete: true,
      outputTruncated: false,
      statusAgreement: true,
    },
    result,
    executable: {
      logicalPath: EXECUTABLE_PATH,
      bytes: executableBytes.length,
      sha256: sha256(executableBytes),
    },
    authority: {
      buildExecutionAuthority: false,
      launchExecutionAuthority: false,
      controlExecutionAuthority: false,
      qualificationExecutionAuthority: false,
      receiptAuthority: false,
      promotionAuthority: false,
      publicationAuthority: false,
      routerQualityAuthority: false,
      providerExecutionAuthority: false,
    },
    binding: null,
    finalDecisionEligible: false,
  };
  const sealed = seal(unsigned);
  return {
    input: {
      bytes: sealed.bytes,
      expected: {
        controlRunId: unsigned.controlRunId,
        authorization,
        buildId: plan.buildId,
        productRole: plan.productRole,
        workspaceOwner,
        captureMode,
        executable: structuredClone(unsigned.executable),
      },
      stdoutBytes,
      stderrBytes,
      executableBytes,
    },
    value: sealed.value,
  };
}

function resealFixture(fixtureValue, input) {
  const { contentHash: ignored, ...unsigned } = fixtureValue;
  input.bytes = seal(unsigned).bytes;
}

test("build-owner v2 replays the exact plan for all four ordinals", () => {
  assert.equal(
    G17_BENCHMARK_BUILD_OWNER_V2_SCHEMA,
    "oxigraph.g1.7-benchmark-build-owner/v2",
  );
  for (const [index, plan] of G17_BENCHMARK_BUILD_PLAN.entries()) {
    const { input } = fixture({ buildIndex: index });
    const projection = verifyG17BenchmarkBuildOwnerV2(input);
    assert.equal(projection.buildId, plan.buildId);
    assert.equal(projection.productRole, plan.productRole);
    assert.equal(projection.command.ordinal, index + 1);
    assert.equal(projection.command.program, G17_BENCHMARK_BUILD_PROGRAM);
    assert.deepEqual(projection.command.argv, G17_BENCHMARK_BUILD_ARGV);
    assert.deepEqual(
      projection.command.environment,
      G17_BENCHMARK_BUILD_ENVIRONMENT,
    );
    assert.equal(projection.supervision.captureMode, "synthetic-test-only");
    assert.equal(projection.status, "SUPERVISION_OBSERVATIONS_REPLAYED");
    assert.equal(projection.binding, null);
    assert.equal(projection.finalDecisionEligible, false);
    assert.equal(
      Object.values(projection.authority).every((value) => !value),
      true,
    );
    assert.equal(Object.isFrozen(projection), true);
  }
});

test("build-owner v2 requires a separately trusted exact capture mode", () => {
  const synthetic = fixture();
  synthetic.input.expected.captureMode = "physical-supervisor";
  assert.throws(
    () => verifyG17BenchmarkBuildOwnerV2(synthetic.input),
    CONTRACT_ERROR,
  );

  const physical = fixture({ captureMode: "physical-supervisor" });
  assert.equal(
    verifyG17BenchmarkBuildOwnerV2(physical.input).supervision.captureMode,
    "physical-supervisor",
  );
});

test("build-owner v2 rejects legacy argv, environment, and ordinal drift", () => {
  for (const mutate of [
    (value) => value.command.argv.unshift("cargo"),
    (value) => {
      value.command.environment = {
        CARGO_BUILD_JOBS: "4",
        CARGO_INCREMENTAL: "0",
      };
      value.command.environmentSha256 = canonicalSha256(
        value.command.environment,
      );
    },
    (value) => {
      value.command.ordinal = 1;
    },
    (value) => {
      value.command.program = "cargo";
    },
  ]) {
    const candidate = fixture({ buildIndex: 2 });
    mutate(candidate.value);
    resealFixture(candidate.value, candidate.input);
    assert.throws(
      () => verifyG17BenchmarkBuildOwnerV2(candidate.input),
      CONTRACT_ERROR,
    );
  }
});

test("build-owner v2 rejects incomplete or contradictory supervision", () => {
  for (const mutate of [
    (value) => {
      value.supervision.spawned = false;
    },
    (value) => {
      value.supervision.reaped = false;
    },
    (value) => {
      value.supervision.exit.observed = false;
    },
    (value) => {
      value.supervision.close.observed = false;
    },
    (value) => {
      value.supervision.stdoutEofObserved = false;
    },
    (value) => {
      value.supervision.stderrEofObserved = false;
    },
    (value) => {
      value.supervision.captureComplete = false;
    },
    (value) => {
      value.supervision.outputTruncated = true;
    },
    (value) => {
      value.supervision.close.exitCode = 1;
    },
    (value) => {
      value.supervision.statusAgreement = false;
    },
    (value) => {
      value.supervision.processGeneration = "unsafe generation";
    },
  ]) {
    const candidate = fixture();
    mutate(candidate.value);
    resealFixture(candidate.value, candidate.input);
    assert.throws(
      () => verifyG17BenchmarkBuildOwnerV2(candidate.input),
      CONTRACT_ERROR,
    );
  }
});

test("build-owner v2 rejects non-completed first-terminal dispositions", () => {
  for (const disposition of ["timeout", "cancelled", "output-limit"]) {
    const candidate = fixture();
    candidate.value.supervision.disposition = disposition;
    resealFixture(candidate.value, candidate.input);
    assert.throws(
      () => verifyG17BenchmarkBuildOwnerV2(candidate.input),
      CONTRACT_ERROR,
    );
  }
});

test("build-owner v2 binds exact raw streams and executable bytes", () => {
  for (const mutate of [
    (input) => input.stdoutBytes.fill(0x78),
    (input) => input.stderrBytes.fill(0x79),
    (input) => input.executableBytes.fill(0x7a),
  ]) {
    const candidate = fixture();
    mutate(candidate.input);
    assert.throws(
      () => verifyG17BenchmarkBuildOwnerV2(candidate.input),
      CONTRACT_ERROR,
    );
  }
});

test("build-owner v2 rejects authority, binding, or eligibility overclaim", () => {
  for (const mutate of [
    (value) => {
      value.authority.buildExecutionAuthority = true;
    },
    (value) => {
      value.binding = { claimed: true };
    },
    (value) => {
      value.finalDecisionEligible = true;
    },
  ]) {
    const candidate = fixture();
    mutate(candidate.value);
    resealFixture(candidate.value, candidate.input);
    assert.throws(
      () => verifyG17BenchmarkBuildOwnerV2(candidate.input),
      CONTRACT_ERROR,
    );
  }
});
