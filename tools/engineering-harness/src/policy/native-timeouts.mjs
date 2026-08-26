import { WORKER_ROLES, validateWorkerRole } from "./authority.mjs";

export const NATIVE_WORKER_TIMEOUT_CEILINGS_MS = Object.freeze({
  architecture: 600_000,
  critique: 600_000,
  implementation: 1_200_000,
  review: 600_000,
  repair: 1_200_000,
});

if (
  WORKER_ROLES.some(
    (role) => !Object.hasOwn(NATIVE_WORKER_TIMEOUT_CEILINGS_MS, role),
  ) ||
  Object.keys(NATIVE_WORKER_TIMEOUT_CEILINGS_MS).some(
    (role) => !WORKER_ROLES.includes(role),
  )
) {
  throw new Error("native worker timeout policy does not cover the exact worker roles");
}

export function nativeWorkerTimeoutCeilingMs(role) {
  validateWorkerRole(role);
  return NATIVE_WORKER_TIMEOUT_CEILINGS_MS[role];
}

export function nativeWorkerTimeoutMs(role, aggregateCeilingMs) {
  const roleCeilingMs = nativeWorkerTimeoutCeilingMs(role);
  if (!Number.isSafeInteger(aggregateCeilingMs) || aggregateCeilingMs <= 0) {
    throw new Error("native worker aggregate timeout ceiling must be a positive safe integer");
  }
  return Math.min(roleCeilingMs, aggregateCeilingMs);
}
