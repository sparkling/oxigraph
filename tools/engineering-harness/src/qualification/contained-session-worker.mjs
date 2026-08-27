import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  chmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  readSync,
  statfsSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const configurationSchema = "oxigraph.g1.7-native-session-configuration/v4";
const resultSchema = "oxigraph.g1.7-native-session-result/v5";
const isolationSchema = "oxigraph.g1.7-native-isolation-observation/v4";
const launchAttestationSchema =
  "oxigraph.g1.7-native-command-launch-attestation/v2";
const resultPath = "/result/session.json";
const workspace = "/workspace";
const targetRoot = "/state/target";
const cargoExecutable = "/toolchain/bin/cargo";
const mountExecutable = "/usr/bin/mount";
const pythonExecutable = "/usr/bin/python3";
const seccompLauncher = "/runner/seccomp-launcher.py";
const setprivExecutable = "/usr/bin/setpriv";
const safeLane = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const digest = /^[0-9a-f]{64}$/u;
const maxConfigurationBytes = 1_048_576;
const resultReserveMs = 750;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const stateAnchorDefinitions = Object.freeze([
  Object.freeze({ name: "home", path: "/state/home" }),
  Object.freeze({ name: "target", path: "/state/target" }),
  Object.freeze({ name: "temp", path: "/state/tmp" }),
]);

class StateInvariantError extends Error {
  constructor(anchor, phase) {
    super(`qualification state anchor ${phase}: ${anchor}`);
    this.name = "StateInvariantError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("qualification JSON number is not finite");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    ) {
      throw new Error("qualification JSON array is sparse or extended");
    }
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error("qualification JSON value is not plain");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
    .join(",")}}`;
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalValue(value), "utf8"));
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    expected.length !== Object.keys(value).length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} fields are not exact`);
  }
}

