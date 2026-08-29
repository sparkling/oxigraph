import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as lifetime from "../src/candidate/containment-guardian-lifetime-v1.mjs";

const ZERO_SHA256 = "0".repeat(64);

// These are evaluator-owned contract literals. They are intentionally not
// imported from the candidate module under test.
const SCHEMAS = Object.freeze({
  record: "oxigraph.candidate-containment-guardian-lifetime-record/v1",
  context: "oxigraph.candidate-containment-guardian-lifetime-context/v1",
  noChild:
    "oxigraph.candidate-containment-guardian-lifetime-no-child-launch-failure-projection/v1",
  partialLaunch:
    "oxigraph.candidate-containment-guardian-lifetime-partial-launch-resolution-projection/v1",
  targetProjection:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1",
  targetInventory:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-inventory-projection/v1",
  targetEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-event/v1",
  transition:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-projection/v1",
  anchorProjection:
    "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1",
  anchorEvent:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-attempt-anchor-event/v1",
  externalHead: "oxigraph.candidate-containment-recovery-external-head/v1",
  closeReceipt:
    "oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1",
});

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite test value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError("non-JSON test value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function opaque(label) {
  return {
    schema: "oxigraph.test.containment-guardian-lifetime-adversarial/v1",
    label,
    detailSha256: digest(`detail:${label}`),
  };
}

function withDigest(fields, digestField) {
  return { ...fields, [digestField]: semanticSha256(fields) };
}

function artifact(record) {
  return { name: record.name, bytes: record.bytes };
}

function segmentFact(segment) {
  return {
    bootIdSha256: segment.identity.bootIdSha256,
    delegatedRootIdentitySha256: segment.identity.delegatedRootIdentitySha256,
    configured: segment.context !== null,
    lifetimeCgroupIdentitySha256:
      segment.context?.lifetimeCgroupIdentitySha256 ?? null,
    lifetimeEpochSha256: segment.identity.lifetimeEpochSha256,
    recordRawSha256: segment.records.at(-1).rawSha256,
  };
}

function externalHead(fields) {
  return withDigest(
    { schema: SCHEMAS.externalHead, ...fields },
    "externalHeadSha256",
  );
}

