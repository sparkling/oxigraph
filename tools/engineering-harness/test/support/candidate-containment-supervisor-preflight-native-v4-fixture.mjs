import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  createCandidateContainmentLaunchArgvV2,
  createCandidateContainmentLaunchEnvironmentV2,
} from "../../src/candidate/containment-launch-capsule-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  createCandidateContainmentLaunchCapsuleV3,
} from "../../src/candidate/containment-launch-capsule-v3.mjs";
import * as journal from "../../src/candidate/containment-guardian-journal-v1.mjs";
import * as attestation from "../../src/candidate/containment-supervisor-preflight-attestation-v4.mjs";
import * as bootstrap from "../../src/candidate/containment-supervisor-bootstrap-v3.mjs";
import * as preflight from "../../src/candidate/containment-supervisor-preflight-v4.mjs";
import { candidateContainmentOwnerV2Readiness } from "../../src/candidate/containment-owner-v2.mjs";
import { commandIds } from "../../src/command-registry.mjs";
import { canonicalJson, canonicalSha256 } from "../../src/routing/features.mjs";
import { engineeringTaskIds } from "../../src/task-profile.mjs";

const sourceUrl = new URL(
  "../../src/candidate/containment-supervisor-preflight-v4.c",
  import.meta.url,
);
const executableName = "candidate-containment-supervisor-preflight-v1";
const emptySha256 = sha256(Buffer.alloc(0));
const descriptorCloseOnExec = 0o2000000n;
let compiledExecutablePromise;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function executableIdentity(metadata, bytesSha256) {
  return {
    schema:
      "oxigraph.test-only-containment-supervisor-native-executable-identity/v1",
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    links: metadata.nlink.toString(),
    size: metadata.size.toString(),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
    ownerUid: metadata.uid.toString(),
    ownerGid: metadata.gid.toString(),
    sha256: bytesSha256,
  };
}

function launchFileIdentity(metadata, spec, bytes) {
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    links: metadata.nlink.toString(),
    type: "regular",
    permissions: spec.permissions,
    owner: metadata.uid.toString(),
    group: metadata.gid.toString(),
    size: String(bytes.length),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
  };
}

async function compileExecutableBytes() {
  const directory = await mkdtemp(
    join(tmpdir(), "oxigraph-preflight-native-compile-"),
  );
  try {
    await copyFile(
      sourceUrl,
      join(
        directory,
        attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_LOGICAL_NAME_V4,
      ),
    );
    const compile = spawnSync(
      attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_PATH_V4,
      attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILE_ARGV_V4.slice(
        1,
      ),
      {
        cwd: directory,
        env: attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_COMPILER_ENVIRONMENT_V4,
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 120_000,
        windowsHide: true,
      },
    );
    if (
      compile.error !== undefined ||
      compile.status !== 0 ||
      compile.signal !== null ||
      compile.stdout.length !== 0 ||
      compile.stderr.length !== 0
    ) {
      throw new Error("native preflight fixture exact compile failed");
    }
    const executableBytes = await readFile(join(directory, executableName));
    if (executableBytes.length === 0) {
      throw new Error("native preflight fixture compiled an empty executable");
    }
    return executableBytes;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function compiledExecutableBytes() {
  compiledExecutablePromise ??= compileExecutableBytes();
  return compiledExecutablePromise;
}

function descriptorPayload(spec, argvBytes, environmentBytes, supervisorBytes) {
  if (spec.role === "childExecutable") {
    return Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
  }
  if (spec.role === "supervisorSelf") return Buffer.from(supervisorBytes);
  if (spec.role === "launchArgv") return argvBytes;
  if (spec.role === "launchEnvironment") return environmentBytes;
  if (spec.role === "childResult") return Buffer.alloc(0);
  return Buffer.from(`${spec.role}:native-preflight-v4\n`, "utf8");
}

async function createRetainedFiles(directory, supervisorBytes) {
  const argv = createCandidateContainmentLaunchArgvV2({
    argv: ["/usr/bin/bwrap", "--clearenv", "--", "/usr/bin/node"],
  });
  const environment = createCandidateContainmentLaunchEnvironmentV2({
    environment: { LANG: "C.UTF-8", PATH: "/usr/bin:/bin" },
  });
  const retained = [];
  for (const spec of CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2) {
    const claimedBytes = descriptorPayload(
      spec,
      argv.bytes,
      environment.bytes,
      supervisorBytes,
    );
    const physicalBytes = Buffer.from(claimedBytes);
    if (spec.supervisorFd >= 4 && spec.supervisorFd <= 16) {
      physicalBytes[0] ^= 0xff;
    }
    const path = join(directory, `retained-fd-${spec.supervisorFd}`);
    await writeFile(path, physicalBytes, {
      mode: Number.parseInt(spec.permissions, 8),
    });
    await chmod(path, Number.parseInt(spec.permissions, 8));
    const metadata = await stat(path, { bigint: true });
    retained.push({
      spec,
      path,
      claimedBytes,
      physicalBytes,
      capsuleFile: {
        role: spec.role,
        supervisorFd: spec.supervisorFd,
        childFd: spec.childFd,
        destination: spec.destination,
        accessMode: spec.accessMode,
        permissions: spec.permissions,
        byteLength: claimedBytes.length,
        sha256: sha256(claimedBytes),
        initialOffset: 0,
        closeOnExec: true,
        contentBytes: claimedBytes,
        identity: launchFileIdentity(metadata, spec, claimedBytes),
      },
    });
  }
  return { argv, environment, retained };
}

function createDecisionJournalRecords(
  identity,
  decisionProjectionSha256,
  readyProjectionSha256,
) {
  let previousRecord = null;
  const records = [];
  for (const [
    index,
    state,
  ] of journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.entries()) {
    if (state === "CANCEL_WRITE_COMPLETED") break;
    previousRecord = journal.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity: identity,
      state,
      actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
      operationProjectionSha256:
        state === "DECISION_CANCEL_DURABLE"
          ? decisionProjectionSha256
          : digest(`native-preflight-operation:${index + 1}`),
      evidenceProjectionSha256:
        state === "PREFLIGHT_READY_OBSERVED" ||
        state === "DECISION_CANCEL_DURABLE"
          ? readyProjectionSha256
          : digest(`native-preflight-evidence:${index + 1}`),
      previousRecord,
    });
    records.push(previousRecord);
  }
  return records;
}

