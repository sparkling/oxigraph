import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { assembleCandidatePatchV2 } from "../policy/paths-v2.mjs";
import {
  isTaskV2Failure,
  mapTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "../policy/task-v2-failures.mjs";
import { evaluateWorkerProcessProofV2 } from "../policy/worker-process-proof-v2.mjs";
import { validateWorkerRole } from "../policy/authority.mjs";
import { validateWorkerOutputV2 } from "../policy/worker-output-v2.mjs";
import { assertSealedTaskV2WorkerContext } from "../runtime/task-context-v2.mjs";
import { nativeWorkerTimeoutMs } from "../policy/native-timeouts.mjs";
import { workerOutputV2SchemaPath } from "./worker-schema.mjs";
import { claudeInvocation } from "./claude.mjs";
import { codexInvocation } from "./codex.mjs";
import { runBoundedProcessBytes } from "./process.mjs";
import {
  astraWorkerPromptGuidance,
  validateAstraReasoningEffort,
} from "../policy/astra-routing.mjs";

const MAX_TASK_BYTES = 2_097_152;
const MAX_CONTRACT_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_DIRECTIVE_BYTES = 16_384;
const MAX_ROLE_INPUT_BYTES = 524_288;
const PATCH_PARSE_TIMEOUT_MS = 30_000;
const PATCH_PARSE_OUTPUT_BYTES = 65_536;
const READ_CHUNK_BYTES = 64 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const REQUEST_SCHEMA = "oxigraph.engineering-native-worker-request/v2";
const REQUEST_DOMAIN = Buffer.from(`${REQUEST_SCHEMA}\0`, "ascii");
const V2_SCHEMA_BYTES = readFileSync(workerOutputV2SchemaPath);
const V2_SCHEMA_SHA256 = createHash("sha256")
  .update(V2_SCHEMA_BYTES)
  .digest("hex");
const V2_SCHEMA_STAT = statSync(workerOutputV2SchemaPath);
const V2_SCHEMA_EXPECTED = Object.freeze({
  sha256: V2_SCHEMA_SHA256,
  size: V2_SCHEMA_STAT.size,
  mode: V2_SCHEMA_STAT.mode & 0o777,
  uid: V2_SCHEMA_STAT.uid,
  gid: V2_SCHEMA_STAT.gid,
});
const V2_CLAUDE_SCHEMA = (() => {
  const schema = JSON.parse(V2_SCHEMA_BYTES.toString("utf8"));
  delete schema.$schema;
  return JSON.stringify(schema);
})();
const productionRequests = new WeakMap();
const productionPatchParseResults = new WeakSet();
const nativeAbortSignalPrototype = AbortSignal.prototype;
const nativeAbortedGetter = Object.getOwnPropertyDescriptor(
  nativeAbortSignalPrototype,
  "aborted",
).get;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeTypedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
).get;
const nativeTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
).get;
const nativeTypedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
).get;
const MAX_PINNED_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const PIN_READ_BYTES = 1024 * 1024;
const GIT_EXECUTABLE_PATH = "/usr/bin/git";
const GIT_EXECUTABLE_STAT = statSync(GIT_EXECUTABLE_PATH);
const GIT_EXECUTABLE_EXPECTED = Object.freeze({
  sha256: sha256(readFileSync(GIT_EXECUTABLE_PATH)),
  size: GIT_EXECUTABLE_STAT.size,
  mode: GIT_EXECUTABLE_STAT.mode & 0o777,
  uid: GIT_EXECUTABLE_STAT.uid,
  gid: GIT_EXECUTABLE_STAT.gid,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function copyPrivateBytes(
  value,
  maximumBytes,
  label,
  allowEmpty = false,
  failureCode = "ERR_RECONSTRUCTION",
) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !utilTypes.isUint8Array(value)
  ) {
    fail(failureCode, `${label} must be private raw bytes`);
  }
  let buffer;
  let byteLength;
  let byteOffset;
  try {
    buffer = nativeTypedArrayBufferGetter.call(value);
    byteLength = nativeTypedArrayByteLengthGetter.call(value);
    byteOffset = nativeTypedArrayByteOffsetGetter.call(value);
  } catch (error) {
    fail(failureCode, error);
  }
  if (
    utilTypes.isSharedArrayBuffer(buffer) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    (!allowEmpty && byteLength === 0) ||
    byteLength > maximumBytes ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0
  ) {
    fail(failureCode, `${label} is outside its byte ceiling`);
  }
  try {
    return Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
  } catch (error) {
    fail(failureCode, error);
  }
}

function samePinnedStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function hashPinnedDescriptor(fd, size) {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(PIN_READ_BYTES, size || 1));
  let position = 0;
  while (position < size) {
    const bytesRead = readSync(
      fd,
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    if (bytesRead === 0) {
      fail("ERR_INTERNAL_FAIL_CLOSED", "pinned file ended during hashing");
    }
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex");
}

function pinReadOnlyRegularFile(path, expected, maximumBytes, label) {
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0),
    );
    const before = fstatSync(fd, { bigint: true });
    const size = Number(before.size);
    if (
      !before.isFile() ||
      before.size <= 0n ||
      !Number.isSafeInteger(size) ||
      size > maximumBytes ||
      size !== expected.size ||
      Number(before.mode & 0o777n) !== expected.mode ||
      Number(before.uid) !== expected.uid ||
      Number(before.gid) !== expected.gid
    ) {
      fail("ERR_INTERNAL_FAIL_CLOSED", `${label} identity is not exact`);
    }
    const digest = hashPinnedDescriptor(fd, size);
    const after = fstatSync(fd, { bigint: true });
    if (!samePinnedStat(before, after) || digest !== expected.sha256) {
      fail("ERR_INTERNAL_FAIL_CLOSED", `${label} bytes changed while pinned`);
    }
    return Object.freeze({
      fd,
      sha256: digest,
      size,
      mode: Number(before.mode & 0o777n),
      uid: Number(before.uid),
      gid: Number(before.gid),
      label,
      snapshot: Object.freeze({
        dev: before.dev,
        ino: before.ino,
        nlink: before.nlink,
        size: before.size,
        mode: before.mode,
        uid: before.uid,
        gid: before.gid,
        mtimeNs: before.mtimeNs,
        ctimeNs: before.ctimeNs,
      }),
    });
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_INTERNAL_FAIL_CLOSED", error);
  }
}

