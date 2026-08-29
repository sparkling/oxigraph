import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as lifetime from "../src/candidate/containment-guardian-lifetime-v1.mjs";

const ZERO_SHA256 = "0".repeat(64);
const MATRIX_SHA256 =
  "51433108d1ce01bb1492c01fd18140fe290782f4a54a31f7d2c80f8dae64d8ab";
const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-lifetime-v1.mjs",
  import.meta.url,
);
const EXACT_URL = new URL(
  "../src/candidate/containment-exact-v2.mjs",
  import.meta.url,
);
const ROUTING_URL = new URL("../src/routing/features.mjs", import.meta.url);

const SCHEMAS = Object.freeze({
  context: "oxigraph.candidate-containment-guardian-lifetime-context/v1",
  noChild:
    "oxigraph.candidate-containment-guardian-lifetime-no-child-launch-failure-projection/v1",
  target:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1",
  targetInventory:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-inventory-projection/v1",
  targetEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-event/v1",
  transition:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-projection/v1",
  transitionEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-chain-event/v1",
  anchor:
    "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1",
  anchorEvent:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-attempt-anchor-event/v1",
  externalHead: "oxigraph.candidate-containment-recovery-external-head/v1",
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((child) => canonicalJson(child)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function semanticSha256(value) {
  return sha256(canonicalJson(value));
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function withDigest(prefix, field) {
  return { ...prefix, [field]: semanticSha256(prefix) };
}

function artifact(record) {
  return { name: record.name, bytes: record.bytes };
}

function matrixRow(recordType, writerRule, targetRule, predecessorRule) {
  const row = Object.create(null);
  row.recordType = recordType;
  row.writerRule = writerRule;
  row.targetRule = targetRule;
  row.predecessorRule = predecessorRule;
  return Object.freeze(row);
}

const EXPECTED_RELATIONSHIP_MATRIX = Object.freeze([
  matrixRow(
    "NORMAL_LIFETIME_EPOCH_CONSUMED",
    "service manager; epoch = manager actor",
    "null",
    "sequence 1 of the sole NORMAL genesis segment; zero prior replay and all-zero record head",
  ),
  matrixRow(
    "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
    "service manager; epoch = manager actor",
    "null",
    "sequence 1 of a REBOOT_RECOVERY segment; previous complete-tail-matched nonclosed segment tuple equals the identity predecessor; that predecessor replay contains neither removal intent nor pathname absence; boot and lifetime epoch both differ",
  ),
  matrixRow(
    "LIFETIME_CGROUP_CREATE_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "segment epoch-consumed is the previous segment-wide event",
  ),
  matrixRow(
    "LIFETIME_CGROUP_CONFIGURED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "cgroup-create intent; evidence is the exact configured context",
  ),
  matrixRow(
    "GUARDIAN_LAUNCH_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "configured NORMAL context; no normal guardian launch event exists",
  ),
  matrixRow(
    "GUARDIAN_NOT_CREATED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists",
  ),
  matrixRow(
    "GUARDIAN_PIDFD_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian launch intent",
  ),
  matrixRow(
    "GUARDIAN_EXEC_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian pidfd observation",
  ),
  matrixRow(
    "GUARDIAN_MEMBERSHIP_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian exec observation",
  ),
  matrixRow(
    "GUARDIAN_INITIALIZATION_ADOPTED",
    "live-birth guardian; epoch = normal lifetime epoch",
    "null",
    "normal guardian membership observation",
  ),
  matrixRow(
    "GENERATION_RECOVERY_HEAD_DURABLE",
    "live-birth guardian with normal lifetime epoch after its exact initialization-adopted prefix, or service manager with manager epoch after normal-guardian terminal resolution or in a configured proved-reboot segment",
    "non-null",
    "target and generation identity absent from replay; target count below six and complete append reserve available; operation is the exact target-genesis event, whose reboot-transition chain is empty except for service-manager genesis after one or more proved-reboot segments; evidence is its sole genesis NO_RECOVERY_ATTEMPT head",
  ),
  matrixRow(
    "TARGET_REBOOT_TRANSITION_OBSERVED",
    "service manager; epoch = manager actor",
    "non-null existing target",
    "current reboot segment is configured; operation is the exact one-through-four transition-chain event covering every segment since the target's latest context; target has no transition ending at this segment; latest external head remains unchanged",
  ),
  matrixRow(
    "RECOVERY_ATTEMPT_ANCHOR_DURABLE",
    "initialized live-birth guardian with epoch = anchor actor and no not-created/termination/reboot supersession, or service manager with epoch = manager actor for a recovery-only anchor",
    "non-null existing target",
    "configured context; complete reboot-transition catch-up exists iff boot changed; no unresolved anchor; target nonterminal; attempt count below four; complete append reserve exists for the whole attempt/result/actor-resolution suffix; evidence is the exact anchor event",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "anchor target",
    "current anchor is recovery-only and has no launch event",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_PIDFD_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery launch intent",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_EXEC_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery guardian pidfd observation",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery guardian exec observation",
  ),
  matrixRow(
    "RECOVERY_ATTEMPT_RESULT_DURABLE",
    "matching initialized live-birth actor before termination/reboot; matching recovery-only actor only after its exact launch-intent/pidfd/exec/membership prefix and before not-created/termination/reboot; service manager for a recovery-only anchor after exact never-launched pre-temp ABSENT/PRESENT_EMPTY observation or recovery-guardian not-created; or service manager for either actor kind only after that actor's same-boot terminal resolution or configured target reboot supersession",
    "anchor target",
    "exact current anchor; result binds that anchor and recovery head; residue-free never-launched/not-created result is anchored-empty; launched result is structurally observed from the exact recovery ledger; temp/other residue rejects; a live-birth empty directory never grants the manager a direct pre-resolution result branch; after reboot, complete target catch-up and exact directory/ledger observation replace unobtainable old-boot process evidence without claiming reap or exit status",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_TERMINATION_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "any durable recovery launch-intent prefix; may follow its honest launch prefix or result; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence; occurs once",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_REAPED_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "termination observed and this manager retains exclusive direct-child wait authority",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "termination observed after manager replacement; direct-child wait authority is absent and no reap/exit-status claim is made",
  ),
  matrixRow(
    "NORMAL_CLOSE_RECEIPT_DURABLE",
    "service manager; epoch = manager actor",
    "non-null existing target",
    "target has its unique genesis head, zero attempts, no recovery terminal, and zero through four exact replay-derived transitions ending in the current configured context; evidence is the exact close-receipt projection replay will brand",
  ),
  matrixRow(
    "GUARDIAN_TERMINATION_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "any durable normal launch-intent prefix has terminated, independently of target terminality; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence",
  ),
  matrixRow(
    "GUARDIAN_REAPED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian termination observed and this manager retains exclusive direct-child wait authority",
  ),
  matrixRow(
    "GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian termination observed after manager replacement; no reap/exit-status claim",
  ),
  matrixRow(
    "LIFETIME_REMOVAL_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "every target is terminal; no anchor/result relationship is open; the current-segment normal guardian is not-created, reaped, parentage-lost, or absent because reboot superseded the prior actor; and every current-segment recovery launch is not-created or termination followed by reap or parentage-lost",
  ),
  matrixRow(
    "LIFETIME_PATH_ABSENT_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "lifetime removal intent",
  ),
  matrixRow(
    "LIFETIME_CLOSED_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "lifetime pathname absence observation; no successor in this segment",
  ),
]);

class AdversarialLifetimeFixture {
  constructor(label) {
    this.label = label;
    this.stateRootIdentitySha256 = digest(`${label}:state-root`);
    this.managerActorEpochSha256 = digest(`${label}:manager`);
    this.limitsSha256 = digest(`${label}:limits`);
    this.guardianExecutableIdentitySha256 = digest(`${label}:guardian`);
    this.guardianControlRequirementsSha256 = digest(`${label}:control`);
    this.segments = [];
    this.latestReplay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: [],
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256: null,
      expectedLatestRecordSequence: null,
      expectedLatestRecordRawSha256: null,
    });
    this.zeroReplay = this.latestReplay;
  }

  get currentSegment() {
    return this.segments.at(-1);
  }

  replay() {
    const tail = this.currentSegment.records.at(-1);
    this.latestReplay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: this.segments.map((segment) => ({
        lifetimeIdentity: segment.identity,
        records: segment.records.map(artifact),
      })),
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256:
        this.currentSegment.identity.lifetimeEpochSha256,
      expectedLatestRecordSequence: tail.sequence,
      expectedLatestRecordRawSha256: tail.rawSha256,
    });
    return this.latestReplay;
  }

  startNormal() {
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
        lifetimeKind: "NORMAL",
        stateRootIdentitySha256: this.stateRootIdentitySha256,
        managerActorEpochSha256: this.managerActorEpochSha256,
        bootIdSha256: digest(`${this.label}:boot:0`),
        delegatedRootIdentitySha256: digest(`${this.label}:root:0`),
        lifetimeEpochSha256: digest(`${this.label}:lifetime:0`),
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
    const predecessor = this.currentSegment;
    const predecessorTail = predecessor.records.at(-1);
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
        lifetimeKind: "REBOOT_RECOVERY",
        stateRootIdentitySha256: this.stateRootIdentitySha256,
        managerActorEpochSha256: this.managerActorEpochSha256,
        bootIdSha256: digest(`${this.label}:boot:${index}`),
        delegatedRootIdentitySha256: digest(`${this.label}:root:${index}`),
        lifetimeEpochSha256: digest(`${this.label}:lifetime:${index}`),
        limitsSha256: this.limitsSha256,
        guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
        guardianControlRequirementsSha256:
          this.guardianControlRequirementsSha256,
        previousLifetimeReplay: this.latestReplay,
      });
    this.segments.push({
      identity,
      records: [],
      context: null,
      predecessor: {
        bootIdSha256: predecessor.identity.bootIdSha256,
        delegatedRootIdentitySha256:
          predecessor.identity.delegatedRootIdentitySha256,
        lifetimeEpochSha256: predecessor.identity.lifetimeEpochSha256,
        lifetimeCgroupIdentitySha256:
          predecessor.context?.lifetimeCgroupIdentitySha256 ?? null,
        configured: predecessor.context !== null,
        recordRawSha256: predecessorTail.rawSha256,
      },
    });
    return identity;
  }

  append(recordType, options = {}) {
    const record = lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      previousLifetimeReplay:
        this.segments.length === 1 && this.currentSegment.records.length === 0
          ? this.zeroReplay
          : this.latestReplay,
      lifetimeIdentity: this.currentSegment.identity,
      writerKind: options.writerKind ?? "SERVICE_MANAGER",
      writerActorEpochSha256:
        options.writerActorEpochSha256 ?? this.managerActorEpochSha256,
      targetSha256: options.targetSha256 ?? null,
      recordType,
      operationBytes: jsonLine(
        options.operation ?? { schema: "oxigraph.test.opaque/v1" },
      ),
      evidenceBytes: jsonLine(
        options.evidence ?? { schema: "oxigraph.test.opaque/v1" },
      ),
    });
    this.currentSegment.records.push(record);
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

  configureCurrentSegment() {
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
    this.append("LIFETIME_CGROUP_CONFIGURED_OBSERVED", { evidence: context });
    this.currentSegment.context = context;
    return context;
  }

  resolveNormalAsNotCreated() {
    const launch = this.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
    const prefix = {
      schema: SCHEMAS.noChild,
      lifetimeIdentitySha256: this.currentSegment.identity.identitySha256,
      targetSha256: null,
      launchRecordRawSha256: launch.rawSha256,
      syscall: "clone3",
      resultClass: "DEFINITE_NO_CHILD",
      errnoName: "EAGAIN",
      reportedChildCreated: false,
      reportedPidfdReturned: false,
    };
    this.append("GUARDIAN_NOT_CREATED_OBSERVED", {
      evidence: withDigest(prefix, "projectionSha256"),
    });
  }

  addTarget() {
    const targetSha256 = digest(`${this.label}:target`);
    const identity = this.currentSegment.identity;
    const projectionPrefix = {
      schema: SCHEMAS.target,
      generationIdentitySha256: digest(`${this.label}:generation`),
      generationManifestRawSha256: digest(`${this.label}:manifest`),
      targetSha256,
      targetBootIdSha256: identity.bootIdSha256,
      targetDelegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      targetLifetimeEpochSha256: identity.lifetimeEpochSha256,
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
      provedRebootTransitions: [],
    };
    const headPrefix = {
      schema: SCHEMAS.externalHead,
      targetSha256,
      result: "NO_RECOVERY_ATTEMPT",
      recoveryActorEpochSha256: null,
      attemptDirectoryName: null,
      lifetimeAttemptAnchorRawSha256: null,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
    };
    const head = withDigest(headPrefix, "externalHeadSha256");
    const genesisRecord = this.append("GENERATION_RECOVERY_HEAD_DURABLE", {
      targetSha256,
      operation: withDigest(eventPrefix, "eventSha256"),
      evidence: head,
    });
    return {
      targetSha256,
      projection,
      genesisRecord,
      head,
      currentContext: this.currentSegment.context,
      currentAnchor: null,
    };
  }

  addAnchor(target, recoveryActorEpochSha256) {
    const projection = {
      schema: SCHEMAS.anchor,
      targetSha256: target.targetSha256,
      actorKind: "RECOVERY_ONLY_GUARDIAN",
      recoveryActorEpochSha256,
      attemptDirectoryName: recoveryActorEpochSha256,
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedCurrentBootIdSha256: target.currentContext.bootIdSha256,
      expectedDelegatedRootIdentitySha256:
        target.currentContext.delegatedRootIdentitySha256,
      expectedLifetimeCgroupIdentitySha256:
        target.currentContext.lifetimeCgroupIdentitySha256,
      previousRecoveryActorEpochSha256: target.head.recoveryActorEpochSha256,
      previousAttemptDirectoryName: target.head.attemptDirectoryName,
      previousRecoveryRecordSequence: target.head.latestRecoveryRecordSequence,
      previousRecoveryRecordRawSha256:
        target.head.latestRecoveryRecordRawSha256,
    };
    const eventPrefix = {
      schema: SCHEMAS.anchorEvent,
      predecessorExternalHead: target.head,
      anchorProjection: projection,
    };
    const record = this.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
      targetSha256: target.targetSha256,
      evidence: withDigest(eventPrefix, "eventSha256"),
    });
    target.currentAnchor = {
      projection,
      record,
      recoveryActorEpochSha256,
    };
    return target.currentAnchor;
  }

  appendAnchoredEmptyResult(target) {
    const anchor = target.currentAnchor;
    const prefix = {
      schema: SCHEMAS.externalHead,
      targetSha256: target.targetSha256,
      result: "ANCHORED_EMPTY_ATTEMPT",
      recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
      attemptDirectoryName: anchor.recoveryActorEpochSha256,
      lifetimeAttemptAnchorRawSha256: anchor.record.rawSha256,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
    };
    const head = withDigest(prefix, "externalHeadSha256");
    this.append("RECOVERY_ATTEMPT_RESULT_DURABLE", {
      targetSha256: target.targetSha256,
      evidence: head,
    });
    target.head = head;
  }

  transitionTarget(target) {
    const previous = this.currentSegment.predecessor;
    const identity = this.currentSegment.identity;
    const context = this.currentSegment.context;
    const transitionPrefix = {
      schema: SCHEMAS.transition,
      targetSha256: target.targetSha256,
      previousBootIdSha256: previous.bootIdSha256,
      previousDelegatedRootIdentitySha256: previous.delegatedRootIdentitySha256,
      previousSegmentConfigured: previous.configured,
      previousLifetimeCgroupIdentitySha256:
        previous.lifetimeCgroupIdentitySha256,
      previousLifetimeEpochSha256: previous.lifetimeEpochSha256,
      previousLifetimeRecordRawSha256: previous.recordRawSha256,
      currentBootIdSha256: identity.bootIdSha256,
      currentDelegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      currentSegmentConfigured: true,
      currentLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
      currentLifetimeEpochSha256: identity.lifetimeEpochSha256,
      reportedPreviousLifetimeCgroupAbsent: true,
      reportedControlCgroupAbsent: true,
      reportedJobCgroupAbsent: true,
    };
    const transition = withDigest(transitionPrefix, "transitionSha256");
    const eventPrefix = {
      schema: SCHEMAS.transitionEvent,
      targetSha256: target.targetSha256,
      transitions: [transition],
    };
    this.append("TARGET_REBOOT_TRANSITION_OBSERVED", {
      targetSha256: target.targetSha256,
      operation: withDigest(eventPrefix, "eventSha256"),
    });
    target.currentContext = context;
  }

  exactReplayInputWith(reference) {
    const record = this.currentSegment.records[0];
    return {
      segments: [
        {
          lifetimeIdentity: this.currentSegment.identity,
          records: [reference],
        },
      ],
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256:
        this.currentSegment.identity.lifetimeEpochSha256,
      expectedLatestRecordSequence: record.sequence,
      expectedLatestRecordRawSha256: record.rawSha256,
    };
  }
}

