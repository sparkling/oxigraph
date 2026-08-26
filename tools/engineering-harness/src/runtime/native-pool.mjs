import { createHash } from "node:crypto";
import { validateWorkerOutput, validateWorkerRole } from "../policy/authority.mjs";
import { NATIVE_FAILURE_CODES } from "../policy/native-failures.mjs";
import { nativeWorkerTimeoutMs } from "../policy/native-timeouts.mjs";
import { runNativeWorker } from "../native/worker.mjs";
import { createHostRecovery, UPSTREAM_STRATEGIES } from "./upstream.mjs";

const PROVIDERS = Object.freeze(["codex", "claude"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function modelMap(contract) {
  const result = {};
  for (const declaration of contract.routing.providers) {
    if (!PROVIDERS.includes(declaration.provider) || declaration.transport !== "native") {
      throw new Error("native worker pool received a non-native provider declaration");
    }
    if (/openrouter/i.test(declaration.model)) {
      throw new Error("OpenRouter routing is prohibited");
    }
    result[declaration.provider] = declaration.model;
  }
  if (Object.keys(result).length !== PROVIDERS.length) {
    throw new Error("native worker pool requires Codex and Claude models");
  }
  return Object.freeze(result);
}

function boundedOutcome(outcome) {
  if (outcome === null || typeof outcome !== "object") {
    throw new Error("native worker did not return process evidence");
  }
  return Object.freeze({
    disposition: outcome.disposition,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    durationMs: outcome.durationMs,
    stdoutSha256: sha256(outcome.stdout ?? ""),
    stderrSha256: sha256(outcome.stderr ?? ""),
    terminationErrors: Object.freeze(
      Array.isArray(outcome.terminationErrors)
        ? structuredClone(outcome.terminationErrors)
        : [],
    ),
  });
}

function invocationEvidence(sequence, executionId, result) {
  const invocation = result.invocation ?? null;
  const output = result.output ?? null;
  if (
    invocation === null ||
    typeof invocation.executable !== "string" ||
    !Array.isArray(invocation.args) ||
    invocation.attestation === undefined ||
    !/^[a-f0-9]{64}$/.test(invocation.taskSha256) ||
    !/^[a-f0-9]{64}$/.test(invocation.promptSha256)
  ) {
    throw new Error("spawned native worker omitted invocation provenance");
  }
  const failure = result.failure ?? null;
  if (
    result.status === "INCONCLUSIVE" &&
    (failure === null ||
      !NATIVE_FAILURE_CODES.includes(failure.code) ||
      !/^[a-f0-9]{64}$/.test(failure.detailSha256) ||
      typeof failure.retryable !== "boolean")
  ) {
    throw new Error("inconclusive native worker omitted its bounded failure classification");
  }
  if (result.status !== "INCONCLUSIVE" && failure !== null) {
    throw new Error("completed native worker attached an invalid failure classification");
  }
  return Object.freeze({
    sequence,
    executionId,
    provider: result.provider,
    model: result.model,
    role: result.role,
    status: result.status,
    executable: invocation.executable,
    args: Object.freeze([...invocation.args]),
    executableAttestation: Object.freeze(structuredClone(invocation.attestation)),
    taskSha256: invocation.taskSha256,
    promptSha256: invocation.promptSha256,
    process: boundedOutcome(result.outcome),
    outputSha256: output === null ? null : sha256(JSON.stringify(output)),
    patchSha256: output?.patch === null || output?.patch === undefined
      ? null
      : sha256(output.patch),
    ...(failure === null
      ? {}
      : {
          failureCode: failure.code,
          failureDetailSha256: failure.detailSha256,
        }),
  });
}

function failedInvocationEvidence(
  sequence,
  executionId,
  { provider, model, role, error },
) {
  const message = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    sequence,
    executionId,
    provider,
    model,
    role,
    status: "ERROR",
    executable: null,
    args: Object.freeze([]),
    executableAttestation: null,
    taskSha256: null,
    promptSha256: null,
    process: null,
    outputSha256: null,
    patchSha256: null,
    error: message.slice(0, 512),
    errorSha256: sha256(message),
  });
}

function classifiedError(code, message, cause) {
  const error = new Error(message, { cause });
  error.code = code;
  return error;
}

function cancelledResult(result, signal) {
  return (
    signal?.aborted === true ||
    result?.outcome?.disposition === "cancelled" ||
    result?.outcome?.disposition === "cancelled-unreaped"
  );
}

function strategyRoles(intent) {
  const strategy = UPSTREAM_STRATEGIES[intent];
  if (strategy === undefined) throw new Error(`unsupported native pool intent: ${intent}`);
  return strategy.steps.map(({ kind }) => kind);
}

export class NativeWorkerPool {
  #contract;
  #models;
  #workerRunner;
  #recoveries;
  #evidence = [];