class AdversarialLifetimeFixture {
  constructor(label) {
    this.label = label;
    this.stateRootIdentitySha256 = digest(`${label}:state-root`);
    this.managerActorEpochSha256 = digest(`${label}:manager`);
    this.limitsSha256 = digest(`${label}:limits`);
    this.guardianExecutableIdentitySha256 = digest(`${label}:guardian-exe`);
    this.guardianControlRequirementsSha256 = digest(
      `${label}:guardian-control`,
    );
    this.segments = [];
    this.targetIndex = 0;
    this.actorIndex = 0;
    this.zeroReplay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: [],
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256: null,
      expectedLatestRecordSequence: null,
      expectedLatestRecordRawSha256: null,
    });
    this.latestReplay = this.zeroReplay;
  }

  get currentSegment() {
    return this.segments.at(-1);
  }

  startNormal() {
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
        lifetimeKind: "NORMAL",
        stateRootIdentitySha256: this.stateRootIdentitySha256,
        managerActorEpochSha256: this.managerActorEpochSha256,
        bootIdSha256: digest(`${this.label}:boot:0`),
        delegatedRootIdentitySha256: digest(`${this.label}:delegated:0`),
        lifetimeEpochSha256: digest(`${this.label}:epoch:0`),
        limitsSha256: this.limitsSha256,
        guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
        guardianControlRequirementsSha256:
          this.guardianControlRequirementsSha256,
        previousLifetimeReplay: this.zeroReplay,
      });
    this.segments.push({ identity, records: [], context: null });
    return identity;
  }

  startReboot() {
    const index = this.segments.length;
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
        lifetimeKind: "REBOOT_RECOVERY",
        stateRootIdentitySha256: this.stateRootIdentitySha256,
        managerActorEpochSha256: this.managerActorEpochSha256,
        bootIdSha256: digest(`${this.label}:boot:${index}`),
        delegatedRootIdentitySha256: digest(`${this.label}:delegated:${index}`),
        lifetimeEpochSha256: digest(`${this.label}:epoch:${index}`),
        limitsSha256: this.limitsSha256,
        guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
        guardianControlRequirementsSha256:
          this.guardianControlRequirementsSha256,
        previousLifetimeReplay: this.latestReplay,
      });
    this.segments.push({ identity, records: [], context: null });
    return identity;
  }

  replay() {
    const latestRecord = this.currentSegment.records.at(-1);
    this.latestReplay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: this.segments.map((segment) => ({
        lifetimeIdentity: segment.identity,
        records: segment.records.map(artifact),
      })),
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256:
        this.currentSegment.identity.lifetimeEpochSha256,
      expectedLatestRecordSequence: latestRecord.sequence,
      expectedLatestRecordRawSha256: latestRecord.rawSha256,
    });
    return this.latestReplay;
  }

  append(recordType, options = {}) {
    const segment = this.currentSegment;
    const previousLifetimeReplay =
      this.segments.length === 1 && segment.records.length === 0
        ? this.zeroReplay
        : this.latestReplay;
    const writerKind = options.writerKind ?? "SERVICE_MANAGER";
    const record = lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      previousLifetimeReplay,
      lifetimeIdentity: segment.identity,
      writerKind,
      writerActorEpochSha256:
        options.writerActorEpochSha256 ?? this.managerActorEpochSha256,
      targetSha256: options.targetSha256 ?? null,
      recordType,
      operationBytes: jsonLine(
        options.operation ?? opaque(`${this.label}:${recordType}:operation`),
      ),
      evidenceBytes: jsonLine(
        options.evidence ?? opaque(`${this.label}:${recordType}:evidence`),
      ),
    });
    segment.records.push(record);
    this.replay();
    return record;
  }

  appendEpoch() {
    return this.append(
      this.currentSegment.identity.lifetimeKind === "NORMAL"
        ? "NORMAL_LIFETIME_EPOCH_CONSUMED"
        : "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
    );
  }

  appendConfigured() {
    this.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
    const identity = this.currentSegment.identity;
    const prefix = {
      schema: SCHEMAS.context,
      lifetimeIdentitySha256: identity.identitySha256,
      stateRootIdentitySha256: identity.stateRootIdentitySha256,
      bootIdSha256: identity.bootIdSha256,
      delegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      lifetimeCgroupIdentitySha256: digest(
        `${this.label}:cgroup:${this.segments.length - 1}`,
      ),
    };
    const context = withDigest(prefix, "contextSha256");
    const record = this.append("LIFETIME_CGROUP_CONFIGURED_OBSERVED", {
      evidence: context,
    });
    this.currentSegment.context = context;
    return record;
  }

  appendNormalAdoption() {
    this.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
    this.append("GUARDIAN_PIDFD_OBSERVED");
    this.append("GUARDIAN_EXEC_OBSERVED");
    this.append("GUARDIAN_MEMBERSHIP_OBSERVED");
    return this.append("GUARDIAN_INITIALIZATION_ADOPTED", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256: this.currentSegment.identity.lifetimeEpochSha256,
    });
  }

  partialLaunchEvidence(launchRecord, targetSha256 = null) {
    const prefix = {
      schema: SCHEMAS.partialLaunch,
      lifetimeIdentitySha256: this.currentSegment.identity.identitySha256,
      targetSha256,
      launchRecordRawSha256: launchRecord.rawSha256,
      reportedStateRootLockReacquired: true,
      reportedPriorManagerAbsent: true,
      reportedLifetimeCgroupIdentitySha256:
        this.currentSegment.context.lifetimeCgroupIdentitySha256,
      reportedLifetimeCgroupEmpty: true,
    };
    return withDigest(prefix, "projectionSha256");
  }

  noChildEvidence(launchRecord, targetSha256 = null) {
    const prefix = {
      schema: SCHEMAS.noChild,
      lifetimeIdentitySha256: this.currentSegment.identity.identitySha256,
      targetSha256,
      launchRecordRawSha256: launchRecord.rawSha256,
      syscall: "clone3",
      resultClass: "DEFINITE_NO_CHILD",
      errnoName: "EAGAIN",
      reportedChildCreated: false,
      reportedPidfdReturned: false,
    };
    return withDigest(prefix, "projectionSha256");
  }

  appendNormalNoChild() {
    const launch = this.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
    this.append("GUARDIAN_NOT_CREATED_OBSERVED", {
      evidence: this.noChildEvidence(launch),
    });
    return launch;
  }

  appendNormalTermination() {
    this.append("GUARDIAN_TERMINATION_OBSERVED");
    this.append("GUARDIAN_REAPED_OBSERVED");
  }

  targetCandidate({ writerKind, transitions = [] } = {}) {
    const index = this.targetIndex;
    const targetSha256 = digest(`${this.label}:target:${index}`);
    const generationIdentitySha256 = digest(
      `${this.label}:generation:${index}`,
    );
    const origin = transitions[0]
      ? {
          bootIdSha256: transitions[0].previousBootIdSha256,
          delegatedRootIdentitySha256:
            transitions[0].previousDelegatedRootIdentitySha256,
          lifetimeEpochSha256: transitions[0].previousLifetimeEpochSha256,
        }
      : this.currentSegment.identity;
    const projectionPrefix = {
      schema: SCHEMAS.targetProjection,
      generationIdentitySha256,
      generationManifestRawSha256: digest(`${this.label}:manifest:${index}`),
      targetSha256,
      targetBootIdSha256: origin.bootIdSha256,
      targetDelegatedRootIdentitySha256: origin.delegatedRootIdentitySha256,
      targetLifetimeEpochSha256: origin.lifetimeEpochSha256,
      latestBundleSequence: null,
      latestBundleRawSha256: null,
      latestInnerRecordRawSha256: null,
      latestNormalState: null,
    };
    const projection = withDigest(projectionPrefix, "projectionSha256");
    const inventoryPrefix = {
      schema: SCHEMAS.targetInventory,
      targetSha256,
      reportedRecoveryDirectoryPresent: true,
      reportedRecoveryDirectoryEntryCount: 0,
      reportedExistingLifetimeTargetHead: false,
    };
    const inventory = withDigest(inventoryPrefix, "inventorySha256");
    const eventPrefix = {
      schema: SCHEMAS.targetEvent,
      recoveryTargetProjection: projection,
      targetGenesisInventory: inventory,
      provedRebootTransitions: transitions,
    };
    const event = withDigest(eventPrefix, "eventSha256");
    const head = externalHead({
      targetSha256,
      result: "NO_RECOVERY_ATTEMPT",
      recoveryActorEpochSha256: null,
      attemptDirectoryName: null,
      lifetimeAttemptAnchorRawSha256: null,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
    });
    const selectedWriter =
      writerKind ??
      (this.currentSegment.identity.lifetimeKind === "NORMAL"
        ? "LIVE_BIRTH_GUARDIAN"
        : "SERVICE_MANAGER");
    return {
      target: {
        targetSha256,
        generationIdentitySha256,
        projection,
        head,
        currentContext: this.currentSegment.context,
      },
      appendOptions: {
        writerKind: selectedWriter,
        writerActorEpochSha256:
          selectedWriter === "LIVE_BIRTH_GUARDIAN"
            ? this.currentSegment.identity.lifetimeEpochSha256
            : this.managerActorEpochSha256,
        targetSha256,
        operation: event,
        evidence: head,
      },
    };
  }

  addTarget(options = {}) {
    const candidate = this.targetCandidate(options);
    const record = this.append(
      "GENERATION_RECOVERY_HEAD_DURABLE",
      candidate.appendOptions,
    );
    this.targetIndex += 1;
    candidate.target.genesisRecord = record;
    return candidate.target;
  }

  appendNormalClose(target) {
    return this.append("NORMAL_CLOSE_RECEIPT_DURABLE", {
      targetSha256: target.targetSha256,
      evidence: {
        schema: SCHEMAS.closeReceipt,
        targetSha256: target.targetSha256,
        sourceLocation: "active",
        destinationLocation: "closed",
        activeParentSynced: true,
        closedParentSynced: true,
        closedLocationReobserved: true,
      },
    });
  }

  addRecoveryAnchor(target) {
    const actor = digest(`${this.label}:recovery-actor:${this.actorIndex}`);
    const previous = target.head;
    const projection = {
      schema: SCHEMAS.anchorProjection,
      targetSha256: target.targetSha256,
      actorKind: "RECOVERY_ONLY_GUARDIAN",
      recoveryActorEpochSha256: actor,
      attemptDirectoryName: actor,
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedCurrentBootIdSha256: target.currentContext.bootIdSha256,
      expectedDelegatedRootIdentitySha256:
        target.currentContext.delegatedRootIdentitySha256,
      expectedLifetimeCgroupIdentitySha256:
        target.currentContext.lifetimeCgroupIdentitySha256,
      previousRecoveryActorEpochSha256: previous.recoveryActorEpochSha256,
      previousAttemptDirectoryName: previous.attemptDirectoryName,
      previousRecoveryRecordSequence: previous.latestRecoveryRecordSequence,
      previousRecoveryRecordRawSha256: previous.latestRecoveryRecordRawSha256,
    };
    const eventPrefix = {
      schema: SCHEMAS.anchorEvent,
      predecessorExternalHead: previous,
      anchorProjection: projection,
    };
    const event = withDigest(eventPrefix, "eventSha256");
    const record = this.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
      targetSha256: target.targetSha256,
      evidence: event,
    });
    this.actorIndex += 1;
    target.currentAnchor = { actor, projection, record };
    return target.currentAnchor;
  }

  appendAnchoredEmptyManagerResult(target) {
    const anchor = target.currentAnchor;
    const head = externalHead({
      targetSha256: target.targetSha256,
      result: "ANCHORED_EMPTY_ATTEMPT",
      recoveryActorEpochSha256: anchor.actor,
      attemptDirectoryName: anchor.actor,
      lifetimeAttemptAnchorRawSha256: anchor.record.rawSha256,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
    });
    const record = this.append("RECOVERY_ATTEMPT_RESULT_DURABLE", {
      targetSha256: target.targetSha256,
      evidence: head,
    });
    target.head = head;
    return record;
  }

  appendRecoveryLaunch(target) {
    const launch = this.append("RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE", {
      targetSha256: target.targetSha256,
    });
    target.currentAnchor.launchRecord = launch;
    return launch;
  }

  appendRecoveryNoChild(target) {
    return this.append("RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED", {
      targetSha256: target.targetSha256,
      evidence: this.noChildEvidence(
        target.currentAnchor.launchRecord,
        target.targetSha256,
      ),
    });
  }
}

