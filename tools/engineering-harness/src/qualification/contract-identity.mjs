import { createHash } from "node:crypto";

import { canonicalJson } from "../routing/features.mjs";

export const G17_CONTRACT_SCHEMA = "oxigraph.g1.7-qualification-contract/v4";
export const G17_LEGACY_V1_CONTRACT_SHA256 =
  "e267e4d276a3d0b7997c2522d3f24ca7a32f669282c5f2ea332a752c3322c54c";
export const G17_LEGACY_CONTRACT_SHA256 = G17_LEGACY_V1_CONTRACT_SHA256;
export const G17_LEGACY_V3_CONTRACT_SHA256 =
  "de547f5bc4a484f83da1b3d9167c4969766189455a22f9dcf542b471a8b77278";
export const G17_CURRENT_CONTRACT_SHA256 =
  "dd97f4a25b9555c1b711d697cdf636d1949690138fd3a78eb2f02a8b7a9b24f0";
export const G17_CONTRACT_GENERATION = Object.freeze({
  LEGACY_V1: "LEGACY_V1",
  LEGACY_V3: "LEGACY_V3",
  CURRENT_V4: "CURRENT_V4",
});

const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_CONTRACT_BYTES = 1024 * 1024;

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

function generationForSha256(contractSha256) {
  if (contractSha256 === G17_LEGACY_V1_CONTRACT_SHA256) {
    return G17_CONTRACT_GENERATION.LEGACY_V1;
  }
  if (contractSha256 === G17_LEGACY_V3_CONTRACT_SHA256) {
    return G17_CONTRACT_GENERATION.LEGACY_V3;
  }
  if (contractSha256 === G17_CURRENT_CONTRACT_SHA256) {
    return G17_CONTRACT_GENERATION.CURRENT_V4;
  }
  throw new Error("copied contract has an unsupported byte identity");
}

export function decodeG17ContractByteIdentity(input = {}) {
  try {
    const suppliedBytes = input?.bytes;
    if (
      !Buffer.isBuffer(suppliedBytes) ||
      suppliedBytes.length < 1 ||
      suppliedBytes.length > MAX_CONTRACT_BYTES
    ) {
      throw new Error("copied bytes are not a bounded Buffer");
    }
    const bytes = Buffer.from(suppliedBytes);
    const receiptSha256 = input?.receiptSha256;
    const contractSha256 = sha256(bytes);
    if (!DIGEST.test(receiptSha256 ?? "") || receiptSha256 !== contractSha256) {
      throw new Error("copied bytes differ from the receipt digest");
    }
    const generation = generationForSha256(contractSha256);
    let contract;
    try {
      contract = JSON.parse(bytes);
    } catch (error) {
      throw new Error(`copied contract is invalid JSON: ${error.message}`);
    }
    if (generation === G17_CONTRACT_GENERATION.CURRENT_V4) {
      if (!bytes.equals(Buffer.from(`${canonicalJson(contract)}\n`, "utf8"))) {
        throw new Error(
          "current contract bytes are not canonical JSON plus one LF",
        );
      }
      if (
        contract?.schema !== G17_CONTRACT_SCHEMA ||
        contract.id !== "g1.7-compatibility-performance-qualification" ||
        contract.programme !== "linked-data-store"
      ) {
        throw new Error("current byte identity has impossible parsed metadata");
      }
    } else {
      const expectedSchema =
        generation === G17_CONTRACT_GENERATION.LEGACY_V1
          ? "oxigraph.g1.7-qualification-contract/v1"
          : "oxigraph.g1.7-qualification-contract/v3";
      if (
        contract?.schema !== expectedSchema ||
        contract.id !== "g1.7-compatibility-performance-qualification" ||
        contract.programme !== "linked-data-store"
      ) {
        throw new Error("legacy byte identity has impossible parsed metadata");
      }
    }
    return Object.freeze({
      contract: deepFreeze(contract),
      bytes,
      contractSha256,
      generation,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 qualification contract:")) throw error;
    throw new Error(`G1.7 qualification contract: ${error.message}`);
  }
}

export function g17ContractCompatibilityGeneration({
  contractGeneration,
  compatibilityStatus,
  compatibilitySchemaState,
}) {
  try {
    if (
      !Object.values(G17_CONTRACT_GENERATION).includes(contractGeneration) ||
      !["PASS", "FAIL", "MISSING", "STALE", "NOT_RUN"].includes(
        compatibilityStatus,
      ) ||
      ![
        "CURRENT_SCHEMA_UNREPLAYED",
        "LEGACY_REPLAY_ONLY",
        "NOT_APPLICABLE",
      ].includes(compatibilitySchemaState)
    ) {
      throw new Error("contract/evidence generation state is invalid");
    }
    const currentContract =
      contractGeneration === G17_CONTRACT_GENERATION.CURRENT_V4;
    const currentCompatibility =
      compatibilitySchemaState === "CURRENT_SCHEMA_UNREPLAYED";
    if (
      compatibilityStatus === "PASS" &&
      currentContract !== currentCompatibility
    ) {
      throw new Error(
        "contract and compatibility evidence generations are mixed",
      );
    }
    return Object.freeze({
      currentContract,
      currentCompatibility,
      legacyReplayOnly:
        !currentContract || compatibilitySchemaState === "LEGACY_REPLAY_ONLY",
    });
  } catch (error) {
    throw new Error(`G1.7 qualification contract: ${error.message}`);
  }
}

export function decodeReviewedG17V4Contract({
  contractBytes,
  contractSha256,
} = {}) {
  if (
    !Buffer.isBuffer(contractBytes) ||
    contractBytes.length < 1 ||
    contractBytes.length > MAX_CONTRACT_BYTES ||
    contractSha256 !== G17_CURRENT_CONTRACT_SHA256 ||
    sha256(contractBytes) !== G17_CURRENT_CONTRACT_SHA256
  ) {
    throw new Error("contract bytes are not the reviewed v4 byte identity");
  }
  let contract;
  try {
    contract = JSON.parse(contractBytes);
  } catch (error) {
    throw new Error(`contract bytes are invalid JSON: ${error.message}`);
  }
  if (
    !contractBytes.equals(Buffer.from(`${canonicalJson(contract)}\n`, "utf8"))
  ) {
    throw new Error("reviewed v4 contract bytes are not canonical");
  }
  if (
    contract?.schema !== G17_CONTRACT_SCHEMA ||
    contract.id !== "g1.7-compatibility-performance-qualification" ||
    contract.programme !== "linked-data-store"
  ) {
    throw new Error("reviewed v4 contract has impossible parsed metadata");
  }
  return deepFreeze(contract);
}