function readConfiguration() {
  const chunks = [];
  let bytes = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const count = readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    bytes += count;
    if (bytes > maxConfigurationBytes) {
      throw new Error("qualification configuration exceeds its byte ceiling");
    }
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateCommandPairs(commands) {
  if (
    !Array.isArray(commands) ||
    commands.length !== 6
  ) {
    throw new Error("qualification commands are not bounded pairs");
  }
  const lanes = new Set();
  return Object.freeze(commands.map((command, index) => {
    exactKeys(command, ["name", "argv", "timeoutMs", "maxOutputBytes"], `command ${index}`);
    const separator = command.name.indexOf(":");
    const phase = command.name.slice(0, separator);
    const lane = command.name.slice(separator + 1);
    const expectedPhase = index % 2 === 0 ? "inventory" : "execution";
    if (
      separator < 1 ||
      phase !== expectedPhase ||
      !safeLane.test(lane) ||
      (phase === "inventory" && lanes.has(lane)) ||
      (phase === "execution" && commands[index - 1]?.name !== `inventory:${lane}`)
    ) {
      throw new Error("qualification commands are not frozen inventory/execution pairs");
    }
    if (phase === "inventory") lanes.add(lane);
    if (!Array.isArray(command.argv)) {
      throw new Error(`invalid qualification Cargo argv for ${command.name}`);
    }
    const targetIndexes = command.argv
      .map((argument, argvIndex) => argument === "--target-dir" ? argvIndex : -1)
      .filter((argvIndex) => argvIndex >= 0);
    if (
      command.argv.length < 8 ||
      command.argv[0] !== "cargo" ||
      command.argv[1] !== "test" ||
      !command.argv.includes("--locked") ||
      !command.argv.includes("--offline") ||
      targetIndexes.length !== 1 ||
      command.argv[targetIndexes[0] + 1] !== targetRoot ||
      command.argv.some(
        (argument) =>
          typeof argument !== "string" ||
          argument.length === 0 ||
          argument.includes("\0"),
      ) ||
      !Number.isInteger(command.timeoutMs) ||
      command.timeoutMs < 1_000 ||
      !Number.isInteger(command.maxOutputBytes) ||
      command.maxOutputBytes < 1_024 ||
      command.maxOutputBytes > 67_108_864
    ) {
      throw new Error(`invalid qualification Cargo argv for ${command.name}`);
    }
    return Object.freeze({
      name: command.name,
      argv: Object.freeze([...command.argv]),
      timeoutMs: command.timeoutMs,
      maxOutputBytes: command.maxOutputBytes,
    });
  }));
}

function validateConfiguration(value) {
  exactKeys(
    value,
    [
      "schema",
      "runId",
      "bindings",
      "environment",
      "requestedLimits",
      "maxResultBytes",
      "cargoExecutable",
      "commands",
    ],
    "qualification configuration",
  );
  if (
    value.schema !== configurationSchema ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u.test(value.runId ?? "") ||
    value.cargoExecutable !== cargoExecutable ||
    !Number.isInteger(value.maxResultBytes) ||
    value.maxResultBytes < 65_536 ||
    value.maxResultBytes > 16 * 1024 * 1024
  ) {
    throw new Error("invalid qualification-session configuration");
  }
  exactKeys(
    value.bindings,
    [
      "contractSha256",
      "platformManifestSha256",
      "policySha256",
      "workspaceProjectionSha256",
      "environmentSha256",
      "logicalArgvSha256",
      "requestedLimitsSha256",
    ],
    "qualification bindings",
  );
  if (Object.values(value.bindings).some((item) => !digest.test(item ?? ""))) {
    throw new Error("qualification binding digest is invalid");
  }
  exactKeys(
    value.requestedLimits,
    [
      "totalWallMs",
      "residentBytes",
      "diskBytes",
      "cargoBuildJobs",
      "tasksMax",
      "memorySwapBytes",
    ],
    "qualification requested limits",
  );
  const limits = value.requestedLimits;
  if (
    !Number.isInteger(limits.totalWallMs) ||
    limits.totalWallMs < 1_000 ||
    limits.totalWallMs > 7_200_000 ||
    !Number.isSafeInteger(limits.residentBytes) ||
    limits.residentBytes < 268_435_456 ||
    limits.residentBytes > 68_719_476_736 ||
    !Number.isSafeInteger(limits.diskBytes) ||
    limits.diskBytes < 33_554_432 ||
    limits.diskBytes > 137_438_953_472 ||
    !Number.isInteger(limits.cargoBuildJobs) ||
    limits.cargoBuildJobs < 1 ||
    limits.cargoBuildJobs > 16 ||
    limits.tasksMax !== 512 ||
    limits.memorySwapBytes !== 0
  ) {
    throw new Error("qualification requested limits are invalid");
  }
  exactKeys(
    value.environment,
    [
      "AR",
      "CARGO_BUILD_JOBS",
      "CARGO_HOME",
      "CARGO_INCREMENTAL",
      "CARGO_NET_OFFLINE",
      "CARGO_PROFILE_TEST_DEBUG",
      "CARGO_TARGET_DIR",
      "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER",
      "CARGO_TERM_COLOR",
      "CC",
      "CXX",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_TERMINAL_PROMPT",
      "HOME",
      "LANG",
      "LC_ALL",
      "LD_LIBRARY_PATH",
      "LIBCLANG_PATH",
      "LLVM_CONFIG_PATH",
      "NO_COLOR",
      "PATH",
      "RUSTC",
      "RUSTFMT",
      "SOURCE_DATE_EPOCH",
      "TEMP",
      "TERM",
      "TMP",
      "TMPDIR",
      "TZ",
      "USER",
    ],
    "qualification environment",
  );
  if (
    Object.values(value.environment).some(
      (item) => typeof item !== "string" || item.length === 0 || item.includes("\0"),
    )
  ) {
    throw new Error("qualification environment value is invalid");
  }
  const commands = validateCommandPairs(value.commands);
  if (commands.some((command) => command.timeoutMs > limits.totalWallMs)) {
    throw new Error("qualification command exceeds total timeout");
  }
  if (
    value.bindings.environmentSha256 !== canonicalSha256(value.environment) ||
    value.bindings.logicalArgvSha256 !== canonicalSha256(commands) ||
    value.bindings.requestedLimitsSha256 !== canonicalSha256(limits)
  ) {
    throw new Error("qualification configuration digest binding drifted");
  }
  return Object.freeze({
    schema: configurationSchema,
    runId: value.runId,
    bindings: Object.freeze({ ...value.bindings }),
    environment: Object.freeze({ ...value.environment }),
    requestedLimits: Object.freeze({ ...limits }),
    maxResultBytes: value.maxResultBytes,
    cargoExecutable,
    commands,
  });
}

function assertExactEnvironment(expected) {
  const observedKeys = Object.keys(process.env).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    observedKeys.length !== expectedKeys.length ||
    observedKeys.some(
      (key, index) => key !== expectedKeys[index] || process.env[key] !== expected[key],
    )
  ) {
    throw new Error("qualification worker environment differs from configuration");
  }
}