function createProtocol(retainedFiles, supervisorExecutableIdentitySha256) {
  const requestSha256 = digest("native-preflight-request");
  const admissionGenerationSha256 = digest(
    "native-preflight-admission-generation",
  );
  const capsuleArtifact = createCandidateContainmentLaunchCapsuleV3({
    requestSha256,
    generationSha256: admissionGenerationSha256,
    argvBytes: retainedFiles.argv.bytes,
    environmentBytes: retainedFiles.environment.bytes,
    files: retainedFiles.retained.map(({ capsuleFile }) => capsuleFile),
    resultMaximumBytes: 256 * 1024 * 1024,
  });
  const launchCapsuleBytes = capsuleArtifact.bytes;
  const identity =
    journal.createCandidateContainmentGuardianGenerationIdentityV1({
      requestSha256,
      ownerRequestSha256: digest("native-preflight-owner-request"),
      limitsSha256: digest("native-preflight-limits"),
      delegatedRootIdentitySha256: digest("native-preflight-delegated-root"),
      launchCapsuleRawSha256: sha256(launchCapsuleBytes),
      launchCapsuleProjectionSha256:
        preflight.candidateContainmentSupervisorPreflightLaunchCapsuleProjectionSha256V4(
          launchCapsuleBytes,
        ),
      bootstrapRequirementsSha256:
        bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3,
      launchRequirementsSha256:
        CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
      supervisorExecutableIdentitySha256,
      birthGuardianEpochSha256: digest("native-preflight-guardian-epoch"),
      bootIdSha256: digest("native-preflight-boot-id"),
      admissionGenerationSha256,
      launchNonceSha256: digest("native-preflight-launch-nonce"),
    });
  const supervisorLaunchIntentRecordRawSha256 = digest(
    "native-preflight-supervisor-launch-intent-record",
  );
  const startArtifact =
    preflight.createCandidateContainmentSupervisorPreflightStartV4({
      generationIdentity: identity,
      actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
      supervisorLaunchIntentRecordRawSha256,
      launchCapsuleBytes,
    });
  const capsuleFrameArtifact =
    preflight.createCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: startArtifact.bytes,
      launchCapsuleBytes,
    });
  const readyArtifact =
    preflight.createCandidateContainmentSupervisorPreflightReadyV4({
      startBytes: startArtifact.bytes,
      capsuleFrameBytes: capsuleFrameArtifact.bytes,
    });
  return {
    identity,
    supervisorLaunchIntentRecordRawSha256,
    launchCapsuleBytes,
    startBytes: startArtifact.bytes,
    capsuleFrameBytes: capsuleFrameArtifact.bytes,
    expectedReadyBytes: readyArtifact.bytes,
  };
}

function completeProtocol(protocol, readyBytes) {
  const ready = preflight.verifyCandidateContainmentSupervisorPreflightReadyV4({
    startBytes: protocol.startBytes,
    capsuleFrameBytes: protocol.capsuleFrameBytes,
    readyBytes,
  });
  const cancelDecision =
    preflight.createCandidateContainmentSupervisorPreflightCancelDecisionV4({
      startBytes: protocol.startBytes,
      capsuleFrameBytes: protocol.capsuleFrameBytes,
      readyBytes,
      reason: "caller-abort",
    });
  const decisionJournalRecords = createDecisionJournalRecords(
    protocol.identity,
    cancelDecision.projectionSha256,
    ready.projectionSha256,
  );
  const decisionJournalArtifact = decisionJournalRecords.at(-1);
  const decisionJournalRecord = {
    name: decisionJournalArtifact.name,
    bytes: decisionJournalArtifact.bytes,
  };
  const cancelArtifact =
    preflight.createCandidateContainmentSupervisorPreflightCancelV4({
      startBytes: protocol.startBytes,
      capsuleFrameBytes: protocol.capsuleFrameBytes,
      readyBytes,
      cancelDecision,
      decisionJournalRecord,
    });
  const cancelledArtifact =
    preflight.createCandidateContainmentSupervisorPreflightCancelledV4({
      startBytes: protocol.startBytes,
      capsuleFrameBytes: protocol.capsuleFrameBytes,
      readyBytes,
      cancelBytes: cancelArtifact.bytes,
      decisionJournalRecord,
    });
  const doneArtifact =
    preflight.createCandidateContainmentSupervisorPreflightDoneV4({
      startBytes: protocol.startBytes,
      capsuleFrameBytes: protocol.capsuleFrameBytes,
      readyBytes,
      cancelBytes: cancelArtifact.bytes,
      cancelledBytes: cancelledArtifact.bytes,
      decisionJournalRecord,
    });
  return {
    ready,
    cancelDecision,
    decisionJournalRecord,
    decisionJournalRecordRawSha256: decisionJournalArtifact.rawSha256,
    cancelBytes: cancelArtifact.bytes,
    cancelledBytes: cancelledArtifact.bytes,
    doneBytes: doneArtifact.bytes,
  };
}

class BoundedLineReader {
  constructor(
    stream,
    maximumLineBytes,
    maximumLines = 3,
    maximumTotalBytes = maximumLineBytes * maximumLines,
  ) {
    this.maximumLineBytes = maximumLineBytes;
    this.maximumLines = maximumLines;
    this.maximumTotalBytes = maximumTotalBytes;
    this.totalBytes = 0;
    this.lineCount = 0;
    this.buffer = Buffer.alloc(0);
    this.lines = [];
    this.waiter = null;
    this.ended = false;
    this.endCount = 0;
    this.error = null;
    this.endWaiters = [];
    stream.on("data", (chunk) => this.onData(Buffer.from(chunk)));
    stream.on("end", () => this.onEnd());
    stream.on("error", (error) => this.onError(error));
  }

  onData(chunk) {
    if (this.error !== null) return;
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maximumTotalBytes) {
      this.onError(new Error("native preflight status stream exceeded bound"));
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) break;
      const length = newline + 1;
      if (length > this.maximumLineBytes) {
        this.onError(new Error("native preflight status line exceeded bound"));
        return;
      }
      this.lineCount += 1;
      if (this.lineCount > this.maximumLines) {
        this.onError(new Error("native preflight status frame count exceeded"));
        return;
      }
      this.lines.push(this.buffer.subarray(0, length));
      this.buffer = this.buffer.subarray(length);
    }
    if (this.buffer.length > this.maximumLineBytes) {
      this.onError(new Error("native preflight status line exceeded bound"));
      return;
    }
    this.deliver();
  }

  onEnd() {
    this.endCount += 1;
    if (this.buffer.length !== 0) {
      this.onError(new Error("native preflight status ended mid-frame"));
      return;
    }
    this.ended = true;
    this.deliver();
    for (const resolve of this.endWaiters.splice(0)) resolve();
  }

  onError(error) {
    if (this.error !== null) return;
    this.error = error;
    this.deliver();
    for (const resolve of this.endWaiters.splice(0)) resolve();
  }

  deliver() {
    if (this.waiter === null) return;
    if (this.error !== null) {
      const { reject, timer } = this.waiter;
      this.waiter = null;
      clearTimeout(timer);
      reject(this.error);
      return;
    }
    if (this.lines.length > 0) {
      const { resolve, timer } = this.waiter;
      this.waiter = null;
      clearTimeout(timer);
      resolve(Buffer.from(this.lines.shift()));
      return;
    }
    if (this.ended) {
      const { resolve, timer } = this.waiter;
      this.waiter = null;
      clearTimeout(timer);
      resolve(null);
    }
  }

  nextLine(timeoutMs = 5_000) {
    if (this.waiter !== null) {
      throw new Error("native preflight line reads must be sequential");
    }
    if (this.error !== null) return Promise.reject(this.error);
    if (this.lines.length > 0)
      return Promise.resolve(Buffer.from(this.lines.shift()));
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.timer !== timer) return;
        this.waiter = null;
        reject(new Error("native preflight status read timed out"));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  waitForEnd(timeoutMs = 5_000) {
    if (this.error !== null) return Promise.reject(this.error);
    if (this.ended) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("native preflight status EOF timed out")),
        timeoutMs,
      );
      this.endWaiters.push(() => {
        clearTimeout(timer);
        if (this.error !== null) reject(this.error);
        else resolve();
      });
    });
  }
}