  constructor({ contract, workerRunner = runNativeWorker }) {
    if (typeof workerRunner !== "function") {
      throw new Error("native worker pool requires a worker runner");
    }
    this.#contract = contract;
    this.#models = modelMap(contract);
    this.#workerRunner = workerRunner;
    this.#recoveries = new Map(
      PROVIDERS.map((provider) => [
        provider,
        createHostRecovery({
          threshold: 2,
          cooldownMs: 30_000,
          maxRetries: 1,
          maxRetryUsd: 0,
        }),
      ]),
    );
  }

  get models() {
    return this.#models;
  }

  agentsFor({ intent, providersByRole, taskFactory, signal, executionId = null }) {
    if (typeof taskFactory !== "function") {
      throw new Error("native worker pool requires a role task factory");
    }
    if (
      executionId !== null &&
      (typeof executionId !== "string" || executionId.length === 0 || executionId.length > 512)
    ) {
      throw new Error("native worker pool executionId must be a bounded string or null");
    }
    const roles = strategyRoles(intent);
    const selectedAgents = [];
    const recoveries = new Map();
    for (const role of roles) {
      validateWorkerRole(role);
      const provider = providersByRole[role];
      if (!PROVIDERS.includes(provider)) {
        throw new Error(`native worker pool has no provider for ${role}`);
      }
      const id = `${provider}:${role}`;
      const model = this.#models[provider];
      selectedAgents.push(
        Object.freeze({
          id,
          model,
          handles: Object.freeze([role]),
          run: async (input) => {
            let result;
            let evidence;
            let task;
            try {
              if (signal?.aborted) {
                throw classifiedError(
                  "OXIGRAPH_CANCELLED",
                  `${provider} ${role} cancelled before task preparation`,
                );
              }
              task = await taskFactory({ role, provider, input });
            } catch (error) {
              const classified =
                error?.code === "OXIGRAPH_CANCELLED"
                  ? error
                  : classifiedError(
                      "OXIGRAPH_PREPARATION_FAILED",
                      error instanceof Error ? error.message : String(error),
                      error,
                    );
              this.#evidence.push(
                failedInvocationEvidence(
                  this.#evidence.length + 1,
                  executionId,
                  { provider, model, role, error: classified },
                ),
              );
              throw classified;
            }
            try {
              result = await this.#workerRunner({
                provider,
                role,
                model,
                task,
                contract: this.#contract,
                timeoutMs: nativeWorkerTimeoutMs(
                  role,
                  this.#contract.ceilings.maxTotalVerifierWallMs,
                ),
                maxOutputBytes: this.#contract.ceilings.maxWorkerOutputBytes,
                signal,
              });
              if (
                result.provider !== provider ||
                result.model !== model ||
                result.role !== role
              ) {
                throw new Error("native worker result changed its frozen identity");
              }
              evidence = invocationEvidence(
                this.#evidence.length + 1,
                executionId,
                result,
              );
            } catch (error) {
              this.#evidence.push(
                failedInvocationEvidence(
                  this.#evidence.length + 1,
                  executionId,
                  { provider, model, role, error },
                ),
              );
              throw error;
            }
            this.#evidence.push(evidence);
            if (result.status === "INCONCLUSIVE" || result.output === undefined) {
              if (cancelledResult(result, signal)) {
                throw classifiedError(
                  "OXIGRAPH_CANCELLED",
                  `${provider} ${role} worker was cancelled`,
                );
              }
              const error = classifiedError(
                result.failure.retryable
                  ? "OXIGRAPH_NATIVE_TRANSIENT"
                  : "OXIGRAPH_WORKER_OUTPUT_REJECTED",
                `${provider} ${role} worker failed at ${result.failure.code}`,
              );
              error.nativeFailureCode = result.failure.code;
              error.nativeFailureDetailSha256 = result.failure.detailSha256;
              throw error;
            }
            const output = validateWorkerOutput(result.output, role);
            return Object.freeze({
              output,
              quality: 0,
              confidence: 1,
              risk: 0.01,
              costUsd: 0,
              latencyMs: result.outcome.durationMs,
            });
          },
        }),
      );
      recoveries.set(id, this.#recoveries.get(provider));
    }
    return Object.freeze({
      selectedAgents: Object.freeze(selectedAgents),
      recoveries,
    });
  }

  evidence() {
    return Object.freeze(structuredClone(this.#evidence));
  }

  evidenceFor(executionId) {
    if (typeof executionId !== "string" || executionId.length === 0) {
      throw new Error("native evidence lookup requires an executionId");
    }
    return Object.freeze(
      structuredClone(
        this.#evidence.filter((entry) => entry.executionId === executionId),
      ),
    );
  }

  recoverySnapshot() {
    return Object.freeze(
      Object.fromEntries(
        PROVIDERS.map((provider) => [
          provider,
          this.#recoveries.get(provider).snapshot(),
        ]),
      ),
    );
  }
}
