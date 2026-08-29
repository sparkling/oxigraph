import { createHash } from "node:crypto";
import { isDeepStrictEqual, types as utilTypes } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

// This is a pure, dormant replay contract. It opens no descriptor, starts no
// process, touches no cgroup, and cannot mint the sandbox production brand.

export const CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-request/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-request-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-status/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-status-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-fd-map/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-requirements/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2 = 4_096;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2 = 65_536;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_FRAMES_V2 = 10;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_FRAME_MAX_BYTES_V2 = 4_096;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2 = 2_000;

const digestPattern = /^[0-9a-f]{64}$/u;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`candidate containment supervisor protocol: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function frozenCopyOnReadBytes(bytes, entries = []) {
  const retained = bufferFrom(bytes);
  const value = Object.create(null);
  Object.defineProperty(value, "bytes", {
    configurable: false,
    enumerable: true,
    get() {
      return bufferFrom(retained);
    },
  });
  for (const [key, child] of entries) value[key] = child;
  return Object.freeze(value);
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactRecord(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    fail(`${label} must be a plain own-data record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch {
    fail(`${label} cannot be inspected`);
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(`${label} has a foreign prototype`);
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort()) ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return !(
        "value" in descriptor &&
        descriptor.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    })
  ) {
    fail(`${label} fields are not exact enumerable own data`);
  }
  return nullRecord(expected.map((key) => [key, descriptors[key].value]));
}

function exactDenseArray(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    objectGetPrototypeOf(value) !== arrayPrototype
  ) {
    fail(`${label} must be an exact dense array`);
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(descriptors);
  const expectedKeys = [
    ...Array.from({ length: expected.length }, (_, index) => String(index)),
    "length",
  ];
  if (
    descriptors.length?.value !== expected.length ||
    !isDeepStrictEqual([...keys].sort(), expectedKeys.sort()) ||
    expected.some((child, index) => descriptors[String(index)]?.value !== child)
  ) {
    fail(`${label} changed`);
  }
  return Object.freeze([...expected]);
}

function boundedInteger(value, label, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} is outside its exact bound`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(`${label} is not exact lowercase SHA-256`);
  }
  return value;
}

function copyBoundedBuffer(value, maximum, label) {
  if (
    !Buffer.isBuffer(value) ||
    utilTypes.isProxy(value) ||
    objectGetPrototypeOf(value) !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(`${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch {
    fail(`${label} length cannot be read intrinsically`);
  }
  if (!Number.isSafeInteger(length) || length < 1 || length > maximum) {
    fail(`${label} is outside its byte bound`);
  }
  const copied = bufferAllocUnsafe(length);
  typedArraySet.call(copied, value);
  return copied;
}

function decodeCanonicalJsonLines(bytesValue, options) {
  const bytes = copyBoundedBuffer(
    bytesValue,
    options.maximumBytes,
    options.label,
  );
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    fail(`${options.label} is not valid UTF-8`);
  }
  if (
    text.includes("\0") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text === "\n"
  ) {
    fail(`${options.label} framing is invalid`);
  }
  const lines = text.slice(0, -1).split("\n");
  if (
    lines.length < options.minimumFrames ||
    lines.length > options.maximumFrames ||
    lines.some(
      (line) =>
        line.length === 0 ||
        Buffer.byteLength(line, "utf8") + 1 > options.maximumFrameBytes,
    )
  ) {
    fail(`${options.label} frame inventory is outside its bound`);
  }
  const values = [];
  for (const [index, line] of lines.entries()) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      fail(`${options.label} frame ${index} is not JSON`);
    }
    let canonical;
    try {
      canonical = canonicalJson(value);
    } catch {
      fail(`${options.label} frame ${index} is not canonical JSON data`);
    }
    if (canonical !== line) {
      fail(`${options.label} frame ${index} is not canonical`);
    }
    values.push(value);
  }
  return { bytes, values };
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_V2 = deepFreeze(
  nullRecord([
    ["commandStream", 0],
    ["status", 1],
    ["diagnostics", 2],
    ["delegatedCgroup", 3],
    ["childLaunchExecutable", 4],
    ["childStdin", 5],
    ["supervisorSelf", 6],
    ["payloadSandboxWorker", 7],
    ["payloadProcess", 8],
    ["payloadBuildCommand", 9],
    ["payloadEvidenceLimits", 10],
    ["payloadSessionLimits", 11],
    ["payloadTaskFailures", 12],
    ["payloadRoutingFeatures", 13],
    ["payloadSeccompLauncher", 14],
  ]),
);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_V2);