export async function captureCandidateContainmentSupervisorPreflightStatusForTestV4(
  chunks,
) {
  const stream = new PassThrough();
  const reader = new BoundedLineReader(
    stream,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
  );
  const frames = [];
  const capture = drainStatusLines(reader, frames);
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  try {
    await capture;
    return Buffer.concat(frames);
  } finally {
    await closeOwnedStreams([stream]);
  }
}

function collectBounded(stream, maximumBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on("data", (chunk) => {
      total += chunk.length;
      if (total > maximumBytes) {
        reject(new Error("native preflight diagnostics exceeded bound"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function processClose(child, timeoutMs = 15_000) {
  let timedOut = false;
  let cleanupTimedOut = false;
  let closed = false;
  let exitEventCount = 0;
  let closeEventCount = 0;
  child.on("exit", () => {
    exitEventCount += 1;
  });
  const completion = new Promise((resolve, reject) => {
    let settled = false;
    let cleanupTimer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(executionTimer);
      clearTimeout(cleanupTimer);
      callback(value);
    };
    const executionTimer = setTimeout(() => {
      if (closed) return;
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch (error) {
        finish(reject, error);
        return;
      }
      if (closed || settled) return;
      cleanupTimer = setTimeout(() => {
        if (closed) return;
        cleanupTimedOut = true;
        finish(
          reject,
          new Error("native preflight process cleanup timed out after SIGKILL"),
        );
      }, 5_000);
    }, timeoutMs);
    child.once("error", (error) => {
      finish(reject, error);
    });
    child.once("close", (exitCode, signal) => {
      closed = true;
      closeEventCount += 1;
      finish(resolve, {
        exitCode,
        signal,
        reaped: true,
        exitEventCount,
        closeEventCount,
      });
    });
  });
  return {
    completion,
    timedOut: () => timedOut,
    cleanupTimedOut: () => cleanupTimedOut,
    closed: () => closed,
  };
}

async function closeOwnedStreams(streams, timeoutMs = 2_000) {
  await Promise.all(
    streams
      .filter((stream) => stream !== undefined)
      .map(
        (stream) =>
          new Promise((resolve, reject) => {
            if (stream.closed) {
              resolve();
              return;
            }
            const timer = setTimeout(() => {
              cleanup();
              reject(new Error("native preflight stream close timed out"));
            }, timeoutMs);
            const cleanup = () => {
              clearTimeout(timer);
              stream.off("close", onClose);
              stream.off("error", onError);
            };
            const onClose = () => {
              cleanup();
              resolve();
            };
            const onError = (error) => {
              cleanup();
              reject(error);
            };
            stream.once("close", onClose);
            stream.once("error", onError);
            stream.destroy();
          }),
      ),
  );
}

function writeStream(stream, bytes, end = false) {
  return new Promise((resolve, reject) => {
    const callback = (error) => (error == null ? resolve() : reject(error));
    if (end) stream.end(bytes, callback);
    else stream.write(bytes, callback);
  });
}

function descriptorKind(mode) {
  const kind = Number(mode & 0o170000n);
  if (kind === 0o010000) return "fifo";
  if (kind === 0o040000) return "directory";
  if (kind === 0o100000) return "regular";
  return `other:${kind.toString(8)}`;
}

async function observeNativeBoundary(pid, expectedExecutableIdentity) {
  const descriptorDirectory = `/proc/${pid}/fd`;
  const descriptorNumbers = (await readdir(descriptorDirectory))
    .filter((name) => /^[0-9]+$/u.test(name))
    .map(Number)
    .sort((left, right) => left - right);
  const descriptors = [];
  for (const fd of descriptorNumbers) {
    const [metadata, target, fdInfo] = await Promise.all([
      stat(`${descriptorDirectory}/${fd}`, { bigint: true }),
      readlink(`${descriptorDirectory}/${fd}`),
      readFile(`/proc/${pid}/fdinfo/${fd}`, "utf8"),
    ]);
    const flagsMatch = /^flags:\s+([0-7]+)$/mu.exec(fdInfo);
    if (flagsMatch === null) {
      throw new Error(`native preflight fdinfo ${fd} omitted flags`);
    }
    const flags = BigInt(`0o${flagsMatch[1]}`);
    descriptors.push({
      fd,
      target,
      kind: descriptorKind(metadata.mode),
      accessMode: Number(flags & 3n),
      closeOnExec: (flags & descriptorCloseOnExec) !== 0n,
      device: metadata.dev.toString(),
      inode: metadata.ino.toString(),
    });
  }
  const identities = descriptors.map(
    ({ device, inode }) => `${device}:${inode}`,
  );
  const pairwiseUnique = new Set(identities).size === identities.length;
  for (const descriptor of descriptors)
    descriptor.pairwiseUnique = pairwiseUnique;

  const [
    liveExecutableMetadata,
    liveExecutableBytes,
    liveExecutableTarget,
    childrenText,
    processStat,
  ] = await Promise.all([
    stat(`/proc/${pid}/exe`, { bigint: true }),
    readFile(`/proc/${pid}/exe`),
    readlink(`/proc/${pid}/exe`),
    readFile(`/proc/${pid}/task/${pid}/children`, "utf8"),
    readFile(`/proc/${pid}/stat`, "utf8"),
  ]);
  const commEnd = processStat.lastIndexOf(")");
  const processFields = processStat
    .slice(commEnd + 2)
    .trim()
    .split(/\s+/u);
  if (commEnd < 1 || processFields.length < 20) {
    throw new Error("native preflight proc stat was malformed");
  }
  const liveExecutableIdentity = executableIdentity(
    liveExecutableMetadata,
    sha256(liveExecutableBytes),
  );
  return {
    descriptors,
    descriptorsAbove17: descriptors.filter(({ fd }) => fd > 17),
    liveExecutableTarget,
    liveExecutableIdentitySha256: canonicalSha256(liveExecutableIdentity),
    liveExecutableMatched:
      canonicalSha256(liveExecutableIdentity) ===
      canonicalSha256(expectedExecutableIdentity),
    children:
      childrenText.trim() === "" ? [] : childrenText.trim().split(/\s+/u),
    parentPid: Number(processFields[1]),
    startTimeTicks: processFields[19],
  };
}

async function observePostReap(pid, expectedStartTimeTicks) {
  let processStat;
  try {
    processStat = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "absent" };
    throw error;
  }
  const commEnd = processStat.lastIndexOf(")");
  const processFields = processStat
    .slice(commEnd + 2)
    .trim()
    .split(/\s+/u);
  if (commEnd < 1 || processFields.length < 20) {
    throw new Error("native preflight post-reap proc stat was malformed");
  }
  if (processFields[19] === expectedStartTimeTicks) {
    throw new Error(
      "native preflight process remained present after close/reap",
    );
  }
  return {
    status: "pid-reused",
    observedStartTimeTicks: processFields[19],
  };
}

function openRetainedDescriptors(
  directory,
  retainedFiles,
  executablePath,
  descriptorFault = null,
) {
  const parentFds = [];
  try {
    const fd3Path =
      descriptorFault === "fd3-regular"
        ? join(directory, "fd-19-close-range-sentinel")
        : directory;
    parentFds.push(
      openSync(
        fd3Path,
        descriptorFault === "opath-fd3"
          ? 0o10000000
          : descriptorFault === "fd3-regular"
            ? fsConstants.O_RDONLY
            : fsConstants.O_RDONLY | fsConstants.O_DIRECTORY,
      ),
    );
    for (const { spec, path } of retainedFiles.retained) {
      if (descriptorFault === "alias-fd4-fd5" && spec.supervisorFd === 5) {
        parentFds.push(parentFds[1]);
        continue;
      }
      parentFds.push(
        openSync(
          descriptorFault === "fd4-directory" && spec.supervisorFd === 4
            ? directory
            : path,
          descriptorFault === `opath-fd${spec.supervisorFd}`
            ? 0o10000000
            : spec.supervisorFd === 17 && descriptorFault !== "fd17-readonly"
              ? fsConstants.O_RDWR
              : fsConstants.O_RDONLY,
        ),
      );
    }
    parentFds.push(openSync(executablePath, fsConstants.O_RDONLY));
    const sentinelPath = join(directory, "fd-19-close-range-sentinel");
    readFileSync(executablePath);
    parentFds.push(openSync(sentinelPath, fsConstants.O_RDONLY));
    return { parentFds, sentinelPath };
  } catch (error) {
    for (const fd of new Set(parentFds)) closeSync(fd);
    throw error;
  }
}

function createFifoPair(directory, name, childAccess) {
  const path = join(directory, name);
  const created = spawnSync("/usr/bin/mkfifo", ["--mode=0600", path], {
    encoding: "buffer",
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  });
  if (
    created.error !== undefined ||
    created.status !== 0 ||
    created.signal !== null ||
    created.stdout.length !== 0 ||
    created.stderr.length !== 0
  ) {
    throw new Error(`native preflight fixture could not create ${name}`);
  }
  const anchorFd = openSync(path, fsConstants.O_RDWR);
  let childFd;
  let parentFd;
  try {
    if (childAccess === "read") {
      childFd = openSync(path, fsConstants.O_RDONLY);
      parentFd = openSync(path, fsConstants.O_WRONLY);
    } else {
      childFd = openSync(path, fsConstants.O_WRONLY);
      parentFd = openSync(path, fsConstants.O_RDONLY);
    }
  } catch (error) {
    if (childFd !== undefined) closeSync(childFd);
    if (parentFd !== undefined) closeSync(parentFd);
    throw error;
  } finally {
    closeSync(anchorFd);
  }
  return { path, childFd, parentFd };
}

async function prepareDescriptors(
  directory,
  retainedFiles,
  executablePath,
  descriptorFault = null,
) {
  const sentinelPath = join(directory, "fd-19-close-range-sentinel");
  await writeFile(sentinelPath, Buffer.from("close-range-sentinel\n", "utf8"), {
    mode: 0o400,
  });
  await chmod(sentinelPath, 0o400);
  const opened = openRetainedDescriptors(
    directory,
    retainedFiles,
    executablePath,
    descriptorFault,
  );
  opened.sentinelPath = sentinelPath;
  return opened;
}

function closeParentDescriptors(parentFds) {
  for (const fd of new Set(parentFds)) closeSync(fd);
}

function createNativeStdio(directory, inheritedFds) {
  const childFds = [];
  const parentFds = [];
  try {
    const command = createFifoPair(directory, "command.fifo", "read");
    childFds.push(command.childFd);
    parentFds.push(command.parentFd);
    const status = createFifoPair(directory, "status.fifo", "write");
    childFds.push(status.childFd);
    parentFds.push(status.parentFd);
    const diagnostics = createFifoPair(directory, "diagnostics.fifo", "write");
    childFds.push(diagnostics.childFd, ...inheritedFds);
    parentFds.push(diagnostics.parentFd);
    return { childFds, parentFds };
  } catch (error) {
    closeParentDescriptors(childFds);
    closeParentDescriptors(parentFds);
    throw error;
  }
}

function mutateJsonLine(bytes, mutate) {
  const value = JSON.parse(bytes.toString("utf8"));
  mutate(value);
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

const nativeFaultScenarios = new Set([
  "alias-fd1-fd2",
  "alias-fd4-fd5",
  "capsule-padding-bits",
  "capsule-stale-hash",
  "cancel-without-eof",
  "commit-control",
  "commit-start",
  "crlf-start",
  "duplicate-start-key",
  "empty-command",
  "eof-after-ready",
  "extra-capsule-field",
  "extra-start-field",
  "fd0-writeonly",
  "fd1-regular",
  "fd2-regular-valid",
  "fd17-readonly",
  "fd3-regular",
  "fd4-directory",
  "opath-fd3",
  "opath-fd4",
  "oversized-start",
  "partial-start-open",
  "stale-ready-control",
  "status-reader-closed",
  "trailing-after-cancel",
  "truncated-capsule",
  "truncated-start",
  "unvalidated-diagnostic-regular",
  "wrong-start-schema",
]);

const descriptorFaultScenarios = new Set([
  "alias-fd4-fd5",
  "fd17-readonly",
  "fd3-regular",
  "fd4-directory",
  "opath-fd3",
  "opath-fd4",
]);

const cancelFaultScenarios = new Set([
  "cancel-without-eof",
  "commit-control",
  "eof-after-ready",
  "stale-ready-control",
  "trailing-after-cancel",
]);

function preReadyFaultCommand(protocol, scenario) {
  if (scenario === "empty-command") return Buffer.alloc(0);
  if (scenario === "truncated-start") {
    return protocol.startBytes.subarray(0, protocol.startBytes.length - 1);
  }
  if (scenario === "partial-start-open") {
    return protocol.startBytes.subarray(0, protocol.startBytes.length - 1);
  }
  if (scenario === "crlf-start") {
    return Buffer.concat([
      protocol.startBytes.subarray(0, protocol.startBytes.length - 1),
      Buffer.from("\r\n", "utf8"),
    ]);
  }
  if (scenario === "duplicate-start-key") {
    return Buffer.from(
      protocol.startBytes
        .toString("utf8")
        .replace(
          '\"action\":\"START\"',
          '\"action\":\"START\",\"action\":\"START\"',
        ),
      "utf8",
    );
  }
  if (scenario === "extra-start-field") {
    return mutateJsonLine(protocol.startBytes, (value) => {
      value.unexpected = null;
    });
  }
  if (scenario === "wrong-start-schema") {
    return mutateJsonLine(protocol.startBytes, (value) => {
      value.schema =
        "oxigraph.candidate-containment-supervisor-bootstrap-start/v1";
    });
  }
  if (scenario === "commit-start") {
    return mutateJsonLine(protocol.startBytes, (value) => {
      value.action = "COMMIT";
    });
  }
  if (scenario === "oversized-start") {
    return Buffer.concat([Buffer.alloc(8_193, 0x20), Buffer.from("\n")]);
  }
  if (scenario === "truncated-capsule") {
    return Buffer.concat([
      protocol.startBytes,
      protocol.capsuleFrameBytes.subarray(
        0,
        protocol.capsuleFrameBytes.length - 1,
      ),
    ]);
  }
  if (scenario === "capsule-padding-bits") {
    return Buffer.concat([
      protocol.startBytes,
      mutateJsonLine(protocol.capsuleFrameBytes, (value) => {
        value.launchCapsuleBase64 = "Zh==";
      }),
    ]);
  }
  if (scenario === "capsule-stale-hash") {
    return Buffer.concat([
      protocol.startBytes,
      mutateJsonLine(protocol.capsuleFrameBytes, (value) => {
        value.launchCapsuleRawSha256 = "1".repeat(64);
      }),
    ]);
  }
  if (scenario === "extra-capsule-field") {
    return Buffer.concat([
      protocol.startBytes,
      mutateJsonLine(protocol.capsuleFrameBytes, (value) => {
        value.unexpected = null;
      }),
    ]);
  }
  if (descriptorFaultScenarios.has(scenario)) {
    return Buffer.concat([protocol.startBytes, protocol.capsuleFrameBytes]);
  }
  return null;
}

function cancelFaultCommand(terminal, scenario) {
  if (scenario === "cancel-without-eof") return terminal.cancelBytes;
  if (scenario === "eof-after-ready") return Buffer.alloc(0);
  if (scenario === "commit-control") {
    return mutateJsonLine(terminal.cancelBytes, (value) => {
      value.action = "COMMIT";
    });
  }
  if (scenario === "stale-ready-control") {
    return mutateJsonLine(terminal.cancelBytes, (value) => {
      value.preflightReadyRawSha256 = "2".repeat(64);
    });
  }
  if (scenario === "trailing-after-cancel") {
    return Buffer.concat([terminal.cancelBytes, Buffer.from("x", "utf8")]);
  }
  throw new Error(`scenario is not a cancel fault: ${scenario}`);
}

async function drainStatusLines(reader, target) {
  for (;;) {
    const line = await reader.nextLine();
    if (line === null) return;
    target.push(line);
  }
}

const stdioFaultScenarios = new Set([
  "alias-fd1-fd2",
  "fd0-writeonly",
  "fd1-regular",
  "status-reader-closed",
]);

function replayNativeTranscript(protocol, terminal, transcript, processResult) {
  const observation = {
    commandEofObserved: true,
    commandEofAfterCancel: true,
    trailingCommandBytes: 0,
    statusEofObserved: true,
    statusEofCount: 1,
    eofAfterFinalStatus: true,
    commandWriteError: null,
    statusReadError: null,
    diagnosticsBytes: transcript.diagnosticsBytes.length,
    diagnosticsSha256: sha256(transcript.diagnosticsBytes),
    supervisorExitCode: processResult.exitCode,
    supervisorSignal: processResult.signal,
    supervisorReaped: processResult.reaped,
  };
  return preflight.verifyCandidateContainmentSupervisorPreflightReplayV4({
    events: [
      { direction: "guardian-to-supervisor", bytes: protocol.startBytes },
      {
        direction: "guardian-to-supervisor",
        bytes: protocol.capsuleFrameBytes,
      },
      { direction: "supervisor-to-guardian", bytes: transcript.readyBytes },
      { direction: "guardian-to-supervisor", bytes: terminal.cancelBytes },
      {
        direction: "supervisor-to-guardian",
        bytes: transcript.cancelledBytes,
      },
      { direction: "supervisor-to-guardian", bytes: transcript.doneBytes },
    ],
    observation,
    expectedGenerationIdentitySha256: protocol.identity.identitySha256,
    expectedBirthGuardianEpochSha256:
      protocol.identity.birthGuardianEpochSha256,
    expectedSupervisorLaunchIntentRecordRawSha256:
      protocol.supervisorLaunchIntentRecordRawSha256,
    expectedCancelDecisionProjectionSha256:
      terminal.cancelDecision.projectionSha256,
    expectedDecisionJournalRecordRawSha256:
      terminal.decisionJournalRecordRawSha256,
    decisionJournalRecord: terminal.decisionJournalRecord,
  });
}

export async function runCandidateContainmentSupervisorPreflightNativeV4() {
  const executableBytes = await compiledExecutableBytes();
  const executableBytesSha256 = sha256(executableBytes);
  const directory = await mkdtemp(
    join(tmpdir(), "oxigraph-preflight-native-run-"),
  );
  let child;
  let closeState;
  let parentFds = [];
  let childFds = [];
  let endpointFds = [];
  let commandWriter;
  let statusReader;
  let diagnosticsReader;
  let heldExecutableFd;
  try {
    const executablePath = join(directory, executableName);
    await writeFile(executablePath, executableBytes, { mode: 0o500 });
    await chmod(executablePath, 0o500);
    heldExecutableFd = openSync(executablePath, fsConstants.O_RDONLY);
    const executableMetadata = fstatSync(heldExecutableFd, { bigint: true });
    const directoryFilesystem = await statfs(directory, { bigint: true });
    const expectedExecutableIdentity = executableIdentity(
      executableMetadata,
      executableBytesSha256,
    );
    const expectedExecutableIdentitySha256 = canonicalSha256(
      expectedExecutableIdentity,
    );
    const retainedFiles = await createRetainedFiles(directory, executableBytes);
    const protocol = createProtocol(
      retainedFiles,
      expectedExecutableIdentitySha256,
    );
    const opened = await prepareDescriptors(
      directory,
      retainedFiles,
      executablePath,
    );
    parentFds = opened.parentFds;
    const sentinelPath = opened.sentinelPath;
    const nativeStdio = createNativeStdio(directory, parentFds);
    endpointFds = nativeStdio.parentFds;
    childFds = nativeStdio.childFds;
    parentFds = [];
    child = spawn("/proc/self/fd/18", [], {
      cwd: directory,
      env: {},
      shell: false,
      stdio: childFds,
      windowsHide: true,
    });
    closeState = processClose(child);
    closeParentDescriptors(childFds);
    childFds = [];

    commandWriter = createWriteStream(null, {
      fd: endpointFds[0],
      autoClose: true,
    });
    statusReader = createReadStream(null, {
      fd: endpointFds[1],
      autoClose: true,
    });
    diagnosticsReader = createReadStream(null, {
      fd: endpointFds[2],
      autoClose: true,
    });
    endpointFds = [];

    const status = new BoundedLineReader(
      statusReader,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
    );
    const diagnosticsPromise = collectBounded(
      diagnosticsReader,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_DIAGNOSTICS_MAX_BYTES_V4,
    );
    await writeStream(commandWriter, protocol.startBytes);
    const beforeDescriptorPreflight = await observeNativeBoundary(
      child.pid,
      expectedExecutableIdentity,
    );
    await writeStream(commandWriter, protocol.capsuleFrameBytes);
    const readyBytes = await status.nextLine();
    if (readyBytes === null) {
      const [earlyProcess, earlyDiagnostics] = await Promise.all([
        closeState.completion,
        diagnosticsPromise,
      ]);
      throw new Error(
        `native preflight exited before PREFLIGHT_READY: exit=${earlyProcess.exitCode} signal=${earlyProcess.signal} diagnostics=${JSON.stringify(earlyDiagnostics.toString("utf8"))} descriptors=${JSON.stringify(beforeDescriptorPreflight.descriptors)}`,
      );
    }
    const nativeBoundary = await observeNativeBoundary(
      child.pid,
      expectedExecutableIdentity,
    );
    const heldExecutableIdentityAtReady = executableIdentity(
      fstatSync(heldExecutableFd, { bigint: true }),
      executableBytesSha256,
    );
    if (
      canonicalSha256(heldExecutableIdentityAtReady) !==
      expectedExecutableIdentitySha256
    ) {
      throw new Error("native preflight held executable identity changed");
    }
    closeSync(heldExecutableFd);
    heldExecutableFd = undefined;
    const terminal = completeProtocol(protocol, readyBytes);
    await writeStream(commandWriter, terminal.cancelBytes, true);
    const cancelledBytes = await status.nextLine();
    const doneBytes = await status.nextLine();
    if (cancelledBytes === null || doneBytes === null) {
      throw new Error("native preflight omitted a terminal status frame");
    }
    const extraStatusBytes = await status.nextLine();
    if (extraStatusBytes !== null) {
      throw new Error(
        "native preflight emitted an extra terminal status frame",
      );
    }
    await status.waitForEnd();
    const [processResult, diagnosticsBytes] = await Promise.all([
      closeState.completion,
      diagnosticsPromise,
    ]);
    const postReap = await observePostReap(
      child.pid,
      nativeBoundary.startTimeTicks,
    );
    const transcript = {
      readyBytes,
      cancelledBytes,
      doneBytes,
      diagnosticsBytes,
    };
    const replay = replayNativeTranscript(
      protocol,
      terminal,
      transcript,
      processResult,
    );
    const productionReadiness = candidateContainmentOwnerV2Readiness();
    const g1_7Touched = !(
      engineeringTaskIds.length === 9 &&
      commandIds().length === 33 &&
      !commandIds().some((id) => id.includes("g2.2"))
    );
    return {
      process: {
        ...processResult,
        timedOut: closeState.timedOut(),
        cleanupTimedOut: closeState.cleanupTimedOut(),
        childrenAtReady: nativeBoundary.children,
        parentPidAtReady: nativeBoundary.parentPid,
        startTimeTicksAtReady: nativeBoundary.startTimeTicks,
        liveExecutableMatched: nativeBoundary.liveExecutableMatched,
        liveExecutableTarget: nativeBoundary.liveExecutableTarget,
        liveExecutableIdentitySha256:
          nativeBoundary.liveExecutableIdentitySha256,
        intendedExecutableIdentitySha256: expectedExecutableIdentitySha256,
        heldExecutableIdentitySha256: canonicalSha256(
          heldExecutableIdentityAtReady,
        ),
        executableBytesSha256,
        postReap,
      },
      heldExecutableIdentityAtReady,
      descriptorsBeforePreflight: beforeDescriptorPreflight.descriptors,
      descriptorsAbove19BeforePreflight:
        beforeDescriptorPreflight.descriptors.filter(({ fd }) => fd > 19),
      executableDescriptorBeforePreflight:
        beforeDescriptorPreflight.descriptors.find(({ fd }) => fd === 18) ??
        null,
      sentinelDescriptorBeforePreflight:
        beforeDescriptorPreflight.descriptors.find(({ fd }) => fd === 19) ??
        null,
      sentinelPath,
      descriptorsAtReady: nativeBoundary.descriptors.filter(
        ({ fd }) => fd <= 17,
      ),
      descriptorsAbove17AtReady: nativeBoundary.descriptorsAbove17,
      readyBytes,
      cancelledBytes,
      doneBytes,
      statusEofObserved: true,
      statusEofCount: status.endCount,
      commandBytes: Buffer.concat([
        protocol.startBytes,
        protocol.capsuleFrameBytes,
        terminal.cancelBytes,
      ]),
      statusBytes: Buffer.concat([readyBytes, cancelledBytes, doneBytes]),
      diagnosticsBytes,
      expected: {
        startBytes: protocol.startBytes,
        capsuleFrameBytes: protocol.capsuleFrameBytes,
        readyBytes: protocol.expectedReadyBytes,
        cancelBytes: terminal.cancelBytes,
        cancelledBytes: terminal.cancelledBytes,
        doneBytes: terminal.doneBytes,
      },
      replay,
      implementationCheckpoint:
        preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_IMPLEMENTATION_CHECKPOINT_V4,
      nativeObservation: {
        schema:
          "oxigraph.test-only-containment-supervisor-native-observation/v1",
        supervisorExecuted: true,
        supervisorReaped: processResult.reaped,
        supervisorExitCode: processResult.exitCode,
        liveExecutableMatched: nativeBoundary.liveExecutableMatched,
        descriptorsZeroThroughSeventeenObserved:
          nativeBoundary.descriptors.filter(({ fd }) => fd <= 17).length === 18,
        descriptorsAboveSeventeenObserved: nativeBoundary.descriptorsAbove17,
        childProcessesAtReady: nativeBoundary.children,
        serializedAuthorityGranted: false,
      },
      productionReadiness,
      g1_7Touched,
      privateRootPath: directory,
      directoryFilesystemType: directoryFilesystem.type.toString(),
      directoryIsCgroup2: directoryFilesystem.type === BigInt(0x63677270),
      retainedContentControls: retainedFiles.retained.map(
        ({ spec, claimedBytes, physicalBytes }) => ({
          fd: spec.supervisorFd,
          claimedSha256: sha256(claimedBytes),
          physicalSha256: sha256(physicalBytes),
          contentMatched: claimedBytes.equals(physicalBytes),
          physicalMatchedExecutedSupervisor:
            sha256(physicalBytes) === sha256(executableBytes),
        }),
      ),
      compile: {
        sourceSha256:
          attestation.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_SOURCE_SHA256_V4,
        executableSha256: executableBytesSha256,
        executionCopyMode: "0500",
        attestedStorageExecuted: false,
      },
    };
  } catch (error) {
    if (
      child !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
    }
    if (closeState !== undefined) {
      await closeState.completion.catch(() => {});
    }
    throw error;
  } finally {
    closeParentDescriptors(parentFds);
    closeParentDescriptors(childFds);
    closeParentDescriptors(endpointFds);
    if (heldExecutableFd !== undefined) closeSync(heldExecutableFd);
    await closeOwnedStreams([commandWriter, statusReader, diagnosticsReader]);
    if (closeState === undefined || closeState.closed()) {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

async function runNativeStdioFaultScenario(scenario) {
  const executableBytes = await compiledExecutableBytes();
  const executableBytesSha256 = sha256(executableBytes);
  const directory = await mkdtemp(
    join(tmpdir(), "oxigraph-preflight-native-stdio-fault-"),
  );
  let child;
  let closeState;
  let childFds = [];
  let inheritedFds = [];
  let endpointFds = [];
  let commandWriter;
  let statusReader;
  let diagnosticsReader;
  try {
    const executablePath = join(directory, executableName);
    await writeFile(executablePath, executableBytes, { mode: 0o500 });
    await chmod(executablePath, 0o500);
    const executableMetadata = await stat(executablePath, { bigint: true });
    const retainedFiles = await createRetainedFiles(directory, executableBytes);
    const protocol = createProtocol(
      retainedFiles,
      canonicalSha256(
        executableIdentity(executableMetadata, executableBytesSha256),
      ),
    );
    const opened = await prepareDescriptors(
      directory,
      retainedFiles,
      executablePath,
    );
    inheritedFds = opened.parentFds;
    let commandParentFd = null;
    let statusParentFd = null;
    let diagnosticsParentFd = null;
    let statusRegularPath = null;

    if (scenario === "alias-fd1-fd2") {
      const command = createFifoPair(directory, "command.fifo", "read");
      const aliasedStatus = createFifoPair(
        directory,
        "aliased-status-diagnostics.fifo",
        "write",
      );
      childFds = [
        command.childFd,
        aliasedStatus.childFd,
        aliasedStatus.childFd,
        ...inheritedFds,
      ];
      commandParentFd = command.parentFd;
      statusParentFd = aliasedStatus.parentFd;
    } else if (scenario === "fd1-regular") {
      const command = createFifoPair(directory, "command.fifo", "read");
      const diagnostics = createFifoPair(
        directory,
        "diagnostics.fifo",
        "write",
      );
      statusRegularPath = join(directory, "invalid-status.bin");
      await writeFile(statusRegularPath, Buffer.alloc(0), { mode: 0o600 });
      const statusChildFd = openSync(statusRegularPath, fsConstants.O_WRONLY);
      childFds = [
        command.childFd,
        statusChildFd,
        diagnostics.childFd,
        ...inheritedFds,
      ];
      commandParentFd = command.parentFd;
      diagnosticsParentFd = diagnostics.parentFd;
    } else if (scenario === "status-reader-closed") {
      const nativeStdio = createNativeStdio(directory, inheritedFds);
      childFds = nativeStdio.childFds;
      commandParentFd = nativeStdio.parentFds[0];
      closeSync(nativeStdio.parentFds[1]);
      diagnosticsParentFd = nativeStdio.parentFds[2];
    } else {
      const command = createFifoPair(directory, "command.fifo", "write");
      const status = createFifoPair(directory, "status.fifo", "write");
      const diagnostics = createFifoPair(
        directory,
        "diagnostics.fifo",
        "write",
      );
      childFds = [
        command.childFd,
        status.childFd,
        diagnostics.childFd,
        ...inheritedFds,
      ];
      endpointFds.push(command.parentFd);
      statusParentFd = status.parentFd;
      diagnosticsParentFd = diagnostics.parentFd;
    }
    inheritedFds = [];

    endpointFds.push(
      ...[commandParentFd, statusParentFd, diagnosticsParentFd].filter(
        (fd) => fd !== null,
      ),
    );
    child = spawn("/proc/self/fd/18", [], {
      cwd: directory,
      env: {},
      shell: false,
      stdio: childFds,
      windowsHide: true,
    });
    closeState = processClose(child);
    closeParentDescriptors(childFds);
    childFds = [];

    if (commandParentFd !== null) {
      commandWriter = createWriteStream(null, {
        fd: commandParentFd,
        autoClose: true,
      });
      endpointFds = endpointFds.filter((fd) => fd !== commandParentFd);
    }
    let statusPromise;
    if (statusParentFd !== null) {
      statusReader = createReadStream(null, {
        fd: statusParentFd,
        autoClose: true,
      });
      endpointFds = endpointFds.filter((fd) => fd !== statusParentFd);
      statusPromise = collectBounded(
        statusReader,
        3 *
          preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
      );
    } else {
      statusPromise = Promise.resolve(Buffer.alloc(0));
    }
    let diagnosticsPromise;
    if (diagnosticsParentFd === null) {
      diagnosticsPromise = Promise.resolve(Buffer.alloc(0));
    } else {
      diagnosticsReader = createReadStream(null, {
        fd: diagnosticsParentFd,
        autoClose: true,
      });
      endpointFds = endpointFds.filter((fd) => fd !== diagnosticsParentFd);
      diagnosticsPromise = collectBounded(
        diagnosticsReader,
        preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_DIAGNOSTICS_MAX_BYTES_V4,
      );
    }

    if (commandWriter !== undefined) {
      await writeStream(
        commandWriter,
        Buffer.concat([protocol.startBytes, protocol.capsuleFrameBytes]),
      );
    }
    const [processResult, statusBytes, diagnosticsBytes] = await Promise.all([
      closeState.completion,
      statusPromise,
      diagnosticsPromise,
    ]);
    const statusRegularBytes =
      statusRegularPath === null ? null : await readFile(statusRegularPath);
    return {
      ...processResult,
      timedOut: closeState.timedOut(),
      cleanupTimedOut: closeState.cleanupTimedOut(),
      readyBytes: null,
      statusBytes:
        statusRegularBytes === null ? statusBytes : statusRegularBytes,
      diagnosticsBytes,
      privateRootPath: directory,
    };
  } catch (error) {
    if (
      child !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
    }
    if (closeState !== undefined) {
      await closeState.completion.catch(() => {});
    }
    throw error;
  } finally {
    closeParentDescriptors(inheritedFds);
    closeParentDescriptors(childFds);
    closeParentDescriptors(endpointFds);
    await closeOwnedStreams([commandWriter, statusReader, diagnosticsReader]);
    if (closeState === undefined || closeState.closed()) {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

export async function runCandidateContainmentSupervisorPreflightNativeScenarioV4(
  scenario,
) {
  if (!nativeFaultScenarios.has(scenario)) {
    throw new Error(`unknown native preflight scenario: ${scenario}`);
  }
  if (stdioFaultScenarios.has(scenario)) {
    return runNativeStdioFaultScenario(scenario);
  }
  const executableBytes = await compiledExecutableBytes();
  const executableBytesSha256 = sha256(executableBytes);
  const directory = await mkdtemp(
    join(tmpdir(), "oxigraph-preflight-native-fault-"),
  );
  let child;
  let closeState;
  let inheritedFds = [];
  let childFds = [];
  let endpointFds = [];
  let commandWriter;
  let statusReader;
  let diagnosticsReader;
  try {
    const executablePath = join(directory, executableName);
    await writeFile(executablePath, executableBytes, { mode: 0o500 });
    await chmod(executablePath, 0o500);
    const executableMetadata = await stat(executablePath, { bigint: true });
    const expectedExecutableIdentitySha256 = canonicalSha256(
      executableIdentity(executableMetadata, executableBytesSha256),
    );
    const retainedFiles = await createRetainedFiles(directory, executableBytes);
    const protocol = createProtocol(
      retainedFiles,
      expectedExecutableIdentitySha256,
    );
    const opened = await prepareDescriptors(
      directory,
      retainedFiles,
      executablePath,
      descriptorFaultScenarios.has(scenario) ? scenario : null,
    );
    inheritedFds = opened.parentFds;

    let diagnosticRegularFilePath = null;
    let diagnosticRegularFileInitialBytes = null;
    if (
      scenario === "unvalidated-diagnostic-regular" ||
      scenario === "fd2-regular-valid"
    ) {
      const command = createFifoPair(directory, "command.fifo", "read");
      const status = createFifoPair(directory, "status.fifo", "write");
      diagnosticRegularFilePath = join(directory, "unvalidated-diagnostic.bin");
      diagnosticRegularFileInitialBytes = Buffer.from(
        "UNVALIDATED-DIAGNOSTIC-SINK-MUST-REMAIN-UNCHANGED\n",
        "utf8",
      );
      await writeFile(
        diagnosticRegularFilePath,
        diagnosticRegularFileInitialBytes,
        { mode: 0o600 },
      );
      const diagnosticChildFd = openSync(
        diagnosticRegularFilePath,
        fsConstants.O_WRONLY,
      );
      childFds = [
        command.childFd,
        status.childFd,
        diagnosticChildFd,
        ...inheritedFds,
      ];
      endpointFds = [command.parentFd, status.parentFd];
    } else {
      const nativeStdio = createNativeStdio(directory, inheritedFds);
      childFds = nativeStdio.childFds;
      endpointFds = nativeStdio.parentFds;
    }
    inheritedFds = [];

    child = spawn("/proc/self/fd/18", [], {
      cwd: directory,
      env: {},
      shell: false,
      stdio: childFds,
      windowsHide: true,
    });
    closeState = processClose(
      child,
      scenario === "cancel-without-eof" || scenario === "partial-start-open"
        ? 1_000
        : 15_000,
    );
    closeParentDescriptors(childFds);
    childFds = [];
    inheritedFds = [];

    commandWriter = createWriteStream(null, {
      fd: endpointFds[0],
      autoClose: true,
    });
    statusReader = createReadStream(null, {
      fd: endpointFds[1],
      autoClose: true,
    });
    let diagnosticsPromise;
    if (
      scenario === "unvalidated-diagnostic-regular" ||
      scenario === "fd2-regular-valid"
    ) {
      diagnosticsPromise = Promise.resolve(Buffer.alloc(0));
    } else {
      diagnosticsReader = createReadStream(null, {
        fd: endpointFds[2],
        autoClose: true,
      });
      diagnosticsPromise = collectBounded(
        diagnosticsReader,
        preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_DIAGNOSTICS_MAX_BYTES_V4,
      );
    }
    endpointFds = [];
    const status = new BoundedLineReader(
      statusReader,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
    );

    const statusFrames = [];
    let readyBytes = null;
    if (scenario === "unvalidated-diagnostic-regular") {
      await writeStream(commandWriter, Buffer.from("{}\n", "utf8"), true);
      await drainStatusLines(status, statusFrames);
    } else if (scenario === "fd2-regular-valid") {
      await writeStream(
        commandWriter,
        Buffer.concat([protocol.startBytes, protocol.capsuleFrameBytes]),
        true,
      );
      await drainStatusLines(status, statusFrames);
    } else if (cancelFaultScenarios.has(scenario)) {
      await writeStream(
        commandWriter,
        Buffer.concat([protocol.startBytes, protocol.capsuleFrameBytes]),
      );
      readyBytes = await status.nextLine();
      if (readyBytes !== null) {
        statusFrames.push(readyBytes);
        const terminal = completeProtocol(protocol, readyBytes);
        await writeStream(
          commandWriter,
          cancelFaultCommand(terminal, scenario),
          scenario !== "cancel-without-eof",
        );
      } else {
        commandWriter.destroy();
      }
      await drainStatusLines(status, statusFrames);
    } else {
      const commandBytes = preReadyFaultCommand(protocol, scenario);
      if (commandBytes === null) {
        throw new Error(`scenario has no command plan: ${scenario}`);
      }
      await writeStream(
        commandWriter,
        commandBytes,
        scenario !== "partial-start-open",
      );
      await drainStatusLines(status, statusFrames);
      if (statusFrames.length > 0) readyBytes = statusFrames[0];
    }
    await status.waitForEnd();
    const [processResult, diagnosticsBytes] = await Promise.all([
      closeState.completion,
      diagnosticsPromise,
    ]);
    const diagnosticRegularFileBytes =
      diagnosticRegularFilePath === null
        ? null
        : await readFile(diagnosticRegularFilePath);
    return {
      ...processResult,
      timedOut: closeState.timedOut(),
      readyBytes,
      statusBytes: Buffer.concat(statusFrames),
      diagnosticsBytes,
      diagnosticRegularFileBytes,
      diagnosticRegularFileInitialBytes,
      privateRootPath: directory,
      cleanupTimedOut: closeState.cleanupTimedOut(),
    };
  } catch (error) {
    if (
      child !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
    }
    if (closeState !== undefined) {
      await closeState.completion.catch(() => {});
    }
    throw error;
  } finally {
    closeParentDescriptors(inheritedFds);
    closeParentDescriptors(childFds);
    closeParentDescriptors(endpointFds);
    await closeOwnedStreams([commandWriter, statusReader, diagnosticsReader]);
    if (closeState === undefined || closeState.closed()) {
      await rm(directory, { force: true, recursive: true });
    }
  }
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NATIVE_EMPTY_SHA256_V4 =
  emptySha256;
