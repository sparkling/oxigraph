import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as journal from "../src/candidate/containment-guardian-journal-v1.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment guardian journal v1/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
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
  return journal.createCandidateContainmentGuardianGenerationIdentityV1(
    identityInput(overrides),
  );
}

function createChain(identity = createIdentity(), options = {}) {
  const operationLabel = options.operationLabel ?? "operation";
  const evidenceLabel = options.evidenceLabel ?? "evidence";
  const records = [];
  let previousRecord = null;
  for (const [
    index,
    state,
  ] of journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.entries()) {
    const record = journal.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity: identity,
      state,
      actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
      operationProjectionSha256: digest(`${operationLabel}:${index + 1}`),
      evidenceProjectionSha256: digest(`${evidenceLabel}:${index + 1}`),
      previousRecord,
    });
    records.push(record);
    previousRecord = record;
  }
  return records;
}

function copyRecord(record) {
  return { name: record.name, bytes: record.bytes };
}

function replayInput(records, options = {}) {
  const generationIdentity =
    options.generationIdentity ??
    records[0]?.generationIdentity ??
    createIdentity();
  const last = records.at(-1);
  return {
    records: records.map(copyRecord),
    expectedGenerationIdentitySha256:
      options.expectedGenerationIdentitySha256 ??
      generationIdentity.identitySha256,
    expectedBirthGuardianEpochSha256:
      options.expectedBirthGuardianEpochSha256 ??
      generationIdentity.birthGuardianEpochSha256,
    expectedLatestRecordRawSha256: Object.hasOwn(
      options,
      "expectedLatestRecordRawSha256",
    )
      ? options.expectedLatestRecordRawSha256
      : last === undefined
        ? null
        : sha256(last.bytes),
    reportedCurrentBootIdSha256:
      options.reportedCurrentBootIdSha256 === undefined
        ? generationIdentity.bootIdSha256
        : options.reportedCurrentBootIdSha256,
  };
}

function renamed(sequence, bytes) {
  return {
    name: `${sequence}-${sha256(bytes)}.jsonl`,
    bytes,
  };
}

function mutateRecord(record, mutate) {
  const value = JSON.parse(record.bytes.toString("utf8"));
  mutate(value);
  const bytes = jsonLine(value);
  return renamed(value.sequence, bytes);
}

function projectionBinding(kind, value) {
  const projection = value[kind];
  const bindingSchema =
    kind === "operation"
      ? "oxigraph.candidate-containment-guardian-journal-operation-binding/v1"
      : "oxigraph.candidate-containment-guardian-journal-evidence-binding/v1";
  return sha256(
    Buffer.from(
      canonicalJson({
        schema: bindingSchema,
        projectionSchema: projection.schema,
        sequence: value.sequence,
        state: value.nextState,
        generationIdentitySha256: value.generationIdentity.identitySha256,
        actorGuardianEpochSha256: value.actorGuardianEpochSha256,
        previousRecordRawSha256: value.previousRecordRawSha256,
        reportedProjectionSha256: projection.reportedProjectionSha256,
      }),
      "utf8",
    ),
  );
}

