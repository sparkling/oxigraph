import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nativeChildEnvironment, ordinaryClaudeEnvironment } from "../src/native/environment.mjs";
import { runOrdinaryNativeRequest } from "../src/native/ordinary-host.mjs";

const names = ["CLAUDE_CONFIG_DIR", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"];
const digest = value => createHash("sha256").update(value).digest("hex");
function setup(t, settings) {
  const directory = mkdtempSync(join(tmpdir(), "ordinary-settings-"));
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.CLAUDE_CONFIG_DIR = directory;
  if (settings !== undefined) writeFileSync(join(directory, "settings.json"), JSON.stringify(settings));
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (existsSync(join(directory, "start.json"))) {
      const root = JSON.parse(readFileSync(join(directory, "start.json"))).executionRoot;
      if (root !== directory) rmSync(root, { recursive: true, force: true });
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
const configured = { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20128/v1",
  ANTHROPIC_AUTH_TOKEN: "fixture-settings-token", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
  ANTHROPIC_API_KEY: "fixture-api-key", OPENROUTER_API_KEY: "fixture-openrouter-key",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "unrequested-model", MAX_THINKING_TOKENS: "1",
  UNSAFE_UNKNOWN: "never-forward" }, model: "unrequested-model" };

test("ordinary missing settings preserves frozen environment", t => {
  setup(t);
  assert.deepEqual(ordinaryClaudeEnvironment(), nativeChildEnvironment("claude"));
});

test("ordinary settings fallback forwards only approved values without mutating process or frozen helper", t => {
  setup(t, configured);
  const frozen = nativeChildEnvironment("claude"), actual = ordinaryClaudeEnvironment();
  assert.equal(actual.ANTHROPIC_BASE_URL, configured.env.ANTHROPIC_BASE_URL);
  assert.equal(actual.ANTHROPIC_AUTH_TOKEN, configured.env.ANTHROPIC_AUTH_TOKEN);
  assert.equal(actual.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "64000");
  for (const name of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "MAX_THINKING_TOKENS", "UNSAFE_UNKNOWN"]) assert.equal(actual[name], undefined);
  assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.deepEqual(nativeChildEnvironment("claude"), frozen);
  assert.equal(Object.isFrozen(actual), true);
});

test("ordinary explicit environment overrides configured values", t => {
  setup(t, configured);
  process.env.ANTHROPIC_BASE_URL = "https://shell.example.invalid/v1";
  process.env.ANTHROPIC_AUTH_TOKEN = "fixture-shell-token";
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "32000";
  assert.deepEqual(ordinaryClaudeEnvironment(), nativeChildEnvironment("claude"));
});

test("ordinary malformed configuration fails without exposing values", t => {
  const directory = setup(t);
  const secret = "fixture-private-config";
  for (const settings of ["{" + secret, "[]", '{"env":[]}',
    JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: { [secret]: true } } }),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: "file:///" + secret } }),
    JSON.stringify({ env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "0" } }),
    JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: secret + "\n" } })]) {
    writeFileSync(join(directory, "settings.json"), settings);
    assert.throws(() => ordinaryClaudeEnvironment(), error => {
      assert.ok(!String(error).includes(secret)); return true;
    });
  }
});

test("fully explicit ordinary environment ignores unused malformed settings", t => {
  const directory = setup(t);
  writeFileSync(join(directory, "settings.json"), "invalid unused configuration");
  process.env.ANTHROPIC_BASE_URL = "https://shell.example.invalid/v1";
  process.env.ANTHROPIC_AUTH_TOKEN = "fixture-shell-token";
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "128000";
  assert.deepEqual(ordinaryClaudeEnvironment(), nativeChildEnvironment("claude"));
});

