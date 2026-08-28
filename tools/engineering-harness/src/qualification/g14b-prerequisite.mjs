import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { replayApplicationReceipt } from "../receipts/application.mjs";
import { canonicalSha256 } from "../routing/features.mjs";

export const G17_G14B_PREREQUISITE_SCHEMA =
  "oxigraph.g1.7-g1.4b-prerequisite/v1";
export const G17_G14B_PREREQUISITE_BINDING_SCHEMA =
  "oxigraph.g1.7-g1.4b-prerequisite-binding/v1";
export const G17_G14B_PREREQUISITE_ARTIFACT_NAME =
  "g14b-application-receipt.json";

export const G17_G14B_APPLICATION_RECEIPT_BYTES = 95_990;
export const G17_G14B_APPLICATION_RECEIPT_RAW_SHA256 =
  "6273c29d7221d820ac6e46bc784deca5867045aa3704470e269f862a459d3205";
export const G17_G14B_APPLICATION_RECEIPT_SHA256 =
  "d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad";

const APPLICATION_RECEIPT_SCHEMA =
  "oxigraph.engineering-application-receipt/v6";
const TASK_ID = "g1.4b-outcome-fault-safety:g14b-phase-order-20260828";
const RUN_ID = "g14b-phase-order-20260828";
const CONTRACT_SHA256 =
  "926724ae8c8d206b4a4de576eb0120fc21c75aa96c99fb4f38664a2bdf3b44c8";
const EVALUATOR_COMMIT = "fa832174f3023e035fbaad52721f1b616eb1752e";
const SELECTED_COMMIT = "a1ca1eb45dba23c246ce84f70d67740c9bd388ab";
const SELECTED_TREE = "ab5b281da2ee40c12122a9598d19d33b699d0b86";
const SELECTED_PATCH_SHA256 =
  "02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314";
