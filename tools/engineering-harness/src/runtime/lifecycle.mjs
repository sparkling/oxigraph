import { NATIVE_PROVIDERS } from "../routing/history.mjs";

export const CANDIDATE_ROLES = Object.freeze([
  "architecture",
  "critique",
  "implementation",
]);

function requireDecision(decision, role) {
  if (decision === null || typeof decision !== "object") {
    throw new Error(`missing routing decision for ${role}`);
  }
  if (decision.mode === "paired") {
    if (
      !Array.isArray(decision.providers) ||
      decision.providers.length !== NATIVE_PROVIDERS.length ||
      !NATIVE_PROVIDERS.every((provider) => decision.providers.includes(provider))
    ) {
      throw new Error(`${role} paired decision lacks both native providers`);
    }
  } else if (
    decision.mode !== "routed" ||
    !NATIVE_PROVIDERS.includes(decision.provider)
  ) {
    throw new Error(`${role} has an invalid routing decision`);
  }
  return decision;
}

export async function routeRoles(router, context, roles = CANDIDATE_ROLES) {
  if (typeof router?.route !== "function") {
    throw new Error("programme lifecycle requires the quality router");
  }
  const decisions = {};
  for (const role of roles) {
    decisions[role] = requireDecision(
      await router.route({ ...context, role }),
      role,
    );
  }
  return Object.freeze(decisions);
}

export function candidateProviderPlans(decisions) {
  const modes = new Set(
    CANDIDATE_ROLES.map((role) => requireDecision(decisions[role], role).mode),
  );
  if (modes.size !== 1) {
    throw new Error("candidate-role routing state diverged; re-pair before execution");
  }
  if (modes.has("paired")) {
    return Object.freeze(
      NATIVE_PROVIDERS.map((provider) =>
        Object.freeze({
          mode: "paired",
          providersByRole: Object.freeze(
            Object.fromEntries(CANDIDATE_ROLES.map((role) => [role, provider])),
          ),
        }),
      ),
    );
  }
  return Object.freeze([
    Object.freeze({
      mode: "routed",
      providersByRole: Object.freeze(
        Object.fromEntries(
          CANDIDATE_ROLES.map((role) => [role, decisions[role].provider]),
        ),
      ),
    }),
  ]);
}

export function upstreamRoleOutputs(run, roles) {
  if (run?.success !== true || !Array.isArray(run.steps)) {
    throw new Error("upstream attempt did not complete its frozen DAG");
  }
  const outputs = {};
  for (const role of roles) {
    const step = run.steps.find(({ step: definition }) => definition?.kind === role);
    if (step?.verdict?.pass !== true || step.output?.output === undefined) {
      throw new Error(`upstream attempt has no verified ${role} output`);
    }
    outputs[role] = step.output.output;
  }
  return Object.freeze(outputs);
}

export function candidateSha256(candidate) {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    !/^[0-9a-f]{40}$/.test(candidate.candidateTree) ||
    !/^[0-9a-f]{64}$/.test(candidate.candidatePatchSha256)
  ) {
    throw new Error("candidate identity is not sealed");
  }
  // Router history uses the admitted patch digest as its candidate identity.
  // The application receipt independently binds that patch to the candidate
  // commit, tree, protected manifest, verifier evidence, and native output.
  return candidate.candidatePatchSha256;
}

export function chooseVerifiedCandidate(attempts) {
  const accepted = attempts.filter(
    (attempt) =>
      attempt?.verifier?.verdict === "ACCEPT" &&
      /^[0-9a-f]{64}$/.test(attempt.candidateSha256),
  );
  if (accepted.length === 0) return null;
  accepted.sort((left, right) => {
    const repair = (left.repairCycles ?? 0) - (right.repairCycles ?? 0);
    if (repair !== 0) return repair;
    const cost = (left.measuredCostUsd ?? 0) - (right.measuredCostUsd ?? 0);
    if (cost !== 0) return cost;
    return (
      NATIVE_PROVIDERS.indexOf(
        left.candidateProvider ?? left.providersByRole.implementation,
      ) -
      NATIVE_PROVIDERS.indexOf(
        right.candidateProvider ?? right.providersByRole.implementation,
      )
    );
  });
  return accepted[0];
}

export function reviewProviderPlan(decision, implementationProvider) {
  requireDecision(decision, "review");
  if (!NATIVE_PROVIDERS.includes(implementationProvider)) {
    throw new Error("winning implementation provider is invalid");
  }
  if (decision.mode === "paired") {
    return Object.freeze({
      providers: Object.freeze([...NATIVE_PROVIDERS]),
      forcedCrossVendor: false,
    });
  }
  const crossProvider = NATIVE_PROVIDERS.find(
    (provider) => provider !== implementationProvider,
  );
  const providers =
    decision.provider === implementationProvider
      ? [decision.provider, crossProvider]
      : [decision.provider];
  return Object.freeze({
    providers: Object.freeze(providers),
    forcedCrossVendor: decision.provider === implementationProvider,
  });
}

export function qualityOutcome({
  taskId,
  taskClass,
  role,
  provider,
  candidateSha256: candidateDigest,
  contractSha256,
  evaluatorSha256,
  harnessSha256,
  models,
  decision,
  quality,
  repairCycles = 0,
}) {
  requireDecision(decision, role);
  if (!NATIVE_PROVIDERS.includes(provider)) {
    throw new Error("quality outcome provider is invalid");
  }
  const mode = decision.mode;
  const outcome = {
    taskId,
    taskClass,
    role,
    provider,
    model: models[provider],
    models,
    candidateSha256: candidateDigest,
    evaluatorSha256,
    contractSha256,
    harnessSha256,
    disposition: "verified",
    quality,
    mode,
    pairId: mode === "paired" ? `${taskId}:${role}` : null,
    repairCycles,
  };
  if (mode === "routed") outcome.predictedQuality = decision.predictedQuality;
  return Object.freeze(outcome);
}
