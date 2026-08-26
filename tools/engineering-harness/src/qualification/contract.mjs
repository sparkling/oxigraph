import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { bench } from "@metaharness/darwin";
import { harnessRoot } from "../paths.mjs";

export const G17_CONTRACT_SCHEMA =
  "oxigraph.g1.7-qualification-contract/v1";
export const g17ContractPath = join(
  harnessRoot,
  "qualification",
  "g1.7",
  "contract.json",
);

const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const MAX_CONTRACT_BYTES = 1024 * 1024;
const AUTHORITY = Object.freeze({
  localOnly: true,
  promotionAuthority: false,
  routerQualityAuthority: false,
  publicationAuthority: false,
});
const ABSENT_DECISION = Object.freeze({
  status: "ABSENT",
  path: null,
  sha256: null,
  approvedBy: null,
  approvedAt: null,
});
const UNSELECTED_REFERENCE = Object.freeze({
  status: "UNSELECTED",
  commit: null,
  tree: null,
  approvedBy: null,
  approvedAt: null,
});
const EXPECTED_EVALUATOR = Object.freeze({
  commit: "3aca932e4062f9b087adfa486fac936b5bbeaebb",
  parent: "623adae314f3c4093d563900f6376ce78262a9f0",
  tree: "a8b0310482b88a813aa602ebb7264b259e066586",
  paths: [
    {
      path: "lib/oxigraph/Cargo.toml",
      changeStatus: "M",
      blob: "8b4a1d3f82829d0f2780b88904f8bd2149151020",
      contentSha256:
        "e83b4ab43124affe47706192de6af6ae462bf6d819f66e8caecf3897888bb868",
    },
    {
      path: "lib/oxigraph/benches/transactional_write.rs",
      changeStatus: "A",
      blob: "07560ff94aaf12f9c4bd3e70e58a61edf3446fcb",
      contentSha256:
        "4a1ce885de13b2db4562195c2735b350e0623109c52a44d54f6b7b0076e10727",
    },
  ],
  patchSha256:
    "3c3df24b0021b1bfebb42ffed2ff9a2c228d7e0ac302c4a5aa9e6b6e8e68db46",
});
const EXPECTED_CASES = Object.freeze([
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
const EXPECTED_AGENTIC_COMMANDS = Object.freeze([
  "g11TransactionStateModel",
  "g12TransactionConcurrency",
  "g13TransactionCapabilities",
  "g14RocksdbWriterSerialization",
  "g15SparqlEgressPolicy",
  "g15bSparqlUpdateCancellation",
  "g15cSparqlNegotiatedUpdate",
  "g16EffectiveCapabilities",
  "g16ServiceClaims",
  "g16CompatibilityCanary",
  "g16SparqlVersion",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) {
    throw new Error(`${label} fields are not exact`);
  }
}

function assertInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function validateContract(value) {
  exactKeys(
    value,
    [
      "schema",
      "id",
      "programme",
      "decisions",
      "objective",
      "authority",
      "evaluator",
      "referenceDecision",
      "budgetDecision",
      "noiseDecision",
      "benchmark",
      "compatibility",
      "artifactPolicy",
    ],
    "contract",
  );
  assertInvariant(value.schema === G17_CONTRACT_SCHEMA, "schema is not v1");
  assertInvariant(
    value.id === "g1.7-compatibility-performance-qualification" &&
      value.programme === "linked-data-store",
    "identity drifted",
  );
  assertInvariant(
    isDeepStrictEqual(value.decisions, ["ADR-0017", "ADR-0018", "ADR-0019"]),
    "decision binding drifted",
  );
  assertInvariant(
    typeof value.objective === "string" && value.objective.length > 32,
    "objective is missing",
  );
  assertInvariant(isDeepStrictEqual(value.authority, AUTHORITY), "authority drifted");
  assertInvariant(
    isDeepStrictEqual(value.evaluator, EXPECTED_EVALUATOR),
    "evaluator binding drifted",
  );
  assertInvariant(
    GIT_OBJECT.test(value.evaluator.commit) &&
      GIT_OBJECT.test(value.evaluator.parent) &&
      GIT_OBJECT.test(value.evaluator.tree) &&
      DIGEST.test(value.evaluator.patchSha256),
    "evaluator identifiers are malformed",
  );
  assertInvariant(
    isDeepStrictEqual(value.referenceDecision, UNSELECTED_REFERENCE),
    "reference decision is not the reviewed unselected state",
  );
  assertInvariant(
    isDeepStrictEqual(value.budgetDecision, ABSENT_DECISION),
    "performance budget decision is not the reviewed absent state",
  );
  assertInvariant(
    isDeepStrictEqual(value.noiseDecision, ABSENT_DECISION),
    "noise budget decision is not the reviewed absent state",
  );

  exactKeys(value.benchmark, ["suite", "build", "protocol", "statistics"], "benchmark");
  const { suite, build, protocol, statistics } = value.benchmark;
  exactKeys(suite, ["id", "version", "taskHash", "tasks"], "benchmark suite");
  assertInvariant(
    suite.id === "oxigraph-g1.7-transactional-write" && suite.version === "1",
    "benchmark suite identity drifted",
  );
  assertInvariant(isDeepStrictEqual(suite.tasks, EXPECTED_CASES), "benchmark cases drifted");
  assertInvariant(DIGEST.test(suite.taskHash), "benchmark suite hash is malformed");
  const suiteVerification = bench.verifySuite(suite);
  assertInvariant(
    suiteVerification.ok && suite.taskHash === bench.hashTasks(suite.tasks),
    "Darwin suite hash does not verify",
  );
  assertInvariant(
    isDeepStrictEqual(build, {
      argv: [
        "cargo",
        "bench",
        "--locked",
        "--offline",
        "-p",
        "oxigraph",
        "--bench",
        "transactional_write",
        "--no-run",
      ],
      target: "transactional_write",
      profile: "bench",
      buildOnceBeforeTiming: true,
    }),
    "benchmark build contract drifted",
  );
  assertInvariant(
    isDeepStrictEqual(protocol, {
      sampleSchema: "oxigraph.transactional-write-sample/v1",
      qualificationSampleSchema: "oxigraph.g1.7-qualification-sample/v1",
      schedules: [
        ["subject", "reference", "reference", "subject"],
        ["reference", "subject", "subject", "reference"],
      ],
      warmupBlocks: 2,
      measuredBlocks: 5,
      seed: 170_017,
      seedDerivation: "base-plus-case100000-plus-globalblock2-plus-pair",
      exclusive: true,
      nonTmpfsVolume: true,
      adaptiveStopping: false,
      outlierDeletion: false,
    }),
    "benchmark protocol drifted",
  );
  assertInvariant(
    isDeepStrictEqual(statistics, {
      owner: "@metaharness/darwin",
      suiteHashApi: "bench.hashTasks",
      suiteVerifyApi: "bench.verifySuite",
      bootstrapApi: "bench.bootstrapDelta",
      bootstrapSamples: 5_000,
      bootstrapSeed: 170_017,
      bootstrapScore: "negative-elapsed-nanoseconds",
      median: "integer-midpoint-floor",
      p95: "nearest-rank",
      dispersion: "median-absolute-deviation",
    }),
    "benchmark statistics contract drifted",
  );

  exactKeys(value.compatibility, ["agenticQe", "native", "semantic"], "compatibility");
  assertInvariant(
    isDeepStrictEqual(value.compatibility.agenticQe, {
      profile: "g1-regression",
      commandIds: EXPECTED_AGENTIC_COMMANDS,
      expectedCommands: 11,
      expectedPassedTests: 66,
    }),
    "Agentic-QE G1 profile drifted",
  );
  assertInvariant(
    isDeepStrictEqual(value.compatibility.native, [
      {
        id: "transaction-compatibility",
        argv: [
          "cargo",
          "test",
          "--locked",
          "--offline",
          "-p",
          "oxigraph",
          "--test",
          "transaction_compatibility",
        ],
        expectedPassedTests: 20,
      },
      {
        id: "bulk-sst-writer-serialization",
        argv: [
          "cargo",
          "test",
          "--locked",
          "--offline",
          "-p",
          "oxigraph",
          "--test",
          "rocksdb_bulk_writer_serialization",
        ],
        expectedPassedTests: 1,
      },
      {
        id: "update-atomicity",
        argv: [
          "cargo",
          "test",
          "--locked",
          "--offline",
          "-p",
          "oxigraph",
          "--test",
          "update_atomicity",
        ],
        expectedPassedTests: 2,
      },
    ]),
    "native compatibility lanes drifted",
  );
  assertInvariant(
    isDeepStrictEqual(value.compatibility.semantic, {
      qualificationPath: "target/metaharness/qualification.json",
      verificationPath: "target/metaharness/verification.json",
      requireFull: true,
    }),
    "semantic prerequisite drifted",
  );
  assertInvariant(
    isDeepStrictEqual(value.artifactPolicy, {
      receiptSchema: "oxigraph.g1.7-qualification-receipt/v1",
      runDirectory: "tools/engineering-harness/.runtime/g1.7/runs",
      writeOnce: true,
      regularFilesOnly: true,
      singleLinkOnly: true,
      ownerOnly: true,
      maxFiles: 64,
      maxBytes: 67_108_864,
    }),
    "artifact policy drifted",
  );
  return value;
}

export function validateG17Contract(value) {
  try {
    return deepFreeze(validateContract(value));
  } catch (error) {
    throw new Error(`G1.7 qualification contract: ${error.message}`);
  }
}

export function loadG17Contract({ contractPath = g17ContractPath } = {}) {
  const metadata = lstatSync(contractPath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > MAX_CONTRACT_BYTES
  ) {
    throw new Error("G1.7 qualification contract must be a bounded regular file");
  }
  const bytes = readFileSync(contractPath);
  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`G1.7 qualification contract is invalid JSON: ${error.message}`);
  }
  return Object.freeze({
    contract: validateG17Contract(parsed),
    bytes,
    contractSha256: sha256(bytes),
  });
}
