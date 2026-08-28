import {
  G17_BENCHMARK_CASES,
  G17_CONTROL_STATISTICS_CONTRACT,
} from "./control-statistics-contract.mjs";
import { g17NativeSessionEnvironment } from "./native-session-contract.mjs";
import { canonicalSha256 } from "../routing/features.mjs";

// This module is an authority-free, deterministic description of the frozen
// G1.7 Phase-A benchmark execution plan. It performs no I/O and cannot execute
// builds, launch benchmarks, approve controls, or promote a qualification.

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(message) {
  throw new Error(`G1.7 benchmark execution plan: ${message}`);
}

export const G17_BENCHMARK_LEGACY_BUILD_ARGV = deepFreeze([
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

export const G17_BENCHMARK_BUILD_PROGRAM = "/toolchain/bin/cargo";

export const G17_BENCHMARK_BUILD_ARGV = deepFreeze(
  G17_BENCHMARK_LEGACY_BUILD_ARGV.slice(1),
);

export const G17_BENCHMARK_BUILD_LAUNCHER = deepFreeze({
  cargoLogicalPath: "/toolchain/bin/cargo",
  rustcLogicalPath: "/toolchain/bin/rustc",
});

export const G17_BENCHMARK_LEGACY_BUILD_ENVIRONMENT = deepFreeze({
  CARGO_BUILD_JOBS: "4",
  CARGO_INCREMENTAL: "0",
});

const G17_BENCHMARK_NATIVE_ENVIRONMENT_PLATFORM = deepFreeze({
  schema: "oxigraph.g1.7-linux-native-platform-closure/v4",
  roles: {
    ar: { root: "platform", path: "usr/bin/x86_64-linux-gnu-ar" },
    cc: { root: "platform", path: "usr/bin/x86_64-linux-gnu-gcc-13" },
    cxx: { root: "platform", path: "usr/bin/x86_64-linux-gnu-g++-13" },
    libclang: {
      root: "platform",
      path: "usr/lib/llvm-18/lib/libclang-18.so.1",
    },
    rustc: { root: "toolchain", path: "bin/rustc" },
    rustfmt: { root: "toolchain", path: "bin/rustfmt" },
  },
});

export const G17_BENCHMARK_BUILD_ENVIRONMENT = deepFreeze(
  g17NativeSessionEnvironment(G17_BENCHMARK_NATIVE_ENVIRONMENT_PLATFORM, 4),
);

export const G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256 = canonicalSha256(
  G17_BENCHMARK_BUILD_ENVIRONMENT,
);

export const G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA =
  "oxigraph.g1.7-benchmark-native-session-environment-recipe/v1";

export const G17_BENCHMARK_ENVIRONMENT_RECIPE = deepFreeze({
  schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  source: {
    module: "qualification/native-session-contract.mjs",
    export: "g17NativeSessionEnvironment",
  },
  platformSchema: G17_BENCHMARK_NATIVE_ENVIRONMENT_PLATFORM.schema,
  cargoBuildJobs: 4,
  environment: G17_BENCHMARK_BUILD_ENVIRONMENT,
  environmentSha256: G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
});

export const G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256 = canonicalSha256(
  G17_BENCHMARK_ENVIRONMENT_RECIPE,
);

export const G17_BENCHMARK_BUILD_PLAN = deepFreeze([
  { buildId: "negative-control", productRole: "negativeControl" },
  {
    buildId: "performance-reference",
    productRole: "performanceReference",
  },
  { buildId: "noise-control-a", productRole: "noiseControl" },
  { buildId: "noise-control-b", productRole: "noiseControl" },
]);

export const G17_BENCHMARK_CONTROL_PLAN = deepFreeze([
  {
    controlName: "negativeControl",
    controlId: "negative-control",
    subject: { buildId: "negative-control", productRole: "negativeControl" },
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

function deriveControlCoordinates(control) {
  const rows = [];
  const sampleContract = G17_CONTROL_STATISTICS_CONTRACT.sampleSet;
  for (const [caseIndex, task] of G17_BENCHMARK_CASES.entries()) {
    for (const [phase, blocks] of [
      ["warmup", sampleContract.warmupBlocks],
      ["measured", sampleContract.measuredBlocks],
    ]) {
      for (let block = 0; block < blocks; block += 1) {
        const globalBlock =
          (phase === "measured" ? sampleContract.warmupBlocks : 0) + block;
        const schedule =
          sampleContract.schedules[
            globalBlock % sampleContract.schedules.length
          ];
        for (const [slot, arm] of schedule.entries()) {
          const pair = Math.floor(slot / 2);
          const build = control[arm];
          const sequence = rows.length;
          rows.push({
            controlId: control.controlId,
            sequence,
            buildId: build.buildId,
            productRole: build.productRole,
            arm,
            task,
            databasePath:
              task.backend === "rocksdb"
                ? `/state/databases/${control.controlId}/${String(sequence).padStart(3, "0")}`
                : null,
            coordinate: {
              caseId: task.id,
              phase,
              block,
              pair,
              slot,
              repetition: globalBlock * schedule.length + slot,
              seed:
                sampleContract.executionSeed.base +
                caseIndex * 100_000 +
                globalBlock * 2 +
                pair,
            },
          });
        }
      }
    }
  }
  return deepFreeze(rows);
}

const CONTROL_COORDINATES = deepFreeze(
  Object.fromEntries(
    G17_BENCHMARK_CONTROL_PLAN.map((control) => [
      control.controlName,
      deriveControlCoordinates(control),
    ]),
  ),
);

export const G17_BENCHMARK_EXECUTION_PLAN_SCHEMA =
  "oxigraph.g1.7-benchmark-execution-plan/v2";

export const G17_BENCHMARK_EXECUTION_PLAN = deepFreeze({
  schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  build: {
    program: G17_BENCHMARK_BUILD_PROGRAM,
    launcher: G17_BENCHMARK_BUILD_LAUNCHER,
    workingDirectory: "/workspace/source",
    targetDirectory: "/state/target",
    argv: G17_BENCHMARK_BUILD_ARGV,
    environment: G17_BENCHMARK_BUILD_ENVIRONMENT,
    environmentSha256: G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
    environmentRecipe: {
      schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
      sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
    },
    privateDirectories: {
      cargoHome: "/cargo-home",
      home: "/state/home",
      temporary: "/state/tmp",
    },
    rustcRequest: {
      mechanism: "exact-reviewed-environment-RUSTC",
      logicalPath: G17_BENCHMARK_BUILD_LAUNCHER.rustcLogicalPath,
      directChildExecutionEvidence: false,
    },
    nonclaims: {
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
    },
  },
  builds: G17_BENCHMARK_BUILD_PLAN,
  controls: G17_BENCHMARK_CONTROL_PLAN,
  coordinates: Object.fromEntries(
    G17_BENCHMARK_CONTROL_PLAN.map(({ controlName }) => [
      controlName,
      {
        rows: CONTROL_COORDINATES[controlName],
        sha256: canonicalSha256(CONTROL_COORDINATES[controlName]),
      },
    ]),
  ),
});

export const G17_BENCHMARK_EXECUTION_PLAN_SHA256 = canonicalSha256(
  G17_BENCHMARK_EXECUTION_PLAN,
);

export function g17BenchmarkControlCoordinates(controlName) {
  if (
    typeof controlName !== "string" ||
    !Object.hasOwn(CONTROL_COORDINATES, controlName)
  ) {
    fail("controlName is not part of the frozen Phase-A control plan");
  }
  return CONTROL_COORDINATES[controlName];
}

export function g17BenchmarkLaunchArgv(executablePath, controlName, sequence) {
  if (
    typeof executablePath !== "string" ||
    !/^\/state\/target\/release\/deps\/transactional_write-[a-zA-Z0-9._-]+$/u.test(
      executablePath,
    )
  ) {
    fail("executablePath is not a reviewed benchmark logical path");
  }
  const coordinates = g17BenchmarkControlCoordinates(controlName);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence >= coordinates.length
  ) {
    fail("sequence is outside the reviewed control coordinates");
  }
  const expected = coordinates[sequence];
  const argv = [
    executablePath,
    "--case",
    expected.task.id,
    "--operations",
    String(expected.task.operations),
    "--seed",
    String(expected.coordinate.seed),
  ];
  if (expected.databasePath !== null) {
    argv.push("--database", expected.databasePath);
  }
  return deepFreeze(argv);
}
