import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  asciiFoldPathBytes,
  diffTreesV2,
  loadTreeV2,
  projectTreeManifestV2,
  readBlobByOid,
  treeEntryAtPath,
} from "./candidate/tree-v2.mjs";
import { runGitBytes } from "./candidate/git.mjs";
import { validateTaskV2Path, validateTaskV2Scope } from "./policy/paths-v2.mjs";
import {
  isTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "./policy/task-v2-failures.mjs";

const TOP_LEVEL_KEYS = Object.freeze([
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
]);
const SCOPE_KEYS = Object.freeze([
  "mutableExact",
  "createExact",
  "mutablePrefixes",
  "blockedExact",
  "blockedPrefixes",
  "allowCreate",
  "allowDelete",
  "allowRename",
  "allowModeChange",
  "allowSymlink",
  "allowSubmoduleChange",
]);
const CEILING_KEYS = Object.freeze([
  "maxPatchBytes",
  "maxChangedFiles",
  "maxChangedLines",
  "maxWorkerOutputBytes",
  "maxBuildOutputBytes",
  "maxTestOutputBytesPerCommand",
  "maxTotalVerifierWallMs",
  "maxResidentBytes",
  "maxVerifierDiskBytes",
  "cargoBuildJobs",
  "maxRepairCycles",
  "maxCritiqueRounds",
  "networkDuringVerification",
]);
const RUNTIME_RED_KEYS = Object.freeze([
  "commandRole",
  "exitCode",
  "passed",
  "failed",
  "requiredSubstrings",
  "forbiddenSubstrings",
]);
const COMPILER_RED_KEYS = Object.freeze([
  "kind",
  "commandRole",
  "exitCode",
  "rustcCode",
  "rustcErrorCount",
  "primaryPath",
  "requiredExports",
  "requiredSubstrings",
  "forbiddenSubstrings",
]);
const MANIFEST_ALGORITHM = "git-ls-tree-r-z-sort-nul-sha256-v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const COMMAND_ROLE = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_SCOPE_PATHS = 32;
const MAX_SUBMODULES = 64;
const MAX_COMMANDS = 16;
const MAX_COMMAND_ARGUMENTS = 256;
const MAX_TEXT_LIST = 256;
const COMMIT_OUTPUT_CEILING = 1024 * 1024;
const PATCH_OUTPUT_CEILING = 256 * 1024 * 1024;

function fail(code, detail) {
  throw taskV2Failure(code, detail);
}

function exactRecord(
  value,
  expectedKeys,
  label,
  code = "ERR_CONTRACT_SCHEMA_OR_KEYS",
) {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      fail(code, `${label} must be a plain own-data record`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.some(
        (key) =>
          !("value" in descriptors[key]) ||
          descriptors[key].enumerable !== true,
      ) ||
      !isDeepStrictEqual([...keys].sort(), [...expectedKeys].sort())
    ) {
      fail(code, `${label} keys must be exact own data properties`);
    }
    return value;
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(code, error);
  }
}

function denseArray(
  value,
  label,
  maximum,
  code = "ERR_CONTRACT_SCHEMA_OR_KEYS",
) {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum
    ) {
      fail(code, `${label} must be a bounded plain dense array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const expected = new Set([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== expected.size ||
      keys.some((key) => !expected.has(key))
    ) {
      fail(code, `${label} must be a bounded plain dense array`);
    }
    const captured = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        fail(code, `${label} must contain only own data elements`);
      }
      captured.push(descriptor.value);
    }
    return captured;
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(code, error);
  }
}

function boundedString(value, label, { minimum = 1, maximum = 4096 } = {}) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.includes("\0") ||
    value.includes("\r")
  ) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `${label} must be bounded text`);
  }
  return value;
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must be a bounded safe integer`,
    );
  }
  return value;
}

