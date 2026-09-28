// Ordinary delivery, not the frozen candidate/qualification runtime (ADR-0043).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCommandSafeguards, commandPassed, execute,
} from "../../agentic-qe/process-runner.mjs";
import { ensureDirectoryInsideRepository } from "../../agentic-qe/path-policy.mjs";
import { scrubbedChildEnvironment } from "../../child-environment.mjs";

export const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// ADR-0049 ordinary routes; frozen qualification provider policy is separate.
const roles = Object.freeze({
  build: [null, null],
  test: [null, null],
  implement: ["deepseek/deepseek-v4.1-flash", "high"],
  documentation: ["cc/claude-sonnet-5[1m]", "medium"],
  review: ["deepseek/deepseek-v4.1-flash", "high"],
  difficult: ["cc/claude-opus-5-5[1m]", "high"],
  decision: ["cc/claude-opus-5-5[1m]", "high"],
});
const efforts = {
  "cc/claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "cc/claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "cc/claude-opus-5-5[1m]": ["low", "medium", "high", "xhigh", "max"],
  "cc/claude-sonnet-5[1m]": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max", "ultra"],
  "deepseek/deepseek-v4.1-flash": ["high"],
};

export function routeDelivery({ role, taskId, completionCheck, model, effort, reason, selection }) {
  if (!Object.hasOwn(roles, role)) throw new Error("Unknown delivery role");
  if (!/^task-[a-zA-Z0-9-]+$/.test(taskId ?? "") || !completionCheck?.trim()) {
    throw new Error("A live task ID and observable completion check are required");
  }
  const [defaultModel, defaultEffort] = roles[role];
  if (model !== undefined || effort !== undefined) {
    if (!defaultModel || !reason?.trim() || !efforts[model]?.includes(effort)) {
      throw new Error("A model override needs an explicit supported model, effort and reason");
    }
  }
  const selectedModel = model ?? defaultModel;
  const selectedEffort = effort ?? defaultEffort;
  // Role-default Max is allowed; explicit Max requires a recorded selection.
  if (effort !== undefined && selectedEffort === "max" && !["owner", "unresolved"].includes(selection)) {
    throw new Error("An explicit Max effort needs selection=owner or selection=unresolved, plus reason and completion check");
  }
  const transport = selectedModel === null ? null : selectedModel === "deepseek/deepseek-v4.1-flash" ? "openrouter-api" : "native-subscription";
  return {
    policy: "adr-0049-ordinary-delivery-v1", role, taskId, completionCheck, transport,
    model: selectedModel, effort: selectedEffort, reason: reason ?? "role default",
    selection: selection ?? "role-policy",
    status: "planned-not-dispatched", ownerConversationChanged: false,
    nativeDispatch: transport !== "native-subscription" ? null
      : { provider: selectedModel.startsWith("gpt-") ? "codex" : "claude", model: selectedModel, effort: selectedEffort },
    apiDispatch: transport !== "openrouter-api" ? null : { provider: "openrouter", model: selectedModel, effort: selectedEffort },
    instructions: "One writer on canonical main. Direct implementation, repair, tests and builds are allowed. API credentials stay isolated from native/tools/verifiers. Native unavailability pauses with exact client/model/error. Only confirmed nonexecuted HTTP402 permits lighter subscription fallback; capability/output failure uses declared capable repair. A tracked agent is not execution proof.",
  };
}

const cargoFlags = new Set([
  "--locked", "--offline", "--release", "--lib", "--bins", "--tests",
  "--all-targets", "--workspace", "--all-features", "--no-default-features",
  "--quiet", "-q",
]);
const cargoValues = new Set([
  "-p", "--package", "--features", "--test", "--bin", "--example", "--bench",
  "--target", "-j", "--jobs",
]);
const privateTarget = /^target\/engineering-delivery\/builds\/[A-Za-z0-9][A-Za-z0-9_-]*$/;
const nodeTests = new Set([
  "tools/engineering-harness/test/delivery.test.mjs",
  "tools/engineering-harness/test/workflow-policy.test.mjs",
  "tools/engineering-harness/test/workflow.test.mjs",
  "tools/engineering-harness/test/ordinary-api.test.mjs",
  "tools/engineering-harness/test/astra-routing.test.mjs",
  "tools/engineering-harness/test/cli.test.mjs",
  "tools/engineering-harness/test/task-profile.test.mjs",
  "tools/agentic-qe/process-runner.test.mjs",
  "tools/evidence/verify-programme.test.mjs",
  "tools/evidence/receipt-evidence.test.mjs",
  "tools/evidence/adr-prereview.test.mjs",
  "tools/shacl-tests/hidden-entries.test.mjs",
]);
const evidenceChecks = new Set([
  "tools/shacl-tests/run.mjs",
  "tools/shacl-tests/clause-audit.mjs",
  "tools/shacl-tests/jena-compact.mjs",
]);
const sourceOnlyEvidenceCheck = "tools/evidence/verify-programme.mjs";
const fuzzTargets = new Set([
  "nquads", "trig", "n3", "rdf_xml", "jsonld", "sparql_query",
  "sparql_update", "sparql_query_eval", "sparql_update_eval",
  "sparql_results_json", "sparql_results_tsv", "sparql_results_xml",
]);

