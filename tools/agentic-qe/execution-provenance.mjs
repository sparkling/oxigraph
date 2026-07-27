import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { sha256 } from "./evidence.mjs";
import { repoRoot } from "./path-policy.mjs";
import { execute } from "./process-runner.mjs";

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

export function parseCargoTestIds(output) {
  return output
    .split(/\r?\n/)
    .map((line) => /^(\S(?:.*\S)?): test$/.exec(line)?.[1])
    .filter((name) => name !== undefined)
    .sort();
}

export function validateCargoTestIds(id, ids, policy) {
  if (ids.length !== policy.expectedPassedTests) {
    throw new Error(
      `${id}: Cargo selected ${ids.length} tests; expected ${policy.expectedPassedTests}`,
    );
  }
  if (policy.expectedTestIds !== undefined) {
    const expected = [...policy.expectedTestIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error(
        `${id}: selected Cargo test IDs differ from the reviewed inventory`,
      );
    }
  }
  if (policy.requiredTestIds !== undefined) {
    const selected = new Set(ids);
    const missing = policy.requiredTestIds.filter(
      (testId) => !selected.has(testId),
    );
    if (missing.length > 0) {
      throw new Error(
        `${id}: selected Cargo tests omit required sentinels: ${missing.join(", ")}`,
      );
    }
  }
}

export async function cargoTestInventory(id, args, policy) {
  const separator = args.indexOf("--");
  const cargoArgs = separator < 0 ? args : args.slice(0, separator);
  const result = await execute(
    "cargo",
    [...cargoArgs, "--", "--list", "--format", "terse"],
    {
      timeoutMs: policy.timeoutMs,
      quiet: true,
      announce: false,
      captureCargoTestIds: true,
    },
  );
  if (result.code !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`${id}: unable to inventory the selected Cargo tests`);
  }
  const ids = result.observedCargoTestIds;
  validateCargoTestIds(id, ids, policy);
  return {
    observedTests: ids.length,
    ids,
    output: result.output,
  };
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
    throw new Error(`unable to capture required executable version: ${program}`);
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
    throw new Error(`unable to capture mise-selected executable version: ${program}`);
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

export function runtimeProgramPlan(selected, commands) {
  const host = new Set(["git", "node"]);
  const jenaParityMise = new Set();
  for (const id of selected) {
    const [program] = commands[id];
    host.add(program);
    if (program === "cargo") host.add("rustc");
    if (id === "datalogJena" || id === "rdfsJena") {
      host.add("cargo");
      host.add("rustc");
      host.add("java");
      host.add("mvn");
    }
    if (id === "jenaParity") {
      host.add("mise");
      for (const selectedProgram of ["cargo", "java", "mvn", "rustc"]) {
        jenaParityMise.add(selectedProgram);
      }
    }
    if (id === "datalogSouffle") {
      host.add("cargo");
      host.add("rustc");
      host.add("souffle");
    }
    if (id === "owlW3c" || id === "shaclW3c") {
      host.add("cargo");
      host.add("rustc");
    }
    if (id === "shaclJena") {
      host.add("java");
      host.add("mvn");
    }
  }
  return {
    host: [...host].sort(),
    jenaParityMise: [...jenaParityMise].sort(),
  };
}

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
