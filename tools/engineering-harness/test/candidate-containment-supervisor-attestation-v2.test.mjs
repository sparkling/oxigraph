import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { COMMANDS } from "../src/command-registry.mjs";
import {
  CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_ARTIFACT_NAME_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_PROJECTION_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_STATUS_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILE_ARGV_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_ENVIRONMENT_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_VERSION_ARGV_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_BYTES_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_LOGICAL_NAME_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_SHA256_V2,
  createCandidateContainmentSupervisorAttestationV2,
  verifyCandidateContainmentSupervisorAttestationV2,
} from "../src/candidate/containment-supervisor-attestation-v2.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
} from "../src/candidate/containment-protocol-v2.mjs";
import {
  isTrustedSandboxSessionV2Report,
  sandboxSessionV2ContainmentReadiness,
} from "../src/candidate/sandbox-session-v2.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { engineeringTaskRegistry } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment supervisor attestation/u;
const sourceUrl = new URL(
  "../src/candidate/containment-supervisor-v2.c",
  import.meta.url,
);
const targetHost = process.platform === "linux" && process.arch === "x64";
const compileTest = targetHost ? test : test.skip;
const temporaryDirectories = [];
let fixturePromise;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
  return spawnSync(CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2, args, {
    cwd,
    env: CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_ENVIRONMENT_V2,
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
}

async function compileOnce() {
  const directory = await mkdtemp(
    join(tmpdir(), "oxigraph-containment-supervisor-attestation-"),
  );
  temporaryDirectories.push(directory);
  const sourcePath = join(
    directory,
    CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_LOGICAL_NAME_V2,
  );
  const executablePath = join(directory, "candidate-containment-supervisor-v1");
  await copyFile(sourceUrl, sourcePath);
  const compile = runCompiler(
    CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILE_ARGV_V2.slice(1),
    directory,
  );
  assert.equal(compile.error, undefined);
  assert.equal(compile.status, 0);
  assert.equal(compile.signal, null);
  assert.equal(compile.stdout.length, 0);
  assert.equal(compile.stderr.length, 0);
  await chmod(executablePath, 0o400);
  const [executableBytes, executableStatus] = await Promise.all([
    readFile(executablePath),
    stat(executablePath, { bigint: true }),
  ]);
  return {
    compile,
    executableBytes,
    executableIdentity: metadataIdentity(executableStatus),
  };
}

async function fixture() {
  if (fixturePromise !== undefined) return fixturePromise;
  fixturePromise = (async () => {
    const versionDirectory = await mkdtemp(
      join(tmpdir(), "oxigraph-containment-supervisor-compiler-"),
    );
    temporaryDirectories.push(versionDirectory);
    const version = runCompiler(
      CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_VERSION_ARGV_V2.slice(1),
      versionDirectory,
    );
    assert.equal(version.error, undefined);
    assert.equal(version.status, 0);
    assert.equal(version.signal, null);
    assert.ok(version.stdout.length > 0);
    const [first, second, sourceBytes, compilerBytes, compilerStatus] =
      await Promise.all([
        compileOnce(),
        compileOnce(),
        readFile(sourceUrl),
        readFile(CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2),
        stat(CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2, {
          bigint: true,
        }),
      ]);
    return {
      sourceBytes,
      compilerBytes,
      compilerIdentity: metadataIdentity(compilerStatus),
      compilerVersionBytes: version.stdout,
      compilerVersionStderrBytes: version.stderr,
      compilerVersionExitCode: version.status,
      compilerVersionSignal: version.signal,
      compileStdoutBytes: first.compile.stdout,
      compileStderrBytes: first.compile.stderr,
      compileExitCode: first.compile.status,
      compileSignal: first.compile.signal,
      executableBytes: first.executableBytes,
      secondExecutableBytes: second.executableBytes,
      executableIdentity: first.executableIdentity,
    };
  })();
  return fixturePromise;
}

test.after(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { force: true, recursive: true });
  }
});

function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
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

