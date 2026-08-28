import { createHash } from "node:crypto";

import {
  G17_BENCHMARK_BUILD_OWNER_SCHEMA,
  G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
  G17_BENCHMARK_SESSION_OWNER_SCHEMA,
  G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
} from "../../src/qualification/benchmark-owner-contract.mjs";
import {
  G17_CONTROL_AUTHORIZATION_PROTOCOL,
  G17_CONTROL_AUTHORIZATION_SCHEMA,
} from "../../src/qualification/control-protocol.mjs";
import {
  G17_BENCHMARK_CASES,
  G17_CONTROL_STATISTICS_CONTRACT,
} from "../../src/qualification/control-statistics-contract.mjs";
import { g17ControlSampleSetBytes } from "../../src/qualification/control-statistics-replay.mjs";
import { canonicalJson, canonicalSha256 } from "../../src/routing/features.mjs";
import { g17ControlSampleSet } from "./g17-control-statistics-fixture.mjs";

export const EXPECTED_G17_BENCHMARK_BUILD_PLAN = Object.freeze([
  Object.freeze({
    buildId: "negative-control",
    productRole: "negativeControl",
  }),
  Object.freeze({
    buildId: "performance-reference",
    productRole: "performanceReference",
  }),
  Object.freeze({
    buildId: "noise-control-a",
    productRole: "noiseControl",
  }),
  Object.freeze({
    buildId: "noise-control-b",
    productRole: "noiseControl",
  }),
]);

export const G17_BENCHMARK_OWNER_FIXTURE_RUN_ID = "g17-benchmark-owner-fixture";

const BUILD_EXECUTABLE =
  "/state/target/release/deps/transactional_write-fixture";
const SAMPLE_SCHEMA = "oxigraph.transactional-write-sample/v1";
const AUTHORIZED_AT = "2026-08-28T08:00:00.000Z";

const BUILD_ARGV = Object.freeze([
  "cargo",
  "bench",
  "--locked",
  "--offline",
  "-p",
  "oxigraph",
  "--bench",
  "transactional_write",
  "--no-run",
  "--message-format",
  "json-render-diagnostics",
  "--target-dir",
  "/state/target",
]);

const BUILD_ENVIRONMENT = Object.freeze({
  CARGO_BUILD_JOBS: "4",
  CARGO_INCREMENTAL: "0",
});

const EXECUTABLE_DIGESTS = Object.freeze({
  "negative-control": "a".repeat(64),
  "performance-reference": "b".repeat(64),
  "noise-control-a": "c".repeat(64),
  // Independent builds may legitimately produce byte-identical executables.
  "noise-control-b": "c".repeat(64),
});

export function g17BenchmarkOwnerSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function g17BenchmarkOwnerBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function g17SealBenchmarkOwner(value) {
  const { contentHash: ignored, ...unsigned } = structuredClone(value);
  return { ...unsigned, contentHash: canonicalSha256(unsigned) };
}

