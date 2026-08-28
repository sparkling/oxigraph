import { repositoryRoot } from "../paths.mjs";
import { classifyG17Qualification } from "./classification.mjs";
import { loadG17Contract } from "./contract.mjs";
import {
  loadG17ControlProtocol,
  validateG17ControlExecutionBinding,
  validateG17QualificationOwnerGate,
} from "./control-protocol.mjs";
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

function legacyDecisionProjection(protocol) {
  const approved =
    protocol.authorization.status === "CONTROL_AUTHORIZED" &&
    protocol.finalDecisionSet.status === "APPROVED";
  return Object.freeze({
    reference: Object.freeze({ status: approved ? "SELECTED" : "PROPOSED" }),
    performance: Object.freeze({ status: approved ? "APPROVED" : "PROPOSED" }),
    noise: Object.freeze({ status: approved ? "APPROVED" : "PROPOSED" }),
  });
}

function contractProjection(loaded, protocol) {
  const { contract } = loaded;
  const decisions = legacyDecisionProjection(protocol);
  return Object.freeze({
    id: contract.id,
    sha256: loaded.contractSha256,
    suiteHash: contract.benchmark.suite.taskHash,
    referenceDecision: decisions.reference.status,
    budgetDecision: decisions.performance.status,
    noiseDecision: decisions.noise.status,
    controlAuthorization: protocol.authorization.status,
    finalDecisionSet: protocol.finalDecisionSet.status,
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

function blockedRunResult(loaded, protocol) {
  const benchmark = notRunBenchmark();
  const decisions = legacyDecisionProjection(protocol);
  return Object.freeze({
    schema: "oxigraph.g1.7-qualification-run-gate/v2",
    contract: contractProjection(loaded, protocol),
    decisionAuthority: "DIAGNOSTIC_ONLY",
    phase:
      protocol.authorization.status === "CONTROL_AUTH_PROPOSED"
        ? "CONTROL_AUTH_PROPOSED"
        : "CONTROL_AUTHORIZED",
    final: classifyCurrent(decisions, "NOT_RUN", "NOT_RUN", benchmark),
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

export class G17ControlAuthorizationGateError extends Error {
  constructor(result) {
    super("G1.7 controls require a prior human control authorization");
    this.name = "G17ControlAuthorizationGateError";
    this.code = "G17_CONTROL_AUTHORIZATION_UNAPPROVED";
    this.result = result;
  }
}

export class G17ControlExecutionUnavailableError extends Error {
  constructor() {
    super(
      "G1.7 authorized controls require a separately reviewed raw build and launch owner",
    );
    this.name = "G17ControlExecutionUnavailableError";
    this.code = "G17_CONTROL_EXECUTION_OWNER_UNIMPLEMENTED";
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

export function assertG17ControlExecutionOwnerAvailable() {
  throw new G17ControlExecutionUnavailableError();
}

export async function preflightG17Qualification({
  contractLoader = loadG17Contract,
  protocolLoader = loadG17ControlProtocol,
  identityProvider = currentG17QualificationIdentity,
  repoRoot = repositoryRoot,
  clock = () => new Date(),
} = {}) {
  instant(clock);
  const loaded = contractLoader();
  const protocol = protocolLoader({ contract: loaded.contract });
  const decisions = legacyDecisionProjection(protocol);
  const identity = await identityProvider({
    contract: loaded.contract,
    repoRoot,
  });
  const benchmark = notRunBenchmark();
  return Object.freeze({
    schema: "oxigraph.g1.7-qualification-preflight/v1",
    contract: contractProjection(loaded, protocol),
    identity: g17ReceiptIdentity(identity),
    final: classifyCurrent(decisions, "MISSING", "MISSING", benchmark),
    authority: AUTHORITY,
  });
}

export async function runG17Qualification({
  contractLoader = loadG17Contract,
  protocolLoader = loadG17ControlProtocol,
  clock = () => new Date(),
} = {}) {
  const started = instant(clock);
  const loaded = contractLoader();
  const { contract } = loaded;
  const protocol = protocolLoader({ contract });
  if (
    protocol.authorization.status !== "CONTROL_AUTHORIZED" ||
    protocol.finalDecisionSet.status !== "APPROVED"
  ) {
    throw new G17QualificationDecisionGateError(
      blockedRunResult(loaded, protocol),
    );
  }
  validateG17QualificationOwnerGate({
    authorization: protocol.authorization,
    authorizationRawSha256: protocol.artifacts.authorization.rawSha256,
    finalDecisionSet: protocol.finalDecisionSet,
    qualificationStartedAt: started.toISOString(),
  });
  assertG17ExecutionOwnerAvailable();
}

export async function runG17Controls({
  contractLoader = loadG17Contract,
  protocolLoader = loadG17ControlProtocol,
  clock = () => new Date(),
} = {}) {
  const started = instant(clock);
  const loaded = contractLoader();
  const protocol = protocolLoader({ contract: loaded.contract });
  if (protocol.authorization.status !== "CONTROL_AUTHORIZED") {
    throw new G17ControlAuthorizationGateError(
      blockedRunResult(loaded, protocol),
    );
  }
  validateG17ControlExecutionBinding({
    authorization: protocol.authorization,
    authorizationRawSha256: protocol.artifacts.authorization.rawSha256,
    controlStartedAt: started.toISOString(),
  });
  assertG17ControlExecutionOwnerAvailable();
}