function bootstrapConfigured(label) {
  const fixture = new AdversarialLifetimeFixture(label);
  fixture.startNormal();
  fixture.appendEpoch();
  fixture.appendConfigured();
  return fixture;
}

function bootstrapAdopted(label) {
  const fixture = bootstrapConfigured(label);
  fixture.appendNormalAdoption();
  return fixture;
}

function bootstrapNoChild(label) {
  const fixture = bootstrapConfigured(label);
  fixture.appendNormalNoChild();
  return fixture;
}

function transitionValue({ targetSha256, previous, current }) {
  const prefix = {
    schema: SCHEMAS.transition,
    targetSha256,
    previousBootIdSha256: previous.bootIdSha256,
    previousDelegatedRootIdentitySha256: previous.delegatedRootIdentitySha256,
    previousSegmentConfigured: previous.configured,
    previousLifetimeCgroupIdentitySha256: previous.lifetimeCgroupIdentitySha256,
    previousLifetimeEpochSha256: previous.lifetimeEpochSha256,
    previousLifetimeRecordRawSha256: previous.recordRawSha256,
    currentBootIdSha256: current.bootIdSha256,
    currentDelegatedRootIdentitySha256: current.delegatedRootIdentitySha256,
    currentSegmentConfigured: current.configured,
    currentLifetimeCgroupIdentitySha256: current.lifetimeCgroupIdentitySha256,
    currentLifetimeEpochSha256: current.lifetimeEpochSha256,
    reportedPreviousLifetimeCgroupAbsent: true,
    reportedControlCgroupAbsent: true,
    reportedJobCgroupAbsent: true,
  };
  return withDigest(prefix, "transitionSha256");
}

