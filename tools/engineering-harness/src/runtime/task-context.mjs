import { constants, lstat, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { runGit } from "../candidate/git.mjs";
import { isContained } from "../paths.mjs";
import { validateWorkerOutput, validateWorkerRole } from "../policy/authority.mjs";
import {
  MAX_LOGICAL_ARGV_ITEMS,
  MAX_SANDBOX_ARGV_ITEMS,
  MAX_TASK_ARG_BYTES,
} from "../policy/evidence-limits.mjs";
import { validateCandidatePatch } from "../policy/paths.mjs";
import { g12Profile, taskProfile } from "../task-profile.mjs";

export const G12_SOURCE_ALLOWLIST = g12Profile.sourceAllowlist;

export const G12_SOURCE_BYTE_CEILING = 512 * 1024;
const PER_FILE_BYTE_CEILING = 256 * 1024;
const MAX_PRIOR_BYTES = 384 * 1024;
const MAX_RECEIPT_BYTES = 512 * 1024;
const SOURCE_DIGEST_ALGORITHM = "sha256-length-framed-path-content-v1";
const sealedSnapshotAuthority = new WeakMap();
const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const TASK_ROLES = Object.freeze([
  "architecture",
  "critique",
  "implementation",
  "review",
  "repair",
]);
const CONTRACT_KEYS = Object.freeze([
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
const EVALUATOR_KEYS = Object.freeze([
  "temporaryRoot",
  "workspace",
  "targetRoot",
  "commandTemp",
  "gitHome",
  "evaluatorPatch",
  "candidateTree",
  "candidateCommit",
  "candidatePatchSha256",
  "evaluatorPatchSha256",
  "changedPaths",
  "protectedManifest",
  "kind",
]);
const CURRENT_CANDIDATE_KEYS = Object.freeze([
  "patch",
  "patchSha256",
  "commit",
  "tree",
  "protectedManifest",
]);
const COMMAND_EVIDENCE_KEYS = Object.freeze([
  "name",
  "logicalArgv",
  "sandboxArgv",
  "network",
  "workspace",
  "exitCode",
  "signal",
  "disposition",
  "durationMs",
  "stdoutSha256",
  "stderrSha256",
  "stdoutTail",
  "stderrTail",
]);
const ROLE_PRIORS = Object.freeze({
  architecture: Object.freeze([]),
  critique: Object.freeze(["architecture"]),
  implementation: Object.freeze(["architecture", "critique"]),
  review: Object.freeze(["architecture", "critique", "implementation"]),
  repair: Object.freeze(["architecture", "critique", "implementation"]),
});
const ROLE_DIRECTIVES = Object.freeze({
  architecture:
    "Design a minimal implementation within the frozen mutable path set. Explain state, concurrency, lifetime, failure, and regression risks. Do not return a patch.",
  critique:
    "Critique the supplied architecture against the frozen source, anomalies, scope, and verification contract. Do not return a patch.",
  implementation:
    "Produce one minimal unified diff confined to the frozen mutable path set that implements the accepted architecture and satisfies every frozen verifier command, including stable cargo fmt output.",
  review:
    "Independently review the candidate patch and verifier evidence for correctness, safety, scope compliance, and hidden regressions. Do not return a patch.",
  repair:
    "Produce one complete replacement unified diff from the frozen evaluator source to the repaired final state within the frozen mutable path set. Preserve every accepted candidate change, address the rejecting verifier evidence, and satisfy stable cargo fmt. Do not return an incremental diff against currentCandidate: reconstruction applies your patch directly to the evaluator tree.",
});

function fail(message) {
  throw new Error(`invalid engineering worker task context: ${message}`);
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
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} keys must be exactly ${wanted.join(", ")}`);
  }
}

function hash(bytes, algorithm = "sha256") {
  return createHash(algorithm).update(bytes).digest("hex");
}

function requireHash(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} must be a lowercase hexadecimal digest`);
  }
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
}

function requireString(value, label, maxBytes = 16 * 1024) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    Buffer.byteLength(value) > maxBytes
  ) {
    fail(`${label} must be a bounded NUL-free string`);
  }
  return value;
}

function requireStringArray(value, label, maximum = 256) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(`${label} must be a bounded string array`);
  }
  for (const [index, entry] of value.entries()) {
    requireString(entry, `${label}[${index}]`, 16 * 1024);
  }
}

