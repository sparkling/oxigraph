import { reconstructEvaluator, disposeCandidate } from "../candidate/reconstruct.mjs";
import { materializeFrozenSubmodules } from "../candidate/submodules.mjs";
import { verifyRedBaseline } from "../candidate/verifier.mjs";
import {
  g12ContractPath,
  g13ContractPath,
  g14ContractPath,
  g15ContractPath,
  g15bContractPath,
  g15cContractPath,
  resolveTaskContract,
} from "../contract.mjs";
import { repositoryRoot } from "../paths.mjs";
import { taskProfile } from "../task-profile.mjs";
import { currentControlIdentity } from "./control-identity.mjs";
import { createTaskSourceSnapshot } from "./task-context.mjs";

const redVerdicts = new Set(["CONFIRMED_RED", "INCONCLUSIVE", "INVALID_BASELINE"]);
const commandNames = new Set(["format", "build", "public", "independent", "regression"]);
const commandDispositions = new Set(["completed", "timed-out", "output-limit"]);
const sha256Pattern = /^[0-9a-f]{64}$/u;

function boundedRedDiagnostic(receipt) {
  const commands = Array.isArray(receipt?.commands)
    ? receipt.commands.slice(0, commandNames.size).map((command) => ({
        name: commandNames.has(command?.name) ? command.name : "unknown",
        disposition: commandDispositions.has(command?.disposition)
          ? command.disposition
          : "unknown",
        exitCode: Number.isInteger(command?.exitCode) ? command.exitCode : null,
        signal:
          typeof command?.signal === "string" && /^[A-Z0-9]{1,16}$/u.test(command.signal)
            ? command.signal
            : null,
        durationMs:
          Number.isSafeInteger(command?.durationMs) && command.durationMs >= 0
            ? command.durationMs
            : null,
        stdoutSha256: sha256Pattern.test(command?.stdoutSha256)
          ? command.stdoutSha256
          : null,
        stderrSha256: sha256Pattern.test(command?.stderrSha256)
          ? command.stderrSha256
          : null,
      }))
    : [];
  return {
    verdict: redVerdicts.has(receipt?.verdict) ? receipt.verdict : "missing",
    initialRedMatched: receipt?.initialRedMatched === true,
    referencesGreen: receipt?.referencesGreen === true,
    commands,
  };
}

function requireConfirmedRed(receipt, label) {
  if (
    receipt?.verdict !== "CONFIRMED_RED" ||
    receipt.initialRedMatched !== true ||
    receipt.referencesGreen !== true
  ) {
    throw new Error(
      `${label} evaluator prerequisite is not confirmed red: ${JSON.stringify(boundedRedDiagnostic(receipt))}`,
    );
  }
  return receipt;
}

/**
 * Resolves the committed G1.2 control plane, reconstructs its evaluator in an
 * isolated checkout, proves the frozen red/green split, and returns only the
 * process-sealed source snapshot needed by native workers. The evaluator
 * checkout is always destroyed before this function returns.
 */
export async function runTaskPreflight({
  signal,
  repoRoot = repositoryRoot,
  contractPath: requestedContractPath = g12ContractPath,
  resolveContract = resolveTaskContract,
  resolveControl = currentControlIdentity,
  reconstruct = reconstructEvaluator,
  materializeSubmodules = materializeFrozenSubmodules,
  createSourceSnapshot = createTaskSourceSnapshot,
  verifyBaseline = verifyRedBaseline,
  dispose = disposeCandidate,
} = {}) {
  const resolved = resolveContract({ repoRoot, contractPath: requestedContractPath });
  const {
    contract,
    contractPath: resolvedContractPath,
    contractSha256,
    repository,
  } = resolved;
  const profile = taskProfile(contract);
  const control = await resolveControl({ contract, repoRoot });
  let evaluator;
  try {
    evaluator = await reconstruct({ repositoryRoot: repoRoot, contract });
    const submodules = await materializeSubmodules({
      controllerRoot: repoRoot,
      candidate: evaluator,
      contract,
    });
    const sourceSnapshot = await createSourceSnapshot({
      evaluator,
      contract,
      contractSha256,
    });
    const redBaseline = requireConfirmedRed(
      await verifyBaseline({ candidate: evaluator, contract, signal }),
      profile.label,
    );
    return Object.freeze({
      schema: `oxigraph.${profile.slug}-preflight/v1`,
      contract,
      contractPath: resolvedContractPath,
      contractSha256,
      repository,
      control,
      sourceSnapshot,
      submodules,
      redBaseline,
    });
  } finally {
    if (evaluator !== undefined) await dispose(evaluator);
  }
}

export function runG12Preflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g12ContractPath });
}

export function runG13Preflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g13ContractPath });
}

export function runG14Preflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g14ContractPath });
}

export function runG15Preflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g15ContractPath });
}

export function runG15bPreflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g15bContractPath });
}

export function runG15cPreflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g15cContractPath });
}
