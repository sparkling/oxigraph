import { runGit } from "./git.mjs";
import { runSandboxVerificationSession } from "./sandbox-session.mjs";

const commandOrder = Object.freeze([
  "format",
  "build",
  "public",
  "independent",
  "regression",
]);
const evaluatorNames = Object.freeze(["public", "independent", "regression"]);
const sessionArtifactName = "verifier-session-result.json";

async function assertCandidateIdentity(candidate) {
  const [commit, tree] = await Promise.all([
    runGit({ args: ["rev-parse", "HEAD"], cwd: candidate.workspace, home: candidate.gitHome }),
    runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: candidate.workspace, home: candidate.gitHome }),
  ]);
  if (commit.trim() !== candidate.candidateCommit) {
    throw new Error("candidate workspace no longer resolves to its sealed commit");
  }
  if (tree.trim() !== candidate.candidateTree) {
    throw new Error("candidate workspace no longer resolves to its sealed tree");
  }
}

function sameArgv(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedDisposition(value) {
  if (["timeout", "timeout-unreaped"].includes(value)) return "timed-out";
  if (["output-limit", "output-limit-unreaped"].includes(value)) return "output-limit";
  return value;
}

function commandEvidence(record, sandboxArgv) {
  return Object.freeze({
    name: record.name,
    logicalArgv: record.logicalArgv,
    sandboxArgv,
    network: "isolated",
    workspace: "read-only",
    exitCode: record.exitCode,
    signal: record.signal,
    disposition: normalizedDisposition(record.disposition),
    durationMs: record.durationMs,
    stdoutSha256: record.stdoutSha256,
    stderrSha256: record.stderrSha256,
    stdoutTail: record.stdout.slice(-4096),
    stderrTail: record.stderr.slice(-4096),
  });
}

function sessionResultArtifact(report) {
  return Object.freeze({ name: sessionArtifactName, sha256: report.resultSha256, bytes: report.resultBytes });
}

function normalizedArtifacts(report) {
  if (report.session.artifacts.some(({ name }) => name === sessionArtifactName)) {
    throw new Error("verifier executable artifact collides with reserved session evidence");
  }
  return Object.freeze([
    ...report.session.artifacts.map(({ name, sha256, bytes }) => Object.freeze({ name, sha256, bytes })),
    sessionResultArtifact(report),
  ]);
}

function validateSessionReport(report, contract) {
  if (
    report?.session?.status !== "completed" ||
    report?.outcome?.disposition !== "completed" ||
    report.outcome.exitCode !== 0 ||
    report?.invocation?.network !== "isolated" ||
    report.invocation.workspace !== "read-only" ||
    report.invocation.state !== "single-quota-tmpfs" ||
    !Array.isArray(report.invocation.argv) ||
    report.invocation.argv.length < 2 ||
    report.invocation.argv.some((argument) => typeof argument !== "string" || argument.includes("\0")) ||
    !/^[a-f0-9]{64}$/.test(report.resultSha256) ||
    !Number.isSafeInteger(report.resultBytes) ||
    report.resultBytes < 1 ||
    !Array.isArray(report.session.commands) ||
    !Array.isArray(report.session.artifacts)
  ) {
    throw new Error("single-session verifier returned invalid infrastructure evidence");
  }
  const expectedCounts = Object.freeze({ format: 1, build: 2, complete: 5 });
  if (report.session.commands.length !== expectedCounts[report.session.stage]) {
    throw new Error("single-session verifier stage and command count disagree");
  }
  for (let index = 0; index < report.session.commands.length; index += 1) {
    const record = report.session.commands[index];
    const name = commandOrder[index];
    if (
      record?.name !== name ||
      !sameArgv(record.logicalArgv, contract.commands[name].argv) ||
      !["completed", "timeout", "timeout-unreaped", "output-limit", "output-limit-unreaped"].includes(record.disposition) ||
      typeof record.stdout !== "string" ||
      typeof record.stderr !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.stdoutSha256) ||
      !/^[a-f0-9]{64}$/.test(record.stderrSha256)
    ) {
      throw new Error(`single-session verifier returned invalid ${name} evidence`);
    }
  }
  for (const artifact of report.session.artifacts) {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      typeof artifact.name !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1
    ) {
      throw new Error("single-session verifier returned invalid artifact evidence");
    }
  }
  return report;
}

async function createVerificationSession({ candidate, contract, signal, sessionRunner }) {
  await assertCandidateIdentity(candidate);
  const report = validateSessionReport(
    await sessionRunner({
      workspace: candidate.workspace,
      commands: contract.commands,
      maxTotalWallMs: contract.ceilings.maxTotalVerifierWallMs,
      maxResidentBytes: contract.ceilings.maxResidentBytes,
      maxDiskBytes: contract.ceilings.maxVerifierDiskBytes,
      cargoBuildJobs: contract.ceilings.cargoBuildJobs,
      maxBuildOutputBytes: contract.ceilings.maxBuildOutputBytes,
      maxTestOutputBytesPerCommand: contract.ceilings.maxTestOutputBytesPerCommand,
      signal,
    }),
    contract,
  );
  await assertCandidateIdentity(candidate);
  const commands = Object.freeze(report.session.commands.map((record) => commandEvidence(record, report.invocation.argv)));
  return Object.freeze({
    report,
    commands,
    rawOutcomes: new Map(report.session.commands.map((record) => [record.name, record])),
    artifacts: normalizedArtifacts(report),
    durationMs: report.session.durationMs,
  });
}