function verifyPinnedFile(file) {
  try {
    const before = fstatSync(file.fd, { bigint: true });
    const digest = hashPinnedDescriptor(file.fd, file.size);
    const after = fstatSync(file.fd, { bigint: true });
    if (
      !samePinnedStat(file.snapshot, before) ||
      !samePinnedStat(before, after) ||
      digest !== file.sha256
    ) {
      fail(
        "ERR_INTERNAL_FAIL_CLOSED",
        `${file.label} bytes changed during execution`,
      );
    }
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_INTERNAL_FAIL_CLOSED", error);
  }
}

function verifyPinnedFiles(files) {
  for (const file of files) verifyPinnedFile(file);
}

function closePinnedFiles(files) {
  for (const file of files) {
    try {
      closeSync(file.fd);
    } catch {}
  }
}

function fail(code, detail) {
  throw taskV2Failure(code, detail);
}

function exactRecord(value, expectedKeys, label) {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      utilTypes.isProxy(value) ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      fail("ERR_RECONSTRUCTION", `${label} must be a plain own-data record`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !keys.includes(key)) ||
      keys.some(
        (key) =>
          !("value" in descriptors[key]) ||
          descriptors[key].enumerable !== true,
      )
    ) {
      fail("ERR_RECONSTRUCTION", `${label} keys are not exact own data`);
    }
    return Object.fromEntries(
      expectedKeys.map((key) => [key, descriptors[key].value]),
    );
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_RECONSTRUCTION", error);
  }
}