test("should reject normal launch progress after terminal reap", () => {
  const fixture = bootstrapConfigured("adversarial-normal-after-reap");
  const launch = fixture.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
  fixture.append("GUARDIAN_TERMINATION_OBSERVED", {
    evidence: fixture.partialLaunchEvidence(launch),
  });
  fixture.append("GUARDIAN_REAPED_OBSERVED");

  assert.throws(() => fixture.append("GUARDIAN_PIDFD_OBSERVED"));
});

test("should reject a recovery launch after its durable result", () => {
  const fixture = bootstrapAdopted("adversarial-launch-after-result");
  const target = fixture.addTarget();
  fixture.appendNormalTermination();
  fixture.addRecoveryAnchor(target);
  fixture.appendAnchoredEmptyManagerResult(target);

  assert.throws(() => {
    fixture.appendRecoveryLaunch(target);
    fixture.appendRecoveryNoChild(target);
  });
});

test("should reject target genesis after lifetime removal intent", () => {
  const fixture = bootstrapNoChild("adversarial-target-after-removal");
  fixture.append("LIFETIME_REMOVAL_INTENT_DURABLE");

  let targetGenesisError = null;
  let laterCloseError = null;
  try {
    fixture.addTarget({ writerKind: "SERVICE_MANAGER" });
  } catch (error) {
    targetGenesisError = error;
  }
  if (targetGenesisError === null) {
    try {
      fixture.append("LIFETIME_PATH_ABSENT_OBSERVED");
      fixture.append("LIFETIME_CLOSED_DURABLE");
    } catch (error) {
      laterCloseError = error;
    }
  }

  assert.notEqual(
    targetGenesisError,
    null,
    `target genesis was admitted after removal; later close error=${String(laterCloseError)} status=${fixture.latestReplay.status}`,
  );
});

