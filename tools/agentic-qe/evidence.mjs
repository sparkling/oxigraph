import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CHILD_ENVIRONMENT_POLICY } from "../child-environment.mjs";
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  createImplementationManifest,
  implementationManifestValid,
  validateImplementationManifest,
} from "./implementation-manifest.mjs";
import {
  canonicalInside,
  portablePath,
  repoRoot,
  toolDir,
} from "./path-policy.mjs";
import { archiveStructureMatches } from "./artifact-archive.mjs";
import { stableRegularFileBytes } from "./file-safety.mjs";
import {
  publicationStructureMatches,
  readAgenticPublication,
} from "./publication.mjs";

export {
  archiveOutputArtifacts,
  validateAgenticArtifactArchive,
} from "./artifact-archive.mjs";
export {
  implementationManifestsEqual,
  validateImplementationManifest,
} from "./implementation-manifest.mjs";
export { readAgenticFileBytes } from "./publication.mjs";

const ignoredNames = new Set([".git", "node_modules", "target"]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileRecord(path) {
  const canonical = canonicalInside(repoRoot, path);
  const { bytes } = stableRegularFileBytes(canonical, {
    repositoryRoot: repoRoot,
    label: "Agentic-QE implementation evidence",
  });
  return {
    path: portablePath(relative(repoRoot, canonical)),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function walk(path, records, visited) {
  const lexical = lstatSync(path);
  const canonical = canonicalInside(repoRoot, path, { allowRoot: true });
  const metadata = lexical.isSymbolicLink() ? statSync(canonical) : lexical;
  if (metadata.isFile()) {
    records.set(canonical, fileRecord(canonical));
    return;
  }
  if (!metadata.isDirectory()) return;
  if (visited.has(canonical)) return;
  visited.add(canonical);
  for (const entry of readdirSync(canonical, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    walk(join(canonical, entry.name), records, visited);
  }
}

function cargoPackages() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--locked", "--format-version", "1", "--no-deps"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  );
  const local = metadata.packages.filter((item) => item.source === null);
  const byDirectory = new Map(
    local.map((item) => [realpathSync(dirname(item.manifest_path)), item]),
  );
  return { local, byDirectory };
}

function packageDirectories(packageNames) {
  if (packageNames.length === 0) return [];
  const { local, byDirectory } = cargoPackages();
  const pending = packageNames.map((name) => {
    const matches = local.filter((item) => item.name === name);
    if (matches.length !== 1) {
      throw new Error(`expected one local Cargo package named ${name}`);
    }
    return matches[0];
  });
  const directories = new Set();
  while (pending.length > 0) {
    const item = pending.pop();
    const directory = realpathSync(dirname(item.manifest_path));
    if (directories.has(directory)) continue;
    directories.add(directory);
    for (const dependency of item.dependencies) {
      if (!dependency.path) continue;
      const dependencyDirectory = realpathSync(dependency.path);
      const localDependency = byDirectory.get(dependencyDirectory);
      if (!localDependency) {
        throw new Error(`local dependency is not workspace metadata: ${dependency.path}`);
      }
      pending.push(localDependency);
    }
  }
  return [...directories];
}

function snapshot(paths) {
  const records = new Map();
  const visited = new Set();
  for (const path of paths) walk(path, records, visited);
  return createImplementationManifest([...records.values()]);
}

function selectedEvidence(selected, commands) {
  const packageNames = new Set();
  const paths = new Set([
    join(repoRoot, "Cargo.toml"),
    join(repoRoot, "Cargo.lock"),
    join(repoRoot, "tools", "child-environment.mjs"),
    join(repoRoot, "tools", "dependency-policy.mjs"),
    toolDir,
  ]);
  for (const relativePath of [".cargo", "rust-toolchain", "rust-toolchain.toml"]) {
    const path = join(repoRoot, relativePath);
    if (existsSync(path)) paths.add(path);
  }
  for (const id of selected) {
    const policy = commands[id][2] ?? {};
    for (const name of policy.evidencePackages ?? []) packageNames.add(name);
    for (const path of policy.evidencePaths ?? []) {
      paths.add(canonicalInside(repoRoot, join(repoRoot, path)));
    }
  }
  for (const path of packageDirectories([...packageNames])) paths.add(path);
  return [...paths];
}

export function implementationSnapshot(selected, commands) {
  return snapshot(selectedEvidence(selected, commands));
}

export function changedInputs(before, after) {
  validateImplementationManifest(before);
  validateImplementationManifest(after);
  const beforeFiles = new Map(
    before.files.map((item) => [item.path, JSON.stringify(item)]),
  );
  const afterFiles = new Map(
    after.files.map((item) => [item.path, JSON.stringify(item)]),
  );
  return [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])]
    .filter((path) => beforeFiles.get(path) !== afterFiles.get(path))
    .sort();
}

export function outputArtifacts(selected, commands) {
  const paths = new Set();
  for (const id of selected) {
    const policy = commands[id][2] ?? {};
    for (const path of policy.outputPaths ?? []) paths.add(join(repoRoot, path));
  }
  if (paths.size === 0) {
    return {
      algorithm: "sha256",
      complete: true,
      missingPaths: [],
      invalidPaths: [],
      files: [],
      contentHash: sha256("[]"),
    };
  }
  const missingPaths = [...paths]
    .filter((path) => !existsSync(path))
    .map((path) => portablePath(relative(repoRoot, path)))
    .sort();
  const invalidPaths = [...paths]
    .filter((path) => {
      if (!existsSync(path)) return false;
      const metadata = lstatSync(path);
      return metadata.isSymbolicLink() || !metadata.isFile();
    })
    .map((path) => portablePath(relative(repoRoot, path)))
    .sort();
  const result = snapshot(
    [...paths].filter(
      (path) =>
        existsSync(path) &&
        !lstatSync(path).isSymbolicLink() &&
        lstatSync(path).isFile(),
    ),
  );
  return {
    ...result,
    complete: missingPaths.length === 0 && invalidPaths.length === 0,
    missingPaths,
    invalidPaths,
  };
}

export function stableCommandResult(result) {
  const {
    id,
    program,
    args,
    code,
    signal,
    spawnError,
    timedOut,
    timeoutMs,
    testSafeguard,
    testInventory,
  } = result;
  return {
    id,
    program,
    args,
    code,
    signal,
    spawnFailed: spawnError !== null,
    timedOut,
    timeoutMs,
    testSafeguard: testSafeguard ?? null,
    testInventory:
      testInventory === null || testInventory === undefined
        ? null
        : {
            observedTests: testInventory.observedTests,
            ids: testInventory.ids,
          },
  };
}

export function outputBinding(result) {
  return {
    id: result.id,
    ...result.output,
    testInventoryOutput: result.testInventory?.output ?? null,
  };
}

export function agenticReceiptContentHash(receipt) {
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      adapter: receipt.adapter,
      agenticQeVersion: receipt.agenticQeVersion,
      profile: receipt.profile,
      repository: {
        gitHead: receipt.repository?.gitHead,
        worktreeDirty: receipt.repository?.worktreeDirty,
        rdfTestsCommit: receipt.repository?.rdfTestsCommit,
        rdfCanonTestsCommit: receipt.repository?.rdfCanonTestsCommit,
      },
      implementation: receipt.implementation,
      authority: receipt.authority,
      commands: receipt.commands?.map(stableCommandResult),
      passed: receipt.passed,
    }),
  );
}

