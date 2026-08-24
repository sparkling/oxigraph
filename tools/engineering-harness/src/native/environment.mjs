import { tmpdir, userInfo } from "node:os";
import { scrubbedChildEnvironment } from "../../../child-environment.mjs";
import { SAFE_NATIVE_PATH } from "./executable.mjs";

export function nativeChildEnvironment() {
  const user = userInfo();
  return Object.freeze(
    scrubbedChildEnvironment(
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
    ),
  );
}