async function runFake(t, { settings = configured, override = false, codex = false } = {}) {
  const directory = setup(t, settings), executable = join(directory, "fake-native.mjs");
  if (override) {
    process.env.ANTHROPIC_BASE_URL = "https://shell.example.invalid/v1";
    process.env.ANTHROPIC_AUTH_TOKEN = "fixture-shell-token";
  }
  process.env.ANTHROPIC_API_KEY = "fixture-shell-api-key";
  process.env.OPENROUTER_API_KEY = "fixture-shell-openrouter-key";
  writeFileSync(executable, `#!${process.execPath}
import fs from "node:fs"; import { createHash } from "node:crypto";
const argv=process.argv.slice(2), emit=x=>process.stdout.write(JSON.stringify(x)+"\\n");
fs.writeFileSync("actual.json",JSON.stringify({argv,baseUrl:process.env.ANTHROPIC_BASE_URL,
  tokenPresent:!!process.env.ANTHROPIC_AUTH_TOKEN,
  tokenDigest:process.env.ANTHROPIC_AUTH_TOKEN ? createHash("sha256").update(process.env.ANTHROPIC_AUTH_TOKEN).digest("hex") : null,
  apiKeyPresent:!!process.env.ANTHROPIC_API_KEY || !!process.env.OPENROUTER_API_KEY,
  aliasPresent:!!process.env.ANTHROPIC_DEFAULT_OPUS_MODEL}));
process.stdin.resume();
const output={summary:"checked",verdict:"ACCEPT",findings:[],changes:[]};
if(argv[0]==="exec"){
  emit({type:"thread.started",thread_id:"fixture-native"});
  fs.writeFileSync(argv[argv.indexOf("--output-last-message")+1],JSON.stringify(output));
  emit({type:"turn.completed"});
}else emit({type:"result",session_id:"fixture-native",structured_output:output});
`, { mode: 0o700 });
  const request = { schema: 1, runId: randomUUID(), requestId: 1, taskId: "settings-fixture",
    specSha256: "spec", sourceSha256: "source", action: "native-worker",
    payload: { route: { transport: "native-subscription", role: "review",
      model: codex ? "gpt-6.1-sol" : "cc/claude-opus-5-5[1m]", effort: "high" }, files: [] } };
  const requestPath = join(directory, "request.json");
  writeFileSync(requestPath, JSON.stringify(request));
  const observations = [];
  const result = await runOrdinaryNativeRequest({ request, requestPath, directory, prompt: "inspect",
    driverUrl: new URL(import.meta.url), resolveExecutable: provider => ({ provider, path: executable, sha256: digest(readFileSync(executable)) }),
    streamLimits: { warnMs: 1000, cancelMs: 3000, termGraceMs: 50, drainMs: 1000, progressMs: 50 },
    observation: value => observations.push(value) });
  assert.equal(result.status, "completed");
  const start = JSON.parse(readFileSync(join(directory, "start.json")));
  const actual = JSON.parse(readFileSync(join(start.executionRoot, "actual.json")));
  assert.equal(actual.apiKeyPresent, false);
  assert.equal(actual.aliasPresent, false);
  const publicArtifacts = JSON.stringify(observations) + readFileSync(join(directory, "start.json"), "utf8");
  for (const token of ["fixture-settings-token", "fixture-shell-token"]) assert.ok(!publicArtifacts.includes(token));
  return actual;
}

for (const override of [false, true]) test("ordinary fake Claude child receives configured gateway with shell precedence " + override, async t => {
  const actual = await runFake(t, { override });
  assert.equal(actual.baseUrl, override ? "https://shell.example.invalid/v1" : configured.env.ANTHROPIC_BASE_URL);
  assert.equal(actual.tokenPresent, true);
  assert.equal(actual.tokenDigest, digest(override ? "fixture-shell-token" : configured.env.ANTHROPIC_AUTH_TOKEN));
  assert.equal(actual.argv[actual.argv.indexOf("--model") + 1], "cc/claude-opus-5-5[1m]");
  assert.ok(actual.argv.includes("--safe-mode"));
});

test("ordinary fake Codex child ignores Claude settings and credentials", async t => {
  const actual = await runFake(t, { settings: { env: [] }, override: true, codex: true });
  assert.equal(actual.baseUrl, undefined);
  assert.equal(actual.tokenPresent, false);
  assert.equal(actual.argv[actual.argv.indexOf("--model") + 1], "gpt-6.1-sol");
});