export function agenticReceiptExecutionHash(receipt) {
  return sha256(
    JSON.stringify({
      runId: receipt.runId,
      contentHash: receipt.contentHash,
      publication: receipt.publication,
      outputs: receipt.commands?.map(outputBinding),
      artifacts: receipt.artifacts,
      runtime: receipt.runtime,
    }),
  );
}

export function agenticReceiptBytes(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
}

export function validateAgenticPublication(
  receipt,
  options = {},
) {
  const publication = readAgenticPublication(receipt, options);
  const { receiptBytes, oracleBytes } = publication;
  const authoritativeReceipt = JSON.parse(receiptBytes);
  if (
    !receiptBytes.equals(agenticReceiptBytes(authoritativeReceipt)) ||
    !receiptBytes.equals(agenticReceiptBytes(receipt))
  ) {
    throw new Error("Agentic-QE immutable receipt bytes differ from the receipt");
  }
  const oracle = JSON.parse(oracleBytes);
  validateAgenticOracle(oracle, authoritativeReceipt, receiptBytes);
  return { ...publication, receipt: authoritativeReceipt, oracle };
}

export function validateAgenticOracle(oracle, receipt, receiptBytes) {
  const bytes = receiptBytes ?? agenticReceiptBytes(receipt);
  if (
    !oracle ||
    typeof oracle !== "object" ||
    oracle.schemaVersion !== 1 ||
    oracle.profile !== receipt?.profile ||
    oracle.runId !== receipt?.runId ||
    oracle.passed !== true ||
    oracle.baselinePassed !== true ||
    oracle.contentHash !== receipt?.contentHash ||
    oracle.executionHash !== receipt?.executionHash ||
    oracle.receiptSha256 !== sha256(bytes)
  ) {
    throw new Error("Agentic-QE oracle does not bind the exact receipt");
  }
  return oracle;
}

