import { tmpdir, userInfo } from "node:os";
import { scrubbedChildEnvironment } from "../../../child-environment.mjs";
import { SAFE_NATIVE_PATH } from "./executable.mjs";

export const CLAUDE_CONFIGURATION_ENV = Object.freeze([
  "CLAUDE_CONFIG_DIR", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
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
    for (const name of CLAUDE_CONFIGURATION_ENV) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
  }
  return Object.freeze(environment);
}
