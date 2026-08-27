import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  g17NativeExecutionArgv,
  g17NativeInventoryArgv,
  replayG17NativeLaneOutputContract,
} from "./native-compatibility-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  decodeReviewedG17V4Contract,
} from "./contract-identity.mjs";

export const G17_NATIVE_SESSION_CONFIGURATION_SCHEMA =
  "oxigraph.g1.7-native-session-configuration/v4";
export const G17_NATIVE_SESSION_RESULT_SCHEMA =
  "oxigraph.g1.7-native-session-result/v5";
export const G17_NATIVE_SESSION_ISOLATION_SCHEMA =
  "oxigraph.g1.7-native-isolation-observation/v4";
export const G17_NATIVE_SESSION_PROJECTION_SCHEMA =
  "oxigraph.g1.7-native-session-projection/v2";
export const G17_NATIVE_COMMAND_LAUNCH_ATTESTATION_SCHEMA =
  "oxigraph.g1.7-native-command-launch-attestation/v2";
export const G17_NATIVE_SESSION_ARTIFACT_NAME = "native-session.json";
export const G17_NATIVE_SESSION_MAX_BYTES = 16 * 1024 * 1024;

const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const TARGET_DIRECTORY = "/state/target";
const MAX_CONTRACT_BYTES = 1024 * 1024;
const CURRENT_PLATFORM_SCHEMA =
  "oxigraph.g1.7-linux-native-platform-closure/v4";
const CURRENT_POLICY_SCHEMA =
  "oxigraph.g1.7-linux-native-isolation-policy/v4";
const utf8 = new TextDecoder("utf-8", { fatal: true });
const SIGNALS = new Set([
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGKILL",
  "SIGPIPE",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGXCPU",
  "SIGXFSZ",
]);