test("reviewed dormant supervisor source and freestanding compile recipe are exact", async () => {
  const sourceBytes = await readFile(sourceUrl);
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_LOGICAL_NAME_V2,
    "containment-supervisor-v2.c",
  );
  assert.equal(
    sourceBytes.length,
    CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_BYTES_V2,
  );
  assert.equal(
    sha256(sourceBytes),
    CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_SHA256_V2,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_PATH_V2,
    "/usr/bin/x86_64-linux-gnu-gcc-13",
  );
  assert.deepEqual(CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILE_ARGV_V2, [
    "/usr/bin/x86_64-linux-gnu-gcc-13",
    "-std=c17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-ffreestanding",
    "-fno-builtin",
    "-fno-pie",
    "-no-pie",
    "-fno-stack-protector",
    "-fno-asynchronous-unwind-tables",
    "-fno-unwind-tables",
    "-fno-ident",
    "-nostdlib",
    "-nostartfiles",
    "-nodefaultlibs",
    "-static",
    "-Wl,--build-id=none",
    "-Wl,--fatal-warnings",
    "-Wl,-z,noexecstack,-z,separate-code",
    "-Wl,-e,oxigraph_supervisor_dormant_entry",
    "containment-supervisor-v2.c",
    "-o",
    "candidate-containment-supervisor-v1",
  ]);
  assert.deepEqual(CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_VERSION_ARGV_V2, [
    "/usr/bin/x86_64-linux-gnu-gcc-13",
    "--version",
  ]);
  assert.deepEqual(
    { ...CANDIDATE_CONTAINMENT_SUPERVISOR_COMPILER_ENVIRONMENT_V2 },
    {
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
      SOURCE_DATE_EPOCH: "0",
    },
  );
});

test("dormant source embeds one exact self-description and only a fail-closed entry", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /oxigraph_supervisor_dormant_entry/u);
  assert.match(source, /exit_status __asm__\("rdi"\) = 125L/u);
  assert.match(source, /syscall_number __asm__\("rax"\) = 231L/u);
  assert.doesNotMatch(
    source,
    /\b(?:SYS_clone3|__NR_clone3|waitid|execveat|fork|vfork|posix_spawn)\s*\(/u,
  );
  assert.doesNotMatch(source, /\b(?:mount|umount|kill)\s*\(/u);
  assert.equal(
    source.includes(
      CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_JSONL_V2.replaceAll(
        "\\",
        "\\\\",
      )
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n"),
    ),
    true,
  );
});

compileTest(
  "exact recipe compiles twice to one deterministic static x86-64 ELF without execution",
  async () => {
    const evidence = await fixture();
    assert.deepEqual(evidence.executableBytes, evidence.secondExecutableBytes);
    assert.equal(evidence.executableIdentity.links, "1");
    assert.equal(BigInt(evidence.executableIdentity.mode) & 0o777n, 0o400n);

    const created = createCandidateContainmentSupervisorAttestationV2(evidence);
    const elf = created.attestation.executable.elf;
    assert.equal(elf.elfClass, 64);
    assert.equal(elf.elfData, "little");
    assert.equal(elf.elfType, "ET_EXEC");
    assert.equal(elf.elfMachine, 62);
    assert.equal(elf.interpreter, null);
    assert.equal(elf.dynamicSegment, false);
    assert.equal(elf.loadSegments >= 1, true);
    assert.equal(elf.writeExecutableLoad, false);
    assert.equal(elf.gnuStackExecutable, false);
    assert.equal(elf.entryInExecutableLoad, true);
    assert.deepEqual(elf.needed, []);
    assert.deepEqual(elf.rpath, []);
    assert.deepEqual(elf.runpath, []);
    assert.equal(elf.soname, null);
    assert.equal(elf.selfDescriptionOccurrences, 1);
  },
);

