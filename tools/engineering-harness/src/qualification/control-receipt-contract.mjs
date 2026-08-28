import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
  verifyG17BenchmarkOwnerBundle,
} from "./benchmark-owner-contract.mjs";
import {
  G17_BENCHMARK_CASE_IDS,
  G17_BENCHMARK_SUITE_HASH,
  G17_CONTROL_STATISTICS_PROJECTION_SCHEMA,
} from "./control-statistics-contract.mjs";
import { summarizeG17ControlSampleSets } from "./control-statistics-replay.mjs";

// This module is a pure re-executing verifier over caller-supplied bytes. It
// neither reads a filesystem nor proves that a receipt was written last. Those
// are separate responsibilities of the future control storage owner.

export const G17_BENCHMARK_OWNER_BATCH_SCHEMA =
  "oxigraph.g1.7-benchmark-owner-batch/v1";
export const G17_BENCHMARK_OWNER_BATCH_NAME = "benchmark-owner-bundle.json";
export const G17_CONTROL_RECEIPT_REPLAY_SCHEMA =
  "oxigraph.g1.7-control-receipt-candidate-replay/v1";

const G17_CONTROL_AUTHORIZATION_SCHEMA =
  "oxigraph.g1.7-control-authorization/v3";
const G17_CONTROL_RUN_RECEIPT_SCHEMA = "oxigraph.g1.7-control-run-receipt/v1";
const G17_NEGATIVE_CONTROL_SIGNATURE_SCHEMA =
  "oxigraph.g1.7-negative-control-signature/v2";
const DIGEST = /^[0-9a-f]{64}$/u;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const MAX_FILES = 128;
const MAX_FILE_BYTES = 67_108_864;
const MAX_AGGREGATE_BYTES = 268_435_456;
const MAX_AUTHORIZATION_BYTES = 131_072;
const MAX_BATCH_DECODED_BYTES = 48 * 1024 * 1024;
const MAX_BATCH_BUFFER_COUNT = 2_048;
const MAX_SNAPSHOT_NODES = 100_000;
const MAX_SNAPSHOT_ARRAY_LENGTH = 4_096;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_STRING_BYTES = 4 * 1024 * 1024;
const MAX_SNAPSHOT_SINGLE_STRING_BYTES = 1024 * 1024;

// V1 deliberately accepts less than the general control-envelope policy. Its
// single base64 JSON batch must fit one physical file, so owner-valid evidence
// above these limits needs a separately reviewed chunked/binary successor.
export const G17_BENCHMARK_OWNER_BATCH_V1_LIMITS = Object.freeze({
  maxEncodedBytes: MAX_FILE_BYTES,
  maxDecodedBytes: MAX_BATCH_DECODED_BYTES,
  maxBuffers: MAX_BATCH_BUFFER_COUNT,
  maxArrayLength: MAX_SNAPSHOT_ARRAY_LENGTH,
  maxDepth: MAX_SNAPSHOT_DEPTH,
  maxStringBytes: MAX_SNAPSHOT_STRING_BYTES,
  maxSingleStringBytes: MAX_SNAPSHOT_SINGLE_STRING_BYTES,
});

const AUTHORITY = Object.freeze({
  controlExecution: false,
  qualificationExecution: false,
  promotion: false,
  publication: false,
  routerQuality: false,
  providerExecution: false,
});