test("freezes the exact pure journal requirements and generation identity", () => {
  assert.deepEqual(journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1, [
    "ADMISSION_INTENT_DURABLE",
    "CGROUP_EFFECT_INTENT_DURABLE",
    "CGROUPS_CONFIGURED_EMPTY_OBSERVED",
    "SUPERVISOR_LAUNCH_INTENT_DURABLE",
    "SUPERVISOR_EXEC_OBSERVED",
    "LAUNCHER_DESCRIPTOR_CLOSURE_OBSERVED",
    "PREFLIGHT_READY_OBSERVED",
    "DECISION_CANCEL_DURABLE",
    "CANCEL_WRITE_COMPLETED",
    "CANCELLED_WITHOUT_CLONE_OBSERVED",
    "SUPERVISOR_DONE_OBSERVED",
    "STATUS_EOF_OBSERVED",
    "SUPERVISOR_REAPED_OBSERVED",
    "CLEANUP_INTENT_DURABLE",
    "CGROUPS_QUIESCENT_OBSERVED",
    "CGROUPS_REMOVED_OBSERVED",
    "GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED",
    "CLOSED_DURABLE",
  ]);
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1,
    18,
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V1,
    16,
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1,
    "0".repeat(64),
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
    sha256(
      Buffer.from(
        canonicalJson(
          journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V1,
        ),
        "utf8",
      ),
    ),
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
    "e76b54712178631c51eb90a8c46ce0bae29b9a0d66b25ada937566d65cf91bb4",
  );

  const identity = createIdentity();
  assert.equal(Object.getPrototypeOf(identity), null);
  assert.equal(Object.isFrozen(identity), true);
  assert.match(identity.controlGenerationSha256, /^[0-9a-f]{64}$/u);
  assert.match(identity.jobGenerationSha256, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    identity.controlGenerationSha256,
    identity.jobGenerationSha256,
  );
  assert.equal(
    identity.guardianCgroupName,
    `guardian-${identity.birthGuardianEpochSha256}`,
  );
  assert.equal(
    identity.controlCgroupName,
    `ctl-${identity.controlGenerationSha256}`,
  );
  assert.equal(identity.jobCgroupName, `job-${identity.jobGenerationSha256}`);
  assert.match(identity.identitySha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    identity.controlGenerationSha256,
    "6edc335200be2d72228bf6c9f6a3c4e784c12e14702af3c8341f70689cccb7ba",
  );
  assert.equal(
    identity.jobGenerationSha256,
    "623a7df83b24f47bd2c7c41f71037bf0b239267187f4b4c731486f686ebd3aca",
  );
  assert.equal(
    identity.identitySha256,
    "b5aae62e1e0009be5f284e71beb113ac71cac2ae2f69ddcb9c8aa2aa5686933e",
  );
  assert.deepEqual(createIdentity(), identity);

  const changed = createIdentity({
    admissionGenerationSha256: digest("different-admission-generation"),
  });
  assert.notEqual(
    changed.controlGenerationSha256,
    identity.controlGenerationSha256,
  );
  assert.notEqual(changed.jobGenerationSha256, identity.jobGenerationSha256);
  assert.notEqual(changed.identitySha256, identity.identitySha256);

  const changedBirth = createIdentity({
    birthGuardianEpochSha256: digest("different-birth-guardian-epoch"),
  });
  assert.notEqual(
    changedBirth.controlGenerationSha256,
    identity.controlGenerationSha256,
  );
  assert.notEqual(
    changedBirth.jobGenerationSha256,
    identity.jobGenerationSha256,
  );
  assert.notEqual(changedBirth.identitySha256, identity.identitySha256);
});

test("constructs, verifies, and replays the complete canonical hash chain", () => {
  const identity = createIdentity();
  const records = createChain(identity);
  assert.equal(records.length, 18);
  assert.equal(
    records[0].rawSha256,
    "635002e2582fe449e874c02927f27dd37e2a9211748779f1ad969606494f300b",
  );
  assert.equal(
    records.at(-1).rawSha256,
    "e49db427e80468883d4caa6f9e656821d4f490650000ef651ff9db8e0395bb65",
  );

  for (const [index, record] of records.entries()) {
    const sequence = String(index + 1).padStart(16, "0");
    assert.match(
      record.name,
      new RegExp(`^${sequence}-[0-9a-f]{64}\\.jsonl$`, "u"),
    );
    assert.equal(record.rawSha256, sha256(record.bytes));
    const verified = journal.verifyCandidateContainmentGuardianJournalRecordV1(
      copyRecord(record),
    );
    assert.equal(verified.sequence, sequence);
    assert.equal(
      verified.nextState,
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[index],
    );
    assert.equal(verified.rawSha256, record.rawSha256);
    assert.equal(verified.hashChainValidated, false);
    assert.equal(
      verified.operation.schema,
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_OPERATION_SCHEMAS_V1[
        verified.nextState
      ],
    );
    assert.equal(
      verified.evidence.schema,
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_EVIDENCE_SCHEMAS_V1[
        verified.nextState
      ],
    );
    if (index === 0) {
      assert.equal(verified.priorState, null);
      assert.equal(
        verified.previousRecordRawSha256,
        journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1,
      );
    } else {
      assert.equal(
        verified.previousRecordRawSha256,
        records[index - 1].rawSha256,
      );
    }
  }

  const firstRead = records[0].bytes;
  firstRead.fill(0);
  assert.notEqual(records[0].bytes[0], 0);

  const replay = journal.replayCandidateContainmentGuardianJournalV1(
    replayInput(records.toReversed(), {
      generationIdentity: identity,
      expectedLatestRecordRawSha256: records.at(-1).rawSha256,
    }),
  );
  assert.equal(Object.getPrototypeOf(replay), null);
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(replay.status, "COMPLETE_RECORD_CHAIN_REPLAYED");
  assert.equal(replay.recordCount, 18);
  assert.equal(replay.chainComplete, true);
  assert.equal(replay.hashChainValidated, true);
  assert.equal(replay.reportedLatestState, "CLOSED_DURABLE");
  assert.equal(replay.reportedNextExpectedState, null);
  assert.equal(replay.recordAppendRequired, false);
  assert.equal(replay.physicalRecoveryRequired, null);
  assert.equal(replay.filesystemInventoryValidated, null);
  assert.equal(replay.journalDurabilityObserved, null);
  assert.equal(replay.suppliedBootDigestRelationship, "same-boot");
  assert.deepEqual(replay.generationIdentity, identity);
  assert.deepEqual(
    replay.authority,
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1,
  );
  assert.deepEqual(
    replay.nonclaims,
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V1,
  );
  assert.deepEqual(
    replay.physicalFacts,
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PHYSICAL_FACTS_V1,
  );
});