function remountResult(mode) {
  const outcome = spawnSync(
    mountExecutable,
    ["-o", `remount,bind,${mode}`, resultPath],
    {
      env: Object.freeze({
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
      }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (outcome.status !== 0) {
    const detail = `${outcome.stderr ?? ""}`.trim().slice(-1_024);
    throw new Error(`failed to remount qualification result ${mode}: ${detail}`);
  }
}

function bindStateAnchor({ name, path }) {
  const outcome = spawnSync(mountExecutable, ["--bind", path, path], {
    env: Object.freeze({
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
    }),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (outcome.status !== 0) throw new StateInvariantError(name, "setup failed");
}

function mountId(path, name) {
  const matches = readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(" "))
    .filter((fields) => fields[4] === path);
  if (matches.length !== 1 || !/^\d+$/u.test(matches[0][0])) {
    throw new StateInvariantError(name, "mount identity changed");
  }
  return matches[0][0];
}

function stateAnchorIdentity({ name, path }) {
  try {
    const metadata = lstatSync(path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new StateInvariantError(name, "type changed");
    }
    return Object.freeze({
      name,
      path,
      device: metadata.dev.toString(),
      group: metadata.gid.toString(),
      inode: metadata.ino.toString(),
      mode: metadata.mode.toString(),
      mountId: mountId(path, name),
      owner: metadata.uid.toString(),
    });
  } catch (error) {
    if (error instanceof StateInvariantError) throw error;
    throw new StateInvariantError(name, "identity unavailable");
  }
}

function protectStateAnchors() {
  for (const anchor of stateAnchorDefinitions) {
    chmodSync(anchor.path, 0o700);
    bindStateAnchor(anchor);
  }
  return Object.freeze(stateAnchorDefinitions.map(stateAnchorIdentity));
}

function stateObservation(anchors) {
  const state = statfsSync("/state", { bigint: true });
  return Object.freeze({
    statfs: Object.freeze({
      type: state.type.toString(),
      blockSize: state.bsize.toString(),
      blocks: state.blocks.toString(),
      blocksFree: state.bfree.toString(),
      blocksAvailable: state.bavail.toString(),
      files: state.files.toString(),
      filesFree: state.ffree.toString(),
    }),
    anchors: Object.freeze(anchors.map((anchor) => Object.freeze({ ...anchor }))),
  });
}

function assertStateAnchors(expected) {
  for (const anchor of expected) {
    const observed = stateAnchorIdentity(anchor);
    if (
      observed.device !== anchor.device ||
      observed.group !== anchor.group ||
      observed.inode !== anchor.inode ||
      observed.mode !== anchor.mode ||
      observed.mountId !== anchor.mountId ||
      observed.owner !== anchor.owner
    ) {
      throw new StateInvariantError(anchor.name, "identity changed");
    }
  }
}

function terminateProcessGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function sandboxedCommandArguments(name, argv) {
  return [
    "--bounding-set=-all",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    "--pdeathsig=SIGKILL",
    pythonExecutable,
    "-I",
    "-S",
    seccompLauncher,
    "--attest-fd",
    "3",
    "--attest-name",
    name,
    "--",
    ...argv,
  ];
}

function boundedRawFile(path, maximumBytes) {
  const bytes = readFileSync(path);
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    throw new Error(`qualification observation is outside its byte ceiling: ${path}`);
  }
  return bytes;
}

function boundedRawFileBase64(path, maximumBytes) {
  return boundedRawFile(path, maximumBytes).toString("base64");
}

function namespaceIdentities() {
  return Object.freeze({
    user: readlinkSync("/proc/self/ns/user"),
    mount: readlinkSync("/proc/self/ns/mnt"),
    network: readlinkSync("/proc/self/ns/net"),
    pid: readlinkSync("/proc/self/ns/pid"),
    ipc: readlinkSync("/proc/self/ns/ipc"),
    uts: readlinkSync("/proc/self/ns/uts"),
  });
}

function currentCgroupObservation() {
  const bytes = boundedRawFile("/proc/self/cgroup", 65_536);
  const text = utf8.decode(bytes);
  if (
    !text.endsWith("\n") ||
    text.slice(0, -1).includes("\n") ||
    !/^0::\/[A-Za-z0-9_.@:/-]*\n$/u.test(text)
  ) {
    throw new Error("qualification worker is not in one cgroup-v2 hierarchy");
  }
  const relative = text.slice(3, -1);
  if (
    !relative.startsWith("/") ||
    relative.includes("//") ||
    relative.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("qualification cgroup path is unsafe");
  }
  return Object.freeze({
    root: `/control/cgroup2${relative}`,
    cgroup: Object.freeze({
      hierarchy: "v2",
      membershipSha256: sha256(bytes),
    }),
  });
}

function decodeMountPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new Error("qualification mount path is not absolute");
  }
  const decoded = value.replace(/\\(040|011|012|134)/gu, (_, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)));
  if (decoded.includes("\\") || decoded.includes("\0")) {
    throw new Error("qualification mount path contains an unsupported escape");
  }
  return decoded;
}