test("should reject reboot target genesis that skips historical normal context", () => {
  const fixture = bootstrapNoChild("adversarial-skipped-target-origin");
  fixture.startReboot();
  fixture.appendEpoch();
  fixture.startReboot();
  fixture.appendEpoch();
  fixture.appendConfigured();

  const targetSha256 = digest(`${fixture.label}:target:0`);
  const skippedNormalTransition = transitionValue({
    targetSha256,
    previous: segmentFact(fixture.segments.at(-2)),
    current: segmentFact(fixture.currentSegment),
  });

  assert.throws(() =>
    fixture.addTarget({
      writerKind: "SERVICE_MANAGER",
      transitions: [skippedNormalTransition],
    }),
  );
});

test("should preserve configured supersession through a later reboot epoch", () => {
  const fixture = bootstrapConfigured("adversarial-supersession-reopen");
  fixture.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
  fixture.startReboot();
  fixture.appendEpoch();
  fixture.appendConfigured();
  assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");

  fixture.startReboot();
  fixture.appendEpoch();

  assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");
});

test("should reject exhausted target capacity before record canonicalization", () => {
  const fixture = bootstrapAdopted("adversarial-reserve-order");
  for (let index = 0; index < 6; index += 1) {
    fixture.appendNormalClose(fixture.addTarget());
  }
  const seventh = fixture.targetCandidate();

  const originalStringify = JSON.stringify;
  const canonicalizationSentinel = new Error(
    "record canonicalization occurred before capacity rejection",
  );
  let sentinelObserved = false;
  let rejection = null;
  JSON.stringify = function instrumentedStringify(value, ...rest) {
    if (value === SCHEMAS.record) {
      sentinelObserved = true;
      throw canonicalizationSentinel;
    }
    return Reflect.apply(originalStringify, JSON, [value, ...rest]);
  };
  try {
    fixture.append("GENERATION_RECOVERY_HEAD_DURABLE", seventh.appendOptions);
  } catch (error) {
    rejection = error;
  } finally {
    JSON.stringify = originalStringify;
  }

  assert.deepEqual(
    {
      rejected: rejection !== null,
      rejectedByCapacity: rejection !== canonicalizationSentinel,
      recordCanonicalizationObserved: sentinelObserved,
    },
    {
      rejected: true,
      rejectedByCapacity: true,
      recordCanonicalizationObserved: false,
    },
  );
});