test("classifies every clean crash prefix as an incomplete reported chain", () => {
  const identity = createIdentity();
  const records = createChain(identity);
  for (let length = 1; length < records.length; length += 1) {
    const prefix = records.slice(0, length);
    const replay = journal.replayCandidateContainmentGuardianJournalV1(
      replayInput(prefix.toReversed(), {
        generationIdentity: identity,
        expectedLatestRecordRawSha256: prefix.at(-1).rawSha256,
      }),
    );
    assert.equal(replay.status, "VALID_RECORD_PREFIX_REPLAYED");
    assert.equal(replay.recordCount, length);
    assert.equal(replay.chainComplete, false);
    assert.equal(
      replay.reportedLatestState,
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[length - 1],
    );
    assert.equal(
      replay.reportedNextExpectedState,
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[length],
    );
    assert.equal(replay.recordAppendRequired, true);
    assert.equal(replay.physicalRecoveryRequired, null);
    assert.equal(
      Object.values(replay.authority).every((value) => value === false),
      true,
    );
    assert.equal(
      Object.values(replay.nonclaims).every((value) => value === false),
      true,
    );
    assert.equal(replay.physicalFacts.supervisorReaped, null);
    assert.equal(replay.physicalFacts.supervisorExitStatus, null);
    assert.equal(replay.physicalFacts.applicationResult, null);
    assert.equal(replay.physicalFacts.cleanupSafe, null);
    assert.equal(replay.physicalFacts.binding, null);
    assert.equal(replay.physicalFacts.physicalEligibility, false);
    assert.equal(replay.physicalFacts.finalDecisionEligibility, false);
  }
});

test("keeps boot comparison observational and non-authoritative", () => {
  const identity = createIdentity();
  const [first] = createChain(identity);
  const records = [first];
  assert.equal(
    journal.replayCandidateContainmentGuardianJournalV1(
      replayInput(records, {
        reportedCurrentBootIdSha256: identity.bootIdSha256,
      }),
    ).suppliedBootDigestRelationship,
    "same-boot",
  );
  assert.equal(
    journal.replayCandidateContainmentGuardianJournalV1(
      replayInput(records, {
        reportedCurrentBootIdSha256: digest("other-boot"),
      }),
    ).suppliedBootDigestRelationship,
    "different-boot",
  );
  assert.equal(
    journal.replayCandidateContainmentGuardianJournalV1(
      replayInput(records, { reportedCurrentBootIdSha256: null }),
    ).suppliedBootDigestRelationship,
    "unknown",
  );
});