function mountSourceBinding(destination) {
  const exact = new Map([
    ["/", ["platform", null]],
    ["/proc", ["proc", null]],
    ["/control/cgroup2", ["cgroup2", null]],
    ["/cargo-home", ["cargo-home", null]],
    ["/toolchain", ["toolchain", null]],
    ["/workspace", ["workspace", null]],
    ["/state", ["state", "/"]],
    ["/state/home", ["state", "/home"]],
    ["/state/target", ["state", "/target"]],
    ["/state/tmp", ["state", "/tmp"]],
    ["/runner/contained-session-worker.mjs", ["worker", null]],
    ["/runner/seccomp-launcher.py", ["launcher", null]],
    ["/result/session.json", ["result", null]],
  ]);
  if (destination === "/dev" || destination.startsWith("/dev/")) {
    return ["device", null];
  }
  const binding = exact.get(destination);
  if (binding === undefined) throw new Error("qualification mount destination is unreviewed");
  return binding;
}

function normalizeMountTopologyText(text) {
  if (typeof text !== "string" || text.length < 1) {
    throw new Error("qualification mount topology is absent");
  }
  const raw = [];
  const destinations = new Set();
  const identifiers = new Set();
  for (const line of text.trimEnd().split("\n")) {
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    const device = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/u.exec(fields[2] ?? "");
    if (
      separator < 6 ||
      fields.length < separator + 4 ||
      !/^[1-9][0-9]*$/u.test(fields[0] ?? "") ||
      !/^(?:0|[1-9][0-9]*)$/u.test(fields[1] ?? "") ||
      device === null
    ) {
      throw new Error("qualification mount topology has an invalid row");
    }
    const destination = decodeMountPath(fields[4]);
    if (destinations.has(destination) || identifiers.has(fields[0])) {
      throw new Error("qualification mount topology is ambiguous");
    }
    destinations.add(destination);
    identifiers.add(fields[0]);
    const options = new Set(fields[5].split(","));
    const access = options.has("ro") && !options.has("rw")
      ? "ro"
      : options.has("rw") && !options.has("ro")
        ? "rw"
        : null;
    const filesystem = fields[separator + 1];
    if (access === null || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(filesystem)) {
      throw new Error("qualification mount access or filesystem is invalid");
    }
    const major = BigInt(device[1]);
    const minor = BigInt(device[2]);
    const encodedDevice =
      ((major & 0xfffn) << 8n) |
      (minor & 0xffn) |
      ((major & ~0xfffn) << 32n) |
      ((minor & ~0xffn) << 12n);
    const [sourceRole, sourceSubpath] = mountSourceBinding(destination);
    raw.push({
      mountId: fields[0],
      parentMountId: fields[1],
      device: encodedDevice.toString(),
      destination,
      access,
      filesystem,
      sourceRole,
      sourceSubpath,
      privateRoot: decodeMountPath(fields[3]),
      privateSource: fields[separator + 2],
      privateSuperOptions: fields.slice(separator + 3).join(" "),
    });
  }
  const unique = (destination) => {
    const matches = raw.filter((mount) => mount.destination === destination);
    if (matches.length !== 1) throw new Error("qualification mount topology is incomplete");
    return matches[0];
  };
  const requiredReadOnly = [
    "/", "/dev", "/toolchain", "/workspace", "/cargo-home",
    "/control/cgroup2", "/runner/contained-session-worker.mjs",
    "/runner/seccomp-launcher.py", "/result/session.json",
  ];
  const requiredReadWrite = ["/proc", "/state", "/state/home", "/state/target", "/state/tmp"];
  if (
    requiredReadOnly.some((path) => unique(path).access !== "ro") ||
    requiredReadWrite.some((path) => unique(path).access !== "rw") ||
    unique("/proc").filesystem !== "proc" ||
    unique("/control/cgroup2").filesystem !== "cgroup2"
  ) {
    throw new Error("qualification mount topology access drifted");
  }
  const state = unique("/state");
  const root = unique("/");
  const device = unique("/dev");
  for (const mount of raw) {
    if (mount.destination === "/") continue;
    const expectedParent = mount.destination.startsWith("/dev/")
      ? device.mountId
      : mount.destination.startsWith("/state/")
        ? state.mountId
        : root.mountId;
    if (mount.parentMountId !== expectedParent) {
      throw new Error("qualification mount ancestry drifted");
    }
  }
  for (const [destination, subpath] of [
    ["/state/home", "/home"],
    ["/state/target", "/target"],
    ["/state/tmp", "/tmp"],
  ]) {
    const mount = unique(destination);
    if (
      mount.parentMountId !== state.mountId ||
      mount.device !== state.device ||
      mount.privateRoot !== subpath ||
      mount.privateSource !== state.privateSource ||
      mount.privateSuperOptions !== state.privateSuperOptions ||
      mount.filesystem !== "tmpfs"
    ) {
      throw new Error("qualification state mount topology drifted");
    }
  }
  if (
    state.privateRoot !== "/" ||
    state.privateSource !== "tmpfs" ||
    state.filesystem !== "tmpfs"
  ) {
    throw new Error("qualification state tmpfs topology drifted");
  }
  return Object.freeze(raw
    .map(({ privateRoot, privateSource, privateSuperOptions, ...mount }) =>
      Object.freeze(mount))
    .sort((left, right) =>
      left.destination < right.destination ? -1 : left.destination > right.destination ? 1 : 0));
}