export function g17DecodeBenchmarkOwner(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function sealedBytes(value) {
  return g17BenchmarkOwnerBytes(g17SealBenchmarkOwner(value));
}

function approvedAuthorization() {
  const unsigned = {
    schema: G17_CONTROL_AUTHORIZATION_SCHEMA,
    id: "control-authorization",
    status: "CONTROL_AUTHORIZED",
    protocol: G17_CONTROL_AUTHORIZATION_PROTOCOL,
    approval: {
      status: "APPROVED",
      approvedBy: "benchmark-owner-fixture-reviewer",
      approvedAt: AUTHORIZED_AT,
    },
  };
  const authorization = {
    ...structuredClone(unsigned),
    contentHash: canonicalSha256(unsigned),
  };
  const bytes = g17BenchmarkOwnerBytes(authorization);
  return {
    authorization,
    authorizationBytes: bytes,
    authorizationRawSha256: g17BenchmarkOwnerSha256(bytes),
  };
}

function authorizationBinding(authorization, authorizationRawSha256) {
  return {
    rawSha256: authorizationRawSha256,
    contentHash: authorization.contentHash,
  };
}

function evaluatorFor(productRole) {
  const evaluator = G17_CONTROL_AUTHORIZATION_PROTOCOL.evaluatorOverlay;
  return {
    commit: evaluator.commit,
    parent: evaluator.parent,
    tree: evaluator.tree,
    patchSha256: evaluator.patchSha256,
    paths: structuredClone(evaluator.paths),
    composition: structuredClone(evaluator.roleCompositions[productRole]),
  };
}

function workspaceOwner({ controlRunId, authorization, buildId, productRole }) {
  const composition =
    G17_CONTROL_AUTHORIZATION_PROTOCOL.evaluatorOverlay.roleCompositions[
      productRole
    ];
  return g17SealBenchmarkOwner({
    schema: G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
    controlRunId,
    authorization,
    buildId,
    productRole,
    product: structuredClone(
      G17_CONTROL_AUTHORIZATION_PROTOCOL.products[productRole],
    ),
    evaluator: evaluatorFor(productRole),
    workspace: {
      generation: `${controlRunId}-${buildId}-workspace`,
      targetGeneration: `${controlRunId}-${buildId}-target`,
      effectiveTree: composition.effectiveTree,
      isolated: true,
      targetIsolated: true,
      sourceReadOnlyAfterBuildStart: true,
    },
  });
}

function buildJsonl() {
  return Buffer.from(
    `${JSON.stringify({
      reason: "compiler-artifact",
      package_id: "path+file:///workspace/lib/oxigraph#0.5.0",
      manifest_path: "/workspace/lib/oxigraph/Cargo.toml",
      target: {
        kind: ["bench"],
        crate_types: ["bin"],
        name: "transactional_write",
        src_path: "/workspace/lib/oxigraph/benches/transactional_write.rs",
        edition: "2024",
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
      filenames: [BUILD_EXECUTABLE],
      executable: BUILD_EXECUTABLE,
      fresh: false,
    })}\n${JSON.stringify({ reason: "build-finished", success: true })}\n`,
    "utf8",
  );
}

function processResult(stdoutBytes, stderrBytes = Buffer.alloc(0)) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: {
      bytes: stdoutBytes.length,
      sha256: g17BenchmarkOwnerSha256(stdoutBytes),
    },
    stderr: {
      bytes: stderrBytes.length,
      sha256: g17BenchmarkOwnerSha256(stderrBytes),
    },
  };
}

function buildOwner({
  controlRunId,
  authorization,
  buildId,
  productRole,
  ordinal,
  workspaceOwnerValue,
  workspaceOwnerBytes,
  stdoutBytes,
  stderrBytes,
}) {
  return g17SealBenchmarkOwner({
    schema: G17_BENCHMARK_BUILD_OWNER_SCHEMA,
    controlRunId,
    authorization,
    buildId,
    productRole,
    workspaceOwner: {
      rawSha256: g17BenchmarkOwnerSha256(workspaceOwnerBytes),
      contentHash: workspaceOwnerValue.contentHash,
    },
    command: {
      argv: structuredClone(BUILD_ARGV),
      environment: structuredClone(BUILD_ENVIRONMENT),
      ordinal,
    },
    result: processResult(stdoutBytes, stderrBytes),
    executable: {
      logicalPath: BUILD_EXECUTABLE,
      sha256: EXECUTABLE_DIGESTS[buildId],
    },
  });
}

function rustSampleBytes(row) {
  return Buffer.from(
    `${JSON.stringify({
      bytes: row.bytes,
      caseId: row.caseId,
      elapsedNs: row.elapsedNs,
      operations: row.operations,
      readerObservations: row.readerObservations,
      schema: SAMPLE_SCHEMA,
      seed: row.seed,
    })}\n`,
    "utf8",
  );
}