// Extend this ordinary command surface with reviewed tests, never with an
// arbitrary shell/Node/npm escape hatch. Existing G1 registries stay untouched.
export function admitCommand(argv) {
  if (!Array.isArray(argv) || argv.length < 2 || argv.some((s) =>
    typeof s !== "string" || !s.length || /[\x00-\x1f\x7f]/u.test(s))) {
    throw new Error("Expected a literal executable and argument array");
  }
  const [program, command, ...args] = argv;
  if (program === "cargo" && command === "fmt") {
    const all = args.length === 3 && args[0] === "--all" && args[1] === "--" && args[2] === "--check";
    const packageOnly = args.length === 4 && ["-p", "--package"].includes(args[0]) &&
      /^[a-zA-Z0-9_+-]+$/.test(args[1]) && args[2] === "--" && args[3] === "--check";
    if (!all && !packageOnly) throw new Error("Cargo fmt must be --all or one package, followed by -- --check");
    return { program, args: [command, ...args], kind: "format" };
  }
  if (program === "cargo" && command === "fuzz") {
    if (args.length !== 6 || args[0] !== "run" || !fuzzTargets.has(args[1]) ||
        args[2] !== "--sanitizer" || args[3] !== "none" || args[4] !== "--" ||
        args[5] !== "-max_total_time=60") {
      throw new Error("Cargo fuzz must match one listed AGENTS target and the exact one-minute command");
    }
    return { program, args: [command, ...args], kind: "cargo-fuzz" };
  }
  if (program === "cargo" && ["test", "build", "check", "clippy"].includes(command)) {
    if (!args.includes("--locked")) throw new Error("Cargo requires --locked");
    let filterSeen = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--target-dir") {
        if (!privateTarget.test(args[++i] ?? "") || args.indexOf(arg) !== i - 1) {
          throw new Error("Cargo target must name one private ordinary build directory");
        }
        continue;
      }
      if (cargoFlags.has(arg) || /^-j[1-9][0-9]*$/.test(arg)) continue;
      if (cargoValues.has(arg)) {
        if (!/^[a-zA-Z0-9_.,:/+-]+$/.test(args[++i] ?? "") || args[i].startsWith("-")) {
          throw new Error(`Invalid value for ${arg}`);
        }
        continue;
      }
      if (command === "test" && arg === "--") {
        if (args.slice(i + 1).some((value) =>
          !["--exact", "--ignored", "--nocapture", "--show-output"].includes(value) &&
          !/^--test-threads=[1-9][0-9]*$/.test(value))) {
          throw new Error("Unsupported libtest argument");
        }
        break;
      }
      if (command === "test" && !filterSeen && /^[a-zA-Z0-9_:.-]+$/.test(arg) && !arg.startsWith("-")) {
        filterSeen = true;
        continue;
      }
      throw new Error(`Unsupported Cargo delivery argument: ${arg}`);
    }
    return { program, args: [command, ...args], kind: command === "test" ? "cargo-test" : command };
  }
  if (program === "node" && command === "--test" && args[0] === "--test-reporter=tap" &&
      args.length > 1 && args.slice(1).every((path) => nodeTests.has(path)) &&
      new Set(args.slice(1)).size === args.length - 1) {
    return { program: process.execPath, args: [command, ...args], kind: "node-test" };
  }
  if (program === "node" && args.length === 0 && evidenceChecks.has(command)) {
    return { program: process.execPath, args: [command], kind: "evidence-check" };
  }
  if (program === "node" && command === sourceOnlyEvidenceCheck &&
      args.length === 1 && args[0] === "--source-only") {
    return { program: process.execPath, args: [command, ...args], kind: "evidence-check" };
  }
  throw new Error("Command not registered for ordinary delivery; add a reviewed adapter or run an authorized direct check");
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repository, env: scrubbedChildEnvironment(), maxBuffer: 32 * 1024 * 1024,
    timeout: 30000,
  });
}

