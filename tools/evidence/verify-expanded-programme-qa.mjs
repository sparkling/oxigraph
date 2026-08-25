#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../w3c-tests/strict-json.mjs";

const policyRelativePath = "tools/evidence/expanded-programme-qa-policy.json";
const implementationPaths = [
  "tools/evidence/expanded-programme-qa-policy.json",
  "tools/evidence/expanded-programme-qa.mjs",
  "tools/evidence/expanded-programme-qa.test.mjs",
  "tools/evidence/run-expanded-programme-qa.mjs",
  "tools/evidence/verify-expanded-programme-qa.mjs",
  "tools/evidence/verify-expanded-programme-qa.test.mjs",
  "tools/evidence/package.json",
  "tools/w3c-tests/strict-json.mjs",
].sort();
const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function same(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function expectedScope(policy) {
  return {
    adrIds: policy.adrs.map((adr) => adr.id),
    adrCount: policy.adrs.length,
    stableGIds: Object.keys(policy.tasks),
    stableGCount: Object.keys(policy.tasks).length,
    phaseCounts: policy.phaseCounts,
    rollups: Object.keys(policy.rollups),
    controls: Object.keys(policy.controls),
  };
}

function classify({ sourceOk, commandsDisposition, rufloDisposition }) {
  if (!sourceOk || commandsDisposition === "FAIL" || rufloDisposition === "MISMATCH") {
    return "FAIL";
  }
  if (commandsDisposition !== "PASS" || rufloDisposition !== "MATCH") {
    return "INCONCLUSIVE";
  }
  return "PASS";
}

export function verifyReceiptEnvelope(receipt, { policy, receiptSha256 }) {
  const errors = [];
  if (receipt?.schema !== "oxigraph.expanded-programme-qa/v1") errors.push("receipt schema drift");
  if (receipt?.programme !== policy.programme) errors.push("receipt programme drift");
  if (!sha256Pattern.test(receiptSha256 ?? "")) errors.push("receipt byte hash is invalid");
  if (!gitObjectPattern.test(receipt?.subject?.commit ?? "")) errors.push("receipt commit is invalid");
  if (!gitObjectPattern.test(receipt?.subject?.tree ?? "")) errors.push("receipt tree is invalid");
  if (receipt?.subject?.trackedClean !== true) errors.push("receipt subject was not tracked-clean");
  if (receipt?.subject?.policy?.path !== policyRelativePath || !sha256Pattern.test(receipt?.subject?.policy?.sha256 ?? "")) {
    errors.push("receipt policy binding is invalid");
  }
  if (!sha256Pattern.test(receipt?.subject?.implementation?.sha256 ?? "")) errors.push("receipt implementation binding is invalid");
  if (!sha256Pattern.test(receipt?.subject?.inputs?.sha256 ?? "")) errors.push("receipt input binding is invalid");
  if (!same(
    receipt?.subject?.implementation?.files?.map((file) => file.path),
    implementationPaths,
  )) {
    errors.push("receipt implementation inventory drift");
  }
  const inputPaths = [policyRelativePath, ...policy.sourceDocuments].sort();
  if (!same(receipt?.subject?.inputs?.files?.map((file) => file.path), inputPaths)) {
    errors.push("receipt input inventory drift");
  }
  if (
    receipt?.subject?.implementation?.sha256 !==
    sha256(canonicalBytes(receipt?.subject?.implementation?.files ?? []))
  ) {
    errors.push("receipt implementation manifest hash drift");
  }
  if (
    receipt?.subject?.inputs?.sha256 !==
    sha256(canonicalBytes(receipt?.subject?.inputs?.files ?? []))
  ) {
    errors.push("receipt input manifest hash drift");
  }
  const policyRecord = receipt?.subject?.inputs?.files?.find(
    (file) => file.path === policyRelativePath,
  );
  if (policyRecord?.sha256 !== receipt?.subject?.policy?.sha256) {
    errors.push("receipt policy/input binding drift");
  }
  if (!same(receipt?.scope, expectedScope(policy))) errors.push("receipt scope drift");

  const expectedIds = Object.keys(policy.assertionWeights);
  const assertions = Array.isArray(receipt?.assertions) ? receipt.assertions : [];
  if (!same(assertions.map((item) => item.id), expectedIds)) errors.push("receipt assertion inventory drift");
  for (const assertion of assertions) {
    if (
      assertion.weight !== policy.assertionWeights[assertion.id] ||
      assertion.mandatory !== true ||
      assertion.authority !== "committed-source" ||
      !["PASS", "FAIL", "INCONCLUSIVE"].includes(assertion.status)
    ) {
      errors.push(`${assertion.id ?? "unknown"}: assertion contract drift`);
    }
  }
  const control = assertions.find((item) => item.id === "control.exact-subject-and-inputs");
  if (
    control?.evidence?.commit !== receipt?.subject?.commit ||
    control?.evidence?.tree !== receipt?.subject?.tree ||
    control?.evidence?.inputManifestSha256 !== receipt?.subject?.inputs?.sha256
  ) {
    errors.push("receipt control evidence does not bind its subject");
  }

  const commands = Array.isArray(receipt?.commands) ? receipt.commands : [];
  if (commands.length !== policy.quickCommands.length) errors.push("receipt command count drift");
  for (let index = 0; index < policy.quickCommands.length; index += 1) {
    const expected = policy.quickCommands[index];
    const observed = commands[index];
    if (!observed || observed.id !== expected.id || !same(observed.argv, [expected.program, ...expected.args])) {
      errors.push(`${expected.id}: literal command drift`);
    }
  }
  const commandsDisposition = commands.some((item) => item.disposition === "FAIL")
    ? "FAIL"
    : commands.length !== policy.quickCommands.length || commands.some((item) => item.disposition !== "PASS")
      ? "INCONCLUSIVE"
      : "PASS";
  const tooling = assertions.find((item) => item.id === "tooling.bounded-contracts");
  if (tooling?.status !== commandsDisposition) errors.push("tooling assertion does not match commands");

  const sourceAssertions = assertions.filter((item) => item.id !== "tooling.bounded-contracts");
  const sourceOk = sourceAssertions.every((item) => item.status === "PASS");
  const sourceScore = assertions
    .filter((item) => item.status === "PASS")
    .reduce((sum, item) => sum + item.weight, 0);
  const ruflo = receipt?.rufloObservation;
  if (
    ruflo?.authority !== "non-authoritative-local-audit" ||
    !["MATCH", "MISMATCH", "UNAVAILABLE"].includes(ruflo?.disposition)
  ) {
    errors.push("Ruflo observation contract drift");
  }
  const observational = ruflo?.disposition === "MATCH" ? 2 : 0;
  const verdict = classify({
    sourceOk,
    commandsDisposition,
    rufloDisposition: ruflo?.disposition,
  });
  const expectedScore = {
    source: sourceScore,
    observational,
    total: sourceScore + observational,
    threshold: 98,
    criticalFailure: verdict === "FAIL",
  };
  if (!same(receipt?.score, expectedScore)) errors.push("receipt score drift");
  if (receipt?.verdict !== verdict) errors.push("receipt verdict drift");
  if (!same(receipt?.authority, policy.authority)) errors.push("receipt authority drift");
  return { ok: errors.length === 0, errors: [...new Set(errors)].sort(), verdict };
}

function inside(root, path) {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function safeFile(root, path) {
  const requested = resolve(root, path);
  if (!inside(root, requested)) throw new Error(`path escapes repository: ${path}`);
  let cursor = root;
  for (const component of relative(root, requested).split(sep)) {
    cursor = join(cursor, component);
    const metadata = lstatSync(cursor);
    if (metadata.isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
  }
  const canonical = realpathSync(requested);
  if (!inside(root, canonical) || !lstatSync(canonical).isFile()) {
    throw new Error(`unsafe file: ${path}`);
  }
  return canonical;
}

function recomputeManifest(root, manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const records = files.map((record) => {
    const bytes = readFileSync(safeFile(root, record.path));
    return { path: record.path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return {
    files: records,
    sha256: sha256(canonicalBytes(records)),
  };
}

function gitValue(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.signal) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function parseTap(stdout) {
  const summary = {};
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)) {
    summary[match[1]] = Number.parseInt(match[2], 10);
  }
  return summary;
}

function rerunQuickCommands(root, policy) {
  const results = [];
  for (let index = 0; index < policy.quickCommands.length; index += 1) {
    const command = policy.quickCommands[index];
    const result = spawnSync(command.program, command.args, {
      cwd: root,
      encoding: "utf8",
      timeout: command.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    let disposition;
    if (result.error || result.signal || result.status === null) {
      disposition = "INCONCLUSIVE";
    } else if (result.status !== 0) {
      const diagnostics = `${result.stdout}\n${result.stderr}`;
      disposition = /ERR_MODULE_NOT_FOUND|Cannot find package|ENOENT[^\n]*node_modules/iu.test(diagnostics)
        ? "INCONCLUSIVE"
        : "FAIL";
    } else if (command.expectedNodeTests !== undefined) {
      const summary = parseTap(result.stdout);
      const pass =
        summary.tests === command.expectedNodeTests &&
        summary.pass === command.expectedNodeTests &&
        summary.fail === 0 &&
        summary.cancelled === 0 &&
        summary.skipped === 0 &&
        summary.todo === 0;
      disposition = pass ? "PASS" : "FAIL";
    } else {
      disposition = "PASS";
    }
    results.push({ id: command.id, disposition });
    if (disposition !== "PASS") {
      for (const skipped of policy.quickCommands.slice(index + 1)) {
        results.push({ id: skipped.id, disposition: "INCONCLUSIVE" });
      }
      break;
    }
  }
  return results;
}

export function verifyExpandedProgrammeReceipt(
  rootInput,
  receiptInput,
  { rerunCommands = false } = {},
) {
  const root = realpathSync(resolve(rootInput));
  const receiptPath = safeFile(root, receiptInput);
  const relativeReceipt = relative(root, receiptPath).split(sep).join("/");
  const match = /^target\/programme-qa\/runs\/([0-9a-f]{40})\/([0-9a-f]{64})\/receipt\.json$/u.exec(relativeReceipt);
  if (!match) return { ok: false, errors: ["receipt path is not canonical"], verdict: null };
  const receiptBytes = readFileSync(receiptPath);
  const receiptSha256 = sha256(receiptBytes);
  if (receiptSha256 !== match[2]) return { ok: false, errors: ["receipt path hash mismatch"], verdict: null };
  const receipt = JSON.parse(JSON.stringify(parseStrictJson(receiptBytes, relativeReceipt)));
  const policyBytes = readFileSync(safeFile(root, policyRelativePath));
  const policy = JSON.parse(JSON.stringify(parseStrictJson(policyBytes, policyRelativePath)));
  const envelope = verifyReceiptEnvelope(receipt, { policy, receiptSha256 });
  const errors = [...envelope.errors];
  if (receipt.subject.commit !== match[1]) errors.push("receipt path commit mismatch");
  if (receipt.subject.policy.sha256 !== sha256(policyBytes)) errors.push("current policy hash mismatch");
  if (gitValue(root, ["rev-parse", "HEAD"]) !== receipt.subject.commit) errors.push("receipt is not for current HEAD");
  if (gitValue(root, ["rev-parse", "HEAD^{tree}"]) !== receipt.subject.tree) errors.push("receipt is not for current tree");
  if (gitValue(root, ["status", "--porcelain=v1", "--untracked-files=no"]) !== "") errors.push("tracked worktree is dirty");
  try {
    const inputs = recomputeManifest(root, receipt.subject.inputs);
    if (!same(inputs, receipt.subject.inputs)) errors.push("current input manifest mismatch");
    const implementation = recomputeManifest(root, receipt.subject.implementation);
    if (!same(implementation, receipt.subject.implementation)) errors.push("current implementation manifest mismatch");
  } catch (error) {
    errors.push(`manifest verification failed: ${error.message}`);
  }
  if (rerunCommands) {
    const rerun = rerunQuickCommands(root, policy);
    const recorded = receipt.commands.map((item) => ({
      id: item.id,
      disposition: item.disposition,
    }));
    if (!same(rerun, recorded)) errors.push("bounded command rerun disposition drift");
  }
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    verdict: receipt.verdict,
    receiptSha256,
    commit: receipt.subject.commit,
    tree: receipt.subject.tree,
    score: receipt.score,
  };
}

function parseArguments(args) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  let receipt = null;
  let rerunCommands = true;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root" && args[index + 1]) {
      root = resolve(args[++index]);
    } else if (args[index] === "--receipt" && args[index + 1]) {
      receipt = args[++index];
    } else if (args[index] === "--no-rerun-commands") {
      rerunCommands = false;
    } else {
      throw new Error(`unknown or incomplete argument: ${args[index]}`);
    }
  }
  return { root, receipt, rerunCommands };
}

function discoverReceipt(root) {
  const head = gitValue(root, ["rev-parse", "HEAD"]);
  const directory = join(root, "target", "programme-qa", "runs", head);
  if (!existsSync(directory)) throw new Error("no current-HEAD programme QA receipt exists");
  const receipts = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && sha256Pattern.test(entry.name))
    .map((entry) => join(directory, entry.name, "receipt.json"))
    .filter(existsSync);
  if (receipts.length !== 1) throw new Error("current-HEAD receipt is absent or ambiguous; pass --receipt");
  return receipts[0];
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const receipt = options.receipt ?? discoverReceipt(options.root);
  const result = verifyExpandedProgrammeReceipt(options.root, receipt, {
    rerunCommands: options.rerunCommands,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok || result.verdict === "FAIL") process.exitCode = 1;
  else if (result.verdict === "INCONCLUSIVE") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
