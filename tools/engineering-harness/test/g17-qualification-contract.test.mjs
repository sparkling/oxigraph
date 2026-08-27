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
import {
  G17_CONTRACT_GENERATION,
  G17_CURRENT_CONTRACT_SHA256,
  G17_LEGACY_V1_CONTRACT_SHA256,
  G17_LEGACY_V3_CONTRACT_SHA256,
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

test("G1.7 v4 freezes paired Darwin and exact decision descriptors", () => {
  const loaded = loadG17Contract();
  assert.equal(loaded.generation, G17_CONTRACT_GENERATION.CURRENT_V4);
  assert.equal(loaded.contractSha256, G17_CURRENT_CONTRACT_SHA256);
  assert.equal(
    loaded.contract.schema,
    "oxigraph.g1.7-qualification-contract/v4",
  );
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
    "oxigraph.g1.7-qualification-sample/v2",
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
      evaluatorOverlayAppliedBeforeBuild: true,
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
  });
  assert.deepEqual(
    [
      loaded.contract.referenceDecision,
      loaded.contract.budgetDecision,
      loaded.contract.noiseDecision,
    ].map(({ id, maxBytes, sha256: raw, contentHash }) => ({
      id,
      maxBytes,
      raw,
      contentHash,
    })),
    [
      {
        id: "reference",
        maxBytes: 32_768,
        raw: "45fbb9b98f9dabc7742c254a4b5b3bafc0f25174713445965332176df7af3a84",
        contentHash:
          "0a3f5e4f1ff40ead49f809cc124f54ce58bf5e3c4ca74114e0c565c33c0ea367",
      },
      {
        id: "performance-budget",
        maxBytes: 32_768,
        raw: "b38ae4b929dcf9e5da701808c726ada68a8c8188b7f3700f2fc47d4de6727d12",
        contentHash:
          "3184f0603d1a74f66161d097f995f572bf9592c3b90f316f6969ec1b499a5e98",
      },
      {
        id: "noise-budget",
        maxBytes: 32_768,
        raw: "72666540abf5196bb65bfeab2eac1b6ae8b0f4ab25621f5eadf998e054deeb01",
        contentHash:
          "3cf2243f1febc0e86322b1fec21bd67bcf6ba2e66ff4d97cb58783921202cb06",
      },
    ],
  );
  assert.equal(
    loaded.contract.decisionSetSha256,
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

test("sealed contract dispatch preserves v1 and v3 as byte-exact replay only", async () => {
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
      contractGeneration: G17_CONTRACT_GENERATION.CURRENT_V4,
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
    [G17_CONTRACT_GENERATION.CURRENT_V4, "LEGACY_REPLAY_ONLY"],
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

test("G1.7 v4 rejects decision, suite, evaluator, and statistics drift", async () => {
  const pristine = JSON.parse(await readFile(g17ContractPath, "utf8"));
  for (const mutate of [
    (contract) => {
      contract.benchmark.suite.tasks[0].operations += 1;
    },
    (contract) => {
      contract.referenceDecision.sha256 = "a".repeat(64);
    },
    (contract) => {
      contract.decisionSetSha256 = "b".repeat(64);
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