function sha256(value, label, code = "ERR_CONTRACT_SCHEMA_OR_KEYS") {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(code, `${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function oidFormat(value, label, expectedFormat) {
  if (typeof value !== "string" || !OID.test(value) || /^0+$/u.test(value)) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} must be a full non-zero lowercase Git object identifier`,
    );
  }
  const format = value.length === 40 ? "sha1" : "sha256";
  if (expectedFormat !== undefined && format !== expectedFormat) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} does not use the contract Git object format`,
    );
  }
  return format;
}

function stringList(
  value,
  label,
  { maximum = MAX_TEXT_LIST, nonempty = false } = {},
) {
  const values = denseArray(value, label, maximum);
  if (nonempty && values.length === 0) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `${label} must not be empty`);
  }
  for (const [index, item] of values.entries()) {
    boundedString(item, `${label}[${index}]`);
  }
  if (new Set(values).size !== values.length) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `${label} must not contain duplicates`);
  }
  return values;
}

function pathList(value, label, maximum = MAX_SCOPE_PATHS) {
  const values = denseArray(value, label, maximum);
  for (const [index, path] of values.entries()) {
    validateTaskV2Path(path, `${label}[${index}]`);
  }
  if (new Set(values).size !== values.length) {
    fail("ERR_PATH_OVERLAP", `${label} must not contain duplicates`);
  }
  return values;
}

function compareRawPaths(left, right) {
  return Buffer.compare(
    Buffer.from(left, "ascii"),
    Buffer.from(right, "ascii"),
  );
}

function requireCanonicalPaths(paths, label) {
  for (let index = 1; index < paths.length; index += 1) {
    if (compareRawPaths(paths[index - 1], paths[index]) >= 0) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `${label} is not canonically ordered`,
      );
    }
  }
}

function pathWithin(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function validateRouting(routing) {
  exactRecord(
    routing,
    ["pairedCalibration", "forbidOpenRouter", "providers"],
    "routing",
  );
  if (routing.pairedCalibration !== true || routing.forbidOpenRouter !== true) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "routing must require paired native providers",
    );
  }
  const providers = denseArray(routing.providers, "routing.providers", 2);
  if (providers.length !== 2) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "routing.providers must bind two providers",
    );
  }
  for (const [index, expectedProvider] of ["codex", "claude"].entries()) {
    const provider = exactRecord(
      providers[index],
      ["provider", "transport", "model"],
      `routing.providers[${index}]`,
    );
    if (
      provider.provider !== expectedProvider ||
      provider.transport !== "native" ||
      typeof provider.model !== "string" ||
      provider.model.length === 0 ||
      provider.model.length > 128 ||
      /openrouter/iu.test(provider.model)
    ) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        "routing provider binding is invalid",
      );
    }
  }
}

function validateScope(contract) {
  const scope = exactRecord(contract.scope, SCOPE_KEYS, "scope");
  const mutableExact = pathList(scope.mutableExact, "scope.mutableExact");
  const createExact = pathList(scope.createExact, "scope.createExact");
  const mutablePrefixes = pathList(
    scope.mutablePrefixes,
    "scope.mutablePrefixes",
  );
  const blockedExact = pathList(scope.blockedExact, "scope.blockedExact", 256);
  const blockedPrefixes = pathList(
    scope.blockedPrefixes,
    "scope.blockedPrefixes",
    256,
  );
  for (const name of [
    "allowCreate",
    "allowDelete",
    "allowRename",
    "allowModeChange",
    "allowSymlink",
    "allowSubmoduleChange",
  ]) {
    if (typeof scope[name] !== "boolean") {
      fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `scope.${name} must be boolean`);
    }
  }
  if (
    scope.allowDelete ||
    scope.allowRename ||
    scope.allowModeChange ||
    scope.allowSymlink ||
    scope.allowSubmoduleChange
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "v2 scope forbids non-creation transitions",
    );
  }
  const projected = validateTaskV2Scope(contract);
  if (scope.allowCreate !== createExact.length > 0) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "scope.allowCreate is not derived");
  }
  if (!isDeepStrictEqual(projected.mutableExact, mutableExact)) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "scope.mutableExact projection changed",
    );
  }
  return Object.freeze({
    mutableExact,
    createExact,
    mutablePrefixes,
    blockedExact,
    blockedPrefixes,
  });
}

function validateManifest(manifest, label, presentCount) {
  exactRecord(
    manifest,
    ["entries", "fullSha256", "protectedEntries", "protectedSha256"],
    label,
  );
  safeInteger(manifest.entries, `${label}.entries`);
  safeInteger(manifest.protectedEntries, `${label}.protectedEntries`);
  if (
    manifest.entries < presentCount ||
    manifest.protectedEntries !== manifest.entries - presentCount
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} does not subtract exactly the present mutable entries`,
    );
  }
  sha256(manifest.fullSha256, `${label}.fullSha256`);
  sha256(manifest.protectedSha256, `${label}.protectedSha256`);
}

function validatePresentIdentity(identity, label, objectFormat) {
  exactRecord(
    identity,
    ["state", "mode", "type", "objectId", "contentSha256"],
    label,
  );
  if (
    identity.state !== "present" ||
    identity.mode !== "100644" ||
    identity.type !== "blob"
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      `${label} is not a regular blob identity`,
    );
  }
  oidFormat(identity.objectId, `${label}.objectId`, objectFormat);
  sha256(identity.contentSha256, `${label}.contentSha256`);
}