test("should reject a normal manager/lifetime epoch collision at both identity boundaries", () => {
  const fixture = new AdversarialLifetimeFixture(
    "adversarial-normal-identity-role-collision",
  );
  const collidingEpochSha256 = digest(
    "adversarial-normal-identity-role-collision:epoch",
  );
  const input = {
    lifetimeKind: "NORMAL",
    stateRootIdentitySha256: fixture.stateRootIdentitySha256,
    managerActorEpochSha256: collidingEpochSha256,
    bootIdSha256: digest("adversarial-normal-identity-role-collision:boot"),
    delegatedRootIdentitySha256: digest(
      "adversarial-normal-identity-role-collision:delegated-root",
    ),
    lifetimeEpochSha256: collidingEpochSha256,
    limitsSha256: fixture.limitsSha256,
    guardianExecutableIdentitySha256: fixture.guardianExecutableIdentitySha256,
    guardianControlRequirementsSha256:
      fixture.guardianControlRequirementsSha256,
    previousLifetimeReplay: fixture.zeroReplay,
  };
  const identityPrefix = {
    schema: "oxigraph.candidate-containment-guardian-lifetime-identity/v1",
    lifetimeKind: input.lifetimeKind,
    stateRootIdentitySha256: input.stateRootIdentitySha256,
    managerActorEpochSha256: input.managerActorEpochSha256,
    bootIdSha256: input.bootIdSha256,
    delegatedRootIdentitySha256: input.delegatedRootIdentitySha256,
    lifetimeEpochSha256: input.lifetimeEpochSha256,
    lifetimeCgroupName: `guardian-${input.lifetimeEpochSha256}`,
    limitsSha256: input.limitsSha256,
    guardianExecutableIdentitySha256: input.guardianExecutableIdentitySha256,
    guardianControlRequirementsSha256: input.guardianControlRequirementsSha256,
    previousLifetimeEpochSha256: null,
    previousLifetimeRecordSequence: null,
    previousLifetimeRecordRawSha256: ZERO_SHA256,
  };
  const identity = {
    ...identityPrefix,
    identitySha256: semanticSha256(identityPrefix),
  };
  const rejected = (operation) => {
    try {
      operation();
      return false;
    } catch {
      return true;
    }
  };

  assert.deepEqual(
    {
      createRejected: rejected(() =>
        lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(input),
      ),
      verifyRejected: rejected(() =>
        lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
          identity,
          previousLifetimeReplay: fixture.zeroReplay,
        }),
      ),
    },
    { createRejected: true, verifyRejected: true },
  );
});

test("should reject a reboot lifetime epoch reused from a prior anchor at both identity boundaries", () => {
  const fixture = bootstrapAdopted(
    "adversarial-reboot-identity-anchor-collision",
  );
  const target = fixture.addTarget();
  fixture.appendNormalTermination();
  const anchor = fixture.addRecoveryAnchor(target);
  const previousIdentity = fixture.currentSegment.identity;
  const previousRecord = fixture.currentSegment.records.at(-1);
  const input = {
    lifetimeKind: "REBOOT_RECOVERY",
    stateRootIdentitySha256: fixture.stateRootIdentitySha256,
    managerActorEpochSha256: fixture.managerActorEpochSha256,
    bootIdSha256: digest(
      "adversarial-reboot-identity-anchor-collision:new-boot",
    ),
    delegatedRootIdentitySha256: digest(
      "adversarial-reboot-identity-anchor-collision:new-delegated-root",
    ),
    lifetimeEpochSha256: anchor.actor,
    limitsSha256: fixture.limitsSha256,
    guardianExecutableIdentitySha256: fixture.guardianExecutableIdentitySha256,
    guardianControlRequirementsSha256:
      fixture.guardianControlRequirementsSha256,
    previousLifetimeReplay: fixture.latestReplay,
  };
  const identityPrefix = {
    schema: "oxigraph.candidate-containment-guardian-lifetime-identity/v1",
    lifetimeKind: input.lifetimeKind,
    stateRootIdentitySha256: input.stateRootIdentitySha256,
    managerActorEpochSha256: input.managerActorEpochSha256,
    bootIdSha256: input.bootIdSha256,
    delegatedRootIdentitySha256: input.delegatedRootIdentitySha256,
    lifetimeEpochSha256: input.lifetimeEpochSha256,
    lifetimeCgroupName: `guardian-${input.lifetimeEpochSha256}`,
    limitsSha256: input.limitsSha256,
    guardianExecutableIdentitySha256: input.guardianExecutableIdentitySha256,
    guardianControlRequirementsSha256: input.guardianControlRequirementsSha256,
    previousLifetimeEpochSha256: previousIdentity.lifetimeEpochSha256,
    previousLifetimeRecordSequence: previousRecord.sequence,
    previousLifetimeRecordRawSha256: previousRecord.rawSha256,
  };
  const identity = {
    ...identityPrefix,
    identitySha256: semanticSha256(identityPrefix),
  };
  const rejected = (operation) => {
    try {
      operation();
      return false;
    } catch {
      return true;
    }
  };

  assert.deepEqual(
    {
      createRejected: rejected(() =>
        lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(input),
      ),
      verifyRejected: rejected(() =>
        lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
          identity,
          previousLifetimeReplay: fixture.latestReplay,
        }),
      ),
    },
    { createRejected: true, verifyRejected: true },
  );
});
