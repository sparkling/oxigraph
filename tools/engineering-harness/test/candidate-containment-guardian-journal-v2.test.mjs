import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as journalV1 from "../src/candidate/containment-guardian-journal-v1.mjs";
import * as journalV2 from "../src/candidate/containment-guardian-journal-v2.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment guardian journal v2/u;
const EXPECTED_V2_NONCLAIMS = Object.freeze([
  ["serializedReplayProvesFreshness", false],
  ["serializedReplayProvesFreshRandomness", false],
  ["serializedReplayProvesArtifactOrigin", false],
  ["serializedReplayProvesExclusiveStateRootLock", false],
  ["serializedReplayProvesCompleteFilesystemInventory", false],
  ["serializedReplayProvesStateFilesystemMetadata", false],
  ["serializedReplayProvesFilesystemDurability", false],
  ["serializedReplayProvesGuardianExecution", false],
  ["serializedReplayProvesGuardianLiveness", false],
  ["serializedReplayProvesGuardianParentage", false],
  ["serializedActorDigestProvesProcessContinuity", false],
  ["reportedBootDigestComparisonProvesBootIdentity", false],
  ["serializedReplayProvesDelegatedRootIdentity", false],
  ["serializedReplayProvesSupervisorExecution", false],
  ["serializedReplayProvesDirectChildReap", false],
  ["serializedReplayProvesSupervisorExitStatus", false],
  ["serializedReplayProvesCgroupConfiguration", false],
  ["serializedReplayProvesCgroupCleanup", false],
  ["serializedReplayProvesApplicationResult", false],
  ["serializedReplayProvesRuntimeClosure", false],
  ["serializedReplayGrantsRecoveryMutationAuthority", false],
  ["completeBundleChainProvesOperationalRecoveryClearance", false],
  ["embeddedOperationArtifactProvesEffect", false],
  ["embeddedEvidenceArtifactProvesObservation", false],
  ["embeddedJournalRecordProvesTrustedOrigin", false],
  ["canonicalBase64ProvesPersistence", false],
  ["suppliedAnchorsProveTrustedOrigin", false],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function identityInput(overrides = {}) {
  return {
    requestSha256: digest("request"),
    ownerRequestSha256: digest("owner-request"),
    limitsSha256: digest("limits"),
    delegatedRootIdentitySha256: digest("delegated-root"),
    launchCapsuleRawSha256: digest("launch-capsule-raw"),
    launchCapsuleProjectionSha256: digest("launch-capsule-projection"),
    bootstrapRequirementsSha256: digest("bootstrap-requirements"),
    launchRequirementsSha256: digest("launch-requirements"),
    supervisorExecutableIdentitySha256: digest("supervisor-executable"),
    birthGuardianEpochSha256: digest("birth-guardian-epoch"),
    bootIdSha256: digest("boot-id"),
    admissionGenerationSha256: digest("admission-generation"),
    launchNonceSha256: digest("launch-nonce"),
    ...overrides,
  };
}

function createIdentity(overrides = {}) {
  return journalV1.createCandidateContainmentGuardianGenerationIdentityV1(
    identityInput(overrides),
  );
}

function projection(kind, state, sequence, identity, variant = "normal") {
  const value = {
    schema: `oxigraph.candidate-containment-guardian-${kind}-projection/${state
      .toLowerCase()
      .replaceAll("_", "-")}/v2`,
    sequence: String(sequence).padStart(16, "0"),
    state,
    generationIdentitySha256: identity.identitySha256,
    detailSha256: digest(`${variant}:${kind}:${sequence}:${state}`),
  };
  return {
    value,
    bytes: jsonLine(value),
    semanticSha256: semanticSha256(value),
  };
}

function createChain(identity = createIdentity(), options = {}) {
  const records = [];
  const bundles = [];
  const operations = [];
  const evidence = [];
  let previousRecord = null;
  let previousBundle = null;
  for (const [
    index,
    state,
  ] of journalV1.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.entries()) {
    const sequence = index + 1;
    const operation = projection(
      "operation",
      state,
      sequence,
      identity,
      options.variant,
    );
    const evidenceArtifact = projection(
      "evidence",
      state,
      sequence,
      identity,
      options.variant,
    );
    const record = journalV1.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity: identity,
      state,
      actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
      operationProjectionSha256: operation.semanticSha256,
      evidenceProjectionSha256: evidenceArtifact.semanticSha256,
      previousRecord,
    });
    const bundle = journalV2.createCandidateContainmentGuardianJournalBundleV2({
      journalRecord: { name: record.name, bytes: record.bytes },
      operationBytes: operation.bytes,
      evidenceBytes: evidenceArtifact.bytes,
      previousBundle,
    });
    records.push(record);
    bundles.push(bundle);
    operations.push(operation);
    evidence.push(evidenceArtifact);
    previousRecord = record;
    previousBundle = bundle;
  }
  return { identity, records, bundles, operations, evidence };
}

