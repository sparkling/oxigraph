// The reconstruction module owns the sole production WeakMap and therefore
// the only safe transition from an opaque public identity into verification.
// This facade intentionally exports no runner, path, contract, or handle seam.
export { verifyCandidateV2 } from "./reconstruct-v2.mjs";
