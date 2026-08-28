import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_LAUNCHER,
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_CONTROL_PLAN,
  G17_BENCHMARK_ENVIRONMENT_RECIPE,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
  G17_BENCHMARK_LEGACY_BUILD_ARGV,
  G17_BENCHMARK_LEGACY_BUILD_ENVIRONMENT,
  g17BenchmarkControlCoordinates,
  g17BenchmarkLaunchArgv,
} from "../src/qualification/benchmark-execution-plan.mjs";
import { verifyG17BenchmarkOwnerBundle } from "../src/qualification/benchmark-owner-contract.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import { createG17BenchmarkOwnerFixture } from "./support/g17-benchmark-owner-fixture.mjs";

const EXECUTABLE = "/state/target/release/deps/transactional_write-fixture";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("execution plan exposes the exact frozen build and control inventory", () => {
  assert.deepEqual(G17_BENCHMARK_LEGACY_BUILD_ARGV, [
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
  assert.deepEqual(G17_BENCHMARK_BUILD_ARGV, [
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
  assert.equal(G17_BENCHMARK_BUILD_PROGRAM, "/toolchain/bin/cargo");
  assert.deepEqual(G17_BENCHMARK_LEGACY_BUILD_ENVIRONMENT, {
    CARGO_BUILD_JOBS: "4",
    CARGO_INCREMENTAL: "0",
  });
  assert.deepEqual(G17_BENCHMARK_BUILD_ENVIRONMENT, {
    AR: "/usr/bin/x86_64-linux-gnu-ar",
    CARGO_BUILD_JOBS: "4",
    CARGO_HOME: "/cargo-home",
    CARGO_INCREMENTAL: "0",
    CARGO_NET_OFFLINE: "true",
    CARGO_PROFILE_TEST_DEBUG: "0",
    CARGO_TARGET_DIR: "/state/target",
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER:
      "/usr/bin/x86_64-linux-gnu-gcc-13",
    CARGO_TERM_COLOR: "never",
    CC: "/usr/bin/x86_64-linux-gnu-gcc-13",
    CXX: "/usr/bin/x86_64-linux-gnu-g++-13",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/state/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LD_LIBRARY_PATH:
      "/toolchain/lib:/usr/lib/llvm-18/lib:/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu",
    LIBCLANG_PATH: "/usr/lib/llvm-18/lib",
    LLVM_CONFIG_PATH: "/nonexistent",
    NO_COLOR: "1",
    PATH: "/toolchain/bin:/usr/bin",
    RUSTC: "/toolchain/bin/rustc",
    RUSTFMT: "/toolchain/bin/rustfmt",
    SOURCE_DATE_EPOCH: "946684800",
    TEMP: "/state/tmp",
    TERM: "dumb",
    TMP: "/state/tmp",
    TMPDIR: "/state/tmp",
    TZ: "UTC",
    USER: "sandbox",
  });
  assert.equal(
    G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
    "c4b7b35072ba92da4934d1501407f78a4f88d7b92031687259967c805fcfc8ad",
  );
  assert.equal(
    G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
    "oxigraph.g1.7-benchmark-native-session-environment-recipe/v1",
  );
  assert.equal(
    G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
    "3299b02ecd9a1c8b071d3788b5d4a8cb940ca4dc634c37234273082e53640aa4",
  );
  assert.equal(
    G17_BENCHMARK_ENVIRONMENT_RECIPE.environmentSha256,
    G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  );
  assert.deepEqual(G17_BENCHMARK_BUILD_LAUNCHER, {
    cargoLogicalPath: "/toolchain/bin/cargo",
    rustcLogicalPath: "/toolchain/bin/rustc",
  });
  assert.deepEqual(G17_BENCHMARK_EXECUTION_PLAN.build.nonclaims, {
    cargoProcessExecutableIdentityIndependentlyObserved: false,
    heldCargoExecutionViaExecveatVerified: false,
    cargoConfigAndVendorContentsIndependentlyVerified: false,
    homeAndTemporaryContentsIndependentlyVerified: false,
    privateDirectoryCreationIndependentlyVerified: false,
    privateDirectoryProvenanceIndependentlyVerified: false,
    privateDirectoryOwnershipIndependentlyVerified: false,
    privateDirectoryPermissionsIndependentlyVerified: false,
    privateDirectoryAncestryIndependentlyVerified: false,
    cargoSelectedRequestedRustcIndependentlyVerified: false,
    directRustcChildExecutionObserved: false,
    directRustcChildRawEvidenceReplayed: false,
  });
  assert.deepEqual(G17_BENCHMARK_BUILD_PLAN, [
    { buildId: "negative-control", productRole: "negativeControl" },
    {
      buildId: "performance-reference",
      productRole: "performanceReference",
    },
    { buildId: "noise-control-a", productRole: "noiseControl" },
    { buildId: "noise-control-b", productRole: "noiseControl" },
  ]);
  assert.deepEqual(G17_BENCHMARK_CONTROL_PLAN, [
    {
      controlName: "negativeControl",
      controlId: "negative-control",
      subject: {
        buildId: "negative-control",
        productRole: "negativeControl",
      },
      reference: {
        buildId: "performance-reference",
        productRole: "performanceReference",
      },
    },
    {
      controlName: "aaNoiseControl",
      controlId: "a-a-noise-control",
      subject: { buildId: "noise-control-a", productRole: "noiseControl" },
      reference: { buildId: "noise-control-b", productRole: "noiseControl" },
    },
  ]);

  for (const value of [
    G17_BENCHMARK_BUILD_ARGV,
    G17_BENCHMARK_BUILD_ENVIRONMENT,
    G17_BENCHMARK_ENVIRONMENT_RECIPE,
    G17_BENCHMARK_BUILD_LAUNCHER,
    G17_BENCHMARK_BUILD_PLAN,
    G17_BENCHMARK_CONTROL_PLAN,
    G17_BENCHMARK_EXECUTION_PLAN,
  ]) {
    assertDeepFrozen(value);
  }
  assert.throws(() => G17_BENCHMARK_BUILD_ARGV.push("--release"), TypeError);
  assert.throws(
    () => {
      G17_BENCHMARK_CONTROL_PLAN[0].subject.buildId = "substituted";
    },
    TypeError,
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
    "oxigraph.g1.7-benchmark-execution-plan/v2",
  );
  assert.equal(
    G17_BENCHMARK_EXECUTION_PLAN_SHA256,
    "ed85e4bd9ba926ed08157195d46144506cc0998cef3b7bb22e769ebf78b299e9",
  );
});

test("coordinate generation is exact, deterministic, bounded, and immutable", () => {
  const expectedHashes = {
    negativeControl:
      "d58871b56bb374c8166e572f31afae0967f711d402c9cb56a436a3aa206f17ad",
    aaNoiseControl:
      "aec35cb793257d31c458a1a459f8319281654bc72d81125b2d01994a0ae07fda",
  };

  for (const control of G17_BENCHMARK_CONTROL_PLAN) {
    const rows = g17BenchmarkControlCoordinates(control.controlName);
    assert.equal(rows.length, 196);
    assert.equal(sha256(canonicalJson(rows)), expectedHashes[control.controlName]);
    assert.strictEqual(
      g17BenchmarkControlCoordinates(control.controlName),
      rows,
    );
    assertDeepFrozen(rows);
    assert.deepEqual(
      rows.map(({ sequence }) => sequence),
      Array.from({ length: 196 }, (_, sequence) => sequence),
    );
    assert.deepEqual(
      rows.slice(0, 8).map(({ arm }) => arm),
      [
        "subject",
        "reference",
        "reference",
        "subject",
        "reference",
        "subject",
        "subject",
        "reference",
      ],
    );

    const databasePaths = rows
      .map(({ databasePath }) => databasePath)
      .filter((path) => path !== null);
    assert.equal(databasePaths.length, 140);
    assert.equal(new Set(databasePaths).size, 140);
    assert.equal(
      rows.filter(({ databasePath }) => databasePath === null).length,
      56,
    );
    assert.ok(
      databasePaths.every((path) =>
        path.startsWith(`/state/databases/${control.controlId}/`),
      ),
    );
  }

  const negative = g17BenchmarkControlCoordinates("negativeControl");
  assert.deepEqual(negative[0].coordinate, {
    caseId: "on-store-memory",
    phase: "warmup",
    block: 0,
    pair: 0,
    slot: 0,
    repetition: 0,
    seed: 170_017,
  });
  assert.equal(negative[0].buildId, "negative-control");
  assert.equal(negative[0].databasePath, null);
  assert.deepEqual(negative.at(-1).coordinate, {
    caseId: "writers-16-rocksdb",
    phase: "measured",
    block: 4,
    pair: 1,
    slot: 3,
    repetition: 27,
    seed: 770_030,
  });
  assert.equal(negative.at(-1).buildId, "negative-control");
  assert.equal(
    negative.at(-1).databasePath,
    "/state/databases/negative-control/195",
  );

  assert.throws(
    () => g17BenchmarkControlCoordinates("qualification"),
    /not part of the frozen Phase-A control plan/u,
  );
  assert.throws(() => g17BenchmarkControlCoordinates(null), /controlName/u);
});

test("launch argv is derived only from one reviewed coordinate", () => {
  const rows = g17BenchmarkControlCoordinates("negativeControl");
  assert.deepEqual(
    g17BenchmarkLaunchArgv(EXECUTABLE, "negativeControl", 0),
    [
    EXECUTABLE,
    "--case",
    "on-store-memory",
    "--operations",
    "10000",
    "--seed",
    "170017",
    ],
  );
  assert.deepEqual(
    g17BenchmarkLaunchArgv(EXECUTABLE, "negativeControl", rows.length - 1),
    [
    EXECUTABLE,
    "--case",
    "writers-16-rocksdb",
    "--operations",
    "1000",
    "--seed",
    "770030",
    "--database",
    "/state/databases/negative-control/195",
    ],
  );
  assertDeepFrozen(
    g17BenchmarkLaunchArgv(EXECUTABLE, "negativeControl", rows.length - 1),
  );
  assert.throws(
    () => g17BenchmarkLaunchArgv("", "negativeControl", 0),
    /executablePath/u,
  );
  assert.throws(
    () => g17BenchmarkLaunchArgv(EXECUTABLE, "negativeControl", rows.length),
    /sequence/u,
  );
  let reads = 0;
  const arbitraryCoordinate = Object.defineProperty({}, "task", {
    get() {
      reads += 1;
      return { id: "unreviewed" };
    },
  });
  assert.throws(
    () => g17BenchmarkLaunchArgv(EXECUTABLE, arbitraryCoordinate, 0),
    /controlName/u,
  );
  assert.equal(reads, 0);
});

test(
  "owner replay consumes the shared plan without changing its frozen projection",
  () => {
    const fixture = createG17BenchmarkOwnerFixture();
    const projection = verifyG17BenchmarkOwnerBundle({
      authorization: fixture.authorization,
      authorizationRawSha256: fixture.authorizationRawSha256,
      controlRunId: fixture.controlRunId,
      artifacts: fixture.artifacts,
    });
    assert.equal(
      sha256(canonicalJson(projection)),
      "5555e51ad7f0ec8cd20df3d47fa85028434827448ff1b1f017f7c09491e67d23",
    );
  },
);

test(
  "execution plan shares the pure native-session environment recipe without authority",
  async () => {
    const planSource = await readFile(
      new URL(
        "../src/qualification/benchmark-execution-plan.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const ownerSource = await readFile(
      new URL(
        "../src/qualification/benchmark-owner-contract.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.deepEqual(
      [...planSource.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map(
        (match) => match[1],
      ),
      [
        "./control-statistics-contract.mjs",
        "./native-session-contract.mjs",
        "../routing/features.mjs",
      ],
    );
    assert.doesNotMatch(planSource, /\bimport\s*\(/u);
    assert.doesNotMatch(planSource, /\bprocess\s*(?:\.|\[)/u);
    assert.doesNotMatch(
      planSource,
      /(?:node:|@metaharness\/darwin|provider|router|contained-session|storage\.mjs)/u,
    );
    assert.doesNotMatch(
      JSON.stringify({
        buildArgv: G17_BENCHMARK_BUILD_ARGV,
        buildEnvironment: G17_BENCHMARK_BUILD_ENVIRONMENT,
        builds: G17_BENCHMARK_BUILD_PLAN,
        controls: G17_BENCHMARK_CONTROL_PLAN,
      }),
      /authority|approval|qualification|promotion|publication|receipt/u,
    );
    assert.match(ownerSource, /from "\.\/benchmark-execution-plan\.mjs"/u);
    assert.doesNotMatch(
      ownerSource,
      /const BUILD_ARGV|function controlCoordinates/u,
    );
  },
);
