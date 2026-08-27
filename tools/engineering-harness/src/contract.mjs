import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join, relative, resolve } from "node:path";

import { harnessRoot, isContained, repositoryRoot } from "./paths.mjs";
import {
  g12Profile,
  g13Profile,
  g14Profile,
  g14aProfile,
  g14bProfile,
  g15Profile,
  g15bProfile,
  g15cProfile,
  g16Profile,
  engineeringTaskIds,
  taskProfile,
} from "./task-profile.mjs";

export const g12ContractPath = g12Profile.contractPath;
export const g13ContractPath = g13Profile.contractPath;
export const g14ContractPath = g14Profile.contractPath;
export const g14aContractPath = g14aProfile.contractPath;
export const g14bContractPath = g14bProfile.contractPath;
export const g15ContractPath = g15Profile.contractPath;
export const g15bContractPath = g15bProfile.contractPath;
export const g15cContractPath = g15cProfile.contractPath;
export const g16ContractPath = g16Profile.contractPath;

const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[\u0000\r\n])[\x20-\x7e]+$/u;
const MANIFEST_ALGORITHM = "git-ls-tree-r-z-sort-nul-sha256-v1";

const EXPECTED = Object.freeze({
  topKeys: [
    "schemaVersion",
    "id",
    "programme",
    "decision",
    "objective",
    "localOnly",
    "promotionAuthority",
    "routing",
    "baseline",
    "evaluator",
    "protectedInputs",
    "scope",
    "verificationSequence",
    "commands",
    "ceilings",
    "initialRed",
    "success",
  ],
  routing: {
    pairedCalibration: true,
    forbidOpenRouter: true,
    providers: [
      { provider: "codex", transport: "native", model: "gpt-5.6-sol" },
      { provider: "claude", transport: "native", model: "opus" },
    ],
  },
  decision: "ADR-0018",
  baseline: {
    commit: "3edfb86a7f9d591f20ba14b2a2c9a7f2b41fade9",
    tree: "0d4d29166b8785a41c762625e5eb2cf79ce7e7f7",
  },
  evaluator: {
    commit: "eaf7161c142fb8afecd37dd9dad02463c0efa107",
    parent: "3edfb86a7f9d591f20ba14b2a2c9a7f2b41fade9",
    tree: "1b61a2717657e001d81a61eb88f56b5b62e05d0e",
    path: "lib/oxigraph/tests/transaction_concurrency.rs",
    changeStatus: "A",
    blob: "be6de1f2fab2f5f779f297ed7b1de29c10a06c69",
    contentSha256:
      "29f21c6b2dcf7b6f143e0eee93dbd0e87eec15d7f85e49b2b757cca5c5caec3a",
    patchSha256:
      "d15a5e4e7dc4d60a620f046bf1f831014ad76e4a2037fed2e039a2a025bdf120",
  },
  mutableExact: ["lib/oxigraph/src/storage/rocksdb_wrapper.rs"],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "lib/oxigraph/src/store.rs",
    "lib/oxigraph/src/storage/mod.rs",
    "lib/oxigraph/src/storage/memory.rs",
    "lib/oxigraph/src/storage/rocksdb.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/sparql",
    "lib/oxigraph/src/store",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: [
    "format",
    "build",
    "public",
    "independent",
    "regression",
  ],
  commands: {
    format: {
      argv: ["cargo", "fmt", "--all", "--", "--check"],
      timeoutMs: 120_000,
    },
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--no-run",
        "--test",
        "transaction_concurrency",
        "--test",
        "transaction_state_model",
        "--test",
        "update_atomicity",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_concurrency",
      ],
      timeoutMs: 90_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_state_model",
      ],
      timeoutMs: 420_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "update_atomicity",
      ],
      timeoutMs: 120_000,
    },
  },
  ceilings: {
    maxPatchBytes: 65_536,
    maxChangedFiles: 1,
    maxChangedLines: 512,
    maxWorkerOutputBytes: 262_144,
    maxBuildOutputBytes: 8_388_608,
    maxTestOutputBytesPerCommand: 2_097_152,
    maxTotalVerifierWallMs: 2_700_000,
    maxResidentBytes: 8_589_934_592,
    maxVerifierDiskBytes: 17_179_869_184,
    cargoBuildJobs: 4,
    maxRepairCycles: 2,
    maxCritiqueRounds: 1,
    networkDuringVerification: false,
  },
  initialRed: {
    commandRole: "public",
    exitCode: 101,
    passed: 0,
    failed: 2,
    requiredSubstrings: [
      "lost-update history violated serial writer semantics; overlap_observed=true; expected counter=2",
      "write-skew history removed every on-call doctor; overlap_observed=true",
    ],
    forbiddenSubstrings: [
      "did not emit",
      "disconnected before staging",
      "could not compile",
      "no test target named",
      "timed out",
    ],
  },
  success: { publicPassed: 2, independentPassed: 3, regressionPassed: 2 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
    mutableBaselineBlob: "ee9794ed73fb25b7bda0c41469557ab20d2af8df",
    mutableBaselineSha256:
      "116fdc9afa59c16d1c54e497b9110841b2346246d49f358f727b5f8cfde81e87",
    baselineManifest: {
      entries: 1303,
      fullSha256:
        "ab2f7e165ec9bba5b36d36e5b536ef8822cae7c8002ae2dd36a0ccf70c10ea47",
      protectedEntries: 1302,
      protectedSha256:
        "c5f7c32cf3a237b41ebb9499eeffbf4d0b87201b2e5dff3f468f85d1d81a566c",
    },
    evaluatorManifest: {
      entries: 1304,
      fullSha256:
        "4b70b20014b630c0bbc5e09d8894fe72b47a25cbba0a57854cdfd763b9f5fd23",
      protectedEntries: 1303,
      protectedSha256:
        "cd2a60c9f87792191984185c969568be565f15a3b5e9425a3538f254de516405",
    },
    submodules: [
      {
        path: "oxrocksdb-sys/lz4",
        commit: "ebb370ca83af193212df4dcbadcc5d87bc0de2f0",
        tree: "1ff35e0f086e3b431ea0efd001eb5c6254561953",
      },
      {
        path: "oxrocksdb-sys/rocksdb",
        commit: "3b446089141659fad25328c5ea3e7ed283df46e4",
        tree: "36afaac5df4b9666e3c7ca5e32e094edd6fedfac",
      },
    ],
  },
});