function exactUtf8(value, maximumBytes, label) {
  if (
    typeof value !== "string" ||
    value.length > maximumBytes ||
    value.includes("\0")
  ) {
    fail("ERR_RECONSTRUCTION", `${label} must be NUL-free UTF-8 text`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    fail("ERR_RECONSTRUCTION", `${label} is outside its byte ceiling`);
  }
  let decoded;
  try {
    decoded = UTF8.decode(bytes);
  } catch (error) {
    fail("ERR_RECONSTRUCTION", error);
  }
  if (decoded !== value)
    fail("ERR_RECONSTRUCTION", `${label} is not exact UTF-8`);
  return value;
}

function captureJson(
  value,
  label,
  state = { nodes: 0, scalarBytes: 0, seen: new Set() },
) {
  state.nodes += 1;
  if (state.nodes > 16_384) {
    fail("ERR_RECONSTRUCTION", `${label} exceeds its structural ceiling`);
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    state.scalarBytes += Buffer.byteLength(value, "utf8");
    if (state.scalarBytes > MAX_ROLE_INPUT_BYTES) {
      fail("ERR_RECONSTRUCTION", `${label} exceeds its byte ceiling`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("ERR_RECONSTRUCTION", `${label} contains a non-finite number`);
    }
    return value;
  }
  if (typeof value !== "object") {
    fail("ERR_RECONSTRUCTION", `${label} is not an exact JSON value`);
  }
  if (utilTypes.isProxy(value)) {
    fail("ERR_RECONSTRUCTION", `${label} must not be a Proxy`);
  }
  if (state.seen.has(value)) {
    fail("ERR_RECONSTRUCTION", `${label} contains a cycle`);
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail("ERR_RECONSTRUCTION", `${label} must use a plain array`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = descriptors.length?.value;
      const keys = Reflect.ownKeys(descriptors);
      if (!Number.isSafeInteger(length) || length < 0 || length > 4096) {
        fail("ERR_RECONSTRUCTION", `${label} is not an exact dense array`);
      }
      const expected = new Set([
        "length",
        ...Array.from({ length }, (_, index) => String(index)),
      ]);
      if (
        keys.some((key) => typeof key !== "string") ||
        keys.length !== expected.size ||
        keys.some((key) => !expected.has(key))
      ) {
        fail("ERR_RECONSTRUCTION", `${label} is not an exact dense array`);
      }
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          fail("ERR_RECONSTRUCTION", `${label} contains non-data authority`);
        }
        result.push(captureJson(descriptor.value, `${label}[${index}]`, state));
      }
      return result;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      fail("ERR_RECONSTRUCTION", `${label} must use a plain record`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length > 4096 ||
      keys.some((key) => typeof key !== "string") ||
      keys.some(
        (key) =>
          !("value" in descriptors[key]) ||
          descriptors[key].enumerable !== true,
      )
    ) {
      fail("ERR_RECONSTRUCTION", `${label} contains non-data authority`);
    }
    for (const key of keys) {
      state.scalarBytes += Buffer.byteLength(key, "utf8");
      if (state.scalarBytes > MAX_ROLE_INPUT_BYTES) {
        fail("ERR_RECONSTRUCTION", `${label} exceeds its byte ceiling`);
      }
    }
    return Object.fromEntries(
      keys.map((key, index) => [
        key,
        captureJson(descriptors[key].value, `${label}{${index}}`, state),
      ]),
    );
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_RECONSTRUCTION", error);
  } finally {
    state.seen.delete(value);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function routingSelection(contract, provider) {
  if (provider !== "codex" && provider !== "claude") {
    fail(
      "ERR_RECONSTRUCTION",
      "v2 worker provider must be native Codex or Claude",
    );
  }
  const matches = contract.routing.providers.filter(
    (entry) => entry.provider === provider && entry.transport === "native",
  );
  if (matches.length !== 1 || /openrouter/iu.test(matches[0].model)) {
    fail(
      "ERR_RECONSTRUCTION",
      "v2 worker provider/model is not contract-bound",
    );
  }
  let reasoningEffort;
  try {
    reasoningEffort = validateAstraReasoningEffort(
      matches[0].model,
      matches[0].reasoningEffort ?? null,
    );
    if (provider !== "codex" && reasoningEffort !== null) {
      fail(
        "ERR_RECONSTRUCTION",
        "reasoning effort is supported only for native Codex",
      );
    }
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_RECONSTRUCTION", error);
  }
  return Object.freeze({ model: matches[0].model, reasoningEffort });
}

function captureAbortSignal(value) {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== nativeAbortSignalPrototype
  ) {
    fail("ERR_RECONSTRUCTION", "v2 worker signal must be a native AbortSignal");
  }
  try {
    nativeAbortedGetter.call(value);
  } catch (error) {
    fail("ERR_RECONSTRUCTION", error);
  }
  return value;
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try {
    return nativeAbortedGetter.call(signal);
  } catch (error) {
    fail("ERR_INTERNAL_FAIL_CLOSED", error);
  }
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    fail("ERR_RECONSTRUCTION", `${label} is not an exact SHA-256 digest`);
  }
  return value;
}

function captureSealedContext(value) {
  const sealed = exactRecord(
    value,
    ["context", "contract", "contractSha256", "taskBytes", "taskSha256"],
    "sealed v2 worker context",
  );
  const taskBytes = copyPrivateBytes(
    sealed.taskBytes,
    MAX_TASK_BYTES,
    "sealed context taskBytes",
  );
  const taskSha256 = exactDigest(
    sealed.taskSha256,
    "sealed context taskSha256",
  );
  if (sha256(taskBytes) !== taskSha256) {
    fail(
      "ERR_RECONSTRUCTION",
      "sealed context task bytes do not match their digest",
    );
  }
  return Object.freeze({
    context: sealed.context,
    contract: sealed.contract,
    contractSha256: exactDigest(
      sealed.contractSha256,
      "sealed context contractSha256",
    ),
    taskSha256,
  });
}

function createRequestWithAssertion(input, assertContext, requestStore) {
  return withTaskV2FailureBoundary(() => {
    if (
      input === null ||
      typeof input !== "object" ||
      utilTypes.isProxy(input)
    ) {
      fail(
        "ERR_RECONSTRUCTION",
        "v2 worker request input must be a plain record",
      );
    }
    const inputDescriptors = Object.getOwnPropertyDescriptors(input);
    const hasSignal = Object.hasOwn(inputDescriptors, "signal");
    const captured = exactRecord(
      input,
      [
        "context",
        "contractBytes",
        "provider",
        "role",
        "directive",
        "roleInput",
        ...(hasSignal ? ["signal"] : []),
      ],
      "v2 worker request input",
    );
    if (typeof assertContext !== "function") {
      fail("ERR_INTERNAL_FAIL_CLOSED", "context assertion is unavailable");
    }
    const contractBytes = copyPrivateBytes(
      captured.contractBytes,
      MAX_CONTRACT_BYTES,
      "contractBytes",
    );
    const sealed = captureSealedContext(
      assertContext({
        context: captured.context,
        contractBytes,
      }),
    );
    let role;
    try {
      if (typeof captured.role !== "string") {
        fail("ERR_RECONSTRUCTION", "v2 worker role must be a string");
      }
      role = validateWorkerRole(captured.role);
    } catch (error) {
      fail("ERR_RECONSTRUCTION", error);
    }
    const directive = exactUtf8(
      captured.directive,
      MAX_DIRECTIVE_BYTES,
      "v2 worker directive",
    );
    const roleInput = captureJson(captured.roleInput, "v2 worker roleInput");
    const roleInputJson = JSON.stringify(roleInput);
    if (Buffer.byteLength(roleInputJson, "utf8") > MAX_ROLE_INPUT_BYTES) {
      fail(
        "ERR_RECONSTRUCTION",
        "v2 worker roleInput exceeds its byte ceiling",
      );
    }
    const provider = captured.provider;
    const selection = routingSelection(sealed.contract, provider);
    const { model, reasoningEffort } = selection;
    const signal = captureAbortSignal(hasSignal ? captured.signal : undefined);
    const task = deepFreeze({
      schemaVersion: 2,
      role,
      directive,
      context: sealed.context,
      roleInput,
    });
    const taskJson = JSON.stringify(task);
    const taskBytes = Buffer.from(taskJson, "utf8");
    if (taskBytes.length > MAX_TASK_BYTES) {
      fail("ERR_RECONSTRUCTION", "v2 worker task exceeds its byte ceiling");
    }
    const taskSha256 = sha256(taskBytes);
    const routingIdentity =
      reasoningEffort === null
        ? `${provider}\0${model}\0${role}`
        : `${provider}\0${model}\0${reasoningEffort}\0${role}`;
    const requestSha256 = sha256(
      Buffer.concat([
        REQUEST_DOMAIN,
        Buffer.from(sealed.contractSha256, "ascii"),
        Buffer.from(taskSha256, "ascii"),
        Buffer.from(routingIdentity, "utf8"),
      ]),
    );
    const request = Object.freeze({ schema: REQUEST_SCHEMA, requestSha256 });
    requestStore.set(
      request,
      Object.freeze({
        contract: sealed.contract,
        contractSha256: sealed.contractSha256,
        contextTaskSha256: sealed.taskSha256,
        provider,
        model,
        reasoningEffort,
        role,
        requestSha256,
        taskJson,
        taskSha256,
        signal,
        timeoutMs: nativeWorkerTimeoutMs(
          role,
          sealed.contract.ceilings.maxTotalVerifierWallMs,
        ),
        maxOutputBytes: Math.min(
          sealed.contract.ceilings.maxWorkerOutputBytes,
          MAX_OUTPUT_BYTES,
        ),
      }),
    );
    return request;
  });
}

function promptFor(authority) {
  const lines = [
    "You are a bounded Oxigraph engineering worker operating under task-contract schema v2.",
    `Role: ${authority.role}.`,
    "You have no local tools. Inspect only the sealed source snapshot in this request. Do not publish, push, deploy, request external access, or alter evaluator/governance inputs.",
    "Return only the schema-v2 structured object with summary, patch, creations, findings, and verdict.",
  ];
  if (["implementation", "repair"].includes(authority.role)) {
    lines.push(
      "For an ACCEPT verdict, patch contains modification sections only, or null when there are no modifications. Creations contains exactly one {path,content} item for every creation instruction, in its declared order. The harness derives mode, status, Git object format, full blob identity, hunk framing, and creation metadata.",
      "For REJECT or INCONCLUSIVE, return patch=null and creations=[]. Never put creation metadata in patch.",
      "A modification patch is raw LF-only text and is never rewritten. Each section uses exact diff --git, --- a/<path>, +++ b/<path>, and complete standard hunks. Counts must equal marked lines; omit ,1 counts; a blank context line is one space.",
      "Created content must be exact non-empty UTF-8, NUL/CR-free, and terminal-LF-terminated. Do not calculate a Git object ID, invent absent baseline content, create parents, use Markdown fences, or add prose to patch.",
    );
  } else {
    lines.push("Return patch=null and creations=[].");
  }
  lines.push(...astraWorkerPromptGuidance(authority.model));
  lines.push("Sealed task request:", authority.taskJson);
  return lines.join("\n");
}

function decodeExactUtf8(bytes, label) {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    fail("ERR_RECONSTRUCTION", error);
  }
  if (Buffer.from(text, "utf8").compare(bytes) !== 0 || text.includes("\0")) {
    fail("ERR_RECONSTRUCTION", `${label} is not exact NUL-free UTF-8`);
  }
  return text;
}