const naturalStates = Object.freeze([
  "ACQUIRED_EMPTY_CONFIGURED",
  "CLONE_COMMIT_STARTED",
  "SPAWN_COMMITTED",
  "PIDFD_READY",
  "DIRECT_CHILD_REAPED",
  "CGROUP_QUIESCENT",
  "CGROUP_REMOVED",
  "DESCRIPTORS_CLOSED",
  "CLOSED",
]);
const waitCancellationStates = Object.freeze([
  "ACQUIRED_EMPTY_CONFIGURED",
  "CLONE_COMMIT_STARTED",
  "SPAWN_COMMITTED",
  "CANCELLING",
  "DIRECT_CHILD_REAPED",
  "CGROUP_QUIESCENT",
  "CGROUP_REMOVED",
  "DESCRIPTORS_CLOSED",
  "CLOSED",
]);
const descendantCancellationStates = Object.freeze([
  "ACQUIRED_EMPTY_CONFIGURED",
  "CLONE_COMMIT_STARTED",
  "SPAWN_COMMITTED",
  "PIDFD_READY",
  "DIRECT_CHILD_REAPED",
  "CANCELLING",
  "CGROUP_QUIESCENT",
  "CGROUP_REMOVED",
  "DESCRIPTORS_CLOSED",
  "CLOSED",
]);
const acceptedStateSequences = Object.freeze([
  naturalStates,
  waitCancellationStates,
  descendantCancellationStates,
]);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_V2 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SCHEMA_V2],
    ["ownerRequestSchema", "oxigraph.candidate-containment-owner-request/v1"],
    ["requestSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2],
    ["statusSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2],
    ["fdMapSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SCHEMA_V2],
    ["fdMapSha256", CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2],
    [
      "requestMaximumBytes",
      CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2,
    ],
    [
      "statusMaximumBytes",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2,
    ],
    [
      "statusMaximumFrames",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_FRAMES_V2,
    ],
    [
      "statusMaximumFrameBytes",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_FRAME_MAX_BYTES_V2,
    ],
    [
      "statusTimeoutMilliseconds",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2,
    ],
    ["payloadCount", 8],
    ["payloadMaximumFileBytes", 16 * 1024 * 1024],
    ["payloadMaximumAggregateBytes", 64 * 1024 * 1024],
    ["acceptedClosedStateSequences", acceptedStateSequences],
    ["mechanicsImplemented", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_V2);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-self-description/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_V2 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SCHEMA_V2],
    ["artifact", "candidate-containment-supervisor-v1"],
    ["target", "linux-x86_64-freestanding-static"],
    ["entry", "oxigraph_supervisor_dormant_entry"],
    ["dormantExitCode", 125],
    ["requestSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2],
    ["statusSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2],
    [
      "requirementsSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
    ],
    ["fdMapSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SCHEMA_V2],
    ["fdMapSha256", CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2],
    [
      "requestMaximumBytes",
      CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2,
    ],
    [
      "statusMaximumBytes",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2,
    ],
    [
      "statusMaximumFrames",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_FRAMES_V2,
    ],
    [
      "statusMaximumFrameBytes",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_FRAME_MAX_BYTES_V2,
    ],
    [
      "statusTimeoutMilliseconds",
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2,
    ],
    ["supervisorPayloadFds", Object.freeze([7, 8, 9, 10, 11, 12, 13, 14])],
    ["childPayloadFds", Object.freeze([3, 4, 5, 6, 7, 8, 9, 10])],
    ["firstUnexpectedSupervisorFd", 15],
    ["requestParserImplemented", false],
    ["statusWriterImplemented", false],
    ["mechanicsImplemented", false],
    ["binding", null],
    ["physicalLaunchEligible", false],
  ]),
);
export const CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2 = `${canonicalJson(CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_V2)}\n`;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SHA256_V2 =
  sha256(
    bufferFrom(
      CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2,
      "utf8",
    ),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2 = deepFreeze(
  nullRecord([
    ["nativeObservationAuthority", false],
    ["containmentExecutionAuthority", false],
    ["sandboxReportAuthority", false],
    ["applicationReceiptAuthority", false],
    ["qualificationAuthority", false],
    ["finalDecisionAuthority", false],
    ["promotionAuthority", false],
    ["publicationAuthority", false],
    ["providerExecutionAuthority", false],
    ["routerQualityAuthority", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2 = deepFreeze(
  nullRecord([
    ["serializedReplayProvesNativeOrigin", false],
    ["serializedReplayProvesObservationOrder", false],
    ["serializedReplayProvesSoleWriterOwnership", false],
    ["serializedReplayProvesCgroupIdentity", false],
    ["serializedReplayProvesKernelReadback", false],
    ["serializedReplayProvesClone3", false],
    ["serializedReplayProvesPidfdIdentity", false],
    ["serializedReplayProvesWaitid", false],
    ["serializedReplayProvesCgroupRemoval", false],
    ["supervisorImplemented", false],
    ["supervisorExecuted", false],
    ["physicalContainment", false],
    ["runtimeExecutableClosure", false],
    ["dynamicLoadingResistance", false],
    ["sameUidTamperResistance", false],
  ]),
);

function snapshotLimits(value, label) {
  const limits = exactRecord(
    value,
    ["memoryMaxBytes", "memorySwapMaxBytes", "tasksMax", "wallMs"],
    label,
  );
  return deepFreeze(
    nullRecord([
      [
        "memoryMaxBytes",
        boundedInteger(
          limits.memoryMaxBytes,
          `${label} memoryMaxBytes`,
          256 * 1024 * 1024,
          64 * 1024 * 1024 * 1024,
        ),
      ],
      [
        "memorySwapMaxBytes",
        boundedInteger(
          limits.memorySwapMaxBytes,
          `${label} memorySwapMaxBytes`,
          0,
          0,
        ),
      ],
      [
        "tasksMax",
        boundedInteger(limits.tasksMax, `${label} tasksMax`, 512, 512),
      ],
      [
        "wallMs",
        boundedInteger(limits.wallMs, `${label} wallMs`, 1_000, 7_200_000),
      ],
    ]),
  );
}

function ownerRequestSha256(requestSha256, limits) {
  return sha256(
    bufferFrom(
      JSON.stringify({
        schema: "oxigraph.candidate-containment-owner-request/v1",
        requestSha256,
        limits: {
          memoryMaxBytes: limits.memoryMaxBytes,
          memorySwapMaxBytes: limits.memorySwapMaxBytes,
          tasksMax: limits.tasksMax,
          wallMs: limits.wallMs,
        },
      }),
      "utf8",
    ),
  );
}

function snapshotRequestInput(value) {
  const input = exactRecord(
    value,
    [
      "requestSha256",
      "generationSha256",
      "launchArgvSha256",
      "launchArgvCount",
      "launchArgvBytes",
      "launchEnvironmentSha256",
      "launchEnvironmentCount",
      "launchEnvironmentBytes",
      "childStdinSha256",
      "childStdinBytes",
      "payloadClosureSha256",
      "limits",
    ],
    "request input",
  );
  const limits = snapshotLimits(input.limits, "request input limits");
  return deepFreeze(
    nullRecord([
      ["requestSha256", digest(input.requestSha256, "request digest")],
      ["generationSha256", digest(input.generationSha256, "generation digest")],
      ["limits", limits],
      [
        "launchArgvSha256",
        digest(input.launchArgvSha256, "launch argv digest"),
      ],
      [
        "launchArgvCount",
        boundedInteger(input.launchArgvCount, "launch argv count", 1, 4_096),
      ],
      [
        "launchArgvBytes",
        boundedInteger(
          input.launchArgvBytes,
          "launch argv bytes",
          1,
          1024 * 1024,
        ),
      ],
      [
        "launchEnvironmentSha256",
        digest(input.launchEnvironmentSha256, "launch environment digest"),
      ],
      [
        "launchEnvironmentCount",
        boundedInteger(
          input.launchEnvironmentCount,
          "launch environment count",
          0,
          4_096,
        ),
      ],
      [
        "launchEnvironmentBytes",
        boundedInteger(
          input.launchEnvironmentBytes,
          "launch environment bytes",
          0,
          1024 * 1024,
        ),
      ],
      [
        "childStdinSha256",
        digest(input.childStdinSha256, "child stdin digest"),
      ],
      [
        "childStdinBytes",
        boundedInteger(
          input.childStdinBytes,
          "child stdin bytes",
          1,
          4 * 1024 * 1024,
        ),
      ],
      [
        "payloadClosureSha256",
        digest(input.payloadClosureSha256, "payload closure digest"),
      ],
    ]),
  );
}

function requestBody(input) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2],
    ["requestSha256", input.requestSha256],
    [
      "ownerRequestSha256",
      ownerRequestSha256(input.requestSha256, input.limits),
    ],
    ["generationSha256", input.generationSha256],
    [
      "requirementsSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
    ],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
    ],
    ["launchArgvSha256", input.launchArgvSha256],
    ["launchArgvCount", input.launchArgvCount],
    ["launchArgvBytes", input.launchArgvBytes],
    ["launchEnvironmentSha256", input.launchEnvironmentSha256],
    ["launchEnvironmentCount", input.launchEnvironmentCount],
    ["launchEnvironmentBytes", input.launchEnvironmentBytes],
    ["childStdinSha256", input.childStdinSha256],
    ["childStdinBytes", input.childStdinBytes],
    ["payloadClosureSha256", input.payloadClosureSha256],
    ["limits", input.limits],
  ]);
}

function requestProjection(body, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_PROJECTION_SCHEMA_V2],
      ["protocolSchema", body.schema],
      ["byteLength", bytes.length],
      ["rawSha256", sha256(bytes)],
      ["requestSha256", body.requestSha256],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", body.generationSha256],
      ["requirementsSha256", body.requirementsSha256],
      ["fileDescriptorMapSha256", body.fileDescriptorMapSha256],
      ["launchArgvSha256", body.launchArgvSha256],
      ["launchArgvCount", body.launchArgvCount],
      ["launchArgvBytes", body.launchArgvBytes],
      ["launchEnvironmentSha256", body.launchEnvironmentSha256],
      ["launchEnvironmentCount", body.launchEnvironmentCount],
      ["launchEnvironmentBytes", body.launchEnvironmentBytes],
      ["childStdinSha256", body.childStdinSha256],
      ["childStdinBytes", body.childStdinBytes],
      ["payloadClosureSha256", body.payloadClosureSha256],
      ["limits", body.limits],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2],
    ]),
  );
}

