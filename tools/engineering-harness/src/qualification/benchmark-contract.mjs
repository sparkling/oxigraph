import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { harnessRoot } from "../paths.mjs";

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const G17_QUALIFICATION_SAMPLE_SCHEMA =
  "oxigraph.g1.7-qualification-sample/v2";
export const G17_BENCHMARK_SUITE_HASH =
  "533a1501130971712ef5ca2a62b3ddfd9115eaaf0b650baacd1e5f04ed44aaba";
export const G17_PERFORMANCE_SLOWDOWN_BASIS_POINTS = 1_000;
export const G17_NOISE_MAD_BASIS_POINTS = 500;
export const G17_DARWIN_STATISTICS = deepFreeze({
  package: "@metaharness/darwin",
  version: "0.9.3",
  packageIntegrity:
    "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
  api: "security.bootstrapDelta",
  statisticsModuleSha256:
    "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
  samples: 5_000,
  baseSeed: 170_017,
  caseSeedDerivation: "base-plus-case-index",
  minDelta: 0,
  scorePrecisionDecimals: 12,
  decision: "lower95-strictly-positive",
});
export const G17_DARWIN_RUNTIME_MODULES = deepFreeze({
  "dist/bench/index.js":
    "7d0b3f9bc068abfe0d1f867dac141abc96923c6533fceeb852fcb7d7fa0555ab",
  "dist/bench/stats.js":
    "f4ca03dd0ef2edf4b1f85d2fe4aaa7d3c1fdb7b8ffc376436a1a18bba6fff110",
  "dist/bench/suite.js":
    "2b5494a4189b3cebb1078e45666da8e2bd5426c05e2cea32802f38aa081ffdca",
  "dist/index.js":
    "394902754a912108210a2016846f54e0f596c71ac2ef476b723aa6e9474dda7e",
  "dist/security/agents.js":
    "3774952d43be5a97effb9e497848cf63ef02f10f10c838dc2d9ffcf25b2c025d",
  "dist/security/corpus.js":
    "22276dac624e9c1f33dd1791a4a830f7f6031e3dd43808098f6f70650c8157d0",
  "dist/security/index.js":
    "8d1c34de7a81362fd609736e13878230105030389eecc452fe3fd440a18d17b2",
  "dist/security/memory.js":
    "d49b736942de4ea8fe44b187960cf5113cd6c8ac23f50e121c91c30371d3e0de",
  "dist/security/policy.js":
    "cae70a89d55885cd50bb59c44f6632f4e8329e3ae3b74938421534aab08abe81",
  "dist/security/scoring.js":
    "81a79eabdeb120b0398850647c4b4c15cb2a3e93ead44187e62f2ac172fecc2e",
  "dist/security/stats.js":
    "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
  "dist/security/swarm.js":
    "ce36eea7d305cb4be7d556da0d377855b2b448b69a951e52a692759ddb163ab9",
  "dist/security/util.js":
    "264045fbd320d62f0056243d3af08ee4c18671ea74ad52406b117b4ff5fe0433",
});

export const G17_BENCHMARK_CASES = deepFreeze([
  {
    id: "on-store-memory",
    backend: "memory",
    binding: "on-store",
    writers: 1,
    concurrentReaders: false,
    operations: 10_000,
  },
  {
    id: "on-dataset-memory",
    backend: "memory",
    binding: "on-dataset",
    writers: 1,
    concurrentReaders: false,
    operations: 10_000,
  },
  {
    id: "on-store-rocksdb",
    backend: "rocksdb",
    binding: "on-store",
    writers: 1,
    concurrentReaders: false,
    operations: 10_000,
  },
  {
    id: "on-dataset-rocksdb",
    backend: "rocksdb",
    binding: "on-dataset",
    writers: 1,
    concurrentReaders: false,
    operations: 10_000,
  },
  {
    id: "writers-1-rocksdb",
    backend: "rocksdb",
    binding: "transaction",
    writers: 1,
    concurrentReaders: true,
    operations: 1_000,
  },
  {
    id: "writers-4-rocksdb",
    backend: "rocksdb",
    binding: "transaction",
    writers: 4,
    concurrentReaders: true,
    operations: 1_000,
  },
  {
    id: "writers-16-rocksdb",
    backend: "rocksdb",
    binding: "transaction",
    writers: 16,
    concurrentReaders: true,
    operations: 1_000,
  },
]);