function fail(message) {
  throw new Error(`G1.7 native session contract: ${message}`);
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeReviewedContract({ contractBytes, contractSha256 }) {
  if (
    !Buffer.isBuffer(contractBytes) ||
    contractBytes.length < 1 ||
    contractBytes.length > MAX_CONTRACT_BYTES
  ) {
    fail("contract bytes are not a bounded Buffer");
  }
  const contract = decodeReviewedG17V4Contract({
    contractBytes,
    contractSha256,
  });
  if (
    !Array.isArray(contract.compatibility?.native) ||
    contract.compatibility.native.length !== 3 ||
    contract.compatibility.nativeSession === null ||
    typeof contract.compatibility.nativeSession !== "object" ||
    Array.isArray(contract.compatibility.nativeSession)
  ) {
    fail("reviewed v4 contract has impossible parsed metadata");
  }
  return deepFreeze(contract);
}

function cloneCanonical(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (error) {
    fail(`${label} is not canonical JSON data: ${error.message}`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function roleLogicalPath(roles, id, expectedRoot) {
  const role = plainObject(roles?.[id], `platform role ${id}`);
  if (
    role.root !== expectedRoot ||
    typeof role.path !== "string" ||
    role.path.length === 0 ||
    role.path.startsWith("/") ||
    role.path.includes("\\") ||
    role.path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    fail(`platform role ${id} path is invalid`);
  }
  return expectedRoot === "toolchain" ? `/toolchain/${role.path}` : `/${role.path}`;
}

function reviewedLimits(contract) {
  const value = contract.compatibility.nativeSession;
  return {
    totalWallMs: value.maxTotalWallMs,
    residentBytes: value.maxResidentBytes,
    diskBytes: value.maxDiskBytes,
    cargoBuildJobs: value.cargoBuildJobs,
    tasksMax: value.tasksMax,
    memorySwapBytes: value.memorySwapMaxBytes,
  };
}

export function g17NativeSessionCommands({ contractBytes, contractSha256 }) {
  try {
    const reviewed = decodeReviewedContract({ contractBytes, contractSha256 });
    return deepFreeze(
      reviewed.compatibility.native.flatMap((lane) => {
        const executionArgv = g17NativeExecutionArgv(lane.argv, TARGET_DIRECTORY);
        return [
          {
            name: `inventory:${lane.id}`,
            argv: g17NativeInventoryArgv(executionArgv),
            timeoutMs: lane.timeoutMs,
            maxOutputBytes: lane.maxOutputBytes,
          },
          {
            name: `execution:${lane.id}`,
            argv: executionArgv,
            timeoutMs: lane.timeoutMs,
            maxOutputBytes: lane.maxOutputBytes,
          },
        ];
      }),
    );
  } catch (error) {
    if (error.message.startsWith("G1.7 native session contract:")) throw error;
    fail(error.message);
  }
}

export function g17NativeSessionEnvironment(platform, cargoBuildJobs) {
  try {
    plainObject(platform, "platform binding");
    if (
      platform.schema !== CURRENT_PLATFORM_SCHEMA ||
      !Number.isInteger(cargoBuildJobs) ||
      cargoBuildJobs < 1 ||
      cargoBuildJobs > 16
    ) {
      fail("platform binding or Cargo job ceiling is invalid");
    }
    const roles = plainObject(platform.roles, "platform roles");
    const ar = roleLogicalPath(roles, "ar", "platform");
    const cc = roleLogicalPath(roles, "cc", "platform");
    const cxx = roleLogicalPath(roles, "cxx", "platform");
    const libclang = roleLogicalPath(roles, "libclang", "platform");
    const rustc = roleLogicalPath(roles, "rustc", "toolchain");
    const rustfmt = roleLogicalPath(roles, "rustfmt", "toolchain");
    return deepFreeze({
      AR: ar,
      CARGO_BUILD_JOBS: String(cargoBuildJobs),
      CARGO_HOME: "/cargo-home",
      CARGO_INCREMENTAL: "0",
      CARGO_NET_OFFLINE: "true",
      CARGO_PROFILE_TEST_DEBUG: "0",
      CARGO_TARGET_DIR: TARGET_DIRECTORY,
      CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER: cc,
      CARGO_TERM_COLOR: "never",
      CC: cc,
      CXX: cxx,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/state/home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      LD_LIBRARY_PATH: [
        "/toolchain/lib",
        posix.dirname(libclang),
        "/usr/lib/x86_64-linux-gnu",
        "/lib/x86_64-linux-gnu",
      ].join(":"),
      LIBCLANG_PATH: posix.dirname(libclang),
      LLVM_CONFIG_PATH: "/nonexistent",
      NO_COLOR: "1",
      PATH: "/toolchain/bin:/usr/bin",
      RUSTC: rustc,
      RUSTFMT: rustfmt,
      SOURCE_DATE_EPOCH: "946684800",
      TEMP: "/state/tmp",
      TERM: "dumb",
      TMP: "/state/tmp",
      TMPDIR: "/state/tmp",
      TZ: "UTC",
      USER: "sandbox",
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native session contract:")) throw error;
    fail(error.message);
  }
}

function resultCeiling(commands) {
  const capturedBytes = commands.reduce(
    (total, command) => total + command.maxOutputBytes,
    0,
  );
  const maximum = Math.ceil(capturedBytes / 3) * 4 + 2_097_152;
  if (maximum < 65_536 || maximum > G17_NATIVE_SESSION_MAX_BYTES) {
    fail("reviewed command output cannot fit the native-session artifact ceiling");
  }
  return maximum;
}

export function createG17NativeSessionConfiguration(input) {
  try {
    exactKeys(
      input,
      [
        "runId",
        "contractBytes",
        "contractSha256",
        "platform",
        "policy",
        "workspaceProjectionSha256",
        "requestedLimits",
      ],
      "configuration input",
    );
    if (!SAFE_RUN_ID.test(input.runId ?? "")) fail("run id is unsafe");
    const contract = decodeReviewedContract(input);
    const commands = g17NativeSessionCommands(input);
    const platform = plainObject(
      cloneCanonical(input.platform, "platform binding"),
      "platform binding",
    );
    if (platform.schema !== CURRENT_PLATFORM_SCHEMA) fail("platform generation is not current");
    digest(platform.manifestSha256, "platform manifest");
    const policy = plainObject(
      cloneCanonical(input.policy, "isolation policy binding"),
      "isolation policy binding",
    );
    if (policy.schema !== CURRENT_POLICY_SCHEMA) fail("isolation policy generation is not current");
    digest(policy.sha256, "isolation policy");
    digest(input.workspaceProjectionSha256, "workspace projection");
    const requestedLimits = plainObject(
      cloneCanonical(input.requestedLimits, "requested limits"),
      "requested limits",
    );
    exactKeys(
      requestedLimits,
      [
        "totalWallMs",
        "residentBytes",
        "diskBytes",
        "cargoBuildJobs",
        "tasksMax",
        "memorySwapBytes",
      ],
      "requested limits",
    );
    const limits = reviewedLimits(contract);
    if (!isDeepStrictEqual(requestedLimits, limits)) {
      fail("requested limits differ from the reviewed contract");
    }
    const environment = g17NativeSessionEnvironment(
      platform,
      limits.cargoBuildJobs,
    );
    const bindings = {
      contractSha256: input.contractSha256,
      platformManifestSha256: platform.manifestSha256,
      policySha256: policy.sha256,
      workspaceProjectionSha256: input.workspaceProjectionSha256,
      environmentSha256: canonicalSha256(environment),
      logicalArgvSha256: canonicalSha256(commands),
      requestedLimitsSha256: canonicalSha256(limits),
    };
    return deepFreeze({
      schema: G17_NATIVE_SESSION_CONFIGURATION_SCHEMA,
      runId: input.runId,
      bindings,
      environment,
      requestedLimits: limits,
      maxResultBytes: resultCeiling(commands),
      cargoExecutable: "/toolchain/bin/cargo",
      commands,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native session contract:")) throw error;
    fail(error.message);
  }
}

function strictBase64(value, label) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    fail(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(`${label} is not canonical base64`);
  return bytes;
}

function boundedRawText(value, label, maximumBytes) {
  const bytes = strictBase64(value, label);
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    fail(`${label} exceeds its raw-byte contract`);
  }
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
  if (text.includes("\0")) fail(`${label} contains a NUL byte`);
  return text;
}

function parseSingleIdMap(text, label) {
  const rows = text.trim().split("\n").map((line) => line.trim().split(/\s+/u));
  if (
    rows.length !== 1 ||
    rows[0].length !== 3 ||
    rows[0].some((item) => !/^\d+$/u.test(item)) ||
    rows[0][0] !== "0" ||
    rows[0][2] !== "1"
  ) {
    fail(`${label} is not one exact root identity mapping`);
  }
  return Object.freeze({
    namespaceId: Number(rows[0][0]),
    parentId: Number(rows[0][1]),
    length: Number(rows[0][2]),
  });
}

function validateNamespaces(value, label) {
  exactKeys(value, ["user", "mount", "network", "pid", "ipc", "uts"], label);
  const tags = {
    user: "user",
    mount: "mnt",
    network: "net",
    pid: "pid",
    ipc: "ipc",
    uts: "uts",
  };
  for (const [key, tag] of Object.entries(tags)) {
    if (!new RegExp(`^${tag}:\\[([1-9][0-9]*)\\]$`, "u").test(value[key] ?? "")) {
      fail(`${label} ${key} identity is invalid`);
    }
  }
  return value;
}

function parseStatus(text, label) {
  const fields = new Map();
  for (const line of text.trimEnd().split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) fail(`${label} has an invalid status row`);
    const key = line.slice(0, separator);
    if (fields.has(key)) fail(`${label} repeats status field ${key}`);
    fields.set(key, line.slice(separator + 1).trim());
  }
  return fields;
}

function statusInteger(status, key, label) {
  const value = status.get(key);
  if (!/^\d+$/u.test(value ?? "")) fail(`${label} ${key} is invalid`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(`${label} ${key} is too large`);
  return number;
}

function statusIdQuad(status, key, label) {
  const values = (status.get(key) ?? "").split(/\s+/u);
  if (values.length !== 4 || values.some((value) => !/^\d+$/u.test(value))) {
    fail(`${label} ${key} identity is invalid`);
  }
  return values.map(Number);
}

function assertZeroCommandAuthority(status, label) {
  if (
    statusIdQuad(status, "Uid", label).some((value) => value !== 0) ||
    statusIdQuad(status, "Gid", label).some((value) => value !== 0)
  ) {
    fail(`${label} is not namespace root`);
  }
  for (const key of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
    const value = status.get(key);
    if (!/^[0-9a-fA-F]{16}$/u.test(value ?? "") || BigInt(`0x${value}`) !== 0n) {
      fail(`${label} retains command capability authority`);
    }
  }
  if (
    statusInteger(status, "NoNewPrivs", label) !== 1 ||
    statusInteger(status, "Seccomp", label) !== 2 ||
    statusInteger(status, "Seccomp_filters", label) < 1
  ) {
    fail(`${label} does not prove no-new-privileges and seccomp filtering`);
  }
}

function validateNormalizedMounts(value, label) {
  const requiredReadOnly = [
    "/",
    "/dev",
    "/toolchain",
    "/workspace",
    "/cargo-home",
    "/control/cgroup2",
    "/runner/contained-session-worker.mjs",
    "/runner/seccomp-launcher.py",
    "/result/session.json",
  ];
  const requiredReadWrite = ["/proc", "/state", "/state/home", "/state/tmp", "/state/target"];
  if (!Array.isArray(value) || value.length < 14 || value.length > 512) {
    fail(`${label} mount inventory is not bounded`);
  }
  const mounts = value.map((mount, index) => {
    exactKeys(
      mount,
      [
        "mountId",
        "parentMountId",
        "device",
        "destination",
        "access",
        "filesystem",
        "sourceRole",
        "sourceSubpath",
      ],
      `${label} mount ${index}`,
    );
    if (
      !/^[1-9][0-9]*$/u.test(mount.mountId ?? "") ||
      !/^(?:0|[1-9][0-9]*)$/u.test(mount.parentMountId ?? "") ||
      !/^(?:0|[1-9][0-9]*)$/u.test(mount.device ?? "") ||
      typeof mount.destination !== "string" ||
      !mount.destination.startsWith("/") ||
      mount.destination.includes("\\") ||
      !["ro", "rw"].includes(mount.access) ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(mount.filesystem ?? "") ||
      typeof mount.sourceRole !== "string" ||
      (mount.sourceSubpath !== null &&
        (typeof mount.sourceSubpath !== "string" ||
          !mount.sourceSubpath.startsWith("/")))
    ) {
      fail(`${label} mount ${index} is malformed`);
    }
    return mount;
  });
  const sorted = [...mounts].sort((left, right) =>
    left.destination < right.destination ? -1 : left.destination > right.destination ? 1 : 0);
  if (
    !isDeepStrictEqual(mounts, sorted) ||
    new Set(mounts.map(({ mountId }) => mountId)).size !== mounts.length ||
    new Set(mounts.map(({ destination }) => destination)).size !== mounts.length
  ) {
    fail(`${label} mount inventory is not uniquely and canonically ordered`);
  }
  const uniqueMount = (destination) => {
    const matches = mounts.filter((mount) => mount.destination === destination);
    if (matches.length !== 1) fail(`${label} does not contain one ${destination} mount`);
    return matches[0];
  };
  for (const destination of requiredReadOnly) {
    if (uniqueMount(destination).access !== "ro") {
      fail(`${label} ${destination} mount is not read-only`);
    }
  }
  for (const destination of requiredReadWrite) {
    if (uniqueMount(destination).access !== "rw") {
      fail(`${label} ${destination} mount is not read-write`);
    }
  }
  if (
    uniqueMount("/proc").filesystem !== "proc" ||
    uniqueMount("/control/cgroup2").filesystem !== "cgroup2" ||
    ["/state", "/state/home", "/state/tmp", "/state/target"].some(
      (destination) => uniqueMount(destination).filesystem !== "tmpfs",
    )
  ) {
    fail(`${label} kernel filesystem topology drifted`);
  }
  const allowedDestinations = new Set([
    "/",
    "/proc",
    "/dev",
    "/dev/null",
    "/dev/zero",
    "/dev/full",
    "/dev/random",
    "/dev/urandom",
    "/dev/tty",
    "/dev/pts",
    "/dev/shm",
    "/dev/hugepages",
    "/dev/mqueue",
    "/state",
    "/state/home",
    "/state/target",
    "/state/tmp",
      "/toolchain",
      "/workspace",
      "/cargo-home",
      "/control/cgroup2",
      "/runner/contained-session-worker.mjs",
      "/runner/seccomp-launcher.py",
      "/result/session.json",
  ]);
  if (mounts.some(({ destination }) => !allowedDestinations.has(destination))) {
    fail(`${label} contains an unreviewed mount destination`);
  }
  const roles = new Map([
    ["/", "platform"],
    ["/proc", "proc"],
    ["/control/cgroup2", "cgroup2"],
    ["/cargo-home", "cargo-home"],
    ["/toolchain", "toolchain"],
    ["/workspace", "workspace"],
    ["/runner/contained-session-worker.mjs", "worker"],
    ["/runner/seccomp-launcher.py", "launcher"],
    ["/result/session.json", "result"],
  ]);
  for (const mount of mounts) {
    const expectedRole = mount.destination === "/state" ||
        mount.destination.startsWith("/state/")
      ? "state"
      : mount.destination === "/dev" || mount.destination.startsWith("/dev/")
        ? "device"
        : roles.get(mount.destination);
    const expectedSubpath = new Map([
      ["/state", "/"],
      ["/state/home", "/home"],
      ["/state/target", "/target"],
      ["/state/tmp", "/tmp"],
    ]).get(mount.destination) ?? null;
    if (mount.sourceRole !== expectedRole || mount.sourceSubpath !== expectedSubpath) {
      fail(`${label} ${mount.destination} source role or subpath drifted`);
    }
  }
  const state = uniqueMount("/state");
  const root = uniqueMount("/");
  const device = uniqueMount("/dev");
  for (const mount of mounts) {
    if (mount.destination === "/") continue;
    const expectedParent = mount.destination.startsWith("/dev/")
      ? device.mountId
      : mount.destination.startsWith("/state/")
        ? state.mountId
        : root.mountId;
    if (mount.parentMountId !== expectedParent) {
      fail(`${label} ${mount.destination} mount ancestry drifted`);
    }
  }
  const anchors = [
    ["/state/home", "/home"],
    ["/state/target", "/target"],
    ["/state/tmp", "/tmp"],
  ].map(([destination, expectedRoot]) => {
    const mount = uniqueMount(destination);
    if (
      mount.parentMountId !== state.mountId ||
      mount.device !== state.device ||
      mount.sourceSubpath !== expectedRoot ||
      mount.filesystem !== "tmpfs" ||
      mount.sourceRole !== "state"
    ) {
      fail(`${label} ${destination} is not one bind of the state tmpfs`);
    }
    return mount;
  });
  if (
    state.sourceSubpath !== "/" ||
    state.filesystem !== "tmpfs" ||
    state.sourceRole !== "state" ||
    anchors.some((mount) => mount.access !== "rw")
  ) {
    fail(`${label} state tmpfs topology drifted`);
  }
  return mounts;
}

function validateNetwork(devices, ipv4, ipv6, addresses, label) {
  const deviceLines = devices.trimEnd().split("\n");
  if (deviceLines.length < 3 || deviceLines.slice(2).some((line) =>
    line.slice(0, line.indexOf(":"))?.trim() !== "lo")) {
    fail(`${label} exposes a non-loopback network device`);
  }
  const ipv4Lines = ipv4.trimEnd().split("\n");
  if (ipv4Lines.length < 1 || !ipv4Lines[0].startsWith("Iface")) {
    fail(`${label} IPv4 routes have no kernel header`);
  }
  for (const line of ipv4Lines.slice(1).filter(Boolean)) {
    if (line.trim().split(/\s+/u)[0] !== "lo") {
      fail(`${label} exposes a non-loopback IPv4 route`);
    }
  }
  for (const line of ipv6.trimEnd().split("\n").filter(Boolean)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 10 || fields.at(-1) !== "lo") {
      fail(`${label} exposes a non-loopback IPv6 route`);
    }
  }
  for (const line of addresses.trimEnd().split("\n").filter(Boolean)) {
    const fields = line.trim().split(/\s+/u);
    if (
      fields.length !== 6 ||
      fields[0] !== "00000000000000000000000000000001" ||
      fields.at(-1) !== "lo"
    ) {
      fail(`${label} exposes a non-loopback IPv6 address`);
    }
  }
}

function validateSemanticCgroup(value, label) {
  exactKeys(value, ["hierarchy", "membershipSha256"], label);
  if (value.hierarchy !== "v2" || !DIGEST.test(value.membershipSha256 ?? "")) {
    fail(`${label} is not one cgroup-v2 membership identity`);
  }
  return value;
}

function exactUnsignedText(value, expected, label) {
  const text = value.trim();
  if (!/^\d+$/u.test(text) || Number(text) !== expected) {
    fail(`${label} does not match the requested limit`);
  }
}

function validateLimitsText(text, requested, label) {
  const file = text.match(/^Max file size\s+(\S+)\s+(\S+)\s+bytes\s*$/mu);
  const core = text.match(/^Max core file size\s+(\S+)\s+(\S+)\s+bytes\s*$/mu);
  if (
    file === null ||
    core === null ||
    file[1] !== String(requested.diskBytes) ||
    file[2] !== String(requested.diskBytes) ||
    core[1] !== "0" ||
    core[2] !== "0"
  ) {
    fail(`${label} does not prove the requested file limits`);
  }
}

function validateRawIsolationProcess(record, label, requested) {
  exactKeys(
    record,
    [
      "uidMapBase64",
      "gidMapBase64",
      "namespaces",
      "statusBase64",
      "mounts",
      "networkDevicesBase64",
      "ipv4RoutesBase64",
      "ipv6RoutesBase64",
      "ipv6AddressesBase64",
      "cgroup",
      "limitsBase64",
      "cgroupFiles",
    ],
    label,
  );
  const raw = {
    uidMap: boundedRawText(record.uidMapBase64, `${label} uid map`, 4_096),
    gidMap: boundedRawText(record.gidMapBase64, `${label} gid map`, 4_096),
    status: boundedRawText(record.statusBase64, `${label} status`, 65_536),
    networkDevices: boundedRawText(
      record.networkDevicesBase64,
      `${label} network devices`,
      16_384,
    ),
    ipv4Routes: boundedRawText(record.ipv4RoutesBase64, `${label} IPv4 routes`, 262_144),
    ipv6Routes: boundedRawText(record.ipv6RoutesBase64, `${label} IPv6 routes`, 262_144),
    ipv6Addresses: boundedRawText(
      record.ipv6AddressesBase64,
      `${label} IPv6 addresses`,
      65_536,
    ),
    limits: boundedRawText(record.limitsBase64, `${label} limits`, 65_536),
  };
  exactKeys(
    record.cgroupFiles,
    [
      "memoryMaxBase64",
      "memorySwapMaxBase64",
      "tasksMaxBase64",
      "cgroupTypeBase64",
      "tasksCurrentBase64",
    ],
    `${label} cgroup files`,
  );
  const cgroupFiles = {
    memoryMax: boundedRawText(
      record.cgroupFiles.memoryMaxBase64,
      `${label} memory.max`,
      4_096,
    ),
    memorySwapMax: boundedRawText(
      record.cgroupFiles.memorySwapMaxBase64,
      `${label} memory.swap.max`,
      4_096,
    ),
    tasksMax: boundedRawText(
      record.cgroupFiles.tasksMaxBase64,
      `${label} pids.max`,
      4_096,
    ),
    cgroupType: boundedRawText(
      record.cgroupFiles.cgroupTypeBase64,
      `${label} cgroup.type`,
      4_096,
    ),
    tasksCurrent: boundedRawText(
      record.cgroupFiles.tasksCurrentBase64,
      `${label} pids.current`,
      4_096,
    ),
  };
  parseSingleIdMap(raw.uidMap, `${label} uid map`);
  parseSingleIdMap(raw.gidMap, `${label} gid map`);
  validateNamespaces(record.namespaces, `${label} namespaces`);
  const status = parseStatus(raw.status, `${label} status`);
  const mounts = validateNormalizedMounts(record.mounts, `${label} mounts`);
  validateNetwork(
    raw.networkDevices,
    raw.ipv4Routes,
    raw.ipv6Routes,
    raw.ipv6Addresses,
    label,
  );
  const cgroup = validateSemanticCgroup(record.cgroup, `${label} cgroup`);
  validateLimitsText(raw.limits, requested, `${label} limits`);
  exactUnsignedText(cgroupFiles.memoryMax, requested.residentBytes, `${label} memory.max`);
  exactUnsignedText(
    cgroupFiles.memorySwapMax,
    requested.memorySwapBytes,
    `${label} memory.swap.max`,
  );
  exactUnsignedText(cgroupFiles.tasksMax, requested.tasksMax, `${label} pids.max`);
  const tasksCurrent = Number(cgroupFiles.tasksCurrent.trim());
  if (
    !/^\d+$/u.test(cgroupFiles.tasksCurrent.trim()) ||
    !Number.isSafeInteger(tasksCurrent) ||
    tasksCurrent < 1 ||
    tasksCurrent > requested.tasksMax
  ) {
    fail(`${label} pids.current is invalid`);
  }
  if (cgroupFiles.cgroupType.trim() !== "domain") {
    fail(`${label} does not run in a domain cgroup`);
  }
  return {
    raw,
    status,
    cgroupFiles,
    cgroup,
    namespaces: record.namespaces,
    mounts,
  };
}

function decimalString(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value ?? "")) {
    fail(`${label} is not a canonical decimal string`);
  }
  return BigInt(value);
}

function validateStateObservation(value, requested, mounts, label) {
  exactKeys(value, ["statfs", "anchors"], label);
  exactKeys(
    value.statfs,
    [
      "type",
      "blockSize",
      "blocks",
      "blocksFree",
      "blocksAvailable",
      "files",
      "filesFree",
    ],
    `${label} statfs`,
  );
  const statfs = Object.fromEntries(
    Object.entries(value.statfs).map(([key, item]) => [
      key,
      decimalString(item, `${label} statfs ${key}`),
    ]),
  );
  if (
    statfs.type !== 0x01021994n ||
    statfs.blockSize < 1n ||
    statfs.blocks * statfs.blockSize !== BigInt(requested.diskBytes) ||
    statfs.blocksFree > statfs.blocks ||
    statfs.blocksAvailable > statfs.blocksFree ||
    statfs.filesFree > statfs.files
  ) {
    fail(`${label} does not prove the exact tmpfs capacity`);
  }
  const definitions = [
    ["home", "/state/home"],
    ["target", "/state/target"],
    ["temp", "/state/tmp"],
  ];
  if (!Array.isArray(value.anchors) || value.anchors.length !== definitions.length) {
    fail(`${label} state-anchor inventory is not exact`);
  }
  for (const [index, anchor] of value.anchors.entries()) {
    exactKeys(
      anchor,
      ["name", "path", "device", "group", "inode", "mode", "mountId", "owner"],
      `${label} anchor ${index}`,
    );
    const [name, path] = definitions[index];
    const mode = decimalString(anchor.mode, `${label} anchor ${name} mode`);
    const mount = mounts.find(({ destination }) => destination === path);
    if (
      anchor.name !== name ||
      anchor.path !== path ||
      decimalString(anchor.device, `${label} anchor ${name} device`) < 1n ||
      decimalString(anchor.inode, `${label} anchor ${name} inode`) < 1n ||
      decimalString(anchor.mountId, `${label} anchor ${name} mount`) < 1n ||
      mount === undefined ||
      anchor.mountId !== mount.mountId ||
      anchor.device !== mount.device ||
      anchor.owner !== "0" ||
      anchor.group !== "0" ||
      (mode & 0o777n) !== 0o700n
    ) {
      fail(`${label} anchor ${name} identity or mode drifted`);
    }
  }
  return { statfs, anchors: value.anchors };
}

function assertWorkerAuthority(status, label) {
  if (
    statusIdQuad(status, "Uid", label).some((value) => value !== 0) ||
    statusIdQuad(status, "Gid", label).some((value) => value !== 0) ||
    statusInteger(status, "TracerPid", label) !== 0 ||
    statusInteger(status, "NoNewPrivs", label) !== 1 ||
    statusInteger(status, "Seccomp", label) !== 0 ||
    statusInteger(status, "Seccomp_filters", label) !== 0
  ) {
    fail(`${label} identity, tracing, or filter baseline is invalid`);
  }
  for (const key of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) {
    if ((status.get(key) ?? "").toLowerCase() !== "0000000000200100") {
      fail(`${label} namespace-setup capability mask drifted`);
    }
  }
}

function verifyIsolationObservations(value, requested, stateBytes) {
  exactKeys(
    value,
    [
      "schema",
      "beforeCommands",
      "afterCommands",
      "stateBefore",
      "stateAfter",
      "finalProcesses",
    ],
    "isolation observations",
  );
  if (value.schema !== G17_NATIVE_SESSION_ISOLATION_SCHEMA) {
    fail("isolation observation schema is not current");
  }
  const before = validateRawIsolationProcess(
    value.beforeCommands,
    "worker before-commands observation",
    requested,
  );
  const after = validateRawIsolationProcess(
    value.afterCommands,
    "worker after-commands observation",
    requested,
  );
  for (const key of [
    "uidMap",
    "gidMap",
    "networkDevices",
    "ipv4Routes",
    "ipv6Routes",
    "ipv6Addresses",
    "limits",
  ]) {
    if (before.raw[key] !== after.raw[key]) {
      fail(`worker before/after ${key} observations differ`);
    }
  }
  if (
    !isDeepStrictEqual(value.beforeCommands.namespaces, value.afterCommands.namespaces) ||
    !isDeepStrictEqual(before.mounts, after.mounts) ||
    !isDeepStrictEqual(before.cgroup, after.cgroup) ||
    before.cgroupFiles.memoryMax !== after.cgroupFiles.memoryMax ||
    before.cgroupFiles.memorySwapMax !== after.cgroupFiles.memorySwapMax ||
    before.cgroupFiles.tasksMax !== after.cgroupFiles.tasksMax ||
    before.cgroupFiles.cgroupType !== after.cgroupFiles.cgroupType
  ) {
    fail("worker before/after isolation generation differs");
  }
  assertWorkerAuthority(before.status, "worker before-commands status");
  assertWorkerAuthority(after.status, "worker after-commands status");
  for (const key of [
    "Uid",
    "Gid",
    "TracerPid",
    "CapInh",
    "CapPrm",
    "CapEff",
    "CapBnd",
    "CapAmb",
    "NoNewPrivs",
    "Seccomp",
    "Seccomp_filters",
  ]) {
    if (before.status.get(key) !== after.status.get(key)) {
      fail(`worker security status ${key} changed across commands`);
    }
  }
  const workerPid = statusInteger(
    before.status,
    "Pid",
    "worker before-commands status",
  );
  if (
    workerPid < 2 ||
    statusInteger(before.status, "PPid", "worker before-commands status") !== 1 ||
    statusInteger(after.status, "Pid", "worker after-commands status") !== workerPid ||
    statusInteger(after.status, "PPid", "worker after-commands status") !== 1
  ) {
    fail("worker PID-namespace topology is contradictory");
  }
  const stateBefore = validateStateObservation(
    value.stateBefore,
    requested,
    before.mounts,
    "state before commands",
  );
  const stateAfter = validateStateObservation(
    value.stateAfter,
    requested,
    after.mounts,
    "state after commands",
  );
  if (!isDeepStrictEqual(stateBefore.anchors, stateAfter.anchors)) {
    fail("state anchor identities changed across commands");
  }
  const used =
    (stateAfter.statfs.blocks - stateAfter.statfs.blocksFree) *
    stateAfter.statfs.blockSize;
  if (used > BigInt(Number.MAX_SAFE_INTEGER) || Number(used) !== stateBytes) {
    fail("session state usage differs from the final tmpfs observation");
  }
  if (!Array.isArray(value.finalProcesses) || value.finalProcesses.length !== 2) {
    fail("final process snapshot is not exact");
  }
  const expectedPids = [1, workerPid].sort((left, right) => left - right);
  for (const [index, processRecord] of value.finalProcesses.entries()) {
    exactKeys(processRecord, ["pid", "statusBase64"], `final process ${index}`);
    if (processRecord.pid !== expectedPids[index]) {
      fail("final process snapshot retains an untrusted process");
    }
    const status = parseStatus(
      boundedRawText(processRecord.statusBase64, `final process ${index} status`, 65_536),
      `final process ${index} status`,
    );
    if (statusInteger(status, "Pid", `final process ${index} status`) !== processRecord.pid) {
      fail("final process snapshot identity is contradictory");
    }
  }
  const projection = deepFreeze({
    namespaceIdentitiesObserved: true,
    zeroMappedIdentity: true,
    mountAuthorityBounded: true,
    loopbackRoutesOnly: true,
    cgroupV2LimitsMatch: true,
    rlimitsMatch: true,
    stateTmpfsAndAnchorsMatch: true,
    finalQuiescence: true,
    normalizedMountTopologyObserved: true,
    cgroupMembershipMatched: true,
    innerNamespaces: cloneCanonical(
      value.beforeCommands.namespaces,
      "inner namespace identities",
    ),
  });
  return Object.freeze({ projection, worker: before, workerPid });
}

function rawByteRecord(record, label, maximumBytes) {
  exactKeys(record, ["bytes", "sha256", "base64"], label);
  const bytes = strictBase64(record.base64, `${label} bytes`);
  if (
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    record.bytes > maximumBytes ||
    bytes.length !== record.bytes ||
    sha256(bytes) !== record.sha256
  ) {
    fail(`${label} byte identity is invalid`);
  }
  return bytes;
}

function fatalText(bytes, label) {
  try {
    return utf8.decode(bytes);
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
}

function nulFields(bytes, label) {
  if (bytes.length < 2 || bytes.at(-1) !== 0) {
    fail(`${label} is not NUL terminated`);
  }
  const fields = fatalText(bytes.subarray(0, -1), label).split("\0");
  if (fields.some((field) => field.length === 0)) {
    fail(`${label} contains an empty field`);
  }
  return fields;
}

function statusLastInteger(status, key, label) {
  const values = (status.get(key) ?? "").split(/\s+/u);
  if (values.length < 1 || values.some((value) => !/^\d+$/u.test(value))) {
    fail(`${label} ${key} is invalid`);
  }
  const value = Number(values.at(-1));
  if (!Number.isSafeInteger(value)) fail(`${label} ${key} is too large`);
  return value;
}

function validateLaunchAttestation({
  bytes,
  expected,
  worker,
  workerPid,
  environment,
}) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`command launch attestation is invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("command launch attestation is not canonical JSON");
  }
  exactKeys(
    value,
    [
      "schema",
      "name",
      "status",
      "limits",
      "cgroup",
      "cmdline",
      "environ",
      "namespaces",
      "process",
      "parentDeathSignal",
      "negativeProbes",
    ],
    "command launch attestation",
  );
  if (
    value.schema !== G17_NATIVE_COMMAND_LAUNCH_ATTESTATION_SCHEMA ||
    value.name !== expected.name ||
    value.parentDeathSignal !== 9 ||
    !isDeepStrictEqual(value.namespaces, worker.namespaces)
  ) {
    fail(`command launch attestation ${expected.name} generation drifted`);
  }
  validateNamespaces(value.namespaces, `command ${expected.name} namespaces`);
  const expectedNegativeProbes = [
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
  ];
  if (
    !Array.isArray(value.negativeProbes) ||
    value.negativeProbes.length !== expectedNegativeProbes.length
  ) {
    fail(`command ${expected.name} negative syscall probes are not exact`);
  }
  const syscallNumbers = new Set();
  for (const [index, probe] of value.negativeProbes.entries()) {
    exactKeys(
      probe,
      ["name", "syscallNumber", "observedReturn", "errno"],
      `command ${expected.name} negative probe ${index}`,
    );
    const [name, expectedNumber, expectedErrno] = expectedNegativeProbes[index];
    if (
      probe.name !== name ||
      !Number.isSafeInteger(probe.syscallNumber) ||
      probe.syscallNumber !== expectedNumber ||
      syscallNumbers.has(probe.syscallNumber) ||
      probe.observedReturn !== -1 ||
      probe.errno !== expectedErrno
    ) {
      fail(`command ${expected.name} negative probe ${name} drifted`);
    }
    syscallNumbers.add(probe.syscallNumber);
  }
  const statusText = fatalText(
    rawByteRecord(value.status, `command ${expected.name} status`, 16_384),
    `command ${expected.name} status`,
  );
  const limitsText = fatalText(
    rawByteRecord(value.limits, `command ${expected.name} limits`, 16_384),
    `command ${expected.name} limits`,
  );
  const cgroup = validateSemanticCgroup(
    value.cgroup,
    `command ${expected.name} cgroup`,
  );
  if (limitsText !== worker.raw.limits || !isDeepStrictEqual(cgroup, worker.cgroup)) {
    fail(`command ${expected.name} limits or cgroup membership differs from worker`);
  }
  const status = parseStatus(statusText, `command ${expected.name} status`);
  assertZeroCommandAuthority(status, `command ${expected.name} status`);
  if (
    statusInteger(status, "TracerPid", `command ${expected.name} status`) !== 0 ||
    statusInteger(status, "Seccomp_filters", `command ${expected.name} status`) !==
      statusInteger(worker.status, "Seccomp_filters", "worker status") + 1
  ) {
    fail(`command ${expected.name} tracing or seccomp-filter count drifted`);
  }
  exactKeys(
    value.process,
    ["pid", "parentPid", "processGroup", "session"],
    `command ${expected.name} process`,
  );
  const processIds = Object.fromEntries(
    Object.entries(value.process).map(([key, item]) => {
      const parsed = decimalString(item, `command ${expected.name} process ${key}`);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        fail(`command ${expected.name} process ${key} is too large`);
      }
      return [key, Number(parsed)];
    }),
  );
  if (
    processIds.pid < 2 ||
    processIds.parentPid !== workerPid ||
    processIds.processGroup !== processIds.pid ||
    processIds.session !== processIds.pid ||
    statusInteger(status, "Pid", `command ${expected.name} status`) !== processIds.pid ||
    statusInteger(status, "PPid", `command ${expected.name} status`) !== workerPid ||
    statusLastInteger(status, "NSpgid", `command ${expected.name} status`) !== processIds.pid ||
    statusLastInteger(status, "NSsid", `command ${expected.name} status`) !== processIds.pid
  ) {
    fail(`command ${expected.name} process/session topology is contradictory`);
  }
  const observedArgv = nulFields(
    rawByteRecord(value.cmdline, `command ${expected.name} cmdline`, 65_536),
    `command ${expected.name} cmdline`,
  );
  const expectedArgv = [
    "/usr/bin/python3",
    "-I",
    "-S",
    "/runner/seccomp-launcher.py",
    "--attest-fd",
    "3",
    "--attest-name",
    expected.name,
    "--",
    "/toolchain/bin/cargo",
    ...expected.argv.slice(1),
  ];
  if (!isDeepStrictEqual(observedArgv, expectedArgv)) {
    fail(`command ${expected.name} launch argv drifted`);
  }
  const observedEnvironment = {};
  for (const field of nulFields(
    rawByteRecord(value.environ, `command ${expected.name} environ`, 65_536),
    `command ${expected.name} environ`,
  )) {
    const separator = field.indexOf("=");
    const key = field.slice(0, separator);
    if (separator < 1 || Object.hasOwn(observedEnvironment, key)) {
      fail(`command ${expected.name} environment is ambiguous`);
    }
    observedEnvironment[key] = field.slice(separator + 1);
  }
  if (!isDeepStrictEqual(observedEnvironment, environment)) {
    fail(`command ${expected.name} environment drifted`);
  }
  return deepFreeze({
    pid: processIds.pid,
    commandCapabilitiesDropped: true,
    noNewPrivileges: true,
    seccompFiltered: true,
    deniedSyscallProbesObserved: true,
    detachedCommandSession: true,
    parentDeathSignal: "SIGKILL",
  });
}

function decodedCommandRecord(record, expected, index, isolation, environment) {
  exactKeys(
    record,
    [
      "name",
      "logicalArgv",
      "exitCode",
      "signal",
      "disposition",
      "durationMs",
      "stdoutBase64",
      "stderrBase64",
      "stdoutSha256",
      "stderrSha256",
      "launchAttestationBase64",
      "launchAttestationSha256",
      "terminationErrors",
      "descendantsObserved",
    ],
    `command result ${index}`,
  );
  if (
    record.name !== expected.name ||
    !isDeepStrictEqual(record.logicalArgv, expected.argv) ||
    !["completed", "timeout", "timeout-unreaped", "output-limit", "output-limit-unreaped"].includes(
      record.disposition,
    ) ||
    !Number.isSafeInteger(record.durationMs) ||
    record.durationMs < 0 ||
    record.durationMs > expected.timeoutMs ||
    !Number.isSafeInteger(record.descendantsObserved) ||
    record.descendantsObserved < 0 ||
    !Array.isArray(record.terminationErrors) ||
    record.terminationErrors.some(
      (item) => typeof item !== "string" || item.length === 0,
    )
  ) {
    fail(`command result ${expected.name} differs from the reviewed command`);
  }
  const exitCodeValid =
    record.exitCode === null ||
    (Number.isInteger(record.exitCode) && record.exitCode >= 0);
  const signalValid =
    record.signal === null ||
    (typeof record.signal === "string" && SIGNALS.has(record.signal));
  if (
    !exitCodeValid ||
    !signalValid ||
    (record.exitCode !== null && record.signal !== null) ||
    (record.disposition === "completed" &&
      ((record.exitCode === null && record.signal === null) ||
        record.terminationErrors.length !== 0))
  ) {
    fail(`command result ${expected.name} has an impossible process outcome`);
  }
  const stdout = strictBase64(record.stdoutBase64, `${expected.name} stdout`);
  const stderr = strictBase64(record.stderrBase64, `${expected.name} stderr`);
  const attestation = strictBase64(
    record.launchAttestationBase64,
    `${expected.name} launch attestation`,
  );
  if (
    stdout.length + stderr.length > expected.maxOutputBytes ||
    sha256(stdout) !== record.stdoutSha256 ||
    sha256(stderr) !== record.stderrSha256 ||
    attestation.length < 1 ||
    attestation.length > 128 * 1024 ||
    sha256(attestation) !== record.launchAttestationSha256
  ) {
    fail(`command result ${expected.name} differs from its bounded raw bytes`);
  }
  let stdoutText;
  let stderrText;
  try {
    stdoutText = utf8.decode(stdout);
    stderrText = utf8.decode(stderr);
  } catch (error) {
    fail(`command result ${expected.name} is not UTF-8: ${error.message}`);
  }
  const launch = validateLaunchAttestation({
    bytes: attestation,
    expected,
    worker: isolation.worker,
    workerPid: isolation.workerPid,
    environment,
  });
  return {
    value: record,
    stdout,
    stderr,
    stdoutText,
    stderrText,
    launch,
  };
}

function verifySessionValue({
  value,
  bytes,
  expectedConfiguration,
  contractBytes,
  contractSha256,
}) {
  exactKeys(
    value,
    [
      "schema",
      "configuration",
      "outcome",
      "reason",
      "commands",
      "stateBytes",
      "durationMs",
      "finalDescendantsObserved",
      "isolation",
    ],
    "session artifact",
  );
  if (
    value.schema !== G17_NATIVE_SESSION_RESULT_SCHEMA ||
    !isDeepStrictEqual(value.configuration, expectedConfiguration) ||
    !["pass", "fail", "incomplete", "error"].includes(value.outcome) ||
    !Array.isArray(value.commands) ||
    value.commands.length > expectedConfiguration.commands.length ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > expectedConfiguration.requestedLimits.totalWallMs
  ) {
    fail("session artifact identity, configuration, or duration drifted");
  }
  const diskBytes = expectedConfiguration.requestedLimits.diskBytes;
  if (
    value.stateBytes !== null &&
    (!Number.isSafeInteger(value.stateBytes) ||
      value.stateBytes < 0 ||
      value.stateBytes > diskBytes)
  ) {
    fail("session artifact state usage is invalid");
  }
  if (value.reason !== null) {
    exactKeys(value.reason, ["code", "command"], "session reason");
  }
  const commandReasonCodes = new Set([
    "command-exit-nonzero",
    "command-signal",
    "command-timeout",
    "command-timeout-unreaped",
    "command-output-limit",
    "command-output-limit-unreaped",
    "command-live-descendants",
  ]);
  const errorReasonCodes = new Set(["infrastructure", "result-too-large"]);
  if (
    value.reason !== null &&
    (!commandReasonCodes.has(value.reason.code) &&
      !errorReasonCodes.has(value.reason.code) &&
      value.reason.code !== "final-live-descendants")
  ) {
    fail("session reason code is not reviewed");
  }
  const nonErrorEvidence =
    value.commands.length >= 1 &&
    value.stateBytes !== null &&
    Number.isSafeInteger(value.finalDescendantsObserved) &&
    value.finalDescendantsObserved >= 0 &&
    value.isolation !== null;
  if (
    (value.outcome === "error" &&
      (value.commands.length !== 0 ||
        value.stateBytes !== null ||
        value.finalDescendantsObserved !== null ||
        value.isolation !== null ||
        value.reason === null ||
        !errorReasonCodes.has(value.reason.code) ||
        value.reason.command !== null)) ||
    (value.outcome !== "error" && !nonErrorEvidence)
  ) {
    fail("session outcome and evidence are contradictory");
  }
  const isolationReplay =
    value.isolation === null
      ? null
      : verifyIsolationObservations(
          value.isolation,
          expectedConfiguration.requestedLimits,
          value.stateBytes,
        );
  const decoded = value.commands.map((record, index) =>
    decodedCommandRecord(
      record,
      expectedConfiguration.commands[index],
      index,
      isolationReplay,
      expectedConfiguration.environment,
    ));
  if (
    decoded.reduce((total, command) => total + command.value.durationMs, 0) >
    value.durationMs + decoded.length
  ) {
    fail("session duration is shorter than its sequential command durations");
  }
  const classifyCommand = (record) => {
    if (record.descendantsObserved > 0) {
      return { outcome: "incomplete", code: "command-live-descendants" };
    }
    if (record.disposition !== "completed") {
      return { outcome: "incomplete", code: `command-${record.disposition}` };
    }
    if (record.signal !== null) return { outcome: "fail", code: "command-signal" };
    if (record.exitCode !== 0) return { outcome: "fail", code: "command-exit-nonzero" };
    return null;
  };
  const commandClassifications = decoded.map(({ value: record }) => classifyCommand(record));
  const firstTerminal = commandClassifications.findIndex((item) => item !== null);
  if (
    value.outcome !== "error" &&
    ((firstTerminal < 0 && decoded.length !== expectedConfiguration.commands.length) ||
      (firstTerminal >= 0 && firstTerminal !== decoded.length - 1))
  ) {
    fail("session command prefix did not stop at its first non-success");
  }
  const terminal = firstTerminal < 0 ? null : commandClassifications[firstTerminal];
  const last = decoded.at(-1)?.value;
  const expectedCommandReason = terminal === null
    ? null
    : { code: terminal.code, command: last.name };
  const finalContainment =
    value.reason?.code === "final-live-descendants" &&
    value.reason.command === null;
  if (
    (value.outcome === "pass" &&
      (value.reason !== null || terminal !== null || value.finalDescendantsObserved !== 0)) ||
    (value.outcome === "fail" &&
      (terminal?.outcome !== "fail" ||
        !isDeepStrictEqual(value.reason, expectedCommandReason) ||
        value.finalDescendantsObserved !== 0)) ||
    (value.outcome === "incomplete" &&
      (finalContainment
        ? (value.finalDescendantsObserved < 1 || terminal?.outcome === "incomplete")
        : (terminal?.outcome !== "incomplete" ||
          !isDeepStrictEqual(value.reason, expectedCommandReason) ||
          value.finalDescendantsObserved !== 0))) ||
    (value.outcome !== "incomplete" && finalContainment)
  ) {
    fail("session typed outcome or reason contradicts command evidence");
  }
  const reviewed = decodeReviewedContract({ contractBytes, contractSha256 });
  const effectiveIsolation =
    isolationReplay === null
      ? null
      : deepFreeze({
          ...isolationReplay.projection,
          commandLaunchesObserved: decoded.length,
          commandCapabilitiesDropped: true,
          noNewPrivileges: true,
          seccompFiltered: true,
          deniedSyscallProbesObserved: true,
          detachedCommandSessions: true,
          parentDeathSignal: "SIGKILL",
        });
  const lanes = [];
  let totalPassedTests = 0;
  if (value.outcome === "pass") {
    for (const [laneIndex, lane] of reviewed.compatibility.native.entries()) {
      const inventory = decoded[laneIndex * 2];
      const execution = decoded[laneIndex * 2 + 1];
      const replay = replayG17NativeLaneOutputContract({
        lane,
        inventoryStdout: inventory.stdoutText,
        inventoryStderr: inventory.stderrText,
        executionStdout: execution.stdoutText,
        executionStderr: execution.stderrText,
      });
      totalPassedTests += replay.observedPassedTests;
      lanes.push({
        id: lane.id,
        status: "PASS",
        inventoriedTestIds: replay.inventoriedTestIds,
        observedPassedTests: replay.observedPassedTests,
        inventoryDurationMs: inventory.value.durationMs,
        executionDurationMs: execution.value.durationMs,
        inventoryOutputSha256: canonicalSha256({
          stdout: inventory.value.stdoutSha256,
          stderr: inventory.value.stderrSha256,
        }),
        executionOutputSha256: canonicalSha256({
          stdout: execution.value.stdoutSha256,
          stderr: execution.value.stderrSha256,
        }),
      });
    }
  }
  return deepFreeze({
    schema: G17_NATIVE_SESSION_PROJECTION_SCHEMA,
    status: value.outcome.toUpperCase(),
    runId: expectedConfiguration.runId,
    bindings: cloneCanonical(expectedConfiguration.bindings, "session bindings"),
    artifact: {
      name: G17_NATIVE_SESSION_ARTIFACT_NAME,
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
    commandsObserved: decoded.length,
    lanes,
    totalPassedTests,
    stateBytes: value.stateBytes,
    durationMs: value.durationMs,
    reason: cloneCanonical(value.reason, "session reason"),
    finalDescendantsObserved: value.finalDescendantsObserved,
    effectiveIsolation,
  });
}

export function verifyG17NativeSessionArtifact({
  bytes,
  expectedConfiguration,
  contractBytes,
  contractSha256,
}) {
  try {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > G17_NATIVE_SESSION_MAX_BYTES ||
      bytes.length > expectedConfiguration?.maxResultBytes
    ) {
      fail("session artifact is not a bounded Buffer");
    }
    let value;
    try {
      value = JSON.parse(bytes);
    } catch (error) {
      fail(`session artifact is invalid JSON: ${error.message}`);
    }
    const expectedBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    if (!bytes.equals(expectedBytes)) fail("session artifact is not canonical JSON");
    return verifySessionValue({
      value,
      bytes,
      expectedConfiguration,
      contractBytes,
      contractSha256,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native session contract:")) throw error;
    fail(error.message);
  }
}

export function createG17NativeSessionArtifactForTesting({
  configuration,
  session,
  contractBytes,
  contractSha256,
}) {
  try {
    const value = {
      schema: G17_NATIVE_SESSION_RESULT_SCHEMA,
      configuration: cloneCanonical(configuration, "session configuration"),
      ...cloneCanonical(session, "session result"),
    };
    const storedBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    const projection = verifyG17NativeSessionArtifact({
      bytes: storedBytes,
      expectedConfiguration: configuration,
      contractBytes,
      contractSha256,
    });
    return Object.freeze({
      artifact: Object.freeze({
        name: G17_NATIVE_SESSION_ARTIFACT_NAME,
        get bytes() {
          return Buffer.from(storedBytes);
        },
        sha256: sha256(storedBytes),
      }),
      projection,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native session contract:")) throw error;
    fail(error.message);
  }
}