function trustedCommandContractsValid(receipt, expectedCommands) {
  if (
    !expectedCommands ||
    typeof expectedCommands !== "object" ||
    Array.isArray(expectedCommands)
  ) {
    return false;
  }
  return receipt.commands.every((command) => {
    const definition = expectedCommands[command.id];
    if (!Array.isArray(definition) || definition.length < 2) return false;
    const [program, args, policy = {}] = definition;
    if (
      command.program !== program ||
      JSON.stringify(command.args) !== JSON.stringify(args) ||
      command.timeoutMs !== policy.timeoutMs
    ) {
      return false;
    }
    if (program === "cargo") {
      const safeguard = command.testSafeguard;
      const inventory = command.testInventory;
      const ids = inventory?.ids;
      const expectedIds = policy.expectedTestIds
        ? [...policy.expectedTestIds].sort()
        : null;
      const requiredIds = policy.requiredTestIds ?? null;
      const requiredIdsValid =
        requiredIds === null ||
        (expectedIds === null &&
          Array.isArray(requiredIds) &&
          requiredIds.length > 0 &&
          requiredIds.length <= policy.expectedPassedTests &&
          requiredIds.every(
            (testId) => typeof testId === "string" && testId.length > 0,
          ) &&
          new Set(requiredIds).size === requiredIds.length &&
          requiredIds.every((testId) => ids.includes(testId)));
      return (
        safeguard?.minimumPassedTests === policy.minimumPassedTests &&
        safeguard?.expectedPassedTests === policy.expectedPassedTests &&
        safeguard?.observedPassedTests === policy.expectedPassedTests &&
        safeguard?.passed === true &&
        inventory?.observedTests === policy.expectedPassedTests &&
        Array.isArray(ids) &&
        ids.length === policy.expectedPassedTests &&
        new Set(ids).size === ids.length &&
        JSON.stringify(ids) === JSON.stringify([...ids].sort()) &&
        (expectedIds === null ||
          JSON.stringify(ids) === JSON.stringify(expectedIds)) &&
        requiredIdsValid
      );
    }
    if (policy.expectedNodeTests !== undefined) {
      const safeguard = command.testSafeguard;
      const observed = safeguard?.observed;
      const expectedSuites = policy.expectedNodeSuites ?? 0;
      return (
        command.testInventory === null &&
        safeguard?.format === "node-tap-v13" &&
        safeguard.minimumPassedTests === policy.expectedNodeTests &&
        safeguard.expectedPassedTests === policy.expectedNodeTests &&
        safeguard.observedPassedTests === policy.expectedNodeTests &&
        safeguard.expectedSuites === expectedSuites &&
        safeguard.passed === true &&
        observed?.duplicateOrMissing === false &&
        observed?.terminal === true &&
        observed?.summaryBlockCount === 1 &&
        observed?.conserved === true &&
        observed?.plan === policy.expectedNodeTests &&
        observed?.tests === policy.expectedNodeTests &&
        observed?.pass === policy.expectedNodeTests &&
        observed?.suites === expectedSuites &&
        observed?.fail === 0 &&
        observed?.cancelled === 0 &&
        observed?.skipped === 0 &&
        observed?.todo === 0
      );
    }
    return command.testInventory === null && command.testSafeguard === undefined;
  });
}

