import { createHash } from "node:crypto";

import * as journalV1 from "../src/candidate/containment-guardian-journal-v1.mjs";
import * as journalV2 from "../src/candidate/containment-guardian-journal-v2.mjs";
import * as lifetime from "../src/candidate/containment-guardian-lifetime-v1.mjs";
import { exactRecord as exactRecordUnderNoSortProbe } from "../src/candidate/containment-exact-v2.mjs";

export const ZERO_SHA256 = "0".repeat(64);

export function probeExactRecordNoSortContractV1() {
  const objectCreate = Object.create;
  const objectDefineProperty = Object.defineProperty;
  const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const objectGetPrototypeOf = Object.getPrototypeOf;
  const reflectApply = Reflect.apply;
  const reflectOwnKeys = Reflect.ownKeys;
  const arrayPush = Array.prototype.push;
  const patched = [
    [Array.prototype, "at"],
    [Array.prototype, "concat"],
    [Array.prototype, "copyWithin"],
    [Array.prototype, "entries"],
    [Array.prototype, "every"],
    [Array.prototype, "fill"],
    [Array.prototype, "filter"],
    [Array.prototype, "find"],
    [Array.prototype, "findIndex"],
    [Array.prototype, "findLast"],
    [Array.prototype, "findLastIndex"],
    [Array.prototype, "flatMap"],
    [Array.prototype, "forEach"],
    [Array.prototype, "includes"],
    [Array.prototype, "indexOf"],
    [Array.prototype, "join"],
    [Array.prototype, "keys"],
    [Array.prototype, "lastIndexOf"],
    [Array.prototype, "map"],
    [Array.prototype, "pop"],
    [Array.prototype, "push"],
    [Array.prototype, "reduce"],
    [Array.prototype, "reduceRight"],
    [Array.prototype, "reverse"],
    [Array.prototype, "shift"],
    [Array.prototype, "slice"],
    [Array.prototype, "some"],
    [Array.prototype, "sort"],
    [Array.prototype, "splice"],
    [Array.prototype, "toReversed"],
    [Array.prototype, "toSorted"],
    [Array.prototype, "toSpliced"],
    [Array.prototype, "unshift"],
    [Array.prototype, "values"],
    [Array.prototype, "with"],
    [Array.prototype, Symbol.iterator],
    [Array, "isArray"],
    [Object, "assign"],
    [Object, "create"],
    [Object, "defineProperty"],
    [Object, "entries"],
    [Object, "fromEntries"],
    [Object, "getOwnPropertyDescriptor"],
    [Object, "hasOwn"],
    [Object, "keys"],
    [Object, "values"],
    [Object, "getOwnPropertyDescriptors"],
    [Object, "getPrototypeOf"],
    [Reflect, "ownKeys"],
  ].map(([owner, key]) => [
    owner,
    key,
    objectGetOwnPropertyDescriptor(owner, key),
  ]);
  const sentinel = new Error("dynamic inspection or sorting escaped capture");
  let dynamicIntrinsicHits = 0;
  const normalizedValues = [];
  let proxyTrapHits = 0;
  let proxyRejected = false;
  let getterHits = 0;
  let accessorRejected = false;
  let duplicateExpectedRejected = false;
  const fail = () => {
    throw new TypeError("exact record-reference preflight rejected");
  };
  const permutations = [
    ["name", "bytes"],
    ["bytes", "name"],
  ];
  try {
    for (let patchIndex = 0; patchIndex < patched.length; patchIndex += 1) {
      const patch = patched[patchIndex];
      const owner = patch[0];
      const key = patch[1];
      const descriptor = patch[2];
      if (descriptor === undefined) continue;
      objectDefineProperty(owner, key, {
        ...descriptor,
        value() {
          dynamicIntrinsicHits += 1;
          throw sentinel;
        },
      });
    }
    for (
      let permutationIndex = 0;
      permutationIndex < permutations.length;
      permutationIndex += 1
    ) {
      const keys = permutations[permutationIndex];
      const input = objectCreate(null);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex];
        input[key] =
          key === "name"
            ? `0000000000000001-${"0".repeat(64)}.jsonl`
            : Buffer.from("{}\n", "utf8");
      }
      try {
        reflectApply(arrayPush, normalizedValues, [
          {
            input,
            normalized: exactRecordUnderNoSortProbe(
              input,
              ["name", "bytes"],
              "record reference",
              fail,
            ),
          },
        ]);
      } catch {}
    }

    const proxy = new Proxy(objectCreate(null), {
      defineProperty() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      deleteProperty() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      get() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      getOwnPropertyDescriptor() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      getPrototypeOf() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      has() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      isExtensible() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      ownKeys() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      preventExtensions() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      set() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      setPrototypeOf() {
        proxyTrapHits += 1;
        throw sentinel;
      },
    });
    try {
      exactRecordUnderNoSortProbe(
        proxy,
        ["name", "bytes"],
        "record reference",
        fail,
      );
    } catch {
      proxyRejected = true;
    }

    const accessor = objectCreate(null);
    objectDefineProperty(accessor, "name", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: `0000000000000001-${"0".repeat(64)}.jsonl`,
    });
    objectDefineProperty(accessor, "bytes", {
      configurable: true,
      enumerable: true,
      get() {
        getterHits += 1;
        throw sentinel;
      },
    });
    try {
      exactRecordUnderNoSortProbe(
        accessor,
        ["name", "bytes"],
        "record reference",
        fail,
      );
    } catch {
      accessorRejected = true;
    }
  } finally {
    for (
      let patchIndex = patched.length - 1;
      patchIndex >= 0;
      patchIndex -= 1
    ) {
      const patch = patched[patchIndex];
      const owner = patch[0];
      const key = patch[1];
      const descriptor = patch[2];
      if (descriptor !== undefined)
        objectDefineProperty(owner, key, descriptor);
    }
  }
  const duplicateExpectedInput = objectCreate(null);
  duplicateExpectedInput.name = `0000000000000001-${"0".repeat(64)}.jsonl`;
  duplicateExpectedInput.bytes = Buffer.from("{}\n", "utf8");
  try {
    exactRecordUnderNoSortProbe(
      duplicateExpectedInput,
      ["name", "bytes", "bytes"],
      "record reference",
      fail,
    );
  } catch {
    duplicateExpectedRejected = true;
  }
  return Object.freeze({
    acceptedPermutationCount: normalizedValues.length,
    normalizedKeyOrders: Object.freeze(
      normalizedValues.map(({ normalized }) =>
        Object.freeze(reflectOwnKeys(normalized)),
      ),
    ),
    normalizedPrototypesAreNull: normalizedValues.every(
      ({ normalized }) => objectGetPrototypeOf(normalized) === null,
    ),
    normalizedValuesRetainIdentity: normalizedValues.every(
      ({ input, normalized }) =>
        normalized.name === input.name && normalized.bytes === input.bytes,
    ),
    proxyRejected,
    proxyTrapHits,
    accessorRejected,
    getterHits,
    duplicateExpectedRejected,
    dynamicIntrinsicHits,
  });
}

