import { createHash, randomBytes } from "node:crypto";
import { types as utilTypes } from "node:util";

const digestPattern = /^[0-9a-f]{64}$/u;
const testTraceSchema = "oxigraph.candidate-containment-test-trace/v1";
const mechanicsMethods = Object.freeze([
  "acquire",
  "spawn",
  "wait",
  "terminate",
  "reap",
  "observeTerminal",
  "cleanup",
  "close",
]);
const readiness = Object.freeze({
  status: "unavailable",
  reason: "native-adapter-unavailable",
});
const trustedFaults = new WeakSet();
const trustedTestTraces = new WeakSet();
const testingAdmissions = new WeakMap();
const abortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const intrinsicAddEventListener =
  typeof EventTarget === "undefined"
    ? undefined
    : EventTarget.prototype.addEventListener;
const intrinsicRemoveEventListener =
  typeof EventTarget === "undefined"
    ? undefined
    : EventTarget.prototype.removeEventListener;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalOwnerRequestSha256(requestSha256, limits) {
  return sha256(
    Buffer.from(
      JSON.stringify({
        schema: "oxigraph.candidate-containment-owner-request/v1",
        requestSha256,
        limits,
      }),
      "utf8",
    ),
  );
}

function intrinsicSignalAborted(signal) {
  if (
    abortSignalAbortedGetter === undefined ||
    intrinsicAddEventListener === undefined ||
    intrinsicRemoveEventListener === undefined ||
    utilTypes.isProxy(signal)
  ) {
    throw new TypeError("candidate containment signal is invalid");
  }
  try {
    return Reflect.apply(abortSignalAbortedGetter, signal, []);
  } catch {
    throw new TypeError("candidate containment signal is invalid");
  }
}

function ownDataRecord(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain own-data record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !actual.includes(key)) ||
    actual.some((key) => {
      const descriptor = descriptors[key];
      return !(
        "value" in descriptor &&
        descriptor.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    })
  ) {
    throw new TypeError(`${label} fields are not exact data properties`);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function exactInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} is outside its exact bound`);
  }
  return value;
}

function snapshotInput(value) {
  const input = ownDataRecord(
    value,
    ["requestSha256", "limits", "signal"],
    "candidate containment input",
  );
  if (
    typeof input.requestSha256 !== "string" ||
    !digestPattern.test(input.requestSha256)
  ) {
    throw new TypeError("candidate containment input digest is invalid");
  }
  const rawLimits = ownDataRecord(
    input.limits,
    ["memoryMaxBytes", "memorySwapMaxBytes", "tasksMax", "wallMs"],
    "candidate containment limits",
  );
  const limits = Object.freeze({
    memoryMaxBytes: exactInteger(
      rawLimits.memoryMaxBytes,
      "candidate containment memory limit",
      256 * 1024 * 1024,
      64 * 1024 * 1024 * 1024,
    ),
    memorySwapMaxBytes: exactInteger(
      rawLimits.memorySwapMaxBytes,
      "candidate containment swap limit",
      0,
      0,
    ),
    tasksMax: exactInteger(
      rawLimits.tasksMax,
      "candidate containment task limit",
      512,
      512,
    ),
    wallMs: exactInteger(
      rawLimits.wallMs,
      "candidate containment wall limit",
      1000,
      7_200_000,
    ),
  });
  const signalAborted =
    input.signal === undefined ? false : intrinsicSignalAborted(input.signal);
  return Object.freeze({
    requestSha256: input.requestSha256,
    limits,
    signal: input.signal,
    signalAborted,
    ownerRequestSha256: canonicalOwnerRequestSha256(
      input.requestSha256,
      limits,
    ),
  });
}

function snapshotTestingOptions(value) {
  if (value === undefined) {
    return Object.freeze({ operationTimeoutMs: 2000 });
  }
  const options = ownDataRecord(
    value,
    ["operationTimeoutMs"],
    "candidate containment testing options",
  );
  return Object.freeze({
    operationTimeoutMs: exactInteger(
      options.operationTimeoutMs,
      "candidate containment test operation timeout",
      10,
      10_000,
    ),
  });
}

function snapshotMechanics(value) {
  const mechanics = ownDataRecord(
    value,
    mechanicsMethods,
    "candidate containment test mechanics",
  );
  for (const method of mechanicsMethods) {
    if (
      typeof mechanics[method] !== "function" ||
      utilTypes.isProxy(mechanics[method])
    ) {
      throw new TypeError(
        `candidate containment test mechanics.${method} is not a fixed function`,
      );
    }
  }
  return Object.freeze(mechanics);
}

function lifecycleSnapshot(state) {
  return Object.freeze([...state.lifecycle]);
}

class CandidateContainmentV2Fault extends Error {
  constructor(phase, reason, cleanupSafe, lifecycle) {
    super(`candidate containment ${phase}: ${reason}`);
    Object.defineProperty(this, "name", {
      value: "CandidateContainmentV2Fault",
    });
    this.phase = phase;
    this.reason = reason;
    this.cleanupSafe = cleanupSafe;
    this.lifecycle = Object.freeze([...lifecycle]);
    this.stack = `${this.name}: ${this.message}`;
    trustedFaults.add(this);
    Object.freeze(this);
  }
}

function fault(phase, reason, cleanupSafe, stateOrLifecycle) {
  const lifecycle = Array.isArray(stateOrLifecycle)
    ? stateOrLifecycle
    : stateOrLifecycle.lifecycle;
  return new CandidateContainmentV2Fault(phase, reason, cleanupSafe, lifecycle);
}

export function isCandidateContainmentV2Fault(error) {
  try {
    return (
      error instanceof CandidateContainmentV2Fault && trustedFaults.has(error)
    );
  } catch {
    return false;
  }
}

export function isCandidateContainmentV2TestTrace(value) {
  try {
    return trustedTestTraces.has(value);
  } catch {
    return false;
  }
}

function transition(state, next) {
  state.lifecycle.push(next);
}

function markRetained(state, retainedStates) {
  if (state.lifecycle.at(-1) !== "FAILED_RETAINED") {
    transition(state, "FAILED_RETAINED");
  }
  state.retained = true;
  retainedStates.add(state);
}

function exactStringArray(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError(`${label} is not an exact dense array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const expectedKeys = [
    "length",
    ...Array.from({ length: expected.length }, (_, index) => String(index)),
  ];
  if (
    descriptors.length?.value !== expected.length ||
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !keys.includes(key)) ||
    expected.some((item, index) => descriptors[index]?.value !== item)
  ) {
    throw new TypeError(`${label} changed`);
  }
  return Object.freeze([...expected]);
}

