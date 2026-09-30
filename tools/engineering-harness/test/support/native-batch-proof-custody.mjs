import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function assertNativeBatchProofCustody(final) {
  const record = JSON.parse(readFileSync(join(final.directory, "result.json"), "utf8"));
  assert.deepEqual(record.custodyErrors, [], "Native batch proof requires released durable custody");
  return record;
}