export function sourceObservation() {
  const branch = git(["branch", "--show-current"]).toString().trim();
  if (branch !== "main" || realpathSync(git(["rev-parse", "--show-toplevel"]).toString().trim()) !== repository ||
      realpathSync(resolve(repository, git(["rev-parse", "--git-common-dir"]).toString().trim())) !==
      realpathSync(resolve(repository, git(["rev-parse", "--git-dir"]).toString().trim()))) {
    throw new Error("Delivery requires the canonical main checkout, not another worktree");
  }
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString()
    .split("\0").filter(Boolean).sort().map((path) => {
      const absolute = join(repository, path);
      const stat = lstatSync(absolute);
      if (!stat.isFile() && !stat.isSymbolicLink()) {
        throw new Error(`Cannot bind nonregular untracked source: ${path}`);
      }
      return { path, sha256: sha256(stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute)) };
    });
  return {
    root: repository, branch, head: git(["rev-parse", "HEAD"]).toString().trim(),
    trackedDiffSha256: sha256(git(["diff", "--binary", "HEAD", "--"])),
    status: git(["status", "--porcelain=v1", "--untracked-files=all"]).toString(),
    untracked,
  };
}

export function evaluateResult(command, result, capturedOutput) {
  if (command.kind === "cargo-test") {
    result = applyCommandSafeguards(result, { minimumPassedTests: 1 });
  } else if (command.kind === "cargo-fuzz") {
    const stdout = capturedOutput?.stdout?.toString("utf8") ?? result.stdoutTail ?? "";
    const stderr = capturedOutput?.stderr?.toString("utf8") ?? result.stderrTail ?? "";
    const output = `${stdout}\n${stderr}`.trimEnd();
    const terminal = /(?:^|\n)Done ([1-9][0-9]*) runs in [1-9][0-9]* second\(s\)$/u.exec(output);
    const observed = {
      engine: /(?:^|\n)INFO: Running with .+ power schedule/u.test(output),
      terminal: terminal !== null,
      executedUnits: terminal === null ? 0 : Number(terminal[1]),
    };
    result = { ...result, fuzzSafeguard: observed, testSafeguard: {
      format: "libfuzzer-terminal-v1", observed,
      passed: observed.engine && observed.terminal && observed.executedUnits > 0,
    } };
  } else if (command.kind === "node-test") {
    const observed = result.observedNodeTestSummary;
    result = {
      ...result,
      testSafeguard: {
        format: "node-tap-v13", observed,
        passed: observed?.duplicateOrMissing === false && observed.terminal === true &&
          observed.conserved === true && observed.tests > 0 && observed.pass === observed.tests &&
          observed.fail === 0 && observed.cancelled === 0 && observed.skipped === 0 && observed.todo === 0,
      },
    };
  }
  return { ...result, passed: commandPassed(result) };
}

export function bindBuildArtifact(command, stdout, path) {
  if (command.kind !== "build") throw new Error("Only a build can identify a produced artifact");
  const matches = stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try {
      const message = JSON.parse(line);
      return message.reason === "compiler-artifact" && message.executable === path &&
        message.target?.name === path.split("/").at(-1) && typeof message.fresh === "boolean" ? [message] : [];
    } catch { return []; }
  });
  if (matches.length !== 1) throw new Error("Selected artifact lacks one exact Cargo compiler-artifact observation");
  return { cargoFresh: matches[0].fresh, packageId: matches[0].package_id,
    targetName: matches[0].target.name, origin: "Cargo compiler-artifact from this command" };
}

export function deliveryStatus(before, after, result, failure) {
  const sourceStable = after !== null && JSON.stringify(before) === JSON.stringify(after);
  return { sourceStable, status: !failure && sourceStable && result?.passed ? "command-passed" : "failed" };
}

export function deliveryArtifactPath(command, artifact, root = repository) {
  if (artifact === undefined) return null;
  if (typeof artifact !== "string") throw new Error("Artifact must match a native Cargo build path");
  const targetIndex = command.args.indexOf("--target-dir");
  const target = targetIndex < 0 ? "target" : command.args[targetIndex + 1];
  const profile = command.args.includes("--release") ? "release" : "debug";
  const name = artifact.split("/").at(-1);
  const hasPair = (flag, value) => command.args.some((arg, index) => arg === flag && command.args[index + 1] === value);
  if ((target !== "target" && !privateTarget.test(target ?? "")) || !/^[a-zA-Z0-9_-]+$/.test(name ?? "") ||
      artifact !== `${target}/${profile}/${name}` || command.kind !== "build" || command.args.includes("--target") ||
      !(hasPair("--bin", name) || (name === "oxigraph" && (hasPair("-p", "oxigraph-cli") || hasPair("--package", "oxigraph-cli"))))) {
    throw new Error("Artifact must match this native Cargo build's selected target, binary and profile");
  }
  return join(root, artifact);
}

