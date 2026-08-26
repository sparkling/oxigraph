import { createHash, randomUUID } from "node:crypto";

import { canonicalJson } from "../routing/features.mjs";
import { repositoryRoot } from "../paths.mjs";
import {
  collectG17CompatibilityEvidence,
  inspectG17SemanticEvidence,
} from "./application-evidence.mjs";
import { classifyG17Qualification } from "./classification.mjs";
import { loadG17Contract } from "./contract.mjs";
import {
  currentG17QualificationIdentity,
  g17ReceiptIdentity,
} from "./identity.mjs";
import {
  createG17Receipt,
  g17ReceiptBytes,
} from "./receipt.mjs";
import {
  createG17Run,
  g17RunsRoot,
} from "./storage.mjs";

const AUTHORITY = Object.freeze({
  localOnly: true,
  promotionAuthority: false,
  routerQualityAuthority: false,
  publicationAuthority: false,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function instant(clock) {
  const observed = clock();
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) {
    throw new Error("G1.7 qualification clock returned an invalid instant");
  }
  return observed;
}

function contractProjection(loaded) {
  const { contract } = loaded;
  return Object.freeze({
    id: contract.id,
    sha256: loaded.contractSha256,
    suiteHash: contract.benchmark.suite.taskHash,
    referenceDecision: contract.referenceDecision.status,
    budgetDecision: contract.budgetDecision.status,
    noiseDecision: contract.noiseDecision.status,
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

function classifyCurrent(contract, semanticStatus, compatibilityStatus, benchmark) {
  return classifyG17Qualification({
    semantic: { status: semanticStatus },
    compatibility: { status: compatibilityStatus },
    benchmark,
    referenceDecision: contract.referenceDecision,
    budgetDecision: contract.budgetDecision,
    noiseDecision: contract.noiseDecision,
  });
}

function publicEvidence(evidence) {
  return Object.freeze({
    status: evidence.status,
    sha256: evidence.sha256,
    reasons: Object.freeze([...evidence.reasons]),
    projection: evidence.projection,
  });
}

function artifactRecord(name, bytes) {
  return Object.freeze({ name, bytes: bytes.length, sha256: sha256(bytes) });
}

function uniqueArtifacts(artifacts) {
  const sorted = [...artifacts].sort((left, right) => left.name.localeCompare(right.name));
  const names = new Set();
  for (const artifact of sorted) {
    if (
      names.has(artifact.name) ||
      !Buffer.isBuffer(artifact.bytes) ||
      artifact.bytes.length < 1
    ) {
      throw new Error("G1.7 qualification artifact inventory is invalid");
    }
    names.add(artifact.name);
  }
  return sorted;
}

export async function preflightG17Qualification({
  contractLoader = loadG17Contract,
  identityProvider = currentG17QualificationIdentity,
  repoRoot = repositoryRoot,
} = {}) {
  const loaded = contractLoader();
  const identity = await identityProvider({
    contract: loaded.contract,
    repoRoot,
  });
  const benchmark = notRunBenchmark();
  return Object.freeze({
    schema: "oxigraph.g1.7-qualification-preflight/v1",
    contract: contractProjection(loaded),
    identity: g17ReceiptIdentity(identity),
    final: classifyCurrent(
      loaded.contract,
      "MISSING",
      "MISSING",
      benchmark,
    ),
    authority: AUTHORITY,
  });
}

export async function runG17Qualification({
  runId = randomUUID(),
  runsRoot = g17RunsRoot,
  contractLoader = loadG17Contract,
  identityProvider = currentG17QualificationIdentity,
  semanticProvider = inspectG17SemanticEvidence,
  compatibilityProvider = collectG17CompatibilityEvidence,
  repoRoot = repositoryRoot,
  evidenceRepositoryRoot = repoRoot,
  clock = () => new Date(),
} = {}) {
  const started = instant(clock);
  const loaded = contractLoader();
  const { contract } = loaded;
  const identity = await identityProvider({ contract, repoRoot });
  const [semanticEvidence, compatibilityEvidence] = await Promise.all([
    semanticProvider({ contract, identity, repoRoot }),
    compatibilityProvider({
      contract,
      identity,
      repoRoot,
      evidenceRepositoryRoot,
      maximumGeneratedAtMs: started.getTime(),
    }),
  ]);

  const benchmark = notRunBenchmark();
  if (
    contract.referenceDecision.status !== "UNSELECTED" ||
    contract.budgetDecision.status !== "ABSENT" ||
    contract.noiseDecision.status !== "ABSENT"
  ) {
    throw new Error(
      "G1.7 benchmark comparison requires a separately reviewed runner revision",
    );
  }
  const final = classifyCurrent(
    contract,
    semanticEvidence.status,
    compatibilityEvidence.status,
    benchmark,
  );
  const semantic = publicEvidence(semanticEvidence);
  const compatibility = publicEvidence(compatibilityEvidence);
  const observations = Object.freeze({
    schema: "oxigraph.g1.7-qualification-observations/v1",
    identity,
    semantic,
    compatibility,
    benchmark,
  });
  const initialArtifacts = uniqueArtifacts([
    { name: "contract.json", bytes: Buffer.from(loaded.bytes) },
    { name: "identity.json", bytes: canonicalBytes(identity) },
    { name: "observations.json", bytes: canonicalBytes(observations) },
    ...semanticEvidence.artifacts,
    ...compatibilityEvidence.artifacts,
  ]);

  const run = await createG17Run({ runId, runsRoot });
  const artifactRecords = [];
  for (const artifact of initialArtifacts) {
    await run.write(artifact.name, artifact.bytes);
    artifactRecords.push(artifactRecord(artifact.name, artifact.bytes));
  }
  const manifest = Object.freeze({
    schema: "oxigraph.g1.7-qualification-artifact-manifest/v1",
    runId,
    artifacts: Object.freeze([...artifactRecords]),
  });
  const manifestBytes = canonicalBytes(manifest);
  await run.write("manifest.json", manifestBytes);
  artifactRecords.push(artifactRecord("manifest.json", manifestBytes));
  artifactRecords.sort((left, right) => left.name.localeCompare(right.name));

  const receipt = createG17Receipt({
    run: {
      id: runId,
      startedAt: started.toISOString(),
      finishedAt: instant(clock).toISOString(),
    },
    contract: contractProjection(loaded),
    identity: g17ReceiptIdentity(identity),
    evidence: { semantic, compatibility },
    benchmark,
    final,
    artifacts: artifactRecords,
  });
  await run.seal(g17ReceiptBytes(receipt));
  return Object.freeze({ receipt, runPath: run.path });
}