function copyArtifact(artifact) {
  return { name: artifact.name, bytes: artifact.bytes };
}

function replayInput(chain, options = {}) {
  return {
    bundles: chain.bundles.map(copyArtifact),
    expectedGenerationIdentitySha256:
      options.expectedGenerationIdentitySha256 ?? chain.identity.identitySha256,
    expectedBirthGuardianEpochSha256:
      options.expectedBirthGuardianEpochSha256 ??
      chain.identity.birthGuardianEpochSha256,
    expectedLatestBundleRawSha256: Object.hasOwn(
      options,
      "expectedLatestBundleRawSha256",
    )
      ? options.expectedLatestBundleRawSha256
      : chain.bundles.at(-1).rawSha256,
    reportedCurrentBootIdSha256: Object.hasOwn(
      options,
      "reportedCurrentBootIdSha256",
    )
      ? options.reportedCurrentBootIdSha256
      : chain.identity.bootIdSha256,
  };
}

function renamed(sequence, bytes) {
  return {
    name: `${sequence}-${sha256(bytes)}.jsonl`,
    bytes,
  };
}

function mutateBundle(bundle, mutate) {
  const value = JSON.parse(bundle.bytes.toString("utf8"));
  mutate(value);
  const bytes = jsonLine(value);
  return renamed(value.sequence, bytes);
}

test("freezes the generation manifest and journal-v2 requirements", () => {
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_BUNDLES_V2,
    18,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V2,
    16,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V2,
    "0".repeat(64),
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_MAX_BYTES_V2,
    16 * 1024,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2,
    16 * 1024,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_MAX_BYTES_V2,
    96 * 1024,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2,
    semanticSha256(
      journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2,
    ),
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2,
    "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26",
  );

  const identity = createIdentity();
  const manifest =
    journalV2.createCandidateContainmentGuardianGenerationManifestV2({
      generationIdentity: identity,
    });
  assert.equal(manifest.name, "generation.jsonl");
  assert.equal(manifest.rawSha256, sha256(manifest.bytes));
  assert.equal(
    manifest.rawSha256,
    "9673741418fe924b9663fb2447d88c3b42d4fb738cb08b46f3839fd48323b8ec",
  );
  assert.equal(
    manifest.semanticSha256,
    semanticSha256(JSON.parse(manifest.bytes.toString("utf8"))),
  );
  assert.equal(
    manifest.semanticSha256,
    "ae0969f16095476fef9e3da596c20c68af83144eeb4d05dd540ecea575f2e7dd",
  );
  assert.equal(manifest.generationIdentitySha256, identity.identitySha256);
  assert.equal(
    manifest.journalV1RequirementsSha256,
    journalV1.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
  );
  const verified =
    journalV2.verifyCandidateContainmentGuardianGenerationManifestV2({
      name: manifest.name,
      bytes: manifest.bytes,
    });
  assert.deepEqual(verified.generationIdentity, identity);
  const mutableRead = manifest.bytes;
  mutableRead.fill(0);
  assert.notEqual(manifest.bytes[0], 0);
});

