import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalMutationInventory,
  validateMutantInventory,
} from "./native-evidence.mjs";
import {
  assertExactCurrentSnapshots,
  snapshotProtectedInputs,
} from "./source-snapshot.mjs";
import {
  cleanupMutationEnvironment,
  createMutationEnvironment,
} from "./runtime-policy.mjs";

export const INVENTORY_TIMEOUT_MS = 120_000;

export function listCurrentMutationInventory(
  repositoryRoot,
  {
    timeoutMs = INVENTORY_TIMEOUT_MS,
    execute = execFileSync,
  } = {},
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 300_000
  ) {
    throw new Error("mutation inventory timeout is outside its reviewed bound");
  }
  const root = realpathSync(repositoryRoot);
  const configPath = join(root, "tools", "mutation", "oxdatalog.toml");
  const before = snapshotProtectedInputs(root);
  const environment = createMutationEnvironment(root, randomUUID());
  let stdout;
  try {
    stdout = execute(
      "cargo",
      [
        "mutants",
        "--config",
        configPath,
        "--package",
        "oxdatalog",
        "--colors",
        "never",
        "--annotations",
        "none",
        "--list",
        "--json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: environment,
      },
    );
  } catch (error) {
    throw new Error(
      `independent cargo-mutants inventory failed: ${error?.message ?? error}`,
    );
  } finally {
    cleanupMutationEnvironment(root, environment);
  }
  const after = snapshotProtectedInputs(root);
  assertExactCurrentSnapshots(before, after, after);
  let inventory;
  try {
    inventory = JSON.parse(stdout);
  } catch {
    throw new Error("independent cargo-mutants inventory is not valid JSON");
  }
  validateMutantInventory(inventory);
  return { inventory, before, after };
}

export function assertCurrentInventoryMatches(archived, current) {
  if (
    JSON.stringify(canonicalMutationInventory(archived)) !==
    JSON.stringify(canonicalMutationInventory(current))
  ) {
    throw new Error(
      "immutable mutants.json does not match current source inventory",
    );
  }
}
