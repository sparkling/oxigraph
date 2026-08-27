import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { bench } from "@metaharness/darwin";
import { harnessRoot } from "../paths.mjs";

export const G17_CONTRACT_SCHEMA =
  "oxigraph.g1.7-qualification-contract/v3";
export const G17_LEGACY_CONTRACT_SHA256 =
  "e267e4d276a3d0b7997c2522d3f24ca7a32f669282c5f2ea332a752c3322c54c";
export const G17_CURRENT_CONTRACT_SHA256 =
  "de547f5bc4a484f83da1b3d9167c4969766189455a22f9dcf542b471a8b77278";
export const G17_CONTRACT_GENERATION = Object.freeze({
  LEGACY_V1: "LEGACY_V1",
  CURRENT_V3: "CURRENT_V3",
});
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
const EXPECTED_NATIVE_SESSION = Object.freeze({
  maxTotalWallMs: 1_860_000,
  maxResidentBytes: 17_179_869_184,
  maxDiskBytes: 12_884_901_888,
  cargoBuildJobs: 4,
  tasksMax: 512,
  memorySwapMaxBytes: 0,
});
const EXPECTED_NATIVE_LANES = Object.freeze([
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
    expectedTestIds: [
      "external_fault_adapter_preserves_the_legacy_transaction_traits",
      "injected_open_failure_does_not_construct_or_mutate_a_transaction",
      "injected_prepublication_commit_failure_preserves_source_without_rollback_claim",
      "injected_read_iteration_failure_rolls_back_and_preserves_source",
      "injected_rollback_failure_reports_both_failures_and_preserves_source",
      "injected_second_mutation_failure_rolls_back_all_staged_state",
      "memory_drop_releases_writer_without_publication",
      "memory_explicit_rollback_releases_writer_without_publication",
      "memory_one_four_and_sixteen_writers_are_serialized_without_lost_commits",
      "memory_queued_writer_cancellation_is_bounded_and_leak_free",
      "memory_readers_remain_live_and_do_not_see_staged_writes",
      "memory_store_rejects_durable_outcome_lookup_before_writer_open",
      "public_transaction_enums_preserve_the_g1_source_shape",
      "rocksdb_drop_releases_writer_without_publication",
      "rocksdb_explicit_rollback_releases_writer_without_publication",
      "rocksdb_one_four_and_sixteen_writers_are_serialized_without_lost_commits",
      "rocksdb_queued_writer_cancellation_is_bounded_and_leak_free",
      "rocksdb_readers_remain_live_and_do_not_see_staged_writes",
      "rocksdb_store_rejects_durable_outcome_lookup_before_writer_open",
      "rocksdb_without_atomicity_keeps_prior_ingestions_when_later_work_is_dropped",
    ],
    expectedPassedTests: 20,
    maxOutputBytes: 1_048_576,
    timeoutMs: 300_000,
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
    expectedTestIds: [
      "rocksdb_bulk_sst_publication_waits_for_the_active_writer",
    ],
    expectedPassedTests: 1,
    maxOutputBytes: 1_048_576,
    timeoutMs: 300_000,
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
    expectedTestIds: [
      "tests::failing_update_operation_aborts_all_following_operations",
      "tests::whole_update_request_rolls_back_when_a_later_operation_fails",
    ],
    expectedPassedTests: 2,
    maxOutputBytes: 1_048_576,
    timeoutMs: 300_000,
  },
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
  assertInvariant(value.schema === G17_CONTRACT_SCHEMA, "schema is not v3");
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

  exactKeys(
    value.compatibility,
    ["agenticQe", "native", "nativeSession", "semantic"],
    "compatibility",
  );
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
    isDeepStrictEqual(value.compatibility.native, EXPECTED_NATIVE_LANES),
    "native compatibility lanes drifted",
  );
  assertInvariant(
    isDeepStrictEqual(value.compatibility.nativeSession, EXPECTED_NATIVE_SESSION),
    "native whole-session policy drifted",
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

export function decodeSealedG17Contract({ bytes, receiptSha256 }) {
  try {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > MAX_CONTRACT_BYTES
    ) {
      throw new Error("copied bytes are not a bounded Buffer");
    }
    const contractSha256 = sha256(bytes);
    if (!DIGEST.test(receiptSha256 ?? "") || receiptSha256 !== contractSha256) {
      throw new Error("copied bytes differ from the receipt digest");
    }
    let generation;
    if (contractSha256 === G17_LEGACY_CONTRACT_SHA256) {
      generation = G17_CONTRACT_GENERATION.LEGACY_V1;
    } else if (contractSha256 === G17_CURRENT_CONTRACT_SHA256) {
      generation = G17_CONTRACT_GENERATION.CURRENT_V3;
    } else {
      throw new Error("copied contract has an unsupported byte identity");
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes);
    } catch (error) {
      throw new Error(`copied contract is invalid JSON: ${error.message}`);
    }
    const contract = generation === G17_CONTRACT_GENERATION.CURRENT_V3
      ? validateG17Contract(parsed)
      : (() => {
          if (
            parsed?.schema !== "oxigraph.g1.7-qualification-contract/v1" ||
            parsed.id !== "g1.7-compatibility-performance-qualification" ||
            parsed.programme !== "linked-data-store"
          ) {
            throw new Error("legacy byte identity has impossible parsed metadata");
          }
          return deepFreeze(parsed);
        })();
    return Object.freeze({ contract, bytes, contractSha256, generation });
  } catch (error) {
    if (error.message.startsWith("G1.7 qualification contract:")) throw error;
    throw new Error(`G1.7 qualification contract: ${error.message}`);
  }
}

export function g17ContractCompatibilityGeneration({
  contractGeneration,
  compatibilityStatus,
  compatibilitySchemaState,
}) {
  try {
    if (
      !Object.values(G17_CONTRACT_GENERATION).includes(contractGeneration) ||
      !["PASS", "FAIL", "MISSING", "STALE", "NOT_RUN"].includes(
        compatibilityStatus,
      ) ||
      ![
        "CURRENT_SCHEMA_UNREPLAYED",
        "LEGACY_REPLAY_ONLY",
        "NOT_APPLICABLE",
      ].includes(compatibilitySchemaState)
    ) {
      throw new Error("contract/evidence generation state is invalid");
    }
    const currentContract =
      contractGeneration === G17_CONTRACT_GENERATION.CURRENT_V3;
    const currentCompatibility =
      compatibilitySchemaState === "CURRENT_SCHEMA_UNREPLAYED";
    if (
      compatibilityStatus === "PASS" &&
      currentContract !== currentCompatibility
    ) {
      throw new Error("contract and compatibility evidence generations are mixed");
    }
    return Object.freeze({
      currentContract,
      currentCompatibility,
      legacyReplayOnly:
        !currentContract || compatibilitySchemaState === "LEGACY_REPLAY_ONLY",
    });
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
  const decoded = decodeSealedG17Contract({
    bytes,
    receiptSha256: sha256(bytes),
  });
  if (decoded.generation !== G17_CONTRACT_GENERATION.CURRENT_V3) {
    throw new Error("G1.7 qualification contract: current path is not current generation");
  }
  return decoded;
}