function normalizedMountTopology() {
  return normalizeMountTopologyText(
    utf8.decode(boundedRawFile("/proc/self/mountinfo", 1_048_576)),
  );
}

function cgroupFiles(root) {
  return Object.freeze({
    memoryMaxBase64: boundedRawFileBase64(`${root}/memory.max`, 4_096),
    memorySwapMaxBase64: boundedRawFileBase64(`${root}/memory.swap.max`, 4_096),
    tasksMaxBase64: boundedRawFileBase64(`${root}/pids.max`, 4_096),
    cgroupTypeBase64: boundedRawFileBase64(`${root}/cgroup.type`, 4_096),
    tasksCurrentBase64: boundedRawFileBase64(`${root}/pids.current`, 4_096),
  });
}

function captureWorkerIsolationObservation() {
  const cgroup = currentCgroupObservation();
  return Object.freeze({
    uidMapBase64: boundedRawFileBase64("/proc/self/uid_map", 4_096),
    gidMapBase64: boundedRawFileBase64("/proc/self/gid_map", 4_096),
    namespaces: namespaceIdentities(),
    statusBase64: boundedRawFileBase64("/proc/self/status", 65_536),
    mounts: normalizedMountTopology(),
    networkDevicesBase64: boundedRawFileBase64("/proc/net/dev", 16_384),
    ipv4RoutesBase64: boundedRawFileBase64("/proc/net/route", 262_144),
    ipv6RoutesBase64: boundedRawFileBase64("/proc/net/ipv6_route", 262_144),
    ipv6AddressesBase64: boundedRawFileBase64("/proc/net/if_inet6", 65_536),
    cgroup: cgroup.cgroup,
    limitsBase64: boundedRawFileBase64("/proc/self/limits", 65_536),
    cgroupFiles: cgroupFiles(cgroup.root),
  });
}

