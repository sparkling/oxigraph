import { realpathSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertDirectoryIdentity,
  createExclusiveDirectoryInside,
  directoryIdentity,
  ensureDirectoryInside,
  isInside,
  portable,
  readStableFileBytes,
  syncDirectory,
  writeExclusiveDurableFile,
} from "./path-policy.mjs";
import { sha256 } from "./source-snapshot.mjs";

export const MUTATION_RECEIPT_SCHEMA_VERSION = 3;
export const MUTATION_PUBLICATION_SCHEMA_VERSION = 1;
const PROFILE = "oxdatalog-d2-complete";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function repositoryRelativePath(repositoryRoot, path) {
  const lexical = resolve(repositoryRoot, path);
  const name = portable(relative(repositoryRoot, lexical));
  if (
    !isInside(repositoryRoot, lexical) ||
    isAbsolute(path) ||
    name !== path ||
    relative(repositoryRoot, lexical).startsWith(`..${sep}`)
  ) {
    throw new Error(`mutation publication path is invalid: ${path}`);
  }
  return lexical;
}

export function isUuidV4(value) {
  return typeof value === "string" && UUID_V4.test(value);
}

function publicationRoot(runId) {
  if (!isUuidV4(runId)) {
    throw new Error("mutation publication runId is not a UUIDv4");
  }
  return `target/mutation/oxdatalog/runs/${runId}`;
}

function evidenceFiles(root, outcomeBytes, inventoryBytes, configBytes) {
  return [
    {
      role: "native-outcomes",
      path: `${root}/outcomes.json`,
      sha256: sha256(outcomeBytes),
      bytes: outcomeBytes.length,
    },
    {
      role: "native-mutants",
      path: `${root}/mutants.json`,
      sha256: sha256(inventoryBytes),
      bytes: inventoryBytes.length,
    },
    {
      role: "mutation-config",
      path: `${root}/oxdatalog.toml`,
      sha256: sha256(configBytes),
      bytes: configBytes.length,
    },
  ];
}

export function createMutationPublication(
  runId,
  { outcomeBytes, inventoryBytes, configBytes },
) {
  if (
    !Buffer.isBuffer(outcomeBytes) ||
    !Buffer.isBuffer(inventoryBytes) ||
    !Buffer.isBuffer(configBytes)
  ) {
    throw new Error("mutation publication evidence must be byte buffers");
  }
  const root = publicationRoot(runId);
  const files = evidenceFiles(root, outcomeBytes, inventoryBytes, configBytes);
  return {
    schemaVersion: MUTATION_PUBLICATION_SCHEMA_VERSION,
    immutable: true,
    root,
    receiptPath: `${root}/receipt.json`,
    files,
    contentHash: sha256(JSON.stringify(files)),
  };
}

function exactPublicationFiles(receipt) {
  const root = publicationRoot(receipt.runId);
  const files = receipt?.publication?.files;
  if (!Array.isArray(files) || files.length !== 3) return false;
  const expectedPaths = [
    ["native-outcomes", `${root}/outcomes.json`],
    ["native-mutants", `${root}/mutants.json`],
    ["mutation-config", `${root}/oxdatalog.toml`],
  ];
  return files.every(
    (file, index) =>
      file !== null &&
      typeof file === "object" &&
      !Array.isArray(file) &&
      JSON.stringify(Object.keys(file)) ===
        JSON.stringify(["role", "path", "sha256", "bytes"]) &&
      file.role === expectedPaths[index][0] &&
      file.path === expectedPaths[index][1] &&
      /^[0-9a-f]{64}$/.test(file.sha256 ?? "") &&
      Number.isSafeInteger(file.bytes) &&
      file.bytes > 0,
  );
}

export function mutationPublicationStructureMatches(receipt) {
  try {
    const root = publicationRoot(receipt?.runId);
    const publication = receipt?.publication;
    if (
      receipt?.profile !== PROFILE ||
      publication?.schemaVersion !== MUTATION_PUBLICATION_SCHEMA_VERSION ||
      publication?.immutable !== true ||
      publication?.root !== root ||
      publication?.receiptPath !== `${root}/receipt.json` ||
      !exactPublicationFiles(receipt) ||
      publication.contentHash !== sha256(JSON.stringify(publication.files))
    ) {
      return false;
    }
    const [outcomes, inventory, config] = publication.files;
    return (
      outcomes.sha256 === receipt.evidence?.nativeOutcomesSha256 &&
      inventory.sha256 === receipt.evidence?.nativeInventorySha256 &&
      config.sha256 === receipt.evidence?.configSha256
    );
  } catch {
    return false;
  }
}

export function readMutationFileBytes(relativePath, { repositoryRoot }) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const lexical = repositoryRelativePath(canonicalRoot, relativePath);
  return readStableFileBytes(canonicalRoot, lexical);
}

