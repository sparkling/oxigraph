import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { sha256 } from "./evidence.mjs";
import {
  parseCargoTestIds,
  validateCargoTestIds,
} from "./native-test-contract.mjs";
import { repoRoot } from "./path-policy.mjs";
import { execute } from "./process-runner.mjs";
import { runtimeProgramPlan } from "./runtime-plan.mjs";

const versionArguments = {
  bash: ["--version"],
  cargo: ["--version", "--verbose"],
  git: ["--version"],
  java: ["--version"],
  mise: ["--version"],
  mvn: ["--version"],
  node: ["--version"],
  rustc: ["--version", "--verbose"],
  souffle: ["--version"],
};

async function capture(program, args, cwd = repoRoot) {
  return execute(program, args, {
    cwd,
    quiet: true,
    announce: false,
    timeoutMs: 30_000,
  });
}

export { parseCargoTestIds, validateCargoTestIds };

function cargoInventoryObservation(program, args, result) {
  const ids = result.observedCargoTestIds ?? [];
  return {
    program,
    args,
    code: result.code,
    signal: result.signal,
    spawnError: result.spawnError,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded,
    outputLimitBytes: result.outputLimitBytes,
    scanLimitExceeded: result.scanLimitExceeded,
    timeoutMs: result.timeoutMs,
    durationMs: result.durationMs,
    observedTests: ids.length,
    ids,
    output: result.output,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
    ...(result.capturedOutput === undefined
      ? {}
      : { capturedOutput: result.capturedOutput }),
  };
}

function inventoryFailure(message, code, observation) {
  const error = new Error(message);
  error.code = code;
  error.inventoryResult = observation;
  return error;
}

export async function cargoTestInventory(id, args, policy, execution = {}) {
  const separator = args.indexOf("--");
  const cargoArgs = separator < 0 ? args : args.slice(0, separator);
  const program = execution.program ?? "cargo";
  const inventoryArgs = [...cargoArgs, "--", "--list", "--format", "terse"];
  const result = await execute(program, inventoryArgs, {
    cwd: execution.cwd ?? repoRoot,
    timeoutMs: policy.timeoutMs,
    quiet: true,
    announce: false,
    captureCargoTestIds: true,
    captureOutputBytes: execution.captureOutputBytes,
    retainCompleteOutput: policy.requireCompleteOutputReplay === true,
    env: execution.env,
    inheritEnvironment: execution.inheritEnvironment,
  });
  const observation = cargoInventoryObservation(program, inventoryArgs, result);
  if (
    result.timedOut ||
    result.outputLimitExceeded ||
    result.scanLimitExceeded ||
    result.spawnError ||
    result.signal !== null
  ) {
    throw inventoryFailure(
      `${id}: Cargo test inventory infrastructure failed`,
      "CARGO_TEST_INVENTORY_INFRASTRUCTURE",
      observation,
    );
  }
  if (result.code !== 0 || result.signal !== null) {
    throw inventoryFailure(
      `${id}: Cargo test inventory command failed`,
      "CARGO_TEST_INVENTORY_FAILED",
      observation,
    );
  }
  const ids = result.observedCargoTestIds;
  try {
    validateCargoTestIds(id, ids, policy);
  } catch (error) {
    error.inventoryResult = observation;
    throw error;
  }
  return observation;
}

