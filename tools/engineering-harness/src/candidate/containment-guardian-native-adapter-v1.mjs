import { canonicalSha256 } from "../routing/features.mjs";
import {
  boundedInteger,
  canonicalJsonLine,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactDecimal,
  exactDenseArray,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";

// S1 is deliberately a pure receipt/replay boundary. It performs no open,
// clone, ptrace, cgroup, pidfd, wait, StateFS, or registration operation. A
// safe-local fixture may supply process observations and a synthetic fixture
// may supply the unavailable delegated-cgroup observations, but neither input
// becomes an authority or physical-fact claim merely by passing this verifier.

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_ADAPTER_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-native-adapter/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_LAUNCH_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-native-launch-observation/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_RECEIPT_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-native-pre-release-receipt/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REPLAY_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-native-lifecycle-replay/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_MAX_RECEIPT_BYTES_V1 =
  32 * 1024;

const ZERO_SHA256 = "0".repeat(64);

function fail(message) {
  throw new Error(`candidate containment guardian native adapter v1: ${message}`);
}

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1 = deepFreeze(
  nullRecord([
    [
      "compiler",
      nullRecord([
        ["path", "/usr/bin/x86_64-linux-gnu-gcc-13"],
        ["bytes", 1_023_032],
        ["sha256", "1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26"],
        ["versionBytes", 266],
        ["versionSha256", "ae487f55927d605284a32711e4ecf6bc3be2bcd5a9de414ace0936264b741f85"],
      ]),
    ],
    [
      "manager",
      nullRecord([
        ["sourceBytes", 2_840],
        ["sourceSha256", "4dba252351003b14202f20490b17b55ac5abf011ab60bdd87024a3d207585137"],
        ["requirementsSha256", "ec91cb4740266fdf4dac278af25cc3713d8f6b657ffc32e826933b4c8637f31f"],
        ["elfBytes", 30_880],
        ["elfSha256", "b297d888bce75128fc3f18c2454c753a159df97ab7fba8ce790af27540003e99"],
      ]),
    ],
    [
      "guardian",
      nullRecord([
        ["sourceBytes", 18_627],
        ["sourceSha256", "93e87316a10d289ac537350bd2af314370f0324e3d5b130cfe9ba4f1760f8039"],
        ["requirementsSha256", "94c6b1bbf7330fae09b73da5948aab02577aae42b7e5506577c11b270a556071"],
        ["elfBytes", 10_872],
        ["elfSha256", "b42663bd425f22e34998dd9d674849fd35673d7f3ad9e33d03d3cf09c12c4867"],
      ]),
    ],
    [
      "trampoline",
      nullRecord([
        ["sourceBytes", 5_828],
        ["sourceSha256", "2e4e39718673030ee26f9870eab03d0adda33d656d807c01226420b776dc955b"],
        ["requirementsSha256", "7efd0ec2b8728304dcf320e8fc22113047d4702002a76f849f3f39528e73bd6a"],
        ["elfBytes", 9_848],
        ["elfSha256", "2a19da84b079337d19b13b86d3dd6395e7517f038735c657b2956308dea87abc"],
      ]),
    ],
    [
      "statefs",
      nullRecord([
        ["headerSha256", "358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28"],
        ["sourceSha256", "f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138"],
        ["objectBytes", 33_048],
        ["objectSha256", "73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043"],
        ["buildRequirementsSha256", "fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70"],
        ["entrypoint", "oxigraph_containment_statefs_execute_v1"],
      ]),
    ],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1 = deepFreeze(
  nullRecord(
    [
      "filesystemExecution",
      "processExecution",
      "cgroupMutation",
      "serviceManagerAuthority",
      "guardianAuthority",
      "reapAuthority",
      "runtimeRegistration",
      "productExecution",
      "g17Execution",
      "qualification",
      "readiness",
      "promotion",
      "publication",
    ].map((field) => [field, false]),
  ),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1 =
  deepFreeze(
    nullRecord(
      [
        "serviceManager",
        "managerGuardianParentage",
        "delegatedCgroup",
        "productionUnit",
        "stateFilesystem",
        "powerLossDurability",
        "managerHeldExec",
        "guardianHeldExec",
        "liveManagerImageEquality",
        "liveGuardianImageEquality",
        "cloneIntoCgroup",
        "membership",
        "pidfdReadability",
        "pidfdHup",
        "waitidReap",
        "cgroupQuiescence",
      ].map((field) => [field, null]),
    ),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1 =
  Object.freeze([
    "serialized-input-origin",
    "source-or-compiler-causality",
    "static-trace-proves-runtime-trace",
    "synthetic-clone3-proves-kernel-placement",
    "synthetic-membership-proves-delegated-cgroup",
    "safe-local-pidfd-open-proves-clone-pidfd",
    "held-executable-live-image-equality-outside-exact-fixture",
    "durable-model-proves-filesystem-or-power-loss-durability",
    "parentage-lost-or-ambiguous-proves-reap",
    "same-uid-tamper-resistance",
    "production-service-manager",
    "runtime-registration",
    "COMMIT",
    "semantic-qualification",
    "production-readiness",
    "promotion",
    "publication",
  ]);

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1 = deepFreeze(
  nullRecord([
    ["status", "unavailable"],
    ["reason", "native-adapter-unavailable"],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_V1 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_ADAPTER_SCHEMA_V1],
    ["receiptSchema", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_RECEIPT_SCHEMA_V1],
    ["maximumReceiptBytes", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_MAX_RECEIPT_BYTES_V1],
    ["bindings", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1],
    ["launchOrder", Object.freeze(["manager", "guardian"])],
    ["launchOwners", Object.freeze(["trusted-service-manager", "manager"])],
    ["launchOwnerEvidenceClass", "synthetic-replay"],
    ["heldExecution", "execveat-empty-path-AT_EMPTY_PATH"],
    ["positiveExecStop", "PTRACE_EVENT_EXEC"],
    ["preExecTrace", Object.freeze(["execveat"])],
    ["preExecTraceScope", "post-initial-stop-through-positive-exec-event"],
    ["preExecTraceMaximumEvents", 1],
    ["liveImageIdentity", "held-and-proc-device-inode-independent-byte-equality"],
    [
      "evidenceClasses",
      Object.freeze([
        "source-bytes",
        "compiler-recipe",
        "static-ELF-inspection",
        "safe-local-runtime-observation",
        "synthetic-replay",
      ]),
    ],
    ["placementRequest", Object.freeze(["CLONE_INTO_CGROUP", "CLONE_PIDFD"])],
    ["placementEvidenceClass", "synthetic-replay"],
    ["pidfdEvidenceClass", "safe-local-pidfd-open-not-clone3"],
    ["pidfdHupEvidenceClass", "synthetic-replay"],
    ["statusEofEvidenceClass", "synthetic-replay"],
    ["waitOwnerEvidenceClass", "synthetic-replay"],
    ["waitOperation", "waitid-P_PIDFD-exclusive"],
    ["statefsModel", "ADR-0037-PERSIST-result-before-release"],
    ["physicalDurabilityClaim", null],
    ["adapterRegistered", false],
    ["binding", null],
    ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1],
    ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1],
    ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1],
    ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 =
  canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_V1);

function text(value, expected, label) {
  if (value !== expected) fail(`${label} changed`);
  return value;
}

function bool(value, expected, label) {
  if (value !== expected) fail(`${label} changed`);
  return value;
}

function nullableInteger(value, label) {
  if (value === null) return null;
  return boundedInteger(value, label, 0, 255, fail);
}

function exactToken(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(value)) {
    fail(`${label} is not an exact bounded token`);
  }
  return value;
}

function normalizeIdentity(value, binding, label) {
  const record = exactRecord(
    value,
    ["byteLength", "sha256", "device", "inode"],
    label,
    fail,
  );
  if (record.byteLength !== binding.elfBytes) fail(`${label} byte length changed`);
  if (exactDigest(record.sha256, `${label} sha256`, fail) !== binding.elfSha256) {
    fail(`${label} bytes do not bind the frozen S0 artifact`);
  }
  return nullRecord([
    ["byteLength", binding.elfBytes],
    ["sha256", binding.elfSha256],
    ["device", exactDecimal(record.device, `${label} device`, {}, fail)],
    ["inode", exactDecimal(record.inode, `${label} inode`, { minimum: 1n }, fail)],
  ]);
}

function normalizeExecution(value, held, label) {
  const record = exactRecord(
    value,
    [
      "mechanism",
      "pathname",
      "flags",
      "traceScope",
      "trace",
      "traceMaximumEvents",
      "traceComplete",
      "events",
      "eventMaximumEvents",
      "eventComplete",
      "positiveExecStop",
      "childStoppedUntilObservationComplete",
      "childStoppedUntilDurableReceipt",
      "syntheticHeldUntilReceipt",
      "outcomePipeEof",
      "liveImage",
      "independentByteRead",
    ],
    label,
    fail,
  );
  text(record.mechanism, "execveat-held-fd-empty-path", `${label} mechanism`);
  text(record.pathname, "", `${label} pathname`);
  const flags = exactDenseArray(record.flags, `${label} flags`, 1, fail);
  if (flags.length !== 1 || flags[0] !== "AT_EMPTY_PATH") fail(`${label} flags changed`);
  text(
    record.traceScope,
    "post-initial-stop-through-positive-exec-event",
    `${label} trace scope`,
  );
  const trace = exactDenseArray(record.trace, `${label} trace`, 1, fail);
  if (trace.length !== 1 || trace[0] !== "execveat") fail(`${label} trace changed`);
  boundedInteger(record.traceMaximumEvents, `${label} trace bound`, 1, 1, fail);
  bool(record.traceComplete, true, `${label} trace completeness`);
  const events = exactDenseArray(record.events, `${label} events`, 1, fail);
  if (events.length !== 1 || events[0] !== "PTRACE_EVENT_EXEC") fail(`${label} events changed`);
  boundedInteger(record.eventMaximumEvents, `${label} event bound`, 1, 1, fail);
  bool(record.eventComplete, true, `${label} event completeness`);
  text(record.positiveExecStop, "PTRACE_EVENT_EXEC", `${label} exec stop`);
  bool(record.childStoppedUntilObservationComplete, true, `${label} observation stop latch`);
  if (record.childStoppedUntilDurableReceipt !== null) {
    fail(`${label} safe-local durable receipt stop was overclaimed`);
  }
  bool(record.syntheticHeldUntilReceipt, true, `${label} synthetic receipt stop latch`);
  bool(record.outcomePipeEof, true, `${label} outcome EOF`);
  bool(record.independentByteRead, true, `${label} independent byte read`);
  const live = exactRecord(
    record.liveImage,
    ["byteLength", "sha256", "device", "inode"],
    `${label} live image`,
    fail,
  );
  if (
    live.byteLength !== held.byteLength ||
    live.sha256 !== held.sha256 ||
    live.device !== held.device ||
    live.inode !== held.inode
  ) {
    fail(`${label} live image does not equal the held executable`);
  }
  return nullRecord([
    ["mechanism", "execveat-held-fd-empty-path"],
    ["pathname", ""],
    ["flags", Object.freeze(["AT_EMPTY_PATH"])],
    ["traceScope", "post-initial-stop-through-positive-exec-event"],
    ["trace", Object.freeze(["execveat"])],
    ["traceMaximumEvents", 1],
    ["traceComplete", true],
    ["events", Object.freeze(["PTRACE_EVENT_EXEC"])],
    ["eventMaximumEvents", 1],
    ["eventComplete", true],
    ["positiveExecStop", "PTRACE_EVENT_EXEC"],
    ["childStoppedUntilObservationComplete", true],
    ["childStoppedUntilDurableReceipt", null],
    ["syntheticHeldUntilReceipt", true],
    ["outcomePipeEof", true],
    ["liveImage", nullRecord(Object.entries(held))],
    ["independentByteRead", true],
  ]);
}

function normalizePlacement(value, childToken, pidfdToken, label) {
  const record = exactRecord(
    value,
    [
      "evidenceClass",
      "syscall",
      "flags",
      "intoCgroupRole",
      "pidfdOutput",
      "cloneArgsBytes",
      "exitSignal",
      "fallbackUsed",
      "returnedPid",
      "returnedPidfd",
      "returnedChildToken",
      "returnedPidfdToken",
      "membership",
    ],
    label,
    fail,
  );
  text(record.evidenceClass, "synthetic-replay", `${label} evidence class`);
  text(record.syscall, "clone3", `${label} syscall`);
  const flags = exactDenseArray(record.flags, `${label} flags`, 2, fail);
  if (
    flags.length !== 2 ||
    flags[0] !== "CLONE_INTO_CGROUP" ||
    flags[1] !== "CLONE_PIDFD"
  ) {
    fail(`${label} flags changed`);
  }
  text(record.intoCgroupRole, "held-lifetime-cgroup", `${label} cgroup role`);
  bool(record.pidfdOutput, true, `${label} pidfd output`);
  boundedInteger(record.cloneArgsBytes, `${label} clone args bytes`, 88, 88, fail);
  text(record.exitSignal, "SIGCHLD", `${label} exit signal`);
  bool(record.fallbackUsed, false, `${label} fallback`);
  const returnedPid = boundedInteger(record.returnedPid, `${label} returned pid`, 1, 1_000_000, fail);
  const returnedPidfd = boundedInteger(record.returnedPidfd, `${label} returned pidfd`, 3, 1_023, fail);
  text(record.returnedChildToken, childToken, `${label} child return`);
  text(record.returnedPidfdToken, pidfdToken, `${label} pidfd return`);
  const membership = exactRecord(
    record.membership,
    ["source", "cgroupToken", "members", "childToken", "exact"],
    `${label} membership`,
    fail,
  );
  text(membership.source, "synthetic-cgroup.procs-replay", `${label} membership source`);
  text(membership.cgroupToken, "lifetime-cgroup-0001", `${label} membership cgroup`);
  const members = exactDenseArray(membership.members, `${label} members`, 1, fail);
  if (members.length !== 1 || members[0] !== returnedPid) {
    fail(`${label} membership drifted`);
  }
  text(membership.childToken, childToken, `${label} membership child token`);
  bool(membership.exact, true, `${label} exact membership`);
  return nullRecord([
    ["evidenceClass", "synthetic-replay"],
    ["syscall", "clone3"],
    ["flags", Object.freeze(["CLONE_INTO_CGROUP", "CLONE_PIDFD"])],
    ["intoCgroupRole", "held-lifetime-cgroup"],
    ["pidfdOutput", true],
    ["cloneArgsBytes", 88],
    ["exitSignal", "SIGCHLD"],
    ["fallbackUsed", false],
    ["returnedPid", returnedPid],
    ["returnedPidfd", returnedPidfd],
    ["returnedChildToken", childToken],
    ["returnedPidfdToken", pidfdToken],
    [
      "membership",
      nullRecord([
        ["source", "synthetic-cgroup.procs-replay"],
        ["cgroupToken", "lifetime-cgroup-0001"],
        ["members", Object.freeze([returnedPid])],
        ["childToken", childToken],
        ["exact", true],
      ]),
    ],
  ]);
}

function normalizeSupervision(value, childToken, pidfdToken, parentage, label) {
  const record = exactRecord(
    value,
    [
      "evidenceClass",
      "childToken",
      "pidfdToken",
      "pidfdReadable",
      "pidfdHup",
      "syntheticPidfdHup",
      "waitidIdType",
      "waitOwnerMatchesLaunchOwner",
      "syntheticWaitOwnerMatchesLaunchOwner",
      "waitidReaped",
      "secondWaitEchild",
      "statusEof",
      "syntheticStatusEof",
      "exitCode",
      "termSignal",
    ],
    label,
    fail,
  );
  text(
    record.evidenceClass,
    parentage === "direct-parent"
      ? "safe-local-pidfd-open-not-clone3"
      : "unresolved-parentage-replay",
    `${label} evidence class`,
  );
  text(record.childToken, childToken, `${label} child token`);
  text(record.pidfdToken, pidfdToken, `${label} pidfd token`);
  if (parentage === "direct-parent") {
    bool(record.pidfdReadable, true, `${label} pidfd readable`);
    if (record.pidfdHup !== null) fail(`${label} safe-local pidfd HUP was overclaimed`);
    bool(record.syntheticPidfdHup, true, `${label} synthetic pidfd HUP`);
    text(record.waitidIdType, "P_PIDFD", `${label} wait id type`);
    if (record.waitOwnerMatchesLaunchOwner !== null) {
      fail(`${label} safe-local wait owner was overclaimed`);
    }
    bool(
      record.syntheticWaitOwnerMatchesLaunchOwner,
      true,
      `${label} synthetic wait owner`,
    );
    bool(record.waitidReaped, true, `${label} reap`);
    bool(record.secondWaitEchild, true, `${label} exclusive wait`);
    if (record.statusEof !== null) fail(`${label} safe-local status EOF was overclaimed`);
    bool(record.syntheticStatusEof, true, `${label} synthetic status EOF`);
    nullableInteger(record.exitCode, `${label} exit code`);
    nullableInteger(record.termSignal, `${label} term signal`);
    if ((record.exitCode === null) === (record.termSignal === null)) {
      fail(`${label} terminal status is not exclusive`);
    }
  } else {
    for (const field of [
      "pidfdReadable",
      "pidfdHup",
      "syntheticPidfdHup",
      "waitidIdType",
      "waitOwnerMatchesLaunchOwner",
      "syntheticWaitOwnerMatchesLaunchOwner",
      "waitidReaped",
      "secondWaitEchild",
      "statusEof",
      "syntheticStatusEof",
      "exitCode",
      "termSignal",
    ]) {
      if (record[field] !== null) fail(`${label} unresolved parentage claimed ${field}`);
    }
  }
  return nullRecord([
    [
      "evidenceClass",
      parentage === "direct-parent"
        ? "safe-local-pidfd-open-not-clone3"
        : "unresolved-parentage-replay",
    ],
    ["childToken", childToken],
    ["pidfdToken", pidfdToken],
    ...[
      "pidfdReadable",
      "pidfdHup",
      "syntheticPidfdHup",
      "waitidIdType",
      "waitOwnerMatchesLaunchOwner",
      "syntheticWaitOwnerMatchesLaunchOwner",
      "waitidReaped",
      "secondWaitEchild",
      "statusEof",
      "syntheticStatusEof",
      "exitCode",
      "termSignal",
    ].map((field) => [field, record[field]]),
  ]);
}

function normalizeLaunch(value) {
  const record = exactRecord(
    value,
    [
      "schema",
      "role",
      "ownerRole",
      "ownerEvidenceClass",
      "childToken",
      "pidfdToken",
      "heldExecutable",
      "execution",
      "placement",
      "supervision",
      "parentage",
    ],
    "launch observation",
    fail,
  );
  text(record.schema, CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_LAUNCH_SCHEMA_V1, "launch schema");
  if (record.role !== "manager" && record.role !== "guardian") fail("launch role changed");
  const owner = record.role === "manager" ? "trusted-service-manager" : "manager";
  text(record.ownerRole, owner, "launch owner role");
  text(record.ownerEvidenceClass, "synthetic-replay", "launch owner evidence class");
  const childToken = exactToken(record.childToken, "child token");
  const pidfdToken = exactToken(record.pidfdToken, "pidfd token");
  if (childToken === pidfdToken) fail("child and pidfd tokens alias");
  if (
    record.parentage !== "direct-parent" &&
    record.parentage !== "parentage-lost" &&
    record.parentage !== "parentage-ambiguous"
  ) {
    fail("parentage classification changed");
  }
  const binding = CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1[record.role];
  const held = normalizeIdentity(record.heldExecutable, binding, "held executable");
  const execution = normalizeExecution(record.execution, held, "execution");
  const placement = normalizePlacement(record.placement, childToken, pidfdToken, "placement");
  const supervision = normalizeSupervision(
    record.supervision,
    childToken,
    pidfdToken,
    record.parentage,
    "supervision",
  );
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_LAUNCH_SCHEMA_V1],
    ["role", record.role],
    ["ownerRole", owner],
    ["ownerEvidenceClass", "synthetic-replay"],
    ["childToken", childToken],
    ["pidfdToken", pidfdToken],
    ["heldExecutable", held],
    ["execution", execution],
    ["placement", placement],
    ["supervision", supervision],
    ["parentage", record.parentage],
  ]);
}