const EXPECTED_G13 = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0018",
  baseline: {
    commit: "7eec1f0715e4f28434b2f505e289c9b599991aae",
    tree: "5d1034cac3a37c8cecc9f26b3f5844c4ed248f53",
  },
  evaluator: {
    commit: "4ad118a039d6ee57c63b9c45e47368454762e2ee",
    parent: "7eec1f0715e4f28434b2f505e289c9b599991aae",
    tree: "aaf08375b441fefa8051dede88e0603283084215",
    path: "lib/oxigraph/tests/transaction_capabilities.rs",
    changeStatus: "M",
    blob: "1908194b5a7fc0a3e0319710a7ce319b69fee6ae",
    contentSha256:
      "543209b7de7e82a0f0c894b925871788222dca3aaa393cae0d656ff3332375d3",
    patchSha256:
      "8c5187ff50158dc66a9e6df095201f3c6503c9d05769a45ef02d8c29eb16115a",
  },
  mutableExact: ["lib/oxigraph/src/store.rs"],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/sparql",
    "lib/oxigraph/src/store",
    "lib/oxigraph/src/storage",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: EXPECTED.verificationSequence,
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--no-run",
        "--test",
        "transaction_state_model",
        "--test",
        "transactional_dataset",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_capabilities",
      ],
      timeoutMs: 120_000,
    },
    independent: EXPECTED.commands.independent,
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transactional_dataset",
      ],
      timeoutMs: 120_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 98_304,
    maxChangedLines: 768,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0432",
    rustcErrorCount: 1,
    primaryPath: "lib/oxigraph/tests/transaction_capabilities.rs",
    requiredExports: [
      "CancellationGuarantee",
      "ConflictBehavior",
      "NegotiatedTransactionalDataset",
      "OutcomeAwareWritableDataset",
      "OutcomeLookup",
      "RollbackGuarantee",
      "TransactionCapabilities",
      "TransactionCommitError",
      "TransactionKey",
      "TransactionRequest",
      "TransactionRequirements",
      "TransactionRollbackError",
      "TransactionStartError",
      "UnmetTransactionRequirement",
      "WriterIsolation",
    ],
    requiredSubstrings: [
      "error[E0432]: unresolved imports",
      "could not compile `oxigraph` (test \"transaction_capabilities\") due to 1 previous error",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: { publicPassed: 9, independentPassed: 3, regressionPassed: 3 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/store.rs",
    mutableBaselineBlob: "aed3bba9d9839efcb7ba9b376bbbd5ca4c536290",
    mutableBaselineSha256:
      "88591c979240bb33a1ddcca287c7a31dc10080ff83fabbd0f15511265e20a182",
    baselineManifest: {
      entries: 1383,
      fullSha256:
        "11cfe7a7649acb16f2d8e3c469bf6c863f50044a8cd96947bbb2ea45f88b5d7e",
      protectedEntries: 1382,
      protectedSha256:
        "48d97e50b3c73a4ea22604201f79058e3adcbfab0e34f29ada9f0b4754206226",
    },
    evaluatorManifest: {
      entries: 1383,
      fullSha256:
        "5b1852f142b5adf64bb4afab121cf0090d5a8c2ddc6f04ddb0bbaf4e43c869f0",
      protectedEntries: 1382,
      protectedSha256:
        "679e1ce34462d761090534c186e6bbbde5ba9297b7d00dda60d3748f8b16e189",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_G14 = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0018",
  baseline: {
    commit: "1f187690ac574fc87433065fc0a6cc85c5b74106",
    tree: "a1168bdc7d25e09507dfd4818dff4caed817f876",
  },
  evaluator: {
    commit: "27b7856e7eaca96de112ab53b969f0e3d17c82eb",
    parent: "1f187690ac574fc87433065fc0a6cc85c5b74106",
    tree: "b0e8d3e825cb1c08bcea61af24ad42d94dbe8271",
    path: "lib/oxigraph/tests/rocksdb_writer_serialization.rs",
    changeStatus: "A",
    blob: "7dbb5dec56e7b242ccc8f620a5fba61d497ab70c",
    contentSha256:
      "0d916490c19d26b65ec65e4ec770a244e2f828e6c6f15b4aef1eee6999039239",
    patchSha256:
      "1b782aaa979d7159fcc66ce47bfd83f6696c9fb5b6b98840b494231e2c5c701b",
  },
  mutableExact: [
    "lib/oxigraph/src/store.rs",
    "lib/oxigraph/src/storage/mod.rs",
    "lib/oxigraph/src/storage/memory.rs",
    "lib/oxigraph/src/storage/rocksdb.rs",
    "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
  ],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "lib/oxigraph/src/lib.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/sparql",
    "lib/oxigraph/src/store",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: EXPECTED.verificationSequence,
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--no-run",
        "--test",
        "transaction_concurrency",
        "--test",
        "update_atomicity",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "rocksdb_writer_serialization",
      ],
      timeoutMs: 120_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_concurrency",
      ],
      timeoutMs: 120_000,
    },
    regression: EXPECTED.commands.regression,
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 131_072,
    maxChangedFiles: 5,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0432",
    rustcErrorCount: 5,
    primaryPath: "lib/oxigraph/tests/rocksdb_writer_serialization.rs",
    requiredExports: [
      "TransactionStartControl",
      "start_transaction_with_control",
      "Cancelled",
      "TimedOut",
    ],
    requiredSubstrings: [
      "error[E0432]: unresolved import `oxigraph::store::TransactionStartControl`",
      "could not compile `oxigraph` (test \"rocksdb_writer_serialization\") due to 5 previous errors",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: { publicPassed: 6, independentPassed: 2, regressionPassed: 2 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/store.rs",
    mutableBaselineBlob: "313b3322d8254fdd8db94e7e7445b7fe52c4bb72",
    mutableBaselineSha256:
      "b33ca0ed372fbfe2a80f0b81027c1e07fa9a772c420afab27560f45477df3c01",
    baselineManifest: {
      entries: 1385,
      fullSha256:
        "31bb7fb5535277db14956295e9173379b6a8035710813e5d4ea82b709d5319fe",
      protectedEntries: 1380,
      protectedSha256:
        "d80f43dfae5a48170cf285a38b93031434c88c729a2fb1a34cfb869aa41c04b7",
    },
    evaluatorManifest: {
      entries: 1386,
      fullSha256:
        "4c965224804fca4a5355ff8e54b1a8597333359ec216a72122c0cb5bd5f5164d",
      protectedEntries: 1381,
      protectedSha256:
        "537184400702bd927208c3f314c014386a65390061f263d7924855d38777bb3b",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_G14A = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0018",
  baseline: {
    commit: "ad98c8cdaace7ba9d075cd4591f5212e3b48367b",
    tree: "5f57a492593158c071fa67533667533380b1b146",
  },
  evaluator: {
    commit: "b6bf1f159810516f03cbf84c703091d61cd27a56",
    parent: "ad98c8cdaace7ba9d075cd4591f5212e3b48367b",
    tree: "62c22d70348c9f75b58a7cf87532d6a4ed35633b",
    path: "lib/oxigraph/tests/transaction_outcomes.rs",
    changeStatus: "A",
    blob: "bac1378d741ef3e5335204f25eab543668ce3343",
    contentSha256:
      "07ad260bad9297961a850efc1ca859e8f27016ff1d9254618c40a1e4d74be01c",
    patchSha256:
      "d881ce0013a193a5bec8310ae335b4cc996c6044122e400d7d08c16f6348ccec",
  },
  evaluatorChanges: Object.freeze([
    Object.freeze({
      changeStatus: "M",
      path: "lib/oxigraph/tests/transaction_capabilities.rs",
      blob: "d4621269efcaa7dd8f0df88ab6adf6947b1b00ce",
      contentSha256:
        "bef7988faf7092f16c03f184f5c58ef15a782b29cc37671ce1f2b26bbc838421",
    }),
    Object.freeze({
      changeStatus: "M",
      path: "lib/oxigraph/tests/transaction_compatibility.rs",
      blob: "b251e5448e18dfc4dbe7383909da9a0010b40a69",
      contentSha256:
        "54cf7d92140cdcf71b72b8d3b5f08f191266926027126e38304baa0ae71f0511",
    }),
    Object.freeze({
      changeStatus: "A",
      path: "lib/oxigraph/tests/transaction_outcomes.rs",
      blob: "bac1378d741ef3e5335204f25eab543668ce3343",
      contentSha256:
        "07ad260bad9297961a850efc1ca859e8f27016ff1d9254618c40a1e4d74be01c",
    }),
  ]),
  mutableExact: [
    "lib/oxigraph/src/store.rs",
    "lib/oxigraph/src/storage/mod.rs",
    "lib/oxigraph/src/storage/memory.rs",
    "lib/oxigraph/src/storage/rocksdb.rs",
    "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
  ],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "lib/oxigraph/src/lib.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/sparql",
    "lib/oxigraph/src/store",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: [
    "format",
    "build",
    "public",
    "service",
    "compatibility",
    "independent",
    "regression",
  ],
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--no-run",
        "--test",
        "transaction_state_model",
        "--test",
        "update_atomicity",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_outcomes",
      ],
      timeoutMs: 300_000,
    },
    service: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_capabilities",
      ],
      timeoutMs: 420_000,
    },
    compatibility: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_compatibility",
      ],
      timeoutMs: 420_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_state_model",
      ],
      timeoutMs: 420_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "update_atomicity",
      ],
      timeoutMs: 420_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 196_608,
    maxChangedFiles: 5,
    maxChangedLines: 1_536,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0432",
    rustcErrorCount: 24,
    primaryPath: "lib/oxigraph/tests/transaction_outcomes.rs",
    requiredExports: [
      "OutcomeAwareTransactionalDataset",
      "TransactionNonCommitReason",
      "TransactionOutcome",
      "as_bytes",
      "into_bytes",
      "start_transaction_with_key",
      "lookup_transaction_outcome",
    ],
    requiredSubstrings: [
      "error[E0432]: unresolved imports",
      "no `OutcomeAwareTransactionalDataset` in `store`",
      "could not compile `oxigraph` (test \"transaction_outcomes\") due to 24 previous errors",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: {
    publicPassed: 7,
    servicePassed: 9,
    compatibilityPassed: 20,
    independentPassed: 3,
    regressionPassed: 2,
  },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/store.rs",
    mutableBaselineBlob: "3617547b5535100dc1060c9027f740aecf48ca87",
    mutableBaselineSha256:
      "55f96dd50b650f39ab36e34c50f86efe3c30b939efdb43b23dcd8ed528845c29",
    baselineManifest: {
      entries: 1477,
      fullSha256:
        "7431df9ed08b6b46df7c72952038fcf8f0068bad5ef96d77f1a058a90eefd11b",
      protectedEntries: 1472,
      protectedSha256:
        "374cdee1b8c0d15eecf9bb6fdaa78e43e8562ffc999614068ed851ac0d255135",
    },
    evaluatorManifest: {
      entries: 1478,
      fullSha256:
        "9b29a9b16490fb9513e7b2bb6231e45144aab73ed7a3c85f30822e8d07936d5c",
      protectedEntries: 1473,
      protectedSha256:
        "54162db0dd0f4dfebb78cade7d136daa16d403f3e520a1b295860a99ea56999c",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_G15 = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0019",
  baseline: {
    commit: "0ead1df969fd6de5b42ee2bcae8360ffaa55b281",
    tree: "a150843c9c705cd6beb6dc49632746d08b411a04",
  },
  evaluator: {
    commit: "f1fa7900191a4eaffd2d9c92694851152a5e4fb1",
    parent: "0ead1df969fd6de5b42ee2bcae8360ffaa55b281",
    tree: "829b42c96c6bf72839f7858c6da932c8709d2d60",
    path: "lib/oxigraph/tests/sparql_egress_policy.rs",
    changeStatus: "A",
    blob: "fea9d5a25e680ff30d27592139152b85e0852581",
    contentSha256:
      "96a414d1ccf78e323e310a853ca6f1c060567c44b02b688b8de523a0ebf61e87",
    patchSha256:
      "aacc284628b9bb64073a97eee29c555fef327c23cd169cf15ea2e1d1e1d9ee91",
  },
  mutableExact: [
    "lib/oxigraph/src/http.rs",
    "lib/oxigraph/src/io/loader.rs",
    "lib/oxigraph/src/sparql/mod.rs",
    "lib/oxigraph/src/sparql/http.rs",
    "lib/oxigraph/src/sparql/update.rs",
    "lib/oxigraph/Cargo.toml",
  ],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/src/lib.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/store",
    "lib/oxigraph/src/storage",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: EXPECTED.verificationSequence,
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--no-run",
        "--test",
        "sparql_update_load_http",
        "--test",
        "sparql_service_http",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_egress_policy",
      ],
      timeoutMs: 180_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_update_load_http",
      ],
      timeoutMs: 120_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_service_http",
      ],
      timeoutMs: 120_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 262_144,
    maxChangedFiles: 6,
    maxChangedLines: 1_536,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0432",
    rustcErrorCount: 21,
    primaryPath: "lib/oxigraph/tests/sparql_egress_policy.rs",
    requiredExports: [
      "EgressError",
      "EgressErrorKind",
      "EgressPolicy",
      "EgressPolicyConfigurationError",
      "EgressPurpose",
      "with_egress_policy",
    ],
    requiredSubstrings: [
      "error[E0432]: unresolved imports",
      "could not compile `oxigraph` (test \"sparql_egress_policy\") due to 21 previous errors",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: { publicPassed: 12, independentPassed: 8, regressionPassed: 13 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/http.rs",
    mutableBaselineBlob: "f248e3e558cf1720119b2d3489d913c091c0e199",
    mutableBaselineSha256:
      "b08c852f66347b1db1a234fc27f9ef1fceed2ee091e92a5ee18af3911d14d8c7",
    baselineManifest: {
      entries: 1387,
      fullSha256:
        "68adad8178869439c67a3ee46eb13d9a7ed6b9fae76b657fcc7f21f3f2b5490e",
      protectedEntries: 1381,
      protectedSha256:
        "d06baeaa20287712b2ed8fbda43acedf118ec1c49fe197d8c560c9a6c41dd178",
    },
    evaluatorManifest: {
      entries: 1388,
      fullSha256:
        "e872004eeae99ae183d399a5686517bc2ceb552802b892e7e1f589e0ae9f5c6c",
      protectedEntries: 1382,
      protectedSha256:
        "5f7c03cef435fd8ed8750b6ce13f8807481413e75dc1b943dbc118fdd9ccda30",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_G15B = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0019",
  baseline: {
    commit: "9408e9cd9253c5a606f390d9dec075b22588c4b0",
    tree: "888767f478acd47a1e0664cf483885dfac20c209",
  },
  evaluator: {
    commit: "776b212dda26a4967f82098a90ade4c2d83aade1",
    parent: "9408e9cd9253c5a606f390d9dec075b22588c4b0",
    tree: "8f966046c4aa9f160a0869e0bac6d72cde04efa2",
    path: "lib/oxigraph/tests/sparql_update_cancellation.rs",
    changeStatus: "A",
    blob: "e7f615028a043a2b49c32e3115d7309f55067a7b",
    contentSha256:
      "0e323a7020917b0e17a77d12d2cb00505167d54c8089b9297b66198bac8c448a",
    patchSha256:
      "fbb93b4cfead8c6cf333241a647f13478c3380580bb0a9547c473fee0f6b5a7e",
  },
  mutableExact: [
    "lib/oxigraph/src/sparql/update.rs",
    "lib/oxigraph/src/sparql/error.rs",
    "lib/oxigraph/src/sparql/mod.rs",
    "lib/oxigraph/src/storage/mod.rs",
  ],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "lib/oxigraph/src/lib.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/store",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: EXPECTED.verificationSequence,
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--no-run",
        "--test",
        "rocksdb_writer_serialization",
        "--test",
        "sparql_egress_policy",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "sparql_update_cancellation",
      ],
      timeoutMs: 180_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "rocksdb_writer_serialization",
      ],
      timeoutMs: 120_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_egress_policy",
      ],
      timeoutMs: 180_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 196_608,
    maxChangedFiles: 4,
    maxChangedLines: 1_024,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0599",
    rustcErrorCount: 1,
    primaryPath: "lib/oxigraph/tests/sparql_update_cancellation.rs",
    requiredExports: ["Cancelled"],
    requiredSubstrings: [
      "no variant, associated function, or constant named `Cancelled` found for enum `UpdateEvaluationError`",
      "could not compile `oxigraph` (test \"sparql_update_cancellation\") due to 1 previous error",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: { publicPassed: 6, independentPassed: 6, regressionPassed: 12 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/sparql/update.rs",
    mutableBaselineBlob: "111ee935fc3a4a4be54aaf8e58d145aa2151bcaf",
    mutableBaselineSha256:
      "6f370674352fb0a33c5b74fd3052fa47cd2fad449138559397ae3ea507baed3d",
    baselineManifest: {
      entries: 1389,
      fullSha256:
        "f795407f620e470cd755c243145ced1bef41a7eaf8ea306da72b22172737066f",
      protectedEntries: 1385,
      protectedSha256:
        "7b614631844d644aedb617d654813448f226ba35c59fd0b64e72c850fcf4e91f",
    },
    evaluatorManifest: {
      entries: 1390,
      fullSha256:
        "031eaf844ac6dda195ccc40d08d22df6120c4899c90a3b9c192b756e05e4369e",
      protectedEntries: 1386,
      protectedSha256:
        "65cedf8d5a2cb289b3cd60d929fbc04fbbd1332e508a2bfd697f738b51c2c0f3",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_G15C = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0019",
  baseline: {
    commit: "86d93890ad5f9504a267a571bdeff01431e9144b",
    tree: "572089d8becd9b7ab1cbb1ab77b6e0166d686950",
  },
  evaluator: {
    commit: "fbd11e1802c295da3b4e510686e18090b62f381b",
    parent: "86d93890ad5f9504a267a571bdeff01431e9144b",
    tree: "d36eeb470334b7be3fe381b52c640d95e724c479",
    path: "lib/oxigraph/tests/sparql_negotiated_update.rs",
    changeStatus: "A",
    blob: "1338d8d55520f9405aaeba1b5d06ee340bed4deb",
    contentSha256:
      "fa7515ca0b0a058d6f1a2613d65f45a8d9fb29459d269a8a391aa5b2bb57cac6",
    patchSha256:
      "6a67bad0ce50de23e7a926218e163d2508a1e6f766231cec41d41db8193752cc",
  },
  mutableExact: [
    "lib/oxigraph/src/sparql/update.rs",
    "lib/oxigraph/src/sparql/mod.rs",
    "lib/oxigraph/src/store.rs",
  ],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "lib/oxigraph/src/lib.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/store",
    "lib/oxigraph/src/storage",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: EXPECTED.verificationSequence,
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--no-run",
        "--test",
        "transaction_capabilities",
        "--test",
        "rocksdb_writer_serialization",
        "--test",
        "sparql_update_cancellation",
        "--test",
        "sparql_egress_policy",
        "--test",
        "transactional_dataset",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "sparql_negotiated_update",
      ],
      timeoutMs: 180_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_capabilities",
        "--test",
        "rocksdb_writer_serialization",
      ],
      timeoutMs: 240_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_update_cancellation",
        "--test",
        "sparql_egress_policy",
        "--test",
        "transactional_dataset",
      ],
      timeoutMs: 300_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 196_608,
    maxChangedFiles: 3,
    maxChangedLines: 1_024,
    maxResidentBytes: 17_179_869_184,
    maxVerifierDiskBytes: 12_884_901_888,
    cargoBuildJobs: 1,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0599",
    rustcErrorCount: 2,
    primaryPath: "lib/oxigraph/tests/sparql_negotiated_update.rs",
    requiredExports: ["new", "on_dataset_with_request"],
    requiredSubstrings: [
      "no associated function or constant named `new` found for struct `NegotiatedTransaction<T>` in the current scope",
      "no method named `on_dataset_with_request` found for struct `PreparedSparqlUpdate` in the current scope",
      "could not compile `oxigraph` (test \"sparql_negotiated_update\") due to 2 previous errors",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: { publicPassed: 5, independentPassed: 9, regressionPassed: 3 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/sparql/update.rs",
    mutableBaselineBlob: "6d8eaab90f5ee4becfb2fe16f11656a3ac5619cc",
    mutableBaselineSha256:
      "04aeabff6ee95ed0c7c566da0876397c586c02c34553ae99009c3891b7a6594a",
    baselineManifest: {
      entries: 1391,
      fullSha256:
        "cca20d5db9845a5c8b9f07bbac7e4bff3b830d4b9e4e2aa7e4de91617797a2da",
      protectedEntries: 1388,
      protectedSha256:
        "9024f8985ced26f3b7493b1b9e0529e47c3757d9a346db17edcbdd579504e584",
    },
    evaluatorManifest: {
      entries: 1392,
      fullSha256:
        "6b847357e16e59e9a6bd586069e08100838babd3625e16be2e050b6bacde5783",
      protectedEntries: 1389,
      protectedSha256:
        "f0d009cd1b48b6c850b45026a2956fea752c8e9cf932022d7e34aa37cf5fb2bb",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_G16 = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0019",
  baseline: {
    commit: "826bd7a2622282b4194aa03ffc1b9effbb0adae0",
    tree: "a7b1c37e9965b6dcdbebd9cf76377110e9e6ef85",
  },
  evaluator: {
    commit: "8dcb795a08e3605c18c662d13b040311a260ac2b",
    parent: "826bd7a2622282b4194aa03ffc1b9effbb0adae0",
    tree: "973d5ed5615fc2f34a1e9d0da657d01f5c899755",
    path: "lib/oxigraph/tests/sparql_effective_capabilities.rs",
    changeStatus: "A",
    blob: "4f8156e3b3e34af2482bb40a87110f35576c458c",
    contentSha256:
      "4a150b695de39baba392a9282365bd74c86cde20422f64e7dd3c3e054cc80416",
    patchSha256:
      "93893693ed9804d56589169168c4dcd464bdeef2bc8dfea9e0eee0689888cee6",
  },
  evaluatorChanges: Object.freeze([
    Object.freeze({
      changeStatus: "M",
      path: "cli/src/service_description/tests.rs",
      blob: "79a47ba4feb872e79fa4b6e6291eb8bdf4b8d293",
      contentSha256:
        "5de8a8dfdc0d3730792babcc7b671f1c0fa5bb0c6056417c0ae821a10a2b20b9",
    }),
    Object.freeze({
      changeStatus: "A",
      path: "lib/oxigraph/tests/sparql_effective_capabilities.rs",
      blob: "4f8156e3b3e34af2482bb40a87110f35576c458c",
      contentSha256:
        "4a150b695de39baba392a9282365bd74c86cde20422f64e7dd3c3e054cc80416",
    }),
  ]),
  mutableExact: [
    "lib/oxigraph/src/http.rs",
    "lib/oxigraph/src/sparql/mod.rs",
    "cli/src/service_description.rs",
    "cli/src/main.rs",
  ],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "cli/Cargo.toml",
    "lib/oxigraph/src/lib.rs",
    "cli/src/service_description/tests.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/io",
    "lib/oxigraph/src/storage",
    "lib/oxigraph/src/store",
    "cli/tests",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: [
    "format",
    "build",
    "public",
    "service",
    "compatibility",
    "independent",
    "regression",
  ],
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "-p",
        "oxigraph-cli",
        "--features",
        "oxigraph/http-client-native-tls,oxigraph/rdf-12,oxigraph-cli/native-tls,oxigraph-cli/rdf-12",
        "--test",
        "sparql_version",
        "--test",
        "sparql_egress_policy",
        "--bin",
        "oxigraph",
        "--no-run",
      ],
      timeoutMs: 2_700_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client-native-tls,rdf-12",
        "--test",
        "sparql_effective_capabilities",
      ],
      timeoutMs: 300_000,
    },
    service: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph-cli",
        "--features",
        "native-tls,rdf-12",
        "--bin",
        "oxigraph",
        "service_description::tests::",
      ],
      timeoutMs: 300_000,
    },
    compatibility: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph-cli",
        "--no-default-features",
        "--features",
        "oxigraph/http-client-native-tls,rdfs,geosparql,owl2-rl",
        "--bin",
        "oxigraph",
        "service_description::tests::dependency_qualified_library_tls_is_enforced_without_cli_tls",
        "--",
        "--exact",
        "--ignored",
      ],
      timeoutMs: 300_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "rdf-12",
        "--test",
        "sparql_version",
      ],
      timeoutMs: 2_700_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--features",
        "http-client,rdf-12",
        "--test",
        "sparql_egress_policy",
      ],
      timeoutMs: 2_700_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 196_608,
    maxChangedFiles: 4,
    maxChangedLines: 1_024,
    maxResidentBytes: 17_179_869_184,
    maxVerifierDiskBytes: 12_884_901_888,
    maxTotalVerifierWallMs: 7_200_000,
    cargoBuildJobs: 1,
  },
  initialRed: {
    kind: "compiler",
    commandRole: "public",
    exitCode: 101,
    rustcCode: "E0599",
    rustcErrorCount: 1,
    primaryPath: "lib/oxigraph/tests/sparql_effective_capabilities.rs",
    requiredExports: ["effective_capabilities"],
    requiredSubstrings: [
      "no method named `effective_capabilities` found for reference `&SparqlEvaluator` in the current scope",
      "could not compile `oxigraph` (test \"sparql_effective_capabilities\") due to 1 previous error",
    ],
    forbiddenSubstrings: [
      "no test target named",
      "linking with",
      "timed out",
      "No space left on device",
    ],
  },
  success: {
    publicPassed: 4,
    servicePassed: 17,
    compatibilityPassed: 1,
    independentPassed: 1,
    regressionPassed: 12,
  },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/http.rs",
    mutableBaselineBlob: "01bcc5be2fd40da24ba4d8a022f512d41a8da988",
    mutableBaselineSha256:
      "d682ac111541190229dd43da434efbad3c370baf9229c5b304730d7e2be53109",
    baselineManifest: {
      entries: 1401,
      fullSha256:
        "4efcf0307f589726806454375a39d675559d0759fc801e81def86a49c7f6f097",
      protectedEntries: 1397,
      protectedSha256:
        "93c149eaa757440b506bb8cfab42540dbe356a01f317077f7f817df4a54ed434",
    },
    evaluatorManifest: {
      entries: 1402,
      fullSha256:
        "e8cf534cde4c2d572b08a46604641441ed503a0ffb32cf4be1fb5e46bd9edc8c",
      protectedEntries: 1398,
      protectedSha256:
        "a5c3f5c448a9aa1a615f7b4b1d60b8c5e43965240c5981acb66fa356831b155f",
    },
    submodules: [
      ...EXPECTED.protectedInputs.submodules,
      {
        path: "cli/templates/yasgui",
        commit: "05a7ac428edeab35e40f66cafe0589ac9d224ee6",
        tree: "84c72c5bced4d33c566a915aa7bb126d9220fe84",
      },
    ],
  },
});