test("constructs, verifies, and replays all 18 bound bundles", () => {
  const chain = createChain();
  assert.equal(chain.bundles.length, 18);
  assert.equal(
    chain.bundles[0].rawSha256,
    "b8f6f442e91d364615f46cec83b1aed5521dbd22cdaccc012f69a01baafd61a7",
  );
  assert.equal(
    chain.bundles.at(-1).rawSha256,
    "019cc469d6c3fa86c1dafca08b22bf96e8acad9650cc8c166ce98dd6e8703380",
  );
  for (const [index, bundle] of chain.bundles.entries()) {
    const sequence = String(index + 1).padStart(16, "0");
    assert.match(
      bundle.name,
      new RegExp(`^${sequence}-[0-9a-f]{64}\\.jsonl$`, "u"),
    );
    assert.equal(bundle.rawSha256, sha256(bundle.bytes));
    assert.equal(bundle.sequence, sequence);
    assert.equal(
      bundle.innerJournalRecord.rawSha256,
      chain.records[index].rawSha256,
    );
    assert.deepEqual(
      bundle.innerJournalRecord.bytes,
      chain.records[index].bytes,
    );
    assert.deepEqual(
      bundle.operationArtifact.bytes,
      chain.operations[index].bytes,
    );
    assert.deepEqual(
      bundle.evidenceArtifact.bytes,
      chain.evidence[index].bytes,
    );
    assert.equal(
      bundle.operationArtifact.semanticSha256,
      chain.records[index].operation.reportedProjectionSha256,
    );
    assert.equal(
      bundle.evidenceArtifact.semanticSha256,
      chain.records[index].evidence.reportedProjectionSha256,
    );
    const verified =
      journalV2.verifyCandidateContainmentGuardianJournalBundleV2(
        copyArtifact(bundle),
      );
    assert.equal(verified.bundleHashChainValidated, false);
    assert.equal(verified.innerJournalHashChainValidated, false);
    assert.equal(verified.embeddedArtifactBindingsValidated, true);
  }

  const replay = journalV2.replayCandidateContainmentGuardianJournalV2(
    replayInput(
      { ...chain, bundles: chain.bundles.toReversed() },
      { expectedLatestBundleRawSha256: chain.bundles.at(-1).rawSha256 },
    ),
  );
  assert.equal(replay.status, "COMPLETE_BUNDLE_CHAIN_REPLAYED");
  assert.equal(replay.bundleCount, 18);
  assert.equal(replay.chainComplete, true);
  assert.equal(replay.bundleHashChainValidated, true);
  assert.equal(replay.innerJournalHashChainValidated, true);
  assert.equal(replay.embeddedArtifactBindingsValidated, true);
  assert.equal(replay.reportedLatestState, "CLOSED_DURABLE");
  assert.equal(replay.reportedNextExpectedState, null);
  assert.equal(replay.bundleAppendRequired, false);
  assert.equal(replay.suppliedBootDigestRelationship, "same-boot");
  assert.deepEqual(replay.generationIdentity, chain.identity);
});

test("classifies every clean journal-v2 crash prefix without physical claims", () => {
  const complete = createChain();
  for (let length = 1; length < complete.bundles.length; length += 1) {
    const chain = { ...complete, bundles: complete.bundles.slice(0, length) };
    const replay = journalV2.replayCandidateContainmentGuardianJournalV2(
      replayInput(chain),
    );
    assert.equal(replay.status, "VALID_BUNDLE_PREFIX_REPLAYED");
    assert.equal(replay.bundleCount, length);
    assert.equal(replay.chainComplete, false);
    assert.equal(replay.bundleAppendRequired, true);
    assert.equal(
      replay.reportedNextExpectedState,
      journalV1.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[length],
    );
    assert.equal(
      Object.values(replay.authority).every((value) => value === false),
      true,
    );
    assert.equal(
      Object.values(replay.nonclaims).every((value) => value === false),
      true,
    );
    assert.equal(replay.physicalFacts.journalFilesystemDurability, null);
    assert.equal(replay.physicalFacts.operationEffectObserved, null);
    assert.equal(replay.physicalFacts.evidenceObservationEstablished, null);
    assert.equal(replay.physicalFacts.physicalEligibility, false);
    assert.equal(replay.physicalFacts.productionContainment, false);
  }
});

