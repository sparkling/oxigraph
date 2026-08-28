import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { canonicalJson } from "../routing/features.mjs";
import { isTrustedSandboxSessionV2Report } from "./sandbox-session-v2.mjs";

const digestPattern = /^[0-9a-f]{64}$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(detail) {
  throw new Error(`v2 verification evidence is invalid: ${detail}`);
}

function plainRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} is not a plain record`);
  }
  return value;
}

function denseArray(value, label, maximum = 4096) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Object.keys(value).length !== value.length ||
    Object.keys(value).some((key, index) => key !== String(index))
  ) {
    fail(`${label} is not a bounded dense array`);
  }
  return value;
}

function digest(value, label) {
  if (!digestPattern.test(value ?? "")) fail(`${label} is not a digest`);
  return value;
}

function commandDigest(role, command) {
  const record = plainRecord(command, `contract command ${role}`);
  if (
    !Array.isArray(record.argv) ||
    record.argv.length < 2 ||
    record.argv[0] !== "cargo" ||
    record.argv.some(
      (argument) => typeof argument !== "string" || argument.length === 0,
    ) ||
    !Number.isSafeInteger(record.timeoutMs) ||
    record.timeoutMs < 1
  ) {
    fail(`contract command ${role} is invalid`);
  }
  return sha256(
    Buffer.from(
      canonicalJson({ role, argv: record.argv, timeoutMs: record.timeoutMs }),
      "utf8",
    ),
  );
}

function snapshotContract(contractValue) {
  const contract = plainRecord(contractValue, "contract");
  const roles = denseArray(contract.verificationSequence, "contract roles", 16);
  if (
    roles.length < 3 ||
    roles[0] !== "format" ||
    roles[1] !== "build" ||
    new Set(roles).size !== roles.length
  ) {
    fail("contract roles are not the generic ordered sequence");
  }
  const commands = plainRecord(contract.commands, "contract commands");
  if (
    Object.keys(commands).length !== roles.length ||
    roles.some((role) => !Object.hasOwn(commands, role))
  ) {
    fail("contract commands do not match the roles");
  }
  const success = plainRecord(contract.success, "contract success");
  const expectedSuccessKeys = roles.slice(2).map((role) => `${role}Passed`);
  if (
    Object.keys(success).length !== expectedSuccessKeys.length ||
    expectedSuccessKeys.some(
      (key) => !Number.isSafeInteger(success[key]) || success[key] < 1,
    )
  ) {
    fail("contract success predicates are invalid");
  }
  return Object.freeze({ roles, commands, success });
}

function publicCommand(recordValue, role, contract) {
  const record = plainRecord(recordValue, `command ${role}`);
  if (
    record.role !== role ||
    record.disposition !== "completed" ||
    !Number.isInteger(record.exitCode) ||
    (record.signal !== null && typeof record.signal !== "string") ||
    !digestPattern.test(record.stdoutSha256 ?? "") ||
    !digestPattern.test(record.stderrSha256 ?? "") ||
    (record.observedPassed !== null &&
      (!Number.isSafeInteger(record.observedPassed) ||
        record.observedPassed < 0)) ||
    (["format", "build"].includes(role) && record.observedPassed !== null) ||
    (!["format", "build"].includes(role) &&
      record.exitCode === 0 &&
      record.observedPassed === null) ||
    (record.exitCode !== 0 && record.observedPassed !== null)
  ) {
    fail(`command ${role} has impossible typed evidence`);
  }
  return Object.freeze({
    role,
    commandSha256: commandDigest(role, contract.commands[role]),
    disposition: record.disposition,
    exitCode: record.exitCode,
    signal: record.signal,
    stdoutSha256: record.stdoutSha256,
    stderrSha256: record.stderrSha256,
    observedPassed: record.observedPassed,
  });
}

function snapshotCandidate(candidateValue) {
  const candidate = plainRecord(candidateValue, "candidate");
  for (const [key, value] of [
    ["contractSha256", candidate.contractSha256],
    ["evaluatorPatchSha256", candidate.evaluatorPatchSha256],
    ["patchSha256", candidate.patchSha256],
  ]) {
    digest(value, `candidate ${key}`);
  }
  if (
    candidate.schemaVersion !== 2 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(candidate.commit ?? "") ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(candidate.tree ?? "") ||
    candidate.commit.length !== candidate.tree.length ||
    !Array.isArray(candidate.pathStatuses) ||
    !Array.isArray(candidate.createdBlobs) ||
    candidate.manifests === null ||
    typeof candidate.manifests !== "object"
  ) {
    fail("candidate identity is incomplete");
  }
  return candidate;
}

function sessionProjection(report, commands) {
  const invocation = plainRecord(report.invocation, "session invocation");
  const session = plainRecord(report.session, "session result");
  digest(invocation.configurationSha256, "session configuration");
  digest(report.resultSha256, "session result");
  if (
    session.configurationSha256 !== invocation.configurationSha256 ||
    !Number.isSafeInteger(report.resultBytes) ||
    report.resultBytes < 1 ||
    typeof report.cleanupSafe !== "boolean" ||
    !["verified", "unavailable", "unproved"].includes(invocation.containment)
  ) {
    fail("session identity or containment projection is invalid");
  }
  return Object.freeze({
    configurationSha256: invocation.configurationSha256,
    resultSha256: report.resultSha256,
    resultBytes: report.resultBytes,
    commandsCompleted: commands.length,
    containment: invocation.containment,
    cleanupSafe: report.cleanupSafe,
    stateBytes: session.stateBytes,
    workerFailure: session.failure,
  });
}

function artifactProjection(values) {
  const artifacts = denseArray(values, "session artifacts");
  return Object.freeze(
    artifacts.map((value, index) => {
      const artifact = plainRecord(value, `artifact ${index}`);
      if (
        typeof artifact.name !== "string" ||
        artifact.name.length === 0 ||
        !digestPattern.test(artifact.sha256 ?? "") ||
        !Number.isSafeInteger(artifact.bytes) ||
        artifact.bytes < 1
      ) {
        fail(`artifact ${index} is invalid`);
      }
      return Object.freeze({
        name: artifact.name,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
      });
    }),
  );
}

function verdict({ contract, report, commands }) {
  const session = report.session;
  if (report.cleanupSafe !== true) {
    return Object.freeze({
      verdict: "INCONCLUSIVE",
      stage: "infrastructure",
      reason: "cleanup-unproved",
    });
  }
  if (report.invocation.containment !== "verified") {
    return Object.freeze({
      verdict: "INCONCLUSIVE",
      stage: "infrastructure",
      reason: `containment-${report.invocation.containment}`,
    });
  }
  if (
    report.process?.disposition !== "completed" ||
    report.process?.exitCode !== 0 ||
    report.process?.signal !== null
  ) {
    return Object.freeze({
      verdict: "INCONCLUSIVE",
      stage: "infrastructure",
      reason: "outer-process",
    });
  }
  if (session.status !== "completed") {
    return Object.freeze({
      verdict: "INCONCLUSIVE",
      stage: "infrastructure",
      reason: "worker-infrastructure",
    });
  }
  const failed = commands.find((command) => command.exitCode !== 0);
  if (failed !== undefined) {
    return Object.freeze({
      verdict: "REJECT",
      stage: failed.role,
      reason: "command-failed",
    });
  }
  for (const command of commands.slice(2)) {
    if (command.observedPassed !== contract.success[`${command.role}Passed`]) {
      return Object.freeze({
        verdict: "REJECT",
        stage: command.role,
        reason: "success-predicate-mismatch",
      });
    }
  }
  if (
    commands.length !== contract.roles.length ||
    session.stage !== "complete"
  ) {
    fail("completed session omitted a required role");
  }
  return Object.freeze({
    verdict: "ACCEPT",
    stage: "complete",
    reason: "all-predicates-satisfied",
  });
}

function classify(inputValue) {
  const input = plainRecord(inputValue, "classifier input");
  const candidate = snapshotCandidate(input.candidate);
  const contract = snapshotContract(input.contract);
  const report = plainRecord(input.report, "session report");
  const session = plainRecord(report.session, "session result");
  const records = denseArray(session.commands, "session commands", 16);
  if (
    !Number.isSafeInteger(session.commandCount) ||
    session.commandCount !== records.length ||
    records.length > contract.roles.length
  ) {
    fail("session command count is invalid");
  }
  const commands = Object.freeze(
    records.map((record, index) =>
      publicCommand(record, contract.roles[index], contract),
    ),
  );
  if (session.status === "completed") {
    const failedIndex = commands.findIndex((command) => command.exitCode !== 0);
    const expectedStage =
      failedIndex === -1
        ? commands.length === contract.roles.length
          ? "complete"
          : contract.roles[commands.length - 1]
        : contract.roles[failedIndex];
    if (
      commands.length === 0 ||
      session.stage !== expectedStage ||
      (failedIndex !== -1 && failedIndex !== commands.length - 1)
    ) {
      fail("session stage does not match the command prefix");
    }
  }
  const classification = verdict({ contract, report, commands });
  const projection = Object.freeze({
    schema: "oxigraph.engineering-candidate-verification/v2",
    verdict: classification.verdict,
    stage: classification.stage,
    reason: classification.reason,
    candidate,
    session: sessionProjection(report, commands),
    commands,
    artifacts: artifactProjection(session.artifacts),
  });
  return Object.freeze({
    ...projection,
    projectionSha256: sha256(Buffer.from(canonicalJson(projection), "utf8")),
  });
}

/** Pure test seam. The production facade additionally requires a trusted report. */
export function classifyCandidateVerificationV2ForTesting(input) {
  return classify(input);
}

export function classifyTrustedCandidateVerificationV2(input) {
  const record = plainRecord(input, "trusted classifier input");
  const reportDescriptor = Object.getOwnPropertyDescriptor(record, "report");
  if (
    reportDescriptor === undefined ||
    !("value" in reportDescriptor) ||
    !isTrustedSandboxSessionV2Report(reportDescriptor.value)
  ) {
    fail("session report has no production trust brand");
  }
  return classify(input);
}
