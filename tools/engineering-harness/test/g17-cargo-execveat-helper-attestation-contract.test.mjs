import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV,
  G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV,
  G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
  G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256,
  createG17CargoExecveatHelperAttestationArtifact,
  verifyG17CargoExecveatHelperAttestationArtifact,
} from "../src/qualification/cargo-execveat-helper-attestation-contract.mjs";
import {
  G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
} from "../src/qualification/cargo-execveat-status-protocol-contract.mjs";
import { parseG17Elf64 } from "../src/qualification/native-elf.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-v2-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /G1\.7 Cargo execveat helper attestation/u;
const helperSourceUrl = new URL(
  "../src/qualification/cargo-execveat-helper.c",
  import.meta.url,
);
const compilerEnvironment = Object.freeze({
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
  SOURCE_DATE_EPOCH: "0",
});

let fixturePromise;
let fixtureDirectory;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function metadataIdentity(metadata) {
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    links: metadata.nlink.toString(),
    size: metadata.size.toString(),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
    ownerUid: metadata.uid.toString(),
    ownerGid: metadata.gid.toString(),
  };
}

function runCompiler(args, cwd) {
  return spawnSync(G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH, args, {
    cwd,
    env: compilerEnvironment,
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
}

async function buildFixture() {
  if (fixturePromise !== undefined) return fixturePromise;
  fixturePromise = (async () => {
    fixtureDirectory = await mkdtemp(
      join(tmpdir(), "oxigraph-g17-execveat-helper-"),
    );
    const sourcePath = join(
      fixtureDirectory,
      G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
    );
    const executablePath = join(fixtureDirectory, "g17-cargo-execveat-helper");
    await copyFile(helperSourceUrl, sourcePath);

    const version = runCompiler(
      G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV.slice(1),
      fixtureDirectory,
    );
    assert.equal(version.error, undefined);
    assert.equal(version.status, 0);
    assert.equal(version.signal, null);
    assert.ok(version.stdout.length > 0);

    const compile = runCompiler(
      G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV.slice(1),
      fixtureDirectory,
    );
    assert.equal(compile.error, undefined);
    assert.equal(compile.status, 0);
    assert.equal(compile.signal, null);
    assert.equal(compile.stdout.length, 0);
    assert.equal(compile.stderr.length, 0);
    await chmod(executablePath, 0o500);

    const [sourceBytes, compilerBytes, executableBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH),
      readFile(executablePath),
    ]);
    const [compilerStatus, executableStatus] = await Promise.all([
      stat(G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH, { bigint: true }),
      stat(executablePath, { bigint: true }),
    ]);
    return {
      sourceBytes,
      compilerBytes,
      compilerVersionBytes: version.stdout,
      compilerVersionStderrBytes: version.stderr,
      compilerVersionExitCode: version.status,
      compilerVersionSignal: version.signal,
      compileStdoutBytes: compile.stdout,
      compileStderrBytes: compile.stderr,
      compileExitCode: compile.status,
      compileSignal: compile.signal,
      executableBytes,
      compilerIdentity: metadataIdentity(compilerStatus),
      executableIdentity: metadataIdentity(executableStatus),
    };
  })();
  return fixturePromise;
}