function validateAbsentIdentity(identity, label) {
  exactRecord(identity, ["state"], label);
  if (identity.state !== "absent") {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `${label} must be explicitly absent`);
  }
}

function validateSubmodules(submodules, objectFormat) {
  const values = denseArray(
    submodules,
    "protectedInputs.submodules",
    MAX_SUBMODULES,
  );
  const paths = [];
  for (const [index, declaration] of values.entries()) {
    exactRecord(
      declaration,
      ["path", "commit", "tree"],
      `protectedInputs.submodules[${index}]`,
    );
    validateTaskV2Path(
      declaration.path,
      `protectedInputs.submodules[${index}].path`,
    );
    oidFormat(
      declaration.commit,
      `protectedInputs.submodules[${index}].commit`,
      objectFormat,
    );
    oidFormat(
      declaration.tree,
      `protectedInputs.submodules[${index}].tree`,
      objectFormat,
    );
    paths.push(declaration.path);
  }
  if (new Set(paths).size !== paths.length) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "submodule paths must be unique");
  }
  requireCanonicalPaths(paths, "protectedInputs.submodules");
  return values;
}

function validateProtectedInputs(inputs, scope, objectFormat) {
  exactRecord(
    inputs,
    [
      "manifestAlgorithm",
      "mutableBaselines",
      "baselineManifest",
      "evaluatorManifest",
      "submodules",
    ],
    "protectedInputs",
  );
  if (inputs.manifestAlgorithm !== MANIFEST_ALGORITHM) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "protected manifest algorithm is invalid",
    );
  }
  const baselines = denseArray(
    inputs.mutableBaselines,
    "protectedInputs.mutableBaselines",
    MAX_SCOPE_PATHS,
  );
  if (baselines.length !== scope.mutableExact.length) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "mutableBaselines must bind every exact mutable path once",
    );
  }
  const create = new Set(scope.createExact);
  let presentCount = 0;
  for (const [index, baseline] of baselines.entries()) {
    exactRecord(
      baseline,
      ["path", "state", "baseline", "evaluator"],
      `protectedInputs.mutableBaselines[${index}]`,
    );
    if (baseline.path !== scope.mutableExact[index]) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        "mutableBaselines paths must equal canonical mutableExact order",
      );
    }
    const expectedState = create.has(baseline.path) ? "absent" : "present";
    if (baseline.state !== expectedState) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        "mutable baseline state is inconsistent",
      );
    }
    if (expectedState === "absent") {
      validateAbsentIdentity(
        baseline.baseline,
        `protectedInputs.mutableBaselines[${index}].baseline`,
      );
      validateAbsentIdentity(
        baseline.evaluator,
        `protectedInputs.mutableBaselines[${index}].evaluator`,
      );
    } else {
      presentCount += 1;
      validatePresentIdentity(
        baseline.baseline,
        `protectedInputs.mutableBaselines[${index}].baseline`,
        objectFormat,
      );
      validatePresentIdentity(
        baseline.evaluator,
        `protectedInputs.mutableBaselines[${index}].evaluator`,
        objectFormat,
      );
      if (!isDeepStrictEqual(baseline.baseline, baseline.evaluator)) {
        fail(
          "ERR_CONTRACT_SCHEMA_OR_KEYS",
          "baseline and evaluator mutable identities must be independently equal",
        );
      }
    }
  }
  validateManifest(
    inputs.baselineManifest,
    "protectedInputs.baselineManifest",
    presentCount,
  );
  validateManifest(
    inputs.evaluatorManifest,
    "protectedInputs.evaluatorManifest",
    presentCount,
  );
  const submodules = validateSubmodules(inputs.submodules, objectFormat);
  return Object.freeze({ baselines, presentCount, submodules });
}

