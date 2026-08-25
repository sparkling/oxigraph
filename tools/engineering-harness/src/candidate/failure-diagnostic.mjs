const PRIMARY_CLASSES = new Set([
  "timeout",
  "output-limit",
  "memory-exhausted",
  "state-exhausted",
  "sandbox-filesystem",
  "toolchain-error",
  "linker-error",
  "native-build-error",
  "offline-dependency",
  "child-process-signaled",
  "child-process-exited",
  "child-process-spawn-failed",
  "rust-compiler-diagnostic",
  "cargo-build-failed-unclassified",
]);

const CHILD_ROLES = new Set([
  "rustc",
  "rustdoc",
  "linker",
  "build-script",
  "native-compiler",
  "unknown",
]);
const CHILD_TERMINATIONS = new Set(["signal", "exit", "spawn"]);
const IO_AREAS = new Set([
  "temp",
  "target",
  "incremental-cache",
  "cargo-cache",
  "source",
  "unknown",
]);
const IO_ERRNOS = new Set([
  "ENOSPC",
  "EDQUOT",
  "EROFS",
  "EACCES",
  "ENOENT",
  "ENOMEM",
  "EIO",
]);
const SIGNAL_NAMES = new Set([
  "SIGHUP",
  "SIGINT",
  "SIGQUIT",
  "SIGILL",
  "SIGTRAP",
  "SIGABRT",
  "SIGBUS",
  "SIGFPE",
  "SIGKILL",
  "SIGUSR1",
  "SIGSEGV",
  "SIGUSR2",
  "SIGPIPE",
  "SIGALRM",
  "SIGTERM",
  "SIGCHLD",
  "SIGCONT",
  "SIGSTOP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGURG",
  "SIGXCPU",
  "SIGXFSZ",
  "SIGVTALRM",
  "SIGPROF",
  "SIGWINCH",
  "SIGIO",
  "SIGPWR",
  "SIGSYS",
  "other",
]);

const DIAGNOSTIC_KEYS = Object.freeze([
  "primaryClass",
  "rustcCodes",
  "childRole",
  "childTermination",
  "childExitCode",
  "childSignalNumber",
  "childSignalName",
  "ioArea",
  "ioErrno",
]);

const IO_PATTERNS = Object.freeze([
  ["ENOMEM", /\bENOMEM\b|Cannot allocate memory|out of memory|memory allocation of \d+ bytes failed/iu],
  ["ENOSPC", /\bENOSPC\b|No space left on device/iu],
  ["EDQUOT", /\bEDQUOT\b|Disk quota exceeded/iu],
  ["EROFS", /\bEROFS\b|Read-only file system/iu],
  ["EACCES", /\bEACCES\b|Permission denied/iu],
  ["ENOENT", /\bENOENT\b|No such file or directory/iu],
  ["EIO", /\bEIO\b|Input\/output error/iu],
]);