compileTest(
  "pure attestation binds source, compiler, recipe, static ELF, protocols, and honest nonclaims",
  async () => {
    const evidence = await fixture();
    const created = createCandidateContainmentSupervisorAttestationV2(evidence);
    const { attestation, artifact } = created;

    assert.equal(
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_SCHEMA_V2,
      "oxigraph.candidate-containment-supervisor-attestation/v1",
    );
    assert.equal(
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_PROJECTION_SCHEMA_V2,
      "oxigraph.candidate-containment-supervisor-attestation-replay/v1",
    );
    assert.equal(
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_STATUS_V2,
      "DORMANT_STATIC_SUPERVISOR_ATTESTATION_ONLY",
    );
    assert.equal(
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_ARTIFACT_NAME_V2,
      "candidate-containment-supervisor-attestation-v1.json",
    );
    assert.equal(
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_MAX_BYTES_V2,
      4 * 1024 * 1024,
    );
    assert.equal(
      attestation.status,
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_STATUS_V2,
    );
    assert.equal(attestation.source.sha256, sha256(evidence.sourceBytes));
    assert.equal(
      attestation.compiler.executable.sha256,
      sha256(evidence.compilerBytes),
    );
    assert.equal(
      attestation.executable.sha256,
      sha256(evidence.executableBytes),
    );
    assert.equal(
      attestation.executable.suppliedRepeatedExecutableBytesEqual,
      true,
    );
    assert.deepEqual(
      { ...attestation.protocolBindings },
      {
        requestSchema: CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2,
        statusSchema: CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
        requirementsSha256:
          CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
        fileDescriptorMapSha256:
          CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
        selfDescriptionSha256:
          CANDIDATE_CONTAINMENT_SUPERVISOR_SELF_DESCRIPTION_SHA256_V2,
      },
    );
    assert.equal(attestation.implementation.requestParserImplemented, false);
    assert.equal(attestation.implementation.statusWriterImplemented, false);
    assert.equal(attestation.implementation.mechanicsImplemented, false);
    assert.equal(attestation.binding, null);
    assert.equal(attestation.physicalLaunchEligible, false);
    assert.equal(attestation.finalDecisionEligible, false);
    assert.equal(
      Object.values(attestation.authority).every((value) => value === false),
      true,
    );
    assert.equal(
      Object.values(attestation.nonclaims).every((value) => value === false),
      true,
    );
    assert.equal(
      artifact.name,
      CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_ARTIFACT_NAME_V2,
    );
    assert.equal(
      artifact.bytes.length <=
        CANDIDATE_CONTAINMENT_SUPERVISOR_ATTESTATION_MAX_BYTES_V2,
      true,
    );
    const canonicalArtifactBytes = artifact.bytes;
    assert.equal(artifact.sha256, sha256(canonicalArtifactBytes));
    const callerCopy = artifact.bytes;
    callerCopy.fill(0);
    assert.deepEqual(artifact.bytes, canonicalArtifactBytes);
    assert.equal(artifact.sha256, sha256(artifact.bytes));
    assertDeepFrozen(attestation);
    assertNullPrototypeRecords(attestation);
  },
);

compileTest(
  "independent replay reconstructs the exact artifact and stays binding-null",
  async () => {
    const evidence = await fixture();
    const created = createCandidateContainmentSupervisorAttestationV2(evidence);
    const projection = verifyCandidateContainmentSupervisorAttestationV2({
      artifactBytes: created.artifact.bytes,
      evidence,
    });

    assert.equal(
      projection.status,
      "DORMANT_STATIC_SUPERVISOR_ATTESTATION_REPLAYED",
    );
    assert.equal(projection.binding, null);
    assert.equal(projection.physicalLaunchEligible, false);
    assert.equal(projection.finalDecisionEligible, false);
    assert.equal(projection.artifactSha256, created.artifact.sha256);
    assert.equal(
      projection.sourceSha256,
      CANDIDATE_CONTAINMENT_SUPERVISOR_SOURCE_SHA256_V2,
    );
    assert.equal(projection.executableSha256, sha256(evidence.executableBytes));
    assert.equal(projection.suppliedRepeatedExecutableBytesEqual, true);
    assert.equal(
      projection.projectionSha256,
      canonicalSha256(
        Object.fromEntries(
          Object.entries(projection).filter(
            ([key]) => key !== "projectionSha256",
          ),
        ),
      ),
    );
    assert.equal(isTrustedSandboxSessionV2Report(projection), false);
    assertDeepFrozen(projection);
    assertNullPrototypeRecords(projection);
  },
);