export function validateAgenticReceipt(
  receipt,
  {
    expectedProfile,
    expectedAgenticQeVersion,
    expectedAgenticQeDependency,
    expectedCommandIds,
    expectedCommands,
    minimumGeneratedAtMs = 0,
    maximumGeneratedAtMs = Number.POSITIVE_INFINITY,
  },
) {
  const generatedAtMs = Date.parse(receipt?.generatedAt);
  const observedCommandIds = Array.isArray(receipt?.commands)
    ? receipt.commands.map((command) => command?.id)
    : [];
  const commandInventoryMatches =
    expectedCommandIds === undefined ||
    (Array.isArray(expectedCommandIds) &&
      expectedCommandIds.length > 0 &&
      JSON.stringify(observedCommandIds) ===
        JSON.stringify(expectedCommandIds));
  const trustedContractsValid =
    Array.isArray(receipt?.commands) &&
    trustedCommandContractsValid(receipt, expectedCommands);
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.schemaVersion !== 4 ||
    receipt.adapter !== "oxigraph-agentic-qe" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      receipt.runId ?? "",
    ) ||
    receipt.profile !== expectedProfile ||
    receipt.agenticQeVersion !== expectedAgenticQeVersion ||
    receipt.authority?.childEnvironmentPolicy !== CHILD_ENVIRONMENT_POLICY ||
    (expectedAgenticQeDependency !== undefined &&
      JSON.stringify(receipt.authority?.agenticQeDependency) !==
        JSON.stringify(expectedAgenticQeDependency)) ||
    receipt.passed !== true ||
    !Number.isFinite(minimumGeneratedAtMs) ||
    !(
      Number.isFinite(maximumGeneratedAtMs) ||
      maximumGeneratedAtMs === Number.POSITIVE_INFINITY
    ) ||
    maximumGeneratedAtMs < minimumGeneratedAtMs ||
    !Number.isFinite(generatedAtMs) ||
    new Date(generatedAtMs).toISOString() !== receipt.generatedAt ||
    generatedAtMs < minimumGeneratedAtMs ||
    generatedAtMs > maximumGeneratedAtMs ||
    receipt.implementation?.stable !== true ||
    !implementationManifestValid(receipt.implementation) ||
    receipt.implementation?.contentHash !==
      receipt.implementation?.afterContentHash ||
    !Array.isArray(receipt.implementation?.changedPaths) ||
    receipt.implementation.changedPaths.length !== 0 ||
    receipt.artifacts?.complete !== true ||
    !Array.isArray(receipt.artifacts?.missingPaths) ||
    receipt.artifacts.missingPaths.length !== 0 ||
    !Array.isArray(receipt.artifacts?.invalidPaths) ||
    receipt.artifacts.invalidPaths.length !== 0 ||
    !publicationStructureMatches(receipt) ||
    !archiveStructureMatches(receipt) ||
    !Array.isArray(receipt.commands) ||
    receipt.commands.length === 0 ||
    !commandInventoryMatches ||
    !trustedContractsValid ||
    receipt.commands.some(
      (command) =>
        command?.code !== 0 ||
        command?.spawnError !== null ||
        command?.timedOut !== false ||
        command?.testSafeguard?.passed === false,
    ) ||
    !Array.isArray(receipt.runtime) ||
    receipt.runtime.length === 0 ||
    receipt.runtime.some(
      (record) =>
        typeof record?.program !== "string" ||
        typeof record?.context !== "string" ||
        !/^[0-9a-f]{64}$/.test(record?.executableSha256 ?? ""),
    ) ||
    receipt.contentHash !== agenticReceiptContentHash(receipt) ||
    receipt.executionHash !== agenticReceiptExecutionHash(receipt)
  ) {
    throw new Error("Agentic-QE receipt failed its execution or hash contract");
  }
  return receipt;
}
