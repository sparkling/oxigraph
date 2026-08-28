import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_OWNER_SCHEMA,
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
  G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
  G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256,
  G17_BENCHMARK_SESSION_OWNER_SCHEMA,
  G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
  verifyG17BenchmarkBuildOwner,
  verifyG17BenchmarkLaunchAttestation,
  verifyG17BenchmarkOwnerBundle,
  verifyG17BenchmarkSessionOwner,
  verifyG17BenchmarkWorkspaceOwner,
} from "../src/qualification/benchmark-owner-contract.mjs";
import {
  G17_BENCHMARK_BUILD_OWNER_SCHEMA as CONTROL_BUILD_OWNER_SCHEMA,
  G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA as CONTROL_LAUNCH_ATTESTATION_SCHEMA,
  G17_BENCHMARK_SESSION_OWNER_SCHEMA as CONTROL_SESSION_OWNER_SCHEMA,
  G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA as CONTROL_WORKSPACE_OWNER_SCHEMA,
  G17_CONTROL_AUTHORIZATION_PROTOCOL,
} from "../src/qualification/control-protocol.mjs";
import { g17ControlSampleSetBytes } from "../src/qualification/control-statistics-replay.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  EXPECTED_G17_BENCHMARK_BUILD_PLAN,
  createG17BenchmarkOwnerFixture,
  g17BenchmarkOwnerSha256,
  g17DecodeBenchmarkOwner,
  resealG17BenchmarkOwnerArtifact,
} from "./support/g17-benchmark-owner-fixture.mjs";

const CONTRACT_ERROR = /G1\.7 benchmark owner/u;

function verifyFixture(fixture) {
  return verifyG17BenchmarkOwnerBundle({
    authorization: fixture.authorization,
    authorizationRawSha256: fixture.authorizationRawSha256,
    controlRunId: fixture.controlRunId,
    artifacts: fixture.artifacts,
  });
}

function ownerValue(bytes) {
  return g17DecodeBenchmarkOwner(bytes);
}

function reseal(value) {
  return resealG17BenchmarkOwnerArtifact(value);
}

function updateSessionBuildReference(fixture, buildId, buildOwnerBytes) {
  const buildOwner = ownerValue(buildOwnerBytes);
  for (const control of fixture.artifacts.controls) {
    const session = ownerValue(control.sessionOwnerBytes);
    let changed = false;
    for (const arm of ["subject", "reference"]) {
      if (session.builds[arm].buildId !== buildId) continue;
      session.builds[arm].buildOwnerRawSha256 =
        g17BenchmarkOwnerSha256(buildOwnerBytes);
      session.builds[arm].buildOwnerContentHash = buildOwner.contentHash;
      changed = true;
    }
    if (changed) control.sessionOwnerBytes = reseal(session);
  }
}

function replaceWorkspaceOwner(fixture, buildIndex, mutate) {
  const buildArtifact = fixture.artifacts.builds[buildIndex];
  const workspace = ownerValue(buildArtifact.workspaceOwnerBytes);
  mutate(workspace);
  buildArtifact.workspaceOwnerBytes = reseal(workspace);

  const buildOwner = ownerValue(buildArtifact.buildOwnerBytes);
  const sealedWorkspace = ownerValue(buildArtifact.workspaceOwnerBytes);
  buildOwner.workspaceOwner = {
    rawSha256: g17BenchmarkOwnerSha256(buildArtifact.workspaceOwnerBytes),
    contentHash: sealedWorkspace.contentHash,
  };
  buildArtifact.buildOwnerBytes = reseal(buildOwner);
  updateSessionBuildReference(
    fixture,
    buildArtifact.buildId,
    buildArtifact.buildOwnerBytes,
  );
}

function replaceBuildOwner(fixture, buildIndex, mutate) {
  const artifact = fixture.artifacts.builds[buildIndex];
  const buildOwner = ownerValue(artifact.buildOwnerBytes);
  mutate(buildOwner, artifact);
  artifact.buildOwnerBytes = reseal(buildOwner);
  updateSessionBuildReference(
    fixture,
    artifact.buildId,
    artifact.buildOwnerBytes,
  );
}