test("requires canonical artifact bytes and exact reported semantic digests", () => {
  const identity = createIdentity();
  const state = journalV1.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[0];
  const operation = projection("operation", state, 1, identity);
  const evidence = projection("evidence", state, 1, identity);
  const record = journalV1.createCandidateContainmentGuardianJournalRecordV1({
    generationIdentity: identity,
    state,
    actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
    operationProjectionSha256: operation.semanticSha256,
    evidenceProjectionSha256: evidence.semanticSha256,
    previousRecord: null,
  });
  const input = {
    journalRecord: copyArtifact(record),
    operationBytes: operation.bytes,
    evidenceBytes: evidence.bytes,
    previousBundle: null,
  };

  assert.throws(
    () =>
      journalV2.createCandidateContainmentGuardianJournalBundleV2({
        ...input,
        operationBytes: jsonLine({ changed: true }),
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.createCandidateContainmentGuardianJournalBundleV2({
        ...input,
        operationBytes: Buffer.from('{"z":1,"a":2}\n', "utf8"),
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.createCandidateContainmentGuardianJournalBundleV2({
        ...input,
        evidenceBytes: Buffer.alloc(
          journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2 +
            1,
          0x61,
        ),
      }),
    CONTRACT_ERROR,
  );

  const bundle =
    journalV2.createCandidateContainmentGuardianJournalBundleV2(input);
  for (const field of [
    "innerJournalRecord",
    "operationArtifact",
    "evidenceArtifact",
  ]) {
    for (const descriptorField of [
      "rawSha256",
      "semanticSha256",
      "bytesBase64",
    ]) {
      const changed = mutateBundle(bundle, (value) => {
        value[field][descriptorField] =
          descriptorField === "bytesBase64"
            ? `${value[field][descriptorField]}=`
            : digest(`${field}:${descriptorField}:changed`);
      });
      assert.throws(
        () =>
          journalV2.verifyCandidateContainmentGuardianJournalBundleV2(changed),
        CONTRACT_ERROR,
      );
    }
  }
  const changedInnerName = mutateBundle(bundle, (value) => {
    value.innerJournalRecord.name = "not-the-inner-record.jsonl";
  });
  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianJournalBundleV2(
        changedInnerName,
      ),
    CONTRACT_ERROR,
  );
});

test("rejects malformed bundle and manifest framing, names, and exact fields", () => {
  const chain = createChain();
  const [bundle] = chain.bundles;
  const malformed = [
    bundle.bytes.subarray(0, -1),
    Buffer.concat([bundle.bytes.subarray(0, -1), Buffer.from("\r\n")]),
    Buffer.concat([bundle.bytes, Buffer.from("{}\n")]),
    Buffer.from([0xff, 0x0a]),
    Buffer.alloc(
      journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_MAX_BYTES_V2 + 1,
      0x61,
    ),
  ];
  for (const bytes of malformed) {
    assert.throws(
      () =>
        journalV2.verifyCandidateContainmentGuardianJournalBundleV2(
          renamed(bundle.sequence, bytes),
        ),
      CONTRACT_ERROR,
    );
  }

  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianJournalBundleV2({
        name: bundle.name.toUpperCase(),
        bytes: bundle.bytes,
      }),
    CONTRACT_ERROR,
  );
  for (const mutate of [
    (value) => {
      value.extra = false;
    },
    (value) => {
      delete value.operationArtifact;
    },
    (value) => {
      value.schema = "unknown/v2";
    },
    (value) => {
      value.recordType = "COMMIT";
    },
    (value) => {
      value.previousBundleRawSha256 = "f".repeat(64);
    },
  ]) {
    assert.throws(
      () =>
        journalV2.verifyCandidateContainmentGuardianJournalBundleV2(
          mutateBundle(bundle, mutate),
        ),
      CONTRACT_ERROR,
    );
  }

  const manifest =
    journalV2.createCandidateContainmentGuardianGenerationManifestV2({
      generationIdentity: chain.identity,
    });
  const manifestValue = JSON.parse(manifest.bytes.toString("utf8"));
  const malformedManifests = [
    manifest.bytes.subarray(0, -1),
    Buffer.concat([manifest.bytes.subarray(0, -1), Buffer.from("\r\n")]),
    Buffer.concat([manifest.bytes, Buffer.from("{}\n")]),
    Buffer.from([0xff, 0x0a]),
    Buffer.alloc(
      journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_MAX_BYTES_V2 +
        1,
      0x61,
    ),
    Buffer.from(`${JSON.stringify(manifestValue, null, 2)}\n`, "utf8"),
  ];
  for (const bytes of malformedManifests) {
    assert.throws(
      () =>
        journalV2.verifyCandidateContainmentGuardianGenerationManifestV2({
          name: manifest.name,
          bytes,
        }),
      CONTRACT_ERROR,
    );
  }
  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianGenerationManifestV2({
        name: "other.jsonl",
        bytes: manifest.bytes,
      }),
    CONTRACT_ERROR,
  );
  const changedManifestValue = structuredClone(manifestValue);
  changedManifestValue.bootIdSha256 = digest("other-boot");
  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianGenerationManifestV2({
        name: manifest.name,
        bytes: jsonLine(changedManifestValue),
      }),
    CONTRACT_ERROR,
  );

  const innerFork = createChain(chain.identity, {
    variant: "wrong-inner-predecessor",
  });
  const wrongInnerPredecessor = mutateBundle(innerFork.bundles[1], (value) => {
    value.previousBundleRawSha256 = chain.bundles[0].rawSha256;
  });
  assert.equal(
    journalV2.verifyCandidateContainmentGuardianJournalBundleV2(
      wrongInnerPredecessor,
    ).innerJournalHashChainValidated,
    false,
  );
  const innerDriftChain = {
    ...chain,
    bundles: [copyArtifact(chain.bundles[0]), wrongInnerPredecessor],
  };
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2(
        replayInput(innerDriftChain),
      ),
    CONTRACT_ERROR,
  );
});

