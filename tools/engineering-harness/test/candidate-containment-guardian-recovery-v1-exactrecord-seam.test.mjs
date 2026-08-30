import assert from "node:assert/strict";
import test from "node:test";

import {
  plain,
  probeExactRecordNoSortContractV1,
} from "./candidate-containment-guardian-recovery-v1.fixture.mjs";

test("exactRecord provides the captured-intrinsics no-sort recovery record-reference preflight", () => {
  assert.deepEqual(plain(probeExactRecordNoSortContractV1()), {
    acceptedPermutationCount: 2,
    normalizedKeyOrders: [
      ["name", "bytes"],
      ["name", "bytes"],
    ],
    normalizedPrototypesAreNull: true,
    normalizedValuesRetainIdentity: true,
    proxyRejected: true,
    proxyTrapHits: 0,
    accessorRejected: true,
    getterHits: 0,
    duplicateExpectedRejected: true,
    dynamicIntrinsicHits: 0,
  });
});
