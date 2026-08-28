function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const G17_CONTROL_SAMPLE_SCHEMA =
  "oxigraph.g1.7-qualification-sample/v3";
export const G17_CONTROL_SAMPLE_SET_SCHEMA =
  "oxigraph.g1.7-control-sample-set/v1";
export const G17_CONTROL_STATISTICS_PROJECTION_SCHEMA =
  "oxigraph.g1.7-control-statistics-projection/v1";

export const G17_BENCHMARK_SUITE_HASH =
  "533a1501130971712ef5ca2a62b3ddfd9115eaaf0b650baacd1e5f04ed44aaba";

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

export const G17_DARWIN_PAIRED_BOOTSTRAP_BINDING = deepFreeze({
  package: "@metaharness/darwin",
  version: "0.9.3",
  packageIntegrity:
    "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
  api: "security.bootstrapDelta",
  apiModule: "dist/security/stats.js",
  statisticsModuleSha256:
    "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
  utilityModule: "dist/security/util.js",
  utilityModuleSha256:
    "264045fbd320d62f0056243d3af08ee4c18671ea74ad52406b117b4ff5fe0433",
  algorithm: "equal-length-paired-mean-delta-bootstrap/mulberry32/v1",
  samples: 5_000,
  minDelta: 0,
  resultPrecisionDecimals: 6,
  lower95Index: "floor(samples*0.025)",
  upper95Index: "floor(samples*0.975)",
  decision:
    "promote-iff-meanDelta-strictly-above-minDelta-and-lower95-strictly-positive",
});

export const G17_CONTROL_STATISTICS_CONTRACT = deepFreeze({
  suite: {
    id: "oxigraph-g1.7-transactional-write",
    version: "1",
    taskHash: G17_BENCHMARK_SUITE_HASH,
    caseIds: G17_BENCHMARK_CASE_IDS,
  },
  sampleSet: {
    schema: G17_CONTROL_SAMPLE_SET_SCHEMA,
    rowSchema: G17_CONTROL_SAMPLE_SCHEMA,
    encoding: "utf8",
    canonicalization:
      "recursive-lexicographic-object-keys-dense-arrays-finite-json-negative-zero-normalized",
    terminator: "single-lf",
    hash: "sha256-over-exact-canonical-bytes",
    framing:
      "canonicalJson({schema,runId,controlId,authorization:{rawSha256,contentHash},suiteHash,rows})-plus-single-lf",
    order: "suite-case-order-then-warmup-before-measured-then-block-then-slot",
    warmupBlocks: 2,
    measuredBlocks: 5,
    measuredPairsPerCase: 10,
    rowsPerCase: 28,
    rowsPerControl: 196,
    schedules: [
      ["subject", "reference", "reference", "subject"],
      ["reference", "subject", "subject", "reference"],
    ],
    executionSeed: {
      base: 170_017,
      derivation:
        "base-plus-case-index-times-100000-plus-global-block-times-2-plus-pair",
    },
  },
  controls: {
    negativeControl: {
      id: "negative-control",
      subject: { productRole: "negativeControl", buildId: "negative-control" },
      reference: {
        productRole: "performanceReference",
        buildId: "performance-reference",
      },
      detector: "paired-log-noninferiority-breach",
      maximumSlowdownBasisPoints: 1_000,
      passCondition: "at-least-one-quiet-case-fails-strict-noninferiority",
    },
    aaNoiseControl: {
      id: "a-a-noise-control",
      subject: { productRole: "noiseControl", buildId: "noise-control-a" },
      reference: { productRole: "noiseControl", buildId: "noise-control-b" },
      detector: "two-one-sided-paired-log-bootstrap-equivalence",
      equivalenceBasisPoints: 500,
      independentBuildOwnersRequired: true,
      directions: ["A_WITHIN_B", "B_WITHIN_A"],
      passCondition:
        "both-directions-lower95-strictly-positive-for-every-quiet-case",
    },
  },
  statistics: {
    owner: G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.package,
    attribution: G17_DARWIN_PAIRED_BOOTSTRAP_BINDING,
    scorePrecisionDecimals: 12,
    maximumMadBasisPoints: 500,
    madDecision:
      "pass-when-mad-times-10000-less-than-or-equal-to-median-times-threshold",
    bootstrapSeed: {
      base: 170_017,
      negativeControl: "base-plus-case-index",
      aaAWithinB: "base-plus-case-index",
      aaBWithinA: "same-as-aaAWithinB",
      aaDirectionCoupling: "same-seed-same-resampled-pair-index-stream",
    },
  },
  verdict: {
    statuses: [
      "CONTROL_SEALED_PASS",
      "CONTROL_SEALED_FAIL",
      "CONTROL_SEALED_INCONCLUSIVE",
    ],
    precedence: [
      "structural-invalid-throws",
      "negative-pass-iff-any-quiet-noninferiority-breach",
      "negative-inconclusive-iff-no-quiet-breach-and-any-noisy-case",
      "negative-fail-iff-all-cases-quiet-and-no-breach",
      "aa-fail-iff-any-quiet-direction-failure",
      "aa-inconclusive-iff-no-quiet-direction-failure-and-any-noisy-case",
      "aa-pass-iff-all-cases-quiet-and-both-directions-strict-pass",
      "aggregate-fail-before-inconclusive-before-pass",
    ],
  },
});
