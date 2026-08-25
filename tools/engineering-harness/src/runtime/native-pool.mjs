import { createHash } from "node:crypto";
import { validateWorkerOutput, validateWorkerRole } from "../policy/authority.mjs";
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

function invocationEvidence(sequence, result) {
  const invocation = result.invocation ?? null;
  const output = result.output ?? null;
  return Object.freeze({
    sequence,
    provider: result.provider,
    model: result.model,
    role: result.role,
    status: result.status,
    executable: invocation?.executable ?? null,
    args: Object.freeze(invocation === null ? [] : [...invocation.args]),
    executableAttestation:
      invocation?.attestation === undefined
        ? null
        : Object.freeze(structuredClone(invocation.attestation)),
    process: boundedOutcome(result.outcome),
    outputSha256: output === null ? null : sha256(JSON.stringify(output)),
    patchSha256: output?.patch === null || output?.patch === undefined
      ? null
      : sha256(output.patch),
  });
}

function failedInvocationEvidence(sequence, { provider, model, role, error }) {
  const message = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    sequence,
    provider,
    model,
    role,
    status: "ERROR",
    executable: null,
    args: Object.freeze([]),
    executableAttestation: null,
    process: null,
    outputSha256: null,
    patchSha256: null,
    error: message.slice(0, 512),
    errorSha256: sha256(message),
  });
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

  agentsFor({ intent, providersByRole, taskFactory, signal }) {
    if (typeof taskFactory !== "function") {
      throw new Error("native worker pool requires a role task factory");
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
            const task = await taskFactory({ role, provider, input });
            let result;
            try {
              result = await this.#workerRunner({
                provider,
                role,
                model,
                task,
                contract: this.#contract,
                timeoutMs: Math.min(
                  600_000,
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
            } catch (error) {
              this.#evidence.push(
                failedInvocationEvidence(this.#evidence.length + 1, {
                  provider,
                  model,
                  role,
                  error,
                }),
              );
              throw error;
            }
            this.#evidence.push(invocationEvidence(this.#evidence.length + 1, result));
            if (result.status === "INCONCLUSIVE" || result.output === undefined) {
              throw new Error(`${provider} ${role} worker was inconclusive`);
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