function validateCommands(sequence, commands) {
  const roles = denseArray(sequence, "verificationSequence", MAX_COMMANDS);
  if (
    roles.length < 3 ||
    roles[0] !== "format" ||
    roles[1] !== "build" ||
    new Set(roles).size !== roles.length ||
    roles.some((role) => typeof role !== "string" || !COMMAND_ROLE.test(role))
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "verificationSequence must begin with unique format/build roles",
    );
  }
  exactRecord(commands, roles, "commands");
  for (const role of roles) {
    const command = exactRecord(
      commands[role],
      ["argv", "timeoutMs"],
      `commands.${role}`,
    );
    const argv = denseArray(
      command.argv,
      `commands.${role}.argv`,
      MAX_COMMAND_ARGUMENTS,
    );
    if (argv.length === 0) {
      fail(
        "ERR_CONTRACT_SCHEMA_OR_KEYS",
        `commands.${role}.argv must not be empty`,
      );
    }
    let aggregateBytes = 0;
    for (const [index, argument] of argv.entries()) {
      if (
        typeof argument !== "string" ||
        argument.length === 0 ||
        argument.includes("\0") ||
        argument.includes("\r") ||
        argument.includes("\n")
      ) {
        fail(
          "ERR_CONTRACT_SCHEMA_OR_KEYS",
          `commands.${role}.argv[${index}] is not literal text`,
        );
      }
      aggregateBytes += Buffer.byteLength(argument, "utf8");
    }
    if (aggregateBytes > 1024 * 1024) {
      fail("ERR_CONTRACT_SCHEMA_OR_KEYS", `commands.${role}.argv is too large`);
    }
    safeInteger(command.timeoutMs, `commands.${role}.timeoutMs`, 1);
  }
  return roles;
}

function validateCeilings(ceilings, createCount) {
  exactRecord(ceilings, CEILING_KEYS, "ceilings");
  for (const name of CEILING_KEYS) {
    if (name === "networkDuringVerification") continue;
    const minimum = ["maxRepairCycles", "maxCritiqueRounds"].includes(name)
      ? 0
      : 1;
    safeInteger(ceilings[name], `ceilings.${name}`, minimum);
  }
  if (ceilings.networkDuringVerification !== false) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "verification network access must be false",
    );
  }
  if (ceilings.maxChangedFiles < createCount) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "maxChangedFiles cannot admit createExact",
    );
  }
  if (ceilings.maxPatchBytes > PATCH_OUTPUT_CEILING) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "maxPatchBytes exceeds the native ceiling",
    );
  }
}

function validateInitialRed(initialRed, roles) {
  let kindDescriptor;
  try {
    kindDescriptor =
      initialRed !== null &&
      (typeof initialRed === "object" || typeof initialRed === "function")
        ? Object.getOwnPropertyDescriptor(initialRed, "kind")
        : undefined;
  } catch (error) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", error);
  }
  const compiler = kindDescriptor !== undefined;
  exactRecord(
    initialRed,
    compiler ? COMPILER_RED_KEYS : RUNTIME_RED_KEYS,
    "initialRed",
  );
  if (
    compiler &&
    (!("value" in kindDescriptor) || kindDescriptor.value !== "compiler")
  ) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "initialRed.kind is invalid");
  }
  if (
    !roles.includes(initialRed.commandRole) ||
    ["format", "build"].includes(initialRed.commandRole)
  ) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "initialRed.commandRole is invalid");
  }
  safeInteger(initialRed.exitCode, "initialRed.exitCode", 1);
  stringList(initialRed.requiredSubstrings, "initialRed.requiredSubstrings", {
    nonempty: true,
  });
  stringList(initialRed.forbiddenSubstrings, "initialRed.forbiddenSubstrings");
  if (compiler) {
    if (!/^E[0-9]{4}$/u.test(initialRed.rustcCode)) {
      fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "initialRed.rustcCode is invalid");
    }
    safeInteger(initialRed.rustcErrorCount, "initialRed.rustcErrorCount", 1);
    validateTaskV2Path(initialRed.primaryPath, "initialRed.primaryPath");
    stringList(initialRed.requiredExports, "initialRed.requiredExports", {
      nonempty: true,
    });
  } else {
    safeInteger(initialRed.passed, "initialRed.passed");
    safeInteger(initialRed.failed, "initialRed.failed", 1);
  }
}

function validateSuccess(success, roles) {
  const expectedKeys = roles
    .filter((role) => !["format", "build"].includes(role))
    .map((role) => `${role}Passed`);
  exactRecord(success, expectedKeys, "success");
  for (const key of expectedKeys) safeInteger(success[key], `success.${key}`);
}