function replaceLaunchStdout(fixture, controlIndex, launchIndex, mutate) {
  const control = fixture.artifacts.controls[controlIndex];
  const launch = control.launches[launchIndex];
  const raw = JSON.parse(launch.stdoutBytes.toString("utf8"));
  mutate(raw);
  launch.stdoutBytes = Buffer.from(`${JSON.stringify(raw)}\n`, "utf8");

  const attestation = ownerValue(launch.attestationBytes);
  attestation.result.stdout = {
    bytes: launch.stdoutBytes.length,
    sha256: g17BenchmarkOwnerSha256(launch.stdoutBytes),
  };
  launch.attestationBytes = reseal(attestation);
  const sealedAttestation = ownerValue(launch.attestationBytes);

  const sampleSet = JSON.parse(control.sampleSetBytes.toString("utf8"));
  sampleSet.rows[launchIndex].rawSampleSha256 = g17BenchmarkOwnerSha256(
    launch.stdoutBytes,
  );
  control.sampleSetBytes = g17ControlSampleSetBytes(
    sampleSet,
    control.controlName,
  );

  const session = ownerValue(control.sessionOwnerBytes);
  session.launches[launchIndex] = {
    sequence: launchIndex,
    attestationRawSha256: g17BenchmarkOwnerSha256(launch.attestationBytes),
    attestationContentHash: sealedAttestation.contentHash,
    stdoutSha256: g17BenchmarkOwnerSha256(launch.stdoutBytes),
    stderrSha256: g17BenchmarkOwnerSha256(launch.stderrBytes),
  };
  session.sampleSet = {
    rawSha256: g17BenchmarkOwnerSha256(control.sampleSetBytes),
    rows: sampleSet.rows.length,
  };
  control.sessionOwnerBytes = reseal(session);
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("benchmark owner contract exposes the exact frozen Phase-A schemas and build plan", () => {
  assert.equal(
    G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
    "oxigraph.g1.7-benchmark-workspace-owner/v1",
  );
  assert.equal(
    G17_BENCHMARK_BUILD_OWNER_SCHEMA,
    "oxigraph.g1.7-benchmark-build-owner/v1",
  );
  assert.equal(
    G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
    "oxigraph.g1.7-benchmark-launch-attestation/v1",
  );
  assert.equal(
    G17_BENCHMARK_SESSION_OWNER_SCHEMA,
    "oxigraph.g1.7-benchmark-session-owner/v1",
  );
  assert.equal(
    G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
    "oxigraph.g1.7-benchmark-owner-bundle-projection/v1",
  );
  assert.deepEqual(
    [
      G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
      G17_BENCHMARK_BUILD_OWNER_SCHEMA,
      G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
      G17_BENCHMARK_SESSION_OWNER_SCHEMA,
    ],
    [
      CONTROL_WORKSPACE_OWNER_SCHEMA,
      CONTROL_BUILD_OWNER_SCHEMA,
      CONTROL_LAUNCH_ATTESTATION_SCHEMA,
      CONTROL_SESSION_OWNER_SCHEMA,
    ],
  );
  assert.equal(
    canonicalSha256(G17_CONTROL_AUTHORIZATION_PROTOCOL),
    G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256,
  );
  assert.deepEqual(G17_BENCHMARK_BUILD_PLAN, EXPECTED_G17_BENCHMARK_BUILD_PLAN);
  for (const verifier of [
    verifyG17BenchmarkWorkspaceOwner,
    verifyG17BenchmarkBuildOwner,
    verifyG17BenchmarkLaunchAttestation,
    verifyG17BenchmarkSessionOwner,
    verifyG17BenchmarkOwnerBundle,
  ]) {
    assert.equal(typeof verifier, "function");
  }
});

test("pure aggregate replays four isolated builds, two sessions, and 392 raw launches", () => {
  const fixture = createG17BenchmarkOwnerFixture();
  assert.equal(fixture.artifacts.builds.length, 4);
  assert.deepEqual(
    fixture.artifacts.builds.map(({ buildId, productRole }) => ({
      buildId,
      productRole,
    })),
    EXPECTED_G17_BENCHMARK_BUILD_PLAN,
  );
  assert.deepEqual(
    fixture.artifacts.controls.map(({ controlName }) => controlName),
    ["negativeControl", "aaNoiseControl"],
  );
  assert.deepEqual(
    fixture.artifacts.controls.map(({ launches }) => launches.length),
    [196, 196],
  );
  assert.equal(
    fixture.builds[2].buildOwnerValue.executable.sha256,
    fixture.builds[3].buildOwnerValue.executable.sha256,
    "independent A/A owners may produce identical executable bytes",
  );

  const projection = verifyFixture(fixture);
  assert.equal(projection.schema, G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA);
  assert.equal(projection.controlRunId, fixture.controlRunId);
  assertDeepFrozen(projection);
  const serialized = canonicalJson(projection);
  for (const forbidden of [
    "/tmp/",
    "/home/",
    "CONTROL_AUTHORIZED_FOR_QUALIFICATION",
    'promotionAuthority":true',
    'publicationAuthority":true',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("owner replay rejects noncanonical bytes, unknown fields, and accessor-backed inventories", () => {
  for (const mutate of [
    (fixture) => {
      const value = ownerValue(fixture.artifacts.builds[0].workspaceOwnerBytes);
      fixture.artifacts.builds[0].workspaceOwnerBytes = Buffer.from(
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
    },
    (fixture) => {
      fixture.artifacts.builds[0].workspaceOwnerBytes =
        fixture.artifacts.builds[0].workspaceOwnerBytes.subarray(0, -1);
    },
    (fixture) => {
      const value = ownerValue(fixture.artifacts.builds[0].workspaceOwnerBytes);
      value.unreviewed = true;
      fixture.artifacts.builds[0].workspaceOwnerBytes = reseal(value);
    },
  ]) {
    const fixture = createG17BenchmarkOwnerFixture();
    mutate(fixture);
    assert.throws(() => verifyFixture(fixture), CONTRACT_ERROR);
  }

  const fixture = createG17BenchmarkOwnerFixture();
  const first = fixture.artifacts.builds[0];
  const bytes = first.workspaceOwnerBytes;
  let reads = 0;
  Object.defineProperty(first, "workspaceOwnerBytes", {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return bytes;
    },
  });
  assert.throws(() => verifyFixture(fixture), CONTRACT_ERROR);
  assert.equal(reads, 0);
});

test("owner replay rejects non-Buffers, invalid UTF-8, symbols, sparse inventories, cycles, and foreign prototypes", () => {
  const mutations = [
    (fixture) => {
      fixture.artifacts.builds[0].workspaceOwnerBytes = "not-bytes";
    },
    (fixture) => {
      fixture.artifacts.builds[0].workspaceOwnerBytes = Buffer.from([
        0xff, 0x0a,
      ]);
    },
    (fixture) => {
      fixture.artifacts[Symbol("hidden-owner")] = true;
    },
    (fixture) => {
      delete fixture.artifacts.builds[1];
    },
    (fixture) => {
      fixture.artifacts.controls[0].cycle = fixture.artifacts;
    },
    (fixture) => {
      Object.setPrototypeOf(fixture.artifacts.controls[0], {
        inheritedAuthority: true,
      });
    },
  ];
  for (const mutate of mutations) {
    const fixture = createG17BenchmarkOwnerFixture();
    mutate(fixture);
    assert.throws(() => verifyFixture(fixture), CONTRACT_ERROR);
  }
});

test("owner replay rejects product substitution and coherent workspace reuse", () => {
  const substituted = createG17BenchmarkOwnerFixture();
  replaceWorkspaceOwner(substituted, 0, (workspace) => {
    workspace.product.tree = "f".repeat(40);
  });
  assert.throws(() => verifyFixture(substituted), CONTRACT_ERROR);

  const reused = createG17BenchmarkOwnerFixture();
  const noiseA = ownerValue(reused.artifacts.builds[2].workspaceOwnerBytes);
  replaceWorkspaceOwner(reused, 3, (workspace) => {
    workspace.workspace.generation = noiseA.workspace.generation;
    workspace.workspace.targetGeneration = noiseA.workspace.targetGeneration;
  });
  assert.throws(() => verifyFixture(reused), CONTRACT_ERROR);

  const wrongComposition = createG17BenchmarkOwnerFixture();
  replaceWorkspaceOwner(wrongComposition, 1, (workspace) => {
    workspace.evaluator.composition = structuredClone(
      ownerValue(wrongComposition.artifacts.builds[0].workspaceOwnerBytes)
        .evaluator.composition,
    );
  });
  assert.throws(() => verifyFixture(wrongComposition), CONTRACT_ERROR);
});

test("build replay rejects command drift, raw stream drift, and ambiguous executables", () => {
  const wrongArgv = createG17BenchmarkOwnerFixture();
  replaceBuildOwner(wrongArgv, 0, (owner) => {
    owner.command.argv = owner.command.argv.filter(
      (argument) => argument !== "--offline",
    );
  });
  assert.throws(() => verifyFixture(wrongArgv), CONTRACT_ERROR);

  const rawDrift = createG17BenchmarkOwnerFixture();
  rawDrift.artifacts.builds[0].buildStdoutBytes = Buffer.concat([
    rawDrift.artifacts.builds[0].buildStdoutBytes,
    Buffer.from("{}\n", "utf8"),
  ]);
  assert.throws(() => verifyFixture(rawDrift), CONTRACT_ERROR);

  const ambiguous = createG17BenchmarkOwnerFixture();
  replaceBuildOwner(ambiguous, 0, (owner, artifact) => {
    const lines = artifact.buildStdoutBytes
      .toString("utf8")
      .trimEnd()
      .split("\n");
    artifact.buildStdoutBytes = Buffer.from(
      `${lines[0]}\n${lines[0]}\n${lines[1]}\n`,
      "utf8",
    );
    owner.result.stdout = {
      bytes: artifact.buildStdoutBytes.length,
      sha256: g17BenchmarkOwnerSha256(artifact.buildStdoutBytes),
    };
  });
  assert.throws(() => verifyFixture(ambiguous), CONTRACT_ERROR);
});

test("launch replay derives rows from exact Rust stdout and rejects semantic raw-output drift", () => {
  const fixture = createG17BenchmarkOwnerFixture();
  replaceLaunchStdout(fixture, 0, 0, (sample) => {
    sample.seed += 1;
  });
  assert.throws(() => verifyFixture(fixture), CONTRACT_ERROR);

  const stderr = createG17BenchmarkOwnerFixture();
  stderr.artifacts.controls[0].launches[0].stderrBytes = Buffer.from(
    "unexpected warning\n",
    "utf8",
  );
  assert.throws(() => verifyFixture(stderr), CONTRACT_ERROR);

  const hidden = createG17BenchmarkOwnerFixture();
  hidden.artifacts.controls[0].launches.push({
    ...hidden.artifacts.controls[0].launches[0],
  });
  assert.throws(() => verifyFixture(hidden), CONTRACT_ERROR);
});

test("session replay rejects sample substitution and non-serialized execution", () => {
  const samples = createG17BenchmarkOwnerFixture();
  samples.artifacts.controls[0].sampleSetBytes = Buffer.from(
    samples.artifacts.controls[1].sampleSetBytes,
  );
  assert.throws(() => verifyFixture(samples), /G1\.7 control statistics/u);

  const serialization = createG17BenchmarkOwnerFixture();
  const session = ownerValue(
    serialization.artifacts.controls[0].sessionOwnerBytes,
  );
  session.execution.serialized = false;
  serialization.artifacts.controls[0].sessionOwnerBytes = reseal(session);
  assert.throws(() => verifyFixture(serialization), CONTRACT_ERROR);

  const environment = createG17BenchmarkOwnerFixture();
  const environmentSession = ownerValue(
    environment.artifacts.controls[0].sessionOwnerBytes,
  );
  environmentSession.environment.class = "tmpfs-unserialized";
  environment.artifacts.controls[0].sessionOwnerBytes =
    reseal(environmentSession);
  assert.throws(() => verifyFixture(environment), CONTRACT_ERROR);
});

test("aggregate rejects authorization drift, artifact reordering, and incomplete control evidence", () => {
  const authorization = createG17BenchmarkOwnerFixture();
  authorization.authorizationRawSha256 = "0".repeat(64);
  assert.throws(() => verifyFixture(authorization), CONTRACT_ERROR);

  const proposed = createG17BenchmarkOwnerFixture();
  proposed.authorization.status = "CONTROL_AUTH_PROPOSED";
  proposed.authorization.approval = {
    status: "UNAPPROVED",
    approvedBy: null,
    approvedAt: null,
  };
  const { contentHash: ignoredProposedHash, ...proposedUnsigned } =
    proposed.authorization;
  proposed.authorization.contentHash = canonicalSha256(proposedUnsigned);
  assert.throws(() => verifyFixture(proposed), CONTRACT_ERROR);

  const protocolDrift = createG17BenchmarkOwnerFixture();
  protocolDrift.authorization.protocol.products.negativeControl.tree =
    "f".repeat(40);
  const { contentHash: ignoredProtocolHash, ...protocolUnsigned } =
    protocolDrift.authorization;
  protocolDrift.authorization.contentHash = canonicalSha256(protocolUnsigned);
  assert.throws(() => verifyFixture(protocolDrift), CONTRACT_ERROR);

  const buildOrder = createG17BenchmarkOwnerFixture();
  buildOrder.artifacts.builds.reverse();
  assert.throws(() => verifyFixture(buildOrder), CONTRACT_ERROR);

  const controlOrder = createG17BenchmarkOwnerFixture();
  controlOrder.artifacts.controls.reverse();
  assert.throws(() => verifyFixture(controlOrder), CONTRACT_ERROR);

  const missing = createG17BenchmarkOwnerFixture();
  missing.artifacts.controls[1].launches.pop();
  assert.throws(() => verifyFixture(missing), CONTRACT_ERROR);

  const launchOrder = createG17BenchmarkOwnerFixture();
  launchOrder.artifacts.controls[0].launches.reverse();
  assert.throws(() => verifyFixture(launchOrder), CONTRACT_ERROR);
});

test("aggregate snapshots inputs and returns an immutable detached projection", () => {
  const fixture = createG17BenchmarkOwnerFixture();
  const projection = verifyFixture(fixture);
  const before = canonicalJson(projection);
  fixture.authorization.status = "CONTROL_AUTH_PROPOSED";
  fixture.artifacts.builds[0].workspaceOwnerBytes.fill(0x78);
  fixture.artifacts.controls[0].sampleSetBytes.fill(0x79);
  fixture.artifacts.controls[0].launches[0].stdoutBytes.fill(0x7a);
  assert.equal(canonicalJson(projection), before);
  assertDeepFrozen(projection);
});

test("benchmark owner replay imports no live owner, filesystem, process, storage, or Darwin modules", async () => {
  const source = await readFile(
    new URL(
      "../src/qualification/benchmark-owner-contract.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  for (const forbidden of [
    "node:child_process",
    "node:fs",
    "node:os",
    "node:process",
    "@metaharness/darwin",
    "benchmark-contract.mjs",
    "contained-session",
    "native-platform.mjs",
    "native-workspace.mjs",
    "runner.mjs",
    "storage.mjs",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`from ["'][^"']*${forbidden.replaceAll(".", "\\.")}`, "u"),
      forbidden,
    );
  }
  assert.doesNotMatch(source, /\bprocess\./u);
});
