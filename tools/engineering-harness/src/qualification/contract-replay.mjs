import {
  G17_CURRENT_CONTRACT_SHA256,
  decodeG17ContractByteIdentity,
} from "./contract-identity.mjs";

async function loadCurrentContractModule() {
  return import("./contract.mjs");
}

export async function decodeSealedG17ContractForReplay(input) {
  const identified = decodeG17ContractByteIdentity(input);
  if (identified.contractSha256 !== G17_CURRENT_CONTRACT_SHA256) {
    return identified;
  }

  let current;
  try {
    current = await loadCurrentContractModule();
  } catch (error) {
    throw new Error(
      `G1.7 qualification contract: current protocol runtime validation failed: ${error.message}`,
      { cause: error },
    );
  }
  if (typeof current?.decodeSealedG17Contract !== "function") {
    throw new Error(
      "G1.7 qualification contract: current protocol runtime validation failed: current contract decoder is unavailable",
    );
  }
  return current.decodeSealedG17Contract({
    bytes: identified.bytes,
    receiptSha256: identified.contractSha256,
  });
}