function validateRequestBody(value, bytes) {
  const body = exactRecord(
    value,
    [
      "schema",
      "requestSha256",
      "ownerRequestSha256",
      "generationSha256",
      "requirementsSha256",
      "fileDescriptorMapSha256",
      "launchArgvSha256",
      "launchArgvCount",
      "launchArgvBytes",
      "launchEnvironmentSha256",
      "launchEnvironmentCount",
      "launchEnvironmentBytes",
      "childStdinSha256",
      "childStdinBytes",
      "payloadClosureSha256",
      "limits",
    ],
    "request body",
  );
  if (body.schema !== CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2) {
    fail("request schema changed");
  }
  const normalized = snapshotRequestInput({
    requestSha256: body.requestSha256,
    generationSha256: body.generationSha256,
    launchArgvSha256: body.launchArgvSha256,
    launchArgvCount: body.launchArgvCount,
    launchArgvBytes: body.launchArgvBytes,
    launchEnvironmentSha256: body.launchEnvironmentSha256,
    launchEnvironmentCount: body.launchEnvironmentCount,
    launchEnvironmentBytes: body.launchEnvironmentBytes,
    childStdinSha256: body.childStdinSha256,
    childStdinBytes: body.childStdinBytes,
    payloadClosureSha256: body.payloadClosureSha256,
    limits: body.limits,
  });
  const expected = requestBody(normalized);
  if (
    body.ownerRequestSha256 !== expected.ownerRequestSha256 ||
    body.requirementsSha256 !== expected.requirementsSha256 ||
    body.fileDescriptorMapSha256 !== expected.fileDescriptorMapSha256
  ) {
    fail("request bindings changed");
  }
  return requestProjection(expected, bytes);
}