function canonicalize(value, seen = new Set(), depth = 0) {
  if (depth > 32) fail("JSON binding exceeds the maximum nesting depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("JSON binding contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("JSON binding contains a cycle");
    seen.add(value);
    const result = value.map((entry) => canonicalize(entry, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  plainObject(value, "JSON binding value");
  if (seen.has(value)) fail("JSON binding contains a cycle");
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) fail("JSON binding contains undefined");
    result[key] = canonicalize(value[key], seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertLiteralArgv(value, label, maximum) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    fail(`${label} must be a non-empty bounded argv array`);
  }
  for (const [index, part] of value.entries()) {
    requireString(part, `${label}[${index}]`, MAX_TASK_ARG_BYTES);
    if (part.length === 0 || /[\r\n]/u.test(part)) {
      fail(`${label}[${index}] must be a literal non-empty argument`);
    }
  }
}

function validateContract(contract, contractSha256) {
  exactKeys(contract, CONTRACT_KEYS, "contract");
  const profile = taskProfile(contract);
  if (contractSha256 !== undefined) {
    requireHash(contractSha256, HEX64, "contractSha256");
  }
  if (contract.schemaVersion !== 1) fail("contract must use task schema v1");
  for (const [name, expected] of [
    ["programme", "linked-data-store"],
    ["decision", profile.decision],
  ]) {
    if (contract[name] !== expected) fail(`contract.${name} is not the frozen value`);
  }
  requireString(contract.objective, "contract.objective", 16 * 1024);
  if (contract.objective.length < 40) fail("contract.objective is not substantive");
  if (contract.localOnly !== true || contract.promotionAuthority !== false) {
    fail("contract must be local-only and carry no promotion authority");
  }

  exactKeys(contract.routing, ["pairedCalibration", "forbidOpenRouter", "providers"], "contract.routing");
  if (
    contract.routing.pairedCalibration !== true ||
    contract.routing.forbidOpenRouter !== true ||
    !Array.isArray(contract.routing.providers) ||
    contract.routing.providers.length !== 2
  ) {
    fail("contract routing must require paired native providers and forbid OpenRouter");
  }
  for (const [index, provider] of contract.routing.providers.entries()) {
    exactKeys(provider, ["provider", "transport", "model"], `contract.routing.providers[${index}]`);
    if (provider.transport !== "native") fail("contract provider transport must be native");
    requireString(provider.provider, `contract.routing.providers[${index}].provider`, 64);
    requireString(provider.model, `contract.routing.providers[${index}].model`, 256);
  }

  exactKeys(contract.baseline, ["commit", "tree"], "contract.baseline");
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
    "contract.evaluator",
  );
  for (const [label, value] of [
    ["baseline.commit", contract.baseline.commit],
    ["baseline.tree", contract.baseline.tree],
    ["evaluator.commit", contract.evaluator.commit],
    ["evaluator.parent", contract.evaluator.parent],
    ["evaluator.tree", contract.evaluator.tree],
    ["evaluator.blob", contract.evaluator.blob],
  ]) {
    requireHash(value, HEX40, `contract.${label}`);
  }
  if (contract.evaluator.parent !== contract.baseline.commit) {
    fail("evaluator parent must equal the baseline commit");
  }
  if (
    !profile.sourceAllowlist.includes(contract.evaluator.path) ||
    contract.evaluator.changeStatus !== profile.evaluatorChangeStatus
  ) {
    fail("contract evaluator path/status is not the registered frozen evaluator");
  }
  requireHash(contract.evaluator.contentSha256, HEX64, "contract.evaluator.contentSha256");
  requireHash(contract.evaluator.patchSha256, HEX64, "contract.evaluator.patchSha256");

  exactKeys(
    contract.protectedInputs,
    [
      "manifestAlgorithm",
      "mutableExclusion",
      "mutableBaselineBlob",
      "mutableBaselineSha256",
      "baselineManifest",
      "evaluatorManifest",
      "submodules",
    ],
    "contract.protectedInputs",
  );
  if (contract.protectedInputs.mutableExclusion !== profile.mutablePath) {
    fail("contract mutable exclusion is not the registered mutable source path");
  }
  requireHash(contract.protectedInputs.mutableBaselineBlob, HEX40, "mutable baseline blob");
  requireHash(contract.protectedInputs.mutableBaselineSha256, HEX64, "mutable baseline source digest");
  for (const name of ["baselineManifest", "evaluatorManifest"]) {
    const manifest = contract.protectedInputs[name];
    exactKeys(
      manifest,
      ["entries", "fullSha256", "protectedEntries", "protectedSha256"],
      `contract.protectedInputs.${name}`,
    );
    requireSafeInteger(manifest.entries, `${name}.entries`, 1);
    requireSafeInteger(manifest.protectedEntries, `${name}.protectedEntries`, 1);
    requireHash(manifest.fullSha256, HEX64, `${name}.fullSha256`);
    requireHash(manifest.protectedSha256, HEX64, `${name}.protectedSha256`);
  }
  if (!Array.isArray(contract.protectedInputs.submodules)) {
    fail("contract.protectedInputs.submodules must be an array");
  }
  for (const [index, submodule] of contract.protectedInputs.submodules.entries()) {
    exactKeys(submodule, ["path", "commit", "tree"], `contract.protectedInputs.submodules[${index}]`);
    requireString(submodule.path, `submodule[${index}].path`, 4096);
    requireHash(submodule.commit, HEX40, `submodule[${index}].commit`);
    requireHash(submodule.tree, HEX40, `submodule[${index}].tree`);
  }

  exactKeys(contract.scope, SCOPE_KEYS, "contract.scope");
  const mutablePaths = profile.mutablePaths ?? [profile.mutablePath];
  if (
    !Array.isArray(contract.scope.mutableExact) ||
    canonicalJson(contract.scope.mutableExact) !== canonicalJson(mutablePaths) ||
    !Array.isArray(contract.scope.mutablePrefixes) ||
    contract.scope.mutablePrefixes.length !== 0
  ) {
    fail("contract scope must contain the registered mutable paths");
  }
  requireStringArray(contract.scope.blockedExact, "contract.scope.blockedExact");
  requireStringArray(contract.scope.blockedPrefixes, "contract.scope.blockedPrefixes");
  for (const name of SCOPE_KEYS.filter((key) => key.startsWith("allow"))) {
    if (contract.scope[name] !== false) fail(`contract.scope.${name} must be false`);
  }

  const sequence = ["format", "build", "public", "independent", "regression"];
  if (
    !Array.isArray(contract.verificationSequence) ||
    canonicalJson(contract.verificationSequence) !== canonicalJson(sequence)
  ) {
    fail("contract verification sequence is not the frozen five-stage sequence");
  }
  exactKeys(contract.commands, sequence, "contract.commands");
  for (const name of sequence) {
    exactKeys(contract.commands[name], ["argv", "timeoutMs"], `contract.commands.${name}`);
    assertLiteralArgv(
      contract.commands[name].argv,
      `contract.commands.${name}.argv`,
      MAX_LOGICAL_ARGV_ITEMS,
    );
    requireSafeInteger(contract.commands[name].timeoutMs, `contract.commands.${name}.timeoutMs`, 1);
  }
  exactKeys(contract.ceilings, CEILING_KEYS, "contract.ceilings");
  for (const name of CEILING_KEYS.filter((key) => key !== "networkDuringVerification")) {
    requireSafeInteger(contract.ceilings[name], `contract.ceilings.${name}`, 0);
  }
  if (contract.ceilings.networkDuringVerification !== false) {
    fail("contract verification must forbid network access");
  }
  const redKeys =
    contract.initialRed.kind === "compiler"
      ? [
          "kind",
          "commandRole",
          "exitCode",
          "rustcCode",
          "rustcErrorCount",
          "primaryPath",
          "requiredExports",
          "requiredSubstrings",
          "forbiddenSubstrings",
        ]
      : [
          "commandRole",
          "exitCode",
          "passed",
          "failed",
          "requiredSubstrings",
          "forbiddenSubstrings",
        ];
  exactKeys(contract.initialRed, redKeys, "contract.initialRed");
  if (contract.initialRed.commandRole !== "public") fail("initial red command must be public");
  for (const name of
    contract.initialRed.kind === "compiler"
      ? ["exitCode", "rustcErrorCount"]
      : ["exitCode", "passed", "failed"]) {
    requireSafeInteger(contract.initialRed[name], `contract.initialRed.${name}`, 0);
  }
  if (contract.initialRed.kind === "compiler") {
    requireString(contract.initialRed.rustcCode, "contract.initialRed.rustcCode", 16);
    requireString(contract.initialRed.primaryPath, "contract.initialRed.primaryPath", 4_096);
    requireStringArray(contract.initialRed.requiredExports, "contract.initialRed.requiredExports", 64);
  }
  requireStringArray(contract.initialRed.requiredSubstrings, "contract.initialRed.requiredSubstrings", 32);
  requireStringArray(contract.initialRed.forbiddenSubstrings, "contract.initialRed.forbiddenSubstrings", 32);
  exactKeys(contract.success, ["publicPassed", "independentPassed", "regressionPassed"], "contract.success");
  for (const name of Object.keys(contract.success)) {
    requireSafeInteger(contract.success[name], `contract.success.${name}`, 1);
  }
}

async function validateEvaluator(evaluator, contract) {
  exactKeys(evaluator, EVALUATOR_KEYS, "evaluator workspace descriptor");
  if (
    evaluator.kind !== "evaluator" ||
    evaluator.candidateCommit !== contract.evaluator.commit ||
    evaluator.candidateTree !== contract.evaluator.tree ||
    evaluator.candidatePatchSha256 !== null ||
    evaluator.evaluatorPatchSha256 !== contract.evaluator.patchSha256 ||
    !Array.isArray(evaluator.changedPaths) ||
    evaluator.changedPaths.length !== 0
  ) {
    fail("workspace descriptor is not the frozen evaluator reconstruction");
  }
  requireString(evaluator.evaluatorPatch, "evaluator.evaluatorPatch", 8 * 1024 * 1024);
  if (hash(evaluator.evaluatorPatch) !== contract.evaluator.patchSha256) {
    fail("evaluator patch bytes do not match the trusted contract");
  }
  exactKeys(evaluator.protectedManifest, ["entries", "sha256"], "evaluator.protectedManifest");
  if (
    evaluator.protectedManifest.entries !==
      contract.protectedInputs.evaluatorManifest.protectedEntries ||
    evaluator.protectedManifest.sha256 !==
      contract.protectedInputs.evaluatorManifest.protectedSha256
  ) {
    fail("evaluator protected manifest does not match the trusted contract");
  }
  for (const name of ["temporaryRoot", "workspace", "targetRoot", "commandTemp", "gitHome"]) {
    requireString(evaluator[name], `evaluator.${name}`, 32 * 1024);
  }
  const temporaryStat = await lstat(evaluator.temporaryRoot);
  const workspaceStat = await lstat(evaluator.workspace);
  if (
    temporaryStat.isSymbolicLink() ||
    !temporaryStat.isDirectory() ||
    workspaceStat.isSymbolicLink() ||
    !workspaceStat.isDirectory()
  ) {
    fail("evaluator temporary root and workspace must be real directories");
  }
  const temporaryRoot = await realpath(evaluator.temporaryRoot);
  const workspace = await realpath(evaluator.workspace);
  if (!isContained(temporaryRoot, workspace) || temporaryRoot === workspace) {
    fail("evaluator workspace escapes its private temporary root");
  }
  for (const name of ["targetRoot", "commandTemp", "gitHome"]) {
    const canonical = await realpath(evaluator[name]);
    if (!isContained(temporaryRoot, canonical) || canonical === temporaryRoot) {
      fail(`evaluator.${name} escapes its private temporary root`);
    }
  }
  const [head, tree] = await Promise.all([
    runGit({ args: ["rev-parse", "HEAD"], cwd: workspace, home: evaluator.gitHome }),
    runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: workspace, home: evaluator.gitHome }),
  ]);
  if (head.trim() !== contract.evaluator.commit || tree.trim() !== contract.evaluator.tree) {
    fail("evaluator checkout identity no longer matches the trusted contract");
  }
  return Object.freeze({ temporaryRoot, workspace });
}