function validateTaskContractV2Internal(contract) {
  exactRecord(contract, TOP_LEVEL_KEYS, "contract");
  if (contract.schemaVersion !== 2) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "schemaVersion must be 2");
  }
  if (typeof contract.id !== "string" || !IDENTIFIER.test(contract.id)) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", "id must be a bounded task identifier");
  }
  if (
    contract.programme !== "linked-data-store" ||
    contract.decision !== "ADR-0034"
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "programme or decision binding is invalid",
    );
  }
  boundedString(contract.objective, "objective", {
    minimum: 40,
    maximum: 4096,
  });
  if (contract.localOnly !== true || contract.promotionAuthority !== false) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "v2 contract must remain local and non-promoting",
    );
  }
  validateRouting(contract.routing);

  exactRecord(contract.baseline, ["commit", "tree"], "baseline");
  exactRecord(
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
  const objectFormat = oidFormat(contract.baseline.commit, "baseline.commit");
  for (const [label, value] of [
    ["baseline.tree", contract.baseline.tree],
    ["evaluator.commit", contract.evaluator.commit],
    ["evaluator.parent", contract.evaluator.parent],
    ["evaluator.tree", contract.evaluator.tree],
    ["evaluator.blob", contract.evaluator.blob],
  ]) {
    oidFormat(value, label, objectFormat);
  }
  if (contract.evaluator.parent !== contract.baseline.commit) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "evaluator.parent must equal baseline.commit",
    );
  }
  validateTaskV2Path(contract.evaluator.path, "evaluator.path");
  if (!new Set(["A", "M"]).has(contract.evaluator.changeStatus)) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "evaluator.changeStatus must be A or M",
    );
  }
  sha256(contract.evaluator.contentSha256, "evaluator.contentSha256");
  sha256(contract.evaluator.patchSha256, "evaluator.patchSha256");

  const scope = validateScope(contract);
  const evaluatorBlocked =
    scope.blockedExact.includes(contract.evaluator.path) ||
    scope.blockedPrefixes.some((prefix) =>
      pathWithin(contract.evaluator.path, prefix),
    );
  if (!evaluatorBlocked) {
    fail("ERR_PATH_OVERLAP", "evaluator path must be inside blocked scope");
  }
  const protectedInputs = validateProtectedInputs(
    contract.protectedInputs,
    scope,
    objectFormat,
  );
  const roles = validateCommands(
    contract.verificationSequence,
    contract.commands,
  );
  validateCeilings(contract.ceilings, scope.createExact.length);
  validateInitialRed(contract.initialRed, roles);
  validateSuccess(contract.success, roles);
  return Object.freeze({ contract, objectFormat, scope, protectedInputs });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runTaskGit(reason, input) {
  try {
    return await runGitBytes(input);
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(reason, error);
  }
}

function parseCommit(bytes, label, objectFormat) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.includes(0) ||
    bytes.includes(0x0d)
  ) {
    fail("ERR_OBJECT_TYPE", `${label} commit object is malformed`);
  }
  const separator = bytes.indexOf(Buffer.from("\n\n", "ascii"));
  if (separator < 0)
    fail("ERR_OBJECT_TYPE", `${label} commit has no header boundary`);
  const lines = bytes.subarray(0, separator).toString("utf8").split("\n");
  const treeLines = lines.filter((line) => line.startsWith("tree "));
  const parentLines = lines.filter((line) => line.startsWith("parent "));
  if (treeLines.length !== 1 || lines[0] !== treeLines[0]) {
    fail("ERR_OBJECT_TYPE", `${label} commit does not have one leading tree`);
  }
  const tree = treeLines[0].slice(5);
  oidFormat(tree, `${label} commit tree`, objectFormat);
  const parents = parentLines.map((line, index) => {
    const parent = line.slice(7);
    oidFormat(parent, `${label} commit parent ${index}`, objectFormat);
    return parent;
  });
  return Object.freeze({ tree, parents: Object.freeze(parents) });
}

async function readCommit({
  repoRoot,
  home,
  oid,
  label,
  objectFormat,
  signal,
}) {
  const bytes = await runTaskGit("ERR_OBJECT_TYPE", {
    args: ["cat-file", "commit", oid],
    cwd: repoRoot,
    home,
    timeoutMs: 120_000,
    maxOutputBytes: COMMIT_OUTPUT_CEILING,
    signal,
  });
  return parseCommit(bytes, label, objectFormat);
}

function bytesEqual(left, right) {
  return left.length === right.length && left.equals(right);
}

function componentPrefix(path, prefix) {
  return (
    path.length > prefix.length &&
    path[prefix.length] === 0x2f &&
    path.subarray(0, prefix.length).equals(prefix)
  );
}

function componentRelated(left, right) {
  return (
    bytesEqual(left, right) ||
    componentPrefix(left, right) ||
    componentPrefix(right, left)
  );
}

