import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join, relative, resolve } from "node:path";

import { harnessRoot, isContained, repositoryRoot } from "./paths.mjs";
import { g12Profile, g13Profile, g14Profile, taskProfile } from "./task-profile.mjs";

export const g12ContractPath = g12Profile.contractPath;
export const g13ContractPath = g13Profile.contractPath;
export const g14ContractPath = g14Profile.contractPath;

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

const EXPECTED_BY_ID = Object.freeze({
  "g1.2-rocksdb-serialized-writers": EXPECTED,
  "g1.3-transaction-capabilities": EXPECTED_G13,
  "g1.4-bounded-writer-admission": EXPECTED_G14,
});

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
  if (!Array.isArray(inputs.submodules) || inputs.submodules.length !== 2) {
    fail("protectedInputs.submodules must contain the two frozen gitlinks");
  }
  for (const [index, submodule] of inputs.submodules.entries()) {
    exactKeys(submodule, ["path", "commit", "tree"], `submodules[${index}]`);
    validatePath(submodule.path, `submodules[${index}].path`);
    validateHash(submodule.commit, HEX40, `submodules[${index}].commit`);
    validateHash(submodule.tree, HEX40, `submodules[${index}].tree`);
  }
  if (new Set(inputs.submodules.map(({ path }) => path)).size !== 2) {
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
  if (contract.decision !== "ADR-0018") fail("decision must be ADR-0018");
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
  if (
    !contract.scope.blockedPrefixes.some((prefix) =>
      pathMatchesPrefix(contract.evaluator.path, prefix),
    )
  ) {
    fail("evaluator path must be in blocked prefix scope");
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
  const expectedChange = `${contract.evaluator.changeStatus}\t${contract.evaluator.path}`;
  if (!isDeepStrictEqual(changes, [expectedChange])) {
    fail("evaluator commit must add exactly the frozen evaluator-only path");
  }

  const patch = git(repoRoot, ["diff", "--binary", baseline, evaluator], {
    buffer: true,
  });
  if (digest(patch) !== contract.evaluator.patchSha256) {
    fail("evaluator binary patch digest does not match");
  }
  const evaluatorBlob = git(repoRoot, [
    "rev-parse",
    `${evaluator}:${contract.evaluator.path}`,
  ]).trim();
  if (evaluatorBlob !== contract.evaluator.blob) fail("evaluator blob does not match");
  const evaluatorContent = git(
    repoRoot,
    ["show", `${evaluator}:${contract.evaluator.path}`],
    { buffer: true },
  );
  if (digest(evaluatorContent) !== contract.evaluator.contentSha256) {
    fail("evaluator content digest does not match");
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
  const requestedPath = resolve(options.contractPath ?? g12ContractPath);
  if (!isContained(harnessRoot, requestedPath)) {
    fail("contract path escapes the engineering harness");
  }
  const stat = lstatSync(requestedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("contract must be a regular, non-symbolic-link file");
  }
  const canonicalPath = realpathSync(requestedPath);
  if (!isContained(harnessRoot, canonicalPath)) {
    fail("contract resolves outside the engineering harness");
  }
  const raw = readFileSync(canonicalPath);
  let contract;
  try {
    contract = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail(`contract JSON could not be parsed: ${error.message}`);
  }
  validateTaskContract(contract);
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