function bootstrapTarget(label) {
  const fixture = new AdversarialLifetimeFixture(label);
  fixture.startNormal();
  fixture.appendEpoch();
  fixture.configureCurrentSegment();
  fixture.resolveNormalAsNotCreated();
  return { fixture, target: fixture.addTarget() };
}

async function sourceText() {
  return readFile(SOURCE_URL, "utf8");
}

async function instrumentPrivateMatrix(source) {
  const instrumented = `${source
    .replace('"./containment-exact-v2.mjs"', JSON.stringify(EXACT_URL.href))
    .replace('"../routing/features.mjs"', JSON.stringify(ROUTING_URL.href))}
export { RECORD_TYPE_RELATIONSHIP_MATRIX_V1 as __relationshipMatrixV1 };\n`;
  return import(
    `data:text/javascript;base64,${Buffer.from(instrumented, "utf8").toString("base64")}`
  );
}

test("retains exactly the ratified 56 lifetime-v1 named exports", () => {
  assert.equal(Object.keys(lifetime).length, 56);
});

test("rejects a recovery actor equal to the target birth epoch", () => {
  const { fixture, target } = bootstrapTarget("actor-target-birth");
  assert.throws(() =>
    fixture.addAnchor(target, target.projection.targetLifetimeEpochSha256),
  );
});

