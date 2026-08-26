import { reconstructEvaluator, disposeCandidate } from "../candidate/reconstruct.mjs";
import { normalizeCommandFailureDiagnostic } from "../candidate/failure-diagnostic.mjs";
import { materializeFrozenSubmodules } from "../candidate/submodules.mjs";
import { verifyRedBaseline } from "../candidate/verifier.mjs";
import { resolveTaskContract } from "../contract.mjs";
import { repositoryRoot } from "../paths.mjs";
import {
  g12Profile,
  g13Profile,
  g14Profile,
  g15Profile,
  g15bProfile,
  g15cProfile,
  g16Profile,
  taskProfile,
} from "../task-profile.mjs";
import { currentControlIdentity } from "./control-identity.mjs";
import { createTaskSourceSnapshot } from "./task-context.mjs";

const redVerdicts = new Set(["CONFIRMED_RED", "INCONCLUSIVE", "INVALID_BASELINE"]);
const commandNames = new Set([
  "format",
  "build",
  "public",
  "service",
  "compatibility",
  "independent",
  "regression",
]);
const commandDispositions = new Set(["completed", "timed-out", "output-limit"]);
const sha256Pattern = /^[0-9a-f]{64}$/u;

function commandOutput(command) {
  return `${command?.stdoutTail ?? ""}\n${command?.stderrTail ?? ""}`;
}

function legacyFailureDiagnostic(command) {
  const output = commandOutput(command);
  if (command?.disposition === "completed" && command.exitCode === 0) {
    return normalizeCommandFailureDiagnostic({
      primaryClass: null,
      rustcCodes: [],
      childRole: "unknown",
      childTermination: null,
      childExitCode: null,
      childSignalNumber: null,
      childSignalName: null,
      ioArea: "unknown",
      ioErrno: null,
    });
  }
  const rustcCodes = [
    ...new Set([...output.matchAll(/error\[(E\d{4})\]/gu)].map((match) => match[1])),
  ]
    .sort()
    .slice(0, 8);
  let primaryClass = null;
  let ioErrno = null;
  if (command?.disposition === "timed-out") {
    primaryClass = "timeout";
  } else if (command?.disposition === "output-limit") {
    primaryClass = "output-limit";
  } else if (/Cannot allocate memory|out of memory|\bENOMEM\b/iu.test(output)) {
    primaryClass = "memory-exhausted";
    ioErrno = "ENOMEM";
  } else if (/No space left on device|\bENOSPC\b/iu.test(output)) {
    primaryClass = "state-exhausted";
    ioErrno = "ENOSPC";
  } else if (/rustc-LLVM ERROR|internal compiler error/iu.test(output)) {
    primaryClass = "toolchain-error";
  } else if (/linking with .{0,80} failed|linker .{0,80} failed|collect2: error/iu.test(output)) {
    primaryClass = "linker-error";
  } else if (/failed to run custom build command|CMake Error/iu.test(output)) {
    primaryClass = "native-build-error";
  } else if (
    /attempting to make an HTTP request|failed to download|no matching package named.{0,120}offline/iu.test(
      output,
    )
  ) {
    primaryClass = "offline-dependency";
  } else if (/Read-only file system|\bEROFS\b/iu.test(output)) {
    primaryClass = "sandbox-filesystem";
    ioErrno = "EROFS";
  } else if (/Permission denied|\bEACCES\b/iu.test(output)) {
    primaryClass = "sandbox-filesystem";
    ioErrno = "EACCES";
  } else if (
    /couldn't create a temp dir:[^\n]{0,160}No such file or directory|\bENOENT\b/iu.test(
      output,
    )
  ) {
    primaryClass = "sandbox-filesystem";
    ioErrno = "ENOENT";
  } else if (rustcCodes.length > 0) {
    primaryClass = "rust-compiler-diagnostic";
  } else if (Number.isInteger(command?.exitCode) && command.exitCode !== 0) {
    primaryClass = "cargo-build-failed-unclassified";
  }
  return normalizeCommandFailureDiagnostic({
    primaryClass,
    rustcCodes,
    childRole: "unknown",
    childTermination: null,
    childExitCode: null,
    childSignalNumber: null,
    childSignalName: null,
    ioArea: "unknown",
    ioErrno,
  });
}

function commandFailureDiagnostic(command) {
  return command?.diagnostic === undefined || command.diagnostic === null
    ? legacyFailureDiagnostic(command)
    : normalizeCommandFailureDiagnostic(command.diagnostic);
}

function boundedRedDiagnostic(receipt) {
  const commands = Array.isArray(receipt?.commands)
    ? receipt.commands.slice(0, commandNames.size).map((command) => {
        const diagnostic = commandFailureDiagnostic(command);
        return {
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
          failureClass: diagnostic.primaryClass,
          ...(diagnostic.rustcCodes.length > 0
            ? { rustcCodes: diagnostic.rustcCodes }
            : {}),
          ...(diagnostic.childTermination === null
            ? {}
            : {
                childRole: diagnostic.childRole,
                childTermination: diagnostic.childTermination,
                childExitCode: diagnostic.childExitCode,
                childSignalNumber: diagnostic.childSignalNumber,
                childSignalName: diagnostic.childSignalName,
              }),
          ...(diagnostic.ioErrno === null
            ? {}
            : { ioArea: diagnostic.ioArea, ioErrno: diagnostic.ioErrno }),
          stdoutSha256: sha256Pattern.test(command?.stdoutSha256)
            ? command.stdoutSha256
            : null,
          stderrSha256: sha256Pattern.test(command?.stderrSha256)
            ? command.stderrSha256
            : null,
        };
      })
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
export async function runTaskPreflight(options = {}) {
  if (Object.hasOwn(options, "contractPath")) {
    throw new Error(
      "engineering preflight contractPath selection is forbidden; select taskId",
    );
  }
  const {
    taskId = g12Profile.id,
    signal,
    repoRoot = repositoryRoot,
    resolveContract = resolveTaskContract,
    resolveControl = currentControlIdentity,
    reconstruct = reconstructEvaluator,
    materializeSubmodules = materializeFrozenSubmodules,
    createSourceSnapshot = createTaskSourceSnapshot,
    verifyBaseline = verifyRedBaseline,
    dispose = disposeCandidate,
  } = options;
  const selectedProfile = taskProfile(taskId);
  const resolved = resolveContract({ repoRoot, taskId: selectedProfile.id });
  const {
    contract,
    contractPath: resolvedContractPath,
    contractSha256,
    repository,
  } = resolved;
  const profile = taskProfile(contract);
  if (profile !== selectedProfile) {
    throw new Error("resolved contract does not match the selected engineering task");
  }
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
  return runTaskPreflight({ ...options, taskId: g12Profile.id });
}

export function runG13Preflight(options = {}) {
  return runTaskPreflight({ ...options, taskId: g13Profile.id });
}

export function runG14Preflight(options = {}) {
  return runTaskPreflight({ ...options, taskId: g14Profile.id });
}

export function runG15Preflight(options = {}) {
  return runTaskPreflight({ ...options, taskId: g15Profile.id });
}

export function runG15bPreflight(options = {}) {
  return runTaskPreflight({ ...options, taskId: g15bProfile.id });
}

export function runG15cPreflight(options = {}) {
  return runTaskPreflight({ ...options, taskId: g15cProfile.id });
}

export function runG16Preflight(options = {}) {
  return runTaskPreflight({ ...options, taskId: g16Profile.id });
}