function captureFinalProcessSnapshot() {
  return Object.freeze(numericProcessIds()
    .sort((left, right) => left - right)
    .map((pid) => Object.freeze({
      pid,
      statusBase64: boundedRawFileBase64(`/proc/${pid}/status`, 65_536),
    })));
}

function runCargoCommand({ command, timeoutMs, environment }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(
      setprivExecutable,
      sandboxedCommandArguments(
        command.name,
        [cargoExecutable, ...command.argv.slice(1)],
      ),
      {
        cwd: workspace,
        detached: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      },
    );
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let capturedBytes = 0;
    let attestation = Buffer.alloc(0);
    let attestationError = null;
    let disposition = "completed";
    let settled = false;
    let killTimer;
    let reapTimer;
    let timeout;
    const terminationErrors = [];

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
    };
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (attestationError !== null) throw attestationError;
        if (attestation.length < 1 || attestation.length > 128 * 1024) {
          throw new Error("qualification command attestation is not bounded");
        }
        const parsed = JSON.parse(attestation);
        if (
          parsed?.schema !== launchAttestationSchema ||
          parsed.name !== command.name ||
          !attestation.equals(Buffer.from(`${canonicalValue(parsed)}\n`, "utf8"))
        ) {
          throw new Error("qualification command attestation is not canonical and exact");
        }
        resolve(Object.freeze({
          exitCode,
          signal,
          disposition,
          durationMs: Math.round(performance.now() - started),
          stdout,
          stderr,
          attestation,
          terminationErrors: Object.freeze([...terminationErrors]),
        }));
      } catch (error) {
        reject(error);
      }
    };
    const stop = (reason) => {
      if (disposition !== "completed") return;
      disposition = reason;
      try {
        terminateProcessGroup(child, "SIGTERM");
      } catch (error) {
        terminationErrors.push(`SIGTERM: ${error.code ?? error.name}`);
      }
      killTimer = setTimeout(() => {
        try {
          terminateProcessGroup(child, "SIGKILL");
        } catch (error) {
          terminationErrors.push(`SIGKILL: ${error.code ?? error.name}`);
        }
      }, 250);
      reapTimer = setTimeout(() => {
        if (settled) return;
        disposition = `${disposition}-unreaped`;
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdio[3].destroy();
        child.unref();
        finish(null, null);
      }, 2_000);
    };
    const append = (current, chunk) => {
      const remaining = Math.max(0, command.maxOutputBytes - capturedBytes);
      if (chunk.length > remaining) stop("output-limit");
      const admitted = chunk.subarray(0, remaining);
      capturedBytes += admitted.length;
      return admitted.length === 0 ? current : Buffer.concat([current, admitted]);
    };

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.stdio[3].on("data", (chunk) => {
      if (attestation.length + chunk.length > 128 * 1024) {
        attestationError = new Error("qualification command attestation exceeded its byte ceiling");
        stop("output-limit");
        return;
      }
      attestation = Buffer.concat([attestation, chunk]);
    });
    child.stdio[3].once("error", (error) => {
      attestationError = error;
      stop("output-limit");
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", finish);
    timeout = setTimeout(() => stop("timeout"), timeoutMs);
  });
}

