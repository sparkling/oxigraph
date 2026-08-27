import { createHash } from "node:crypto";

import { canonicalJson } from "../../src/routing/features.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function rawText(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function rawBytes(bytes) {
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function namespaces() {
  return {
    ipc: "ipc:[101]",
    mount: "mnt:[102]",
    network: "net:[103]",
    pid: "pid:[104]",
    user: "user:[105]",
    uts: "uts:[106]",
  };
}

function workerStatus() {
  return [
    "Pid:\t2",
    "PPid:\t1",
    "TracerPid:\t0",
    "Uid:\t0\t0\t0\t0",
    "Gid:\t0\t0\t0\t0",
    "CapInh:\t0000000000200100",
    "CapPrm:\t0000000000200100",
    "CapEff:\t0000000000200100",
    "CapBnd:\t0000000000200100",
    "CapAmb:\t0000000000200100",
    "NoNewPrivs:\t1",
    "Seccomp:\t0",
    "Seccomp_filters:\t0",
    "",
  ].join("\n");
}

function commandStatus(pid) {
  return [
    `Pid:\t${pid}`,
    "PPid:\t2",
    "TracerPid:\t0",
    "Uid:\t0\t0\t0\t0",
    "Gid:\t0\t0\t0\t0",
    `NSpgid:\t${pid}`,
    `NSsid:\t${pid}`,
    "CapInh:\t0000000000000000",
    "CapPrm:\t0000000000000000",
    "CapEff:\t0000000000000000",
    "CapBnd:\t0000000000000000",
    "CapAmb:\t0000000000000000",
    "NoNewPrivs:\t1",
    "Seccomp:\t2",
    "Seccomp_filters:\t1",
    "",
  ].join("\n");
}

function mountinfo() {
  const mounts = [
    ["/", "ro", "tmpfs", "platform"],
    ["/dev", "ro", "devtmpfs", "dev"],
    ["/proc", "rw", "proc", "proc"],
    ["/toolchain", "ro", "tmpfs", "toolchain"],
    ["/workspace", "ro", "tmpfs", "workspace"],
    ["/cargo-home", "ro", "tmpfs", "cargo-home"],
    ["/control/cgroup2", "ro", "cgroup2", "cgroup2"],
    ["/state", "rw", "tmpfs", "tmpfs", "/", "0:1", "0"],
    ["/state/home", "rw", "tmpfs", "tmpfs", "/home", "0:1", "8"],
    ["/state/target", "rw", "tmpfs", "tmpfs", "/target", "0:1", "8"],
    ["/state/tmp", "rw", "tmpfs", "tmpfs", "/tmp", "0:1", "8"],
    ["/runner/contained-session-worker.mjs", "ro", "tmpfs", "worker"],
    ["/runner/seccomp-launcher.py", "ro", "tmpfs", "launcher"],
    ["/result/session.json", "ro", "tmpfs", "result"],
  ];
  return `${mounts.map((mount, index) => {
    const [destination, mode, filesystem, source, root = "/", device = `0:${index + 1}`, parent = "0"] = mount;
    return `${index + 1} ${parent} ${device} ${root} ${destination} ${mode} - ${filesystem} ${source} ${mode}`;
  }
  ).join("\n")}\n`;
}

function limits(configuration) {
  const disk = configuration.requestedLimits.diskBytes;
  return [
    "Limit                     Soft Limit           Hard Limit           Units",
    `Max file size             ${disk}               ${disk}               bytes`,
    "Max core file size        0                    0                    bytes",
    "",
  ].join("\n");
}

function workerObservation(configuration, tasksCurrent = 2) {
  return {
    uidMapBase64: rawText("         0       1000          1\n"),
    gidMapBase64: rawText("         0       1000          1\n"),
    namespaces: namespaces(),
    statusBase64: rawText(workerStatus()),
    mountinfoBase64: rawText(mountinfo()),
    networkDevicesBase64: rawText(
      "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n",
    ),
    ipv4RoutesBase64: rawText(
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n",
    ),
    ipv6RoutesBase64: rawText(
      "00000000000000000000000000000001 80 00000000000000000000000000000000 00 00000000000000000000000000000000 00000000 00000000 00000000 00000001 lo\n",
    ),
    ipv6AddressesBase64: rawText(
      "00000000000000000000000000000001 01 80 10 80       lo\n",
    ),
    cgroupBase64: rawText("0::/user.slice/g17.scope\n"),
    limitsBase64: rawText(limits(configuration)),
    cgroupFiles: {
      memoryMaxBase64: rawText(`${configuration.requestedLimits.residentBytes}\n`),
      memorySwapMaxBase64: rawText(`${configuration.requestedLimits.memorySwapBytes}\n`),
      tasksMaxBase64: rawText(`${configuration.requestedLimits.tasksMax}\n`),
      cgroupTypeBase64: rawText("domain\n"),
      tasksCurrentBase64: rawText(`${tasksCurrent}\n`),
    },
  };
}