const EXPECTED_G14B = Object.freeze({
  topKeys: EXPECTED.topKeys,
  routing: EXPECTED.routing,
  decision: "ADR-0018",
  baseline: {
    commit: "9c13454350b951a24b68b996aaefb50e32997a06",
    tree: "6a5043617b539d07ec52851fe6113886796088b2",
  },
  evaluator: {
    commit: "fa832174f3023e035fbaad52721f1b616eb1752e",
    parent: "9c13454350b951a24b68b996aaefb50e32997a06",
    tree: "43e62330d649a4c8eff83dc8490530d873775dd8",
    path: "lib/oxigraph/src/store/transaction_outcome_faults.rs",
    changeStatus: "M",
    blob: "e1e2a35fd4f3cd76cca918e1befb8d9601452c88",
    contentSha256:
      "a90bd0351e5869faf05d6c96165b7b2f7611faca1106054ff5bfba54c6090b86",
    patchSha256:
      "d9c252e2bc5f0e0735da31b68a56adcf92931c106213bb2c9a8cf6b8d69be365",
  },
  mutableExact: ["lib/oxigraph/src/storage/rocksdb_wrapper.rs"],
  mutablePrefixes: [],
  blockedExact: [
    "Cargo.toml",
    "Cargo.lock",
    "lib/oxigraph/Cargo.toml",
    "lib/oxigraph/src/lib.rs",
    "lib/oxigraph/src/store.rs",
    "lib/oxigraph/src/storage/mod.rs",
    "lib/oxigraph/src/storage/memory.rs",
    "lib/oxigraph/src/storage/rocksdb.rs",
    "README.md",
    ".gitmodules",
  ],
  blockedPrefixes: [
    "lib/oxigraph/tests",
    "lib/oxigraph/benches",
    "lib/oxigraph/src/sparql",
    "lib/oxigraph/src/store",
    "oxrocksdb-sys",
    "docs",
    ".github",
    "tools",
  ],
  verificationSequence: [
    "format",
    "build",
    "public",
    "independent",
    "regression",
  ],
  commands: {
    format: EXPECTED.commands.format,
    build: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--no-run",
        "--lib",
        "--test",
        "transaction_outcomes",
        "--test",
        "transaction_compatibility",
      ],
      timeoutMs: 1_800_000,
    },
    public: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--lib",
        "store::transaction_outcome_faults::",
      ],
      timeoutMs: 300_000,
    },
    independent: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_outcomes",
      ],
      timeoutMs: 300_000,
    },
    regression: {
      argv: [
        "cargo",
        "test",
        "--locked",
        "-p",
        "oxigraph",
        "--test",
        "transaction_compatibility",
      ],
      timeoutMs: 420_000,
    },
  },
  ceilings: {
    ...EXPECTED.ceilings,
    maxPatchBytes: 65_536,
    maxChangedFiles: 1,
    maxChangedLines: 512,
  },
  initialRed: {
    commandRole: "public",
    exitCode: 101,
    passed: 6,
    failed: 2,
    requiredSubstrings: [
      "store::transaction_outcome_faults::commit_attempted_prewrite_failure_cannot_be_rolled_back",
      "commit-attempted pre-write failure was falsely proven rolled back",
      "store::transaction_outcome_faults::commit_attempted_postwrite_error_cannot_be_rolled_back",
      "commit-attempted post-write error was falsely proven rolled back",
    ],
    forbiddenSubstrings: [
      "could not compile",
      "no test target named",
      "timed out",
      "No space left on device",
    ],
  },
  success: { publicPassed: 8, independentPassed: 7, regressionPassed: 20 },
  protectedInputs: {
    manifestAlgorithm: MANIFEST_ALGORITHM,
    mutableExclusion: "lib/oxigraph/src/storage/rocksdb_wrapper.rs",
    mutableBaselineBlob: "10fc79e55633752cb2d11377fe0d142f4038729c",
    mutableBaselineSha256:
      "8e6036308b37333059f5b5ab19c01cf5095e204347bc46e267e61fc3f44bdc6d",
    baselineManifest: {
      entries: 1480,
      fullSha256:
        "9f008380ead8e69a1a0f357344e27b33692c1882eb20af2a8fe9a762d1e599e5",
      protectedEntries: 1479,
      protectedSha256:
        "a5d5793039c1d6ac49df77d36783d3d62818686101bb677ea48a10af8409b920",
    },
    evaluatorManifest: {
      entries: 1480,
      fullSha256:
        "49fe87c2d4db2f836146a80974cdeff20475c757314d779728b8f396206ea681",
      protectedEntries: 1479,
      protectedSha256:
        "432273f0a1bb93da7bf2f4bbd4d1d26c0743e156ff44fc02081dabb9bd7ac703",
    },
    submodules: EXPECTED.protectedInputs.submodules,
  },
});