function decodeClaude(stdoutBytes) {
  const decoded = JSON.parse(
    decodeExactUtf8(stdoutBytes, "Claude provider output"),
  );
  const envelope = Array.isArray(decoded)
    ? (() => {
        if (decoded.length === 0 || decoded.length > 4096) {
          fail(
            "ERR_RECONSTRUCTION",
            "Claude event envelope is outside its bound",
          );
        }
        const terminal = decoded.filter((item) => item?.type === "result");
        if (terminal.length !== 1 || terminal[0] !== decoded.at(-1)) {
          fail(
            "ERR_RECONSTRUCTION",
            "Claude event envelope has no unique terminal result",
          );
        }
        return terminal[0];
      })()
    : decoded;
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    envelope.type !== "result" ||
    envelope.is_error !== false
  ) {
    fail("ERR_RECONSTRUCTION", "Claude result envelope is invalid");
  }
  if (Object.hasOwn(envelope, "structured_output"))
    return envelope.structured_output;
  if (
    Object.hasOwn(envelope, "result") &&
    typeof envelope.result === "object"
  ) {
    return envelope.result;
  }
  if (
    Object.hasOwn(envelope, "result") &&
    typeof envelope.result === "string"
  ) {
    return JSON.parse(envelope.result);
  }
  fail("ERR_RECONSTRUCTION", "Claude result envelope has no structured result");
}

async function readBoundedRegularFile(path, maximumBytes) {
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    fail("ERR_RECONSTRUCTION", error);
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > maximumBytes
  ) {
    fail("ERR_RECONSTRUCTION", "Codex output is not a bounded regular file");
  }
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1 ||
      after.size > maximumBytes
    ) {
      fail("ERR_RECONSTRUCTION", "Codex output identity changed before read");
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(
        Math.min(READ_CHUNK_BYTES, maximumBytes - total + 1),
      );
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        fail("ERR_RECONSTRUCTION", "Codex output exceeds its byte ceiling");
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const bytes = Buffer.concat(chunks, total);
    const final = await handle.stat();
    if (
      !final.isFile() ||
      final.dev !== after.dev ||
      final.ino !== after.ino ||
      final.nlink !== 1 ||
      final.size !== after.size ||
      final.size !== total
    ) {
      fail("ERR_RECONSTRUCTION", "Codex output changed while it was read");
    }
    let text;
    try {
      text = UTF8.decode(bytes);
    } catch (error) {
      fail("ERR_RECONSTRUCTION", error);
    }
    if (Buffer.from(text, "utf8").compare(bytes) !== 0 || text.includes("\0")) {
      fail("ERR_RECONSTRUCTION", "Codex output is not exact NUL-free UTF-8");
    }
    return text;
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail("ERR_RECONSTRUCTION", error);
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error) {
        if (!isTaskV2Failure(error)) {
          fail("ERR_INTERNAL_FAIL_CLOSED", error);
        }
        throw error;
      }
    }
  }
}

