import {
  G17_BENCHMARK_OWNER_BATCH_NAME,
  buildG17ControlReceiptCandidate,
  replayG17ControlReceipt,
} from "../../src/qualification/control-receipt-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../../src/routing/features.mjs";
import {
  G17_BENCHMARK_OWNER_FIXTURE_RUN_ID,
  createG17BenchmarkOwnerFixture,
} from "./g17-benchmark-owner-fixture.mjs";

export const G17_CONTROL_RECEIPT_FIXTURE_RUN_ID =
  G17_BENCHMARK_OWNER_FIXTURE_RUN_ID;
export const G17_CONTROL_RECEIPT_STARTED_AT = "2026-08-28T08:01:00.000Z";
export const G17_CONTROL_RECEIPT_COMPLETED_AT = "2026-08-28T08:02:00.000Z";

export function g17ControlReceiptBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function g17DecodeControlReceipt(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

export function g17ResealControlReceipt(value) {
  const { receiptSha256: ignored, ...unsigned } = structuredClone(value);
  return {
    ...unsigned,
    receiptSha256: canonicalSha256(unsigned),
  };
}

export function g17ControlReceiptArtifactsByName(ownerBatchBytes) {
  return new Map([
    [G17_BENCHMARK_OWNER_BATCH_NAME, Buffer.from(ownerBatchBytes)],
  ]);
}

export function createG17ControlReceiptFixture({
  controlRunId = G17_CONTROL_RECEIPT_FIXTURE_RUN_ID,
  startedAt = G17_CONTROL_RECEIPT_STARTED_AT,
  completedAt = G17_CONTROL_RECEIPT_COMPLETED_AT,
  elapsedNs,
} = {}) {
  const ownerFixture = createG17BenchmarkOwnerFixture({
    controlRunId,
    ...(elapsedNs === undefined ? {} : { elapsedNs }),
  });
  const built = buildG17ControlReceiptCandidate({
    authorizationBytes: ownerFixture.authorizationBytes,
    controlRunId,
    startedAt,
    completedAt,
    artifacts: ownerFixture.artifacts,
  });
  return {
    ...ownerFixture,
    startedAt,
    completedAt,
    receiptBytes: Buffer.from(built.receiptBytes),
    ownerBatchBytes: Buffer.from(built.ownerBatchBytes),
    artifactsByName: g17ControlReceiptArtifactsByName(built.ownerBatchBytes),
    replay: built.replay,
  };
}

export function replayG17ControlReceiptFixture(
  fixture,
  {
    authorizationBytes = fixture.authorizationBytes,
    receiptBytes = fixture.receiptBytes,
    artifactsByName = fixture.artifactsByName,
  } = {},
) {
  return replayG17ControlReceipt({
    authorizationBytes,
    receiptBytes,
    artifactsByName,
  });
}
