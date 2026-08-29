import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as attestation from "../src/candidate/containment-supervisor-preflight-attestation-v4.mjs";
import * as preflight from "../src/candidate/containment-supervisor-preflight-v4.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR =
  /candidate containment supervisor preflight attestation v4/u;
const sourceUrl = new URL(
  "../src/candidate/containment-supervisor-preflight-v4.c",
  import.meta.url,
);
const predecessorSourceUrl = new URL(
  "../src/candidate/containment-supervisor-v2.c",
  import.meta.url,
);
const targetHost = process.platform === "linux" && process.arch === "x64";
const compileTest = targetHost ? test : test.skip;
const temporaryDirectories = [];
let fixturePromise;

const exactAttestationAuthorityKeys = [
  "applicationReceiptAuthority",
  "applicationResultAuthority",
  "compileAuthority",
  "containmentExecutionAuthority",
  "descriptorAuthority",
  "filesystemDurabilityAuthority",
  "finalDecisionAuthority",
  "guardianAuthority",
  "helperIdentityAuthority",
  "nativeObservationAuthority",
  "productionContainment",
  "promotionAuthority",
  "publicationAuthority",
  "qualificationAuthority",
  "reapAuthority",
  "runtimeRegistrationAuthority",
  "sandboxReportAuthority",
  "sourceToBinaryCausalityAuthority",
  "supervisorAuthority",
  "supervisorExecutionAuthority",
].sort();

const exactAttestationNonclaimKeys = [
  "assemblerAndLinkerClosure",
  "attestationBindsExecutableToLiveProcess",
  "attestationBindsExecutableToStartIdentity",
  "attestationProvesCompilerInvocation",
  "attestationProvesDescriptorInheritance",
  "attestationProvesJournalDurability",
  "attestationProvesNativeExecution",
  "attestationProvesPhysicalContainment",
  "attestationProvesSourceToBinaryCausality",
  "compilerDriverClosesToolchain",
  "embeddedDescriptionProvesRuntimeEnforcement",
  "historicalBootstrapRequirementAuthorizesV3Ready",
  "historicalBootstrapRequirementReinterpretsV3Ready",
  "serializedReplayProvesCapsuleProjectionValidation",
  "serializedReplayProvesCgroupConfiguration",
  "serializedReplayProvesCgroupFilesystem",
  "serializedReplayProvesCleanup",
  "serializedReplayProvesDecisionDurability",
  "serializedReplayProvesDelegatedRootIdentity",
  "serializedReplayProvesDirectChildReap",
  "serializedReplayProvesExecutedSupervisorFdBinding",
  "serializedReplayProvesFrameOrigin",
  "serializedReplayProvesFreshness",
  "serializedReplayProvesGlobalSoleWriterOwnership",
  "serializedReplayProvesGuardianLauncherWriterClosure",
  "serializedReplayProvesInheritedDescriptorExactness",
  "serializedReplayProvesNativeSupervisorExecution",
  "serializedReplayProvesPhysicalContainment",
  "serializedReplayProvesRetainedFileContentIdentity",
  "serializedReplayProvesSemanticCapsuleValidation",
  "sourceReviewProvesRuntimeSyscallClosure",
  "staticElfInspectionProvesRuntimeSyscallClosure",
  "suppliedObservationProvesNativeOrigin",
  "suppliedOutputEqualityProvesCrossHostReproducibility",
].sort();

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
  return spawnSync(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
    args,
    {
      cwd,
      env: attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_ENVIRONMENT_V4,
      encoding: "buffer",
      maxBuffer: 1024 * 1024,
      shell: false,
      timeout: 120_000,
      windowsHide: true,
    },
  );
}