function fail(message) {
  throw new Error(`invalid command failure diagnostic: ${message}`);
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be a plain object`);
  }
}

function exactKeys(value) {
  const actual = Object.keys(value).sort();
  const expected = [...DIAGNOSTIC_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`keys must be exactly ${expected.join(", ")}`);
  }
}

function text(value, label) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  fail(`${label} must be a string or byte buffer`);
}

function outputText(stdout, stderr) {
  return `${text(stderr, "stderr")}\n${text(stdout, "stdout")}`;
}

function rustcCodes(output) {
  return [
    ...new Set(
      [...output.matchAll(/(?:^|\n)\s*error\[(E\d{4})\]/gu)].map(
        (match) => match[1],
      ),
    ),
  ]
    .sort()
    .slice(0, 8);
}

function childRole(command) {
  if (/build-script-build|(?:^|[\\/])build[\\/][^\s`"']+[\\/]build-script/iu.test(command)) {
    return "build-script";
  }
  if (/(?:^|[\\/\s`"'])rustdoc(?:\.exe)?(?=$|[\s`"'])/iu.test(command)) {
    return "rustdoc";
  }
  if (/(?:^|[\\/\s`"'])rustc(?:\.exe)?(?=$|[\s`"'])/iu.test(command)) {
    return "rustc";
  }
  if (
    /(?:^|[\\/\s`"'])(?:ld(?:\.lld)?|lld-link|mold|collect2|link\.exe)(?=$|[\s`"'])/iu.test(
      command,
    )
  ) {
    return "linker";
  }
  if (
    /(?:^|[\\/\s`"'])(?:cc1plus|cc1|clang(?:\+\+)?|gcc|g\+\+|c\+\+|cc|cl\.exe)(?=$|[\s`"'])/iu.test(
      command,
    )
  ) {
    return "native-compiler";
  }
  return "unknown";
}

function signalName(value) {
  const candidate = value?.toUpperCase();
  return SIGNAL_NAMES.has(candidate) && candidate !== "other" ? candidate : "other";
}

function terminatedChild(command, status) {
  const signal = /\bsignal:\s*(\d{1,3})(?:\s*,\s*([A-Za-z][A-Za-z0-9]*))?/iu.exec(
    status,
  );
  if (signal !== null) {
    const number = Number(signal[1]);
    if (Number.isSafeInteger(number) && number >= 1 && number <= 64) {
      return {
        childRole: childRole(command),
        childTermination: "signal",
        childExitCode: null,
        childSignalNumber: number,
        childSignalName: signalName(signal[2]),
      };
    }
  }
  const exit = /\b(?:exit status|exit code|status):\s*(\d{1,3})\b/iu.exec(status);
  if (exit !== null) {
    const code = Number(exit[1]);
    if (Number.isSafeInteger(code) && code >= 0 && code <= 255) {
      return {
        childRole: childRole(command),
        childTermination: "exit",
        childExitCode: code,
        childSignalNumber: null,
        childSignalName: null,
      };
    }
  }
  return null;
}

function childStatus(output) {
  for (const line of output.split(/\r?\n/u)) {
    const prefix = /^\s*(?:error:\s*)?process didn't exit successfully:\s*/iu.exec(
      line,
    );
    if (prefix !== null) {
      const record = line.slice(prefix[0].length).trimEnd();
      const statusStart = record.lastIndexOf(" (");
      if (statusStart >= 0 && record.endsWith(")")) {
        const child = terminatedChild(
          record.slice(0, statusStart),
          record.slice(statusStart + 2, -1),
        );
        if (child !== null) return child;
      }
    }

    const spawn = /^\s*(?:error:\s*)?(?:could not|failed to)\s+(?:execute|spawn)\s+(?:process\s+)?(.+?)(?:\s*\([^)]*\))?\s*$/iu.exec(
      line,
    );
    if (spawn !== null) {
      return {
        childRole: childRole(spawn[1]),
        childTermination: "spawn",
        childExitCode: null,
        childSignalNumber: null,
        childSignalName: null,
      };
    }
  }
  return {
    childRole: "unknown",
    childTermination: null,
    childExitCode: null,
    childSignalNumber: null,
    childSignalName: null,
  };
}

function ioArea(output, index) {
  const start = Math.max(0, output.lastIndexOf("\n", index) + 1);
  const next = output.indexOf("\n", index);
  const end = next < 0 ? output.length : next;
  const context = output.slice(Math.max(0, start - 256), Math.min(output.length, end + 256));
  if (/incremental(?:-cache)?|query-cache\.bin|dep-graph\.bin|work-products\.bin/iu.test(context)) {
    return "incremental-cache";
  }
  if (/CARGO_HOME|\.cargo[\\/](?:registry|git)|registry[\\/](?:cache|src)/iu.test(context)) {
    return "cargo-cache";
  }
  if (/(?:^|[\s'"`])\/state\/target(?:[\/\s'"`:]|$)/u.test(context)) {
    return "target";
  }
  if (/(?:^|[\s'"`])\/state\/tmp(?:[\/\s'"`:]|$)/u.test(context)) {
    return "temp";
  }
  if (/\btemporary\b|\btemp(?:\s+(?:dir|directory|file))?\b|TMPDIR|(?:^|[\\/])tmp[\\/]/iu.test(context)) {
    return "temp";
  }
  if (/CARGO_TARGET_DIR|(?:^|[\\/])target[\\/]|target\s+(?:dir|directory)/iu.test(context)) {
    return "target";
  }
  if (/source\s+(?:file|directory)|(?:^|[\\/])src[\\/]|\.rs(?=$|[:\s'"`])/iu.test(context)) {
    return "source";
  }
  return "unknown";
}

function ioEvidence(output) {
  for (const [errno, pattern] of IO_PATTERNS) {
    const match = pattern.exec(output);
    if (match !== null) {
      return { ioErrno: errno, ioArea: ioArea(output, match.index) };
    }
  }
  return { ioErrno: null, ioArea: "unknown" };
}

function primaryClass({ output, disposition, exitCode, authoritativeOomKill, io, child, codes }) {
  if (disposition === "timed-out") return "timeout";
  if (disposition === "output-limit") return "output-limit";
  if (disposition === "completed" && exitCode === 0) return null;
  if (authoritativeOomKill || io.ioErrno === "ENOMEM") return "memory-exhausted";
  if (["ENOSPC", "EDQUOT"].includes(io.ioErrno)) return "state-exhausted";
  if (io.ioErrno !== null) return "sandbox-filesystem";
  if (/rustc-LLVM ERROR|internal compiler error|LLVM ERROR:/iu.test(output)) {
    return "toolchain-error";
  }
  if (
    /linking with [^\r\n]{0,160} failed|linker [^\r\n]{0,160} failed|collect2: error|undefined reference|(?:^|\n)\s*(?:ld|lld|mold):[^\r\n]*(?:error|failed)/imu.test(
      output,
    )
  ) {
    return "linker-error";
  }
  if (/failed to run custom build command|CMake Error|error occurred in cc-rs/iu.test(output)) {
    return "native-build-error";
  }
  if (
    /attempting to make an HTTP request|failed to download|no matching package named[^\r\n]{0,160}offline/iu.test(
      output,
    )
  ) {
    return "offline-dependency";
  }
  if (child.childTermination === "signal") return "child-process-signaled";
  if (child.childTermination === "exit") return "child-process-exited";
  if (child.childTermination === "spawn") return "child-process-spawn-failed";
  if (codes.length > 0) return "rust-compiler-diagnostic";
  return "cargo-build-failed-unclassified";
}

function emptyDiagnostic() {
  return {
    primaryClass: null,
    rustcCodes: [],
    childRole: "unknown",
    childTermination: null,
    childExitCode: null,
    childSignalNumber: null,
    childSignalName: null,
    ioArea: "unknown",
    ioErrno: null,
  };
}

export function normalizeCommandFailureDiagnostic(value) {
  plainObject(value, "diagnostic");
  exactKeys(value);
  if (value.primaryClass !== null && !PRIMARY_CLASSES.has(value.primaryClass)) {
    fail("primaryClass is not allowed");
  }
  if (
    !Array.isArray(value.rustcCodes) ||
    value.rustcCodes.length > 8 ||
    value.rustcCodes.some((code) => typeof code !== "string" || !/^E\d{4}$/u.test(code)) ||
    new Set(value.rustcCodes).size !== value.rustcCodes.length ||
    value.rustcCodes.some((code, index) => index > 0 && value.rustcCodes[index - 1] >= code)
  ) {
    fail("rustcCodes must be at most eight sorted unique Rust error codes");
  }
  if (!CHILD_ROLES.has(value.childRole)) fail("childRole is not allowed");
  if (value.childTermination !== null && !CHILD_TERMINATIONS.has(value.childTermination)) {
    fail("childTermination is not allowed");
  }
  if (
    value.childExitCode !== null &&
    (!Number.isSafeInteger(value.childExitCode) || value.childExitCode < 0 || value.childExitCode > 255)
  ) {
    fail("childExitCode must be null or an integer from 0 through 255");
  }
  if (
    value.childSignalNumber !== null &&
    (!Number.isSafeInteger(value.childSignalNumber) ||
      value.childSignalNumber < 1 ||
      value.childSignalNumber > 64)
  ) {
    fail("childSignalNumber must be null or an integer from 1 through 64");
  }
  if (value.childSignalName !== null && !SIGNAL_NAMES.has(value.childSignalName)) {
    fail("childSignalName is not allowed");
  }
  if (!IO_AREAS.has(value.ioArea)) fail("ioArea is not allowed");
  if (value.ioErrno !== null && !IO_ERRNOS.has(value.ioErrno)) {
    fail("ioErrno is not allowed");
  }

  if (value.childTermination === null) {
    if (
      value.childRole !== "unknown" ||
      value.childExitCode !== null ||
      value.childSignalNumber !== null ||
      value.childSignalName !== null
    ) {
      fail("absent child termination must have empty child evidence");
    }
  } else if (value.childTermination === "signal") {
    if (
      value.childExitCode !== null ||
      value.childSignalNumber === null ||
      value.childSignalName === null
    ) {
      fail("signal termination has inconsistent child evidence");
    }
  } else if (value.childTermination === "exit") {
    if (
      value.childExitCode === null ||
      value.childSignalNumber !== null ||
      value.childSignalName !== null
    ) {
      fail("exit termination has inconsistent child evidence");
    }
  } else if (
    value.childExitCode !== null ||
    value.childSignalNumber !== null ||
    value.childSignalName !== null
  ) {
    fail("spawn termination has inconsistent child evidence");
  }

  if (value.ioErrno === null && value.ioArea !== "unknown") {
    fail("absent ioErrno must use the unknown ioArea");
  }
  if (value.primaryClass === null) {
    const empty = emptyDiagnostic();
    if (DIAGNOSTIC_KEYS.some((key) => JSON.stringify(value[key]) !== JSON.stringify(empty[key]))) {
      fail("successful diagnostics must not contain failure evidence");
    }
  }
  if (
    value.primaryClass === "child-process-signaled" &&
    value.childTermination !== "signal"
  ) {
    fail("child-process-signaled requires signal evidence");
  }
  if (value.primaryClass === "child-process-exited" && value.childTermination !== "exit") {
    fail("child-process-exited requires exit evidence");
  }
  if (
    value.primaryClass === "child-process-spawn-failed" &&
    value.childTermination !== "spawn"
  ) {
    fail("child-process-spawn-failed requires spawn evidence");
  }
  if (value.primaryClass === "rust-compiler-diagnostic" && value.rustcCodes.length === 0) {
    fail("rust-compiler-diagnostic requires a Rust error code");
  }
  if (
    value.primaryClass === "state-exhausted" &&
    !["ENOSPC", "EDQUOT"].includes(value.ioErrno)
  ) {
    fail("state-exhausted requires ENOSPC or EDQUOT evidence");
  }
  if (
    value.primaryClass === "sandbox-filesystem" &&
    !["EROFS", "EACCES", "ENOENT", "EIO"].includes(value.ioErrno)
  ) {
    fail("sandbox-filesystem requires bounded filesystem evidence");
  }
  if (value.primaryClass === "memory-exhausted" && ![null, "ENOMEM"].includes(value.ioErrno)) {
    fail("memory-exhausted has inconsistent IO evidence");
  }

  return Object.freeze({
    primaryClass: value.primaryClass,
    rustcCodes: Object.freeze([...value.rustcCodes]),
    childRole: value.childRole,
    childTermination: value.childTermination,
    childExitCode: value.childExitCode,
    childSignalNumber: value.childSignalNumber,
    childSignalName: value.childSignalName,
    ioArea: value.ioArea,
    ioErrno: value.ioErrno,
  });
}

export function summarizeCommandFailure({
  stdout,
  stderr,
  disposition,
  exitCode,
  authoritativeOomKill = false,
}) {
  if (
    !new Set([
      "completed",
      "timed-out",
      "timeout",
      "timeout-unreaped",
      "output-limit",
      "output-limit-unreaped",
    ]).has(disposition)
  ) {
    fail("disposition is not allowed");
  }
  if (
    exitCode !== null &&
    (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255)
  ) {
    fail("exitCode must be null or an integer from 0 through 255");
  }
  if (typeof authoritativeOomKill !== "boolean") {
    fail("authoritativeOomKill must be boolean");
  }
  if (disposition === "completed" && exitCode === 0) {
    return normalizeCommandFailureDiagnostic(emptyDiagnostic());
  }

  const normalizedDisposition = disposition.startsWith("timeout")
    ? "timed-out"
    : disposition.startsWith("output-limit")
      ? "output-limit"
      : disposition;

  const output = outputText(stdout, stderr);
  const codes = rustcCodes(output);
  const child = childStatus(output);
  const io = ioEvidence(output);
  return normalizeCommandFailureDiagnostic({
    primaryClass: primaryClass({
      output,
      disposition: normalizedDisposition,
      exitCode,
      authoritativeOomKill,
      io,
      child,
      codes,
    }),
    rustcCodes: codes,
    ...child,
    ...io,
  });
}