async function parseCandidatePatchWithGit({ patch, cwd, signal }) {
  let outcome;
  let executable;
  let executionStarted = false;
  let runnerFailure;
  let pinFailure;
  try {
    executable = pinReadOnlyRegularFile(
      GIT_EXECUTABLE_PATH,
      GIT_EXECUTABLE_EXPECTED,
      MAX_PINNED_EXECUTABLE_BYTES,
      "Git parser executable",
    );
    const running = runBoundedProcessBytes({
      executable: "/proc/self/fd/3",
      args: ["apply", "--numstat", "--whitespace=error", "-"],
      cwd,
      environment: Object.freeze({
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        HOME: cwd,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
      }),
      stdin: Buffer.from(patch, "utf8"),
      timeoutMs: PATCH_PARSE_TIMEOUT_MS,
      maxOutputBytes: PATCH_PARSE_OUTPUT_BYTES,
      signal,
      inheritedFileDescriptors: [executable.fd],
    });
    executionStarted = true;
    try {
      outcome = await running;
    } catch (error) {
      runnerFailure = error;
    }
    try {
      verifyPinnedFile(executable);
    } catch (error) {
      pinFailure = error;
    }
  } catch (error) {
    runnerFailure = error;
  } finally {
    if (executable !== undefined) closePinnedFiles([executable]);
  }
  let process;
  if (outcome !== undefined) {
    try {
      process = capturedProcessOutcome(outcome, PATCH_PARSE_OUTPUT_BYTES, true);
    } catch (error) {
      runnerFailure ??= error;
    }
  }
  if (runnerFailure !== undefined || pinFailure !== undefined) {
    const result = Object.freeze({
      accepted: false,
      cleanupSafe: process?.cleanupSafe ?? !executionStarted,
      failureCode: "ERR_INTERNAL_FAIL_CLOSED",
    });
    productionPatchParseResults.add(result);
    return result;
  }
  const completedExactly = processCompletedExactly(process.evidence);
  const accepted = completedExactly && process.evidence.exitCode === 0;
  const result = Object.freeze({
    accepted,
    cleanupSafe: process.cleanupSafe,
    failureCode: accepted
      ? null
      : completedExactly
        ? "ERR_PATCH_CANONICAL"
        : "ERR_INTERNAL_FAIL_CLOSED",
  });
  productionPatchParseResults.add(result);
  return result;
}