async function executableProvenance(program) {
  const locator = process.platform === "win32" ? "where" : "which";
  const located = await capture(locator, [program]);
  if (located.code !== 0 || located.timedOut || located.spawnError) {
    throw new Error(`unable to resolve required executable: ${program}`);
  }
  const invokedPath = located.stdoutTail.trim().split(/\r?\n/, 1)[0];
  const path = realpathSync(invokedPath);
  const version = await capture(
    program,
    versionArguments[program] ?? ["--version"],
  );
  if (version.code !== 0 || version.timedOut || version.spawnError) {
    throw new Error(
      `unable to capture required executable version: ${program}`,
    );
  }
  const provenance = {
    program,
    context: "host",
    invokedPath,
    path,
    executableSha256: sha256(readFileSync(path)),
    versionStdout: version.stdoutTail.trim(),
    versionStderr: version.stderrTail.trim(),
  };
  if (
    (program === "cargo" || program === "rustc") &&
    /^rustup(?:\.exe)?$/i.test(basename(path))
  ) {
    const selected = await capture("rustup", ["which", program]);
    if (selected.code !== 0 || selected.timedOut || selected.spawnError) {
      throw new Error(`unable to resolve selected Rust tool: ${program}`);
    }
    const toolchainPath = realpathSync(selected.stdoutTail.trim());
    provenance.toolchainPath = toolchainPath;
    provenance.toolchainExecutableSha256 = sha256(readFileSync(toolchainPath));
  }
  return provenance;
}

export function executablePathProvenance(
  program,
  executablePath,
  versionStdout,
) {
  const path = realpathSync(executablePath);
  return {
    program,
    context: "host",
    invokedPath: executablePath,
    path,
    executableSha256: sha256(readFileSync(path)),
    versionStdout,
    versionStderr: "",
  };
}

async function miseExecutableProvenance(program) {
  const cwd = join(repoRoot, "tools", "jena-parity");
  const locator = process.platform === "win32" ? "where" : "which";
  const located = await capture("mise", ["exec", "--", locator, program], cwd);
  if (located.code !== 0 || located.timedOut || located.spawnError) {
    throw new Error(`unable to resolve mise-selected executable: ${program}`);
  }
  const invokedPath = located.stdoutTail.trim().split(/\r?\n/, 1)[0];
  const path = realpathSync(invokedPath);
  const version = await capture(
    "mise",
    ["exec", "--", program, ...(versionArguments[program] ?? ["--version"])],
    cwd,
  );
  if (version.code !== 0 || version.timedOut || version.spawnError) {
    throw new Error(
      `unable to capture mise-selected executable version: ${program}`,
    );
  }
  return {
    program,
    context: "tools/jena-parity/.mise.toml",
    launcher: "mise exec --",
    invokedPath,
    path,
    executableSha256: sha256(readFileSync(path)),
    versionStdout: version.stdoutTail.trim(),
    versionStderr: version.stderrTail.trim(),
  };
}

export { runtimeProgramPlan };

export async function runtimeProvenance(selected, commands) {
  const plan = runtimeProgramPlan(selected, commands);
  const records = [];
  for (const program of plan.host) {
    records.push(await executableProvenance(program));
  }
  for (const program of plan.jenaParityMise) {
    records.push(await miseExecutableProvenance(program));
  }
  return records;
}

export async function agenticRuntimeProvenance(
  selected,
  commands,
  agenticQeVersion,
) {
  const runtime = await runtimeProvenance(selected, commands);
  const executable = join(
    repoRoot,
    "tools",
    "agentic-qe",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "aqe.cmd" : "aqe",
  );
  runtime.push(
    executablePathProvenance("agentic-qe", executable, agenticQeVersion),
  );
  runtime.sort((left, right) =>
    `${left.context}:${left.program}`.localeCompare(
      `${right.context}:${right.program}`,
    ),
  );
  return runtime;
}

export function commandAuthority(id, program) {
  if (id === "rdfc10" || id === "w3cRdf12" || id === "w3cSparql12") {
    return "pinned W3C suite with Oxigraph-owned Rust runner";
  }
  if (program === "cargo") return "native Rust/libtest oracle";
  if (
    id === "datalogJena" ||
    id === "rdfsJena" ||
    id === "shaclJena" ||
    id === "jenaParity"
  ) {
    return "Apache Jena differential oracle";
  }
  if (id === "datalogSouffle") return "Souffle differential oracle";
  if (id === "owlInventory") return "pinned W3C inventory";
  if (id === "owlW3c" || id === "shaclW3c") {
    return "pinned W3C suite with Oxigraph-owned runner";
  }
  if (id === "agenticAdapter") return "adapter adversarial tests";
  return "profile-defined executable oracle";
}