const CLAIM_SCOPE = "simulated-storage-call-pre-and-post-write-faults-only/v1";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`G1.7 G1.4b prerequisite: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const binding = deepFreeze({
  schema: G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  task: {
    id: TASK_ID,
    runId: RUN_ID,
  },
  contract: {
    sha256: CONTRACT_SHA256,
    evaluatorCommit: EVALUATOR_COMMIT,
    success: {
      publicPassed: 8,
      independentPassed: 7,
      regressionPassed: 20,
    },
  },
  selectedCandidate: {
    commit: SELECTED_COMMIT,
    tree: SELECTED_TREE,
    patchSha256: SELECTED_PATCH_SHA256,
  },
  applicationReceipt: {
    schema: APPLICATION_RECEIPT_SCHEMA,
    bytes: G17_G14B_APPLICATION_RECEIPT_BYTES,
    rawSha256: G17_G14B_APPLICATION_RECEIPT_RAW_SHA256,
    receiptSha256: G17_G14B_APPLICATION_RECEIPT_SHA256,
  },
  claim: {
    scope: CLAIM_SCOPE,
    crashDurability: false,
    powerLossDurability: false,
    fsyncDurability: false,
  },
});

const projection = deepFreeze({
  schema: G17_G14B_PREREQUISITE_SCHEMA,
  status: "PASS",
  binding,
  bindingSha256: canonicalSha256(binding),
  artifact: {
    name: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
    bytes: G17_G14B_APPLICATION_RECEIPT_BYTES,
    sha256: G17_G14B_APPLICATION_RECEIPT_RAW_SHA256,
  },
});

function exactInput(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !isDeepStrictEqual(Reflect.ownKeys(input), ["receiptBytes"])
  ) {
    fail("replay input must contain exactly receiptBytes");
  }
  const suppliedBytes = input.receiptBytes;
  if (!Buffer.isBuffer(suppliedBytes)) {
    fail("receiptBytes must be a Buffer");
  }
  return Buffer.from(suppliedBytes);
}

function validateReceipt(receipt) {
  if (
    receipt.schema !== APPLICATION_RECEIPT_SCHEMA ||
    receipt.receiptSha256 !== G17_G14B_APPLICATION_RECEIPT_SHA256 ||
    receipt.run?.id !== RUN_ID ||
    receipt.run?.taskId !== TASK_ID ||
    receipt.contract?.sha256 !== CONTRACT_SHA256 ||
    receipt.contract?.evaluator?.commit !== EVALUATOR_COMMIT ||
    !isDeepStrictEqual(receipt.contract?.success, binding.contract.success) ||
    !isDeepStrictEqual(
      {
        commit: receipt.selectedCandidate?.commit,
        tree: receipt.selectedCandidate?.tree,
        patchSha256: receipt.selectedCandidate?.patchSha256,
      },
      binding.selectedCandidate,
    ) ||
    receipt.final?.verdict !== "ACCEPT"
  ) {
    fail("replayed application receipt differs from the accepted binding");
  }
}

/**
 * Purely replays the accepted G1.4b application receipt and derives the exact
 * prerequisite projection. This function never performs Router admission or
 * executes a task programme.
 */
export function replayG17G14bPrerequisite(input) {
  const bytes = exactInput(input);
  if (bytes.at(-1) === 0x0a) {
    fail("accepted receipt bytes must not have a trailing LF");
  }
  if (bytes.length !== G17_G14B_APPLICATION_RECEIPT_BYTES) {
    fail(
      `accepted receipt must be exactly ${G17_G14B_APPLICATION_RECEIPT_BYTES} bytes`,
    );
  }
  if (sha256(bytes) !== G17_G14B_APPLICATION_RECEIPT_RAW_SHA256) {
    fail("accepted receipt raw SHA-256 differs");
  }
  let receipt;
  try {
    receipt = replayApplicationReceipt(utf8.decode(bytes));
  } catch (error) {
    fail(`accepted receipt replay failed: ${error.message}`);
  }
  validateReceipt(receipt);
  return projection;
}

export function g17G14bPrerequisiteProjectionSha256(value) {
  if (!isDeepStrictEqual(value, projection)) {
    fail("prerequisite projection differs from the accepted binding");
  }
  return canonicalSha256(value);
}

function stableReadExact(path) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    fail("O_NOFOLLOW is unavailable");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.size !== BigInt(G17_G14B_APPLICATION_RECEIPT_BYTES)
    ) {
      fail("receipt source is not the exact bounded regular file");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) {
        fail("receipt source changed while being read");
      }
    }
    if (BigInt(bytes.length) !== before.size) {
      fail("receipt source read length drifted");
    }
    return bytes;
  } catch (error) {
    if (error.message.startsWith("G1.7 G1.4b prerequisite:")) throw error;
    fail(`receipt source cannot be read safely: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function evidenceBundle(receiptBytes) {
  const bytes = Buffer.from(receiptBytes);
  const prerequisite = replayG17G14bPrerequisite({ receiptBytes: bytes });
  return Object.freeze({
    status: "PASS",
    sha256: g17G14bPrerequisiteProjectionSha256(prerequisite),
    reasons: Object.freeze([]),
    projection: prerequisite,
    artifacts: Object.freeze([
      Object.freeze({
        name: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
        bytes,
      }),
    ]),
  });
}

/** Stable no-follow reader for a caller-selected accepted receipt source. */
export function loadG17G14bPrerequisite({ receiptPath } = {}) {
  if (typeof receiptPath !== "string" || receiptPath.length === 0) {
    fail("receiptPath must be a non-empty string");
  }
  return evidenceBundle(stableReadExact(receiptPath));
}

export function inspectG17G14bPrerequisite({ receiptPath } = {}) {
  if (receiptPath === undefined) {
    return Object.freeze({
      status: "MISSING",
      sha256: null,
      reasons: Object.freeze(["g1.4b-application-receipt-absent"]),
      projection: null,
      artifacts: Object.freeze([]),
    });
  }
  try {
    return loadG17G14bPrerequisite({ receiptPath });
  } catch {
    return Object.freeze({
      status: "STALE",
      sha256: null,
      reasons: Object.freeze(["g1.4b-application-receipt-invalid-or-stale"]),
      projection: null,
      artifacts: Object.freeze([]),
    });
  }
}
