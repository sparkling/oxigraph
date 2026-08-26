const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;

function usage() {
  throw new Error(
    "G1.7 qualification usage: preflight | run [--run-id <safe-id>] | verify --run-id <safe-id>",
  );
}

export function parseG17CliArgs(args) {
  if (!Array.isArray(args)) usage();
  if (args.length === 1 && args[0] === "preflight") {
    return Object.freeze({ action: "preflight" });
  }
  if (args[0] === "run") {
    if (args.length === 1) {
      return Object.freeze({ action: "run", runId: undefined });
    }
    if (
      args.length === 3 &&
      args[1] === "--run-id" &&
      SAFE_ID.test(args[2])
    ) {
      return Object.freeze({ action: "run", runId: args[2] });
    }
    usage();
  }
  if (
    args[0] === "verify" &&
    args.length === 3 &&
    args[1] === "--run-id" &&
    SAFE_ID.test(args[2])
  ) {
    return Object.freeze({ action: "verify", runId: args[2] });
  }
  usage();
}

export function g17VerdictExitCode(verdict) {
  if (verdict === "REJECT") return 3;
  if (verdict === "INCONCLUSIVE") return 4;
  if (verdict === "ACCEPT") return 0;
  return 2;
}

export function g17VerificationExitCode(result) {
  if (
    result?.ok !== true ||
    result.verificationStatus !== "SEALED_RUN_VERIFIED" ||
    (result.verdict === "ACCEPT" && result.qualificationEligible !== true)
  ) {
    return 2;
  }
  return g17VerdictExitCode(result.verdict);
}
