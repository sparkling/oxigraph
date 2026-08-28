import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  G17_LEGACY_V4_CONTRACT_SHA256,
  decodeSealedG17Contract,
} from "../../src/qualification/contract.mjs";

const bytes = readFileSync(
  new URL("../fixtures/g17-qualification-contract-v4.json", import.meta.url),
);

export const g17LegacyV4Contract = decodeSealedG17Contract({
  bytes,
  receiptSha256: G17_LEGACY_V4_CONTRACT_SHA256,
});

export const g17LegacyV4DecisionRoot = fileURLToPath(
  new URL("../fixtures", import.meta.url),
);

export function loadG17LegacyV4Contract() {
  return g17LegacyV4Contract;
}
