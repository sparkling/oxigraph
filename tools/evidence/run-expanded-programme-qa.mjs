#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../w3c-tests/strict-json.mjs";
import {
  buildExpandedProgrammeReceipt,
  createRepositoryManifest,
  expandedProgrammeImplementationPaths,
  loadExpandedProgrammePolicy,
  observeRufloState,
  publishExpandedProgrammeReceipt,
  readExpandedProgrammeGitSubject,
  readStrictRepositoryJson,
  validateExpandedProgramme,
} from "./expanded-programme-qa.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseTap(stdout) {
  const summary = {};
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)) {
    summary[match[1]] = Number.parseInt(match[2], 10);
  }
  return summary;
}

function nodeExpectation(command) {
  return {
    tests: command.expectedNodeTests,
    pass: command.expectedNodeTests,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  };
}

export function runBoundedQuickCommand(root, command) {
  const argv = [command.program, ...command.args];
  const expected = command.expectedNodeTests === undefined
    ? { exitCode: 0, signal: null }
    : nodeExpectation(command);
  const result = spawnSync(command.program, command.args, {
    cwd: root,
    encoding: "utf8",
    timeout: command.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) {
    return {
      id: command.id,
      argv,
      expected,
      observed: null,
      disposition: "INCONCLUSIVE",
      failureClass: result.error.code === "ETIMEDOUT" ? "TIMEOUT" : "SPAWN_ERROR",
    };
  }
  if (result.signal || result.status === null) {
    return {
      id: command.id,
      argv,
      expected,
      observed: { exitCode: result.status, signal: result.signal },
      disposition: "INCONCLUSIVE",
      failureClass: "PROCESS_SIGNAL",
    };
  }
  if (command.expectedNodeTests !== undefined) {
    const observed = parseTap(result.stdout);
    const diagnostics = `${result.stdout}\n${result.stderr}`;
    const dependencyUnavailable =
      /ERR_MODULE_NOT_FOUND|Cannot find package|ENOENT[^\n]*node_modules/iu.test(
        diagnostics,
      );
    if (result.status !== 0 && dependencyUnavailable) {
      return {
        id: command.id,
        argv,
        expected,
        observed,
        disposition: "INCONCLUSIVE",
        failureClass: "DEPENDENCY_UNAVAILABLE",
      };
    }
    const passed =
      result.status === 0 &&
      Object.entries(expected).every(([key, value]) => observed[key] === value);
    return {
      id: command.id,
      argv,
      expected,
      observed,
      disposition: passed ? "PASS" : "FAIL",
      failureClass: passed
        ? null
        : result.status === 0
          ? "TEST_INVENTORY_MISMATCH"
          : "EXIT_NONZERO",
    };
  }
  const observed = { exitCode: result.status, signal: null };
  return {
    id: command.id,
    argv,
    expected,
    observed,
    disposition: result.status === 0 ? "PASS" : "FAIL",
    failureClass: result.status === 0 ? null : "EXIT_NONZERO",
  };
}

function ensureGeneratedTargetRoot(root) {
  const target = join(root, "target");
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("repository target root is unsafe");
    }
    return;
  }
  mkdirSync(target, { mode: 0o700 });
}

export function runBoundedQuickCommands(root, policy) {
  const results = [];
  for (let index = 0; index < policy.quickCommands.length; index += 1) {
    const command = policy.quickCommands[index];
    const result = runBoundedQuickCommand(root, command);
    results.push(result);
    if (result.disposition !== "PASS") {
      for (const skipped of policy.quickCommands.slice(index + 1)) {
        results.push({
          id: skipped.id,
          argv: [skipped.program, ...skipped.args],
          expected: skipped.expectedNodeTests === undefined
            ? { exitCode: 0, signal: null }
            : nodeExpectation(skipped),
          observed: null,
          disposition: "INCONCLUSIVE",
          failureClass: "NOT_RUN_AFTER_FAILURE",
        });
      }
      break;
    }
  }
  return results;
}

function inside(root, path) {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function resolveExecutable(name) {
  if (name.includes(sep) || (process.platform === "win32" && name.includes("/"))) return null;
  const candidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const canonical = realpathSync(candidate);
    if (lstatSync(canonical).isFile()) return canonical;
  }
  return null;
}