const EXPECTED_BY_ID = Object.freeze({
  "g1.2-rocksdb-serialized-writers": EXPECTED,
  "g1.3-transaction-capabilities": EXPECTED_G13,
  "g1.4-bounded-writer-admission": EXPECTED_G14,
  "g1.4a-store-terminal-outcomes": EXPECTED_G14A,
  "g1.4b-outcome-fault-safety": EXPECTED_G14B,
  "g1.5-unified-egress-policy": EXPECTED_G15,
  "g1.5b-update-cancellation": EXPECTED_G15B,
  "g1.5c-negotiated-update": EXPECTED_G15C,
  "g1.6-runtime-derived-service-claims": EXPECTED_G16,
});

if (!isDeepStrictEqual(Object.keys(EXPECTED_BY_ID), engineeringTaskIds)) {
  throw new Error(
    "engineering task registry must exactly match the ordered frozen contract ids",
  );
}

function fail(message) {
  throw new Error(`invalid engineering task contract: ${message}`);
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be a plain object`);
  }
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) {
    fail(`${label} keys must be exactly ${wanted.join(", ")}`);
  }
}

function exactValue(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label} does not match the frozen task value`);
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateHash(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} must be a lowercase hexadecimal object identifier`);
  }
}

function validatePath(value, label) {
  if (
    typeof value !== "string" ||
    !PATH.test(value) ||
    value === "." ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === ".") ||
    value.startsWith("-")
  ) {
    fail(`${label} must be a normalized repository-relative path`);
  }
}

function validatePathList(value, label) {
  if (!Array.isArray(value) || new Set(value).size !== value.length) {
    fail(`${label} must be an array of unique paths`);
  }
  for (const [index, path] of value.entries()) {
    validatePath(path, `${label}[${index}]`);
  }
}

function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function validateScope(scope, expected) {
  exactKeys(
    scope,
    [
      "mutableExact",
      "mutablePrefixes",
      "blockedExact",
      "blockedPrefixes",
      "allowCreate",
      "allowDelete",
      "allowRename",
      "allowModeChange",
      "allowSymlink",
      "allowSubmoduleChange",
    ],
    "scope",
  );
  for (const name of [
    "mutableExact",
    "mutablePrefixes",
    "blockedExact",
    "blockedPrefixes",
  ]) {
    validatePathList(scope[name], `scope.${name}`);
  }
  for (const name of [
    "allowCreate",
    "allowDelete",
    "allowRename",
    "allowModeChange",
    "allowSymlink",
    "allowSubmoduleChange",
  ]) {
    if (scope[name] !== false) fail(`scope.${name} must be false`);
  }
  for (const mutable of [...scope.mutableExact, ...scope.mutablePrefixes]) {
    if (
      scope.blockedExact.includes(mutable) ||
      scope.blockedPrefixes.some((prefix) => pathMatchesPrefix(mutable, prefix))
    ) {
      fail(`mutable path ${mutable} overlaps blocked scope`);
    }
  }
  exactValue(scope.mutableExact, expected.mutableExact, "scope.mutableExact");
  exactValue(
    scope.mutablePrefixes,
    expected.mutablePrefixes,
    "scope.mutablePrefixes",
  );
  exactValue(scope.blockedExact, expected.blockedExact, "scope.blockedExact");
  exactValue(
    scope.blockedPrefixes,
    expected.blockedPrefixes,
    "scope.blockedPrefixes",
  );
}

function validateCommands(commands, expectedCommands) {
  exactKeys(commands, Object.keys(expectedCommands), "commands");
  for (const [role, expected] of Object.entries(expectedCommands)) {
    const command = commands[role];
    exactKeys(command, ["argv", "timeoutMs"], `commands.${role}`);
    if (
      !Array.isArray(command.argv) ||
      command.argv.length === 0 ||
      command.argv.some(
        (part) =>
          typeof part !== "string" ||
          part.length === 0 ||
          part.includes("\0") ||
          part.includes("\n") ||
          part.includes("\r"),
      )
    ) {
      fail(`commands.${role}.argv must be literal non-empty strings`);
    }
    if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs <= 0) {
      fail(`commands.${role}.timeoutMs must be a positive safe integer`);
    }
    exactValue(command, expected, `commands.${role}`);
  }
}

function validateProtectedInputs(inputs, expected) {
  exactKeys(
    inputs,
    [
      "manifestAlgorithm",
      "mutableExclusion",
      "mutableBaselineBlob",
      "mutableBaselineSha256",
      "baselineManifest",
      "evaluatorManifest",
      "submodules",
    ],
    "protectedInputs",
  );
  if (inputs.manifestAlgorithm !== MANIFEST_ALGORITHM) {
    fail(`protectedInputs.manifestAlgorithm must be ${MANIFEST_ALGORITHM}`);
  }
  validatePath(inputs.mutableExclusion, "protectedInputs.mutableExclusion");
  if (inputs.mutableExclusion !== expected.mutableExact[0]) {
    fail("protectedInputs.mutableExclusion must equal the primary mutable path");
  }
  validateHash(inputs.mutableBaselineBlob, HEX40, "mutable baseline blob");
  validateHash(inputs.mutableBaselineSha256, HEX64, "mutable baseline digest");
  for (const name of ["baselineManifest", "evaluatorManifest"]) {
    const manifest = inputs[name];
    exactKeys(
      manifest,
      ["entries", "fullSha256", "protectedEntries", "protectedSha256"],
      `protectedInputs.${name}`,
    );
    for (const count of ["entries", "protectedEntries"]) {
      if (!Number.isSafeInteger(manifest[count]) || manifest[count] < 1) {
        fail(`protectedInputs.${name}.${count} must be a positive safe integer`);
      }
    }
    if (manifest.protectedEntries !== manifest.entries - expected.mutableExact.length) {
      fail(
        `protectedInputs.${name} must exclude every registered mutable entry`,
      );
    }
    validateHash(manifest.fullSha256, HEX64, `${name} full digest`);
    validateHash(manifest.protectedSha256, HEX64, `${name} protected digest`);
  }
  if (
    !Array.isArray(inputs.submodules) ||
    inputs.submodules.length !== expected.protectedInputs.submodules.length
  ) {
    fail("protectedInputs.submodules must contain every frozen gitlink");
  }
  for (const [index, submodule] of inputs.submodules.entries()) {
    exactKeys(submodule, ["path", "commit", "tree"], `submodules[${index}]`);
    validatePath(submodule.path, `submodules[${index}].path`);
    validateHash(submodule.commit, HEX40, `submodules[${index}].commit`);
    validateHash(submodule.tree, HEX40, `submodules[${index}].tree`);
  }
  if (
    new Set(inputs.submodules.map(({ path }) => path)).size !==
    inputs.submodules.length
  ) {
    fail("protectedInputs.submodules paths must be unique");
  }
  exactValue(inputs, expected.protectedInputs, "protectedInputs");
}

export function validateTaskContract(contract) {
  plainObject(contract, "contract");
  const expected = EXPECTED_BY_ID[contract.id];
  if (expected === undefined) fail("id must identify a registered frozen task");
  const profile = taskProfile(contract);
  exactKeys(contract, expected.topKeys, "contract");
  if (contract.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (contract.programme !== "linked-data-store") {
    fail("programme must be linked-data-store");
  }
  exactValue(contract.decision, expected.decision, "decision");
  if (typeof contract.objective !== "string" || contract.objective.length < 40) {
    fail("objective must be a substantive string");
  }
  if (contract.localOnly !== true) fail("localOnly must be true");
  if (contract.promotionAuthority !== false) {
    fail("promotionAuthority must be false");
  }

  exactKeys(
    contract.routing,
    ["pairedCalibration", "forbidOpenRouter", "providers"],
    "routing",
  );
  exactValue(contract.routing, expected.routing, "routing");

  exactKeys(contract.baseline, ["commit", "tree"], "baseline");
  exactKeys(
    contract.evaluator,
    [
      "commit",
      "parent",
      "tree",
      "path",
      "changeStatus",
      "blob",
      "contentSha256",
      "patchSha256",
    ],
    "evaluator",
  );
  for (const [label, value] of [
    ["baseline.commit", contract.baseline.commit],
    ["baseline.tree", contract.baseline.tree],
    ["evaluator.commit", contract.evaluator.commit],
    ["evaluator.parent", contract.evaluator.parent],
    ["evaluator.tree", contract.evaluator.tree],
    ["evaluator.blob", contract.evaluator.blob],
  ]) {
    validateHash(value, HEX40, label);
  }
  validateHash(contract.evaluator.contentSha256, HEX64, "evaluator content digest");
  validateHash(contract.evaluator.patchSha256, HEX64, "evaluator patch digest");
  validatePath(contract.evaluator.path, "evaluator.path");
  if (
    contract.evaluator.path !== profile.sourceAllowlist.find(
      (path) => path === contract.evaluator.path,
    ) ||
    contract.evaluator.changeStatus !== profile.evaluatorChangeStatus
  ) {
    fail("evaluator path/status does not match the registered task profile");
  }
  exactValue(contract.baseline, expected.baseline, "baseline");
  exactValue(contract.evaluator, expected.evaluator, "evaluator");

  validateProtectedInputs(contract.protectedInputs, expected);
  validateScope(contract.scope, expected);
  for (const evaluatorChange of frozenEvaluatorChanges(contract)) {
    const blocked =
      contract.scope.blockedExact.includes(evaluatorChange.path) ||
      contract.scope.blockedPrefixes.some((prefix) =>
        pathMatchesPrefix(evaluatorChange.path, prefix),
      );
    if (!blocked) fail(`evaluator path ${evaluatorChange.path} must be blocked`);
    if (!profile.sourceAllowlist.includes(evaluatorChange.path)) {
      fail(`evaluator path ${evaluatorChange.path} must be source-allowlisted`);
    }
  }
  exactValue(
    contract.verificationSequence,
    expected.verificationSequence,
    "verificationSequence",
  );
  if (contract.verificationSequence.indexOf("build") > 1) {
    fail("build must precede every test command");
  }
  validateCommands(contract.commands, expected.commands);

  exactKeys(contract.ceilings, Object.keys(expected.ceilings), "ceilings");
  exactValue(contract.ceilings, expected.ceilings, "ceilings");
  for (const [name, value] of Object.entries(contract.ceilings)) {
    if (name !== "networkDuringVerification" && !Number.isSafeInteger(value)) {
      fail(`ceilings.${name} must be a safe integer`);
    }
  }
  if (contract.ceilings.networkDuringVerification !== false) {
    fail("verification network access must be disabled");
  }

  exactKeys(contract.initialRed, Object.keys(expected.initialRed), "initialRed");
  exactValue(contract.initialRed, expected.initialRed, "initialRed");
  exactKeys(contract.success, Object.keys(expected.success), "success");
  exactValue(contract.success, expected.success, "success");
  return contract;
}

function git(repoRoot, args, options = {}) {
  return execFileSync("/usr/bin/git", args, {
    cwd: repoRoot,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
    },
    encoding: options.buffer ? undefined : "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitObjectType(repoRoot, oid, expected) {
  const actual = git(repoRoot, ["cat-file", "-t", oid]).trim();
  if (actual !== expected) fail(`${oid} is ${actual}, expected ${expected}`);
}

function requireAncestor(repoRoot, ancestor, descendant) {
  const result = spawnSync(
    "/usr/bin/git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        HOME: "/nonexistent",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) fail(`could not check Git ancestry: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${ancestor} is not an ancestor of ${descendant}`);
  }
}

function manifest(repoRoot, commit, excludedPaths) {
  const excluded = new Set(
    Array.isArray(excludedPaths) ? excludedPaths : [excludedPaths],
  );
  const raw = git(repoRoot, ["ls-tree", "-r", "-z", commit], { buffer: true });
  const records = raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const protectedRecords = records.filter((record) => {
    const separator = record.indexOf("\t");
    if (separator < 0) fail(`malformed ls-tree record for ${commit}`);
    return !excluded.has(record.slice(separator + 1));
  });
  const encoded = (values) => Buffer.from(`${values.join("\0")}\0`, "utf8");
  return {
    entries: records.length,
    fullSha256: digest(encoded(records)),
    protectedEntries: protectedRecords.length,
    protectedSha256: digest(encoded(protectedRecords)),
  };
}

function verifySubmodule(repoRoot, evaluatorCommit, declaration) {
  const treeLine = git(repoRoot, [
    "ls-tree",
    evaluatorCommit,
    "--",
    declaration.path,
  ]).trim();
  const expected = `160000 commit ${declaration.commit}\t${declaration.path}`;
  if (treeLine !== expected) fail(`gitlink ${declaration.path} does not match`);

  const worktreePath = resolve(repoRoot, declaration.path);
  if (!isContained(repoRoot, worktreePath)) {
    fail(`submodule ${declaration.path} escapes the repository`);
  }
  const stat = lstatSync(worktreePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`submodule ${declaration.path} is not an initialized directory`);
  }
  const canonical = realpathSync(worktreePath);
  if (!isContained(repoRoot, canonical)) {
    fail(`submodule ${declaration.path} resolves outside the repository`);
  }
  const head = git(canonical, ["rev-parse", "HEAD"]).trim();
  const tree = git(canonical, ["rev-parse", "HEAD^{tree}"]).trim();
  if (head !== declaration.commit || tree !== declaration.tree) {
    fail(`submodule ${declaration.path} checkout does not match frozen input`);
  }
  if (git(canonical, ["status", "--porcelain=v1", "--untracked-files=all"]).trim()) {
    fail(`submodule ${declaration.path} has tracked working-tree changes`);
  }
}

function frozenEvaluatorChanges(contract) {
  const registered = EXPECTED_BY_ID[contract.id].evaluatorChanges;
  return (
    registered ?? [
      Object.freeze({
        changeStatus: contract.evaluator.changeStatus,
        path: contract.evaluator.path,
        blob: contract.evaluator.blob,
        contentSha256: contract.evaluator.contentSha256,
      }),
    ]
  );
}

export function verifyTaskContractRepository(contract, options = {}) {
  validateTaskContract(contract);
  const repoRoot = realpathSync(options.repoRoot ?? repositoryRoot);
  const baseline = contract.baseline.commit;
  const evaluator = contract.evaluator.commit;

  gitObjectType(repoRoot, baseline, "commit");
  gitObjectType(repoRoot, evaluator, "commit");
  const baselineTree = git(repoRoot, ["rev-parse", `${baseline}^{tree}`]).trim();
  const evaluatorTree = git(repoRoot, ["rev-parse", `${evaluator}^{tree}`]).trim();
  if (baselineTree !== contract.baseline.tree) fail("baseline tree does not match");
  if (evaluatorTree !== contract.evaluator.tree) fail("evaluator tree does not match");

  const parents = git(repoRoot, ["show", "-s", "--format=%P", evaluator])
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (!isDeepStrictEqual(parents, [contract.evaluator.parent])) {
    fail("evaluator must have exactly the frozen baseline as its sole parent");
  }
  if (contract.evaluator.parent !== baseline) {
    fail("evaluator parent declaration must equal baseline commit");
  }
  requireAncestor(repoRoot, baseline, evaluator);

  const changes = git(repoRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    evaluator,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  const evaluatorChanges = frozenEvaluatorChanges(contract);
  const expectedChanges = evaluatorChanges.map(
    ({ changeStatus, path }) => `${changeStatus}\t${path}`,
  );
  if (!isDeepStrictEqual(changes, expectedChanges)) {
    fail("evaluator commit must contain exactly the frozen evaluator changes");
  }

  const patch = git(repoRoot, ["diff", "--binary", baseline, evaluator], {
    buffer: true,
  });
  if (digest(patch) !== contract.evaluator.patchSha256) {
    fail("evaluator binary patch digest does not match");
  }
  for (const change of evaluatorChanges) {
    const evaluatorBlob = git(repoRoot, [
      "rev-parse",
      `${evaluator}:${change.path}`,
    ]).trim();
    if (evaluatorBlob !== change.blob) {
      fail(`evaluator blob does not match for ${change.path}`);
    }
    const evaluatorContent = git(repoRoot, ["show", `${evaluator}:${change.path}`], {
      buffer: true,
    });
    if (digest(evaluatorContent) !== change.contentSha256) {
      fail(`evaluator content digest does not match for ${change.path}`);
    }
  }

  const mutablePaths = contract.scope.mutableExact;
  const mutablePath = contract.protectedInputs.mutableExclusion;
  const mutableBlob = git(repoRoot, ["rev-parse", `${baseline}:${mutablePath}`]).trim();
  if (mutableBlob !== contract.protectedInputs.mutableBaselineBlob) {
    fail("mutable baseline blob does not match");
  }
  const mutableContent = git(repoRoot, ["show", `${baseline}:${mutablePath}`], {
    buffer: true,
  });
  if (digest(mutableContent) !== contract.protectedInputs.mutableBaselineSha256) {
    fail("mutable baseline content digest does not match");
  }
  const evaluatorMutableBlob = git(repoRoot, [
    "rev-parse",
    `${evaluator}:${mutablePath}`,
  ]).trim();
  if (evaluatorMutableBlob !== mutableBlob) {
    fail("evaluator commit modified the mutable product path");
  }

  for (const path of mutablePaths) {
    const baselineBlob = git(repoRoot, ["rev-parse", `${baseline}:${path}`]).trim();
    const evaluatorBlob = git(repoRoot, ["rev-parse", `${evaluator}:${path}`]).trim();
    if (evaluatorBlob !== baselineBlob) {
      fail(`evaluator commit modified mutable product path ${path}`);
    }
  }

  const baselineManifest = manifest(repoRoot, baseline, mutablePaths);
  const evaluatorManifest = manifest(repoRoot, evaluator, mutablePaths);
  exactValue(
    baselineManifest,
    contract.protectedInputs.baselineManifest,
    "baseline protected manifest",
  );
  exactValue(
    evaluatorManifest,
    contract.protectedInputs.evaluatorManifest,
    "evaluator protected manifest",
  );
  for (const submodule of contract.protectedInputs.submodules) {
    verifySubmodule(repoRoot, evaluator, submodule);
  }

  let registration = null;
  if (options.registrationCommit !== undefined) {
    validateHash(options.registrationCommit, HEX40, "registrationCommit");
    gitObjectType(repoRoot, options.registrationCommit, "commit");
    requireAncestor(repoRoot, evaluator, options.registrationCommit);
    registration = { commit: options.registrationCommit };
  }

  return {
    baseline: { commit: baseline, tree: baselineTree },
    evaluator: { commit: evaluator, tree: evaluatorTree },
    baselineManifest,
    evaluatorManifest,
    registration,
  };
}

export function loadTaskContract(options = {}) {
  if (Object.hasOwn(options, "contractPath")) {
    fail("contractPath selection is forbidden; select a registered taskId");
  }
  const selectedProfile = taskProfile(options.taskId ?? g12Profile.id);
  const requestedPath = resolve(selectedProfile.contractPath);
  const stat = lstatSync(requestedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("contract must be a regular, non-symbolic-link file");
  }
  const canonicalPath = realpathSync(requestedPath);
  if (
    canonicalPath !== requestedPath ||
    !isContained(harnessRoot, canonicalPath)
  ) {
    fail("contract must resolve to its registered canonical path");
  }
  const raw = readFileSync(canonicalPath);
  let contract;
  try {
    contract = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail(`contract JSON could not be parsed: ${error.message}`);
  }
  validateTaskContract(contract);
  if (contract.id !== selectedProfile.id) {
    fail("contract id does not match the selected registered task");
  }
  return {
    contract,
    contractPath: relative(repositoryRoot, canonicalPath),
    contractSha256: digest(raw),
  };
}

export function resolveTaskContract(options = {}) {
  const loaded = loadTaskContract(options);
  const repository = verifyTaskContractRepository(loaded.contract, options);
  return { ...loaded, repository };
}
