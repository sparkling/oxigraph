import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { harnessRoot } from "../paths.mjs";
import {
  G17_BENCHMARK_CASES,
  G17_BENCHMARK_SUITE_HASH,
  G17_DARWIN_RUNTIME_MODULES,
  loadG17DarwinFunctions,
  verifyG17DarwinRuntime,
} from "./benchmark-contract.mjs";
import {
  G17_CONTROL_AUTHORIZATION_SCHEMA,
  G17_FINAL_DECISION_SET_SCHEMA,
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  G17_G14B_PREREQUISITE_SCHEMA,
  G17_PRE_CONTROL_DECISION_SET,
  G17_QUALIFICATION_SAMPLE_V3_SCHEMA,
} from "./control-protocol.mjs";
import {
  G17_CONTRACT_GENERATION,
  G17_CONTRACT_SCHEMA,
  G17_CURRENT_CONTRACT_SHA256,
  decodeG17ContractByteIdentity,
} from "./contract-identity.mjs";

export {
  G17_CONTRACT_GENERATION,
  G17_CONTRACT_SCHEMA,
  G17_CURRENT_CONTRACT_SHA256,
  G17_LEGACY_CONTRACT_SHA256,
  G17_LEGACY_V1_CONTRACT_SHA256,
  G17_LEGACY_V3_CONTRACT_SHA256,
  G17_LEGACY_V4_CONTRACT_SHA256,
  g17ContractCompatibilityGeneration,
} from "./contract-identity.mjs";

