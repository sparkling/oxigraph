import { existsSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { repository, routeDelivery } from "./delivery.mjs";
import { canonicalSha256 } from "./routing/features.mjs";
import { ordinaryMemory } from "./ordinary-memory.mjs";
import { captureOrdinaryPolicy, ordinaryPolicyContext, readOrdinaryPolicy, seedOrdinaryPolicy } from "./ordinary-policy.mjs";
import { ensureDirectoryInsideRepository } from "../../agentic-qe/path-policy.mjs";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const bytesHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const runtimeBinding = () => canonicalSha256(["workflow.mjs", "workflow-output.mjs", "ordinary-api.mjs", "delivery.mjs",
  "ordinary-runtime.mjs", "ordinary-memory.mjs", "ordinary-policy.mjs", "ordinary-policy-evaluator.mjs", "../package-lock.json"].map((name) => [name, bytesHash(join(sourceDirectory, name))]));

export function loadOrdinaryRuntimeConfig(path = join(repository, "tools/engineering-harness/ordinary-runtime.json")) {
  if (!existsSync(path)) {
    if (path !== join(repository, "tools/engineering-harness/ordinary-runtime.json")) throw new Error("Ordinary runtime config missing");
    return { schema: 1 };
  }
  if (!lstatSync(path).isFile()) throw new Error("Ordinary runtime config must be regular");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (config?.schema !== 1 || Object.keys(config).some((key) => !["schema", "memoryDirectory", "policyActivation"].includes(key))) {
    throw new Error("Invalid ordinary runtime config");
  }
  return config;
}

export function ordinaryRuntimeBinding(spec, initialFiles, root = repository) {
  const evaluator = spec.checks.flatMap((check) => check.argv.filter((arg) => arg.endsWith(".mjs")))
    .map((path) => [path, bytesHash(join(root, path))]);
  return { harnessSha256: runtimeBinding(), evaluatorSha256: canonicalSha256({ evaluator, checks: spec.checks }),
    sourceSha256: canonicalSha256(initialFiles), specSha256: canonicalSha256(spec) };
}

export function createOrdinaryRuntime(config = { schema: 1 }, { policy, learning = true } = {}) {
  const memoryDirectory = resolve(repository, config.memoryDirectory ?? "target/engineering-delivery/native-outcomes");
  const allowed = relative(join(repository, "target/engineering-delivery"), memoryDirectory);
  if (!allowed || allowed.startsWith("..") || allowed.startsWith("/")) throw new Error("Ordinary memory must use private delivery output");
  ensureDirectoryInsideRepository(memoryDirectory);
  if (policy && config.policyActivation) throw new Error("Explicit policy conflicts with configured activation");
  const active = config.policyActivation ? readOrdinaryPolicy(config.policyActivation)
    : { policy: captureOrdinaryPolicy(policy ?? seedOrdinaryPolicy), digest: canonicalSha256(policy ?? seedOrdinaryPolicy) };
  return {
    policyDigest: active.digest,
    forWorkflow(spec, initialFiles, root = repository) {
      const current = ordinaryRuntimeBinding(spec, initialFiles, root);
      const applicable = config.policyActivation && Object.hasOwn(config.policyActivation.bindings?.tasks ?? {}, spec.taskId);
      const fallback = captureOrdinaryPolicy(config.policyActivation?.rootPolicy ?? seedOrdinaryPolicy);
      const selected = config.policyActivation && !applicable ? { policy: fallback, digest: canonicalSha256(fallback) } : active;
      const policyApplicability = config.policyActivation ? applicable ? "applicable-task" : "nonapplicable-task" : "default-policy";
      if (applicable && config.policyActivation?.dataSource && config.policyActivation.dataSource !== "OBSERVED" && spec.scope === "product") {
        throw new Error("Synthetic policy evidence cannot authorize product execution");
      }
      if (applicable && canonicalSha256(config.policyActivation.bindings.tasks[spec.taskId]) !== canonicalSha256(current)) {
        throw new Error("Active ordinary policy source/evaluator/runtime binding drifted");
      }
      const binding = canonicalSha256({ runtime: current.harnessSha256, evaluator: current.evaluatorSha256,
        policy: selected.digest, scope: spec.scope });
      const memory = ordinaryMemory(memoryDirectory, binding);
      const observations = [];
      let hybrid = false;
      let packet;
      let authorPacket;
      return {
        policyDigest: selected.digest,
        policyApplicability,
        binding: current,
        context: (role) => ({ policy: ordinaryPolicyContext(selected.policy, role), policyDigest: selected.digest, policyApplicability,
          nativeMemory: memory.summary() }),
        noteRoute: (route) => { if (route.transport === "openrouter-api") hybrid = true; },
        notePacket(request) {
          packet = { prompt: request.payload.prompt, sourceDigest: request.sourceSha256,
            policyDigest: selected.digest, role: request.payload.feedback ? "repair" : request.payload.route.role };
          if (["implement", "repair"].includes(packet.role)) authorPacket = packet;
        },
        selectCreditFallback(route) {
          const candidates = ["cc/claude-sonnet-5-5[1m]", "gpt-5.6-sol"].map((model) => routeDelivery({
            role: route.role, taskId: spec.taskId, completionCheck: spec.completionCheck, model, effort: "medium",
            reason: "confirmed-credit-rejection",
          }));
          return memory.select(route, candidates, canonicalSha256(packet), packet.role);
        },
        observe(route, checks, references, quality) {
          if (route.transport !== "native-subscription" || checks.length !== spec.checks.length ||
              checks.some((check) => check.result?.timedOut || check.result?.cleanupUnconfirmed ||
                !Number.isInteger(check.result?.code) || ![0, 1].includes(check.result.code))) return;
          observations.push({ inputDigest: canonicalSha256(authorPacket), model: route.model, effort: route.effort,
            role: route.reason === "capability/output repair" ? "repair" : "implement", quality,
            evidenceDigest: canonicalSha256(references) });
        },
        finish: (runId) => learning ? memory.record(runId, observations, { hybrid }) : { recorded: false, reason: "evolution-routing-frozen" },
      };
    },
  };
}