function normalizeAcquisition(value, limits, generationSha256, state) {
  const acquisition = ownDataRecord(
    value,
    ["resource", "generation", "cgroup", "readback"],
    "candidate containment acquisition",
  );
  if (
    acquisition.resource === null ||
    !["object", "function"].includes(typeof acquisition.resource) ||
    utilTypes.isProxy(acquisition.resource)
  ) {
    throw new TypeError("candidate containment resource identity is invalid");
  }
  state.resource = acquisition.resource;
  const generation = ownDataRecord(
    acquisition.generation,
    ["source", "sha256", "fresh", "reusable", "exclusiveAdmission"],
    "candidate containment generation",
  );
  const cgroup = ownDataRecord(
    acquisition.cgroup,
    ["filesystem", "descriptorHeld", "accessMode", "type", "initialProcs"],
    "candidate containment cgroup identity",
  );
  if (
    generation.source !== "owner-random-256" ||
    generation.sha256 !== generationSha256 ||
    generation.fresh !== true ||
    generation.reusable !== false ||
    generation.exclusiveAdmission !== true ||
    cgroup.filesystem !== "cgroup2" ||
    cgroup.descriptorHeld !== true ||
    cgroup.accessMode !== "O_RDONLY|O_DIRECTORY|O_CLOEXEC" ||
    cgroup.type !== "domain\n" ||
    cgroup.initialProcs !== ""
  ) {
    throw new TypeError(
      "candidate containment fresh child-free cgroup is unproved",
    );
  }
  state.childFreeAcquisitionProven = true;
  transition(state, "ACQUIRED_EMPTY_CONFIGURED");
  const readback = ownDataRecord(
    acquisition.readback,
    ["memoryMax", "memorySwapMax", "pidsMax"],
    "candidate containment limit readback",
  );
  if (
    readback.memoryMax !== `${limits.memoryMaxBytes}\n` ||
    readback.memorySwapMax !== "0\n" ||
    readback.pidsMax !== `${limits.tasksMax}\n`
  ) {
    throw new TypeError("candidate containment acquisition readback changed");
  }
  return Object.freeze({
    generation: Object.freeze({
      source: "owner-random-256",
      sha256: generationSha256,
      fresh: true,
      reusable: false,
      exclusiveAdmission: true,
    }),
    cgroup: Object.freeze({
      filesystem: "cgroup2",
      descriptorHeld: true,
      accessMode: "O_RDONLY|O_DIRECTORY|O_CLOEXEC",
      type: "domain",
      initialProcsEmpty: true,
    }),
    limitsExact: true,
  });
}