function persistenceModel(role) {
  return nullRecord([
    ["evidenceClass", "synthetic-durable-model"],
    ["operation", "ADR-0037-PERSIST"],
    ["writerRole", role === "manager" ? "trusted-service-manager" : "manager"],
    ["statefsObjectSha256", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.statefs.objectSha256],
    ["statefsEntrypoint", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_BINDINGS_V1.statefs.entrypoint],
    ["requestBeforeRelease", true],
    ["resultBeforeRelease", true],
    ["physicalDurability", null],
  ]);
}

function receiptBody(sequence, predecessorSha256, launch) {
  const resolved = launch.parentage === "direct-parent";
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_RECEIPT_SCHEMA_V1],
    ["sequence", sequence],
    ["predecessorSha256", predecessorSha256],
    ["requirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1],
    ["launch", launch],
    ["persistence", persistenceModel(launch.role)],
    ["preReleaseModelSatisfied", resolved],
    ["releasePerformed", false],
    ["binding", null],
    ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1],
    ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1],
    ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1],
    ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1],
  ]);
}

function receiptArtifact(bytes) {
  return deepFreeze(
    nullRecord([
      ["name", "candidate-containment-guardian-native-pre-release-receipt-v1.json"],
      ["bytes", bytes.length],
      ["sha256", sha256(bytes)],
    ]),
  );
}