test.after(async () => {
  if (fixtureDirectory !== undefined) {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertNullPrototypeRecords(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    assert.equal(Object.getPrototypeOf(value), null);
  }
  for (const child of Object.values(value)) {
    assertNullPrototypeRecords(child, seen);
  }
}

function reseal(attestation) {
  const { contentHash: _oldContentHash, ...unsigned } = attestation;
  attestation.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(attestation)}\n`, "utf8");
}

function mutatedArtifact(created, mutate) {
  const value = plainJson(created.attestation);
  mutate(value);
  return reseal(value);
}

test("reviewed C17 source bytes and compile recipe are exact", async () => {
  const sourceBytes = await readFile(helperSourceUrl);
  const policy = createG17NonTmpfsBuildIsolationV2PolicyArtifact().policy;

  assert.equal(
    G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
    "cargo-execveat-helper.c",
  );
  assert.equal(sourceBytes.length, G17_CARGO_EXECVEAT_HELPER_SOURCE_BYTES);
  assert.equal(sha256(sourceBytes), G17_CARGO_EXECVEAT_HELPER_SOURCE_SHA256);
  assert.equal(
    G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
    "/usr/bin/x86_64-linux-gnu-gcc-13",
  );
  assert.deepEqual(
    G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV,
    policy.helper.attestation.compileArgv,
  );
  assert.deepEqual(G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV, [
    "/usr/bin/x86_64-linux-gnu-gcc-13",
    "-std=c17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fstack-protector-strong",
    "-D_FORTIFY_SOURCE=2",
    "-Wl,-z,relro,-z,now",
    "cargo-execveat-helper.c",
    "-o",
    "g17-cargo-execveat-helper",
  ]);
  assert.deepEqual(G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV, [
    "/usr/bin/x86_64-linux-gnu-gcc-13",
    "--version",
  ]);
});

test("reviewed helper source uses only the exact held-fd execveat transition", async () => {
  const source = await readFile(helperSourceUrl, "utf8");

  assert.match(source, /syscall\(SYS_execveat,\s*CARGO_FD,\s*""/u);
  assert.match(source, /AT_EMPTY_PATH/u);
  assert.match(source, /syscall\(SYS_close_range/u);
  assert.match(source, /syscall\(\s*SYS_kcmp/u);
  assert.match(source, /syscall\(\s*SYS_openat2/u);
  assert.match(source, /RESOLVE_BENEATH\s*\|\s*RESOLVE_NO_SYMLINKS/u);
  assert.match(
    source,
    /validate_child_beneath_workspace\(\s*3,\s*"source",\s*&observations\[4\]/u,
  );
  assert.match(
    source,
    /validate_child_beneath_workspace\(\s*3,\s*"target",\s*&observations\[5\]/u,
  );
  assert.match(source, /sigaction\(SIGPIPE/u);
  assert.match(source, /sigprocmask\(SIG_BLOCK/u);
  assert.match(source, /sigtimedwait\(/u);
  assert.match(source, /SIG_DFL/u);
  assert.match(
    source,
    /const int distinct_pipe_object_fds\[\]\s*=\s*\{\s*1,\s*2,\s*STATUS_FD,\s*\}/u,
  );
  assert.match(source, /fcntl\([^)]*,\s*F_SETFD/u);
  assert.match(source, /fcntl\([^)]*,\s*F_GETFD/u);
  assert.doesNotMatch(
    source,
    /\b(?:system|popen|fork|vfork|fexecve|posix_spawn)\s*\(/u,
  );
  assert.doesNotMatch(source, /\bexecve\s*\(/u);
  assert.doesNotMatch(source, /\/proc\/self\/fd\/6/u);
});

test("helper source embeds the exact canonical status schema and terminal stages", async () => {
  const source = await readFile(helperSourceUrl, "utf8");
  const ready = `${canonicalJson({
    schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    type: "READY",
    stage: "execveat",
    errno: null,
    reservedExitCode: null,
  })}\n`;

  assert.equal(
    source.includes(G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA),
    true,
  );
  assert.equal(source.includes(ready.replaceAll('"', '\\"').trim()), true);
  assert.deepEqual(G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES, [
    "preflight",
    "cargo-fd",
    "status-fd",
    "status-cloexec",
    "ready-write",
  ]);
  for (const [stage, exitCode] of Object.entries(
    G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
  )) {
    assert.equal(source.includes(`"${stage}"`), true, stage);
    assert.equal(source.includes(String(exitCode)), true, stage);
  }
});

test("exact GCC-13 recipe compiles an x86-64 ELF without running it", async () => {
  const evidence = await buildFixture();
  const elf = parseG17Elf64(evidence.executableBytes);

  assert.equal(elf.elfClass, 64);
  assert.equal(elf.elfData, "little");
  assert.equal(elf.elfMachine, 62);
  assert.match(elf.interpreter, /^\/(?:usr\/)?lib64?\//u);
  assert.equal(elf.needed.includes("libc.so.6"), true);
});

test("pure attestation binds exact source, compiler, streams, ELF, and policy hashes", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  const { attestation, identity, artifact } = created;
  const policyArtifact = createG17NonTmpfsBuildIsolationV2PolicyArtifact();

  assert.equal(
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA,
    "oxigraph.g1.7-cargo-execveat-helper-attestation/v1",
  );
  assert.equal(
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
    "oxigraph.g1.7-cargo-execveat-helper-attestation-replay/v1",
  );
  assert.equal(
    artifact.name,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_ARTIFACT_NAME,
  );
  assert.equal(artifact.rawSha256, sha256(artifact.bytes));
  assert.equal(identity.rawSha256, artifact.rawSha256);
  assert.equal(identity.contentHash, attestation.contentHash);
  assert.deepEqual(plainJson(attestation.source), {
    logicalName: G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
    bytes: evidence.sourceBytes.length,
    sha256: sha256(evidence.sourceBytes),
  });
  assert.equal(
    attestation.compiler.path,
    G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
  );
  assert.equal(attestation.compiler.major, "13");
  assert.deepEqual(
    attestation.compiler.version.argv,
    G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV,
  );
  assert.equal(
    attestation.compiler.executable.sha256,
    sha256(evidence.compilerBytes),
  );
  assert.equal(
    attestation.compiler.version.stdout.base64,
    evidence.compilerVersionBytes.toString("base64"),
  );
  assert.equal(attestation.compiler.version.stderr.base64, "");
  assert.equal(attestation.compiler.version.exitCode, 0);
  assert.equal(attestation.compiler.version.signal, null);
  assert.deepEqual(
    attestation.compile.argv,
    G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV,
  );
  assert.equal(attestation.compile.stdout.base64, "");
  assert.equal(attestation.compile.stderr.base64, "");
  assert.equal(attestation.executable.sha256, sha256(evidence.executableBytes));
  assert.deepEqual(
    plainJson(attestation.executable.identity),
    evidence.executableIdentity,
  );
  assert.equal(attestation.executable.elf.elfMachine, 62);
  assert.deepEqual(plainJson(attestation.policyBindings), {
    isolationPolicySchema: G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
    isolationPolicyRawSha256: policyArtifact.artifact.sha256,
    isolationPolicyContentHash: policyArtifact.policy.sha256,
    fileDescriptorMapSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
    statusProtocolSchema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    statusProtocolRequirementsSha256:
      G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  });
  assert.deepEqual(
    attestation.requestBinding,
    G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  );
  assert.equal(
    attestation.contentHash,
    canonicalSha256(
      Object.fromEntries(
        Object.entries(attestation).filter(([key]) => key !== "contentHash"),
      ),
    ),
  );
  assertDeepFrozen(created);
  assertNullPrototypeRecords(attestation);
});

test("attestation replay remains dormant, binding-null, and authority-free", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  const replay = verifyG17CargoExecveatHelperAttestationArtifact({
    bytes: created.artifact.bytes,
    evidence,
  });

  assert.equal(
    replay.schema,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
  );
  assert.equal(replay.status, "DORMANT_HELPER_ATTESTATION_REPLAYED");
  assert.deepEqual(replay.identity, created.identity);
  assert.deepEqual(
    replay.requestBinding,
    G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  );
  assert.deepEqual(
    replay.authority,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
  );
  assert.deepEqual(
    replay.nonclaims,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
  );
  assert.equal(
    Object.values(replay.authority).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(replay.nonclaims).every((value) => value === false),
    true,
  );
  assert.equal(replay.physicalLaunchEligible, false);
  assert.equal(replay.binding, null);
  assert.equal(replay.finalDecisionEligible, false);
  assert.equal(
    replay.nonclaims.helperRuntimeArgvBoundToExecutionRequest,
    false,
  );
  assert.equal(
    replay.nonclaims.helperRuntimeEnvironmentBoundToExecutionRequest,
    false,
  );
  assert.equal(replay.nonclaims.helperValidatesExecutionRequestBinding, false);
  assertDeepFrozen(replay);
  assertNullPrototypeRecords(replay);
});

test("every authority and nonclaim oracle is fixed false", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);

  for (const key of Object.keys(
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
  )) {
    assert.throws(
      () =>
        verifyG17CargoExecveatHelperAttestationArtifact({
          bytes: mutatedArtifact(created, (value) => {
            value.authority[key] = true;
          }),
          evidence,
        }),
      CONTRACT_ERROR,
      `authority ${key}`,
    );
  }
  for (const key of Object.keys(
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
  )) {
    assert.throws(
      () =>
        verifyG17CargoExecveatHelperAttestationArtifact({
          bytes: mutatedArtifact(created, (value) => {
            value.nonclaims[key] = true;
          }),
          evidence,
        }),
      CONTRACT_ERROR,
      `nonclaim ${key}`,
    );
  }
});

test("attestation rejects drift across every identity and binding boundary", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  const mutations = [
    [
      "schema",
      (value) => {
        value.schema = `${value.schema}-drift`;
      },
    ],
    [
      "source digest",
      (value) => {
        value.source.sha256 = "0".repeat(64);
      },
    ],
    [
      "compiler path",
      (value) => {
        value.compiler.path = "/usr/bin/cc";
      },
    ],
    [
      "compiler digest",
      (value) => {
        value.compiler.executable.sha256 = "0".repeat(64);
      },
    ],
    [
      "compiler version argv",
      (value) => {
        value.compiler.version.argv[1] = "-v";
      },
    ],
    [
      "compiler version",
      (value) => {
        value.compiler.version.stdout.base64 = "";
      },
    ],
    [
      "compile argv",
      (value) => {
        value.compile.argv[2] = "-O0";
      },
    ],
    [
      "compile stdout",
      (value) => {
        value.compile.stdout.bytes = 1;
      },
    ],
    [
      "compile status",
      (value) => {
        value.compile.exitCode = 1;
      },
    ],
    [
      "executable digest",
      (value) => {
        value.executable.sha256 = "0".repeat(64);
      },
    ],
    [
      "executable identity",
      (value) => {
        value.executable.identity.inode = "0";
      },
    ],
    [
      "ELF",
      (value) => {
        value.executable.elf.elfMachine = 3;
      },
    ],
    [
      "policy raw hash",
      (value) => {
        value.policyBindings.isolationPolicyRawSha256 = "0".repeat(64);
      },
    ],
    [
      "policy content hash",
      (value) => {
        value.policyBindings.isolationPolicyContentHash = "0".repeat(64);
      },
    ],
    [
      "FD map",
      (value) => {
        value.policyBindings.fileDescriptorMapSha256 = "0".repeat(64);
      },
    ],
    [
      "status hash",
      (value) => {
        value.policyBindings.statusProtocolRequirementsSha256 = "0".repeat(64);
      },
    ],
    [
      "request placeholder",
      (value) => {
        value.requestBinding.rawSha256 = "0".repeat(64);
      },
    ],
    [
      "request argv binding",
      (value) => {
        value.requestBinding.runtimeArgvBound = true;
      },
    ],
    [
      "request environment binding",
      (value) => {
        value.requestBinding.runtimeEnvironmentBound = true;
      },
    ],
    [
      "binding",
      (value) => {
        value.binding = {};
      },
    ],
    [
      "decision",
      (value) => {
        value.finalDecisionEligible = true;
      },
    ],
    [
      "extra",
      (value) => {
        value.unreviewed = true;
      },
    ],
  ];

  for (const [label, mutate] of mutations) {
    assert.throws(
      () =>
        verifyG17CargoExecveatHelperAttestationArtifact({
          bytes: mutatedArtifact(created, mutate),
          evidence,
        }),
      CONTRACT_ERROR,
      label,
    );
  }
});

test("attestation creation rejects unreviewed compiler, stream, and held-file evidence", async () => {
  const evidence = await buildFixture();
  const changedSource = Buffer.from(evidence.sourceBytes);
  changedSource[0] ^= 1;
  const cases = [
    ["source bytes", { sourceBytes: changedSource }],
    ["compiler major", { compilerVersionBytes: Buffer.from("gcc 14.1.0\n") }],
    ["version LF", { compilerVersionBytes: Buffer.from("gcc 13.1.0") }],
    [
      "version stderr",
      { compilerVersionStderrBytes: Buffer.from("warning\n") },
    ],
    ["version exit", { compilerVersionExitCode: 1 }],
    ["version signal", { compilerVersionSignal: "SIGTERM" }],
    ["compile stdout", { compileStdoutBytes: Buffer.from("unexpected") }],
    ["compile stderr", { compileStderrBytes: Buffer.from("warning") }],
    ["compile exit", { compileExitCode: 1 }],
    ["compile signal", { compileSignal: "SIGKILL" }],
    [
      "compiler mode",
      {
        compilerIdentity: {
          ...evidence.compilerIdentity,
          mode: String(0o100600),
        },
      },
    ],
    [
      "helper mode",
      {
        executableIdentity: {
          ...evidence.executableIdentity,
          mode: String(0o100700),
        },
      },
    ],
    [
      "helper links",
      { executableIdentity: { ...evidence.executableIdentity, links: "2" } },
    ],
    [
      "helper size",
      { executableIdentity: { ...evidence.executableIdentity, size: "1" } },
    ],
    [
      "compiler alias",
      {
        executableBytes: Buffer.from(evidence.compilerBytes),
        executableIdentity: {
          ...evidence.executableIdentity,
          size: String(evidence.compilerBytes.length),
        },
      },
    ],
    [
      "non ELF helper",
      {
        executableBytes: Buffer.from("not an ELF"),
        executableIdentity: {
          ...evidence.executableIdentity,
          size: String(Buffer.byteLength("not an ELF")),
        },
      },
    ],
  ];

  for (const [label, change] of cases) {
    assert.throws(
      () =>
        createG17CargoExecveatHelperAttestationArtifact({
          ...evidence,
          ...change,
        }),
      CONTRACT_ERROR,
      label,
    );
  }
});

test("attestation defensively snapshots exact own-data and Buffer evidence", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  const fields = Object.keys(evidence);

  assert.throws(
    () =>
      createG17CargoExecveatHelperAttestationArtifact(new Proxy(evidence, {})),
    CONTRACT_ERROR,
  );
  const extra = { ...evidence, authority: true };
  assert.throws(
    () => createG17CargoExecveatHelperAttestationArtifact(extra),
    CONTRACT_ERROR,
  );
  const symbolic = { ...evidence };
  symbolic[Symbol("authority")] = true;
  assert.throws(
    () => createG17CargoExecveatHelperAttestationArtifact(symbolic),
    CONTRACT_ERROR,
  );
  const accessor = Object.fromEntries(
    fields.map((key) => [key, evidence[key]]),
  );
  let accessed = false;
  Object.defineProperty(accessor, "sourceBytes", {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error("must not run");
    },
  });
  assert.throws(
    () => createG17CargoExecveatHelperAttestationArtifact(accessor),
    CONTRACT_ERROR,
  );
  assert.equal(accessed, false);

  const proxiedBuffer = {
    ...evidence,
    sourceBytes: new Proxy(evidence.sourceBytes, {}),
  };
  assert.throws(
    () => createG17CargoExecveatHelperAttestationArtifact(proxiedBuffer),
    CONTRACT_ERROR,
  );
  const ownLength = Buffer.from(evidence.sourceBytes);
  let lengthRead = false;
  Object.defineProperty(ownLength, "length", {
    configurable: true,
    get() {
      lengthRead = true;
      return 1;
    },
  });
  assert.throws(
    () =>
      createG17CargoExecveatHelperAttestationArtifact({
        ...evidence,
        sourceBytes: ownLength,
      }),
    CONTRACT_ERROR,
  );
  assert.equal(lengthRead, false);

  const bytes = created.artifact.bytes;
  assert.throws(
    () =>
      verifyG17CargoExecveatHelperAttestationArtifact({
        bytes: new Proxy(bytes, {}),
        evidence,
      }),
    CONTRACT_ERROR,
  );
});

test("canonical artifact verifier rejects malformed and ambiguous bytes", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  const bytes = created.artifact.bytes;
  const rejected = [
    Buffer.alloc(0),
    Buffer.alloc(G17_CARGO_EXECVEAT_HELPER_ATTESTATION_MAX_BYTES + 1),
    Buffer.from([0xff, 0x0a]),
    bytes.subarray(0, -1),
    Buffer.concat([bytes, Buffer.from("\n")]),
    Buffer.from(` ${bytes.toString("utf8")}`, "utf8"),
    Buffer.from(
      `{"schema":"${G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA}","schema":"${G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA}"}\n`,
      "utf8",
    ),
  ];

  for (const value of rejected) {
    assert.throws(
      () =>
        verifyG17CargoExecveatHelperAttestationArtifact({
          bytes: value,
          evidence,
        }),
      CONTRACT_ERROR,
    );
  }
});

test("compiled helper identity is held-file compatible without executing it", async () => {
  const evidence = await buildFixture();
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  const mode = BigInt(created.attestation.executable.identity.mode);

  assert.equal(created.attestation.executable.identity.links, "1");
  assert.equal((mode & 0o170000n) === 0o100000n, true);
  assert.equal((mode & 0o777n) === 0o500n, true);
  assert.equal(
    created.attestation.executable.identity.size,
    String(evidence.executableBytes.length),
  );

  const handle = await open(
    join(fixtureDirectory, "g17-cargo-execveat-helper"),
    "r",
  );
  try {
    const held = metadataIdentity(await handle.stat({ bigint: true }));
    assert.deepEqual(held, evidence.executableIdentity);
  } finally {
    await handle.close();
  }
});