export async function runDelivery({ taskId, completionCheck, argv, timeoutMs = 1800000, artifact, quiet = false }, context = {}) {
  const workspace = context.root ?? repository;
  if (workspace !== repository && (typeof workspace !== "string" ||
      !workspace.startsWith(`${join(repository, "target", "engineering-delivery", "candidates")}/`) ||
      realpathSync(workspace) !== workspace || typeof context.observe !== "function")) {
    throw new Error("Ordinary command requires its canonical or isolated candidate workspace");
  }
  const observe = context.observe ?? sourceObservation;
  if (!/^task-[a-zA-Z0-9-]+$/.test(taskId ?? "")) throw new Error("A live Ruflo task ID is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 7200000) {
    throw new Error("Timeout must be between 1ms and 2h (local process bound, not a model budget)");
  }
  const command = admitCommand(argv);
  const plan = routeDelivery({ role: command.kind.endsWith("test") ? "test" : "build", taskId, completionCheck });
  const artifactPath = deliveryArtifactPath(command, artifact, workspace);
  if (artifact !== undefined) {
    command.args.push("--message-format=json-render-diagnostics");
  }
  const before = observe();
  const targetIndex = command.args.indexOf("--target-dir");
  if (targetIndex >= 0) ensureDirectoryInsideRepository(join(workspace, command.args[targetIndex + 1]));
  const root = ensureDirectoryInsideRepository(join(workspace, "target", "engineering-delivery"));
  const directory = mkdtempSync(join(root, "run-"));
  const startedAt = new Date().toISOString();
  const input = {
    schema: "ordinary-delivery-run-v1", taskId, command, source: before,
    plan, planSha256: sha256(JSON.stringify(plan)), taskAttribution: "unverified-coordinator-supplied",
    startedAt, timeoutMs, node: { version: process.version, executable: process.execPath },
    nativeVersions: command.program === "cargo" ? Object.fromEntries(["cargo", "rustc"].map((program) =>
      [program, execFileSync(program, ["--version"], { cwd: workspace,
        env: scrubbedChildEnvironment(), timeout: 30000, encoding: "utf8" }).trim()])) : {},
    modelExecution: false, qualification: false, publication: false,
    mcpSync: "native coordinator must update live MCP task and read back evidence",
  };
  writeFileSync(join(directory, "input.json"), JSON.stringify(input, null, 2) + "\n", { flag: "wx" });
  let result;
  let completeStdout = "";
  let failure = null;
  try {
    result = await execute(command.program, command.args, {
      cwd: workspace, timeoutMs, captureOutputBytes: 16 * 1024 * 1024,
      quiet, announce: !quiet,
    });
  } catch (error) {
    failure = error.message;
    result = error.processResult;
  }
  if (result) {
    const { capturedOutput, ...observation } = result;
    completeStdout = capturedOutput?.stdout.toString("utf8") ?? "";
    writeFileSync(join(directory, "stdout.log"), capturedOutput?.stdout ?? "", { flag: "wx" });
    writeFileSync(join(directory, "stderr.log"), capturedOutput?.stderr ?? "", { flag: "wx" });
    result = evaluateResult(command, observation, capturedOutput);
  }
  let after = null;
  let artifactIdentity = null;
  try {
    after = observe();
    if (artifact !== undefined) {
      const path = artifactPath;
      if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error("Artifact is not a regular in-repository file");
      const bytes = readFileSync(path);
      artifactIdentity = { path: artifact, bytes: bytes.length, sha256: sha256(bytes),
        ...bindBuildArtifact(command, completeStdout, path) };
    }
  } catch (error) { failure ??= error.message; }
  const { sourceStable, status } = deliveryStatus(before, after, result, failure);
  const output = {
    ...input, finishedAt: new Date().toISOString(), result: result ?? null,
    sourceAfter: after, sourceStable, artifact: artifactIdentity, failure,
    status,
    scope: "Exact native command only; not task completion, semantic qualification, promotion, or publication",
  };
  writeFileSync(join(directory, "result.json"), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  return { directory, ...output };
}