function validatePathRelations(tree, path, expectedState, label) {
  const target = Buffer.from(path, "ascii");
  const foldedTarget = asciiFoldPathBytes(target);
  const exact = treeEntryAtPath(tree, path);
  if (expectedState === "absent" && exact !== undefined) {
    fail(
      "ERR_PARENT_TREE",
      `${label} absent target already exists as an object`,
    );
  }
  if (
    expectedState === "present" &&
    (exact === undefined || exact.mode !== "100644" || exact.type !== "blob")
  ) {
    fail("ERR_BASELINE_STATE", `${label} present target is not a regular blob`);
  }

  let slash = target.lastIndexOf(0x2f);
  while (slash !== -1) {
    const parent = target.subarray(0, slash);
    const parentEntry = treeEntryAtPath(tree, parent);
    if (
      parentEntry === undefined ||
      parentEntry.mode !== "040000" ||
      parentEntry.type !== "tree"
    ) {
      fail(
        "ERR_PARENT_TREE",
        `${label} does not have an exact regular tree parent`,
      );
    }
    slash = target.lastIndexOf(0x2f, slash - 1);
  }

  for (const entry of tree.entries) {
    const existing = entry.path;
    const foldedExisting = asciiFoldPathBytes(existing);
    if (!componentRelated(foldedExisting, foldedTarget)) continue;
    const allowedParent = componentPrefix(target, existing);
    const allowedOwn =
      expectedState === "present" && bytesEqual(existing, target);
    if (allowedParent && entry.mode === "040000" && entry.type === "tree")
      continue;
    if (allowedOwn) continue;
    if (componentRelated(existing, target)) {
      fail(
        "ERR_PARENT_TREE",
        `${label} has an exact object ancestry collision`,
      );
    }
    fail("ERR_PATH_COLLISION", `${label} has a portable case-fold collision`);
  }
  return exact;
}

async function verifyPresentMutable({
  baselineTree,
  evaluatorTree,
  declaration,
  repoRoot,
  home,
  signal,
}) {
  const baselineEntry = validatePathRelations(
    baselineTree,
    declaration.path,
    "present",
    `baseline ${declaration.path}`,
  );
  const evaluatorEntry = validatePathRelations(
    evaluatorTree,
    declaration.path,
    "present",
    `evaluator ${declaration.path}`,
  );
  for (const [phase, entry, expected] of [
    ["baseline", baselineEntry, declaration.baseline],
    ["evaluator", evaluatorEntry, declaration.evaluator],
  ]) {
    if (
      entry.mode !== expected.mode ||
      entry.type !== expected.type ||
      entry.oid !== expected.objectId
    ) {
      fail("ERR_BASELINE_STATE", `${phase} mutable identity does not match`);
    }
    const content = await readBlobByOid({
      workspace: repoRoot,
      home,
      oid: entry.oid,
      maxOutputBytes: 256 * 1024 * 1024,
      signal,
    });
    if (digest(content) !== expected.contentSha256) {
      fail(
        "ERR_BASELINE_STATE",
        `${phase} mutable content digest does not match`,
      );
    }
  }
  return Object.freeze({
    path: declaration.path,
    state: "present",
    objectId: baselineEntry.oid,
  });
}

function verifyAbsentMutable({ baselineTree, evaluatorTree, declaration }) {
  validatePathRelations(
    baselineTree,
    declaration.path,
    "absent",
    `baseline ${declaration.path}`,
  );
  validatePathRelations(
    evaluatorTree,
    declaration.path,
    "absent",
    `evaluator ${declaration.path}`,
  );
  return Object.freeze({ path: declaration.path, state: "absent" });
}

function manifestProjection(tree, exclusions) {
  const full = projectTreeManifestV2(tree);
  const protectedManifest = projectTreeManifestV2(tree, {
    exclude: exclusions,
  });
  return Object.freeze({
    entries: full.entries,
    fullSha256: full.sha256,
    protectedEntries: protectedManifest.entries,
    protectedSha256: protectedManifest.sha256,
  });
}

function verifyGitlinks(tree, declarations, label) {
  const expected = declarations.map(({ path, commit }) => ({ path, commit }));
  const actual = tree.entries
    .filter((entry) => entry.mode === "160000" && entry.type === "commit")
    .map((entry) => ({ path: entry.path.toString("utf8"), commit: entry.oid }))
    .sort((left, right) => compareRawPaths(left.path, right.path));
  if (!isDeepStrictEqual(actual, expected)) {
    fail(
      "ERR_BASELINE_STATE",
      `${label} gitlinks do not match frozen submodules`,
    );
  }
}

