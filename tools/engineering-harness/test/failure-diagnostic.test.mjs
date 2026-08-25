import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCommandFailureDiagnostic,
  summarizeCommandFailure,
} from "../src/candidate/failure-diagnostic.mjs";

function summary(stderr, overrides = {}) {
  return summarizeCommandFailure({
    stdout: "",
    stderr,
    disposition: "completed",
    exitCode: 101,
    ...overrides,
  });
}

test("a bare Cargo compilation failure remains explicitly unclassified", () => {
  assert.deepEqual(summary("error: could not compile `private-crate`"), {
    primaryClass: "cargo-build-failed-unclassified",
    rustcCodes: [],
    childRole: "unknown",
    childTermination: null,
    childExitCode: null,
    childSignalNumber: null,
    childSignalName: null,
    ioArea: "unknown",
    ioErrno: null,
  });
});

test("a causal child status earlier than a retained tail is still summarized", () => {
  const diagnostic = summary(
    "process didn't exit successfully: `/toolchains/bin/rustc --crate-name SECRET_CRATE` " +
      "(signal: 9, SIGKILL: kill)\n" +
      "tail-noise\n".repeat(600),
  );
  assert.equal(diagnostic.primaryClass, "child-process-signaled");
  assert.equal(diagnostic.childRole, "rustc");
  assert.equal(diagnostic.childTermination, "signal");
  assert.equal(diagnostic.childSignalNumber, 9);
  assert.equal(diagnostic.childSignalName, "SIGKILL");
});

test("a build-script signal is not relabelled by unrelated rustc prose", () => {
  const diagnostic = summary(
    [
      "note: rustc /private/arguments appeared in an unrelated earlier message",
      "process didn't exit successfully: `/workspace/target/debug/build/secret/build-script-build` (signal: 9, SIGKILL: kill)",
      "error[E0599]: unrelated compiler diagnostic",
    ].join("\n"),
  );
  assert.equal(diagnostic.primaryClass, "child-process-signaled");
  assert.equal(diagnostic.childRole, "build-script");
  assert.equal(diagnostic.childSignalName, "SIGKILL");
  assert.deepEqual(diagnostic.rustcCodes, ["E0599"]);
});

test("a rustc child exit retains the complete bounded exit code", () => {
  const diagnostic = summary(
    "process didn't exit successfully: `/toolchains/bin/rustc --crate-name secret` (exit status: 254)",
  );
  assert.equal(diagnostic.primaryClass, "child-process-exited");
  assert.equal(diagnostic.childRole, "rustc");
  assert.equal(diagnostic.childTermination, "exit");
  assert.equal(diagnostic.childExitCode, 254);
  assert.equal(diagnostic.childSignalNumber, null);
  assert.equal(diagnostic.childSignalName, null);
});

test("an ICE outranks a child signal while retaining the secondary evidence", () => {
  const diagnostic = summary(
    [
      "error: internal compiler error: SECRET_ICE_DETAIL",
      "process didn't exit successfully: `/toolchains/bin/rustc --crate-name secret` (signal: 6, SIGABRT: abort)",
    ].join("\n"),
  );
  assert.equal(diagnostic.primaryClass, "toolchain-error");
  assert.equal(diagnostic.childRole, "rustc");
  assert.equal(diagnostic.childTermination, "signal");
  assert.equal(diagnostic.childSignalNumber, 6);
  assert.equal(diagnostic.childSignalName, "SIGABRT");
});

