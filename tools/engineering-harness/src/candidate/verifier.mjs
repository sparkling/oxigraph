import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename, join } from "node:path";
import { runGit } from "./git.mjs";
import { sha256 } from "./manifest.mjs";
import { runSandboxCommand } from "./sandbox.mjs";

async function directoryBytes(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(child);
    else total += (await lstat(child)).size;
  }
  return total;
}

function fileSha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function artifactEvidence(targetRoot, prefixes) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    throw new Error("task contract must declare rebuilt artifact prefixes");
  }
  const dependencyRoot = join(targetRoot, "debug", "deps");
  const entries = await readdir(dependencyRoot, { withFileTypes: true });
  const reports = [];
  for (const prefix of prefixes) {
    const matches = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(`${prefix}-`) &&
          !entry.name.endsWith(".d"),
      )
      .map((entry) => join(dependencyRoot, entry.name))
      .sort();
    if (matches.length === 0) {
      throw new Error(`fresh build did not produce the ${prefix} test artifact`);
    }
    for (const path of matches) {
      const mode = (await lstat(path)).mode;
      if ((mode & 0o111) === 0) continue;
      reports.push(
        Object.freeze({
          name: basename(path),
          sha256: await fileSha256(path),
          bytes: (await lstat(path)).size,
        }),
      );
    }
    if (!reports.some(({ name }) => name.startsWith(`${prefix}-`))) {
      throw new Error(`fresh ${prefix} artifact is not executable`);
    }
  }
  return Object.freeze(reports);
}

function artifactPrefixes(contract) {
  const prefixes = [];
  const argv = contract.commands.build.argv;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--test" && typeof argv[index + 1] === "string") {
      prefixes.push(argv[index + 1]);
      index += 1;
    }
  }
  return [...new Set(prefixes)];
}

function commandEvidence(name, execution) {
  const { outcome } = execution;
  return Object.freeze({
    name,
    logicalArgv: execution.logicalArgv,
    sandboxArgv: execution.argv,
    network: execution.network,
    workspace: execution.workspace,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    disposition: outcome.disposition,
    durationMs: outcome.durationMs,
    stdoutSha256: sha256(outcome.stdout),
    stderrSha256: sha256(outcome.stderr),
    stdoutTail: outcome.stdout.slice(-4096),
    stderrTail: outcome.stderr.slice(-4096),
  });
}

async function assertCandidateIdentity(candidate) {
  const [commit, tree] = await Promise.all([
    runGit({
      args: ["rev-parse", "HEAD"],
      cwd: candidate.workspace,
      home: candidate.gitHome,
    }),
    runGit({
      args: ["rev-parse", "HEAD^{tree}"],
      cwd: candidate.workspace,
      home: candidate.gitHome,
    }),
  ]);
  if (commit.trim() !== candidate.candidateCommit) {
    throw new Error("candidate workspace no longer resolves to its sealed commit");
  }
  if (tree.trim() !== candidate.candidateTree) {
    throw new Error("candidate workspace no longer resolves to its sealed tree");
  }
}

function commandPassed(command, expectedPassed) {
  return (
    command.disposition === "completed" &&
    command.exitCode === 0 &&
    `${command.stdoutTail}\n${command.stderrTail}`.includes(
      `test result: ok. ${expectedPassed} passed; 0 failed;`,
    )
  );
}

async function createVerificationSession({
  candidate,
  contract,
  signal,
  commandRunner,
}) {
  const started = performance.now();
  const totalCeiling = contract.ceilings.maxTotalVerifierWallMs;
  const totalSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(totalCeiling)])
    : AbortSignal.timeout(totalCeiling);
  await assertCandidateIdentity(candidate);
  const commands = [];
  const rawOutcomes = new Map();
  const execute = async (name, definition, outputCeiling) => {
    const execution = await commandRunner({
      workspace: candidate.workspace,
      targetRoot: candidate.targetRoot,
      commandTemp: candidate.commandTemp,
      argv: definition.argv,
      timeoutMs: definition.timeoutMs,
      maxOutputBytes: outputCeiling,
      cargoBuildJobs: contract.ceilings.cargoBuildJobs,
      maxResidentBytes: contract.ceilings.maxResidentBytes,
      maxDiskBytes: contract.ceilings.maxVerifierDiskBytes,
      signal: totalSignal,
    });
    const evidence = commandEvidence(name, execution);
    commands.push(evidence);
    rawOutcomes.set(name, execution.outcome);
    const diskBytes =
      (await directoryBytes(candidate.targetRoot)) +
      (await directoryBytes(candidate.commandTemp));
    if (diskBytes > contract.ceilings.maxVerifierDiskBytes) {
      throw new Error(`candidate verifier exceeded its disk ceiling: ${diskBytes}`);
    }
    await assertCandidateIdentity(candidate);
    return evidence;
  };
  return Object.freeze({
    started,
    commands,
    rawOutcomes,
    execute,
  });
}