export function createCandidateContainmentSupervisorRequestV2(value) {
  const body = requestBody(snapshotRequestInput(value));
  const bytes = bufferFrom(`${canonicalJson(body)}\n`, "utf8");
  if (bytes.length > CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2) {
    fail("created request exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      deepFreeze(
        nullRecord([
          ["name", "candidate-containment-request-v1.json"],
          ["bytes", bytes.length],
          ["sha256", sha256(bytes)],
        ]),
      ),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorRequestV2(bytesValue) {
  const decoded = decodeCanonicalJsonLines(bytesValue, {
    label: "request bytes",
    maximumBytes: CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2,
    minimumFrames: 1,
    maximumFrames: 1,
    maximumFrameBytes: CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2,
  });
  return validateRequestBody(decoded.values[0], decoded.bytes);
}

function exactBoolean(value, expected, label) {
  if (value !== expected) fail(`${label} changed`);
  return value;
}

function validateAcquired(value, request) {
  const evidence = exactRecord(
    value,
    [
      "generationSha256",
      "filesystem",
      "descriptorHeld",
      "accessMode",
      "type",
      "initialProcsEmpty",
      "memoryMax",
      "memorySwapMax",
      "pidsMax",
    ],
    "ACQUIRED_EMPTY_CONFIGURED evidence",
  );
  if (
    evidence.generationSha256 !== request.generationSha256 ||
    evidence.filesystem !== "cgroup2" ||
    evidence.accessMode !== "O_RDONLY|O_DIRECTORY|O_CLOEXEC" ||
    evidence.type !== "domain" ||
    evidence.memoryMax !== `${request.limits.memoryMaxBytes}\n` ||
    evidence.memorySwapMax !== "0\n" ||
    evidence.pidsMax !== `${request.limits.tasksMax}\n`
  ) {
    fail("ACQUIRED_EMPTY_CONFIGURED evidence changed");
  }
  exactBoolean(evidence.descriptorHeld, true, "acquisition descriptor latch");
  exactBoolean(evidence.initialProcsEmpty, true, "initial cgroup emptiness");
  return evidence;
}

function validateCloneCommit(value) {
  const evidence = exactRecord(
    value,
    ["syscall", "cloneArgsSize", "flags", "exitSignal"],
    "CLONE_COMMIT_STARTED evidence",
  );
  if (
    evidence.syscall !== "clone3" ||
    evidence.cloneArgsSize !== 88 ||
    evidence.exitSignal !== "SIGCHLD"
  ) {
    fail("CLONE_COMMIT_STARTED evidence changed");
  }
  exactDenseArray(
    evidence.flags,
    ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
    "clone3 flags",
  );
  return evidence;
}

function validateSpawned(value) {
  const evidence = exactRecord(
    value,
    ["cgroupFdHeld", "pidfdHeld", "initialPlacement", "fallbackUsed"],
    "SPAWN_COMMITTED evidence",
  );
  exactBoolean(evidence.cgroupFdHeld, true, "spawn cgroup descriptor latch");
  exactBoolean(evidence.pidfdHeld, true, "spawn pidfd latch");
  exactBoolean(evidence.initialPlacement, true, "initial placement latch");
  exactBoolean(evidence.fallbackUsed, false, "spawn fallback latch");
  return evidence;
}

function validatePidfdReady(value) {
  const evidence = exactRecord(
    value,
    ["mechanism", "bounded", "pidfdReadable"],
    "PIDFD_READY evidence",
  );
  if (evidence.mechanism !== "pidfd-poll") {
    fail("PIDFD_READY mechanism changed");
  }
  exactBoolean(evidence.bounded, true, "pidfd wait bound");
  exactBoolean(evidence.pidfdReadable, true, "pidfd readable latch");
  return evidence;
}

function validateCancelling(value, expectedReason) {
  const evidence = exactRecord(
    value,
    ["reason", "mechanism", "cgroupKillWritten"],
    "CANCELLING evidence",
  );
  if (
    evidence.reason !== expectedReason ||
    evidence.mechanism !== "cgroup.kill"
  ) {
    fail("CANCELLING evidence changed");
  }
  exactBoolean(evidence.cgroupKillWritten, true, "cgroup kill latch");
  return evidence;
}

function validateReaped(value) {
  const evidence = exactRecord(
    value,
    [
      "syscall",
      "idType",
      "options",
      "result",
      "siCode",
      "exitCode",
      "signal",
      "coreDumped",
    ],
    "DIRECT_CHILD_REAPED evidence",
  );
  exactDenseArray(evidence.options, ["WEXITED"], "waitid options");
  const exited =
    evidence.siCode === "CLD_EXITED" &&
    Number.isInteger(evidence.exitCode) &&
    !Object.is(evidence.exitCode, -0) &&
    evidence.exitCode >= 0 &&
    evidence.exitCode <= 255 &&
    evidence.signal === null &&
    evidence.coreDumped === false;
  const signalled =
    ["CLD_KILLED", "CLD_DUMPED"].includes(evidence.siCode) &&
    evidence.exitCode === null &&
    Number.isInteger(evidence.signal) &&
    evidence.signal > 0 &&
    evidence.signal < 128 &&
    evidence.coreDumped === (evidence.siCode === "CLD_DUMPED");
  if (
    evidence.syscall !== "waitid" ||
    evidence.idType !== "P_PIDFD" ||
    evidence.result !== "REAPED" ||
    (!exited && !signalled)
  ) {
    fail("DIRECT_CHILD_REAPED evidence changed");
  }
  return evidence;
}

function validateQuiescent(value) {
  const evidence = exactRecord(
    value,
    [
      "cgroupProcsBytes",
      "cgroupProcsSha256",
      "cgroupEventsBytes",
      "cgroupEventsSha256",
      "pidsCurrentBytes",
      "pidsCurrentSha256",
      "cgroupProcsEmpty",
      "cgroupPopulated",
      "pidsCurrent",
      "eventsRawSha256",
    ],
    "CGROUP_QUIESCENT evidence",
  );
  if (
    evidence.cgroupProcsBytes !== 0 ||
    evidence.cgroupProcsSha256 !== sha256(Buffer.alloc(0)) ||
    !Number.isSafeInteger(evidence.cgroupEventsBytes) ||
    evidence.cgroupEventsBytes < 1 ||
    evidence.cgroupEventsBytes > 4_096 ||
    digest(evidence.cgroupEventsSha256, "cgroup events digest") !==
      evidence.eventsRawSha256 ||
    evidence.pidsCurrentBytes !== 2 ||
    evidence.pidsCurrentSha256 !== sha256(bufferFrom("0\n", "utf8")) ||
    evidence.cgroupProcsEmpty !== true ||
    evidence.cgroupPopulated !== false ||
    evidence.pidsCurrent !== 0
  ) {
    fail("CGROUP_QUIESCENT evidence changed");
  }
  return evidence;
}

function validateRemoved(value) {
  const evidence = exactRecord(
    value,
    ["cgroupRemoved", "postCleanupOpen", "postCleanupStat"],
    "CGROUP_REMOVED evidence",
  );
  if (
    evidence.cgroupRemoved !== true ||
    evidence.postCleanupOpen !== "ENOENT" ||
    evidence.postCleanupStat !== "ENOENT"
  ) {
    fail("CGROUP_REMOVED evidence changed");
  }
  return evidence;
}

function validateDescriptorsClosed(value) {
  const evidence = exactRecord(
    value,
    ["cgroupFdClosed", "pidfdClosed"],
    "DESCRIPTORS_CLOSED evidence",
  );
  if (evidence.cgroupFdClosed !== true || evidence.pidfdClosed !== true) {
    fail("DESCRIPTORS_CLOSED evidence changed");
  }
  return evidence;
}

function validateClosed(value) {
  const evidence = exactRecord(value, ["cleanupSafe"], "CLOSED evidence");
  if (evidence.cleanupSafe !== true) fail("CLOSED evidence changed");
  return evidence;
}

function validateStatusEvidence(state, value, request, states, index) {
  switch (state) {
    case "ACQUIRED_EMPTY_CONFIGURED":
      return validateAcquired(value, request);
    case "CLONE_COMMIT_STARTED":
      return validateCloneCommit(value);
    case "SPAWN_COMMITTED":
      return validateSpawned(value);
    case "PIDFD_READY":
      return validatePidfdReady(value);
    case "CANCELLING":
      return validateCancelling(
        value,
        states[index - 1] === "DIRECT_CHILD_REAPED"
          ? "descendants-present"
          : "wait-failed",
      );
    case "DIRECT_CHILD_REAPED":
      return validateReaped(value);
    case "CGROUP_QUIESCENT":
      return validateQuiescent(value);
    case "CGROUP_REMOVED":
      return validateRemoved(value);
    case "DESCRIPTORS_CLOSED":
      return validateDescriptorsClosed(value);
    case "CLOSED":
      return validateClosed(value);
    default:
      fail(`status state ${state} is not accepted`);
  }
}

function validateObservation(value) {
  const observation = exactRecord(
    value,
    [
      "statusDeadlineMilliseconds",
      "statusTimedOut",
      "eofObserved",
      "eofCount",
      "eofAfterFinalFrame",
      "readError",
      "writerCountAtLaunch",
      "writerDuplicationObserved",
      "supervisorExitCode",
      "supervisorSignal",
      "supervisorReaped",
    ],
    "status observation",
  );
  if (
    observation.statusDeadlineMilliseconds !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2 ||
    observation.statusTimedOut !== false ||
    observation.eofObserved !== true ||
    observation.eofCount !== 1 ||
    observation.eofAfterFinalFrame !== true ||
    observation.readError !== null ||
    observation.writerCountAtLaunch !== 1 ||
    observation.writerDuplicationObserved !== false ||
    observation.supervisorExitCode !== 0 ||
    observation.supervisorSignal !== null ||
    observation.supervisorReaped !== true
  ) {
    fail("status observation is ambiguous or non-terminal");
  }
  return observation;
}

function acceptedSequence(states) {
  return acceptedStateSequences.some((expected) =>
    isDeepStrictEqual(states, expected),
  );
}

export function verifyCandidateContainmentSupervisorStatusV2(value) {
  const input = exactRecord(
    value,
    ["requestBytes", "statusBytes", "observation"],
    "status replay input",
  );
  const request = verifyCandidateContainmentSupervisorRequestV2(
    input.requestBytes,
  );
  validateObservation(input.observation);
  const decoded = decodeCanonicalJsonLines(input.statusBytes, {
    label: "status bytes",
    maximumBytes: CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2,
    minimumFrames: 1,
    maximumFrames: CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_FRAMES_V2,
    maximumFrameBytes:
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_FRAME_MAX_BYTES_V2,
  });
  const rawFrames = decoded.values.map((value, index) =>
    exactRecord(
      value,
      [
        "schema",
        "sequence",
        "state",
        "requestRawSha256",
        "ownerRequestSha256",
        "generationSha256",
        "evidence",
      ],
      `status frame ${index}`,
    ),
  );
  const states = rawFrames.map((frame) => frame.state);
  if (!acceptedSequence(states)) {
    fail("status lifecycle is not one exact cleanup-safe CLOSED sequence");
  }
  const frames = rawFrames.map((frame, index) => {
    if (
      frame.schema !== CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2 ||
      frame.sequence !== index ||
      frame.requestRawSha256 !== request.rawSha256 ||
      frame.ownerRequestSha256 !== request.ownerRequestSha256 ||
      frame.generationSha256 !== request.generationSha256
    ) {
      fail(`status frame ${index} identity changed`);
    }
    const evidence = validateStatusEvidence(
      frame.state,
      frame.evidence,
      request,
      states,
      index,
    );
    return deepFreeze(
      nullRecord([
        ["schema", frame.schema],
        ["sequence", index],
        ["state", frame.state],
        ["requestRawSha256", frame.requestRawSha256],
        ["ownerRequestSha256", frame.ownerRequestSha256],
        ["generationSha256", frame.generationSha256],
        ["evidence", evidence],
      ]),
    );
  });
  const evidenceFor = (state) =>
    frames.find((frame) => frame.state === state).evidence;
  const reap = evidenceFor("DIRECT_CHILD_REAPED");
  const quiescent = evidenceFor("CGROUP_QUIESCENT");
  const removed = evidenceFor("CGROUP_REMOVED");
  const descriptors = evidenceFor("DESCRIPTORS_CLOSED");
  const cancellation = frames.find((frame) => frame.state === "CANCELLING");
  const terminal = deepFreeze(
    nullRecord([
      ["directChildReaped", reap.result === "REAPED"],
      ["siCode", reap.siCode],
      ["exitCode", reap.exitCode],
      ["signal", reap.signal],
      ["coreDumped", reap.coreDumped],
      ["eventsRawSha256", quiescent.eventsRawSha256],
      ["cgroupProcsEmpty", quiescent.cgroupProcsEmpty],
      ["cgroupPopulated", quiescent.cgroupPopulated],
      ["pidsCurrent", quiescent.pidsCurrent],
      ["cgroupKillWritten", cancellation !== undefined],
      ["cgroupRemoved", removed.cgroupRemoved],
      ["postCleanupOpen", removed.postCleanupOpen],
      ["postCleanupStat", removed.postCleanupStat],
      ["cgroupFdClosed", descriptors.cgroupFdClosed],
      ["pidfdClosed", descriptors.pidfdClosed],
    ]),
  );
  const unsigned = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_PROJECTION_SCHEMA_V2],
    ["protocolSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2],
    ["status", "CLOSED_EOF_REPLAYED"],
    ["containment", "replayed"],
    ["request", request],
    ["states", Object.freeze([...states])],
    ["frameCount", frames.length],
    ["byteLength", decoded.bytes.length],
    ["rawSha256", sha256(decoded.bytes)],
    ["frames", Object.freeze(frames)],
    ["terminal", terminal],
    ["cleanupSafe", true],
    ["binding", null],
    ["physicalEligibility", false],
    ["finalDecisionEligible", false],
    ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2],
    ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}