function earlyVerdict(session, verdict, stage) {
  return Object.freeze({ verdict, stage, commands: session.commands, artifacts: session.artifacts, durationMs: session.durationMs });
}

function commandPassed(command, expectedPassed) {
  return command.disposition === "completed" && command.exitCode === 0 && `${command.stdoutTail}\n${command.stderrTail}`.includes(`test result: ok. ${expectedPassed} passed; 0 failed;`);
}

async function verifyCandidateWithRunner({ candidate, contract, signal }, sessionRunner) {
  if (candidate.kind !== "candidate" || candidate.candidatePatchSha256 === null) {
    throw new Error("candidate verification requires a sealed product patch");
  }
  const session = await createVerificationSession({ candidate, contract, signal, sessionRunner });
  if (session.commands[0]?.disposition !== "completed" || session.commands[0]?.exitCode !== 0) return earlyVerdict(session, "REJECT", "format");
  if (session.commands[1]?.disposition !== "completed" || session.commands[1]?.exitCode !== 0) return earlyVerdict(session, "REJECT", "build");
  const evaluatorCommands = session.commands.filter(({ name }) => evaluatorNames.includes(name));
  const green = evaluatorCommands.length === evaluatorNames.length && evaluatorCommands.every((command) => commandPassed(command, contract.success[`${command.name}Passed`]));
  return Object.freeze({
    verdict: green ? "ACCEPT" : "REJECT",
    stage: green ? "complete" : "evaluation",
    commands: session.commands,
    artifacts: session.artifacts,
    durationMs: session.durationMs,
    candidateTree: candidate.candidateTree,
    protectedManifest: candidate.protectedManifest,
  });
}

async function verifyRedBaselineWithRunner({ candidate, contract, signal }, sessionRunner) {
  if (candidate.kind !== "evaluator" || candidate.candidateCommit !== contract.evaluator.commit || candidate.candidatePatchSha256 !== null) {
    throw new Error("red-baseline verification requires the sealed evaluator tree");
  }
  const session = await createVerificationSession({ candidate, contract, signal, sessionRunner });
  if (session.commands[0]?.disposition !== "completed" || session.commands[0]?.exitCode !== 0) return earlyVerdict(session, "INCONCLUSIVE", "format");
  if (session.commands[1]?.disposition !== "completed" || session.commands[1]?.exitCode !== 0) return earlyVerdict(session, "INCONCLUSIVE", "build");
  const publicEvidence = session.commands.find(({ name }) => name === "public");
  const publicOutcome = session.rawOutcomes.get("public");
  const publicText = `${publicOutcome.stdout}\n${publicOutcome.stderr}`;
  const red = publicEvidence.disposition === "completed" && publicEvidence.exitCode === contract.initialRed.exitCode && publicText.includes(`test result: FAILED. ${contract.initialRed.passed} passed; ${contract.initialRed.failed} failed;`) && contract.initialRed.requiredSubstrings.every((value) => publicText.includes(value)) && contract.initialRed.forbiddenSubstrings.every((value) => !publicText.includes(value));
  const independent = session.commands.find(({ name }) => name === "independent");
  const regression = session.commands.find(({ name }) => name === "regression");
  const referencesGreen = commandPassed(independent, contract.success.independentPassed) && commandPassed(regression, contract.success.regressionPassed);
  const confirmed = red && referencesGreen;
  return Object.freeze({
    verdict: confirmed ? "CONFIRMED_RED" : "INVALID_BASELINE",
    stage: "complete",
    commands: session.commands,
    artifacts: session.artifacts,
    durationMs: session.durationMs,
    candidateTree: candidate.candidateTree,
    protectedManifest: candidate.protectedManifest,
    initialRedMatched: red,
    referencesGreen,
  });
}

export async function verifyCandidate(args) {
  return verifyCandidateWithRunner(args, runSandboxVerificationSession);
}

export async function verifyRedBaseline(args) {
  return verifyRedBaselineWithRunner(args, runSandboxVerificationSession);
}

export function createVerifierForTesting(sessionRunner) {
  if (typeof sessionRunner !== "function") throw new Error("test verifier requires a whole-session runner");
  return Object.freeze({
    verifyCandidate: (args) => verifyCandidateWithRunner(args, sessionRunner),
    verifyRedBaseline: (args) => verifyRedBaselineWithRunner(args, sessionRunner),
  });
}