const { hashTasks: darwinHashTasks, verifySuite: darwinVerifySuite } =
  await loadG17DarwinFunctions();

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
const EXPECTED_PROTOCOL_DESCRIPTORS = Object.freeze({
  authorization: {
    id: "control-authorization",
    path: "qualification/g1.7/decisions/control-authorization.json",
    sealedName: "control-authorization.json",
    schema: G17_CONTROL_AUTHORIZATION_SCHEMA,
    sha256: "b9ee0f7615a885cda10157d1a6fdeebe4dc8175b267e6b25cd2c5bc636603515",
    contentHash:
      "5cb0f48f232784e7b6d0206b5ddbf72c7cd89d78f1924930a85ddba1cdf298b4",
    maxBytes: 131_072,
  },
  finalDecisionSet: {
    id: "final-decision-set",
    path: "qualification/g1.7/decisions/final-decision-set.json",
    sealedName: "final-decision-set.json",
    schema: G17_FINAL_DECISION_SET_SCHEMA,
    sha256: "2fd16b9ef0228fc054efb80a6f338fafeb6a289f1371b20f774e7c6f10ea0bce",
    contentHash:
      "ba49181b0c19ccc065f51510837a035aa64cccb746e089ac13d68a39c1d89898",
    maxBytes: 131_072,
  },
});
const EXPECTED_G14B_PREREQUISITE = Object.freeze({
  schema: G17_G14B_PREREQUISITE_SCHEMA,
  bindingSchema: G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  artifactName: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  status: "REQUIRED_FOR_FINAL_APPROVAL",
  verifier: "replayApplicationReceipt",
  projectionHash: "canonical-sha256",
  expectedProjectionSha256:
    "d57eb7cb753d905e8951131c0bbcac188afb00e6ba893f572a994eeb5d20de87",
  expectedBindingSha256:
    "5a4f57211ab6bce138a4a5facc78092559e8f371f836687d1fc539e9129d08e5",
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
      "legacyV4DecisionSet",
      "controlAuthorizationDecision",
      "finalDecisionSet",
      "g14bPrerequisite",
      "benchmark",
      "compatibility",
      "artifactPolicy",
    ],
    "contract",
  );
  assertInvariant(value.schema === G17_CONTRACT_SCHEMA, "schema is not v5");
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
  assertInvariant(
    isDeepStrictEqual(value.authority, AUTHORITY),
    "authority drifted",
  );
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
    isDeepStrictEqual(value.legacyV4DecisionSet, G17_PRE_CONTROL_DECISION_SET),
    "legacy v4 pre-control values drifted",
  );
  assertInvariant(
    isDeepStrictEqual(
      value.controlAuthorizationDecision,
      EXPECTED_PROTOCOL_DESCRIPTORS.authorization,
    ),
    "control authorization descriptor drifted",
  );
  assertInvariant(
    isDeepStrictEqual(
      value.finalDecisionSet,
      EXPECTED_PROTOCOL_DESCRIPTORS.finalDecisionSet,
    ),
    "final decision descriptor drifted",
  );
  assertInvariant(
    isDeepStrictEqual(value.g14bPrerequisite, EXPECTED_G14B_PREREQUISITE),
    "G1.4b prerequisite contract drifted",
  );

  exactKeys(
    value.benchmark,
    ["suite", "build", "protocol", "statistics"],
    "benchmark",
  );
  const { suite, build, protocol, statistics } = value.benchmark;
  exactKeys(suite, ["id", "version", "taskHash", "tasks"], "benchmark suite");
  assertInvariant(
    suite.id === "oxigraph-g1.7-transactional-write" && suite.version === "1",
    "benchmark suite identity drifted",
  );
  assertInvariant(
    isDeepStrictEqual(suite.tasks, G17_BENCHMARK_CASES),
    "benchmark cases drifted",
  );
  assertInvariant(
    suite.taskHash === G17_BENCHMARK_SUITE_HASH,
    "benchmark suite hash is malformed",
  );
  verifyG17DarwinRuntime();
  const suiteVerification = darwinVerifySuite(suite);
  assertInvariant(
    suiteVerification.ok && suite.taskHash === darwinHashTasks(suite.tasks),
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
        "--message-format",
        "json-render-diagnostics",
        "--target-dir",
        "/state/target",
      ],
      isolation: {
        workspacePerProduct: true,
        targetDirectoryPerProduct: true,
        crossProductArtifactReuse: false,
        evaluatorOverlayAppliedBeforeBuild: true,
      },
      target: "transactional_write",
      targetDirectory: "/state/target",
      profile: "bench",
      buildOnceBeforeTiming: true,
    }),
    "benchmark build contract drifted",
  );
  assertInvariant(
    isDeepStrictEqual(protocol, {
      sampleSchema: "oxigraph.transactional-write-sample/v1",
      qualificationSampleSchema: G17_QUALIFICATION_SAMPLE_V3_SCHEMA,
      schedules: [
        ["subject", "reference", "reference", "subject"],
        ["reference", "subject", "subject", "reference"],
      ],
      warmupBlocks: 2,
      measuredBlocks: 5,
      seed: 170_017,
      seedDerivation: "base-plus-case100000-plus-globalblock2-plus-pair",
      harnessSessionExclusive: true,
      dedicatedHostRequired: false,
      dedicatedCpusetRequired: false,
      nonTmpfsVolumeRequired: true,
      hardVolumeQuotaRequired: false,
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
      bootstrapApi: "security.bootstrapDelta",
      bootstrapSamples: 5_000,
      bootstrapSeed: 170_017,
      bootstrapSeedDerivation: "base-plus-case-index",
      bootstrapScore: "paired-log-noninferiority-margin",
      bootstrapScorePrecisionDecimals: 12,
      packageVersion: "0.9.3",
      packageIntegrity:
        "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
      statisticsModuleSha256:
        "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
      runtimeModuleSha256: G17_DARWIN_RUNTIME_MODULES,
      median: "integer-midpoint-overflow-safe-floor",
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
    isDeepStrictEqual(
      value.compatibility.nativeSession,
      EXPECTED_NATIVE_SESSION,
    ),
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
  const decoded = decodeG17ContractByteIdentity({ bytes, receiptSha256 });
  if (decoded.generation !== G17_CONTRACT_GENERATION.CURRENT_V5) {
    return decoded;
  }
  return Object.freeze({
    ...decoded,
    contract: validateG17Contract(decoded.contract),
  });
}

function stableReadContract(contractPath) {
  if (
    !Number.isInteger(constants.O_NOFOLLOW) ||
    !Number.isInteger(constants.O_NONBLOCK)
  ) {
    throw new Error(
      "G1.7 qualification contract: O_NOFOLLOW or O_NONBLOCK is unavailable",
    );
  }
  let descriptor;
  try {
    const closeOnExec = Number.isInteger(constants.O_CLOEXEC)
      ? constants.O_CLOEXEC
      : 0;
    descriptor = openSync(
      contractPath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        closeOnExec,
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 1n ||
      before.size > BigInt(MAX_CONTRACT_BYTES)
    ) {
      throw new Error("must be a bounded regular file");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) {
        throw new Error("changed while being read");
      }
    }
    if (BigInt(bytes.length) !== before.size) {
      throw new Error("read length drifted");
    }
    return bytes;
  } catch (error) {
    if (error.message.startsWith("G1.7 qualification contract:")) throw error;
    throw new Error(`G1.7 qualification contract: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function loadG17Contract({ contractPath = g17ContractPath } = {}) {
  const bytes = stableReadContract(contractPath);
  const decoded = decodeSealedG17Contract({
    bytes,
    receiptSha256: sha256(bytes),
  });
  if (decoded.generation !== G17_CONTRACT_GENERATION.CURRENT_V5) {
    throw new Error(
      "G1.7 qualification contract: current path is not current generation",
    );
  }
  return decoded;
}