export function createCandidateContainmentGuardianNativeReceiptV1(value) {
  const record = exactRecord(
    value,
    ["sequence", "predecessorSha256", "launch"],
    "receipt input",
    fail,
  );
  const launch = normalizeLaunch(record.launch);
  const expectedSequence = launch.role === "manager" ? 0 : 1;
  boundedInteger(record.sequence, "receipt sequence", expectedSequence, expectedSequence, fail);
  const predecessor = exactDigest(record.predecessorSha256, "receipt predecessor", fail);
  if (launch.role === "manager" && predecessor !== ZERO_SHA256) {
    fail("manager receipt predecessor changed");
  }
  if (launch.role === "guardian" && predecessor === ZERO_SHA256) {
    fail("guardian receipt predecessor is absent");
  }
  const bytes = canonicalJsonLine(receiptBody(expectedSequence, predecessor, launch));
  if (bytes.length > CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_MAX_RECEIPT_BYTES_V1) {
    fail("receipt exceeds its exact byte bound");
  }
  return frozenCopyOnReadBytes(bytes, [["artifact", receiptArtifact(bytes)]]);
}

function validateEmbeddedConstants(body) {
  if (
    body.requirementsSha256 !== CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 ||
    body.binding !== null ||
    canonicalSha256(body.authority) !== canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1) ||
    canonicalSha256(body.physicalFacts) !== canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1) ||
    canonicalSha256(body.nonclaims) !== canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1) ||
    canonicalSha256(body.readiness) !== canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1)
  ) {
    fail("receipt authority or binding changed");
  }
}