function rufloMemoryMaps(root, policy) {
  const executable = resolveExecutable("ruflo");
  if (!executable) return { memoryMaps: null, runtime: null };
  const versionResult = spawnSync(executable, ["--version"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  if (versionResult.status !== 0 || versionResult.signal || versionResult.error) {
    return { memoryMaps: null, runtime: null };
  }
  const runtime = {
    version: versionResult.stdout.trim().slice(0, 128),
    executableSha256: sha256(readFileSync(executable)),
  };
  const memoryMaps = {};
  for (const key of policy.ruflo.memoryKeys) {
    const result = spawnSync(
      executable,
      [
        "memory",
        "retrieve",
        "--path",
        join(root, policy.ruflo.memoryPath),
        "--namespace",
        policy.ruflo.namespace,
        "--key",
        key,
        "--value-only",
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      },
    );
    if (result.status !== 0 || result.signal || result.error) {
      return { memoryMaps: null, runtime };
    }
    try {
      memoryMaps[key] = JSON.parse(
        JSON.stringify(parseStrictJson(Buffer.from(result.stdout), `Ruflo memory ${key}`)),
      );
    } catch {
      return { memoryMaps: null, runtime };
    }
  }
  return { memoryMaps, runtime };
}

export function collectRufloObservation(root, policy) {
  let taskStore = null;
  try {
    const path = resolve(root, policy.ruflo.taskStorePath);
    if (inside(root, path)) taskStore = readStrictRepositoryJson(root, policy.ruflo.taskStorePath);
  } catch {
    taskStore = null;
  }
  const { memoryMaps, runtime } = rufloMemoryMaps(root, policy);
  return observeRufloState({ policy, taskStore, memoryMaps, runtime });
}

function parseArguments(args) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  let withRuflo = true;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root" && args[index + 1]) {
      root = resolve(args[++index]);
    } else if (args[index] === "--without-ruflo") {
      withRuflo = false;
    } else {
      throw new Error(`unknown or incomplete argument: ${args[index]}`);
    }
  }
  return { root: realpathSync(root), withRuflo };
}

function runIndependentVerifier(root, receiptPath) {
  const verifier = join(root, "tools", "evidence", "verify-expanded-programme-qa.mjs");
  const result = spawnSync(
    process.execPath,
    [verifier, "--root", root, "--receipt", receiptPath, "--no-rerun-commands"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    },
  );
  if (result.error || result.signal || ![0, 1, 2].includes(result.status)) {
    throw new Error("independent verifier did not complete normally");
  }
  let verification;
  try {
    verification = JSON.parse(result.stdout);
  } catch {
    throw new Error("independent verifier returned invalid JSON");
  }
  if (!verification.ok) throw new Error("independent verifier rejected the receipt");
  return verification;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = loadExpandedProgrammePolicy(options.root);
  const subject = readExpandedProgrammeGitSubject(options.root);
  const source = validateExpandedProgramme(options.root, { policy, subject });
  ensureGeneratedTargetRoot(options.root);
  const commands = source.ok ? runBoundedQuickCommands(options.root, policy) : [];
  const rufloObservation = options.withRuflo
    ? collectRufloObservation(options.root, policy)
    : observeRufloState({ policy, taskStore: null, memoryMaps: null });
  const implementation = createRepositoryManifest(
    options.root,
    expandedProgrammeImplementationPaths,
  );
  const receipt = buildExpandedProgrammeReceipt({
    policy,
    source,
    commands,
    rufloObservation,
    implementation,
  });
  const publication = publishExpandedProgrammeReceipt(options.root, receipt);
  const verification = runIndependentVerifier(options.root, publication.path);
  const result = {
    verdict: receipt.verdict,
    score: receipt.score,
    commit: receipt.subject.commit,
    tree: receipt.subject.tree,
    receiptPath: relative(options.root, publication.path).split(sep).join("/"),
    receiptSha256: publication.sha256,
    independentlyVerified: verification.ok,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (receipt.verdict === "FAIL") process.exitCode = 1;
  else if (receipt.verdict === "INCONCLUSIVE") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