function normalizePlacement(value, state) {
  const spawned = ownDataRecord(
    value,
    ["child", "placement"],
    "candidate containment clone result",
  );
  if (
    spawned.child === null ||
    !["object", "function"].includes(typeof spawned.child) ||
    utilTypes.isProxy(spawned.child)
  ) {
    throw new TypeError("candidate containment child identity is invalid");
  }
  const placement = ownDataRecord(
    spawned.placement,
    [
      "syscall",
      "cloneArgsSize",
      "flags",
      "exitSignal",
      "cgroupFdHeld",
      "pidfdHeld",
      "initialPlacement",
      "fallbackUsed",
    ],
    "candidate containment placement",
  );
  const flags = exactStringArray(
    placement.flags,
    ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
    "candidate containment clone flags",
  );
  if (
    placement.syscall !== "clone3" ||
    placement.cloneArgsSize !== 88 ||
    placement.exitSignal !== "SIGCHLD" ||
    placement.cgroupFdHeld !== true ||
    placement.pidfdHeld !== true ||
    placement.initialPlacement !== true ||
    placement.fallbackUsed !== false
  ) {
    throw new TypeError("candidate containment placement changed");
  }
  state.child = spawned.child;
  transition(state, "SPAWN_COMMITTED");
  transition(state, "RUNNING");
  return Object.freeze({
    syscall: "clone3",
    cloneArgsSize: 88,
    flags,
    exitSignal: "SIGCHLD",
    cgroupFdHeld: true,
    pidfdHeld: true,
    initialPlacement: true,
    fallbackUsed: false,
  });
}

function normalizeWait(value) {
  const wait = ownDataRecord(
    value,
    ["mechanism", "bounded", "pidfdReadable"],
    "candidate containment pidfd wait",
  );
  if (
    wait.mechanism !== "pidfd-poll" ||
    wait.bounded !== true ||
    wait.pidfdReadable !== true
  ) {
    throw new TypeError("candidate containment pidfd did not become readable");
  }
  return Object.freeze({
    mechanism: "pidfd-poll",
    bounded: true,
    pidfdReadable: true,
  });
}

function normalizeTermination(value) {
  const termination = ownDataRecord(
    value,
    ["mechanism", "cgroupKillWritten"],
    "candidate containment termination",
  );
  if (
    termination.mechanism !== "cgroup.kill" ||
    termination.cgroupKillWritten !== true
  ) {
    throw new TypeError("candidate containment cgroup kill was not written");
  }
  return Object.freeze({ cgroupKillWritten: true });
}

function normalizeReap(value) {
  const reap = ownDataRecord(
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
    "candidate containment waitid result",
  );
  const options = exactStringArray(
    reap.options,
    ["WEXITED"],
    "candidate containment waitid options",
  );
  const exited =
    reap.siCode === "CLD_EXITED" &&
    Number.isInteger(reap.exitCode) &&
    reap.exitCode >= 0 &&
    reap.exitCode <= 255 &&
    reap.signal === null &&
    reap.coreDumped === false;
  const signalled =
    ["CLD_KILLED", "CLD_DUMPED"].includes(reap.siCode) &&
    reap.exitCode === null &&
    Number.isInteger(reap.signal) &&
    reap.signal > 0 &&
    reap.signal < 128 &&
    reap.coreDumped === (reap.siCode === "CLD_DUMPED");
  if (
    reap.syscall !== "waitid" ||
    reap.idType !== "P_PIDFD" ||
    reap.result !== "REAPED" ||
    (!exited && !signalled)
  ) {
    throw new TypeError("candidate containment waitid result changed");
  }
  return Object.freeze({
    syscall: "waitid",
    idType: "P_PIDFD",
    options,
    result: "REAPED",
    siCode: reap.siCode,
    exitCode: reap.exitCode,
    signal: reap.signal,
    coreDumped: reap.coreDumped,
  });
}

