import { reconstructEvaluator, disposeCandidate } from "../candidate/reconstruct.mjs";
import { materializeFrozenSubmodules } from "../candidate/submodules.mjs";
import { verifyRedBaseline } from "../candidate/verifier.mjs";
import { resolveTaskContract } from "../contract.mjs";
import { repositoryRoot } from "../paths.mjs";
import { currentControlIdentity } from "./control-identity.mjs";
import { createG12SourceSnapshot } from "./task-context.mjs";

function requireConfirmedRed(receipt) {
  if (
    receipt?.verdict !== "CONFIRMED_RED" ||
    receipt.initialRedMatched !== true ||
    receipt.referencesGreen !== true
  ) {
    throw new Error(
      `G1.2 evaluator prerequisite is not confirmed red: ${receipt?.verdict ?? "missing"}`,
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
export async function runG12Preflight({
  signal,
  repoRoot = repositoryRoot,
  resolveContract = resolveTaskContract,
  resolveControl = currentControlIdentity,
  reconstruct = reconstructEvaluator,
  materializeSubmodules = materializeFrozenSubmodules,
  createSourceSnapshot = createG12SourceSnapshot,
  verifyBaseline = verifyRedBaseline,
  dispose = disposeCandidate,
} = {}) {
  const resolved = resolveContract({ repoRoot });
  const { contract, contractPath, contractSha256, repository } = resolved;
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
    );
    return Object.freeze({
      schema: "oxigraph.g1.2-preflight/v1",
      contract,
      contractPath,
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