test("rejects a recovery actor equal to the service-manager actor epoch", () => {
  const { fixture, target } = bootstrapTarget("actor-manager");
  assert.throws(() =>
    fixture.addAnchor(target, fixture.managerActorEpochSha256),
  );
});

test("rejects a recovery actor equal to the current reboot lifetime epoch", () => {
  const { fixture, target } = bootstrapTarget("actor-reboot-lifetime");
  fixture.startReboot();
  fixture.appendEpoch();
  fixture.configureCurrentSegment();
  fixture.transitionTarget(target);
  assert.throws(() =>
    fixture.addAnchor(
      target,
      fixture.currentSegment.identity.lifetimeEpochSha256,
    ),
  );
});

test("continues rejecting an actor epoch already consumed by an earlier anchor", () => {
  const { fixture, target } = bootstrapTarget("actor-prior-anchor");
  const actor = digest("actor-prior-anchor:actor");
  fixture.addAnchor(target, actor);
  fixture.appendAnchoredEmptyResult(target);
  assert.throws(() => fixture.addAnchor(target, actor));
});

test("rejects old recovery process launch in a new unconfigured reboot segment before target catch-up", () => {
  const { fixture, target } = bootstrapTarget("old-process-before-catchup");
  fixture.addAnchor(target, digest("old-process-before-catchup:actor"));
  fixture.startReboot();
  fixture.appendEpoch();
  assert.throws(() =>
    fixture.append("RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE", {
      targetSha256: target.targetSha256,
    }),
  );
});

