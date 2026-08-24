import { accessSync, constants, realpathSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { runBoundedProcess } from "../native/process.mjs";

const bwrapExecutable = "/usr/bin/bwrap";
const prlimitExecutable = "/usr/bin/prlimit";
const systemdRunExecutable = "/usr/bin/systemd-run";

function existing(path) {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function bindIfPresent(args, source, destination) {
  if (existing(source)) args.push("--ro-bind", realpathSync(source), destination);
}

export function sandboxArguments({
  workspace,
  targetRoot,
  commandTemp,
  argv,
  cargoBuildJobs = 4,
}) {
  if (!Array.isArray(argv) || argv.length < 2 || argv[0] !== "cargo") {
    throw new Error("sandbox command must be a literal cargo argv array");
  }
  if (argv.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw new Error("sandbox command contains an invalid argument");
  }
  if (!Number.isInteger(cargoBuildJobs) || cargoBuildJobs < 1 || cargoBuildJobs > 16) {
    throw new Error("sandbox Cargo job ceiling must be within 1..16");
  }
  const home = userInfo().homedir;
  const cargo = join(home, ".cargo");
  const rustup = join(home, ".rustup");
  for (const path of [bwrapExecutable, workspace, targetRoot, commandTemp, cargo, rustup]) {
    accessSync(path, constants.R_OK);
  }
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    "/lib",
    "/lib",
  ];
  bindIfPresent(args, "/lib64", "/lib64");
  bindIfPresent(args, "/etc", "/etc");
  args.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/home",
    "--dir",
    "/home/sandbox",
    "--tmpfs",
    "/cargo",
  );
  bindIfPresent(args, join(cargo, "bin"), "/cargo/bin");
  bindIfPresent(args, join(cargo, "registry"), "/cargo/registry");
  bindIfPresent(args, join(cargo, "git"), "/cargo/git");
  bindIfPresent(args, join(cargo, ".global-cache"), "/cargo/.global-cache");
  args.push(
    "--ro-bind",
    realpathSync(rustup),
    "/rustup",
    "--ro-bind",
    realpathSync(workspace),
    "/workspace",
    "--bind",
    realpathSync(targetRoot),
    "/target",
    "--bind",
    realpathSync(commandTemp),
    "/tmp",
    "--chdir",
    "/workspace",
    "--setenv",
    "CARGO_BUILD_JOBS",
    String(cargoBuildJobs),
    "--setenv",
    "CARGO_HOME",
    "/cargo",
    "--setenv",
    "CARGO_NET_OFFLINE",
    "true",
    "--setenv",
    "CARGO_TARGET_DIR",
    "/target",
    "--setenv",
    "HOME",
    "/home/sandbox",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "LC_ALL",
    "C.UTF-8",
    "--setenv",
    "PATH",
    "/cargo/bin:/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "RUSTUP_HOME",
    "/rustup",
    "--setenv",
    "SOURCE_DATE_EPOCH",
    "946684800",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "USER",
    "sandbox",
    "--",
    "/cargo/bin/cargo",
    ...argv.slice(1),
  );
  return Object.freeze(args);
}

export async function runSandboxCommand({
  workspace,
  targetRoot,
  commandTemp,
  argv,
  timeoutMs,
  maxOutputBytes,
  cargoBuildJobs,
  signal,
  maxResidentBytes = 8_589_934_592,
  maxDiskBytes = 17_179_869_184,
}) {
  if (
    !Number.isSafeInteger(maxResidentBytes) ||
    maxResidentBytes < 268_435_456 ||
    maxResidentBytes > 68_719_476_736
  ) {
    throw new Error("sandbox resident-memory ceiling is invalid");
  }
  if (
    !Number.isSafeInteger(maxDiskBytes) ||
    maxDiskBytes < 268_435_456 ||
    maxDiskBytes > 137_438_953_472
  ) {
    throw new Error("sandbox disk ceiling is invalid");
  }
  const args = sandboxArguments({
    workspace,
    targetRoot,
    commandTemp,
    argv,
    cargoBuildJobs,
  });
  const outcome = await runBoundedProcess({
    executable: systemdRunExecutable,
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "-p",
      "TasksMax=512",
      "-p",
      `MemoryMax=${maxResidentBytes}`,
      "-p",
      "MemorySwapMax=0",
      "--",
      prlimitExecutable,
      `--as=${maxResidentBytes}`,
      "--core=0",
      `--fsize=${maxDiskBytes}`,
      "--",
      bwrapExecutable,
      ...args,
    ],
    cwd: tmpdir(),
    environment: Object.freeze({
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: `/run/user/${typeof process.getuid === "function" ? process.getuid() : 1000}`,
    }),
    timeoutMs,
    maxOutputBytes,
    signal,
  });
  return Object.freeze({
    argv: Object.freeze([
      systemdRunExecutable,
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "-p",
      "TasksMax=512",
      "-p",
      `MemoryMax=${maxResidentBytes}`,
      "-p",
      "MemorySwapMax=0",
      "--",
      prlimitExecutable,
      `--as=${maxResidentBytes}`,
      "--core=0",
      `--fsize=${maxDiskBytes}`,
      "--",
      bwrapExecutable,
      ...args,
    ]),
    logicalArgv: Object.freeze([...argv]),
    network: "isolated",
    workspace: "read-only",
    outcome,
  });
}
