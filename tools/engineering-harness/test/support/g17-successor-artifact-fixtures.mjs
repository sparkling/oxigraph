import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { G17_BENCHMARK_BUILD_PLAN } from "../../src/qualification/benchmark-execution-plan.mjs";
import { createG17BenchmarkExecutionRequestV2Artifact } from "../../src/qualification/benchmark-execution-request-v2-contract.mjs";
import {
  G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV,
  G17_CARGO_EXECVEAT_HELPER_COMPILER_PATH,
  G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV,
  G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
  createG17CargoExecveatHelperAttestationArtifact,
} from "../../src/qualification/cargo-execveat-helper-attestation-contract.mjs";

const helperSourceUrl = new URL(
  "../../src/qualification/cargo-execveat-helper.c",
  import.meta.url,
);
const compilerEnvironment = Object.freeze({
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
  SOURCE_DATE_EPOCH: "0",
});

let helperFixturePromise;
let helperFixtureDirectory;

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

async function buildHelperFixture() {
  if (helperFixturePromise !== undefined) return helperFixturePromise;
  helperFixturePromise = (async () => {
    helperFixtureDirectory = await mkdtemp(
      join(tmpdir(), "oxigraph-g17-containment-v2-helper-"),
    );
    const sourcePath = join(
      helperFixtureDirectory,
      G17_CARGO_EXECVEAT_HELPER_SOURCE_LOGICAL_NAME,
    );
    const executablePath = join(
      helperFixtureDirectory,
      "g17-cargo-execveat-helper",
    );
    await copyFile(helperSourceUrl, sourcePath);

    const version = runCompiler(
      G17_CARGO_EXECVEAT_HELPER_COMPILER_VERSION_ARGV.slice(1),
      helperFixtureDirectory,
    );
    assert.equal(version.error, undefined);
    assert.equal(version.status, 0);
    assert.equal(version.signal, null);
    assert.ok(version.stdout.length > 0);

    const compile = runCompiler(
      G17_CARGO_EXECVEAT_HELPER_COMPILE_ARGV.slice(1),
      helperFixtureDirectory,
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
  return helperFixturePromise;
}

function cloneHelperEvidence(value) {
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (Buffer.isBuffer(child)) output[key] = Buffer.from(child);
    else if (child !== null && typeof child === "object") {
      output[key] = { ...child };
    } else output[key] = child;
  }
  return output;
}

export function createG17RequestV2FixtureInput(buildIndex = 0) {
  const build = G17_BENCHMARK_BUILD_PLAN[buildIndex];
  return {
    controlRunId: "execution-request-v2-fixture",
    buildId: build.buildId,
    productRole: build.productRole,
    authorization: {
      schema: "oxigraph.g1.7-control-authorization/v3",
      rawSha256: "1".repeat(64),
      contentHash: "2".repeat(64),
    },
    source: {
      rawSha256: "3".repeat(64),
      contentHash: "4".repeat(64),
      controlRunId: "execution-request-v2-fixture",
      buildId: build.buildId,
      productRole: build.productRole,
      workspaceGeneration: `g17-workspace-${"5".repeat(64)}`,
      targetGeneration: `g17-target-${"6".repeat(64)}`,
    },
    platform: {
      platformRootSha256: "7".repeat(64),
      toolchainRootSha256: "8".repeat(64),
      cargo: {
        logicalPath: "/toolchain/bin/cargo",
        sha256: "9".repeat(64),
        identity: {
          device: "101",
          inode: "201",
          uid: "1000",
          gid: "1000",
          mode: 0o100555,
          nlink: 1,
          size: 1_000_001,
        },
      },
      rustc: {
        logicalPath: "/toolchain/bin/rustc",
        sha256: "a".repeat(64),
        identity: {
          device: "101",
          inode: "202",
          uid: "1000",
          gid: "1000",
          mode: 0o100555,
          nlink: 1,
          size: 2_000_002,
        },
      },
    },
    ownership: {
      ownerGeneration: `g17-owner-${"b".repeat(64)}`,
      processGeneration: `g17-process-${String(buildIndex + 1).padStart(64, "0")}`,
      ordinal: buildIndex + 1,
    },
  };
}

export function createG17RequestV2Verification({
  buildIndex = 0,
  mutateExpected = undefined,
} = {}) {
  const expected = createG17RequestV2FixtureInput(buildIndex);
  if (mutateExpected !== undefined) mutateExpected(expected);
  const created = createG17BenchmarkExecutionRequestV2Artifact(expected);
  return {
    created,
    verification: {
      bytes: created.artifact.bytes,
      expected,
    },
  };
}

export async function createG17HelperAttestationVerification({
  mutateEvidence = undefined,
} = {}) {
  const evidence = cloneHelperEvidence(await buildHelperFixture());
  if (mutateEvidence !== undefined) mutateEvidence(evidence);
  const created = createG17CargoExecveatHelperAttestationArtifact(evidence);
  return {
    created,
    evidence,
    verification: {
      bytes: created.artifact.bytes,
      evidence,
    },
  };
}

export async function cleanupG17SuccessorArtifactFixtures() {
  if (helperFixtureDirectory !== undefined) {
    await rm(helperFixtureDirectory, { force: true, recursive: true });
  }
  helperFixtureDirectory = undefined;
  helperFixturePromise = undefined;
}