class NonEmptyCgroupObservation extends Error {}

function parseCgroupEvents(text) {
  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > 4096 ||
    !text.endsWith("\n") ||
    text.includes("\r") ||
    text.includes("\0")
  ) {
    throw new TypeError("candidate containment cgroup events are malformed");
  }
  const rows = text.slice(0, -1).split("\n");
  if (rows.length < 1 || rows.length > 32) {
    throw new TypeError(
      "candidate containment cgroup events exceed their bound",
    );
  }
  const events = new Map();
  for (const row of rows) {
    const match = /^([a-z][a-z0-9_.-]{0,63}) (0|[1-9][0-9]{0,19})$/u.exec(row);
    if (match === null || events.has(match[1])) {
      throw new TypeError("candidate containment cgroup events are malformed");
    }
    events.set(match[1], match[2]);
  }
  if (
    !events.has("populated") ||
    (events.has("frozen") && !["0", "1"].includes(events.get("frozen")))
  ) {
    throw new TypeError("candidate containment cgroup events are incomplete");
  }
  return Object.freeze({
    populated: events.get("populated"),
    frozen: events.get("frozen") ?? null,
    rawSha256: sha256(Buffer.from(text, "utf8")),
  });
}

function normalizeTerminal(value) {
  const terminal = ownDataRecord(
    value,
    ["cgroupProcs", "cgroupEvents", "pidsCurrent"],
    "candidate containment terminal observation",
  );
  const events = parseCgroupEvents(terminal.cgroupEvents);
  if (
    typeof terminal.cgroupProcs !== "string" ||
    terminal.cgroupProcs.length > 4096 ||
    typeof terminal.pidsCurrent !== "string" ||
    terminal.pidsCurrent.length > 64
  ) {
    throw new TypeError(
      "candidate containment terminal bytes exceed their bound",
    );
  }
  if (
    terminal.cgroupProcs !== "" ||
    events.populated !== "0" ||
    (events.frozen !== null && events.frozen !== "0") ||
    terminal.pidsCurrent !== "0\n"
  ) {
    throw new NonEmptyCgroupObservation(
      "candidate containment cgroup is not terminal-empty",
    );
  }
  return Object.freeze({
    cgroupProcsEmpty: true,
    cgroupPopulated: false,
    pidsCurrent: 0,
    eventsRawSha256: events.rawSha256,
  });
}

function normalizeCleanup(value) {
  const cleanup = ownDataRecord(
    value,
    ["cgroupRemoved", "postCleanupOpen", "postCleanupStat"],
    "candidate containment cleanup",
  );
  if (
    cleanup.cgroupRemoved !== true ||
    cleanup.postCleanupOpen !== "ENOENT" ||
    cleanup.postCleanupStat !== "ENOENT"
  ) {
    throw new TypeError("candidate containment cgroup removal is unproved");
  }
}

function normalizeClose(value, childPresent) {
  const close = ownDataRecord(
    value,
    ["cgroupFdClosed", "pidfdClosed"],
    "candidate containment descriptor close",
  );
  if (
    close.cgroupFdClosed !== true ||
    close.pidfdClosed !== (childPresent ? true : null)
  ) {
    throw new TypeError("candidate containment descriptors did not close");
  }
}

class OperationBoundaryFault extends Error {
  constructor(reason, pending) {
    super(reason);
    this.reason = reason;
    this.pending = pending;
  }
}