test("rejects malformed framing, names, canonical bytes, and record fields", () => {
  const [record] = createChain();
  const sequence = record.name.slice(0, 16);
  const malformed = [
    record.bytes.subarray(0, record.bytes.length - 1),
    Buffer.concat([record.bytes.subarray(0, -1), Buffer.from("\r\n")]),
    Buffer.concat([record.bytes, Buffer.from("{}\n")]),
    Buffer.from([0xff, 0x0a]),
    Buffer.from(` ${record.bytes.toString("utf8")}`, "utf8"),
    Buffer.alloc(
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1 + 1,
      0x61,
    ),
  ];
  for (const bytes of malformed) {
    assert.throws(
      () =>
        journal.verifyCandidateContainmentGuardianJournalRecordV1(
          renamed(sequence, bytes),
        ),
      CONTRACT_ERROR,
    );
  }

  assert.throws(
    () =>
      journal.verifyCandidateContainmentGuardianJournalRecordV1({
        name: record.name.toUpperCase(),
        bytes: record.bytes,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.verifyCandidateContainmentGuardianJournalRecordV1({
        name: record.name.replace(/-[0-9a-f]{64}/u, `-${"0".repeat(64)}`),
        bytes: record.bytes,
      }),
    CONTRACT_ERROR,
  );

  for (const mutate of [
    (value) => {
      value.extra = false;
    },
    (value) => {
      delete value.operation;
    },
    (value) => {
      value.evidence.schema = "unknown/v1";
    },
    (value) => {
      value.operation.schema = "unknown/v1";
    },
    (value) => {
      value.operation.bindingSha256 = "0".repeat(64);
    },
    (value) => {
      value.recordType = "COMMIT";
    },
    (value) => {
      value.previousRecordRawSha256 = "f".repeat(64);
    },
  ]) {
    const changed = mutateRecord(record, mutate);
    assert.throws(
      () => journal.verifyCandidateContainmentGuardianJournalRecordV1(changed),
      CONTRACT_ERROR,
    );
  }
});

test("rejects gaps, duplicate successors, content swaps, and identity drift", () => {
  const records = createChain();
  const input = (values) =>
    replayInput(values, { generationIdentity: records[0].generationIdentity });

  assert.throws(
    () => journal.replayCandidateContainmentGuardianJournalV1(input([])),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        input([records[0], records[2]]),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        input([records[0], records[1], records[1]]),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(
          [
            copyRecord(records[0]),
            { name: records[1].name, bytes: records[2].bytes },
          ],
          {
            generationIdentity: records[0].generationIdentity,
            reportedCurrentBootIdSha256: null,
          },
        ),
      ),
    CONTRACT_ERROR,
  );

  const driftIdentity = createIdentity({
    requestSha256: digest("drift-request"),
  });
  const drifted = mutateRecord(records[1], (value) => {
    value.generationIdentity = driftIdentity;
  });
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput([records[0], drifted], {
          generationIdentity: records[0].generationIdentity,
          reportedCurrentBootIdSha256: null,
        }),
      ),
    CONTRACT_ERROR,
  );

  const alternateSecond =
    journal.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity: records[0].generationIdentity,
      state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[1],
      actorGuardianEpochSha256:
        records[0].generationIdentity.birthGuardianEpochSha256,
      operationProjectionSha256: digest("alternate-operation"),
      evidenceProjectionSha256: digest("alternate-evidence"),
      previousRecord: records[0],
    });
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(
          [
            copyRecord(records[0]),
            copyRecord(records[1]),
            copyRecord(alternateSecond),
          ],
          {
            generationIdentity: records[0].generationIdentity,
            reportedCurrentBootIdSha256: null,
          },
        ),
      ),
    CONTRACT_ERROR,
  );
});

test("requires generation, birth-epoch, and optional raw-head anchors", () => {
  const identityA = createIdentity();
  const recordsA = createChain(identityA);
  const identityB = createIdentity({
    requestSha256: digest("generation-b"),
    birthGuardianEpochSha256: digest("birth-guardian-b"),
  });
  const recordsB = createChain(identityB);

  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(recordsB, {
          generationIdentity: identityB,
          expectedGenerationIdentitySha256: identityA.identitySha256,
        }),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(recordsB, {
          generationIdentity: identityB,
          expectedBirthGuardianEpochSha256: identityA.birthGuardianEpochSha256,
        }),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(recordsA, {
          expectedLatestRecordRawSha256: digest("wrong-head"),
        }),
      ),
    CONTRACT_ERROR,
  );

  const reauthored = createChain(identityA, {
    operationLabel: "reauthored-operation",
  });
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(reauthored, {
          expectedLatestRecordRawSha256: recordsA.at(-1).rawSha256,
        }),
      ),
    CONTRACT_ERROR,
  );

  const unheaded = journal.replayCandidateContainmentGuardianJournalV1(
    replayInput(recordsA, { expectedLatestRecordRawSha256: null }),
  );
  assert.equal(unheaded.latestRawRecordAnchorMatched, null);
  assert.equal(unheaded.physicalRecoveryRequired, null);
  assert.equal(unheaded.nonclaims.suppliedAnchorsProveTrustedOrigin, false);
});