function parseTreeEntries(output, sourceAllowlist) {
  const entries = new Map();
  for (const record of output.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (match === null || match[1] !== "100644") {
      fail("allowlisted source is not a regular 100644 Git blob");
    }
    if (entries.has(match[3])) fail(`Git tree duplicates allowlisted path ${match[3]}`);
    entries.set(match[3], match[2]);
  }
  if (
    entries.size !== sourceAllowlist.length ||
    sourceAllowlist.some((path) => !entries.has(path))
  ) {
    fail("evaluator tree does not contain the complete fixed source allowlist");
  }
  return entries;
}

async function requirePathComponents(root, path) {
  let current = root;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) fail(`allowlisted source contains a symlink: ${path}`);
    if (index < parts.length - 1 && !metadata.isDirectory()) {
      fail(`allowlisted source parent is not a directory: ${path}`);
    }
    if (index === parts.length - 1 && !metadata.isFile()) {
      fail(`allowlisted source is not a regular file: ${path}`);
    }
  }
  return current;
}

async function readSealedFile({ workspace, path, gitOid }) {
  const absolute = await requirePathComponents(workspace, path);
  const canonical = await realpath(absolute);
  if (!isContained(workspace, canonical)) fail(`allowlisted source escapes workspace: ${path}`);
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    fail("this host cannot provide no-follow source reads");
  }
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > PER_FILE_BYTE_CEILING) {
      fail(`allowlisted source exceeds its byte ceiling or is not regular: ${path}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      bytes.length !== after.size
    ) {
      fail(`allowlisted source changed while being read: ${path}`);
    }
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      fail(`allowlisted source is not valid UTF-8: ${path}`);
    }
    if (content.includes("\0")) fail(`allowlisted source contains a NUL byte: ${path}`);
    const blobHeader = Buffer.from(`blob ${bytes.length}\0`, "utf8");
    const actualOid = createHash("sha1").update(blobHeader).update(bytes).digest("hex");
    if (actualOid !== gitOid) fail(`allowlisted source differs from evaluator tree: ${path}`);
    return Object.freeze({
      path,
      bytes: bytes.length,
      sha256: hash(bytes),
      content,
    });
  } finally {
    await handle.close();
  }
}

function sourceDigest(files) {
  const digest = createHash("sha256");
  for (const file of files) {
    const path = Buffer.from(file.path, "utf8");
    const content = Buffer.from(file.content, "utf8");
    const pathLength = Buffer.alloc(4);
    const contentLength = Buffer.alloc(8);
    pathLength.writeUInt32BE(path.length);
    contentLength.writeBigUInt64BE(BigInt(content.length));
    digest.update(pathLength).update(path).update(contentLength).update(content);
  }
  return digest.digest("hex");
}

async function sealedSourceSnapshot(
  evaluator,
  contract,
  contractSha256,
  workspace,
) {
  const profile = taskProfile(contract);
  const sourceAllowlist = profile.sourceAllowlist;
  const output = await runGit({
    args: ["ls-tree", "-r", "-z", contract.evaluator.tree, "--", ...sourceAllowlist],
    cwd: workspace,
    home: evaluator.gitHome,
    maxOutputBytes: 256 * 1024,
  });
  const treeEntries = parseTreeEntries(output, sourceAllowlist);
  const files = [];
  let totalBytes = 0;
  for (const path of sourceAllowlist) {
    const file = await readSealedFile({ workspace, path, gitOid: treeEntries.get(path) });
    totalBytes += file.bytes;
    if (totalBytes > G12_SOURCE_BYTE_CEILING) {
      fail(`source snapshot exceeds the ${G12_SOURCE_BYTE_CEILING}-byte ceiling`);
    }
    files.push(file);
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  if (
    byPath.get(profile.mutablePath).sha256 !==
      contract.protectedInputs.mutableBaselineSha256 ||
    byPath.get(contract.evaluator.path).sha256 !== contract.evaluator.contentSha256
  ) {
    fail("mutable or evaluator source digest does not match the trusted contract");
  }
  return deepFreeze({
    algorithm: SOURCE_DIGEST_ALGORITHM,
    contractSha256,
    totalBytes,
    sha256: sourceDigest(files),
    files,
  });
}

function normalizePriorOutputs(role, priorOutputs, contract) {
  const required = ROLE_PRIORS[role];
  if (required.length === 0) return null;
  exactKeys(priorOutputs, required, "priorOutputs");
  const outputs = {};
  for (const priorRole of required) {
    const output = validateWorkerOutput(priorOutputs[priorRole], priorRole);
    if (priorRole !== "review" && output.verdict !== "ACCEPT") {
      fail(`prior ${priorRole} output must be accepted before ${role}`);
    }
    if (output.patch !== null) validateCandidatePatch(output.patch, contract);
    outputs[priorRole] = {
      summary: output.summary,
      patch: output.patch,
      findings: [...output.findings],
      verdict: output.verdict,
    };
  }
  const encoded = canonicalJson(outputs);
  if (Buffer.byteLength(encoded) > MAX_PRIOR_BYTES) fail("prior outputs exceed their byte ceiling");
  return deepFreeze({ sha256: hash(encoded), outputs });
}

function normalizeArtifact(value, index) {
  exactKeys(value, ["name", "sha256", "bytes"], `verifierReceipt.artifacts[${index}]`);
  requireString(value.name, `verifierReceipt.artifacts[${index}].name`, 4096);
  requireHash(value.sha256, HEX64, `verifierReceipt.artifacts[${index}].sha256`);
  requireSafeInteger(value.bytes, `verifierReceipt.artifacts[${index}].bytes`, 0);
  return { name: value.name, sha256: value.sha256, bytes: value.bytes };
}

function normalizeCommandEvidence(value, index, contract) {
  exactKeys(value, COMMAND_EVIDENCE_KEYS, `verifierReceipt.commands[${index}]`);
  const expectedName = contract.verificationSequence[index];
  if (value.name !== expectedName) fail("verifier receipt command order is not frozen");
  assertLiteralArgv(
    value.logicalArgv,
    `verifierReceipt.commands[${index}].logicalArgv`,
    MAX_LOGICAL_ARGV_ITEMS,
  );
  if (canonicalJson(value.logicalArgv) !== canonicalJson(contract.commands[expectedName].argv)) {
    fail(`verifier receipt ${expectedName} argv differs from the contract`);
  }
  assertLiteralArgv(
    value.sandboxArgv,
    `verifierReceipt.commands[${index}].sandboxArgv`,
    MAX_SANDBOX_ARGV_ITEMS,
  );
  if (value.network !== "isolated" || value.workspace !== "read-only") {
    fail("verifier receipt must prove isolated network and read-only workspace");
  }
  if (!Number.isInteger(value.exitCode) && value.exitCode !== null) {
    fail("verifier receipt exitCode must be an integer or null");
  }
  if (value.signal !== null) requireString(value.signal, "verifier receipt signal", 64);
  if (!["completed", "timed-out", "cancelled", "output-limit", "spawn-error"].includes(value.disposition)) {
    fail("verifier receipt disposition is unsupported");
  }
  requireSafeInteger(value.durationMs, "verifier receipt command durationMs", 0);
  requireHash(value.stdoutSha256, HEX64, "verifier receipt stdout digest");
  requireHash(value.stderrSha256, HEX64, "verifier receipt stderr digest");
  requireString(value.stdoutTail, "verifier receipt stdout tail", 4096);
  requireString(value.stderrTail, "verifier receipt stderr tail", 4096);
  return {
    name: value.name,
    logicalArgv: [...value.logicalArgv],
    sandboxArgv: [...value.sandboxArgv],
    network: value.network,
    workspace: value.workspace,
    exitCode: value.exitCode,
    signal: value.signal,
    disposition: value.disposition,
    durationMs: value.durationMs,
    stdoutSha256: value.stdoutSha256,
    stderrSha256: value.stderrSha256,
    stdoutTail: value.stdoutTail,
    stderrTail: value.stderrTail,
  };
}

function normalizeCurrentCandidate(value, contract) {
  exactKeys(value, CURRENT_CANDIDATE_KEYS, "currentCandidate");
  const patch = requireString(
    value.patch,
    "currentCandidate.patch",
    contract.ceilings.maxPatchBytes,
  );
  validateCandidatePatch(patch, contract);
  requireHash(value.patchSha256, HEX64, "currentCandidate.patchSha256");
  if (hash(patch) !== value.patchSha256) {
    fail("currentCandidate.patchSha256 does not bind the admitted patch bytes");
  }
  requireHash(value.commit, HEX40, "currentCandidate.commit");
  requireHash(value.tree, HEX40, "currentCandidate.tree");
  exactKeys(
    value.protectedManifest,
    ["entries", "sha256"],
    "currentCandidate.protectedManifest",
  );
  requireSafeInteger(
    value.protectedManifest.entries,
    "currentCandidate.protectedManifest.entries",
    1,
  );
  requireHash(
    value.protectedManifest.sha256,
    HEX64,
    "currentCandidate.protectedManifest.sha256",
  );
  if (
    value.protectedManifest.entries !==
      contract.protectedInputs.evaluatorManifest.protectedEntries ||
    value.protectedManifest.sha256 !==
      contract.protectedInputs.evaluatorManifest.protectedSha256
  ) {
    fail("currentCandidate protected manifest does not match the trusted contract");
  }
  return deepFreeze({
    patch,
    patchSha256: value.patchSha256,
    commit: value.commit,
    tree: value.tree,
    protectedManifest: {
      entries: value.protectedManifest.entries,
      sha256: value.protectedManifest.sha256,
    },
  });
}

function normalizeVerifierReceipt(role, receipt, contract, currentCandidate) {
  if (!Array.isArray(receipt?.commands)) fail("verifierReceipt.commands must be an array");
  const complete = Object.hasOwn(receipt, "candidateTree");
  exactKeys(
    receipt,
    complete
      ? ["verdict", "stage", "commands", "artifacts", "durationMs", "candidateTree", "protectedManifest"]
      : ["verdict", "stage", "commands", "artifacts", "durationMs"],
    "verifierReceipt",
  );
  if (!['ACCEPT', 'REJECT'].includes(receipt.verdict)) {
    fail("verifier receipt verdict must be ACCEPT or REJECT");
  }
  if (role === "review" && receipt.verdict !== "ACCEPT") {
    fail("review requires an accepted complete verifier receipt");
  }
  if (role === "repair" && receipt.verdict !== "REJECT") {
    fail("repair requires a rejecting verifier receipt");
  }
  requireString(receipt.stage, "verifierReceipt.stage", 64);
  if (
    receipt.commands.length === 0 ||
    receipt.commands.length > contract.verificationSequence.length ||
    (receipt.verdict === "ACCEPT" && receipt.commands.length !== contract.verificationSequence.length)
  ) {
    fail("verifier receipt has an invalid command count");
  }
  const commands = receipt.commands.map((entry, index) =>
    normalizeCommandEvidence(entry, index, contract),
  );
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length > 64) {
    fail("verifierReceipt.artifacts must be a bounded array");
  }
  const artifacts = receipt.artifacts.map(normalizeArtifact);
  requireSafeInteger(receipt.durationMs, "verifierReceipt.durationMs", 0);
  if (receipt.verdict === "ACCEPT") {
    if (
      receipt.stage !== "complete" ||
      commands.some(
        ({ disposition, exitCode }) => disposition !== "completed" || exitCode !== 0,
      ) ||
      artifacts.length === 0
    ) {
      fail("accepted verifier receipt is not complete and green");
    }
    for (const name of ["public", "independent", "regression"]) {
      const command = commands.find((entry) => entry.name === name);
      const expected = contract.success[`${name}Passed`];
      if (
        command === undefined ||
        !`${command.stdoutTail}\n${command.stderrTail}`.includes(
          `test result: ok. ${expected} passed; 0 failed;`,
        )
      ) {
        fail(`accepted verifier receipt does not prove ${name} success`);
      }
    }
  }
  const normalized = {
    verdict: receipt.verdict,
    stage: receipt.stage,
    commands,
    artifacts,
    durationMs: receipt.durationMs,
  };
  if (complete) {
    requireHash(receipt.candidateTree, HEX40, "verifierReceipt.candidateTree");
    exactKeys(receipt.protectedManifest, ["entries", "sha256"], "verifierReceipt.protectedManifest");
    requireSafeInteger(receipt.protectedManifest.entries, "verifierReceipt.protectedManifest.entries", 1);
    requireHash(receipt.protectedManifest.sha256, HEX64, "verifierReceipt.protectedManifest.sha256");
    if (
      receipt.protectedManifest.entries !==
        contract.protectedInputs.evaluatorManifest.protectedEntries ||
      receipt.protectedManifest.sha256 !==
        contract.protectedInputs.evaluatorManifest.protectedSha256
    ) {
      fail("verifier receipt protected manifest does not match the contract");
    }
    normalized.candidateTree = receipt.candidateTree;
    normalized.protectedManifest = { ...receipt.protectedManifest };
  } else if (receipt.verdict === "ACCEPT") {
    fail("an accepted verifier receipt must bind the candidate tree");
  }
  if (["review", "repair"].includes(role)) {
    if (!complete) {
      fail(`${role} verifier receipt must bind the exact current candidate`);
    }
    if (
      normalized.candidateTree !== currentCandidate.tree ||
      normalized.protectedManifest.entries !==
        currentCandidate.protectedManifest.entries ||
      normalized.protectedManifest.sha256 !==
        currentCandidate.protectedManifest.sha256
    ) {
      fail(`${role} verifier receipt does not match the exact current candidate`);
    }
  }
  const encoded = canonicalJson(normalized);
  if (Buffer.byteLength(encoded) > MAX_RECEIPT_BYTES) fail("verifier receipt exceeds its byte ceiling");
  return deepFreeze({
    sha256: hash(encoded),
    currentCandidateSha256: hash(canonicalJson(currentCandidate)),
    receipt: normalized,
  });
}

function contractProjection(contract, contractSha256) {
  const commands = {};
  for (const name of contract.verificationSequence) {
    commands[name] = { argv: [...contract.commands[name].argv] };
  }
  const projection = {
    contractSha256,
    contractId: contract.id,
    programme: contract.programme,
    decision: contract.decision,
    baseline: { ...contract.baseline },
    evaluator: {
      commit: contract.evaluator.commit,
      parent: contract.evaluator.parent,
      tree: contract.evaluator.tree,
      path: contract.evaluator.path,
      contentSha256: contract.evaluator.contentSha256,
      patchSha256: contract.evaluator.patchSha256,
    },
    scope: {
      mutableExact: [...contract.scope.mutableExact],
      mutablePrefixes: [...contract.scope.mutablePrefixes],
      allowCreate: contract.scope.allowCreate,
      allowDelete: contract.scope.allowDelete,
      allowRename: contract.scope.allowRename,
      allowModeChange: contract.scope.allowModeChange,
      allowSymlink: contract.scope.allowSymlink,
      allowSubmoduleChange: contract.scope.allowSubmoduleChange,
    },
    verification: {
      sequence: [...contract.verificationSequence],
      commands,
      initialRed: structuredClone(contract.initialRed),
      success: { ...contract.success },
    },
  };
  return deepFreeze({
    ...projection,
    projectionSha256: hash(canonicalJson(projection)),
  });
}

function validateCachedSourceSnapshot(snapshot, contract, contractSha256) {
  const profile = taskProfile(contract);
  const sourceAllowlist = profile.sourceAllowlist;
  exactKeys(
    snapshot,
    ["algorithm", "contractSha256", "totalBytes", "sha256", "files"],
    "sourceSnapshot",
  );
  if (snapshot.algorithm !== SOURCE_DIGEST_ALGORITHM) {
    fail("sourceSnapshot uses an unsupported digest algorithm");
  }
  requireHash(snapshot.contractSha256, HEX64, "sourceSnapshot.contractSha256");
  if (snapshot.contractSha256 !== contractSha256) {
    fail("sourceSnapshot raw contract digest differs from the task contract digest");
  }
  requireSafeInteger(snapshot.totalBytes, "sourceSnapshot.totalBytes", 1);
  if (snapshot.totalBytes > G12_SOURCE_BYTE_CEILING) {
    fail(`sourceSnapshot exceeds the ${G12_SOURCE_BYTE_CEILING}-byte ceiling`);
  }
  requireHash(snapshot.sha256, HEX64, "sourceSnapshot.sha256");
  if (
    !Array.isArray(snapshot.files) ||
    snapshot.files.length !== sourceAllowlist.length
  ) {
    fail("sourceSnapshot must contain the complete fixed allowlist");
  }
  const files = snapshot.files.map((file, index) => {
    exactKeys(file, ["path", "bytes", "sha256", "content"], `sourceSnapshot.files[${index}]`);
    if (file.path !== sourceAllowlist[index]) {
      fail("sourceSnapshot file order/path differs from the fixed allowlist");
    }
    requireSafeInteger(file.bytes, `sourceSnapshot.files[${index}].bytes`, 1);
    if (file.bytes > PER_FILE_BYTE_CEILING) {
      fail(`sourceSnapshot file exceeds its byte ceiling: ${file.path}`);
    }
    requireHash(file.sha256, HEX64, `sourceSnapshot.files[${index}].sha256`);
    requireString(file.content, `sourceSnapshot.files[${index}].content`, PER_FILE_BYTE_CEILING);
    const bytes = Buffer.from(file.content, "utf8");
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) {
      fail(`sourceSnapshot file binding is invalid: ${file.path}`);
    }
    return { path: file.path, bytes: file.bytes, sha256: file.sha256, content: file.content };
  });
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  if (totalBytes !== snapshot.totalBytes || sourceDigest(files) !== snapshot.sha256) {
    fail("sourceSnapshot total binding is invalid");
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  if (
    byPath.get(profile.mutablePath).sha256 !==
      contract.protectedInputs.mutableBaselineSha256 ||
    byPath.get(contract.evaluator.path).sha256 !== contract.evaluator.contentSha256
  ) {
    fail("sourceSnapshot does not bind the trusted mutable/evaluator sources");
  }
  const authority = sealedSnapshotAuthority.get(snapshot);
  if (authority === undefined) {
    fail("sourceSnapshot was not sealed by this process");
  }
  if (authority.canonicalContractSha256 !== hash(canonicalJson(contract))) {
    fail("sourceSnapshot was sealed for a different task contract");
  }
  if (
    authority.contractSha256 !== contractSha256 ||
    authority.contractSha256 !== snapshot.contractSha256
  ) {
    fail("sourceSnapshot was sealed for a different raw contract digest");
  }
  return deepFreeze({
    algorithm: snapshot.algorithm,
    contractSha256: snapshot.contractSha256,
    totalBytes,
    sha256: snapshot.sha256,
    files,
  });
}

/**
 * Seals the fixed source allowlist while the reconstructed evaluator checkout
 * exists. The returned JSON value remains usable after that checkout is disposed.
 */
export async function createG12SourceSnapshot(input) {
  exactKeys(
    input,
    ["evaluator", "contract", "contractSha256"],
    "source snapshot input",
  );
  validateContract(input.contract, input.contractSha256);
  const { workspace } = await validateEvaluator(input.evaluator, input.contract);
  const snapshot = await sealedSourceSnapshot(
    input.evaluator,
    input.contract,
    input.contractSha256,
    workspace,
  );
  sealedSnapshotAuthority.set(
    snapshot,
    Object.freeze({
      canonicalContractSha256: hash(canonicalJson(input.contract)),
      contractSha256: input.contractSha256,
    }),
  );
  return snapshot;
}

/**
 * Builds the only JSON task shape admitted to a tool-free native task worker.
 * It consumes only an already sealed, self-verifying source snapshot.
 */
export async function createG12TaskContext(input) {
  plainObject(input, "task context input");
  validateWorkerRole(input.role);
  if (!TASK_ROLES.includes(input.role)) fail("worker role is not admitted");
  const requiredKeys = ["role", "sourceSnapshot", "contract", "contractSha256"];
  if (ROLE_PRIORS[input.role].length > 0) requiredKeys.push("priorOutputs");
  if (["review", "repair"].includes(input.role)) {
    requiredKeys.push("currentCandidate", "verifierReceipt");
  }
  exactKeys(input, requiredKeys, "task context input");

  validateContract(input.contract, input.contractSha256);
  const profile = taskProfile(input.contract);
  const sourceSnapshot = validateCachedSourceSnapshot(
    input.sourceSnapshot,
    input.contract,
    input.contractSha256,
  );
  const prior = normalizePriorOutputs(input.role, input.priorOutputs, input.contract);
  const currentCandidate = ["review", "repair"].includes(input.role)
    ? normalizeCurrentCandidate(input.currentCandidate, input.contract)
    : null;
  const verifier = ["review", "repair"].includes(input.role)
    ? normalizeVerifierReceipt(
        input.role,
        input.verifierReceipt,
        input.contract,
        currentCandidate,
      )
    : null;
  const bindings = contractProjection(input.contract, input.contractSha256);

  return deepFreeze({
    schemaVersion: 1,
    taskId: input.contract.id,
    role: input.role,
    objective: input.contract.objective,
    directive:
      profile.guidance === undefined
        ? ROLE_DIRECTIVES[input.role]
        : `${ROLE_DIRECTIVES[input.role]} ${profile.guidance}`,
    bindings: {
      ...bindings,
      sourceSnapshotSha256: sourceSnapshot.sha256,
      currentCandidateSha256:
        currentCandidate === null
          ? null
          : hash(canonicalJson(currentCandidate)),
    },
    sourceSnapshot,
    prior,
    currentCandidate,
    verifier,
    authority: {
      tools: false,
      network: false,
      filesystemWrites: false,
      externalAccess: false,
      publication: false,
      promotion: false,
      evaluatorChanges: false,
      governanceChanges: false,
    },
    response: {
      fields: ["summary", "patch", "findings", "verdict"],
      patch: ["implementation", "repair"].includes(input.role)
        ? "required-unified-diff-within-mutable-exact"
        : "must-be-null",
      verdicts: ["ACCEPT", "REJECT", "INCONCLUSIVE"],
    },
  });
}

export const createTaskSourceSnapshot = createG12SourceSnapshot;
export const createTaskContext = createG12TaskContext;