function stateObservation(configuration, stateBytes) {
  const blockSize = 4_096;
  const blocks = configuration.requestedLimits.diskBytes / blockSize;
  const usedBlocks = stateBytes / blockSize;
  const anchors = [
    ["home", "/state/home", "11", "9"],
    ["target", "/state/target", "12", "10"],
    ["temp", "/state/tmp", "13", "11"],
  ].map(([name, path, inode, mountId]) => ({
    name,
    path,
    device: "1",
    group: "0",
    inode,
    mode: String(0o40700),
    mountId,
    owner: "0",
  }));
  return {
    statfs: {
      type: String(0x01021994),
      blockSize: String(blockSize),
      blocks: String(blocks),
      blocksFree: String(blocks - usedBlocks),
      blocksAvailable: String(blocks - usedBlocks),
      files: "1024",
      filesFree: "1000",
    },
    anchors,
  };
}

export function syntheticG17Isolation(configuration, stateBytes = 4_096) {
  return {
    schema: "oxigraph.g1.7-native-isolation-observation/v3",
    beforeCommands: workerObservation(configuration),
    afterCommands: workerObservation(configuration),
    stateBefore: stateObservation(configuration, stateBytes),
    stateAfter: stateObservation(configuration, stateBytes),
    finalProcesses: [
      { pid: 1, statusBase64: rawText("Pid:\t1\n") },
      { pid: 2, statusBase64: rawText("Pid:\t2\n") },
    ],
  };
}

export function syntheticG17LaunchAttestation(configuration, command, index) {
  const pid = 10 + index;
  const argv = [
    "/usr/bin/python3",
    "-I",
    "-S",
    "/runner/seccomp-launcher.py",
    "--attest-fd",
    "3",
    "--attest-name",
    command.name,
    "--",
    "/toolchain/bin/cargo",
    ...command.argv.slice(1),
  ];
  const environ = Object.entries(configuration.environment)
    .map(([key, value]) => `${key}=${value}\0`)
    .join("");
  const value = {
    schema: "oxigraph.g1.7-native-command-launch-attestation/v1",
    name: command.name,
    status: rawBytes(Buffer.from(commandStatus(pid), "utf8")),
    limits: rawBytes(Buffer.from(limits(configuration), "utf8")),
    cgroupMembership: rawBytes(Buffer.from("0::/user.slice/g17.scope\n", "utf8")),
    cmdline: rawBytes(Buffer.from(`${argv.join("\0")}\0`, "utf8")),
    environ: rawBytes(Buffer.from(environ, "utf8")),
    namespaces: namespaces(),
    process: {
      pid: String(pid),
      parentPid: "2",
      processGroup: String(pid),
      session: String(pid),
    },
    parentDeathSignal: 9,
    negativeProbes: [
      ["clone-newuser", 56, 1],
      ["clone3", 435, 38],
      ["fsconfig", 431, 1],
      ["fsmount", 432, 1],
      ["fsopen", 430, 1],
      ["fspick", 433, 1],
      ["mount", 165, 1],
      ["mount_setattr", 442, 1],
      ["move_mount", 429, 1],
      ["open_tree", 428, 1],
      ["pivot_root", 155, 1],
      ["setns", 308, 1],
      ["umount2", 166, 1],
      ["unshare", 272, 1],
      ["prctl-clear-pdeathsig", 157, 1],
    ].map(([name, syscallNumber, observedErrno]) => ({
      name,
      syscallNumber,
      observedReturn: -1,
      errno: observedErrno,
    })),
  };
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function syntheticG17CommandRecord(
  configuration,
  command,
  index,
  stdoutText,
  stderrText = "",
  overrides = {},
) {
  const stdout = Buffer.from(stdoutText, "utf8");
  const stderr = Buffer.from(stderrText, "utf8");
  const attestation = syntheticG17LaunchAttestation(configuration, command, index);
  return {
    name: command.name,
    logicalArgv: command.argv,
    exitCode: 0,
    signal: null,
    disposition: "completed",
    durationMs: 5,
    stdoutBase64: stdout.toString("base64"),
    stderrBase64: stderr.toString("base64"),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    launchAttestationBase64: attestation.toString("base64"),
    launchAttestationSha256: sha256(attestation),
    terminationErrors: [],
    descendantsObserved: 0,
    ...overrides,
  };
}
