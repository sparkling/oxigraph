import { repositoryRoot } from "../paths.mjs";
import { classifyG17Qualification } from "./classification.mjs";
import { loadG17Contract } from "./contract.mjs";
import {
  loadG17DecisionSet,
  validateG17DecisionSetBinding,
} from "./decision-contract.mjs";
import {
  currentG17QualificationIdentity,
  g17ReceiptIdentity,
} from "./identity.mjs";

const AUTHORITY = Object.freeze({
  localOnly: true,
  promotionAuthority: false,
  routerQualityAuthority: false,
  publicationAuthority: false,
});

function instant(clock) {
  const observed = clock();
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    throw new Error("G1.7 qualification clock returned an invalid instant");
  }
  return observed;
}

function contractProjection(loaded, decisions) {
  const { contract } = loaded;
  return Object.freeze({
    id: contract.id,
    sha256: loaded.contractSha256,
    suiteHash: contract.benchmark.suite.taskHash,
    referenceDecision: decisions.reference.status,
    budgetDecision: decisions.performance.status,
    noiseDecision: decisions.noise.status,
  });
}

function notRunBenchmark() {
  return Object.freeze({
    status: "NOT_RUN",
    sampleCount: 0,
    samplesSha256: null,
    summarySha256: null,
    budgetBreaches: Object.freeze([]),
  });
}

function classifyCurrent(
  decisions,
  semanticStatus,
  compatibilityStatus,
  benchmark,
) {
  return classifyG17Qualification({
    semantic: { status: semanticStatus },
    compatibility: { status: compatibilityStatus },
    benchmark,
    referenceDecision: decisions.reference,
    budgetDecision: decisions.performance,
    noiseDecision: decisions.noise,
  });
}

function blockedRunResult(loaded, decisionBinding) {
  const benchmark = notRunBenchmark();
  return Object.freeze({
    schema: "oxigraph.g1.7-qualification-run-gate/v1",
    contract: contractProjection(loaded, decisionBinding),
    decisionAuthority: decisionBinding.authority,
    final: classifyCurrent(decisionBinding, "NOT_RUN", "NOT_RUN", benchmark),
    authority: AUTHORITY,
  });
}

export class G17QualificationDecisionGateError extends Error {
  constructor(result) {
    super(
      "G1.7 qualification decisions are proposed and do not authorize execution",
    );
    this.name = "G17QualificationDecisionGateError";
    this.code = "G17_DECISIONS_UNAPPROVED";
    this.result = result;
  }
}

export class G17QualificationExecutionUnavailableError extends Error {
  constructor() {
    super(
      "G1.7 approved execution requires a separately reviewed attested build and sample owner",
    );
    this.name = "G17QualificationExecutionUnavailableError";
    this.code = "G17_EXECUTION_OWNER_UNIMPLEMENTED";
  }
}

export function assertG17ExecutionOwnerAvailable() {
  throw new G17QualificationExecutionUnavailableError();
}

export async function preflightG17Qualification({
  contractLoader = loadG17Contract,
  decisionLoader = loadG17DecisionSet,
  identityProvider = currentG17QualificationIdentity,
  repoRoot = repositoryRoot,
  clock = () => new Date(),
} = {}) {
  const observedAt = instant(clock);
  const loaded = contractLoader();
  const decisions = decisionLoader({ contract: loaded.contract });
  const decisionBinding = validateG17DecisionSetBinding({
    contract: loaded.contract,
    decisions,
    startedAt: observedAt.toISOString(),
  });
  const identity = await identityProvider({
    contract: loaded.contract,
    repoRoot,
  });
  const benchmark = notRunBenchmark();
  return Object.freeze({
    schema: "oxigraph.g1.7-qualification-preflight/v1",
    contract: contractProjection(loaded, decisionBinding),
    identity: g17ReceiptIdentity(identity),
    final: classifyCurrent(decisionBinding, "MISSING", "MISSING", benchmark),
    authority: AUTHORITY,
  });
}

export async function runG17Qualification({
  contractLoader = loadG17Contract,
  decisionLoader = loadG17DecisionSet,
  clock = () => new Date(),
} = {}) {
  const started = instant(clock);
  const loaded = contractLoader();
  const { contract } = loaded;
  const decisions = decisionLoader({ contract });
  const decisionBinding = validateG17DecisionSetBinding({
    contract,
    decisions,
    startedAt: started.toISOString(),
  });
  if (!decisionBinding.approved) {
    throw new G17QualificationDecisionGateError(
      blockedRunResult(loaded, decisionBinding),
    );
  }
  assertG17ExecutionOwnerAvailable();
}