test("binds reported operation and evidence projections to each exact state", () => {
  const identity = createIdentity();
  const sharedOperationProjectionSha256 = digest("shared-operation-projection");
  const first = journal.createCandidateContainmentGuardianJournalRecordV1({
    generationIdentity: identity,
    state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[0],
    actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
    operationProjectionSha256: sharedOperationProjectionSha256,
    evidenceProjectionSha256: digest("first-evidence"),
    previousRecord: null,
  });
  const second = journal.createCandidateContainmentGuardianJournalRecordV1({
    generationIdentity: identity,
    state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[1],
    actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
    operationProjectionSha256: sharedOperationProjectionSha256,
    evidenceProjectionSha256: digest("second-evidence"),
    previousRecord: first,
  });
  assert.equal(
    first.operation.reportedProjectionSha256,
    second.operation.reportedProjectionSha256,
  );
  assert.notEqual(first.operation.schema, second.operation.schema);
  assert.notEqual(
    first.operation.bindingSha256,
    second.operation.bindingSha256,
  );

  const replay = journal.replayCandidateContainmentGuardianJournalV1(
    replayInput([first, second]),
  );
  assert.equal(replay.hashChainValidated, true);
  assert.equal(replay.nonclaims.reportedOperationProjectionProvesEffect, false);
  assert.equal(
    replay.nonclaims.reportedEvidenceProjectionProvesObservation,
    false,
  );
});

test("rejects a correctly rehashed record with the wrong predecessor", () => {
  const records = createChain();
  const wrongPredecessor = mutateRecord(records[1], (value) => {
    value.previousRecordRawSha256 = digest("wrong-predecessor");
    value.operation.bindingSha256 = projectionBinding("operation", value);
    value.evidence.bindingSha256 = projectionBinding("evidence", value);
  });
  assert.equal(
    journal.verifyCandidateContainmentGuardianJournalRecordV1(wrongPredecessor)
      .hashChainValidated,
    false,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput([records[0], wrongPredecessor], {
          generationIdentity: records[0].generationIdentity,
        }),
      ),
    CONTRACT_ERROR,
  );
});

test("rejects invalid transitions, actor substitution, and append after close", () => {
  const identity = createIdentity();
  const records = createChain(identity);
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianJournalRecordV1({
        generationIdentity: identity,
        state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[1],
        actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
        operationProjectionSha256: digest("skip-operation"),
        evidenceProjectionSha256: digest("skip-evidence"),
        previousRecord: null,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianJournalRecordV1({
        generationIdentity: identity,
        state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[0],
        actorGuardianEpochSha256: digest("replacement-actor"),
        operationProjectionSha256: digest("actor-operation"),
        evidenceProjectionSha256: digest("actor-evidence"),
        previousRecord: null,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianJournalRecordV1({
        generationIdentity: identity,
        state: "CLOSED_DURABLE",
        actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
        operationProjectionSha256: digest("append-operation"),
        evidenceProjectionSha256: digest("append-evidence"),
        previousRecord: records.at(-1),
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianJournalRecordV1({
        generationIdentity: createIdentity({
          requestSha256: digest("other-request"),
        }),
        state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[1],
        actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
        operationProjectionSha256: digest("drift-operation"),
        evidenceProjectionSha256: digest("drift-evidence"),
        previousRecord: records[0],
      }),
    CONTRACT_ERROR,
  );
});

test("rejects proxy, accessor, sparse, symbol, and foreign-prototype inputs", () => {
  const base = identityInput();
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianGenerationIdentityV1(
        new Proxy(base, {}),
      ),
    CONTRACT_ERROR,
  );
  const accessor = { ...base };
  Object.defineProperty(accessor, "requestSha256", {
    enumerable: true,
    get: () => base.requestSha256,
  });
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianGenerationIdentityV1(accessor),
    CONTRACT_ERROR,
  );
  const symbol = { ...base, [Symbol("hidden")]: false };
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianGenerationIdentityV1(symbol),
    CONTRACT_ERROR,
  );
  const foreign = Object.assign(Object.create({ inherited: true }), base);
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianGenerationIdentityV1(foreign),
    CONTRACT_ERROR,
  );

  const identity = createIdentity();
  const records = new Array(1);
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(records, {
          generationIdentity: identity,
          reportedCurrentBootIdSha256: null,
        }),
      ),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1({
        records: new Proxy([], {}),
        expectedGenerationIdentitySha256: identity.identitySha256,
        expectedBirthGuardianEpochSha256: identity.birthGuardianEpochSha256,
        expectedLatestRecordRawSha256: null,
        reportedCurrentBootIdSha256: null,
      }),
    CONTRACT_ERROR,
  );
});

