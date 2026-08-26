import { runGit } from "./git.mjs";
import { normalizeCommandFailureDiagnostic } from "./failure-diagnostic.mjs";
import { runSandboxVerificationSession } from "./sandbox-session.mjs";
import {
  MAX_SANDBOX_ARGV_ITEMS,
  MAX_TASK_ARG_BYTES,
} from "../policy/evidence-limits.mjs";

const legacyCommandOrder = Object.freeze([
  "format",
  "build",
  "public",
  "independent",
  "regression",
]);
const serviceCommandOrder = Object.freeze([
  "format",
  "build",
  "public",
  "service",
  "independent",
  "regression",
]);
const sessionArtifactName = "verifier-session-result.json";

function commandOrder(contract) {
  const sequence = contract.verificationSequence;
  if (
    ![legacyCommandOrder, serviceCommandOrder].some((expected) =>
      sameArgv(sequence, expected),
    )
  ) {
    throw new Error("contract has an unsupported verifier command sequence");
  }
  return sequence;
}

function evaluatorNames(contract) {
  return commandOrder(contract).slice(2);
}

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

function validSandboxArgument(argument) {
  return (
    typeof argument === "string" &&
    argument.length > 0 &&
    Buffer.byteLength(argument) <= MAX_TASK_ARG_BYTES &&
    !/[\0\r\n]/u.test(argument)
  );
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
  const order = commandOrder(contract);
  if (
    report?.session?.status !== "completed" ||
    report?.outcome?.disposition !== "completed" ||
    report.outcome.exitCode !== 0 ||
    report?.invocation?.network !== "isolated" ||
    report.invocation.workspace !== "read-only" ||
    report.invocation.state !== "single-quota-tmpfs" ||
    !Array.isArray(report.invocation.argv) ||
    report.invocation.argv.length < 2 ||
    report.invocation.argv.length > MAX_SANDBOX_ARGV_ITEMS ||
    report.invocation.argv.some((argument) => !validSandboxArgument(argument)) ||
    !/^[a-f0-9]{64}$/.test(report.resultSha256) ||
    !Number.isSafeInteger(report.resultBytes) ||
    report.resultBytes < 1 ||
    !Array.isArray(report.session.commands) ||
    !Array.isArray(report.session.artifacts)
  ) {
    throw new Error("single-session verifier returned invalid infrastructure evidence");
  }
  const expectedCounts = Object.freeze({
    format: 1,
    build: 2,
    complete: order.length,
  });
  if (report.session.commands.length !== expectedCounts[report.session.stage]) {
    throw new Error("single-session verifier stage and command count disagree");
  }
  for (let index = 0; index < report.session.commands.length; index += 1) {
    const record = report.session.commands[index];
    const name = order[index];
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
      verificationSequence: commandOrder(contract),
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

function candidateIdentity(candidate) {
  return Object.freeze({
    candidateTree: candidate.candidateTree,
    protectedManifest: candidate.protectedManifest,
  });
}

function earlyVerdict(session, candidate, verdict, stage, commands = session.commands) {
  return Object.freeze({
    verdict,
    stage,
    commands,
    artifacts: session.artifacts,
    durationMs: session.durationMs,
    ...candidateIdentity(candidate),
  });
}

function redBaselineCommands(session) {
  return Object.freeze(
    session.commands.map((command) => {
      const diagnostic = session.rawOutcomes.get(command.name)?.diagnostic;
      return Object.freeze({
        ...command,
        diagnostic:
          diagnostic === undefined || diagnostic === null
            ? null
            : normalizeCommandFailureDiagnostic(diagnostic),
      });
    }),
  );
}

function commandPassed(command, expectedPassed) {
  return command.disposition === "completed" && command.exitCode === 0 && `${command.stdoutTail}\n${command.stderrTail}`.includes(`test result: ok. ${expectedPassed} passed; 0 failed;`);
}

function infrastructureFailure(session) {
  return session.commands.some((command) => {
    const outcome = session.rawOutcomes.get(command.name);
    const diagnostic =
      outcome?.diagnostic === undefined || outcome.diagnostic === null
        ? null
        : normalizeCommandFailureDiagnostic(outcome.diagnostic);
    return (
      ["timeout", "timeout-unreaped"].includes(outcome?.disposition) ||
      diagnostic?.primaryClass === "state-exhausted" ||
      ["ENOSPC", "EDQUOT"].includes(diagnostic?.ioErrno)
    );
  });
}

function initialRedMatched(evidence, outcome, initialRed) {
  if (
    evidence?.disposition !== "completed" ||
    evidence.exitCode !== initialRed.exitCode
  ) {
    return false;
  }
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  const common =
    initialRed.requiredSubstrings.every((value) => text.includes(value)) &&
    initialRed.forbiddenSubstrings.every((value) => !text.includes(value));
  if (!common) return false;
  if (initialRed.kind !== "compiler") {
    return text.includes(
      `test result: FAILED. ${initialRed.passed} passed; ${initialRed.failed} failed;`,
    );
  }
  const rustcErrors = text.match(/^error\[E\d{4}\]:/gmu) ?? [];
  return (
    rustcErrors.length === initialRed.rustcErrorCount &&
    text.includes(`error[${initialRed.rustcCode}]:`) &&
    text.includes(`--> ${initialRed.primaryPath}:`) &&
    initialRed.requiredExports.every((value) => text.includes(value))
  );
}

async function verifyCandidateWithRunner({ candidate, contract, signal }, sessionRunner) {
  if (candidate.kind !== "candidate" || candidate.candidatePatchSha256 === null) {
    throw new Error("candidate verification requires a sealed product patch");
  }
  const session = await createVerificationSession({ candidate, contract, signal, sessionRunner });
  if (infrastructureFailure(session)) {
    return earlyVerdict(session, candidate, "INCONCLUSIVE", "infrastructure");
  }
  if (session.commands[0]?.disposition !== "completed" || session.commands[0]?.exitCode !== 0) return earlyVerdict(session, candidate, "REJECT", "format");
  if (session.commands[1]?.disposition !== "completed" || session.commands[1]?.exitCode !== 0) return earlyVerdict(session, candidate, "REJECT", "build");
  const expectedEvaluators = evaluatorNames(contract);
  const evaluatorCommands = session.commands.filter(({ name }) =>
    expectedEvaluators.includes(name),
  );
  const green =
    evaluatorCommands.length === expectedEvaluators.length &&
    evaluatorCommands.every((command) =>
      commandPassed(command, contract.success[`${command.name}Passed`]),
    );
  return Object.freeze({
    verdict: green ? "ACCEPT" : "REJECT",
    stage: green ? "complete" : "evaluation",
    commands: session.commands,
    artifacts: session.artifacts,
    durationMs: session.durationMs,
    ...candidateIdentity(candidate),
  });
}

async function verifyRedBaselineWithRunner({ candidate, contract, signal }, sessionRunner) {
  if (candidate.kind !== "evaluator" || candidate.candidateCommit !== contract.evaluator.commit || candidate.candidatePatchSha256 !== null) {
    throw new Error("red-baseline verification requires the sealed evaluator tree");
  }
  const session = await createVerificationSession({ candidate, contract, signal, sessionRunner });
  const commands = redBaselineCommands(session);
  if (infrastructureFailure(session)) {
    return earlyVerdict(
      session,
      candidate,
      "INCONCLUSIVE",
      "infrastructure",
      commands,
    );
  }
  if (commands[0]?.disposition !== "completed" || commands[0]?.exitCode !== 0) {
    return earlyVerdict(session, candidate, "INCONCLUSIVE", "format", commands);
  }
  if (commands[1]?.disposition !== "completed" || commands[1]?.exitCode !== 0) {
    return earlyVerdict(session, candidate, "INCONCLUSIVE", "build", commands);
  }
  const publicEvidence = commands.find(({ name }) => name === "public");
  const publicOutcome = session.rawOutcomes.get("public");
  const red = initialRedMatched(
    publicEvidence,
    publicOutcome,
    contract.initialRed,
  );
  const independent = commands.find(({ name }) => name === "independent");
  const regression = commands.find(({ name }) => name === "regression");
  const referencesGreen = commandPassed(independent, contract.success.independentPassed) && commandPassed(regression, contract.success.regressionPassed);
  const confirmed = red && referencesGreen;
  return Object.freeze({
    verdict: confirmed ? "CONFIRMED_RED" : "INVALID_BASELINE",
    stage: "complete",
    commands,
    artifacts: session.artifacts,
    durationMs: session.durationMs,
    ...candidateIdentity(candidate),
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