export const G17_BENCHMARK_CASE_IDS = Object.freeze(
  G17_BENCHMARK_CASES.map(({ id }) => id),
);

function fail(message) {
  throw new Error(`G1.7 Darwin runtime: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableRead(path, maximumBytes, label) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    fail("O_NOFOLLOW is unavailable");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 1n ||
      before.size > BigInt(maximumBytes)
    ) {
      fail(`${label} is not a bounded regular file`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) {
        fail(`${label} changed while being read`);
      }
    }
    if (BigInt(bytes.length) !== before.size) {
      fail(`${label} read length drifted`);
    }
    return bytes;
  } catch (error) {
    if (error.message.startsWith("G1.7 Darwin runtime:")) throw error;
    fail(`${label} cannot be read safely: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

export function verifyG17DarwinRuntime({
  root = harnessRoot,
  resolvedEntryPath = fileURLToPath(import.meta.resolve("@metaharness/darwin")),
} = {}) {
  const resolvedRoot = resolve(root);
  const packageRoot = join(
    resolvedRoot,
    "node_modules",
    "@metaharness",
    "darwin",
  );
  const expectedEntryPath = join(packageRoot, "dist", "index.js");
  const lockPath = join(resolvedRoot, "package-lock.json");
  const packageJsonPath = join(packageRoot, "package.json");

  if (
    resolve(resolvedEntryPath) !== expectedEntryPath ||
    realpathSync(packageRoot) !== packageRoot ||
    Object.keys(G17_DARWIN_RUNTIME_MODULES).some((modulePath) =>
      relative(packageRoot, join(packageRoot, modulePath))
        .split(sep)
        .some((part) => part === ".."),
    )
  ) {
    fail("resolved package root or entry point drifted");
  }

  const packageJson = parseJson(
    stableRead(packageJsonPath, 256 * 1024, "package manifest"),
    "package manifest",
  );
  const lock = parseJson(
    stableRead(lockPath, 4 * 1024 * 1024, "package lock"),
    "package lock",
  );
  const lockEntry = lock?.packages?.["node_modules/@metaharness/darwin"];
  if (
    packageJson?.name !== G17_DARWIN_STATISTICS.package ||
    packageJson.version !== G17_DARWIN_STATISTICS.version ||
    lockEntry?.version !== G17_DARWIN_STATISTICS.version ||
    lockEntry?.integrity !== G17_DARWIN_STATISTICS.packageIntegrity
  ) {
    fail("package version or lock integrity drifted");
  }
  for (const [modulePath, expectedSha256] of Object.entries(
    G17_DARWIN_RUNTIME_MODULES,
  )) {
    const observedSha256 = sha256(
      stableRead(join(packageRoot, modulePath), 1024 * 1024, modulePath),
    );
    if (observedSha256 !== expectedSha256) {
      fail(`${modulePath} digest drifted`);
    }
  }

  return deepFreeze({
    package: G17_DARWIN_STATISTICS.package,
    version: packageJson.version,
    packageIntegrity: lockEntry.integrity,
    statisticsModuleSha256: G17_DARWIN_STATISTICS.statisticsModuleSha256,
    moduleSha256: G17_DARWIN_RUNTIME_MODULES,
    resolvedEntry: "dist/index.js",
  });
}

export async function loadG17DarwinFunctions(options) {
  const verification = verifyG17DarwinRuntime(options);
  const root = resolve(options?.root ?? harnessRoot);
  const packageRoot = join(root, "node_modules", "@metaharness", "darwin");
  const [benchSuite, benchStats, securityStats] = await Promise.all([
    import(pathToFileURL(join(packageRoot, "dist", "bench", "suite.js"))),
    import(pathToFileURL(join(packageRoot, "dist", "bench", "stats.js"))),
    import(pathToFileURL(join(packageRoot, "dist", "security", "stats.js"))),
  ]);
  if (
    typeof benchSuite.hashTasks !== "function" ||
    typeof benchSuite.verifySuite !== "function" ||
    typeof benchStats.bootstrapDelta !== "function" ||
    typeof securityStats.bootstrapDelta !== "function"
  ) {
    fail("verified Darwin modules do not expose the required functions");
  }
  return Object.freeze({
    verification,
    hashTasks: benchSuite.hashTasks,
    verifySuite: benchSuite.verifySuite,
    unpairedBootstrapDelta: benchStats.bootstrapDelta,
    pairedBootstrapDelta: securityStats.bootstrapDelta,
  });
}