export const FIXTURE_SCHEMAS = Object.freeze({
  lifetimeContext:
    "oxigraph.candidate-containment-guardian-lifetime-context/v1",
  targetGenesisInventory:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-inventory-projection/v1",
  targetGenesisEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-event/v1",
  anchorProjection:
    "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1",
  anchorEvent:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-attempt-anchor-event/v1",
  rebootTransition:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-projection/v1",
  rebootTransitionChainEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-chain-event/v1",
  externalHead: "oxigraph.candidate-containment-recovery-external-head/v1",
  normalCloseReceipt:
    "oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1",
});

export function canonicalJson(value, ancestors = new WeakSet()) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("non-finite fixture number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("non-canonical fixture value");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.keys(value).join("\0") !==
        value.map((_, index) => String(index)).join("\0")
      ) {
        throw new TypeError("non-dense fixture array");
      }
      return `[${value.map((child) => canonicalJson(child, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("foreign fixture prototype");
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

export function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

export function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function artifact(value) {
  return { name: value.name, bytes: value.bytes };
}

export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, plain(child)]),
    );
  }
  return value;
}

export function opaque(label) {
  return {
    schema: "oxigraph.test.candidate-containment-recovery-payload/v1",
    label,
    detailSha256: digest(`payload:${label}`),
  };
}

function projection(kind, state, sequence, identity, label) {
  const value = {
    schema: `oxigraph.candidate-containment-guardian-${kind}-projection/${state
      .toLowerCase()
      .replaceAll("_", "-")}/v2`,
    sequence: String(sequence).padStart(16, "0"),
    state,
    generationIdentitySha256: identity.identitySha256,
    detailSha256: digest(`${label}:${kind}:${sequence}:${state}`),
  };
  return {
    value,
    bytes: jsonLine(value),
    semanticSha256: semanticSha256(value),
  };
}

export function createJournalStack(label, bundleCount = 0) {
  const bootIdSha256 = digest(`${label}:boot`);
  const delegatedRootIdentitySha256 = digest(`${label}:delegated-root`);
  const birthGuardianEpochSha256 = digest(`${label}:birth-guardian`);
  const generationIdentity =
    journalV1.createCandidateContainmentGuardianGenerationIdentityV1({
      requestSha256: digest(`${label}:request`),
      ownerRequestSha256: digest(`${label}:owner-request`),
      limitsSha256: digest(`${label}:limits`),
      delegatedRootIdentitySha256,
      launchCapsuleRawSha256: digest(`${label}:launch-capsule-raw`),
      launchCapsuleProjectionSha256: digest(
        `${label}:launch-capsule-projection`,
      ),
      bootstrapRequirementsSha256: digest(`${label}:bootstrap-requirements`),
      launchRequirementsSha256: digest(`${label}:launch-requirements`),
      supervisorExecutableIdentitySha256: digest(
        `${label}:supervisor-executable`,
      ),
      birthGuardianEpochSha256,
      bootIdSha256,
      admissionGenerationSha256: digest(`${label}:admission-generation`),
      launchNonceSha256: digest(`${label}:launch-nonce`),
    });
  const generationManifest =
    journalV2.createCandidateContainmentGuardianGenerationManifestV2({
      generationIdentity,
    });
  const normalJournalBundles = [];
  const normalJournalRecords = [];
  let previousRecord = null;
  let previousBundle = null;
  const states = journalV1.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1;
  for (const [index, state] of states.slice(0, bundleCount).entries()) {
    const sequence = index + 1;
    const operation = projection(
      "operation",
      state,
      sequence,
      generationIdentity,
      label,
    );
    const evidence = projection(
      "evidence",
      state,
      sequence,
      generationIdentity,
      label,
    );
    const record = journalV1.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity,
      state,
      actorGuardianEpochSha256: birthGuardianEpochSha256,
      operationProjectionSha256: operation.semanticSha256,
      evidenceProjectionSha256: evidence.semanticSha256,
      previousRecord,
    });
    const bundle = journalV2.createCandidateContainmentGuardianJournalBundleV2({
      journalRecord: artifact(record),
      operationBytes: operation.bytes,
      evidenceBytes: evidence.bytes,
      previousBundle,
    });
    normalJournalBundles.push(bundle);
    normalJournalRecords.push(record);
    previousRecord = record;
    previousBundle = bundle;
  }
  return {
    label,
    bootIdSha256,
    delegatedRootIdentitySha256,
    birthGuardianEpochSha256,
    generationIdentity,
    generationManifest,
    normalJournalRecords,
    normalJournalBundles,
  };
}

export function forkJournalBundleChain(journal, forkIndex, variant) {
  if (
    !Number.isSafeInteger(forkIndex) ||
    forkIndex < 0 ||
    forkIndex >= journal.normalJournalBundles.length
  ) {
    throw new TypeError("fixture fork index is outside the journal chain");
  }
  const bundles = journal.normalJournalBundles.slice(0, forkIndex);
  let previousRecord = journal.normalJournalRecords[forkIndex - 1] ?? null;
  let previousBundle = bundles.at(-1) ?? null;
  const states = journalV1.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1;
  for (
    let index = forkIndex;
    index < journal.normalJournalBundles.length;
    index++
  ) {
    const sequence = index + 1;
    const state = states[index];
    const operation = projection(
      "operation",
      state,
      sequence,
      journal.generationIdentity,
      `${journal.label}:fork:${variant}`,
    );
    const evidence = projection(
      "evidence",
      state,
      sequence,
      journal.generationIdentity,
      `${journal.label}:fork:${variant}`,
    );
    const record = journalV1.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity: journal.generationIdentity,
      state,
      actorGuardianEpochSha256: journal.birthGuardianEpochSha256,
      operationProjectionSha256: operation.semanticSha256,
      evidenceProjectionSha256: evidence.semanticSha256,
      previousRecord,
    });
    const bundle = journalV2.createCandidateContainmentGuardianJournalBundleV2({
      journalRecord: artifact(record),
      operationBytes: operation.bytes,
      evidenceBytes: evidence.bytes,
      previousBundle,
    });
    bundles.push(bundle);
    previousRecord = record;
    previousBundle = bundle;
  }
  return bundles;
}

// This oracle derives the recovery target from evaluator-created manifest and
// bundle artifacts without calling recovery-v1. The journal-v2 chain itself is
// verified independently by the production-facing tests; this helper does not
// claim to be a second general-purpose journal-v2 verifier.
export function independentlyDeriveRecoveryTargetFromFixtureArtifacts(journal) {
  const manifestBytes = journal.generationManifest.bytes;
  const manifestValue = JSON.parse(manifestBytes.toString("utf8"));
  if (!jsonLine(manifestValue).equals(manifestBytes)) {
    throw new Error("fixture generation manifest is not canonical JSONL");
  }
  const identity = plain(manifestValue.generationIdentity);
  const latest = journal.normalJournalBundles.at(-1) ?? null;
  let latestValue = null;
  if (latest !== null) {
    const latestBytes = latest.bytes;
    latestValue = JSON.parse(latestBytes.toString("utf8"));
    if (!jsonLine(latestValue).equals(latestBytes)) {
      throw new Error("fixture latest journal bundle is not canonical JSONL");
    }
  }
  const targetPrefix = {
    schema: "oxigraph.candidate-containment-recovery-target/v1",
    generationManifestRawSha256: sha256(manifestBytes),
    generationIdentity: identity,
    generationIdentitySha256: identity.identitySha256,
    birthGuardianEpochSha256: identity.birthGuardianEpochSha256,
    bootIdSha256: identity.bootIdSha256,
    admissionGenerationSha256: identity.admissionGenerationSha256,
    controlGenerationSha256: identity.controlGenerationSha256,
    jobGenerationSha256: identity.jobGenerationSha256,
    latestBundleSequence: latestValue?.sequence ?? null,
    latestBundleRawSha256: latest === null ? null : sha256(latest.bytes),
    latestInnerRecordRawSha256:
      latestValue?.innerJournalRecord.rawSha256 ?? null,
    latestNormalState: latestValue?.nextState ?? null,
  };
  const target = {
    ...targetPrefix,
    targetSha256: semanticSha256(targetPrefix),
  };
  const projectionPrefix = {
    schema:
      "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1",
    generationIdentitySha256: target.generationIdentitySha256,
    generationManifestRawSha256: target.generationManifestRawSha256,
    targetSha256: target.targetSha256,
    targetBootIdSha256: target.bootIdSha256,
    targetDelegatedRootIdentitySha256:
      target.generationIdentity.delegatedRootIdentitySha256,
    targetLifetimeEpochSha256: target.birthGuardianEpochSha256,
    latestBundleSequence: target.latestBundleSequence,
    latestBundleRawSha256: target.latestBundleRawSha256,
    latestInnerRecordRawSha256: target.latestInnerRecordRawSha256,
    latestNormalState: target.latestNormalState,
  };
  const projection = {
    ...projectionPrefix,
    projectionSha256: semanticSha256(projectionPrefix),
  };
  return { target, projection };
}

function digested(schema, fields, digestField) {
  const value = { schema, ...fields };
  value[digestField] = semanticSha256(value);
  return value;
}

export function recoveryExternalHead(fields) {
  return digested(FIXTURE_SCHEMAS.externalHead, fields, "externalHeadSha256");
}

export class RecoveryLifetimeFixture {
  constructor(label = "recovery", { bundleCount = 0 } = {}) {
    this.label = label;
    this.journal = createJournalStack(label, bundleCount);
    this.stateRootIdentitySha256 = digest(`${label}:state-root`);
    this.managerActorEpochSha256 = digest(`${label}:manager`);
    this.limitsSha256 = digest(`${label}:lifetime-limits`);
    this.guardianExecutableIdentitySha256 = digest(
      `${label}:guardian-executable`,
    );
    this.guardianControlRequirementsSha256 = digest(
      `${label}:guardian-control-requirements`,
    );
    this.segments = [];
    this.anchorIndex = 0;
    this.zeroLifetimeReplay =
      lifetime.replayCandidateContainmentGuardianLifetimeV1({
        segments: [],
        expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
        expectedLatestLifetimeEpochSha256: null,
        expectedLatestRecordSequence: null,
        expectedLatestRecordRawSha256: null,
      });
    this.lifetimeIdentity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
        lifetimeKind: "NORMAL",
        stateRootIdentitySha256: this.stateRootIdentitySha256,
        managerActorEpochSha256: this.managerActorEpochSha256,
        bootIdSha256: this.journal.bootIdSha256,
        delegatedRootIdentitySha256: this.journal.delegatedRootIdentitySha256,
        lifetimeEpochSha256: this.journal.birthGuardianEpochSha256,
        limitsSha256: this.limitsSha256,
        guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
        guardianControlRequirementsSha256:
          this.guardianControlRequirementsSha256,
        previousLifetimeReplay: this.zeroLifetimeReplay,
      });
    this.records = [];
    this.segments.push({
      identity: this.lifetimeIdentity,
      records: this.records,
      context: null,
    });
    this.latestLifetimeReplay = this.zeroLifetimeReplay;
    this.appendLifetime("NORMAL_LIFETIME_EPOCH_CONSUMED");
    this.appendLifetime("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
    const contextPrefix = {
      schema: FIXTURE_SCHEMAS.lifetimeContext,
      lifetimeIdentitySha256: this.lifetimeIdentity.identitySha256,
      stateRootIdentitySha256: this.stateRootIdentitySha256,
      bootIdSha256: this.journal.bootIdSha256,
      delegatedRootIdentitySha256: this.journal.delegatedRootIdentitySha256,
      lifetimeCgroupIdentitySha256: digest(`${label}:lifetime-cgroup`),
    };
    this.lifetimeContext = {
      ...contextPrefix,
      contextSha256: semanticSha256(contextPrefix),
    };
    this.segments.at(-1).context = this.lifetimeContext;
    this.appendLifetime("LIFETIME_CGROUP_CONFIGURED_OBSERVED", {
      evidence: this.lifetimeContext,
    });
    this.appendLifetime("GUARDIAN_LAUNCH_INTENT_DURABLE");
    this.appendLifetime("GUARDIAN_PIDFD_OBSERVED");
    this.appendLifetime("GUARDIAN_EXEC_OBSERVED");
    this.appendLifetime("GUARDIAN_MEMBERSHIP_OBSERVED");
    this.appendLifetime("GUARDIAN_INITIALIZATION_ADOPTED", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256: this.lifetimeIdentity.lifetimeEpochSha256,
    });
  }

  replayLifetime() {
    const latest = this.records.at(-1);
    this.latestLifetimeReplay =
      lifetime.replayCandidateContainmentGuardianLifetimeV1({
        segments: this.segments.map((segment) => ({
          lifetimeIdentity: segment.identity,
          records: segment.records.map(artifact),
        })),
        expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
        expectedLatestLifetimeEpochSha256:
          this.lifetimeIdentity.lifetimeEpochSha256,
        expectedLatestRecordSequence: latest.sequence,
        expectedLatestRecordRawSha256: latest.rawSha256,
      });
    return this.latestLifetimeReplay;
  }

  appendLifetime(recordType, options = {}) {
    const previousLifetimeReplay = this.latestLifetimeReplay;
    const record = lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      previousLifetimeReplay,
      lifetimeIdentity: this.lifetimeIdentity,
      writerKind: options.writerKind ?? "SERVICE_MANAGER",
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
    this.records.push(record);
    this.replayLifetime();
    return record;
  }

  startRebootRecovery() {
    const previousIdentity = this.lifetimeIdentity;
    const previousContext = this.lifetimeContext;
    const previousRecord = this.records.at(-1);
    const segmentIndex = this.segments.length;
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
        lifetimeKind: "REBOOT_RECOVERY",
        stateRootIdentitySha256: this.stateRootIdentitySha256,
        managerActorEpochSha256: this.managerActorEpochSha256,
        bootIdSha256: digest(`${this.label}:reboot:${segmentIndex}:boot`),
        delegatedRootIdentitySha256: digest(
          `${this.label}:reboot:${segmentIndex}:delegated-root`,
        ),
        lifetimeEpochSha256: digest(
          `${this.label}:reboot:${segmentIndex}:lifetime-epoch`,
        ),
        limitsSha256: this.limitsSha256,
        guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
        guardianControlRequirementsSha256:
          this.guardianControlRequirementsSha256,
        previousLifetimeReplay: this.latestLifetimeReplay,
      });
    this.lifetimeIdentity = identity;
    this.records = [];
    this.segments.push({ identity, records: this.records, context: null });
    this.appendLifetime("REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED");
    this.appendLifetime("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
    const contextPrefix = {
      schema: FIXTURE_SCHEMAS.lifetimeContext,
      lifetimeIdentitySha256: identity.identitySha256,
      stateRootIdentitySha256: this.stateRootIdentitySha256,
      bootIdSha256: identity.bootIdSha256,
      delegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      lifetimeCgroupIdentitySha256: digest(
        `${this.label}:reboot:${segmentIndex}:lifetime-cgroup`,
      ),
    };
    this.lifetimeContext = {
      ...contextPrefix,
      contextSha256: semanticSha256(contextPrefix),
    };
    this.segments.at(-1).context = this.lifetimeContext;
    this.appendLifetime("LIFETIME_CGROUP_CONFIGURED_OBSERVED", {
      evidence: this.lifetimeContext,
    });

    const transitionPrefix = {
      schema: FIXTURE_SCHEMAS.rebootTransition,
      targetSha256: this.target.targetSha256,
      previousBootIdSha256: previousIdentity.bootIdSha256,
      previousDelegatedRootIdentitySha256:
        previousIdentity.delegatedRootIdentitySha256,
      previousSegmentConfigured: true,
      previousLifetimeCgroupIdentitySha256:
        previousContext.lifetimeCgroupIdentitySha256,
      previousLifetimeEpochSha256: previousIdentity.lifetimeEpochSha256,
      previousLifetimeRecordRawSha256: previousRecord.rawSha256,
      currentBootIdSha256: identity.bootIdSha256,
      currentDelegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      currentSegmentConfigured: true,
      currentLifetimeCgroupIdentitySha256:
        this.lifetimeContext.lifetimeCgroupIdentitySha256,
      currentLifetimeEpochSha256: identity.lifetimeEpochSha256,
      reportedPreviousLifetimeCgroupAbsent: true,
      reportedControlCgroupAbsent: true,
      reportedJobCgroupAbsent: true,
    };
    const transition = {
      ...transitionPrefix,
      transitionSha256: semanticSha256(transitionPrefix),
    };
    const eventPrefix = {
      schema: FIXTURE_SCHEMAS.rebootTransitionChainEvent,
      targetSha256: this.target.targetSha256,
      transitions: [transition],
    };
    const event = {
      ...eventPrefix,
      eventSha256: semanticSha256(eventPrefix),
    };
    this.appendLifetime("TARGET_REBOOT_TRANSITION_OBSERVED", {
      targetSha256: this.target.targetSha256,
      operation: event,
    });
    this.targetCurrentContext = this.lifetimeContext;
    return { identity, context: this.lifetimeContext, transition };
  }

  appendNormalTermination() {
    this.appendLifetime("GUARDIAN_TERMINATION_OBSERVED");
    return this.appendLifetime("GUARDIAN_REAPED_OBSERVED");
  }

  appendRecoveryLaunchLineage(anchor = this.currentAnchor) {
    this.appendLifetime("RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE", {
      targetSha256: this.target.targetSha256,
    });
    this.appendLifetime("RECOVERY_GUARDIAN_PIDFD_OBSERVED", {
      targetSha256: this.target.targetSha256,
    });
    this.appendLifetime("RECOVERY_GUARDIAN_EXEC_OBSERVED", {
      targetSha256: this.target.targetSha256,
    });
    const membership = this.appendLifetime(
      "RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED",
      { targetSha256: this.target.targetSha256 },
    );
    anchor.launched = true;
    return membership;
  }

  appendRecoveryTermination({ parentageLost = false } = {}) {
    this.appendLifetime("RECOVERY_GUARDIAN_TERMINATION_OBSERVED", {
      targetSha256: this.target.targetSha256,
    });
    return this.appendLifetime(
      parentageLost
        ? "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED"
        : "RECOVERY_GUARDIAN_REAPED_OBSERVED",
      { targetSha256: this.target.targetSha256 },
    );
  }

  targetSelection() {
    return lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: this.latestLifetimeReplay,
      generationIdentitySha256: this.journal.generationIdentity.identitySha256,
    });
  }

  headSelection() {
    return lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: this.latestLifetimeReplay,
      targetSha256: this.target.targetSha256,
    });
  }

  anchorSelection(anchor = this.currentAnchor) {
    return lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1(
      {
        lifetimeReplay: this.latestLifetimeReplay,
        targetSha256: this.target.targetSha256,
        recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
      },
    );
  }

  closeSelection() {
    return lifetime.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1(
      {
        lifetimeReplay: this.latestLifetimeReplay,
        targetSha256: this.target.targetSha256,
      },
    );
  }

  installRecoveryTarget(recovery) {
    const generationManifest = artifact(this.journal.generationManifest);
    const normalJournalBundles =
      this.journal.normalJournalBundles.map(artifact);
    const independentlyDerived =
      independentlyDeriveRecoveryTargetFromFixtureArtifacts(this.journal);
    const productionDerivedProjection =
      recovery.deriveCandidateContainmentRecoveryTargetProjectionV1({
        generationManifest,
        normalJournalBundles,
      });
    if (
      canonicalJson(plain(productionDerivedProjection)) !==
      canonicalJson(independentlyDerived.projection)
    ) {
      throw new Error(
        "evaluator-owned recovery target projection disagrees with production",
      );
    }
    const recoveryTargetProjection = independentlyDerived.projection;
    this.independentlyDerivedTarget = independentlyDerived.target;
    this.independentlyDerivedTargetProjection = recoveryTargetProjection;
    const targetGenesisInventoryPrefix = {
      schema: FIXTURE_SCHEMAS.targetGenesisInventory,
      targetSha256: recoveryTargetProjection.targetSha256,
      reportedRecoveryDirectoryPresent: true,
      reportedRecoveryDirectoryEntryCount: 0,
      reportedExistingLifetimeTargetHead: false,
    };
    const targetGenesisInventory = {
      ...targetGenesisInventoryPrefix,
      inventorySha256: semanticSha256(targetGenesisInventoryPrefix),
    };
    const eventPrefix = {
      schema: FIXTURE_SCHEMAS.targetGenesisEvent,
      recoveryTargetProjection: plain(recoveryTargetProjection),
      targetGenesisInventory,
      provedRebootTransitions: [],
    };
    const event = {
      ...eventPrefix,
      eventSha256: semanticSha256(eventPrefix),
    };
    const genesisHead = recoveryExternalHead({
      targetSha256: recoveryTargetProjection.targetSha256,
      result: "NO_RECOVERY_ATTEMPT",
      recoveryActorEpochSha256: null,
      attemptDirectoryName: null,
      lifetimeAttemptAnchorRawSha256: null,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
    });
    this.targetGenesisRecord = this.appendLifetime(
      "GENERATION_RECOVERY_HEAD_DURABLE",
      {
        writerKind: "LIVE_BIRTH_GUARDIAN",
        writerActorEpochSha256: this.lifetimeIdentity.lifetimeEpochSha256,
        targetSha256: recoveryTargetProjection.targetSha256,
        operation: event,
        evidence: genesisHead,
      },
    );
    this.target = recovery.createCandidateContainmentRecoveryTargetV1({
      generationManifest,
      normalJournalBundles,
      lifetimeTargetSelection: this.targetSelection(),
    });
    if (
      canonicalJson(plain(this.target)) !==
      canonicalJson(this.independentlyDerivedTarget)
    ) {
      throw new Error(
        "evaluator-owned recovery target disagrees with production target",
      );
    }
    this.genesisHead = genesisHead;
    this.targetHead = genesisHead;
    return this.target;
  }

  refreshTarget(recovery) {
    this.target = recovery.verifyCandidateContainmentRecoveryTargetV1({
      target: this.target,
      generationManifest: artifact(this.journal.generationManifest),
      normalJournalBundles: this.journal.normalJournalBundles.map(artifact),
      lifetimeTargetSelection: this.targetSelection(),
    });
    return this.target;
  }

  addAnchor(actorKind = "LIVE_BIRTH_GUARDIAN") {
    const recoveryActorEpochSha256 = digest(
      `${this.label}:recovery-actor:${this.anchorIndex++}`,
    );
    const projection = {
      schema: FIXTURE_SCHEMAS.anchorProjection,
      targetSha256: this.target.targetSha256,
      actorKind,
      recoveryActorEpochSha256,
      attemptDirectoryName: recoveryActorEpochSha256,
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedCurrentBootIdSha256: this.lifetimeContext.bootIdSha256,
      expectedDelegatedRootIdentitySha256:
        this.lifetimeContext.delegatedRootIdentitySha256,
      expectedLifetimeCgroupIdentitySha256:
        this.lifetimeContext.lifetimeCgroupIdentitySha256,
      previousRecoveryActorEpochSha256:
        this.targetHead.recoveryActorEpochSha256,
      previousAttemptDirectoryName: this.targetHead.attemptDirectoryName,
      previousRecoveryRecordSequence:
        this.targetHead.latestRecoveryRecordSequence,
      previousRecoveryRecordRawSha256:
        this.targetHead.latestRecoveryRecordRawSha256,
    };
    const eventPrefix = {
      schema: FIXTURE_SCHEMAS.anchorEvent,
      predecessorExternalHead: this.targetHead,
      anchorProjection: projection,
    };
    const event = {
      ...eventPrefix,
      eventSha256: semanticSha256(eventPrefix),
    };
    const writerKind =
      actorKind === "LIVE_BIRTH_GUARDIAN"
        ? "LIVE_BIRTH_GUARDIAN"
        : "SERVICE_MANAGER";
    const record = this.appendLifetime("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
      writerKind,
      writerActorEpochSha256:
        writerKind === "LIVE_BIRTH_GUARDIAN"
          ? recoveryActorEpochSha256
          : this.managerActorEpochSha256,
      targetSha256: this.target.targetSha256,
      evidence: event,
    });
    this.currentAnchor = {
      actorKind,
      recoveryActorEpochSha256,
      attemptDirectoryName: recoveryActorEpochSha256,
      projection,
      record,
    };
    return this.currentAnchor;
  }

  appendResult(head, { managerWriter = false } = {}) {
    const record = this.appendLifetime("RECOVERY_ATTEMPT_RESULT_DURABLE", {
      writerKind: managerWriter
        ? "SERVICE_MANAGER"
        : this.currentAnchor.actorKind,
      writerActorEpochSha256: managerWriter
        ? this.managerActorEpochSha256
        : this.currentAnchor.recoveryActorEpochSha256,
      targetSha256: this.target.targetSha256,
      evidence: head,
    });
    this.targetHead = head;
    return record;
  }

  appendNormalClose() {
    const receipt = {
      schema: FIXTURE_SCHEMAS.normalCloseReceipt,
      targetSha256: this.target.targetSha256,
      sourceLocation: "active",
      destinationLocation: "closed",
      activeParentSynced: true,
      closedParentSynced: true,
      closedLocationReobserved: true,
    };
    this.normalCloseRecord = this.appendLifetime(
      "NORMAL_CLOSE_RECEIPT_DURABLE",
      { targetSha256: this.target.targetSha256, evidence: receipt },
    );
    return receipt;
  }
}