test("rejects gaps, forks, substitutions, and inner/v2 predecessor drift", () => {
  const chain = createChain();
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2({
        ...replayInput(chain),
        bundles: [],
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2({
        ...replayInput(chain),
        bundles: [
          copyArtifact(chain.bundles[0]),
          copyArtifact(chain.bundles[2]),
        ],
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2({
        ...replayInput(chain),
        bundles: [
          copyArtifact(chain.bundles[0]),
          copyArtifact(chain.bundles[1]),
          copyArtifact(chain.bundles[1]),
        ],
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianJournalBundleV2({
        name: chain.bundles[0].name,
        bytes: chain.bundles[1].bytes,
      }),
    CONTRACT_ERROR,
  );

  const fork = createChain(chain.identity, { variant: "fork" });
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2({
        ...replayInput(chain),
        bundles: [
          copyArtifact(chain.bundles[0]),
          copyArtifact(chain.bundles[1]),
          copyArtifact(fork.bundles[1]),
        ],
      }),
    CONTRACT_ERROR,
  );

  const wrongV2Predecessor = mutateBundle(chain.bundles[1], (value) => {
    value.previousBundleRawSha256 = digest("wrong-v2-predecessor");
  });
  assert.equal(
    journalV2.verifyCandidateContainmentGuardianJournalBundleV2(
      wrongV2Predecessor,
    ).bundleHashChainValidated,
    false,
  );
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2({
        ...replayInput(chain),
        bundles: [copyArtifact(chain.bundles[0]), wrongV2Predecessor],
      }),
    CONTRACT_ERROR,
  );
});

test("requires generation, birth, and optional latest-bundle anchors", () => {
  const chain = createChain();
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2(
        replayInput(chain, {
          expectedGenerationIdentitySha256: digest("wrong-generation"),
        }),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2(
        replayInput(chain, {
          expectedBirthGuardianEpochSha256: digest("wrong-birth"),
        }),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2(
        replayInput(chain, {
          expectedLatestBundleRawSha256: digest("wrong-head"),
        }),
      ),
    CONTRACT_ERROR,
  );
  const unheaded = journalV2.replayCandidateContainmentGuardianJournalV2(
    replayInput(chain, {
      expectedLatestBundleRawSha256: null,
      reportedCurrentBootIdSha256: null,
    }),
  );
  assert.equal(unheaded.latestBundleRawAnchorMatched, null);
  assert.equal(unheaded.suppliedBootDigestRelationship, "unknown");
  assert.equal(unheaded.physicalFacts.physicalRecoveryRequired, null);
});

test("keeps boot comparison observational", () => {
  const chain = createChain();
  assert.equal(
    journalV2.replayCandidateContainmentGuardianJournalV2(
      replayInput(chain, {
        reportedCurrentBootIdSha256: chain.identity.bootIdSha256,
      }),
    ).suppliedBootDigestRelationship,
    "same-boot",
  );
  assert.equal(
    journalV2.replayCandidateContainmentGuardianJournalV2(
      replayInput(chain, {
        reportedCurrentBootIdSha256: digest("different-boot"),
      }),
    ).suppliedBootDigestRelationship,
    "different-boot",
  );
});

test("rejects proxies, accessors, sparse inputs, and mutable-byte tricks", () => {
  const identity = createIdentity();
  assert.throws(
    () =>
      journalV2.createCandidateContainmentGuardianGenerationManifestV2(
        new Proxy({ generationIdentity: identity }, {}),
      ),
    CONTRACT_ERROR,
  );
  const accessor = {};
  Object.defineProperty(accessor, "generationIdentity", {
    enumerable: true,
    get: () => identity,
  });
  assert.throws(
    () =>
      journalV2.createCandidateContainmentGuardianGenerationManifestV2(
        accessor,
      ),
    CONTRACT_ERROR,
  );
  const chain = createChain(identity);
  const sparse = new Array(1);
  assert.throws(
    () =>
      journalV2.replayCandidateContainmentGuardianJournalV2({
        ...replayInput(chain),
        bundles: sparse,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianJournalBundleV2({
        name: chain.bundles[0].name,
        bytes: new Uint8Array(chain.bundles[0].bytes),
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journalV2.verifyCandidateContainmentGuardianJournalBundleV2({
        name: chain.bundles[0].name,
        bytes: new Proxy(chain.bundles[0].bytes, {}),
      }),
    CONTRACT_ERROR,
  );
});

test("returns deeply frozen metadata and copy-on-read embedded bytes", () => {
  const chain = createChain();
  const bundle = chain.bundles[0];
  assert.equal(Object.getPrototypeOf(bundle), null);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.innerJournalRecord), true);
  assert.equal(Object.isFrozen(bundle.operationArtifact), true);
  assert.equal(Object.isFrozen(bundle.evidenceArtifact), true);
  const operationRead = bundle.operationArtifact.bytes;
  operationRead.fill(0);
  assert.notEqual(bundle.operationArtifact.bytes[0], 0);
  const innerRead = bundle.innerJournalRecord.bytes;
  innerRead.fill(0);
  assert.notEqual(bundle.innerJournalRecord.bytes[0], 0);
  const replay = journalV2.replayCandidateContainmentGuardianJournalV2(
    replayInput(chain),
  );
  assert.equal(Object.getPrototypeOf(replay), null);
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(Object.isFrozen(replay.generationIdentity), true);
});

test("keeps journal-v1 byte-identical and the new contract authority-null", () => {
  const sourceV1 = readFileSync(
    fileURLToPath(
      new URL(
        "../src/candidate/containment-guardian-journal-v1.mjs",
        import.meta.url,
      ),
    ),
  );
  assert.equal(
    sha256(sourceV1),
    "c48c6692752550a547fa5936ab47c78170c6e33f0d8d527fe2d24c4ffc5e1276",
  );
  const sourceV2 = readFileSync(
    fileURLToPath(
      new URL(
        "../src/candidate/containment-guardian-journal-v2.mjs",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  for (const forbidden of [
    "node:fs",
    "node:child_process",
    "cgroup.kill",
    "cgroup.procs",
    "pidfd_open",
    "waitid(",
    "process.kill",
  ]) {
    assert.equal(sourceV2.includes(forbidden), false, forbidden);
  }
  assert.equal(
    Object.values(
      journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V2,
    ).every((value) => value === false),
    true,
  );
  assert.deepEqual(
    Object.entries(
      journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V2,
    ),
    EXPECTED_V2_NONCLAIMS,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2
      .reportedBootDigestComparisonProvesBootIdentity,
    false,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2
      .filesystemMechanicsImplemented,
    false,
  );
  assert.equal(
    journalV2.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2
      .recoveryMutationImplemented,
    false,
  );
  assert.deepEqual(candidateContainmentOwnerV2Readiness(), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.strictEqual(
    sandboxSessionV2ContainmentReadiness(),
    candidateContainmentOwnerV2Readiness(),
  );
  assert.equal(engineeringTaskIds.length, 9);
  assert.equal(commandIds().length, 33);
});