function launchArgv(row, executable, sequence) {
  const task = G17_BENCHMARK_CASES.find(({ id }) => id === row.caseId);
  if (task === undefined) {
    throw new Error(`fixture case is not reviewed: ${row.caseId}`);
  }
  const argv = [
    executable.logicalPath,
    "--case",
    row.caseId,
    "--operations",
    String(task.operations),
    "--seed",
    String(row.seed),
  ];
  if (!row.caseId.endsWith("-memory")) {
    argv.push(
      "--database",
      `/state/databases/${row.controlId}/${String(sequence).padStart(3, "0")}`,
    );
  }
  return argv;
}

function launchOwner({
  controlRunId,
  authorization,
  row,
  sequence,
  executable,
  stdoutBytes,
  stderrBytes,
}) {
  return g17SealBenchmarkOwner({
    schema: G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
    controlRunId,
    authorization,
    controlId: row.controlId,
    sequence,
    buildId: row.buildId,
    productRole: row.productRole,
    arm: row.arm,
    coordinate: {
      caseId: row.caseId,
      phase: row.phase,
      block: row.block,
      pair: row.pair,
      slot: row.slot,
      repetition: row.repetition,
      seed: row.seed,
    },
    executable: structuredClone(executable),
    command: { argv: launchArgv(row, executable, sequence) },
    result: processResult(stdoutBytes, stderrBytes),
  });
}

function buildBinding(build) {
  return {
    buildId: build.buildId,
    buildOwnerRawSha256: g17BenchmarkOwnerSha256(build.buildOwnerBytes),
    buildOwnerContentHash: build.buildOwnerValue.contentHash,
  };
}

function defaultElapsedNs({ controlName, arm, caseIndex, globalBlock, slot }) {
  const uniqueOffset = caseIndex * 1_000 + globalBlock * 10 + slot;
  if (controlName === "negativeControl") {
    return (arm === "subject" ? 120_000 : 100_000) + uniqueOffset;
  }
  return 100_000 + uniqueOffset;
}

function controlOwner({
  controlName,
  controlRunId,
  authorization,
  buildsById,
  elapsedNs,
}) {
  const control = G17_CONTROL_STATISTICS_CONTRACT.controls[controlName];
  const sampleSet = g17ControlSampleSet({
    controlName,
    runId: controlRunId,
    authorization,
    elapsedNs: ({ arm, caseIndex, globalBlock, slot }) =>
      elapsedNs({ controlName, arm, caseIndex, globalBlock, slot }),
  });
  const launches = sampleSet.rows.map((row, sequence) => {
    const build = buildsById.get(row.buildId);
    row.executableSha256 = build.buildOwnerValue.executable.sha256;
    const stdoutBytes = rustSampleBytes(row);
    const stderrBytes = Buffer.alloc(0);
    row.rawSampleSha256 = g17BenchmarkOwnerSha256(stdoutBytes);
    const attestation = launchOwner({
      controlRunId,
      authorization,
      row,
      sequence,
      executable: build.buildOwnerValue.executable,
      stdoutBytes,
      stderrBytes,
    });
    return {
      attestationValue: attestation,
      attestationBytes: g17BenchmarkOwnerBytes(attestation),
      stdoutBytes,
      stderrBytes,
    };
  });
  const sampleSetBytes = g17ControlSampleSetBytes(sampleSet, controlName);
  const subjectBuild = buildsById.get(control.subject.buildId);
  const referenceBuild = buildsById.get(control.reference.buildId);
  const session = g17SealBenchmarkOwner({
    schema: G17_BENCHMARK_SESSION_OWNER_SCHEMA,
    controlRunId,
    authorization,
    controlId: control.id,
    environment: structuredClone(
      G17_CONTROL_AUTHORIZATION_PROTOCOL.environment,
    ),
    execution: {
      serialized: true,
      adaptiveStopping: false,
      outlierDeletion: false,
    },
    builds: {
      subject: buildBinding(subjectBuild),
      reference: buildBinding(referenceBuild),
    },
    launches: launches.map((launch, sequence) => ({
      sequence,
      attestationRawSha256: g17BenchmarkOwnerSha256(launch.attestationBytes),
      attestationContentHash: launch.attestationValue.contentHash,
      stdoutSha256: g17BenchmarkOwnerSha256(launch.stdoutBytes),
      stderrSha256: g17BenchmarkOwnerSha256(launch.stderrBytes),
    })),
    sampleSet: {
      rawSha256: g17BenchmarkOwnerSha256(sampleSetBytes),
      rows: sampleSet.rows.length,
    },
  });
  return {
    controlName,
    sessionOwnerValue: session,
    sessionOwnerBytes: g17BenchmarkOwnerBytes(session),
    sampleSet,
    sampleSetBytes,
    launches,
  };
}