async function invokeMechanic(
  state,
  mechanics,
  method,
  value,
  { operationTimeoutMs, signal },
) {
  if (signal !== undefined && intrinsicSignalAborted(signal)) {
    throw new OperationBoundaryFault("aborted-before-operation", false);
  }
  const record = {
    method,
    boundaryWon: false,
    settled: false,
    outcome: "pending",
    value: undefined,
    reason: undefined,
    promise: undefined,
  };
  const operation = Promise.resolve().then(() =>
    Reflect.apply(mechanics[method], undefined, [value]),
  );
  record.promise = operation;
  state.pendingOperations.add(record);
  void operation.then(
    (result) => {
      record.settled = true;
      record.outcome = "fulfilled";
      record.value = result;
      if (!record.boundaryWon) state.pendingOperations.delete(record);
    },
    (error) => {
      record.settled = true;
      record.outcome = "rejected";
      record.reason = error;
      if (!record.boundaryWon) state.pendingOperations.delete(record);
    },
  );
  let timeout;
  let abortListener;
  const races = [
    operation,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        record.boundaryWon = true;
        reject(new OperationBoundaryFault("operation-timeout", true));
      }, operationTimeoutMs);
    }),
  ];
  if (signal !== undefined) {
    races.push(
      new Promise((_, reject) => {
        abortListener = () => {
          record.boundaryWon = true;
          reject(new OperationBoundaryFault("operation-aborted", true));
        };
        Reflect.apply(intrinsicAddEventListener, signal, [
          "abort",
          abortListener,
          { once: true },
        ]);
        if (intrinsicSignalAborted(signal)) abortListener();
      }),
    );
  }
  try {
    return await Promise.race(races);
  } finally {
    clearTimeout(timeout);
    if (signal !== undefined && abortListener !== undefined) {
      Reflect.apply(intrinsicRemoveEventListener, signal, [
        "abort",
        abortListener,
      ]);
    }
  }
}

async function closeProvenChildFreeResource(
  state,
  mechanics,
  retainedStates,
  testingOptions,
  originalPhase,
  originalReason,
) {
  transition(state, "CLEANING");
  try {
    normalizeCleanup(
      await invokeMechanic(
        state,
        mechanics,
        "cleanup",
        { resource: state.resource },
        { ...testingOptions, signal: undefined },
      ),
    );
  } catch {
    markRetained(state, retainedStates);
    throw fault("cleanup", "pre-spawn-cleanup-uncertain", false, state);
  }
  transition(state, "CGROUP_REMOVED");
  try {
    normalizeClose(
      await invokeMechanic(
        state,
        mechanics,
        "close",
        { resource: state.resource, child: undefined },
        { ...testingOptions, signal: undefined },
      ),
      false,
    );
  } catch {
    markRetained(state, retainedStates);
    throw fault("close", "pre-spawn-close-uncertain", false, state);
  }
  transition(state, "DESCRIPTORS_CLOSED");
  transition(state, "CLOSED");
  throw fault(originalPhase, originalReason, true, state);
}

async function reapQuiesceAndClose(
  state,
  mechanics,
  retainedStates,
  testingOptions,
) {
  try {
    state.reap = normalizeReap(
      await invokeMechanic(
        state,
        mechanics,
        "reap",
        { resource: state.resource, child: state.child },
        { ...testingOptions, signal: undefined },
      ),
    );
  } catch {
    markRetained(state, retainedStates);
    throw fault("reap", "direct-child-reap-uncertain", false, state);
  }
  transition(state, "DIRECT_CHILD_REAPED");

  try {
    state.terminal = normalizeTerminal(
      await invokeMechanic(
        state,
        mechanics,
        "observeTerminal",
        { resource: state.resource },
        { ...testingOptions, signal: undefined },
      ),
    );
  } catch (error) {
    if (
      error instanceof NonEmptyCgroupObservation &&
      state.terminationAttempted !== true
    ) {
      transition(state, "CANCELLING");
      state.terminationAttempted = true;
      try {
        normalizeTermination(
          await invokeMechanic(
            state,
            mechanics,
            "terminate",
            { resource: state.resource, child: state.child },
            { ...testingOptions, signal: undefined },
          ),
        );
      } catch {
        markRetained(state, retainedStates);
        throw fault(
          "terminate",
          "descendant-termination-uncertain",
          false,
          state,
        );
      }
      try {
        state.terminal = normalizeTerminal(
          await invokeMechanic(
            state,
            mechanics,
            "observeTerminal",
            { resource: state.resource },
            { ...testingOptions, signal: undefined },
          ),
        );
      } catch {
        markRetained(state, retainedStates);
        throw fault("quiescence", "terminal-cgroup-uncertain", false, state);
      }
    } else {
      markRetained(state, retainedStates);
      throw fault("quiescence", "terminal-cgroup-uncertain", false, state);
    }
  }
  transition(state, "CGROUP_QUIESCENT");
  transition(state, "CLEANING");

  try {
    normalizeCleanup(
      await invokeMechanic(
        state,
        mechanics,
        "cleanup",
        { resource: state.resource },
        { ...testingOptions, signal: undefined },
      ),
    );
  } catch {
    markRetained(state, retainedStates);
    throw fault("cleanup", "cgroup-removal-uncertain", false, state);
  }
  transition(state, "CGROUP_REMOVED");
  try {
    normalizeClose(
      await invokeMechanic(
        state,
        mechanics,
        "close",
        { resource: state.resource, child: state.child },
        { ...testingOptions, signal: undefined },
      ),
      true,
    );
  } catch {
    markRetained(state, retainedStates);
    throw fault("close", "descriptor-close-uncertain", false, state);
  }
  transition(state, "DESCRIPTORS_CLOSED");
  transition(state, "CLOSED");
}