function safePublicationRoot(repositoryRoot, publication) {
  const lexical = repositoryRelativePath(repositoryRoot, publication.root);
  const identity = directoryIdentity(lexical);
  const expectedEntries = [
    "mutants.json",
    "outcomes.json",
    "oxdatalog.toml",
    "receipt.json",
  ];
  const entries = readdirSync(lexical).sort();
  assertDirectoryIdentity(identity);
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error("mutation immutable publication contains unexpected files");
  }
  return identity;
}

function assertExactPublicationEntries(identity) {
  const expectedEntries = [
    "mutants.json",
    "outcomes.json",
    "oxdatalog.toml",
    "receipt.json",
  ];
  const entries = readdirSync(identity.path).sort();
  assertDirectoryIdentity(identity);
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error("mutation immutable publication contains unexpected files");
  }
}

export function readMutationPublication(receipt, { repositoryRoot }) {
  if (!mutationPublicationStructureMatches(receipt)) {
    throw new Error("mutation immutable publication contract is invalid");
  }
  const canonicalRoot = realpathSync(repositoryRoot);
  const runIdentity = safePublicationRoot(canonicalRoot, receipt.publication);
  const [outcomes, inventory, config] = receipt.publication.files;
  const receiptBytes = readStableFileBytes(
    canonicalRoot,
    repositoryRelativePath(canonicalRoot, receipt.publication.receiptPath),
    { expectedParentIdentity: runIdentity },
  );
  const outcomeBytes = readStableFileBytes(
    canonicalRoot,
    repositoryRelativePath(canonicalRoot, outcomes.path),
    { expectedParentIdentity: runIdentity },
  );
  const inventoryBytes = readStableFileBytes(
    canonicalRoot,
    repositoryRelativePath(canonicalRoot, inventory.path),
    { expectedParentIdentity: runIdentity },
  );
  const configBytes = readStableFileBytes(
    canonicalRoot,
    repositoryRelativePath(canonicalRoot, config.path),
    { expectedParentIdentity: runIdentity },
  );
  assertDirectoryIdentity(runIdentity);
  assertExactPublicationEntries(runIdentity);
  for (const [entry, bytes] of [
    [outcomes, outcomeBytes],
    [inventory, inventoryBytes],
    [config, configBytes],
  ]) {
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`mutation immutable publication bytes changed: ${entry.path}`);
    }
  }
  return {
    publication: receipt.publication,
    receiptBytes,
    outcomeBytes,
    inventoryBytes,
    configBytes,
  };
}

export function publishMutationPublication(
  receipt,
  {
    repositoryRoot,
    receiptBytes,
    outcomeBytes,
    inventoryBytes,
    configBytes,
  },
) {
  const expected = createMutationPublication(receipt?.runId, {
    outcomeBytes,
    inventoryBytes,
    configBytes,
  });
  const expectedReceiptBytes = Buffer.from(
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  if (
    !Buffer.isBuffer(receiptBytes) ||
    !receiptBytes.equals(expectedReceiptBytes) ||
    JSON.stringify(receipt?.publication) !== JSON.stringify(expected) ||
    !mutationPublicationStructureMatches(receipt)
  ) {
    throw new Error("refusing to publish an invalid mutation publication");
  }
  const canonicalRoot = realpathSync(repositoryRoot);
  const runs = ensureDirectoryInside(
    canonicalRoot,
    join(canonicalRoot, "target", "mutation", "oxdatalog", "runs"),
  );
  const runsIdentity = directoryIdentity(runs);
  let runRoot;
  try {
    runRoot = createExclusiveDirectoryInside(
      canonicalRoot,
      join(runs, receipt.runId),
    );
  } catch (error) {
    if (/refusing to reuse exclusive directory/.test(error?.message ?? "")) {
      throw new Error(`refusing to replace immutable mutation run: ${receipt.runId}`);
    }
    throw error;
  }
  assertDirectoryIdentity(runsIdentity);
  const runIdentity = directoryIdentity(runRoot);
  for (const [name, bytes] of [
    ["outcomes.json", outcomeBytes],
    ["mutants.json", inventoryBytes],
    ["oxdatalog.toml", configBytes],
    ["receipt.json", receiptBytes],
  ]) {
    assertDirectoryIdentity(runIdentity);
    writeExclusiveDurableFile(join(runRoot, name), bytes, canonicalRoot);
    assertDirectoryIdentity(runIdentity);
  }
  syncDirectory(runRoot);
  const observed = readMutationPublication(receipt, {
    repositoryRoot: canonicalRoot,
  });
  if (!observed.receiptBytes.equals(receiptBytes)) {
    throw new Error("immutable mutation receipt bytes differ after publication");
  }
  return observed;
}

export { syncDirectory };
