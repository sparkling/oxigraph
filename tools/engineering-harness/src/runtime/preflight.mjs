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
  g16ContractPath,
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
const compilerSignals = new Set([
  "SIGABRT",
  "SIGBUS",
  "SIGILL",
  "SIGKILL",
  "SIGSEGV",
  "SIGSYS",
  "SIGTERM",
  "SIGXCPU",
  "SIGXFSZ",
]);

function commandOutput(command) {
  return `${command?.stdoutTail ?? ""}\n${command?.stderrTail ?? ""}`;
}

function redactedCompilerEvidence(command) {
  const output = commandOutput(command);
  const rustcCodes = [
    ...new Set([...output.matchAll(/error\[(E\d{4})\]/gu)].map((match) => match[1])),
  ]
    .sort()
    .slice(0, 8);
  const signalMatch = output.match(/\(signal:\s*\d+,\s*(SIG[A-Z]+)(?::[^)]*)?\)/u);
  const compilerSignal =
    /\brustc\b|\bcc1plus\b|\bclang(?:\+\+)?\b/iu.test(output) &&
    compilerSignals.has(signalMatch?.[1])
      ? signalMatch[1]
      : null;
  return Object.freeze({ rustcCodes: Object.freeze(rustcCodes), compilerSignal });
}

function redactedFailureClass(command) {
  if (command?.disposition === "timed-out") return "timeout";
  if (command?.disposition === "output-limit") return "output-limit";
  const output = commandOutput(command);
  if (/No space left on device|\bENOSPC\b/iu.test(output)) {
    return "state-exhausted";
  }
  if (/Cannot allocate memory|out of memory|\bENOMEM\b/iu.test(output)) {
    return "memory-exhausted";
  }
  if (/rustc-LLVM ERROR|internal compiler error/iu.test(output)) {
    return "toolchain-error";
  }
  if (/linking with .{0,80} failed|linker .{0,80} failed|collect2: error/iu.test(output)) {
    return "linker-error";
  }
  if (/failed to run custom build command|CMake Error/iu.test(output)) {
    return "native-build-error";
  }
  if (
    /attempting to make an HTTP request|failed to download|no matching package named.{0,120}offline/iu.test(
      output,
    )
  ) {
    return "offline-dependency";
  }
  if (
    /Read-only file system|\bEROFS\b|Permission denied|\bEACCES\b|couldn't create a temp dir:[^\n]{0,160}No such file or directory/iu.test(
      output,
    )
  ) {
    return "sandbox-filesystem";
  }
  const { compilerSignal } = redactedCompilerEvidence(command);
  if (compilerSignal === "SIGKILL") {
    return "compiler-process-killed";
  }
  if (compilerSignal !== null) {
    return "compiler-process-terminated";
  }
  if (/error\[E\d{4}\]|could not compile/iu.test(output)) {
    return "compiler-error";
  }
  return Number.isInteger(command?.exitCode) && command.exitCode !== 0
    ? "command-failed"
    : null;
}

function boundedRedDiagnostic(receipt) {
  const commands = Array.isArray(receipt?.commands)
    ? receipt.commands.slice(0, commandNames.size).map((command) => {
        const { rustcCodes, compilerSignal } = redactedCompilerEvidence(command);
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
          failureClass: redactedFailureClass(command),
          ...(rustcCodes.length > 0 ? { rustcCodes } : {}),
          ...(compilerSignal === null ? {} : { compilerSignal }),
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

export function runG16Preflight(options = {}) {
  return runTaskPreflight({ ...options, contractPath: g16ContractPath });
}