test("derives the relationship-matrix digest without embedding its golden literal", async () => {
  const source = await sourceText();
  assert.equal(
    source.includes(MATRIX_SHA256),
    false,
    "production must compute the relationship-matrix digest instead of embedding the evaluator golden",
  );
});

test("owns a private independently computed frozen 29-row null-prototype relationship matrix", async () => {
  const source = await sourceText();
  assert.match(
    source,
    /const RECORD_TYPE_RELATIONSHIP_MATRIX_V1\s*=/u,
    "production must own the private RECORD_TYPE_RELATIONSHIP_MATRIX_V1 projection",
  );
  const instrumented = await instrumentPrivateMatrix(source);
  const matrix = instrumented.__relationshipMatrixV1;
  assert.equal(Object.isFrozen(matrix), true);
  assert.equal(matrix.length, 29);
  for (const row of matrix) {
    assert.equal(Object.getPrototypeOf(row), null);
    assert.equal(Object.isFrozen(row), true);
    assert.deepEqual(Object.keys(row), [
      "recordType",
      "writerRule",
      "targetRule",
      "predecessorRule",
    ]);
  }
  assert.deepEqual(matrix, EXPECTED_RELATIONSHIP_MATRIX);
  assert.equal(semanticSha256(matrix), MATRIX_SHA256);
  assert.equal(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1
      .recordTypeRelationshipMatrixSha256,
    semanticSha256(matrix),
  );
  assert.equal(Object.keys(lifetime).length, 56);
});

