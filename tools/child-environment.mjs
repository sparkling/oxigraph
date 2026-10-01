export const CHILD_ENVIRONMENT_POLICY = "inherited-safe-name-allowlist-v1";

/** Apply after sanitization on ordinary routes, never sealed qualification. */
export function ordinaryRustEnvironment(environment) {
  return { ...environment, CARGO_PROFILE_DEV_DEBUG: "1", CARGO_PROFILE_TEST_DEBUG: "1",
    CARGO_PROFILE_DEV_INCREMENTAL: "false", CARGO_PROFILE_TEST_INCREMENTAL: "false" };
}

const providerPrefix =
  /^(?:ANTHROPIC|AZURE_OPENAI|CLAUDE|CODEX|COHERE|COPILOT|DEEPSEEK|GEMINI|GOOGLE_GENAI|GROQ|MISTRAL|OPENAI|OPENROUTER|PERPLEXITY|TOGETHER|XAI)(?:_|$)/i;
const sensitiveName =
  /(?:^|_)(?:API_?KEY|AUTH|CREDENTIALS?|PASSWORD|SECRET|TOKEN)(?:_|$)/i;
const networkOverride =
  /(?:^|_)(?:API_URL|BASE_URL|ENDPOINT)$|^(?:ALL|HTTP|HTTPS|NO)_PROXY$/i;
const unsafeRuntimeControl =
  /^(?:AWS|AZURE|CARGO|DOCKER|GCP|GH|GITHUB|GOOGLE|JAVA|KUBE|MAVEN|MISE|RUST[A-Z0-9]*|SSH)(?:_|$)|^(?:AR|BASH_ENV|CC|CXX|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|ENV|GIT_ASKPASS|LD|LD_LIBRARY_PATH|LD_PRELOAD|LIBCLANG_PATH|NODE_OPTIONS|NODE_PATH|NPM_CONFIG_USERCONFIG|PERL5OPT|PKG_CONFIG_PATH|PYTHONPATH|RUBYOPT)$/i;
const inheritedNames = new Set([
  "APPDATA",
  "CI",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "GITHUB_WORKSPACE",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "NO_COLOR",
  "NUMBER_OF_PROCESSORS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "RUNNER_ARCH",
  "RUNNER_OS",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
  "SHELL",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR",
]);

export function blockedChildEnvironmentName(name) {
  return (
    providerPrefix.test(name) ||
    sensitiveName.test(name) ||
    networkOverride.test(name) ||
    unsafeRuntimeControl.test(name)
  );
}

function allowedInheritedName(name) {
  return inheritedNames.has(name) || /^LC_[A-Z0-9_]+$/.test(name);
}

export function scrubbedChildEnvironment(
  overrides = {},
  inherited = process.env,
) {
  const environment = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (
      value !== undefined &&
      allowedInheritedName(name) &&
      !blockedChildEnvironmentName(name)
    ) {
      environment[name] = value;
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (blockedChildEnvironmentName(name)) {
      throw new Error(`child environment override is prohibited: ${name}`);
    }
    if (value === undefined) {
      delete environment[name];
    } else {
      environment[name] = String(value);
    }
  }
  return environment;
}