compileTest(
  "attestation and replay reject source, compiler, build, executable, and canonical artifact drift",
  async () => {
    const evidence = await fixture();
    const created = createCandidateContainmentSupervisorAttestationV2(evidence);
    const evidenceMutations = [
      {
        ...evidence,
        sourceBytes: Buffer.concat([evidence.sourceBytes, Buffer.from("\n")]),
      },
      {
        ...evidence,
        compilerBytes: Buffer.concat([
          evidence.compilerBytes,
          Buffer.from([0]),
        ]),
      },
      { ...evidence, compilerVersionExitCode: 1 },
      { ...evidence, compilerVersionSignal: "SIGKILL" },
      { ...evidence, compileStderrBytes: Buffer.from("warning", "utf8") },
      { ...evidence, compileExitCode: 1 },
      { ...evidence, compileSignal: "SIGKILL" },
      {
        ...evidence,
        executableBytes: Buffer.from(evidence.executableBytes).fill(0, 0, 4),
      },
      {
        ...evidence,
        secondExecutableBytes: Buffer.concat([
          evidence.secondExecutableBytes,
          Buffer.from([0]),
        ]),
      },
      {
        ...evidence,
        executableIdentity: { ...evidence.executableIdentity, links: "2" },
      },
      {
        ...evidence,
        executableIdentity: {
          ...evidence.executableIdentity,
          mode: String(0o100500),
        },
      },
    ];
    for (const mutation of evidenceMutations) {
      assert.throws(
        () => createCandidateContainmentSupervisorAttestationV2(mutation),
        CONTRACT_ERROR,
      );
    }

    const artifacts = [
      Buffer.alloc(0),
      created.artifact.bytes.subarray(0, created.artifact.bytes.length - 1),
      Buffer.concat([created.artifact.bytes, Buffer.from("\0")]),
      mutatedArtifact(created, (value) => {
        value.binding = "verified";
      }),
      mutatedArtifact(created, (value) => {
        value.implementation.mechanicsImplemented = true;
      }),
      mutatedArtifact(created, (value) => {
        value.protocolBindings.fileDescriptorMapSha256 = "f".repeat(64);
      }),
      mutatedArtifact(created, (value) => {
        value.executable.elf.interpreter = "/lib64/ld-linux-x86-64.so.2";
      }),
    ];
    for (const artifactBytes of artifacts) {
      assert.throws(
        () =>
          verifyCandidateContainmentSupervisorAttestationV2({
            artifactBytes,
            evidence,
          }),
        CONTRACT_ERROR,
      );
    }
  },
);

test("dormant attestation leaves production, registry, CLI, Node floor, and candidate boundaries unchanged", async () => {
  const [ownerSource, sandboxSource, attestationSource, packageJson] =
    await Promise.all([
      readFile(
        new URL("../src/candidate/containment-owner-v2.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/candidate/sandbox-session-v2.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/candidate/containment-supervisor-attestation-v2.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);
  assert.deepEqual(candidateContainmentOwnerV2Readiness(), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.strictEqual(
    sandboxSessionV2ContainmentReadiness(),
    candidateContainmentOwnerV2Readiness(),
  );
  assert.equal(engineeringTaskRegistry.length, 9);
  assert.equal(COMMANDS.length, 33);
  assert.equal(JSON.parse(packageJson).engines.node, ">=20");
  assert.doesNotMatch(ownerSource, /containment-supervisor/u);
  assert.doesNotMatch(sandboxSource, /containment-supervisor/u);
  assert.doesNotMatch(
    attestationSource,
    /src\/qualification|\.\.\/qualification|g1\.7|G17/u,
  );
});
