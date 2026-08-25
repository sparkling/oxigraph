export const NATIVE_FAILURE_CODES = Object.freeze([
  "process-incomplete",
  "process-nonzero",
  "output-missing",
  "provider-envelope-invalid",
  "worker-json-invalid",
  "role-contract-invalid",
  "patch-policy-invalid",
  "worker-declined",
]);

export function validateNativeFailureCode(value, label = "native failure code") {
  if (!NATIVE_FAILURE_CODES.includes(value)) {
    throw new Error(`${label} is unsupported`);
  }
  return value;
}