export function createG17BenchmarkOwnerFixture({
  controlRunId = G17_BENCHMARK_OWNER_FIXTURE_RUN_ID,
  elapsedNs = defaultElapsedNs,
} = {}) {
  const { authorization, authorizationBytes, authorizationRawSha256 } =
    approvedAuthorization();
  const authorizationReference = authorizationBinding(
    authorization,
    authorizationRawSha256,
  );
  const buildStdoutBytes = buildJsonl();
  const builds = EXPECTED_G17_BENCHMARK_BUILD_PLAN.map(
    ({ buildId, productRole }) => {
      const workspaceOwnerValue = workspaceOwner({
        controlRunId,
        authorization: authorizationReference,
        buildId,
        productRole,
      });
      const workspaceOwnerBytes = g17BenchmarkOwnerBytes(workspaceOwnerValue);
      const buildStderrBytes = Buffer.alloc(0);
      const buildOwnerValue = buildOwner({
        controlRunId,
        authorization: authorizationReference,
        buildId,
        productRole,
        ordinal: 1,
        workspaceOwnerValue,
        workspaceOwnerBytes,
        stdoutBytes: buildStdoutBytes,
        stderrBytes: buildStderrBytes,
      });
      const buildOwnerBytes = g17BenchmarkOwnerBytes(buildOwnerValue);
      return {
        buildId,
        productRole,
        workspaceOwnerValue,
        workspaceOwnerBytes,
        buildOwnerValue,
        buildOwnerBytes,
        buildStdoutBytes: Buffer.from(buildStdoutBytes),
        buildStderrBytes,
      };
    },
  );
  const buildsById = new Map(builds.map((build) => [build.buildId, build]));
  const controls = ["negativeControl", "aaNoiseControl"].map((controlName) =>
    controlOwner({
      controlName,
      controlRunId,
      authorization: authorizationReference,
      buildsById,
      elapsedNs,
    }),
  );
  return {
    authorization,
    authorizationBytes,
    authorizationRawSha256,
    authorizationReference,
    controlRunId,
    builds,
    controls,
    artifacts: {
      builds: builds.map((build) => ({
        buildId: build.buildId,
        productRole: build.productRole,
        workspaceOwnerBytes: Buffer.from(build.workspaceOwnerBytes),
        buildOwnerBytes: Buffer.from(build.buildOwnerBytes),
        buildStdoutBytes: Buffer.from(build.buildStdoutBytes),
        buildStderrBytes: Buffer.from(build.buildStderrBytes),
      })),
      controls: controls.map((control) => ({
        controlName: control.controlName,
        sessionOwnerBytes: Buffer.from(control.sessionOwnerBytes),
        sampleSetBytes: Buffer.from(control.sampleSetBytes),
        launches: control.launches.map((launch) => ({
          attestationBytes: Buffer.from(launch.attestationBytes),
          stdoutBytes: Buffer.from(launch.stdoutBytes),
          stderrBytes: Buffer.from(launch.stderrBytes),
        })),
      })),
    },
  };
}

export function resealG17BenchmarkOwnerArtifact(value) {
  return sealedBytes(value);
}