export function verifyCandidateContainmentGuardianNativeReceiptV1(bytesValue) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "receipt bytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_MAX_RECEIPT_BYTES_V1,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "sequence",
      "predecessorSha256",
      "requirementsSha256",
      "launch",
      "persistence",
      "preReleaseModelSatisfied",
      "releasePerformed",
      "binding",
      "authority",
      "physicalFacts",
      "nonclaims",
      "readiness",
    ],
    "receipt",
    fail,
  );
  text(body.schema, CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_RECEIPT_SCHEMA_V1, "receipt schema");
  validateEmbeddedConstants(body);
  const launch = normalizeLaunch(body.launch);
  const expectedSequence = launch.role === "manager" ? 0 : 1;
  boundedInteger(body.sequence, "receipt sequence", expectedSequence, expectedSequence, fail);
  const predecessor = exactDigest(body.predecessorSha256, "receipt predecessor", fail);
  if ((launch.role === "manager") !== (predecessor === ZERO_SHA256)) {
    fail("receipt predecessor does not match role");
  }
  const expected = receiptBody(expectedSequence, predecessor, launch);
  if (canonicalSha256(body.persistence) !== canonicalSha256(expected.persistence)) {
    fail("receipt persistence model changed");
  }
  bool(body.preReleaseModelSatisfied, expected.preReleaseModelSatisfied, "pre-release model latch");
  bool(body.releasePerformed, false, "release performed latch");
  const canonical = canonicalJsonLine(expected);
  if (sha256(canonical) !== sha256(decoded.bytes)) fail("receipt normalization changed");
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_RECEIPT_SCHEMA_V1],
      ["role", launch.role],
      ["ownerRole", launch.ownerRole],
      ["sequence", expectedSequence],
      ["predecessorSha256", predecessor],
      ["rawSha256", sha256(decoded.bytes)],
      ["parentage", launch.parentage],
      ["preReleaseModelSatisfied", expected.preReleaseModelSatisfied],
      ["releasePerformed", false],
      ["binding", null],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1],
      ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1],
      ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1],
    ]),
  );
}

