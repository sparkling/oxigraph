import { tmpdir, userInfo } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scrubbedChildEnvironment } from "../../../child-environment.mjs";
import { SAFE_NATIVE_PATH } from "./executable.mjs";

export const CLAUDE_CONFIGURATION_ENV = Object.freeze([
  "CLAUDE_CONFIG_DIR", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
]);

export function nativeChildEnvironment(provider = "codex") {
  const user = userInfo();
  const environment = scrubbedChildEnvironment(
      {
        HOME: user.homedir,
        LANG: process.env.LANG ?? "C.UTF-8",
        LOGNAME: user.username,
        NO_COLOR: "1",
        PATH: SAFE_NATIVE_PATH,
        SHELL: process.env.SHELL ?? "/bin/sh",
        TERM: "dumb",
        TMPDIR: tmpdir(),
        USER: user.username,
      },
      {},
    );
  if (provider === "claude") {
    const outputTokens = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? "128000";
    if (!/^[1-9][0-9]*$/.test(outputTokens) || !Number.isSafeInteger(Number(outputTokens))) {
      throw new Error("CLAUDE_CODE_MAX_OUTPUT_TOKENS must be a positive safe integer");
    }
    // Requested ceiling, not a generation target; native client applies model caps.
    environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS = outputTokens;
    for (const name of CLAUDE_CONFIGURATION_ENV) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
  }
  return Object.freeze(environment);
}

// Ordinary --safe-mode workers do not load settings themselves. Keep frozen
// nativeChildEnvironment unchanged; only this ordinary adapter resolves settings.
export function ordinaryClaudeEnvironment() {
  const environment = { ...nativeChildEnvironment("claude") };
  const names = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_MAX_OUTPUT_TOKENS"];
  const configDir = environment.CLAUDE_CONFIG_DIR ?? join(userInfo().homedir, ".claude");
  ordinaryEnvironmentString("CLAUDE_CONFIG_DIR", configDir);
  const path = join(configDir, "settings.json");
  let settings = {};
  try {
    if (names.some(name => process.env[name] === undefined)) {
      const metadata = statSync(path);
      if (!metadata.isFile() || metadata.size > 1024 * 1024) {
        throw new Error("Ordinary Claude settings must be a bounded regular file");
      }
      const text = readFileSync(path, "utf8");
      try { settings = JSON.parse(text); }
      catch { throw new Error("Ordinary Claude settings must contain valid JSON"); }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
      (settings.env !== undefined && (!settings.env || typeof settings.env !== "object" || Array.isArray(settings.env)))) {
    throw new Error("Ordinary Claude settings must contain an object environment");
  }
  for (const name of names) {
    if (process.env[name] === undefined && Object.hasOwn(settings.env ?? {}, name)) {
      environment[name] = settings.env[name];
    }
    if (environment[name] !== undefined) ordinaryEnvironmentString(name, environment[name]);
  }
  if (environment.ANTHROPIC_BASE_URL !== undefined) {
    let url;
    try { url = new URL(environment.ANTHROPIC_BASE_URL); }
    catch { throw new Error("Invalid ordinary Claude ANTHROPIC_BASE_URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
      throw new Error("Invalid ordinary Claude ANTHROPIC_BASE_URL");
    }
  }
  const outputTokens = environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  if (!/^[1-9][0-9]*$/.test(outputTokens) || !Number.isSafeInteger(Number(outputTokens))) {
    throw new Error("CLAUDE_CODE_MAX_OUTPUT_TOKENS must be a positive safe integer");
  }
  return Object.freeze(environment);
}

function ordinaryEnvironmentString(name, value) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid ordinary Claude ${name}`);
  }
}
