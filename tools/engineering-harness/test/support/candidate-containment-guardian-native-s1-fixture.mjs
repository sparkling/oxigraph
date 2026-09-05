import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_LAUNCH_SCHEMA_V1,
} from "../../src/candidate/containment-guardian-native-adapter-v1.mjs";
import { buildNativeArtifactV1 } from "./candidate-containment-guardian-native-v1-fixture.mjs";

const DRIVER_SOURCE = fileURLToPath(
  new URL("./candidate-containment-guardian-native-s1-driver.c", import.meta.url),
);
const COMPILER = "/usr/bin/x86_64-linux-gnu-gcc-13";

const EXPECTED_KEYS = Object.freeze([
  "SCHEMA",
  "PATH_SUBSTITUTED",
  "TRACE_COUNT",
  "TRACE_SYSCALL",
  "POSITIVE_EXEC_STOP",
  "OUTCOME_EOF",
  "HELD_DEVICE",
  "HELD_INODE",
  "HELD_BYTES",
  "LIVE_DEVICE",
  "LIVE_INODE",
  "LIVE_BYTES",
  "INDEPENDENT_BYTES_EQUAL",
  "PIDFD_ORIGIN",
  "PIDFD_READABLE",
  "PIDFD_HUP",
  "WAITID_IDTYPE",
  "WAITID_CODE",
  "WAITID_STATUS",
  "SECOND_WAIT_ECHILD",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, argv) {
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    env: {
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
      SOURCE_DATE_EPOCH: "0",
      TZ: "UTC",
    },
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function parseReport(text) {
  assert.equal(text.endsWith("\n"), true);
  const lines = text.slice(0, -1).split("\n");
  assert.equal(lines.length, EXPECTED_KEYS.length);
  const report = Object.create(null);
  for (let index = 0; index < lines.length; index += 1) {
    const split = lines[index].indexOf(" ");
    assert.notEqual(split, -1);
    const key = lines[index].slice(0, split);
    const value = lines[index].slice(split + 1);
    assert.equal(key, EXPECTED_KEYS[index]);
    assert.equal(Object.hasOwn(report, key), false);
    report[key] = value;
  }
  return Object.freeze(report);
}

function exactOne(report, key) {
  assert.equal(report[key], "1", key);
}

function launchObservation(role, bytes, report) {
  assert.equal(report.SCHEMA, "oxigraph.adr38-s1-safe-local-launch/v1");
  assert.equal(report.TRACE_COUNT, "1");
  assert.equal(report.TRACE_SYSCALL, "322");
  assert.equal(report.PIDFD_ORIGIN, "pidfd_open-safe-local-not-clone3");
  assert.equal(report.WAITID_IDTYPE, "P_PIDFD");
  assert.equal(report.WAITID_CODE, "1");
  assert.equal(report.WAITID_STATUS, "125");
  for (const key of [
    "POSITIVE_EXEC_STOP",
    "OUTCOME_EOF",
    "INDEPENDENT_BYTES_EQUAL",
    "PIDFD_READABLE",
    "SECOND_WAIT_ECHILD",
  ]) exactOne(report, key);
  assert.equal(report.HELD_DEVICE, report.LIVE_DEVICE);
  assert.equal(report.HELD_INODE, report.LIVE_INODE);
  assert.equal(report.HELD_BYTES, report.LIVE_BYTES);
  assert.equal(Number(report.HELD_BYTES), bytes.length);
  const childToken = `${role}-child-0001`;
  const pidfdToken = `${role}-pidfd-0001`;
  const returnedPid = role === "manager" ? 41_001 : 41_002;
  const returnedPidfd = role === "manager" ? 51 : 52;
  const identity = {
    byteLength: bytes.length,
    sha256: sha256(bytes),
    device: report.HELD_DEVICE,
    inode: report.HELD_INODE,
  };
  return {
    schema: CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_LAUNCH_SCHEMA_V1,
    role,
    ownerRole: role === "manager" ? "trusted-service-manager" : "manager",
    ownerEvidenceClass: "synthetic-replay",
    childToken,
    pidfdToken,
    heldExecutable: identity,
    execution: {
      mechanism: "execveat-held-fd-empty-path",
      pathname: "",
      flags: ["AT_EMPTY_PATH"],
      traceScope: "post-initial-stop-through-positive-exec-event",
      trace: ["execveat"],
      traceMaximumEvents: 1,
      traceComplete: true,
      events: ["PTRACE_EVENT_EXEC"],
      eventMaximumEvents: 1,
      eventComplete: true,
      positiveExecStop: "PTRACE_EVENT_EXEC",
      childStoppedUntilObservationComplete: true,
      childStoppedUntilDurableReceipt: null,
      syntheticHeldUntilReceipt: true,
      outcomePipeEof: true,
      liveImage: {...identity},
      independentByteRead: true,
    },
    placement: {
      evidenceClass: "synthetic-replay",
      syscall: "clone3",
      flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
      intoCgroupRole: "held-lifetime-cgroup",
      pidfdOutput: true,
      cloneArgsBytes: 88,
      exitSignal: "SIGCHLD",
      fallbackUsed: false,
      returnedPid,
      returnedPidfd,
      returnedChildToken: childToken,
      returnedPidfdToken: pidfdToken,
      membership: {
        source: "synthetic-cgroup.procs-replay",
        cgroupToken: "lifetime-cgroup-0001",
        members: [returnedPid],
        childToken,
        exact: true,
      },
    },
    supervision: {
      evidenceClass: "safe-local-pidfd-open-not-clone3",
      childToken,
      pidfdToken,
      pidfdReadable: true,
      pidfdHup: null,
      syntheticPidfdHup: true,
      waitidIdType: "P_PIDFD",
      waitOwnerMatchesLaunchOwner: null,
      syntheticWaitOwnerMatchesLaunchOwner: true,
      waitidReaped: true,
      secondWaitEchild: true,
      statusEof: null,
      syntheticStatusEof: true,
      exitCode: 125,
      termSignal: null,
    },
    parentage: "direct-parent",
  };
}

export function syntheticCandidateContainmentGuardianNativeLaunchV1(role) {
  assert.match(role, /^(?:manager|guardian)$/u);
  const artifact = role === "manager"
    ? {
        byteLength: 30_880,
        sha256: "b297d888bce75128fc3f18c2454c753a159df97ab7fba8ce790af27540003e99",
        device: "2049",
        inode: "38001",
      }
    : {
        byteLength: 10_872,
        sha256: "b42663bd425f22e34998dd9d674849fd35673d7f3ad9e33d03d3cf09c12c4867",
        device: "2049",
        inode: "38002",
      };
  const childToken = `${role}-child-0001`;
  const pidfdToken = `${role}-pidfd-0001`;
  const returnedPid = role === "manager" ? 41_001 : 41_002;
  const returnedPidfd = role === "manager" ? 51 : 52;
  return {
    schema: CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_LAUNCH_SCHEMA_V1,
    role,
    ownerRole: role === "manager" ? "trusted-service-manager" : "manager",
    ownerEvidenceClass: "synthetic-replay",
    childToken,
    pidfdToken,
    heldExecutable: {...artifact},
    execution: {
      mechanism: "execveat-held-fd-empty-path",
      pathname: "",
      flags: ["AT_EMPTY_PATH"],
      traceScope: "post-initial-stop-through-positive-exec-event",
      trace: ["execveat"],
      traceMaximumEvents: 1,
      traceComplete: true,
      events: ["PTRACE_EVENT_EXEC"],
      eventMaximumEvents: 1,
      eventComplete: true,
      positiveExecStop: "PTRACE_EVENT_EXEC",
      childStoppedUntilObservationComplete: true,
      childStoppedUntilDurableReceipt: null,
      syntheticHeldUntilReceipt: true,
      outcomePipeEof: true,
      liveImage: {...artifact},
      independentByteRead: true,
    },
    placement: {
      evidenceClass: "synthetic-replay",
      syscall: "clone3",
      flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
      intoCgroupRole: "held-lifetime-cgroup",
      pidfdOutput: true,
      cloneArgsBytes: 88,
      exitSignal: "SIGCHLD",
      fallbackUsed: false,
      returnedPid,
      returnedPidfd,
      returnedChildToken: childToken,
      returnedPidfdToken: pidfdToken,
      membership: {
        source: "synthetic-cgroup.procs-replay",
        cgroupToken: "lifetime-cgroup-0001",
        members: [returnedPid],
        childToken,
        exact: true,
      },
    },
    supervision: {
      evidenceClass: "safe-local-pidfd-open-not-clone3",
      childToken,
      pidfdToken,
      pidfdReadable: true,
      pidfdHup: null,
      syntheticPidfdHup: true,
      waitidIdType: "P_PIDFD",
      waitOwnerMatchesLaunchOwner: null,
      syntheticWaitOwnerMatchesLaunchOwner: true,
      waitidReaped: true,
      secondWaitEchild: true,
      statusEof: null,
      syntheticStatusEof: true,
      exitCode: 125,
      termSignal: null,
    },
    parentage: "direct-parent",
  };
}

export async function observeCandidateContainmentGuardianNativeLaunchV1(
  role,
  { pathnameSubstitution = false } = {},
) {
  assert.match(role, /^(?:manager|guardian)$/u);
  const buildRoot = await mkdtemp(join(tmpdir(), "oxigraph-adr38-s1-"));
  try {
    const driver = join(buildRoot, "s1-driver");
    const target = join(buildRoot, "held-target");
    const decoySource = join(buildRoot, "decoy.c");
    const decoy = join(buildRoot, "decoy");
    const artifact = await buildNativeArtifactV1(role);
    await writeFile(target, artifact.bytes, {mode: 0o500});
    await chmod(target, 0o500);
    run(COMPILER, [
      "-std=c17",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      driver,
      DRIVER_SOURCE,
    ]);
    const argv = [target];
    if (pathnameSubstitution) {
      await writeFile(decoySource, "int main(void){return 77;}\n", "utf8");
      run(COMPILER, ["-std=c17", "-O2", "-static", "-s", "-o", decoy, decoySource]);
      argv.push(decoy);
    }
    const result = run(driver, argv);
    const report = parseReport(result.stdout);
    assert.equal(report.PATH_SUBSTITUTED, pathnameSubstitution ? "1" : "0");
    return Object.freeze({
      observation: launchObservation(role, artifact.bytes, report),
      report,
      stderr: result.stderr,
    });
  } finally {
    await rm(buildRoot, {recursive: true, force: true});
  }
}

export function unresolvedCandidateContainmentGuardianNativeLaunchV1(
  launch,
  parentage,
) {
  assert.match(parentage, /^(?:parentage-lost|parentage-ambiguous)$/u);
  const unresolved = structuredClone(launch);
  unresolved.parentage = parentage;
  unresolved.supervision.evidenceClass = "unresolved-parentage-replay";
  for (const field of [
    "pidfdReadable",
    "pidfdHup",
    "syntheticPidfdHup",
    "waitidIdType",
    "waitOwnerMatchesLaunchOwner",
    "syntheticWaitOwnerMatchesLaunchOwner",
    "waitidReaped",
    "secondWaitEchild",
    "statusEof",
    "syntheticStatusEof",
    "exitCode",
    "termSignal",
  ]) unresolved.supervision[field] = null;
  return unresolved;
}