test("rejects unknown fields, invalid digests, mutable byte tricks, and overflow", () => {
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianGenerationIdentityV1({
        ...identityInput(),
        unexpected: false,
      }),
    CONTRACT_ERROR,
  );
  const missing = identityInput();
  delete missing.launchNonceSha256;
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianGenerationIdentityV1(missing),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      createIdentity({
        bootIdSha256: digest("boot-id").toUpperCase(),
      }),
    CONTRACT_ERROR,
  );

  const identity = createIdentity();
  assert.throws(
    () =>
      journal.createCandidateContainmentGuardianJournalRecordV1({
        generationIdentity: identity,
        state: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[0],
        actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
        operationProjectionSha256: "0",
        evidenceProjectionSha256: digest("evidence"),
        previousRecord: null,
      }),
    CONTRACT_ERROR,
  );

  const [record] = createChain(identity);
  assert.throws(
    () =>
      journal.verifyCandidateContainmentGuardianJournalRecordV1({
        name: record.name,
        bytes: new Proxy(record.bytes, {}),
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      journal.verifyCandidateContainmentGuardianJournalRecordV1({
        name: record.name,
        bytes: new Uint8Array(record.bytes),
      }),
    CONTRACT_ERROR,
  );

  const overflow = Array.from(
    {
      length: journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1 + 1,
    },
    () => copyRecord(record),
  );
  assert.throws(
    () =>
      journal.replayCandidateContainmentGuardianJournalV1(
        replayInput(overflow, {
          generationIdentity: identity,
          reportedCurrentBootIdSha256: null,
        }),
      ),
    CONTRACT_ERROR,
  );
});

test("keeps the pure contract free of filesystem and process mechanics", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        "../src/candidate/containment-guardian-journal-v1.mjs",
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
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V1
      .filesystemMechanicsImplemented,
    false,
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V1
      .recoveryMutationImplemented,
    false,
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V1
      .guardianImplemented,
    false,
  );
});

test("has no commit, clone, filesystem, cgroup, or runtime authority surface", () => {
  const exportedNames = Object.keys(journal).map((name) => name.toLowerCase());
  assert.equal(
    exportedNames.some((name) => name.includes("commit")),
    false,
  );
  assert.equal(
    exportedNames.some((name) => name.includes("clone")),
    false,
  );
  assert.deepEqual(
    Object.keys(
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1,
    ).sort(),
    [
      "mayAcceptApplicationResult",
      "mayIssueApplicationReceipt",
      "mayMutateDelegatedCgroup",
      "mayMutateStateFilesystem",
      "mayPromote",
      "mayPublish",
      "mayQualify",
      "mayReapSupervisor",
      "mayRegisterRuntime",
      "maySignalPersistedPid",
      "mayWriteSupervisorCommand",
      "productionContainment",
    ],
  );
  assert.deepEqual(
    Object.keys(
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V1,
    ).sort(),
    [
      "completeRecordChainProvesOperationalRecoveryClearance",
      "reportedEvidenceProjectionProvesObservation",
      "reportedOperationProjectionProvesEffect",
      "serializedActorDigestProvesProcessContinuity",
      "serializedReplayGrantsRecoveryMutationAuthority",
      "serializedReplayProvesApplicationResult",
      "serializedReplayProvesCgroupCleanup",
      "serializedReplayProvesCgroupConfiguration",
      "serializedReplayProvesCompleteFilesystemInventory",
      "serializedReplayProvesDelegatedRootIdentity",
      "serializedReplayProvesDirectChildReap",
      "serializedReplayProvesExclusiveStateRootLock",
      "serializedReplayProvesFilesystemDurability",
      "serializedReplayProvesFreshRandomness",
      "serializedReplayProvesFreshness",
      "serializedReplayProvesGuardianExecution",
      "serializedReplayProvesGuardianLiveness",
      "serializedReplayProvesGuardianParentage",
      "serializedReplayProvesRecordOrigin",
      "serializedReplayProvesRuntimeClosure",
      "serializedReplayProvesStateFilesystemMetadata",
      "serializedReplayProvesSupervisorExecution",
      "serializedReplayProvesSupervisorExitStatus",
      "suppliedAnchorsProveTrustedOrigin",
    ],
  );
  assert.equal(
    Object.values(
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1,
    ).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(
      journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V1,
    ).every((value) => value === false),
    true,
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1
      .mayIssueApplicationReceipt,
    false,
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1.mayPublish,
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
  assert.equal(
    commandIds().some((id) => id.includes("g2.2")),
    false,
  );
});
