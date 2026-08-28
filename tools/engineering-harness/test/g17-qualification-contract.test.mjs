import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "../src/routing/features.mjs";
import {
  G17_DARWIN_RUNTIME_MODULES,
  loadG17DarwinFunctions,
  verifyG17DarwinRuntime,
} from "../src/qualification/benchmark-contract.mjs";
import { G17_CONTROL_STATISTICS_CONTRACT } from "../src/qualification/control-statistics-contract.mjs";
import {
  G17_CONTRACT_GENERATION,
  G17_CURRENT_CONTRACT_SHA256,
  G17_LEGACY_V1_CONTRACT_SHA256,
  G17_LEGACY_V3_CONTRACT_SHA256,
  G17_LEGACY_V4_CONTRACT_SHA256,
  G17_LEGACY_V5_CONTRACT_SHA256,
  G17_LEGACY_V6_CONTRACT_SHA256,
  decodeSealedG17Contract,
  g17ContractCompatibilityGeneration,
  g17ContractPath,
  loadG17Contract,
  validateG17Contract,
} from "../src/qualification/contract.mjs";

const { hashTasks: darwinHashTasks } = await loadG17DarwinFunctions();

const legacyV1ContractUrl = new URL(
  "fixtures/g17-qualification-contract-v1.json",
  import.meta.url,
);
const legacyV3ContractUrl = new URL(
  "fixtures/g17-qualification-contract-v3.json",
  import.meta.url,
);
const legacyV4ContractUrl = new URL(
  "fixtures/g17-qualification-contract-v4.json",
  import.meta.url,
);
const legacyV5ContractUrl = new URL(
  "fixtures/g17-qualification-contract-v5.json",
  import.meta.url,
);
const legacyV6ContractUrl = new URL(
  "fixtures/g17-qualification-contract-v6.json",
  import.meta.url,
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlob(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

const CASE_IDS = [
  "on-store-memory",
  "on-dataset-memory",
  "on-store-rocksdb",
  "on-dataset-rocksdb",
  "writers-1-rocksdb",
  "writers-4-rocksdb",
  "writers-16-rocksdb",
];

test("G1.7 v7 freezes the resealed subject, archives, and exact descriptors", () => {
  const loaded = loadG17Contract();
  assert.equal(loaded.generation, G17_CONTRACT_GENERATION.CURRENT_V7);
  assert.equal(loaded.contractSha256, G17_CURRENT_CONTRACT_SHA256);
  assert.equal(
    G17_CURRENT_CONTRACT_SHA256,
    "42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80",
  );
  assert.equal(
    loaded.contract.schema,
    "oxigraph.g1.7-qualification-contract/v7",
  );
  assert.deepEqual(loaded.contract.subject, {
    evaluator: {
      commit: "3aca932e4062f9b087adfa486fac936b5bbeaebb",
      composition: {
        baseManifestBlob: "8b4a1d3f82829d0f2780b88904f8bd2149151020",
        effectiveManifestBlob: "8b4a1d3f82829d0f2780b88904f8bd2149151020",
        effectiveManifestSha256:
          "e83b4ab43124affe47706192de6af6ae462bf6d819f66e8caecf3897888bb868",
        effectiveTree: "fcc5bb75c469fbbf80f77bc330279d3a7c593bfe",
        mode: "ALREADY_PRESENT",
      },
      state: "PRESENT_AS_ANCESTOR",
    },
    product: {
      cargoLockBlob: "763b2fedd24173c0b1d9f67e30fe3f971b4a2afd",
      cargoLockSha256:
        "587e4563371c9573d27732b1ed8d8b0c1392e0f12ceec6b38124fcb578dd5a75",
      commit: "e9d2db1b7c4eb974b406136e667e09ba06e34b48",
      tree: "fcc5bb75c469fbbf80f77bc330279d3a7c593bfe",
    },
    schema: "oxigraph.g1.7-subject-binding/v1",
  });
  assert.deepEqual(
    loaded.contract.benchmark.suite.tasks.map(({ id }) => id),
    CASE_IDS,
  );
  assert.equal(
    loaded.contract.benchmark.suite.taskHash,
    darwinHashTasks(loaded.contract.benchmark.suite.tasks),
  );
  assert.equal(
    loaded.contract.benchmark.protocol.qualificationSampleSchema,
    "oxigraph.g1.7-qualification-sample/v3",
  );
  assert.deepEqual(loaded.contract.benchmark.build, {
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
    buildOnceBeforeTiming: true,
    isolation: {
      crossProductArtifactReuse: false,
      evaluatorCompositionVerifiedBeforeBuild: true,
      targetDirectoryPerProduct: true,
      workspacePerProduct: true,
    },
    profile: "bench",
    target: "transactional_write",
    targetDirectory: "/state/target",
  });
  assert.deepEqual(loaded.contract.benchmark.statistics, {
    bootstrapApi: "security.bootstrapDelta",
    bootstrapSamples: 5_000,
    bootstrapScore: "paired-log-noninferiority-margin",
    bootstrapScorePrecisionDecimals: 12,
    bootstrapSeed: 170_017,
    bootstrapSeedDerivation: "base-plus-case-index",
    dispersion: "median-absolute-deviation",
    median: "integer-midpoint-overflow-safe-floor",
    owner: "@metaharness/darwin",
    p95: "nearest-rank",
    packageIntegrity:
      "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
    packageVersion: "0.9.3",
    statisticsModuleSha256:
      "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
    runtimeModuleSha256: G17_DARWIN_RUNTIME_MODULES,
    suiteHashApi: "bench.hashTasks",
    suiteVerifyApi: "bench.verifySuite",
    controlStatistics: G17_CONTROL_STATISTICS_CONTRACT,
  });
  assert.deepEqual(
    [
      loaded.contract.controlAuthorizationDecision,
      loaded.contract.finalDecisionSet,
    ].map(({ id, maxBytes, sha256: raw, contentHash }) => ({
      id,
      maxBytes,
      raw,
      contentHash,
    })),
    [
      {
        id: "control-authorization",
        maxBytes: 131_072,
        raw: "31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767",
        contentHash:
          "d61434741577787729dde9c23725523b855fca208e5b891de2a73e8abe0c0bb2",
      },
      {
        id: "final-decision-set",
        maxBytes: 131_072,
        raw: "b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5",
        contentHash:
          "bb4d92160e4d71089ec9d29dc0861ffccf0dbcaa46e87c53d4a49f996fe9ac72",
      },
    ],
  );
  assert.deepEqual(loaded.contract.legacyV6Protocol, {
    contract: {
      bytes: 17_907,
      path: "test/fixtures/g17-qualification-contract-v6.json",
      schema: "oxigraph.g1.7-qualification-contract/v6",
      sha256:
        "22cec755d291e6fe15cb8de69b881538fbae857e9de9049a9eda2585635b1bf0",
    },
    controlAuthorization: {
      bytes: 10_768,
      contentHash:
        "5e223cf4e11540eadef1e725794e05af838e2d5d347b5959091e424d7140961a",
      path: "test/fixtures/qualification/g1.7/v6/control-authorization.json",
      schema: "oxigraph.g1.7-control-authorization/v2",
      sha256:
        "285c86fd0ec6d3f00cb8bc48e30d0fe41e800f21ef03799d770b253a3a6ff839",
    },
    finalDecisionSet: {
      bytes: 5_686,
      contentHash:
        "7eb0dcfbc35d70dc6b1fcf5debf69bd083900d9e9356c1cef745fc29271345c5",
      path: "test/fixtures/qualification/g1.7/v6/final-decision-set.json",
      schema: "oxigraph.g1.7-final-decision-set/v2",
      sha256:
        "e2884b738c59232e9b4b3b750adbd419f338a0781aba70c6b3091672cb610732",
    },
  });
  assert.equal(
    loaded.contract.legacyV4DecisionSet.decisionSetSha256,
    "9a76ace507534b00cb5587e340e89ae24d6a8174b1bc257d532e694185a61efc",
  );
  assert.equal(Object.isFrozen(loaded.contract), true);
});

test("G1.7 verifies Darwin version, lock integrity, and module-chain bytes", async (t) => {
  assert.deepEqual(verifyG17DarwinRuntime(), {
    package: "@metaharness/darwin",
    version: "0.9.3",
    packageIntegrity:
      "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==",
    statisticsModuleSha256:
      "65adf15656c7850217faeca4e664a7d8cd0f1672c358a727b60e4e67e8fe3141",
    moduleSha256: G17_DARWIN_RUNTIME_MODULES,
    resolvedEntry: "dist/index.js",
  });

  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-darwin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "node_modules", "@metaharness", "darwin");
  await mkdir(packageRoot, { recursive: true });
  await copyFile(
    new URL("../package-lock.json", import.meta.url),
    join(root, "package-lock.json"),
  );
  await copyFile(
    new URL(
      "../node_modules/@metaharness/darwin/package.json",
      import.meta.url,
    ),
    join(packageRoot, "package.json"),
  );
  for (const modulePath of Object.keys(G17_DARWIN_RUNTIME_MODULES)) {
    const target = join(packageRoot, modulePath);
    await mkdir(join(target, ".."), { recursive: true });
    await copyFile(
      new URL(
        `../node_modules/@metaharness/darwin/${modulePath}`,
        import.meta.url,
      ),
      target,
    );
  }
  const options = {
    root,
    resolvedEntryPath: join(packageRoot, "dist", "index.js"),
  };
  assert.equal(verifyG17DarwinRuntime(options).version, "0.9.3");
  for (const modulePath of [
    "dist/security/stats.js",
    "dist/index.js",
    "dist/security/index.js",
  ]) {
    const target = join(packageRoot, modulePath);
    const pristine = await readFile(target);
    await writeFile(target, Buffer.from(`tampered ${modulePath}\n`));
    const message = new RegExp(
      `${modulePath.replaceAll("/", "\\/")} digest drifted`,
      "u",
    );
    assert.throws(() => verifyG17DarwinRuntime(options), message);
    await assert.rejects(() => loadG17DarwinFunctions(options), message);
    await writeFile(target, pristine);
  }
});

test("sealed contract dispatch preserves v1, v3, v4, v5, and v6 byte replay", async () => {
  const fixtures = [
    {
      url: legacyV1ContractUrl,
      bytes: 6_945,
      digest: G17_LEGACY_V1_CONTRACT_SHA256,
      blob: "d281db1f02b0a67e19edcd16a49435301b6eca4c",
      schema: "oxigraph.g1.7-qualification-contract/v1",
      generation: G17_CONTRACT_GENERATION.LEGACY_V1,
    },
    {
      url: legacyV3ContractUrl,
      bytes: 9_127,
      digest: G17_LEGACY_V3_CONTRACT_SHA256,
      blob: "8b50a003b4c9bb0da1e732fce52e6d440aad72a9",
      schema: "oxigraph.g1.7-qualification-contract/v3",
      generation: G17_CONTRACT_GENERATION.LEGACY_V3,
    },
    {
      url: legacyV4ContractUrl,
      bytes: 9_408,
      digest: G17_LEGACY_V4_CONTRACT_SHA256,
      blob: "4caac4c9666175cf6fff630794ee7adc142c1734",
      schema: "oxigraph.g1.7-qualification-contract/v4",
      generation: G17_CONTRACT_GENERATION.LEGACY_V4,
    },
    {
      url: legacyV5ContractUrl,
      bytes: 13_434,
      digest: G17_LEGACY_V5_CONTRACT_SHA256,
      blob: "fbddebed32fe767ece304b235151374539c505a2",
      schema: "oxigraph.g1.7-qualification-contract/v5",
      generation: G17_CONTRACT_GENERATION.LEGACY_V5,
    },
    {
      url: legacyV6ContractUrl,
      bytes: 17_907,
      digest: G17_LEGACY_V6_CONTRACT_SHA256,
      blob: "995b126a8af04c883211cb8fb29d1191fc30ebc0",
      schema: "oxigraph.g1.7-qualification-contract/v6",
      generation: G17_CONTRACT_GENERATION.LEGACY_V6,
    },
  ];
  for (const expected of fixtures) {
    const bytes = await readFile(expected.url);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(sha256(bytes), expected.digest);
    assert.equal(gitBlob(bytes), expected.blob);
    const decoded = decodeSealedG17Contract({
      bytes,
      receiptSha256: expected.digest,
    });
    assert.equal(decoded.generation, expected.generation);
    assert.equal(decoded.contract.schema, expected.schema);
    assert.equal(Object.isFrozen(decoded.contract), true);
    assert.throws(
      () =>
        decodeSealedG17Contract({
          bytes: Buffer.concat([bytes, Buffer.from(" ")]),
          receiptSha256: sha256(Buffer.concat([bytes, Buffer.from(" ")])),
        }),
      /unsupported byte identity/u,
    );
  }
});

test("contract and compatibility generations cannot be mixed for PASS evidence", () => {
  for (const generation of [
    G17_CONTRACT_GENERATION.LEGACY_V1,
    G17_CONTRACT_GENERATION.LEGACY_V3,
    G17_CONTRACT_GENERATION.LEGACY_V4,
    G17_CONTRACT_GENERATION.LEGACY_V5,
    G17_CONTRACT_GENERATION.LEGACY_V6,
  ]) {
    assert.deepEqual(
      g17ContractCompatibilityGeneration({
        contractGeneration: generation,
        compatibilityStatus: "PASS",
        compatibilitySchemaState: "LEGACY_REPLAY_ONLY",
      }),
      {
        currentContract: false,
        currentCompatibility: false,
        legacyReplayOnly: true,
      },
    );
  }
  assert.deepEqual(
    g17ContractCompatibilityGeneration({
      contractGeneration: G17_CONTRACT_GENERATION.CURRENT_V7,
      compatibilityStatus: "PASS",
      compatibilitySchemaState: "CURRENT_SCHEMA_UNREPLAYED",
    }),
    {
      currentContract: true,
      currentCompatibility: true,
      legacyReplayOnly: false,
    },
  );
  for (const [contractGeneration, compatibilitySchemaState] of [
    [G17_CONTRACT_GENERATION.LEGACY_V1, "CURRENT_SCHEMA_UNREPLAYED"],
    [G17_CONTRACT_GENERATION.LEGACY_V3, "CURRENT_SCHEMA_UNREPLAYED"],
    [G17_CONTRACT_GENERATION.LEGACY_V4, "CURRENT_SCHEMA_UNREPLAYED"],
    [G17_CONTRACT_GENERATION.LEGACY_V5, "CURRENT_SCHEMA_UNREPLAYED"],
    [G17_CONTRACT_GENERATION.LEGACY_V6, "CURRENT_SCHEMA_UNREPLAYED"],
    [G17_CONTRACT_GENERATION.CURRENT_V7, "LEGACY_REPLAY_ONLY"],
  ]) {
    assert.throws(
      () =>
        g17ContractCompatibilityGeneration({
          contractGeneration,
          compatibilityStatus: "PASS",
          compatibilitySchemaState,
        }),
      /generations are mixed/u,
    );
  }
});

test("G1.7 v7 rejects protocol, subject, suite, evaluator, and statistics drift", async () => {
  const pristine = JSON.parse(await readFile(g17ContractPath, "utf8"));
  for (const mutate of [
    (contract) => {
      contract.benchmark.suite.tasks[0].operations += 1;
    },
    (contract) => {
      contract.controlAuthorizationDecision.sha256 = "a".repeat(64);
    },
    (contract) => {
      contract.legacyV4DecisionSet.decisionSetSha256 = "b".repeat(64);
    },
    (contract) => {
      contract.legacyV5Protocol.contract.sha256 = "b".repeat(64);
    },
    (contract) => {
      contract.legacyV6Protocol.contract.sha256 = "b".repeat(64);
    },
    (contract) => {
      contract.subject.product.commit = "b".repeat(40);
    },
    (contract) => {
      contract.evaluator.parent = contract.evaluator.commit;
    },
    (contract) => {
      contract.authority.promotionAuthority = true;
    },
    (contract) => {
      contract.benchmark.protocol.qualificationSampleSchema =
        "oxigraph.g1.7-qualification-sample/v1";
    },
    (contract) => {
      contract.benchmark.statistics.bootstrapApi = "bench.bootstrapDelta";
    },
    (contract) => {
      contract.benchmark.statistics.runtimeModuleSha256["dist/index.js"] =
        "c".repeat(64);
    },
    (contract) => {
      contract.benchmark.build.isolation.crossProductArtifactReuse = true;
    },
  ]) {
    const candidate = structuredClone(pristine);
    mutate(candidate);
    assert.throws(
      () => validateG17Contract(candidate),
      /G1\.7 qualification contract/u,
    );
  }
});

test("G1.7 current contract is canonical and content-addressed", async () => {
  const bytes = await readFile(g17ContractPath);
  const value = JSON.parse(bytes);
  assert.equal(
    bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")),
    true,
  );
  assert.equal(sha256(bytes), G17_CURRENT_CONTRACT_SHA256);
  assert.ok(bytes.length > 0 && bytes.length < 1024 * 1024);
});