export function replayCandidateContainmentGuardianNativeLifecycleV1(value) {
  const record = exactRecord(
    value,
    ["managerReceiptBytes", "guardianReceiptBytes"],
    "lifecycle replay input",
    fail,
  );
  const manager = verifyCandidateContainmentGuardianNativeReceiptV1(record.managerReceiptBytes);
  const guardian = verifyCandidateContainmentGuardianNativeReceiptV1(record.guardianReceiptBytes);
  if (
    manager.role !== "manager" ||
    guardian.role !== "guardian" ||
    guardian.predecessorSha256 !== manager.rawSha256
  ) {
    fail("manager-to-guardian receipt chain changed");
  }
  const complete =
    manager.parentage === "direct-parent" &&
    guardian.parentage === "direct-parent" &&
    manager.preReleaseModelSatisfied &&
    guardian.preReleaseModelSatisfied;
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REPLAY_SCHEMA_V1],
      ["managerReceiptSha256", manager.rawSha256],
      ["guardianReceiptSha256", guardian.rawSha256],
      ["managerOwner", manager.ownerRole],
      ["guardianOwner", guardian.ownerRole],
      ["managerParentage", manager.parentage],
      ["guardianParentage", guardian.parentage],
      ["preReleaseModelComplete", complete],
      ["releasePerformed", false],
      ["binding", null],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_AUTHORITY_V1],
      ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_PHYSICAL_FACTS_V1],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_NONCLAIMS_V1],
      ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_READINESS_V1],
    ]),
  );
}