test("rejects a replay record-reference Proxy without invoking its traps", () => {
  const fixture = new AdversarialLifetimeFixture("record-reference-proxy");
  fixture.startNormal();
  const record = fixture.appendEpoch();
  const sentinel = new Error("record-reference Proxy trap was invoked");
  let trapCalls = 0;
  const reference = new Proxy(artifact(record), {
    ownKeys() {
      trapCalls += 1;
      throw sentinel;
    },
  });
  let thrown = null;
  try {
    lifetime.replayCandidateContainmentGuardianLifetimeV1(
      fixture.exactReplayInputWith(reference),
    );
  } catch (error) {
    thrown = error;
  }
  assert.notEqual(thrown, null);
  assert.notStrictEqual(
    thrown,
    sentinel,
    "replay must reject a Proxy intrinsically before invoking ownKeys",
  );
  assert.equal(trapCalls, 0);
});

test("rejects a replay Buffer with a poisoned own length accessor without invoking it", () => {
  const fixture = new AdversarialLifetimeFixture("poisoned-buffer-length");
  fixture.startNormal();
  const record = fixture.appendEpoch();
  const poisoned = Buffer.from(record.bytes);
  const sentinel = new Error("poisoned Buffer length accessor was invoked");
  let accessorCalls = 0;
  Object.defineProperty(poisoned, "length", {
    configurable: false,
    enumerable: false,
    get() {
      accessorCalls += 1;
      throw sentinel;
    },
  });
  let thrown = null;
  try {
    lifetime.replayCandidateContainmentGuardianLifetimeV1(
      fixture.exactReplayInputWith({ name: record.name, bytes: poisoned }),
    );
  } catch (error) {
    thrown = error;
  }
  assert.notEqual(thrown, null);
  assert.notStrictEqual(
    thrown,
    sentinel,
    "replay must reject an own length descriptor before ordinary property access",
  );
  assert.equal(accessorCalls, 0);
});