function fail(message) {
  throw new Error(`G1.7 control receipt contract: ${message}`);
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

function snapshotData(
  value,
  label,
  ancestors = new WeakSet(),
  budget = undefined,
  depth = 0,
) {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    fail(`${label} exceeds the snapshot depth ceiling`);
  }
  if (budget?.nodes !== undefined) {
    budget.nodes += 1;
    if (budget.nodes > MAX_SNAPSHOT_NODES) {
      fail(`${label} exceeds the snapshot node ceiling`);
    }
  }
  if (Buffer.isBuffer(value)) {
    if (budget?.bufferCount !== undefined) {
      budget.bufferCount += 1;
      budget.bufferBytes += value.length;
      if (
        budget.bufferCount > MAX_BATCH_BUFFER_COUNT ||
        budget.bufferBytes > MAX_BATCH_DECODED_BYTES
      ) {
        fail(`${label} exceeds the v1 owner-batch byte budget`);
      }
    }
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    if (budget?.stringBytes !== undefined) {
      const bytes = Buffer.byteLength(value, "utf8");
      budget.stringBytes += bytes;
      if (
        bytes > MAX_SNAPSHOT_SINGLE_STRING_BYTES ||
        budget.stringBytes > MAX_SNAPSHOT_STRING_BYTES
      ) {
        fail(`${label} exceeds the v1 owner-batch string budget`);
      }
    }
    return value;
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail(`${label} must contain only ordinary objects, arrays, and Buffers`);
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const key of keys) {
      if ("get" in descriptors[key] || "set" in descriptors[key]) {
        fail(`${label} contains accessor fields`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        (budget?.maxArrayLength !== undefined && length > budget.maxArrayLength)
      ) {
        fail(`${label} array length is invalid`);
      }
      const expected = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      if (!isDeepStrictEqual([...keys].sort(), expected)) {
        fail(`${label} arrays must be dense and field-free`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
          budget,
          depth + 1,
        ),
      );
    }
    const snapshot = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      Object.defineProperty(snapshot, key, {
        value: snapshotData(
          descriptor.value,
          `${label}.${key}`,
          ancestors,
          budget,
          depth + 1,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

function snapshotOwnerArtifacts(value) {
  return snapshotData(value, "benchmark owner artifacts", new WeakSet(), {
    nodes: 0,
    bufferCount: 0,
    bufferBytes: 0,
    stringBytes: 0,
    maxArrayLength: MAX_SNAPSHOT_ARRAY_LENGTH,
  });
}

function decodedJsonBudget() {
  return {
    nodes: 0,
    maxArrayLength: MAX_SNAPSHOT_ARRAY_LENGTH,
  };
}

function ownerBatchReplayBudget() {
  return {
    ...decodedJsonBudget(),
    bufferCount: 0,
    bufferBytes: 0,
  };
}

function canonicalValue(value, ancestors, depth = 0) {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    fail("canonical JSON exceeds the depth ceiling");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fail("canonical JSON contains a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail("canonical JSON contains non-JSON data");
  }
  if (ancestors.has(value)) fail("canonical JSON contains a cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        fail("canonical JSON arrays must be dense and field-free");
      }
      return `[${value
        .map((entry) => canonicalValue(entry, ancestors, depth + 1))
        .join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail("canonical JSON objects must be ordinary objects");
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalValue(
            value[key],
            ancestors,
            depth + 1,
          )}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value) {
  return canonicalValue(value, new WeakSet());
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function exactOptions(value, expected, label) {
  const options = value === undefined ? {} : value;
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    fail(`${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    fail(`${label} contains symbol fields`);
  }
  if (!isDeepStrictEqual([...keys].sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
  const snapshot = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable data field`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function safeId(value, label) {
  if (!SAFE_ID.test(value ?? "")) fail(`${label} is not a safe identifier`);
  return value;
}

function canonicalTimestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(`${label} is not a canonical UTC timestamp`);
  }
  return milliseconds;
}

function strictBefore(left, right, message) {
  if (left >= right) fail(message);
}

function canonicalBytes(value, label) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) {
    fail(`${label} is outside the frozen per-file ceiling`);
  }
  return bytes;
}

function decodeCanonicalBytes(
  bytesValue,
  label,
  maximumBytes = MAX_FILE_BYTES,
  snapshotBudget = decodedJsonBudget(),
) {
  if (!Buffer.isBuffer(bytesValue)) fail(`${label} must be a Buffer`);
  if (bytesValue.length < 1 || bytesValue.length > maximumBytes) {
    fail(`${label} is outside the frozen per-file ceiling`);
  }
  const bytes = Buffer.from(bytesValue);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not valid UTF-8: ${error.message}`);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(`${label} must be exactly one LF-terminated JSON value`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  const value = snapshotData(parsed, label, new WeakSet(), snapshotBudget);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail(`${label} is not canonical JSON`);
  }
  return { bytes, value, rawSha256: sha256(bytes) };
}

function byteRecord(value, label) {
  if (!Buffer.isBuffer(value)) fail(`${label} must be a Buffer`);
  const bytes = Buffer.from(value);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function decodeByteRecord(value, label, budget) {
  exactKeys(value, ["bytes", "sha256", "base64"], label);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    fail(`${label} byte count is invalid`);
  }
  digest(value.sha256, `${label} sha256`);
  if (typeof value.base64 !== "string") fail(`${label} base64 is invalid`);
  if (value.base64.length % 4 !== 0 || !CANONICAL_BASE64.test(value.base64)) {
    fail(`${label} base64 is not canonical`);
  }
  const padding = value.base64.endsWith("==")
    ? 2
    : value.base64.endsWith("=")
      ? 1
      : 0;
  const decodedLength = (value.base64.length / 4) * 3 - padding;
  if (decodedLength !== value.bytes) {
    fail(`${label} base64 length does not match its byte count`);
  }
  budget.bufferCount += 1;
  budget.bufferBytes += decodedLength;
  if (
    budget.bufferCount > MAX_BATCH_BUFFER_COUNT ||
    budget.bufferBytes > MAX_BATCH_DECODED_BYTES
  ) {
    fail(`${label} exceeds the v1 owner-batch replay budget`);
  }
  const bytes = Buffer.from(value.base64, "base64");
  if (
    bytes.toString("base64") !== value.base64 ||
    bytes.length !== value.bytes ||
    sha256(bytes) !== value.sha256
  ) {
    fail(`${label} does not bind canonical base64 bytes`);
  }
  return bytes;
}

function encodeBatchValue(options) {
  const { controlRunId, artifacts } = exactOptions(
    options,
    ["controlRunId", "artifacts"],
    "benchmark owner batch options",
  );
  const runId = safeId(controlRunId, "controlRunId");
  const inventory = snapshotOwnerArtifacts(artifacts);
  exactKeys(inventory, ["builds", "controls"], "benchmark owner artifacts");
  if (!Array.isArray(inventory.builds) || !Array.isArray(inventory.controls)) {
    fail("benchmark owner artifact groups must be arrays");
  }
  const unsigned = {
    schema: G17_BENCHMARK_OWNER_BATCH_SCHEMA,
    controlRunId: runId,
    builds: inventory.builds.map((build, index) => {
      exactKeys(
        build,
        [
          "buildId",
          "productRole",
          "workspaceOwnerBytes",
          "buildOwnerBytes",
          "buildStdoutBytes",
          "buildStderrBytes",
        ],
        `batch build ${index}`,
      );
      return {
        buildId: build.buildId,
        productRole: build.productRole,
        workspaceOwner: byteRecord(
          build.workspaceOwnerBytes,
          `batch build ${index} workspace owner`,
        ),
        buildOwner: byteRecord(
          build.buildOwnerBytes,
          `batch build ${index} build owner`,
        ),
        buildStdout: byteRecord(
          build.buildStdoutBytes,
          `batch build ${index} stdout`,
        ),
        buildStderr: byteRecord(
          build.buildStderrBytes,
          `batch build ${index} stderr`,
        ),
      };
    }),
    controls: inventory.controls.map((control, index) => {
      exactKeys(
        control,
        ["controlName", "sessionOwnerBytes", "sampleSetBytes", "launches"],
        `batch control ${index}`,
      );
      if (!Array.isArray(control.launches)) {
        fail(`batch control ${index} launches must be an array`);
      }
      return {
        controlName: control.controlName,
        sessionOwner: byteRecord(
          control.sessionOwnerBytes,
          `batch control ${index} session owner`,
        ),
        sampleSet: byteRecord(
          control.sampleSetBytes,
          `batch control ${index} sample set`,
        ),
        launches: control.launches.map((launch, sequence) => {
          exactKeys(
            launch,
            ["attestationBytes", "stdoutBytes", "stderrBytes"],
            `batch control ${index} launch ${sequence}`,
          );
          return {
            sequence,
            attestation: byteRecord(
              launch.attestationBytes,
              `batch control ${index} launch ${sequence} attestation`,
            ),
            stdout: byteRecord(
              launch.stdoutBytes,
              `batch control ${index} launch ${sequence} stdout`,
            ),
            stderr: byteRecord(
              launch.stderrBytes,
              `batch control ${index} launch ${sequence} stderr`,
            ),
          };
        }),
      };
    }),
  };
  return { ...unsigned, contentHash: canonicalSha256(unsigned) };
}

export function g17BenchmarkOwnerBatchBytes(options) {
  return canonicalBytes(encodeBatchValue(options), "benchmark owner batch");
}

function decodeBatch(bytesValue, expectedRunId) {
  const budget = ownerBatchReplayBudget();
  const decoded = decodeCanonicalBytes(
    bytesValue,
    "benchmark owner batch",
    MAX_FILE_BYTES,
    budget,
  );
  const batch = decoded.value;
  exactKeys(
    batch,
    ["schema", "controlRunId", "builds", "controls", "contentHash"],
    "benchmark owner batch",
  );
  if (
    batch.schema !== G17_BENCHMARK_OWNER_BATCH_SCHEMA ||
    batch.controlRunId !== expectedRunId ||
    !Array.isArray(batch.builds) ||
    !Array.isArray(batch.controls)
  ) {
    fail("benchmark owner batch identity or groups drifted");
  }
  digest(batch.contentHash, "benchmark owner batch contentHash");
  const { contentHash, ...unsigned } = batch;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail("benchmark owner batch self-hash does not verify");
  }
  const artifacts = {
    builds: batch.builds.map((build, index) => {
      exactKeys(
        build,
        [
          "buildId",
          "productRole",
          "workspaceOwner",
          "buildOwner",
          "buildStdout",
          "buildStderr",
        ],
        `batch build ${index}`,
      );
      return {
        buildId: build.buildId,
        productRole: build.productRole,
        workspaceOwnerBytes: decodeByteRecord(
          build.workspaceOwner,
          `batch build ${index} workspace owner`,
          budget,
        ),
        buildOwnerBytes: decodeByteRecord(
          build.buildOwner,
          `batch build ${index} build owner`,
          budget,
        ),
        buildStdoutBytes: decodeByteRecord(
          build.buildStdout,
          `batch build ${index} stdout`,
          budget,
        ),
        buildStderrBytes: decodeByteRecord(
          build.buildStderr,
          `batch build ${index} stderr`,
          budget,
        ),
      };
    }),
    controls: batch.controls.map((control, index) => {
      exactKeys(
        control,
        ["controlName", "sessionOwner", "sampleSet", "launches"],
        `batch control ${index}`,
      );
      if (!Array.isArray(control.launches)) {
        fail(`batch control ${index} launches must be an array`);
      }
      return {
        controlName: control.controlName,
        sessionOwnerBytes: decodeByteRecord(
          control.sessionOwner,
          `batch control ${index} session owner`,
          budget,
        ),
        sampleSetBytes: decodeByteRecord(
          control.sampleSet,
          `batch control ${index} sample set`,
          budget,
        ),
        launches: control.launches.map((launch, sequence) => {
          exactKeys(
            launch,
            ["sequence", "attestation", "stdout", "stderr"],
            `batch control ${index} launch ${sequence}`,
          );
          if (launch.sequence !== sequence) {
            fail(`batch control ${index} launch sequence drifted`);
          }
          return {
            attestationBytes: decodeByteRecord(
              launch.attestation,
              `batch control ${index} launch ${sequence} attestation`,
              budget,
            ),
            stdoutBytes: decodeByteRecord(
              launch.stdout,
              `batch control ${index} launch ${sequence} stdout`,
              budget,
            ),
            stderrBytes: decodeByteRecord(
              launch.stderr,
              `batch control ${index} launch ${sequence} stderr`,
              budget,
            ),
          };
        }),
      };
    }),
  };
  return { decoded, batch, artifacts };
}

function validateArtifactsMap(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Map.prototype ||
    Reflect.ownKeys(value).length !== 0
  ) {
    fail("artifactsByName must be an ordinary Map");
  }
  const size = Reflect.get(Map.prototype, "size", value);
  if (size !== 1 || size > MAX_FILES - 1) {
    fail("receipt artifact inventory cardinality drifted");
  }
  const entries = [...Map.prototype.entries.call(value)];
  if (
    entries.length !== 1 ||
    entries[0][0] !== G17_BENCHMARK_OWNER_BATCH_NAME ||
    !Buffer.isBuffer(entries[0][1]) ||
    entries[0][1].length < 1 ||
    entries[0][1].length > MAX_FILE_BYTES
  ) {
    fail("receipt artifact inventory is not the exact owner batch");
  }
  return new Map([[entries[0][0], Buffer.from(entries[0][1])]]);
}

function decodeAuthorization(bytesValue) {
  const decoded = decodeCanonicalBytes(
    bytesValue,
    "control authorization",
    MAX_AUTHORIZATION_BYTES,
  );
  const authorization = decoded.value;
  exactKeys(
    authorization,
    ["schema", "id", "status", "protocol", "approval", "contentHash"],
    "control authorization",
  );
  if (
    authorization.schema !== G17_CONTROL_AUTHORIZATION_SCHEMA ||
    authorization.id !== "control-authorization" ||
    authorization.status !== "CONTROL_AUTHORIZED"
  ) {
    fail("only an approved v3 control authorization may bind a receipt");
  }
  exactKeys(
    authorization.approval,
    ["status", "approvedBy", "approvedAt"],
    "control authorization approval",
  );
  if (
    authorization.approval.status !== "APPROVED" ||
    typeof authorization.approval.approvedBy !== "string" ||
    authorization.approval.approvedBy.trim().length === 0
  ) {
    fail("control authorization lacks a named approval");
  }
  canonicalTimestamp(
    authorization.approval.approvedAt,
    "control authorization approvedAt",
  );
  digest(authorization.contentHash, "control authorization contentHash");
  const { contentHash, ...unsigned } = authorization;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail("control authorization self-hash does not verify");
  }
  return {
    authorization,
    authorizationBytes: decoded.bytes,
    authorizationRawSha256: decoded.rawSha256,
  };
}

function deriveG17NegativeControlSignature(options) {
  const { statistics, authorizationContentHash, controlRunId } = exactOptions(
    options,
    ["statistics", "authorizationContentHash", "controlRunId"],
    "negative-control signature options",
  );
  const projection = snapshotData(statistics, "control statistics projection");
  const authorizationHash = digest(
    authorizationContentHash,
    "negative signature authorizationContentHash",
  );
  const runId = safeId(controlRunId, "negative signature controlRunId");
  if (
    projection.schema !== G17_CONTROL_STATISTICS_PROJECTION_SCHEMA ||
    projection.sampleSets?.negativeControl === undefined ||
    projection.negativeControl?.status !== "CONTROL_SEALED_PASS" ||
    !Array.isArray(projection.negativeControl.quietBreaches)
  ) {
    fail("negative-control statistics cannot derive a signature");
  }
  const breaches = projection.negativeControl.quietBreaches;
  if (breaches.length === 0) {
    fail("a passing control projection lacks a quiet negative breach");
  }
  const indexes = breaches.map((caseId) =>
    G17_BENCHMARK_CASE_IDS.indexOf(caseId),
  );
  if (
    indexes.some((index) => index < 0) ||
    new Set(indexes).size !== indexes.length ||
    indexes.some(
      (index, position) => position > 0 && index <= indexes[position - 1],
    )
  ) {
    fail("negative-control breach order is invalid");
  }
  digest(
    projection.sampleSets.negativeControl.sha256,
    "negative-control sample-set digest",
  );
  const unsigned = {
    schema: G17_NEGATIVE_CONTROL_SIGNATURE_SCHEMA,
    suiteHash: G17_BENCHMARK_SUITE_HASH,
    status: "FAIL",
    budgetBreaches: breaches,
    sampleSetSha256: projection.sampleSets.negativeControl.sha256,
    authorizationContentHash: authorizationHash,
    controlRunId: runId,
  };
  return deepFreeze({ ...unsigned, contentHash: canonicalSha256(unsigned) });
}

function signatureForRecomputedStatistics(options) {
  return options.statistics.negativeControl.status === "CONTROL_SEALED_PASS"
    ? deriveG17NegativeControlSignature(options)
    : null;
}

function projectionBinding(schema, projection) {
  return {
    schema,
    projectionSha256: canonicalSha256(projection),
  };
}

function statisticsBinding(statistics) {
  return {
    schema: G17_CONTROL_STATISTICS_PROJECTION_SCHEMA,
    status: statistics.status,
    reason: statistics.reason,
    projectionSha256: canonicalSha256(statistics),
  };
}

function receiptAuthorizationBinding(authorization, rawSha256) {
  return {
    schema: G17_CONTROL_AUTHORIZATION_SCHEMA,
    rawSha256,
    contentHash: authorization.contentHash,
  };
}

function inventoryForBatch(batchBytes) {
  return [
    {
      name: G17_BENCHMARK_OWNER_BATCH_NAME,
      schema: G17_BENCHMARK_OWNER_BATCH_SCHEMA,
      bytes: batchBytes.length,
      sha256: sha256(batchBytes),
    },
  ];
}

function validateReceiptValue({
  receipt,
  receiptRawSha256,
  authorization,
  authorizationRawSha256,
  ownerBatchBytes,
  ownerProjection,
  statistics,
  negativeControlSignature,
}) {
  exactKeys(
    receipt,
    [
      "schema",
      "status",
      "runId",
      "authorization",
      "startedAt",
      "completedAt",
      "environmentClass",
      "ownerBundle",
      "statistics",
      "negativeControlSignature",
      "inventory",
      "authority",
      "receiptSha256",
    ],
    "control receipt",
  );
  if (
    receipt.schema !== G17_CONTROL_RUN_RECEIPT_SCHEMA ||
    !new Set([
      "CONTROL_SEALED_PASS",
      "CONTROL_SEALED_FAIL",
      "CONTROL_SEALED_INCONCLUSIVE",
    ]).has(receipt.status) ||
    !SAFE_ID.test(receipt.runId ?? "")
  ) {
    fail("control receipt identity or outcome drifted");
  }
  exactKeys(
    receipt.authorization,
    ["schema", "rawSha256", "contentHash"],
    "control receipt authorization",
  );
  exactKeys(
    receipt.ownerBundle,
    ["schema", "projectionSha256"],
    "control receipt owner bundle",
  );
  exactKeys(
    receipt.statistics,
    ["schema", "status", "reason", "projectionSha256"],
    "control receipt statistics",
  );
  exactKeys(
    receipt.authority,
    [
      "controlExecution",
      "qualificationExecution",
      "promotion",
      "publication",
      "routerQuality",
      "providerExecution",
    ],
    "control receipt authority",
  );
  if (
    !isDeepStrictEqual(
      receipt.authorization,
      receiptAuthorizationBinding(authorization, authorizationRawSha256),
    ) ||
    receipt.environmentClass !== authorization.protocol.environment.class ||
    !isDeepStrictEqual(
      receipt.ownerBundle,
      projectionBinding(
        G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
        ownerProjection,
      ),
    ) ||
    !isDeepStrictEqual(receipt.statistics, statisticsBinding(statistics)) ||
    receipt.status !== statistics.status ||
    !isDeepStrictEqual(
      receipt.negativeControlSignature,
      negativeControlSignature,
    ) ||
    !isDeepStrictEqual(receipt.inventory, inventoryForBatch(ownerBatchBytes)) ||
    !isDeepStrictEqual(receipt.authority, AUTHORITY)
  ) {
    fail("control receipt recomputed evidence binding drifted");
  }
  if (!Array.isArray(receipt.inventory) || receipt.inventory.length !== 1) {
    fail("control receipt inventory cardinality drifted");
  }
  const inventory = receipt.inventory[0];
  exactKeys(
    inventory,
    ["name", "schema", "bytes", "sha256"],
    "control receipt inventory record",
  );
  digest(inventory.sha256, "control receipt inventory sha256");
  digest(receipt.receiptSha256, "control receipt receiptSha256");
  digest(receiptRawSha256, "control receipt rawSha256");
  const { receiptSha256, ...unsigned } = receipt;
  if (receiptSha256 !== canonicalSha256(unsigned)) {
    fail("control receipt inner hash does not verify");
  }
  const approvedAt = canonicalTimestamp(
    authorization.approval.approvedAt,
    "control authorization approvedAt",
  );
  const startedAt = canonicalTimestamp(receipt.startedAt, "control startedAt");
  const completedAt = canonicalTimestamp(
    receipt.completedAt,
    "control completedAt",
  );
  strictBefore(
    approvedAt,
    startedAt,
    "control authorization must precede control start",
  );
  strictBefore(
    startedAt,
    completedAt,
    "control start must precede control completion",
  );
  if (
    ownerBatchBytes.length + canonicalBytes(receipt, "control receipt").length >
    MAX_AGGREGATE_BYTES
  ) {
    fail("control receipt envelope exceeds its aggregate byte ceiling");
  }
  return { startedAt, completedAt };
}

function buildReceiptValue({
  authorization,
  authorizationRawSha256,
  controlRunId,
  startedAt,
  completedAt,
  ownerBatchBytes,
  ownerProjection,
  statistics,
  negativeControlSignature,
}) {
  safeId(controlRunId, "controlRunId");
  const approvedAtMs = canonicalTimestamp(
    authorization.approval.approvedAt,
    "control authorization approvedAt",
  );
  const startedAtMs = canonicalTimestamp(startedAt, "control startedAt");
  const completedAtMs = canonicalTimestamp(completedAt, "control completedAt");
  strictBefore(
    approvedAtMs,
    startedAtMs,
    "control authorization must precede control start",
  );
  strictBefore(
    startedAtMs,
    completedAtMs,
    "control start must precede control completion",
  );
  const unsigned = {
    schema: G17_CONTROL_RUN_RECEIPT_SCHEMA,
    status: statistics.status,
    runId: controlRunId,
    authorization: receiptAuthorizationBinding(
      authorization,
      authorizationRawSha256,
    ),
    startedAt,
    completedAt,
    environmentClass: authorization.protocol.environment.class,
    ownerBundle: projectionBinding(
      G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
      ownerProjection,
    ),
    statistics: statisticsBinding(statistics),
    negativeControlSignature,
    inventory: inventoryForBatch(ownerBatchBytes),
    authority: { ...AUTHORITY },
  };
  return { ...unsigned, receiptSha256: canonicalSha256(unsigned) };
}

export function buildG17ControlReceiptCandidate(options) {
  const {
    authorizationBytes,
    controlRunId,
    startedAt,
    completedAt,
    artifacts,
  } = exactOptions(
    options,
    [
      "authorizationBytes",
      "controlRunId",
      "startedAt",
      "completedAt",
      "artifacts",
    ],
    "control receipt build options",
  );
  const authorized = decodeAuthorization(authorizationBytes);
  const runId = safeId(controlRunId, "controlRunId");
  const artifactSnapshot = snapshotOwnerArtifacts(artifacts);
  const ownerProjection = verifyG17BenchmarkOwnerBundle({
    authorization: authorized.authorization,
    authorizationRawSha256: authorized.authorizationRawSha256,
    controlRunId: runId,
    artifacts: artifactSnapshot,
  });
  const statistics = summarizeG17ControlSampleSets(ownerProjection.sampleSets);
  const negativeControlSignature = signatureForRecomputedStatistics({
    statistics,
    authorizationContentHash: authorized.authorization.contentHash,
    controlRunId: runId,
  });
  const ownerBatchBytes = g17BenchmarkOwnerBatchBytes({
    controlRunId: runId,
    artifacts: artifactSnapshot,
  });
  const receipt = buildReceiptValue({
    authorization: authorized.authorization,
    authorizationRawSha256: authorized.authorizationRawSha256,
    controlRunId: runId,
    startedAt,
    completedAt,
    ownerBatchBytes,
    ownerProjection,
    statistics,
    negativeControlSignature,
  });
  const receiptBytes = canonicalBytes(receipt, "control receipt");
  if (ownerBatchBytes.length + receiptBytes.length > MAX_AGGREGATE_BYTES) {
    fail("control receipt envelope exceeds its aggregate byte ceiling");
  }
  const replay = replayG17ControlReceipt({
    authorizationBytes: authorized.authorizationBytes,
    receiptBytes,
    artifactsByName: new Map([
      [G17_BENCHMARK_OWNER_BATCH_NAME, ownerBatchBytes],
    ]),
  });
  return Object.freeze({
    receiptBytes: Buffer.from(receiptBytes),
    ownerBatchBytes: Buffer.from(ownerBatchBytes),
    replay,
  });
}

export function replayG17ControlReceipt(options) {
  const { authorizationBytes, receiptBytes, artifactsByName } = exactOptions(
    options,
    ["authorizationBytes", "receiptBytes", "artifactsByName"],
    "control receipt replay options",
  );
  const authorized = decodeAuthorization(authorizationBytes);
  const artifactMap = validateArtifactsMap(artifactsByName);
  const decodedReceipt = decodeCanonicalBytes(receiptBytes, "control receipt");
  const receipt = decodedReceipt.value;
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    Array.isArray(receipt)
  ) {
    fail("control receipt must be an object");
  }
  const runId = safeId(receipt.runId, "control receipt runId");
  const ownerBatchBytes = artifactMap.get(G17_BENCHMARK_OWNER_BATCH_NAME);
  const { artifacts } = decodeBatch(ownerBatchBytes, runId);
  const ownerProjection = verifyG17BenchmarkOwnerBundle({
    authorization: authorized.authorization,
    authorizationRawSha256: authorized.authorizationRawSha256,
    controlRunId: runId,
    artifacts,
  });
  const statistics = summarizeG17ControlSampleSets(ownerProjection.sampleSets);
  const negativeControlSignature = signatureForRecomputedStatistics({
    statistics,
    authorizationContentHash: authorized.authorization.contentHash,
    controlRunId: runId,
  });
  validateReceiptValue({
    receipt,
    receiptRawSha256: decodedReceipt.rawSha256,
    authorization: authorized.authorization,
    authorizationRawSha256: authorized.authorizationRawSha256,
    ownerBatchBytes,
    ownerProjection,
    statistics,
    negativeControlSignature,
  });
  return deepFreeze({
    schema: G17_CONTROL_RECEIPT_REPLAY_SCHEMA,
    status: "CANDIDATE_REPLAYED",
    outcome: receipt.status,
    receiptCandidateReplayComplete: true,
    finalDecisionEligible: false,
    receipt,
    receiptRawSha256: decodedReceipt.rawSha256,
    ownerProjection,
    statistics,
    negativeControlSignature,
    binding: null,
    authority: { ...AUTHORITY },
  });
}