function createTestTrace(state, input) {
  const trace = Object.freeze({
    schema: testTraceSchema,
    containment: "simulated",
    productionAuthority: false,
    cleanupSafe: true,
    requestSha256: input.requestSha256,
    ownerRequestSha256: input.ownerRequestSha256,
    limits: input.limits,
    lifecycle: lifecycleSnapshot(state),
    acquisition: state.acquisition,
    placement: state.placement,
    supervision: Object.freeze({
      wait: state.wait,
      reap: state.reap,
    }),
    terminal: state.terminal,
  });
  trustedTestTraces.add(trace);
  return trace;
}

async function runTestOwner(inputValue, mechanics, admission, testingOptions) {
  const retainedStates = admission.retainedStates;
  const input = snapshotInput(inputValue);
  const state = {
    lifecycle: ["NEW"],
    resource: undefined,
    child: undefined,
    retained: false,
    childFreeAcquisitionProven: false,
    terminationAttempted: false,
    pendingOperations: new Set(),
  };
  if (input.signalAborted) {
    throw fault("preflight", "already-aborted", true, state);
  }
  const generationSha256 = sha256(randomBytes(32));
  if (admission.generationDigests.has(generationSha256)) {
    throw fault("preflight", "generation-reuse", false, state);
  }
  admission.generationDigests.add(generationSha256);

  let acquisitionValue;
  transition(state, "ACQUIRING");
  try {
    acquisitionValue = await invokeMechanic(
      state,
      mechanics,
      "acquire",
      {
        requestSha256: input.requestSha256,
        ownerRequestSha256: input.ownerRequestSha256,
        generationSha256,
        limits: input.limits,
        signal: input.signal,
      },
      { ...testingOptions, signal: undefined },
    );
    state.acquisitionValue = acquisitionValue;
    state.acquisition = normalizeAcquisition(
      acquisitionValue,
      input.limits,
      generationSha256,
      state,
    );
  } catch (error) {
    if (state.childFreeAcquisitionProven) {
      await closeProvenChildFreeResource(
        state,
        mechanics,
        retainedStates,
        testingOptions,
        "acquire",
        "limit-or-empty-readback-mismatch",
      );
    }
    state.acquisitionValue = acquisitionValue;
    markRetained(state, retainedStates);
    throw fault("acquire", "acquisition-uncertain", false, state);
  }

  if (input.signal !== undefined && intrinsicSignalAborted(input.signal)) {
    await closeProvenChildFreeResource(
      state,
      mechanics,
      retainedStates,
      testingOptions,
      "cancel",
      "aborted-before-clone",
    );
  }
  let spawnValue;
  transition(state, "CLONE_COMMIT_STARTED");
  try {
    spawnValue = await invokeMechanic(
      state,
      mechanics,
      "spawn",
      {
        resource: state.resource,
        ownerRequestSha256: input.ownerRequestSha256,
        signal: input.signal,
      },
      { ...testingOptions, signal: input.signal },
    );
    state.spawnValue = spawnValue;
    state.placement = normalizePlacement(spawnValue, state);
  } catch {
    state.spawnValue = spawnValue;
    markRetained(state, retainedStates);
    throw fault("spawn", "clone-commitment-uncertain", false, state);
  }

  let waitFailed = false;
  try {
    state.wait = normalizeWait(
      await invokeMechanic(
        state,
        mechanics,
        "wait",
        {
          resource: state.resource,
          child: state.child,
          wallMs: input.limits.wallMs,
          signal: input.signal,
        },
        { ...testingOptions, signal: input.signal },
      ),
    );
  } catch (error) {
    waitFailed = true;
    transition(state, "CANCELLING");
    state.terminationAttempted = true;
    try {
      normalizeTermination(
        await invokeMechanic(
          state,
          mechanics,
          "terminate",
          { resource: state.resource, child: state.child },
          { ...testingOptions, signal: undefined },
        ),
      );
    } catch {
      markRetained(state, retainedStates);
      throw fault(
        "terminate",
        "whole-cgroup-termination-uncertain",
        false,
        state,
      );
    }
    if (error instanceof OperationBoundaryFault && error.pending) {
      markRetained(state, retainedStates);
      throw fault("wait", "child-wait-pending", false, state);
    }
  }

  await reapQuiesceAndClose(state, mechanics, retainedStates, testingOptions);
  if (waitFailed) {
    throw fault("wait", "child-wait-failed", true, state);
  }
  return createTestTrace(state, input);
}