function containedPath(root, candidate) {
  const relation = relative(root, candidate);
  return (
    relation.length > 0 &&
    relation !== ".." &&
    !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(relation)
  );
}

async function verifySubmoduleCheckouts({
  repoRoot,
  home,
  signal,
  declarations,
  objectFormat,
}) {
  for (const declaration of declarations) {
    const worktree = resolve(repoRoot, declaration.path);
    if (!containedPath(repoRoot, worktree)) {
      fail("ERR_BASELINE_STATE", "submodule path escapes the repository");
    }
    let stat;
    let canonical;
    try {
      stat = await lstat(worktree);
      canonical = await realpath(worktree);
    } catch (error) {
      fail("ERR_BASELINE_STATE", error);
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !containedPath(repoRoot, canonical)
    ) {
      fail(
        "ERR_BASELINE_STATE",
        "submodule checkout is not a contained regular directory",
      );
    }

    const head = await runTaskGit("ERR_BASELINE_STATE", {
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: canonical,
      home,
      timeoutMs: 120_000,
      maxOutputBytes: 1024,
      signal,
    });
    if (!head.equals(Buffer.from(`${declaration.commit}\n`, "ascii"))) {
      fail("ERR_BASELINE_STATE", "submodule checkout HEAD does not match");
    }
    const commit = await readCommit({
      repoRoot: canonical,
      home,
      oid: declaration.commit,
      label: `submodule ${declaration.path}`,
      objectFormat,
      signal,
    });
    if (commit.tree !== declaration.tree) {
      fail("ERR_BASELINE_STATE", "submodule tree identity does not match");
    }
    const status = await runTaskGit("ERR_BASELINE_STATE", {
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: canonical,
      home,
      timeoutMs: 120_000,
      maxOutputBytes: 4 * 1024 * 1024,
      signal,
    });
    if (status.length !== 0) {
      fail("ERR_BASELINE_STATE", "submodule checkout is not clean");
    }
  }
}

