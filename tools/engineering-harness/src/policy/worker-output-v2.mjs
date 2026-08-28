import { validateWorkerRole } from "./authority.mjs";
import { types as utilTypes } from "node:util";
import {
  isTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "./task-v2-failures.mjs";
import { validateTaskV2Path } from "./paths-v2.mjs";

const OUTPUT_KEYS = Object.freeze([
  "summary",
  "patch",
  "creations",
  "findings",
  "verdict",
]);
const CREATION_KEYS = Object.freeze(["path", "content"]);
const READ_ONLY_ROLES = new Set(["architecture", "critique", "review"]);
const PATCH_ROLES = new Set(["implementation", "repair"]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function fail(detail) {
  throw taskV2Failure("ERR_RECONSTRUCTION", detail);
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
      fail(`${label} must be a plain own-data record`);
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
      fail(`${label} keys must be exact enumerable own data properties`);
    }
    return Object.fromEntries(
      expectedKeys.map((key) => [key, descriptors[key].value]),
    );
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(error);
  }
}

function denseArray(value, maximum, label) {
  try {
    if (
      !Array.isArray(value) ||
      utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      fail(`${label} must be a bounded plain dense array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
      fail(`${label} must be a bounded plain dense array`);
    }
    const keys = Reflect.ownKeys(descriptors);
    const expected = new Set([
      "length",
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== expected.size ||
      keys.some((key) => !expected.has(key))
    ) {
      fail(`${label} must be a bounded plain dense array`);
    }
    const captured = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[index];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        fail(`${label} must contain only enumerable own data elements`);
      }
      captured.push(descriptor.value);
    }
    return captured;
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    fail(error);
  }
}

function boundedText(value, maximumBytes, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    fail(`${label} must be NUL-free UTF-8 text`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > maximumBytes) fail(`${label} exceeds its byte ceiling`);
  let decoded;
  try {
    decoded = UTF8.decode(bytes);
  } catch (error) {
    fail(error);
  }
  if (decoded !== value) fail(`${label} is not exact UTF-8 text`);
  return value;
}

function validateWorkerOutputV2Internal(output, role) {
  try {
    validateWorkerRole(role);
  } catch (error) {
    fail(error);
  }
  const captured = exactRecord(output, OUTPUT_KEYS, "worker output v2");
  const summary = boundedText(captured.summary, 4096, "worker summary");
  const patch =
    captured.patch === null
      ? null
      : boundedText(captured.patch, 262_144, "worker modification patch");
  if (patch === "") {
    fail("worker modification patch must use null when absent");
  }
  const creationValues = denseArray(captured.creations, 32, "worker creations");
  const creations = creationValues.map((creation, index) => {
    const record = exactRecord(
      creation,
      CREATION_KEYS,
      `worker creations[${index}]`,
    );
    let path;
    try {
      path = validateTaskV2Path(
        boundedText(record.path, 4096, `worker creations[${index}].path`),
        `worker creations[${index}].path`,
      );
    } catch (error) {
      fail(error);
    }
    return Object.freeze({
      path,
      content: boundedText(
        record.content,
        262_144,
        `worker creations[${index}].content`,
      ),
    });
  });
  const findingValues = denseArray(captured.findings, 128, "worker findings");
  const findings = findingValues.map((finding, index) =>
    boundedText(finding, 2048, `worker findings[${index}]`),
  );
  if (!new Set(["ACCEPT", "REJECT", "INCONCLUSIVE"]).has(captured.verdict)) {
    fail("worker verdict is invalid");
  }
  if (READ_ONLY_ROLES.has(role) && (patch !== null || creations.length !== 0)) {
    fail(`${role} workers may not propose changes`);
  }
  if (PATCH_ROLES.has(role)) {
    const hasCandidate = patch !== null || creations.length !== 0;
    if (captured.verdict === "ACCEPT" && !hasCandidate) {
      fail(`${role} workers must return the accepted candidate`);
    }
    if (captured.verdict !== "ACCEPT" && hasCandidate) {
      fail(`${role} workers may not attach a candidate when declining`);
    }
  }
  return Object.freeze({
    summary,
    patch,
    creations: Object.freeze(creations),
    findings: Object.freeze(findings),
    verdict: captured.verdict,
  });
}

export function validateWorkerOutputV2(output, role) {
  return withTaskV2FailureBoundary(() =>
    validateWorkerOutputV2Internal(output, role),
  );
}