/** Fixed preflight. It performs no filesystem access and starts no process. */
export function candidateContainmentOwnerV2Readiness() {
  return readiness;
}

/**
 * Production has no mechanics injection. It stays unavailable until the
 * candidate-specific sealed native adapter is implemented and reviewed.
 */
export async function runCandidateContainmentOwnerV2(inputValue) {
  const input = snapshotInput(inputValue);
  if (input.signalAborted) {
    throw fault("preflight", "already-aborted", true, Object.freeze(["NEW"]));
  }
  throw fault(
    "preflight",
    "native-adapter-unavailable",
    true,
    Object.freeze(["NEW"]),
  );
}

/** Explicit test-only lifecycle seam; its trace can never mint authority. */
export function createCandidateContainmentOwnerV2ForTesting(
  mechanicsValue,
  optionsValue,
) {
  const mechanics = snapshotMechanics(mechanicsValue);
  const testingOptions = snapshotTestingOptions(optionsValue);
  let admission = testingAdmissions.get(mechanicsValue);
  if (admission === undefined) {
    admission = {
      active: false,
      retainedStates: new Set(),
      generationDigests: new Set(),
    };
    testingAdmissions.set(mechanicsValue, admission);
  }
  let consumed = false;
  return Object.freeze({
    async run(inputValue) {
      if (consumed) {
        throw new Error(
          "candidate containment test capability already consumed",
        );
      }
      consumed = true;
      if (admission.retainedStates.size > 0) {
        throw fault(
          "preflight",
          "retained-admission-blocked",
          false,
          Object.freeze(["NEW", "FAILED_RETAINED"]),
        );
      }
      if (admission.active) {
        throw fault(
          "preflight",
          "concurrent-admission-blocked",
          false,
          Object.freeze(["NEW"]),
        );
      }
      admission.active = true;
      try {
        return await runTestOwner(
          inputValue,
          mechanics,
          admission,
          testingOptions,
        );
      } finally {
        admission.active = false;
      }
    },
    retainedStateCountForTesting() {
      return admission.retainedStates.size;
    },
    pendingOperationCountForTesting() {
      return [...admission.retainedStates].reduce(
        (total, state) => total + state.pendingOperations.size,
        0,
      );
    },
    hasRetainedOperationValueForTesting(value) {
      return [...admission.retainedStates].some((state) =>
        [...state.pendingOperations].some((record) => record.value === value),
      );
    },
    retainedOperationStatesForTesting() {
      return Object.freeze(
        [...admission.retainedStates].flatMap((state) =>
          [...state.pendingOperations].map((record) =>
            Object.freeze({
              method: record.method,
              boundaryWon: record.boundaryWon,
              settled: record.settled,
              outcome: record.outcome,
            }),
          ),
        ),
      );
    },
  });
}