async function verifyTaskContractRepositoryV2Internal(contract, options) {
  const validated = validateTaskContractV2Internal(contract);
  let hasSignal = false;
  try {
    hasSignal =
      options !== null &&
      typeof options === "object" &&
      Object.hasOwn(options, "signal");
  } catch (error) {
    fail("ERR_CONTRACT_SCHEMA_OR_KEYS", error);
  }
  exactRecord(
    options,
    ["repoRoot", "home", ...(hasSignal ? ["signal"] : [])],
    "repository verification options",
  );
  if (
    typeof options.repoRoot !== "string" ||
    options.repoRoot.length === 0 ||
    options.repoRoot.includes("\0") ||
    typeof options.home !== "string" ||
    options.home.length === 0 ||
    options.home.includes("\0")
  ) {
    fail(
      "ERR_CONTRACT_SCHEMA_OR_KEYS",
      "repository verification paths are invalid",
    );
  }
  let repoRoot;
  try {
    repoRoot = await realpath(options.repoRoot);
  } catch (error) {
    fail("ERR_BASELINE_STATE", error);
  }
  const { home, signal } = options;
  const baselineCommit = await readCommit({
    repoRoot,
    home,
    oid: contract.baseline.commit,
    label: "baseline",
    objectFormat: validated.objectFormat,
    signal,
  });
  const evaluatorCommit = await readCommit({
    repoRoot,
    home,
    oid: contract.evaluator.commit,
    label: "evaluator",
    objectFormat: validated.objectFormat,
    signal,
  });
  if (
    baselineCommit.tree !== contract.baseline.tree ||
    evaluatorCommit.tree !== contract.evaluator.tree
  ) {
    fail(
      "ERR_BASELINE_STATE",
      "commit tree identity does not match the contract",
    );
  }
  if (
    !isDeepStrictEqual(evaluatorCommit.parents, [contract.baseline.commit]) ||
    contract.evaluator.parent !== contract.baseline.commit
  ) {
    fail(
      "ERR_BASELINE_STATE",
      "evaluator is not the direct single-parent commit",
    );
  }

  const baselineTree = await loadTreeV2({
    workspace: repoRoot,
    home,
    tree: contract.baseline.tree,
    signal,
  });
  const evaluatorTree = await loadTreeV2({
    workspace: repoRoot,
    home,
    tree: contract.evaluator.tree,
    signal,
  });

  const mutableStates = [];
  for (const declaration of validated.protectedInputs.baselines) {
    mutableStates.push(
      declaration.state === "present"
        ? await verifyPresentMutable({
            baselineTree,
            evaluatorTree,
            declaration,
            repoRoot,
            home,
            signal,
          })
        : verifyAbsentMutable({ baselineTree, evaluatorTree, declaration }),
    );
  }

  const evaluatorBaselineState =
    contract.evaluator.changeStatus === "A" ? "absent" : "present";
  const oldEvaluatorEntry = validatePathRelations(
    baselineTree,
    contract.evaluator.path,
    evaluatorBaselineState,
    "baseline evaluator path",
  );
  const newEvaluatorEntry = validatePathRelations(
    evaluatorTree,
    contract.evaluator.path,
    "present",
    "evaluator path",
  );
  const rawDiff = await diffTreesV2({
    workspace: repoRoot,
    home,
    oldTree: contract.baseline.tree,
    newTree: contract.evaluator.tree,
    signal,
  });
  if (rawDiff.changeCount !== 1) {
    fail(
      "ERR_BASELINE_STATE",
      "evaluator must contain exactly one frozen raw change",
    );
  }
  const change = rawDiff.changes[0];
  if (
    !change.path.equals(Buffer.from(contract.evaluator.path, "ascii")) ||
    change.status !== contract.evaluator.changeStatus ||
    change.newOid !== contract.evaluator.blob ||
    newEvaluatorEntry.oid !== contract.evaluator.blob ||
    (change.status === "M" && oldEvaluatorEntry.oid !== change.oldOid)
  ) {
    fail(
      "ERR_BASELINE_STATE",
      "evaluator raw change does not match its frozen identity",
    );
  }
  const evaluatorContent = await readBlobByOid({
    workspace: repoRoot,
    home,
    oid: contract.evaluator.blob,
    maxOutputBytes: 256 * 1024 * 1024,
    signal,
  });
  if (digest(evaluatorContent) !== contract.evaluator.contentSha256) {
    fail("ERR_BASELINE_STATE", "evaluator blob content digest does not match");
  }
  const patch = await runTaskGit("ERR_BASELINE_STATE", {
    args: [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      contract.baseline.commit,
      contract.evaluator.commit,
      "--",
    ],
    cwd: repoRoot,
    home,
    timeoutMs: 120_000,
    maxOutputBytes: contract.ceilings.maxPatchBytes,
    signal,
  });
  if (digest(patch) !== contract.evaluator.patchSha256) {
    fail("ERR_BASELINE_STATE", "evaluator patch digest does not match");
  }

  const presentPaths = validated.protectedInputs.baselines
    .filter(({ state }) => state === "present")
    .map(({ path }) => path);
  const baselineManifest = manifestProjection(baselineTree, presentPaths);
  const evaluatorManifest = manifestProjection(evaluatorTree, presentPaths);
  if (
    !isDeepStrictEqual(
      baselineManifest,
      contract.protectedInputs.baselineManifest,
    ) ||
    !isDeepStrictEqual(
      evaluatorManifest,
      contract.protectedInputs.evaluatorManifest,
    )
  ) {
    fail("ERR_PROTECTED_MANIFEST", "phase protected manifests do not match");
  }
  verifyGitlinks(
    baselineTree,
    validated.protectedInputs.submodules,
    "baseline",
  );
  verifyGitlinks(
    evaluatorTree,
    validated.protectedInputs.submodules,
    "evaluator",
  );
  await verifySubmoduleCheckouts({
    repoRoot,
    home,
    signal,
    declarations: validated.protectedInputs.submodules,
    objectFormat: validated.objectFormat,
  });

  return Object.freeze({
    schema: "oxigraph.engineering-task-contract-repository/v2",
    objectFormat: validated.objectFormat,
    baseline: Object.freeze({
      commit: contract.baseline.commit,
      tree: contract.baseline.tree,
    }),
    evaluator: Object.freeze({
      commit: contract.evaluator.commit,
      tree: contract.evaluator.tree,
      parent: contract.evaluator.parent,
      path: contract.evaluator.path,
      changeStatus: change.status,
      blob: change.newOid,
    }),
    mutableBaselines: Object.freeze(mutableStates),
    baselineManifest,
    evaluatorManifest,
  });
}

export function validateTaskContractV2(contract) {
  return withTaskV2FailureBoundary(() => {
    validateTaskContractV2Internal(contract);
    return contract;
  });
}

export function verifyTaskContractRepositoryV2(contract, options) {
  return withTaskV2FailureBoundary(() =>
    verifyTaskContractRepositoryV2Internal(contract, options),
  );
}