function capturedDenseDataArrayLength(value, label, maximumLength = 64) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    fail("ERR_INTERNAL_FAIL_CLOSED", `${label} must be a plain dense array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  const keys = Reflect.ownKeys(descriptors);
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumLength ||
    keys.some((key) => typeof key !== "string")
  ) {
    fail("ERR_INTERNAL_FAIL_CLOSED", `${label} is outside its bound`);
  }
  const expected = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key)) ||
    Array.from({ length }, (_, index) => descriptors[index]).some(
      (descriptor) => descriptor === undefined || !("value" in descriptor),
    )
  ) {
    fail("ERR_INTERNAL_FAIL_CLOSED", `${label} is not exact own data`);
  }
  return length;
}

function capturedOutcomeBytes(
  outcome,
  descriptor,
  trusted,
  maximumBytes,
  label,
) {
  let value;
  if ("value" in descriptor) {
    value = descriptor.value;
  } else if (
    trusted &&
    typeof descriptor.get === "function" &&
    descriptor.set === undefined
  ) {
    try {
      value = descriptor.get.call(outcome);
    } catch (error) {
      fail("ERR_INTERNAL_FAIL_CLOSED", error);
    }
  } else {
    fail("ERR_INTERNAL_FAIL_CLOSED", `${label} is not trusted byte evidence`);
  }
  return copyPrivateBytes(
    value,
    maximumBytes,
    label,
    true,
    "ERR_INTERNAL_FAIL_CLOSED",
  );
}

function capturedProcessOutcome(outcome, maximumBytes, trustedRawOutcome) {
  if (
    outcome === null ||
    typeof outcome !== "object" ||
    utilTypes.isProxy(outcome)
  ) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "native provider returned no process evidence",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(outcome);
  const required = [
    "disposition",
    "firstTerminalReason",
    "syntheticTestOnly",
    "spawned",
    "noChild",
    "exitCode",
    "signal",
    "closeCode",
    "closeSignal",
    "statusAgreement",
    "reaped",
    "directChildCleanupSafe",
    "processGroupQuiescent",
    "exitObserved",
    "closeObserved",
    "stdoutEof",
    "stderrEof",
    "stdinComplete",
    "captureComplete",
    "outputTruncated",
    "durationMs",
    "stdout",
    "stderr",
    "terminationErrors",
    "processErrors",
  ];
  if (
    Reflect.ownKeys(descriptors).length !== required.length ||
    required.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        (!["stdout", "stderr"].includes(key) &&
          !("value" in descriptors[key])) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "native provider evidence is not own data",
    );
  }
  const captured = Object.fromEntries(
    required
      .filter((key) => !["stdout", "stderr"].includes(key))
      .map((key) => [key, descriptors[key].value]),
  );
  const stdoutBytes = capturedOutcomeBytes(
    outcome,
    descriptors.stdout,
    trustedRawOutcome,
    maximumBytes,
    "native provider stdout",
  );
  const stderrBytes = capturedOutcomeBytes(
    outcome,
    descriptors.stderr,
    trustedRawOutcome,
    maximumBytes,
    "native provider stderr",
  );
  const {
    disposition,
    firstTerminalReason,
    syntheticTestOnly,
    exitCode,
    signal,
    closeCode,
    closeSignal,
    durationMs,
  } = captured;
  const proofKeys = [
    "spawned",
    "noChild",
    "statusAgreement",
    "reaped",
    "directChildCleanupSafe",
    "processGroupQuiescent",
    "exitObserved",
    "closeObserved",
    "stdoutEof",
    "stderrEof",
    "stdinComplete",
    "captureComplete",
    "outputTruncated",
  ];
  if (
    typeof disposition !== "string" ||
    disposition.length === 0 ||
    disposition.length > 128 ||
    disposition.includes("\0") ||
    typeof firstTerminalReason !== "string" ||
    firstTerminalReason.length === 0 ||
    firstTerminalReason.length > 128 ||
    firstTerminalReason.includes("\0") ||
    syntheticTestOnly !== false ||
    proofKeys.some((key) => typeof captured[key] !== "boolean") ||
    (exitCode !== null && !Number.isInteger(exitCode)) ||
    (closeCode !== null && !Number.isInteger(closeCode)) ||
    (signal !== null &&
      (typeof signal !== "string" ||
        signal.length === 0 ||
        signal.length > 128 ||
        signal.includes("\0"))) ||
    (closeSignal !== null &&
      (typeof closeSignal !== "string" ||
        closeSignal.length === 0 ||
        closeSignal.length > 128 ||
        closeSignal.includes("\0"))) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0 ||
    stdoutBytes.length + stderrBytes.length > maximumBytes
  ) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "native provider evidence is outside its bound",
    );
  }
  const terminationErrorCount = capturedDenseDataArrayLength(
    captured.terminationErrors,
    "native provider termination errors",
  );
  const processErrorCount = capturedDenseDataArrayLength(
    captured.processErrors,
    "native provider process errors",
  );
  const processProof = evaluateWorkerProcessProofV2(
    captured,
    terminationErrorCount,
    processErrorCount,
  );
  if (!processProof.coherent) {
    fail(
      "ERR_INTERNAL_FAIL_CLOSED",
      "native provider process proofs are inconsistent",
    );
  }
  const evidence = Object.freeze({
    disposition,
    firstTerminalReason,
    spawned: captured.spawned,
    noChild: captured.noChild,
    exitCode,
    signal,
    closeCode,
    closeSignal,
    statusAgreement: captured.statusAgreement,
    reaped: captured.reaped,
    directChildCleanupSafe: captured.directChildCleanupSafe,
    processGroupQuiescent: captured.processGroupQuiescent,
    exitObserved: captured.exitObserved,
    closeObserved: captured.closeObserved,
    stdoutEof: captured.stdoutEof,
    stderrEof: captured.stderrEof,
    stdinComplete: captured.stdinComplete,
    captureComplete: captured.captureComplete,
    outputTruncated: captured.outputTruncated,
    durationMs,
    stdoutSha256: sha256(stdoutBytes),
    stderrSha256: sha256(stderrBytes),
    terminationErrorCount,
    processErrorCount,
  });
  return Object.freeze({
    stdoutBytes,
    evidence,
    cleanupSafe: processProof.cleanupSafe,
  });
}

function processCompletedExactly(evidence) {
  return (
    evidence.disposition === "completed" &&
    evidence.firstTerminalReason === "completed" &&
    evidence.spawned === true &&
    evidence.noChild === false &&
    Number.isInteger(evidence.exitCode) &&
    evidence.closeCode === evidence.exitCode &&
    evidence.signal === null &&
    evidence.closeSignal === null &&
    evidence.statusAgreement === true &&
    evidence.reaped === true &&
    evidence.directChildCleanupSafe === true &&
    evidence.processGroupQuiescent === true &&
    evidence.exitObserved === true &&
    evidence.closeObserved === true &&
    evidence.stdoutEof === true &&
    evidence.stderrEof === true &&
    evidence.stdinComplete === true &&
    evidence.captureComplete === true &&
    evidence.outputTruncated === false &&
    evidence.terminationErrorCount === 0 &&
    evidence.processErrorCount === 0
  );
}

function processSuccess(evidence) {
  return processCompletedExactly(evidence) && evidence.exitCode === 0;
}

function createPinnedExecution(invocation, provider) {
  const pinned = [];
  try {
    const executable = pinReadOnlyRegularFile(
      invocation.attestation.path,
      invocation.attestation,
      MAX_PINNED_EXECUTABLE_BYTES,
      "native provider executable",
    );
    pinned.push(executable);
    const args = [...invocation.args];
    let outputSchemaSha256;
    let outputSchemaTransport;
    let outputSchemaChildFd = null;
    if (provider === "codex") {
      const schemaIndex = args.indexOf("--output-schema") + 1;
      if (schemaIndex === 0 || args[schemaIndex] !== workerOutputV2SchemaPath) {
        fail("ERR_INTERNAL_FAIL_CLOSED", "Codex schema transport is not v2");
      }
      const schema = pinReadOnlyRegularFile(
        workerOutputV2SchemaPath,
        V2_SCHEMA_EXPECTED,
        MAX_CONTRACT_BYTES,
        "worker output schema",
      );
      pinned.push(schema);
      args[schemaIndex] = "/proc/self/fd/4";
      outputSchemaSha256 = schema.sha256;
      outputSchemaTransport = "inherited-readonly-fd-v1";
      outputSchemaChildFd = 4;
    } else {
      const schemaIndex = args.indexOf("--json-schema") + 1;
      if (schemaIndex === 0 || args[schemaIndex] !== V2_CLAUDE_SCHEMA) {
        fail("ERR_INTERNAL_FAIL_CLOSED", "Claude schema transport is not v2");
      }
      outputSchemaSha256 = sha256(Buffer.from(args[schemaIndex], "utf8"));
      outputSchemaTransport = "argv-utf8-v1";
    }
    return Object.freeze({
      executable: "/proc/self/fd/3",
      args: Object.freeze(args),
      cwd: invocation.cwd,
      environment: invocation.environment,
      stdin: Buffer.from(invocation.stdin, "utf8"),
      inheritedFileDescriptors: Object.freeze(pinned.map((file) => file.fd)),
      pinned: Object.freeze(pinned),
      executableEvidence: Object.freeze({
        provider,
        transport: "inherited-readonly-fd-v1",
        childFd: 3,
        sha256: executable.sha256,
        size: executable.size,
        mode: executable.mode,
        uid: executable.uid,
        gid: executable.gid,
      }),
      outputSchemaSha256,
      outputSchemaTransport,
      outputSchemaChildFd,
    });
  } catch (error) {
    closePinnedFiles(pinned);
    throw error;
  }
}

function normalizedInvocationArgs(invocation, executionRoot) {
  return invocation.args.map((argument) => {
    if (argument === executionRoot) return "$EXECUTION_ROOT";
    const prefix = `${executionRoot}/`;
    return argument.startsWith(prefix)
      ? `$EXECUTION_ROOT/${argument.slice(prefix.length)}`
      : argument;
  });
}

function canonicalEnvironmentBytes(environment) {
  const entries = Object.keys(environment)
    .sort()
    .map((key) => [key, environment[key]]);
  return Buffer.from(JSON.stringify(entries), "utf8");
}

function invocationEvidence(authority, execution, executionRoot) {
  const normalizedArgs = normalizedInvocationArgs(execution, executionRoot);
  return Object.freeze({
    executableAttestation: execution.executableEvidence,
    argsNormalization: "execution-root-token-v1",
    argsSha256: sha256(Buffer.from(JSON.stringify(normalizedArgs), "utf8")),
    environmentSha256: sha256(canonicalEnvironmentBytes(execution.environment)),
    workerSchemaVersion: 2,
    timeoutMs: authority.timeoutMs,
    maxOutputBytes: authority.maxOutputBytes,
    contractSha256: authority.contractSha256,
    contextTaskSha256: authority.contextTaskSha256,
    requestSha256: authority.requestSha256,
    taskSha256: authority.taskSha256,
    promptSha256: sha256(execution.stdin),
    outputSchemaSha256: execution.outputSchemaSha256,
    outputSchemaTransport: execution.outputSchemaTransport,
    outputSchemaChildFd: execution.outputSchemaChildFd,
  });
}

function resultFailure(authority, outcome, invocation, failure) {
  if (!isTaskV2Failure(failure)) {
    fail("ERR_INTERNAL_FAIL_CLOSED", "v2 worker failure was not trusted");
  }
  return Object.freeze({
    provider: authority.provider,
    model: authority.model,
    role: authority.role,
    status: "INCONCLUSIVE",
    outcome,
    invocation,
    failure,
  });
}

async function runRequestCore(
  request,
  requestStore,
  processRunner,
  patchParser,
  beforePinnedExecution,
) {
  const authority = requestStore.get(request);
  if (authority === undefined) {
    fail(
      "ERR_RECONSTRUCTION",
      "v2 worker request is not sealed by this controller",
    );
  }
  // Consumption happens before any asynchronous boundary. A request is one
  // provider attempt, never a reusable retry capability.
  requestStore.delete(request);
  if (signalAborted(authority.signal)) {
    fail("ERR_INTERNAL_FAIL_CLOSED", "v2 worker was cancelled before spawn");
  }
  const outputRoot = await mkdtemp(join(tmpdir(), "oxigraph-worker-v2-"));
  let cleanupAllowed = true;
  try {
    const outputPath = join(outputRoot, "last-message.json");
    const prompt = promptFor(authority);
    const invocation =
      authority.provider === "codex"
        ? codexInvocation({
            executionRoot: outputRoot,
            model: authority.model,
            reasoningEffort: authority.reasoningEffort,
            prompt,
            workerSchemaVersion: 2,
          })
        : claudeInvocation({
            executionRoot: outputRoot,
            model: authority.model,
            prompt,
            workerSchemaVersion: 2,
          });
    let execution;
    let publicInvocation;
    try {
      if (beforePinnedExecution !== undefined) beforePinnedExecution();
      execution = createPinnedExecution(invocation, authority.provider);
      publicInvocation = invocationEvidence(authority, execution, outputRoot);
    } catch (error) {
      if (execution !== undefined) closePinnedFiles(execution.pinned);
      return resultFailure(authority, null, null, mapTaskV2Failure(error));
    }
    let rawOutcome;
    let runnerFailure;
    let pinFailure;
    try {
      const running = processRunner({
        executable: execution.executable,
        args: execution.args,
        cwd: execution.cwd,
        environment: execution.environment,
        stdin: execution.stdin,
        inheritedFileDescriptors: execution.inheritedFileDescriptors,
        timeoutMs: authority.timeoutMs,
        maxOutputBytes: authority.maxOutputBytes,
        signal: authority.signal,
      });
      cleanupAllowed = false;
      rawOutcome = await running;
    } catch (error) {
      runnerFailure = mapTaskV2Failure(error);
    } finally {
      try {
        verifyPinnedFiles(execution.pinned);
      } catch (error) {
        pinFailure = mapTaskV2Failure(error);
      }
      closePinnedFiles(execution.pinned);
    }
    if (runnerFailure !== undefined) {
      return resultFailure(
        authority,
        null,
        publicInvocation,
        pinFailure ?? runnerFailure,
      );
    }
    let process;
    try {
      process = capturedProcessOutcome(
        rawOutcome,
        authority.maxOutputBytes,
        processRunner === runBoundedProcessBytes,
      );
      cleanupAllowed = process.cleanupSafe;
    } catch (error) {
      return resultFailure(
        authority,
        null,
        publicInvocation,
        mapTaskV2Failure(error),
      );
    }
    if (pinFailure !== undefined) {
      return resultFailure(
        authority,
        process.evidence,
        publicInvocation,
        pinFailure,
      );
    }
    if (!processSuccess(process.evidence)) {
      return resultFailure(
        authority,
        process.evidence,
        publicInvocation,
        taskV2Failure(
          "ERR_INTERNAL_FAIL_CLOSED",
          "native provider did not complete",
        ),
      );
    }

    let untrustedOutput;
    try {
      if (authority.provider === "codex") {
        untrustedOutput = JSON.parse(
          await readBoundedRegularFile(outputPath, authority.maxOutputBytes),
        );
      } else {
        untrustedOutput = decodeClaude(process.stdoutBytes);
      }
    } catch (error) {
      return resultFailure(
        authority,
        process.evidence,
        publicInvocation,
        mapTaskV2Failure(error),
      );
    }

    let providerOutput;
    try {
      providerOutput = validateWorkerOutputV2(untrustedOutput, authority.role);
    } catch (error) {
      return resultFailure(
        authority,
        process.evidence,
        publicInvocation,
        mapTaskV2Failure(error),
      );
    }
    const providerOutputSha256 = sha256(
      Buffer.from(JSON.stringify(providerOutput), "utf8"),
    );
    const modificationPatchSha256 =
      providerOutput.patch === null
        ? null
        : sha256(Buffer.from(providerOutput.patch, "utf8"));
    const creationsSha256 = sha256(
      Buffer.from(JSON.stringify(providerOutput.creations), "utf8"),
    );
    let candidatePatch = null;
    let candidateProjection = null;
    if (
      ["implementation", "repair"].includes(authority.role) &&
      providerOutput.verdict === "ACCEPT"
    ) {
      try {
        const assembled = assembleCandidatePatchV2(
          authority.contract,
          providerOutput.patch,
          providerOutput.creations,
        );
        candidatePatch = assembled.patch;
        candidateProjection = assembled.projection;
        const parsing = patchParser({
          patch: candidatePatch,
          cwd: outputRoot,
          signal: authority.signal,
        });
        cleanupAllowed = false;
        const patchParse = await parsing;
        if (patchParser === parseCandidatePatchWithGit) {
          if (!productionPatchParseResults.has(patchParse)) {
            cleanupAllowed = false;
            fail(
              "ERR_INTERNAL_FAIL_CLOSED",
              "Git parser returned untrusted completion evidence",
            );
          }
          cleanupAllowed = patchParse.cleanupSafe;
          if (!patchParse.accepted) {
            fail(
              patchParse.failureCode,
              patchParse.failureCode === "ERR_PATCH_CANONICAL"
                ? "Git rejected the exact assembled patch"
                : "Git parser failed closed",
            );
          }
        } else {
          cleanupAllowed = process.cleanupSafe;
        }
      } catch (error) {
        return resultFailure(
          authority,
          process.evidence,
          Object.freeze({
            ...publicInvocation,
            providerOutputSha256,
            modificationPatchSha256,
            creationsSha256,
          }),
          mapTaskV2Failure(error),
        );
      }
    }
    const output = Object.freeze({
      summary: providerOutput.summary,
      patch: candidatePatch,
      findings: providerOutput.findings,
      verdict: providerOutput.verdict,
    });
    const completeInvocation = Object.freeze({
      ...publicInvocation,
      providerOutputSha256,
      modificationPatchSha256,
      creationsSha256,
      finalPatchSha256:
        candidatePatch === null
          ? null
          : sha256(Buffer.from(candidatePatch, "utf8")),
    });
    if (providerOutput.verdict === "INCONCLUSIVE") {
      return resultFailure(
        authority,
        process.evidence,
        completeInvocation,
        taskV2Failure("ERR_RECONSTRUCTION", "worker declined the request"),
      );
    }
    return Object.freeze({
      provider: authority.provider,
      model: authority.model,
      role: authority.role,
      status: providerOutput.verdict,
      output,
      providerOutputV2: providerOutput,
      candidateProjection,
      outcome: process.evidence,
      invocation: completeInvocation,
    });
  } finally {
    if (cleanupAllowed) {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }
}

function runRequestWithController(
  request,
  requestStore,
  processRunner,
  patchParser,
  beforePinnedExecution,
) {
  return withTaskV2FailureBoundary(() =>
    runRequestCore(
      request,
      requestStore,
      processRunner,
      patchParser,
      beforePinnedExecution,
    ),
  );
}

export function createNativeWorkerV2Request(input) {
  return createRequestWithAssertion(
    input,
    assertSealedTaskV2WorkerContext,
    productionRequests,
  );
}

export function runNativeWorkerV2(request) {
  return runRequestWithController(
    request,
    productionRequests,
    runBoundedProcessBytes,
    parseCandidatePatchWithGit,
    undefined,
  );
}

export function createNativeWorkerV2ControllerForTesting({
  assertContext,
  processRunner,
  patchParser,
  beforePinnedExecution,
}) {
  if (
    typeof assertContext !== "function" ||
    typeof processRunner !== "function" ||
    (patchParser !== undefined && typeof patchParser !== "function") ||
    (beforePinnedExecution !== undefined &&
      typeof beforePinnedExecution !== "function")
  ) {
    throw new TypeError("v2 worker test controller requires fixed functions");
  }
  const selectedPatchParser = patchParser ?? parseCandidatePatchWithGit;
  const requests = new WeakMap();
  return Object.freeze({
    createRequest: (input) =>
      createRequestWithAssertion(input, assertContext, requests),
    run: (request) =>
      runRequestWithController(
        request,
        requests,
        processRunner,
        selectedPatchParser,
        beforePinnedExecution,
      ),
  });
}

/**
 * Test-only exercise for the retained-descriptor integrity primitive. It does
 * not expose the descriptor or participate in production worker execution.
 */
export function exercisePinnedFileVerificationForTesting(path, action) {
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("test-only pinned file path must be non-empty");
  }
  if (typeof action !== "function") {
    throw new TypeError("test-only pinned file action must be a function");
  }
  const initial = statSync(path);
  const expected = Object.freeze({
    sha256: sha256(readFileSync(path)),
    size: initial.size,
    mode: initial.mode & 0o777,
    uid: initial.uid,
    gid: initial.gid,
  });
  const pinned = pinReadOnlyRegularFile(
    path,
    expected,
    MAX_PINNED_EXECUTABLE_BYTES,
    "test-only pinned file",
  );
  try {
    const result = action();
    if (result !== undefined) {
      throw new TypeError("test-only pinned file action must be synchronous");
    }
    verifyPinnedFile(pinned);
    return Object.freeze({ sha256: pinned.sha256, size: pinned.size });
  } finally {
    closePinnedFiles([pinned]);
  }
}

export const nativeWorkerV2OutputSchemaSha256 = V2_SCHEMA_SHA256;