function earlyVerdict(session, verdict, stage) {
  return Object.freeze({
    verdict,
    stage,
    commands: Object.freeze([...session.commands]),
    artifacts: Object.freeze([]),
    durationMs: Math.round(performance.now() - session.started),
  });
}

export async function verifyCandidate({
  candidate,
  contract,
  signal,
  commandRunner = runSandboxCommand,
}) {
  if (candidate.kind !== "candidate" || candidate.candidatePatchSha256 === null) {
    throw new Error("candidate verification requires a sealed product patch");
  }
  const session = await createVerificationSession({
    candidate,
    contract,
    signal,
    commandRunner,
  });

  const format = await session.execute(
    "format",
    contract.commands.format,
    contract.ceilings.maxTestOutputBytesPerCommand,
  );
  if (format.disposition !== "completed" || format.exitCode !== 0) {
    return earlyVerdict(session, "REJECT", "format");
  }
  const build = await session.execute(
    "build",
    contract.commands.build,
    contract.ceilings.maxBuildOutputBytes,
  );
  if (build.disposition !== "completed" || build.exitCode !== 0) {
    return earlyVerdict(session, "REJECT", "build");
  }
  const artifacts = await artifactEvidence(
    candidate.targetRoot,
    artifactPrefixes(contract),
  );
  for (const name of ["public", "independent", "regression"]) {
    await session.execute(
      name,
      contract.commands[name],
      contract.ceilings.maxTestOutputBytesPerCommand,
    );
  }
  const evaluatorCommands = session.commands.filter(({ name }) =>
    ["public", "independent", "regression"].includes(name),
  );
  const green = evaluatorCommands.every(
    (command) =>
      commandPassed(command, contract.success[`${command.name}Passed`]),
  );
  return Object.freeze({
    verdict: green ? "ACCEPT" : "REJECT",
    stage: green ? "complete" : "evaluation",
    commands: Object.freeze([...session.commands]),
    artifacts,
    durationMs: Math.round(performance.now() - session.started),
    candidateTree: candidate.candidateTree,
    protectedManifest: candidate.protectedManifest,
  });
}

export async function verifyRedBaseline({
  candidate,
  contract,
  signal,
  commandRunner = runSandboxCommand,
}) {
  if (
    candidate.kind !== "evaluator" ||
    candidate.candidateCommit !== contract.evaluator.commit ||
    candidate.candidatePatchSha256 !== null
  ) {
    throw new Error("red-baseline verification requires the sealed evaluator tree");
  }
  const session = await createVerificationSession({
    candidate,
    contract,
    signal,
    commandRunner,
  });
  const format = await session.execute(
    "format",
    contract.commands.format,
    contract.ceilings.maxTestOutputBytesPerCommand,
  );
  if (format.disposition !== "completed" || format.exitCode !== 0) {
    return earlyVerdict(session, "INCONCLUSIVE", "format");
  }
  const build = await session.execute(
    "build",
    contract.commands.build,
    contract.ceilings.maxBuildOutputBytes,
  );
  if (build.disposition !== "completed" || build.exitCode !== 0) {
    return earlyVerdict(session, "INCONCLUSIVE", "build");
  }
  const artifacts = await artifactEvidence(
    candidate.targetRoot,
    artifactPrefixes(contract),
  );
  for (const name of ["public", "independent", "regression"]) {
    await session.execute(
      name,
      contract.commands[name],
      contract.ceilings.maxTestOutputBytesPerCommand,
    );
  }

  const publicEvidence = session.commands.find(({ name }) => name === "public");
  const publicOutcome = session.rawOutcomes.get("public");
  const publicText = `${publicOutcome.stdout}\n${publicOutcome.stderr}`;
  const red =
    publicEvidence.disposition === "completed" &&
    publicEvidence.exitCode === contract.initialRed.exitCode &&
    publicText.includes(
      `test result: FAILED. ${contract.initialRed.passed} passed; ${contract.initialRed.failed} failed;`,
    ) &&
    contract.initialRed.requiredSubstrings.every((value) => publicText.includes(value)) &&
    contract.initialRed.forbiddenSubstrings.every((value) => !publicText.includes(value));
  const independent = session.commands.find(({ name }) => name === "independent");
  const regression = session.commands.find(({ name }) => name === "regression");
  const referencesGreen =
    commandPassed(independent, contract.success.independentPassed) &&
    commandPassed(regression, contract.success.regressionPassed);
  const confirmed = red && referencesGreen;
  return Object.freeze({
    verdict: confirmed ? "CONFIRMED_RED" : "INVALID_BASELINE",
    stage: "complete",
    commands: Object.freeze([...session.commands]),
    artifacts,
    durationMs: Math.round(performance.now() - session.started),
    candidateTree: candidate.candidateTree,
    protectedManifest: candidate.protectedManifest,
    initialRedMatched: red,
    referencesGreen,
  });
}