test("errno and IO-area evidence follows the reviewed precedence matrix", async (t) => {
  const cases = [
    {
      name: "memory",
      line: "failed to allocate incremental cache: ENOMEM",
      primaryClass: "memory-exhausted",
      ioErrno: "ENOMEM",
      ioArea: "incremental-cache",
    },
    {
      name: "space",
      line: "failed to write /state/target/debug/output: No space left on device",
      primaryClass: "state-exhausted",
      ioErrno: "ENOSPC",
      ioArea: "target",
    },
    {
      name: "quota",
      line: "failed to update /home/user/.cargo/registry/cache/item: Disk quota exceeded",
      primaryClass: "state-exhausted",
      ioErrno: "EDQUOT",
      ioArea: "cargo-cache",
    },
    {
      name: "read-only",
      line: "couldn't create a temp dir: Read-only file system",
      primaryClass: "sandbox-filesystem",
      ioErrno: "EROFS",
      ioArea: "temp",
    },
    {
      name: "rustc target temp directory",
      line:
        "error: couldn't create a temp dir: No such file or directory (os error 2) at path /state/target/debug/deps/rmetavQ3x7P",
      primaryClass: "sandbox-filesystem",
      ioErrno: "ENOENT",
      ioArea: "target",
      privateSuffix: "rmetavQ3x7P",
    },
    {
      name: "rustc process temp directory",
      line:
        "error: couldn't create a temp dir: No such file or directory (os error 2) at path /state/tmp/rustcT9p4Lm",
      primaryClass: "sandbox-filesystem",
      ioErrno: "ENOENT",
      ioArea: "temp",
      privateSuffix: "rustcT9p4Lm",
    },
    {
      name: "access",
      line: "failed to read /workspace/src/private.rs: Permission denied",
      primaryClass: "sandbox-filesystem",
      ioErrno: "EACCES",
      ioArea: "source",
    },
    {
      name: "missing",
      line: "failed to open /unclassified/location: No such file or directory",
      primaryClass: "sandbox-filesystem",
      ioErrno: "ENOENT",
      ioArea: "unknown",
    },
    {
      name: "io",
      line: "failed to persist query-cache.bin: Input/output error",
      primaryClass: "sandbox-filesystem",
      ioErrno: "EIO",
      ioArea: "incremental-cache",
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const diagnostic = summary(fixture.line);
      assert.equal(diagnostic.primaryClass, fixture.primaryClass);
      assert.equal(diagnostic.ioErrno, fixture.ioErrno);
      assert.equal(diagnostic.ioArea, fixture.ioArea);
      if (fixture.privateSuffix !== undefined) {
        assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(fixture.privateSuffix, "u"));
      }
    });
  }
});

test("Rust error codes are sorted, deduplicated, and capped at eight", () => {
  const diagnostic = summary(
    [
      "error[E9999]: secret",
      "error[E0009]: secret",
      "error[E0001]: secret",
      "error[E0008]: secret",
      "error[E0007]: secret",
      "error[E0006]: secret",
      "error[E0005]: secret",
      "error[E0004]: secret",
      "error[E0003]: secret",
      "error[E0002]: secret",
      "error[E0001]: duplicate",
    ].join("\n"),
  );
  assert.equal(diagnostic.primaryClass, "rust-compiler-diagnostic");
  assert.deepEqual(diagnostic.rustcCodes, [
    "E0001",
    "E0002",
    "E0003",
    "E0004",
    "E0005",
    "E0006",
    "E0007",
    "E0008",
  ]);
});

test("the normalizer rejects malformed and internally inconsistent evidence", () => {
  const valid = summary("error[E0599]: secret");
  const cases = [
    { ...valid, leakedPath: "/private/secret" },
    { ...valid, rustcCodes: ["E0599", "E0277"] },
    { ...valid, childTermination: "signal", childSignalNumber: 0 },
    { ...valid, childSignalName: "SIGSECRET" },
    { ...valid, ioArea: "private-cache" },
    { ...valid, ioErrno: "ESECRET" },
    { ...valid, primaryClass: "child-process-exited" },
  ];
  for (const value of cases) {
    assert.throws(
      () => normalizeCommandFailureDiagnostic(value),
      /invalid command failure diagnostic/u,
    );
  }
});

test("the fixed JSON shape cannot serialize seeded command secrets", () => {
  const secrets = [
    "SECRET_CRATE_7a63",
    "/private/worktree/SECRET_PATH_941c",
    "--secret-argv=SECRET_ARG_853b",
    "SECRET_PROSE_15de",
  ];
  const diagnostic = summary(
    [
      `error[E0599]: ${secrets[3]}`,
      `process didn't exit successfully: \`/toolchains/bin/rustc --crate-name ${secrets[0]} ${secrets[2]} ${secrets[1]}\` (signal: 11, SIGSEGV: fault)`,
    ].join("\n"),
  );
  assert.deepEqual(Object.keys(diagnostic), [
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
  const json = JSON.stringify(diagnostic);
  for (const secret of secrets) assert.doesNotMatch(json, new RegExp(secret, "u"));
});

test("success and authoritative OOM use only bounded fixed-schema values", () => {
  assert.equal(
    summary("error[E0599]: ignored after success", { exitCode: 0 }).primaryClass,
    null,
  );
  const oom = summary("process killed without a textual cause", {
    exitCode: null,
    authoritativeOomKill: true,
  });
  assert.equal(oom.primaryClass, "memory-exhausted");
  assert.equal(oom.ioErrno, null);
  assert.equal(oom.ioArea, "unknown");
});

test("raw sandbox timeout and output dispositions normalize without prose", () => {
  assert.equal(
    summary("private timeout detail", {
      disposition: "timeout-unreaped",
      exitCode: null,
    }).primaryClass,
    "timeout",
  );
  assert.equal(
    summary("private output detail", {
      disposition: "output-limit-unreaped",
      exitCode: null,
    }).primaryClass,
    "output-limit",
  );
});
