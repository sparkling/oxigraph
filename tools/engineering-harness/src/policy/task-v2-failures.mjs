import { createHash } from "node:crypto";

// ADR-0034 deliberately has a finite failure vocabulary. Consumers may branch
// on these codes, but every branch is terminal and carries no retry authority.
export const TASK_V2_FAILURE_CODES = Object.freeze([
  "ERR_CONTRACT_SCHEMA_OR_KEYS",
  "ERR_PATH_INVALID",
  "ERR_PATH_OVERLAP",
  "ERR_PATH_COLLISION",
  "ERR_PARENT_TREE",
  "ERR_BASELINE_STATE",
  "ERR_OBJECT_TYPE",
  "ERR_PATCH_CANONICAL",
  "ERR_PATCH_CEILING",
  "ERR_CANDIDATE_STATUS",
  "ERR_PROTECTED_MANIFEST",
  "ERR_SOURCE_SNAPSHOT",
  "ERR_RECONSTRUCTION",
  "ERR_RECEIPT_REPLAY",
  "ERR_INTERNAL_FAIL_CLOSED",
]);

export const TASK_V2_PUBLIC_FAILURE_MESSAGE =
  "engineering task v2 failed closed";

const FAILURE_CODE_SET = new Set(TASK_V2_FAILURE_CODES);
const TRUSTED_FAILURES = new WeakSet();

function classification() {
  return Object.freeze({ terminal: true, retryAllowed: false });
}

export const TASK_V2_FAILURE_CLASSIFICATION = Object.freeze(
  Object.fromEntries(
    TASK_V2_FAILURE_CODES.map((code) => [code, classification()]),
  ),
);

function internalDetailText(detail) {
  try {
    if (detail instanceof Error) {
      return `${detail.name || "Error"}: ${detail.message || "unspecified"}`;
    }
    if (typeof detail === "string") return detail;
    if (
      detail === undefined ||
      detail === null ||
      typeof detail === "number" ||
      typeof detail === "bigint" ||
      typeof detail === "boolean"
    ) {
      return String(detail);
    }
    return "non-text internal detail";
  } catch {
    return "unreadable internal detail";
  }
}

export function taskV2DetailSha256(code, detail) {
  if (!FAILURE_CODE_SET.has(code)) {
    throw new TypeError("unknown engineering task v2 failure code");
  }
  const framed = Buffer.from(
    `oxigraph.engineering-task-v2-failure-detail/v1\0${code}\0${internalDetailText(detail)}`,
    "utf8",
  );
  return createHash("sha256").update(framed).digest("hex");
}

export class TaskV2Failure extends Error {
  constructor(code, detail = "unspecified") {
    if (!FAILURE_CODE_SET.has(code)) {
      throw new TypeError("unknown engineering task v2 failure code");
    }
    super(TASK_V2_PUBLIC_FAILURE_MESSAGE);
    Object.defineProperty(this, "name", {
      value: "TaskV2Failure",
      configurable: true,
    });
    this.code = code;
    this.publicMessage = TASK_V2_PUBLIC_FAILURE_MESSAGE;
    this.terminal = true;
    this.retryAllowed = false;
    this.detailSha256 = taskV2DetailSha256(code, detail);

    // Error stacks normally disclose local source paths. The public failure is
    // intentionally reduced to its fixed message, code, and opaque digest.
    this.stack = `${this.name}: ${this.message}`;
    TRUSTED_FAILURES.add(this);
    Object.freeze(this);
  }
}

export function taskV2Failure(code, detail = "unspecified") {
  return new TaskV2Failure(code, detail);
}

export function isTaskV2Failure(error) {
  try {
    return error instanceof TaskV2Failure && TRUSTED_FAILURES.has(error);
  } catch {
    return false;
  }
}

export function mapTaskV2Failure(error) {
  if (isTaskV2Failure(error)) return error;
  return taskV2Failure("ERR_INTERNAL_FAIL_CLOSED", error);
}

// The operation is attempted exactly once. Both synchronous throws and
// asynchronous rejections are reduced to the same finite terminal taxonomy.
export function withTaskV2FailureBoundary(operation) {
  try {
    const result = operation();
    if (result !== null && typeof result?.then === "function") {
      return Promise.resolve(result).catch((error) => {
        throw mapTaskV2Failure(error);
      });
    }
    return result;
  } catch (error) {
    throw mapTaskV2Failure(error);
  }
}