function numericProcessIds() {
  return readdirSync("/proc", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
    .map((entry) => Number(entry.name));
}

async function quiesceUntrustedProcesses() {
  const deadline = performance.now() + 1_500;
  const observed = new Set();
  for (;;) {
    const remaining = numericProcessIds().filter(
      (pid) => pid !== 1 && pid !== process.pid,
    );
    for (const pid of remaining) observed.add(pid);
    if (remaining.length === 0) return observed.size;
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (performance.now() >= deadline) {
      throw new Error("qualification descendants could not be reaped");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function aggregateStateBytes() {
  const state = statfsSync("/state", { bigint: true });
  const used = (state.blocks - state.bfree) * state.bsize;
  if (used > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("qualification state usage exceeds the evidence integer range");
  }
  return Number(used);
}

function commandRecord(command, outcome, descendantsObserved) {
  return Object.freeze({
    name: command.name,
    logicalArgv: command.argv,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    disposition: outcome.disposition,
    durationMs: outcome.durationMs,
    stdoutBase64: outcome.stdout.toString("base64"),
    stderrBase64: outcome.stderr.toString("base64"),
    stdoutSha256: sha256(outcome.stdout),
    stderrSha256: sha256(outcome.stderr),
    launchAttestationBase64: outcome.attestation.toString("base64"),
    launchAttestationSha256: sha256(outcome.attestation),
    terminationErrors: outcome.terminationErrors,
    descendantsObserved,
  });
}

async function executeSession(configuration, started, stateAnchors, dependencies = {}) {
  const now = dependencies.now ?? (() => performance.now());
  const assertAnchors = dependencies.assertStateAnchors ?? assertStateAnchors;
  const runCommand = dependencies.runCargoCommand ?? runCargoCommand;
  const quiesce = dependencies.quiesceUntrustedProcesses ?? quiesceUntrustedProcesses;
  const commands = [];
  for (const command of configuration.commands) {
    assertAnchors(stateAnchors);
    const elapsed = now() - started;
    const remaining = Math.floor(
      configuration.requestedLimits.totalWallMs - elapsed - resultReserveMs,
    );
    if (remaining < 1_000) {
      throw new Error(`qualification timeout exhausted before ${command.name}`);
    }
    const outcome = await runCommand({
      command,
      timeoutMs: Math.min(command.timeoutMs, remaining),
      environment: configuration.environment,
    });
    const descendantsObserved = await quiesce();
    assertAnchors(stateAnchors);
    const record = commandRecord(command, outcome, descendantsObserved);
    commands.push(record);
    let terminal = null;
    if (descendantsObserved > 0) {
      terminal = { outcome: "incomplete", code: "command-live-descendants" };
    } else if (outcome.disposition !== "completed") {
      terminal = { outcome: "incomplete", code: `command-${outcome.disposition}` };
    } else if (outcome.signal !== null) {
      terminal = { outcome: "fail", code: "command-signal" };
    } else if (outcome.exitCode !== 0) {
      terminal = { outcome: "fail", code: "command-exit-nonzero" };
    }
    if (terminal !== null) {
      return Object.freeze({
        outcome: terminal.outcome,
        commands: Object.freeze(commands),
        reason: Object.freeze({ code: terminal.code, command: command.name }),
      });
    }
  }
  return Object.freeze({
    outcome: "pass",
    commands: Object.freeze(commands),
    reason: null,
  });
}

function serializedResult(result, ceiling) {
  const serialized = Buffer.from(`${canonicalValue(result)}\n`, "utf8");
  if (serialized.length <= ceiling) return serialized;
  const fallback = Buffer.from(`${canonicalValue({
    schema: resultSchema,
    configuration: result.configuration,
    outcome: "error",
    reason: { code: "result-too-large", command: null },
    commands: [],
    stateBytes: null,
    durationMs: result.durationMs,
    finalDescendantsObserved: null,
    isolation: null,
  })}\n`, "utf8");
  if (fallback.length > ceiling) {
    throw new Error("qualification result ceiling cannot hold error evidence");
  }
  return fallback;
}

function writeResult(buffer) {
  truncateSync(resultPath, 0);
  const descriptor = openSync(resultPath, "r+");
  try {
    let offset = 0;
    while (offset < buffer.length) {
      offset += writeSync(descriptor, buffer, offset, buffer.length - offset, offset);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  const started = performance.now();
  let configuration;
  let resultProtected = false;
  let result;
  let isolationBase = null;
  let stateAnchors = null;
  try {
    configuration = validateConfiguration(readConfiguration());
    if (typeof process.getuid !== "function" || process.getuid() !== 0) {
      throw new Error("qualification worker did not enter its private user namespace");
    }
    assertExactEnvironment(configuration.environment);
    remountResult("ro");
    resultProtected = true;
    stateAnchors = protectStateAnchors();
    isolationBase = {
      schema: isolationSchema,
      beforeCommands: captureWorkerIsolationObservation(),
      stateBefore: stateObservation(stateAnchors),
    };
    const execution = await executeSession(configuration, started, stateAnchors);
    result = {
      schema: resultSchema,
      configuration,
      outcome: execution.outcome,
      reason: execution.reason,
      commands: execution.commands,
      stateBytes: aggregateStateBytes(),
      durationMs: Math.round(performance.now() - started),
      finalDescendantsObserved: 0,
      isolation: null,
    };
  } catch (error) {
    result = {
      schema: resultSchema,
      configuration: configuration ?? null,
      outcome: "error",
      reason: { code: "infrastructure", command: null },
      commands: [],
      stateBytes: null,
      durationMs: Math.round(performance.now() - started),
      finalDescendantsObserved: null,
      isolation: null,
    };
  }
  try {
    const finalObserved = await quiesceUntrustedProcesses();
    if (["pass", "fail"].includes(result.outcome)) {
      result = {
        ...result,
        ...(finalObserved > 0
          ? {
              outcome: "incomplete",
              reason: { code: "final-live-descendants", command: null },
            }
          : {}),
        finalDescendantsObserved: finalObserved,
      };
    } else if (result.outcome === "incomplete" && finalObserved === 0) {
      result = { ...result, finalDescendantsObserved: 0 };
    } else if (result.outcome === "incomplete") {
      result = {
        schema: resultSchema,
        configuration: configuration ?? null,
        outcome: "error",
        reason: { code: "infrastructure", command: null },
        commands: [],
        stateBytes: null,
        durationMs: Math.round(performance.now() - started),
        finalDescendantsObserved: null,
        isolation: null,
      };
    }
    if (result.outcome !== "error") {
      assertStateAnchors(stateAnchors);
      result = {
        ...result,
        isolation: {
          ...isolationBase,
          afterCommands: captureWorkerIsolationObservation(),
          stateAfter: stateObservation(stateAnchors),
          finalProcesses: captureFinalProcessSnapshot(),
        },
      };
    }
  } catch (error) {
    result = {
      schema: resultSchema,
      configuration: configuration ?? null,
      outcome: "error",
      reason: { code: "infrastructure", command: null },
      commands: [],
      stateBytes: null,
      durationMs: Math.round(performance.now() - started),
      finalDescendantsObserved: null,
      isolation: null,
    };
  }
  if (resultProtected) remountResult("rw");
  const ceiling = configuration?.maxResultBytes ?? 65_536;
  writeResult(serializedResult(result, ceiling));
}

export function createG17NativeSessionWorkerForTesting(dependencies) {
  exactKeys(
    dependencies,
    ["now", "assertStateAnchors", "runCargoCommand", "quiesceUntrustedProcesses"],
    "qualification worker test dependencies",
  );
  if (Object.values(dependencies).some((dependency) => typeof dependency !== "function")) {
    throw new Error("qualification worker test dependencies must be functions");
  }
  const frozenDependencies = Object.freeze({ ...dependencies });
  return Object.freeze({
    normalizeMountinfo(text) {
      return normalizeMountTopologyText(text);
    },
    executeSession(configuration, started = 0, stateAnchors = Object.freeze([])) {
      return executeSession(configuration, started, stateAnchors, frozenDependencies);
    },
    serializedResult(result, ceiling) {
      return serializedResult(result, ceiling);
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