async function compileOnce() {
  const directory = await mkdtemp(
    join(tmpdir(), "oxigraph-preflight-supervisor-attestation-"),
  );
  temporaryDirectories.push(directory);
  const sourcePath = join(
    directory,
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_LOGICAL_NAME_V4,
  );
  const executablePath = join(
    directory,
    "candidate-containment-supervisor-preflight-v1",
  );
  await copyFile(sourceUrl, sourcePath);
  const compile = runCompiler(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILE_ARGV_V4.slice(
      1,
    ),
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
      join(tmpdir(), "oxigraph-preflight-supervisor-compiler-"),
    );
    temporaryDirectories.push(versionDirectory);
    const version = runCompiler(
      attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_VERSION_ARGV_V4.slice(
        1,
      ),
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
        readFile(
          attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
        ),
        stat(
          attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
          { bigint: true },
        ),
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

function reseal(value) {
  const { contentHash: _oldContentHash, ...unsigned } = value;
  value.contentHash = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
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

test("reviewed preflight source, compiler recipe, self-description, and syscall boundary are exact", async () => {
  const [sourceBytes, predecessorBytes] = await Promise.all([
    readFile(sourceUrl),
    readFile(predecessorSourceUrl),
  ]);
  const source = sourceBytes.toString("utf8");
  assert.equal(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_LOGICAL_NAME_V4,
    "containment-supervisor-preflight-v4.c",
  );
  assert.equal(
    sourceBytes.length,
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_BYTES_V4,
  );
  assert.equal(
    sha256(sourceBytes),
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_SHA256_V4,
  );
  assert.equal(
    sha256(predecessorBytes),
    "756b6d730e78d72b9ce5c984f89ef6b9431f0376501f0c8e872c1f2601277e57",
  );
  assert.notEqual(sha256(sourceBytes), sha256(predecessorBytes));
  assert.equal(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
    "/usr/bin/x86_64-linux-gnu-gcc-13",
  );
  assert.deepEqual(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILE_ARGV_V4,
    [
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
      "-Wl,-e,oxigraph_supervisor_preflight_entry",
      "containment-supervisor-preflight-v4.c",
      "-o",
      "candidate-containment-supervisor-preflight-v1",
    ],
  );
  assert.deepEqual(
    {
      ...attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_ENVIRONMENT_V4,
    },
    {
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
      SOURCE_DATE_EPOCH: "0",
    },
  );
  assert.equal(
    source.includes(
      attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4.replaceAll(
        "\\",
        "\\\\",
      )
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n"),
    ),
    true,
  );
  const selfDescriptionBytes = Buffer.from(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4,
    "utf8",
  );
  assert.equal(selfDescriptionBytes.length, 1_799);
  assert.equal(
    sha256(selfDescriptionBytes),
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_SHA256_V4,
  );
  const selfDescriptionValue = JSON.parse(
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4.slice(
      0,
      -1,
    ),
  );
  assert.equal(
    `${canonicalJson(selfDescriptionValue)}\n`,
    attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_JSONL_V4,
  );
  assert.deepEqual(selfDescriptionValue, {
    allowedSyscalls: [
      "read",
      "write",
      "close",
      "fstat",
      "fcntl",
      "rt_sigaction",
      "close_range",
      "exit_group",
    ],
    artifact: "candidate-containment-supervisor-preflight-v1",
    authority: plainJson(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
    ),
    binding: null,
    cancelOnlyTerminalWriterImplemented: true,
    candidateExecutionImplemented: false,
    canonicalCapsuleEnvelopeParserImplemented: true,
    canonicalStartParserImplemented: true,
    cgroupMechanicsImplemented: false,
    cloneImplemented: false,
    commandEofRequiredAfterCancel: true,
    diagnosticSinkValidatedBeforeFailureWrite: true,
    descriptorPreflightImplemented: true,
    descriptorThreeSemantics: "opaque-read-only-directory-only",
    descriptorsClosedBeforeReadyFrom: 18,
    entry: "oxigraph_supervisor_preflight_entry",
    entryStackAlignmentImplemented: true,
    failureDiagnosticBase64: "UFJFRkxJR0hUX0ZBSUwhCg==",
    failureDiagnosticBytes: 16,
    opathDescriptorsRejected: true,
    physicalLaunchEligible: false,
    requirementsSha256:
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
    schema:
      "oxigraph.candidate-containment-supervisor-preflight-self-description/v1",
    sha256Implemented: true,
    statusEofRequiredAfterFinalStatus: true,
    strictBase64DecoderImplemented: true,
    supervisorDescriptorRangeEnd: 17,
    supervisorDescriptorRangeStart: 0,
    target: "linux-x86_64-freestanding-static",
    trailingCommandBytesPermitted: false,
  });
  assert.match(source, /oxigraph_supervisor_preflight_entry/u);
  assert.match(source, /andq \$-16,%rsp/u);
  assert.match(source, /call oxigraph_supervisor_preflight_main/u);
  assert.match(source, /__attribute__\(\(noreturn, used, noinline/u);
  for (const syscall of [
    "read",
    "write",
    "close",
    "fstat",
    "fcntl",
    "rt_sigaction",
    "close_range",
    "exit_group",
  ]) {
    assert.match(source, new RegExp(`OX_SYS_${syscall}\\b`, "u"), syscall);
  }
  assert.doesNotMatch(
    source,
    /\b(?:clone3?|fork|vfork|execve|execveat|pidfd_open|pidfd_send_signal|waitid|kill|tgkill|open|openat|openat2|mount|umount2|socket|connect)\s*\(/u,
  );
  assert.equal([...source.matchAll(/\box_read_fd\(/gu)].length, 3);
  assert.equal([...source.matchAll(/\box_write_fd\(/gu)].length, 3);
  assert.equal([...source.matchAll(/\box_fcntl_fd\(/gu)].length, 5);
  assert.match(source, /ox_read_fd\(0,/u);
  assert.match(source, /ox_write_fd\(1,/u);
  assert.match(source, /ox_write_fd\(\s*2,/u);
  assert.match(source, /\(flags & OX_O_PATH\) != 0L/u);
  assert.match(source, /ox_failure_diagnostic_sink_safe\(\)/u);
  assert.match(source, /ox_call3\(OX_SYS_close_range, 18L, 0xffffffffL, 0L\)/u);
  assert.doesNotMatch(source, /OX_F_DUPFD|OX_F_DUPFD_CLOEXEC/u);
  assert.doesNotMatch(source, /OPENROUTER|G1\.7|g1\.7/u);
});

compileTest(
  "exact recipe compiles twice to one deterministic static x86-64 ELF without execution",
  async () => {
    const evidence = await fixture();
    assert.deepEqual(evidence.executableBytes, evidence.secondExecutableBytes);
    assert.equal(evidence.executableIdentity.links, "1");
    assert.equal(BigInt(evidence.executableIdentity.mode) & 0o777n, 0o400n);
    const created =
      attestation.createCandidateContainmentSupervisorPreflightAttestationV4(
        evidence,
      );
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
    assert.equal(elf.entryStackAlignmentShim, true);
    assert.equal(elf.entryCallTargetInExecutableLoad, true);
    assert.deepEqual(elf.needed, []);
    assert.equal(elf.selfDescriptionOccurrences, 1);
    assert.equal(elf.selfDescriptionReadOnlyLoadOccurrences, 1);
  },
);

compileTest(
  "pure attestation binds source, compiler, executable, protocol, syscall surface, and honest nonclaims",
  async () => {
    const evidence = await fixture();
    const created =
      attestation.createCandidateContainmentSupervisorPreflightAttestationV4(
        evidence,
      );
    const { attestation: value, artifact } = created;
    assert.equal(
      value.schema,
      "oxigraph.candidate-containment-supervisor-preflight-attestation/v1",
    );
    assert.equal(value.status, "STATIC_PREFLIGHT_SUPERVISOR_ATTESTATION_ONLY");
    assert.equal(value.source.sha256, sha256(evidence.sourceBytes));
    assert.equal(
      value.compiler.executable.sha256,
      sha256(evidence.compilerBytes),
    );
    assert.equal(value.executable.sha256, sha256(evidence.executableBytes));
    assert.equal(value.executable.suppliedRepeatedExecutableBytesEqual, true);
    assert.deepEqual(
      { ...value.protocolBindings },
      {
        startSchema:
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4,
        capsuleSchema:
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4,
        controlSchema:
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4,
        statusSchema:
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4,
        cancelDecisionSchema:
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CANCEL_DECISION_SCHEMA_V4,
        requirementsSha256:
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
        selfDescriptionSha256:
          attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SELF_DESCRIPTION_SHA256_V4,
      },
    );
    assert.deepEqual(value.syscallSurface.allowed, [
      "read",
      "write",
      "close",
      "fstat",
      "fcntl",
      "rt_sigaction",
      "close_range",
      "exit_group",
    ]);
    assert.equal(value.syscallSurface.candidateExecutionPermitted, false);
    assert.equal(value.implementation.canonicalStartParserImplemented, true);
    assert.equal(
      value.implementation.canonicalCapsuleEnvelopeParserImplemented,
      true,
    );
    assert.equal(value.implementation.strictBase64DecoderImplemented, true);
    assert.equal(value.implementation.sha256Implemented, true);
    assert.equal(value.implementation.descriptorPreflightImplemented, true);
    assert.equal(
      value.implementation.cancelOnlyTerminalWriterImplemented,
      true,
    );
    assert.equal(value.implementation.entryStackAlignmentImplemented, true);
    assert.equal(value.implementation.candidateExecutionImplemented, false);
    assert.equal(value.implementation.cloneImplemented, false);
    assert.equal(value.implementation.cgroupMechanicsImplemented, false);
    assert.equal(value.implementation.artifactExecuted, false);
    assert.equal(value.binding, null);
    assert.equal(value.physicalLaunchEligible, false);
    assert.equal(value.finalDecisionEligible, false);
    assert.deepEqual(
      Object.keys(value.authority).sort(),
      exactAttestationAuthorityKeys,
    );
    assert.deepEqual(
      Object.keys(value.nonclaims).sort(),
      exactAttestationNonclaimKeys,
    );
    assert.equal(
      Object.values(value.authority).every((item) => item === false),
      true,
    );
    assert.equal(
      Object.values(value.nonclaims).every((item) => item === false),
      true,
    );
    assert.deepEqual(
      value.authority,
      attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_AUTHORITY_V4,
    );
    assert.deepEqual(
      value.nonclaims,
      attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_ATTESTATION_NONCLAIMS_V4,
    );
    assert.equal(
      artifact.name,
      "candidate-containment-supervisor-preflight-attestation-v1.json",
    );
    const retained = artifact.bytes;
    const mutated = artifact.bytes;
    mutated.fill(0);
    assert.deepEqual(artifact.bytes, retained);
    assert.equal(artifact.sha256, sha256(retained));
    assertDeepFrozen(value);
  },
);

compileTest(
  "independent replay reconstructs the exact attestation and rejects evidence or artifact drift",
  async () => {
    const evidence = await fixture();
    const created =
      attestation.createCandidateContainmentSupervisorPreflightAttestationV4(
        evidence,
      );
    const projection =
      attestation.verifyCandidateContainmentSupervisorPreflightAttestationV4({
        artifactBytes: created.artifact.bytes,
        evidence,
      });
    assert.equal(
      projection.status,
      "STATIC_PREFLIGHT_SUPERVISOR_ATTESTATION_REPLAYED",
    );
    assert.equal(projection.artifactSha256, created.artifact.sha256);
    assert.equal(projection.sourceSha256, sha256(evidence.sourceBytes));
    assert.equal(projection.executableSha256, sha256(evidence.executableBytes));
    assert.equal(projection.binding, null);
    assert.equal(projection.physicalLaunchEligible, false);
    assert.equal(projection.finalDecisionEligible, false);
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
    assertDeepFrozen(projection);

    const evidenceMutations = [
      {
        ...evidence,
        sourceBytes: Buffer.concat([evidence.sourceBytes, Buffer.from("\n")]),
      },
      { ...evidence, compilerVersionExitCode: 1 },
      { ...evidence, compileStderrBytes: Buffer.from("warning", "utf8") },
      { ...evidence, compileExitCode: 1 },
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
    ];
    for (const mutation of evidenceMutations) {
      assert.throws(
        () =>
          attestation.createCandidateContainmentSupervisorPreflightAttestationV4(
            mutation,
          ),
        CONTRACT_ERROR,
      );
    }
    for (const artifactBytes of [
      Buffer.alloc(0),
      created.artifact.bytes.subarray(0, created.artifact.bytes.length - 1),
      Buffer.concat([created.artifact.bytes, Buffer.from("\0")]),
      mutatedArtifact(created, (value) => {
        value.binding = "verified";
      }),
      mutatedArtifact(created, (value) => {
        value.implementation.candidateExecutionImplemented = true;
      }),
      mutatedArtifact(created, (value) => {
        value.syscallSurface.allowed.push("clone3");
      }),
    ]) {
      assert.throws(
        () =>
          attestation.verifyCandidateContainmentSupervisorPreflightAttestationV4(
            { artifactBytes, evidence },
          ),
        CONTRACT_ERROR,
      );
    }
  },
);

test("attestation leaves predecessor bytes, readiness, registries, and G1.7 untouched", async () => {
  assert.deepEqual(candidateContainmentOwnerV2Readiness(), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.strictEqual(
    sandboxSessionV2ContainmentReadiness(),
    candidateContainmentOwnerV2Readiness(),
  );
  assert.equal(engineeringTaskIds.length, 9);
  assert.equal(commandIds().length, 33);
  assert.equal(
    commandIds().some((id) => id.includes("g2.2")),
    false,
  );
  assert.equal(
    sha256(await readFile(predecessorSourceUrl)),
    "756b6d730e78d72b9ce5c984f89ef6b9431f0376501f0c8e872c1f2601277e57",
  );
  const moduleSource = await readFile(
    new URL(
      "../src/candidate/containment-supervisor-preflight-attestation-v4.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    moduleSource,
    /src\/qualification|\.\.\/qualification|g1\.7|G17/u,
  );
});
